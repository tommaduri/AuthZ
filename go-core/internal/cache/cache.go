// Package cache provides caching implementations for authorization decisions
package cache

import (
	"container/list"
	"sync"
	"sync/atomic"
	"time"
)

// Cache defines the cache interface
type Cache interface {
	Get(key string) (interface{}, bool)
	Set(key string, value interface{})
	Delete(key string)
	Clear()
	Stats() Stats
}

// Stats contains cache statistics
type Stats struct {
	Size    int
	Hits    uint64
	Misses  uint64
	HitRate float64
}

// LRU implements an LRU cache with TTL support
type LRU struct {
	capacity int
	ttl      time.Duration

	items map[string]*list.Element
	order *list.List
	mu    sync.RWMutex

	hits   uint64
	misses uint64
}

type cacheEntry struct {
	key       string
	value     interface{}
	expiresAt time.Time
}

// NewLRU creates a new LRU cache
func NewLRU(capacity int, ttl time.Duration) *LRU {
	return &LRU{
		capacity: capacity,
		ttl:      ttl,
		items:    make(map[string]*list.Element),
		order:    list.New(),
	}
}

// Get retrieves a value from the cache
func (c *LRU) Get(key string) (interface{}, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if elem, ok := c.items[key]; ok {
		entry := elem.Value.(*cacheEntry)

		// Check expiration
		if time.Now().After(entry.expiresAt) {
			c.removeElement(elem)
			atomic.AddUint64(&c.misses, 1)
			return nil, false
		}

		// Move to front (most recently used)
		c.order.MoveToFront(elem)
		atomic.AddUint64(&c.hits, 1)
		return entry.value, true
	}

	atomic.AddUint64(&c.misses, 1)
	return nil, false
}

// Set adds or updates a value in the cache
func (c *LRU) Set(key string, value interface{}) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Update existing entry
	if elem, ok := c.items[key]; ok {
		entry := elem.Value.(*cacheEntry)
		entry.value = value
		entry.expiresAt = time.Now().Add(c.ttl)
		c.order.MoveToFront(elem)
		return
	}

	// Evict if at capacity
	for c.order.Len() >= c.capacity {
		c.evictOldest()
	}

	// Add new entry
	entry := &cacheEntry{
		key:       key,
		value:     value,
		expiresAt: time.Now().Add(c.ttl),
	}
	elem := c.order.PushFront(entry)
	c.items[key] = elem
}

// Delete removes a key from the cache
func (c *LRU) Delete(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if elem, ok := c.items[key]; ok {
		c.removeElement(elem)
	}
}

// Clear removes all entries from the cache
func (c *LRU) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.items = make(map[string]*list.Element)
	c.order.Init()
}

// Stats returns cache statistics
func (c *LRU) Stats() Stats {
	c.mu.RLock()
	defer c.mu.RUnlock()

	hits := atomic.LoadUint64(&c.hits)
	misses := atomic.LoadUint64(&c.misses)
	total := hits + misses

	hitRate := float64(0)
	if total > 0 {
		hitRate = float64(hits) / float64(total)
	}

	return Stats{
		Size:    c.order.Len(),
		Hits:    hits,
		Misses:  misses,
		HitRate: hitRate,
	}
}

// removeElement removes an element from the cache
func (c *LRU) removeElement(elem *list.Element) {
	entry := elem.Value.(*cacheEntry)
	delete(c.items, entry.key)
	c.order.Remove(elem)
}

// evictOldest removes the oldest entry
func (c *LRU) evictOldest() {
	if elem := c.order.Back(); elem != nil {
		c.removeElement(elem)
	}
}

// Cleanup removes expired entries
func (c *LRU) Cleanup() int {
	c.mu.Lock()
	defer c.mu.Unlock()

	removed := 0
	now := time.Now()

	// Iterate from oldest to newest
	var next *list.Element
	for elem := c.order.Back(); elem != nil; elem = next {
		next = elem.Prev()
		entry := elem.Value.(*cacheEntry)
		if now.After(entry.expiresAt) {
			c.removeElement(elem)
			removed++
		}
	}

	return removed
}

// CacheType defines the type of cache to use
type CacheType string

const (
	// LRUCache uses only local LRU cache
	LRUCache CacheType = "lru"
	// RedisCache uses only Redis distributed cache
	RedisOnly CacheType = "redis"
	// HybridCache uses both LRU and Redis
	HybridCacheType CacheType = "hybrid"
)

// NewCache creates a cache based on the specified type and configuration
func NewCache(cacheType CacheType, config interface{}) (Cache, error) {
	switch cacheType {
	case LRUCache:
		cfg, ok := config.(map[string]interface{})
		if !ok {
			return NewLRU(10000, 5*time.Minute), nil
		}
		capacity := 10000
		ttl := 5 * time.Minute
		if c, ok := cfg["capacity"].(int); ok {
			capacity = c
		}
		if t, ok := cfg["ttl"].(time.Duration); ok {
			ttl = t
		}
		return NewLRU(capacity, ttl), nil

	case RedisOnly:
		redisCfg, ok := config.(*RedisConfig)
		if !ok {
			redisCfg = DefaultRedisConfig()
		}
		return NewRedisCache(redisCfg)

	case HybridCacheType:
		hybridCfg, ok := config.(*HybridCacheConfig)
		if !ok {
			hybridCfg = &HybridCacheConfig{
				L1Capacity: 10000,
				L1TTL:      1 * time.Minute,
				L2Enabled:  true,
				L2Config:   DefaultRedisConfig(),
			}
		}
		return NewHybridCache(hybridCfg)

	default:
		return NewLRU(10000, 5*time.Minute), nil
	}
}
