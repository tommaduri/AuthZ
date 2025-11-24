// Package cache provides caching implementations for authorization decisions
package cache

import (
	"crypto/tls"
	"time"
)

// RedisConfig contains Redis connection configuration
type RedisConfig struct {
	// Connection settings
	Host     string
	Port     int
	Password string
	DB       int

	// Pool settings
	PoolSize    int
	PoolTimeout time.Duration
	IdleTimeout time.Duration

	// TTL for cached values
	TTL time.Duration

	// TLS configuration
	TLS *tls.Config

	// Sentinel/Cluster mode
	SentinelEnabled bool
	SentinelMasters []string
	ClusterEnabled  bool

	// Key prefix for namespacing
	KeyPrefix string

	// Read timeout for operations
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	DialTimeout  time.Duration
}

// DefaultRedisConfig returns a configuration with sensible defaults
func DefaultRedisConfig() *RedisConfig {
	return &RedisConfig{
		Host:         "localhost",
		Port:         6379,
		Password:     "",
		DB:           0,
		PoolSize:     10,
		PoolTimeout:  4 * time.Second,
		IdleTimeout:  5 * time.Minute,
		TTL:          5 * time.Minute,
		KeyPrefix:    "authz:",
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
		DialTimeout:  5 * time.Second,
		TLS:          nil,
		SentinelEnabled: false,
		ClusterEnabled:  false,
	}
}

// Validate checks the configuration for validity
func (c *RedisConfig) Validate() error {
	if c.Host == "" {
		return ErrInvalidConfig("host is required")
	}
	if c.Port <= 0 || c.Port > 65535 {
		return ErrInvalidConfig("port must be between 1 and 65535")
	}
	if c.PoolSize <= 0 {
		return ErrInvalidConfig("pool_size must be greater than 0")
	}
	if c.TTL <= 0 {
		return ErrInvalidConfig("ttl must be greater than 0")
	}
	return nil
}
