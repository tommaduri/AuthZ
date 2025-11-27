package integration

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/auth/apikey"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	_ "github.com/lib/pq"
)

// setupIntegrationTest sets up full test environment
func setupIntegrationTest(t *testing.T) (*apikey.PostgresStore, *apikey.RateLimiter, *apikey.Service, func()) {
	t.Helper()

	// Setup PostgreSQL
	dsn := "postgres://postgres:postgres@localhost/authz_test?sslmode=disable"
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Skipf("skipping integration tests: postgres not available: %v", err)
	}

	if err := db.Ping(); err != nil {
		t.Skipf("skipping integration tests: postgres not available: %v", err)
	}

	// Create table
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS api_keys (
			id TEXT PRIMARY KEY,
			key_hash VARCHAR(64) NOT NULL UNIQUE,
			name VARCHAR(255),
			agent_id VARCHAR(255) NOT NULL,
			scopes TEXT[],
			created_at TIMESTAMP NOT NULL DEFAULT NOW(),
			expires_at TIMESTAMP,
			last_used_at TIMESTAMP,
			revoked_at TIMESTAMP,
			rate_limit_rps INTEGER DEFAULT 100,
			metadata JSONB
		)
	`)
	require.NoError(t, err)

	// Clean up
	_, err = db.Exec("TRUNCATE TABLE api_keys")
	require.NoError(t, err)

	// Setup Redis
	redisClient := redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
		DB:   15,
	})

	ctx := context.Background()
	if err := redisClient.Ping(ctx).Err(); err != nil {
		t.Skipf("skipping integration tests: redis not available: %v", err)
	}

	redisClient.FlushDB(ctx)

	// Create components
	store, err := apikey.NewPostgresStore(db)
	require.NoError(t, err)

	rateLimiter := apikey.NewRateLimiter(redisClient, 100)
	service := apikey.NewService(store, rateLimiter)

	cleanup := func() {
		db.Exec("TRUNCATE TABLE api_keys")
		redisClient.FlushDB(ctx)
		store.Close()
		rateLimiter.Close()
	}

	return store, rateLimiter, service, cleanup
}

func TestAPIKeyLifecycle_CreateValidateRevoke(t *testing.T) {
	_, _, service, cleanup := setupIntegrationTest(t)
	defer cleanup()

	ctx := context.Background()

	t.Run("full lifecycle - create, validate, revoke", func(t *testing.T) {
		// 1. Create API key
		req := &apikey.APIKeyCreateRequest{
			Name:         "Lifecycle Test Key",
			AgentID:      "agent-lifecycle",
			Scopes:       []string{"read:*", "write:policies"},
			RateLimitRPS: 50,
			Metadata: map[string]interface{}{
				"env": "test",
			},
		}

		resp, err := service.CreateAPIKey(ctx, req)
		require.NoError(t, err)
		assert.NotEmpty(t, resp.APIKey)
		assert.NotEmpty(t, resp.ID)

		plainKey := resp.APIKey
		keyID := resp.ID

		// 2. Validate API key
		validator := apikey.NewValidator(service.(*struct {
			store     apikey.APIKeyStore
			generator *apikey.Generator
			validator *apikey.Validator
		}).store, nil)

		principal, err := validator.ValidateAPIKey(ctx, plainKey)
		require.NoError(t, err)
		assert.NotNil(t, principal)
		assert.Equal(t, "agent-lifecycle", principal.ID)
		assert.Equal(t, "agent", principal.Type)

		// 3. Use the key (update last_used_at)
		time.Sleep(100 * time.Millisecond) // Let async update complete

		retrieved, err := service.GetAPIKey(ctx, keyID)
		require.NoError(t, err)
		assert.NotNil(t, retrieved)

		// 4. Revoke the key
		err = service.RevokeAPIKey(ctx, keyID)
		require.NoError(t, err)

		// 5. Validation should fail after revocation
		_, err = validator.ValidateAPIKey(ctx, plainKey)
		assert.ErrorIs(t, err, apikey.ErrAPIKeyRevoked)

		// 6. Key should appear in list with includeRevoked=true
		keys, err := service.ListAPIKeys(ctx, "agent-lifecycle", true)
		require.NoError(t, err)
		assert.Len(t, keys, 1)

		// But not in list with includeRevoked=false
		activeKeys, err := service.ListAPIKeys(ctx, "agent-lifecycle", false)
		require.NoError(t, err)
		assert.Len(t, activeKeys, 0)
	})
}

func TestAPIKeyLifecycle_MultiTenantIsolation(t *testing.T) {
	_, _, service, cleanup := setupIntegrationTest(t)
	defer cleanup()

	ctx := context.Background()

	t.Run("tenant isolation - keys are isolated by agent_id", func(t *testing.T) {
		// Create keys for different agents
		agents := []string{"tenant-a", "tenant-b", "tenant-c"}
		createdKeys := make(map[string][]*apikey.APIKeyResponse)

		for _, agentID := range agents {
			for i := 0; i < 3; i++ {
				req := &apikey.APIKeyCreateRequest{
					Name:    "Tenant Key",
					AgentID: agentID,
					Scopes:  []string{"read:*"},
				}

				resp, err := service.CreateAPIKey(ctx, req)
				require.NoError(t, err)
				createdKeys[agentID] = append(createdKeys[agentID], resp)
			}
		}

		// Verify each tenant sees only their keys
		for _, agentID := range agents {
			keys, err := service.ListAPIKeys(ctx, agentID, false)
			require.NoError(t, err)
			assert.Len(t, keys, 3, "each tenant should have exactly 3 keys")

			// Verify all keys belong to this agent
			for _, key := range keys {
				assert.Equal(t, agentID, key.AgentID)
			}
		}

		// Verify tenant-a cannot access tenant-b's keys
		tenantAKeys, _ := service.ListAPIKeys(ctx, "tenant-a", false)
		tenantBKeys, _ := service.ListAPIKeys(ctx, "tenant-b", false)

		for _, keyA := range tenantAKeys {
			for _, keyB := range tenantBKeys {
				assert.NotEqual(t, keyA.ID, keyB.ID, "tenant keys should be different")
			}
		}
	})
}

func TestAPIKeyLifecycle_RateLimitingEnforcement(t *testing.T) {
	store, rateLimiter, service, cleanup := setupIntegrationTest(t)
	defer cleanup()

	ctx := context.Background()

	t.Run("rate limiting is enforced during validation", func(t *testing.T) {
		// Create key with low rate limit
		req := &apikey.APIKeyCreateRequest{
			Name:         "Rate Limited Key",
			AgentID:      "agent-ratelimit",
			Scopes:       []string{"read:*"},
			RateLimitRPS: 5, // 5 requests per second
		}

		resp, err := service.CreateAPIKey(ctx, req)
		require.NoError(t, err)

		plainKey := resp.APIKey

		// Create validator with rate limiter
		validator := apikey.NewValidator(store, rateLimiter)

		// First 5 requests should succeed
		for i := 0; i < 5; i++ {
			principal, err := validator.ValidateAPIKey(ctx, plainKey)
			require.NoError(t, err, "request %d should succeed", i+1)
			assert.NotNil(t, principal)
		}

		// 6th request should fail due to rate limit
		_, err = validator.ValidateAPIKey(ctx, plainKey)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "rate limit exceeded")

		// Wait for next window
		time.Sleep(1100 * time.Millisecond)

		// Should work again
		principal, err := validator.ValidateAPIKey(ctx, plainKey)
		require.NoError(t, err)
		assert.NotNil(t, principal)
	})

	t.Run("different keys have independent rate limits", func(t *testing.T) {
		// Create two keys
		key1Resp, _ := service.CreateAPIKey(ctx, &apikey.APIKeyCreateRequest{
			Name:         "Key 1",
			AgentID:      "agent-1",
			Scopes:       []string{"read:*"},
			RateLimitRPS: 3,
		})

		key2Resp, _ := service.CreateAPIKey(ctx, &apikey.APIKeyCreateRequest{
			Name:         "Key 2",
			AgentID:      "agent-2",
			Scopes:       []string{"read:*"},
			RateLimitRPS: 3,
		})

		validator := apikey.NewValidator(store, rateLimiter)

		// Use up key1's limit
		for i := 0; i < 3; i++ {
			validator.ValidateAPIKey(ctx, key1Resp.APIKey)
		}

		// key1 should be limited
		_, err := validator.ValidateAPIKey(ctx, key1Resp.APIKey)
		assert.Error(t, err)

		// key2 should still work
		_, err = validator.ValidateAPIKey(ctx, key2Resp.APIKey)
		assert.NoError(t, err)
	})
}

func TestAPIKeyLifecycle_ConcurrentOperations(t *testing.T) {
	_, _, service, cleanup := setupIntegrationTest(t)
	defer cleanup()

	ctx := context.Background()

	t.Run("concurrent key creation", func(t *testing.T) {
		var wg sync.WaitGroup
		agentID := "agent-concurrent"
		keyCount := 20

		errors := make([]error, keyCount)
		responses := make([]*apikey.APIKeyResponse, keyCount)

		for i := 0; i < keyCount; i++ {
			wg.Add(1)
			go func(idx int) {
				defer wg.Done()

				req := &apikey.APIKeyCreateRequest{
					Name:    "Concurrent Key",
					AgentID: agentID,
					Scopes:  []string{"read:*"},
				}

				resp, err := service.CreateAPIKey(ctx, req)
				errors[idx] = err
				responses[idx] = resp
			}(i)
		}

		wg.Wait()

		// All operations should succeed
		for i, err := range errors {
			assert.NoError(t, err, "creation %d should succeed", i)
		}

		// All keys should be unique
		keyIDs := make(map[string]bool)
		for _, resp := range responses {
			assert.NotEmpty(t, resp.ID)
			assert.False(t, keyIDs[resp.ID], "key ID should be unique")
			keyIDs[resp.ID] = true
		}

		// Verify all keys exist
		keys, err := service.ListAPIKeys(ctx, agentID, false)
		require.NoError(t, err)
		assert.Len(t, keys, keyCount)
	})

	t.Run("concurrent validation of same key", func(t *testing.T) {
		req := &apikey.APIKeyCreateRequest{
			Name:         "Concurrent Validate Key",
			AgentID:      "agent-concurrent-validate",
			Scopes:       []string{"read:*"},
			RateLimitRPS: 1000, // High limit to avoid rate limiting
		}

		resp, _ := service.CreateAPIKey(ctx, req)

		// Create service with its own components
		store := service.(*struct {
			store     apikey.APIKeyStore
			generator *apikey.Generator
			validator *apikey.Validator
		}).store

		validator := apikey.NewValidator(store, nil)

		var wg sync.WaitGroup
		validations := 50
		successCount := int32(0)
		var mu sync.Mutex

		for i := 0; i < validations; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()

				principal, err := validator.ValidateAPIKey(ctx, resp.APIKey)
				if err == nil && principal != nil {
					mu.Lock()
					successCount++
					mu.Unlock()
				}
			}()
		}

		wg.Wait()

		assert.Equal(t, int32(validations), successCount, "all validations should succeed")
	})
}

func TestAPIKeyLifecycle_HTTPMiddleware(t *testing.T) {
	store, rateLimiter, service, cleanup := setupIntegrationTest(t)
	defer cleanup()

	ctx := context.Background()

	t.Run("middleware integration with service", func(t *testing.T) {
		// Create an API key
		req := &apikey.APIKeyCreateRequest{
			Name:    "HTTP Middleware Key",
			AgentID: "agent-http",
			Scopes:  []string{"read:*", "write:*"},
		}

		resp, err := service.CreateAPIKey(ctx, req)
		require.NoError(t, err)

		// Create middleware
		validator := apikey.NewValidator(store, rateLimiter)
		middleware := apikey.NewMiddleware(validator, false)

		// Test handler
		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			principal := apikey.GetPrincipal(r.Context())
			if principal == nil {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("success"))
		})

		// Test with valid key
		reqHTTP := httptest.NewRequest(http.MethodGet, "/test", nil)
		reqHTTP.Header.Set("X-API-Key", resp.APIKey)
		rec := httptest.NewRecorder()

		middleware.Authenticate(handler).ServeHTTP(rec, reqHTTP)

		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, "success", rec.Body.String())

		// Revoke the key
		service.RevokeAPIKey(ctx, resp.ID)

		// Test with revoked key
		reqHTTP2 := httptest.NewRequest(http.MethodGet, "/test", nil)
		reqHTTP2.Header.Set("X-API-Key", resp.APIKey)
		rec2 := httptest.NewRecorder()

		middleware.Authenticate(handler).ServeHTTP(rec2, reqHTTP2)

		assert.Equal(t, http.StatusUnauthorized, rec2.Code)
		assert.Contains(t, rec2.Body.String(), "revoked")
	})
}

func BenchmarkAPIKeyLifecycle_EndToEnd(b *testing.B) {
	_, _, service, cleanup := setupIntegrationTest(&testing.T{})
	defer cleanup()

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := &apikey.APIKeyCreateRequest{
			Name:    "Benchmark Key",
			AgentID: "agent-bench",
			Scopes:  []string{"read:*"},
		}

		resp, _ := service.CreateAPIKey(ctx, req)
		service.GetAPIKey(ctx, resp.ID)
		service.RevokeAPIKey(ctx, resp.ID)
	}
}
