# Authorization Engine Database Migrations

This directory contains PostgreSQL migration files for the authorization engine schema.

## Migration Overview

### Phase 1: Core Authentication (Migrations 1-10)
- **000001**: Core authentication tables (API keys, refresh tokens, audit logs, rate limiting)
- **000002**: Indexes for performance optimization
- **000007**: Audit hash chain for immutability
- **000008**: OAuth2 client management
- **000009**: API key enhancements
- **000010**: Signing key management

### Phase 2: Derived Roles & Vector Embeddings (Migrations 11-13)
- **000011**: pgvector extension setup for semantic search
- **000012**: Derived roles with hierarchical inheritance
- **000013**: Policy embeddings for pattern optimization

## Migration Files

All migrations follow the pattern: `{version}_{description}.{up|down}.sql`

### Migration 000011: Vector Extension
**File**: `000011_create_vector_extension.up.sql`

Enables pgvector extension for vector similarity search:
- Vector data type support (1536 dimensions for OpenAI embeddings)
- Cosine similarity helper functions
- L2 distance normalization functions

### Migration 000012: Derived Roles
**File**: `000012_create_derived_roles.up.sql`

Creates hierarchical role system:
- `derived_roles` table with parent role inheritance
- GIN indexes for array-based parent role lookups
- Priority-based conflict resolution
- Conditional role assignment (JSONB conditions)
- Multi-tenancy support with RLS policies
- Materialized view for role hierarchy resolution
- Optimistic locking with version tracking

**Key Features**:
- Parent roles stored as TEXT[] array
- Priority field (0-1000) for conflict resolution
- Optional JSONB condition for dynamic assignment
- Recursive CTE materialized view for hierarchy
- Auto-refresh triggers (commented, enable if needed)

### Migration 000013: Policy Embeddings
**File**: `000013_create_policy_embeddings.up.sql`

Adds vector-based policy matching:
- `policy_embeddings` table with vector(1536) column
- HNSW indexes for fast approximate nearest neighbor search
- Cosine similarity and L2 distance search support
- Content hash for cache invalidation
- Usage statistics tracking
- Multi-tenancy isolation

**Key Features**:
- HNSW indexes (m=16, ef_construction=64) for sub-linear search
- Alternative IVFFlat index option (commented)
- Semantic similarity search function
- Batch upsert with conflict resolution
- Stale embedding identification
- Statistics view for monitoring

## Schema Design Decisions

### Multi-Tenancy
All tables include `tenant_id` column with:
- Row-Level Security (RLS) policies for isolation
- Tenant-scoped indexes for performance
- `current_setting('app.current_tenant')` for context

### Indexing Strategy

#### Derived Roles
- **GIN index** on `parent_roles` array for `ANY()` queries
- **B-tree indexes** for tenant, priority, and name lookups
- **Covered indexes** to avoid table lookups
- **Sparse indexes** for conditional roles

#### Policy Embeddings
- **HNSW indexes** for vector similarity (primary)
- **IVFFlat indexes** as alternative (faster build, slower search)
- **B-tree indexes** for policy_id, content_hash, and metadata queries
- **Composite indexes** for common query patterns

### Backward Compatibility

All Phase 2 migrations are fully backward compatible with Phase 1:
- No modifications to existing tables
- New tables are independent
- Foreign keys only reference new tables
- Can be rolled back without affecting Phase 1 functionality

## Running Migrations

### Using sqlx (Rust)
```bash
# Run all pending migrations
sqlx migrate run

# Revert last migration
sqlx migrate revert

# Check migration status
sqlx migrate info
```

### Manual Execution
```bash
# Apply migration
psql -d authz_db -f 000011_create_vector_extension.up.sql

# Rollback migration
psql -d authz_db -f 000011_create_vector_extension.down.sql
```

## Performance Considerations

### HNSW Index Build Time
- Build time scales with dataset size
- Use `ef_construction=64` for balanced build/search performance
- Consider IVFFlat for faster builds on large datasets

### Materialized View Refresh
- `derived_roles_hierarchy` can be refreshed on-demand
- Auto-refresh trigger is commented out by default
- Refresh when role hierarchy changes are infrequent

### Vector Search Performance
- HNSW provides O(log n) search complexity
- Cosine distance is optimal for normalized embeddings
- Adjust `m` and `ef_construction` based on dataset size

## Maintenance

### Regular Tasks
1. **Refresh role hierarchy**: `SELECT refresh_derived_roles_hierarchy();`
2. **Vacuum vector indexes**: `VACUUM ANALYZE policy_embeddings;`
3. **Monitor embedding stats**: `SELECT * FROM policy_embedding_stats;`
4. **Clean stale embeddings**: `SELECT * FROM identify_stale_embeddings(90);`

### Monitoring Queries
```sql
-- Check index usage
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE tablename IN ('derived_roles', 'policy_embeddings')
ORDER BY idx_scan DESC;

-- Monitor table sizes
SELECT
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE tablename IN ('derived_roles', 'policy_embeddings');

-- Check RLS policies
SELECT schemaname, tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename IN ('derived_roles', 'policy_embeddings');
```

## Testing

### Verify Extensions
```sql
SELECT * FROM pg_extension WHERE extname IN ('uuid-ossp', 'pgcrypto', 'vector');
```

### Test Vector Operations
```sql
-- Test cosine similarity
SELECT cosine_similarity('[1,0,0]'::vector, '[0.7071,0.7071,0]'::vector);

-- Test semantic search
SELECT * FROM search_similar_policies(
    '[0.1,0.2,...]'::vector(1536),
    'tenant-123',
    0.8,
    10,
    'access_policy'
);
```

### Test Role Hierarchy
```sql
-- Insert test roles
INSERT INTO derived_roles (name, parent_roles, priority, tenant_id)
VALUES
    ('admin', '{"root"}', 1000, 'test-tenant'),
    ('user', '{"member"}', 100, 'test-tenant');

-- Refresh hierarchy
SELECT refresh_derived_roles_hierarchy();

-- Query hierarchy
SELECT * FROM derived_roles_hierarchy WHERE tenant_id = 'test-tenant';
```

## Troubleshooting

### pgvector Extension Not Found
```bash
# Install pgvector
git clone https://github.com/pgvector/pgvector.git
cd pgvector
make
sudo make install
```

### HNSW Index Build Failure
- Check PostgreSQL version (requires 14+)
- Verify sufficient memory (work_mem)
- Consider using IVFFlat instead

### RLS Policy Not Working
```sql
-- Set tenant context
SET app.current_tenant = 'tenant-123';

-- Verify policy is enabled
SELECT * FROM pg_tables WHERE tablename = 'derived_roles';
```

## Migration Metadata

| Migration | Tables Created | Indexes | Functions | Views | Extensions |
|-----------|---------------|---------|-----------|-------|------------|
| 000011 | 0 | 0 | 2 | 0 | vector |
| 000012 | 1 | 8 | 2 | 1 (MV) | 0 |
| 000013 | 1 | 8 | 5 | 1 | 0 |

**Total Phase 2**: 2 tables, 16 indexes, 7 functions, 2 views, 1 extension

## Next Steps

After running these migrations:

1. Update Rust PostgreSQL store implementation
2. Implement derived role resolution logic
3. Add vector embedding generation
4. Create integration tests
5. Add monitoring and alerting
6. Document API changes
