package apikey

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// MockStore implements APIKeyStore for testing
type MockStore struct {
	keys map[string]*APIKey
}

func NewMockStore() *MockStore {
	return &MockStore{
		keys: make(map[string]*APIKey),
	}
}

func (m *MockStore) Create(ctx context.Context, key *APIKey) error {
	m.keys[key.KeyHash] = key
	return nil
}

func (m *MockStore) Get(ctx context.Context, keyHash string) (*APIKey, error) {
	key, ok := m.keys[keyHash]
	if !ok {
		return nil, ErrAPIKeyNotFound
	}
	return key, nil
}

func (m *MockStore) GetByID(ctx context.Context, keyID string) (*APIKey, error) {
	for _, key := range m.keys {
		if key.ID == keyID {
			return key, nil
		}
	}
	return nil, ErrAPIKeyNotFound
}

func (m *MockStore) List(ctx context.Context, agentID string, includeRevoked bool) ([]*APIKey, error) {
	var keys []*APIKey
	for _, key := range m.keys {
		if key.AgentID == agentID {
			if !includeRevoked && key.IsRevoked() {
				continue
			}
			keys = append(keys, key)
		}
	}
	return keys, nil
}

func (m *MockStore) Revoke(ctx context.Context, keyID string) error {
	for _, key := range m.keys {
		if key.ID == keyID {
			now := time.Now()
			key.RevokedAt = &now
			return nil
		}
	}
	return ErrAPIKeyNotFound
}

func (m *MockStore) UpdateLastUsed(ctx context.Context, keyID string) error {
	for _, key := range m.keys {
		if key.ID == keyID {
			now := time.Now()
			key.LastUsedAt = &now
			return nil
		}
	}
	return ErrAPIKeyNotFound
}

func (m *MockStore) Delete(ctx context.Context, keyID string) error {
	for hash, key := range m.keys {
		if key.ID == keyID {
			delete(m.keys, hash)
			return nil
		}
	}
	return ErrAPIKeyNotFound
}

func (m *MockStore) Close() error {
	return nil
}

func TestValidator_ValidateAPIKey(t *testing.T) {
	ctx := context.Background()
	store := NewMockStore()
	validator := NewValidator(store, nil) // No rate limiter for basic tests

	t.Run("valid API key", func(t *testing.T) {
		// Generate a key
		gen := NewGenerator()
		plainKey, keyHash, err := gen.Generate()
		require.NoError(t, err)

		// Store it
		key := &APIKey{
			ID:           "key-1",
			KeyHash:      keyHash,
			Name:         "Test Key",
			AgentID:      "agent-123",
			Scopes:       []string{"read:*"},
			CreatedAt:    time.Now(),
			RateLimitRPS: 100,
		}
		err = store.Create(ctx, key)
		require.NoError(t, err)

		// Validate
		principal, err := validator.ValidateAPIKey(ctx, plainKey)
		require.NoError(t, err)
		assert.NotNil(t, principal)
		assert.Equal(t, "agent-123", principal.ID)
		assert.Equal(t, "agent", principal.Type)
		assert.Contains(t, principal.Scopes, "read:*")
	})

	t.Run("invalid API key format", func(t *testing.T) {
		_, err := validator.ValidateAPIKey(ctx, "invalid-key")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid api key format")
	})

	t.Run("API key not found", func(t *testing.T) {
		gen := NewGenerator()
		plainKey, _, err := gen.Generate()
		require.NoError(t, err)

		_, err = validator.ValidateAPIKey(ctx, plainKey)
		assert.ErrorIs(t, err, ErrAPIKeyNotFound)
	})

	t.Run("revoked API key", func(t *testing.T) {
		gen := NewGenerator()
		plainKey, keyHash, err := gen.Generate()
		require.NoError(t, err)

		now := time.Now()
		key := &APIKey{
			ID:           "key-2",
			KeyHash:      keyHash,
			Name:         "Revoked Key",
			AgentID:      "agent-123",
			Scopes:       []string{"read:*"},
			CreatedAt:    time.Now(),
			RevokedAt:    &now,
			RateLimitRPS: 100,
		}
		err = store.Create(ctx, key)
		require.NoError(t, err)

		_, err = validator.ValidateAPIKey(ctx, plainKey)
		assert.ErrorIs(t, err, ErrAPIKeyRevoked)
	})

	t.Run("expired API key", func(t *testing.T) {
		gen := NewGenerator()
		plainKey, keyHash, err := gen.Generate()
		require.NoError(t, err)

		expired := time.Now().Add(-1 * time.Hour)
		key := &APIKey{
			ID:           "key-3",
			KeyHash:      keyHash,
			Name:         "Expired Key",
			AgentID:      "agent-123",
			Scopes:       []string{"read:*"},
			CreatedAt:    time.Now().Add(-2 * time.Hour),
			ExpiresAt:    &expired,
			RateLimitRPS: 100,
		}
		err = store.Create(ctx, key)
		require.NoError(t, err)

		_, err = validator.ValidateAPIKey(ctx, plainKey)
		assert.ErrorIs(t, err, ErrAPIKeyExpired)
	})
}

func TestValidator_SecurityProperties(t *testing.T) {
	ctx := context.Background()
	store := NewMockStore()
	validator := NewValidator(store, nil)
	gen := NewGenerator()

	t.Run("constant-time comparison prevents timing attacks", func(t *testing.T) {
		// Generate a valid key
		plainKey, keyHash, err := gen.Generate()
		require.NoError(t, err)

		key := &APIKey{
			ID:           "timing-test",
			KeyHash:      keyHash,
			Name:         "Timing Test Key",
			AgentID:      "agent-timing",
			Scopes:       []string{"read:*"},
			CreatedAt:    time.Now(),
			RateLimitRPS: 100,
		}
		err = store.Create(ctx, key)
		require.NoError(t, err)

		// Try validation with slightly different key (should fail)
		wrongKey := plainKey[:len(plainKey)-1] + "X"
		_, err = validator.ValidateAPIKey(ctx, wrongKey)
		assert.Error(t, err, "wrong key should be rejected")

		// Verify the comparison uses constant-time (we can't directly test timing,
		// but we verify it doesn't panic or leak info through error messages)
		assert.NotContains(t, err.Error(), keyHash, "error should not leak hash")
		assert.NotContains(t, err.Error(), plainKey, "error should not leak plaintext")
	})

	t.Run("hash verification - only hashes stored", func(t *testing.T) {
		plainKey, keyHash, err := gen.Generate()
		require.NoError(t, err)

		// Verify hash is 64 hex characters (SHA-256)
		assert.Len(t, keyHash, 64, "SHA-256 hash should be 64 hex chars")
		assert.Regexp(t, "^[a-f0-9]{64}$", keyHash, "hash should be lowercase hex")

		// Store the key
		key := &APIKey{
			ID:           "hash-test",
			KeyHash:      keyHash,
			Name:         "Hash Test Key",
			AgentID:      "agent-hash",
			Scopes:       []string{"read:*"},
			CreatedAt:    time.Now(),
			RateLimitRPS: 100,
		}
		err = store.Create(ctx, key)
		require.NoError(t, err)

		// Retrieve and verify it's the hash, not plaintext
		retrieved, err := store.Get(ctx, keyHash)
		require.NoError(t, err)
		assert.Equal(t, keyHash, retrieved.KeyHash, "stored value should be hash")
		assert.NotEqual(t, plainKey, retrieved.KeyHash, "stored value should NOT be plaintext")

		// Verify validation works with plaintext input
		principal, err := validator.ValidateAPIKey(ctx, plainKey)
		require.NoError(t, err)
		assert.NotNil(t, principal)
	})

	t.Run("different keys produce different hashes", func(t *testing.T) {
		key1, hash1, err := gen.Generate()
		require.NoError(t, err)
		key2, hash2, err := gen.Generate()
		require.NoError(t, err)

		assert.NotEqual(t, key1, key2, "keys should be different")
		assert.NotEqual(t, hash1, hash2, "hashes should be different")
		assert.Len(t, hash1, 64)
		assert.Len(t, hash2, 64)
	})

	t.Run("same key always produces same hash", func(t *testing.T) {
		testKey := "ak_live_test1234567890123456789012"
		hash1 := gen.Hash(testKey)
		hash2 := gen.Hash(testKey)
		assert.Equal(t, hash1, hash2, "same key should produce same hash")
		assert.Len(t, hash1, 64)
	})

	t.Run("no plaintext keys in error messages", func(t *testing.T) {
		plainKey, _, err := gen.Generate()
		require.NoError(t, err)

		// Try to validate non-existent key
		_, err = validator.ValidateAPIKey(ctx, plainKey)
		assert.Error(t, err)

		// Error should not contain the plaintext key
		assert.NotContains(t, err.Error(), plainKey, "error should not leak plaintext key")
	})
}

func BenchmarkValidator_ValidateAPIKey(b *testing.B) {
	ctx := context.Background()
	store := NewMockStore()
	validator := NewValidator(store, nil)

	// Setup
	gen := NewGenerator()
	plainKey, keyHash, _ := gen.Generate()
	key := &APIKey{
		ID:           "bench-key",
		KeyHash:      keyHash,
		Name:         "Benchmark Key",
		AgentID:      "agent-bench",
		Scopes:       []string{"read:*"},
		CreatedAt:    time.Now(),
		RateLimitRPS: 1000,
	}
	store.Create(ctx, key)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = validator.ValidateAPIKey(ctx, plainKey)
	}
}

func BenchmarkValidator_ConstantTimeComparison(b *testing.B) {
	ctx := context.Background()
	store := NewMockStore()
	validator := NewValidator(store, nil)
	gen := NewGenerator()

	// Setup two keys
	plainKey1, keyHash1, _ := gen.Generate()
	plainKey2, _, _ := gen.Generate()

	key := &APIKey{
		ID:           "bench-timing",
		KeyHash:      keyHash1,
		Name:         "Timing Benchmark Key",
		AgentID:      "agent-timing",
		Scopes:       []string{"read:*"},
		CreatedAt:    time.Now(),
		RateLimitRPS: 1000,
	}
	store.Create(ctx, key)

	b.Run("correct key", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_, _ = validator.ValidateAPIKey(ctx, plainKey1)
		}
	})

	b.Run("wrong key", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_, _ = validator.ValidateAPIKey(ctx, plainKey2)
		}
	})
	// Note: Timing should be similar for both to prevent timing attacks
}
