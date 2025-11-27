package ratelimit

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// RedisLimiter implements rate limiting using Redis with a sliding window algorithm
type RedisLimiter struct {
	client *redis.Client
	config *Config
}

// NewRedisLimiter creates a new Redis-backed rate limiter
func NewRedisLimiter(client *redis.Client, config *Config) *RedisLimiter {
	if config == nil {
		config = DefaultConfig()
	}
	return &RedisLimiter{
		client: client,
		config: config,
	}
}

// Allow checks if a single request is allowed for the given key
func (rl *RedisLimiter) Allow(ctx context.Context, key string) (bool, int, time.Time, error) {
	return rl.AllowN(ctx, key, 1)
}

// AllowN checks if N requests are allowed using sliding window algorithm
func (rl *RedisLimiter) AllowN(ctx context.Context, key string, n int) (bool, int, time.Time, error) {
	now := time.Now()
	windowStart := now.Add(-rl.config.Window)

	// Determine the limit based on the key type
	limit := rl.getLimit(key)

	// Redis key for the sorted set
	redisKey := fmt.Sprintf("%s:%s", rl.config.KeyPrefix, key)

	// Use Lua script for atomic operations
	script := redis.NewScript(`
		local key = KEYS[1]
		local now = tonumber(ARGV[1])
		local window_start = tonumber(ARGV[2])
		local limit = tonumber(ARGV[3])
		local n = tonumber(ARGV[4])
		local window_ms = tonumber(ARGV[5])

		-- Remove old entries outside the window
		redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

		-- Count current requests in window
		local current = redis.call('ZCARD', key)

		-- Check if we can allow N requests
		if current + n <= limit then
			-- Add N entries with unique scores
			for i = 1, n do
				local score = now + (i / 1000000)  -- Microsecond precision
				redis.call('ZADD', key, score, score)
			end

			-- Set expiration
			redis.call('PEXPIRE', key, window_ms)

			-- Return: allowed=1, remaining, reset_time
			return {1, limit - current - n, now + window_ms}
		else
			-- Return: allowed=0, remaining, reset_time
			-- Calculate reset time (when oldest entry expires)
			local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
			local reset_time = now + window_ms
			if #oldest >= 2 then
				reset_time = tonumber(oldest[2]) + window_ms
			end
			return {0, limit - current, reset_time}
		end
	`)

	windowMs := rl.config.Window.Milliseconds()
	result, err := script.Run(
		ctx,
		rl.client,
		[]string{redisKey},
		now.UnixMilli(),
		windowStart.UnixMilli(),
		limit,
		n,
		windowMs,
	).Result()

	if err != nil {
		return false, 0, time.Time{}, fmt.Errorf("rate limit check failed: %w", err)
	}

	// Parse result
	resultSlice, ok := result.([]interface{})
	if !ok || len(resultSlice) != 3 {
		return false, 0, time.Time{}, fmt.Errorf("invalid script result")
	}

	allowed := resultSlice[0].(int64) == 1
	remaining := int(resultSlice[1].(int64))
	resetTimeMs := resultSlice[2].(int64)
	resetTime := time.UnixMilli(resetTimeMs)

	return allowed, remaining, resetTime, nil
}

// Reset clears the rate limit for a key
func (rl *RedisLimiter) Reset(ctx context.Context, key string) error {
	redisKey := fmt.Sprintf("%s:%s", rl.config.KeyPrefix, key)
	return rl.client.Del(ctx, redisKey).Err()
}

// GetLimit returns the current limit for a key
func (rl *RedisLimiter) GetLimit(ctx context.Context, key string) (int, error) {
	return rl.getLimit(key), nil
}

// getLimit determines the limit based on key type
func (rl *RedisLimiter) getLimit(key string) int {
	// Check if this is an auth endpoint
	if len(key) > 5 && key[:5] == "auth:" {
		return rl.config.AuthRPS
	}
	// Check if this is a user-specific limit
	if len(key) > 5 && key[:5] == "user:" {
		return 1000 // Per-user limit
	}
	// Default IP-based limit
	return rl.config.DefaultRPS
}

// Close releases Redis client resources
func (rl *RedisLimiter) Close() error {
	if rl.client != nil {
		return rl.client.Close()
	}
	return nil
}

// GetStats returns current statistics for a key
func (rl *RedisLimiter) GetStats(ctx context.Context, key string) (current int, err error) {
	redisKey := fmt.Sprintf("%s:%s", rl.config.KeyPrefix, key)

	now := time.Now()
	windowStart := now.Add(-rl.config.Window)

	// Remove old entries
	if err := rl.client.ZRemRangeByScore(ctx, redisKey, "-inf", fmt.Sprintf("%d", windowStart.UnixMilli())).Err(); err != nil {
		return 0, err
	}

	// Count current entries
	count, err := rl.client.ZCard(ctx, redisKey).Result()
	if err != nil {
		return 0, err
	}

	return int(count), nil
}
