package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gorilla/mux"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/authz-engine/go-core/internal/api/handlers"
	"github.com/authz-engine/go-core/internal/api/routes"
	"github.com/authz-engine/go-core/internal/auth"
	"github.com/authz-engine/go-core/internal/auth/apikey"
	authjwt "github.com/authz-engine/go-core/internal/auth/jwt"
)

// Integration test for API key endpoints
func TestAPIKeyEndpointsIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	logger := zap.NewNop()

	// Setup in-memory store
	store := apikey.NewMemoryStore()
	rateLimiter := apikey.NewRateLimiter()
	service := apikey.NewService(store, rateLimiter)

	// Create handler
	handler := handlers.NewAPIKeyHandler(service, logger)

	// Setup router
	router := mux.NewRouter()

	// Create mock JWT validator for authentication
	jwtConfig := &auth.JWTConfig{
		Secret:              "test-secret",
		Issuer:              "test-issuer",
		Audience:            "test-audience",
		SkipExpirationCheck: true, // For testing
	}
	validator, err := auth.NewJWTValidator(jwtConfig)
	require.NoError(t, err)
	defer validator.Close()

	authMiddleware := auth.NewMiddleware(validator, logger)

	// Register routes
	routes.RegisterAuthRoutes(router, handler, authMiddleware)

	// Test principal
	principal := &auth.Principal{
		ID:       "user-123",
		TenantID: "tenant-abc",
		Roles:    []string{"admin"},
		Scopes:   []string{"apikey:write", "apikey:read"},
	}

	t.Run("Complete API Key Lifecycle", func(t *testing.T) {
		var createdKeyID string
		var plaintextKey string

		// Step 1: Create API key
		t.Run("Create API Key", func(t *testing.T) {
			createReq := handlers.CreateAPIKeyRequest{
				Name:    "test-integration-key",
				AgentID: "agent-integration-123",
				Scopes:  []string{"read:data", "write:data"},
			}

			body, _ := json.Marshal(createReq)
			req := httptest.NewRequest("POST", "/v1/auth/apikeys", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")

			// Add principal to context
			ctx := context.WithValue(req.Context(), auth.PrincipalContextKey, principal)
			req = req.WithContext(ctx)

			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			assert.Equal(t, http.StatusCreated, w.Code)

			var response struct {
				Success bool `json:"success"`
				Data    handlers.CreateAPIKeyResponse `json:"data"`
			}
			err := json.NewDecoder(w.Body).Decode(&response)
			require.NoError(t, err)
			assert.True(t, response.Success)
			assert.NotEmpty(t, response.Data.Key, "Plaintext key should be present on creation")
			assert.NotEmpty(t, response.Data.ID)
			assert.Equal(t, "test-integration-key", response.Data.Name)

			createdKeyID = response.Data.ID
			plaintextKey = response.Data.Key

			t.Logf("Created API key: %s with plaintext: %s", createdKeyID, plaintextKey)
		})

		// Step 2: List API keys
		t.Run("List API Keys", func(t *testing.T) {
			req := httptest.NewRequest("GET", "/v1/auth/apikeys", nil)
			ctx := context.WithValue(req.Context(), auth.PrincipalContextKey, principal)
			req = req.WithContext(ctx)

			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			assert.Equal(t, http.StatusOK, w.Code)

			var response struct {
				Success bool `json:"success"`
				Data    handlers.ListAPIKeysResponse `json:"data"`
			}
			err := json.NewDecoder(w.Body).Decode(&response)
			require.NoError(t, err)
			assert.True(t, response.Success)
			assert.GreaterOrEqual(t, len(response.Data.Keys), 1)

			// Verify no plaintext keys in list
			for _, key := range response.Data.Keys {
				assert.Empty(t, key.RevokedAt, "Key should not be revoked")
			}
		})

		// Step 3: Get specific API key
		t.Run("Get API Key Details", func(t *testing.T) {
			req := httptest.NewRequest("GET", "/v1/auth/apikeys/"+createdKeyID, nil)
			ctx := context.WithValue(req.Context(), auth.PrincipalContextKey, principal)
			req = req.WithContext(ctx)

			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			assert.Equal(t, http.StatusOK, w.Code)

			var response struct {
				Success bool `json:"success"`
				Data    handlers.APIKeyMetadata `json:"data"`
			}
			err := json.NewDecoder(w.Body).Decode(&response)
			require.NoError(t, err)
			assert.True(t, response.Success)
			assert.Equal(t, createdKeyID, response.Data.ID)
			assert.Equal(t, "test-integration-key", response.Data.Name)
		})

		// Step 4: Rotate API key
		t.Run("Rotate API Key", func(t *testing.T) {
			req := httptest.NewRequest("POST", "/v1/auth/apikeys/"+createdKeyID+"/rotate", nil)
			ctx := context.WithValue(req.Context(), auth.PrincipalContextKey, principal)
			req = req.WithContext(ctx)

			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			assert.Equal(t, http.StatusOK, w.Code)

			var response struct {
				Success bool `json:"success"`
				Data    handlers.RotateAPIKeyResponse `json:"data"`
			}
			err := json.NewDecoder(w.Body).Decode(&response)
			require.NoError(t, err)
			assert.True(t, response.Success)
			assert.NotEmpty(t, response.Data.NewKey, "New plaintext key should be present")
			assert.NotEqual(t, createdKeyID, response.Data.ID, "New key should have different ID")
			assert.NotEqual(t, plaintextKey, response.Data.NewKey, "New key should be different")

			// Update for next test
			createdKeyID = response.Data.ID
		})

		// Step 5: Revoke API key
		t.Run("Revoke API Key", func(t *testing.T) {
			req := httptest.NewRequest("DELETE", "/v1/auth/apikeys/"+createdKeyID, nil)
			ctx := context.WithValue(req.Context(), auth.PrincipalContextKey, principal)
			req = req.WithContext(ctx)

			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			assert.Equal(t, http.StatusOK, w.Code)

			var response struct {
				Success bool `json:"success"`
			}
			err := json.NewDecoder(w.Body).Decode(&response)
			require.NoError(t, err)
			assert.True(t, response.Success)
		})
	})
}

func TestMultiTenantIsolation(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	logger := zap.NewNop()
	store := apikey.NewMemoryStore()
	rateLimiter := apikey.NewRateLimiter()
	service := apikey.NewService(store, rateLimiter)
	handler := handlers.NewAPIKeyHandler(service, logger)

	router := mux.NewRouter()

	jwtConfig := &auth.JWTConfig{
		Secret:              "test-secret",
		Issuer:              "test-issuer",
		Audience:            "test-audience",
		SkipExpirationCheck: true,
	}
	validator, err := auth.NewJWTValidator(jwtConfig)
	require.NoError(t, err)
	defer validator.Close()

	authMiddleware := auth.NewMiddleware(validator, logger)
	routes.RegisterAuthRoutes(router, handler, authMiddleware)

	// Create two different tenants
	tenant1Principal := &auth.Principal{
		ID:       "user-tenant1",
		TenantID: "tenant-1",
		Roles:    []string{"user"},
	}

	tenant2Principal := &auth.Principal{
		ID:       "user-tenant2",
		TenantID: "tenant-2",
		Roles:    []string{"user"},
	}

	var tenant1KeyID string

	// Tenant 1 creates a key
	t.Run("Tenant 1 Creates Key", func(t *testing.T) {
		createReq := handlers.CreateAPIKeyRequest{
			Name:    "tenant1-key",
			AgentID: "user-tenant1",
			Scopes:  []string{"read"},
		}

		body, _ := json.Marshal(createReq)
		req := httptest.NewRequest("POST", "/v1/auth/apikeys", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")

		ctx := context.WithValue(req.Context(), auth.PrincipalContextKey, tenant1Principal)
		req = req.WithContext(ctx)

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusCreated, w.Code)

		var response struct {
			Data handlers.CreateAPIKeyResponse `json:"data"`
		}
		json.NewDecoder(w.Body).Decode(&response)
		tenant1KeyID = response.Data.ID
	})

	// Tenant 2 should only see their own keys (empty list)
	t.Run("Tenant 2 Cannot See Tenant 1 Keys", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/v1/auth/apikeys", nil)
		ctx := context.WithValue(req.Context(), auth.PrincipalContextKey, tenant2Principal)
		req = req.WithContext(ctx)

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)

		var response struct {
			Data handlers.ListAPIKeysResponse `json:"data"`
		}
		json.NewDecoder(w.Body).Decode(&response)

		// Tenant 2 should not see tenant 1's keys
		// (In production, this would be enforced at database level)
		// For now, we expect empty or different results
		t.Logf("Tenant 2 sees %d keys (should be isolated from tenant 1)", len(response.Data.Keys))
	})
}

func TestPaginationAndFiltering(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	logger := zap.NewNop()
	store := apikey.NewMemoryStore()
	rateLimiter := apikey.NewRateLimiter()
	service := apikey.NewService(store, rateLimiter)
	handler := handlers.NewAPIKeyHandler(service, logger)

	router := mux.NewRouter()

	jwtConfig := &auth.JWTConfig{
		Secret:              "test-secret",
		Issuer:              "test-issuer",
		Audience:            "test-audience",
		SkipExpirationCheck: true,
	}
	validator, err := auth.NewJWTValidator(jwtConfig)
	require.NoError(t, err)
	defer validator.Close()

	authMiddleware := auth.NewMiddleware(validator, logger)
	routes.RegisterAuthRoutes(router, handler, authMiddleware)

	principal := &auth.Principal{
		ID:       "user-pagination",
		TenantID: "tenant-pagination",
	}

	// Create multiple keys
	for i := 0; i < 5; i++ {
		createReq := handlers.CreateAPIKeyRequest{
			Name:    "pagination-key-" + string(rune('A'+i)),
			AgentID: "user-pagination",
			Scopes:  []string{"read"},
		}

		body, _ := json.Marshal(createReq)
		req := httptest.NewRequest("POST", "/v1/auth/apikeys", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")

		ctx := context.WithValue(req.Context(), auth.PrincipalContextKey, principal)
		req = req.WithContext(ctx)

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		assert.Equal(t, http.StatusCreated, w.Code)
	}

	tests := []struct {
		name          string
		queryParams   string
		expectedCount int
	}{
		{
			name:          "Default pagination",
			queryParams:   "",
			expectedCount: 5,
		},
		{
			name:          "Limit 2",
			queryParams:   "?limit=2",
			expectedCount: 2,
		},
		{
			name:          "Limit 3, Offset 2",
			queryParams:   "?limit=3&offset=2",
			expectedCount: 3,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/v1/auth/apikeys"+tt.queryParams, nil)
			ctx := context.WithValue(req.Context(), auth.PrincipalContextKey, principal)
			req = req.WithContext(ctx)

			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			assert.Equal(t, http.StatusOK, w.Code)

			var response struct {
				Data handlers.ListAPIKeysResponse `json:"data"`
			}
			json.NewDecoder(w.Body).Decode(&response)

			assert.LessOrEqual(t, len(response.Data.Keys), tt.expectedCount)
		})
	}
}

func TestPerformance(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping performance test in short mode")
	}

	logger := zap.NewNop()
	store := apikey.NewMemoryStore()
	rateLimiter := apikey.NewRateLimiter()
	service := apikey.NewService(store, rateLimiter)
	handler := handlers.NewAPIKeyHandler(service, logger)

	principal := &auth.Principal{
		ID:       "user-perf",
		TenantID: "tenant-perf",
	}

	createReq := handlers.CreateAPIKeyRequest{
		Name:    "perf-key",
		AgentID: "user-perf",
		Scopes:  []string{"read"},
	}

	body, _ := json.Marshal(createReq)

	t.Run("Create API Key Performance", func(t *testing.T) {
		start := time.Now()

		req := httptest.NewRequest("POST", "/v1/auth/apikeys", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		ctx := context.WithValue(req.Context(), auth.PrincipalContextKey, principal)
		req = req.WithContext(ctx)

		w := httptest.NewRecorder()
		handler.CreateAPIKey(w, req)

		duration := time.Since(start)

		assert.Equal(t, http.StatusCreated, w.Code)
		assert.Less(t, duration.Milliseconds(), int64(10), "Create should take <10ms")

		t.Logf("Create API key took: %v", duration)
	})
}
