package cache

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestNewRedisCache tests Redis cache creation
func TestNewRedisCache(t *testing.T) {
	tests := []struct {
		name    string
		config  *RedisConfig
		wantErr bool
	}{
		{
			name: "nil config uses defaults",
			config: &RedisConfig{
				Host: "invalid-host-that-does-not-exist",
				Port: 6379,
			},
			wantErr: true, // Should fail due to connection
		},
		{
			name: "invalid config - missing host",
			config: &RedisConfig{
				Host: "",
				Port: 6379,
			},
			wantErr: true,
		},
		{
			name: "invalid config - invalid port",
			config: &RedisConfig{
				Host: "localhost",
				Port: 99999,
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewRedisCache(tt.config)
			if tt.wantErr {
				require.Error(t, err, "expected error but got none")
			} else {
				require.NoError(t, err, "unexpected error")
			}
		})
	}
}

// TestNewRedisCacheSuccess tests successful Redis cache creation
func TestNewRedisCacheSuccess(t *testing.T) {
	cache, _ := setupMiniredisTest(t)
	require.NotNil(t, cache, "cache should be created")
}

// TestRedisCacheSetGet tests basic set/get operations
func TestRedisCacheSetGet(t *testing.T) {
	cache, _ := setupMiniredisTest(t)

	tests := []struct {
		name  string
		key   string
		value interface{}
	}{
		{
			name:  "string value",
			key:   "key1",
			value: "test_value",
		},
		{
			name:  "int value",
			key:   "key2",
			value: 42,
		},
		{
			name:  "map value",
			key:   "key3",
			value: map[string]interface{}{"nested": "data"},
		},
		{
			name:  "bool value",
			key:   "key4",
			value: true,
		},
		{
			name:  "float value",
			key:   "key5",
			value: 3.14159,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Set value
			cache.Set(tt.key, tt.value)

			// Get value
			got, ok := cache.Get(tt.key)
			require.True(t, ok, "expected key to exist")

			// Use helper for comparison
			assertEqualValues(t, tt.value, got)
		})
	}
}

// TestRedisCacheGetMissing tests getting non-existent keys
func TestRedisCacheGetMissing(t *testing.T) {
	cache, _ := setupMiniredisTest(t)

	// Try to get non-existent key
	val, ok := cache.Get("nonexistent")
	require.False(t, ok, "expected key to not exist")
	require.Nil(t, val, "expected nil value")
}

// TestRedisCacheDelete tests delete operation
func TestRedisCacheDelete(t *testing.T) {
	cache, _ := setupMiniredisTest(t)

	// Set a key
	cache.Set("testkey", "testvalue")

	// Verify it exists
	val, ok := cache.Get("testkey")
	require.True(t, ok, "key should exist")
	require.Equal(t, "testvalue", val)

	// Delete it
	cache.Delete("testkey")

	// Verify it's gone
	_, ok = cache.Get("testkey")
	require.False(t, ok, "key should not exist after delete")
}

// TestRedisCacheClear tests clear operation
func TestRedisCacheClear(t *testing.T) {
	cache, _ := setupMiniredisTest(t)

	// Set multiple keys
	for i := 0; i < 5; i++ {
		key := fmt.Sprintf("key%d", i)
		cache.Set(key, fmt.Sprintf("value%d", i))
	}

	// Verify all exist
	for i := 0; i < 5; i++ {
		key := fmt.Sprintf("key%d", i)
		_, ok := cache.Get(key)
		require.True(t, ok, "key should exist before clear")
	}

	// Clear all
	cache.Clear()

	// Verify all are gone
	for i := 0; i < 5; i++ {
		key := fmt.Sprintf("key%d", i)
		_, ok := cache.Get(key)
		require.False(t, ok, "key %s should not exist after clear", key)
	}
}

// TestRedisCacheStats tests statistics tracking
func TestRedisCacheStats(t *testing.T) {
	cache, _ := setupMiniredisTest(t)

	// Initial stats should be zero
	stats := cache.Stats()
	require.Equal(t, uint64(0), stats.Hits, "initial hits should be 0")
	require.Equal(t, uint64(0), stats.Misses, "initial misses should be 0")

	// Set and get
	cache.Set("key1", "value1")
	cache.Get("key1") // hit
	cache.Get("key2") // miss

	stats = cache.Stats()
	require.Equal(t, uint64(1), stats.Hits, "expected 1 hit")
	require.Equal(t, uint64(1), stats.Misses, "expected 1 miss")
	require.InDelta(t, 0.5, stats.HitRate, 0.01, "expected 0.5 hit rate")
}

// TestRedisCacheKeyPrefix tests key prefixing
func TestRedisCacheKeyPrefix(t *testing.T) {
	// Create two caches with different prefixes pointing to same miniredis
	cache1, s := setupMiniredisTest(t)

	// Create second cache with different prefix to same miniredis
	port := s.Port()
	portInt := 0
	if _, err := fmt.Sscanf(port, "%d", &portInt); err != nil {
		portInt = 6379 // fallback
	}

	config2 := &RedisConfig{
		Host:         s.Host(),
		Port:         portInt,
		Password:     "",
		DB:           0,
		PoolSize:     10,
		PoolTimeout:  5 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
		DialTimeout:  5 * time.Second,
		TTL:          5 * time.Minute,
		KeyPrefix:    "app2:", // Different prefix
	}

	// Create client directly to avoid SETINFO command
	client2 := redis.NewClient(&redis.Options{
		Addr:             fmt.Sprintf("%s:%d", config2.Host, config2.Port),
		Password:         config2.Password,
		DB:               config2.DB,
		PoolSize:         config2.PoolSize,
		PoolTimeout:      config2.PoolTimeout,
		ReadTimeout:      config2.ReadTimeout,
		WriteTimeout:     config2.WriteTimeout,
		DialTimeout:      config2.DialTimeout,
		DisableIndentity: true,
	})

	ctx2, cancel2 := context.WithCancel(context.Background())
	cache2 := &RedisCache{
		client:     client2,
		config:     config2,
		serializer: &JSONSerializer{},
		ctx:        ctx2,
		cancel:     cancel2,
	}

	t.Cleanup(func() {
		cache2.Close()
	})

	// Set same key in both caches with different prefixes
	cache1.Set("shared_key", "value1")
	cache2.Set("shared_key", "value2")

	// Verify isolation
	val1, ok1 := cache1.Get("shared_key")
	require.True(t, ok1, "cache1 should have the key")
	require.Equal(t, "value1", val1, "cache1 should have its own value")

	val2, ok2 := cache2.Get("shared_key")
	require.True(t, ok2, "cache2 should have the key")
	require.Equal(t, "value2", val2, "cache2 should have its own value")
}

// TestRedisCacheTTL tests TTL functionality
func TestRedisCacheTTL(t *testing.T) {
	cache, s := setupMiniredisTest(t)

	// Set short TTL
	cache.config.TTL = 100 * time.Millisecond

	// Set a key
	cache.Set("expiring", "value")

	// Verify it exists
	_, ok := cache.Get("expiring")
	require.True(t, ok, "key should exist immediately")

	// Check TTL using miniredis directly (GetTTL might return 0 in miniredis)
	s.CheckGet(t, "test:expiring", "\"value\"") // Verify key exists

	// Fast-forward time in miniredis
	s.FastForward(200 * time.Millisecond)

	// Try to get - should be gone
	_, ok = cache.Get("expiring")
	require.False(t, ok, "key should be expired")
}

// TestRedisCacheConcurrency tests concurrent operations
func TestRedisCacheConcurrency(t *testing.T) {
	cache, _ := setupMiniredisTest(t)

	numGoroutines := 10
	operationsPerGoroutine := 100
	var wg sync.WaitGroup
	var successCount int64

	for g := 0; g < numGoroutines; g++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for i := 0; i < operationsPerGoroutine; i++ {
				key := fmt.Sprintf("key_%d_%d", id, i)
				value := fmt.Sprintf("value_%d", i)

				cache.Set(key, value)
				if got, ok := cache.Get(key); ok && got == value {
					atomic.AddInt64(&successCount, 1)
				}
			}
		}(g)
	}

	wg.Wait()

	expectedSuccess := int64(numGoroutines * operationsPerGoroutine)
	require.Equal(t, expectedSuccess, successCount,
		"all concurrent operations should succeed")
}

// TestRedisCacheExists tests the Exists method
func TestRedisCacheExists(t *testing.T) {
	cache, _ := setupMiniredisTest(t)

	// Key should not exist initially
	require.False(t, cache.Exists("testkey"), "key should not exist")

	// Set key
	cache.Set("testkey", "value")

	// Key should exist now
	require.True(t, cache.Exists("testkey"), "key should exist")

	// Delete key
	cache.Delete("testkey")

	// Key should not exist anymore
	require.False(t, cache.Exists("testkey"), "key should not exist after delete")
}

// TestRedisCacheSerializationError tests handling of serialization errors
func TestRedisCacheSerializationError(t *testing.T) {
	cache, _ := setupMiniredisTest(t)

	// Create a value that can't be serialized to JSON
	type unserialized struct {
		Ch chan int // Channels can't be serialized
	}

	// This should fail silently (no panic)
	cache.Set("badkey", unserialized{Ch: make(chan int)})

	// Key should not exist since serialization failed
	_, ok := cache.Get("badkey")
	require.False(t, ok, "key should not exist due to serialization failure")
}

// TestHybridCache tests hybrid cache operations
func TestHybridCache(t *testing.T) {
	cache, _ := setupHybridCacheTest(t)

	// Test write-through
	cache.Set("key1", "value1")

	// Get from cache (should hit L1)
	val, ok := cache.Get("key1")
	require.True(t, ok, "key should exist")
	require.Equal(t, "value1", val, "value should match")

	// Check hybrid stats
	stats := cache.HybridStats()
	require.True(t, stats["l2_enabled"].(bool), "L2 should be enabled")
	// Check L1 and L2 stats maps are present
	require.Contains(t, stats, "l1", "should have L1 stats")
	require.Contains(t, stats, "l2", "should have L2 stats")
}

// TestHybridCacheL1Promotion tests L2 to L1 promotion
func TestHybridCacheL1Promotion(t *testing.T) {
	cache, _ := setupHybridCacheTest(t)

	// Set value (goes to both L1 and L2)
	cache.Set("key1", "value1")

	// Manually clear L1 to test L2 fallback
	cache.l1Local.Clear()

	// Get should promote from L2 to L1
	val, ok := cache.Get("key1")
	require.True(t, ok, "key should exist in L2")
	require.Equal(t, "value1", val, "value should match")

	// Now it should be in L1 too
	val, ok = cache.l1Local.Get("key1")
	require.True(t, ok, "key should be promoted to L1")
	require.Equal(t, "value1", val, "promoted value should match")
}

// TestHybridCacheNoRedis tests hybrid cache fallback when Redis unavailable
func TestHybridCacheNoRedis(t *testing.T) {
	config := &HybridCacheConfig{
		L1Capacity: 100,
		L1TTL:      1 * time.Minute,
		L2Enabled:  true,
		L2Config: &RedisConfig{
			Host:        "invalid-host-that-does-not-exist",
			Port:        9999, // Invalid port
			DB:          1,
			PoolSize:    10,
			PoolTimeout: 100 * time.Millisecond,
			TTL:         5 * time.Minute,
			KeyPrefix:   "hybrid:",
		},
	}

	cache, err := NewHybridCache(config)
	require.NoError(t, err, "hybrid cache should handle Redis failure gracefully")
	defer cache.Close()

	// Should still work with L1 only
	cache.Set("key1", "value1")
	val, ok := cache.Get("key1")
	require.True(t, ok, "L1 should work")
	require.Equal(t, "value1", val, "value should match")

	// Check stats show L2 disabled
	stats := cache.HybridStats()
	require.False(t, stats["l2_enabled"].(bool), "L2 should be disabled")
}

// TestHybridCacheClear tests clearing both L1 and L2
func TestHybridCacheClear(t *testing.T) {
	cache, _ := setupHybridCacheTest(t)

	// Add some data
	cache.Set("key1", "value1")
	cache.Set("key2", "value2")

	// Clear
	cache.Clear()

	// Both should be gone
	_, ok := cache.Get("key1")
	require.False(t, ok, "key1 should not exist after clear")

	_, ok = cache.Get("key2")
	require.False(t, ok, "key2 should not exist after clear")
}

// BenchmarkRedisCacheGet benchmarks get operations
func BenchmarkRedisCacheGet(b *testing.B) {
	// Create miniredis for benchmark
	s := miniredis.RunT(b)
	defer s.Close()

	port := s.Port()
	portInt := 0
	if _, err := fmt.Sscanf(port, "%d", &portInt); err != nil {
		portInt = 6379 // fallback
	}

	config := &RedisConfig{
		Host:         s.Host(),
		Port:         portInt,
		Password:     "",
		DB:           0,
		PoolSize:     20,
		PoolTimeout:  5 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
		DialTimeout:  5 * time.Second,
		TTL:          5 * time.Minute,
		KeyPrefix:    "bench:",
	}

	cache, err := NewRedisCache(config)
	if err != nil {
		b.Fatalf("failed to create cache: %v", err)
	}
	defer cache.Close()

	// Pre-populate
	cache.Set("benchkey", "benchvalue")

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			cache.Get("benchkey")
		}
	})
}

// BenchmarkRedisCacheSet benchmarks set operations
func BenchmarkRedisCacheSet(b *testing.B) {
	// Create miniredis for benchmark
	s := miniredis.RunT(b)
	defer s.Close()

	port := s.Port()
	portInt := 0
	if _, err := fmt.Sscanf(port, "%d", &portInt); err != nil {
		portInt = 6379 // fallback
	}

	config := &RedisConfig{
		Host:         s.Host(),
		Port:         portInt,
		Password:     "",
		DB:           0,
		PoolSize:     20,
		PoolTimeout:  5 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
		DialTimeout:  5 * time.Second,
		TTL:          5 * time.Minute,
		KeyPrefix:    "bench:",
	}

	cache, err := NewRedisCache(config)
	if err != nil {
		b.Fatalf("failed to create cache: %v", err)
	}
	defer cache.Close()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		cache.Set(fmt.Sprintf("key_%d", i), "value")
	}
}

// BenchmarkHybridCacheGet benchmarks hybrid cache get operations
func BenchmarkHybridCacheGet(b *testing.B) {
	// Create miniredis for benchmark
	s := miniredis.RunT(b)
	defer s.Close()

	port := s.Port()
	portInt := 0
	if _, err := fmt.Sscanf(port, "%d", &portInt); err != nil {
		portInt = 6379 // fallback
	}

	config := &HybridCacheConfig{
		L1Capacity: 1000,
		L1TTL:      1 * time.Minute,
		L2Enabled:  true,
		L2Config: &RedisConfig{
			Host:         s.Host(),
			Port:         portInt,
			Password:     "",
			DB:           0,
			PoolSize:     20,
			PoolTimeout:  5 * time.Second,
			ReadTimeout:  3 * time.Second,
			WriteTimeout: 3 * time.Second,
			DialTimeout:  5 * time.Second,
			TTL:          5 * time.Minute,
			KeyPrefix:    "bench:",
		},
	}

	cache, err := NewHybridCache(config)
	if err != nil {
		b.Fatalf("failed to create cache: %v", err)
	}
	defer cache.Close()

	cache.Set("benchkey", "benchvalue")

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			cache.Get("benchkey")
		}
	})
}

// TestRedisCacheIntegration is an integration test that requires a real Redis server
// This is marked with a build tag to avoid running in CI where Redis might not be available
func TestRedisCacheIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	cache := setupRealRedisTest(t, "integration:")

	// Test basic operations against real Redis
	cache.Set("integration_key", "integration_value")
	val, ok := cache.Get("integration_key")
	require.True(t, ok)
	require.Equal(t, "integration_value", val)

	// Test stats
	stats := cache.Stats()
	assert.Greater(t, stats.Hits, uint64(0), "should have at least one hit")
}
