# ADR-010: Vector Store Production Strategy

**Status**: Accepted
**Date**: 2024-11-25
**Deciders**: AuthZ Engine Team
**Technical Story**: Production-ready vector storage for pattern learning at scale
**Supersedes**: Partial implementation details in ADR-004

---

## Context

The authorization engine's ANALYST agent requires vector storage for pattern learning from authorization decisions. The current implementation in `@authz-engine/memory` package is a **prototype/MVP** that works for demos but has critical limitations that make it unsuitable for production use.

### Current Implementation Reality

**`InMemoryVectorStore` (packages/memory/src/vector-store/VectorStore.ts)**

```typescript
// CRITICAL ISSUE: O(n) linear scan for every search
async search(query: number[], k: number): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  for (const entry of this.vectors.values()) {  // ⚠️ Iterates ALL vectors
    const score = this.calculateSimilarity(query, entry.vector);
    results.push({ id: entry.id, score, vector: [...entry.vector], metadata: entry.metadata });
  }

  results.sort((a, b) => b.score - a.score);  // ⚠️ Sorts entire result set
  return results.slice(0, k);
}
```

**Identified Problems:**

| Issue | Current State | Production Requirement | Impact |
|-------|--------------|------------------------|--------|
| **Search Algorithm** | O(n) linear scan | O(log n) HNSW/IVF index | ❌ **CRITICAL** - Unusable at scale |
| **Scale Limit** | Hard limit 10,000 vectors | Millions of vectors | ❌ **CRITICAL** - Insufficient capacity |
| **Persistence** | Memory-only (Map) | PostgreSQL with replication | ❌ **CRITICAL** - Data loss on restart |
| **Indexing** | None | HNSW, IVF, or Product Quantization | ❌ **CRITICAL** - No acceleration |
| **Distribution** | Single-node only | Multi-node replication | ⚠️ **HIGH** - No HA |
| **Monitoring** | None | Index health, query latency | ⚠️ **HIGH** - No observability |
| **Batch Operations** | None | Bulk insert/update | ⚠️ **MEDIUM** - Slow ingestion |

### Performance Implications

**Authorization decisions per day** at enterprise scale:
- Small org: 1M decisions/day (11.6 req/sec)
- Medium org: 10M decisions/day (115 req/sec)
- Large org: 100M decisions/day (1,157 req/sec)
- Enterprise: 1B+ decisions/day (11,574 req/sec)

**Current implementation costs** (O(n) with 1M vectors):
- Search latency: ~50ms per query (unacceptable)
- Memory usage: ~2GB for 1M 512-dim float32 vectors
- Throughput: ~20 queries/sec (blocks on single CPU core)

**Production requirement** (O(log n) with HNSW):
- Search latency: <5ms per query (p99)
- Memory usage: ~4GB (includes index overhead)
- Throughput: 10,000+ queries/sec (parallel on GPU)

### Why Vector Search Matters for Authorization

The ANALYST agent learns patterns from historical authorization decisions:

1. **Anomaly Detection**: "This request looks 95% similar to patterns that were denied"
2. **Policy Recommendations**: "Users with these attributes typically need X permissions"
3. **Risk Assessment**: "This combination of principal + resource is unusual"
4. **Optimization**: "These 50 policies can be consolidated based on similarity"

Without production-grade vector search:
- Pattern learning is limited to 10,000 recent decisions
- Search becomes unusably slow beyond 10,000 vectors
- Cannot detect rare but important patterns in long-tail data
- No historical analysis beyond memory capacity

## Decision

We will adopt a **phased approach** to production-ready vector storage:

### Phase 1: pgvector Foundation (3-4 weeks)
**Status**: ⚠️ NOT YET IMPLEMENTED
**Target**: v1.1.0

Implement PostgreSQL with pgvector extension for persistence and basic indexing.

**Required Components:**
1. ✅ **PostgreSQL connection pool** (exists in decision-store.ts)
2. ❌ **pgvector extension setup** (`CREATE EXTENSION vector`)
3. ❌ **Vector column with HNSW index** (`CREATE INDEX ON authz_decisions USING hnsw (embedding vector_cosine_ops)`)
4. ❌ **Vector similarity queries** (`ORDER BY embedding <=> query_vector LIMIT k`)
5. ❌ **Batch insert operations** (bulk decision storage)
6. ❌ **Connection health monitoring** (dead connection detection)

**SQL Schema:**
```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add vector column to decisions table
ALTER TABLE authz_decisions
  ADD COLUMN embedding vector(1536);  -- OpenAI ada-002 dimension

-- Create HNSW index for fast similarity search
CREATE INDEX ON authz_decisions
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Vector similarity search query
SELECT id, principal_id, resource_kind, action,
       embedding <=> $1::vector AS distance
FROM authz_decisions
WHERE embedding IS NOT NULL
ORDER BY embedding <=> $1::vector
LIMIT 10;
```

**Pros:**
- Self-hosted, no external dependencies
- PostgreSQL already in use for DecisionStore
- ~100x faster than current O(n) scan (O(log n) HNSW)
- Handles millions of vectors
- ACID transactions, replication, backups

**Cons:**
- HNSW build time increases with data (minutes for 10M vectors)
- Limited to single machine CPU (no GPU acceleration)
- Requires tuning `m` and `ef_construction` parameters

**Performance Targets:**
- Search: <5ms p50, <15ms p99 (1M vectors)
- Insert: <10ms per decision with vector
- Bulk insert: 1,000 decisions/sec
- Capacity: 10M vectors (~20GB storage)

---

### Phase 2: Hybrid Architecture (2-3 months)
**Status**: ⏳ PLANNED
**Target**: v1.2.0

Add specialized vector database for hot data while keeping PostgreSQL for cold storage.

**Architecture:**
```
┌──────────────────────────────────────────────────────┐
│                  Authorization Engine                 │
├──────────────────────────────────────────────────────┤
│  ANALYST Agent Pattern Learning                      │
├──────────────────────────────────────────────────────┤
│  ┌────────────────┐          ┌──────────────────┐   │
│  │  Hot Storage   │          │   Cold Storage   │   │
│  │  (Pinecone/    │◄────────►│   (PostgreSQL    │   │
│  │   Weaviate)    │  Sync    │    + pgvector)   │   │
│  │                │          │                  │   │
│  │  - Last 30 days│          │  - Historical    │   │
│  │  - 1M vectors  │          │  - 10M+ vectors  │   │
│  │  - <5ms p99    │          │  - <50ms p99     │   │
│  │  - GPU accel   │          │  - Batch queries │   │
│  └────────────────┘          └──────────────────┘   │
└──────────────────────────────────────────────────────┘
```

**Hot Storage Options:**

| Solution | Pros | Cons | Monthly Cost |
|----------|------|------|--------------|
| **Pinecone** | Managed, GPU-accelerated, <5ms p99 | $70/mo base + usage | $200-500 |
| **Weaviate** | Self-hosted, GraphQL API, modules | DevOps overhead | $0 (self-host) |
| **Qdrant** | Rust performance, payload filtering | Newer, smaller ecosystem | $0 (self-host) |
| **Milvus** | Enterprise-grade, Zilliz cloud | Complex setup | $0-300 |

**Recommended**: Start with **Pinecone** for proof-of-concept (lowest friction), migrate to **Weaviate** self-hosted for cost optimization.

**Data Lifecycle:**
1. New decisions → Hot storage (Pinecone) with vector embedding
2. Daily batch → Archive to PostgreSQL cold storage
3. Hot storage retains last 30 days (~1M decisions)
4. Cold storage retains 12+ months (10M+ decisions)
5. Analytics queries → Cold storage (slower but comprehensive)

---

### Phase 3: Enterprise Scale (6+ months)
**Status**: 🔮 FUTURE
**Target**: v2.0.0

Multi-region, GPU-accelerated, with advanced features.

**Features:**
- Multi-region replication (US, EU, Asia)
- GPU-accelerated search (<1ms p99)
- Approximate nearest neighbor (ANN) with quantization
- Federated learning across regions
- Advanced analytics (drift detection, model monitoring)

**Architecture Considerations:**
- Kubernetes operator for auto-scaling
- Multi-tenancy with isolated vector namespaces
- Real-time indexing with streaming ingestion
- Cross-region query federation
- Cost optimization with tiered storage (hot/warm/cold)

---

## Implementation Roadmap

### Immediate (v1.1.0) - pgvector MVP

**Acceptance Criteria:**
- [ ] PostgreSQL with pgvector extension installed
- [ ] HNSW index created on `embedding` column
- [ ] Vector similarity search API implemented
- [ ] Batch insert supports embeddings
- [ ] Performance: <15ms p99 for 100K vectors
- [ ] Integration tests with real embeddings
- [ ] Documentation: setup guide, tuning parameters

**Tasks:**
1. Update `decision-store.ts` with pgvector SQL queries
2. Add migration script for vector column + HNSW index
3. Implement `searchSimilarDecisions(embedding, k)` method
4. Add embedding generation to decision storage flow
5. Create performance benchmarks (100K, 1M, 10M vectors)
6. Document index tuning (`m`, `ef_construction`, `ef_search`)

**Risk Mitigation:**
- Start with small `m=16` for faster builds
- Use async index creation to avoid blocking writes
- Monitor index size vs query performance tradeoff
- Implement graceful degradation (disable vector search if index build fails)

---

### Short-term (v1.2.0) - Hot/Cold Hybrid

**Acceptance Criteria:**
- [ ] Pinecone integration for hot storage
- [ ] Automated archival from hot → cold storage
- [ ] Query router (hot first, fallback to cold)
- [ ] Cost monitoring dashboard
- [ ] Performance: <5ms p99 for hot queries

**Tasks:**
1. Evaluate Pinecone vs Weaviate (1 week proof-of-concept)
2. Implement hot storage adapter interface
3. Build data lifecycle manager (archival scheduler)
4. Create query router with fallback logic
5. Add cost tracking and alerts
6. Performance comparison: hot vs cold vs hybrid

---

### Long-term (v2.0.0) - Enterprise Platform

**Acceptance Criteria:**
- [ ] Multi-region deployment (3+ regions)
- [ ] GPU-accelerated search (<1ms p99)
- [ ] 100M+ vector capacity
- [ ] 10,000+ queries/sec throughput
- [ ] 99.99% uptime SLA

**Tasks:**
1. Multi-region architecture design
2. Cross-region replication strategy
3. Query federation layer
4. Cost optimization with tiered storage
5. Advanced analytics (drift, explainability)
6. Kubernetes operator for auto-scaling

---

## Alternatives Considered

### Alternative 1: Pure In-Memory (Current Approach)
**Rejected** because:
- ❌ O(n) search complexity is catastrophically slow
- ❌ 10,000 vector limit is insufficient
- ❌ No persistence → data loss on restart
- ❌ Single-node → no scalability or HA
- ✅ **Only acceptable for demos/prototypes**

### Alternative 2: Elasticsearch with dense_vector
**Rejected** because:
- ❌ Elasticsearch's vector search is slower than specialized solutions
- ❌ Higher memory overhead vs pgvector or Pinecone
- ❌ Not optimized for high-dimensional embeddings (1536-dim)
- ❌ Adds operational complexity (additional service)
- ✅ Better suited for text search, not pure vector similarity

### Alternative 3: Redis with RediSearch
**Rejected** because:
- ❌ RediSearch vector support is newer, less mature than pgvector
- ❌ Memory cost for 1M+ vectors in Redis is 10x higher than PostgreSQL
- ❌ Limited to single-node scalability
- ⚠️ **Consider for caching layer only, not primary storage**

### Alternative 4: All-In on Cloud Vector DB (Pinecone/Weaviate)
**Deferred** because:
- ⚠️ Monthly costs scale linearly with usage ($500-5000/mo)
- ⚠️ Vendor lock-in risk
- ⚠️ Requires external API calls (latency, availability)
- ✅ **Use for Phase 2 hot storage only, keep PostgreSQL for cold**

---

## Migration Strategy

### For Existing Users (v1.0 → v1.1 with pgvector)

**Step 1**: Database schema migration
```bash
# Run migration script
./scripts/migrate-add-pgvector.sh

# Verify extension
psql -U authz -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
```

**Step 2**: Backfill existing decisions with embeddings
```typescript
// Batch process historical decisions
const decisions = await store.queryDecisions({ limit: 1000 });
for (const decision of decisions) {
  const embedding = await generateEmbedding(decision);
  await store.updateDecisionEmbedding(decision.id, embedding);
}
```

**Step 3**: Enable vector search in config
```typescript
const orchestratorConfig: OrchestratorConfig = {
  store: {
    type: 'postgres',
    database: { /* connection */ },
    enableVectorSearch: true,      // Enable vector search
    embeddingDimension: 1536,      // OpenAI ada-002
    retentionDays: 90,
  },
};
```

**Rollback Plan:**
- Vector search is opt-in via `enableVectorSearch` flag
- If pgvector fails, ANALYST agent falls back to non-vector pattern learning
- No breaking changes to existing decision storage
- Can drop vector column without affecting core functionality

---

## Monitoring & Observability

### Key Metrics

| Metric | Target | Alert Threshold | Action |
|--------|--------|-----------------|--------|
| Vector search p50 | <5ms | >10ms | Check index health |
| Vector search p99 | <15ms | >50ms | Rebuild index |
| Vector search errors | <0.1% | >1% | Check pgvector logs |
| Index build time | <10min | >30min | Reduce `ef_construction` |
| Storage size | <20GB/1M vectors | >50GB/1M | Check data retention |
| Query throughput | >100 qps | <50 qps | Scale read replicas |

### Dashboards

**Vector Search Performance Dashboard:**
```
┌─────────────────────────────────────────────────────┐
│  Vector Search Latency (p50, p95, p99)             │
│  [Graph showing latency over time]                  │
├─────────────────────────────────────────────────────┤
│  Index Health                                       │
│  - Index size: 2.3 GB                              │
│  - Vectors indexed: 1.2M                           │
│  - Last rebuild: 2024-11-25 03:00 UTC              │
│  - Build time: 8.4 minutes                         │
├─────────────────────────────────────────────────────┤
│  Query Distribution                                 │
│  - K=10: 45%  (fast)                               │
│  - K=100: 35% (medium)                             │
│  - K=1000: 20% (slow)                              │
└─────────────────────────────────────────────────────┘
```

---

## Success Criteria

### Phase 1 (pgvector MVP)
- ✅ 100x faster search vs current O(n) implementation
- ✅ Support 1M+ vectors (100x current limit)
- ✅ <15ms p99 latency for similarity search
- ✅ Zero downtime during index builds
- ✅ Automated backups and recovery

### Phase 2 (Hot/Cold Hybrid)
- ✅ <5ms p99 latency for hot queries (recent data)
- ✅ 50% cost reduction vs pure cloud vector DB
- ✅ 10M+ total vector capacity
- ✅ Automated archival without manual intervention

### Phase 3 (Enterprise)
- ✅ Multi-region with <1ms p99 within-region
- ✅ 100M+ vector capacity
- ✅ 99.99% uptime
- ✅ $0.001/query cost at scale

---

## Cost Analysis

### Phase 1: pgvector (Self-Hosted)
- **Storage**: $0.10/GB/month × 20GB = **$2/month**
- **Compute**: Existing PostgreSQL instance = **$0 incremental**
- **Total**: **~$2/month for 1M vectors**

### Phase 2: Hybrid (Pinecone Hot + PostgreSQL Cold)
- **Hot storage** (Pinecone s1 pod): **$70/month base**
- **Queries**: $0.10/1000 queries × 100K/day × 30 = **$300/month**
- **Cold storage**: $2/month (PostgreSQL)
- **Total**: **~$372/month for 1M hot + 10M cold**

### Phase 3: Enterprise (Multi-Region)
- **Hot storage**: $70/month × 3 regions = **$210/month**
- **Queries**: $0.05/1000 queries (volume discount) × 1M/day × 30 = **$1,500/month**
- **Cold storage**: $20/month (larger PostgreSQL)
- **GPU compute**: $500/month (optional acceleration)
- **Total**: **~$2,230/month for 3M hot + 100M cold**

**Cost per decision with vector embedding:**
- Phase 1: $0.000002 (negligible)
- Phase 2: $0.00012 (acceptable)
- Phase 3: $0.000074 (optimized at scale)

---

## Related ADRs

- **ADR-004**: Memory-first Development - Established memory mode for prototyping
- **ADR-005**: Agentic Authorization - Defined ANALYST agent requirements
- **ADR-007**: Native Agentic Framework - Overall agent architecture

---

## References

- [pgvector](https://github.com/pgvector/pgvector) - PostgreSQL vector extension
- [Pinecone](https://www.pinecone.io/) - Managed vector database
- [Weaviate](https://weaviate.io/) - Open-source vector search engine
- [HNSW Paper](https://arxiv.org/abs/1603.09320) - Hierarchical Navigable Small World graphs
- [OpenAI Embeddings](https://platform.openai.com/docs/guides/embeddings) - Text embeddings API

---

**Last Updated**: 2024-11-25
**Next Review**: After Phase 1 implementation (v1.1.0)
