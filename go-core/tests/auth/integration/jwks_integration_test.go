package integration

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/auth"
	gojwt "github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Helper to encode big.Int to base64url
func encodeBase64URL(b *big.Int) string {
	data := b.Bytes()
	// Proper base64url encoding
	return strings.TrimRight(base64.URLEncoding.EncodeToString(data), "=")
}

// Helper to create test JWK
func createTestJWK(kid string, pubKey *rsa.PublicKey) auth.JWK {
	return auth.JWK{
		Kid: kid,
		Kty: "RSA",
		Use: "sig",
		Alg: "RS256",
		N:   encodeBase64URL(pubKey.N),
		E:   encodeBase64URL(big.NewInt(int64(pubKey.E))),
	}
}

func TestJWKS_EndToEnd_Integration(t *testing.T) {
	// Generate test RSA key pair
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	publicKey := &privateKey.PublicKey

	// Create JWKS server
	jwks := auth.JWKS{
		Keys: []auth.JWK{
			createTestJWK("key-2024", publicKey),
		},
	}

	jwksServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(jwks)
	}))
	defer jwksServer.Close()

	// Create JWKS provider
	provider, err := auth.NewJWKSProvider(jwksServer.URL, 1*time.Hour)
	require.NoError(t, err)
	defer provider.Close()

	// Create JWT validator with JWKS provider
	validator, err := auth.NewJWTValidatorWithJWKS(provider, &auth.JWKSValidatorConfig{
		Issuer:   "authz-engine",
		Audience: "authz-api",
	})
	require.NoError(t, err)

	// Create and sign a test token
	claims := &auth.Claims{
		RegisteredClaims: gojwt.RegisteredClaims{
			Issuer:    "authz-engine",
			Subject:   "user:123",
			Audience:  gojwt.ClaimStrings{"authz-api"},
			ExpiresAt: gojwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
			IssuedAt:  gojwt.NewNumericDate(time.Now()),
			ID:        "test-jti-123",
		},
		UserID:   "user-123",
		Username: "testuser",
		Roles:    []string{"user", "admin"},
	}

	token := gojwt.NewWithClaims(gojwt.SigningMethodRS256, claims)
	token.Header["kid"] = "key-2024" // Set key ID in header
	tokenString, err := token.SignedString(privateKey)
	require.NoError(t, err)

	// Validate token using JWKS
	ctx := context.Background()
	validatedClaims, err := validator.Validate(ctx, tokenString)
	require.NoError(t, err)
	require.NotNil(t, validatedClaims)

	// Verify claims
	assert.Equal(t, "user:123", validatedClaims.Subject)
	assert.Equal(t, "testuser", validatedClaims.Username)
	assert.Equal(t, []string{"user", "admin"}, validatedClaims.Roles)
}

func TestJWKS_KeyRotation_Integration(t *testing.T) {
	// Generate two key pairs (for rotation)
	oldKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	newKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	// Start with both keys in JWKS (rotation period)
	currentJWKS := auth.JWKS{
		Keys: []auth.JWK{
			createTestJWK("key-old", &oldKey.PublicKey),
			createTestJWK("key-new", &newKey.PublicKey),
		},
	}

	jwksServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(currentJWKS)
	}))
	defer jwksServer.Close()

	provider, err := auth.NewJWKSProvider(jwksServer.URL, 100*time.Millisecond)
	require.NoError(t, err)
	defer provider.Close()

	validator, err := auth.NewJWTValidatorWithJWKS(provider, &auth.JWKSValidatorConfig{
		Issuer:   "authz-engine",
		Audience: "authz-api",
	})
	require.NoError(t, err)

	ctx := context.Background()

	// Create token signed with old key
	createToken := func(privKey *rsa.PrivateKey, kid string) string {
		claims := &auth.Claims{
			RegisteredClaims: gojwt.RegisteredClaims{
				Issuer:    "authz-engine",
				Subject:   "user:123",
				Audience:  gojwt.ClaimStrings{"authz-api"},
				ExpiresAt: gojwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
				IssuedAt:  gojwt.NewNumericDate(time.Now()),
				ID:        "test-jti",
			},
			UserID: "user-123",
		}
		token := gojwt.NewWithClaims(gojwt.SigningMethodRS256, claims)
		token.Header["kid"] = kid
		tokenString, _ := token.SignedString(privKey)
		return tokenString
	}

	oldToken := createToken(oldKey, "key-old")
	newToken := createToken(newKey, "key-new")

	// Both tokens should validate during rotation period
	_, err = validator.Validate(ctx, oldToken)
	assert.NoError(t, err, "Old key should still work during rotation")

	_, err = validator.Validate(ctx, newToken)
	assert.NoError(t, err, "New key should work during rotation")

	// Simulate key rotation completion (remove old key)
	currentJWKS = auth.JWKS{
		Keys: []auth.JWK{
			createTestJWK("key-new", &newKey.PublicKey),
		},
	}

	// Wait for cache to refresh
	time.Sleep(150 * time.Millisecond)

	// New key should still work
	_, err = validator.Validate(ctx, newToken)
	assert.NoError(t, err, "New key should continue working")

	// Old key should fail (no longer in JWKS)
	_, err = validator.Validate(ctx, oldToken)
	assert.Error(t, err, "Old key should fail after rotation")
	assert.Contains(t, err.Error(), "not found")
}

func TestJWKS_MultipleProviders_Integration(t *testing.T) {
	// Simulate multiple OAuth2 providers (Google, Auth0, etc.)
	googleKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	auth0Key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	// Google JWKS
	googleJWKS := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		jwks := auth.JWKS{
			Keys: []auth.JWK{createTestJWK("google-key-1", &googleKey.PublicKey)},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(jwks)
	}))
	defer googleJWKS.Close()

	// Auth0 JWKS
	auth0JWKS := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		jwks := auth.JWKS{
			Keys: []auth.JWK{createTestJWK("auth0-key-1", &auth0Key.PublicKey)},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(jwks)
	}))
	defer auth0JWKS.Close()

	// Create providers
	googleProvider, err := auth.NewJWKSProvider(googleJWKS.URL, 1*time.Hour)
	require.NoError(t, err)
	defer googleProvider.Close()

	auth0Provider, err := auth.NewJWKSProvider(auth0JWKS.URL, 1*time.Hour)
	require.NoError(t, err)
	defer auth0Provider.Close()

	// Create validators
	googleValidator, err := auth.NewJWTValidatorWithJWKS(googleProvider, &auth.JWKSValidatorConfig{
		Issuer:   "https://accounts.google.com",
		Audience: "my-app",
	})
	require.NoError(t, err)

	auth0Validator, err := auth.NewJWTValidatorWithJWKS(auth0Provider, &auth.JWKSValidatorConfig{
		Issuer:   "https://my-tenant.auth0.com",
		Audience: "my-app",
	})
	require.NoError(t, err)

	// Create tokens from each provider
	createToken := func(privKey *rsa.PrivateKey, kid, issuer string) string {
		claims := &auth.Claims{
			RegisteredClaims: gojwt.RegisteredClaims{
				Issuer:    issuer,
				Subject:   "user:123",
				Audience:  gojwt.ClaimStrings{"my-app"},
				ExpiresAt: gojwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
				IssuedAt:  gojwt.NewNumericDate(time.Now()),
				ID:        "jti-123",
			},
		}
		token := gojwt.NewWithClaims(gojwt.SigningMethodRS256, claims)
		token.Header["kid"] = kid
		tokenString, _ := token.SignedString(privKey)
		return tokenString
	}

	googleToken := createToken(googleKey, "google-key-1", "https://accounts.google.com")
	auth0Token := createToken(auth0Key, "auth0-key-1", "https://my-tenant.auth0.com")

	ctx := context.Background()

	// Each validator should only accept tokens from its provider
	_, err = googleValidator.Validate(ctx, googleToken)
	assert.NoError(t, err, "Google validator should accept Google tokens")

	_, err = googleValidator.Validate(ctx, auth0Token)
	assert.Error(t, err, "Google validator should reject Auth0 tokens")

	_, err = auth0Validator.Validate(ctx, auth0Token)
	assert.NoError(t, err, "Auth0 validator should accept Auth0 tokens")

	_, err = auth0Validator.Validate(ctx, googleToken)
	assert.Error(t, err, "Auth0 validator should reject Google tokens")
}

func TestJWKS_CacheBehavior_Integration(t *testing.T) {
	requestCount := 0
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		t.Logf("JWKS request #%d", requestCount)

		jwks := auth.JWKS{
			Keys: []auth.JWK{createTestJWK("test-key", &key.PublicKey)},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(jwks)
	}))
	defer server.Close()

	provider, err := auth.NewJWKSProvider(server.URL, 1*time.Hour)
	require.NoError(t, err)
	defer provider.Close()

	validator, err := auth.NewJWTValidatorWithJWKS(provider, &auth.JWKSValidatorConfig{
		Issuer:   "authz-engine",
		Audience: "authz-api",
	})
	require.NoError(t, err)

	// Create test token
	claims := &auth.Claims{
		RegisteredClaims: gojwt.RegisteredClaims{
			Issuer:    "authz-engine",
			Subject:   "user:123",
			Audience:  gojwt.ClaimStrings{"authz-api"},
			ExpiresAt: gojwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
			IssuedAt:  gojwt.NewNumericDate(time.Now()),
			ID:        "jti-123",
		},
	}
	token := gojwt.NewWithClaims(gojwt.SigningMethodRS256, claims)
	token.Header["kid"] = "test-key"
	tokenString, err := token.SignedString(key)
	require.NoError(t, err)

	initialRequests := requestCount
	ctx := context.Background()

	// Validate token multiple times
	for i := 0; i < 10; i++ {
		_, err = validator.Validate(ctx, tokenString)
		require.NoError(t, err)
	}

	// Should only have made 1 request (cache hit)
	assert.Equal(t, initialRequests, requestCount, "Cache should prevent multiple JWKS fetches")
}

func TestJWKS_ErrorHandling_Integration(t *testing.T) {
	tests := []struct {
		name        string
		setupServer func() *httptest.Server
		expectError string
	}{
		{
			name: "HTTP 500 error",
			setupServer: func() *httptest.Server {
				return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(http.StatusInternalServerError)
				}))
			},
			expectError: "500",
		},
		{
			name: "Invalid JSON",
			setupServer: func() *httptest.Server {
				return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Write([]byte("not json"))
				}))
			},
			expectError: "parse JWKS",
		},
		{
			name: "Empty JWKS",
			setupServer: func() *httptest.Server {
				return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					jwks := auth.JWKS{Keys: []auth.JWK{}}
					json.NewEncoder(w).Encode(jwks)
				}))
			},
			expectError: "no valid RSA signing keys",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := tt.setupServer()
			defer server.Close()

			_, err := auth.NewJWKSProvider(server.URL, 1*time.Hour)
			assert.Error(t, err)
			assert.Contains(t, err.Error(), tt.expectError)
		})
	}
}
