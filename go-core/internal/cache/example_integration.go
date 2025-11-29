// Package cache provides caching implementations for authorization decisions
package cache

import (
	"log"
	"time"
)

// ExampleNewLRUCache demonstrates LRU cache usage
func ExampleNewLRUCache() {
	// Create an LRU cache with 10000 capacity and 5 minute TTL
	cache := NewLRU(10000, 5*time.Minute)
	defer cache.Clear()

	// Set a value
	cache.Set("user:123:permissions", "read,write,admin")

	// Get a value
	if value, ok := cache.Get("user:123:permissions"); ok {
		log.Printf("Retrieved: %v", value)
	}

	// Get statistics
	stats := cache.Stats()
	log.Printf("Cache stats - Size: %d, Hits: %d, Misses: %d, HitRate: %.2f%%",
		stats.Size, stats.Hits, stats.Misses, stats.HitRate*100)
}

// ExampleNewRedisCache demonstrates Redis cache usage
func ExampleNewRedisCache() {
	config := &RedisConfig{
		Host:      "localhost",
		Port:      6379,
		Password:  "",
		DB:        0,
		PoolSize:  10,
		TTL:       5 * time.Minute,
		KeyPrefix: "authz:",
	}

	cache, err := NewRedisCache(config)
	if err != nil {
		log.Fatalf("Failed to create Redis cache: %v", err)
	}
	defer cache.Close()

	// Set a value
	cache.Set("decision:user:123:resource:doc:456", map[string]interface{}{
		"allowed":  true,
		"reason":   "user has read permission",
		"cached_at": time.Now(),
	})

	// Get a value
	if value, ok := cache.Get("decision:user:123:resource:doc:456"); ok {
		log.Printf("Retrieved decision: %v", value)
	}

	// Delete a value
	cache.Delete("decision:user:123:resource:doc:456")

	// Get statistics
	stats := cache.Stats()
	log.Printf("Cache stats - Size: %d, Hits: %d, Misses: %d, HitRate: %.2f%%",
		stats.Size, stats.Hits, stats.Misses, stats.HitRate*100)
}

// ExampleNewHybridCache demonstrates hybrid cache usage with L1+L2
func ExampleNewHybridCache() {
	config := &HybridCacheConfig{
		L1Capacity: 10000,
		L1TTL:      1 * time.Minute,
		L2Enabled:  true,
		L2Config: &RedisConfig{
			Host:      "localhost",
			Port:      6379,
			Password:  "",
			DB:        0,
			PoolSize:  10,
			TTL:       5 * time.Minute,
			KeyPrefix: "authz:",
		},
	}

	cache, err := NewHybridCache(config)
	if err != nil {
		log.Fatalf("Failed to create hybrid cache: %v", err)
	}
	defer cache.Close()

	// Cache stores in both L1 (local) and L2 (Redis) with write-through strategy
	cache.Set("policy:user:admin", map[string]interface{}{
		"permissions": []string{"read", "write", "delete"},
		"role":        "admin",
	})

	// Get retrieves from L1 first, then L2, promoting hot data
	if value, ok := cache.Get("policy:user:admin"); ok {
		log.Printf("Retrieved policy: %v", value)
	}

	// Get detailed statistics
	stats := cache.HybridStats()
	log.Printf("Hybrid cache stats: %+v", stats)
}

// ExampleFactoryPattern demonstrates cache factory pattern
func ExampleFactoryPattern() {
	// Create LRU cache using factory
	lruCache, err := NewCache(LRUCache, map[string]interface{}{
		"capacity": 5000,
		"ttl":      3 * time.Minute,
	})
	if err != nil {
		log.Fatalf("Failed to create LRU cache: %v", err)
	}

	// Create Redis cache using factory
	redisCache, err := NewCache(RedisOnly, &RedisConfig{
		Host:      "localhost",
		Port:      6379,
		DB:        0,
		PoolSize:  10,
		TTL:       5 * time.Minute,
		KeyPrefix: "authz:",
	})
	if err != nil {
		log.Fatalf("Failed to create Redis cache: %v", err)
	}

	// Create hybrid cache using factory
	hybridCache, err := NewCache(HybridCacheType, &HybridCacheConfig{
		L1Capacity: 10000,
		L1TTL:      1 * time.Minute,
		L2Enabled:  true,
		L2Config: &RedisConfig{
			Host:      "localhost",
			Port:      6379,
			DB:        0,
			PoolSize:  10,
			TTL:       5 * time.Minute,
			KeyPrefix: "authz:",
		},
	})
	if err != nil {
		log.Fatalf("Failed to create hybrid cache: %v", err)
	}

	// Use any of them interchangeably via Cache interface
	lruCache.Set("key1", "value1")
	redisCache.Set("key2", "value2")
	hybridCache.Set("key3", "value3")

	log.Printf("All caches created successfully via factory pattern")
}

// ExampleMultiTenantIsolation demonstrates namespace isolation for multi-tenant
func ExampleMultiTenantIsolation() {
	// Create separate caches for different tenants
	tenant1Config := &RedisConfig{
		Host:      "localhost",
		Port:      6379,
		DB:        0,
		PoolSize:  10,
		TTL:       5 * time.Minute,
		KeyPrefix: "tenant:acme:",
	}

	tenant2Config := &RedisConfig{
		Host:      "localhost",
		Port:      6379,
		DB:        0,
		PoolSize:  10,
		TTL:       5 * time.Minute,
		KeyPrefix: "tenant:widget:",
	}

	tenant1Cache, _ := NewRedisCache(tenant1Config)
	tenant2Cache, _ := NewRedisCache(tenant2Config)
	defer tenant1Cache.Close()
	defer tenant2Cache.Close()

	// Each tenant's data is isolated by key prefix
	tenant1Cache.Set("user:123", map[string]string{"name": "Alice"})
	tenant2Cache.Set("user:123", map[string]string{"name": "Bob"})

	// Keys are completely isolated despite same logical key
	val1, _ := tenant1Cache.Get("user:123")
	val2, _ := tenant2Cache.Get("user:123")

	log.Printf("Tenant 1 user: %v", val1)
	log.Printf("Tenant 2 user: %v", val2)
	log.Printf("Multi-tenant isolation working correctly")
}
