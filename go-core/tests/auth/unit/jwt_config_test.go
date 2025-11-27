package unit

import (
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestJWTConfig_Validate_NoAuthMethod(t *testing.T) {
	// Arrange
	config := &auth.JWTConfig{}

	// Act
	err := config.Validate()

	// Assert
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no authentication method configured")
}

func TestJWTConfig_Validate_WithSecret(t *testing.T) {
	// Arrange
	config := &auth.JWTConfig{
		Secret: "test-secret",
	}

	// Act
	err := config.Validate()

	// Assert
	assert.NoError(t, err)
}

func TestJWTConfig_Validate_WithPublicKey(t *testing.T) {
	// Arrange
	config := &auth.JWTConfig{
		PublicKey: "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----",
	}

	// Act
	err := config.Validate()

	// Assert
	assert.NoError(t, err)
}

func TestJWTConfig_Validate_WithJWKS(t *testing.T) {
	// Arrange
	config := &auth.JWTConfig{
		JWKSUrl: "https://example.com/.well-known/jwks.json",
	}

	// Act
	err := config.Validate()

	// Assert
	assert.NoError(t, err)
	assert.Equal(t, 1*time.Hour, config.JWKSCacheTTL) // Default TTL set
}

func TestJWTConfig_Validate_CustomJWKSCacheTTL(t *testing.T) {
	// Arrange
	config := &auth.JWTConfig{
		JWKSUrl:      "https://example.com/.well-known/jwks.json",
		JWKSCacheTTL: 30 * time.Minute,
	}

	// Act
	err := config.Validate()

	// Assert
	assert.NoError(t, err)
	assert.Equal(t, 30*time.Minute, config.JWKSCacheTTL)
}

func TestDefaultJWTConfig(t *testing.T) {
	// Act
	config := auth.DefaultJWTConfig()

	// Assert
	require.NotNil(t, config)
	assert.Equal(t, "authz-engine", config.Issuer)
	assert.Equal(t, "authz-api", config.Audience)
	assert.Equal(t, 1*time.Hour, config.JWKSCacheTTL)
}

func TestJWTConfig_SkipValidationFlags(t *testing.T) {
	// Arrange
	config := &auth.JWTConfig{
		Secret:                "test-secret",
		SkipExpirationCheck:   true,
		SkipIssuerCheck:       true,
		SkipAudienceCheck:     true,
	}

	// Act
	err := config.Validate()

	// Assert
	assert.NoError(t, err)
	assert.True(t, config.SkipExpirationCheck)
	assert.True(t, config.SkipIssuerCheck)
	assert.True(t, config.SkipAudienceCheck)
}
