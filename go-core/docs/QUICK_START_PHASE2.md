# Phase 2 Quick Start Guide

## Deployment Commands

### 1. Verify Migrations
```bash
# Run verification script
./scripts/verify-migrations.sh

# Expected output: All ✓ checks pass
```

### 2. Deploy Migrations
```bash
# Using sqlx (recommended)
sqlx migrate run

# Or manually
psql -d authz_db -f migrations/000011_create_vector_extension.up.sql
psql -d authz_db -f migrations/000012_create_derived_roles.up.sql
psql -d authz_db -f migrations/000013_create_policy_embeddings.up.sql
```

### 3. Verify Deployment
```bash
# Check extensions
psql -d authz_db -c "SELECT * FROM pg_extension WHERE extname IN ('vector', 'uuid-ossp', 'pgcrypto');"

# Check tables
psql -d authz_db -c "\dt derived_roles"
psql -d authz_db -c "\dt policy_embeddings"

# Check indexes
psql -d authz_db -c "\di *parent_roles*"
psql -d authz_db -c "\di *embedding*"
```

## Test Data

### Create Test Derived Roles
```sql
-- Set tenant context
SET app.current_tenant = 'test-tenant';

-- Insert sample roles
INSERT INTO derived_roles (name, parent_roles, priority, tenant_id)
VALUES
    ('super-admin', ARRAY['admin'], 1000, 'test-tenant'),
    ('admin', ARRAY['user'], 900, 'test-tenant'),
    ('user', ARRAY['guest'], 100, 'test-tenant');

-- Refresh hierarchy
SELECT refresh_derived_roles_hierarchy();

-- Query hierarchy
SELECT * FROM derived_roles_hierarchy WHERE tenant_id = 'test-tenant';
```

### Create Test Embeddings
```sql
-- Insert sample embedding
SELECT upsert_policy_embedding(
    'policy-001',
    'access_policy',
    '[0.1,0.2,0.3,...]'::vector(1536),  -- Replace with real embedding
    'v1.0',
    'abc123...',  -- SHA-256 hash
    'test-tenant'
);

-- Search similar policies
SELECT * FROM search_similar_policies(
    '[0.1,0.2,0.3,...]'::vector(1536),
    'test-tenant',
    0.8,
    10
);
```

## Rollback (if needed)
```bash
# Rollback in REVERSE order
sqlx migrate revert  # 000013
sqlx migrate revert  # 000012
sqlx migrate revert  # 000011
```

## File Locations

- **Migrations**: `/Users/tommaduri/Documents/GitHub/authz-engine/go-core/migrations/`
- **Documentation**: `/Users/tommaduri/Documents/GitHub/authz-engine/go-core/docs/`
- **Scripts**: `/Users/tommaduri/Documents/GitHub/authz-engine/go-core/scripts/`

## Next Steps

1. ✅ Deploy migrations
2. ⏭️ Update Rust PostgreSQL store
3. ⏭️ Create API endpoints
4. ⏭️ Write integration tests
5. ⏭️ Add monitoring

## Support

- **Design Doc**: `docs/schema-design-phase2.md`
- **Full Summary**: `docs/MIGRATION_SUMMARY.md`
- **Migration Guide**: `src/authz/migrations/README.md`
