package cache

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

// setupMiniredisTest creates a test Redis cache with miniredis
func setupMiniredisTest(t *testing.T) (*RedisCache, *miniredis.Miniredis) {
	t.Helper()

	// Start miniredis server
	s := miniredis.RunT(t)

	// Ensure cleanup
	t.Cleanup(func() {
		s.Close()
	})

	// Create Redis config pointing to miniredis
	// Note: miniredis Port() returns string, need to parse
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
		PoolSize:     10,
		PoolTimeout:  5 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
		DialTimeout:  5 * time.Second,
		TTL:          5 * time.Minute,
		KeyPrefix:    "test:",
	}

	// Create Redis client directly to avoid SETINFO command issues with miniredis
	client := redis.NewClient(&redis.Options{
		Addr:         fmt.Sprintf("%s:%d", config.Host, config.Port),
		Password:     config.Password,
		DB:           config.DB,
		PoolSize:     config.PoolSize,
		PoolTimeout:  config.PoolTimeout,
		ReadTimeout:  config.ReadTimeout,
		WriteTimeout: config.WriteTimeout,
		DialTimeout:  config.DialTimeout,
		// Disable CLIENT SETINFO for miniredis compatibility
		DisableIndentity: true,
	})

	// Create context
	ctx, cancel := context.WithCancel(context.Background())

	// Create cache directly without NewRedisCache to avoid connection check
	cache := &RedisCache{
		client:     client,
		config:     config,
		serializer: &JSONSerializer{},
		ctx:        ctx,
		cancel:     cancel,
	}

	// Ensure cache cleanup
	t.Cleanup(func() {
		cache.Close()
	})

	return cache, s
}

// setupHybridCacheTest creates a test hybrid cache with miniredis
func setupHybridCacheTest(t *testing.T) (*HybridCache, *miniredis.Miniredis) {
	t.Helper()

	// Start miniredis server
	s := miniredis.RunT(t)

	// Ensure cleanup
	t.Cleanup(func() {
		s.Close()
	})

	// Create hybrid config with miniredis
	port := s.Port()
	portInt := 0
	if _, err := fmt.Sscanf(port, "%d", &portInt); err != nil {
		portInt = 6379 // fallback
	}

	config := &HybridCacheConfig{
		L1Capacity: 100,
		L1TTL:      1 * time.Minute,
		L2Enabled:  true,
		L2Config: &RedisConfig{
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
			KeyPrefix:    "hybrid:",
		},
	}

	// Create L1 cache
	l1Cache := NewLRU(config.L1Capacity, config.L1TTL)

	// Create L2 Redis client directly to avoid SETINFO command
	client2 := redis.NewClient(&redis.Options{
		Addr:             fmt.Sprintf("%s:%d", config.L2Config.Host, config.L2Config.Port),
		Password:         config.L2Config.Password,
		DB:               config.L2Config.DB,
		PoolSize:         config.L2Config.PoolSize,
		PoolTimeout:      config.L2Config.PoolTimeout,
		ReadTimeout:      config.L2Config.ReadTimeout,
		WriteTimeout:     config.L2Config.WriteTimeout,
		DialTimeout:      config.L2Config.DialTimeout,
		DisableIndentity: true,
	})

	ctx2, cancel2 := context.WithCancel(context.Background())
	l2Cache := &RedisCache{
		client:     client2,
		config:     config.L2Config,
		serializer: &JSONSerializer{},
		ctx:        ctx2,
		cancel:     cancel2,
	}

	// Create hybrid cache
	cache := &HybridCache{
		l1Local:   l1Cache,
		l2Redis:   l2Cache,
		l2Enabled: true,
	}

	// Ensure cache cleanup
	t.Cleanup(func() {
		cache.Close()
	})

	return cache, s
}

// setupRealRedisTest creates a test cache with real Redis (for integration tests)
// This should only be used in integration tests that explicitly require real Redis
func setupRealRedisTest(t *testing.T, keyPrefix string) *RedisCache {
	t.Helper()

	// Check if Redis is available
	client := redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		client.Close()
		t.Skip("Real Redis not available (this is fine for unit tests)")
	}
	client.Close()

	// Create config
	config := &RedisConfig{
		Host:         "localhost",
		Port:         6379,
		Password:     "",
		DB:           1, // Use DB 1 for testing to avoid production data
		PoolSize:     10,
		PoolTimeout:  5 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
		DialTimeout:  5 * time.Second,
		TTL:          5 * time.Minute,
		KeyPrefix:    keyPrefix,
	}

	// Create cache
	cache, err := NewRedisCache(config)
	require.NoError(t, err, "failed to create Redis cache")

	// Ensure cleanup
	t.Cleanup(func() {
		cache.Flush() // Clean up test data
		cache.Close()
	})

	return cache
}

// assertEqualValues compares two values for equality, handling special cases
func assertEqualValues(t *testing.T, expected, actual interface{}) {
	t.Helper()

	// Handle numeric types (JSON unmarshaling converts numbers to float64)
	switch e := expected.(type) {
	case int:
		// JSON unmarshals numbers as float64
		if f, ok := actual.(float64); ok {
			require.Equal(t, float64(e), f, "numeric values should match")
			return
		}
	case float64:
		if f, ok := actual.(float64); ok {
			require.InDelta(t, e, f, 0.0001, "float values should match")
			return
		}
	case bool:
		require.Equal(t, e, actual, "bool values should match")
		return
	case string:
		require.Equal(t, e, actual, "string values should match")
		return
	case map[string]interface{}:
		actualMap, ok := actual.(map[string]interface{})
		require.True(t, ok, "expected map type")
		require.Equal(t, len(e), len(actualMap), "map lengths should match")
		for k, v := range e {
			require.Contains(t, actualMap, k, "map should contain key")
			assertEqualValues(t, v, actualMap[k])
		}
		return
	}

	// Default comparison
	require.Equal(t, expected, actual, "values should match")
}
