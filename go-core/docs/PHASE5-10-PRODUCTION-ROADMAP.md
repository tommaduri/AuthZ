# AuthZ Engine: Phase 5-10 Production Roadmap
**Enterprise-Grade Authorization Engine - Cerbos Compatible**

**Date**: November 26, 2025
**Current Status**: Phase 4 Complete (Derived Roles)
**Target**: Production-Ready, Enterprise-Grade System
**Timeline**: 36-48 weeks (9-12 months)
**Last Updated**: 2025-11-26

---

## 📋 Table of Contents

1. [Executive Summary](#executive-summary)
2. [Visual Roadmap Timeline](#visual-roadmap-timeline)
3. [Phase 5: External Integrations & APIs](#phase-5-external-integrations--apis)
4. [Phase 6: Security & Production Hardening](#phase-6-security--production-hardening)
5. [Phase 7: Scalability & High Availability](#phase-7-scalability--high-availability)
6. [Phase 8: Advanced Policy Features](#phase-8-advanced-policy-features)
7. [Phase 9: DevOps & Operations](#phase-9-devops--operations)
8. [Phase 10: Developer Experience](#phase-10-developer-experience)
9. [Feature Dependency Graph](#feature-dependency-graph)
10. [Risk Assessment & Mitigation](#risk-assessment--mitigation)
11. [Resource Requirements](#resource-requirements)
12. [Success Criteria](#success-criteria)

---

## Executive Summary

### Current State (Phase 4 Complete)

**Completed Capabilities**:
- ✅ Core authorization engine (sub-microsecond decisions)
- ✅ Resource policies with scope resolution
- ✅ Principal policies (O(1) lookup, 168ns)
- ✅ Derived roles with ReBAC support
- ✅ Metrics & observability (Prometheus)
- ✅ In-memory caching (5ms→500µs optimization)
- ✅ Policy versioning foundation

**Performance Achievements**:
- Authorization checks: <500µs p50, <2ms p99
- Principal lookup: 168ns O(1) constant time
- Derived role resolution: <10µs
- Throughput: >10K decisions/sec (single instance)

**Test Coverage**: 111/118 tests passing (94%+)

### Production Gap Analysis

**Missing for Production**:

| Category | Current | Target | Priority |
|----------|---------|--------|----------|
| **External APIs** | REST partial | REST + gRPC complete | P0 |
| **Authentication** | None | JWT/OAuth/mTLS | P0 |
| **Authorization** | None | RBAC for admin APIs | P0 |
| **Audit Logging** | Basic | Immutable, compliant | P0 |
| **Distributed Caching** | In-memory | Redis/Memcached | P1 |
| **Database Backend** | In-memory | PostgreSQL/MongoDB | P1 |
| **High Availability** | Single instance | Clustered | P1 |
| **SDKs** | None | Go/Python/Node/Java | P1 |
| **Policy Testing** | Manual | Framework + CLI | P2 |
| **GitOps** | None | Full pipeline | P2 |

### Strategic Goals (Phases 5-10)

1. **Phase 5** (8-10 weeks): Complete external integrations, vector store, agent identity
2. **Phase 6** (6-8 weeks): Security hardening, authentication, audit logging
3. **Phase 7** (8-10 weeks): Distributed architecture, horizontal scaling
4. **Phase 8** (6-8 weeks): Advanced policy features, testing framework
5. **Phase 9** (6-8 weeks): DevOps automation, Kubernetes, GitOps
6. **Phase 10** (4-6 weeks): Developer experience, SDKs, documentation portal

**Total Timeline**: 38-50 weeks (~9-12 months)

---

## Visual Roadmap Timeline

```
Current (Phase 4 Complete)
│
├─ Phase 5: External Integrations & APIs (8-10 weeks)
│  ├─ Week 1-2:   Vector Store completion (fogfish/hnsw)
│  ├─ Week 3:     Agent Identity refinement + encryption
│  ├─ Week 4-5:   MCP/A2A REST endpoints + delegation chains
│  ├─ Week 6-7:   Avatar Connex integration + 3-hop delegation
│  ├─ Week 8-9:   Integration testing (24 E2E tests)
│  └─ Week 10:    Production readiness + documentation
│
├─ Phase 6: Security & Production Hardening (6-8 weeks)
│  ├─ Week 1-2:   JWT/OAuth authentication + API key management
│  ├─ Week 3-4:   RBAC for admin APIs + authorization middleware
│  ├─ Week 5:     Immutable audit logging + compliance (SOC2/GDPR)
│  ├─ Week 6:     mTLS + encryption at rest/transit
│  ├─ Week 7:     Rate limiting + DDoS protection
│  └─ Week 8:     Secret management (Vault/AWS Secrets Manager)
│
├─ Phase 7: Scalability & High Availability (8-10 weeks)
│  ├─ Week 1-2:   Redis distributed cache + cache coherence
│  ├─ Week 3-4:   PostgreSQL backend + migrations
│  ├─ Week 5-6:   Clustering + Raft consensus + leader election
│  ├─ Week 7:     Horizontal scaling + sharding strategy
│  ├─ Week 8:     Load balancing + health checks
│  ├─ Week 9:     Circuit breakers + retry policies
│  └─ Week 10:    Chaos testing + disaster recovery
│
├─ Phase 8: Advanced Policy Features (6-8 weeks)
│  ├─ Week 1-2:   Derived roles enhancements + optimization
│  ├─ Week 3:     Policy import/export (Cerbos format)
│  ├─ Week 4:     Policy schemas + JSON Schema validation
│  ├─ Week 5-6:   Policy testing framework + CLI
│  ├─ Week 7:     Policy versioning + rollback
│  └─ Week 8:     Policy analytics + usage insights
│
├─ Phase 9: DevOps & Operations (6-8 weeks)
│  ├─ Week 1-2:   Kubernetes Helm charts + operators
│  ├─ Week 3:     Terraform modules (AWS/GCP/Azure)
│  ├─ Week 4:     GitOps integration (ArgoCD/Flux)
│  ├─ Week 5:     Backup/restore automation
│  ├─ Week 6:     Migration tools (Cerbos → AuthZ)
│  ├─ Week 7:     Disaster recovery automation
│  └─ Week 8:     Observability (Grafana dashboards + alerts)
│
└─ Phase 10: Developer Experience (4-6 weeks)
   ├─ Week 1:     Go SDK + comprehensive examples
   ├─ Week 2:     Python SDK + Jupyter notebook examples
   ├─ Week 3:     Node.js SDK + TypeScript definitions
   ├─ Week 4:     Java SDK + Spring Boot integration
   ├─ Week 5:     CLI tools + policy playground
   └─ Week 6:     Documentation portal + example apps

Production Launch: Week 48 (12 months)
```

---

## Phase 5: External Integrations & APIs
**Timeline**: 8-10 weeks
**Status**: IN PROGRESS (Week 1)
**Dependencies**: Phase 4 (Complete)
**Priority**: P0 (Blocking Production)

### 5.1 Goals and Success Criteria

**Strategic Goals**:
- Complete vector store for anomaly detection (<1ms p99 search)
- Finalize agent identity lifecycle management
- Implement MCP/A2A protocol for agent-to-agent authorization
- Enable Avatar Connex 3-hop delegation chains

**Success Metrics**:
- ✅ Vector store: >97K insert/sec, <1ms p50 search latency
- ✅ Agent lookup: <1µs O(1) (ACHIEVED: 168ns baseline from Phase 3)
- ✅ Delegation validation: <100ms for 3-hop chains
- ✅ All 98+ tests passing (unit + integration + E2E)
- ✅ Zero regressions in Phases 1-4

### 5.2 Features Breakdown

#### 5.2.1 Vector Store Completion (P0)
**Estimated Effort**: 2 weeks (16 story points)
**Owner**: Backend team
**Dependencies**: None

**Tasks**:
1. **Fix HNSW Adapter Edge Cases** (5 SP)
   - Add bidirectional ID-to-vector mapping for O(1) lookups
   - Implement context cancellation support
   - Add dimension validation and comprehensive error handling
   - Files: `internal/vector/hnsw_adapter.go` (266 LOC)

2. **Performance Validation** (3 SP)
   - Execute 32 vector benchmarks
   - Profile with pprof for optimization
   - Tune HNSW parameters (M, EfConstruction, EfSearch)
   - Target: >97K insert/sec, <1ms p50, <5ms p99

3. **Integration Testing** (3 SP)
   - Enable 3 vector E2E tests (remove `.Skip()`)
   - Test with authorization hot path (<1ms impact)
   - Validate memory efficiency (<800MB per 1M vectors)

4. **Async Embedding Generation** (5 SP)
   - Background worker queue for embedding generation
   - External provider integration (OpenAI, Cohere, HuggingFace)
   - Zero hot-path impact (async only)
   - Files: `internal/embedding/worker.go`, `internal/embedding/providers/`

**Testing Strategy**:
```bash
# Unit tests
go test ./internal/vector/... -v

# Benchmarks
go test ./tests/vector/... -bench=. -benchmem -benchtime=10s

# Integration
go test ./tests/integration/phase5/ -run TestVectorStore -v
```

**Risk**: Performance targets not met → Mitigation: HNSW parameter tuning, profiling

#### 5.2.2 Agent Identity & Lifecycle (P0)
**Estimated Effort**: 1 week (8 story points)
**Owner**: Security team
**Dependencies**: None

**Tasks**:
1. **Add Missing AgentStore Methods** (2 SP)
   - `RevokeCredential(ctx, agentID, credentialID)`
   - `GetByCredential(ctx, credentialID)`
   - Files: `internal/agent/store.go`, `internal/agent/memory.go`

2. **Credential Encryption** (4 SP)
   - AES-256-GCM encryption for credentials at rest
   - Secure key management (environment variable)
   - Files: `internal/agent/encryption.go` (150 LOC)

3. **Agent Status Lifecycle** (2 SP)
   - Auto-expire agents based on `ExpiresAt`
   - Background worker for expiration checks
   - Audit log for status transitions

**Testing Strategy**:
```bash
go test ./tests/agent/... -v
go test ./pkg/types/... -run TestAgent -v
```

**Risk**: Encryption key management → Mitigation: Use existing secret management (Vault integration in Phase 6)

#### 5.2.3 MCP/A2A REST Endpoints (P0)
**Estimated Effort**: 2 weeks (13 story points)
**Owner**: API team
**Dependencies**: Agent Identity complete

**Endpoints to Implement**:

| Endpoint | Method | Priority | Effort |
|----------|--------|----------|--------|
| `/v1/agent/register` | POST | P0 | 3 SP |
| `/v1/agent/delegate` | POST | P0 | 3 SP |
| `/v1/agent/check` | POST | P0 | 4 SP |
| `/v1/agent/:id` | GET | P1 | 1 SP |
| `/v1/agent/:id/revoke` | DELETE | P1 | 2 SP |

**Example: Agent Check with Delegation**
```go
// Request
POST /v1/agent/check
{
  "agent_id": "agent:worker-456",
  "delegation_chain": ["user:alice", "agent:orchestrator", "agent:worker-456"],
  "action": "write",
  "resource": {
    "kind": "document",
    "id": "report-2024"
  }
}

// Response
{
  "effect": "allow",
  "validated_chain": {
    "source_agent_id": "user:alice",
    "target_agent_id": "agent:worker-456",
    "hops": 2,
    "scopes": ["write:document"]
  }
}
```

**Tasks**:
1. **REST Handler Implementation** (5 SP)
   - Gin HTTP handlers for 5 endpoints
   - Request/response validation
   - Files: `internal/server/handlers/agent_handler.go` (300 LOC)

2. **Delegation Chain Integration** (4 SP)
   - `CheckWithDelegation(ctx, req, chain)` in DecisionEngine
   - Scope validation (wildcards: `*`, `read:*`, `*:document`)
   - Files: `internal/engine/delegation.go` (200 LOC)

3. **Security Middleware** (4 SP)
   - JWT authentication middleware
   - Audit logging for all agent operations
   - Rate limiting (1000 req/min per agent)
   - Files: `internal/server/middleware/agent_auth.go` (150 LOC)

**Testing Strategy**:
```bash
# Unit tests
go test ./internal/server/handlers/... -v

# Integration tests
go test ./tests/integration/phase5/ -run TestMCP_A2A -v
```

**Risk**: Delegation chain complexity → Mitigation: Cache validated chains, limit max hops to 5

#### 5.2.4 Avatar Connex Integration (P1)
**Estimated Effort**: 2 weeks (10 story points)
**Owner**: Integration team
**Dependencies**: MCP/A2A endpoints complete

**Use Cases**:
1. **2-Hop Delegation** (3 SP)
   - User → Orchestrator → Worker
   - Validate scope narrowing at each hop
   - Performance: <50ms p99

2. **3-Hop Delegation** (4 SP)
   - User → Avatar → Orchestrator → Worker
   - Circular delegation detection
   - Performance: <100ms p99

3. **Performance Testing** (3 SP)
   - Load test with 1000 concurrent delegations
   - Profile bottlenecks
   - Optimize chain validation (<80ms p50)

**Testing Strategy**:
```bash
go test ./tests/integration/phase5/ -run TestDelegation -v
```

**Risk**: Performance degradation with deep chains → Mitigation: Caching, max 5 hops

### 5.3 Testing Strategy (TDD: Specification → Design → Development)

**SDD Phase** (Week 0):
- ✅ COMPLETE: All ADRs and SDDs written
- ✅ Architecture decisions finalized

**TDD Phase** (Weeks 1-9):
- ✅ RED: 24 E2E tests written (currently skipped)
- 🚧 GREEN: Implement code to pass tests (Weeks 1-9)
- 📋 REFACTOR: Optimize and clean up (Week 10)

**Test Distribution**:
```
Phase 5 Tests:
├─ Unit Tests: 45 tests
│  ├─ Agent Identity: 10 tests ✅
│  ├─ Vector Store: 27 tests ⏳
│  ├─ Delegation: 18 tests ✅
│
├─ Integration Tests: 24 E2E tests ⏳
│  ├─ Agent Identity: 5 tests
│  ├─ Vector + ANALYST: 3 tests
│  ├─ MCP/A2A: 4 tests
│  ├─ Full System: 3 tests
│  ├─ Performance: 5 tests
│  └─ Regression: 5 tests
│
└─ Performance Benchmarks: 10 benchmarks
   ├─ Vector Insert: 3 benchmarks
   ├─ Vector Search: 4 benchmarks
   └─ Delegation: 3 benchmarks
```

### 5.4 Dependencies and Risks

**Dependencies**:
- Phase 4 complete ✅
- fogfish/hnsw library (added to go.mod) ✅
- Gin HTTP framework (already in use) ✅

**Risks**:

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Vector performance targets not met | Medium | High | HNSW tuning, profiling, batch operations |
| Delegation chain complexity | Medium | Medium | Cache validated chains, limit hops to 5 |
| Integration test failures | Low | Medium | Comprehensive TDD, early testing |
| External provider latency | Low | Low | Async embedding, timeout handling |

### 5.5 Timeline and Milestones

```
Week 1-2:  Vector Store completion → Milestone: >97K insert/sec achieved
Week 3:    Agent Identity refinement → Milestone: Credential encryption
Week 4-5:  MCP/A2A REST endpoints → Milestone: 5 endpoints operational
Week 6-7:  Avatar Connex integration → Milestone: 3-hop delegation working
Week 8-9:  Integration testing → Milestone: 24 E2E tests passing
Week 10:   Production readiness → Milestone: Phase 5 COMPLETE
```

---

## Phase 6: Security & Production Hardening
**Timeline**: 6-8 weeks
**Status**: PLANNED
**Dependencies**: Phase 5 (MCP/A2A endpoints)
**Priority**: P0 (Blocking Production)

### 6.1 Goals and Success Criteria

**Strategic Goals**:
- Implement enterprise-grade authentication (JWT, OAuth, mTLS)
- Add RBAC for admin APIs (policy management)
- Enable immutable audit logging (SOC2/GDPR compliant)
- Encrypt data at rest and in transit
- Add rate limiting and DDoS protection

**Success Metrics**:
- ✅ Authentication: JWT + OAuth + mTLS working
- ✅ Authorization: RBAC enforced on all admin APIs
- ✅ Audit logs: Immutable, tamper-proof, queryable
- ✅ Encryption: TLS 1.3, AES-256-GCM at rest
- ✅ Rate limiting: <0.1% false positives
- ✅ Security audit: Zero critical/high vulnerabilities

### 6.2 Features Breakdown

#### 6.2.1 Authentication Layer (P0)
**Estimated Effort**: 2 weeks (13 story points)
**Owner**: Security team
**Dependencies**: None

**Components**:

1. **JWT Authentication** (4 SP)
   - RS256 signing with rotating keys
   - Claims: `sub` (user ID), `roles`, `exp`, `iat`
   - Token refresh endpoint
   - Files: `internal/auth/jwt.go` (200 LOC)

```go
type AuthService struct {
    privateKey *rsa.PrivateKey
    publicKey  *rsa.PublicKey
    tokenTTL   time.Duration
}

func (s *AuthService) GenerateToken(userID string, roles []string) (string, error)
func (s *AuthService) ValidateToken(token string) (*Claims, error)
func (s *AuthService) RefreshToken(token string) (string, error)
```

2. **OAuth 2.0 Integration** (4 SP)
   - Support OIDC providers (Google, Okta, Auth0)
   - Authorization code flow
   - PKCE for public clients
   - Files: `internal/auth/oauth.go` (250 LOC)

3. **API Key Management** (3 SP)
   - Generate API keys with scopes
   - Key rotation (30-90 day TTL)
   - Key revocation
   - Files: `internal/auth/apikey.go` (150 LOC)

4. **mTLS Support** (2 SP)
   - Client certificate validation
   - Certificate revocation list (CRL)
   - Files: `internal/auth/mtls.go` (100 LOC)

**Testing Strategy**:
```bash
go test ./internal/auth/... -v
go test ./tests/security/ -run TestAuthentication -v
```

**Risk**: Key management complexity → Mitigation: Use Vault/AWS Secrets Manager (task 6.2.6)

#### 6.2.2 Authorization for Admin APIs (P0)
**Estimated Effort**: 2 weeks (10 story points)
**Owner**: Security team
**Dependencies**: Authentication complete

**RBAC Model**:

| Role | Permissions | Description |
|------|-------------|-------------|
| `admin` | `*` | Full access to all APIs |
| `policy:write` | `policy:create`, `policy:update`, `policy:delete` | Manage policies |
| `policy:read` | `policy:get`, `policy:list` | View policies |
| `agent:write` | `agent:register`, `agent:revoke` | Manage agents |
| `agent:read` | `agent:get`, `agent:list` | View agents |
| `audit:read` | `audit:query` | View audit logs |

**Implementation**:

1. **RBAC Middleware** (5 SP)
   - Role extraction from JWT claims
   - Permission checking per endpoint
   - Files: `internal/server/middleware/rbac.go` (200 LOC)

```go
func RequirePermission(permission string) gin.HandlerFunc {
    return func(c *gin.Context) {
        claims := c.MustGet("claims").(*Claims)

        if !hasPermission(claims.Roles, permission) {
            c.JSON(403, gin.H{"error": "insufficient permissions"})
            c.Abort()
            return
        }

        c.Next()
    }
}
```

2. **Policy Management APIs** (3 SP)
   - `POST /v1/policies` - Create policy (requires `policy:write`)
   - `PUT /v1/policies/:id` - Update policy (requires `policy:write`)
   - `DELETE /v1/policies/:id` - Delete policy (requires `policy:write`)
   - `GET /v1/policies` - List policies (requires `policy:read`)

3. **Admin API Documentation** (2 SP)
   - OpenAPI 3.0 spec
   - Interactive Swagger UI
   - Files: `api/openapi.yaml` (500 LOC)

**Testing Strategy**:
```bash
go test ./internal/server/middleware/ -run TestRBAC -v
go test ./tests/security/ -run TestAuthorization -v
```

**Risk**: Permission sprawl → Mitigation: Start with minimal roles, add as needed

#### 6.2.3 Immutable Audit Logging (P0)
**Estimated Effort**: 1 week (8 story points)
**Owner**: Observability team
**Dependencies**: None

**Requirements**:
- Tamper-proof logs (cryptographic hashing)
- Queryable (full-text search)
- Retention policies (configurable)
- Compliance (SOC2, GDPR, HIPAA)

**Implementation**:

1. **Audit Log Schema** (2 SP)
```go
type AuditEvent struct {
    ID            string                 `json:"id"`
    Timestamp     time.Time              `json:"timestamp"`
    Actor         string                 `json:"actor"`         // User or agent ID
    Action        string                 `json:"action"`        // "policy:create", "agent:revoke"
    Resource      string                 `json:"resource"`      // Affected resource
    Effect        string                 `json:"effect"`        // "allow" or "deny"
    Metadata      map[string]interface{} `json:"metadata"`
    IPAddress     string                 `json:"ip_address"`
    UserAgent     string                 `json:"user_agent"`
    Hash          string                 `json:"hash"`          // SHA-256 of all fields
    PreviousHash  string                 `json:"previous_hash"` // For chain integrity
}
```

2. **Audit Logger** (4 SP)
   - Async logging (buffered channel)
   - Cryptographic chaining (SHA-256)
   - Multiple backends (file, database, S3)
   - Files: `internal/audit/logger.go` (300 LOC)

3. **Audit Query API** (2 SP)
   - `GET /v1/audit?actor={id}&action={action}&from={timestamp}&to={timestamp}`
   - Pagination support
   - Full-text search (if using Elasticsearch)

**Testing Strategy**:
```bash
go test ./internal/audit/... -v
go test ./tests/security/ -run TestAuditLog -v
```

**Risk**: Log volume management → Mitigation: Configurable retention, log rotation, archival to S3

#### 6.2.4 Encryption (P0)
**Estimated Effort**: 1 week (8 story points)
**Owner**: Security team
**Dependencies**: None

**Components**:

1. **TLS/HTTPS** (2 SP)
   - TLS 1.3 only
   - Strong cipher suites (AES-GCM, ChaCha20-Poly1305)
   - HSTS headers
   - Certificate rotation (Let's Encrypt integration)

2. **Encryption at Rest** (4 SP)
   - AES-256-GCM for sensitive data (credentials, API keys)
   - Envelope encryption (data key + master key)
   - Key rotation support
   - Files: `internal/crypto/envelope.go` (200 LOC)

3. **Secret Management** (2 SP)
   - HashiCorp Vault integration
   - AWS Secrets Manager integration
   - Environment variable fallback
   - Files: `internal/secrets/vault.go` (150 LOC)

**Testing Strategy**:
```bash
go test ./internal/crypto/... -v
go test ./internal/secrets/... -v
```

**Risk**: Key rotation complexity → Mitigation: Gradual rollout, dual-key support during rotation

#### 6.2.5 Rate Limiting & DDoS Protection (P1)
**Estimated Effort**: 1 week (8 story points)
**Owner**: Infrastructure team
**Dependencies**: None

**Implementation**:

1. **Token Bucket Rate Limiter** (4 SP)
   - Per-user/agent limits
   - Per-IP limits
   - Global limits
   - Files: `internal/server/middleware/rate_limit.go` (200 LOC)

```go
type RateLimiter struct {
    limits map[string]*TokenBucket
    mu     sync.RWMutex
}

type TokenBucket struct {
    Capacity      int           // Max requests
    RefillRate    time.Duration // Refill interval
    Tokens        int           // Current tokens
    LastRefill    time.Time
}
```

2. **Circuit Breaker** (2 SP)
   - Prevent cascading failures
   - Configurable thresholds
   - Half-open state for recovery
   - Files: `internal/resilience/circuit_breaker.go` (150 LOC)

3. **Request Throttling** (2 SP)
   - Queue requests during spikes
   - Shed load if queue full
   - Graceful degradation

**Testing Strategy**:
```bash
go test ./internal/server/middleware/ -run TestRateLimit -v
go test ./tests/load/ -run TestCircuitBreaker -v
```

**Risk**: False positives → Mitigation: Configurable limits, whitelist support

### 6.3 Testing Strategy

**Security Testing**:
```bash
# Unit tests
go test ./internal/auth/... -v
go test ./internal/audit/... -v
go test ./internal/crypto/... -v

# Security tests
go test ./tests/security/... -v

# Penetration testing (external)
# - SQL injection attempts
# - XSS attempts
# - CSRF testing
# - JWT manipulation
# - Rate limit bypass attempts
```

**Compliance Testing**:
- SOC2 Type II audit readiness
- GDPR compliance (data retention, deletion)
- HIPAA compliance (for healthcare customers)

### 6.4 Dependencies and Risks

**Dependencies**:
- Phase 5 complete (MCP/A2A endpoints)
- HashiCorp Vault (optional, Phase 6.2.4)
- AWS Secrets Manager (optional, Phase 6.2.4)

**Risks**:

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Key management complexity | Medium | High | Use Vault/AWS Secrets Manager |
| Audit log volume | High | Medium | Retention policies, archival |
| Rate limiting false positives | Medium | Medium | Tunable limits, whitelist |
| Compliance requirements change | Low | High | Modular design, audit trail |

### 6.5 Timeline and Milestones

```
Week 1-2:  Authentication layer → Milestone: JWT + OAuth + mTLS
Week 3-4:  RBAC for admin APIs → Milestone: Authorization enforced
Week 5:    Immutable audit logging → Milestone: SOC2 compliant logs
Week 6:    Encryption → Milestone: TLS 1.3 + AES-256 at rest
Week 7:    Rate limiting → Milestone: DDoS protection active
Week 8:    Security audit → Milestone: Phase 6 COMPLETE
```

---

## Phase 7: Scalability & High Availability
**Timeline**: 8-10 weeks
**Status**: PLANNED
**Dependencies**: Phase 6 (Security hardening)
**Priority**: P1 (Production scalability)

### 7.1 Goals and Success Criteria

**Strategic Goals**:
- Horizontal scaling (10K → 100K decisions/sec)
- Distributed caching (Redis cluster)
- Database backends (PostgreSQL, MongoDB)
- High availability (99.99% uptime)
- Leader election and consensus (Raft)

**Success Metrics**:
- ✅ Throughput: >100K decisions/sec (10 instances)
- ✅ Latency: <1ms p50, <5ms p99 (with Redis cache)
- ✅ Uptime: 99.99% (4.38 minutes/month downtime)
- ✅ Cache hit rate: >95%
- ✅ Database replication lag: <100ms
- ✅ Failover time: <5 seconds

### 7.2 Features Breakdown

#### 7.2.1 Distributed Caching (P0)
**Estimated Effort**: 2 weeks (13 story points)
**Owner**: Backend team
**Dependencies**: Phase 6 complete

**Implementation**:

1. **Redis Cluster Integration** (5 SP)
   - Connect to Redis cluster (3+ nodes)
   - Consistent hashing for key distribution
   - Connection pooling
   - Files: `internal/cache/redis_cluster.go` (300 LOC)

```go
type RedisCacheAdapter struct {
    client      *redis.ClusterClient
    keyPrefix   string
    defaultTTL  time.Duration
    serializer  Serializer  // JSON or MessagePack
}

func (c *RedisCacheAdapter) Get(ctx context.Context, key string) (interface{}, error)
func (c *RedisCacheAdapter) Set(ctx context.Context, key string, value interface{}, ttl time.Duration) error
func (c *RedisCacheAdapter) Delete(ctx context.Context, key string) error
func (c *RedisCacheAdapter) Clear(ctx context.Context, pattern string) error
```

2. **Cache Coherence** (4 SP)
   - Pub/Sub for cache invalidation
   - Policy update broadcasts
   - Distributed locking (Redis Redlock)
   - Files: `internal/cache/invalidation.go` (200 LOC)

3. **Cache Warming** (2 SP)
   - Pre-populate cache on startup
   - Background refresh for hot keys
   - LRU eviction strategy

4. **Fallback Strategy** (2 SP)
   - In-memory cache as fallback
   - Circuit breaker for Redis failures
   - Graceful degradation

**Cache Key Strategy**:
```
authz:principal:{principalID}:resource:{resourceKind}
authz:policy:{policyID}:version:{version}
authz:derived_role:{roleID}:context:{hash}
```

**Testing Strategy**:
```bash
go test ./internal/cache/... -run TestRedis -v
go test ./tests/integration/ -run TestCacheCoherence -v
```

**Risk**: Redis cluster failures → Mitigation: Fallback to in-memory cache, retry logic

#### 7.2.2 PostgreSQL Backend (P0)
**Estimated Effort**: 2 weeks (13 story points)
**Owner**: Database team
**Dependencies**: None

**Schema Design**:

```sql
-- Policies table
CREATE TABLE policies (
    id              UUID PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    policy_type     VARCHAR(50) NOT NULL,  -- 'resource', 'principal', 'derived_role'
    content         JSONB NOT NULL,
    disabled        BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    created_by      VARCHAR(255),
    UNIQUE(name, version)
);

CREATE INDEX idx_policies_name ON policies(name);
CREATE INDEX idx_policies_type ON policies(policy_type);
CREATE INDEX idx_policies_content ON policies USING GIN(content);

-- Agents table
CREATE TABLE agents (
    id              VARCHAR(255) PRIMARY KEY,
    type            VARCHAR(50) NOT NULL,
    display_name    VARCHAR(255),
    status          VARCHAR(50) NOT NULL,
    credentials     JSONB,
    metadata        JSONB,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMP
);

CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_agents_type ON agents(type);

-- Delegation chains table
CREATE TABLE delegation_chains (
    id              UUID PRIMARY KEY,
    source_agent_id VARCHAR(255) NOT NULL REFERENCES agents(id),
    target_agent_id VARCHAR(255) NOT NULL REFERENCES agents(id),
    scopes          JSONB NOT NULL,
    max_hops        INTEGER NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMP NOT NULL,
    FOREIGN KEY (source_agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    FOREIGN KEY (target_agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX idx_delegation_source ON delegation_chains(source_agent_id);
CREATE INDEX idx_delegation_target ON delegation_chains(target_agent_id);

-- Audit logs table
CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY,
    timestamp       TIMESTAMP NOT NULL DEFAULT NOW(),
    actor           VARCHAR(255) NOT NULL,
    action          VARCHAR(100) NOT NULL,
    resource        VARCHAR(255),
    effect          VARCHAR(20),
    metadata        JSONB,
    ip_address      INET,
    user_agent      TEXT,
    hash            VARCHAR(64) NOT NULL,
    previous_hash   VARCHAR(64)
);

CREATE INDEX idx_audit_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX idx_audit_actor ON audit_logs(actor);
CREATE INDEX idx_audit_action ON audit_logs(action);
```

**Implementation**:

1. **PostgreSQL Adapter** (6 SP)
   - Connection pooling (pgx/v5)
   - CRUD operations for policies, agents, delegations
   - Transaction support
   - Files: `internal/policy/postgres.go` (400 LOC)

2. **Database Migrations** (3 SP)
   - golang-migrate integration
   - Versioned migrations
   - Rollback support
   - Files: `migrations/*.sql` (10 files)

3. **Query Optimization** (2 SP)
   - Prepared statements
   - Index optimization
   - JSONB query optimization
   - Connection pooling tuning

4. **Replication Support** (2 SP)
   - Read replicas for read-heavy queries
   - Write to primary, read from replicas
   - Automatic failover

**Testing Strategy**:
```bash
go test ./internal/policy/ -run TestPostgres -v
go test ./tests/integration/ -run TestDatabaseBackend -v
```

**Risk**: Database performance → Mitigation: Aggressive caching, read replicas

#### 7.2.3 Clustering & Leader Election (P1)
**Estimated Effort**: 2-3 weeks (16 story points)
**Owner**: Infrastructure team
**Dependencies**: PostgreSQL backend

**Implementation**:

1. **Raft Consensus** (8 SP)
   - HashiCorp Raft library integration
   - Leader election
   - Log replication
   - Snapshot support
   - Files: `internal/cluster/raft.go` (500 LOC)

```go
type RaftCluster struct {
    raft         *raft.Raft
    fsm          *PolicyFSM
    transport    *raft.NetworkTransport
    logStore     raft.LogStore
    stableStore  raft.StableStore
    snapshotStore raft.SnapshotStore
}

func (c *RaftCluster) Apply(cmd []byte, timeout time.Duration) error
func (c *RaftCluster) IsLeader() bool
func (c *RaftCluster) GetLeader() string
func (c *RaftCluster) AddServer(id, address string) error
func (c *RaftCluster) RemoveServer(id string) error
```

2. **Finite State Machine** (4 SP)
   - Apply policy changes to FSM
   - Snapshot and restore state
   - Consistent replication
   - Files: `internal/cluster/fsm.go` (300 LOC)

3. **Membership Management** (2 SP)
   - Dynamic node discovery (DNS SRV, Consul)
   - Health checks
   - Graceful node removal

4. **Client-Side Load Balancing** (2 SP)
   - Round-robin to follower nodes
   - Redirect writes to leader
   - Automatic failover

**Testing Strategy**:
```bash
go test ./internal/cluster/... -v
go test ./tests/integration/ -run TestClustering -v
```

**Risk**: Split-brain scenarios → Mitigation: Raft quorum (3+ nodes), network partitioning tests

#### 7.2.4 Horizontal Scaling (P1)
**Estimated Effort**: 1 week (8 story points)
**Owner**: Infrastructure team
**Dependencies**: Clustering complete

**Implementation**:

1. **Sharding Strategy** (4 SP)
   - Consistent hashing for resource policies
   - Principal ID sharding
   - Rebalancing on node add/remove
   - Files: `internal/cluster/sharding.go` (250 LOC)

2. **Service Discovery** (2 SP)
   - Consul integration
   - Kubernetes service discovery
   - Health check endpoints

3. **Auto-Scaling** (2 SP)
   - Kubernetes HPA (Horizontal Pod Autoscaler)
   - CPU/memory-based scaling
   - Custom metrics (decision rate)

**Testing Strategy**:
```bash
go test ./internal/cluster/ -run TestSharding -v
go test ./tests/load/ -run TestHorizontalScaling -v
```

**Risk**: Uneven sharding → Mitigation: Consistent hashing, rebalancing

#### 7.2.5 Load Balancing & Health Checks (P1)
**Estimated Effort**: 1 week (6 story points)
**Owner**: Infrastructure team
**Dependencies**: None

**Implementation**:

1. **Health Check Endpoints** (2 SP)
   - `GET /health` - Basic liveness
   - `GET /ready` - Readiness (cache, database checks)
   - `GET /metrics` - Prometheus metrics

2. **Load Balancer Configuration** (2 SP)
   - HAProxy configuration
   - NGINX configuration
   - AWS ALB configuration

3. **Circuit Breakers** (2 SP)
   - Per-dependency circuit breaker
   - Fallback strategies
   - Files: `internal/resilience/circuit_breaker.go` (already exists from Phase 6)

**Testing Strategy**:
```bash
go test ./internal/server/ -run TestHealthChecks -v
```

#### 7.2.6 Chaos Testing & Disaster Recovery (P2)
**Estimated Effort**: 2 weeks (10 story points)
**Owner**: SRE team
**Dependencies**: All Phase 7 features

**Implementation**:

1. **Chaos Engineering** (5 SP)
   - Chaos Monkey (random node termination)
   - Network partitioning tests
   - Database failure simulations
   - Files: `tests/chaos/*.go` (300 LOC)

2. **Disaster Recovery** (3 SP)
   - Automated backups (hourly, daily)
   - Point-in-time recovery
   - Cross-region replication
   - Files: `scripts/backup.sh`, `scripts/restore.sh`

3. **Runbooks** (2 SP)
   - Node failure recovery
   - Database failover
   - Cache failure recovery
   - Files: `docs/runbooks/*.md`

**Testing Strategy**:
```bash
# Chaos tests
go test ./tests/chaos/... -v

# Disaster recovery drill
./scripts/disaster-recovery-drill.sh
```

### 7.3 Testing Strategy

**Performance Testing**:
```bash
# Load testing (10K decisions/sec)
go test ./tests/load/ -bench=BenchmarkDecisionThroughput -benchtime=60s

# Distributed cache performance
go test ./tests/load/ -bench=BenchmarkRedisCache -benchtime=30s

# Database performance
go test ./tests/load/ -bench=BenchmarkPostgres -benchtime=30s

# Clustering failover
go test ./tests/integration/ -run TestRaftFailover -v
```

**Scalability Testing**:
- Horizontal scaling (2 → 10 instances)
- Vertical scaling (2 CPU → 8 CPU)
- Database scaling (1 → 3 replicas)

### 7.4 Dependencies and Risks

**Dependencies**:
- Phase 6 complete (security)
- Redis cluster (3+ nodes)
- PostgreSQL (with replication)
- Kubernetes (for auto-scaling)

**Risks**:

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Database bottleneck | High | High | Aggressive caching, read replicas |
| Split-brain scenarios | Medium | High | Raft quorum, network partitioning tests |
| Cache stampede | Medium | Medium | Probabilistic early expiration |
| Uneven sharding | Low | Medium | Consistent hashing, rebalancing |

### 7.5 Timeline and Milestones

```
Week 1-2:  Distributed caching → Milestone: Redis cluster operational
Week 3-4:  PostgreSQL backend → Milestone: Database migrations complete
Week 5-6:  Clustering & Raft → Milestone: 3-node cluster with leader election
Week 7:    Horizontal scaling → Milestone: Auto-scaling working
Week 8:    Load balancing → Milestone: Health checks operational
Week 9-10: Chaos testing → Milestone: Phase 7 COMPLETE
```

---

## Phase 8: Advanced Policy Features
**Timeline**: 6-8 weeks
**Status**: PLANNED
**Dependencies**: Phase 7 (Scalability)
**Priority**: P1 (Developer experience)

### 8.1 Goals and Success Criteria

**Strategic Goals**:
- Policy import/export (Cerbos format compatibility)
- Policy schemas and validation (JSON Schema)
- Policy testing framework + CLI
- Policy versioning and rollback
- Policy analytics and usage insights

**Success Metrics**:
- ✅ Cerbos compatibility: 95%+ policy compatibility
- ✅ Validation: <1% false positives on schema validation
- ✅ Test framework: >90% policy coverage achievable
- ✅ Versioning: Zero-downtime policy rollback
- ✅ Analytics: Real-time policy usage insights

### 8.2 Features Breakdown

#### 8.2.1 Derived Roles Enhancements (P1)
**Estimated Effort**: 2 weeks (10 story points)
**Owner**: Core team
**Dependencies**: None

**Current Status**: Phase 4 complete (94% tests passing)

**Enhancements**:

1. **Performance Optimization** (4 SP)
   - Cache derived role resolutions (currently <10µs)
   - Target: <5µs p50, <10µs p99
   - Batch role resolution
   - Files: `internal/derived_roles/cache.go` (optimization)

2. **Circular Dependency Detection** (2 SP)
   - Enhanced cycle detection
   - Clearer error messages
   - Visualization of dependency graph

3. **Wildcard Improvements** (2 SP)
   - Support `prefix:*:suffix` patterns
   - Regex-based parent role matching
   - Performance optimization for wildcards

4. **Documentation** (2 SP)
   - Comprehensive examples
   - Performance tuning guide
   - Troubleshooting guide

**Testing Strategy**:
```bash
go test ./internal/derived_roles/... -v
go test ./tests/integration/ -run TestDerivedRoles -v
```

**Risk**: Backward compatibility → Mitigation: Feature flags, gradual rollout

#### 8.2.2 Policy Import/Export (P0)
**Estimated Effort**: 1 week (8 story points)
**Owner**: API team
**Dependencies**: None

**Cerbos Format Compatibility**:

```yaml
# Cerbos resource policy
---
apiVersion: api.cerbos.dev/v1
resourcePolicy:
  version: "default"
  resource: "document"
  rules:
    - actions: ["read", "write"]
      effect: EFFECT_ALLOW
      roles: ["owner"]
      condition:
        match:
          expr: "request.resource.attr.status == 'published'"
```

**Implementation**:

1. **Import API** (4 SP)
   - `POST /v1/policies/import` - Import Cerbos policies
   - YAML/JSON format support
   - Validation and error reporting
   - Files: `internal/policy/import.go` (300 LOC)

```go
type ImportRequest struct {
    Policies []RawPolicy `json:"policies"`
    DryRun   bool        `json:"dry_run"`
    Replace  bool        `json:"replace"`  // Replace existing
}

type ImportResponse struct {
    Imported int                `json:"imported"`
    Errors   []ImportError      `json:"errors,omitempty"`
    Warnings []ImportWarning    `json:"warnings,omitempty"`
}
```

2. **Export API** (2 SP)
   - `GET /v1/policies/export?format=cerbos` - Export to Cerbos format
   - Bulk export
   - Files: `internal/policy/export.go` (200 LOC)

3. **Format Conversion** (2 SP)
   - Cerbos → AuthZ format
   - AuthZ → Cerbos format
   - Lossless conversion where possible
   - Files: `internal/policy/converter.go` (250 LOC)

**Testing Strategy**:
```bash
go test ./internal/policy/ -run TestImportExport -v
go test ./tests/integration/ -run TestCerbosCompatibility -v
```

**Risk**: Format incompatibilities → Mitigation: Clear documentation of unsupported features

#### 8.2.3 Policy Schemas & Validation (P1)
**Estimated Effort**: 1 week (8 story points)
**Owner**: API team
**Dependencies**: None

**JSON Schema for Policies**:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "AuthZ Policy Schema",
  "type": "object",
  "required": ["apiVersion", "name", "resource", "rules"],
  "properties": {
    "apiVersion": {
      "type": "string",
      "enum": ["authz.engine/v1"]
    },
    "name": {
      "type": "string",
      "pattern": "^[a-zA-Z0-9-_]+$"
    },
    "resource": {
      "type": "object",
      "required": ["kind"],
      "properties": {
        "kind": {
          "type": "string",
          "pattern": "^[a-zA-Z0-9-_]+$"
        }
      }
    },
    "rules": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/rule"
      }
    }
  },
  "definitions": {
    "rule": {
      "type": "object",
      "required": ["actions", "effect"],
      "properties": {
        "actions": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "effect": {
          "type": "string",
          "enum": ["allow", "deny"]
        }
      }
    }
  }
}
```

**Implementation**:

1. **Schema Validation** (4 SP)
   - JSON Schema validation (github.com/xeipuuv/gojsonschema)
   - Custom validators for CEL expressions
   - Validation on policy create/update
   - Files: `internal/policy/validation.go` (200 LOC)

2. **Schema Registry** (2 SP)
   - Versioned schemas
   - Schema evolution support
   - Backward compatibility checking

3. **Validation API** (2 SP)
   - `POST /v1/policies/validate` - Validate policy without saving
   - Detailed error messages
   - Suggested fixes

**Testing Strategy**:
```bash
go test ./internal/policy/ -run TestValidation -v
```

**Risk**: Schema evolution → Mitigation: Semantic versioning, backward compatibility

#### 8.2.4 Policy Testing Framework (P1)
**Estimated Effort**: 2 weeks (13 story points)
**Owner**: Developer experience team
**Dependencies**: None

**Test Case Format**:

```yaml
# policy_test.yaml
---
apiVersion: authz.engine/v1
kind: PolicyTest
name: "Document access tests"
policy: "document-policy"
tests:
  - name: "Owner can read published documents"
    principal:
      id: "user:alice"
      roles: ["owner"]
    resource:
      kind: "document"
      id: "doc-123"
      attr:
        status: "published"
        owner_id: "user:alice"
    action: "read"
    expected: "allow"

  - name: "Viewer cannot delete documents"
    principal:
      id: "user:bob"
      roles: ["viewer"]
    resource:
      kind: "document"
      id: "doc-456"
    action: "delete"
    expected: "deny"
```

**Implementation**:

1. **Test Runner** (6 SP)
   - Parse test YAML files
   - Execute tests against policies
   - Generate test reports (HTML, JSON, JUnit XML)
   - Files: `internal/testing/runner.go` (400 LOC)

```go
type PolicyTest struct {
    Name     string
    Policy   string
    Tests    []TestCase
}

type TestCase struct {
    Name      string
    Principal types.Principal
    Resource  types.Resource
    Action    string
    Expected  string  // "allow" or "deny"
    Reason    string  // Optional: expected reason
}

func (r *TestRunner) RunTests(tests []PolicyTest) (*TestReport, error)
```

2. **Coverage Analysis** (3 SP)
   - Track which policies are tested
   - Track which rules are tested
   - Generate coverage report

3. **CLI Tool** (4 SP)
   - `authz-cli test` - Run policy tests
   - `authz-cli coverage` - Generate coverage report
   - `authz-cli validate` - Validate policies
   - Files: `cmd/authz-cli/main.go` (300 LOC)

**CLI Usage**:
```bash
# Run all tests
authz-cli test ./policies/**/*_test.yaml

# Run tests with coverage
authz-cli test --coverage ./policies/**/*_test.yaml

# Generate HTML coverage report
authz-cli test --coverage --html=coverage.html ./policies/**/*_test.yaml

# Validate policies
authz-cli validate ./policies/**/*.yaml
```

**Testing Strategy**:
```bash
go test ./internal/testing/... -v
go test ./cmd/authz-cli/... -v
```

**Risk**: Complex test scenarios → Mitigation: Comprehensive documentation, examples

#### 8.2.5 Policy Versioning & Rollback (P1)
**Estimated Effort**: 1 week (8 story points)
**Owner**: Backend team
**Dependencies**: PostgreSQL backend (Phase 7)

**Current Status**: Foundation exists (version column in policies table)

**Enhancements**:

1. **Version Management** (3 SP)
   - Automatic version incrementing
   - Version history tracking
   - Side-by-side version comparison
   - Files: `internal/policy/versioning.go` (200 LOC)

```go
func (s *PolicyStore) CreateVersion(ctx context.Context, name string, content *Policy) (int, error)
func (s *PolicyStore) GetVersion(ctx context.Context, name string, version int) (*Policy, error)
func (s *PolicyStore) ListVersions(ctx context.Context, name string) ([]PolicyVersion, error)
func (s *PolicyStore) Rollback(ctx context.Context, name string, targetVersion int) error
```

2. **Zero-Downtime Rollback** (3 SP)
   - Blue-green deployment for policies
   - Gradual rollout (canary)
   - Instant rollback on errors

3. **Version Metadata** (2 SP)
   - Change description
   - Author tracking
   - Approval workflow (optional)

**Testing Strategy**:
```bash
go test ./internal/policy/ -run TestVersioning -v
go test ./tests/integration/ -run TestPolicyRollback -v
```

**Risk**: Cache invalidation on rollback → Mitigation: Pub/Sub invalidation (Phase 7.2.1)

#### 8.2.6 Policy Analytics (P2)
**Estimated Effort**: 1 week (6 story points)
**Owner**: Observability team
**Dependencies**: Audit logging (Phase 6)

**Implementation**:

1. **Usage Tracking** (3 SP)
   - Track policy evaluation frequency
   - Track decision outcomes (allow/deny)
   - Track resource access patterns
   - Files: `internal/analytics/tracker.go` (200 LOC)

2. **Analytics API** (2 SP)
   - `GET /v1/analytics/policies/:name` - Policy usage stats
   - `GET /v1/analytics/resources/:kind` - Resource access stats
   - `GET /v1/analytics/principals/:id` - Principal activity stats

3. **Dashboard** (1 SP)
   - Grafana dashboard templates
   - Pre-built panels for common queries

**Metrics**:
```
authz_policy_evaluations_total{policy="document-policy",effect="allow"}
authz_resource_access_total{kind="document",action="read"}
authz_principal_decisions_total{principal="user:alice",effect="deny"}
authz_policy_latency_seconds{policy="document-policy",quantile="0.99"}
```

**Testing Strategy**:
```bash
go test ./internal/analytics/... -v
```

### 8.3 Testing Strategy

**Policy Testing**:
```bash
# Test framework
go test ./internal/testing/... -v

# CLI tool
go test ./cmd/authz-cli/... -v

# Import/export
go test ./internal/policy/ -run TestImportExport -v

# Versioning
go test ./internal/policy/ -run TestVersioning -v
```

**Integration Testing**:
```bash
# Cerbos compatibility
go test ./tests/integration/ -run TestCerbosCompatibility -v

# Policy testing framework
go test ./tests/integration/ -run TestPolicyTestFramework -v
```

### 8.4 Dependencies and Risks

**Dependencies**:
- Phase 7 complete (scalability)
- PostgreSQL backend (for versioning)
- Audit logging (for analytics)

**Risks**:

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Cerbos format incompatibilities | Medium | Medium | Clear documentation of unsupported features |
| Test framework complexity | Medium | Low | Comprehensive examples and documentation |
| Version migration issues | Low | High | Thorough testing, rollback support |

### 8.5 Timeline and Milestones

```
Week 1-2:  Derived roles enhancements → Milestone: <5µs p50 resolution
Week 3:    Policy import/export → Milestone: Cerbos compatibility
Week 4:    Policy schemas → Milestone: JSON Schema validation
Week 5-6:  Policy testing framework → Milestone: CLI tool operational
Week 7:    Policy versioning → Milestone: Zero-downtime rollback
Week 8:    Policy analytics → Milestone: Phase 8 COMPLETE
```

---

## Phase 9: DevOps & Operations
**Timeline**: 6-8 weeks
**Status**: PLANNED
**Dependencies**: Phase 8 (Advanced features)
**Priority**: P2 (Operational excellence)

### 9.1 Goals and Success Criteria

**Strategic Goals**:
- Kubernetes-native deployment (Helm charts, operators)
- Infrastructure as Code (Terraform modules)
- GitOps integration (ArgoCD, Flux)
- Automated backup/restore
- Migration tools (Cerbos → AuthZ)
- Disaster recovery automation

**Success Metrics**:
- ✅ Kubernetes deployment: <5 min from zero to production
- ✅ Terraform deployment: <10 min for full infrastructure
- ✅ GitOps sync time: <30 seconds
- ✅ Backup/restore: <15 min RTO, <1 hour RPO
- ✅ Migration success rate: >99%
- ✅ MTTR (Mean Time To Recovery): <10 minutes

### 9.2 Features Breakdown

#### 9.2.1 Kubernetes Helm Charts (P0)
**Estimated Effort**: 2 weeks (13 story points)
**Owner**: DevOps team
**Dependencies**: Phase 7 (clustering)

**Helm Chart Structure**:

```
charts/authz-engine/
├── Chart.yaml
├── values.yaml
├── templates/
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   ├── configmap.yaml
│   ├── secret.yaml
│   ├── hpa.yaml
│   ├── pdb.yaml
│   ├── servicemonitor.yaml
│   ├── networkpolicy.yaml
│   └── tests/
│       └── test-connection.yaml
└── README.md
```

**values.yaml Example**:
```yaml
replicaCount: 3

image:
  repository: authz-engine/authz-server
  pullPolicy: IfNotPresent
  tag: "1.0.0"

service:
  type: ClusterIP
  port: 8080
  grpcPort: 9090

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  hosts:
    - host: authz.example.com
      paths:
        - path: /
          pathType: Prefix

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80
  targetMemoryUtilizationPercentage: 80

podDisruptionBudget:
  enabled: true
  minAvailable: 2

resources:
  limits:
    cpu: 1000m
    memory: 1Gi
  requests:
    cpu: 500m
    memory: 512Mi

postgresql:
  enabled: true
  auth:
    username: authz
    password: ""  # Use existingSecret
    database: authz
  primary:
    persistence:
      size: 10Gi

redis:
  enabled: true
  architecture: replication
  auth:
    enabled: true
    password: ""  # Use existingSecret
  master:
    persistence:
      size: 8Gi
  replica:
    replicaCount: 2
    persistence:
      size: 8Gi

monitoring:
  serviceMonitor:
    enabled: true
    interval: 30s

networkPolicy:
  enabled: true
  policyTypes:
    - Ingress
    - Egress
```

**Implementation**:

1. **Core Resources** (5 SP)
   - Deployment, Service, Ingress
   - ConfigMap for configuration
   - Secret for credentials
   - Files: `charts/authz-engine/templates/*.yaml`

2. **Auto-scaling & HA** (3 SP)
   - HorizontalPodAutoscaler
   - PodDisruptionBudget
   - Anti-affinity rules

3. **Dependencies** (3 SP)
   - PostgreSQL subchart
   - Redis subchart
   - Init containers for migrations

4. **Monitoring** (2 SP)
   - ServiceMonitor for Prometheus
   - Grafana dashboard ConfigMap
   - Alert rules

**Testing Strategy**:
```bash
# Lint Helm chart
helm lint charts/authz-engine

# Test template rendering
helm template authz charts/authz-engine --debug

# Install in test cluster
helm install authz charts/authz-engine --dry-run --debug

# Run chart tests
helm test authz
```

**Risk**: Complex dependencies → Mitigation: Thorough testing, documentation

#### 9.2.2 Kubernetes Operator (P1)
**Estimated Effort**: 2 weeks (13 story points)
**Owner**: Platform team
**Dependencies**: Helm charts

**Custom Resource Definitions (CRDs)**:

```yaml
# authzpolicy-crd.yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: authzpolicies.authz.engine
spec:
  group: authz.engine
  names:
    kind: AuthZPolicy
    listKind: AuthZPolicyList
    plural: authzpolicies
    singular: authzpolicy
  scope: Namespaced
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                policyType:
                  type: string
                  enum: ["resource", "principal", "derived_role"]
                resource:
                  type: object
                  properties:
                    kind:
                      type: string
                rules:
                  type: array
                  items:
                    type: object
```

**Example AuthZPolicy Resource**:
```yaml
apiVersion: authz.engine/v1
kind: AuthZPolicy
metadata:
  name: document-policy
  namespace: authz-system
spec:
  policyType: resource
  resource:
    kind: document
  rules:
    - actions: ["read", "write"]
      effect: allow
      roles: ["owner"]
```

**Implementation**:

1. **Operator Framework** (6 SP)
   - Kubebuilder or Operator SDK
   - Reconciliation loop
   - Policy synchronization
   - Files: `operator/*.go` (500 LOC)

```go
type AuthZPolicyReconciler struct {
    client.Client
    Scheme       *runtime.Scheme
    PolicyClient *authzclient.Client
}

func (r *AuthZPolicyReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    // 1. Fetch AuthZPolicy resource
    // 2. Convert to internal policy format
    // 3. Sync to AuthZ engine via API
    // 4. Update status
}
```

2. **Status Updates** (3 SP)
   - Policy sync status
   - Error reporting
   - Metrics collection

3. **Webhooks** (2 SP)
   - Validating webhook (policy validation)
   - Mutating webhook (defaults injection)

4. **RBAC** (2 SP)
   - ClusterRole for operator
   - ServiceAccount bindings

**Testing Strategy**:
```bash
# Unit tests
go test ./operator/... -v

# Integration tests
make test-integration

# Install operator
make install
kubectl apply -f config/samples/authzpolicy_v1.yaml
```

**Risk**: Kubernetes API complexity → Mitigation: Use Kubebuilder, extensive testing

#### 9.2.3 Terraform Modules (P1)
**Estimated Effort**: 1 week (8 story points)
**Owner**: Infrastructure team
**Dependencies**: None

**Module Structure**:

```
terraform/
├── modules/
│   ├── authz-engine/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── README.md
│   ├── postgresql/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   └── redis/
│       ├── main.tf
│       ├── variables.tf
│       └── outputs.tf
├── examples/
│   ├── aws/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── terraform.tfvars.example
│   ├── gcp/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── terraform.tfvars.example
│   └── azure/
│       ├── main.tf
│       ├── variables.tf
│       └── terraform.tfvars.example
└── README.md
```

**Example: AWS Deployment**:
```hcl
# examples/aws/main.tf
module "authz_engine" {
  source = "../../modules/authz-engine"

  cluster_name = "authz-production"
  instance_count = 3
  instance_type = "t3.medium"

  vpc_id = aws_vpc.main.id
  subnet_ids = aws_subnet.private[*].id

  postgres_instance_class = "db.t3.medium"
  postgres_storage_gb = 100

  redis_node_type = "cache.t3.medium"
  redis_num_cache_nodes = 3

  enable_https = true
  certificate_arn = aws_acm_certificate.authz.arn

  tags = {
    Environment = "production"
    ManagedBy = "terraform"
  }
}

output "authz_endpoint" {
  value = module.authz_engine.endpoint
}
```

**Implementation**:

1. **AWS Module** (3 SP)
   - EC2/ECS/EKS deployment
   - RDS for PostgreSQL
   - ElastiCache for Redis
   - ALB/NLB setup
   - Files: `terraform/modules/authz-engine/main.tf`

2. **GCP Module** (2 SP)
   - GKE/GCE deployment
   - Cloud SQL for PostgreSQL
   - Memorystore for Redis
   - Load balancer setup

3. **Azure Module** (2 SP)
   - AKS/VM deployment
   - Azure Database for PostgreSQL
   - Azure Cache for Redis
   - Application Gateway setup

4. **Documentation** (1 SP)
   - Usage examples
   - Variable reference
   - Best practices

**Testing Strategy**:
```bash
# Validate Terraform
terraform validate

# Plan (dry-run)
terraform plan

# Apply to test environment
terraform apply -var="environment=test"

# Destroy test environment
terraform destroy -var="environment=test"
```

**Risk**: Cloud provider differences → Mitigation: Modular design, provider-specific examples

#### 9.2.4 GitOps Integration (P1)
**Estimated Effort**: 1 week (6 story points)
**Owner**: Platform team
**Dependencies**: Helm charts, Kubernetes operator

**Implementation**:

1. **ArgoCD Application** (3 SP)
   - ApplicationSet for multi-environment
   - Auto-sync configuration
   - Rollback support
   - Files: `gitops/argocd/*.yaml`

```yaml
# argocd/applicationset.yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: authz-engine
spec:
  generators:
    - list:
        elements:
          - cluster: production
            url: https://kubernetes.default.svc
          - cluster: staging
            url: https://staging.k8s.example.com
  template:
    metadata:
      name: '{{cluster}}-authz-engine'
    spec:
      project: default
      source:
        repoURL: https://github.com/authz-engine/authz-engine
        targetRevision: main
        path: charts/authz-engine
        helm:
          valueFiles:
            - values-{{cluster}}.yaml
      destination:
        server: '{{url}}'
        namespace: authz-system
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
        syncOptions:
          - CreateNamespace=true
```

2. **Flux Configuration** (2 SP)
   - GitRepository source
   - HelmRelease for deployment
   - Kustomization for environment-specific configs
   - Files: `gitops/flux/*.yaml`

3. **CI/CD Pipeline** (1 SP)
   - GitHub Actions / GitLab CI
   - Automated testing on PR
   - Auto-deploy to staging
   - Manual approval for production

**Testing Strategy**:
```bash
# Validate ArgoCD app
argocd app validate argocd/applicationset.yaml

# Dry-run sync
argocd app sync authz-engine --dry-run

# Deploy to staging
git push origin main  # Auto-synced by ArgoCD
```

**Risk**: Sync failures → Mitigation: Health checks, automated rollback

#### 9.2.5 Backup/Restore Automation (P1)
**Estimated Effort**: 1 week (8 story points)
**Owner**: SRE team
**Dependencies**: PostgreSQL backend (Phase 7)

**Implementation**:

1. **Backup Script** (4 SP)
   - PostgreSQL pg_dump
   - Redis RDB snapshot
   - Policy file export
   - S3/GCS upload
   - Files: `scripts/backup.sh`

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/var/backups/authz-engine"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="authz-backup-${TIMESTAMP}"

# 1. Backup PostgreSQL
pg_dump -h $POSTGRES_HOST -U $POSTGRES_USER authz > ${BACKUP_DIR}/${BACKUP_NAME}.sql

# 2. Backup Redis
redis-cli --rdb ${BACKUP_DIR}/${BACKUP_NAME}.rdb

# 3. Export policies (via API)
curl -H "Authorization: Bearer $API_TOKEN" \
  http://authz.example.com/v1/policies/export > ${BACKUP_DIR}/${BACKUP_NAME}.yaml

# 4. Upload to S3
aws s3 cp ${BACKUP_DIR}/${BACKUP_NAME}.* s3://authz-backups/

# 5. Cleanup old backups (keep 30 days)
find ${BACKUP_DIR} -type f -mtime +30 -delete
```

2. **Restore Script** (3 SP)
   - Download from S3/GCS
   - Restore PostgreSQL
   - Restore Redis
   - Import policies
   - Files: `scripts/restore.sh`

3. **Kubernetes CronJob** (1 SP)
   - Scheduled backups (hourly, daily)
   - Backup verification
   - Files: `k8s/cronjob-backup.yaml`

**Testing Strategy**:
```bash
# Test backup
./scripts/backup.sh

# Test restore
./scripts/restore.sh authz-backup-20250126_120000

# Verify data integrity
./scripts/verify-backup.sh authz-backup-20250126_120000
```

**Risk**: Backup corruption → Mitigation: Verification, multiple backup destinations

#### 9.2.6 Migration Tools (Cerbos → AuthZ) (P2)
**Estimated Effort**: 1 week (8 story points)
**Owner**: Migration team
**Dependencies**: Policy import/export (Phase 8)

**Implementation**:

1. **Migration CLI** (5 SP)
   - `authz-migrate from-cerbos` - Migrate from Cerbos
   - Dry-run mode
   - Validation and error reporting
   - Files: `cmd/authz-migrate/main.go` (400 LOC)

```bash
# Dry-run migration
authz-migrate from-cerbos \
  --cerbos-host https://cerbos.example.com \
  --authz-host https://authz.example.com \
  --dry-run

# Execute migration
authz-migrate from-cerbos \
  --cerbos-host https://cerbos.example.com \
  --authz-host https://authz.example.com \
  --batch-size 100 \
  --progress
```

2. **Compatibility Checker** (2 SP)
   - Identify incompatible policies
   - Suggest manual fixes
   - Generate migration report

3. **Rollback Support** (1 SP)
   - Backup before migration
   - Rollback command
   - Data integrity checks

**Testing Strategy**:
```bash
go test ./cmd/authz-migrate/... -v
```

**Risk**: Data loss during migration → Mitigation: Mandatory backup, dry-run mode

#### 9.2.7 Disaster Recovery Automation (P2)
**Estimated Effort**: 1 week (6 story points)
**Owner**: SRE team
**Dependencies**: Backup/restore automation

**Implementation**:

1. **DR Runbooks** (2 SP)
   - Node failure recovery
   - Database failover
   - Cache failure recovery
   - Complete data loss recovery
   - Files: `docs/runbooks/*.md`

2. **Automated Failover** (3 SP)
   - Health check-based failover
   - DNS update automation
   - Cross-region replication

3. **DR Drills** (1 SP)
   - Quarterly DR drill script
   - Automated testing
   - Post-drill report

**Testing Strategy**:
```bash
# Run DR drill
./scripts/disaster-recovery-drill.sh

# Verify recovery
./scripts/verify-recovery.sh
```

### 9.3 Testing Strategy

**Infrastructure Testing**:
```bash
# Helm chart tests
helm lint charts/authz-engine
helm test authz

# Terraform tests
terraform validate
terraform plan

# Operator tests
go test ./operator/... -v
make test-integration

# Backup/restore tests
./scripts/test-backup-restore.sh
```

**Integration Testing**:
```bash
# Deploy to test cluster
helm install authz-test charts/authz-engine -f values-test.yaml

# Run smoke tests
./scripts/smoke-tests.sh

# Cleanup
helm uninstall authz-test
```

### 9.4 Dependencies and Risks

**Dependencies**:
- Phase 7 complete (clustering)
- Phase 8 complete (policy features)
- Kubernetes cluster (1.25+)
- Terraform (1.5+)
- ArgoCD/Flux (optional)

**Risks**:

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Helm chart complexity | Medium | Medium | Thorough testing, documentation |
| Terraform provider differences | High | Low | Provider-specific modules |
| GitOps sync failures | Low | Medium | Health checks, automated rollback |
| Backup corruption | Low | High | Verification, multiple destinations |
| Migration data loss | Medium | High | Mandatory backup, dry-run mode |

### 9.5 Timeline and Milestones

```
Week 1-2:  Kubernetes Helm charts → Milestone: One-command deployment
Week 3-4:  Kubernetes operator → Milestone: GitOps-ready CRDs
Week 5:    Terraform modules → Milestone: AWS/GCP/Azure support
Week 6:    GitOps integration → Milestone: ArgoCD/Flux working
Week 7:    Backup/restore → Milestone: Automated backups
Week 8:    Migration tools → Milestone: Phase 9 COMPLETE
```

---

## Phase 10: Developer Experience
**Timeline**: 4-6 weeks
**Status**: PLANNED
**Dependencies**: Phase 9 (DevOps)
**Priority**: P2 (Community adoption)

### 10.1 Goals and Success Criteria

**Strategic Goals**:
- SDKs for Go, Python, Node.js, Java
- CLI tools for policy management
- Policy playground/simulator
- Comprehensive documentation portal
- Example applications

**Success Metrics**:
- ✅ SDKs: 4 languages with 90%+ API coverage
- ✅ CLI: <5 min to manage policies from terminal
- ✅ Documentation: <2 min to find any answer
- ✅ Examples: 10+ real-world use cases
- ✅ Community: 100+ GitHub stars, 10+ contributors

### 10.2 Features Breakdown

#### 10.2.1 Go SDK (P0)
**Estimated Effort**: 1 week (8 story points)
**Owner**: SDK team
**Dependencies**: REST API complete (Phase 5)

**Package Structure**:
```
authz-go-sdk/
├── authz/
│   ├── client.go
│   ├── policies.go
│   ├── agents.go
│   ├── delegation.go
│   └── options.go
├── examples/
│   ├── basic/
│   ├── advanced/
│   └── middleware/
├── go.mod
├── go.sum
└── README.md
```

**Client API**:
```go
package authz

import (
    "context"
    "time"
)

type Client struct {
    baseURL    string
    apiKey     string
    httpClient *http.Client
}

func NewClient(baseURL, apiKey string, opts ...Option) (*Client, error)

// Authorization checks
func (c *Client) Check(ctx context.Context, req *CheckRequest) (*CheckResponse, error)
func (c *Client) CheckBatch(ctx context.Context, reqs []*CheckRequest) ([]*CheckResponse, error)

// Policy management
func (c *Client) CreatePolicy(ctx context.Context, policy *Policy) error
func (c *Client) GetPolicy(ctx context.Context, name string) (*Policy, error)
func (c *Client) UpdatePolicy(ctx context.Context, name string, policy *Policy) error
func (c *Client) DeletePolicy(ctx context.Context, name string) error
func (c *Client) ListPolicies(ctx context.Context, filter *PolicyFilter) ([]*Policy, error)

// Agent management
func (c *Client) RegisterAgent(ctx context.Context, agent *Agent) (*AgentResponse, error)
func (c *Client) GetAgent(ctx context.Context, id string) (*Agent, error)
func (c *Client) RevokeAgent(ctx context.Context, id string) error

// Delegation
func (c *Client) CreateDelegation(ctx context.Context, delegation *Delegation) error
func (c *Client) CheckWithDelegation(ctx context.Context, req *CheckRequest, chain []string) (*CheckResponse, error)
```

**Example Usage**:
```go
package main

import (
    "context"
    "fmt"
    "github.com/authz-engine/authz-go-sdk/authz"
)

func main() {
    client, err := authz.NewClient(
        "https://authz.example.com",
        "your-api-key",
        authz.WithTimeout(5*time.Second),
    )
    if err != nil {
        panic(err)
    }

    resp, err := client.Check(context.Background(), &authz.CheckRequest{
        Principal: &authz.Principal{
            ID:    "user:alice",
            Roles: []string{"admin"},
        },
        Resource: &authz.Resource{
            Kind: "document",
            ID:   "doc-123",
        },
        Actions: []string{"read", "write"},
    })
    if err != nil {
        panic(err)
    }

    if resp.Results["read"].Effect == "allow" {
        fmt.Println("Access granted")
    } else {
        fmt.Println("Access denied")
    }
}
```

**Testing Strategy**:
```bash
go test ./authz/... -v
go test ./examples/... -v
```

**Risk**: API changes → Mitigation: Semantic versioning, deprecation warnings

#### 10.2.2 Python SDK (P0)
**Estimated Effort**: 1 week (8 story points)
**Owner**: SDK team
**Dependencies**: REST API complete

**Package Structure**:
```
authz-python-sdk/
├── authz/
│   ├── __init__.py
│   ├── client.py
│   ├── policies.py
│   ├── agents.py
│   ├── delegation.py
│   ├── models.py
│   └── exceptions.py
├── examples/
│   ├── basic.py
│   ├── advanced.py
│   └── django_middleware.py
├── tests/
├── pyproject.toml
├── setup.py
└── README.md
```

**Client API**:
```python
from authz import AuthZClient, CheckRequest, Principal, Resource

client = AuthZClient(
    base_url="https://authz.example.com",
    api_key="your-api-key",
    timeout=5.0,
)

response = client.check(CheckRequest(
    principal=Principal(
        id="user:alice",
        roles=["admin"],
    ),
    resource=Resource(
        kind="document",
        id="doc-123",
    ),
    actions=["read", "write"],
))

if response.results["read"].effect == "allow":
    print("Access granted")
else:
    print("Access denied")
```

**Django Middleware Example**:
```python
from authz import AuthZClient

class AuthZMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
        self.authz_client = AuthZClient(
            base_url=settings.AUTHZ_URL,
            api_key=settings.AUTHZ_API_KEY,
        )

    def __call__(self, request):
        # Check authorization before processing request
        response = self.authz_client.check(
            principal=Principal(id=f"user:{request.user.id}"),
            resource=Resource(kind="endpoint", id=request.path),
            actions=[request.method.lower()],
        )

        if response.results[request.method.lower()].effect != "allow":
            return HttpResponseForbidden("Access denied")

        return self.get_response(request)
```

**Testing Strategy**:
```bash
pytest tests/ -v
python -m mypy authz/
python -m pylint authz/
```

**Risk**: Python version compatibility → Mitigation: Support Python 3.8+

#### 10.2.3 Node.js SDK (P1)
**Estimated Effort**: 1 week (8 story points)
**Owner**: SDK team
**Dependencies**: REST API complete

**Package Structure**:
```
authz-node-sdk/
├── src/
│   ├── client.ts
│   ├── policies.ts
│   ├── agents.ts
│   ├── delegation.ts
│   ├── models.ts
│   └── index.ts
├── examples/
│   ├── basic.ts
│   ├── express-middleware.ts
│   └── nestjs-guard.ts
├── tests/
├── package.json
├── tsconfig.json
└── README.md
```

**Client API**:
```typescript
import { AuthZClient, CheckRequest, Principal, Resource } from '@authz-engine/authz-sdk';

const client = new AuthZClient({
  baseURL: 'https://authz.example.com',
  apiKey: 'your-api-key',
  timeout: 5000,
});

const response = await client.check({
  principal: {
    id: 'user:alice',
    roles: ['admin'],
  },
  resource: {
    kind: 'document',
    id: 'doc-123',
  },
  actions: ['read', 'write'],
});

if (response.results.read.effect === 'allow') {
  console.log('Access granted');
} else {
  console.log('Access denied');
}
```

**Express Middleware Example**:
```typescript
import express from 'express';
import { AuthZClient } from '@authz-engine/authz-sdk';

const authzClient = new AuthZClient({
  baseURL: process.env.AUTHZ_URL,
  apiKey: process.env.AUTHZ_API_KEY,
});

function authzMiddleware(action: string, resourceKind: string) {
  return async (req, res, next) => {
    const response = await authzClient.check({
      principal: { id: `user:${req.user.id}` },
      resource: { kind: resourceKind, id: req.params.id },
      actions: [action],
    });

    if (response.results[action].effect === 'allow') {
      next();
    } else {
      res.status(403).json({ error: 'Access denied' });
    }
  };
}

app.get('/documents/:id', authzMiddleware('read', 'document'), (req, res) => {
  // Handler logic
});
```

**Testing Strategy**:
```bash
npm test
npm run lint
npm run typecheck
```

**Risk**: TypeScript version compatibility → Mitigation: Support TS 4.5+

#### 10.2.4 Java SDK (P1)
**Estimated Effort**: 1 week (8 story points)
**Owner**: SDK team
**Dependencies**: REST API complete

**Package Structure**:
```
authz-java-sdk/
├── src/
│   ├── main/
│   │   └── java/
│   │       └── com/authzengine/authz/
│   │           ├── AuthZClient.java
│   │           ├── Policies.java
│   │           ├── Agents.java
│   │           ├── Delegation.java
│   │           └── models/
│   └── test/
├── examples/
│   ├── BasicExample.java
│   └── SpringSecurityIntegration.java
├── pom.xml
└── README.md
```

**Client API**:
```java
import com.authzengine.authz.AuthZClient;
import com.authzengine.authz.models.*;

public class Example {
    public static void main(String[] args) {
        AuthZClient client = new AuthZClient.Builder()
            .baseURL("https://authz.example.com")
            .apiKey("your-api-key")
            .timeout(5000)
            .build();

        CheckRequest request = CheckRequest.builder()
            .principal(Principal.builder()
                .id("user:alice")
                .roles(List.of("admin"))
                .build())
            .resource(Resource.builder()
                .kind("document")
                .id("doc-123")
                .build())
            .actions(List.of("read", "write"))
            .build();

        CheckResponse response = client.check(request);

        if (response.getResults().get("read").getEffect() == Effect.ALLOW) {
            System.out.println("Access granted");
        } else {
            System.out.println("Access denied");
        }
    }
}
```

**Spring Security Integration**:
```java
@Component
public class AuthZSecurityEvaluator implements SecurityEvaluator {

    @Autowired
    private AuthZClient authzClient;

    @Override
    public boolean hasPermission(Authentication authentication, Object targetDomainObject, Object permission) {
        String userId = authentication.getName();
        String action = (String) permission;
        String resourceKind = targetDomainObject.getClass().getSimpleName().toLowerCase();
        String resourceId = ((Identifiable) targetDomainObject).getId();

        CheckResponse response = authzClient.check(CheckRequest.builder()
            .principal(Principal.builder().id("user:" + userId).build())
            .resource(Resource.builder().kind(resourceKind).id(resourceId).build())
            .actions(List.of(action))
            .build());

        return response.getResults().get(action).getEffect() == Effect.ALLOW;
    }
}
```

**Testing Strategy**:
```bash
mvn test
mvn checkstyle:check
mvn spotbugs:check
```

**Risk**: Java version compatibility → Mitigation: Support Java 11+

#### 10.2.5 CLI Tools (P0)
**Estimated Effort**: 1 week (6 story points)
**Owner**: Developer experience team
**Dependencies**: REST API complete

**CLI Commands**:

```bash
# Policy management
authz-cli policy create ./policies/document-policy.yaml
authz-cli policy update document-policy ./policies/document-policy-v2.yaml
authz-cli policy delete document-policy
authz-cli policy list
authz-cli policy get document-policy
authz-cli policy validate ./policies/**/*.yaml

# Testing
authz-cli test ./policies/**/*_test.yaml
authz-cli test --coverage ./policies/**/*_test.yaml
authz-cli test --coverage --html=coverage.html ./policies/**/*_test.yaml

# Agent management
authz-cli agent register --type service --id agent-worker-1
authz-cli agent list
authz-cli agent get agent-worker-1
authz-cli agent revoke agent-worker-1

# Delegation
authz-cli delegation create --from user:alice --to agent:orchestrator --scopes "read:*,write:document"
authz-cli delegation list
authz-cli delegation revoke delegation-id-123

# Authorization checks (debugging)
authz-cli check --principal user:alice --resource document:doc-123 --action read

# Import/export
authz-cli import --from-cerbos ./cerbos-policies/**/*.yaml
authz-cli export --format cerbos > policies.yaml

# Configuration
authz-cli config set-context production --url https://authz.example.com --api-key $API_KEY
authz-cli config use-context production
```

**Implementation**:
```go
package main

import (
    "github.com/spf13/cobra"
    "github.com/authz-engine/authz-go-sdk/authz"
)

var rootCmd = &cobra.Command{
    Use:   "authz-cli",
    Short: "CLI for AuthZ Engine",
    Long:  "Command-line interface for managing policies, agents, and authorization checks",
}

var policyCmd = &cobra.Command{
    Use:   "policy",
    Short: "Manage policies",
}

var policyCreateCmd = &cobra.Command{
    Use:   "create [file]",
    Short: "Create a policy",
    Args:  cobra.ExactArgs(1),
    RunE: func(cmd *cobra.Command, args []string) error {
        client := getClient()
        policy := loadPolicy(args[0])
        return client.CreatePolicy(cmd.Context(), policy)
    },
}

func init() {
    rootCmd.AddCommand(policyCmd)
    policyCmd.AddCommand(policyCreateCmd)
    // ... more commands
}

func main() {
    if err := rootCmd.Execute(); err != nil {
        os.Exit(1)
    }
}
```

**Testing Strategy**:
```bash
go test ./cmd/authz-cli/... -v
```

**Risk**: CLI complexity → Mitigation: Intuitive commands, comprehensive help

#### 10.2.6 Policy Playground (P2)
**Estimated Effort**: 1 week (8 story points)
**Owner**: Frontend team
**Dependencies**: REST API complete

**Features**:
- Web-based policy editor (Monaco Editor)
- Real-time policy validation
- Authorization check simulator
- Share policy examples (URL)
- Test case generator

**Tech Stack**:
- React + TypeScript
- Monaco Editor (VS Code editor component)
- Tailwind CSS
- Deployed as static site (Vercel/Netlify)

**Playground UI**:
```
┌─────────────────────────────────────────────────────────────┐
│  AuthZ Policy Playground                            [Share] │
├─────────────────────────────────────────────────────────────┤
│  Policy Editor         │  Authorization Check Simulator     │
│                        │                                     │
│  apiVersion: authz/v1  │  Principal:                         │
│  name: document-policy │    ID: user:alice                  │
│  resource:             │    Roles: [owner]                  │
│    kind: document      │                                     │
│  rules:                │  Resource:                          │
│    - actions: [read]   │    Kind: document                  │
│      effect: allow     │    ID: doc-123                     │
│      roles: [owner]    │    Status: published               │
│                        │                                     │
│                        │  Action: read                      │
│                        │                                     │
│                        │  [Run Check]                       │
│                        │                                     │
│                        │  Result: ✅ ALLOW                   │
│                        │  Matched rule: document-policy:1   │
│                        │  Latency: 234µs                    │
│                        │                                     │
├─────────────────────────────────────────────────────────────┤
│  Test Cases            │  Validation Errors                 │
│                        │                                     │
│  [ ] Owner can read    │  ✅ No errors                       │
│  [ ] Viewer can read   │                                     │
│  [x] Guest cannot read │                                     │
│                        │                                     │
└─────────────────────────────────────────────────────────────┘
```

**Testing Strategy**:
```bash
npm test
npm run e2e
```

**Risk**: Browser compatibility → Mitigation: Support modern browsers only

#### 10.2.7 Documentation Portal (P0)
**Estimated Effort**: 1 week (8 story points)
**Owner**: Documentation team
**Dependencies**: None

**Portal Structure**:
```
docs.authz-engine.com/
├── Getting Started
│   ├── Quick Start
│   ├── Installation
│   └── First Policy
├── Concepts
│   ├── Policies
│   ├── Principal Policies
│   ├── Derived Roles
│   ├── Agents
│   └── Delegation
├── API Reference
│   ├── REST API
│   ├── gRPC API
│   └── SDKs
│       ├── Go
│       ├── Python
│       ├── Node.js
│       └── Java
├── CLI Reference
│   └── Commands
├── Deployment
│   ├── Docker
│   ├── Kubernetes
│   ├── Terraform
│   └── Cloud Providers
├── Examples
│   ├── Document Management
│   ├── Multi-Tenant SaaS
│   ├── Healthcare (HIPAA)
│   ├── Financial (SOC2)
│   ├── E-commerce
│   ├── Microservices
│   ├── Agent-to-Agent
│   └── Vector Store Anomaly Detection
├── Migration
│   └── From Cerbos
└── Reference
    ├── Policy Schema
    ├── CEL Expressions
    ├── Performance Tuning
    └── Security Best Practices
```

**Tech Stack**:
- Docusaurus or MkDocs
- Mermaid diagrams
- Interactive examples (CodeSandbox embeds)
- Search (Algolia)
- Versioned docs

**Example Documentation Page**:
```markdown
# Quick Start

Get started with AuthZ Engine in 5 minutes.

## Installation

```bash
# Docker
docker run -p 8080:8080 authz-engine/authz-server:latest

# Kubernetes
helm install authz authz-engine/authz-engine

# Go SDK
go get github.com/authz-engine/authz-go-sdk
```

## Create Your First Policy

```yaml
apiVersion: authz.engine/v1
name: document-policy
resource:
  kind: document
rules:
  - actions: ["read", "write"]
    effect: allow
    roles: ["owner"]
```

## Check Authorization

```go
client, _ := authz.NewClient("http://localhost:8080", "your-api-key")

resp, _ := client.Check(ctx, &authz.CheckRequest{
    Principal: &authz.Principal{ID: "user:alice", Roles: []string{"owner"}},
    Resource:  &authz.Resource{Kind: "document", ID: "doc-123"},
    Actions:   []string{"read"},
})

if resp.Results["read"].Effect == "allow" {
    // Access granted
}
```

## Next Steps

- [Learn about policies](/docs/concepts/policies)
- [Deploy to production](/docs/deployment/kubernetes)
- [Explore examples](/docs/examples)
```

**Testing Strategy**:
```bash
# Build docs
npm run build

# Check for broken links
npm run check-links

# Test search
npm run test-search
```

**Risk**: Documentation drift → Mitigation: Automated checks in CI, versioned docs

### 10.3 Testing Strategy

**SDK Testing**:
```bash
# Go SDK
go test ./authz/... -v

# Python SDK
pytest tests/ -v

# Node.js SDK
npm test

# Java SDK
mvn test
```

**CLI Testing**:
```bash
# Unit tests
go test ./cmd/authz-cli/... -v

# Integration tests
./scripts/test-cli.sh
```

**Documentation Testing**:
```bash
# Build docs
npm run build

# Check links
npm run check-links
```

### 10.4 Dependencies and Risks

**Dependencies**:
- Phase 5 complete (REST API)
- Phase 8 complete (policy testing framework)
- Phase 9 complete (deployment guides)

**Risks**:

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| SDK API changes | Medium | Medium | Semantic versioning, deprecation |
| Language version compatibility | Medium | Low | Support recent versions |
| Documentation drift | High | Medium | Automated checks, versioning |
| CLI complexity | Low | Low | Intuitive design, help text |

### 10.5 Timeline and Milestones

```
Week 1:  Go SDK → Milestone: 90%+ API coverage
Week 2:  Python SDK → Milestone: Django/Flask examples
Week 3:  Node.js SDK → Milestone: Express/NestJS examples
Week 4:  Java SDK → Milestone: Spring Boot integration
Week 5:  CLI tools → Milestone: Policy management from terminal
Week 6:  Documentation portal → Milestone: Phase 10 COMPLETE
```

---

## Feature Dependency Graph

```
Phase 4 (Complete)
    ↓
Phase 5: External Integrations & APIs (8-10 weeks)
    ├─ 5.1: Vector Store ────────┐
    ├─ 5.2: Agent Identity ──────┤
    └─ 5.3: MCP/A2A REST ────────┤
                                  ↓
Phase 6: Security & Hardening (6-8 weeks)
    ├─ 6.1: Authentication ──────┤
    ├─ 6.2: RBAC ────────────────┤
    ├─ 6.3: Audit Logging ───────┤
    └─ 6.4: Encryption ──────────┤
                                  ↓
Phase 7: Scalability & HA (8-10 weeks)
    ├─ 7.1: Redis Caching ───────┤
    ├─ 7.2: PostgreSQL ──────────┤
    ├─ 7.3: Clustering ──────────┤
    └─ 7.4: Horizontal Scaling ──┤
                                  ↓
Phase 8: Advanced Policy Features (6-8 weeks)
    ├─ 8.1: Derived Roles ───────┤
    ├─ 8.2: Import/Export ───────┤
    ├─ 8.3: Validation ──────────┤
    └─ 8.4: Testing Framework ───┤
                                  ├──┐
                                  ↓  │
Phase 9: DevOps & Operations (6-8 weeks)  │
    ├─ 9.1: Helm Charts ─────────┤  │
    ├─ 9.2: Terraform ───────────┤  │
    ├─ 9.3: GitOps ──────────────┤  │
    └─ 9.4: Backup/Restore ──────┤  │
                                  ↓  │
Phase 10: Developer Experience (4-6 weeks) │
    ├─ 10.1: SDKs (Go/Py/Node/Java)┤  │
    ├─ 10.2: CLI Tools ────────────┼──┘
    ├─ 10.3: Playground ───────────┤
    └─ 10.4: Documentation ────────┘
```

**Critical Path**: Phase 5 → 6 → 7 → 9 → 10 (Production deployment)
**Parallel Tracks**: Phase 8 (Policy features) can run in parallel with Phase 7

---

## Risk Assessment & Mitigation

### High-Risk Items (P0 - Blocking Production)

| Risk | Phase | Probability | Impact | Mitigation Strategy |
|------|-------|-------------|--------|---------------------|
| Vector store performance targets not met | 5 | Medium | High | HNSW parameter tuning, profiling, batch operations |
| Security vulnerabilities discovered | 6 | Medium | Critical | Security audit, penetration testing, bug bounty |
| Database performance bottleneck | 7 | High | High | Aggressive caching (95%+ hit rate), read replicas |
| Split-brain scenarios in clustering | 7 | Medium | High | Raft quorum (3+ nodes), network partitioning tests |
| Authentication bypass | 6 | Low | Critical | Multiple layers (JWT + RBAC + audit), security review |

### Medium-Risk Items (P1 - Production Quality)

| Risk | Phase | Probability | Impact | Mitigation Strategy |
|------|-------|-------------|--------|---------------------|
| Delegation chain complexity | 5 | Medium | Medium | Cache validated chains, limit max hops to 5 |
| Cache stampede | 7 | Medium | Medium | Probabilistic early expiration, distributed locking |
| Cerbos format incompatibilities | 8 | Medium | Medium | Clear documentation, compatibility checker |
| Helm chart complexity | 9 | Medium | Low | Thorough testing, comprehensive documentation |
| SDK API changes | 10 | Medium | Medium | Semantic versioning, deprecation warnings |

### Low-Risk Items (P2 - Nice to Have)

| Risk | Phase | Probability | Impact | Mitigation Strategy |
|------|-------|-------------|--------|---------------------|
| Policy testing framework complexity | 8 | Medium | Low | Start simple, iterate based on feedback |
| Documentation drift | 10 | High | Low | Automated checks in CI, versioned docs |
| CLI tool usability | 10 | Low | Low | User testing, intuitive design |

### Risk Mitigation Strategies

**1. Performance Risks**:
- Continuous benchmarking (every PR)
- Performance budgets (max latency thresholds)
- Load testing before production
- Graceful degradation

**2. Security Risks**:
- Security audit before each phase completion
- Penetration testing (quarterly)
- Bug bounty program
- Automated security scanning (Snyk, Dependabot)
- Least privilege principle

**3. Operational Risks**:
- Comprehensive monitoring (Prometheus + Grafana)
- Alerting with PagerDuty integration
- Runbooks for common issues
- Quarterly disaster recovery drills
- Automated backups with verification

**4. Development Risks**:
- Test-Driven Development (TDD)
- Code reviews (2 approvals minimum)
- Continuous Integration (CI)
- Feature flags for gradual rollout
- Rollback mechanisms

---

## Resource Requirements

### Team Composition

**Core Team** (6-8 engineers):
- 2x Backend Engineers (Go)
- 1x Security Engineer
- 1x Infrastructure Engineer
- 1x Frontend Engineer (for playground)
- 1x Technical Writer
- 1x DevOps Engineer
- 1x QA Engineer

**Extended Team** (part-time):
- 1x Product Manager (20% time)
- 1x Designer (10% time)
- 1x SDK Engineer (per SDK language, part-time)

### Infrastructure Requirements

**Development**:
- GitHub repository
- CI/CD (GitHub Actions or GitLab CI)
- Test environments (Kubernetes cluster)
- Development databases (PostgreSQL, Redis)

**Production** (per environment):
- Kubernetes cluster (3+ nodes, 8 CPU / 16GB RAM each)
- PostgreSQL (primary + 2 replicas, db.t3.medium)
- Redis cluster (3+ nodes, cache.t3.medium)
- Load balancer (AWS ALB / GCP LB / Azure App Gateway)
- Monitoring (Prometheus + Grafana)
- Logging (ELK / Loki)
- Secrets management (Vault / AWS Secrets Manager)

**Estimated Cloud Costs** (monthly, production):
- Compute (Kubernetes): $500-$1,000
- Database (PostgreSQL): $200-$400
- Cache (Redis): $150-$300
- Load balancer: $20-$50
- Storage (backups): $50-$100
- Monitoring: $50-$100
- **Total**: ~$1,000-$2,000/month

### Timeline and Effort

**Phase-by-Phase Breakdown**:

| Phase | Duration | Effort (story points) | Team Size |
|-------|----------|----------------------|-----------|
| Phase 5: External Integrations | 8-10 weeks | 67 SP | 4-5 engineers |
| Phase 6: Security Hardening | 6-8 weeks | 61 SP | 3-4 engineers |
| Phase 7: Scalability & HA | 8-10 weeks | 82 SP | 4-5 engineers |
| Phase 8: Advanced Policy Features | 6-8 weeks | 61 SP | 3-4 engineers |
| Phase 9: DevOps & Operations | 6-8 weeks | 68 SP | 3-4 engineers |
| Phase 10: Developer Experience | 4-6 weeks | 54 SP | 3-4 engineers |
| **Total** | **38-50 weeks** | **393 SP** | **4-5 engineers avg** |

**Parallelization Opportunities**:
- Phase 8 (Policy features) can run in parallel with Phase 7 (Scalability)
- SDKs (Phase 10) can be developed in parallel by different engineers
- Documentation (Phase 10) can be written continuously throughout

**Realistic Timeline with Parallelization**: 32-40 weeks (8-10 months)

---

## Success Criteria

### Phase 5 Success Criteria

**Functional**:
- [  ] Vector store: >97K insert/sec, <1ms p50 search latency
- [  ] Agent lookup: <1µs O(1) constant time
- [  ] Delegation validation: <100ms for 3-hop chains
- [  ] All 98+ tests passing (unit + integration + E2E)
- [  ] Zero regressions in Phases 1-4

**Non-Functional**:
- [  ] Documentation: All SDDs updated with actual implementation
- [  ] API documentation: OpenAPI 3.0 spec complete
- [  ] Performance benchmarks: Documented and validated

### Phase 6 Success Criteria

**Functional**:
- [  ] Authentication: JWT + OAuth + mTLS working
- [  ] Authorization: RBAC enforced on all admin APIs
- [  ] Audit logs: Immutable, tamper-proof, queryable
- [  ] Encryption: TLS 1.3, AES-256-GCM at rest
- [  ] Rate limiting: <0.1% false positives

**Non-Functional**:
- [  ] Security audit: Zero critical/high vulnerabilities
- [  ] Compliance: SOC2 Type II audit readiness
- [  ] Penetration test: Passed with no critical findings

### Phase 7 Success Criteria

**Functional**:
- [  ] Throughput: >100K decisions/sec (10 instances)
- [  ] Latency: <1ms p50, <5ms p99 (with Redis cache)
- [  ] Uptime: 99.99% (4.38 minutes/month downtime)
- [  ] Cache hit rate: >95%
- [  ] Failover time: <5 seconds

**Non-Functional**:
- [  ] Database replication lag: <100ms
- [  ] Load testing: Passed with 100K RPS sustained for 1 hour
- [  ] Chaos testing: Survived random node failures

### Phase 8 Success Criteria

**Functional**:
- [  ] Cerbos compatibility: 95%+ policy compatibility
- [  ] Validation: <1% false positives on schema validation
- [  ] Test framework: >90% policy coverage achievable
- [  ] Versioning: Zero-downtime policy rollback
- [  ] Analytics: Real-time policy usage insights

**Non-Functional**:
- [  ] CLI tool: <5 min to manage policies from terminal
- [  ] Policy testing: <10 seconds to run 100 test cases

### Phase 9 Success Criteria

**Functional**:
- [  ] Kubernetes deployment: <5 min from zero to production
- [  ] Terraform deployment: <10 min for full infrastructure
- [  ] GitOps sync time: <30 seconds
- [  ] Backup/restore: <15 min RTO, <1 hour RPO
- [  ] Migration success rate: >99%

**Non-Functional**:
- [  ] MTTR (Mean Time To Recovery): <10 minutes
- [  ] Disaster recovery drill: Quarterly, <30 min total recovery time
- [  ] Runbooks: Comprehensive, tested

### Phase 10 Success Criteria

**Functional**:
- [  ] SDKs: 4 languages (Go, Python, Node.js, Java) with 90%+ API coverage
- [  ] CLI: <5 min to manage policies from terminal
- [  ] Playground: Real-time policy validation and simulation
- [  ] Documentation: <2 min to find any answer

**Non-Functional**:
- [  ] Community: 100+ GitHub stars, 10+ contributors
- [  ] SDK downloads: 1000+ in first month
- [  ] Documentation visits: 1000+ unique visitors/month

### Overall Production Readiness Criteria

**Technical**:
- [  ] All phases (5-10) complete
- [  ] All tests passing (>95% coverage)
- [  ] Performance targets met
- [  ] Security audit passed
- [  ] Load testing passed (100K RPS sustained)

**Operational**:
- [  ] Monitoring: Comprehensive Prometheus metrics + Grafana dashboards
- [  ] Alerting: PagerDuty integration, <5 min response time
- [  ] Runbooks: Complete for all major incidents
- [  ] Backup/restore: Tested and documented
- [  ] Disaster recovery: Quarterly drills, <30 min recovery

**Documentation**:
- [  ] API documentation: Complete OpenAPI 3.0 spec
- [  ] User guides: Getting started, deployment, migration
- [  ] Reference: Policy schema, CEL expressions, performance tuning
- [  ] Examples: 10+ real-world use cases
- [  ] Runbooks: Operational procedures

**Community**:
- [  ] GitHub: 100+ stars, 10+ contributors
- [  ] Slack/Discord: Community channel with >50 members
- [  ] Documentation: 1000+ unique visitors/month
- [  ] SDK downloads: 1000+ in first month

---

## Appendix A: Glossary

**Terms**:
- **AuthZ**: Authorization
- **CEL**: Common Expression Language
- **HNSW**: Hierarchical Navigable Small World (vector search algorithm)
- **MCP/A2A**: Model Context Protocol / Agent-to-Agent
- **O(1)**: Constant time complexity
- **P0/P1/P2**: Priority levels (P0 = critical, P1 = high, P2 = medium)
- **RBAC**: Role-Based Access Control
- **ReBAC**: Relationship-Based Access Control
- **RTO**: Recovery Time Objective
- **RPO**: Recovery Point Objective
- **SDD**: Software Design Document
- **SP**: Story Point (effort estimation unit)
- **TDD**: Test-Driven Development

---

## Appendix B: References

**External Documentation**:
- Cerbos: https://cerbos.dev/
- CEL Language: https://github.com/google/cel-spec
- HNSW Algorithm: https://arxiv.org/abs/1603.09320
- fogfish/hnsw: https://github.com/fogfish/hnsw
- HashiCorp Raft: https://github.com/hashicorp/raft
- Kubernetes: https://kubernetes.io/
- Terraform: https://www.terraform.io/
- ArgoCD: https://argo-cd.readthedocs.io/
- Prometheus: https://prometheus.io/
- Grafana: https://grafana.com/

**Internal Documentation**:
- ADR-001 to ADR-012: Architecture Decision Records
- Phase 1-4 documentation: Complete implementation reports
- Phase 5 documentation: External integrations design
- Security best practices: Internal security guide

---

**Document Version**: 1.0
**Last Updated**: 2025-11-26
**Next Review**: 2025-12-10 (after Phase 5 Week 2)
**Owner**: System Architect Team

---

**End of Roadmap**

This roadmap provides a comprehensive, production-ready plan for Phases 5-10 of the AuthZ Engine. Each phase builds on the previous, with clear dependencies, risk mitigation, and success criteria. The total timeline is 38-50 weeks (9-12 months) with opportunities for parallelization to reduce to 32-40 weeks.
