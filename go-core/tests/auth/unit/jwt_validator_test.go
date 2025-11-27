package unit

import (
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/auth"
	auth_test "github.com/authz-engine/go-core/tests/auth"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestJWTValidator_RS256_ValidToken(t *testing.T) {
	// Arrange
	keyPair := auth_test.GenerateTestKeyPair(t)
	config := &auth.JWTConfig{
		PublicKey: keyPair.PublicKeyPEM,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	}

	validator, err := auth.NewJWTValidator(config)
	require.NoError(t, err)
	defer validator.Close()

	claims := auth_test.DefaultTestClaims()
	tokenString := auth_test.GenerateTestToken(t, keyPair, claims)

	// Act
	validatedClaims, err := validator.Validate(tokenString)

	// Assert
	require.NoError(t, err)
	assert.NotNil(t, validatedClaims)
	assert.Equal(t, "agent:test-123", validatedClaims.Subject)
	assert.Equal(t, "testuser", validatedClaims.Username)
	assert.Equal(t, []string{"user", "admin"}, validatedClaims.Roles)
}

func TestJWTValidator_HS256_ValidToken(t *testing.T) {
	// Arrange
	secret := "test-secret-key-min-32-characters-long"
	config := &auth.JWTConfig{
		Secret:   secret,
		Issuer:   "authz-engine",
		Audience: "authz-api",
	}

	validator, err := auth.NewJWTValidator(config)
	require.NoError(t, err)
	defer validator.Close()

	claims := auth_test.DefaultTestClaims()
	tokenString := auth_test.GenerateTestTokenHS256(t, secret, claims)

	// Act
	validatedClaims, err := validator.Validate(tokenString)

	// Assert
	require.NoError(t, err)
	assert.NotNil(t, validatedClaims)
	assert.Equal(t, "agent:test-123", validatedClaims.Subject)
}

func TestJWTValidator_ExpiredToken_Rejected(t *testing.T) {
	// Arrange
	keyPair := auth_test.GenerateTestKeyPair(t)
	config := &auth.JWTConfig{
		PublicKey: keyPair.PublicKeyPEM,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	}

	validator, err := auth.NewJWTValidator(config)
	require.NoError(t, err)
	defer validator.Close()

	expiredClaims := auth_test.ExpiredTestClaims()
	tokenString := auth_test.GenerateTestToken(t, keyPair, expiredClaims)

	// Act
	_, err = validator.Validate(tokenString)

	// Assert
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "token is expired")
}

func TestJWTValidator_InvalidSignature_Rejected(t *testing.T) {
	// Arrange
	keyPair1 := auth_test.GenerateTestKeyPair(t)
	keyPair2 := auth_test.GenerateTestKeyPair(t)

	// Create validator with keyPair1's public key
	config := &auth.JWTConfig{
		PublicKey: keyPair1.PublicKeyPEM,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	}

	validator, err := auth.NewJWTValidator(config)
	require.NoError(t, err)
	defer validator.Close()

	// Generate token with keyPair2's private key (different key)
	claims := auth_test.DefaultTestClaims()
	tokenString := auth_test.GenerateTestToken(t, keyPair2, claims)

	// Act
	_, err = validator.Validate(tokenString)

	// Assert
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "crypto/rsa")
}

func TestJWTValidator_InvalidIssuer_Rejected(t *testing.T) {
	// Arrange
	keyPair := auth_test.GenerateTestKeyPair(t)
	config := &auth.JWTConfig{
		PublicKey: keyPair.PublicKeyPEM,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	}

	validator, err := auth.NewJWTValidator(config)
	require.NoError(t, err)
	defer validator.Close()

	invalidClaims := auth_test.InvalidIssuerClaims()
	tokenString := auth_test.GenerateTestToken(t, keyPair, invalidClaims)

	// Act
	_, err = validator.Validate(tokenString)

	// Assert
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid issuer")
}

func TestJWTValidator_InvalidAudience_Rejected(t *testing.T) {
	// Arrange
	keyPair := auth_test.GenerateTestKeyPair(t)
	config := &auth.JWTConfig{
		PublicKey: keyPair.PublicKeyPEM,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	}

	validator, err := auth.NewJWTValidator(config)
	require.NoError(t, err)
	defer validator.Close()

	invalidClaims := auth_test.InvalidAudienceClaims()
	tokenString := auth_test.GenerateTestToken(t, keyPair, invalidClaims)

	// Act
	_, err = validator.Validate(tokenString)

	// Assert
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid audience")
}

func TestJWTValidator_EmptyToken_Rejected(t *testing.T) {
	// Arrange
	keyPair := auth_test.GenerateTestKeyPair(t)
	config := &auth.JWTConfig{
		PublicKey: keyPair.PublicKeyPEM,
	}

	validator, err := auth.NewJWTValidator(config)
	require.NoError(t, err)
	defer validator.Close()

	// Act
	_, err = validator.Validate("")

	// Assert
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "empty token")
}

func TestJWTValidator_MalformedToken_Rejected(t *testing.T) {
	// Arrange
	keyPair := auth_test.GenerateTestKeyPair(t)
	config := &auth.JWTConfig{
		PublicKey: keyPair.PublicKeyPEM,
	}

	validator, err := auth.NewJWTValidator(config)
	require.NoError(t, err)
	defer validator.Close()

	// Act
	_, err = validator.Validate("not.a.valid.jwt.token")

	// Assert
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "parse token")
}

func TestJWTValidator_NoneAlgorithm_Rejected(t *testing.T) {
	// Arrange
	config := &auth.JWTConfig{
		Secret: "test-secret",
	}

	validator, err := auth.NewJWTValidator(config)
	require.NoError(t, err)
	defer validator.Close()

	// Create token with "none" algorithm (security vulnerability)
	claims := auth_test.DefaultTestClaims()
	token := jwt.NewWithClaims(jwt.SigningMethodNone, claims)
	tokenString, _ := token.SignedString(jwt.UnsafeAllowNoneSignatureType)

	// Act
	_, err = validator.Validate(tokenString)

	// Assert
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "'none' algorithm not allowed")
}

func TestJWTValidator_NotBeforeCheck(t *testing.T) {
	// Arrange
	keyPair := auth_test.GenerateTestKeyPair(t)
	config := &auth.JWTConfig{
		PublicKey: keyPair.PublicKeyPEM,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	}

	validator, err := auth.NewJWTValidator(config)
	require.NoError(t, err)
	defer validator.Close()

	// Create token with NotBefore in the future
	claims := auth_test.DefaultTestClaims()
	claims.NotBefore = jwt.NewNumericDate(time.Now().Add(1 * time.Hour))
	tokenString := auth_test.GenerateTestToken(t, keyPair, claims)

	// Act
	_, err = validator.Validate(tokenString)

	// Assert
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "token is not valid yet")
}

func TestClaims_HasRole(t *testing.T) {
	claims := auth_test.DefaultTestClaims()

	assert.True(t, claims.HasRole("admin"))
	assert.True(t, claims.HasRole("user"))
	assert.False(t, claims.HasRole("superadmin"))
}

func TestClaims_HasAnyRole(t *testing.T) {
	claims := auth_test.DefaultTestClaims()

	assert.True(t, claims.HasAnyRole("admin", "superadmin"))
	assert.True(t, claims.HasAnyRole("user"))
	assert.False(t, claims.HasAnyRole("superadmin", "moderator"))
}

func TestClaims_HasAllRoles(t *testing.T) {
	claims := auth_test.DefaultTestClaims()

	assert.True(t, claims.HasAllRoles("admin", "user"))
	assert.True(t, claims.HasAllRoles("user"))
	assert.False(t, claims.HasAllRoles("admin", "superadmin"))
}
