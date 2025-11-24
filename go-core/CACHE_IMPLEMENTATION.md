# Redis Distributed Caching Implementation

## Overview

This implementation adds comprehensive Redis distributed caching to the AuthZ Engine's Go core with the following features:

- **Three caching strategies**: LRU (local), Redis (distributed), Hybrid (L1+L2)
- **Connection pooling** with configurable pool size
- **TTL support** with automatic expiration
- **Key prefix namespacing** for multi-tenant isolation
- **TLS support** for secure Redis connections
- **Sentinel/Cluster mode** support for high availability
- **Comprehensive error handling** with custom error types
- **Concurrent operation** safety with atomic statistics
- **Zero configuration** defaults for quick start

## Files Created

### Core Implementation

#### `/internal/cache/redis.go` (242 lines)
Implements the `RedisCache` struct with full Cache interface support:

- **RedisCache struct**: Manages Redis connection and caching operations
- **Connection management**: Supports standard, Sentinel, and Cluster modes
- **Serialization**: JSON serialization for arbitrary Go types
- **Statistics tracking**: Hit/miss counters with atomic operations
- **TTL management**: Automatic expiration via Redis
- **Key prefixing**: Namespace isolation with configurable prefix

**Key Methods:**
```go
Get(key string) (interface{}, bool)          // Retrieve with stats
Set(key string, value interface{})           // Store with TTL
Delete(key string)                           // Remove key
Clear()                                      // Clear all prefixed keys
Stats() Stats                                // Get cache statistics
Close() error                                // Graceful shutdown
Exists(key string) bool                      // Key existence check
GetTTL(key string) time.Duration            // Remaining TTL
```

#### `/internal/cache/redis_config.go` (78 lines)
Configuration struct with validation:

- **RedisConfig**: Host, port, password, pool settings, TLS, Sentinel/Cluster options
- **DefaultRedisConfig()**: Factory for sensible defaults
- **Validate()**: Configuration validation with clear error messages

**Supported Modes:**
- Standard Redis (default)
- Sentinel mode with master failover
- Cluster mode for horizontal scaling
- Optional TLS encryption

#### `/internal/cache/hybrid.go` (213 lines)
Advanced dual-tier caching strategy:

- **HybridCache**: Combines LRU (L1) + Redis (L2)
- **L1 Strategy**: Hot data with fast local access
- **L2 Strategy**: Distributed cache for scalability
- **Write-through**: All writes go to both L1 and L2
- **Promotion**: Reads from L2 are promoted to L1 for hot path acceleration
- **Graceful degradation**: Falls back to L1 if Redis unavailable

**Hybrid Statistics:**
```go
stats := cache.HybridStats()
// Returns detailed per-layer statistics:
// - overall: combined hit rate
// - l1: local cache metrics
// - l2: distributed cache metrics
```

#### `/internal/cache/errors.go` (58 lines)
Custom error types for cache operations:

- `CacheError`: Wrapped errors with error codes
- Error constructors: `ErrInvalidConfig`, `ErrConnectionFailed`, etc.
- Machine-readable error codes for error handling

#### `/internal/cache/cache.go` (240 lines - Updated)
Extended existing interface with factory pattern:

- **Cache interface**: Unified interface for all cache implementations
- **CacheType enum**: `LRUCache`, `RedisOnly`, `HybridCacheType`
- **NewCache()**: Factory function for cache creation
- **Stats struct**: Metrics for all cache types

### Tests

#### `/internal/cache/redis_test.go` (576 lines)
Comprehensive test suite:

**Unit Tests:**
- `TestNewRedisCache`: Configuration validation
- `TestRedisCacheSetGet`: Basic operations
- `TestRedisCacheDelete`: Key removal
- `TestRedisCacheClear`: Batch removal
- `TestRedisCacheStats`: Statistics tracking
- `TestRedisCacheKeyPrefix`: Namespace isolation
- `TestRedisCacheTTL`: Expiration handling
- `TestRedisCacheConcurrency`: Thread safety (10 goroutines × 100 ops)

**Integration Tests:**
- `TestHybridCache`: Dual-tier caching
- `TestHybridCacheNoRedis`: Graceful degradation

**Benchmarks:**
- `BenchmarkRedisCacheGet`: Single key retrieval
- `BenchmarkRedisCacheSet`: Key insertion
- `BenchmarkHybridCacheGet`: L1+L2 retrieval with promotion

**Running Tests:**
```bash
# All cache tests
go test ./internal/cache/...

# Specific test
go test -run TestRedisCacheSetGet ./internal/cache/...

# With benchmarks
go test -bench=BenchmarkRedisCache ./internal/cache/...

# With coverage
go test -cover ./internal/cache/...
```

### Configuration

#### `/docker-compose.yml` (Updated)
Enhanced Docker Compose configuration:

**New Redis Service:**
```yaml
redis:
  image: redis:7-alpine
  ports:
    - "6379:6379"
  command: redis-server --appendonly yes --maxmemory 256mb
  healthcheck: Enabled
  persistence: redis-data volume
```

**Updated AuthZ Server Environment:**
```yaml
AUTHZ_CACHE_TYPE=hybrid              # Cache strategy
AUTHZ_CACHE_L1_CAPACITY=10000       # Local cache size
AUTHZ_CACHE_L1_TTL=1m               # Local TTL
AUTHZ_REDIS_ENABLED=true            # Enable Redis
AUTHZ_REDIS_HOST=redis              # Service name
AUTHZ_REDIS_PORT=6379               # Default Redis port
AUTHZ_REDIS_POOL_SIZE=10            # Connection pool
AUTHZ_REDIS_TTL=5m                  # Distributed TTL
AUTHZ_REDIS_KEY_PREFIX=authz:       # Namespace
AUTHZ_REDIS_READ_TIMEOUT=3s         # Operation timeout
AUTHZ_REDIS_WRITE_TIMEOUT=3s        # Operation timeout
```

**Service Dependencies:**
- AuthZ server depends on Redis with health check
- Redis uses persistent volume
- Network isolation via authz-network

#### `/go.mod` (Updated)
Added dependency:
```
github.com/redis/go-redis/v9 v9.5.0
```

## Usage Examples

### LRU Cache (Local Only)
```go
import "github.com/authz-engine/go-core/internal/cache"

// Create cache
lruCache := cache.NewLRU(10000, 5*time.Minute)

// Use it
lruCache.Set("policy:123", policyData)
if value, ok := lruCache.Get("policy:123"); ok {
    // Use value
}

// Check stats
stats := lruCache.Stats()
log.Printf("Hit rate: %.2f%%", stats.HitRate*100)
```

### Redis Cache (Distributed)
```go
config := &cache.RedisConfig{
    Host:      "redis.example.com",
    Port:      6379,
    Password:  os.Getenv("REDIS_PASSWORD"),
    DB:        0,
    PoolSize:  20,
    TTL:       5 * time.Minute,
    KeyPrefix: "authz:",
}

redisCache, err := cache.NewRedisCache(config)
if err != nil {
    log.Fatalf("Failed to connect: %v", err)
}
defer redisCache.Close()

redisCache.Set("decision:user:123", decisionResult)
```

### Hybrid Cache (L1 + L2)
```go
config := &cache.HybridCacheConfig{
    L1Capacity: 10000,
    L1TTL:      1 * time.Minute,
    L2Enabled:  true,
    L2Config: &cache.RedisConfig{
        Host:      "redis",
        Port:      6379,
        TTL:       5 * time.Minute,
        KeyPrefix: "authz:",
    },
}

hybridCache, err := cache.NewHybridCache(config)
if err != nil {
    log.Fatalf("Failed to create cache: %v", err)
}

// Automatic write-through and L2 promotion
hybridCache.Set("policy:admin", adminPolicy)
policy, _ := hybridCache.Get("policy:admin") // Hits L1, promotes from L2
```

### Factory Pattern
```go
// Environment-based cache selection
var c cache.Cache
var err error

switch os.Getenv("CACHE_TYPE") {
case "redis":
    c, err = cache.NewCache(cache.RedisOnly, redisConfig)
case "hybrid":
    c, err = cache.NewCache(cache.HybridCacheType, hybridConfig)
default:
    c, err = cache.NewCache(cache.LRUCache, map[string]interface{}{
        "capacity": 10000,
        "ttl":      5 * time.Minute,
    })
}

if err != nil {
    log.Fatalf("Failed to create cache: %v", err)
}

// Use uniform interface
c.Set("key", value)
value, ok := c.Get("key")
```

### Multi-Tenant Isolation
```go
// Each tenant gets isolated cache with unique prefix
tenantCache := func(tenantID string) *cache.RedisCache {
    config := cache.DefaultRedisConfig()
    config.KeyPrefix = fmt.Sprintf("tenant:%s:", tenantID)

    cache, err := cache.NewRedisCache(config)
    if err != nil {
        log.Fatal(err)
    }
    return cache
}

acmeCache := tenantCache("acme-corp")
widgetCache := tenantCache("widget-inc")

// Data is completely isolated despite identical logical keys
acmeCache.Set("user:123", acmeUser)
widgetCache.Set("user:123", widgetUser)
```

## Configuration Best Practices

### Development
```go
config := &cache.HybridCacheConfig{
    L1Capacity: 1000,
    L1TTL:      1 * time.Minute,
    L2Enabled:  true,
    L2Config: cache.DefaultRedisConfig(),
}
```

### Production
```go
config := &cache.HybridCacheConfig{
    L1Capacity: 50000,
    L1TTL:      5 * time.Minute,
    L2Enabled:  true,
    L2Config: &cache.RedisConfig{
        Host:           "redis-primary.prod.example.com",
        Port:           6379,
        Password:       os.Getenv("REDIS_PASSWORD"), // Never hardcode
        DB:             0,
        PoolSize:       50,
        PoolTimeout:    5 * time.Second,
        IdleTimeout:    10 * time.Minute,
        TTL:            30 * time.Minute,
        KeyPrefix:      "authz:prod:",
        TLS:            &tls.Config{...},
        SentinelEnabled: true,
        SentinelMasters: []string{"redis-sentinel-1", "redis-sentinel-2"},
        ReadTimeout:    3 * time.Second,
        WriteTimeout:   3 * time.Second,
        DialTimeout:    5 * time.Second,
    },
}
```

### High Availability (Sentinel)
```go
config := &cache.RedisConfig{
    Host:            "redis-sentinel-1",
    Port:            26379,
    Password:        os.Getenv("REDIS_PASSWORD"),
    SentinelEnabled: true,
    SentinelMasters: []string{
        "redis-sentinel-1",
        "redis-sentinel-2",
        "redis-sentinel-3",
    },
    KeyPrefix: "authz:",
}
```

### Cluster Mode
```go
config := &cache.RedisConfig{
    Host:           "redis-cluster-node-1",
    Port:           6379,
    Password:       os.Getenv("REDIS_PASSWORD"),
    ClusterEnabled: true,
    PoolSize:       50,
    KeyPrefix:      "authz:",
}
```

## Performance Characteristics

### LRU Cache
- **Get/Set**: O(1) average case
- **Memory**: Bounded by capacity
- **Throughput**: ~1M ops/sec (single-threaded)

### Redis Cache
- **Network latency**: 1-5ms typical
- **Get/Set**: O(1) average case + network
- **Memory**: Distributed across cluster
- **Throughput**: ~100K ops/sec over network

### Hybrid Cache (L1 + L2)
- **L1 Hit**: < 1μs (local memory)
- **L2 Hit**: 1-5ms (network + Redis)
- **Cache promotion**: Automatic on L2 hits
- **Hit rate improvement**: 80-95% with proper TTL tuning

## Monitoring & Observability

### Statistics Access
```go
// Basic stats
stats := cache.Stats()
log.Printf("Cache size: %d", stats.Size)
log.Printf("Hits: %d, Misses: %d", stats.Hits, stats.Misses)
log.Printf("Hit rate: %.2f%%", stats.HitRate*100)

// Hybrid stats with per-layer metrics
hybridStats := hybridCache.HybridStats()
log.Printf("L1 hit rate: %.2f%%",
    hybridStats["l1"].(map[string]interface{})["hit_rate"].(float64)*100)
log.Printf("L2 hit rate: %.2f%%",
    hybridStats["l2"].(map[string]interface{})["hit_rate"].(float64)*100)
```

### Recommended Metrics to Expose
- Cache hit rate per layer
- Operations per second
- Cache size (items and bytes)
- Eviction rate (LRU only)
- TTL distribution
- Error rates

## Security Considerations

### Production Safety Checklist
- [ ] Never hardcode Redis password
- [ ] Use environment variables or secrets management
- [ ] Enable TLS for remote Redis connections
- [ ] Use Redis AUTH/ACL authentication
- [ ] Restrict network access to Redis port
- [ ] Use key prefixes for namespace isolation
- [ ] Regular backup of Redis AOF/RDB
- [ ] Monitor for unauthorized access
- [ ] Rotate credentials regularly
- [ ] Use VPC/network policies in Kubernetes

### Data Sensitivity
- Cache only non-sensitive authorization decisions
- Don't cache credentials or secrets
- Consider encryption for sensitive cached data
- Implement TTL appropriately for data freshness

## Troubleshooting

### Redis Connection Issues
```go
config := cache.DefaultRedisConfig()
config.DialTimeout = 10 * time.Second
config.ReadTimeout = 5 * time.Second
config.WriteTimeout = 5 * time.Second

// Test connection
cache, err := cache.NewRedisCache(config)
if err != nil {
    log.Printf("Connection error: %v", err)
    // Fall back to LRU only
}
```

### Memory Issues
```go
// Monitor cache size
stats := cache.Stats()
if stats.Size > 100000 {
    log.Warn("Cache size exceeds threshold")
}

// Clear old entries
cache.Clear() // For LRU or HybridCache
```

### Performance Issues
```go
// Increase pool size for concurrent access
config.PoolSize = 100

// Adjust TTL for hot data
config.TTL = 30 * time.Minute // Longer for stable data

// Monitor hit rate
stats := cache.Stats()
if stats.HitRate < 0.5 {
    log.Warn("Low cache hit rate, consider increasing TTL")
}
```

## Migration Guide

### From Existing LRU to Hybrid
1. Add Redis container to docker-compose.yml
2. Update environment variables to set CACHE_TYPE=hybrid
3. Set REDIS_* environment variables
4. Deploy with health checks enabled
5. Monitor hit rates to validate transition

### Rollback Strategy
1. Set CACHE_TYPE=lru to disable Redis
2. Hybrid cache automatically falls back to L1
3. No code changes required
4. Gradual transition possible via gradual traffic shift

## References

- Redis Go Client: https://github.com/redis/go-redis
- Redis Documentation: https://redis.io/docs
- Caching Strategies: https://en.wikipedia.org/wiki/Cache_(computing)
- AuthZ Decision Caching: Consider the freshness vs performance tradeoff
