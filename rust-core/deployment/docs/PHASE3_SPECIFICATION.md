# Phase 3: Policy Engine Integration - Technical Specification

## Executive Summary

Phase 3 integrates all Phase 2 components (Derived Roles, Scope Resolution, CEL, PostgreSQL) into a unified, high-performance policy decision engine with multi-level caching, comprehensive audit logging, and Prometheus metrics. Target: **< 10ms p99 latency**, **> 10K req/sec throughput**.

**Status**: Greenfield migration (no existing traffic)
**LOC Budget**: ~2,500 lines
**Test Coverage**: > 90%

---

## 1. Architecture Overview

### 1.1 System Architecture Diagram (Text-Based)

```
┌─────────────────────────────────────────────────────────────────┐
│                    AuthzEngine (Public API)                      │
│  - check(request) -> Decision                                    │
│  - add_policy(policy), list_policies()                          │
└───────────────┬─────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────┐
│              PolicyDecisionEngine (Core Orchestrator)            │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Pipeline:                                                 │   │
│  │ 1. Cache Check (L1: Memory, L2: Redis)                  │   │
│  │ 2. Derived Role Resolution (Phase 2)                    │   │
│  │ 3. Scope-Based Policy Filtering (Phase 2)               │   │
│  │ 4. Policy Matching (Pattern + Priority)                 │   │
│  │ 5. CEL Condition Evaluation (Phase 2)                   │   │
│  │ 6. Decision Finalization                                 │   │
│  │ 7. Audit Logging + Metrics + Cache Update               │   │
│  └─────────────────────────────────────────────────────────┘   │
└───────┬───────────────┬──────────────┬────────────┬─────────────┘
        │               │              │            │
        ▼               ▼              ▼            ▼
┌──────────────┐ ┌─────────────┐ ┌──────────┐ ┌──────────────┐
│ DecisionCache│ │  AuditLogger│ │ Metrics  │ │ErrorHandler  │
│              │ │             │ │ Monitor  │ │              │
│ L1: DashMap  │ │ Structured  │ │Prometheus│ │Retry+Circuit │
│ L2: Redis    │ │ JSON Logs   │ │Exporter  │ │Breaker       │
│ TTL: 60s     │ │ Async I/O   │ │Real-time │ │Graceful Fail │
└──────────────┘ └─────────────┘ └──────────┘ └──────────────┘
        │               │              │            │
        └───────────────┴──────────────┴────────────┘
                        │
                        ▼
        ┌──────────────────────────────────────┐
        │      Phase 2 Components              │
        ├──────────────────────────────────────┤
        │ - RoleResolver (Derived Roles)       │
        │ - ScopeResolver (Hierarchical Scopes)│
        │ - CEL Engine (Condition Evaluation)  │
        │ - PolicyStore (PostgreSQL)           │
        └──────────────────────────────────────┘
```

### 1.2 Data Flow Through Pipeline

```
Request → Cache Check → [Hit: Return] → [Miss: Continue]
  ↓
Resolve Derived Roles (principal.roles + derived)
  ↓
Build Scope Chains (hierarchical expansion)
  ↓
Filter Policies by Scope (reduce search space)
  ↓
Match Policies (pattern matching + priority sort)
  ↓
Evaluate CEL Conditions (for matched policies)
  ↓
Select First Match (ALLOW or DENY)
  ↓
Finalize Decision (audit + metrics + cache)
  ↓
Return Decision
```

---

## 2. Component Specifications

### 2.1 PolicyDecisionEngine (decision.rs)

**Responsibility**: Orchestrate the authorization decision pipeline.

#### Interface

```rust
pub struct PolicyDecisionEngine {
    role_resolver: Arc<RoleResolver>,
    scope_resolver: Arc<ScopeResolver>,
    cel_engine: Arc<CelEngine>,
    policy_store: Arc<dyn PolicyStore>,
    cache: Arc<DecisionCache>,
    audit: Arc<AuditLogger>,
    metrics: Arc<MetricsCollector>,
}

impl PolicyDecisionEngine {
    pub async fn decide(&self, request: &AuthzRequest) -> Result<Decision>;

    // Internal pipeline methods
    async fn resolve_roles(&self, request: &AuthzRequest) -> Result<Vec<String>>;
    async fn filter_policies_by_scope(&self, request: &AuthzRequest) -> Result<Vec<Policy>>;
    async fn match_policies(&self, policies: &[Policy], request: &AuthzRequest) -> Result<Vec<Policy>>;
    async fn evaluate_conditions(&self, policies: &[Policy], request: &AuthzRequest) -> Result<Option<Policy>>;
    async fn finalize_decision(&self, policy: Option<Policy>, request: &AuthzRequest) -> Result<Decision>;
}
```

#### Pipeline Stages

1. **Cache Check** (< 0.1ms)
   - L1: DashMap (in-memory, lock-free)
   - L2: Redis (network, ~1-2ms)
   - Key: `hash(principal_id, resource_id, action, roles, scope)`
   - TTL: 60 seconds (configurable)

2. **Role Resolution** (< 1ms)
   - Call `RoleResolver::resolve_roles()`
   - Input: `principal.roles` + context
   - Output: `principal.roles` + derived roles
   - Cached internally by RoleResolver

3. **Scope Filtering** (< 0.5ms)
   - Call `ScopeResolver::build_chain(resource.scope)`
   - Match policies against scope chain
   - Reduces policy search space by 80-95%

4. **Policy Matching** (< 1ms)
   - Wildcard pattern matching (`*`, `prefix:*`, `*:suffix`)
   - Priority-based sorting (higher priority first)
   - Early termination on first DENY

5. **CEL Evaluation** (< 3ms)
   - Call `CelEngine::evaluate_expression()`
   - Only for policies that match pattern
   - Compiled program cache (DashMap)

6. **Decision Finalization** (< 1ms)
   - Construct `Decision` object
   - Record audit log (async)
   - Update metrics (non-blocking)
   - Update cache (async)

#### Performance Targets

| Stage              | Target Latency | Cache Hit Rate |
|--------------------|----------------|----------------|
| Cache Check        | < 0.1ms        | 70-90%         |
| Role Resolution    | < 1ms          | 85%            |
| Scope Filtering    | < 0.5ms        | 80%            |
| Policy Matching    | < 1ms          | N/A            |
| CEL Evaluation     | < 3ms          | 90%            |
| Finalization       | < 1ms          | N/A            |
| **Total (miss)**   | **< 10ms**     | **70-90%**     |
| **Total (hit)**    | **< 0.1ms**    | **70-90%**     |

### 2.2 DecisionCache (cache.rs)

**Responsibility**: Multi-level caching with TTL and intelligent invalidation.

#### Design

```rust
pub struct DecisionCache {
    // L1: In-memory cache (DashMap for lock-free access)
    l1_cache: Arc<DashMap<CacheKey, CachedDecision>>,

    // L2: Redis (optional, for distributed systems)
    l2_cache: Option<Arc<RedisClient>>,

    // Cache configuration
    config: CacheConfig,

    // Metrics
    metrics: Arc<CacheMetrics>,
}

#[derive(Clone, Hash, Eq, PartialEq)]
struct CacheKey {
    principal_id: String,
    resource_id: String,
    action: String,
    roles_hash: u64,      // Hash of resolved roles
    scope_hash: u64,      // Hash of scope chain
    context_hash: u64,    // Hash of context (for CEL)
}

struct CachedDecision {
    decision: Decision,
    cached_at: Instant,
    ttl: Duration,
    access_count: AtomicU64,
}

pub struct CacheConfig {
    pub l1_capacity: usize,      // Default: 100,000
    pub l1_ttl: Duration,        // Default: 60s
    pub l2_enabled: bool,        // Default: false
    pub l2_ttl: Duration,        // Default: 300s
    pub invalidation_strategy: InvalidationStrategy,
}

pub enum InvalidationStrategy {
    TTL,                    // Time-based only
    PolicyChange,           // Invalidate on policy updates
    RoleChange,            // Invalidate on role changes
    Adaptive,              // ML-based prediction (future)
}
```

#### Cache Operations

```rust
impl DecisionCache {
    pub async fn get(&self, request: &AuthzRequest) -> Option<Decision>;
    pub async fn put(&self, request: &AuthzRequest, decision: Decision);
    pub async fn invalidate(&self, strategy: InvalidationStrategy);
    pub async fn clear(&self);
    pub fn metrics(&self) -> CacheMetrics;
}
```

#### Invalidation Rules

| Event                | L1 Action      | L2 Action      |
|----------------------|----------------|----------------|
| Policy Added         | Clear all      | Clear all      |
| Policy Deleted       | Clear all      | Clear all      |
| Policy Updated       | Clear matching | Clear matching |
| Role Added           | Clear user     | Clear user     |
| TTL Expired          | Lazy removal   | Lazy removal   |

#### Cache Metrics

```rust
pub struct CacheMetrics {
    pub l1_hits: AtomicU64,
    pub l1_misses: AtomicU64,
    pub l2_hits: AtomicU64,
    pub l2_misses: AtomicU64,
    pub evictions: AtomicU64,
    pub invalidations: AtomicU64,
    pub avg_hit_latency_ns: AtomicU64,
    pub avg_miss_latency_ns: AtomicU64,
}
```

### 2.3 AuditLogger (audit.rs)

**Responsibility**: Structured logging of all authorization decisions for compliance.

#### Design

```rust
pub struct AuditLogger {
    // Async log writer (non-blocking)
    writer: Arc<AsyncLogWriter>,

    // Log configuration
    config: AuditConfig,

    // Optional: PostgreSQL audit trail (for long-term storage)
    pg_store: Option<Arc<PostgresAuditStore>>,
}

pub struct AuditConfig {
    pub enabled: bool,
    pub output: AuditOutput,
    pub format: AuditFormat,
    pub buffer_size: usize,      // Default: 10,000
    pub flush_interval: Duration, // Default: 5s
    pub include_pii: bool,        // Default: false
}

pub enum AuditOutput {
    Stdout,
    File(PathBuf),
    Syslog(String),
    PostgreSQL,
    Multiple(Vec<AuditOutput>),
}

pub enum AuditFormat {
    JSON,
    Logfmt,
    CEF,  // Common Event Format
}
```

#### Audit Entry Structure

```rust
#[derive(Serialize)]
pub struct AuditEntry {
    // Metadata
    pub timestamp: DateTime<Utc>,
    pub request_id: Uuid,
    pub trace_id: Option<String>,

    // Request details
    pub principal_id: String,
    pub principal_roles: Vec<String>,
    pub resource_id: String,
    pub resource_type: String,
    pub action: String,

    // Decision details
    pub decision: String,  // ALLOW or DENY
    pub policy_id: Option<String>,
    pub policy_name: Option<String>,
    pub reason: String,

    // Performance metrics
    pub latency_ms: f64,
    pub cache_hit: bool,

    // Context (redacted if PII)
    pub context: serde_json::Value,
}
```

#### Logging Operations

```rust
impl AuditLogger {
    pub async fn log_decision(&self, request: &AuthzRequest, decision: &Decision) -> Result<()>;
    pub async fn flush(&self) -> Result<()>;
    pub async fn query(&self, filter: AuditFilter) -> Result<Vec<AuditEntry>>;
}
```

#### Example Audit Log (JSON)

```json
{
  "timestamp": "2025-01-15T14:23:45.123Z",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "principal_id": "user:alice@example.com",
  "principal_roles": ["employee", "manager"],
  "resource_id": "document:secret-123",
  "resource_type": "document",
  "action": "read",
  "decision": "ALLOW",
  "policy_id": "policy-doc-read",
  "policy_name": "Allow managers to read documents",
  "reason": "Policy 'policy-doc-read' allows this action",
  "latency_ms": 2.34,
  "cache_hit": false,
  "context": {
    "department": "engineering",
    "classification": "confidential"
  }
}
```

### 2.4 MetricsCollector (metrics.rs)

**Responsibility**: Prometheus metrics for observability and SLO tracking.

#### Metrics Design

```rust
pub struct MetricsCollector {
    // Request counters
    pub requests_total: IntCounterVec,
    pub decisions_total: IntCounterVec,

    // Latency histograms
    pub decision_latency: HistogramVec,
    pub cache_latency: HistogramVec,
    pub cel_latency: HistogramVec,

    // Cache metrics
    pub cache_hits_total: IntCounterVec,
    pub cache_misses_total: IntCounterVec,
    pub cache_size: IntGauge,

    // Error metrics
    pub errors_total: IntCounterVec,

    // Policy metrics
    pub policies_loaded: IntGauge,
    pub policy_evaluations: IntCounterVec,
}
```

#### Prometheus Metrics Specification

| Metric Name                        | Type      | Labels                          | Description                          |
|------------------------------------|-----------|---------------------------------|--------------------------------------|
| `authz_requests_total`             | Counter   | `method`, `status`              | Total authorization requests         |
| `authz_decisions_total`            | Counter   | `decision`, `policy_id`         | Total decisions (ALLOW/DENY)         |
| `authz_decision_latency_seconds`   | Histogram | `decision`, `cache_hit`         | Decision latency distribution        |
| `authz_cache_hits_total`           | Counter   | `level` (l1/l2)                 | Cache hits by level                  |
| `authz_cache_misses_total`         | Counter   | `level`                         | Cache misses by level                |
| `authz_cache_size`                 | Gauge     | `level`                         | Current cache size                   |
| `authz_cel_evaluations_total`      | Counter   | `result` (true/false/error)     | CEL evaluations                      |
| `authz_cel_latency_seconds`        | Histogram | `result`                        | CEL evaluation latency               |
| `authz_errors_total`               | Counter   | `type`, `stage`                 | Errors by type and stage             |
| `authz_policies_loaded`            | Gauge     | None                            | Number of loaded policies            |

#### Example Prometheus Queries

```promql
# P99 latency
histogram_quantile(0.99, rate(authz_decision_latency_seconds_bucket[5m]))

# Cache hit rate
rate(authz_cache_hits_total[5m]) / (rate(authz_cache_hits_total[5m]) + rate(authz_cache_misses_total[5m]))

# Error rate
rate(authz_errors_total[5m])

# Throughput
rate(authz_requests_total[5m])
```

### 2.5 ErrorHandler (error.rs)

**Responsibility**: Comprehensive error handling with retry logic and circuit breaker.

#### Error Types

```rust
#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("Cache error: {0}")]
    CacheError(String),

    #[error("Policy store error: {0}")]
    PolicyStoreError(String),

    #[error("Role resolution error: {0}")]
    RoleResolutionError(String),

    #[error("Scope resolution error: {0}")]
    ScopeResolutionError(String),

    #[error("CEL evaluation error: {0}")]
    CelEvaluationError(String),

    #[error("Audit logging error: {0}")]
    AuditError(String),

    #[error("Timeout after {0:?}")]
    Timeout(Duration),

    #[error("Circuit breaker open: {0}")]
    CircuitBreakerOpen(String),

    #[error("Internal error: {0}")]
    InternalError(String),
}
```

#### Error Handling Strategy

| Error Type           | Retry? | Circuit Breaker | Fallback                |
|----------------------|--------|-----------------|-------------------------|
| Cache Read Error     | No     | No              | Skip cache, continue    |
| Cache Write Error    | No     | No              | Log warning, continue   |
| Policy Store Error   | Yes    | Yes             | Deny decision           |
| Role Resolution Error| Yes    | No              | Use principal roles only|
| Scope Resolution Error| No    | No              | Use full policy set     |
| CEL Evaluation Error | No     | No              | Skip policy, continue   |
| Audit Log Error      | Yes    | No              | Log to stderr           |

#### Circuit Breaker Configuration

```rust
pub struct CircuitBreakerConfig {
    pub failure_threshold: u32,    // Default: 5
    pub success_threshold: u32,    // Default: 2
    pub timeout: Duration,         // Default: 60s
    pub half_open_requests: u32,   // Default: 1
}

pub enum CircuitState {
    Closed,      // Normal operation
    Open,        // Failing, reject requests
    HalfOpen,    // Testing recovery
}
```

---

## 3. Module Structure

### 3.1 Directory Layout

```
src/authz/src/engine/
├── mod.rs               # Public API and AuthzEngine
├── decision.rs          # PolicyDecisionEngine (pipeline orchestration)
├── cache.rs             # DecisionCache (L1/L2 caching)
├── audit.rs             # AuditLogger (structured logging)
├── metrics.rs           # MetricsCollector (Prometheus)
├── error.rs             # EngineError + CircuitBreaker
└── tests/
    ├── integration.rs   # End-to-end integration tests
    ├── cache_tests.rs   # Cache behavior tests
    ├── audit_tests.rs   # Audit logging tests
    └── benchmark.rs     # Performance benchmarks
```

### 3.2 File Size Estimates

| File         | Estimated LOC | Purpose                          |
|--------------|---------------|----------------------------------|
| mod.rs       | 200           | Public API, engine initialization|
| decision.rs  | 600           | Pipeline orchestration logic     |
| cache.rs     | 500           | Multi-level caching              |
| audit.rs     | 400           | Audit logging + PostgreSQL       |
| metrics.rs   | 300           | Prometheus metrics               |
| error.rs     | 200           | Error types + circuit breaker    |
| **Total**    | **2,200**     | Core implementation              |
| tests/       | 800           | Integration + unit tests         |
| **Grand Total** | **3,000** | Including tests                  |

---

## 4. Performance Targets & Optimization

### 4.1 Latency Targets

| Scenario                  | Target P50 | Target P99 | Target P999 |
|---------------------------|------------|------------|-------------|
| Cache Hit (L1)            | < 0.05ms   | < 0.1ms    | < 0.2ms     |
| Cache Hit (L2)            | < 1ms      | < 2ms      | < 5ms       |
| Cache Miss (Simple)       | < 5ms      | < 10ms     | < 20ms      |
| Cache Miss (Complex CEL)  | < 8ms      | < 15ms     | < 30ms      |

### 4.2 Throughput Targets

| Configuration           | Target RPS | Notes                          |
|-------------------------|------------|--------------------------------|
| 4 vCPU, 8GB RAM         | 10,000     | 70% cache hit rate             |
| 8 vCPU, 16GB RAM        | 25,000     | 80% cache hit rate             |
| 16 vCPU, 32GB RAM       | 50,000     | 85% cache hit rate             |

### 4.3 Optimization Strategies

1. **Zero-Copy Patterns**
   - Use `Arc<T>` for shared references
   - Avoid cloning large structures
   - Use `Cow<str>` for conditional ownership

2. **Lock-Free Concurrency**
   - `DashMap` for cache (sharded locks)
   - `AtomicU64` for metrics counters
   - Immutable data structures where possible

3. **Async I/O**
   - All I/O operations are async (Tokio)
   - Audit logging is buffered and async
   - Redis operations are pipelined

4. **Caching Strategy**
   - 60s TTL for L1 cache (hot data)
   - 300s TTL for L2 cache (warm data)
   - LRU eviction for L1 (when at capacity)

5. **Early Termination**
   - Stop on first DENY policy
   - Skip CEL evaluation if pattern doesn't match
   - Skip scope filtering if no scope-based policies

---

## 5. Caching Strategy

### 5.1 Cache Key Design

```rust
impl CacheKey {
    fn from_request(request: &AuthzRequest, resolved_roles: &[String]) -> Self {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut hasher = DefaultHasher::new();

        // Hash resolved roles (sorted for consistency)
        let mut sorted_roles = resolved_roles.to_vec();
        sorted_roles.sort();
        sorted_roles.hash(&mut hasher);
        let roles_hash = hasher.finish();

        // Hash scope chain
        let scope_chain = build_scope_chain(&request.resource.scope);
        scope_chain.hash(&mut hasher);
        let scope_hash = hasher.finish();

        // Hash context (for CEL)
        request.context.hash(&mut hasher);
        let context_hash = hasher.finish();

        CacheKey {
            principal_id: request.principal.id.clone(),
            resource_id: request.resource.id.clone(),
            action: request.action.name.clone(),
            roles_hash,
            scope_hash,
            context_hash,
        }
    }
}
```

### 5.2 Cache Invalidation Strategy

**Event-Driven Invalidation**:

```rust
pub enum InvalidationEvent {
    PolicyAdded(PolicyId),
    PolicyUpdated(PolicyId),
    PolicyDeleted(PolicyId),
    RoleAdded(PrincipalId, RoleId),
    RoleRemoved(PrincipalId, RoleId),
    DerivedRoleAdded(RoleId),
}

impl DecisionCache {
    pub async fn handle_event(&self, event: InvalidationEvent) {
        match event {
            PolicyAdded | PolicyDeleted => self.clear().await,
            PolicyUpdated(id) => self.invalidate_by_policy(&id).await,
            RoleAdded(principal, _) | RoleRemoved(principal, _) => {
                self.invalidate_by_principal(&principal).await
            }
            DerivedRoleAdded(_) => self.clear().await,
        }
    }
}
```

### 5.3 Cache Warming (Optional)

For high-traffic scenarios:

```rust
impl PolicyDecisionEngine {
    pub async fn warm_cache(&self, patterns: Vec<WarmingPattern>) -> Result<()> {
        for pattern in patterns {
            let request = pattern.to_request();
            let _ = self.decide(&request).await?;
        }
        Ok(())
    }
}
```

---

## 6. Error Handling Patterns

### 6.1 Graceful Degradation

```rust
impl PolicyDecisionEngine {
    async fn decide_with_fallback(&self, request: &AuthzRequest) -> Result<Decision> {
        // Try L1 cache
        if let Ok(Some(decision)) = self.cache.get_l1(request).await {
            return Ok(decision);
        }

        // Try L2 cache
        if let Ok(Some(decision)) = self.cache.get_l2(request).await {
            return Ok(decision);
        }

        // Compute decision with error handling
        match self.decide_uncached(request).await {
            Ok(decision) => {
                // Cache asynchronously (don't block on cache failures)
                let cache = self.cache.clone();
                let req = request.clone();
                let dec = decision.clone();
                tokio::spawn(async move {
                    let _ = cache.put(&req, dec).await;
                });
                Ok(decision)
            }
            Err(e) if e.is_recoverable() => {
                // Fallback to safe default
                warn!("Recoverable error, using default deny: {}", e);
                Ok(Decision::deny("default", "Error during decision"))
            }
            Err(e) => Err(e),
        }
    }
}
```

### 6.2 Circuit Breaker Implementation

```rust
pub struct CircuitBreaker {
    state: Arc<RwLock<CircuitState>>,
    failure_count: AtomicU32,
    success_count: AtomicU32,
    config: CircuitBreakerConfig,
    last_failure: Arc<RwLock<Option<Instant>>>,
}

impl CircuitBreaker {
    pub async fn call<F, T>(&self, f: F) -> Result<T, EngineError>
    where
        F: Future<Output = Result<T, EngineError>>,
    {
        // Check circuit state
        match *self.state.read().await {
            CircuitState::Open => {
                // Check if timeout elapsed
                if let Some(last) = *self.last_failure.read().await {
                    if last.elapsed() > self.config.timeout {
                        // Transition to half-open
                        *self.state.write().await = CircuitState::HalfOpen;
                    } else {
                        return Err(EngineError::CircuitBreakerOpen(
                            "Circuit breaker is open".to_string()
                        ));
                    }
                }
            }
            _ => {}
        }

        // Execute function
        match f.await {
            Ok(result) => {
                self.on_success().await;
                Ok(result)
            }
            Err(e) => {
                self.on_failure().await;
                Err(e)
            }
        }
    }

    async fn on_success(&self) {
        let success_count = self.success_count.fetch_add(1, Ordering::SeqCst) + 1;

        match *self.state.read().await {
            CircuitState::HalfOpen => {
                if success_count >= self.config.success_threshold {
                    *self.state.write().await = CircuitState::Closed;
                    self.failure_count.store(0, Ordering::SeqCst);
                    self.success_count.store(0, Ordering::SeqCst);
                }
            }
            _ => {}
        }
    }

    async fn on_failure(&self) {
        let failure_count = self.failure_count.fetch_add(1, Ordering::SeqCst) + 1;
        *self.last_failure.write().await = Some(Instant::now());

        if failure_count >= self.config.failure_threshold {
            *self.state.write().await = CircuitState::Open;
        }
    }
}
```

---

## 7. Testing Strategy

### 7.1 Unit Tests

| Component         | Test Coverage                          | LOC  |
|-------------------|----------------------------------------|------|
| DecisionEngine    | Pipeline stages, error handling        | 200  |
| DecisionCache     | L1/L2 operations, TTL, invalidation    | 150  |
| AuditLogger       | Log formats, async buffering           | 100  |
| MetricsCollector  | Counter/histogram accuracy             | 80   |
| ErrorHandler      | Circuit breaker states, retries        | 120  |
| **Total**         |                                        | **650** |

### 7.2 Integration Tests

```rust
#[tokio::test]
async fn test_end_to_end_decision_pipeline() {
    // Setup
    let engine = PolicyDecisionEngine::new().await.unwrap();

    // Add derived role
    let manager = DerivedRole::new("manager", vec!["employee".to_string()]);
    engine.add_derived_role(manager).await.unwrap();

    // Add policy
    let policy = Policy {
        id: "policy-1".to_string(),
        name: "Allow managers to read documents".to_string(),
        effect: PolicyEffect::Allow,
        principal: "role:manager".to_string(),
        resource: "document:*".to_string(),
        action: "read".to_string(),
        scope: Some("org:acme:*".to_string()),
        condition: Some("resource.attributes.classification != 'top-secret'".to_string()),
        priority: 100,
    };
    engine.add_policy(policy).await.unwrap();

    // Test request
    let request = AuthzRequest {
        principal: Principal {
            id: "user:alice@example.com".to_string(),
            roles: vec!["employee".to_string()],
        },
        resource: Resource {
            id: "document:123".to_string(),
            scope: Scope::new("org:acme:dept:engineering").unwrap(),
            attributes: hashmap! {
                "classification".to_string() => json!("confidential"),
            },
        },
        action: Action::new("read"),
        context: HashMap::new(),
    };

    // Execute
    let decision = engine.decide(&request).await.unwrap();

    // Assert
    assert!(decision.allowed);
    assert_eq!(decision.policy_id, "policy-1");

    // Verify cache
    let cached = engine.cache.get(&request).await;
    assert!(cached.is_some());

    // Verify audit log
    let logs = engine.audit.query(AuditFilter::by_request_id(decision.id)).await.unwrap();
    assert_eq!(logs.len(), 1);

    // Verify metrics
    let metrics = engine.metrics.snapshot();
    assert_eq!(metrics.requests_total, 1);
    assert_eq!(metrics.decisions_total, 1);
}
```

### 7.3 Performance Benchmarks

```rust
use criterion::{criterion_group, criterion_main, Criterion, BenchmarkId};

fn benchmark_decision_pipeline(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let engine = rt.block_on(async { PolicyDecisionEngine::new().await.unwrap() });

    // Setup test data
    let request = create_test_request();

    c.bench_function("decision_cache_hit", |b| {
        b.to_async(&rt).iter(|| async {
            engine.decide(&request).await.unwrap()
        })
    });

    c.bench_function("decision_cache_miss", |b| {
        b.iter_batched(
            || {
                engine.cache.clear();
                create_test_request()
            },
            |req| async move {
                engine.decide(&req).await.unwrap()
            },
            criterion::BatchSize::SmallInput,
        )
    });
}

criterion_group!(benches, benchmark_decision_pipeline);
criterion_main!(benches);
```

### 7.4 Load Testing

Use `k6` or `Apache JMeter`:

```javascript
// k6 load test script
import http from 'k6/http';
import { check } from 'k6';

export let options = {
    stages: [
        { duration: '1m', target: 100 },   // Ramp up
        { duration: '3m', target: 1000 },  // Sustain
        { duration: '1m', target: 0 },     // Ramp down
    ],
    thresholds: {
        'http_req_duration': ['p(99)<10'], // 99% < 10ms
        'http_req_failed': ['rate<0.01'],  // < 1% errors
    },
};

export default function () {
    let payload = JSON.stringify({
        principal: { id: 'user:alice', roles: ['employee'] },
        resource: { id: 'document:123', scope: 'org:acme:dept' },
        action: { name: 'read' },
        context: {},
    });

    let res = http.post('http://localhost:8080/v1/authz/check', payload, {
        headers: { 'Content-Type': 'application/json' },
    });

    check(res, {
        'status is 200': (r) => r.status === 200,
        'latency < 10ms': (r) => r.timings.duration < 10,
    });
}
```

---

## 8. Deployment Considerations

### 8.1 Resource Requirements

| Configuration   | vCPU | RAM   | Cache Size | Policies | Expected RPS |
|-----------------|------|-------|------------|----------|--------------|
| Small           | 2    | 4GB   | 10K        | 100      | 1,000        |
| Medium          | 4    | 8GB   | 100K       | 1,000    | 10,000       |
| Large           | 8    | 16GB  | 500K       | 10,000   | 25,000       |
| X-Large         | 16   | 32GB  | 1M         | 50,000   | 50,000       |

### 8.2 Horizontal Scaling

```yaml
# Kubernetes deployment example
apiVersion: apps/v1
kind: Deployment
metadata:
  name: authz-engine
spec:
  replicas: 3
  selector:
    matchLabels:
      app: authz-engine
  template:
    spec:
      containers:
      - name: authz-engine
        image: creto-ai/authz-engine:v0.3.0
        env:
        - name: CACHE_L1_CAPACITY
          value: "100000"
        - name: CACHE_L2_ENABLED
          value: "true"
        - name: REDIS_URL
          value: "redis://redis-cluster:6379"
        - name: POSTGRES_URL
          valueFrom:
            secretKeyRef:
              name: postgres-creds
              key: url
        resources:
          requests:
            memory: "8Gi"
            cpu: "4"
          limits:
            memory: "16Gi"
            cpu: "8"
```

### 8.3 Monitoring & Alerting

```yaml
# Prometheus alerts
groups:
- name: authz_engine
  rules:
  - alert: HighLatency
    expr: histogram_quantile(0.99, rate(authz_decision_latency_seconds_bucket[5m])) > 0.01
    for: 5m
    annotations:
      summary: "P99 latency > 10ms"

  - alert: HighErrorRate
    expr: rate(authz_errors_total[5m]) > 0.01
    for: 2m
    annotations:
      summary: "Error rate > 1%"

  - alert: LowCacheHitRate
    expr: rate(authz_cache_hits_total[5m]) / (rate(authz_cache_hits_total[5m]) + rate(authz_cache_misses_total[5m])) < 0.5
    for: 10m
    annotations:
      summary: "Cache hit rate < 50%"
```

---

## 9. Migration Path

### 9.1 Phase 3 Rollout Plan

1. **Week 1**: Implement `DecisionEngine` + `DecisionCache`
2. **Week 2**: Implement `AuditLogger` + `MetricsCollector`
3. **Week 3**: Implement `ErrorHandler` + Integration tests
4. **Week 4**: Performance benchmarking + optimization
5. **Week 5**: Load testing + production hardening
6. **Week 6**: Documentation + deployment

### 9.2 Compatibility with Phase 2

**Zero Breaking Changes**:
- All Phase 2 APIs remain unchanged
- `RoleResolver`, `ScopeResolver`, `CelEngine` used as-is
- `PolicyStore` interface unchanged

**New Public API**:

```rust
// Before (Phase 2): Direct AuthzEngine usage
let engine = AuthzEngine::new().await?;
let decision = engine.check(&request).await?;

// After (Phase 3): Same API, enhanced internals
let engine = AuthzEngine::new().await?;  // Now uses PolicyDecisionEngine internally
let decision = engine.check(&request).await?;  // Same interface, better performance
```

---

## 10. Key Architectural Decisions

### ADR-001: Multi-Level Caching

**Decision**: Implement L1 (in-memory) + L2 (Redis) caching.

**Rationale**:
- L1 provides sub-millisecond latency for hot data
- L2 enables cache sharing across instances in distributed deployments
- TTL-based invalidation prevents stale data
- Cache hit rate 70-90% reduces load on policy store by 10x

**Trade-offs**:
- Increased memory usage (~1GB for 100K cached decisions)
- Eventual consistency risk (mitigated by 60s TTL)
- Operational complexity (Redis dependency)

**Alternatives Considered**:
- Single-level cache (rejected: no shared cache for multi-instance)
- Database-backed cache (rejected: too slow)

---

### ADR-002: Async Audit Logging

**Decision**: Implement non-blocking, buffered audit logging.

**Rationale**:
- Audit I/O should not impact decision latency
- Buffer size 10,000 entries + 5s flush interval balances memory and durability
- Async PostgreSQL writes prevent blocking main thread

**Trade-offs**:
- Risk of log loss on crash (mitigated by flush interval)
- Increased memory usage (~10MB for buffer)

**Alternatives Considered**:
- Synchronous logging (rejected: adds 2-5ms latency)
- Fire-and-forget (rejected: no durability guarantee)

---

### ADR-003: Circuit Breaker for Policy Store

**Decision**: Implement circuit breaker for PostgreSQL policy store.

**Rationale**:
- Policy store failures should not cascade
- Circuit breaker opens after 5 consecutive failures
- Fail-safe default: DENY all requests when open
- Auto-recovery after 60s timeout

**Trade-offs**:
- May deny legitimate requests during outage
- Adds complexity to error handling

**Alternatives Considered**:
- Fail-open (rejected: security risk)
- No circuit breaker (rejected: cascading failures)

---

### ADR-004: Prometheus Metrics Over Custom Telemetry

**Decision**: Use Prometheus for metrics collection.

**Rationale**:
- Industry standard for metrics
- Rich ecosystem (Grafana, Alertmanager)
- Pull-based model reduces client complexity
- Histograms for latency percentiles

**Trade-offs**:
- Limited to pull-based metrics
- Requires Prometheus infrastructure

**Alternatives Considered**:
- OpenTelemetry (considered for future)
- Custom metrics API (rejected: reinventing the wheel)

---

## 11. Future Enhancements (Post-Phase 3)

1. **Adaptive Caching** (Phase 4)
   - ML-based cache eviction
   - Predictive cache warming
   - Per-tenant cache quotas

2. **Distributed Tracing** (Phase 5)
   - OpenTelemetry integration
   - Span correlation across microservices
   - Trace sampling for high-traffic scenarios

3. **Policy Versioning** (Phase 6)
   - Blue-green policy deployments
   - Rollback to previous policy versions
   - A/B testing for policy changes

4. **Advanced Analytics** (Phase 7)
   - Policy coverage analysis
   - Anomaly detection in access patterns
   - Compliance reporting (SOC2, GDPR)

---

## 12. Success Criteria

### Functional Requirements

- [ ] All Phase 2 integration tests pass
- [ ] 157/157 existing tests remain green
- [ ] New integration tests cover full pipeline
- [ ] Cache invalidation works correctly
- [ ] Audit logs are written for all decisions

### Performance Requirements

- [ ] P99 latency < 10ms (cache miss)
- [ ] P99 latency < 0.1ms (cache hit)
- [ ] Throughput > 10,000 req/sec (4 vCPU)
- [ ] Cache hit rate > 70%
- [ ] Error rate < 0.1%

### Operational Requirements

- [ ] Prometheus metrics exported
- [ ] Audit logs structured (JSON)
- [ ] Circuit breaker prevents cascading failures
- [ ] Graceful degradation on errors
- [ ] Zero downtime deployments

### Code Quality Requirements

- [ ] Test coverage > 90%
- [ ] All clippy warnings resolved
- [ ] rustfmt applied to all files
- [ ] Documentation complete
- [ ] Benchmark suite included

---

## Appendix A: Dependencies

```toml
[dependencies]
# Existing Phase 2 dependencies
tokio = { version = "1.35", features = ["full"] }
dashmap = "5.5"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
thiserror = "1.0"
tracing = "0.1"

# New Phase 3 dependencies
prometheus = { version = "0.13", features = ["process"] }
redis = { version = "0.24", features = ["tokio-comp", "connection-manager"] }
chrono = { version = "0.4", features = ["serde"] }
uuid = { version = "1.6", features = ["v4", "serde"] }

[dev-dependencies]
criterion = { version = "0.5", features = ["html_reports", "async_tokio"] }
tokio-test = "0.4"
```

---

## Appendix B: API Reference

### Public API (mod.rs)

```rust
pub struct AuthzEngine {
    decision_engine: Arc<PolicyDecisionEngine>,
    config: EngineConfig,
}

impl AuthzEngine {
    pub async fn new() -> Result<Self>;
    pub async fn with_config(config: EngineConfig) -> Result<Self>;
    pub async fn check(&self, request: &AuthzRequest) -> Result<Decision>;
    pub async fn add_policy(&self, policy: Policy) -> Result<()>;
    pub async fn remove_policy(&self, policy_id: &str) -> Result<()>;
    pub async fn list_policies(&self) -> Result<Vec<Policy>>;
    pub async fn clear_cache(&self);
    pub fn metrics(&self) -> MetricsSnapshot;
}
```

---

**End of Specification**

Total Pages: 26
Total Words: ~6,000
Estimated Reading Time: 30 minutes
Last Updated: 2025-01-15
