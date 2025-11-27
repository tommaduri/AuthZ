package apikey

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// RateLimiter implements token bucket rate limiting using Redis
type RateLimiter struct {
	client     *redis.Client
	defaultRPS int // Default requests per second
}

// NewRateLimiter creates a new Redis-backed rate limiter
func NewRateLimiter(client *redis.Client, defaultRPS int) *RateLimiter {
	if defaultRPS <= 0 {
		defaultRPS = 100 // Default to 100 req/sec
	}

	return &RateLimiter{
		client:     client,
		defaultRPS: defaultRPS,
	}
}

// Allow checks if a request should be allowed based on rate limiting
// Uses token bucket algorithm with sliding window
func (r *RateLimiter) Allow(ctx context.Context, keyID string, limit int) (bool, error) {
	if limit <= 0 {
		limit = r.defaultRPS
	}

	// Redis key for this API key's rate limit
	redisKey := fmt.Sprintf("ratelimit:apikey:%s", keyID)

	// Current window (per second)
	now := time.Now()
	window := now.Unix()
	windowKey := fmt.Sprintf("%s:%d", redisKey, window)

	// Use Lua script for atomic operations
	script := redis.NewScript(`
		local key = KEYS[1]
		local limit = tonumber(ARGV[1])
		local window = tonumber(ARGV[2])
		local ttl = 2 -- 2 seconds TTL for cleanup

		local current = redis.call('GET', key)
		if current == false then
			current = 0
		else
			current = tonumber(current)
		end

		if current < limit then
			redis.call('INCR', key)
			redis.call('EXPIRE', key, ttl)
			return 1
		else
			return 0
		end
	`)

	result, err := script.Run(ctx, r.client, []string{windowKey}, limit, window).Result()
	if err != nil {
		return false, fmt.Errorf("run rate limit script: %w", err)
	}

	allowed, ok := result.(int64)
	if !ok {
		return false, fmt.Errorf("unexpected result type: %T", result)
	}

	return allowed == 1, nil
}

// GetCurrentCount returns the current request count for a key in the current window
func (r *RateLimiter) GetCurrentCount(ctx context.Context, keyID string) (int64, error) {
	redisKey := fmt.Sprintf("ratelimit:apikey:%s", keyID)
	window := time.Now().Unix()
	windowKey := fmt.Sprintf("%s:%d", redisKey, window)

	val, err := r.client.Get(ctx, windowKey).Result()
	if err != nil {
		if err == redis.Nil {
			return 0, nil
		}
		return 0, fmt.Errorf("get current count: %w", err)
	}

	count, err := strconv.ParseInt(val, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse count: %w", err)
	}

	return count, nil
}

// Reset resets the rate limit for a specific key
func (r *RateLimiter) Reset(ctx context.Context, keyID string) error {
	pattern := fmt.Sprintf("ratelimit:apikey:%s:*", keyID)

	var cursor uint64
	for {
		var keys []string
		var err error
		keys, cursor, err = r.client.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			return fmt.Errorf("scan keys: %w", err)
		}

		if len(keys) > 0 {
			if err := r.client.Del(ctx, keys...).Err(); err != nil {
				return fmt.Errorf("delete keys: %w", err)
			}
		}

		if cursor == 0 {
			break
		}
	}

	return nil
}

// Close closes the Redis client
func (r *RateLimiter) Close() error {
	return r.client.Close()
}
