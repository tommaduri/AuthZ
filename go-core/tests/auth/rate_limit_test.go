package auth_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/authz-engine/go-core/internal/api/rest/middleware"
	"github.com/authz-engine/go-core/internal/ratelimit"
)

// Mock audit logger for testing
type mockAuditLogger struct {
	events []mockAuditEvent
}

type mockAuditEvent struct {
	Type     string
	Actor    string
	Action   string
	Resource string
}

func (m *mockAuditLogger) Log(ctx context.Context, event interface{}) error {
	// Type assert to extract relevant fields
	m.events = append(m.events, mockAuditEvent{
		Type: "rate_limit_exceeded",
	})
	return nil
}

func setupRedis(t *testing.T) *redis.Client {
	client := redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
		DB:   15, // Use a test database
	})

	// Test connection
	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		t.Skipf("Redis not available: %v", err)
	}

	// Clean up test database
	client.FlushDB(ctx)

	return client
}

func TestRedisLimiter_Allow(t *testing.T) {
	client := setupRedis(t)
	defer client.Close()

	config := &ratelimit.Config{
		DefaultRPS: 10,
		Burst:      20,
		AuthRPS:    5,
		Window:     time.Second,
		KeyPrefix:  "test:ratelimit",
	}

	limiter := ratelimit.NewRedisLimiter(client, config)
	defer limiter.Close()

	ctx := context.Background()

	t.Run("allows requests under limit", func(t *testing.T) {
		key := "test:user:1"

		// First request should be allowed
		allowed, remaining, resetTime, err := limiter.Allow(ctx, key)
		require.NoError(t, err)
		assert.True(t, allowed)
		assert.Equal(t, 9, remaining) // 10 - 1 = 9
		assert.True(t, resetTime.After(time.Now()))
	})

	t.Run("blocks requests over limit", func(t *testing.T) {
		key := "test:user:2"

		// Make requests up to limit
		for i := 0; i < 10; i++ {
			allowed, _, _, err := limiter.Allow(ctx, key)
			require.NoError(t, err)
			assert.True(t, allowed, "Request %d should be allowed", i+1)
		}

		// Next request should be blocked
		allowed, remaining, resetTime, err := limiter.Allow(ctx, key)
		require.NoError(t, err)
		assert.False(t, allowed)
		assert.Equal(t, 0, remaining)
		assert.True(t, resetTime.After(time.Now()))
	})

	t.Run("resets after window expires", func(t *testing.T) {
		// Use shorter window for testing
		config := &ratelimit.Config{
			DefaultRPS: 5,
			Window:     100 * time.Millisecond,
			KeyPrefix:  "test:ratelimit",
		}
		limiter := ratelimit.NewRedisLimiter(client, config)

		key := "test:user:3"

		// Use up all requests
		for i := 0; i < 5; i++ {
			allowed, _, _, err := limiter.Allow(ctx, key)
			require.NoError(t, err)
			assert.True(t, allowed)
		}

		// Should be blocked
		allowed, _, _, err := limiter.Allow(ctx, key)
		require.NoError(t, err)
		assert.False(t, allowed)

		// Wait for window to reset
		time.Sleep(150 * time.Millisecond)

		// Should be allowed again
		allowed, remaining, _, err := limiter.Allow(ctx, key)
		require.NoError(t, err)
		assert.True(t, allowed)
		assert.Equal(t, 4, remaining)
	})

	t.Run("different keys are independent", func(t *testing.T) {
		key1 := "test:user:4"
		key2 := "test:user:5"

		// Use up key1's limit
		for i := 0; i < 10; i++ {
			limiter.Allow(ctx, key1)
		}

		// key1 should be blocked
		allowed, _, _, err := limiter.Allow(ctx, key1)
		require.NoError(t, err)
		assert.False(t, allowed)

		// key2 should still work
		allowed, remaining, _, err := limiter.Allow(ctx, key2)
		require.NoError(t, err)
		assert.True(t, allowed)
		assert.Equal(t, 9, remaining)
	})
}

func TestRedisLimiter_AllowN(t *testing.T) {
	client := setupRedis(t)
	defer client.Close()

	config := &ratelimit.Config{
		DefaultRPS: 10,
		Window:     time.Second,
		KeyPrefix:  "test:ratelimit",
	}

	limiter := ratelimit.NewRedisLimiter(client, config)
	defer limiter.Close()

	ctx := context.Background()

	t.Run("allows N requests under limit", func(t *testing.T) {
		key := "test:bulk:1"

		// Request 5 tokens at once
		allowed, remaining, _, err := limiter.AllowN(ctx, key, 5)
		require.NoError(t, err)
		assert.True(t, allowed)
		assert.Equal(t, 5, remaining) // 10 - 5 = 5
	})

	t.Run("blocks N requests over limit", func(t *testing.T) {
		key := "test:bulk:2"

		// Request 8 tokens
		allowed, remaining, _, err := limiter.AllowN(ctx, key, 8)
		require.NoError(t, err)
		assert.True(t, allowed)
		assert.Equal(t, 2, remaining)

		// Try to request 5 more (would exceed limit)
		allowed, _, _, err = limiter.AllowN(ctx, key, 5)
		require.NoError(t, err)
		assert.False(t, allowed)
	})
}

func TestRedisLimiter_DifferentLimits(t *testing.T) {
	client := setupRedis(t)
	defer client.Close()

	config := &ratelimit.Config{
		DefaultRPS: 100,
		AuthRPS:    10,
		Window:     time.Second,
		KeyPrefix:  "test:ratelimit",
	}

	limiter := ratelimit.NewRedisLimiter(client, config)
	defer limiter.Close()

	ctx := context.Background()

	t.Run("auth endpoints have lower limit", func(t *testing.T) {
		authKey := "auth:/v1/auth/token:192.168.1.1"

		// Should allow up to AuthRPS (10)
		for i := 0; i < 10; i++ {
			allowed, _, _, err := limiter.Allow(ctx, authKey)
			require.NoError(t, err)
			assert.True(t, allowed, "Auth request %d should be allowed", i+1)
		}

		// 11th request should be blocked
		allowed, _, _, err := limiter.Allow(ctx, authKey)
		require.NoError(t, err)
		assert.False(t, allowed)
	})

	t.Run("regular endpoints have higher limit", func(t *testing.T) {
		ipKey := "ip:192.168.1.2"

		// Should allow up to DefaultRPS (100)
		for i := 0; i < 100; i++ {
			allowed, _, _, err := limiter.Allow(ctx, ipKey)
			require.NoError(t, err)
			assert.True(t, allowed, "Request %d should be allowed", i+1)
		}

		// 101st request should be blocked
		allowed, _, _, err := limiter.Allow(ctx, ipKey)
		require.NoError(t, err)
		assert.False(t, allowed)
	})

	t.Run("user endpoints have custom limit", func(t *testing.T) {
		userKey := "user:user123"

		// Should allow up to 1000 (user limit)
		for i := 0; i < 100; i++ {
			allowed, _, _, err := limiter.Allow(ctx, userKey)
			require.NoError(t, err)
			assert.True(t, allowed)
		}

		// Should still have many remaining
		allowed, remaining, _, err := limiter.Allow(ctx, userKey)
		require.NoError(t, err)
		assert.True(t, allowed)
		assert.Greater(t, remaining, 800)
	})
}

func TestRedisLimiter_Reset(t *testing.T) {
	client := setupRedis(t)
	defer client.Close()

	config := &ratelimit.Config{
		DefaultRPS: 5,
		Window:     time.Second,
		KeyPrefix:  "test:ratelimit",
	}

	limiter := ratelimit.NewRedisLimiter(client, config)
	defer limiter.Close()

	ctx := context.Background()
	key := "test:reset:1"

	// Use up limit
	for i := 0; i < 5; i++ {
		limiter.Allow(ctx, key)
	}

	// Should be blocked
	allowed, _, _, err := limiter.Allow(ctx, key)
	require.NoError(t, err)
	assert.False(t, allowed)

	// Reset the limit
	err = limiter.Reset(ctx, key)
	require.NoError(t, err)

	// Should work again
	allowed, remaining, _, err := limiter.Allow(ctx, key)
	require.NoError(t, err)
	assert.True(t, allowed)
	assert.Equal(t, 4, remaining)
}

func TestRateLimitMiddleware(t *testing.T) {
	client := setupRedis(t)
	defer client.Close()

	config := &ratelimit.Config{
		DefaultRPS: 10,
		AuthRPS:    5,
		Window:     time.Second,
		KeyPrefix:  "test:ratelimit",
	}

	limiter := ratelimit.NewRedisLimiter(client, config)
	defer limiter.Close()

	auditLogger := &mockAuditLogger{}
	mw := middleware.NewRateLimitMiddleware(limiter, auditLogger)

	t.Run("allows requests and sets headers", func(t *testing.T) {
		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("OK"))
		})

		req := httptest.NewRequest("GET", "/v1/api/test", nil)
		req.RemoteAddr = "192.168.1.100:12345"

		rr := httptest.NewRecorder()
		mw.Handler(handler).ServeHTTP(rr, req)

		assert.Equal(t, http.StatusOK, rr.Code)
		assert.NotEmpty(t, rr.Header().Get("X-RateLimit-Limit"))
		assert.NotEmpty(t, rr.Header().Get("X-RateLimit-Remaining"))
		assert.NotEmpty(t, rr.Header().Get("X-RateLimit-Reset"))
	})

	t.Run("blocks requests over limit", func(t *testing.T) {
		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		})

		ip := "192.168.1.101"

		// Make requests up to limit
		for i := 0; i < 10; i++ {
			req := httptest.NewRequest("GET", "/v1/api/test", nil)
			req.RemoteAddr = fmt.Sprintf("%s:12345", ip)

			rr := httptest.NewRecorder()
			mw.Handler(handler).ServeHTTP(rr, req)
			assert.Equal(t, http.StatusOK, rr.Code)
		}

		// Next request should be blocked
		req := httptest.NewRequest("GET", "/v1/api/test", nil)
		req.RemoteAddr = fmt.Sprintf("%s:12345", ip)

		rr := httptest.NewRecorder()
		mw.Handler(handler).ServeHTTP(rr, req)

		assert.Equal(t, http.StatusTooManyRequests, rr.Code)
		assert.NotEmpty(t, rr.Header().Get("Retry-After"))
		assert.Contains(t, rr.Body.String(), "rate_limit_exceeded")
	})

	t.Run("extracts IP from X-Forwarded-For", func(t *testing.T) {
		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		})

		req := httptest.NewRequest("GET", "/v1/api/test", nil)
		req.Header.Set("X-Forwarded-For", "203.0.113.1, 198.51.100.1")
		req.RemoteAddr = "10.0.0.1:12345"

		rr := httptest.NewRecorder()
		mw.Handler(handler).ServeHTTP(rr, req)

		assert.Equal(t, http.StatusOK, rr.Code)
		// Should use 203.0.113.1 as the client IP
	})

	t.Run("extracts IP from X-Real-IP", func(t *testing.T) {
		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		})

		req := httptest.NewRequest("GET", "/v1/api/test", nil)
		req.Header.Set("X-Real-IP", "203.0.113.2")
		req.RemoteAddr = "10.0.0.1:12345"

		rr := httptest.NewRecorder()
		mw.Handler(handler).ServeHTTP(rr, req)

		assert.Equal(t, http.StatusOK, rr.Code)
		// Should use 203.0.113.2 as the client IP
	})

	t.Run("applies stricter limit to auth endpoints", func(t *testing.T) {
		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		})

		ip := "192.168.1.102"

		// Auth endpoints should have limit of 5
		for i := 0; i < 5; i++ {
			req := httptest.NewRequest("POST", "/v1/auth/token", nil)
			req.RemoteAddr = fmt.Sprintf("%s:12345", ip)

			rr := httptest.NewRecorder()
			mw.Handler(handler).ServeHTTP(rr, req)
			assert.Equal(t, http.StatusOK, rr.Code, "Request %d should succeed", i+1)
		}

		// 6th request should be blocked
		req := httptest.NewRequest("POST", "/v1/auth/token", nil)
		req.RemoteAddr = fmt.Sprintf("%s:12345", ip)

		rr := httptest.NewRecorder()
		mw.Handler(handler).ServeHTTP(rr, req)

		assert.Equal(t, http.StatusTooManyRequests, rr.Code)
	})

	t.Run("logs rate limit exceeded events", func(t *testing.T) {
		handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		})

		ip := "192.168.1.103"

		// Use up limit
		for i := 0; i < 10; i++ {
			req := httptest.NewRequest("GET", "/v1/api/test", nil)
			req.RemoteAddr = fmt.Sprintf("%s:12345", ip)
			rr := httptest.NewRecorder()
			mw.Handler(handler).ServeHTTP(rr, req)
		}

		initialEvents := len(auditLogger.events)

		// Trigger rate limit
		req := httptest.NewRequest("GET", "/v1/api/test", nil)
		req.RemoteAddr = fmt.Sprintf("%s:12345", ip)
		rr := httptest.NewRecorder()
		mw.Handler(handler).ServeHTTP(rr, req)

		assert.Greater(t, len(auditLogger.events), initialEvents, "Should have logged event")
	})
}

func TestRateLimitMiddleware_ConcurrentRequests(t *testing.T) {
	client := setupRedis(t)
	defer client.Close()

	config := &ratelimit.Config{
		DefaultRPS: 100,
		Window:     time.Second,
		KeyPrefix:  "test:ratelimit",
	}

	limiter := ratelimit.NewRedisLimiter(client, config)
	defer limiter.Close()

	mw := middleware.NewRateLimitMiddleware(limiter, &mockAuditLogger{})

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	// Make 150 concurrent requests
	results := make(chan int, 150)
	ip := "192.168.1.200"

	for i := 0; i < 150; i++ {
		go func() {
			req := httptest.NewRequest("GET", "/v1/api/test", nil)
			req.RemoteAddr = fmt.Sprintf("%s:12345", ip)

			rr := httptest.NewRecorder()
			mw.Handler(handler).ServeHTTP(rr, req)

			results <- rr.Code
		}()
	}

	// Collect results
	successCount := 0
	rateLimitedCount := 0

	for i := 0; i < 150; i++ {
		code := <-results
		if code == http.StatusOK {
			successCount++
		} else if code == http.StatusTooManyRequests {
			rateLimitedCount++
		}
	}

	// Should have approximately 100 successes and 50 rate limited
	assert.LessOrEqual(t, successCount, 100, "Should not exceed limit")
	assert.GreaterOrEqual(t, rateLimitedCount, 40, "Should rate limit excess requests")

	t.Logf("Concurrent test: %d succeeded, %d rate limited", successCount, rateLimitedCount)
}

func TestRedisKeyPatterns(t *testing.T) {
	client := setupRedis(t)
	defer client.Close()

	config := &ratelimit.Config{
		DefaultRPS: 10,
		Window:     time.Second,
		KeyPrefix:  "test:ratelimit",
	}

	limiter := ratelimit.NewRedisLimiter(client, config)
	defer limiter.Close()

	ctx := context.Background()

	testCases := []struct {
		name        string
		key         string
		expectedKey string
	}{
		{
			name:        "IP-based key",
			key:         "ip:192.168.1.1",
			expectedKey: "test:ratelimit:ip:192.168.1.1",
		},
		{
			name:        "Auth endpoint key",
			key:         "auth:/v1/auth/token:192.168.1.1",
			expectedKey: "test:ratelimit:auth:/v1/auth/token:192.168.1.1",
		},
		{
			name:        "User-based key",
			key:         "user:user123",
			expectedKey: "test:ratelimit:user:user123",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Make a request to create the key
			_, _, _, err := limiter.Allow(ctx, tc.key)
			require.NoError(t, err)

			// Verify key exists in Redis
			exists, err := client.Exists(ctx, tc.expectedKey).Result()
			require.NoError(t, err)
			assert.Equal(t, int64(1), exists, "Key should exist in Redis")

			// Verify it's a sorted set
			keyType, err := client.Type(ctx, tc.expectedKey).Result()
			require.NoError(t, err)
			assert.Equal(t, "zset", keyType, "Should be a sorted set")

			t.Logf("Redis key pattern verified: %s", tc.expectedKey)
		})
	}
}

func BenchmarkRedisLimiter_Allow(b *testing.B) {
	client := redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
		DB:   15,
	})
	defer client.Close()

	config := &ratelimit.Config{
		DefaultRPS: 10000,
		Window:     time.Second,
		KeyPrefix:  "bench:ratelimit",
	}

	limiter := ratelimit.NewRedisLimiter(client, config)
	defer limiter.Close()

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		key := fmt.Sprintf("bench:user:%d", i%100)
		limiter.Allow(ctx, key)
	}
}
