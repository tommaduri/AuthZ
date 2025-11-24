# Redis Cache - Code Snippets & Integration Examples

## File Locations

```
/Users/tommaduri/Documents/GitHub/authz-engine/go-core/
├── internal/cache/
│   ├── cache.go                    # Cache interface (existing, updated with factory)
│   ├── redis.go                    # Redis cache implementation (NEW)
│   ├── redis_config.go             # Redis configuration (NEW)
│   ├── hybrid.go                   # Hybrid L1+L2 cache (NEW)
│   ├── errors.go                   # Error types (NEW)
│   ├── redis_test.go               # Comprehensive tests (NEW)
│   └── example_integration.go      # Usage examples (NEW)
├── go.mod                          # Updated with redis dependency
├── docker-compose.yml              # Updated with Redis service
├── CACHE_IMPLEMENTATION.md         # Detailed documentation
├── CACHE_QUICK_START.md            # Quick start guide
└── REDIS_CACHE_SUMMARY.txt         # This summary
```

## Key Code Snippets

### 1. Creating Caches

#### LRU Cache (Local only)
```go
import "github.com/authz-engine/go-core/internal/cache"

// Simple local cache
lru := cache.NewLRU(10000, 5*time.Minute)

// Use it
lru.Set("key", "value")
if val, ok := lru.Get("key"); ok {
    // Use val
}

// Check stats
stats := lru.Stats()
fmt.Printf("Hit rate: %.2f%%\n", stats.HitRate*100)

// Cleanup
lru.Delete("key")
lru.Clear()
```

#### Redis Cache (Distributed)
```go
config := &cache.RedisConfig{
    Host:      "localhost",
    Port:      6379,
    Password:  os.Getenv("REDIS_PASSWORD"),
    DB:        0,
    PoolSize:  10,
    TTL:       5 * time.Minute,
    KeyPrefix: "authz:",
}

redis, err := cache.NewRedisCache(config)
if err != nil {
    log.Fatalf("Failed to connect to Redis: %v", err)
}
defer redis.Close()

// Use it
redis.Set("decision:123", decision)
if val, ok := redis.Get("decision:123"); ok {
    // Use val
}
```

#### Hybrid Cache (Local + Redis)
```go
config := &cache.HybridCacheConfig{
    L1Capacity: 10000,        // Local capacity
    L1TTL:      1 * time.Minute,
    L2Enabled:  true,         // Enable Redis
    L2Config: &cache.RedisConfig{
        Host:      "localhost",
        Port:      6379,
        DB:        0,
        PoolSize:  10,
        TTL:       5 * time.Minute,
        KeyPrefix: "authz:",
    },
}

hybrid, err := cache.NewHybridCache(config)
if err != nil {
    log.Fatalf("Failed to create hybrid cache: %v", err)
}
defer hybrid.Close()

// Automatic write-through to L1 and L2
hybrid.Set("policy:admin", adminPolicy)

// Automatic L2 promotion to L1
if policy, ok := hybrid.Get("policy:admin"); ok {
    // Use policy (likely from L1 after first L2 access)
}

// Get per-layer statistics
stats := hybrid.HybridStats()
log.Printf("L1 hit rate: %.2f%%", stats["l1"].(map[string]interface{})["hit_rate"].(float64)*100)
log.Printf("L2 hit rate: %.2f%%", stats["l2"].(map[string]interface{})["hit_rate"].(float64)*100)
```

### 2. Factory Pattern (Environment-based)

```go
// Create cache based on environment variable
func createCache() (cache.Cache, error) {
    cacheType := os.Getenv("AUTHZ_CACHE_TYPE") // "lru", "redis", or "hybrid"

    switch cacheType {
    case "redis":
        config := &cache.RedisConfig{
            Host:      os.Getenv("AUTHZ_REDIS_HOST"),
            Port:      parsePort(os.Getenv("AUTHZ_REDIS_PORT")),
            Password:  os.Getenv("AUTHZ_REDIS_PASSWORD"),
            DB:        parseInt(os.Getenv("AUTHZ_REDIS_DB"), 0),
            PoolSize:  parseInt(os.Getenv("AUTHZ_REDIS_POOL_SIZE"), 10),
            TTL:       parseDuration(os.Getenv("AUTHZ_REDIS_TTL"), 5*time.Minute),
            KeyPrefix: os.Getenv("AUTHZ_REDIS_KEY_PREFIX"),
        }
        return cache.NewCache(cache.RedisOnly, config)

    case "hybrid":
        config := &cache.HybridCacheConfig{
            L1Capacity: parseInt(os.Getenv("AUTHZ_CACHE_L1_CAPACITY"), 10000),
            L1TTL:      parseDuration(os.Getenv("AUTHZ_CACHE_L1_TTL"), 1*time.Minute),
            L2Enabled:  true,
            L2Config: &cache.RedisConfig{
                Host:      os.Getenv("AUTHZ_REDIS_HOST"),
                Port:      parsePort(os.Getenv("AUTHZ_REDIS_PORT")),
                Password:  os.Getenv("AUTHZ_REDIS_PASSWORD"),
                TTL:       parseDuration(os.Getenv("AUTHZ_REDIS_TTL"), 5*time.Minute),
                KeyPrefix: os.Getenv("AUTHZ_REDIS_KEY_PREFIX"),
            },
        }
        return cache.NewCache(cache.HybridCacheType, config)

    default: // LRU
        return cache.NewCache(cache.LRUCache, map[string]interface{}{
            "capacity": parseInt(os.Getenv("AUTHZ_CACHE_SIZE"), 10000),
            "ttl":      parseDuration(os.Getenv("AUTHZ_CACHE_TTL"), 5*time.Minute),
        }), nil
    }
}
```

### 3. Authorization Decision Caching

```go
type AuthzCache struct {
    cache cache.Cache
}

func (ac *AuthzCache) GetDecision(userID, resource, action string) (bool, error) {
    // Create cache key
    key := fmt.Sprintf("decision:%s:%s:%s", userID, resource, action)

    // Check cache
    if cached, ok := ac.cache.Get(key); ok {
        return cached.(bool), nil
    }

    // Compute decision (expensive operation)
    decision, err := ac.evaluatePolicy(userID, resource, action)
    if err != nil {
        return false, err
    }

    // Cache the result
    ac.cache.Set(key, decision)

    return decision, nil
}

func (ac *AuthzCache) InvalidateDecision(userID, resource, action string) {
    key := fmt.Sprintf("decision:%s:%s:%s", userID, resource, action)
    ac.cache.Delete(key)
}

func (ac *AuthzCache) InvalidateUserDecisions(userID string) {
    // For bulk invalidation, consider deleting by prefix
    // This would require additional helper methods
}
```

### 4. Policy Caching

```go
type PolicyCache struct {
    cache cache.Cache
}

func (pc *PolicyCache) GetPolicy(policyID string) (*Policy, error) {
    key := fmt.Sprintf("policy:%s", policyID)

    // Try cache first
    if cached, ok := pc.cache.Get(key); ok {
        return cached.(*Policy), nil
    }

    // Load from storage
    policy, err := pc.loadPolicyFromStorage(policyID)
    if err != nil {
        return nil, err
    }

    // Cache it
    pc.cache.Set(key, policy)

    return policy, nil
}

func (pc *PolicyCache) UpdatePolicy(policy *Policy) error {
    // Update in storage
    if err := pc.savePolicy(policy); err != nil {
        return err
    }

    // Invalidate cache
    key := fmt.Sprintf("policy:%s", policy.ID)
    pc.cache.Delete(key)

    return nil
}

func (pc *PolicyCache) GetStats() cache.Stats {
    return pc.cache.Stats()
}
```

### 5. Multi-Tenant Cache

```go
type TenantCache struct {
    baseCache cache.Cache
    tenantID  string
}

func NewTenantCache(baseCache cache.Cache, tenantID string) *TenantCache {
    return &TenantCache{
        baseCache: baseCache,
        tenantID:  tenantID,
    }
}

func (tc *TenantCache) Get(key string) (interface{}, bool) {
    // Add tenant prefix to isolate data
    prefixedKey := fmt.Sprintf("tenant:%s:%s", tc.tenantID, key)
    return tc.baseCache.Get(prefixedKey)
}

func (tc *TenantCache) Set(key string, value interface{}) {
    prefixedKey := fmt.Sprintf("tenant:%s:%s", tc.tenantID, key)
    tc.baseCache.Set(prefixedKey, value)
}

func (tc *TenantCache) Delete(key string) {
    prefixedKey := fmt.Sprintf("tenant:%s:%s", tc.tenantID, key)
    tc.baseCache.Delete(prefixedKey)
}

// Usage:
// acmeCache := NewTenantCache(baseCache, "acme-corp")
// widgetCache := NewTenantCache(baseCache, "widget-inc")
// Data is completely isolated despite sharing same Redis instance
```

### 6. Cache with Error Handling

```go
func (ac *AuthzCache) SafeGet(key string) (interface{}, error) {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("Cache get panic: %v", r)
        }
    }()

    value, ok := ac.cache.Get(key)
    if !ok {
        return nil, cache.ErrInvalidConfig("key not found")
    }
    return value, nil
}

func (ac *AuthzCache) SafeSet(key string, value interface{}) error {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("Cache set panic: %v", r)
        }
    }()

    ac.cache.Set(key, value)
    return nil
}
```

### 7. Cache Metrics & Monitoring

```go
type CacheMetrics struct {
    cache cache.Cache
}

func (cm *CacheMetrics) LogStats() {
    stats := cm.cache.Stats()
    log.Printf("Cache Stats:")
    log.Printf("  Size: %d items", stats.Size)
    log.Printf("  Hits: %d", stats.Hits)
    log.Printf("  Misses: %d", stats.Misses)
    log.Printf("  Hit Rate: %.2f%%", stats.HitRate*100)
}

func (cm *CacheMetrics) LogHybridStats(hc *cache.HybridCache) {
    stats := hc.HybridStats()

    overall := stats["overall"].(cache.Stats)
    log.Printf("Overall - Hit Rate: %.2f%%", overall.HitRate*100)

    if l1, ok := stats["l1"].(map[string]interface{}); ok {
        log.Printf("L1 (Local) - Size: %v, Hit Rate: %.2f%%",
            l1["size"], l1["hit_rate"].(float64)*100)
    }

    if l2, ok := stats["l2"].(map[string]interface{}); ok {
        log.Printf("L2 (Redis) - Size: %v, Hit Rate: %.2f%%",
            l2["size"], l2["hit_rate"].(float64)*100)
    }
}
```

### 8. Configuration Validation

```go
func validateCacheConfig(cacheType string) error {
    switch cacheType {
    case "redis":
        config := &cache.RedisConfig{
            Host: os.Getenv("AUTHZ_REDIS_HOST"),
            Port: parsePort(os.Getenv("AUTHZ_REDIS_PORT")),
        }
        if err := config.Validate(); err != nil {
            return fmt.Errorf("invalid Redis config: %w", err)
        }

    case "hybrid":
        if os.Getenv("AUTHZ_REDIS_HOST") == "" {
            return errors.New("hybrid cache requires AUTHZ_REDIS_HOST")
        }
    }

    return nil
}
```

### 9. Graceful Shutdown

```go
type Application struct {
    cache cache.Cache
}

func (app *Application) Shutdown(ctx context.Context) error {
    // Give ongoing operations time to complete
    select {
    case <-time.After(5 * time.Second):
    case <-ctx.Done():
    }

    // Close cache connections
    if rc, ok := app.cache.(*cache.RedisCache); ok {
        return rc.Close()
    }

    if hc, ok := app.cache.(*cache.HybridCache); ok {
        return hc.Close()
    }

    return nil
}
```

### 10. Testing with Caches

```go
import "testing"

func TestAuthzWithCache(t *testing.T) {
    // Create LRU cache for testing
    testCache := cache.NewLRU(1000, 1*time.Minute)
    defer testCache.Clear()

    // Test with cache
    testCache.Set("test:key", "test:value")
    val, ok := testCache.Get("test:key")

    if !ok {
        t.Fatal("expected key to exist in cache")
    }

    if val != "test:value" {
        t.Errorf("expected 'test:value', got %v", val)
    }

    // Verify statistics
    stats := testCache.Stats()
    if stats.Hits != 1 {
        t.Errorf("expected 1 hit, got %d", stats.Hits)
    }
}

func TestCacheWithMockRedis(t *testing.T) {
    // For unit tests, use LRU cache
    mockCache := cache.NewLRU(10000, 5*time.Minute)

    // Mock your service
    authz := &AuthzService{cache: mockCache}

    // Test logic
    result, err := authz.Evaluate("user:123", "resource:456")
    if err != nil {
        t.Fatalf("evaluation failed: %v", err)
    }

    // Verify cache was used
    stats := mockCache.Stats()
    if stats.Size == 0 {
        t.Error("cache should have entries")
    }
}
```

## Configuration Examples

### Development
```yaml
AUTHZ_CACHE_TYPE: lru
AUTHZ_CACHE_SIZE: 1000
AUTHZ_CACHE_TTL: 1m
```

### Staging (Hybrid)
```yaml
AUTHZ_CACHE_TYPE: hybrid
AUTHZ_CACHE_L1_CAPACITY: 5000
AUTHZ_CACHE_L1_TTL: 2m
AUTHZ_REDIS_ENABLED: true
AUTHZ_REDIS_HOST: redis-staging
AUTHZ_REDIS_PORT: 6379
AUTHZ_REDIS_POOL_SIZE: 20
AUTHZ_REDIS_TTL: 10m
AUTHZ_REDIS_KEY_PREFIX: staging:authz:
```

### Production (Sentinel)
```yaml
AUTHZ_CACHE_TYPE: hybrid
AUTHZ_CACHE_L1_CAPACITY: 50000
AUTHZ_CACHE_L1_TTL: 5m
AUTHZ_REDIS_ENABLED: true
AUTHZ_REDIS_HOST: redis-sentinel-1.prod
AUTHZ_REDIS_PORT: 26379
AUTHZ_REDIS_PASSWORD: ${REDIS_PASSWORD}
AUTHZ_REDIS_POOL_SIZE: 50
AUTHZ_REDIS_TTL: 30m
AUTHZ_REDIS_KEY_PREFIX: prod:authz:
AUTHZ_REDIS_READ_TIMEOUT: 3s
AUTHZ_REDIS_WRITE_TIMEOUT: 3s
```

## Performance Benchmarks

Run benchmarks with:
```bash
go test -bench=. ./internal/cache/... -benchmem

# Expected results:
# BenchmarkRedisCacheGet-8       ~100,000 ops in 10ms (network latency)
# BenchmarkRedisCacheSet-8       ~80,000 ops in 12ms (network latency)
# BenchmarkHybridCacheGet-8      ~500,000 ops (L1 hits) or 100K (L2 hits)
```

## Integration Checklist

- [ ] Review all code snippets above
- [ ] Update main.go to use cache factory
- [ ] Load configuration from environment
- [ ] Initialize cache in startup
- [ ] Cache authorization decisions
- [ ] Cache policies
- [ ] Implement cache invalidation on policy updates
- [ ] Expose cache statistics in metrics endpoint
- [ ] Add monitoring for cache hit rate
- [ ] Document cache keys in your project
- [ ] Set appropriate TTL values for your domain
- [ ] Test with both local and Redis caches
- [ ] Load test to find optimal pool size
- [ ] Deploy to staging and validate hit rates

---

For more details, see:
- `CACHE_IMPLEMENTATION.md` - Comprehensive documentation
- `CACHE_QUICK_START.md` - Quick start guide
- `example_integration.go` - Full working examples
