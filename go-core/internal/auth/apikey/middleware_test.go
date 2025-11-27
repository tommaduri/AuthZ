package apikey

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMiddleware_Authenticate(t *testing.T) {
	store := NewMockStore()
	validator := NewValidator(store, nil)
	middleware := NewMiddleware(validator, false)

	// Setup a test API key
	gen := NewGenerator()
	plainKey, keyHash, err := gen.Generate()
	require.NoError(t, err)

	key := &APIKey{
		ID:           "test-key",
		KeyHash:      keyHash,
		Name:         "Test Key",
		AgentID:      "agent-123",
		Scopes:       []string{"read:*"},
		CreatedAt:    time.Now(),
		RateLimitRPS: 100,
	}
	err = store.Create(nil, key)
	require.NoError(t, err)

	// Test handler that checks for principal
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		principal := GetPrincipal(r.Context())
		if principal == nil {
			t.Error("expected principal in context")
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("authenticated"))
	})

	t.Run("valid API key", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set(APIKeyHeader, plainKey)
		rec := httptest.NewRecorder()

		middleware.Authenticate(handler).ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, "authenticated", rec.Body.String())
	})

	t.Run("missing API key", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		rec := httptest.NewRecorder()

		middleware.Authenticate(handler).ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnauthorized, rec.Code)
		assert.Contains(t, rec.Body.String(), "missing API key")
	})

	t.Run("invalid API key", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set(APIKeyHeader, "invalid-key")
		rec := httptest.NewRecorder()

		middleware.Authenticate(handler).ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("expired API key", func(t *testing.T) {
		// Create an expired key
		expiredPlainKey, expiredKeyHash, err := gen.Generate()
		require.NoError(t, err)

		expired := time.Now().Add(-1 * time.Hour)
		expiredKey := &APIKey{
			ID:           "expired-key",
			KeyHash:      expiredKeyHash,
			Name:         "Expired Key",
			AgentID:      "agent-123",
			Scopes:       []string{"read:*"},
			CreatedAt:    time.Now().Add(-2 * time.Hour),
			ExpiresAt:    &expired,
			RateLimitRPS: 100,
		}
		err = store.Create(nil, expiredKey)
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set(APIKeyHeader, expiredPlainKey)
		rec := httptest.NewRecorder()

		middleware.Authenticate(handler).ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnauthorized, rec.Code)
		assert.Contains(t, rec.Body.String(), "expired")
	})

	t.Run("optional mode - missing key allowed", func(t *testing.T) {
		optionalMiddleware := NewMiddleware(validator, true)

		handlerCalled := false
		optionalHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			handlerCalled = true
			w.WriteHeader(http.StatusOK)
		})

		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		rec := httptest.NewRecorder()

		optionalMiddleware.Authenticate(optionalHandler).ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		assert.True(t, handlerCalled)
	})
}
