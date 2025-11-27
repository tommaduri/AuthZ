// Package auth provides credential management for agent authentication
package auth

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// CredentialStore defines the interface for credential storage and retrieval
type CredentialStore interface {
	LookupCredentials(ctx context.Context, username, tenantID string) (agentID, passwordHash string, err error)
	UpdateLastLogin(ctx context.Context, agentID string) error
	StoreCredentials(ctx context.Context, agentID, username, passwordHash, tenantID string) error
	DeleteCredentials(ctx context.Context, agentID string) error
}

// PostgresCredentialStore implements CredentialStore using PostgreSQL
type PostgresCredentialStore struct {
	db *sql.DB
}

// NewPostgresCredentialStore creates a new PostgreSQL credential store
func NewPostgresCredentialStore(db *sql.DB) *PostgresCredentialStore {
	return &PostgresCredentialStore{
		db: db,
	}
}

// LookupCredentials retrieves agent credentials by username and tenant ID
// Returns the agent ID and password hash, or an error if not found
func (s *PostgresCredentialStore) LookupCredentials(ctx context.Context, username, tenantID string) (string, string, error) {
	if username == "" {
		return "", "", fmt.Errorf("username is required")
	}
	if tenantID == "" {
		return "", "", fmt.Errorf("tenant_id is required")
	}

	query := `
		SELECT agent_id, password_hash
		FROM agent_credentials
		WHERE username = $1 AND tenant_id = $2 AND deleted_at IS NULL
	`

	var agentID, passwordHash string
	err := s.db.QueryRowContext(ctx, query, username, tenantID).Scan(&agentID, &passwordHash)
	if err == sql.ErrNoRows {
		return "", "", fmt.Errorf("credentials not found for username: %s in tenant: %s", username, tenantID)
	}
	if err != nil {
		return "", "", fmt.Errorf("database query failed: %w", err)
	}

	return agentID, passwordHash, nil
}

// UpdateLastLogin updates the last login timestamp for an agent
func (s *PostgresCredentialStore) UpdateLastLogin(ctx context.Context, agentID string) error {
	if agentID == "" {
		return fmt.Errorf("agent_id is required")
	}

	query := `
		UPDATE agent_credentials
		SET last_login_at = $1
		WHERE agent_id = $2
	`

	result, err := s.db.ExecContext(ctx, query, time.Now(), agentID)
	if err != nil {
		return fmt.Errorf("failed to update last login: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("no credentials found for agent_id: %s", agentID)
	}

	return nil
}

// StoreCredentials stores new agent credentials
// This is typically called during agent registration
func (s *PostgresCredentialStore) StoreCredentials(ctx context.Context, agentID, username, passwordHash, tenantID string) error {
	if agentID == "" || username == "" || passwordHash == "" || tenantID == "" {
		return fmt.Errorf("all fields are required: agent_id, username, password_hash, tenant_id")
	}

	query := `
		INSERT INTO agent_credentials (agent_id, username, password_hash, tenant_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (username, tenant_id)
		DO UPDATE SET
			password_hash = EXCLUDED.password_hash,
			updated_at = EXCLUDED.updated_at,
			deleted_at = NULL
	`

	now := time.Now()
	_, err := s.db.ExecContext(ctx, query, agentID, username, passwordHash, tenantID, now, now)
	if err != nil {
		return fmt.Errorf("failed to store credentials: %w", err)
	}

	return nil
}

// DeleteCredentials soft-deletes agent credentials
func (s *PostgresCredentialStore) DeleteCredentials(ctx context.Context, agentID string) error {
	if agentID == "" {
		return fmt.Errorf("agent_id is required")
	}

	query := `
		UPDATE agent_credentials
		SET deleted_at = $1
		WHERE agent_id = $2 AND deleted_at IS NULL
	`

	result, err := s.db.ExecContext(ctx, query, time.Now(), agentID)
	if err != nil {
		return fmt.Errorf("failed to delete credentials: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("no credentials found for agent_id: %s", agentID)
	}

	return nil
}
