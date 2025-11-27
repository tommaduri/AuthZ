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

	t.Run("revoked API key", func(t *testing.T) {
		// Create and revoke a key
		revokedPlainKey, revokedKeyHash, err := gen.Generate()
		require.NoError(t, err)

		now := time.Now()
		revokedKey := &APIKey{
			ID:           "revoked-key",
			KeyHash:      revokedKeyHash,
			Name:         "Revoked Key",
			AgentID:      "agent-123",
			Scopes:       []string{"read:*"},
			CreatedAt:    time.Now(),
			RevokedAt:    &now,
			RateLimitRPS: 100,
		}
		err = store.Create(nil, revokedKey)
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set(APIKeyHeader, revokedPlainKey)
		rec := httptest.NewRecorder()

		middleware.Authenticate(handler).ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnauthorized, rec.Code)
		assert.Contains(t, rec.Body.String(), "revoked")
	})
}

func TestMiddleware_HeaderExtraction(t *testing.T) {
	store := NewMockStore()
	validator := NewValidator(store, nil)
	middleware := NewMiddleware(validator, false)

	gen := NewGenerator()
	plainKey, keyHash, err := gen.Generate()
	require.NoError(t, err)

	key := &APIKey{
		ID:           "header-test-key",
		KeyHash:      keyHash,
		Name:         "Header Test Key",
		AgentID:      "agent-header",
		Scopes:       []string{"read:*"},
		CreatedAt:    time.Now(),
		RateLimitRPS: 100,
	}
	err = store.Create(nil, key)
	require.NoError(t, err)

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	t.Run("extracts from X-API-Key header", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set("X-API-Key", plainKey)
		rec := httptest.NewRecorder()

		middleware.Authenticate(handler).ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
	})

	t.Run("case-sensitive header name", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set("x-api-key", plainKey) // lowercase
		rec := httptest.NewRecorder()

		middleware.Authenticate(handler).ServeHTTP(rec, req)

		// Go's http.Header.Get is case-insensitive, so this should work
		assert.Equal(t, http.StatusOK, rec.Code)
	})

	t.Run("rejects empty header value", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set("X-API-Key", "")
		rec := httptest.NewRecorder()

		middleware.Authenticate(handler).ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnauthorized, rec.Code)
		assert.Contains(t, rec.Body.String(), "missing API key")
	})

	t.Run("rejects whitespace-only header", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set("X-API-Key", "   ")
		rec := httptest.NewRecorder()

		middleware.Authenticate(handler).ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})
}

func TestMiddleware_PrincipalContext(t *testing.T) {
	store := NewMockStore()
	validator := NewValidator(store, nil)
	middleware := NewMiddleware(validator, false)

	gen := NewGenerator()
	plainKey, keyHash, err := gen.Generate()
	require.NoError(t, err)

	key := &APIKey{
		ID:           "principal-test-key",
		KeyHash:      keyHash,
		Name:         "Principal Test Key",
		AgentID:      "agent-principal",
		Scopes:       []string{"read:policies", "write:policies"},
		CreatedAt:    time.Now(),
		RateLimitRPS: 100,
		Metadata: map[string]interface{}{
			"env": "test",
		},
	}
	err = store.Create(nil, key)
	require.NoError(t, err)

	t.Run("principal is set in context", func(t *testing.T) {
		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			principal := GetPrincipal(r.Context())
			require.NotNil(t, principal)

			assert.Equal(t, "agent-principal", principal.ID)
			assert.Equal(t, "agent", principal.Type)
			assert.Contains(t, principal.Scopes, "read:policies")
			assert.Contains(t, principal.Scopes, "write:policies")

			// Check metadata
			assert.Equal(t, "api_key", principal.Metadata["auth_method"])
			assert.Equal(t, "principal-test-key", principal.Metadata["key_id"])
			assert.Equal(t, "Principal Test Key", principal.Metadata["key_name"])

			w.WriteHeader(http.StatusOK)
		})

		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set("X-API-Key", plainKey)
		rec := httptest.NewRecorder()

		middleware.Authenticate(handler).ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
	})

	t.Run("GetPrincipal returns nil when no principal", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		principal := GetPrincipal(req.Context())
		assert.Nil(t, principal)
	})
}

func TestMiddleware_ErrorResponses(t *testing.T) {
	store := NewMockStore()
	validator := NewValidator(store, nil)
	middleware := NewMiddleware(validator, false)

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	t.Run("returns 401 for missing key in required mode", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		rec := httptest.NewRecorder()

		middleware.Authenticate(handler).ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnauthorized, rec.Code)
		assert.Contains(t, rec.Body.String(), "missing API key")
	})

	t.Run("returns 401 for invalid key format", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set("X-API-Key", "not-a-valid-format")
		rec := httptest.NewRecorder()

		middleware.Authenticate(handler).ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnauthorized, rec.Code)
		assert.Contains(t, rec.Body.String(), "invalid API key")
	})

	t.Run("returns 401 for expired key", func(t *testing.T) {
		gen := NewGenerator()
		expiredPlainKey, expiredKeyHash, err := gen.Generate()
		require.NoError(t, err)

		expired := time.Now().Add(-1 * time.Hour)
		expiredKey := &APIKey{
			ID:           "expired-error-key",
			KeyHash:      expiredKeyHash,
			Name:         "Expired Error Key",
			AgentID:      "agent-error",
			Scopes:       []string{"read:*"},
			CreatedAt:    time.Now().Add(-2 * time.Hour),
			ExpiresAt:    &expired,
			RateLimitRPS: 100,
		}
		err = store.Create(nil, expiredKey)
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set("X-API-Key", expiredPlainKey)
		rec := httptest.NewRecorder()

		middleware.Authenticate(handler).ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnauthorized, rec.Code)
		assert.Contains(t, rec.Body.String(), "API key expired")
	})

	t.Run("returns 401 for revoked key", func(t *testing.T) {
		gen := NewGenerator()
		revokedPlainKey, revokedKeyHash, err := gen.Generate()
		require.NoError(t, err)

		now := time.Now()
		revokedKey := &APIKey{
			ID:           "revoked-error-key",
			KeyHash:      revokedKeyHash,
			Name:         "Revoked Error Key",
			AgentID:      "agent-error",
			Scopes:       []string{"read:*"},
			CreatedAt:    time.Now(),
			RevokedAt:    &now,
			RateLimitRPS: 100,
		}
		err = store.Create(nil, revokedKey)
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set("X-API-Key", revokedPlainKey)
		rec := httptest.NewRecorder()

		middleware.Authenticate(handler).ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnauthorized, rec.Code)
		assert.Contains(t, rec.Body.String(), "API key revoked")
	})
}

func TestMiddleware_MultiTenantContext(t *testing.T) {
	store := NewMockStore()
	validator := NewValidator(store, nil)
	middleware := NewMiddleware(validator, false)

	// Create keys for different agents (tenants)
	gen := NewGenerator()

	tenant1Key, tenant1Hash, _ := gen.Generate()
	tenant1 := &APIKey{
		ID:           "tenant-1-key",
		KeyHash:      tenant1Hash,
		Name:         "Tenant 1 Key",
		AgentID:      "tenant-1",
		Scopes:       []string{"read:tenant1"},
		CreatedAt:    time.Now(),
		RateLimitRPS: 100,
	}
	store.Create(nil, tenant1)

	tenant2Key, tenant2Hash, _ := gen.Generate()
	tenant2 := &APIKey{
		ID:           "tenant-2-key",
		KeyHash:      tenant2Hash,
		Name:         "Tenant 2 Key",
		AgentID:      "tenant-2",
		Scopes:       []string{"read:tenant2"},
		CreatedAt:    time.Now(),
		RateLimitRPS: 100,
	}
	store.Create(nil, tenant2)

	t.Run("tenant 1 gets correct principal", func(t *testing.T) {
		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			principal := GetPrincipal(r.Context())
			require.NotNil(t, principal)

			assert.Equal(t, "tenant-1", principal.ID)
			assert.Contains(t, principal.Scopes, "read:tenant1")

			w.WriteHeader(http.StatusOK)
		})

		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set("X-API-Key", tenant1Key)
		rec := httptest.NewRecorder()

		middleware.Authenticate(handler).ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
	})

	t.Run("tenant 2 gets correct principal", func(t *testing.T) {
		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			principal := GetPrincipal(r.Context())
			require.NotNil(t, principal)

			assert.Equal(t, "tenant-2", principal.ID)
			assert.Contains(t, principal.Scopes, "read:tenant2")

			w.WriteHeader(http.StatusOK)
		})

		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set("X-API-Key", tenant2Key)
		rec := httptest.NewRecorder()

		middleware.Authenticate(handler).ServeHTTP(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
	})

	t.Run("different tenants are isolated", func(t *testing.T) {
		var capturedPrincipals []string

		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			principal := GetPrincipal(r.Context())
			if principal != nil {
				capturedPrincipals = append(capturedPrincipals, principal.ID)
			}
			w.WriteHeader(http.StatusOK)
		})

		// Request with tenant 1
		req1 := httptest.NewRequest(http.MethodGet, "/test", nil)
		req1.Header.Set("X-API-Key", tenant1Key)
		rec1 := httptest.NewRecorder()
		middleware.Authenticate(handler).ServeHTTP(rec1, req1)

		// Request with tenant 2
		req2 := httptest.NewRequest(http.MethodGet, "/test", nil)
		req2.Header.Set("X-API-Key", tenant2Key)
		rec2 := httptest.NewRecorder()
		middleware.Authenticate(handler).ServeHTTP(rec2, req2)

		assert.Len(t, capturedPrincipals, 2)
		assert.Contains(t, capturedPrincipals, "tenant-1")
		assert.Contains(t, capturedPrincipals, "tenant-2")
	})
}

func BenchmarkMiddleware_Authenticate(b *testing.B) {
	store := NewMockStore()
	validator := NewValidator(store, nil)
	middleware := NewMiddleware(validator, false)

	gen := NewGenerator()
	plainKey, keyHash, _ := gen.Generate()

	key := &APIKey{
		ID:           "bench-key",
		KeyHash:      keyHash,
		Name:         "Benchmark Key",
		AgentID:      "agent-bench",
		Scopes:       []string{"read:*"},
		CreatedAt:    time.Now(),
		RateLimitRPS: 10000,
	}
	store.Create(nil, key)

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	wrapped := middleware.Authenticate(handler)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set("X-API-Key", plainKey)
		rec := httptest.NewRecorder()

		wrapped.ServeHTTP(rec, req)
	}
}
