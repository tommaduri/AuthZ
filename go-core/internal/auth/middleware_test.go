package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/authz-engine/go-core/internal/auth/jwt"
)

func setupTestMiddleware(t *testing.T) (*Middleware, *jwt.JWTIssuer, *rsa.PrivateKey) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	issuer, err := jwt.NewJWTIssuer(&jwt.IssuerConfig{
		PrivateKey: privateKey,
		Issuer:     "authz-engine",
		Audience:   "authz-api",
	})
	require.NoError(t, err)

	validator, err := jwt.NewJWTValidator(&jwt.ValidatorConfig{
		PublicKey: &privateKey.PublicKey,
		Issuer:    "authz-engine",
		Audience:  "authz-api",
	})
	require.NoError(t, err)

	middleware := NewMiddleware(validator, nil)

	return middleware, issuer, privateKey
}

func TestMiddlewareHandler(t *testing.T) {
	middleware, issuer, _ := setupTestMiddleware(t)

	// Test handler that extracts principal
	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		principal, err := GetPrincipal(r.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(principal.ID))
	})

	handler := middleware.Handler(testHandler)

	t.Run("valid token", func(t *testing.T) {
		ctx := context.Background()
		pair, err := issuer.IssueToken(ctx, "agent:test", []string{"admin"}, "tenant-1", []string{"read:*"})
		require.NoError(t, err)

		req := httptest.NewRequest("GET", "/test", nil)
		req.Header.Set("Authorization", "Bearer "+pair.AccessToken)

		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "agent:test", w.Body.String())
	})

	t.Run("missing authorization header", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/test", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		assert.Equal(t, http.StatusUnauthorized, w.Code)
		assert.Contains(t, w.Body.String(), "unauthorized")
	})

	t.Run("invalid token format", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/test", nil)
		req.Header.Set("Authorization", "InvalidFormat")
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})

	t.Run("missing Bearer scheme", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/test", nil)
		req.Header.Set("Authorization", "Basic token123")
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		assert.Equal(t, http.StatusUnauthorized, w.Code)
		assert.Contains(t, w.Body.String(), "Bearer")
	})

	t.Run("invalid token", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/test", nil)
		req.Header.Set("Authorization", "Bearer invalid.jwt.token")
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})
}

func TestOptionalMiddleware(t *testing.T) {
	middleware, issuer, _ := setupTestMiddleware(t)
	optionalMiddleware := NewOptionalMiddleware(middleware.validator, nil)

	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		principal, err := GetPrincipal(r.Context())
		if err != nil {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("no-principal"))
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(principal.ID))
	})

	handler := optionalMiddleware.Handler(testHandler)

	t.Run("valid token provided", func(t *testing.T) {
		ctx := context.Background()
		pair, err := issuer.IssueToken(ctx, "agent:test", []string{}, "", []string{})
		require.NoError(t, err)

		req := httptest.NewRequest("GET", "/test", nil)
		req.Header.Set("Authorization", "Bearer "+pair.AccessToken)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "agent:test", w.Body.String())
	})

	t.Run("no token provided", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/test", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		// Should still succeed
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "no-principal", w.Body.String())
	})

	t.Run("invalid token provided", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/test", nil)
		req.Header.Set("Authorization", "Bearer invalid.token")
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		// Should still succeed without principal
		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "no-principal", w.Body.String())
	})
}

func TestGetPrincipal(t *testing.T) {
	t.Run("principal exists in context", func(t *testing.T) {
		expectedPrincipal := &jwt.Principal{
			ID:       "agent:test",
			Roles:    []string{"admin"},
			TenantID: "tenant-1",
			Scopes:   []string{"read:*"},
		}

		ctx := context.WithValue(context.Background(), PrincipalContextKey, expectedPrincipal)

		principal, err := GetPrincipal(ctx)
		assert.NoError(t, err)
		assert.Equal(t, expectedPrincipal, principal)
	})

	t.Run("no principal in context", func(t *testing.T) {
		ctx := context.Background()

		principal, err := GetPrincipal(ctx)
		assert.Error(t, err)
		assert.Nil(t, principal)
		assert.Contains(t, err.Error(), "no principal")
	})
}

func TestGetClaims(t *testing.T) {
	t.Run("claims exist in context", func(t *testing.T) {
		expectedClaims := &jwt.Claims{
			Roles:    []string{"admin"},
			TenantID: "tenant-1",
			Scopes:   []string{"read:*"},
		}

		ctx := context.WithValue(context.Background(), ClaimsContextKey, expectedClaims)

		claims, err := GetClaims(ctx)
		assert.NoError(t, err)
		assert.Equal(t, expectedClaims, claims)
	})

	t.Run("no claims in context", func(t *testing.T) {
		ctx := context.Background()

		claims, err := GetClaims(ctx)
		assert.Error(t, err)
		assert.Nil(t, claims)
	})
}

func TestRequireRole(t *testing.T) {
	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("success"))
	})

	roleMiddleware := RequireRole("admin")
	handler := roleMiddleware(testHandler)

	t.Run("user has required role", func(t *testing.T) {
		principal := &jwt.Principal{
			ID:    "agent:test",
			Roles: []string{"admin", "user"},
		}

		ctx := context.WithValue(context.Background(), PrincipalContextKey, principal)
		req := httptest.NewRequest("GET", "/test", nil).WithContext(ctx)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "success", w.Body.String())
	})

	t.Run("user missing required role", func(t *testing.T) {
		principal := &jwt.Principal{
			ID:    "agent:test",
			Roles: []string{"user"},
		}

		ctx := context.WithValue(context.Background(), PrincipalContextKey, principal)
		req := httptest.NewRequest("GET", "/test", nil).WithContext(ctx)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		assert.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("no principal in context", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/test", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})
}

func TestRequireAnyRole(t *testing.T) {
	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("success"))
	})

	roleMiddleware := RequireAnyRole("admin", "moderator")
	handler := roleMiddleware(testHandler)

	t.Run("user has one of required roles", func(t *testing.T) {
		principal := &jwt.Principal{
			ID:    "agent:test",
			Roles: []string{"moderator", "user"},
		}

		ctx := context.WithValue(context.Background(), PrincipalContextKey, principal)
		req := httptest.NewRequest("GET", "/test", nil).WithContext(ctx)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("user has none of required roles", func(t *testing.T) {
		principal := &jwt.Principal{
			ID:    "agent:test",
			Roles: []string{"user"},
		}

		ctx := context.WithValue(context.Background(), PrincipalContextKey, principal)
		req := httptest.NewRequest("GET", "/test", nil).WithContext(ctx)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		assert.Equal(t, http.StatusForbidden, w.Code)
	})
}

func BenchmarkMiddleware(b *testing.B) {
	middleware, issuer, _ := setupTestMiddleware(&testing.T{})  // Create a dummy *testing.T for setup

	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := middleware.Handler(testHandler)

	ctx := context.Background()
	pair, _ := issuer.IssueToken(ctx, "agent:benchmark", []string{"admin"}, "tenant-1", []string{"read:*"})

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest("GET", "/test", nil)
		req.Header.Set("Authorization", "Bearer "+pair.AccessToken)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)
	}
}

func TestMiddlewareLatency(t *testing.T) {
	middleware, issuer, _ := setupTestMiddleware(t)

	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := middleware.Handler(testHandler)

	ctx := context.Background()
	pair, err := issuer.IssueToken(ctx, "agent:test", []string{"admin"}, "tenant-1", []string{"read:*"})
	require.NoError(t, err)

	// Warm up
	for i := 0; i < 100; i++ {
		req := httptest.NewRequest("GET", "/test", nil)
		req.Header.Set("Authorization", "Bearer "+pair.AccessToken)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
	}

	// Measure latency
	iterations := 1000
	start := time.Now()

	for i := 0; i < iterations; i++ {
		req := httptest.NewRequest("GET", "/test", nil)
		req.Header.Set("Authorization", "Bearer "+pair.AccessToken)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
	}

	elapsed := time.Since(start)
	avgLatency := elapsed / time.Duration(iterations)

	t.Logf("Average middleware latency: %v", avgLatency)

	// Target: <10ms p99 (we're measuring average here, so should be much lower)
	if avgLatency > 5*time.Millisecond {
		t.Errorf("Middleware latency too high: %v (expected <5ms average)", avgLatency)
	}
}
