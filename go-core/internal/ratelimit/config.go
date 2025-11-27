package ratelimit

import (
	"os"
	"strconv"
	"time"
)

// Config holds rate limiter configuration
type Config struct {
	// DefaultRPS is the default requests per second
	DefaultRPS int

	// Burst is the burst capacity (BurstFactor * DefaultRPS)
	Burst int

	// BurstFactor multiplier for burst capacity
	BurstFactor int

	// AuthRPS is the rate limit for auth endpoints
	AuthRPS int

	// AuthCheckRPS is the rate limit for authorization check endpoints
	AuthCheckRPS int

	// WindowSize is the time window for rate limiting
	WindowSize time.Duration

	// Window is an alias for WindowSize (for backward compatibility)
	Window time.Duration

	// KeyPrefix is the Redis key prefix
	KeyPrefix string

	// RedisAddr is the Redis server address
	RedisAddr string

	// RedisDB is the Redis database number
	RedisDB int

	// RedisPassword is the Redis password
	RedisPassword string

	// FailOpen determines if requests should be allowed when Redis is unavailable
	FailOpen bool
}

// DefaultConfig returns default rate limiter configuration
func DefaultConfig() *Config {
	return &Config{
		DefaultRPS:   100,
		BurstFactor:  2,
		Burst:        200,
		AuthRPS:      10,
		AuthCheckRPS: 100,
		WindowSize:   time.Second,
		Window:       time.Second,
		KeyPrefix:    "ratelimit",
		RedisAddr:    "localhost:6379",
		RedisDB:      0,
		FailOpen:     true, // Fail open by default for availability
	}
}

// LoadConfigFromEnv loads configuration from environment variables
func LoadConfigFromEnv() *Config {
	config := DefaultConfig()

	if v := os.Getenv("RATE_LIMIT_DEFAULT_RPS"); v != "" {
		if rps, err := strconv.Atoi(v); err == nil {
			config.DefaultRPS = rps
		}
	}

	if v := os.Getenv("RATE_LIMIT_BURST"); v != "" {
		if burst, err := strconv.Atoi(v); err == nil {
			config.Burst = burst
		}
	}

	if v := os.Getenv("RATE_LIMIT_BURST_FACTOR"); v != "" {
		if factor, err := strconv.Atoi(v); err == nil {
			config.BurstFactor = factor
			config.Burst = config.DefaultRPS * factor
		}
	}

	if v := os.Getenv("RATE_LIMIT_AUTH_RPS"); v != "" {
		if rps, err := strconv.Atoi(v); err == nil {
			config.AuthRPS = rps
		}
	}

	if v := os.Getenv("RATE_LIMIT_AUTH_CHECK_RPS"); v != "" {
		if rps, err := strconv.Atoi(v); err == nil {
			config.AuthCheckRPS = rps
		}
	}

	if v := os.Getenv("RATE_LIMIT_WINDOW"); v != "" {
		if duration, err := time.ParseDuration(v); err == nil {
			config.WindowSize = duration
			config.Window = duration
		}
	}

	if v := os.Getenv("REDIS_ADDR"); v != "" {
		config.RedisAddr = v
	}

	if v := os.Getenv("REDIS_DB"); v != "" {
		if db, err := strconv.Atoi(v); err == nil {
			config.RedisDB = db
		}
	}

	if v := os.Getenv("REDIS_PASSWORD"); v != "" {
		config.RedisPassword = v
	}

	if v := os.Getenv("RATE_LIMIT_FAIL_OPEN"); v != "" {
		config.FailOpen = v == "true" || v == "1"
	}

	// Ensure backward compatibility
	if config.Window == 0 {
		config.Window = config.WindowSize
	}
	if config.WindowSize == 0 {
		config.WindowSize = config.Window
	}

	return config
}

// GetLimit returns the appropriate rate limit for a given key type
func (c *Config) GetLimit(key string) int {
	// Auth endpoints have the strictest limits
	if len(key) >= 5 && key[:5] == "auth:" {
		// Check for specific auth/token endpoint (even stricter)
		if len(key) > 20 && key[5:20] == "/v1/auth/token:" {
			return 5 // 5 req/sec for token endpoint
		}
		return c.AuthRPS
	}

	// Authorization check endpoints have high throughput
	if len(key) >= 10 && key[:10] == "authcheck:" {
		return c.AuthCheckRPS
	}

	// User-specific limits (authenticated users)
	if len(key) >= 5 && key[:5] == "user:" {
		return 1000 // 1000 req/sec per user
	}

	// Default IP-based limit
	return c.DefaultRPS
}

// GetBurst returns the burst capacity for a given key type
func (c *Config) GetBurst(key string) int {
	// If Burst is explicitly set, use it
	if c.Burst > 0 {
		return c.Burst
	}
	// Otherwise calculate from BurstFactor
	limit := c.GetLimit(key)
	return limit * c.BurstFactor
}
