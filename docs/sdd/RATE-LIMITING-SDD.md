# Software Design Document: Rate Limiting

**Version**: 1.0.0
**Package**: `@authz-engine/server`
**Status**: Specification
**Last Updated**: 2025-11-23

---

## 1. Overview

### 1.1 Purpose

This document defines the rate limiting architecture for the AuthZ Engine, providing protection against abuse, ensuring fair usage, and maintaining system stability.

### 1.2 Design Goals

| Goal | Target | Rationale |
|------|--------|-----------|
| Overhead | <1ms | Minimal impact on latency |
| Accuracy | ±5% | Acceptable variance |
| Distributed | Yes | Works across instances |
| Granularity | Multi-tier | Flexible limits |

---

## 2. Architecture

### 2.1 Rate Limiting Tiers

```
┌─────────────────────────────────────────────────────────────────┐
│                    Rate Limiting Tiers                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Tier 1: Global                                                 │
│  ├── Protects entire system                                     │
│  └── Limit: 1,000,000 req/min                                  │
│                                                                  │
│  Tier 2: Per-Tenant                                             │
│  ├── Fair usage per customer                                    │
│  └── Default: 100,000 req/min                                  │
│                                                                  │
│  Tier 3: Per-Principal                                          │
│  ├── Individual user limits                                     │
│  └── Default: 1,000 req/min                                    │
│                                                                  │
│  Tier 4: Per-Resource                                           │
│  ├── Protect specific resources                                 │
│  └── Configurable per resource kind                            │
│                                                                  │
│  Tier 5: Per-Action                                             │
│  ├── Limit specific operations                                  │
│  └── e.g., delete: 10 req/min                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Algorithms

### 3.1 Token Bucket

```typescript
interface TokenBucketConfig {
  capacity: number;      // Max tokens
  refillRate: number;    // Tokens per second
  refillInterval: number; // Refill check interval (ms)
}

class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(private config: TokenBucketConfig) {
    this.tokens = config.capacity;
    this.lastRefill = Date.now();
  }

  tryConsume(count: number = 1): RateLimitResult {
    this.refill();

    if (this.tokens >= count) {
      this.tokens -= count;
      return {
        allowed: true,
        remaining: Math.floor(this.tokens),
        resetAt: this.calculateResetTime(),
      };
    }

    return {
      allowed: false,
      remaining: 0,
      resetAt: this.calculateResetTime(),
      retryAfter: this.calculateRetryAfter(count),
    };
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.config.refillRate;

    this.tokens = Math.min(this.config.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  private calculateRetryAfter(needed: number): number {
    const deficit = needed - this.tokens;
    return Math.ceil(deficit / this.config.refillRate);
  }
}
```

### 3.2 Sliding Window

```typescript
interface SlidingWindowConfig {
  windowMs: number;      // Window size in milliseconds
  maxRequests: number;   // Max requests per window
}

class SlidingWindowCounter {
  private currentWindow: Map<string, number> = new Map();
  private previousWindow: Map<string, number> = new Map();
  private windowStart: number;

  constructor(private config: SlidingWindowConfig) {
    this.windowStart = this.getCurrentWindowStart();
  }

  tryConsume(key: string): RateLimitResult {
    this.rotateWindowIfNeeded();

    const currentCount = this.currentWindow.get(key) || 0;
    const previousCount = this.previousWindow.get(key) || 0;

    // Calculate weighted count
    const windowProgress = (Date.now() - this.windowStart) / this.config.windowMs;
    const weightedCount = previousCount * (1 - windowProgress) + currentCount;

    if (weightedCount < this.config.maxRequests) {
      this.currentWindow.set(key, currentCount + 1);
      return {
        allowed: true,
        remaining: Math.floor(this.config.maxRequests - weightedCount - 1),
        resetAt: this.windowStart + this.config.windowMs,
      };
    }

    return {
      allowed: false,
      remaining: 0,
      resetAt: this.windowStart + this.config.windowMs,
      retryAfter: Math.ceil((this.windowStart + this.config.windowMs - Date.now()) / 1000),
    };
  }

  private rotateWindowIfNeeded(): void {
    const currentWindowStart = this.getCurrentWindowStart();
    if (currentWindowStart !== this.windowStart) {
      this.previousWindow = this.currentWindow;
      this.currentWindow = new Map();
      this.windowStart = currentWindowStart;
    }
  }

  private getCurrentWindowStart(): number {
    return Math.floor(Date.now() / this.config.windowMs) * this.config.windowMs;
  }
}
```

### 3.3 Distributed Rate Limiting (Redis)

```typescript
// Redis Lua script for atomic rate limiting
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local window_ms = tonumber(ARGV[1])
local max_requests = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local window_start = math.floor(now / window_ms) * window_ms
local current_key = key .. ':' .. window_start
local previous_key = key .. ':' .. (window_start - window_ms)

local current_count = tonumber(redis.call('GET', current_key) or '0')
local previous_count = tonumber(redis.call('GET', previous_key) or '0')

local window_progress = (now - window_start) / window_ms
local weighted_count = previous_count * (1 - window_progress) + current_count

if weighted_count < max_requests then
  redis.call('INCR', current_key)
  redis.call('PEXPIRE', current_key, window_ms * 2)
  return {1, math.floor(max_requests - weighted_count - 1), window_start + window_ms}
else
  return {0, 0, window_start + window_ms}
end
`;

class RedisRateLimiter {
  private script: string;

  constructor(private redis: Redis, private config: RateLimitConfig) {
    this.script = SLIDING_WINDOW_SCRIPT;
  }

  async checkLimit(key: string): Promise<RateLimitResult> {
    const result = await this.redis.eval(
      this.script,
      1,
      key,
      this.config.windowMs,
      this.config.maxRequests,
      Date.now()
    ) as [number, number, number];

    return {
      allowed: result[0] === 1,
      remaining: result[1],
      resetAt: result[2],
      retryAfter: result[0] === 0
        ? Math.ceil((result[2] - Date.now()) / 1000)
        : undefined,
    };
  }
}
```

---

## 4. Rate Limit Configuration

### 4.1 Limit Definitions

```typescript
interface RateLimitConfig {
  // Global limits
  global: {
    requestsPerMinute: number;
    burstSize: number;
  };

  // Per-tenant limits
  tenant: {
    default: TierLimits;
    tiers: Record<string, TierLimits>;
  };

  // Per-principal limits
  principal: {
    default: number;          // req/min
    authenticated: number;
    anonymous: number;
  };

  // Per-resource limits
  resource: {
    default: number;
    overrides: Record<string, number>;
  };

  // Per-action limits
  action: {
    default: number;
    overrides: Record<string, number>;
  };
}

interface TierLimits {
  requestsPerMinute: number;
  requestsPerDay: number;
  burstSize: number;
  concurrentRequests: number;
}

// Example configuration
const rateLimitConfig: RateLimitConfig = {
  global: {
    requestsPerMinute: 1000000,
    burstSize: 10000,
  },
  tenant: {
    default: {
      requestsPerMinute: 100000,
      requestsPerDay: 10000000,
      burstSize: 1000,
      concurrentRequests: 100,
    },
    tiers: {
      enterprise: {
        requestsPerMinute: 500000,
        requestsPerDay: 50000000,
        burstSize: 5000,
        concurrentRequests: 500,
      },
      starter: {
        requestsPerMinute: 10000,
        requestsPerDay: 1000000,
        burstSize: 100,
        concurrentRequests: 10,
      },
    },
  },
  principal: {
    default: 1000,
    authenticated: 1000,
    anonymous: 100,
  },
  resource: {
    default: 10000,
    overrides: {
      'sensitive-data': 100,
    },
  },
  action: {
    default: 10000,
    overrides: {
      delete: 100,
      admin: 50,
    },
  },
};
```

---

## 5. Response Handling

### 5.1 HTTP Response

```typescript
// Rate limit exceeded response
// HTTP 429 Too Many Requests

interface RateLimitResponse {
  error: {
    code: 'RATE_LIMIT_EXCEEDED';
    message: string;
    details: {
      limit: number;
      remaining: number;
      resetAt: string;       // ISO 8601
      retryAfter: number;    // seconds
      tier: string;          // Which limit was hit
    };
  };
}

// Headers
const rateLimitHeaders = {
  'X-RateLimit-Limit': '100000',
  'X-RateLimit-Remaining': '0',
  'X-RateLimit-Reset': '1704067200',
  'Retry-After': '60',
};
```

### 5.2 Middleware Implementation

```typescript
import { FastifyRequest, FastifyReply } from 'fastify';

async function rateLimitMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const tenant = request.headers['x-tenant-id'] as string;
  const principal = request.body?.principal?.id;

  // Check all applicable limits
  const limits = [
    { key: 'global', limiter: globalLimiter },
    { key: `tenant:${tenant}`, limiter: tenantLimiter },
    { key: `principal:${principal}`, limiter: principalLimiter },
  ];

  for (const { key, limiter } of limits) {
    const result = await limiter.checkLimit(key);

    // Set headers
    reply.header('X-RateLimit-Limit', result.limit);
    reply.header('X-RateLimit-Remaining', result.remaining);
    reply.header('X-RateLimit-Reset', result.resetAt);

    if (!result.allowed) {
      reply.header('Retry-After', result.retryAfter);
      reply.status(429).send({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Rate limit exceeded for ${key}`,
          details: result,
        },
      });
      return;
    }
  }
}
```

---

## 6. Quota Management

### 6.1 Usage Tracking

```typescript
interface UsageRecord {
  tenant: string;
  period: 'minute' | 'hour' | 'day' | 'month';
  periodStart: string;
  requests: number;
  allowed: number;
  denied: number;
}

class UsageTracker {
  async recordUsage(tenant: string, allowed: boolean): Promise<void> {
    const periods = ['minute', 'hour', 'day', 'month'];

    for (const period of periods) {
      const key = `usage:${tenant}:${period}:${this.getPeriodKey(period)}`;

      await this.redis.hincrby(key, allowed ? 'allowed' : 'denied', 1);
      await this.redis.hincrby(key, 'total', 1);
      await this.redis.expire(key, this.getTTL(period));
    }
  }

  async getUsage(tenant: string, period: string): Promise<UsageRecord> {
    const key = `usage:${tenant}:${period}:${this.getPeriodKey(period)}`;
    const data = await this.redis.hgetall(key);

    return {
      tenant,
      period: period as UsageRecord['period'],
      periodStart: this.getPeriodStart(period),
      requests: parseInt(data.total || '0'),
      allowed: parseInt(data.allowed || '0'),
      denied: parseInt(data.denied || '0'),
    };
  }
}
```

### 6.2 Quota API

```typescript
// GET /v1/quota/:tenantId
interface QuotaResponse {
  tenant: string;
  tier: string;
  limits: {
    requestsPerMinute: { limit: number; used: number; remaining: number };
    requestsPerDay: { limit: number; used: number; remaining: number };
    requestsPerMonth: { limit: number; used: number; remaining: number };
  };
  resetAt: {
    minute: string;
    day: string;
    month: string;
  };
}
```

---

## 7. Bypass & Exceptions

### 7.1 Allowlist

```typescript
interface RateLimitBypass {
  // Bypass by principal
  principals: string[];

  // Bypass by IP (internal services)
  ips: string[];

  // Bypass by API key
  apiKeys: string[];

  // Emergency bypass (time-limited)
  emergency: {
    enabled: boolean;
    expiresAt?: string;
    reason?: string;
  };
}

class RateLimitBypassChecker {
  async shouldBypass(request: FastifyRequest): Promise<boolean> {
    // Check emergency bypass
    if (this.config.emergency.enabled) {
      if (!this.config.emergency.expiresAt ||
          new Date() < new Date(this.config.emergency.expiresAt)) {
        return true;
      }
    }

    // Check principal allowlist
    const principal = request.body?.principal?.id;
    if (this.config.principals.includes(principal)) {
      return true;
    }

    // Check IP allowlist
    const ip = request.ip;
    if (this.config.ips.some(pattern => this.matchIP(ip, pattern))) {
      return true;
    }

    // Check API key allowlist
    const apiKey = request.headers['x-api-key'];
    if (apiKey && this.config.apiKeys.includes(apiKey)) {
      return true;
    }

    return false;
  }
}
```

---

## 8. Monitoring

### 8.1 Metrics

```typescript
// Prometheus metrics
const rateLimitChecks = new Counter({
  name: 'authz_rate_limit_checks_total',
  help: 'Total rate limit checks',
  labelNames: ['tier', 'result'],
});

const rateLimitExceeded = new Counter({
  name: 'authz_rate_limit_exceeded_total',
  help: 'Rate limit exceeded events',
  labelNames: ['tier', 'tenant'],
});

const currentUsage = new Gauge({
  name: 'authz_rate_limit_usage_ratio',
  help: 'Current usage as ratio of limit',
  labelNames: ['tier', 'tenant'],
});
```

### 8.2 Alerts

```yaml
groups:
  - name: rate-limiting
    rules:
      - alert: HighRateLimitDenials
        expr: rate(authz_rate_limit_exceeded_total[5m]) > 100
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High rate of rate limit denials"

      - alert: TenantNearQuota
        expr: authz_rate_limit_usage_ratio > 0.9
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Tenant {{ $labels.tenant }} near rate limit quota"
```

---

## 9. Configuration

```yaml
rateLimit:
  enabled: true

  # Redis for distributed rate limiting
  redis:
    host: redis.authz.svc
    port: 6379
    keyPrefix: 'rl:'

  # Global limits
  global:
    requestsPerMinute: 1000000
    burstSize: 10000

  # Tenant tiers
  tenants:
    default:
      requestsPerMinute: 100000
      requestsPerDay: 10000000
      burstSize: 1000

    tiers:
      enterprise:
        requestsPerMinute: 500000
      starter:
        requestsPerMinute: 10000

  # Bypass rules
  bypass:
    principals: []
    ips:
      - '10.0.0.0/8'       # Internal network
      - '172.16.0.0/12'
    apiKeys: []

  # Response configuration
  response:
    includeHeaders: true
    includeRetryAfter: true
```

---

## 10. Testing

### 10.1 Unit Tests

```typescript
describe('Rate Limiting', () => {
  it('should allow requests under limit', async () => {
    const limiter = new TokenBucket({ capacity: 10, refillRate: 1 });

    for (let i = 0; i < 10; i++) {
      const result = limiter.tryConsume();
      expect(result.allowed).toBe(true);
    }
  });

  it('should deny requests over limit', async () => {
    const limiter = new TokenBucket({ capacity: 10, refillRate: 1 });

    // Exhaust tokens
    for (let i = 0; i < 10; i++) {
      limiter.tryConsume();
    }

    const result = limiter.tryConsume();
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('should refill tokens over time', async () => {
    const limiter = new TokenBucket({ capacity: 10, refillRate: 10 });

    // Exhaust tokens
    for (let i = 0; i < 10; i++) {
      limiter.tryConsume();
    }

    // Wait for refill
    await sleep(1000);

    const result = limiter.tryConsume();
    expect(result.allowed).toBe(true);
  });
});
```

---

## 11. Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| ioredis | ^5.3.2 | Distributed rate limiting |
| prom-client | ^15.0.0 | Metrics |

---

*Last Updated: 2025-11-23*
