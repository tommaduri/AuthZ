package auth

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

// PostgresAPIKeyStore implements APIKeyStore using PostgreSQL
type PostgresAPIKeyStore struct {
	db *sql.DB
}

// NewPostgresAPIKeyStore creates a new PostgreSQL-backed API key store
func NewPostgresAPIKeyStore(db *sql.DB) *PostgresAPIKeyStore {
	return &PostgresAPIKeyStore{
		db: db,
	}
}

// CreateAPIKey stores a new API key
func (s *PostgresAPIKeyStore) CreateAPIKey(ctx context.Context, key *APIKey) error {
	query := `
		INSERT INTO api_keys (
			key_id, key_hash, key_prefix, agent_id, tenant_id,
			name, scopes, rate_limit_per_sec, created_at, expires_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`

	_, err := s.db.ExecContext(ctx, query,
		key.KeyID,
		key.KeyHash,
		key.KeyPrefix,
		key.AgentID,
		key.TenantID,
		key.Name,
		pq.Array(key.Scopes),
		key.RateLimitPerSec,
		key.CreatedAt,
		key.ExpiresAt,
	)

	if err != nil {
		return fmt.Errorf("failed to create API key: %w", err)
	}

	return nil
}

// GetAPIKeyByHash retrieves an API key by its hash
func (s *PostgresAPIKeyStore) GetAPIKeyByHash(ctx context.Context, keyHash string) (*APIKey, error) {
	query := `
		SELECT
			key_id, key_hash, key_prefix, agent_id, tenant_id,
			name, scopes, rate_limit_per_sec, created_at,
			last_used_at, expires_at, revoked_at
		FROM api_keys
		WHERE key_hash = $1
	`

	key := &APIKey{}
	var scopes pq.StringArray

	err := s.db.QueryRowContext(ctx, query, keyHash).Scan(
		&key.KeyID,
		&key.KeyHash,
		&key.KeyPrefix,
		&key.AgentID,
		&key.TenantID,
		&key.Name,
		&scopes,
		&key.RateLimitPerSec,
		&key.CreatedAt,
		&key.LastUsedAt,
		&key.ExpiresAt,
		&key.RevokedAt,
	)

	if err == sql.ErrNoRows {
		return nil, ErrAPIKeyNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get API key: %w", err)
	}

	key.Scopes = []string(scopes)
	return key, nil
}

// GetAPIKeyByID retrieves an API key by its ID
func (s *PostgresAPIKeyStore) GetAPIKeyByID(ctx context.Context, keyID uuid.UUID) (*APIKey, error) {
	query := `
		SELECT
			key_id, key_hash, key_prefix, agent_id, tenant_id,
			name, scopes, rate_limit_per_sec, created_at,
			last_used_at, expires_at, revoked_at
		FROM api_keys
		WHERE key_id = $1
	`

	key := &APIKey{}
	var scopes pq.StringArray

	err := s.db.QueryRowContext(ctx, query, keyID).Scan(
		&key.KeyID,
		&key.KeyHash,
		&key.KeyPrefix,
		&key.AgentID,
		&key.TenantID,
		&key.Name,
		&scopes,
		&key.RateLimitPerSec,
		&key.CreatedAt,
		&key.LastUsedAt,
		&key.ExpiresAt,
		&key.RevokedAt,
	)

	if err == sql.ErrNoRows {
		return nil, ErrAPIKeyNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get API key: %w", err)
	}

	key.Scopes = []string(scopes)
	return key, nil
}

// ListAPIKeysByAgent lists all API keys for a specific agent
func (s *PostgresAPIKeyStore) ListAPIKeysByAgent(ctx context.Context, agentID string, tenantID string, includeRevoked bool) ([]*APIKey, error) {
	query := `
		SELECT
			key_id, key_hash, key_prefix, agent_id, tenant_id,
			name, scopes, rate_limit_per_sec, created_at,
			last_used_at, expires_at, revoked_at
		FROM api_keys
		WHERE agent_id = $1 AND tenant_id = $2
	`

	if !includeRevoked {
		query += " AND revoked_at IS NULL"
	}

	query += " ORDER BY created_at DESC"

	rows, err := s.db.QueryContext(ctx, query, agentID, tenantID)
	if err != nil {
		return nil, fmt.Errorf("failed to list API keys: %w", err)
	}
	defer rows.Close()

	var keys []*APIKey
	for rows.Next() {
		key := &APIKey{}
		var scopes pq.StringArray

		err := rows.Scan(
			&key.KeyID,
			&key.KeyHash,
			&key.KeyPrefix,
			&key.AgentID,
			&key.TenantID,
			&key.Name,
			&scopes,
			&key.RateLimitPerSec,
			&key.CreatedAt,
			&key.LastUsedAt,
			&key.ExpiresAt,
			&key.RevokedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan API key: %w", err)
		}

		key.Scopes = []string(scopes)
		keys = append(keys, key)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating API keys: %w", err)
	}

	return keys, nil
}

// UpdateLastUsed updates the last used timestamp for an API key
func (s *PostgresAPIKeyStore) UpdateLastUsed(ctx context.Context, keyID uuid.UUID) error {
	query := `
		UPDATE api_keys
		SET last_used_at = $1
		WHERE key_id = $2
	`

	_, err := s.db.ExecContext(ctx, query, time.Now(), keyID)
	if err != nil {
		return fmt.Errorf("failed to update last used: %w", err)
	}

	return nil
}

// RevokeAPIKey marks an API key as revoked
func (s *PostgresAPIKeyStore) RevokeAPIKey(ctx context.Context, keyID uuid.UUID) error {
	query := `
		UPDATE api_keys
		SET revoked_at = $1
		WHERE key_id = $2 AND revoked_at IS NULL
	`

	result, err := s.db.ExecContext(ctx, query, time.Now(), keyID)
	if err != nil {
		return fmt.Errorf("failed to revoke API key: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rows == 0 {
		return ErrAPIKeyNotFound
	}

	return nil
}

// DeleteAPIKey permanently deletes an API key
func (s *PostgresAPIKeyStore) DeleteAPIKey(ctx context.Context, keyID uuid.UUID) error {
	query := `DELETE FROM api_keys WHERE key_id = $1`

	result, err := s.db.ExecContext(ctx, query, keyID)
	if err != nil {
		return fmt.Errorf("failed to delete API key: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rows == 0 {
		return ErrAPIKeyNotFound
	}

	return nil
}

// CleanupExpiredKeys deletes expired API keys older than the specified duration
func (s *PostgresAPIKeyStore) CleanupExpiredKeys(ctx context.Context, olderThan time.Duration) (int64, error) {
	query := `
		DELETE FROM api_keys
		WHERE expires_at IS NOT NULL
		AND expires_at < $1
	`

	cutoff := time.Now().Add(-olderThan)
	result, err := s.db.ExecContext(ctx, query, cutoff)
	if err != nil {
		return 0, fmt.Errorf("failed to cleanup expired keys: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("failed to get rows affected: %w", err)
	}

	return rows, nil
}
