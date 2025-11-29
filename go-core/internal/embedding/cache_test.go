package embedding

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestNewEmbeddingCache verifies cache initialization
func TestNewEmbeddingCache(t *testing.T) {
	t.Run("default config", func(t *testing.T) {
		cache := NewEmbeddingCache(DefaultCacheConfig())
		require.NotNil(t, cache)
		assert.Equal(t, 10000, cache.maxEntries)
		assert.Equal(t, 24*time.Hour, cache.ttl)

		stats := cache.Stats()
		assert.Equal(t, 0, stats.Entries)
		assert.Equal(t, int64(0), stats.Hits)
		assert.Equal(t, int64(0), stats.Misses)
	})

	t.Run("custom config", func(t *testing.T) {
		cfg := CacheConfig{
			MaxEntries: 1000,
			TTL:        1 * time.Hour,
		}
		cache := NewEmbeddingCache(cfg)
		require.NotNil(t, cache)
		assert.Equal(t, 1000, cache.maxEntries)
		assert.Equal(t, 1*time.Hour, cache.ttl)
	})
}

// TestEmbeddingCache_PutAndGet verifies basic cache operations
func TestEmbeddingCache_PutAndGet(t *testing.T) {
	cache := NewEmbeddingCache(DefaultCacheConfig())

	policyID := "policy-123"
	policyHash := "hash-abc"
	embedding := []float32{0.1, 0.2, 0.3, 0.4}

	t.Run("put and get", func(t *testing.T) {
		err := cache.Put(policyID, policyHash, embedding)
		require.NoError(t, err)

		retrieved := cache.Get(policyID, policyHash)
		require.NotNil(t, retrieved)
		assert.Equal(t, embedding, retrieved)

		stats := cache.Stats()
		assert.Equal(t, 1, stats.Entries)
		assert.Equal(t, int64(1), stats.Hits)
		assert.Equal(t, int64(0), stats.Misses)
		assert.Equal(t, 1.0, stats.HitRate)
	})

	t.Run("get non-existent", func(t *testing.T) {
		retrieved := cache.Get("non-existent", "hash")
		assert.Nil(t, retrieved)

		stats := cache.Stats()
		assert.Equal(t, int64(1), stats.Misses)
	})

	t.Run("put empty embedding", func(t *testing.T) {
		err := cache.Put("policy-456", "hash", []float32{})
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "embedding cannot be empty")
	})
}

// TestEmbeddingCache_HashMismatch verifies cache invalidation on policy changes
func TestEmbeddingCache_HashMismatch(t *testing.T) {
	cache := NewEmbeddingCache(DefaultCacheConfig())

	policyID := "policy-123"
	originalHash := "hash-v1"
	newHash := "hash-v2"
	embedding := []float32{0.1, 0.2, 0.3}

	// Store with original hash
	err := cache.Put(policyID, originalHash, embedding)
	require.NoError(t, err)

	// Get with original hash succeeds
	retrieved := cache.Get(policyID, originalHash)
	assert.NotNil(t, retrieved)

	// Get with new hash fails (policy changed)
	retrieved = cache.Get(policyID, newHash)
	assert.Nil(t, retrieved, "should return nil when policy hash doesn't match")

	// Verify entry was removed
	stats := cache.Stats()
	assert.Equal(t, 0, stats.Entries, "stale entry should be evicted")
	assert.Equal(t, int64(1), stats.Evictions)
}

// TestEmbeddingCache_TTL verifies cache expiration
func TestEmbeddingCache_TTL(t *testing.T) {
	// Short TTL for testing
	cfg := CacheConfig{
		MaxEntries: 100,
		TTL:        50 * time.Millisecond,
	}
	cache := NewEmbeddingCache(cfg)

	policyID := "policy-123"
	policyHash := "hash-abc"
	embedding := []float32{0.1, 0.2, 0.3}

	// Store embedding
	err := cache.Put(policyID, policyHash, embedding)
	require.NoError(t, err)

	// Immediate get succeeds
	retrieved := cache.Get(policyID, policyHash)
	assert.NotNil(t, retrieved)

	// Wait for TTL expiration
	time.Sleep(100 * time.Millisecond)

	// Get after TTL expiration fails
	retrieved = cache.Get(policyID, policyHash)
	assert.Nil(t, retrieved, "should return nil after TTL expiration")

	// Verify entry was removed
	stats := cache.Stats()
	assert.Equal(t, 0, stats.Entries)
	assert.Equal(t, int64(1), stats.Evictions)
}

// TestEmbeddingCache_LRU verifies LRU eviction
func TestEmbeddingCache_LRU(t *testing.T) {
	// Small cache for testing eviction
	cfg := CacheConfig{
		MaxEntries: 3,
		TTL:        1 * time.Hour,
	}
	cache := NewEmbeddingCache(cfg)

	// Fill cache to capacity
	for i := 1; i <= 3; i++ {
		policyID := fmt.Sprintf("policy-%d", i)
		hash := fmt.Sprintf("hash-%d", i)
		embedding := []float32{float32(i)}

		err := cache.Put(policyID, hash, embedding)
		require.NoError(t, err)
	}

	stats := cache.Stats()
	assert.Equal(t, 3, stats.Entries)

	// Access policy-2 to make it recently used
	time.Sleep(10 * time.Millisecond)
	cache.Get("policy-2", "hash-2")

	// Add new entry (should evict LRU)
	time.Sleep(10 * time.Millisecond)
	err := cache.Put("policy-4", "hash-4", []float32{4.0})
	require.NoError(t, err)

	// policy-1 should be evicted (LRU)
	retrieved := cache.Get("policy-1", "hash-1")
	assert.Nil(t, retrieved, "LRU entry (policy-1) should be evicted")

	// policy-2 should still exist (recently accessed)
	retrieved = cache.Get("policy-2", "hash-2")
	assert.NotNil(t, retrieved, "recently accessed entry (policy-2) should exist")

	// policy-4 should exist (just added)
	retrieved = cache.Get("policy-4", "hash-4")
	assert.NotNil(t, retrieved, "newly added entry (policy-4) should exist")

	stats = cache.Stats()
	assert.Equal(t, 3, stats.Entries)
	assert.Equal(t, int64(1), stats.Evictions)
}

// TestEmbeddingCache_Delete verifies cache deletion
func TestEmbeddingCache_Delete(t *testing.T) {
	cache := NewEmbeddingCache(DefaultCacheConfig())

	policyID := "policy-123"
	policyHash := "hash-abc"
	embedding := []float32{0.1, 0.2, 0.3}

	// Store embedding
	err := cache.Put(policyID, policyHash, embedding)
	require.NoError(t, err)

	// Verify exists
	retrieved := cache.Get(policyID, policyHash)
	assert.NotNil(t, retrieved)

	// Delete
	cache.Delete(policyID)

	// Verify removed
	retrieved = cache.Get(policyID, policyHash)
	assert.Nil(t, retrieved)

	stats := cache.Stats()
	assert.Equal(t, 0, stats.Entries)
	assert.Equal(t, int64(1), stats.Evictions)
}

// TestEmbeddingCache_Clear verifies cache clearing
func TestEmbeddingCache_Clear(t *testing.T) {
	cache := NewEmbeddingCache(DefaultCacheConfig())

	// Add multiple entries
	for i := 1; i <= 5; i++ {
		policyID := fmt.Sprintf("policy-%d", i)
		hash := fmt.Sprintf("hash-%d", i)
		embedding := []float32{float32(i)}

		err := cache.Put(policyID, hash, embedding)
		require.NoError(t, err)
	}

	stats := cache.Stats()
	assert.Equal(t, 5, stats.Entries)

	// Clear cache
	cache.Clear()

	// Verify all entries removed
	stats = cache.Stats()
	assert.Equal(t, 0, stats.Entries)

	// Verify all entries are gone
	for i := 1; i <= 5; i++ {
		policyID := fmt.Sprintf("policy-%d", i)
		hash := fmt.Sprintf("hash-%d", i)
		retrieved := cache.Get(policyID, hash)
		assert.Nil(t, retrieved)
	}
}

// TestEmbeddingCache_ConcurrentAccess verifies thread safety
func TestEmbeddingCache_ConcurrentAccess(t *testing.T) {
	cache := NewEmbeddingCache(DefaultCacheConfig())

	const numGoroutines = 10
	const numOpsPerGoroutine = 100

	done := make(chan bool, numGoroutines*2)

	// Concurrent writers
	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			for j := 0; j < numOpsPerGoroutine; j++ {
				policyID := fmt.Sprintf("policy-%d-%d", id, j)
				hash := fmt.Sprintf("hash-%d", j)
				embedding := []float32{float32(id), float32(j)}

				cache.Put(policyID, hash, embedding)
			}
			done <- true
		}(i)
	}

	// Concurrent readers
	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			for j := 0; j < numOpsPerGoroutine; j++ {
				policyID := fmt.Sprintf("policy-%d-%d", id, j)
				hash := fmt.Sprintf("hash-%d", j)

				cache.Get(policyID, hash)
			}
			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < numGoroutines*2; i++ {
		<-done
	}

	// Verify no crashes and stats are reasonable
	stats := cache.Stats()
	assert.GreaterOrEqual(t, stats.Entries, 0, "entries should be non-negative")
	assert.GreaterOrEqual(t, stats.Hits, int64(0), "hits should be non-negative")
	assert.GreaterOrEqual(t, stats.Misses, int64(0), "misses should be non-negative")
}

// TestComputePolicyHash verifies policy hash computation
func TestComputePolicyHash(t *testing.T) {
	t.Run("deterministic hashing", func(t *testing.T) {
		text := "Policy: document-edit. Actions: view, edit. Roles: editor."

		hash1 := ComputePolicyHash(text)
		hash2 := ComputePolicyHash(text)

		assert.Equal(t, hash1, hash2, "same text should produce same hash")
		assert.NotEmpty(t, hash1)
		assert.Len(t, hash1, 64, "SHA-256 hash should be 64 hex characters")
	})

	t.Run("different text produces different hash", func(t *testing.T) {
		text1 := "Policy: document-edit. Actions: view, edit."
		text2 := "Policy: document-delete. Actions: delete."

		hash1 := ComputePolicyHash(text1)
		hash2 := ComputePolicyHash(text2)

		assert.NotEqual(t, hash1, hash2, "different text should produce different hash")
	})

	t.Run("empty text", func(t *testing.T) {
		hash := ComputePolicyHash("")
		assert.NotEmpty(t, hash)
		assert.Len(t, hash, 64)
	})
}

// TestCacheStats_String verifies stats formatting
func TestCacheStats_String(t *testing.T) {
	stats := CacheStats{
		Entries:      100,
		Hits:         80,
		Misses:       20,
		Evictions:    5,
		TotalEntries: 105,
		HitRate:      0.8,
		MaxEntries:   10000,
		TTL:          24 * time.Hour,
	}

	str := stats.String()
	assert.Contains(t, str, "100")     // entries
	assert.Contains(t, str, "80")      // hits
	assert.Contains(t, str, "20")      // misses
	assert.Contains(t, str, "5")       // evictions
	assert.Contains(t, str, "80.00%")  // hit rate
	assert.Contains(t, str, "24h")     // ttl
}

// TestEmbeddingCache_AccessCount verifies access tracking
func TestEmbeddingCache_AccessCount(t *testing.T) {
	cache := NewEmbeddingCache(DefaultCacheConfig())

	policyID := "policy-123"
	policyHash := "hash-abc"
	embedding := []float32{0.1, 0.2, 0.3}

	// Store embedding
	err := cache.Put(policyID, policyHash, embedding)
	require.NoError(t, err)

	// Access multiple times
	for i := 0; i < 5; i++ {
		retrieved := cache.Get(policyID, policyHash)
		assert.NotNil(t, retrieved)
	}

	// Verify access count incremented
	cache.mu.RLock()
	entry := cache.entries[policyID]
	cache.mu.RUnlock()

	assert.Equal(t, int64(5), entry.AccessCount)

	stats := cache.Stats()
	assert.Equal(t, int64(5), stats.Hits)
	assert.Equal(t, int64(0), stats.Misses)
}
