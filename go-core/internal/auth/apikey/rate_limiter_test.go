package apikey

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// setupTestRedis sets up a Redis client for testing
// Skip tests if Redis is not available
func setupTestRedis(t *testing.T) *redis.Client {
	t.Helper()

	client := redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
		DB:   15, // Use separate test database
	})

	// Test connection
	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		t.Skipf("skipping redis tests: redis not available: %v", err)
	}

	// Clean up test keys
	client.FlushDB(ctx)

	return client
}

func TestRateLimiter_Allow(t *testing.T) {
	client := setupTestRedis(t)
	defer client.Close()

	ctx := context.Background()

	t.Run("allows requests under limit", func(t *testing.T) {
		limiter := NewRateLimiter(client, 100)
		keyID := "test-key-1"

		// First 10 requests should succeed
		for i := 0; i < 10; i++ {
			allowed, err := limiter.Allow(ctx, keyID, 10)
			require.NoError(t, err)
			assert.True(t, allowed, "request %d should be allowed", i+1)
		}

		// 11th request should be denied
		allowed, err := limiter.Allow(ctx, keyID, 10)
		require.NoError(t, err)
		assert.False(t, allowed, "request over limit should be denied")
	})

	t.Run("uses default limit when limit <= 0", func(t *testing.T) {
		limiter := NewRateLimiter(client, 5)
		keyID := "test-key-default"

		// Should use default limit of 5
		for i := 0; i < 5; i++ {
			allowed, err := limiter.Allow(ctx, keyID, 0) // Pass 0 to use default
			require.NoError(t, err)
			assert.True(t, allowed, "request %d should be allowed with default limit", i+1)
		}

		// 6th request should be denied
		allowed, err := limiter.Allow(ctx, keyID, 0)
		require.NoError(t, err)
		assert.False(t, allowed, "request over default limit should be denied")
	})

	t.Run("separate limits per key", func(t *testing.T) {
		limiter := NewRateLimiter(client, 100)
		keyID1 := "test-key-separate-1"
		keyID2 := "test-key-separate-2"

		// Use up limit for key1
		for i := 0; i < 5; i++ {
			allowed, err := limiter.Allow(ctx, keyID1, 5)
			require.NoError(t, err)
			assert.True(t, allowed)
		}

		// key1 should be limited
		allowed, err := limiter.Allow(ctx, keyID1, 5)
		require.NoError(t, err)
		assert.False(t, allowed, "key1 should be rate limited")

		// key2 should still be allowed
		allowed, err = limiter.Allow(ctx, keyID2, 5)
		require.NoError(t, err)
		assert.True(t, allowed, "key2 should not be affected by key1's limit")
	})

	t.Run("refills after time window", func(t *testing.T) {
		limiter := NewRateLimiter(client, 100)
		keyID := "test-key-refill"

		// Use up limit
		for i := 0; i < 3; i++ {
			allowed, err := limiter.Allow(ctx, keyID, 3)
			require.NoError(t, err)
			assert.True(t, allowed)
		}

		// Should be limited
		allowed, err := limiter.Allow(ctx, keyID, 3)
		require.NoError(t, err)
		assert.False(t, allowed)

		// Wait for next time window (per second)
		time.Sleep(1100 * time.Millisecond)

		// Should be allowed again (new window)
		allowed, err = limiter.Allow(ctx, keyID, 3)
		require.NoError(t, err)
		assert.True(t, allowed, "should be allowed in new time window")
	})

	t.Run("handles concurrent requests correctly", func(t *testing.T) {
		limiter := NewRateLimiter(client, 100)
		keyID := "test-key-concurrent"
		limit := 50

		var wg sync.WaitGroup
		allowedCount := int32(0)
		deniedCount := int32(0)
		var mu sync.Mutex

		// Make 100 concurrent requests
		for i := 0; i < 100; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				allowed, err := limiter.Allow(ctx, keyID, limit)
				require.NoError(t, err)

				mu.Lock()
				if allowed {
					allowedCount++
				} else {
					deniedCount++
				}
				mu.Unlock()
			}()
		}

		wg.Wait()

		// Should allow exactly 50 requests (the limit)
		assert.Equal(t, int32(limit), allowedCount, "should allow exactly the limit")
		assert.Equal(t, int32(100-limit), deniedCount, "should deny requests over limit")
	})
}

func TestRateLimiter_GetCurrentCount(t *testing.T) {
	client := setupTestRedis(t)
	defer client.Close()

	ctx := context.Background()

	t.Run("returns zero for unused key", func(t *testing.T) {
		limiter := NewRateLimiter(client, 100)
		count, err := limiter.GetCurrentCount(ctx, "unused-key")
		require.NoError(t, err)
		assert.Equal(t, int64(0), count)
	})

	t.Run("returns correct count after requests", func(t *testing.T) {
		limiter := NewRateLimiter(client, 100)
		keyID := "test-key-count"

		// Make 5 requests
		for i := 0; i < 5; i++ {
			_, err := limiter.Allow(ctx, keyID, 10)
			require.NoError(t, err)
		}

		count, err := limiter.GetCurrentCount(ctx, keyID)
		require.NoError(t, err)
		assert.Equal(t, int64(5), count)
	})

	t.Run("count resets in new window", func(t *testing.T) {
		limiter := NewRateLimiter(client, 100)
		keyID := "test-key-count-reset"

		// Make requests
		for i := 0; i < 3; i++ {
			_, err := limiter.Allow(ctx, keyID, 10)
			require.NoError(t, err)
		}

		count, err := limiter.GetCurrentCount(ctx, keyID)
		require.NoError(t, err)
		assert.Equal(t, int64(3), count)

		// Wait for new window
		time.Sleep(1100 * time.Millisecond)

		count, err = limiter.GetCurrentCount(ctx, keyID)
		require.NoError(t, err)
		assert.Equal(t, int64(0), count, "count should reset in new window")
	})
}

func TestRateLimiter_Reset(t *testing.T) {
	client := setupTestRedis(t)
	defer client.Close()

	ctx := context.Background()

	t.Run("resets rate limit for key", func(t *testing.T) {
		limiter := NewRateLimiter(client, 100)
		keyID := "test-key-reset"

		// Use up limit
		for i := 0; i < 5; i++ {
			allowed, err := limiter.Allow(ctx, keyID, 5)
			require.NoError(t, err)
			assert.True(t, allowed)
		}

		// Should be limited
		allowed, err := limiter.Allow(ctx, keyID, 5)
		require.NoError(t, err)
		assert.False(t, allowed)

		// Reset
		err = limiter.Reset(ctx, keyID)
		require.NoError(t, err)

		// Should be allowed again immediately
		allowed, err = limiter.Allow(ctx, keyID, 5)
		require.NoError(t, err)
		assert.True(t, allowed, "should be allowed after reset")
	})

	t.Run("reset non-existent key succeeds", func(t *testing.T) {
		limiter := NewRateLimiter(client, 100)
		err := limiter.Reset(ctx, "non-existent-key")
		require.NoError(t, err)
	})

	t.Run("reset clears all windows", func(t *testing.T) {
		limiter := NewRateLimiter(client, 100)
		keyID := "test-key-reset-all"

		// Make requests in multiple windows
		for i := 0; i < 2; i++ {
			limiter.Allow(ctx, keyID, 10)
		}

		time.Sleep(1100 * time.Millisecond)

		for i := 0; i < 2; i++ {
			limiter.Allow(ctx, keyID, 10)
		}

		// Reset should clear all
		err := limiter.Reset(ctx, keyID)
		require.NoError(t, err)

		// Count should be zero
		count, err := limiter.GetCurrentCount(ctx, keyID)
		require.NoError(t, err)
		assert.Equal(t, int64(0), count)
	})
}

func TestRateLimiter_EdgeCases(t *testing.T) {
	client := setupTestRedis(t)
	defer client.Close()

	ctx := context.Background()

	t.Run("handles very high limits", func(t *testing.T) {
		limiter := NewRateLimiter(client, 1000000)
		keyID := "test-key-high-limit"

		allowed, err := limiter.Allow(ctx, keyID, 1000000)
		require.NoError(t, err)
		assert.True(t, allowed)
	})

	t.Run("handles rapid successive calls", func(t *testing.T) {
		limiter := NewRateLimiter(client, 100)
		keyID := "test-key-rapid"

		// Make 100 rapid calls
		for i := 0; i < 100; i++ {
			limiter.Allow(ctx, keyID, 100)
		}

		count, err := limiter.GetCurrentCount(ctx, keyID)
		require.NoError(t, err)
		assert.Equal(t, int64(100), count)
	})

	t.Run("constructor sets default RPS when invalid", func(t *testing.T) {
		limiter := NewRateLimiter(client, 0)
		assert.Equal(t, 100, limiter.defaultRPS)

		limiter = NewRateLimiter(client, -5)
		assert.Equal(t, 100, limiter.defaultRPS)
	})
}

func TestRateLimiter_Close(t *testing.T) {
	client := setupTestRedis(t)

	limiter := NewRateLimiter(client, 100)
	err := limiter.Close()
	assert.NoError(t, err)
}

func BenchmarkRateLimiter_Allow(b *testing.B) {
	client := redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
		DB:   15,
	})
	defer client.Close()

	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		b.Skip("redis not available")
	}

	limiter := NewRateLimiter(client, 100)
	keyID := "bench-key"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		limiter.Allow(ctx, keyID, 10000) // High limit to avoid denials
	}
}

func BenchmarkRateLimiter_GetCurrentCount(b *testing.B) {
	client := redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
		DB:   15,
	})
	defer client.Close()

	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		b.Skip("redis not available")
	}

	limiter := NewRateLimiter(client, 100)
	keyID := "bench-count-key"

	// Make some requests first
	for i := 0; i < 5; i++ {
		limiter.Allow(ctx, keyID, 100)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		limiter.GetCurrentCount(ctx, keyID)
	}
}

func BenchmarkRateLimiter_Concurrent(b *testing.B) {
	client := redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
		DB:   15,
	})
	defer client.Close()

	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		b.Skip("redis not available")
	}

	limiter := NewRateLimiter(client, 100)

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		keyID := "bench-concurrent-key"
		for pb.Next() {
			limiter.Allow(ctx, keyID, 10000)
		}
	})
}
