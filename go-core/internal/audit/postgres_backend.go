package audit

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/authz-engine/go-core/pkg/types"
	"github.com/google/uuid"
	"github.com/lib/pq"
)

// PostgresBackend implements audit log storage in PostgreSQL
type PostgresBackend struct {
	db *sql.DB
}

// NewPostgresBackend creates a new PostgreSQL audit backend
func NewPostgresBackend(db *sql.DB) *PostgresBackend {
	return &PostgresBackend{
		db: db,
	}
}

// InitializeSchema creates the audit log table if it doesn't exist
func (pb *PostgresBackend) InitializeSchema(ctx context.Context) error {
	schema := `
	CREATE TABLE IF NOT EXISTS auth_audit_logs (
		id VARCHAR(255) PRIMARY KEY,
		timestamp TIMESTAMPTZ NOT NULL,
		event_type VARCHAR(100) NOT NULL,
		actor_id VARCHAR(255) NOT NULL,
		agent_id VARCHAR(255),
		tenant_id VARCHAR(255) NOT NULL,
		ip_address VARCHAR(45) NOT NULL,
		user_agent TEXT,
		request_id VARCHAR(255),
		success BOOLEAN NOT NULL,
		error_message TEXT,
		error_code VARCHAR(100),
		metadata JSONB,
		prev_hash VARCHAR(64) NOT NULL,
		hash VARCHAR(64) NOT NULL,
		created_at TIMESTAMPTZ DEFAULT NOW()
	);

	-- Indexes for query performance
	CREATE INDEX IF NOT EXISTS idx_audit_tenant_timestamp ON auth_audit_logs(tenant_id, timestamp DESC);
	CREATE INDEX IF NOT EXISTS idx_audit_actor_timestamp ON auth_audit_logs(actor_id, timestamp DESC);
	CREATE INDEX IF NOT EXISTS idx_audit_event_type ON auth_audit_logs(event_type);
	CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON auth_audit_logs(timestamp DESC);
	CREATE INDEX IF NOT EXISTS idx_audit_success ON auth_audit_logs(success);
	CREATE INDEX IF NOT EXISTS idx_audit_request_id ON auth_audit_logs(request_id) WHERE request_id IS NOT NULL;

	-- GIN index for JSONB metadata queries
	CREATE INDEX IF NOT EXISTS idx_audit_metadata ON auth_audit_logs USING GIN(metadata);

	-- Hash chain verification index
	CREATE INDEX IF NOT EXISTS idx_audit_hash_chain ON auth_audit_logs(prev_hash, hash);
	`

	_, err := pb.db.ExecContext(ctx, schema)
	return err
}

// Store saves an audit event to PostgreSQL
func (pb *PostgresBackend) Store(ctx context.Context, event *types.AuditEvent) error {
	// Generate ID if not present
	if event.ID == "" {
		event.ID = uuid.New().String()
	}

	// Serialize metadata to JSON
	var metadataJSON []byte
	var err error
	if len(event.Metadata) > 0 {
		metadataJSON, err = json.Marshal(event.Metadata)
		if err != nil {
			return fmt.Errorf("failed to marshal metadata: %w", err)
		}
	}

	query := `
		INSERT INTO auth_audit_logs (
			id, timestamp, event_type, actor_id, agent_id, tenant_id,
			ip_address, user_agent, request_id, success, error_message, error_code,
			metadata, prev_hash, hash
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
		)
	`

	_, err = pb.db.ExecContext(ctx, query,
		event.ID,
		event.Timestamp,
		event.EventType,
		event.ActorID,
		nullString(event.AgentID),
		event.TenantID,
		event.IPAddress,
		nullString(event.UserAgent),
		nullString(event.RequestID),
		event.Success,
		nullString(event.ErrorMessage),
		nullString(event.ErrorCode),
		metadataJSON,
		event.PrevHash,
		event.Hash,
	)

	if err != nil {
		return fmt.Errorf("failed to store audit event: %w", err)
	}

	return nil
}

// GetLastHash retrieves the hash of the most recent audit event
func (pb *PostgresBackend) GetLastHash(ctx context.Context) (string, error) {
	var hash string
	query := `SELECT hash FROM auth_audit_logs ORDER BY timestamp DESC, created_at DESC LIMIT 1`

	err := pb.db.QueryRowContext(ctx, query).Scan(&hash)
	if err == sql.ErrNoRows {
		return "", nil // No events yet
	}
	if err != nil {
		return "", fmt.Errorf("failed to get last hash: %w", err)
	}

	return hash, nil
}

// Query retrieves audit events based on query criteria
func (pb *PostgresBackend) Query(ctx context.Context, query *types.AuditQuery) (*types.AuditQueryResult, error) {
	// Build WHERE clause
	where := "WHERE 1=1"
	args := []interface{}{}
	argIdx := 1

	if query.StartTime != nil {
		where += fmt.Sprintf(" AND timestamp >= $%d", argIdx)
		args = append(args, *query.StartTime)
		argIdx++
	}

	if query.EndTime != nil {
		where += fmt.Sprintf(" AND timestamp <= $%d", argIdx)
		args = append(args, *query.EndTime)
		argIdx++
	}

	if len(query.EventTypes) > 0 {
		where += fmt.Sprintf(" AND event_type = ANY($%d)", argIdx)
		eventTypes := make([]string, len(query.EventTypes))
		for i, et := range query.EventTypes {
			eventTypes[i] = string(et)
		}
		args = append(args, pq.Array(eventTypes))
		argIdx++
	}

	if query.ActorID != nil {
		where += fmt.Sprintf(" AND actor_id = $%d", argIdx)
		args = append(args, *query.ActorID)
		argIdx++
	}

	if query.TenantID != nil {
		where += fmt.Sprintf(" AND tenant_id = $%d", argIdx)
		args = append(args, *query.TenantID)
		argIdx++
	}

	if query.Success != nil {
		where += fmt.Sprintf(" AND success = $%d", argIdx)
		args = append(args, *query.Success)
		argIdx++
	}

	// Count total
	countQuery := "SELECT COUNT(*) FROM auth_audit_logs " + where
	var totalCount int
	err := pb.db.QueryRowContext(ctx, countQuery, args...).Scan(&totalCount)
	if err != nil {
		return nil, fmt.Errorf("failed to count audit events: %w", err)
	}

	// Build ORDER BY
	orderBy := "ORDER BY timestamp DESC"
	if query.SortBy != "" {
		direction := "DESC"
		if query.SortOrder == "asc" {
			direction = "ASC"
		}
		orderBy = fmt.Sprintf("ORDER BY %s %s", query.SortBy, direction)
	}

	// Build LIMIT/OFFSET
	limit := 100 // Default
	if query.Limit > 0 {
		limit = query.Limit
	}
	offset := 0
	if query.Offset > 0 {
		offset = query.Offset
	}

	// Query events
	selectQuery := fmt.Sprintf(`
		SELECT id, timestamp, event_type, actor_id, agent_id, tenant_id,
		       ip_address, user_agent, request_id, success, error_message, error_code,
		       metadata, prev_hash, hash
		FROM auth_audit_logs
		%s
		%s
		LIMIT $%d OFFSET $%d
	`, where, orderBy, argIdx, argIdx+1)

	args = append(args, limit, offset)

	rows, err := pb.db.QueryContext(ctx, selectQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query audit events: %w", err)
	}
	defer rows.Close()

	events := []*types.AuditEvent{}
	for rows.Next() {
		event := &types.AuditEvent{}
		var metadataJSON []byte
		var agentID, userAgent, requestID, errorMessage, errorCode sql.NullString

		err := rows.Scan(
			&event.ID,
			&event.Timestamp,
			&event.EventType,
			&event.ActorID,
			&agentID,
			&event.TenantID,
			&event.IPAddress,
			&userAgent,
			&requestID,
			&event.Success,
			&errorMessage,
			&errorCode,
			&metadataJSON,
			&event.PrevHash,
			&event.Hash,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan audit event: %w", err)
		}

		// Handle nullable fields
		if agentID.Valid {
			event.AgentID = agentID.String
		}
		if userAgent.Valid {
			event.UserAgent = userAgent.String
		}
		if requestID.Valid {
			event.RequestID = requestID.String
		}
		if errorMessage.Valid {
			event.ErrorMessage = errorMessage.String
		}
		if errorCode.Valid {
			event.ErrorCode = errorCode.String
		}

		// Deserialize metadata
		if len(metadataJSON) > 0 {
			event.Metadata = make(map[string]interface{})
			if err := json.Unmarshal(metadataJSON, &event.Metadata); err != nil {
				return nil, fmt.Errorf("failed to unmarshal metadata: %w", err)
			}
		}

		events = append(events, event)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating audit events: %w", err)
	}

	return &types.AuditQueryResult{
		Events:     events,
		TotalCount: totalCount,
		HasMore:    offset+len(events) < totalCount,
	}, nil
}

// GetStatistics retrieves aggregate statistics for audit events
func (pb *PostgresBackend) GetStatistics(ctx context.Context, tenantID string, timeRange time.Duration) (*types.AuditStatistics, error) {
	startTime := time.Now().UTC().Add(-timeRange)

	stats := &types.AuditStatistics{
		TenantID:     tenantID,
		TimeRange:    timeRange.String(),
		EventsByType: make(map[types.AuditEventType]int64),
		EventsByActor: make(map[string]int64),
	}

	// Total events
	err := pb.db.QueryRowContext(ctx, `
		SELECT COUNT(*),
		       SUM(CASE WHEN success THEN 1 ELSE 0 END) as success_count,
		       SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) as failure_count,
		       COUNT(DISTINCT actor_id) as unique_actors,
		       COUNT(DISTINCT ip_address) as unique_ips
		FROM auth_audit_logs
		WHERE tenant_id = $1 AND timestamp >= $2
	`, tenantID, startTime).Scan(&stats.TotalEvents, &stats.SuccessCount, &stats.FailureCount,
		&stats.UniqueActors, &stats.UniqueIPAddrs)

	if err != nil {
		return nil, fmt.Errorf("failed to get total statistics: %w", err)
	}

	// Events by type
	rows, err := pb.db.QueryContext(ctx, `
		SELECT event_type, COUNT(*)
		FROM auth_audit_logs
		WHERE tenant_id = $1 AND timestamp >= $2
		GROUP BY event_type
	`, tenantID, startTime)
	if err != nil {
		return nil, fmt.Errorf("failed to get events by type: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var eventType types.AuditEventType
		var count int64
		if err := rows.Scan(&eventType, &count); err != nil {
			return nil, err
		}
		stats.EventsByType[eventType] = count
	}

	// Events by actor (top 10)
	rows2, err := pb.db.QueryContext(ctx, `
		SELECT actor_id, COUNT(*)
		FROM auth_audit_logs
		WHERE tenant_id = $1 AND timestamp >= $2
		GROUP BY actor_id
		ORDER BY COUNT(*) DESC
		LIMIT 10
	`, tenantID, startTime)
	if err != nil {
		return nil, fmt.Errorf("failed to get events by actor: %w", err)
	}
	defer rows2.Close()

	for rows2.Next() {
		var actorID string
		var count int64
		if err := rows2.Scan(&actorID, &count); err != nil {
			return nil, err
		}
		stats.EventsByActor[actorID] = count
	}

	return stats, nil
}

// nullString converts a string to sql.NullString
func nullString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{Valid: false}
	}
	return sql.NullString{String: s, Valid: true}
}
