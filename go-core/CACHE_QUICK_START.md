# Redis Caching Quick Start Guide

## 5-Minute Setup

### 1. Start Redis with Docker Compose
```bash
cd /Users/tommaduri/Documents/GitHub/authz-engine/go-core

# Start all services including Redis
docker-compose up -d

# Verify Redis is running
docker-compose ps
# Should see 'authz-redis' with status 'healthy'
```

### 2. Use Hybrid Cache in Your Code
```go
package main

import (
    "github.com/authz-engine/go-core/internal/cache"
    "time"
)

func main() {
    // Create hybrid cache (L1 local + L2 Redis)
    hybridCache, err := cache.NewHybridCache(&cache.HybridCacheConfig{
        L1Capacity: 10000,
        L1TTL:      1 * time.Minute,
        L2Enabled:  true,
        L2Config: cache.DefaultRedisConfig(),
    })
    if err != nil {
        panic(err)
    }
    defer hybridCache.Close()

    // Use it
    hybridCache.Set("policy:123", policyData)
    policy, ok := hybridCache.Get("policy:123")
}
```

## Cache Type Selection

### LRU (Local Only) - Fast, Single-Instance
```go
cache := cache.NewLRU(10000, 5*time.Minute)
// Use when: Single server deployment, no cross-instance sharing needed
// Performance: ~1M ops/sec, <1μs latency
```

### Redis (Distributed) - Scalable, Cross-Instance
```go
config := &cache.RedisConfig{
    Host:      "redis",
    Port:      6379,
    TTL:       5*time.Minute,
    KeyPrefix: "authz:",
}
cache, _ := cache.NewRedisCache(config)
// Use when: Multiple servers, need shared cache
// Performance: ~100K ops/sec, 1-5ms latency
```

### Hybrid (L1+L2) - Best of Both - RECOMMENDED
```go
config := &cache.HybridCacheConfig{
    L1Capacity: 10000,
    L1TTL:      1*time.Minute,
    L2Enabled:  true,
    L2Config: cache.DefaultRedisConfig(),
}
cache, _ := cache.NewHybridCache(config)
// Use when: Want both speed and distribution
// Performance: L1 hits <1μs, L2 hits 1-5ms, auto-promotion
```

## Environment Variables

Set in docker-compose.yml or .env:

```bash
# Cache type: "lru", "redis", or "hybrid"
AUTHZ_CACHE_TYPE=hybrid

# L1 (Local) settings
AUTHZ_CACHE_L1_CAPACITY=10000
AUTHZ_CACHE_L1_TTL=1m

# L2 (Redis) settings
AUTHZ_REDIS_ENABLED=true
AUTHZ_REDIS_HOST=redis
AUTHZ_REDIS_PORT=6379
AUTHZ_REDIS_PASSWORD=
AUTHZ_REDIS_DB=0
AUTHZ_REDIS_POOL_SIZE=10
AUTHZ_REDIS_TTL=5m
AUTHZ_REDIS_KEY_PREFIX=authz:
AUTHZ_REDIS_READ_TIMEOUT=3s
AUTHZ_REDIS_WRITE_TIMEOUT=3s
```

## Common Tasks

### Check Cache Statistics
```go
stats := cache.Stats()
fmt.Printf("Size: %d, Hits: %d, Misses: %d\n",
    stats.Size, stats.Hits, stats.Misses)
fmt.Printf("Hit Rate: %.2f%%\n", stats.HitRate*100)
```

### Get Detailed Hybrid Stats
```go
hybridStats := hybridCache.HybridStats()
log.Printf("Overall: %+v", hybridStats["overall"])
log.Printf("L1: %+v", hybridStats["l1"])
log.Printf("L2: %+v", hybridStats["l2"])
```

### Cache Authorization Decision
```go
// Check if cached
key := fmt.Sprintf("decision:%s:%s:%s", userID, resource, action)
if decision, ok := cache.Get(key); ok {
    return decision.(bool), nil
}

// Compute decision
decision := evaluatePolicy(userID, resource, action)

// Cache it
cache.Set(key, decision)
```

### Invalidate Cache Entry
```go
key := fmt.Sprintf("policy:%s", policyID)
cache.Delete(key)
```

### Clear All Cache
```go
cache.Clear()
```

## Monitoring

### Check Redis Connection
```bash
# From host
redis-cli -h localhost ping
# Should print: PONG

# From container
docker exec authz-redis redis-cli ping
# Should print: PONG
```

### View Redis Stats
```bash
docker exec authz-redis redis-cli INFO stats
```

### Monitor Redis Memory
```bash
docker exec authz-redis redis-cli INFO memory
```

## Testing

### Run All Cache Tests
```bash
cd /Users/tommaduri/Documents/GitHub/authz-engine/go-core
go test ./internal/cache/... -v
```

### Run Specific Test
```bash
go test -run TestRedisCacheSetGet ./internal/cache/... -v
```

### Run with Coverage
```bash
go test ./internal/cache/... -cover
```

### Run Benchmarks
```bash
go test -bench=. ./internal/cache/... -benchmem
```

## Architecture

```
┌─────────────────────────────────┐
│   Application Layer             │
│  (AuthZ Decisions Cache)        │
└────────────┬────────────────────┘
             │
             ├─────────────────────────────┐
             │                             │
      ┌──────▼────────┐         ┌─────────▼─────┐
      │  L1 Cache     │         │  L2 Cache     │
      │  (Local LRU)  │         │  (Redis)      │
      │  <1μs latency │         │  1-5ms latency│
      │  10K entries  │         │  Distributed  │
      │  1m TTL       │         │  5m TTL       │
      │  Hot data     │         │  Shared state │
      └──────┬────────┘         └─────────┬─────┘
             │                           │
             │                    ┌──────▼─────────┐
             │                    │  Redis Server  │
             │                    │  Persistent    │
             │                    │  Replication   │
             │                    └────────────────┘
             │
      ┌──────▼──────────────────────┐
      │  Write-Through Strategy:     │
      │  - Set: L1 + L2             │
      │  - Get: L1, promote from L2 │
      │  - Delete: L1 + L2          │
      └──────────────────────────────┘
```

## Troubleshooting

### Redis Not Reachable
```bash
# Check if Redis container is running
docker ps | grep authz-redis

# Check Redis logs
docker logs authz-redis

# Restart Redis
docker-compose restart redis
```

### High Memory Usage
```go
// Monitor size
stats := cache.Stats()
if stats.Size > 100000 {
    log.Warn("Cache size exceeds threshold, consider clearing")
    cache.Clear()
}
```

### Low Hit Rate
```go
// Check hit rate
stats := cache.Stats()
if stats.HitRate < 0.5 {
    // TTL might be too short
    // or keys not properly structured
    log.Warnf("Low hit rate: %.2f%%", stats.HitRate*100)
}
```

### Connection Pool Exhausted
```go
// Increase pool size in config
config.PoolSize = 50  // Default is 10
```

## Next Steps

1. Read `CACHE_IMPLEMENTATION.md` for detailed documentation
2. Review `example_integration.go` for advanced usage patterns
3. Run tests: `go test ./internal/cache/... -v`
4. Integrate with authorization engine
5. Monitor cache hit rates in production
6. Adjust TTL based on policy update frequency

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| L1 Hit Latency | <1μs | Local memory access |
| L2 Hit Latency | 1-5ms | Network + Redis |
| Hit Rate | >80% | With proper TTL tuning |
| L1 Capacity | 10K-50K | Adjust for hot keys |
| L2 TTL | 5-30m | Based on policy freshness |
| Memory Usage | <256MB | Redis container limit |

## Files Reference

- **Core Implementation**: `/internal/cache/`
- **Tests**: `redis_test.go` (576 lines, comprehensive)
- **Examples**: `example_integration.go`
- **Documentation**: `CACHE_IMPLEMENTATION.md`
- **Configuration**: `docker-compose.yml`
- **Dependency**: `go.mod` (requires `github.com/redis/go-redis/v9`)

---

**Happy Caching! 🚀**
