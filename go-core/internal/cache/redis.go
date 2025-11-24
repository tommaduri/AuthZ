// Package cache provides caching implementations for authorization decisions
package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

// RedisCache implements Cache interface using Redis as a distributed cache
type RedisCache struct {
	client     redis.UniversalClient
	config     *RedisConfig
	mu         sync.RWMutex
	hits       uint64
	misses     uint64
	serializer Serializer
	ctx        context.Context
	cancel     context.CancelFunc
}

// Serializer defines how values are serialized/deserialized
type Serializer interface {
	Marshal(v interface{}) ([]byte, error)
	Unmarshal(data []byte, v interface{}) error
}

// JSONSerializer uses JSON for serialization
type JSONSerializer struct{}

func (s *JSONSerializer) Marshal(v interface{}) ([]byte, error) {
	return json.Marshal(v)
}

func (s *JSONSerializer) Unmarshal(data []byte, v interface{}) error {
	return json.Unmarshal(data, v)
}

// NewRedisCache creates a new Redis cache
func NewRedisCache(config *RedisConfig) (*RedisCache, error) {
	if config == nil {
		config = DefaultRedisConfig()
	}

	if err := config.Validate(); err != nil {
		return nil, err
	}

	ctx, cancel := context.WithCancel(context.Background())

	// Create Redis client
	var client redis.UniversalClient

	if config.ClusterEnabled {
		// Cluster mode
		client = redis.NewClusterClient(&redis.ClusterOptions{
			Addrs:        []string{net.JoinHostPort(config.Host, fmt.Sprintf("%d", config.Port))},
			Password:     config.Password,
			PoolSize:     config.PoolSize,
			ReadTimeout:  config.ReadTimeout,
			WriteTimeout: config.WriteTimeout,
			DialTimeout:  config.DialTimeout,
			TLSConfig:    config.TLS,
		})
	} else if config.SentinelEnabled && len(config.SentinelMasters) > 0 {
		// Sentinel mode
		sentinelAddrs := make([]string, len(config.SentinelMasters))
		for i, master := range config.SentinelMasters {
			sentinelAddrs[i] = fmt.Sprintf("%s:%d", master, config.Port)
		}
		client = redis.NewFailoverClient(&redis.FailoverOptions{
			SentinelAddrs: sentinelAddrs,
			MasterName:    "mymaster",
			Password:      config.Password,
			DB:            config.DB,
			PoolSize:      config.PoolSize,
			ReadTimeout:   config.ReadTimeout,
			WriteTimeout:  config.WriteTimeout,
			DialTimeout:   config.DialTimeout,
			TLSConfig:     config.TLS,
		})
	} else {
		// Standard mode
		client = redis.NewClient(&redis.Options{
			Addr:         net.JoinHostPort(config.Host, fmt.Sprintf("%d", config.Port)),
			Password:     config.Password,
			DB:           config.DB,
			PoolSize:     config.PoolSize,
			PoolTimeout:  config.PoolTimeout,
			IdleTimeout:  config.IdleTimeout,
			ReadTimeout:  config.ReadTimeout,
			WriteTimeout: config.WriteTimeout,
			DialTimeout:  config.DialTimeout,
			TLSConfig:    config.TLS,
		})
	}

	// Verify connection
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	if err := client.Ping(pingCtx).Err(); err != nil {
		cancel()
		client.Close()
		return nil, fmt.Errorf("failed to connect to Redis: %w", err)
	}
	cancel()

	rc := &RedisCache{
		client:     client,
		config:     config,
		serializer: &JSONSerializer{},
		ctx:        ctx,
		cancel:     cancel,
	}

	return rc, nil
}

// Get retrieves a value from the cache
func (c *RedisCache) Get(key string) (interface{}, bool) {
	prefixedKey := c.config.KeyPrefix + key

	data, err := c.client.Get(c.ctx, prefixedKey).Bytes()
	if err != nil {
		if err == redis.Nil {
			atomic.AddUint64(&c.misses, 1)
			return nil, false
		}
		// Log error but continue (cache miss)
		atomic.AddUint64(&c.misses, 1)
		return nil, false
	}

	// Deserialize the value
	var value interface{}
	if err := c.serializer.Unmarshal(data, &value); err != nil {
		atomic.AddUint64(&c.misses, 1)
		return nil, false
	}

	atomic.AddUint64(&c.hits, 1)
	return value, true
}

// Set adds or updates a value in the cache
func (c *RedisCache) Set(key string, value interface{}) {
	prefixedKey := c.config.KeyPrefix + key

	// Serialize the value
	data, err := c.serializer.Marshal(value)
	if err != nil {
		// Serialization failed, skip caching
		return
	}

	// Set in Redis with TTL
	err = c.client.Set(c.ctx, prefixedKey, data, c.config.TTL).Err()
	if err != nil {
		// Log error but continue (non-fatal)
	}
}

// Delete removes a key from the cache
func (c *RedisCache) Delete(key string) {
	prefixedKey := c.config.KeyPrefix + key
	c.client.Del(c.ctx, prefixedKey)
}

// Clear removes all entries matching the key prefix
func (c *RedisCache) Clear() {
	pattern := c.config.KeyPrefix + "*"
	iter := c.client.Scan(c.ctx, 0, pattern, 100).Iterator()

	var keys []string
	for iter.Next(c.ctx) {
		keys = append(keys, iter.Val())
	}

	if len(keys) > 0 {
		c.client.Del(c.ctx, keys...)
	}
}

// Stats returns cache statistics
func (c *RedisCache) Stats() Stats {
	hits := atomic.LoadUint64(&c.hits)
	misses := atomic.LoadUint64(&c.misses)
	total := hits + misses

	hitRate := float64(0)
	if total > 0 {
		hitRate = float64(hits) / float64(total)
	}

	// Get size info from Redis
	info := c.client.Info(c.ctx, "memory").Val()
	// Parse memory info if needed, for now return estimate
	size := 0
	if dbSize, err := c.client.DBSize(c.ctx).Result(); err == nil {
		size = int(dbSize)
	}

	return Stats{
		Size:    size,
		Hits:    hits,
		Misses:  misses,
		HitRate: hitRate,
	}
}

// Close closes the Redis connection
func (c *RedisCache) Close() error {
	c.cancel()
	return c.client.Close()
}

// Flush flushes all data from the database
func (c *RedisCache) Flush() error {
	return c.client.FlushDB(c.ctx).Err()
}

// Exists checks if a key exists
func (c *RedisCache) Exists(key string) bool {
	prefixedKey := c.config.KeyPrefix + key
	exists, err := c.client.Exists(c.ctx, prefixedKey).Result()
	return err == nil && exists > 0
}

// TTL returns the remaining TTL for a key
func (c *RedisCache) GetTTL(key string) time.Duration {
	prefixedKey := c.config.KeyPrefix + key
	ttl, err := c.client.TTL(c.ctx, prefixedKey).Result()
	if err != nil {
		return -1
	}
	return ttl
}
