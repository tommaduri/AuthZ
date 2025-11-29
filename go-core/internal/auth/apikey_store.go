package auth

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// APIKeyStore defines the interface for API key storage operations
type APIKeyStore interface {
	// CreateAPIKey stores a new API key
	CreateAPIKey(ctx context.Context, key *APIKey) error

	// GetAPIKeyByHash retrieves an API key by its hash
	GetAPIKeyByHash(ctx context.Context, keyHash string) (*APIKey, error)

	// GetAPIKeyByID retrieves an API key by its ID
	GetAPIKeyByID(ctx context.Context, keyID uuid.UUID) (*APIKey, error)

	// ListAPIKeysByAgent lists all API keys for a specific agent
	ListAPIKeysByAgent(ctx context.Context, agentID string, tenantID string, includeRevoked bool) ([]*APIKey, error)

	// UpdateLastUsed updates the last used timestamp for an API key
	UpdateLastUsed(ctx context.Context, keyID uuid.UUID) error

	// RevokeAPIKey marks an API key as revoked
	RevokeAPIKey(ctx context.Context, keyID uuid.UUID) error

	// DeleteAPIKey permanently deletes an API key
	DeleteAPIKey(ctx context.Context, keyID uuid.UUID) error

	// CleanupExpiredKeys deletes expired API keys (for maintenance)
	CleanupExpiredKeys(ctx context.Context, olderThan time.Duration) (int64, error)
}

// APIKeyValidator provides validation and verification functionality
type APIKeyValidator struct {
	store APIKeyStore
}

// NewAPIKeyValidator creates a new API key validator
func NewAPIKeyValidator(store APIKeyStore) *APIKeyValidator {
	return &APIKeyValidator{
		store: store,
	}
}

// ValidateAPIKey validates an API key and returns the associated metadata
func (v *APIKeyValidator) ValidateAPIKey(ctx context.Context, apiKey string) (*APIKey, error) {
	// Validate format
	if err := ValidateAPIKeyFormat(apiKey); err != nil {
		return nil, err
	}

	// Hash the key
	keyHash := HashAPIKey(apiKey)

	// Look up in store
	key, err := v.store.GetAPIKeyByHash(ctx, keyHash)
	if err != nil {
		return nil, err
	}

	// Check validity
	if !key.IsValid() {
		if key.IsRevoked() {
			return nil, ErrAPIKeyRevoked
		}
		if key.IsExpired() {
			return nil, ErrAPIKeyExpired
		}
	}

	// Update last used timestamp (async, don't block on errors)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = v.store.UpdateLastUsed(ctx, key.KeyID)
	}()

	return key, nil
}
