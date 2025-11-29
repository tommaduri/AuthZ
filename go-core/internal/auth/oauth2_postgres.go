package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

var (
	// ErrClientNotFound is returned when a client is not found
	ErrClientNotFound = errors.New("oauth2 client not found")

	// ErrClientRevoked is returned when a client has been revoked
	ErrClientRevoked = errors.New("oauth2 client has been revoked")

	// ErrClientExpired is returned when a client has expired
	ErrClientExpired = errors.New("oauth2 client has expired")

	// ErrClientAlreadyExists is returned when trying to create a duplicate client
	ErrClientAlreadyExists = errors.New("oauth2 client already exists")
)

// PostgresOAuth2Store implements OAuth2ClientStore using PostgreSQL
type PostgresOAuth2Store struct {
	db *sql.DB
}

// NewPostgresOAuth2Store creates a new PostgreSQL-backed OAuth2 client store
func NewPostgresOAuth2Store(db *sql.DB) *PostgresOAuth2Store {
	return &PostgresOAuth2Store{db: db}
}

// GetClient retrieves a client by client_id
func (s *PostgresOAuth2Store) GetClient(ctx context.Context, clientID uuid.UUID) (*OAuth2Client, error) {
	query := `
		SELECT client_id, client_secret_hash, name, tenant_id, scopes,
		       created_at, expires_at, revoked_at
		FROM oauth2_clients
		WHERE client_id = $1
	`

	client := &OAuth2Client{}
	var scopes pq.StringArray

	err := s.db.QueryRowContext(ctx, query, clientID).Scan(
		&client.ClientID,
		&client.ClientSecretHash,
		&client.Name,
		&client.TenantID,
		&scopes,
		&client.CreatedAt,
		&client.ExpiresAt,
		&client.RevokedAt,
	)

	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrClientNotFound
		}
		return nil, fmt.Errorf("failed to get oauth2 client: %w", err)
	}

	client.Scopes = scopes

	// Check if client is active
	if client.RevokedAt != nil {
		return client, ErrClientRevoked
	}
	if client.ExpiresAt != nil && client.ExpiresAt.Before(time.Now()) {
		return client, ErrClientExpired
	}

	return client, nil
}

// CreateClient creates a new OAuth2 client
func (s *PostgresOAuth2Store) CreateClient(ctx context.Context, client *OAuth2Client) error {
	query := `
		INSERT INTO oauth2_clients (
			client_id, client_secret_hash, name, tenant_id, scopes,
			created_at, expires_at, revoked_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`

	if client.CreatedAt.IsZero() {
		client.CreatedAt = time.Now()
	}

	_, err := s.db.ExecContext(ctx, query,
		client.ClientID,
		client.ClientSecretHash,
		client.Name,
		client.TenantID,
		pq.Array(client.Scopes),
		client.CreatedAt,
		client.ExpiresAt,
		client.RevokedAt,
	)

	if err != nil {
		// Check for unique constraint violation
		if pqErr, ok := err.(*pq.Error); ok && pqErr.Code == "23505" {
			return ErrClientAlreadyExists
		}
		return fmt.Errorf("failed to create oauth2 client: %w", err)
	}

	return nil
}

// UpdateClient updates an existing client
func (s *PostgresOAuth2Store) UpdateClient(ctx context.Context, client *OAuth2Client) error {
	query := `
		UPDATE oauth2_clients
		SET name = $2, scopes = $3, expires_at = $4, revoked_at = $5
		WHERE client_id = $1
	`

	result, err := s.db.ExecContext(ctx, query,
		client.ClientID,
		client.Name,
		pq.Array(client.Scopes),
		client.ExpiresAt,
		client.RevokedAt,
	)

	if err != nil {
		return fmt.Errorf("failed to update oauth2 client: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rows == 0 {
		return ErrClientNotFound
	}

	return nil
}

// RevokeClient marks a client as revoked
func (s *PostgresOAuth2Store) RevokeClient(ctx context.Context, clientID uuid.UUID) error {
	query := `
		UPDATE oauth2_clients
		SET revoked_at = $2
		WHERE client_id = $1 AND revoked_at IS NULL
	`

	result, err := s.db.ExecContext(ctx, query, clientID, time.Now())
	if err != nil {
		return fmt.Errorf("failed to revoke oauth2 client: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rows == 0 {
		return ErrClientNotFound
	}

	return nil
}

// ListClientsByTenant lists all clients for a tenant
func (s *PostgresOAuth2Store) ListClientsByTenant(ctx context.Context, tenantID string) ([]*OAuth2Client, error) {
	query := `
		SELECT client_id, client_secret_hash, name, tenant_id, scopes,
		       created_at, expires_at, revoked_at
		FROM oauth2_clients
		WHERE tenant_id = $1
		ORDER BY created_at DESC
	`

	rows, err := s.db.QueryContext(ctx, query, tenantID)
	if err != nil {
		return nil, fmt.Errorf("failed to list oauth2 clients: %w", err)
	}
	defer rows.Close()

	var clients []*OAuth2Client

	for rows.Next() {
		client := &OAuth2Client{}
		var scopes pq.StringArray

		err := rows.Scan(
			&client.ClientID,
			&client.ClientSecretHash,
			&client.Name,
			&client.TenantID,
			&scopes,
			&client.CreatedAt,
			&client.ExpiresAt,
			&client.RevokedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan oauth2 client: %w", err)
		}

		client.Scopes = scopes
		clients = append(clients, client)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating oauth2 clients: %w", err)
	}

	return clients, nil
}

// DeleteClient permanently deletes a client
func (s *PostgresOAuth2Store) DeleteClient(ctx context.Context, clientID uuid.UUID) error {
	query := `DELETE FROM oauth2_clients WHERE client_id = $1`

	result, err := s.db.ExecContext(ctx, query, clientID)
	if err != nil {
		return fmt.Errorf("failed to delete oauth2 client: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rows == 0 {
		return ErrClientNotFound
	}

	return nil
}
