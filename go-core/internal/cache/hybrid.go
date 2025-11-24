// Package cache provides caching implementations for authorization decisions
package cache

import (
	"sync"
	"sync/atomic"
	"time"
)

// HybridCache combines local LRU cache (L1) and Redis (L2) for optimal performance
// L1 (local) is used for hot data with fast access
// L2 (Redis) is used for distributed cache with TTL support
type HybridCache struct {
	l1Local    *LRU
	l2Redis    *RedisCache
	mu         sync.RWMutex
	l2Enabled  bool
	hits       uint64
	misses     uint64
	l1Hits     uint64
	l2Hits     uint64
	l1Misses   uint64
	l2Misses   uint64
}

// HybridCacheConfig contains configuration for hybrid cache
type HybridCacheConfig struct {
	// L1 (Local) cache settings
	L1Capacity int
	L1TTL      time.Duration

	// L2 (Redis) cache settings
	L2Config *RedisConfig

	// If false, L2 is disabled and only L1 is used
	L2Enabled bool
}

// NewHybridCache creates a new hybrid cache with L1 (LRU) and L2 (Redis)
func NewHybridCache(config *HybridCacheConfig) (*HybridCache, error) {
	if config == nil {
		config = &HybridCacheConfig{
			L1Capacity: 10000,
			L1TTL:      1 * time.Minute,
			L2Enabled:  true,
			L2Config:   DefaultRedisConfig(),
		}
	}

	// Always create L1
	l1 := NewLRU(config.L1Capacity, config.L1TTL)

	// Create L2 if enabled
	var l2 *RedisCache
	if config.L2Enabled {
		var err error
		l2, err = NewRedisCache(config.L2Config)
		if err != nil {
			// If Redis fails, fall back to L1 only
			config.L2Enabled = false
		}
	}

	return &HybridCache{
		l1Local:   l1,
		l2Redis:   l2,
		l2Enabled: config.L2Enabled && l2 != nil,
	}, nil
}

// Get retrieves a value from the cache with write-through strategy
// First checks L1, then L2, promoting L1 hits for hot data
func (c *HybridCache) Get(key string) (interface{}, bool) {
	// Check L1 first
	if value, ok := c.l1Local.Get(key); ok {
		atomic.AddUint64(&c.hits, 1)
		atomic.AddUint64(&c.l1Hits, 1)
		return value, true
	}

	atomic.AddUint64(&c.l1Misses, 1)

	// Check L2 if enabled
	if c.l2Enabled && c.l2Redis != nil {
		if value, ok := c.l2Redis.Get(key); ok {
			// Promote to L1 for future fast access
			c.l1Local.Set(key, value)
			atomic.AddUint64(&c.hits, 1)
			atomic.AddUint64(&c.l2Hits, 1)
			return value, true
		}
		atomic.AddUint64(&c.l2Misses, 1)
	}

	atomic.AddUint64(&c.misses, 1)
	return nil, false
}

// Set adds or updates a value in both L1 and L2 (write-through strategy)
func (c *HybridCache) Set(key string, value interface{}) {
	// Always write to L1
	c.l1Local.Set(key, value)

	// Also write to L2 if enabled
	if c.l2Enabled && c.l2Redis != nil {
		c.l2Redis.Set(key, value)
	}
}

// Delete removes a key from both L1 and L2
func (c *HybridCache) Delete(key string) {
	c.l1Local.Delete(key)
	if c.l2Enabled && c.l2Redis != nil {
		c.l2Redis.Delete(key)
	}
}

// Clear removes all entries from both caches
func (c *HybridCache) Clear() {
	c.l1Local.Clear()
	if c.l2Enabled && c.l2Redis != nil {
		c.l2Redis.Clear()
	}
}

// Stats returns combined cache statistics
func (c *HybridCache) Stats() Stats {
	hits := atomic.LoadUint64(&c.hits)
	misses := atomic.LoadUint64(&c.misses)
	total := hits + misses

	hitRate := float64(0)
	if total > 0 {
		hitRate = float64(hits) / float64(total)
	}

	l1Stats := c.l1Local.Stats()
	var l2Size int
	if c.l2Enabled && c.l2Redis != nil {
		l2Stats := c.l2Redis.Stats()
		l2Size = l2Stats.Size
	}

	return Stats{
		Size:    l1Stats.Size + l2Size,
		Hits:    hits,
		Misses:  misses,
		HitRate: hitRate,
	}
}

// Close closes the hybrid cache and associated resources
func (c *HybridCache) Close() error {
	if c.l2Enabled && c.l2Redis != nil {
		return c.l2Redis.Close()
	}
	return nil
}

// HybridStats returns detailed statistics for both L1 and L2
func (c *HybridCache) HybridStats() map[string]interface{} {
	l1Stats := c.l1Local.Stats()
	l1Hits := atomic.LoadUint64(&c.l1Hits)
	l1Misses := atomic.LoadUint64(&c.l1Misses)

	stats := map[string]interface{}{
		"overall": Stats{
			Size:    l1Stats.Size,
			Hits:    atomic.LoadUint64(&c.hits),
			Misses:  atomic.LoadUint64(&c.misses),
			HitRate: l1Stats.HitRate,
		},
		"l1": map[string]interface{}{
			"size":     l1Stats.Size,
			"hits":     l1Hits,
			"misses":   l1Misses,
			"hit_rate": l1Stats.HitRate,
		},
	}

	if c.l2Enabled && c.l2Redis != nil {
		l2Stats := c.l2Redis.Stats()
		l2Hits := atomic.LoadUint64(&c.l2Hits)
		l2Misses := atomic.LoadUint64(&c.l2Misses)

		stats["l2"] = map[string]interface{}{
			"size":     l2Stats.Size,
			"hits":     l2Hits,
			"misses":   l2Misses,
			"hit_rate": l2Stats.HitRate,
		}
		stats["l2_enabled"] = true
	} else {
		stats["l2_enabled"] = false
	}

	return stats
}

// Exists checks if a key exists in L1 or L2
func (c *HybridCache) Exists(key string) bool {
	// Check L1
	if _, ok := c.l1Local.Get(key); ok {
		return true
	}

	// Check L2
	if c.l2Enabled && c.l2Redis != nil {
		return c.l2Redis.Exists(key)
	}

	return false
}
