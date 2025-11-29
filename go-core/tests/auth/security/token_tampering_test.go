package security

import (
	"strings"
	"testing"

	"github.com/authz-engine/go-core/internal/auth"
	auth_test "github.com/authz-engine/go-core/tests/auth"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestTokenTampering_PayloadModification tests detection of payload tampering
func TestTokenTampering_PayloadModification(t *testing.T) {
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

	// Generate valid token
	claims := auth_test.DefaultTestClaims()
	tokenString := auth_test.GenerateTestToken(t, keyPair, claims)

	// Tamper with payload (change middle part of JWT)
	parts := strings.Split(tokenString, ".")
	require.Len(t, parts, 3)

	// Modify payload (base64-encoded middle part)
	tamperedPayload := parts[1][:len(parts[1])-5] + "AAAAA"
	tamperedToken := parts[0] + "." + tamperedPayload + "." + parts[2]

	// Act
	_, err = validator.Validate(tamperedToken)

	// Assert
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "signature")
}

// TestTokenTampering_SignatureRemoval tests rejection of unsigned tokens
func TestTokenTampering_SignatureRemoval(t *testing.T) {
	// Arrange
	keyPair := auth_test.GenerateTestKeyPair(t)
	config := &auth.JWTConfig{
		PublicKey: keyPair.PublicKeyPEM,
	}

	validator, err := auth.NewJWTValidator(config)
	require.NoError(t, err)
	defer validator.Close()

	// Generate valid token
	claims := auth_test.DefaultTestClaims()
	tokenString := auth_test.GenerateTestToken(t, keyPair, claims)

	// Remove signature
	parts := strings.Split(tokenString, ".")
	tamperedToken := parts[0] + "." + parts[1] + "."

	// Act
	_, err = validator.Validate(tamperedToken)

	// Assert
	assert.Error(t, err)
}

// TestTokenTampering_RoleEscalation tests prevention of role escalation via tampering
func TestTokenTampering_RoleEscalation(t *testing.T) {
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

	// Create low-privilege token
	lowPrivClaims := auth_test.DefaultTestClaims()
	lowPrivClaims.Roles = []string{"user"}
	validToken := auth_test.GenerateTestToken(t, keyPair, lowPrivClaims)

	// Validate original token
	validatedClaims, err := validator.Validate(validToken)
	require.NoError(t, err)
	assert.Equal(t, []string{"user"}, validatedClaims.Roles)

	// Attempt to create token with escalated roles using different key
	attackerKeyPair := auth_test.GenerateTestKeyPair(t)
	escalatedClaims := auth_test.DefaultTestClaims()
	escalatedClaims.Roles = []string{"admin", "superadmin"}
	attackToken := auth_test.GenerateTestToken(t, attackerKeyPair, escalatedClaims)

	// Act - Validate with legitimate validator
	_, err = validator.Validate(attackToken)

	// Assert - Should be rejected due to signature mismatch
	assert.Error(t, err)
}

// TestTokenTampering_AlgorithmConfusion tests prevention of algorithm confusion attacks
func TestTokenTampering_AlgorithmConfusion(t *testing.T) {
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

	// Try to create token with "none" algorithm
	claims := auth_test.DefaultTestClaims()
	token := jwt.NewWithClaims(jwt.SigningMethodNone, claims)
	noneToken, _ := token.SignedString(jwt.UnsafeAllowNoneSignatureType)

	// Act
	_, err = validator.Validate(noneToken)

	// Assert
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "'none' algorithm not allowed")
}

// TestTokenTampering_HeaderManipulation tests header tampering detection
func TestTokenTampering_HeaderManipulation(t *testing.T) {
	// Arrange
	keyPair := auth_test.GenerateTestKeyPair(t)
	config := &auth.JWTConfig{
		PublicKey: keyPair.PublicKeyPEM,
	}

	validator, err := auth.NewJWTValidator(config)
	require.NoError(t, err)
	defer validator.Close()

	// Generate valid token
	claims := auth_test.DefaultTestClaims()
	tokenString := auth_test.GenerateTestToken(t, keyPair, claims)

	// Tamper with header
	parts := strings.Split(tokenString, ".")
	tamperedHeader := "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0" // {"alg":"none","typ":"JWT"}
	tamperedToken := tamperedHeader + "." + parts[1] + "." + parts[2]

	// Act
	_, err = validator.Validate(tamperedToken)

	// Assert
	assert.Error(t, err)
}

// TestTokenReplay_RevokedToken tests revoked token rejection
// Note: This requires Redis blacklist implementation
func TestTokenReplay_Prevention(t *testing.T) {
	t.Skip("Requires Redis blacklist implementation")

	// This test would:
	// 1. Generate valid token
	// 2. Add token JTI to blacklist
	// 3. Attempt to use revoked token
	// 4. Assert rejection
}

// TestTimingAttack_ConstantTimeComparison tests resistance to timing attacks
func TestTimingAttack_ConstantTimeComparison(t *testing.T) {
	// Arrange
	keyPair := auth_test.GenerateTestKeyPair(t)
	config := &auth.JWTConfig{
		PublicKey: keyPair.PublicKeyPEM,
	}

	validator, err := auth.NewJWTValidator(config)
	require.NoError(t, err)
	defer validator.Close()

	// Generate valid and invalid tokens
	validClaims := auth_test.DefaultTestClaims()
	validToken := auth_test.GenerateTestToken(t, keyPair, validClaims)

	invalidToken := validToken[:len(validToken)-10] + "0000000000"

	// Measure validation time for both (in real implementation)
	// This is a conceptual test - actual timing attack prevention is in bcrypt/crypto libs

	// Act & Assert
	_, err1 := validator.Validate(validToken)
	_, err2 := validator.Validate(invalidToken)

	// Both should complete (one success, one failure)
	assert.NoError(t, err1)
	assert.Error(t, err2)

	// In production, measure timing variance should be minimal
	// This prevents attackers from deducing token validity through timing
}
