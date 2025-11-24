package cache

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

// TestNewRedisCache tests Redis cache creation
func TestNewRedisCache(t *testing.T) {
	tests := []struct {
		name    string
		config  *RedisConfig
		wantErr bool
	}{
		{
			name: "valid config with default values",
			config: &RedisConfig{
				Host:      "localhost",
				Port:      6379,
				Password:  "",
				DB:        0,
				PoolSize:  10,
				TTL:       5 * time.Minute,
				KeyPrefix: "test:",
			},
			wantErr: true, // Will fail if Redis not running
		},
		{
			name:    "nil config uses defaults",
			config:  nil,
			wantErr: true, // Will fail if Redis not running
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
			if (err != nil) != tt.wantErr {
				t.Errorf("NewRedisCache() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

// TestRedisCacheSetGet tests basic set/get operations
func TestRedisCacheSetGet(t *testing.T) {
	// Skip if Redis not available
	client := redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
	})
	if err := client.Ping(context.Background()).Err(); err != nil {
		t.Skip("Redis not available")
	}
	defer client.Close()

	config := &RedisConfig{
		Host:      "localhost",
		Port:      6379,
		Password:  "",
		DB:        1, // Use DB 1 for testing
		PoolSize:  10,
		TTL:       5 * time.Minute,
		KeyPrefix: "test:",
	}

	cache, err := NewRedisCache(config)
	if err != nil {
		t.Fatalf("failed to create cache: %v", err)
	}
	defer cache.Close()
	defer cache.Flush()

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
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Set value
			cache.Set(tt.key, tt.value)

			// Get value
			got, ok := cache.Get(tt.key)
			if !ok {
				t.Error("expected key to exist")
			}

			// For simple types, compare directly
			if got != tt.value {
				t.Errorf("expected %v, got %v", tt.value, got)
			}
		})
	}
}

// TestRedisCacheDelete tests delete operation
func TestRedisCacheDelete(t *testing.T) {
	client := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	if err := client.Ping(context.Background()).Err(); err != nil {
		t.Skip("Redis not available")
	}
	defer client.Close()

	config := &RedisConfig{
		Host:      "localhost",
		Port:      6379,
		DB:        1,
		PoolSize:  10,
		TTL:       5 * time.Minute,
		KeyPrefix: "test:",
	}

	cache, err := NewRedisCache(config)
	if err != nil {
		t.Fatalf("failed to create cache: %v", err)
	}
	defer cache.Close()
	defer cache.Flush()

	// Set a key
	cache.Set("testkey", "testvalue")

	// Verify it exists
	if _, ok := cache.Get("testkey"); !ok {
		t.Fatal("key should exist")
	}

	// Delete it
	cache.Delete("testkey")

	// Verify it's gone
	if _, ok := cache.Get("testkey"); ok {
		t.Fatal("key should not exist after delete")
	}
}

// TestRedisCacheClear tests clear operation
func TestRedisCacheClear(t *testing.T) {
	client := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	if err := client.Ping(context.Background()).Err(); err != nil {
		t.Skip("Redis not available")
	}
	defer client.Close()

	config := &RedisConfig{
		Host:      "localhost",
		Port:      6379,
		DB:        1,
		PoolSize:  10,
		TTL:       5 * time.Minute,
		KeyPrefix: "testclear:",
	}

	cache, err := NewRedisCache(config)
	if err != nil {
		t.Fatalf("failed to create cache: %v", err)
	}
	defer cache.Close()

	// Set multiple keys
	for i := 0; i < 5; i++ {
		key := fmt.Sprintf("key%d", i)
		cache.Set(key, fmt.Sprintf("value%d", i))
	}

	// Clear all
	cache.Clear()

	// Verify all are gone
	for i := 0; i < 5; i++ {
		key := fmt.Sprintf("key%d", i)
		if _, ok := cache.Get(key); ok {
			t.Errorf("key %s should not exist after clear", key)
		}
	}
}

// TestRedisCacheStats tests statistics tracking
func TestRedisCacheStats(t *testing.T) {
	client := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	if err := client.Ping(context.Background()).Err(); err != nil {
		t.Skip("Redis not available")
	}
	defer client.Close()

	config := &RedisConfig{
		Host:      "localhost",
		Port:      6379,
		DB:        1,
		PoolSize:  10,
		TTL:       5 * time.Minute,
		KeyPrefix: "teststats:",
	}

	cache, err := NewRedisCache(config)
	if err != nil {
		t.Fatalf("failed to create cache: %v", err)
	}
	defer cache.Close()
	defer cache.Flush()

	// Set and get
	cache.Set("key1", "value1")
	cache.Get("key1") // hit
	cache.Get("key2") // miss

	stats := cache.Stats()

	if stats.Hits != 1 {
		t.Errorf("expected 1 hit, got %d", stats.Hits)
	}
	if stats.Misses != 1 {
		t.Errorf("expected 1 miss, got %d", stats.Misses)
	}
	if stats.HitRate != 0.5 {
		t.Errorf("expected 0.5 hit rate, got %f", stats.HitRate)
	}
}

// TestRedisCacheKeyPrefix tests key prefixing
func TestRedisCacheKeyPrefix(t *testing.T) {
	client := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	if err := client.Ping(context.Background()).Err(); err != nil {
		t.Skip("Redis not available")
	}
	defer client.Close()

	config1 := &RedisConfig{
		Host:      "localhost",
		Port:      6379,
		DB:        1,
		PoolSize:  10,
		TTL:       5 * time.Minute,
		KeyPrefix: "app1:",
	}

	config2 := &RedisConfig{
		Host:      "localhost",
		Port:      6379,
		DB:        1,
		PoolSize:  10,
		TTL:       5 * time.Minute,
		KeyPrefix: "app2:",
	}

	cache1, _ := NewRedisCache(config1)
	cache2, _ := NewRedisCache(config2)
	defer cache1.Close()
	defer cache2.Close()
	defer client.FlushDB(context.Background())

	// Set same key in both caches with different prefixes
	cache1.Set("shared_key", "value1")
	cache2.Set("shared_key", "value2")

	// Verify isolation
	val1, _ := cache1.Get("shared_key")
	val2, _ := cache2.Get("shared_key")

	if val1 != "value1" {
		t.Errorf("cache1 got wrong value: %v", val1)
	}
	if val2 != "value2" {
		t.Errorf("cache2 got wrong value: %v", val2)
	}
}

// TestRedisCacheTTL tests TTL functionality
func TestRedisCacheTTL(t *testing.T) {
	client := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	if err := client.Ping(context.Background()).Err(); err != nil {
		t.Skip("Redis not available")
	}
	defer client.Close()

	config := &RedisConfig{
		Host:      "localhost",
		Port:      6379,
		DB:        1,
		PoolSize:  10,
		TTL:       1 * time.Second,
		KeyPrefix: "testttl:",
	}

	cache, err := NewRedisCache(config)
	if err != nil {
		t.Fatalf("failed to create cache: %v", err)
	}
	defer cache.Close()
	defer cache.Flush()

	// Set a key
	cache.Set("expiring", "value")

	// Get TTL
	ttl := cache.GetTTL("expiring")
	if ttl <= 0 {
		t.Errorf("expected positive TTL, got %v", ttl)
	}

	// Wait for expiration
	time.Sleep(1100 * time.Millisecond)

	// Try to get - should be gone
	if _, ok := cache.Get("expiring"); ok {
		t.Error("expected key to expire")
	}
}

// TestRedisCacheConcurrency tests concurrent operations
func TestRedisCacheConcurrency(t *testing.T) {
	client := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	if err := client.Ping(context.Background()).Err(); err != nil {
		t.Skip("Redis not available")
	}
	defer client.Close()

	config := &RedisConfig{
		Host:      "localhost",
		Port:      6379,
		DB:        1,
		PoolSize:  20,
		TTL:       5 * time.Minute,
		KeyPrefix: "testconcur:",
	}

	cache, err := NewRedisCache(config)
	if err != nil {
		t.Fatalf("failed to create cache: %v", err)
	}
	defer cache.Close()
	defer cache.Flush()

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
	if successCount < expectedSuccess {
		t.Errorf("expected %d successful operations, got %d", expectedSuccess, successCount)
	}
}

// TestHybridCache tests hybrid cache operations
func TestHybridCache(t *testing.T) {
	client := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	if err := client.Ping(context.Background()).Err(); err != nil {
		t.Skip("Redis not available")
	}
	defer client.Close()

	config := &HybridCacheConfig{
		L1Capacity: 100,
		L1TTL:      1 * time.Minute,
		L2Enabled:  true,
		L2Config: &RedisConfig{
			Host:      "localhost",
			Port:      6379,
			DB:        1,
			PoolSize:  10,
			TTL:       5 * time.Minute,
			KeyPrefix: "hybrid:",
		},
	}

	cache, err := NewHybridCache(config)
	if err != nil {
		t.Fatalf("failed to create hybrid cache: %v", err)
	}
	defer cache.Close()

	// Test write-through
	cache.Set("key1", "value1")

	// Get from L1
	val, ok := cache.Get("key1")
	if !ok || val != "value1" {
		t.Error("failed to get value from hybrid cache")
	}

	// Test promotion from L2
	// (In real scenario, L1 would be cleared, but we'll test stats)
	stats := cache.HybridStats()
	if stats["l2_enabled"] != true {
		t.Error("L2 should be enabled")
	}
}

// TestHybridCacheNoRedis tests hybrid cache fallback when Redis unavailable
func TestHybridCacheNoRedis(t *testing.T) {
	config := &HybridCacheConfig{
		L1Capacity: 100,
		L1TTL:      1 * time.Minute,
		L2Enabled:  true,
		L2Config: &RedisConfig{
			Host:      "localhost",
			Port:      9999, // Invalid port
			DB:        1,
			PoolSize:  10,
			TTL:       5 * time.Minute,
			KeyPrefix: "hybrid:",
		},
	}

	cache, err := NewHybridCache(config)
	if err != nil {
		t.Fatalf("hybrid cache should handle Redis failure: %v", err)
	}
	defer cache.Close()

	// Should still work with L1 only
	cache.Set("key1", "value1")
	val, ok := cache.Get("key1")
	if !ok || val != "value1" {
		t.Error("hybrid cache should fall back to L1 only")
	}

	stats := cache.HybridStats()
	if stats["l2_enabled"] != false {
		t.Error("L2 should be disabled when Redis unavailable")
	}
}

// BenchmarkRedisCacheGet benchmarks get operations
func BenchmarkRedisCacheGet(b *testing.B) {
	client := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	if err := client.Ping(context.Background()).Err(); err != nil {
		b.Skip("Redis not available")
	}
	defer client.Close()

	config := &RedisConfig{
		Host:      "localhost",
		Port:      6379,
		DB:        1,
		PoolSize:  20,
		TTL:       5 * time.Minute,
		KeyPrefix: "bench:",
	}

	cache, _ := NewRedisCache(config)
	defer cache.Close()
	defer cache.Flush()

	// Pre-populate
	cache.Set("benchkey", "benchvalue")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		cache.Get("benchkey")
	}
}

// BenchmarkRedisCacheSet benchmarks set operations
func BenchmarkRedisCacheSet(b *testing.B) {
	client := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	if err := client.Ping(context.Background()).Err(); err != nil {
		b.Skip("Redis not available")
	}
	defer client.Close()

	config := &RedisConfig{
		Host:      "localhost",
		Port:      6379,
		DB:        1,
		PoolSize:  20,
		TTL:       5 * time.Minute,
		KeyPrefix: "bench:",
	}

	cache, _ := NewRedisCache(config)
	defer cache.Close()
	defer cache.Flush()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		cache.Set(fmt.Sprintf("key_%d", i), "value")
	}
}

// BenchmarkHybridCacheGet benchmarks hybrid cache get operations
func BenchmarkHybridCacheGet(b *testing.B) {
	client := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	if err := client.Ping(context.Background()).Err(); err != nil {
		b.Skip("Redis not available")
	}
	defer client.Close()

	config := &HybridCacheConfig{
		L1Capacity: 1000,
		L1TTL:      1 * time.Minute,
		L2Enabled:  true,
		L2Config: &RedisConfig{
			Host:      "localhost",
			Port:      6379,
			DB:        1,
			PoolSize:  20,
			TTL:       5 * time.Minute,
			KeyPrefix: "bench:",
		},
	}

	cache, _ := NewHybridCache(config)
	defer cache.Close()

	cache.Set("benchkey", "benchvalue")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		cache.Get("benchkey")
	}
}
