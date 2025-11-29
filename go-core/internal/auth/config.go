package auth

import (
	"fmt"
	"time"
)

// JWTConfig contains JWT authentication configuration
type JWTConfig struct {
	// HS256 configuration
	Secret string

	// RS256 configuration
	PublicKey     string // PEM-encoded public key
	PublicKeyFile string // Path to PEM file

	// JWKS configuration (for key rotation)
	JWKSUrl      string
	JWKSCacheTTL time.Duration

	// Token validation
	Issuer   string
	Audience string

	// Token revocation
	RevocationStore RevocationStore // Optional: Redis-based token revocation

	// Optional: Custom validation
	SkipExpirationCheck bool // For testing only
	SkipIssuerCheck     bool // For testing only
	SkipAudienceCheck   bool // For testing only
}

// Validate checks if the configuration is valid
func (c *JWTConfig) Validate() error {
	// Must have at least one authentication method
	if c.Secret == "" && c.PublicKey == "" && c.PublicKeyFile == "" && c.JWKSUrl == "" {
		return fmt.Errorf("no authentication method configured (need Secret, PublicKey, PublicKeyFile, or JWKSUrl)")
	}

	// JWKS requires cache TTL
	if c.JWKSUrl != "" && c.JWKSCacheTTL == 0 {
		c.JWKSCacheTTL = 1 * time.Hour // Default to 1 hour
	}

	return nil
}

// DefaultJWTConfig returns a default JWT configuration
func DefaultJWTConfig() *JWTConfig {
	return &JWTConfig{
		Issuer:       "authz-engine",
		Audience:     "authz-api",
		JWKSCacheTTL: 1 * time.Hour,
	}
}
