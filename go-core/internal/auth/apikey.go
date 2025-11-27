// Package auth provides authentication and authorization functionality
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	// APIKeyPrefix is the prefix for all API keys
	APIKeyPrefix = "authz_"

	// APIKeyLength is the length of the random part (32 bytes)
	APIKeyLength = 32

	// APIKeyPrefixDisplayLength is how many chars to store for identification
	APIKeyPrefixDisplayLength = 8
)

// APIKey represents an API key with metadata
type APIKey struct {
	KeyID          uuid.UUID  `json:"key_id"`
	KeyHash        string     `json:"-"` // Never expose hash
	KeyPrefix      string     `json:"key_prefix"` // First 8 chars for identification
	AgentID        string     `json:"agent_id"`
	TenantID       string     `json:"tenant_id"`
	Name           string     `json:"name,omitempty"`
	Scopes         []string   `json:"scopes,omitempty"`
	RateLimitPerSec int       `json:"rate_limit_per_sec"`
	CreatedAt      time.Time  `json:"created_at"`
	LastUsedAt     *time.Time `json:"last_used_at,omitempty"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
	RevokedAt      *time.Time `json:"revoked_at,omitempty"`
}

// APIKeyCreateRequest represents a request to create a new API key
type APIKeyCreateRequest struct {
	AgentID         string     `json:"agent_id" validate:"required"`
	TenantID        string     `json:"tenant_id" validate:"required"`
	Name            string     `json:"name,omitempty"`
	Scopes          []string   `json:"scopes,omitempty"`
	RateLimitPerSec int        `json:"rate_limit_per_sec,omitempty"`
	ExpiresAt       *time.Time `json:"expires_at,omitempty"`
}

// APIKeyResponse represents the response when creating an API key
type APIKeyResponse struct {
	Key    string  `json:"key"` // Only returned once on creation
	APIKey APIKey  `json:"metadata"`
}

// GenerateAPIKey creates a new API key with cryptographic randomness
func GenerateAPIKey() (string, error) {
	// Generate 32 random bytes
	randomBytes := make([]byte, APIKeyLength)
	if _, err := rand.Read(randomBytes); err != nil {
		return "", fmt.Errorf("failed to generate random bytes: %w", err)
	}

	// Encode to base64url (URL-safe, no padding)
	encoded := base64.RawURLEncoding.EncodeToString(randomBytes)

	// Add prefix
	return APIKeyPrefix + encoded, nil
}

// HashAPIKey creates a SHA-256 hash of the API key
func HashAPIKey(apiKey string) string {
	hash := sha256.Sum256([]byte(apiKey))
	return fmt.Sprintf("%x", hash)
}

// ExtractKeyPrefix gets the first N characters for identification
func ExtractKeyPrefix(apiKey string) string {
	if len(apiKey) < APIKeyPrefixDisplayLength {
		return apiKey
	}
	return apiKey[:APIKeyPrefixDisplayLength]
}

// ValidateAPIKeyFormat checks if the API key has valid format
func ValidateAPIKeyFormat(apiKey string) error {
	if !strings.HasPrefix(apiKey, APIKeyPrefix) {
		return fmt.Errorf("invalid API key format: missing prefix")
	}

	// Remove prefix and check length
	withoutPrefix := strings.TrimPrefix(apiKey, APIKeyPrefix)

	// Base64url encoded 32 bytes should be ~43 characters
	if len(withoutPrefix) < 40 || len(withoutPrefix) > 50 {
		return fmt.Errorf("invalid API key format: incorrect length")
	}

	// Validate base64url encoding
	if _, err := base64.RawURLEncoding.DecodeString(withoutPrefix); err != nil {
		return fmt.Errorf("invalid API key format: not valid base64url encoding")
	}

	return nil
}

// IsExpired checks if the API key has expired
func (k *APIKey) IsExpired() bool {
	if k.ExpiresAt == nil {
		return false
	}
	return time.Now().After(*k.ExpiresAt)
}

// IsRevoked checks if the API key has been revoked
func (k *APIKey) IsRevoked() bool {
	return k.RevokedAt != nil
}

// IsValid checks if the API key is valid (not expired and not revoked)
func (k *APIKey) IsValid() bool {
	return !k.IsExpired() && !k.IsRevoked()
}

// HasScope checks if the API key has a specific scope
func (k *APIKey) HasScope(scope string) bool {
	// Empty scopes means all scopes are allowed
	if len(k.Scopes) == 0 {
		return true
	}

	for _, s := range k.Scopes {
		if s == scope || s == "*" {
			return true
		}
	}
	return false
}

// MaskKey returns a masked version of the key for display (e.g., "authz_abc...xyz")
func MaskKey(apiKey string) string {
	if len(apiKey) < 16 {
		return "***"
	}
	return apiKey[:12] + "..." + apiKey[len(apiKey)-4:]
}
