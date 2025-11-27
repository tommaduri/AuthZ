package apikey

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	_ "github.com/lib/pq" // PostgreSQL driver
)

// PostgresStore implements APIKeyStore using PostgreSQL
type PostgresStore struct {
	db *sql.DB
}

// NewPostgresStore creates a new PostgreSQL-backed API key store
func NewPostgresStore(db *sql.DB) (*PostgresStore, error) {
	if db == nil {
		return nil, errors.New("database connection is nil")
	}

	// Verify connection
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping database: %w", err)
	}

	return &PostgresStore{db: db}, nil
}

// Create creates a new API key
// Security: This method expects key.KeyHash to already contain the SHA-256 hash of the API key.
// NEVER pass a plaintext key in the KeyHash field - it must be hashed before calling Create.
func (s *PostgresStore) Create(ctx context.Context, key *APIKey) error {
	if key == nil {
		return errors.New("api key is nil")
	}

	// Security validation: Ensure KeyHash is present and looks like a hash (64 hex chars for SHA-256)
	if key.KeyHash == "" {
		return errors.New("key_hash is required (must be SHA-256 hash, never plaintext)")
	}
	if len(key.KeyHash) != 64 {
		return errors.New("key_hash must be 64 characters (SHA-256 hex)")
	}

	// Set defaults
	if key.CreatedAt.IsZero() {
		key.CreatedAt = time.Now()
	}
	if key.RateLimitRPS == 0 {
		key.RateLimitRPS = 100 // Default rate limit
	}

	// Serialize metadata
	var metadataJSON []byte
	var err error
	if key.Metadata != nil {
		metadataJSON, err = json.Marshal(key.Metadata)
		if err != nil {
			return fmt.Errorf("marshal metadata: %w", err)
		}
	}

	// Serialize scopes
	scopes := "{}"
	if len(key.Scopes) > 0 {
		scopesJSON, err := json.Marshal(key.Scopes)
		if err != nil {
			return fmt.Errorf("marshal scopes: %w", err)
		}
		scopes = string(scopesJSON)
	}

	query := `
		INSERT INTO api_keys (
			id, key_hash, name, agent_id, scopes,
			created_at, expires_at, rate_limit_rps, metadata
		) VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9)
		RETURNING id
	`

	// Note: key.KeyHash contains the SHA-256 hash, NOT the plaintext key
	// The plaintext key is never stored in the database
	err = s.db.QueryRowContext(
		ctx, query,
		key.ID, key.KeyHash, key.Name, key.AgentID, scopes,
		key.CreatedAt, key.ExpiresAt, key.RateLimitRPS, metadataJSON,
	).Scan(&key.ID)

	if err != nil {
		if isDuplicateKeyError(err) {
			return ErrDuplicateAPIKey
		}
		return fmt.Errorf("insert api key: %w", err)
	}

	return nil
}

// Get retrieves an API key by its hash
func (s *PostgresStore) Get(ctx context.Context, keyHash string) (*APIKey, error) {
	query := `
		SELECT id, key_hash, name, agent_id, scopes,
		       created_at, expires_at, last_used_at, revoked_at,
		       rate_limit_rps, metadata
		FROM api_keys
		WHERE key_hash = $1
	`

	key := &APIKey{}
	var scopesJSON, metadataJSON []byte

	err := s.db.QueryRowContext(ctx, query, keyHash).Scan(
		&key.ID, &key.KeyHash, &key.Name, &key.AgentID, &scopesJSON,
		&key.CreatedAt, &key.ExpiresAt, &key.LastUsedAt, &key.RevokedAt,
		&key.RateLimitRPS, &metadataJSON,
	)

	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrAPIKeyNotFound
		}
		return nil, fmt.Errorf("query api key: %w", err)
	}

	// Deserialize scopes
	if len(scopesJSON) > 0 {
		if err := json.Unmarshal(scopesJSON, &key.Scopes); err != nil {
			return nil, fmt.Errorf("unmarshal scopes: %w", err)
		}
	}

	// Deserialize metadata
	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &key.Metadata); err != nil {
			return nil, fmt.Errorf("unmarshal metadata: %w", err)
		}
	}

	return key, nil
}

// GetByID retrieves an API key by its ID
func (s *PostgresStore) GetByID(ctx context.Context, keyID string) (*APIKey, error) {
	query := `
		SELECT id, key_hash, name, agent_id, scopes,
		       created_at, expires_at, last_used_at, revoked_at,
		       rate_limit_rps, metadata
		FROM api_keys
		WHERE id = $1
	`

	key := &APIKey{}
	var scopesJSON, metadataJSON []byte

	err := s.db.QueryRowContext(ctx, query, keyID).Scan(
		&key.ID, &key.KeyHash, &key.Name, &key.AgentID, &scopesJSON,
		&key.CreatedAt, &key.ExpiresAt, &key.LastUsedAt, &key.RevokedAt,
		&key.RateLimitRPS, &metadataJSON,
	)

	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrAPIKeyNotFound
		}
		return nil, fmt.Errorf("query api key: %w", err)
	}

	// Deserialize scopes and metadata
	if len(scopesJSON) > 0 {
		json.Unmarshal(scopesJSON, &key.Scopes)
	}
	if len(metadataJSON) > 0 {
		json.Unmarshal(metadataJSON, &key.Metadata)
	}

	return key, nil
}

// List retrieves all API keys for an agent
func (s *PostgresStore) List(ctx context.Context, agentID string, includeRevoked bool) ([]*APIKey, error) {
	query := `
		SELECT id, key_hash, name, agent_id, scopes,
		       created_at, expires_at, last_used_at, revoked_at,
		       rate_limit_rps, metadata
		FROM api_keys
		WHERE agent_id = $1
	`

	if !includeRevoked {
		query += " AND revoked_at IS NULL"
	}

	query += " ORDER BY created_at DESC"

	rows, err := s.db.QueryContext(ctx, query, agentID)
	if err != nil {
		return nil, fmt.Errorf("query api keys: %w", err)
	}
	defer rows.Close()

	var keys []*APIKey
	for rows.Next() {
		key := &APIKey{}
		var scopesJSON, metadataJSON []byte

		err := rows.Scan(
			&key.ID, &key.KeyHash, &key.Name, &key.AgentID, &scopesJSON,
			&key.CreatedAt, &key.ExpiresAt, &key.LastUsedAt, &key.RevokedAt,
			&key.RateLimitRPS, &metadataJSON,
		)
		if err != nil {
			return nil, fmt.Errorf("scan api key: %w", err)
		}

		// Deserialize scopes and metadata
		if len(scopesJSON) > 0 {
			json.Unmarshal(scopesJSON, &key.Scopes)
		}
		if len(metadataJSON) > 0 {
			json.Unmarshal(metadataJSON, &key.Metadata)
		}

		keys = append(keys, key)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate rows: %w", err)
	}

	return keys, nil
}

// Revoke marks an API key as revoked
func (s *PostgresStore) Revoke(ctx context.Context, keyID string) error {
	query := `
		UPDATE api_keys
		SET revoked_at = $1
		WHERE id = $2 AND revoked_at IS NULL
	`

	result, err := s.db.ExecContext(ctx, query, time.Now(), keyID)
	if err != nil {
		return fmt.Errorf("revoke api key: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}

	if rows == 0 {
		return ErrAPIKeyNotFound
	}

	return nil
}

// UpdateLastUsed updates the last used timestamp
func (s *PostgresStore) UpdateLastUsed(ctx context.Context, keyID string) error {
	query := `
		UPDATE api_keys
		SET last_used_at = $1
		WHERE id = $2
	`

	_, err := s.db.ExecContext(ctx, query, time.Now(), keyID)
	if err != nil {
		return fmt.Errorf("update last used: %w", err)
	}

	return nil
}

// Delete permanently deletes an API key
func (s *PostgresStore) Delete(ctx context.Context, keyID string) error {
	query := `DELETE FROM api_keys WHERE id = $1`

	result, err := s.db.ExecContext(ctx, query, keyID)
	if err != nil {
		return fmt.Errorf("delete api key: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}

	if rows == 0 {
		return ErrAPIKeyNotFound
	}

	return nil
}

// Close closes the database connection
func (s *PostgresStore) Close() error {
	return s.db.Close()
}

// isDuplicateKeyError checks if an error is a duplicate key violation
func isDuplicateKeyError(err error) bool {
	// PostgreSQL error code 23505 is unique_violation
	return err != nil && (err.Error() == "pq: duplicate key value violates unique constraint \"api_keys_key_hash_key\"" ||
		err.Error() == "pq: duplicate key value violates unique constraint \"api_keys_pkey\"")
}
