package apikey

import (
	"context"
	"database/sql"
	"sync"
	"testing"
	"time"

	_ "github.com/lib/pq"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Note: These tests require a PostgreSQL database
// Set TEST_DATABASE_URL environment variable to run them
// Example: TEST_DATABASE_URL=postgres://user:pass@localhost/test_db?sslmode=disable

func setupTestDB(t *testing.T) *sql.DB {
	t.Helper()

	// Skip if no database URL provided
	dsn := "postgres://postgres:postgres@localhost/authz_test?sslmode=disable"

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Skipf("skipping postgres tests: %v", err)
	}

	if err := db.Ping(); err != nil {
		t.Skipf("skipping postgres tests: database not available: %v", err)
	}

	// Create test table
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS api_keys (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

	// Clean up before tests
	_, err = db.Exec("TRUNCATE TABLE api_keys")
	require.NoError(t, err)

	return db
}

func TestPostgresStore_Create(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	store, err := NewPostgresStore(db)
	require.NoError(t, err)

	ctx := context.Background()
	gen := NewGenerator()
	plainKey, keyHash, err := gen.Generate()
	require.NoError(t, err)

	t.Run("create API key with hash", func(t *testing.T) {
		key := &APIKey{
			ID:           "test-id-1",
			KeyHash:      keyHash, // Must be hash, not plaintext
			Name:         "Test Key",
			AgentID:      "agent-123",
			Scopes:       []string{"read:*", "write:policies"},
			CreatedAt:    time.Now(),
			RateLimitRPS: 150,
			Metadata:     map[string]interface{}{"env": "test"},
		}

		err := store.Create(ctx, key)
		require.NoError(t, err)
		assert.NotEmpty(t, key.ID)

		// Verify that the database contains the hash, not plaintext
		var storedHash string
		err = db.QueryRow("SELECT key_hash FROM api_keys WHERE id = $1", key.ID).Scan(&storedHash)
		require.NoError(t, err)
		assert.Equal(t, keyHash, storedHash, "stored hash should match generated hash")
		assert.NotEqual(t, plainKey, storedHash, "stored value should NOT be plaintext key")
		assert.Len(t, storedHash, 64, "SHA-256 hash should be 64 hex characters")
	})

	t.Run("reject plaintext key in KeyHash field", func(t *testing.T) {
		key := &APIKey{
			ID:           "test-id-invalid",
			KeyHash:      plainKey, // WRONG: This is plaintext, should be rejected
			Name:         "Invalid Key",
			AgentID:      "agent-invalid",
			Scopes:       []string{"read:*"},
			RateLimitRPS: 100,
		}

		err := store.Create(ctx, key)
		assert.Error(t, err, "should reject plaintext key in KeyHash field")
		assert.Contains(t, err.Error(), "64 characters", "error should mention hash length requirement")
	})

	t.Run("reject empty KeyHash", func(t *testing.T) {
		key := &APIKey{
			ID:           "test-id-empty",
			KeyHash:      "", // Empty hash
			Name:         "Empty Hash Key",
			AgentID:      "agent-empty",
			Scopes:       []string{"read:*"},
			RateLimitRPS: 100,
		}

		err := store.Create(ctx, key)
		assert.Error(t, err, "should reject empty KeyHash")
		assert.Contains(t, err.Error(), "required", "error should mention hash is required")
	})

	t.Run("duplicate key hash", func(t *testing.T) {
		key := &APIKey{
			ID:           "test-id-2",
			KeyHash:      keyHash, // Same hash as above
			Name:         "Duplicate Key",
			AgentID:      "agent-456",
			Scopes:       []string{"read:*"},
			RateLimitRPS: 100,
		}

		err := store.Create(ctx, key)
		assert.ErrorIs(t, err, ErrDuplicateAPIKey)
	})
}

func TestPostgresStore_Get(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	store, err := NewPostgresStore(db)
	require.NoError(t, err)

	ctx := context.Background()
	gen := NewGenerator()
	_, keyHash, err := gen.Generate()
	require.NoError(t, err)

	// Create test key
	original := &APIKey{
		ID:           "get-test-id",
		KeyHash:      keyHash,
		Name:         "Get Test Key",
		AgentID:      "agent-789",
		Scopes:       []string{"read:*"},
		CreatedAt:    time.Now(),
		RateLimitRPS: 200,
	}
	err = store.Create(ctx, original)
	require.NoError(t, err)

	t.Run("get existing key", func(t *testing.T) {
		retrieved, err := store.Get(ctx, keyHash)
		require.NoError(t, err)
		assert.Equal(t, original.ID, retrieved.ID)
		assert.Equal(t, original.Name, retrieved.Name)
		assert.Equal(t, original.AgentID, retrieved.AgentID)
		assert.Equal(t, original.Scopes, retrieved.Scopes)
		assert.Equal(t, original.RateLimitRPS, retrieved.RateLimitRPS)
	})

	t.Run("get non-existent key", func(t *testing.T) {
		_, err := store.Get(ctx, "nonexistent-hash")
		assert.ErrorIs(t, err, ErrAPIKeyNotFound)
	})
}

func TestPostgresStore_List(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	store, err := NewPostgresStore(db)
	require.NoError(t, err)

	ctx := context.Background()
	gen := NewGenerator()

	// Create multiple keys for same agent
	agentID := "list-agent-123"
	for i := 0; i < 3; i++ {
		_, keyHash, _ := gen.Generate()
		key := &APIKey{
			KeyHash:      keyHash,
			Name:         "List Key",
			AgentID:      agentID,
			Scopes:       []string{"read:*"},
			RateLimitRPS: 100,
		}
		store.Create(ctx, key)
	}

	t.Run("list agent keys", func(t *testing.T) {
		keys, err := store.List(ctx, agentID, false)
		require.NoError(t, err)
		assert.Len(t, keys, 3)
	})

	t.Run("list with no keys", func(t *testing.T) {
		keys, err := store.List(ctx, "nonexistent-agent", false)
		require.NoError(t, err)
		assert.Empty(t, keys)
	})
}

func TestPostgresStore_Revoke(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	store, err := NewPostgresStore(db)
	require.NoError(t, err)

	ctx := context.Background()
	gen := NewGenerator()
	_, keyHash, _ := gen.Generate()

	key := &APIKey{
		ID:           "revoke-test-id",
		KeyHash:      keyHash,
		Name:         "Revoke Test",
		AgentID:      "agent-revoke",
		Scopes:       []string{"read:*"},
		RateLimitRPS: 100,
	}
	store.Create(ctx, key)

	t.Run("revoke key", func(t *testing.T) {
		err := store.Revoke(ctx, key.ID)
		require.NoError(t, err)

		// Verify revoked
		retrieved, err := store.Get(ctx, keyHash)
		require.NoError(t, err)
		assert.True(t, retrieved.IsRevoked())
	})

	t.Run("revoke non-existent key", func(t *testing.T) {
		err := store.Revoke(ctx, "nonexistent-id")
		assert.ErrorIs(t, err, ErrAPIKeyNotFound)
	})
}

func TestPostgresStore_UpdateLastUsed(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	store, err := NewPostgresStore(db)
	require.NoError(t, err)

	ctx := context.Background()
	gen := NewGenerator()
	_, keyHash, _ := gen.Generate()

	key := &APIKey{
		ID:           "update-last-used-id",
		KeyHash:      keyHash,
		Name:         "Update Last Used",
		AgentID:      "agent-update",
		Scopes:       []string{"read:*"},
		RateLimitRPS: 100,
	}
	store.Create(ctx, key)

	t.Run("updates last used timestamp", func(t *testing.T) {
		time.Sleep(10 * time.Millisecond)

		err := store.UpdateLastUsed(ctx, key.ID)
		require.NoError(t, err)

		// Verify update
		retrieved, err := store.GetByID(ctx, key.ID)
		require.NoError(t, err)
		assert.NotNil(t, retrieved.LastUsedAt)
	})

	t.Run("updating non-existent key succeeds", func(t *testing.T) {
		err := store.UpdateLastUsed(ctx, "non-existent-id")
		assert.NoError(t, err) // SQL UPDATE succeeds with 0 rows affected
	})
}

func TestPostgresStore_Delete(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	store, err := NewPostgresStore(db)
	require.NoError(t, err)

	ctx := context.Background()
	gen := NewGenerator()
	_, keyHash, _ := gen.Generate()

	key := &APIKey{
		ID:           "delete-test-id",
		KeyHash:      keyHash,
		Name:         "Delete Test",
		AgentID:      "agent-delete",
		Scopes:       []string{"read:*"},
		RateLimitRPS: 100,
	}
	store.Create(ctx, key)

	t.Run("deletes key permanently", func(t *testing.T) {
		err := store.Delete(ctx, key.ID)
		require.NoError(t, err)

		// Verify deleted
		_, err = store.GetByID(ctx, key.ID)
		assert.ErrorIs(t, err, ErrAPIKeyNotFound)
	})

	t.Run("deleting non-existent key returns error", func(t *testing.T) {
		err := store.Delete(ctx, "non-existent-id")
		assert.ErrorIs(t, err, ErrAPIKeyNotFound)
	})
}

func TestPostgresStore_ConcurrentOperations(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	store, err := NewPostgresStore(db)
	require.NoError(t, err)

	ctx := context.Background()
	gen := NewGenerator()

	t.Run("concurrent creates of unique keys", func(t *testing.T) {
		agentID := "agent-concurrent"
		count := 20

		errors := make([]error, count)
		var wg sync.WaitGroup

		for i := 0; i < count; i++ {
			wg.Add(1)
			go func(idx int) {
				defer wg.Done()

				_, keyHash, _ := gen.Generate()
				key := &APIKey{
					KeyHash:      keyHash,
					Name:         "Concurrent Key",
					AgentID:      agentID,
					Scopes:       []string{"read:*"},
					RateLimitRPS: 100,
				}
				errors[idx] = store.Create(ctx, key)
			}(i)
		}

		wg.Wait()

		// All should succeed
		for i, err := range errors {
			assert.NoError(t, err, "concurrent create %d should succeed", i)
		}

		// Verify all exist
		keys, err := store.List(ctx, agentID, false)
		require.NoError(t, err)
		assert.Len(t, keys, count)
	})

	t.Run("concurrent reads of same key", func(t *testing.T) {
		_, keyHash, _ := gen.Generate()
		key := &APIKey{
			ID:           "concurrent-read-key",
			KeyHash:      keyHash,
			Name:         "Concurrent Read",
			AgentID:      "agent-read",
			Scopes:       []string{"read:*"},
			RateLimitRPS: 100,
		}
		store.Create(ctx, key)

		readCount := 50
		var wg sync.WaitGroup

		for i := 0; i < readCount; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				retrieved, err := store.Get(ctx, keyHash)
				assert.NoError(t, err)
				assert.Equal(t, key.ID, retrieved.ID)
			}()
		}

		wg.Wait()
	})

	t.Run("concurrent revokes handled correctly", func(t *testing.T) {
		_, keyHash, _ := gen.Generate()
		key := &APIKey{
			ID:           "concurrent-revoke-key",
			KeyHash:      keyHash,
			Name:         "Concurrent Revoke",
			AgentID:      "agent-revoke",
			Scopes:       []string{"read:*"},
			RateLimitRPS: 100,
		}
		store.Create(ctx, key)

		var wg sync.WaitGroup
		errors := make([]error, 5)

		for i := 0; i < 5; i++ {
			wg.Add(1)
			go func(idx int) {
				defer wg.Done()
				errors[idx] = store.Revoke(ctx, key.ID)
			}(i)
		}

		wg.Wait()

		// At least one should succeed, others might fail with not found
		successCount := 0
		for _, err := range errors {
			if err == nil {
				successCount++
			}
		}
		assert.GreaterOrEqual(t, successCount, 1, "at least one revoke should succeed")

		// Verify key is revoked
		retrieved, err := store.Get(ctx, keyHash)
		require.NoError(t, err)
		assert.True(t, retrieved.IsRevoked())
	})
}

func TestPostgresStore_ErrorHandling(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	ctx := context.Background()

	t.Run("nil database connection", func(t *testing.T) {
		_, err := NewPostgresStore(nil)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "nil")
	})

	t.Run("nil API key in Create", func(t *testing.T) {
		store, err := NewPostgresStore(db)
		require.NoError(t, err)

		err = store.Create(ctx, nil)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "nil")
	})

	t.Run("empty key hash in Create", func(t *testing.T) {
		store, err := NewPostgresStore(db)
		require.NoError(t, err)

		key := &APIKey{
			ID:           "empty-hash-test",
			KeyHash:      "",
			Name:         "Empty Hash",
			AgentID:      "agent-empty",
			Scopes:       []string{"read:*"},
			RateLimitRPS: 100,
		}

		err = store.Create(ctx, key)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "required")
	})

	t.Run("invalid hash length in Create", func(t *testing.T) {
		store, err := NewPostgresStore(db)
		require.NoError(t, err)

		key := &APIKey{
			ID:           "invalid-hash-length",
			KeyHash:      "tooshort",
			Name:         "Invalid Hash Length",
			AgentID:      "agent-invalid",
			Scopes:       []string{"read:*"},
			RateLimitRPS: 100,
		}

		err = store.Create(ctx, key)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "64 characters")
	})
}

func TestPostgresStore_MetadataHandling(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	store, err := NewPostgresStore(db)
	require.NoError(t, err)

	ctx := context.Background()
	gen := NewGenerator()

	t.Run("stores and retrieves complex metadata", func(t *testing.T) {
		_, keyHash, _ := gen.Generate()

		metadata := map[string]interface{}{
			"env":         "production",
			"team":        "platform",
			"cost_center": 12345,
			"tags":        []string{"api", "external"},
			"config": map[string]interface{}{
				"timeout": 30,
				"retries": 3,
			},
		}

		key := &APIKey{
			ID:           "metadata-test-id",
			KeyHash:      keyHash,
			Name:         "Metadata Test",
			AgentID:      "agent-metadata",
			Scopes:       []string{"read:*"},
			RateLimitRPS: 100,
			Metadata:     metadata,
		}

		err := store.Create(ctx, key)
		require.NoError(t, err)

		retrieved, err := store.Get(ctx, keyHash)
		require.NoError(t, err)
		assert.NotNil(t, retrieved.Metadata)
		assert.Equal(t, "production", retrieved.Metadata["env"])
		assert.Equal(t, "platform", retrieved.Metadata["team"])
	})

	t.Run("handles nil metadata", func(t *testing.T) {
		_, keyHash, _ := gen.Generate()

		key := &APIKey{
			ID:           "nil-metadata-id",
			KeyHash:      keyHash,
			Name:         "Nil Metadata",
			AgentID:      "agent-nil",
			Scopes:       []string{"read:*"},
			RateLimitRPS: 100,
			Metadata:     nil,
		}

		err := store.Create(ctx, key)
		require.NoError(t, err)

		retrieved, err := store.Get(ctx, keyHash)
		require.NoError(t, err)
		assert.NotNil(t, retrieved)
	})
}

func TestPostgresStore_ScopesHandling(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	store, err := NewPostgresStore(db)
	require.NoError(t, err)

	ctx := context.Background()
	gen := NewGenerator()

	t.Run("stores and retrieves multiple scopes", func(t *testing.T) {
		_, keyHash, _ := gen.Generate()

		scopes := []string{"read:*", "write:policies", "admin:users"}

		key := &APIKey{
			ID:           "scopes-test-id",
			KeyHash:      keyHash,
			Name:         "Scopes Test",
			AgentID:      "agent-scopes",
			Scopes:       scopes,
			RateLimitRPS: 100,
		}

		err := store.Create(ctx, key)
		require.NoError(t, err)

		retrieved, err := store.Get(ctx, keyHash)
		require.NoError(t, err)
		assert.ElementsMatch(t, scopes, retrieved.Scopes)
	})

	t.Run("handles empty scopes", func(t *testing.T) {
		_, keyHash, _ := gen.Generate()

		key := &APIKey{
			ID:           "empty-scopes-id",
			KeyHash:      keyHash,
			Name:         "Empty Scopes",
			AgentID:      "agent-empty-scopes",
			Scopes:       []string{},
			RateLimitRPS: 100,
		}

		err := store.Create(ctx, key)
		require.NoError(t, err)

		retrieved, err := store.Get(ctx, keyHash)
		require.NoError(t, err)
		assert.NotNil(t, retrieved.Scopes)
	})
}

func BenchmarkPostgresStore_Get(b *testing.B) {
	db := setupTestDB(&testing.T{})
	defer db.Close()

	store, _ := NewPostgresStore(db)
	ctx := context.Background()
	gen := NewGenerator()
	_, keyHash, _ := gen.Generate()

	key := &APIKey{
		KeyHash:      keyHash,
		Name:         "Benchmark Key",
		AgentID:      "agent-bench",
		Scopes:       []string{"read:*"},
		RateLimitRPS: 1000,
	}
	store.Create(ctx, key)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = store.Get(ctx, keyHash)
	}
}

func BenchmarkPostgresStore_Create(b *testing.B) {
	db := setupTestDB(&testing.T{})
	defer db.Close()

	store, _ := NewPostgresStore(db)
	ctx := context.Background()
	gen := NewGenerator()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, keyHash, _ := gen.Generate()
		key := &APIKey{
			KeyHash:      keyHash,
			Name:         "Benchmark Key",
			AgentID:      "agent-bench",
			Scopes:       []string{"read:*"},
			RateLimitRPS: 1000,
		}
		store.Create(ctx, key)
	}
}
