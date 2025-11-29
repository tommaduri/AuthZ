package apikey

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestService_CreateAPIKey(t *testing.T) {
	ctx := context.Background()
	store := NewMockStore()
	service := NewService(store, nil)

	t.Run("creates API key successfully", func(t *testing.T) {
		req := &APIKeyCreateRequest{
			Name:         "Test API Key",
			AgentID:      "agent-123",
			Scopes:       []string{"read:*", "write:policies"},
			RateLimitRPS: 150,
			Metadata: map[string]interface{}{
				"env":  "production",
				"team": "platform",
			},
		}

		resp, err := service.CreateAPIKey(ctx, req)
		require.NoError(t, err)
		assert.NotNil(t, resp)

		// Verify response
		assert.NotEmpty(t, resp.APIKey, "should return plain API key")
		assert.NotEmpty(t, resp.ID, "should return key ID")
		assert.Equal(t, req.Name, resp.Name)
		assert.Equal(t, req.AgentID, resp.AgentID)
		assert.Equal(t, req.Scopes, resp.Scopes)
		assert.Equal(t, req.RateLimitRPS, resp.RateLimitRPS)

		// Verify key format
		assert.Contains(t, resp.APIKey, "ak_live_")
		assert.Greater(t, len(resp.APIKey), 20)
	})

	t.Run("sets default rate limit", func(t *testing.T) {
		req := &APIKeyCreateRequest{
			Name:    "Default Rate Limit Key",
			AgentID: "agent-default",
			Scopes:  []string{"read:*"},
			// RateLimitRPS not set
		}

		resp, err := service.CreateAPIKey(ctx, req)
		require.NoError(t, err)
		assert.Equal(t, 100, resp.RateLimitRPS, "should use default rate limit of 100")
	})

	t.Run("validates required fields - agent_id", func(t *testing.T) {
		req := &APIKeyCreateRequest{
			Name:   "Missing Agent ID",
			Scopes: []string{"read:*"},
		}

		_, err := service.CreateAPIKey(ctx, req)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "agent_id is required")
	})

	t.Run("validates required fields - name", func(t *testing.T) {
		req := &APIKeyCreateRequest{
			AgentID: "agent-123",
			Scopes:  []string{"read:*"},
		}

		_, err := service.CreateAPIKey(ctx, req)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "name is required")
	})

	t.Run("handles expiration time", func(t *testing.T) {
		expiresAt := time.Now().Add(30 * 24 * time.Hour) // 30 days

		req := &APIKeyCreateRequest{
			Name:      "Expiring Key",
			AgentID:   "agent-expire",
			Scopes:    []string{"read:*"},
			ExpiresAt: &expiresAt,
		}

		resp, err := service.CreateAPIKey(ctx, req)
		require.NoError(t, err)
		assert.NotNil(t, resp.ExpiresAt)
		assert.WithinDuration(t, expiresAt, *resp.ExpiresAt, time.Second)
	})

	t.Run("creates multiple keys for same agent", func(t *testing.T) {
		agentID := "agent-multi"

		for i := 0; i < 3; i++ {
			req := &APIKeyCreateRequest{
				Name:    "Multi Key",
				AgentID: agentID,
				Scopes:  []string{"read:*"},
			}

			resp, err := service.CreateAPIKey(ctx, req)
			require.NoError(t, err)
			assert.NotEmpty(t, resp.APIKey)
		}

		// Verify all keys were created
		keys, err := service.ListAPIKeys(ctx, agentID, false)
		require.NoError(t, err)
		assert.Len(t, keys, 3)
	})

	t.Run("creates keys with metadata", func(t *testing.T) {
		metadata := map[string]interface{}{
			"env":         "staging",
			"created_by":  "admin",
			"purpose":     "testing",
			"cost_center": 12345,
		}

		req := &APIKeyCreateRequest{
			Name:     "Metadata Key",
			AgentID:  "agent-metadata",
			Scopes:   []string{"read:*"},
			Metadata: metadata,
		}

		resp, err := service.CreateAPIKey(ctx, req)
		require.NoError(t, err)
		assert.NotNil(t, resp)

		// Verify stored
		retrieved, err := service.GetAPIKey(ctx, resp.ID)
		require.NoError(t, err)
		assert.NotNil(t, retrieved)
	})
}

func TestService_ListAPIKeys(t *testing.T) {
	ctx := context.Background()
	store := NewMockStore()
	service := NewService(store, nil)

	agentID := "agent-list-test"

	// Create multiple keys
	for i := 0; i < 5; i++ {
		req := &APIKeyCreateRequest{
			Name:    "List Test Key",
			AgentID: agentID,
			Scopes:  []string{"read:*"},
		}
		service.CreateAPIKey(ctx, req)
	}

	t.Run("lists all keys for agent", func(t *testing.T) {
		keys, err := service.ListAPIKeys(ctx, agentID, false)
		require.NoError(t, err)
		assert.Len(t, keys, 5)

		// Verify no plain API keys are returned
		for _, key := range keys {
			assert.Empty(t, key.APIKey, "list should not include plain API keys")
			assert.NotEmpty(t, key.ID)
			assert.NotEmpty(t, key.Name)
			assert.Equal(t, agentID, key.AgentID)
		}
	})

	t.Run("returns empty list for non-existent agent", func(t *testing.T) {
		keys, err := service.ListAPIKeys(ctx, "non-existent-agent", false)
		require.NoError(t, err)
		assert.Empty(t, keys)
	})

	t.Run("excludes revoked keys by default", func(t *testing.T) {
		// Create and revoke a key
		req := &APIKeyCreateRequest{
			Name:    "To Be Revoked",
			AgentID: agentID,
			Scopes:  []string{"read:*"},
		}
		resp, _ := service.CreateAPIKey(ctx, req)
		service.RevokeAPIKey(ctx, resp.ID)

		// List without revoked
		keys, err := service.ListAPIKeys(ctx, agentID, false)
		require.NoError(t, err)
		assert.Len(t, keys, 5, "should exclude revoked key")

		// List with revoked
		allKeys, err := service.ListAPIKeys(ctx, agentID, true)
		require.NoError(t, err)
		assert.Len(t, allKeys, 6, "should include revoked key")
	})
}

func TestService_RevokeAPIKey(t *testing.T) {
	ctx := context.Background()
	store := NewMockStore()
	service := NewService(store, nil)

	t.Run("revokes key successfully", func(t *testing.T) {
		req := &APIKeyCreateRequest{
			Name:    "To Revoke",
			AgentID: "agent-revoke",
			Scopes:  []string{"read:*"},
		}

		resp, err := service.CreateAPIKey(ctx, req)
		require.NoError(t, err)

		// Revoke
		err = service.RevokeAPIKey(ctx, resp.ID)
		require.NoError(t, err)

		// Verify revoked
		retrieved, err := service.GetAPIKey(ctx, resp.ID)
		require.NoError(t, err)
		assert.NotNil(t, retrieved)
	})

	t.Run("revoking non-existent key returns error", func(t *testing.T) {
		err := service.RevokeAPIKey(ctx, "non-existent-id")
		assert.ErrorIs(t, err, ErrAPIKeyNotFound)
	})

	t.Run("revoked key cannot be used for validation", func(t *testing.T) {
		req := &APIKeyCreateRequest{
			Name:    "Validate After Revoke",
			AgentID: "agent-validate",
			Scopes:  []string{"read:*"},
		}

		resp, _ := service.CreateAPIKey(ctx, req)
		plainKey := resp.APIKey

		// Revoke
		service.RevokeAPIKey(ctx, resp.ID)

		// Try to validate
		_, err := service.validator.ValidateAPIKey(ctx, plainKey)
		assert.ErrorIs(t, err, ErrAPIKeyRevoked)
	})
}

func TestService_GetAPIKey(t *testing.T) {
	ctx := context.Background()
	store := NewMockStore()
	service := NewService(store, nil)

	t.Run("retrieves key by ID", func(t *testing.T) {
		req := &APIKeyCreateRequest{
			Name:         "Get Test",
			AgentID:      "agent-get",
			Scopes:       []string{"read:*", "write:*"},
			RateLimitRPS: 200,
		}

		created, err := service.CreateAPIKey(ctx, req)
		require.NoError(t, err)

		retrieved, err := service.GetAPIKey(ctx, created.ID)
		require.NoError(t, err)
		assert.Equal(t, created.ID, retrieved.ID)
		assert.Equal(t, created.Name, retrieved.Name)
		assert.Equal(t, created.AgentID, retrieved.AgentID)
		assert.Equal(t, created.Scopes, retrieved.Scopes)
		assert.Equal(t, created.RateLimitRPS, retrieved.RateLimitRPS)

		// Should not include plain API key
		assert.Empty(t, retrieved.APIKey)
	})

	t.Run("returns error for non-existent key", func(t *testing.T) {
		_, err := service.GetAPIKey(ctx, "non-existent-id")
		assert.ErrorIs(t, err, ErrAPIKeyNotFound)
	})
}

func TestService_EdgeCases(t *testing.T) {
	ctx := context.Background()
	store := NewMockStore()
	service := NewService(store, nil)

	t.Run("handles empty scopes", func(t *testing.T) {
		req := &APIKeyCreateRequest{
			Name:    "Empty Scopes",
			AgentID: "agent-empty-scopes",
			Scopes:  []string{},
		}

		resp, err := service.CreateAPIKey(ctx, req)
		require.NoError(t, err)
		assert.NotNil(t, resp.Scopes)
	})

	t.Run("handles nil metadata", func(t *testing.T) {
		req := &APIKeyCreateRequest{
			Name:     "Nil Metadata",
			AgentID:  "agent-nil-meta",
			Scopes:   []string{"read:*"},
			Metadata: nil,
		}

		resp, err := service.CreateAPIKey(ctx, req)
		require.NoError(t, err)
		assert.NotNil(t, resp)
	})

	t.Run("handles very long agent ID", func(t *testing.T) {
		longAgentID := "agent-" + string(make([]byte, 200))
		req := &APIKeyCreateRequest{
			Name:    "Long Agent ID",
			AgentID: longAgentID,
			Scopes:  []string{"read:*"},
		}

		resp, err := service.CreateAPIKey(ctx, req)
		require.NoError(t, err)
		assert.Equal(t, longAgentID, resp.AgentID)
	})

	t.Run("handles special characters in name", func(t *testing.T) {
		req := &APIKeyCreateRequest{
			Name:    "Test 🔑 Key <script>alert('xss')</script>",
			AgentID: "agent-special",
			Scopes:  []string{"read:*"},
		}

		resp, err := service.CreateAPIKey(ctx, req)
		require.NoError(t, err)
		assert.Equal(t, req.Name, resp.Name)
	})

	t.Run("handles very high rate limit", func(t *testing.T) {
		req := &APIKeyCreateRequest{
			Name:         "High Rate Limit",
			AgentID:      "agent-high-rate",
			Scopes:       []string{"read:*"},
			RateLimitRPS: 1000000,
		}

		resp, err := service.CreateAPIKey(ctx, req)
		require.NoError(t, err)
		assert.Equal(t, 1000000, resp.RateLimitRPS)
	})
}

func BenchmarkService_CreateAPIKey(b *testing.B) {
	ctx := context.Background()
	store := NewMockStore()
	service := NewService(store, nil)

	req := &APIKeyCreateRequest{
		Name:    "Benchmark Key",
		AgentID: "agent-bench",
		Scopes:  []string{"read:*"},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		service.CreateAPIKey(ctx, req)
	}
}

func BenchmarkService_ListAPIKeys(b *testing.B) {
	ctx := context.Background()
	store := NewMockStore()
	service := NewService(store, nil)

	agentID := "agent-bench-list"

	// Create 100 keys
	for i := 0; i < 100; i++ {
		req := &APIKeyCreateRequest{
			Name:    "Bench Key",
			AgentID: agentID,
			Scopes:  []string{"read:*"},
		}
		service.CreateAPIKey(ctx, req)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		service.ListAPIKeys(ctx, agentID, false)
	}
}
