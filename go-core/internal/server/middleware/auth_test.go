package middleware

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/auth"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// Test helpers

func generateTestKeyPair(t *testing.T) (*rsa.PrivateKey, *rsa.PublicKey) {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	return privateKey, &privateKey.PublicKey
}

func generateTestTokenHS256(t *testing.T, secret string, claims *auth.Claims) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(secret))
	require.NoError(t, err)
	return tokenString
}

func setupTestAuthenticator(t *testing.T) (*Authenticator, string) {
	t.Helper()

	secret := "test-secret-key-for-middleware-tests"
	config := &auth.JWTConfig{
		Secret:   secret,
		Issuer:   "test-issuer",
		Audience: "test-audience",
	}

	validator, err := auth.NewJWTValidator(config)
	require.NoError(t, err)

	authenticator := NewAuthenticator(validator, []string{
		"/health",
		"/metrics",
		"/authz.v1.AuthzService/HealthCheck",
	})

	return authenticator, secret
}

func createTestClaims() *auth.Claims {
	return &auth.Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "test-issuer",
			Audience:  jwt.ClaimStrings{"test-audience"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
		UserID:   "user123",
		Username: "testuser",
		Email:    "test@example.com",
		Roles:    []string{"user"},
	}
}

// Tests

func TestNewAuthenticator(t *testing.T) {
	secret := "test-secret"
	config := &auth.JWTConfig{
		Secret: secret,
	}

	validator, err := auth.NewJWTValidator(config)
	require.NoError(t, err)

	skipPaths := []string{"/health", "/metrics"}
	authenticator := NewAuthenticator(validator, skipPaths)

	require.NotNil(t, authenticator)
	assert.NotNil(t, authenticator.validator)
	assert.Equal(t, 2, len(authenticator.skipPaths))
	assert.True(t, authenticator.skipPaths["/health"])
	assert.True(t, authenticator.skipPaths["/metrics"])
}

func TestAuthenticator_GRPCUnaryInterceptor(t *testing.T) {
	authenticator, secret := setupTestAuthenticator(t)
	interceptor := authenticator.GRPCUnaryInterceptor()

	t.Run("valid token", func(t *testing.T) {
		claims := createTestClaims()
		token := generateTestTokenHS256(t, secret, claims)

		// Create context with authorization metadata
		md := metadata.Pairs("authorization", "Bearer "+token)
		ctx := metadata.NewIncomingContext(context.Background(), md)

		// Mock handler that extracts claims
		handler := func(ctx context.Context, req interface{}) (interface{}, error) {
			extractedClaims, ok := ClaimsFromContext(ctx)
			require.True(t, ok, "claims should be in context")
			assert.Equal(t, "user123", extractedClaims.UserID)
			return "success", nil
		}

		// Call interceptor
		info := &grpc.UnaryServerInfo{FullMethod: "/authz.v1.AuthzService/Check"}
		resp, err := interceptor(ctx, nil, info, handler)

		require.NoError(t, err)
		assert.Equal(t, "success", resp)
	})

	t.Run("missing authorization header", func(t *testing.T) {
		ctx := context.Background()

		handler := func(ctx context.Context, req interface{}) (interface{}, error) {
			t.Fatal("handler should not be called")
			return nil, nil
		}

		info := &grpc.UnaryServerInfo{FullMethod: "/authz.v1.AuthzService/Check"}
		_, err := interceptor(ctx, nil, info, handler)

		require.Error(t, err)
		st, ok := status.FromError(err)
		require.True(t, ok)
		assert.Equal(t, codes.Unauthenticated, st.Code())
	})

	t.Run("invalid token", func(t *testing.T) {
		md := metadata.Pairs("authorization", "Bearer invalid-token")
		ctx := metadata.NewIncomingContext(context.Background(), md)

		handler := func(ctx context.Context, req interface{}) (interface{}, error) {
			t.Fatal("handler should not be called")
			return nil, nil
		}

		info := &grpc.UnaryServerInfo{FullMethod: "/authz.v1.AuthzService/Check"}
		_, err := interceptor(ctx, nil, info, handler)

		require.Error(t, err)
		st, ok := status.FromError(err)
		require.True(t, ok)
		assert.Equal(t, codes.Unauthenticated, st.Code())
	})

	t.Run("skip authentication for health check", func(t *testing.T) {
		ctx := context.Background()

		handler := func(ctx context.Context, req interface{}) (interface{}, error) {
			// Should be called without authentication
			return "health ok", nil
		}

		info := &grpc.UnaryServerInfo{FullMethod: "/authz.v1.AuthzService/HealthCheck"}
		resp, err := interceptor(ctx, nil, info, handler)

		require.NoError(t, err)
		assert.Equal(t, "health ok", resp)
	})
}

func TestAuthenticator_HTTPMiddleware(t *testing.T) {
	authenticator, secret := setupTestAuthenticator(t)
	middleware := authenticator.HTTPMiddleware

	t.Run("valid token", func(t *testing.T) {
		claims := createTestClaims()
		token := generateTestTokenHS256(t, secret, claims)

		// Create test handler that extracts claims
		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			extractedClaims, ok := ClaimsFromContext(r.Context())
			require.True(t, ok, "claims should be in context")
			assert.Equal(t, "user123", extractedClaims.UserID)
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("success"))
		})

		// Create request with authorization header
		req := httptest.NewRequest("GET", "/api/resource", nil)
		req.Header.Set("Authorization", "Bearer "+token)

		// Execute middleware
		rr := httptest.NewRecorder()
		middleware(handler).ServeHTTP(rr, req)

		assert.Equal(t, http.StatusOK, rr.Code)
		assert.Equal(t, "success", rr.Body.String())
	})

	t.Run("missing authorization header", func(t *testing.T) {
		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("handler should not be called")
		})

		req := httptest.NewRequest("GET", "/api/resource", nil)

		rr := httptest.NewRecorder()
		middleware(handler).ServeHTTP(rr, req)

		assert.Equal(t, http.StatusUnauthorized, rr.Code)
	})

	t.Run("invalid token format", func(t *testing.T) {
		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("handler should not be called")
		})

		req := httptest.NewRequest("GET", "/api/resource", nil)
		req.Header.Set("Authorization", "InvalidFormat token")

		rr := httptest.NewRecorder()
		middleware(handler).ServeHTTP(rr, req)

		assert.Equal(t, http.StatusUnauthorized, rr.Code)
	})

	t.Run("skip authentication for health endpoint", func(t *testing.T) {
		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("healthy"))
		})

		req := httptest.NewRequest("GET", "/health", nil)

		rr := httptest.NewRecorder()
		middleware(handler).ServeHTTP(rr, req)

		assert.Equal(t, http.StatusOK, rr.Code)
		assert.Equal(t, "healthy", rr.Body.String())
	})
}

func TestExtractTokenFromHTTP(t *testing.T) {
	t.Run("valid Bearer token", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/", nil)
		req.Header.Set("Authorization", "Bearer test-token-123")

		token, err := extractTokenFromHTTP(req)
		require.NoError(t, err)
		assert.Equal(t, "test-token-123", token)
	})

	t.Run("missing authorization header", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/", nil)

		_, err := extractTokenFromHTTP(req)
		assert.Error(t, err)
	})

	t.Run("invalid format - no bearer", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/", nil)
		req.Header.Set("Authorization", "test-token")

		_, err := extractTokenFromHTTP(req)
		assert.Error(t, err)
	})

	t.Run("invalid format - wrong scheme", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/", nil)
		req.Header.Set("Authorization", "Basic dXNlcjpwYXNz")

		_, err := extractTokenFromHTTP(req)
		assert.Error(t, err)
	})

	t.Run("case insensitive Bearer", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/", nil)
		req.Header.Set("Authorization", "bearer test-token-456")

		token, err := extractTokenFromHTTP(req)
		require.NoError(t, err)
		assert.Equal(t, "test-token-456", token)
	})
}

func TestExtractTokenFromGRPC(t *testing.T) {
	t.Run("valid Bearer token", func(t *testing.T) {
		md := metadata.Pairs("authorization", "Bearer test-token-789")
		ctx := metadata.NewIncomingContext(context.Background(), md)

		token, err := extractTokenFromGRPC(ctx)
		require.NoError(t, err)
		assert.Equal(t, "test-token-789", token)
	})

	t.Run("missing metadata", func(t *testing.T) {
		ctx := context.Background()

		_, err := extractTokenFromGRPC(ctx)
		assert.Error(t, err)
	})

	t.Run("missing authorization", func(t *testing.T) {
		md := metadata.Pairs("other-header", "value")
		ctx := metadata.NewIncomingContext(context.Background(), md)

		_, err := extractTokenFromGRPC(ctx)
		assert.Error(t, err)
	})
}

func TestClaimsFromContext(t *testing.T) {
	t.Run("claims present", func(t *testing.T) {
		claims := &auth.Claims{
			UserID: "user123",
		}

		ctx := withClaims(context.Background(), claims)
		extractedClaims, ok := ClaimsFromContext(ctx)

		require.True(t, ok)
		assert.Equal(t, "user123", extractedClaims.UserID)
	})

	t.Run("claims not present", func(t *testing.T) {
		ctx := context.Background()
		_, ok := ClaimsFromContext(ctx)

		assert.False(t, ok)
	})
}
