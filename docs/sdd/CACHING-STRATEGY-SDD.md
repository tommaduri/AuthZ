# Software Design Document: Caching Strategy

**Version**: 1.0.0
**Package**: `@authz-engine/core`
**Status**: Specification
**Last Updated**: 2025-11-23

---

## 1. Overview

### 1.1 Purpose

This document defines the multi-tier caching architecture for the AuthZ Engine to achieve sub-millisecond authorization decisions at scale.

### 1.2 Scope

**In Scope:**
- L1 in-process LRU cache
- L2 distributed Redis cache
- L3 edge cache (CDN/WASM)
- Cache invalidation strategies
- Consistency models

**Out of Scope:**
- Application-level caching in client SDKs
- Database query caching

### 1.3 Performance Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| L1 cache lookup | <100μs | In-memory, zero network |
| L2 cache lookup | <1ms | Redis round-trip |
| Cache hit rate | >95% | Reduce compute load |
| Invalidation latency | <100ms | Near real-time consistency |
| Memory per instance | <256MB | Cost efficiency |

---

## 2. Architecture

### 2.1 Multi-Tier Cache Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Cache Architecture                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Request Flow:                                                       │
│  ┌─────────┐                                                        │
│  │ Client  │                                                        │
│  └────┬────┘                                                        │
│       │                                                              │
│       ▼                                                              │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │  L1: In-Process LRU Cache                                │        │
│  │  ├── Per-instance, ~100MB                               │        │
│  │  ├── Latency: <100μs                                    │        │
│  │  └── TTL: 60 seconds                                    │        │
│  └────┬────────────────────────────────────────────────────┘        │
│       │ MISS                                                         │
│       ▼                                                              │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │  L2: Distributed Redis Cache                             │        │
│  │  ├── Shared across instances                            │        │
│  │  ├── Latency: <1ms                                      │        │
│  │  └── TTL: 300 seconds                                   │        │
│  └────┬────────────────────────────────────────────────────┘        │
│       │ MISS                                                         │
│       ▼                                                              │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │  Decision Engine                                         │        │
│  │  ├── Policy evaluation                                  │        │
│  │  ├── CEL expression execution                           │        │
│  │  └── Result cached in L1 + L2                           │        │
│  └─────────────────────────────────────────────────────────┘        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Cache Key Design

```typescript
// Cache key structure
interface CacheKey {
  prefix: string;      // 'authz:v1'
  tenant: string;      // Tenant ID for multi-tenant
  type: CacheType;     // 'decision' | 'policy' | 'principal'
  hash: string;        // SHA-256 of request/data
}

// Key format: authz:v1:{tenant}:{type}:{hash}
// Example: authz:v1:acme:decision:a1b2c3d4e5f6...

enum CacheType {
  DECISION = 'decision',      // Authorization decisions
  POLICY = 'policy',          // Compiled policies
  PRINCIPAL = 'principal',    // Principal attributes
  RESOURCE = 'resource',      // Resource attributes
  DERIVED_ROLE = 'derived',   // Derived role results
}
```

### 2.3 Hash Generation

```typescript
import { createHash } from 'crypto';

interface DecisionCacheInput {
  principal: {
    id: string;
    roles: string[];
    attr: Record<string, unknown>;
  };
  resource: {
    kind: string;
    id: string;
    attr: Record<string, unknown>;
  };
  action: string;
  auxData?: Record<string, unknown>;
}

function generateCacheKey(input: DecisionCacheInput, tenant: string): string {
  // Normalize and sort for consistent hashing
  const normalized = {
    p: {
      id: input.principal.id,
      r: [...input.principal.roles].sort(),
      a: sortObject(input.principal.attr),
    },
    r: {
      k: input.resource.kind,
      id: input.resource.id,
      a: sortObject(input.resource.attr),
    },
    a: input.action,
    x: input.auxData ? sortObject(input.auxData) : undefined,
  };

  const hash = createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex')
    .substring(0, 32); // First 32 chars sufficient

  return `authz:v1:${tenant}:decision:${hash}`;
}

function sortObject(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.keys(obj)
    .sort()
    .reduce((sorted, key) => {
      sorted[key] = obj[key];
      return sorted;
    }, {} as Record<string, unknown>);
}
```

---

## 3. Component Design

### 3.1 CacheManager Interface

```typescript
interface CacheManager {
  // Core operations
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void>;
  delete(key: string): Promise<boolean>;

  // Batch operations
  mget<T>(keys: string[]): Promise<Map<string, T>>;
  mset<T>(entries: Map<string, T>, options?: CacheSetOptions): Promise<void>;
  mdelete(keys: string[]): Promise<number>;

  // Invalidation
  invalidateByPattern(pattern: string): Promise<number>;
  invalidateByTags(tags: string[]): Promise<number>;

  // Stats
  getStats(): CacheStats;

  // Lifecycle
  clear(): Promise<void>;
  close(): Promise<void>;
}

interface CacheSetOptions {
  ttl?: number;           // TTL in seconds
  tags?: string[];        // Tags for invalidation
  priority?: CachePriority;
}

interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
  memoryUsage: number;
  evictions: number;
}

enum CachePriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
}
```

### 3.2 L1 LRU Cache Implementation

```typescript
interface LRUCacheConfig {
  maxSize: number;        // Max entries
  maxMemory: number;      // Max memory in bytes
  ttl: number;            // Default TTL in seconds
  updateAgeOnGet: boolean;
}

class LRUCache<T> implements CacheManager {
  private cache: Map<string, CacheEntry<T>>;
  private accessOrder: string[];
  private config: LRUCacheConfig;
  private stats: CacheStats;

  constructor(config: LRUCacheConfig) {
    this.cache = new Map();
    this.accessOrder = [];
    this.config = config;
    this.stats = { hits: 0, misses: 0, hitRate: 0, size: 0, memoryUsage: 0, evictions: 0 };
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    // Check TTL
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    // Update access order for LRU
    this.moveToFront(key);

    this.stats.hits++;
    this.updateHitRate();
    return entry.value as T;
  }

  async set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void> {
    const ttl = options?.ttl ?? this.config.ttl;
    const expiresAt = ttl > 0 ? Date.now() + (ttl * 1000) : undefined;

    // Evict if necessary
    while (this.cache.size >= this.config.maxSize) {
      this.evictLRU();
    }

    const entry: CacheEntry<T> = {
      value,
      expiresAt,
      tags: options?.tags,
      createdAt: Date.now(),
    };

    this.cache.set(key, entry);
    this.moveToFront(key);
    this.stats.size = this.cache.size;
  }

  private evictLRU(): void {
    const lruKey = this.accessOrder.pop();
    if (lruKey) {
      this.cache.delete(lruKey);
      this.stats.evictions++;
    }
  }

  private moveToFront(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.unshift(key);
  }

  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }
}

interface CacheEntry<T> {
  value: T;
  expiresAt?: number;
  tags?: string[];
  createdAt: number;
}
```

### 3.3 L2 Redis Cache Implementation

```typescript
import { Redis, Cluster } from 'ioredis';

interface RedisCacheConfig {
  mode: 'standalone' | 'sentinel' | 'cluster';
  nodes: RedisNode[];
  password?: string;
  ttl: number;
  keyPrefix: string;
  maxRetries: number;
  retryDelayMs: number;
}

interface RedisNode {
  host: string;
  port: number;
}

class RedisCache implements CacheManager {
  private client: Redis | Cluster;
  private config: RedisCacheConfig;
  private stats: CacheStats;

  constructor(config: RedisCacheConfig) {
    this.config = config;
    this.stats = { hits: 0, misses: 0, hitRate: 0, size: 0, memoryUsage: 0, evictions: 0 };
    this.client = this.createClient();
  }

  private createClient(): Redis | Cluster {
    if (this.config.mode === 'cluster') {
      return new Cluster(this.config.nodes, {
        redisOptions: {
          password: this.config.password,
          keyPrefix: this.config.keyPrefix,
        },
        retryDelayOnFailover: this.config.retryDelayMs,
        maxRedirections: 16,
      });
    }

    return new Redis({
      host: this.config.nodes[0].host,
      port: this.config.nodes[0].port,
      password: this.config.password,
      keyPrefix: this.config.keyPrefix,
      retryStrategy: (times) => {
        if (times > this.config.maxRetries) return null;
        return Math.min(times * this.config.retryDelayMs, 2000);
      },
    });
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await this.client.get(key);
      if (!data) {
        this.stats.misses++;
        return null;
      }

      this.stats.hits++;
      return JSON.parse(data) as T;
    } catch (error) {
      // Log and return null on Redis errors
      console.error('Redis get error:', error);
      return null;
    }
  }

  async set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void> {
    try {
      const ttl = options?.ttl ?? this.config.ttl;
      const data = JSON.stringify(value);

      if (ttl > 0) {
        await this.client.setex(key, ttl, data);
      } else {
        await this.client.set(key, data);
      }

      // Store tags if provided
      if (options?.tags?.length) {
        const multi = this.client.multi();
        for (const tag of options.tags) {
          multi.sadd(`tag:${tag}`, key);
          multi.expire(`tag:${tag}`, ttl);
        }
        await multi.exec();
      }
    } catch (error) {
      console.error('Redis set error:', error);
    }
  }

  async invalidateByTags(tags: string[]): Promise<number> {
    let deleted = 0;

    for (const tag of tags) {
      const keys = await this.client.smembers(`tag:${tag}`);
      if (keys.length > 0) {
        deleted += await this.client.del(...keys);
        await this.client.del(`tag:${tag}`);
      }
    }

    return deleted;
  }

  async invalidateByPattern(pattern: string): Promise<number> {
    let deleted = 0;
    let cursor = '0';

    do {
      const [nextCursor, keys] = await this.client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        deleted += await this.client.del(...keys);
      }
    } while (cursor !== '0');

    return deleted;
  }
}
```

### 3.4 Multi-Tier Cache Coordinator

```typescript
interface MultiTierCacheConfig {
  l1: LRUCacheConfig;
  l2: RedisCacheConfig;
  writeThrough: boolean;     // Write to L2 immediately
  readThrough: boolean;      // Populate L1 from L2
}

class MultiTierCache implements CacheManager {
  private l1: LRUCache<unknown>;
  private l2: RedisCache;
  private config: MultiTierCacheConfig;

  constructor(config: MultiTierCacheConfig) {
    this.config = config;
    this.l1 = new LRUCache(config.l1);
    this.l2 = new RedisCache(config.l2);
  }

  async get<T>(key: string): Promise<T | null> {
    // Try L1 first
    const l1Result = await this.l1.get<T>(key);
    if (l1Result !== null) {
      return l1Result;
    }

    // Try L2
    const l2Result = await this.l2.get<T>(key);
    if (l2Result !== null && this.config.readThrough) {
      // Populate L1 from L2
      await this.l1.set(key, l2Result, { ttl: this.config.l1.ttl });
    }

    return l2Result;
  }

  async set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void> {
    // Always write to L1
    await this.l1.set(key, value, options);

    // Write to L2 based on config
    if (this.config.writeThrough) {
      await this.l2.set(key, value, options);
    }
  }

  async invalidate(key: string): Promise<void> {
    await Promise.all([
      this.l1.delete(key),
      this.l2.delete(key),
    ]);
  }

  async invalidateByPattern(pattern: string): Promise<number> {
    // L1 doesn't support patterns, so clear relevant entries
    await this.l1.clear();
    return this.l2.invalidateByPattern(pattern);
  }
}
```

---

## 4. Caching Strategies

### 4.1 Decision Caching

```typescript
interface DecisionCacheEntry {
  effect: 'ALLOW' | 'DENY';
  matchedPolicy?: string;
  derivedRoles?: string[];
  outputs?: Record<string, unknown>;
  cachedAt: number;
}

class DecisionCache {
  private cache: MultiTierCache;
  private config: DecisionCacheConfig;

  async cacheDecision(
    request: CheckRequest,
    decision: CheckResponse,
    tenant: string
  ): Promise<void> {
    const key = generateCacheKey(request, tenant);

    const entry: DecisionCacheEntry = {
      effect: decision.effect,
      matchedPolicy: decision.matchedPolicy,
      derivedRoles: decision.derivedRoles,
      outputs: decision.outputs,
      cachedAt: Date.now(),
    };

    await this.cache.set(key, entry, {
      ttl: this.config.ttl,
      tags: [
        `tenant:${tenant}`,
        `principal:${request.principal.id}`,
        `resource:${request.resource.kind}`,
      ],
    });
  }

  async getDecision(
    request: CheckRequest,
    tenant: string
  ): Promise<DecisionCacheEntry | null> {
    const key = generateCacheKey(request, tenant);
    return this.cache.get<DecisionCacheEntry>(key);
  }
}
```

### 4.2 Policy Caching

```typescript
interface CompiledPolicyCache {
  policy: CompiledPolicy;
  version: string;
  compiledAt: number;
}

class PolicyCache {
  private cache: MultiTierCache;

  async cachePolicy(
    policyId: string,
    policy: CompiledPolicy,
    version: string
  ): Promise<void> {
    const key = `policy:${policyId}:${version}`;

    await this.cache.set(key, {
      policy,
      version,
      compiledAt: Date.now(),
    }, {
      ttl: 3600, // Policies cached for 1 hour
      tags: [`policy:${policyId}`],
    });
  }

  async invalidatePolicyVersion(policyId: string): Promise<void> {
    await this.cache.invalidateByTags([`policy:${policyId}`]);
  }
}
```

### 4.3 Negative Caching

```typescript
// Cache DENY decisions with shorter TTL
const NEGATIVE_CACHE_TTL = 30; // 30 seconds

async function cacheWithNegativeSupport(
  key: string,
  decision: DecisionCacheEntry
): Promise<void> {
  const ttl = decision.effect === 'DENY'
    ? NEGATIVE_CACHE_TTL
    : DEFAULT_CACHE_TTL;

  await cache.set(key, decision, { ttl });
}
```

---

## 5. Cache Invalidation

### 5.1 Invalidation Strategies

| Strategy | Use Case | Latency | Consistency |
|----------|----------|---------|-------------|
| TTL expiration | Default | N/A | Eventual |
| Event-driven | Policy changes | <100ms | Strong |
| Tag-based | Group invalidation | <500ms | Strong |
| Pattern-based | Bulk invalidation | <1s | Strong |

### 5.2 Event-Driven Invalidation

```typescript
interface CacheInvalidationEvent {
  type: 'POLICY_UPDATED' | 'POLICY_DELETED' | 'PRINCIPAL_UPDATED' | 'BULK_INVALIDATE';
  tenant: string;
  targets: {
    policyIds?: string[];
    principalIds?: string[];
    resourceKinds?: string[];
  };
  timestamp: number;
}

class CacheInvalidator {
  private cache: MultiTierCache;
  private eventBus: EventBus;

  constructor(cache: MultiTierCache, eventBus: EventBus) {
    this.cache = cache;
    this.eventBus = eventBus;

    // Subscribe to invalidation events
    this.eventBus.subscribe('cache.invalidate', this.handleInvalidation.bind(this));
  }

  private async handleInvalidation(event: CacheInvalidationEvent): Promise<void> {
    const tags: string[] = [`tenant:${event.tenant}`];

    if (event.targets.policyIds?.length) {
      tags.push(...event.targets.policyIds.map(id => `policy:${id}`));
    }

    if (event.targets.principalIds?.length) {
      tags.push(...event.targets.principalIds.map(id => `principal:${id}`));
    }

    if (event.targets.resourceKinds?.length) {
      tags.push(...event.targets.resourceKinds.map(kind => `resource:${kind}`));
    }

    await this.cache.invalidateByTags(tags);
  }

  async invalidateOnPolicyChange(policyId: string, tenant: string): Promise<void> {
    this.eventBus.emit('cache.invalidate', {
      type: 'POLICY_UPDATED',
      tenant,
      targets: { policyIds: [policyId] },
      timestamp: Date.now(),
    });
  }
}
```

### 5.3 Cascade Invalidation

```typescript
// When a policy changes, invalidate all related cached decisions
async function cascadeInvalidation(
  policyId: string,
  tenant: string,
  cache: MultiTierCache
): Promise<void> {
  // Get affected resource kinds from policy
  const policy = await getPolicyById(policyId);
  const resourceKind = policy.resourcePolicy?.resource;

  if (resourceKind) {
    // Invalidate all decisions for this resource kind
    await cache.invalidateByPattern(
      `authz:v1:${tenant}:decision:*`
    );
  }
}
```

---

## 6. Redis Configuration

### 6.1 Standalone Configuration

```yaml
# redis.conf
maxmemory 2gb
maxmemory-policy allkeys-lru
appendonly yes
appendfsync everysec

# Networking
bind 0.0.0.0
port 6379
protected-mode yes
requirepass ${REDIS_PASSWORD}

# Performance
tcp-keepalive 300
timeout 0
tcp-backlog 511
```

### 6.2 Sentinel Configuration

```yaml
# sentinel.conf
sentinel monitor authz-master redis-master 6379 2
sentinel auth-pass authz-master ${REDIS_PASSWORD}
sentinel down-after-milliseconds authz-master 5000
sentinel failover-timeout authz-master 60000
sentinel parallel-syncs authz-master 1
```

### 6.3 Cluster Configuration

```yaml
# Kubernetes Redis Cluster
apiVersion: v1
kind: ConfigMap
metadata:
  name: redis-cluster-config
data:
  redis.conf: |
    cluster-enabled yes
    cluster-config-file nodes.conf
    cluster-node-timeout 5000
    appendonly yes
    maxmemory 1gb
    maxmemory-policy allkeys-lru
```

---

## 7. Performance Optimization

### 7.1 Thundering Herd Prevention

```typescript
class CacheWithSingleFlight {
  private cache: MultiTierCache;
  private inFlight: Map<string, Promise<unknown>>;

  async getOrCompute<T>(
    key: string,
    compute: () => Promise<T>,
    options?: CacheSetOptions
  ): Promise<T> {
    // Check cache first
    const cached = await this.cache.get<T>(key);
    if (cached !== null) return cached;

    // Check if computation already in flight
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    // Start computation
    const promise = compute().then(async (result) => {
      await this.cache.set(key, result, options);
      this.inFlight.delete(key);
      return result;
    }).catch((error) => {
      this.inFlight.delete(key);
      throw error;
    });

    this.inFlight.set(key, promise);
    return promise;
  }
}
```

### 7.2 Cache Warming

```typescript
class CacheWarmer {
  private cache: MultiTierCache;
  private decisionEngine: DecisionEngine;

  async warmCache(tenant: string): Promise<WarmingResult> {
    const startTime = Date.now();
    let warmed = 0;

    // Get common access patterns from analytics
    const patterns = await this.getCommonPatterns(tenant);

    for (const pattern of patterns) {
      const decision = await this.decisionEngine.check(pattern.request);
      await this.cache.set(
        generateCacheKey(pattern.request, tenant),
        decision,
        { ttl: 300 }
      );
      warmed++;
    }

    return {
      entriesWarmed: warmed,
      durationMs: Date.now() - startTime,
    };
  }
}
```

---

## 8. Monitoring

### 8.1 Cache Metrics

```typescript
// Prometheus metrics
const cacheHits = new Counter({
  name: 'authz_cache_hits_total',
  help: 'Total cache hits',
  labelNames: ['tier', 'type'],
});

const cacheMisses = new Counter({
  name: 'authz_cache_misses_total',
  help: 'Total cache misses',
  labelNames: ['tier', 'type'],
});

const cacheLatency = new Histogram({
  name: 'authz_cache_latency_seconds',
  help: 'Cache operation latency',
  labelNames: ['tier', 'operation'],
  buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01],
});

const cacheSize = new Gauge({
  name: 'authz_cache_size',
  help: 'Number of entries in cache',
  labelNames: ['tier'],
});

const cacheMemory = new Gauge({
  name: 'authz_cache_memory_bytes',
  help: 'Memory used by cache',
  labelNames: ['tier'],
});
```

### 8.2 Grafana Dashboard

```json
{
  "title": "AuthZ Cache Performance",
  "panels": [
    {
      "title": "Cache Hit Rate",
      "type": "gauge",
      "targets": [
        {
          "expr": "sum(rate(authz_cache_hits_total[5m])) / (sum(rate(authz_cache_hits_total[5m])) + sum(rate(authz_cache_misses_total[5m])))"
        }
      ]
    },
    {
      "title": "Cache Latency (P99)",
      "type": "graph",
      "targets": [
        {
          "expr": "histogram_quantile(0.99, rate(authz_cache_latency_seconds_bucket[5m]))",
          "legendFormat": "{{tier}}"
        }
      ]
    }
  ]
}
```

---

## 9. Configuration Reference

```yaml
cache:
  enabled: true

  l1:
    maxSize: 100000           # Max entries
    maxMemory: 268435456      # 256MB
    ttl: 60                   # 60 seconds
    updateAgeOnGet: true

  l2:
    mode: cluster             # standalone | sentinel | cluster
    nodes:
      - host: redis-0.redis.authz.svc
        port: 6379
      - host: redis-1.redis.authz.svc
        port: 6379
      - host: redis-2.redis.authz.svc
        port: 6379
    password: ${REDIS_PASSWORD}
    ttl: 300                  # 5 minutes
    keyPrefix: "authz:v1:"
    maxRetries: 3
    retryDelayMs: 100

  writeThrough: true
  readThrough: true

  invalidation:
    eventDriven: true
    cascadeOnPolicyChange: true
```

---

## 10. Testing Strategy

### 10.1 Unit Tests

| Component | Test Coverage | Focus Areas |
|-----------|--------------|-------------|
| LRUCache | 95% | Eviction, TTL, LRU ordering |
| RedisCache | 90% | Connection, serialization, errors |
| MultiTierCache | 90% | Read-through, write-through |
| CacheInvalidator | 85% | Event handling, patterns |

### 10.2 Performance Tests

```typescript
describe('Cache Performance', () => {
  it('L1 lookup should be <100μs', async () => {
    const start = process.hrtime.bigint();
    await l1Cache.get('test-key');
    const duration = Number(process.hrtime.bigint() - start) / 1000;
    expect(duration).toBeLessThan(100); // microseconds
  });

  it('L2 lookup should be <1ms', async () => {
    const start = process.hrtime.bigint();
    await l2Cache.get('test-key');
    const duration = Number(process.hrtime.bigint() - start) / 1000000;
    expect(duration).toBeLessThan(1); // milliseconds
  });
});
```

---

## 11. Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| ioredis | ^5.3.2 | Redis client |
| lru-cache | ^10.0.0 | In-memory LRU |
| prom-client | ^15.0.0 | Metrics |

---

*Last Updated: 2025-11-23*
