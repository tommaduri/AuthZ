package apikey

import (
	"context"
	"database/sql"
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
