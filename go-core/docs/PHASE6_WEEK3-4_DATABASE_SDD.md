# Phase 6 Week 3-4: PostgreSQL Database Persistence
## Software Design Document (SDD)

**Version**: 1.0
**Date**: 2025-11-26
**Status**: DRAFT
**Author**: System Architecture Designer
**Reviewers**: Security Team, Backend Team, DevOps Team

---

## 1. Overview

### 1.1 Purpose
This document specifies the design and implementation of a PostgreSQL-backed persistence layer for the AuthZ Engine, replacing the current in-memory storage with durable, production-grade database persistence.

### 1.2 Scope
**In Scope**:
- PostgreSQL schema design for policies, agents, credentials, and audit logs
- Policy store implementation (`internal/policy/postgres.go`)
- Agent store implementation (`internal/agent/postgres.go`)
- Database migration strategy (zero-downtime)
- Connection pooling and query optimization
- Cache-aside pattern (Redis + PostgreSQL)
- Backup and disaster recovery procedures

**Out of Scope**:
- Multi-region replication (deferred to Phase 7)
- Sharding/horizontal scaling (deferred to Phase 8)
- NoSQL alternatives (MongoDB, DynamoDB)
- Full-text search (Elasticsearch integration - Phase 9)

### 1.3 Success Criteria
| Metric | Target | Measurement |
|--------|--------|-------------|
| Query Latency (p50) | <2ms | pgBench + application metrics |
| Query Latency (p99) | <5ms | Prometheus histogram |
| Write Latency (p99) | <10ms | Transaction duration tracking |
| Data Loss Tolerance | Zero | ACID compliance, WAL archiving |
| Migration Downtime | Zero | Blue-green deployment validation |
| Cache Hit Rate | >90% | Redis metrics |
| Connection Pool Utilization | 60-80% | PgBouncer stats |

### 1.4 Dependencies
| Component | Version | Purpose |
|-----------|---------|---------|
| PostgreSQL | 15.x+ | Primary database |
| PgBouncer | 1.21+ | Connection pooling |
| Redis | 7.x+ | Caching layer |
| golang-migrate | 4.x+ | Schema migrations |
| pgx | v5 | Go PostgreSQL driver |

---

## 2. Requirements

### 2.1 Functional Requirements

#### FR-1: Policy Persistence
- **FR-1.1**: Store resource policies with JSONB serialization
- **FR-1.2**: Store principal policies with JSONB serialization
- **FR-1.3**: Store derived role definitions with JSONB serialization
- **FR-1.4**: Support policy versioning (optimistic locking)
- **FR-1.5**: Enable soft deletes (`is_deleted` flag)
- **FR-1.6**: Support full-text search on policy names (GIN index)

#### FR-2: Agent Persistence
- **FR-2.1**: Store agent metadata (ID, type, display name, status)
- **FR-2.2**: Store agent credentials with cryptographic hashing
- **FR-2.3**: Support credential expiration and revocation
- **FR-2.4**: Track agent lifecycle (active, suspended, revoked, expired)

#### FR-3: Audit Logging
- **FR-3.1**: Store authorization check decisions (allow/deny)
- **FR-3.2**: Capture request metadata (principal, resource, action, timestamp)
- **FR-3.3**: Enable time-based partitioning (monthly partitions)
- **FR-3.4**: Support audit log retention policies (90 days default)

#### FR-4: Transactions & Consistency
- **FR-4.1**: ACID compliance for all write operations
- **FR-4.2**: Optimistic concurrency control (version numbers)
- **FR-4.3**: Serializable isolation for critical operations
- **FR-4.4**: Automatic retry on transient failures

### 2.2 Non-Functional Requirements

#### NFR-1: Performance
- **NFR-1.1**: Policy retrieval queries: <2ms p50, <5ms p99
- **NFR-1.2**: Agent lookup queries: <1ms p50, <3ms p99
- **NFR-1.3**: Policy upsert operations: <10ms p99
- **NFR-1.4**: Concurrent connections: 50-100 (via PgBouncer)
- **NFR-1.5**: Throughput: 10,000 authz checks/sec with database persistence

#### NFR-2: Availability
- **NFR-2.1**: Database uptime: 99.99% (52 minutes downtime/year)
- **NFR-2.2**: Automatic failover: <30 seconds (PostgreSQL HA)
- **NFR-2.3**: Backup frequency: Continuous WAL archiving + daily snapshots
- **NFR-2.4**: Recovery Point Objective (RPO): <1 minute
- **NFR-2.5**: Recovery Time Objective (RTO): <5 minutes

#### NFR-3: Security
- **NFR-3.1**: Encrypted connections (TLS 1.3)
- **NFR-3.2**: Least-privilege database users (read-only, read-write roles)
- **NFR-3.3**: Credential hashing (bcrypt with work factor 12)
- **NFR-3.4**: Row-level security (RLS) for multi-tenancy
- **NFR-3.5**: Audit log immutability (append-only table)

#### NFR-4: Scalability
- **NFR-4.1**: Support 100,000 policies
- **NFR-4.2**: Support 10,000 agents
- **NFR-4.3**: Audit log retention: 1 billion records (90 days × 10M checks/day)
- **NFR-4.4**: Connection pooling: Reuse connections (PgBouncer transaction mode)

#### NFR-5: Maintainability
- **NFR-5.1**: Automated schema migrations (golang-migrate)
- **NFR-5.2**: Zero-downtime deployments (blue-green strategy)
- **NFR-5.3**: Rollback procedures: <5 minutes
- **NFR-5.4**: Database health monitoring (Prometheus + Grafana)

---

## 3. Architecture

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AuthZ Engine API Server                  │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────┐ │
│  │ Policy Service │  │ Agent Service  │  │ Audit Service│ │
│  └────────┬───────┘  └────────┬───────┘  └──────┬───────┘ │
│           │                    │                  │         │
│  ┌────────▼────────────────────▼──────────────────▼──────┐ │
│  │         Cache-Aside Layer (Redis)                     │ │
│  │  - Policy cache (5 min TTL)                           │ │
│  │  - Agent cache (10 min TTL)                           │ │
│  │  - Cache invalidation on writes                       │ │
│  └────────┬──────────────────────────────────────────────┘ │
└───────────┼──────────────────────────────────────────────────┘
            │
            │ (Cache miss → Query DB)
            ▼
┌─────────────────────────────────────────────────────────────┐
│                  PgBouncer (Connection Pool)                │
│  - Mode: Transaction pooling                                │
│  - Max connections: 100                                     │
│  - Pool size per user: 25                                   │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              PostgreSQL 15 (Primary + Replica)              │
│  ┌───────────────┐  ┌────────────────┐  ┌──────────────┐  │
│  │ Policies      │  │ Agents         │  │ Audit Logs   │  │
│  │ Table         │  │ Table          │  │ (Partitioned)│  │
│  │               │  │                │  │              │  │
│  │ - JSONB data  │  │ - Credentials  │  │ - Time-based │  │
│  │ - Versioning  │  │ - Status       │  │ - Retention  │  │
│  │ - GIN indexes │  │ - Expiration   │  │ - Immutable  │  │
│  └───────────────┘  └────────────────┘  └──────────────┘  │
│                                                             │
│  WAL Archiving → S3/GCS (Point-in-Time Recovery)           │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Connection Pooling Strategy

**PgBouncer Configuration**:
```ini
[databases]
authz_engine = host=localhost port=5432 dbname=authz_engine

[pgbouncer]
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 25
reserve_pool_size = 5
reserve_pool_timeout = 3
server_idle_timeout = 600
server_lifetime = 3600
```

**Go Application**:
```go
// pkg/db/pool.go
type Config struct {
    MaxOpenConns    int           // 50 (PgBouncer handles pooling)
    MaxIdleConns    int           // 10
    ConnMaxLifetime time.Duration // 5 minutes
    ConnMaxIdleTime time.Duration // 2 minutes
}
```

### 3.3 Cache-Aside Pattern

**Cache Invalidation Strategy**:
1. **Write-Through**: Update DB first, then invalidate cache
2. **TTL**: 5 minutes for policies, 10 minutes for agents
3. **Event-Driven**: Publish invalidation events on policy updates

```go
// Policy cache key: policy:{name}
// Agent cache key: agent:{id}
// Invalidation: DELETE FROM cache WHERE key LIKE 'policy:*'
```

---

## 4. Database Schema

### 4.1 Policies Table

```sql
CREATE TABLE policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id VARCHAR(255) NOT NULL,              -- User-facing policy ID
    version INTEGER NOT NULL DEFAULT 1,           -- Optimistic locking version
    kind VARCHAR(50) NOT NULL,                    -- 'resource', 'principal', 'derived_role'
    content JSONB NOT NULL,                       -- Full policy definition (types.Policy)
    metadata JSONB,                               -- User metadata (tags, description)

    -- Audit fields
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by VARCHAR(255),                      -- Agent ID who created
    updated_by VARCHAR(255),                      -- Agent ID who updated

    -- Soft delete
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at TIMESTAMPTZ,
    deleted_by VARCHAR(255),

    -- Constraints
    CONSTRAINT unique_policy_version UNIQUE(policy_id, version),
    CONSTRAINT valid_kind CHECK (kind IN ('resource', 'principal', 'derived_role'))
);

-- Indexes for common queries
CREATE INDEX idx_policies_policy_id ON policies(policy_id) WHERE is_deleted = FALSE;
CREATE INDEX idx_policies_kind ON policies(kind) WHERE is_deleted = FALSE;
CREATE INDEX idx_policies_created_at ON policies(created_at DESC);

-- JSONB GIN index for fast queries on content
CREATE INDEX idx_policies_content_gin ON policies USING GIN(content jsonb_path_ops);

-- Full-text search on policy names
CREATE INDEX idx_policies_content_name ON policies USING GIN(
    (content->>'name') gin_trgm_ops
);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_policies_updated_at
    BEFORE UPDATE ON policies
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

**JSONB Content Structure**:
```json
{
  "apiVersion": "api.authz.com/v1",
  "name": "document-policy",
  "resourceKind": "document",
  "scope": "acme.corp.engineering",
  "principalPolicy": false,
  "rules": [
    {
      "name": "allow-view",
      "actions": ["view", "read"],
      "effect": "allow",
      "roles": ["viewer", "editor"],
      "condition": "resource.attr.status == 'published'"
    }
  ]
}
```

### 4.2 Agents Table

```sql
CREATE TABLE agents (
    id VARCHAR(255) PRIMARY KEY,                  -- Agent ID (user-defined)
    type VARCHAR(50) NOT NULL,                    -- 'service', 'human', 'ai-agent', 'mcp-agent'
    display_name VARCHAR(255),                    -- Human-readable name
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'active', 'suspended', 'revoked', 'expired'
    metadata JSONB,                               -- Custom metadata (email, department, etc.)

    -- Lifecycle timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,                       -- Expiration time (NULL = no expiration)

    -- Constraints
    CONSTRAINT valid_type CHECK (type IN ('service', 'human', 'ai-agent', 'mcp-agent')),
    CONSTRAINT valid_status CHECK (status IN ('active', 'suspended', 'revoked', 'expired'))
);

-- Indexes
CREATE INDEX idx_agents_type ON agents(type);
CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_agents_expires_at ON agents(expires_at) WHERE expires_at IS NOT NULL;

-- Trigger for updated_at
CREATE TRIGGER trigger_agents_updated_at
    BEFORE UPDATE ON agents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

### 4.3 Credentials Table

```sql
CREATE TABLE credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id VARCHAR(255) NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    credential_id VARCHAR(255) NOT NULL,          -- User-facing credential ID
    type VARCHAR(50) NOT NULL,                    -- 'api-key', 'oauth-token', 'certificate'
    value_hash VARCHAR(255) NOT NULL,             -- bcrypt(credential_value)

    -- Lifecycle
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,

    -- Metadata
    metadata JSONB,                               -- Scopes, permissions, etc.

    -- Constraints
    CONSTRAINT unique_agent_credential UNIQUE(agent_id, credential_id),
    CONSTRAINT valid_credential_type CHECK (type IN ('api-key', 'oauth-token', 'certificate'))
);

-- Indexes
CREATE INDEX idx_credentials_agent_id ON credentials(agent_id);
CREATE INDEX idx_credentials_credential_id ON credentials(credential_id);
CREATE INDEX idx_credentials_expires_at ON credentials(expires_at) WHERE expires_at IS NOT NULL;
```

### 4.4 Audit Log Table (Partitioned)

```sql
CREATE TABLE audit_log (
    id BIGSERIAL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_type VARCHAR(100) NOT NULL,             -- 'auth_check', 'policy_create', 'policy_update', etc.

    -- Request details
    principal_id VARCHAR(255),
    principal_roles TEXT[],                        -- Array of roles
    resource_kind VARCHAR(100),
    resource_id VARCHAR(255),
    action VARCHAR(100),

    -- Decision
    decision VARCHAR(20),                          -- 'allow', 'deny'
    policy_name VARCHAR(255),                      -- Matched policy

    -- Context
    metadata JSONB,                                -- Request context, IP address, user agent

    -- Constraints
    CONSTRAINT valid_decision CHECK (decision IN ('allow', 'deny'))
) PARTITION BY RANGE (timestamp);

-- Create monthly partitions for the next 12 months
-- Example: audit_log_2025_01, audit_log_2025_02, etc.
CREATE TABLE audit_log_2025_11 PARTITION OF audit_log
    FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');

CREATE TABLE audit_log_2025_12 PARTITION OF audit_log
    FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');

-- Indexes on partitions (inherited)
CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp DESC);
CREATE INDEX idx_audit_log_principal ON audit_log(principal_id);
CREATE INDEX idx_audit_log_event_type ON audit_log(event_type);
CREATE INDEX idx_audit_log_decision ON audit_log(decision);

-- Auto-create new partitions (via cron job or pg_partman extension)
-- Retention policy: DROP old partitions after 90 days
```

### 4.5 Database Migrations Table (golang-migrate)

```sql
CREATE TABLE schema_migrations (
    version BIGINT NOT NULL PRIMARY KEY,
    dirty BOOLEAN NOT NULL
);
```

---

## 5. Implementation Plan

### 5.1 Week 1: Database Setup & Policy Migration

#### Day 1-2: PostgreSQL Setup & Schema Creation
**Tasks**:
- Install PostgreSQL 15 (Docker Compose for dev, managed RDS/Cloud SQL for prod)
- Create database user with least-privilege permissions
- Apply schema migrations (`golang-migrate`)
- Set up PgBouncer connection pooling
- Configure WAL archiving (S3/GCS)

**Deliverables**:
```bash
# migrations/001_create_policies_table.up.sql
# migrations/002_create_agents_table.up.sql
# migrations/003_create_credentials_table.up.sql
# migrations/004_create_audit_log_table.up.sql
```

**Testing**:
```bash
# Apply migrations
migrate -path ./migrations -database "postgres://localhost:5432/authz_engine?sslmode=disable" up

# Verify schema
psql -d authz_engine -c "\dt"
psql -d authz_engine -c "\d policies"
```

#### Day 3: Policy Store PostgreSQL Implementation
**File**: `internal/policy/postgres.go`

**Interface Implementation**:
```go
package policy

import (
    "context"
    "database/sql"
    "encoding/json"
    "fmt"
    "time"

    "github.com/authz-engine/go-core/pkg/types"
    "github.com/jackc/pgx/v5/pgxpool"
)

type PostgresStore struct {
    pool *pgxpool.Pool
}

func NewPostgresStore(ctx context.Context, connString string) (*PostgresStore, error) {
    config, err := pgxpool.ParseConfig(connString)
    if err != nil {
        return nil, fmt.Errorf("failed to parse connection string: %w", err)
    }

    // Configure pool
    config.MaxConns = 50
    config.MinConns = 10
    config.MaxConnLifetime = 5 * time.Minute
    config.MaxConnIdleTime = 2 * time.Minute

    pool, err := pgxpool.NewWithConfig(ctx, config)
    if err != nil {
        return nil, fmt.Errorf("failed to create connection pool: %w", err)
    }

    return &PostgresStore{pool: pool}, nil
}

// Get retrieves a policy by name
func (s *PostgresStore) Get(name string) (*types.Policy, error) {
    ctx := context.Background()

    var contentJSON []byte
    err := s.pool.QueryRow(ctx, `
        SELECT content
        FROM policies
        WHERE policy_id = $1 AND is_deleted = FALSE
        ORDER BY version DESC
        LIMIT 1
    `, name).Scan(&contentJSON)

    if err == sql.ErrNoRows {
        return nil, fmt.Errorf("policy not found: %s", name)
    }
    if err != nil {
        return nil, fmt.Errorf("failed to get policy: %w", err)
    }

    var policy types.Policy
    if err := json.Unmarshal(contentJSON, &policy); err != nil {
        return nil, fmt.Errorf("failed to unmarshal policy: %w", err)
    }

    return &policy, nil
}

// Add adds a policy to the store
func (s *PostgresStore) Add(policy *types.Policy) error {
    ctx := context.Background()

    contentJSON, err := json.Marshal(policy)
    if err != nil {
        return fmt.Errorf("failed to marshal policy: %w", err)
    }

    kind := "resource"
    if policy.PrincipalPolicy {
        kind = "principal"
    }

    _, err = s.pool.Exec(ctx, `
        INSERT INTO policies (policy_id, kind, content, version)
        VALUES ($1, $2, $3, 1)
        ON CONFLICT (policy_id, version)
        DO UPDATE SET content = $3, updated_at = NOW()
    `, policy.Name, kind, contentJSON)

    if err != nil {
        return fmt.Errorf("failed to add policy: %w", err)
    }

    return nil
}

// FindPolicies finds policies by resource kind
func (s *PostgresStore) FindPolicies(resourceKind string, actions []string) []*types.Policy {
    ctx := context.Background()

    rows, err := s.pool.Query(ctx, `
        SELECT content
        FROM policies
        WHERE content->>'resourceKind' = $1
          AND is_deleted = FALSE
        ORDER BY created_at DESC
    `, resourceKind)

    if err != nil {
        return nil
    }
    defer rows.Close()

    var policies []*types.Policy
    for rows.Next() {
        var contentJSON []byte
        if err := rows.Scan(&contentJSON); err != nil {
            continue
        }

        var policy types.Policy
        if err := json.Unmarshal(contentJSON, &policy); err != nil {
            continue
        }

        policies = append(policies, &policy)
    }

    return policies
}

// Implement remaining Store interface methods...
```

**Testing**:
```bash
go test ./internal/policy -run TestPostgresStore -v
```

#### Day 4: Migration from In-Memory to PostgreSQL
**File**: `internal/migration/migrate_policies.go`

**Zero-Downtime Migration Strategy**:
1. **Dual-Write Phase** (Week 1, Day 4):
   - Write to both in-memory and PostgreSQL
   - Read from in-memory (existing behavior)
   - Backfill existing policies to PostgreSQL

2. **Dual-Read Validation** (Week 1, Day 5):
   - Read from PostgreSQL
   - Compare with in-memory results
   - Log discrepancies

3. **Cutover** (Week 2, Day 1):
   - Switch primary read source to PostgreSQL
   - Keep in-memory as fallback
   - Monitor error rates

4. **Deprecation** (Week 2, Day 2):
   - Remove in-memory store
   - PostgreSQL is sole source of truth

**Migration Script**:
```go
package migration

import (
    "context"
    "log"
    "github.com/authz-engine/go-core/internal/policy"
)

func MigratePolicies(memStore *policy.MemoryStore, pgStore *policy.PostgresStore) error {
    policies := memStore.GetAll()

    for _, p := range policies {
        if err := pgStore.Add(p); err != nil {
            log.Printf("Failed to migrate policy %s: %v", p.Name, err)
            return err
        }
    }

    log.Printf("Migrated %d policies to PostgreSQL", len(policies))
    return nil
}
```

#### Day 5: Testing & Rollback Procedures
**Testing Suite**:
```bash
# Unit tests
go test ./internal/policy -run TestPostgresStore -v

# Integration tests (with Docker Compose PostgreSQL)
go test ./tests/integration -run TestPolicyPersistence -v

# Performance tests (10K policies)
go test ./tests/performance -run TestQueryLatency -v -bench=.
```

**Rollback Procedure**:
1. Detect failure (error rate >1%)
2. Switch read source back to in-memory
3. Stop dual-write to PostgreSQL
4. Investigate root cause
5. Fix and redeploy
6. Resume migration

---

### 5.2 Week 2: Agent Store & Optimization

#### Day 1-2: Agent Store PostgreSQL Implementation
**File**: `internal/agent/postgres.go`

```go
package agent

import (
    "context"
    "fmt"
    "time"

    "github.com/authz-engine/go-core/pkg/types"
    "github.com/jackc/pgx/v5/pgxpool"
    "golang.org/x/crypto/bcrypt"
)

type PostgresAgentStore struct {
    pool *pgxpool.Pool
}

func NewPostgresAgentStore(ctx context.Context, connString string) (*PostgresAgentStore, error) {
    // Similar to PostgresStore setup
}

// Register creates a new agent with credentials
func (s *PostgresAgentStore) Register(ctx context.Context, agent *types.Agent) error {
    tx, err := s.pool.Begin(ctx)
    if err != nil {
        return fmt.Errorf("failed to start transaction: %w", err)
    }
    defer tx.Rollback(ctx)

    // Insert agent
    _, err = tx.Exec(ctx, `
        INSERT INTO agents (id, type, display_name, status, metadata, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6)
    `, agent.ID, agent.Type, agent.DisplayName, agent.Status,
       agent.Metadata, agent.ExpiresAt)

    if err != nil {
        return fmt.Errorf("failed to insert agent: %w", err)
    }

    // Insert credentials
    for _, cred := range agent.Credentials {
        hashedValue, err := bcrypt.GenerateFromPassword(
            []byte(cred.Value), bcrypt.DefaultCost)
        if err != nil {
            return fmt.Errorf("failed to hash credential: %w", err)
        }

        _, err = tx.Exec(ctx, `
            INSERT INTO credentials (agent_id, credential_id, type, value_hash, expires_at)
            VALUES ($1, $2, $3, $4, $5)
        `, agent.ID, cred.ID, cred.Type, string(hashedValue), cred.ExpiresAt)

        if err != nil {
            return fmt.Errorf("failed to insert credential: %w", err)
        }
    }

    if err := tx.Commit(ctx); err != nil {
        return fmt.Errorf("failed to commit transaction: %w", err)
    }

    return nil
}

// GetWithContext retrieves an agent by ID
func (s *PostgresAgentStore) GetWithContext(ctx context.Context, id string) (*types.Agent, error) {
    var agent types.Agent

    err := s.pool.QueryRow(ctx, `
        SELECT id, type, display_name, status, metadata, created_at, updated_at, expires_at
        FROM agents
        WHERE id = $1
    `, id).Scan(&agent.ID, &agent.Type, &agent.DisplayName, &agent.Status,
                &agent.Metadata, &agent.CreatedAt, &agent.UpdatedAt, &agent.ExpiresAt)

    if err != nil {
        return nil, fmt.Errorf("agent not found: %w", err)
    }

    // Load credentials
    rows, err := s.pool.Query(ctx, `
        SELECT credential_id, type, issued_at, expires_at, revoked_at
        FROM credentials
        WHERE agent_id = $1 AND revoked_at IS NULL
    `, id)

    if err != nil {
        return nil, fmt.Errorf("failed to load credentials: %w", err)
    }
    defer rows.Close()

    for rows.Next() {
        var cred types.Credential
        if err := rows.Scan(&cred.ID, &cred.Type, &cred.IssuedAt,
                            &cred.ExpiresAt, &cred.RevokedAt); err != nil {
            continue
        }
        agent.Credentials = append(agent.Credentials, cred)
    }

    return &agent, nil
}
```

#### Day 3: Audit Log Integration
**File**: `internal/audit/postgres.go`

```go
package audit

import (
    "context"
    "encoding/json"
    "time"

    "github.com/jackc/pgx/v5/pgxpool"
)

type PostgresAuditLog struct {
    pool *pgxpool.Pool
}

func (l *PostgresAuditLog) LogAuthCheck(ctx context.Context, req AuthCheckEvent) error {
    metadataJSON, _ := json.Marshal(req.Metadata)

    _, err := l.pool.Exec(ctx, `
        INSERT INTO audit_log (event_type, principal_id, principal_roles,
                               resource_kind, resource_id, action, decision,
                               policy_name, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, "auth_check", req.PrincipalID, req.PrincipalRoles,
       req.ResourceKind, req.ResourceID, req.Action, req.Decision,
       req.PolicyName, metadataJSON)

    return err
}

func (l *PostgresAuditLog) QueryLogs(ctx context.Context, filters AuditFilters) ([]AuditEvent, error) {
    query := `
        SELECT id, timestamp, event_type, principal_id, resource_kind,
               resource_id, action, decision, policy_name, metadata
        FROM audit_log
        WHERE timestamp >= $1 AND timestamp <= $2
    `

    rows, err := l.pool.Query(ctx, query, filters.StartTime, filters.EndTime)
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var events []AuditEvent
    for rows.Next() {
        var event AuditEvent
        // Scan rows...
        events = append(events, event)
    }

    return events, nil
}
```

#### Day 4: Query Optimization
**Optimization Techniques**:

1. **EXPLAIN ANALYZE** all queries:
```sql
EXPLAIN ANALYZE
SELECT content
FROM policies
WHERE content->>'resourceKind' = 'document'
  AND is_deleted = FALSE;

-- Expected: Index Scan using idx_policies_content_gin
-- Cost: ~0.1ms
```

2. **Add Missing Indexes**:
```sql
-- If EXPLAIN shows sequential scan, add index:
CREATE INDEX idx_policies_resource_kind ON policies((content->>'resourceKind'));
```

3. **Query Rewriting**:
```sql
-- BEFORE (slow):
SELECT * FROM policies WHERE content->>'name' LIKE '%document%';

-- AFTER (fast with GIN index):
SELECT * FROM policies WHERE content->>'name' % 'document';
```

4. **Connection Pooling Tuning**:
```go
config.MaxConns = 50           // Match PgBouncer pool size
config.MinConns = 10           // Pre-warm connections
config.MaxConnLifetime = 5m    // Prevent stale connections
config.HealthCheckPeriod = 1m  // Detect dead connections
```

#### Day 5: Performance Testing
**Load Testing Script** (`tests/performance/db_load_test.go`):
```go
func BenchmarkQueryLatency(b *testing.B) {
    // Setup: Insert 10,000 policies
    // Measure: p50, p95, p99 latency

    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            policy, err := store.Get("document-policy-1234")
            if err != nil {
                b.Fatal(err)
            }
        }
    })
}

// Target: p50 <2ms, p99 <5ms
```

**pgBench Load Testing**:
```bash
pgbench -c 50 -j 4 -T 60 -f tests/sql/select_policies.sql authz_engine

# Expected: 10,000+ TPS
```

---

## 6. Testing Strategy

### 6.1 Unit Tests
**Coverage**: 80%+

```go
// internal/policy/postgres_test.go
func TestPostgresStore_Add(t *testing.T) {
    // Test policy insertion
    // Verify JSONB serialization
    // Check version increment
}

func TestPostgresStore_Get(t *testing.T) {
    // Test policy retrieval
    // Verify soft delete filtering
}

func TestPostgresStore_FindPolicies(t *testing.T) {
    // Test JSONB queries
    // Verify index usage (EXPLAIN ANALYZE)
}
```

### 6.2 Integration Tests
**Docker Compose** (`docker-compose.test.yml`):
```yaml
version: '3.8'
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: authz_engine_test
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
    ports:
      - "5432:5432"
```

**Test Suite**:
```go
func TestIntegration_PolicyPersistence(t *testing.T) {
    // Setup: Start PostgreSQL container
    // Insert 1000 policies
    // Verify retrieval
    // Test concurrent writes
    // Teardown: Drop database
}
```

### 6.3 Performance Tests
**Load Test Scenarios**:
1. **Baseline**: 10,000 policies, 1,000 agents
2. **High Load**: 10,000 authz checks/sec
3. **Spike**: 50,000 authz checks/sec for 1 minute

**Metrics**:
- Query latency (p50, p95, p99)
- Connection pool utilization
- Cache hit rate
- Database CPU/memory usage

### 6.4 Migration Tests
**Test Data Integrity**:
```go
func TestMigration_DataIntegrity(t *testing.T) {
    // Load 1000 policies into in-memory store
    // Run migration to PostgreSQL
    // Compare policy counts
    // Verify policy content matches
    // Check for data loss
}
```

---

## 7. Performance Targets

### 7.1 Query Performance
| Query Type | Target Latency (p50) | Target Latency (p99) | Optimization |
|------------|---------------------|---------------------|--------------|
| Policy Get by Name | <1ms | <2ms | Primary key index |
| FindPolicies by Kind | <2ms | <5ms | GIN index on JSONB |
| Agent Get by ID | <1ms | <3ms | Primary key index |
| Audit Log Insert | <5ms | <10ms | Partitioned table |
| Audit Log Query (30 days) | <50ms | <100ms | Partition pruning |

### 7.2 Write Performance
| Operation | Target Latency (p99) | Notes |
|-----------|---------------------|-------|
| Policy Insert | <10ms | Single transaction |
| Policy Update | <15ms | Versioning overhead |
| Agent Register | <20ms | Multi-row insert (credentials) |
| Credential Revoke | <5ms | Single UPDATE |

### 7.3 Caching Performance
| Metric | Target | Measurement |
|--------|--------|-------------|
| Cache Hit Rate | >90% | Redis metrics |
| Cache Miss Penalty | <5ms | DB query latency |
| Cache Invalidation Time | <100ms | Event propagation |

---

## 8. Security Considerations

### 8.1 Encryption
**TLS Configuration**:
```go
connString := "postgres://user:pass@localhost:5432/authz_engine?sslmode=require&sslrootcert=/path/to/ca.crt"
```

**PostgreSQL** (`postgresql.conf`):
```ini
ssl = on
ssl_cert_file = '/path/to/server.crt'
ssl_key_file = '/path/to/server.key'
ssl_ca_file = '/path/to/ca.crt'
```

### 8.2 Least-Privilege Database Users
```sql
-- Read-only user (for replicas)
CREATE USER authz_reader WITH PASSWORD 'secure_password';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authz_reader;

-- Read-write user (for application)
CREATE USER authz_writer WITH PASSWORD 'secure_password';
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authz_writer;

-- Admin user (for migrations)
CREATE USER authz_admin WITH PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE authz_engine TO authz_admin;
```

### 8.3 Row-Level Security (Multi-Tenancy)
```sql
-- Enable RLS on policies table
ALTER TABLE policies ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see policies in their tenant
CREATE POLICY tenant_isolation ON policies
    USING (content->>'tenant' = current_setting('app.tenant_id')::text);
```

### 8.4 Audit Log Immutability
```sql
-- Prevent updates/deletes on audit_log
CREATE POLICY audit_log_immutable ON audit_log
    FOR UPDATE USING (false);

CREATE POLICY audit_log_no_delete ON audit_log
    FOR DELETE USING (false);
```

### 8.5 Credential Hashing
```go
// Use bcrypt with work factor 12
hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), 12)

// Validate credential
err := bcrypt.CompareHashAndPassword(hashedPassword, []byte(inputPassword))
```

---

## 9. Deployment

### 9.1 Blue-Green Deployment Strategy

**Phase 1: Blue Environment (Current)**
- In-memory policy store
- No database dependencies

**Phase 2: Green Environment (New)**
- PostgreSQL policy store
- Dual-write to in-memory + PostgreSQL
- Read from PostgreSQL (with in-memory fallback)

**Phase 3: Cutover**
1. Deploy Green environment (10% traffic)
2. Monitor error rates (<0.1%)
3. Gradually increase traffic (25%, 50%, 75%, 100%)
4. Deprecate Blue environment

**Rollback**:
- Switch traffic back to Blue (in-memory store)
- Investigate PostgreSQL issues
- Fix and redeploy

### 9.2 Database Migration Scripts

**Directory Structure**:
```
migrations/
├── 001_create_policies_table.up.sql
├── 001_create_policies_table.down.sql
├── 002_create_agents_table.up.sql
├── 002_create_agents_table.down.sql
├── 003_create_credentials_table.up.sql
├── 003_create_credentials_table.down.sql
├── 004_create_audit_log_table.up.sql
├── 004_create_audit_log_table.down.sql
```

**Apply Migrations**:
```bash
# Development
migrate -path ./migrations -database "postgres://localhost:5432/authz_engine?sslmode=disable" up

# Production
migrate -path ./migrations -database "$DATABASE_URL" up

# Rollback
migrate -path ./migrations -database "$DATABASE_URL" down 1
```

### 9.3 Connection String Management

**Environment Variables**:
```bash
# Development
export DATABASE_URL="postgres://authz_user:password@localhost:5432/authz_engine?sslmode=disable"

# Production (via Kubernetes Secret)
export DATABASE_URL="postgres://authz_user:$(cat /secrets/db-password)@postgres.internal:5432/authz_engine?sslmode=require"
```

**Configuration** (`config/database.yaml`):
```yaml
database:
  host: postgres.internal
  port: 5432
  name: authz_engine
  user: authz_user
  password: ${DB_PASSWORD}  # Injected from secret
  sslmode: require
  max_open_conns: 50
  max_idle_conns: 10
  conn_max_lifetime: 5m
```

### 9.4 Backup & Restore Procedures

**Continuous WAL Archiving**:
```bash
# postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'aws s3 cp %p s3://authz-backups/wal/%f'

# Retention: 7 days
```

**Daily Full Backups**:
```bash
#!/bin/bash
# backup.sh - Runs daily via cron

BACKUP_FILE="authz_engine_$(date +%Y%m%d).sql.gz"

pg_dump -h localhost -U authz_admin authz_engine | gzip > /backups/$BACKUP_FILE

# Upload to S3
aws s3 cp /backups/$BACKUP_FILE s3://authz-backups/daily/

# Retention: 30 days
find /backups -name "*.sql.gz" -mtime +30 -delete
```

**Point-in-Time Recovery (PITR)**:
```bash
# Restore to specific timestamp
pg_basebackup -h localhost -U authz_admin -D /var/lib/postgresql/15/main -Fp -Xs -P

# Create recovery.conf
echo "restore_command = 'aws s3 cp s3://authz-backups/wal/%f %p'" > /var/lib/postgresql/15/main/recovery.conf
echo "recovery_target_time = '2025-11-26 14:30:00'" >> /var/lib/postgresql/15/main/recovery.conf

# Start PostgreSQL (will replay WAL logs)
systemctl start postgresql
```

---

## 10. Acceptance Criteria

### 10.1 Functional Acceptance
- [ ] **AC-1**: All policies persisted to PostgreSQL with JSONB content
- [ ] **AC-2**: Policy retrieval works with <5ms p99 latency
- [ ] **AC-3**: Agent data persisted with credentials (bcrypt hashed)
- [ ] **AC-4**: Audit logs working with time-based partitioning
- [ ] **AC-5**: Policy versioning implemented (optimistic locking)
- [ ] **AC-6**: Soft deletes working (`is_deleted` flag)

### 10.2 Performance Acceptance
- [ ] **AC-7**: Query latency <5ms p99 (achieved via indexes)
- [ ] **AC-8**: Write latency <10ms p99
- [ ] **AC-9**: Cache hit rate >90% (Redis metrics)
- [ ] **AC-10**: Connection pool utilization 60-80%
- [ ] **AC-11**: 10,000 authz checks/sec with database persistence

### 10.3 Migration Acceptance
- [ ] **AC-12**: Zero data loss during migration (100% policy count match)
- [ ] **AC-13**: Zero downtime deployment (blue-green cutover <1s)
- [ ] **AC-14**: Rollback tested and working (<5 minutes)
- [ ] **AC-15**: Dual-write validation (in-memory vs PostgreSQL comparison)

### 10.4 Security Acceptance
- [ ] **AC-16**: TLS encryption enabled (sslmode=require)
- [ ] **AC-17**: Least-privilege database users configured
- [ ] **AC-18**: Credentials hashed with bcrypt (work factor 12)
- [ ] **AC-19**: Audit log immutability enforced (RLS policies)
- [ ] **AC-20**: Row-level security (RLS) tested for multi-tenancy

### 10.5 Operational Acceptance
- [ ] **AC-21**: Database migrations tested (up/down)
- [ ] **AC-22**: Backup/restore procedures validated (PITR tested)
- [ ] **AC-23**: Monitoring dashboards created (Prometheus + Grafana)
- [ ] **AC-24**: Alerting configured (query latency >10ms, error rate >1%)
- [ ] **AC-25**: Runbook created (incident response procedures)

---

## 11. Risks & Mitigation

### 11.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| **Query latency >5ms** | Medium | High | - Optimize indexes (GIN on JSONB)<br>- Use EXPLAIN ANALYZE<br>- Connection pooling (PgBouncer) |
| **Data loss during migration** | Low | Critical | - Dual-write validation<br>- Automated data integrity checks<br>- Rollback procedures |
| **Connection pool exhaustion** | Medium | High | - PgBouncer transaction pooling<br>- Max connections: 100<br>- Connection timeout: 3s |
| **PostgreSQL downtime** | Low | High | - PostgreSQL HA (primary + replica)<br>- Automatic failover (<30s)<br>- Circuit breaker pattern |
| **Audit log table bloat** | Medium | Medium | - Time-based partitioning<br>- Automatic partition pruning<br>- 90-day retention policy |

### 11.2 Operational Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| **Migration rollback failure** | Low | Critical | - Test rollback in staging<br>- Automated rollback scripts<br>- Keep in-memory as fallback |
| **Schema migration conflicts** | Medium | Medium | - Semantic versioning<br>- Migration testing in CI/CD<br>- Backward compatibility |
| **Backup corruption** | Low | High | - Verify backups weekly<br>- Test PITR recovery monthly<br>- Multiple backup locations (S3 + GCS) |

---

## 12. Monitoring & Observability

### 12.1 Database Metrics (Prometheus)

```yaml
# Prometheus scrape config
scrape_configs:
  - job_name: 'postgres'
    static_configs:
      - targets: ['postgres-exporter:9187']

  - job_name: 'pgbouncer'
    static_configs:
      - targets: ['pgbouncer-exporter:9127']
```

**Key Metrics**:
- `pg_stat_database_tup_fetched` (rows read)
- `pg_stat_database_tup_inserted` (rows written)
- `pg_stat_activity_count` (active connections)
- `pg_stat_bgwriter_buffers_alloc` (memory usage)
- `pgbouncer_pools_cl_waiting` (waiting clients)

### 12.2 Application Metrics

```go
// internal/metrics/db_metrics.go
var (
    dbQueryDuration = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name: "authz_db_query_duration_seconds",
            Help: "Database query latency",
            Buckets: []float64{0.001, 0.002, 0.005, 0.01, 0.02, 0.05},
        },
        []string{"query_type"},
    )

    dbConnectionsActive = prometheus.NewGauge(
        prometheus.GaugeOpts{
            Name: "authz_db_connections_active",
            Help: "Active database connections",
        },
    )
)
```

### 12.3 Alerting Rules

```yaml
# alerts.yml
groups:
  - name: database
    rules:
      - alert: HighQueryLatency
        expr: histogram_quantile(0.99, rate(authz_db_query_duration_seconds_bucket[5m])) > 0.005
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Database query latency >5ms (p99)"

      - alert: DatabaseConnectionPoolExhausted
        expr: authz_db_connections_active > 45
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Database connection pool near limit (45/50)"

      - alert: HighErrorRate
        expr: rate(authz_db_errors_total[5m]) > 0.01
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Database error rate >1%"
```

---

## 13. Rollback Plan

### 13.1 Rollback Triggers
- Query latency >10ms p99 for >5 minutes
- Error rate >1% for >2 minutes
- Data integrity issues detected
- PostgreSQL outage >1 minute

### 13.2 Rollback Procedure

**Step 1: Detect Failure** (Automated)
```go
// internal/circuit_breaker.go
if errorRate > 0.01 || latencyP99 > 10*time.Millisecond {
    circuitBreaker.Open()  // Stop PostgreSQL queries
    fallbackToInMemory()   // Switch to in-memory store
}
```

**Step 2: Switch Traffic** (Manual, <1 minute)
```bash
# Update Kubernetes deployment
kubectl set env deployment/authz-engine USE_POSTGRES=false

# Verify fallback
curl http://authz-engine/health
# Expected: {"status": "ok", "store": "in-memory"}
```

**Step 3: Investigate** (Manual, <10 minutes)
```bash
# Check PostgreSQL logs
kubectl logs -l app=postgres --tail=100

# Check query latency
psql -c "SELECT query, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"

# Check connection pool
psql -c "SELECT * FROM pg_stat_activity WHERE state = 'active';"
```

**Step 4: Fix & Redeploy** (Manual, <30 minutes)
- Fix identified issue (index, query optimization, etc.)
- Deploy fix to staging
- Validate fix (latency <5ms, error rate <0.1%)
- Re-enable PostgreSQL in production

**Step 5: Post-Mortem** (Within 24 hours)
- Root cause analysis
- Update runbook
- Add automated tests to prevent recurrence

---

## 14. Open Questions & Future Work

### 14.1 Open Questions
1. **Multi-Region Replication**: Should we use PostgreSQL logical replication or a distributed SQL database (CockroachDB, YugabyteDB)?
2. **Read Replicas**: How many read replicas do we need for 10,000 authz checks/sec?
3. **Sharding Strategy**: When do we need to shard the policies table (100K policies? 1M policies)?
4. **Cache Invalidation**: Should we use Redis Pub/Sub or Kafka for cache invalidation events?

### 14.2 Future Work (Phase 7+)
- **Phase 7**: Multi-region PostgreSQL replication (cross-region failover)
- **Phase 8**: Horizontal sharding (consistent hashing on `policy_id`)
- **Phase 9**: Elasticsearch integration (full-text search on policy content)
- **Phase 10**: Time-series database (TimescaleDB) for audit logs

---

## 15. Glossary

| Term | Definition |
|------|------------|
| **ACID** | Atomicity, Consistency, Isolation, Durability (database transaction properties) |
| **Cache-Aside** | Lazy-loading cache pattern (check cache, if miss, query DB and populate cache) |
| **GIN Index** | Generalized Inverted Index (for JSONB full-text search) |
| **JSONB** | PostgreSQL binary JSON storage format (faster than JSON) |
| **Optimistic Locking** | Concurrency control using version numbers (prevent lost updates) |
| **PgBouncer** | Lightweight PostgreSQL connection pooler |
| **PITR** | Point-In-Time Recovery (restore database to specific timestamp) |
| **RLS** | Row-Level Security (PostgreSQL access control at row level) |
| **WAL** | Write-Ahead Log (PostgreSQL transaction log for durability) |

---

## 16. References

1. **PostgreSQL Documentation**: https://www.postgresql.org/docs/15/
2. **PgBouncer Configuration**: https://www.pgbouncer.org/config.html
3. **golang-migrate**: https://github.com/golang-migrate/migrate
4. **pgx Driver**: https://github.com/jackc/pgx
5. **JSONB Performance**: https://www.postgresql.org/docs/15/datatype-json.html
6. **Connection Pooling Best Practices**: https://wiki.postgresql.org/wiki/Number_Of_Database_Connections

---

## 17. Appendix

### 17.1 Sample Queries

**Query 1: Find policies by resource kind**
```sql
SELECT content
FROM policies
WHERE content->>'resourceKind' = 'document'
  AND is_deleted = FALSE
ORDER BY created_at DESC;
```

**Query 2: Find principal policies by role**
```sql
SELECT content
FROM policies
WHERE kind = 'principal'
  AND content->'principal'->'roles' ? 'admin'
  AND is_deleted = FALSE;
```

**Query 3: Audit log query (last 24 hours)**
```sql
SELECT principal_id, action, decision, COUNT(*)
FROM audit_log
WHERE timestamp >= NOW() - INTERVAL '24 hours'
GROUP BY principal_id, action, decision
ORDER BY count DESC;
```

### 17.2 Performance Benchmark Results (Target)

| Benchmark | Target | Notes |
|-----------|--------|-------|
| Policy Get (p50) | <1ms | Primary key index |
| Policy Get (p99) | <2ms | Cached queries |
| FindPolicies (p50) | <2ms | GIN index on JSONB |
| FindPolicies (p99) | <5ms | 10,000 policies |
| Agent Get (p50) | <1ms | Primary key index |
| Audit Log Insert (p99) | <5ms | Partitioned table |
| Throughput | 10,000+ TPS | PgBouncer + connection pooling |

---

**Document Status**: ✅ Ready for Review
**Next Steps**:
1. Security team review (credential hashing, RLS)
2. Backend team review (Go implementation)
3. DevOps team review (deployment strategy, backups)
4. Approval for Week 1 implementation

---

**END OF DOCUMENT**
