package apikey

import (
	"context"
	"crypto/subtle"
	"fmt"
	"time"

	"github.com/authz-engine/go-core/internal/auth"
)

// Validator validates API keys and enforces rate limiting
type Validator struct {
	store       APIKeyStore
	rateLimiter *RateLimiter
	generator   *Generator
}

// NewValidator creates a new API key validator
func NewValidator(store APIKeyStore, rateLimiter *RateLimiter) *Validator {
	return &Validator{
		store:       store,
		rateLimiter: rateLimiter,
		generator:   NewGenerator(),
	}
}

// ValidateAPIKey validates an API key and returns the associated principal
// Security: Uses SHA-256 hashing and constant-time comparison to prevent timing attacks
func (v *Validator) ValidateAPIKey(ctx context.Context, apiKey string) (*auth.Principal, error) {
	// Validate format first (fail fast)
	if err := v.generator.ValidateFormat(apiKey); err != nil {
		return nil, fmt.Errorf("invalid api key format: %w", err)
	}

	// Hash the provided plaintext key to compare with stored hash
	// Security: We hash the incoming key and compare hashes, never storing plaintext
	keyHash := v.generator.Hash(apiKey)

	// Lookup in database by hash
	// The database stores only SHA-256 hashes, never plaintext keys
	key, err := v.store.Get(ctx, keyHash)
	if err != nil {
		return nil, fmt.Errorf("lookup api key: %w", err)
	}

	// Security: Use constant-time comparison to prevent timing attacks
	// Compare the hash we just computed with the hash from the database
	// Both should be 64-character hex strings (SHA-256 output)
	if subtle.ConstantTimeCompare([]byte(key.KeyHash), []byte(keyHash)) != 1 {
		return nil, ErrInvalidAPIKey
	}

	// Check if revoked
	if key.IsRevoked() {
		return nil, ErrAPIKeyRevoked
	}

	// Check if expired
	if key.IsExpired() {
		return nil, ErrAPIKeyExpired
	}

	// Check rate limit
	if v.rateLimiter != nil {
		allowed, err := v.CheckRateLimit(ctx, key.ID, key.RateLimitRPS)
		if err != nil {
			// Log error but don't fail request (fail open for availability)
			// In production, you might want to fail closed for security
			return nil, fmt.Errorf("check rate limit: %w", err)
		}

		if !allowed {
			return nil, fmt.Errorf("rate limit exceeded for key %s", key.ID)
		}
	}

	// Update last used timestamp (async, don't block on this)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = v.store.UpdateLastUsed(ctx, key.ID)
	}()

	// Convert to principal
	return key.ToPrincipal(), nil
}

// CheckRateLimit checks if the API key has exceeded its rate limit
func (v *Validator) CheckRateLimit(ctx context.Context, keyID string, limitRPS int) (bool, error) {
	if v.rateLimiter == nil {
		return true, nil // No rate limiter configured
	}

	return v.rateLimiter.Allow(ctx, keyID, limitRPS)
}
