package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Test helpers

// generateTestKeyPair generates an RSA key pair for testing
func generateTestKeyPair(t *testing.T) (*rsa.PrivateKey, *rsa.PublicKey) {
	t.Helper()

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err, "failed to generate RSA key pair")

	return privateKey, &privateKey.PublicKey
}

// privateKeyToPEM converts a private key to PEM format
func privateKeyToPEM(key *rsa.PrivateKey) []byte {
	keyBytes := x509.MarshalPKCS1PrivateKey(key)
	return pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: keyBytes,
	})
}

// publicKeyToPEM converts a public key to PEM format
func publicKeyToPEM(key *rsa.PublicKey) []byte {
	keyBytes, _ := x509.MarshalPKIXPublicKey(key)
	return pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: keyBytes,
	})
}

// generateTestTokenHS256 creates a test JWT token using HS256
func generateTestTokenHS256(t *testing.T, secret string, claims *Claims) string {
	t.Helper()

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(secret))
	require.NoError(t, err, "failed to sign token")

	return tokenString
}

// generateTestTokenRS256 creates a test JWT token using RS256
func generateTestTokenRS256(t *testing.T, privateKey *rsa.PrivateKey, claims *Claims) string {
	t.Helper()

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tokenString, err := token.SignedString(privateKey)
	require.NoError(t, err, "failed to sign token")

	return tokenString
}

// Tests

func TestNewJWTValidator(t *testing.T) {
	t.Run("with HS256 secret", func(t *testing.T) {
		config := &JWTConfig{
			Secret:   "test-secret-key",
			Issuer:   "test-issuer",
			Audience: "test-audience",
		}

		validator, err := NewJWTValidator(config)
		require.NoError(t, err)
		require.NotNil(t, validator)
		assert.NotNil(t, validator.secret)
	})

	t.Run("with RS256 public key", func(t *testing.T) {
		_, publicKey := generateTestKeyPair(t)
		publicKeyPEM := publicKeyToPEM(publicKey)

		config := &JWTConfig{
			PublicKey: string(publicKeyPEM),
			Issuer:    "test-issuer",
			Audience:  "test-audience",
		}

		validator, err := NewJWTValidator(config)
		require.NoError(t, err)
		require.NotNil(t, validator)
		assert.NotNil(t, validator.publicKey)
	})

	t.Run("with invalid public key", func(t *testing.T) {
		config := &JWTConfig{
			PublicKey: "invalid-key",
			Issuer:    "test-issuer",
		}

		_, err := NewJWTValidator(config)
		assert.Error(t, err)
	})

	t.Run("with no authentication method", func(t *testing.T) {
		config := &JWTConfig{
			Issuer: "test-issuer",
		}

		_, err := NewJWTValidator(config)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "no authentication method")
	})
}

func TestJWTValidator_ValidateHS256(t *testing.T) {
	secret := "test-secret-key-for-hs256-validation"
	config := &JWTConfig{
		Secret:   secret,
		Issuer:   "test-issuer",
		Audience: "test-audience",
	}

	validator, err := NewJWTValidator(config)
	require.NoError(t, err)

	t.Run("valid token", func(t *testing.T) {
		claims := &Claims{
			RegisteredClaims: jwt.RegisteredClaims{
				Issuer:    "test-issuer",
				Audience:  jwt.ClaimStrings{"test-audience"},
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
				IssuedAt:  jwt.NewNumericDate(time.Now()),
			},
			UserID:   "user123",
			Username: "testuser",
			Email:    "test@example.com",
			Roles:    []string{"user", "admin"},
		}

		token := generateTestTokenHS256(t, secret, claims)
		validatedClaims, err := validator.Validate(token)

		require.NoError(t, err)
		require.NotNil(t, validatedClaims)
		assert.Equal(t, "user123", validatedClaims.UserID)
		assert.Equal(t, "testuser", validatedClaims.Username)
		assert.Equal(t, "test@example.com", validatedClaims.Email)
		assert.Equal(t, []string{"user", "admin"}, validatedClaims.Roles)
	})

	t.Run("expired token", func(t *testing.T) {
		claims := &Claims{
			RegisteredClaims: jwt.RegisteredClaims{
				Issuer:    "test-issuer",
				Audience:  jwt.ClaimStrings{"test-audience"},
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Hour)),
				IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
			},
		}

		token := generateTestTokenHS256(t, secret, claims)
		_, err := validator.Validate(token)

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "expired")
	})

	t.Run("invalid issuer", func(t *testing.T) {
		claims := &Claims{
			RegisteredClaims: jwt.RegisteredClaims{
				Issuer:    "wrong-issuer",
				Audience:  jwt.ClaimStrings{"test-audience"},
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
			},
		}

		token := generateTestTokenHS256(t, secret, claims)
		_, err := validator.Validate(token)

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid issuer")
	})

	t.Run("invalid audience", func(t *testing.T) {
		claims := &Claims{
			RegisteredClaims: jwt.RegisteredClaims{
				Issuer:    "test-issuer",
				Audience:  jwt.ClaimStrings{"wrong-audience"},
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
			},
		}

		token := generateTestTokenHS256(t, secret, claims)
		_, err := validator.Validate(token)

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid audience")
	})

	t.Run("tampered token", func(t *testing.T) {
		claims := &Claims{
			RegisteredClaims: jwt.RegisteredClaims{
				Issuer:    "test-issuer",
				Audience:  jwt.ClaimStrings{"test-audience"},
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
			},
		}

		token := generateTestTokenHS256(t, secret, claims)
		// Tamper with the token
		tamperedToken := token[:len(token)-5] + "XXXXX"

		_, err := validator.Validate(tamperedToken)
		assert.Error(t, err)
	})

	t.Run("empty token", func(t *testing.T) {
		_, err := validator.Validate("")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "empty token")
	})
}

func TestJWTValidator_ValidateRS256(t *testing.T) {
	privateKey, publicKey := generateTestKeyPair(t)
	publicKeyPEM := publicKeyToPEM(publicKey)

	config := &JWTConfig{
		PublicKey: string(publicKeyPEM),
		Issuer:    "test-issuer",
		Audience:  "test-audience",
	}

	validator, err := NewJWTValidator(config)
	require.NoError(t, err)

	t.Run("valid token", func(t *testing.T) {
		claims := &Claims{
			RegisteredClaims: jwt.RegisteredClaims{
				Issuer:    "test-issuer",
				Audience:  jwt.ClaimStrings{"test-audience"},
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
				IssuedAt:  jwt.NewNumericDate(time.Now()),
			},
			UserID:   "user456",
			Username: "rsauser",
		}

		token := generateTestTokenRS256(t, privateKey, claims)
		validatedClaims, err := validator.Validate(token)

		require.NoError(t, err)
		require.NotNil(t, validatedClaims)
		assert.Equal(t, "user456", validatedClaims.UserID)
		assert.Equal(t, "rsauser", validatedClaims.Username)
	})

	t.Run("wrong private key", func(t *testing.T) {
		wrongPrivateKey, _ := generateTestKeyPair(t)

		claims := &Claims{
			RegisteredClaims: jwt.RegisteredClaims{
				Issuer:    "test-issuer",
				Audience:  jwt.ClaimStrings{"test-audience"},
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
			},
		}

		token := generateTestTokenRS256(t, wrongPrivateKey, claims)
		_, err := validator.Validate(token)

		assert.Error(t, err)
	})
}

func TestJWTValidator_AlgorithmValidation(t *testing.T) {
	secret := "test-secret"
	config := &JWTConfig{
		Secret:   secret,
		Issuer:   "test-issuer",
		Audience: "test-audience",
	}

	validator, err := NewJWTValidator(config)
	require.NoError(t, err)

	t.Run("reject none algorithm", func(t *testing.T) {
		// Create a token with "none" algorithm (unsigned)
		token := jwt.NewWithClaims(jwt.SigningMethodNone, &Claims{
			RegisteredClaims: jwt.RegisteredClaims{
				Issuer:    "test-issuer",
				Audience:  jwt.ClaimStrings{"test-audience"},
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
			},
		})

		tokenString, _ := token.SignedString(jwt.UnsafeAllowNoneSignatureType)

		_, err := validator.Validate(tokenString)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "none")
	})
}

func TestClaims_RoleMethods(t *testing.T) {
	claims := &Claims{
		Roles: []string{"user", "admin", "moderator"},
	}

	t.Run("HasRole", func(t *testing.T) {
		assert.True(t, claims.HasRole("user"))
		assert.True(t, claims.HasRole("admin"))
		assert.False(t, claims.HasRole("superadmin"))
	})

	t.Run("HasAnyRole", func(t *testing.T) {
		assert.True(t, claims.HasAnyRole("user", "superadmin"))
		assert.True(t, claims.HasAnyRole("admin"))
		assert.False(t, claims.HasAnyRole("superadmin", "owner"))
	})

	t.Run("HasAllRoles", func(t *testing.T) {
		assert.True(t, claims.HasAllRoles("user", "admin"))
		assert.True(t, claims.HasAllRoles("user"))
		assert.False(t, claims.HasAllRoles("user", "admin", "superadmin"))
	})
}

func TestJWTConfig_Validate(t *testing.T) {
	t.Run("valid with secret", func(t *testing.T) {
		config := &JWTConfig{
			Secret: "test-secret",
		}
		err := config.Validate()
		assert.NoError(t, err)
	})

	t.Run("valid with public key", func(t *testing.T) {
		config := &JWTConfig{
			PublicKey: "-----BEGIN PUBLIC KEY-----\n...",
		}
		err := config.Validate()
		assert.NoError(t, err)
	})

	t.Run("invalid - no auth method", func(t *testing.T) {
		config := &JWTConfig{}
		err := config.Validate()
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "no authentication method")
	})

	t.Run("sets default JWKS cache TTL", func(t *testing.T) {
		config := &JWTConfig{
			JWKSUrl: "https://example.com/.well-known/jwks.json",
		}
		err := config.Validate()
		assert.NoError(t, err)
		assert.Equal(t, 1*time.Hour, config.JWKSCacheTTL)
	})
}
