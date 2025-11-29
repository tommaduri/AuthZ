# Software Design Document: Multi-Tenancy

**Version**: 1.0.0
**Package**: `@authz-engine/core`, `@authz-engine/server`
**Status**: Specification (Not Yet Implemented)
**Last Updated**: 2025-11-23

---

## 1. Overview

### 1.1 Purpose

Multi-tenancy enables a single AuthZ Engine instance to serve multiple independent tenants with isolated policies while maximizing resource efficiency. This capability is essential for SaaS deployments where multiple customers share infrastructure.

### 1.2 Scope

**In Scope:**
- Tenant configuration and lifecycle management
- Policy namespace isolation
- Request routing by tenant
- Per-tenant resource limits and quotas
- Shared vs. isolated resource strategies
- Cross-tenant access prevention

**Out of Scope:**
- Tenant billing and metering
- Tenant provisioning UI
- Cross-tenant policy sharing (Phase 2)

### 1.3 Key Decisions

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Namespace-based isolation | Clear separation, simpler implementation | Scope-based, database-level |
| Header-based tenant extraction | Industry standard, easy integration | Path-based, JWT claim |
| Per-tenant caching | Prevents cache pollution | Shared cache with tenant keys |

---

## 2. Requirements

### 2.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-001 | Support tenant identification via HTTP header | Must Have | Pending |
| FR-002 | Isolate policies by tenant namespace | Must Have | Pending |
| FR-003 | Enforce per-tenant resource limits | Must Have | Pending |
| FR-004 | Route requests to correct policy set | Must Have | Pending |
| FR-005 | Support shared base policies | Should Have | Pending |
| FR-006 | Enable tenant-specific settings | Should Have | Pending |
| FR-007 | Provide tenant health metrics | Should Have | Pending |

### 2.2 Non-Functional Requirements

| ID | Category | Requirement | Target |
|----|----------|-------------|--------|
| NFR-001 | Performance | Tenant resolution overhead | < 0.5ms |
| NFR-002 | Performance | Per-tenant cache hit rate | > 90% |
| NFR-003 | Security | Cross-tenant data leakage | Zero tolerance |
| NFR-004 | Scalability | Concurrent tenants | 1,000+ |
| NFR-005 | Availability | Tenant isolation failure | Fail-closed |

---

## 3. Architecture

### 3.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Multi-Tenant AuthZ Engine                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐  │
│  │  Tenant Router   │───▶│  Policy Resolver │───▶│ Decision Engine  │  │
│  │                  │    │                  │    │                  │  │
│  │  - Extract ID    │    │  - Load Context  │    │  - Evaluate      │  │
│  │  - Validate      │    │  - Apply Limits  │    │  - Respond       │  │
│  └──────────────────┘    └──────────────────┘    └──────────────────┘  │
│           │                       │                       │             │
│           ▼                       ▼                       ▼             │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                      Tenant Context Store                         │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐                 │  │
│  │  │  Tenant A  │  │  Tenant B  │  │  Tenant C  │  ...            │  │
│  │  │  Policies  │  │  Policies  │  │  Policies  │                 │  │
│  │  │  Cache     │  │  Cache     │  │  Cache     │                 │  │
│  │  │  Limits    │  │  Limits    │  │  Limits    │                 │  │
│  │  └────────────┘  └────────────┘  └────────────┘                 │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                      Shared Resources                             │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │  │
│  │  │ Base Policies│  │ CEL Runtime │  │ Global Admin│              │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘              │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow

```
Request → Tenant Extraction → Tenant Validation → Context Loading
                                    │
                                    ▼
                           ┌─────────────────┐
                           │ Rate Limiting   │
                           │ (Per-Tenant)    │
                           └────────┬────────┘
                                    │
                                    ▼
                           ┌─────────────────┐
                           │ Policy Loading  │
                           │ (Namespace)     │
                           └────────┬────────┘
                                    │
                                    ▼
                           ┌─────────────────┐
                           │ Decision Engine │
                           └────────┬────────┘
                                    │
                                    ▼
                           Response with Tenant Context
```

---

## 4. Interfaces

### 4.1 Core Type Definitions

```typescript
/**
 * Tenant configuration defining isolation and resource boundaries
 */
interface TenantConfig {
  /** Unique tenant identifier */
  id: string;
  /** Human-readable tenant name */
  name: string;
  /** Whether tenant is active */
  enabled: boolean;
  /** Policy namespace for isolation */
  policyNamespace: string;
  /** Resource quotas and limits */
  limits?: TenantLimits;
  /** Tenant-specific behavior settings */
  settings?: TenantSettings;
  /** Metadata for tracking */
  metadata?: Record<string, unknown>;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Resource limits enforced per tenant
 */
interface TenantLimits {
  /** Maximum number of policies */
  maxPolicies?: number;
  /** Request rate limit (requests per second) */
  maxRequestsPerSecond?: number;
  /** Maximum principal attributes in request */
  maxPrincipalAttributes?: number;
  /** Maximum resource attributes in request */
  maxResourceAttributes?: number;
  /** Maximum derived roles definitions */
  maxDerivedRoles?: number;
  /** Maximum CEL expression complexity */
  maxCelComplexity?: number;
  /** Maximum request payload size in bytes */
  maxRequestSize?: number;
}

/**
 * Tenant-specific behavior configuration
 */
interface TenantSettings {
  /** Default policy version to use */
  defaultPolicyVersion?: string;
  /** Enable strict schema validation */
  strictValidation?: boolean;
  /** Audit logging verbosity */
  auditLevel?: 'none' | 'basic' | 'detailed';
  /** Decision caching strategy */
  cacheStrategy?: 'none' | 'memory' | 'distributed';
  /** Cache TTL in milliseconds */
  cacheTtlMs?: number;
  /** Allow undefined attributes */
  allowUndefinedAttributes?: boolean;
  /** Custom CEL functions enabled */
  customCelFunctions?: string[];
}

/**
 * Extended check request with tenant context
 */
interface TenantRequest {
  /** Tenant identifier for routing */
  tenantId: string;
  /** Request identifier for tracing */
  requestId?: string;
  /** Principal making the request */
  principal: Principal;
  /** Resource being accessed */
  resource: Resource;
  /** Action being performed */
  action: string;
  /** Additional context */
  auxData?: AuxData;
}

/**
 * Runtime tenant context loaded for request processing
 */
interface TenantContext {
  /** Tenant identifier */
  id: string;
  /** Tenant configuration */
  config: TenantConfig;
  /** Loaded policies for this tenant */
  policies: Policy[];
  /** Derived role definitions */
  derivedRoles: DerivedRole[];
  /** Schema definitions */
  schemas: Schema[];
  /** Per-tenant cache instance */
  cache: TenantCache;
  /** Rate limiter instance */
  rateLimiter: RateLimiter;
}
```

### 4.2 Multi-Tenant Router Interface

```typescript
/**
 * Routes requests to appropriate tenant context
 */
interface MultiTenantRouter {
  /**
   * Extract tenant identifier from incoming request
   * @param request - HTTP/gRPC request
   * @returns Tenant identifier
   * @throws TenantExtractionError if tenant cannot be determined
   */
  extractTenant(request: Request): string;

  /**
   * Load tenant context with policies and configuration
   * @param tenantId - Tenant identifier
   * @returns Fully loaded tenant context
   * @throws TenantNotFoundError if tenant doesn't exist
   * @throws TenantDisabledError if tenant is disabled
   */
  getTenantContext(tenantId: string): Promise<TenantContext>;

  /**
   * Route authorization check to tenant-specific policy set
   * @param tenantId - Target tenant
   * @param request - Check request
   * @returns Authorization decision
   */
  route(tenantId: string, request: CheckRequest): Promise<CheckResponse>;

  /**
   * Validate request against tenant limits
   * @param tenantId - Tenant identifier
   * @param request - Request to validate
   * @throws TenantLimitExceededError if limits breached
   */
  validateLimits(tenantId: string, request: TenantRequest): void;

  /**
   * Register a new tenant
   * @param config - Tenant configuration
   */
  registerTenant(config: TenantConfig): Promise<void>;

  /**
   * Update tenant configuration
   * @param tenantId - Tenant to update
   * @param updates - Partial configuration updates
   */
  updateTenant(tenantId: string, updates: Partial<TenantConfig>): Promise<void>;

  /**
   * Remove tenant and all associated resources
   * @param tenantId - Tenant to remove
   */
  removeTenant(tenantId: string): Promise<void>;
}
```

### 4.3 Tenant Store Interface

```typescript
/**
 * Persistent storage for tenant configurations
 */
interface TenantStore {
  /** Get tenant by ID */
  get(tenantId: string): Promise<TenantConfig | null>;

  /** List all tenants with optional filtering */
  list(filter?: TenantFilter): Promise<TenantConfig[]>;

  /** Create new tenant */
  create(config: TenantConfig): Promise<void>;

  /** Update existing tenant */
  update(tenantId: string, updates: Partial<TenantConfig>): Promise<void>;

  /** Delete tenant */
  delete(tenantId: string): Promise<void>;

  /** Check if tenant exists */
  exists(tenantId: string): Promise<boolean>;
}

interface TenantFilter {
  enabled?: boolean;
  namespace?: string;
  createdAfter?: Date;
  limit?: number;
  offset?: number;
}
```

---

## 5. Tenant Isolation Strategies

### 5.1 Namespace Isolation

Policies are isolated by tenant using a namespace prefix:

```yaml
# Tenant A policy: policies/tenant-a/document-policy.yaml
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
  tenant: tenant-a
  namespace: acme
spec:
  resource: document
  version: "1.0"
  rules:
    - actions: ["view", "edit"]
      effect: EFFECT_ALLOW
      roles: ["editor"]
      condition:
        match:
          expr: resource.attr.department == principal.attr.department

# Tenant B policy: policies/tenant-b/document-policy.yaml
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
  tenant: tenant-b
  namespace: widgets
spec:
  resource: document
  version: "1.0"
  rules:
    - actions: ["view"]
      effect: EFFECT_ALLOW
      roles: ["viewer"]
    - actions: ["edit", "delete"]
      effect: EFFECT_ALLOW
      roles: ["admin"]
```

### 5.2 Scope-Based Isolation

Using hierarchical scopes for tenant segregation:

```yaml
# Scoped policy with tenant hierarchy
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: order-policy
  scope: tenants.acme-corp.region-us
spec:
  resource: order
  rules:
    - actions: ["approve"]
      effect: EFFECT_ALLOW
      roles: ["manager"]
      condition:
        match:
          expr: resource.attr.amount <= 10000
```

### 5.3 Policy Resolution Order

```typescript
/**
 * Policy resolution with tenant precedence
 */
class TenantPolicyResolver {
  async resolvePolicies(
    tenantId: string,
    resourceKind: string
  ): Promise<Policy[]> {
    const policies: Policy[] = [];

    // 1. Tenant-specific policies (highest priority)
    const tenantPolicies = await this.loadTenantPolicies(tenantId, resourceKind);
    policies.push(...tenantPolicies);

    // 2. Shared base policies (lower priority)
    const basePolicies = await this.loadBasePolicies(resourceKind);
    policies.push(...basePolicies);

    // 3. Global default policies (lowest priority)
    const defaultPolicies = await this.loadDefaultPolicies(resourceKind);
    policies.push(...defaultPolicies);

    return this.deduplicateByPriority(policies);
  }

  private deduplicateByPriority(policies: Policy[]): Policy[] {
    const seen = new Set<string>();
    return policies.filter(p => {
      const key = `${p.resource}:${p.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
```

---

## 6. Configuration

### 6.1 Server Configuration

```yaml
# config.yaml
server:
  httpAddr: ":3592"
  grpcAddr: ":3593"

multiTenancy:
  enabled: true
  isolation: namespace  # 'namespace' or 'scope'
  tenantHeader: X-Tenant-ID
  tenantQueryParam: tenant_id  # Fallback
  defaultTenant: default
  requireTenant: true  # Reject requests without tenant

  # Tenant definitions
  tenants:
    - id: acme-corp
      name: ACME Corporation
      enabled: true
      policyNamespace: acme
      limits:
        maxPolicies: 100
        maxRequestsPerSecond: 1000
        maxPrincipalAttributes: 50
        maxResourceAttributes: 50
      settings:
        auditLevel: detailed
        strictValidation: true
        cacheTtlMs: 60000

    - id: widgets-inc
      name: Widgets Inc
      enabled: true
      policyNamespace: widgets
      limits:
        maxPolicies: 50
        maxRequestsPerSecond: 500
      settings:
        auditLevel: basic
        strictValidation: false

    - id: default
      name: Default Tenant
      enabled: true
      policyNamespace: default
      limits:
        maxRequestsPerSecond: 100

  # Shared resources configuration
  shared:
    basePoliciesPath: /policies/shared
    enableGlobalAdmin: true
    globalAdminRoles: ["super_admin"]
```

### 6.2 Policy Directory Structure

```
policies/
├── shared/                    # Shared base policies
│   ├── base-rbac.yaml
│   └── audit-logging.yaml
├── tenant-a/                  # ACME Corp policies
│   ├── document-policy.yaml
│   ├── user-policy.yaml
│   └── derived-roles.yaml
├── tenant-b/                  # Widgets Inc policies
│   ├── document-policy.yaml
│   └── order-policy.yaml
└── default/                   # Default tenant policies
    └── fallback-policy.yaml
```

---

## 7. Implementation

### 7.1 Tenant Router Implementation

```typescript
import { Request } from 'fastify';

class MultiTenantRouterImpl implements MultiTenantRouter {
  private tenantStore: TenantStore;
  private contextCache: Map<string, TenantContext> = new Map();
  private config: MultiTenancyConfig;

  constructor(config: MultiTenancyConfig, tenantStore: TenantStore) {
    this.config = config;
    this.tenantStore = tenantStore;
  }

  extractTenant(request: Request): string {
    // 1. Check header
    const headerTenant = request.headers[this.config.tenantHeader.toLowerCase()];
    if (headerTenant) {
      return Array.isArray(headerTenant) ? headerTenant[0] : headerTenant;
    }

    // 2. Check query parameter
    const queryTenant = request.query[this.config.tenantQueryParam];
    if (queryTenant) {
      return String(queryTenant);
    }

    // 3. Use default or reject
    if (this.config.requireTenant) {
      throw new TenantExtractionError(
        `Tenant ID required via header '${this.config.tenantHeader}' or query '${this.config.tenantQueryParam}'`
      );
    }

    return this.config.defaultTenant;
  }

  async getTenantContext(tenantId: string): Promise<TenantContext> {
    // Check cache first
    const cached = this.contextCache.get(tenantId);
    if (cached) {
      return cached;
    }

    // Load tenant configuration
    const config = await this.tenantStore.get(tenantId);
    if (!config) {
      throw new TenantNotFoundError(`Tenant '${tenantId}' not found`);
    }

    if (!config.enabled) {
      throw new TenantDisabledError(`Tenant '${tenantId}' is disabled`);
    }

    // Build context
    const context = await this.buildTenantContext(config);
    this.contextCache.set(tenantId, context);

    return context;
  }

  private async buildTenantContext(config: TenantConfig): Promise<TenantContext> {
    const [policies, derivedRoles, schemas] = await Promise.all([
      this.loadPolicies(config.policyNamespace),
      this.loadDerivedRoles(config.policyNamespace),
      this.loadSchemas(config.policyNamespace),
    ]);

    return {
      id: config.id,
      config,
      policies,
      derivedRoles,
      schemas,
      cache: new TenantCache(config.settings?.cacheTtlMs || 60000),
      rateLimiter: new RateLimiter(config.limits?.maxRequestsPerSecond || 1000),
    };
  }

  async route(tenantId: string, request: CheckRequest): Promise<CheckResponse> {
    const context = await this.getTenantContext(tenantId);

    // Validate limits
    this.validateLimits(tenantId, { tenantId, ...request });

    // Check rate limit
    if (!context.rateLimiter.tryAcquire()) {
      throw new TenantRateLimitError(
        `Rate limit exceeded for tenant '${tenantId}'`
      );
    }

    // Execute authorization check with tenant context
    return this.executeCheck(context, request);
  }

  validateLimits(tenantId: string, request: TenantRequest): void {
    const context = this.contextCache.get(tenantId);
    if (!context) return;

    const limits = context.config.limits;
    if (!limits) return;

    if (limits.maxPrincipalAttributes) {
      const attrCount = Object.keys(request.principal.attr || {}).length;
      if (attrCount > limits.maxPrincipalAttributes) {
        throw new TenantLimitExceededError(
          `Principal attributes (${attrCount}) exceeds limit (${limits.maxPrincipalAttributes})`
        );
      }
    }

    if (limits.maxResourceAttributes) {
      const attrCount = Object.keys(request.resource.attr || {}).length;
      if (attrCount > limits.maxResourceAttributes) {
        throw new TenantLimitExceededError(
          `Resource attributes (${attrCount}) exceeds limit (${limits.maxResourceAttributes})`
        );
      }
    }
  }
}
```

### 7.2 Per-Tenant Caching

```typescript
/**
 * Isolated cache instance per tenant
 */
class TenantCache {
  private cache: Map<string, CacheEntry> = new Map();
  private ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  set<T>(key: string, value: T): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  invalidate(pattern?: string): void {
    if (!pattern) {
      this.cache.clear();
      return;
    }

    const regex = new RegExp(pattern);
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  getStats(): CacheStats {
    return {
      size: this.cache.size,
      hitRate: this.calculateHitRate(),
    };
  }
}

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}
```

### 7.3 Rate Limiter

```typescript
/**
 * Token bucket rate limiter per tenant
 */
class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number;
  private lastRefill: number;

  constructor(requestsPerSecond: number) {
    this.maxTokens = requestsPerSecond;
    this.tokens = requestsPerSecond;
    this.refillRate = requestsPerSecond;
    this.lastRefill = Date.now();
  }

  tryAcquire(): boolean {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  getStats(): RateLimiterStats {
    return {
      availableTokens: this.tokens,
      maxTokens: this.maxTokens,
      refillRate: this.refillRate,
    };
  }
}
```

---

## 8. Shared vs Isolated Resources

### 8.1 Resource Classification

| Resource Type | Isolation | Rationale |
|--------------|-----------|-----------|
| Policies | Isolated | Core tenant data |
| Derived Roles | Isolated | Tenant-specific logic |
| Schemas | Isolated | Custom validation |
| CEL Runtime | Shared | Stateless, expensive to initialize |
| Base Policies | Shared | Common patterns |
| Global Admin | Shared | Cross-tenant management |
| Metrics | Per-tenant labels | Tenant-specific observability |
| Audit Logs | Isolated | Compliance requirement |

### 8.2 Shared Base Policies

```yaml
# policies/shared/base-rbac.yaml
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: base-rbac
  scope: shared
spec:
  resource: "*"
  rules:
    # Super admin bypass
    - actions: ["*"]
      effect: EFFECT_ALLOW
      roles: ["super_admin"]

    # Deny by default for unknown principals
    - actions: ["*"]
      effect: EFFECT_DENY
      condition:
        match:
          expr: principal.id == ""
```

### 8.3 Tenant Override Pattern

```typescript
/**
 * Merge tenant policies with base policies
 */
function mergePolicies(
  tenantPolicies: Policy[],
  basePolicies: Policy[]
): Policy[] {
  const merged: Policy[] = [...tenantPolicies];
  const tenantResources = new Set(tenantPolicies.map(p => p.resource));

  // Add base policies only for resources not defined by tenant
  for (const basePolicy of basePolicies) {
    if (!tenantResources.has(basePolicy.resource)) {
      merged.push({ ...basePolicy, priority: -1 }); // Lower priority
    }
  }

  return merged.sort((a, b) => (b.priority || 0) - (a.priority || 0));
}
```

---

## 9. Security Considerations

### 9.1 Cross-Tenant Access Prevention

```typescript
/**
 * Security middleware to prevent cross-tenant access
 */
class TenantSecurityMiddleware {
  async validateRequest(
    tenantId: string,
    request: CheckRequest
  ): Promise<void> {
    // Ensure principal belongs to tenant
    if (request.principal.attr?.tenantId !== tenantId) {
      throw new CrossTenantAccessError(
        `Principal tenant mismatch: expected '${tenantId}', got '${request.principal.attr?.tenantId}'`
      );
    }

    // Ensure resource belongs to tenant
    if (request.resource.attr?.tenantId &&
        request.resource.attr.tenantId !== tenantId) {
      throw new CrossTenantAccessError(
        `Resource tenant mismatch: expected '${tenantId}', got '${request.resource.attr.tenantId}'`
      );
    }
  }
}
```

### 9.2 Audit Separation

```typescript
interface TenantAuditConfig {
  /** Separate audit streams per tenant */
  separateStreams: boolean;
  /** Tenant-specific audit backend */
  backend: 'shared' | 'isolated';
  /** Redact cross-tenant references */
  redactCrossTenant: boolean;
}

class TenantAuditLogger {
  async logDecision(
    tenantId: string,
    decision: DecisionLogEntry
  ): Promise<void> {
    // Add tenant context
    const entry = {
      ...decision,
      tenant: {
        id: tenantId,
        namespace: this.getNamespace(tenantId),
      },
    };

    // Route to tenant-specific stream
    if (this.config.separateStreams) {
      await this.backends.get(tenantId)?.write(entry);
    } else {
      await this.sharedBackend.write(entry);
    }
  }
}
```

### 9.3 Threat Model

| Threat | Mitigation |
|--------|------------|
| Tenant ID spoofing | Validate against authenticated identity |
| Policy injection | Strict schema validation, namespace isolation |
| Resource exhaustion | Per-tenant rate limits and quotas |
| Cache poisoning | Per-tenant cache isolation |
| Data exfiltration | Audit logging, cross-tenant checks |

---

## 10. Performance Considerations

### 10.1 Per-Tenant Metrics

```typescript
const tenantMetrics = {
  requestsTotal: new Counter({
    name: 'authz_tenant_requests_total',
    help: 'Total requests by tenant',
    labelNames: ['tenant_id', 'effect'],
  }),

  latencyHistogram: new Histogram({
    name: 'authz_tenant_latency_seconds',
    help: 'Request latency by tenant',
    labelNames: ['tenant_id'],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1],
  }),

  cacheHitRate: new Gauge({
    name: 'authz_tenant_cache_hit_rate',
    help: 'Cache hit rate by tenant',
    labelNames: ['tenant_id'],
  }),

  rateLimitRemaining: new Gauge({
    name: 'authz_tenant_rate_limit_remaining',
    help: 'Remaining rate limit tokens',
    labelNames: ['tenant_id'],
  }),
};
```

### 10.2 Resource Pooling

```typescript
/**
 * Shared resource pool with tenant isolation
 */
class TenantResourcePool {
  private celRuntime: CelRuntime;
  private connectionPool: Pool;

  constructor() {
    // Shared CEL runtime (stateless)
    this.celRuntime = new CelRuntime();

    // Shared connection pool
    this.connectionPool = createPool({
      max: 100,
      min: 10,
    });
  }

  getCelRuntime(): CelRuntime {
    return this.celRuntime;
  }

  async getConnection(tenantId: string): Promise<Connection> {
    const conn = await this.connectionPool.acquire();
    // Tag connection with tenant for query isolation
    conn.setTenant(tenantId);
    return conn;
  }
}
```

### 10.3 Fair Scheduling

```typescript
/**
 * Fair request scheduling across tenants
 */
class FairScheduler {
  private queues: Map<string, RequestQueue> = new Map();
  private roundRobinIndex: number = 0;
  private tenantIds: string[] = [];

  enqueue(tenantId: string, request: PendingRequest): void {
    if (!this.queues.has(tenantId)) {
      this.queues.set(tenantId, new RequestQueue());
      this.tenantIds.push(tenantId);
    }
    this.queues.get(tenantId)!.push(request);
  }

  dequeue(): PendingRequest | undefined {
    if (this.tenantIds.length === 0) return undefined;

    // Round-robin across tenants
    for (let i = 0; i < this.tenantIds.length; i++) {
      const idx = (this.roundRobinIndex + i) % this.tenantIds.length;
      const tenantId = this.tenantIds[idx];
      const queue = this.queues.get(tenantId);

      if (queue && queue.length > 0) {
        this.roundRobinIndex = (idx + 1) % this.tenantIds.length;
        return queue.shift();
      }
    }

    return undefined;
  }
}
```

---

## 11. Error Handling

### 11.1 Tenant-Specific Errors

```typescript
class TenantError extends Error {
  constructor(
    message: string,
    public tenantId: string,
    public code: string
  ) {
    super(message);
    this.name = 'TenantError';
  }
}

class TenantNotFoundError extends TenantError {
  constructor(tenantId: string) {
    super(`Tenant '${tenantId}' not found`, tenantId, 'TENANT_NOT_FOUND');
  }
}

class TenantDisabledError extends TenantError {
  constructor(tenantId: string) {
    super(`Tenant '${tenantId}' is disabled`, tenantId, 'TENANT_DISABLED');
  }
}

class TenantExtractionError extends TenantError {
  constructor(message: string) {
    super(message, 'unknown', 'TENANT_EXTRACTION_FAILED');
  }
}

class TenantLimitExceededError extends TenantError {
  constructor(message: string, tenantId?: string) {
    super(message, tenantId || 'unknown', 'TENANT_LIMIT_EXCEEDED');
  }
}

class TenantRateLimitError extends TenantError {
  constructor(tenantId: string) {
    super(
      `Rate limit exceeded for tenant '${tenantId}'`,
      tenantId,
      'TENANT_RATE_LIMITED'
    );
  }
}

class CrossTenantAccessError extends TenantError {
  constructor(message: string) {
    super(message, 'unknown', 'CROSS_TENANT_ACCESS');
  }
}
```

---

## 12. Testing Strategy

### 12.1 Unit Tests

| Component | Coverage Target | Test File |
|-----------|-----------------|-----------|
| TenantRouter | 90% | `tenant-router.test.ts` |
| TenantCache | 90% | `tenant-cache.test.ts` |
| RateLimiter | 95% | `rate-limiter.test.ts` |
| PolicyResolver | 90% | `policy-resolver.test.ts` |

### 12.2 Integration Tests

| Scenario | Description |
|----------|-------------|
| Multi-tenant isolation | Verify policies don't leak between tenants |
| Rate limiting | Verify per-tenant rate limits |
| Cache isolation | Verify cache entries don't cross tenants |
| Tenant lifecycle | Create, update, disable, delete tenants |

### 12.3 Test Fixtures

```yaml
# tests/fixtures/multi-tenant.yaml
tenants:
  - id: test-tenant-a
    policyNamespace: test-a
    limits:
      maxRequestsPerSecond: 10
  - id: test-tenant-b
    policyNamespace: test-b
    limits:
      maxRequestsPerSecond: 10

testCases:
  - name: "Tenant A can access own resources"
    tenant: test-tenant-a
    request:
      principal: { id: "user-a", roles: ["editor"] }
      resource: { kind: "document", id: "doc-1" }
      action: "edit"
    expected: EFFECT_ALLOW

  - name: "Tenant A cannot access Tenant B resources"
    tenant: test-tenant-a
    request:
      principal: { id: "user-a", roles: ["editor"] }
      resource: { kind: "document", id: "doc-b", attr: { tenantId: "test-tenant-b" } }
      action: "edit"
    expected: ERROR_CROSS_TENANT
```

---

## 13. Related Documents

- [CORE-ARCHITECTURE-SDD.md](./CORE-ARCHITECTURE-SDD.md)
- [SERVER-PACKAGE-SDD.md](./SERVER-PACKAGE-SDD.md)
- [OBSERVABILITY-SDD.md](./OBSERVABILITY-SDD.md)
- [CERBOS-FEATURE-PARITY-SDD.md](./CERBOS-FEATURE-PARITY-SDD.md)

---

## 14. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-11-23 | Initial specification |
