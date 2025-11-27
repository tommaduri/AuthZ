package apikey

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strings"
)

const (
	// API key format: ak_live_{base64url(32 bytes)}
	APIKeyPrefix = "ak"
	APIKeyEnv    = "live"
	APIKeyBytes  = 32 // 256 bits of entropy
)

// Generator handles secure API key generation
type Generator struct{}

// NewGenerator creates a new API key generator
func NewGenerator() *Generator {
	return &Generator{}
}

// Generate generates a new secure API key
// Format: ak_live_{base64url(32 random bytes)}
// Returns the plain key and its SHA-256 hash
func (g *Generator) Generate() (plainKey string, keyHash string, err error) {
	// Generate 32 bytes of cryptographically secure random data
	randomBytes := make([]byte, APIKeyBytes)
	if _, err := rand.Read(randomBytes); err != nil {
		return "", "", fmt.Errorf("generate random bytes: %w", err)
	}

	// Encode as base64url (URL-safe, no padding)
	encoded := base64.RawURLEncoding.EncodeToString(randomBytes)

	// Format: ak_live_{encoded}
	plainKey = fmt.Sprintf("%s_%s_%s", APIKeyPrefix, APIKeyEnv, encoded)

	// Hash the key with SHA-256
	keyHash = g.Hash(plainKey)

	return plainKey, keyHash, nil
}

// Hash computes the SHA-256 hash of an API key
// Security: This is used to hash API keys before storage.
// The database stores ONLY this hash, never the plaintext key.
// Returns a 64-character hex string (SHA-256 output).
func (g *Generator) Hash(plainKey string) string {
	hash := sha256.Sum256([]byte(plainKey))
	return fmt.Sprintf("%x", hash)
}

// ValidateFormat checks if an API key has the correct format
func (g *Generator) ValidateFormat(plainKey string) error {
	// Split on underscore - should have at least 3 parts: prefix_env_key
	parts := strings.SplitN(plainKey, "_", 3)
	if len(parts) < 3 {
		return fmt.Errorf("%w: expected format ak_env_key", ErrInvalidAPIKey)
	}

	if parts[0] != APIKeyPrefix {
		return fmt.Errorf("%w: invalid prefix", ErrInvalidAPIKey)
	}

	if parts[1] != APIKeyEnv && parts[1] != "test" {
		return fmt.Errorf("%w: invalid environment", ErrInvalidAPIKey)
	}

	// The rest is the base64-encoded key (may contain underscores from URL-safe encoding)
	keyPart := parts[2]
	if keyPart == "" {
		return fmt.Errorf("%w: missing key part", ErrInvalidAPIKey)
	}

	// Decode and validate length
	decoded, err := base64.RawURLEncoding.DecodeString(keyPart)
	if err != nil {
		return fmt.Errorf("%w: invalid base64 encoding", ErrInvalidAPIKey)
	}

	if len(decoded) != APIKeyBytes {
		return fmt.Errorf("%w: invalid key length (expected %d bytes, got %d)", ErrInvalidAPIKey, APIKeyBytes, len(decoded))
	}

	return nil
}
