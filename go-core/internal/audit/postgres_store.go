package audit

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

// PostgresStore implements the Store interface using PostgreSQL
type PostgresStore struct {
	db *sql.DB
}

// NewPostgresStore creates a new PostgreSQL audit store
func NewPostgresStore(db *sql.DB) *PostgresStore {
	return &PostgresStore{db: db}
}

// Insert inserts a single audit event
func (s *PostgresStore) Insert(ctx context.Context, event *AuditEvent) error {
	query := `
		INSERT INTO auth_audit_logs (
			id, event_type, user_id, agent_id, api_key_id, tenant_id,
			timestamp, ip_address, user_agent, success, error_message,
			request_id, metadata, current_hash, prev_hash
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
		)
	`

	metadataJSON, err := json.Marshal(event.Metadata)
	if err != nil {
		return fmt.Errorf("failed to marshal metadata: %w", err)
	}

	_, err = s.db.ExecContext(ctx, query,
		event.ID,
		event.EventType,
		event.UserID,
		event.AgentID,
		event.APIKeyID,
		event.TenantID,
		event.Timestamp,
		event.IPAddress,
		event.UserAgent,
		event.Success,
		nullString(event.ErrorMessage),
		event.RequestID,
		metadataJSON,
		event.EventHash,
		nullString(event.PrevEventHash),
	)

	if err != nil {
		return fmt.Errorf("failed to insert audit event: %w", err)
	}

	return nil
}

// InsertBatch inserts multiple audit events in a single transaction
func (s *PostgresStore) InsertBatch(ctx context.Context, events []*AuditEvent) error {
	if len(events) == 0 {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO auth_audit_logs (
			id, event_type, user_id, agent_id, api_key_id, tenant_id,
			timestamp, ip_address, user_agent, success, error_message,
			request_id, metadata, current_hash, prev_hash
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare statement: %w", err)
	}
	defer stmt.Close()

	for _, event := range events {
		metadataJSON, err := json.Marshal(event.Metadata)
		if err != nil {
			return fmt.Errorf("failed to marshal metadata: %w", err)
		}

		_, err = stmt.ExecContext(ctx,
			event.ID,
			event.EventType,
			event.UserID,
			event.AgentID,
			event.APIKeyID,
			event.TenantID,
			event.Timestamp,
			event.IPAddress,
			event.UserAgent,
			event.Success,
			nullString(event.ErrorMessage),
			event.RequestID,
			metadataJSON,
			event.EventHash,
			nullString(event.PrevEventHash),
		)
		if err != nil {
			return fmt.Errorf("failed to insert event %s: %w", event.ID, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// Query retrieves audit events based on filter criteria
func (s *PostgresStore) Query(ctx context.Context, filter *AuditFilter) ([]*AuditEvent, error) {
	query := `
		SELECT
			id, event_type, user_id, agent_id, api_key_id, tenant_id,
			timestamp, ip_address, user_agent, success, error_message,
			request_id, metadata, current_hash, prev_hash
		FROM auth_audit_logs
		WHERE tenant_id = $1
	`
	args := []interface{}{filter.TenantID}
	argIndex := 2

	// Add user_id filter
	if filter.UserID != "" {
		query += fmt.Sprintf(" AND user_id = $%d", argIndex)
		args = append(args, filter.UserID)
		argIndex++
	}

	// Add event_type filter
	if len(filter.EventTypes) > 0 {
		query += fmt.Sprintf(" AND event_type = ANY($%d)", argIndex)
		args = append(args, pq.Array(filter.EventTypes))
		argIndex++
	}

	// Add success filter
	if filter.Success != nil {
		query += fmt.Sprintf(" AND success = $%d", argIndex)
		args = append(args, *filter.Success)
		argIndex++
	}

	// Add time range filters
	if !filter.StartTime.IsZero() {
		query += fmt.Sprintf(" AND timestamp >= $%d", argIndex)
		args = append(args, filter.StartTime)
		argIndex++
	}

	if !filter.EndTime.IsZero() {
		query += fmt.Sprintf(" AND timestamp <= $%d", argIndex)
		args = append(args, filter.EndTime)
		argIndex++
	}

	// Order by timestamp descending (most recent first)
	query += " ORDER BY timestamp DESC"

	// Add pagination
	if filter.Limit > 0 {
		query += fmt.Sprintf(" LIMIT $%d", argIndex)
		args = append(args, filter.Limit)
		argIndex++
	}

	if filter.Offset > 0 {
		query += fmt.Sprintf(" OFFSET $%d", argIndex)
		args = append(args, filter.Offset)
	}

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query audit events: %w", err)
	}
	defer rows.Close()

	var events []*AuditEvent
	for rows.Next() {
		event, err := scanAuditEvent(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating rows: %w", err)
	}

	return events, nil
}

// GetLastEvent retrieves the most recent audit event for a tenant
func (s *PostgresStore) GetLastEvent(ctx context.Context, tenantID string) (*AuditEvent, error) {
	query := `
		SELECT
			id, event_type, user_id, agent_id, api_key_id, tenant_id,
			timestamp, ip_address, user_agent, success, error_message,
			request_id, metadata, current_hash, prev_hash
		FROM auth_audit_logs
		WHERE tenant_id = $1
		ORDER BY timestamp DESC
		LIMIT 1
	`

	row := s.db.QueryRowContext(ctx, query, tenantID)
	event, err := scanAuditEvent(row)
	if err == sql.ErrNoRows {
		return nil, nil // No events yet
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get last event: %w", err)
	}

	return event, nil
}

// GetEventsByTimeRange retrieves events in chronological order for verification
func (s *PostgresStore) GetEventsByTimeRange(ctx context.Context, tenantID string, from, to time.Time) ([]*AuditEvent, error) {
	query := `
		SELECT
			id, event_type, user_id, agent_id, api_key_id, tenant_id,
			timestamp, ip_address, user_agent, success, error_message,
			request_id, metadata, current_hash, prev_hash
		FROM auth_audit_logs
		WHERE tenant_id = $1 AND timestamp >= $2 AND timestamp <= $3
		ORDER BY timestamp ASC
	`

	rows, err := s.db.QueryContext(ctx, query, tenantID, from, to)
	if err != nil {
		return nil, fmt.Errorf("failed to query events: %w", err)
	}
	defer rows.Close()

	var events []*AuditEvent
	for rows.Next() {
		event, err := scanAuditEvent(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}

	return events, rows.Err()
}

// VerifyIntegrity verifies the hash chain integrity for a tenant
func (s *PostgresStore) VerifyIntegrity(ctx context.Context, tenantID string, from, to time.Time) error {
	events, err := s.GetEventsByTimeRange(ctx, tenantID, from, to)
	if err != nil {
		return fmt.Errorf("failed to fetch events: %w", err)
	}

	if len(events) == 0 {
		return nil // No events to verify
	}

	return VerifyChain(events)
}

// scanAuditEvent scans a database row into an AuditEvent
func scanAuditEvent(scanner interface {
	Scan(dest ...interface{}) error
}) (*AuditEvent, error) {
	var event AuditEvent
	var userID, agentID sql.NullString
	var apiKeyID uuid.NullUUID
	var errorMessage, prevHash sql.NullString
	var metadataJSON []byte

	err := scanner.Scan(
		&event.ID,
		&event.EventType,
		&userID,
		&agentID,
		&apiKeyID,
		&event.TenantID,
		&event.Timestamp,
		&event.IPAddress,
		&event.UserAgent,
		&event.Success,
		&errorMessage,
		&event.RequestID,
		&metadataJSON,
		&event.EventHash,
		&prevHash,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to scan row: %w", err)
	}

	// Handle nullable fields
	if userID.Valid {
		event.UserID = &userID.String
	}
	if agentID.Valid {
		event.AgentID = &agentID.String
	}
	if apiKeyID.Valid {
		event.APIKeyID = &apiKeyID.UUID
	}
	if errorMessage.Valid {
		event.ErrorMessage = errorMessage.String
	}
	if prevHash.Valid {
		event.PrevEventHash = prevHash.String
	}

	// Unmarshal metadata
	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &event.Metadata); err != nil {
			return nil, fmt.Errorf("failed to unmarshal metadata: %w", err)
		}
	}

	return &event, nil
}

// nullString returns sql.NullString for empty strings
func nullString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{Valid: false}
	}
	return sql.NullString{String: s, Valid: true}
}
