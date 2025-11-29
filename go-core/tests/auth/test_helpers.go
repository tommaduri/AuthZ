package auth_test

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/auth"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/require"
)

// TestKeyPair holds a test RSA key pair
type TestKeyPair struct {
	PrivateKey    *rsa.PrivateKey
	PublicKey     *rsa.PublicKey
	PrivateKeyPEM string
	PublicKeyPEM  string
}

// GenerateTestKeyPair generates a test RSA key pair
func GenerateTestKeyPair(t *testing.T) *TestKeyPair {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	privateKeyPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(privateKey),
	})

	publicKeyBytes, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	require.NoError(t, err)

	publicKeyPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: publicKeyBytes,
	})

	return &TestKeyPair{
		PrivateKey:    privateKey,
		PublicKey:     &privateKey.PublicKey,
		PrivateKeyPEM: string(privateKeyPEM),
		PublicKeyPEM:  string(publicKeyPEM),
	}
}

// GenerateTestToken generates a test JWT token with custom claims
func GenerateTestToken(t *testing.T, keyPair *TestKeyPair, claims *auth.Claims) string {
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tokenString, err := token.SignedString(keyPair.PrivateKey)
	require.NoError(t, err)
	return tokenString
}

// GenerateTestTokenHS256 generates a test JWT token using HS256
func GenerateTestTokenHS256(t *testing.T, secret string, claims *auth.Claims) string {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(secret))
	require.NoError(t, err)
	return tokenString
}

// DefaultTestClaims returns default test claims
func DefaultTestClaims() *auth.Claims {
	return &auth.Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "authz-engine",
			Subject:   "agent:test-123",
			Audience:  jwt.ClaimStrings{"authz-api"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ID:        "test-jti-123",
		},
		UserID:   "user-123",
		Username: "testuser",
		Email:    "test@example.com",
		Roles:    []string{"user", "admin"},
		Scope:    "read:* write:policies",
	}
}

// ExpiredTestClaims returns expired test claims
func ExpiredTestClaims() *auth.Claims {
	claims := DefaultTestClaims()
	claims.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-1 * time.Hour))
	return claims
}

// InvalidIssuerClaims returns claims with invalid issuer
func InvalidIssuerClaims() *auth.Claims {
	claims := DefaultTestClaims()
	claims.Issuer = "wrong-issuer"
	return claims
}

// InvalidAudienceClaims returns claims with invalid audience
func InvalidAudienceClaims() *auth.Claims {
	claims := DefaultTestClaims()
	claims.Audience = jwt.ClaimStrings{"wrong-audience"}
	return claims
}

// MultiTenantClaims returns claims with tenant isolation
func MultiTenantClaims(tenantID string) *auth.Claims {
	claims := DefaultTestClaims()
	claims.Subject = "agent:tenant-" + tenantID
	return claims
}

// GenerateTamperedToken generates a token and tampers with it
func GenerateTamperedToken(t *testing.T, keyPair *TestKeyPair) string {
	claims := DefaultTestClaims()
	tokenString := GenerateTestToken(t, keyPair, claims)

	// Tamper with the token by changing the payload
	parts := jwt.NewParser().DecodeSegment
	_ = parts
	// Return modified token (implementation would modify payload)
	return tokenString[:len(tokenString)-10] + "tampered123"
}
