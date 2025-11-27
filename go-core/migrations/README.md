# Database Migrations

This directory contains PostgreSQL database migrations for the authentication system.

## Overview

Migrations are managed using [golang-migrate](https://github.com/golang-migrate/migrate) and follow a numbered sequential pattern.

## Migration Files

### 000001 - Core Authentication Tables
- **Up**: Creates core tables (api_keys, refresh_tokens, auth_audit_logs, rate_limit_state)
- **Down**: Drops all authentication tables
- **Features**:
  - UUID primary keys
  - Row-Level Security (RLS) for multi-tenant isolation
  - JSONB columns for flexible metadata
  - Comprehensive constraints and validations

### 000002 - Performance Indexes
- **Up**: Creates optimized indexes for query performance
- **Down**: Drops all indexes
- **Features**:
  - B-tree indexes for lookups and sorting
  - GIN indexes for JSONB containment queries
  - Partial indexes for filtered queries (active keys, failed events)
  - Composite indexes for common query patterns

## Running Migrations

### Using Go Code

```go
import "authz-engine/internal/db"

// Create database connection
dbConn, err := sql.Open("postgres", connectionString)
if err != nil {
    log.Fatal(err)
}

// Create migration runner
runner, err := db.NewMigrationRunner(dbConn)
if err != nil {
    log.Fatal(err)
}
defer runner.Close()

// Run all pending migrations
if err := runner.Up(); err != nil {
    log.Fatal(err)
}
```

### Using golang-migrate CLI

```bash
# Install CLI
go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest

# Run migrations up
migrate -database "postgres://user:password@localhost:5432/dbname?sslmode=disable" \
        -path ./migrations up

# Rollback one migration
migrate -database "postgres://user:password@localhost:5432/dbname?sslmode=disable" \
        -path ./migrations down 1

# Check version
migrate -database "postgres://user:password@localhost:5432/dbname?sslmode=disable" \
        -path ./migrations version
```

## Schema Design

### Multi-Tenancy

All tables include a `tenant_id` column and use Row-Level Security (RLS) policies to enforce tenant isolation:

```sql
-- Set tenant context before queries
SET app.current_tenant = 'tenant-123';

-- All queries automatically filtered by tenant_id
SELECT * FROM api_keys; -- Only returns keys for tenant-123
```

### Indexing Strategy

1. **B-tree Indexes**: Primary lookups, sorting, range queries
2. **GIN Indexes**: JSONB containment queries (scopes, metadata)
3. **Partial Indexes**: Filtered queries (WHERE clauses)
4. **Composite Indexes**: Common multi-column queries

### Performance Targets

- Single-key lookups: < 5ms
- Tenant-scoped queries: < 10ms
- Audit log queries (1M+ records): < 50ms
- Index size: < 20% of table size

## Security Features

### Row-Level Security (RLS)

All tables enforce tenant isolation through RLS policies:

```sql
CREATE POLICY api_keys_tenant_isolation ON api_keys
    USING (tenant_id = current_setting('app.current_tenant', true));
```

### Data Protection

- API keys stored as SHA-256 hashes only
- Refresh tokens stored as SHA-256 hashes only
- Sensitive fields excluded from JSON serialization
- Audit logs for all authentication events

## Schema Constraints

### api_keys Table

| Constraint | Description |
|------------|-------------|
| `key_hash` UNIQUE | Prevents duplicate keys |
| `name` length 1-255 | Validates key name |
| `rate_limit_rps` 1-10000 | Validates rate limit |
| `expires_at` > `created_at` | Ensures valid expiration |

### refresh_tokens Table

| Constraint | Description |
|------------|-------------|
| `token_hash` UNIQUE | Prevents duplicate tokens |
| `expires_at` > `created_at` | Ensures valid expiration |
| `parent_token_id` FK | Links token rotation chain |

### auth_audit_logs Table

| Constraint | Description |
|------------|-------------|
| `event_type` ENUM | Validates event types |
| User/Agent required | Ensures attribution |

## Testing

Run migration tests:

```bash
cd tests/db
go test -v ./...
```

Tests cover:
- ✅ Migration up/down execution
- ✅ Index creation and properties
- ✅ RLS policy enforcement
- ✅ Tenant isolation
- ✅ Schema constraints
- ✅ Performance benchmarks

## Troubleshooting

### Dirty State

If migrations fail and leave the database in a "dirty" state:

```go
// Force to specific version (use with caution)
runner.Force(1)
```

### Reset Database

**WARNING**: Drops all tables

```go
// Development only!
runner.Drop()
```

### Check Current Version

```go
version, dirty, err := runner.Version()
if dirty {
    log.Printf("Database is dirty at version %d", version)
}
```

## Best Practices

1. **Always test rollback**: Every migration should have a working `.down.sql`
2. **Use transactions**: Migrations run in transactions for atomicity
3. **Add indexes separately**: Separate schema and index migrations
4. **Document changes**: Add comments to explain complex logic
5. **Test with data**: Verify migrations work with existing data
6. **Monitor performance**: Track query performance after index changes

## Future Migrations

When adding new migrations:

1. Increment the version number: `000003_description.up.sql`
2. Always create both `.up.sql` and `.down.sql` files
3. Test locally before deploying
4. Document in this README
5. Update schema.go with new constants/models
6. Add tests in migrations_test.go

## Schema Documentation

See `PHASE6_WEEK3-4_DATABASE_SDD.md` for complete schema specification and design decisions.
