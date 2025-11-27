# Database Schema & Migrations - Quick Start Guide

## Overview

Complete PostgreSQL database schema for authentication system with:
- ✅ API key management with rate limiting
- ✅ Refresh token rotation
- ✅ Comprehensive audit logging
- ✅ Multi-tenant isolation via Row-Level Security (RLS)
- ✅ Performance-optimized indexes (B-tree, GIN, partial)
- ✅ Zero-downtime migrations

## Files Created

### Migration Files
```
/migrations/
├── 000001_create_auth_tables.up.sql    # Core table creation
├── 000001_create_auth_tables.down.sql  # Core table rollback
├── 000002_create_indexes.up.sql        # Index creation
├── 000002_create_indexes.down.sql      # Index rollback
└── README.md                            # Migration documentation
```

### Go Code
```
/internal/db/
├── schema.go      # Schema constants, models, validation
├── migrations.go  # Migration runner utilities
└── README.md      # Package documentation

/tests/db/
└── migrations_test.go  # Comprehensive migration tests

/examples/
└── migration_example.go  # Usage examples
```

### Build Files
```
/Makefile  # Database migration targets added
```

## Quick Start (3 Steps)

### 1. Start PostgreSQL (Choose One)

**Option A: Docker (Recommended)**
```bash
make docker-db-start
# Starts PostgreSQL 15 in Docker on port 5432
```

**Option B: Local PostgreSQL**
```bash
# Ensure PostgreSQL is running
psql --version  # Verify installation
```

### 2. Install Migration Tool
```bash
make migrate-install
# Installs golang-migrate CLI
```

### 3. Run Migrations
```bash
# Create database and run migrations
make db-reset

# Or step by step:
make db-create      # Create database
make migrate-up     # Run migrations
```

## Verify Installation

```bash
# Check migration version
make migrate-version
# Should show: 2

# Open database shell
make db-shell
# Then run: \dt to list tables

# Run tests
make test-db
# All tests should pass
```

## Database Schema

### Tables Created

#### 1. **api_keys** - API Key Storage
```sql
- id (UUID, PK)
- key_hash (TEXT, UNIQUE) -- SHA-256 hash only
- name (TEXT)
- agent_id (TEXT)
- scopes (JSONB) -- Permissions array
- rate_limit_rps (INTEGER) -- Requests per second
- tenant_id (TEXT) -- Multi-tenant isolation
- created_at, expires_at, last_used_at, revoked_at (TIMESTAMPS)
```

**Indexes**: key_hash (unique), agent_id, tenant_id, scopes (GIN), active keys (partial)

#### 2. **refresh_tokens** - Token Rotation
```sql
- id (UUID, PK)
- token_hash (TEXT, UNIQUE) -- SHA-256 hash only
- user_id (TEXT)
- expires_at (TIMESTAMP)
- tenant_id (TEXT)
- parent_token_id (UUID, FK) -- Token chain tracking
```

**Indexes**: token_hash (unique), user_id, tenant_id, active tokens (partial)

#### 3. **auth_audit_logs** - Event Logging
```sql
- id (UUID, PK)
- event_type (TEXT) -- api_key_created, login_success, etc.
- user_id, agent_id (TEXT)
- ip_address (INET)
- success (BOOLEAN)
- timestamp (TIMESTAMP)
- tenant_id (TEXT)
```

**Indexes**: timestamp (DESC), event_type, tenant_id, failures (partial), IP tracking

#### 4. **rate_limit_state** - Token Bucket State
```sql
- key (TEXT, PK composite)
- tokens (DECIMAL) -- Available tokens
- last_refill (TIMESTAMP)
- tenant_id (TEXT, PK composite)
```

**Indexes**: Composite primary key (key, tenant_id)

## Multi-Tenant Isolation

All tables use Row-Level Security (RLS) policies:

```go
// Set tenant context
db.SetTenant(dbConn, "tenant-123")

// All queries automatically filtered by tenant_id
rows, _ := dbConn.Query("SELECT * FROM api_keys")
// Only returns keys for tenant-123

// Reset tenant
db.ResetTenant(dbConn)
```

## Usage Examples

### Run Migrations Programmatically
```go
import "authz-engine/internal/db"

runner, _ := db.NewMigrationRunner(dbConn)
runner.Up()  // Run all pending migrations
```

### Work with API Keys
```go
apiKey := &db.APIKey{
    KeyHash:      hashKey("secret"),
    Name:         "Production Key",
    AgentID:      "agent-1",
    Scopes:       []string{"read", "write"},
    RateLimitRPS: 1000,
    TenantID:     "tenant-123",
}

// Validate before insert
db.ValidateAPIKeyName(apiKey.Name)
db.ValidateRateLimitRPS(apiKey.RateLimitRPS)

// Check if active
if apiKey.IsActive() {
    // Use the key
}
```

### Log Authentication Events
```go
auditLog := &db.AuthAuditLog{
    EventType: db.EventAPIKeyValidated,
    UserID:    &userID,
    Success:   true,
    TenantID:  "tenant-123",
}

db.IsValidEventType(auditLog.EventType)  // Validate
```

## Common Operations

### Create Database
```bash
make db-create
```

### Run Migrations
```bash
make migrate-up
```

### Rollback Last Migration
```bash
make migrate-down
```

### Reset Database (Drop + Create + Migrate)
```bash
make db-reset
```

### Open Database Shell
```bash
make db-shell
```

### Run Tests
```bash
make test-db
```

### Create New Migration
```bash
make migrate-create NAME=add_users_table
# Creates: 000003_add_users_table.up.sql
#          000003_add_users_table.down.sql
```

## Testing

### Run All Migration Tests
```bash
cd tests/db
go test -v ./...
```

### Tests Include
- ✅ Migration up/down execution
- ✅ Index creation and properties
- ✅ RLS policy enforcement
- ✅ Tenant isolation verification
- ✅ Schema constraint validation
- ✅ Performance benchmarks (< 5ms queries)

### Run Specific Tests
```bash
# Test RLS policies
go test -v -run TestMigrations_RLS

# Test schema constraints
go test -v -run TestMigrations_SchemaConstraints

# Test performance (skip in CI)
go test -v -run TestMigrations_Performance
```

## Performance

### Expected Query Times
- Single key lookup: **< 5ms**
- Tenant-scoped queries: **< 10ms**
- Audit log queries (1M+ records): **< 50ms**

### Index Strategy
- **B-tree indexes**: Primary lookups, range queries
- **GIN indexes**: JSONB containment (scopes, metadata)
- **Partial indexes**: Filtered queries (active keys, failed events)
- **Composite indexes**: Multi-column common queries

## Security Features

### Row-Level Security (RLS)
- ✅ All tables have RLS enabled
- ✅ Automatic tenant isolation
- ✅ INSERT/SELECT policies per tenant
- ✅ Admin bypass available

### Data Protection
- ✅ API keys hashed with SHA-256 (never plaintext)
- ✅ Refresh tokens hashed with SHA-256
- ✅ Sensitive fields excluded from JSON
- ✅ Comprehensive audit trail

## Troubleshooting

### Migration Fails with "Dirty State"
```bash
# Check version
make migrate-version

# Force to correct version (use with caution)
make migrate-force VERSION=1
```

### Can't Connect to Database
```bash
# Check PostgreSQL is running
docker ps | grep postgres

# Or for local install
pg_isready -h localhost -p 5432

# Restart Docker database
make docker-db-stop
make docker-db-start
```

### RLS Not Working
```go
// Ensure tenant is set before queries
err := db.SetTenant(dbConn, "tenant-123")
if err != nil {
    log.Fatal(err)
}

// Always reset after
defer db.ResetTenant(dbConn)

// Or use WithTenant helper
db.WithTenant(dbConn, "tenant-123", func(conn *sql.DB) error {
    // Queries here automatically filtered
    return nil
})
```

### Poor Query Performance
```bash
# Check indexes exist
make db-shell
\di  # List indexes

# Analyze tables for optimizer
ANALYZE api_keys;

# Check query plan
EXPLAIN ANALYZE SELECT * FROM api_keys WHERE key_hash = 'xxx';
```

## Development Workflow

### Initial Setup
```bash
# 1. Start database
make docker-db-start

# 2. Install tools
make migrate-install

# 3. Create and migrate
make db-reset
```

### Daily Development
```bash
# Run migrations on startup
make migrate-up

# Make schema changes
make migrate-create NAME=add_feature

# Edit new migration files
# vim migrations/000003_add_feature.up.sql
# vim migrations/000003_add_feature.down.sql

# Test migration
make migrate-up
make test-db
```

### CI/CD Pipeline
```bash
# In CI environment
make test-db-create    # Create fresh test DB
make test-db-migrate   # Run migrations
make test-db           # Run tests
```

## Next Steps

1. **Review Schema**: See `PHASE6_WEEK3-4_DATABASE_SDD.md` for complete specification
2. **Read Documentation**: Check `/migrations/README.md` and `/internal/db/README.md`
3. **Run Examples**: Execute `go run examples/migration_example.go`
4. **Integrate**: Import `authz-engine/internal/db` in your code
5. **Customize**: Add new migrations with `make migrate-create`

## References

- **Schema Spec**: `PHASE6_WEEK3-4_DATABASE_SDD.md`
- **Migration Docs**: `/migrations/README.md`
- **Package Docs**: `/internal/db/README.md`
- **Examples**: `/examples/migration_example.go`
- **Tests**: `/tests/db/migrations_test.go`

## Support

For issues or questions:
1. Check migration tests for examples
2. Review package documentation
3. Examine example code
4. Check Makefile for available commands

---

**Status**: ✅ P0 CRITICAL - Database schema security audit resolved

All authentication tables, indexes, and RLS policies implemented according to specification.
