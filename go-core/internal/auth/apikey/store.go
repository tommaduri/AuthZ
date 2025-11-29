package apikey

import (
	"context"
	"errors"
)

// Common errors
var (
	ErrAPIKeyNotFound  = errors.New("api key not found")
	ErrAPIKeyExpired   = errors.New("api key expired")
	ErrAPIKeyRevoked   = errors.New("api key revoked")
	ErrInvalidAPIKey   = errors.New("invalid api key format")
	ErrDuplicateAPIKey = errors.New("api key already exists")
)

// APIKeyStore defines the interface for API key storage operations
type APIKeyStore interface {
	// Create creates a new API key
	Create(ctx context.Context, key *APIKey) error

	// Get retrieves an API key by its hash
	Get(ctx context.Context, keyHash string) (*APIKey, error)

	// GetByID retrieves an API key by its ID
	GetByID(ctx context.Context, keyID string) (*APIKey, error)

	// List retrieves all API keys for an agent
	List(ctx context.Context, agentID string, includeRevoked bool) ([]*APIKey, error)

	// Revoke marks an API key as revoked
	Revoke(ctx context.Context, keyID string) error

	// UpdateLastUsed updates the last used timestamp
	UpdateLastUsed(ctx context.Context, keyID string) error

	// Delete permanently deletes an API key
	Delete(ctx context.Context, keyID string) error

	// Close closes the store and releases resources
	Close() error
}
