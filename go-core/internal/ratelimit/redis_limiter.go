package ratelimit

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// RedisLimiter implements rate limiting using Redis with a token bucket algorithm
type RedisLimiter struct {
	client      *redis.Client
	config      *Config
	luaScriptSHA string
	tokenBucketScript *redis.Script
}

// NewRedisLimiter creates a new Redis-backed rate limiter
func NewRedisLimiter(client *redis.Client, config *Config) *RedisLimiter {
	if config == nil {
		config = DefaultConfig()
	}

	// Token bucket Lua script for atomic operations
	tokenBucketScript := redis.NewScript(`
		-- Token bucket rate limiter (executed atomically in Redis)
		-- KEYS[1] = rate limit key
		-- ARGV[1] = current time (float seconds)
		-- ARGV[2] = refill rate (tokens per second)
		-- ARGV[3] = capacity (max tokens)
		-- ARGV[4] = cost (tokens to consume, default 1)

		local key = KEYS[1]
		local now = tonumber(ARGV[1])
		local rate = tonumber(ARGV[2])
		local capacity = tonumber(ARGV[3])
		local cost = tonumber(ARGV[4]) or 1

		-- Get current state
		local tokens = tonumber(redis.call('HGET', key, 'tokens'))
		local last_refill = tonumber(redis.call('HGET', key, 'last_refill'))

		-- Initialize if doesn't exist
		if tokens == nil then
			tokens = capacity
			last_refill = now
		end

		-- Calculate tokens to add
		local elapsed = now - last_refill
		local added_tokens = elapsed * rate
		tokens = math.min(tokens + added_tokens, capacity)

		-- Check if enough tokens
		local allowed = tokens >= cost
		if allowed then
			tokens = tokens - cost
		end

		-- Update state
		redis.call('HSET', key, 'tokens', tokens)
		redis.call('HSET', key, 'last_refill', now)
		redis.call('EXPIRE', key, math.ceil(capacity / rate * 2))

		-- Calculate retry-after
		local retry_after = 0
		if not allowed then
			retry_after = (cost - tokens) / rate
		end

		-- Return: allowed, remaining, retry_after
		return {allowed and 1 or 0, math.floor(tokens), math.ceil(retry_after)}
	`)

	return &RedisLimiter{
		client: client,
		config: config,
		tokenBucketScript: tokenBucketScript,
	}
}

// Allow checks if a single request is allowed for the given key
func (rl *RedisLimiter) Allow(ctx context.Context, key string) (bool, int, time.Time, error) {
	return rl.AllowN(ctx, key, 1)
}

// AllowN checks if N requests are allowed using token bucket algorithm
func (rl *RedisLimiter) AllowN(ctx context.Context, key string, n int) (bool, int, time.Time, error) {
	now := time.Now()

	// Determine the limit (refill rate) based on the key type
	limit := rl.config.GetLimit(key)

	// Determine capacity (bucket size)
	// For token bucket: capacity should equal the burst allowance
	capacity := limit // Default: capacity = limit (no burst)

	// If BurstFactor is set, multiply limit by factor
	if rl.config.BurstFactor > 1 {
		capacity = limit * rl.config.BurstFactor
	}

	// If Burst is explicitly set and different from calculated, use explicit value
	// But only for keys that don't have specific limits (ip: and default keys)
	if rl.config.Burst > 0 && (len(key) < 3 || key[:3] == "ip:") {
		capacity = rl.config.Burst
	}

	// Redis key with prefix
	redisKey := fmt.Sprintf("%s:%s", rl.config.KeyPrefix, key)

	// Calculate refill rate (tokens per second)
	// Rate = limit / window (in seconds)
	windowSeconds := rl.config.Window.Seconds()
	if windowSeconds == 0 {
		windowSeconds = 1.0 // Default to 1 second
	}
	refillRate := float64(limit) / windowSeconds

	// Execute token bucket Lua script
	result, err := rl.tokenBucketScript.Run(
		ctx,
		rl.client,
		[]string{redisKey},
		float64(now.Unix()) + float64(now.Nanosecond())/1e9, // Current time in seconds with decimal
		refillRate,
		capacity,
		n, // Number of tokens to consume
	).Result()

	if err != nil {
		// Fail open if configured and Redis is unavailable
		if rl.config.FailOpen {
			return true, 0, now.Add(rl.config.Window), nil
		}
		return false, 0, time.Time{}, fmt.Errorf("rate limit check failed: %w", err)
	}

	// Parse result: {allowed, remaining, retry_after_seconds}
	resultSlice, ok := result.([]interface{})
	if !ok || len(resultSlice) != 3 {
		return false, 0, time.Time{}, fmt.Errorf("invalid script result")
	}

	allowed := resultSlice[0].(int64) == 1
	remaining := int(resultSlice[1].(int64))
	retryAfterSecs := resultSlice[2].(int64)

	// Calculate reset time
	resetTime := now.Add(time.Duration(retryAfterSecs) * time.Second)
	if retryAfterSecs == 0 {
		resetTime = now.Add(rl.config.Window)
	}

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

// getLimit determines the limit based on key type (deprecated, use config.GetLimit)
func (rl *RedisLimiter) getLimit(key string) int {
	return rl.config.GetLimit(key)
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
