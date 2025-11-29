# Phase 2 Schema Design: Derived Roles & Vector Embeddings

## Overview

This document describes the PostgreSQL schema design for Phase 2 of the authorization engine, focusing on derived roles with hierarchical inheritance and vector-based policy matching.

## Architecture Decisions

### 1. Vector Extension (pgvector)

**Migration**: `000011_create_vector_extension.up.sql`

**Key Decisions**:
- Use pgvector extension for native PostgreSQL vector support
- Vector dimension: 1536 (OpenAI text-embedding-ada-002 standard)
- Include helper functions for cosine similarity and L2 distance
- Enable both distance metrics for flexibility

**Rationale**:
- Native PostgreSQL integration reduces external dependencies
- 1536 dimensions is industry standard for semantic embeddings
- Cosine similarity optimal for normalized embeddings
- L2 distance provides alternative for non-normalized vectors

### 2. Derived Roles Table

**Migration**: `000012_create_derived_roles.up.sql`

#### Schema Structure

```sql
CREATE TABLE derived_roles (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    parent_roles TEXT[] NOT NULL,  -- Array of parent role names
    condition JSONB,                -- Optional dynamic condition
    priority INTEGER,               -- Conflict resolution (0-1000)
    tenant_id TEXT NOT NULL,
    version INTEGER,                -- Optimistic locking
    enabled BOOLEAN,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
);
```

#### Index Strategy

| Index Type | Column(s) | Purpose |
|------------|-----------|---------|
| GIN | parent_roles | Fast `ANY(parent_roles)` queries |
| B-tree | (tenant_id, enabled) | Tenant-scoped active roles |
| B-tree | (tenant_id, priority DESC, name) | Priority-ordered queries |
| B-tree (covered) | (name, tenant_id) INCLUDE (...) | Avoid table lookups |
| B-tree (sparse) | tenant_id WHERE condition IS NOT NULL | Conditional roles only |

#### Key Features

**Hierarchical Inheritance**:
- Parent roles stored as TEXT[] array for efficient lookups
- GIN index enables fast `role_name = ANY(parent_roles)` queries
- Recursive CTE in materialized view for full hierarchy resolution

**Priority-Based Conflict Resolution**:
- Priority range: 0-1000 (higher = higher priority)
- Used when multiple derived roles apply
- Indexed for efficient sorting

**Conditional Assignment**:
- Optional JSONB condition field for dynamic role assignment
- Can store CEL expressions or custom evaluation logic
- Sparse index for conditional roles (WHERE condition IS NOT NULL)

**Materialized View for Hierarchy**:
```sql
CREATE MATERIALIZED VIEW derived_roles_hierarchy AS
WITH RECURSIVE role_tree AS (
    -- Recursive CTE to build role inheritance tree
    -- Max depth: 10 levels to prevent infinite loops
    -- Cycle detection: NOT name = ANY(role_path)
)
```

**Optimistic Locking**:
- Version field auto-increments on update
- Prevents concurrent modification conflicts
- Trigger-based version management

### 3. Policy Embeddings Table

**Migration**: `000013_create_policy_embeddings.up.sql`

#### Schema Structure

```sql
CREATE TABLE policy_embeddings (
    id UUID PRIMARY KEY,
    policy_id TEXT NOT NULL,
    policy_type TEXT NOT NULL,
    embedding vector(1536) NOT NULL,  -- Vector column
    model_version TEXT NOT NULL,
    content_hash TEXT NOT NULL,       -- SHA-256 for invalidation
    tenant_id TEXT NOT NULL,
    similarity_search_count INTEGER,  -- Usage tracking
    last_used_at TIMESTAMPTZ
);
```

#### Index Strategy

| Index Type | Column(s) | Purpose | Parameters |
|------------|-----------|---------|------------|
| HNSW | embedding (cosine) | Semantic similarity search | m=16, ef_construction=64 |
| HNSW | embedding (L2) | Euclidean distance search | m=16, ef_construction=64 |
| B-tree | (policy_id, tenant_id) | Policy lookups | - |
| B-tree | (content_hash, tenant_id) | Cache invalidation | - |
| B-tree | (tenant_id, last_used_at DESC) | Stale detection | - |

#### HNSW Index Configuration

**Parameters**:
- `m = 16`: Number of connections per layer (trade-off: memory vs accuracy)
- `ef_construction = 64`: Quality during index build (higher = better quality, slower build)

**Performance Characteristics**:
- Search complexity: O(log n) on average
- Build time: O(n * log n * m * ef_construction)
- Memory: ~200 bytes per vector per connection

**Alternative: IVFFlat** (commented out in migration):
- Faster build time on large datasets
- Slightly slower search performance
- Use when build time is critical

#### Vector Search Function

```sql
CREATE FUNCTION search_similar_policies(
    query_embedding vector(1536),
    query_tenant_id TEXT,
    similarity_threshold FLOAT8 DEFAULT 0.8,
    max_results INTEGER DEFAULT 10,
    policy_type_filter TEXT DEFAULT NULL
) RETURNS TABLE (...) AS $$
    -- Returns policies with cosine similarity >= threshold
    -- Ordered by similarity (descending)
    -- Limited to max_results
$$;
```

#### Content Hash for Cache Invalidation

- SHA-256 hash of policy content
- Detects when policy has changed
- Triggers re-embedding when hash mismatch
- Indexed for fast invalidation queries

#### Usage Statistics

**Tracked Metrics**:
- `similarity_search_count`: Number of times used in searches
- `last_used_at`: Last usage timestamp
- Enables stale embedding detection and cleanup

**Stale Detection Function**:
```sql
SELECT * FROM identify_stale_embeddings(90);  -- Not used in 90 days
```

## Multi-Tenancy Implementation

### Row-Level Security (RLS)

All tables include comprehensive RLS policies:

```sql
-- Tenant isolation for SELECT
CREATE POLICY {table}_tenant_isolation ON {table}
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant', true));

-- Tenant validation for INSERT
CREATE POLICY {table}_insert_policy ON {table}
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true));

-- Tenant validation for UPDATE
CREATE POLICY {table}_update_policy ON {table}
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant', true))
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true));

-- Tenant validation for DELETE
CREATE POLICY {table}_delete_policy ON {table}
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant', true));
```

### Setting Tenant Context

```sql
-- Set for current transaction
SET LOCAL app.current_tenant = 'tenant-123';

-- Set for current session
SET app.current_tenant = 'tenant-123';
```

### Tenant-Scoped Indexes

All indexes include `tenant_id` for optimal query performance:
- Reduces index scan scope
- Improves query planner statistics
- Enables index-only scans

## Backward Compatibility

### Phase 1 Compatibility Guarantee

**No Breaking Changes**:
- ✅ No modifications to existing tables
- ✅ No foreign keys referencing Phase 1 tables
- ✅ All new tables are independent
- ✅ Can be deployed without Phase 1 schema changes
- ✅ Can be rolled back without affecting Phase 1

**Migration Safety**:
- Each migration has corresponding down migration
- Down migrations tested for data preservation
- No data loss on rollback

## Performance Optimization

### Derived Roles

**Query Patterns**:
1. Find roles by parent: `GIN index on parent_roles`
2. List active roles: `B-tree on (tenant_id, enabled)`
3. Priority ordering: `B-tree on (tenant_id, priority DESC)`
4. Hierarchy resolution: `Materialized view (refresh on-demand)`

**Optimization Tips**:
- Refresh materialized view after bulk role changes
- Use covered indexes to avoid table lookups
- Enable sparse indexes for conditional roles only

### Policy Embeddings

**Search Performance**:
- HNSW index provides sub-linear search time
- Cosine similarity is faster than L2 for normalized vectors
- Adjust `ef_search` parameter for speed/accuracy trade-off

**Index Build Performance**:
- HNSW build scales with `O(n * log n * m * ef_construction)`
- For large datasets (>1M vectors), consider IVFFlat
- Build index asynchronously to avoid blocking writes

**Memory Considerations**:
- Vector storage: 1536 * 4 bytes = 6.144 KB per embedding
- HNSW overhead: ~3-4 KB per vector (with m=16)
- Total: ~10 KB per policy embedding

## Monitoring and Maintenance

### Health Checks

```sql
-- Check extension status
SELECT * FROM pg_extension WHERE extname = 'vector';

-- Monitor index usage
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE tablename IN ('derived_roles', 'policy_embeddings')
ORDER BY idx_scan DESC;

-- Check table sizes
SELECT
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))
FROM pg_tables
WHERE tablename IN ('derived_roles', 'policy_embeddings');
```

### Maintenance Tasks

**Daily**:
- Monitor embedding usage stats: `SELECT * FROM policy_embedding_stats;`
- Check for slow queries in pg_stat_statements

**Weekly**:
- Vacuum analyze policy_embeddings (if high update rate)
- Review stale embeddings: `SELECT * FROM identify_stale_embeddings(30);`

**Monthly**:
- Refresh derived_roles_hierarchy materialized view
- Archive old audit logs (if partitioned)
- Review index bloat and rebuild if necessary

## Testing Strategy

### Unit Tests

**Derived Roles**:
- Test parent role array queries with GIN index
- Verify priority-based ordering
- Test recursive hierarchy resolution (max depth 10)
- Validate cycle detection in role tree
- Test optimistic locking with concurrent updates

**Policy Embeddings**:
- Test vector similarity search accuracy
- Verify HNSW index performance on various dataset sizes
- Test content hash invalidation
- Validate usage statistics updates
- Test stale embedding detection

### Integration Tests

**Multi-Tenancy**:
- Verify RLS policies prevent cross-tenant access
- Test tenant context setting and isolation
- Validate tenant-scoped index usage

**Performance Tests**:
- Benchmark vector search on 10K, 100K, 1M embeddings
- Test role hierarchy resolution with 100+ roles
- Measure index build time for HNSW vs IVFFlat

## Migration Execution Plan

### Pre-Migration

1. **Verify PostgreSQL version**: Requires PostgreSQL 14+
2. **Install pgvector extension**: `make && make install`
3. **Backup database**: Full backup before migration
4. **Check disk space**: Estimate 10 KB per policy embedding

### Migration Order

1. **000011**: Enable vector extension (fast, no data)
2. **000012**: Create derived_roles table (fast, no data)
3. **000013**: Create policy_embeddings table (fast, no data)

### Post-Migration

1. **Verify extensions**: `SELECT * FROM pg_extension;`
2. **Test vector operations**: `SELECT cosine_similarity(...)`
3. **Create initial test data**: Insert sample roles and embeddings
4. **Refresh materialized view**: `SELECT refresh_derived_roles_hierarchy();`
5. **Monitor index build**: Watch HNSW index creation progress

## Rollback Plan

### Rollback Order (Reverse)

1. **000013**: Drop policy_embeddings table
2. **000012**: Drop derived_roles table
3. **000011**: Drop vector extension (WARNING: loses all vector data)

### Rollback Safety

- All down migrations tested
- No foreign key dependencies
- Phase 1 schema unaffected
- Application remains functional (Phase 2 features disabled)

## Next Steps

1. **Update Rust Store Implementation**:
   - Add derived role CRUD operations
   - Implement vector similarity queries
   - Add pattern matching optimization

2. **Create API Endpoints**:
   - POST /derived-roles (create role)
   - GET /derived-roles/:id/hierarchy (get hierarchy)
   - POST /policies/search-similar (semantic search)

3. **Add Monitoring**:
   - Prometheus metrics for search latency
   - Grafana dashboards for vector index health
   - Alerts for stale embeddings

4. **Documentation**:
   - API documentation for new endpoints
   - User guide for derived roles
   - Admin guide for embedding management

## References

- [pgvector Documentation](https://github.com/pgvector/pgvector)
- [HNSW Algorithm Paper](https://arxiv.org/abs/1603.09320)
- [PostgreSQL Row-Level Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)
