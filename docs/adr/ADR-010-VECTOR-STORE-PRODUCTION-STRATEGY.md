# ADR-010: Vector Store Production Strategy

**Status**: Accepted
**Date**: 2025-11-25
**Deciders**: AuthZ Engine Team
**Technical Story**: Production-ready vector storage for pattern learning at scale
**Supersedes**: Partial implementation details in ADR-004
**Decision Made**: Option B - fogfish/hnsw with in-memory store (phased approach)

---

## Decision Rationale

After evaluating three technology approaches (see [TECHNOLOGY-DECISION-MATRIX.md](../TECHNOLOGY-DECISION-MATRIX.md)), we selected **Option B: fogfish/hnsw** for the following reasons:

1. **Go-Native Performance**: fogfish/hnsw is a pure Go implementation optimized for Go's memory model and concurrency patterns
2. **Zero External Dependencies**: No PostgreSQL or Vald cluster required initially - reduces operational complexity
3. **Faster Time to Value**: 3-6 weeks vs 8-10 weeks for custom HNSW implementation
4. **Production-Proven**: Production-tested architecture patterns, validated in real-world deployments
5. **Flexible Migration Path**: Start with in-memory, optionally add PostgreSQL persistence later (Phase 2)

**Architecture Pattern**: Using production-tested HNSW patterns for embedding generation, indexing, and query optimization.

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

We will adopt a **phased approach** to production-ready vector storage using **fogfish/hnsw**:

### Phase 1: fogfish/hnsw with In-Memory Store (3-6 weeks)
**Status**: ✅ **APPROVED - Implementation Starting**
**Target**: v1.1.0
**Technology**: fogfish/hnsw (Go-native HNSW library)
**Architecture**: Production HNSW patterns

Implement Go-native HNSW indexing with in-memory vector storage for fast pattern learning.

**Required Components:**
1. ✅ **fogfish/hnsw Go package** (github.com/fogfish/hnsw)
2. ❌ **In-memory vector store** (map-based, thread-safe)
3. ❌ **HNSW index initialization** (M=16, efConstruction=200, efSearch=50)
4. ❌ **Vector similarity search API** (cosine distance, k-NN)
5. ❌ **Async embedding generation** (OpenAI ada-002 or similar)
6. ❌ **Batch insert operations** (bulk decision vectorization)

**Go Implementation:**
```go
import (
    "github.com/fogfish/hnsw"
)

// Vector store with HNSW indexing
type VectorStore struct {
    index    *hnsw.Index
    vectors  map[string][]float32
    metadata map[string]DecisionMetadata
    mu       sync.RWMutex
}

// Initialize HNSW index
func NewVectorStore(dimension int) *VectorStore {
    return &VectorStore{
        index: hnsw.New(
            dimension,
            hnsw.WithM(16),              // Max connections per layer
            hnsw.WithEfConstruction(200), // Build-time search depth
            hnsw.WithEfSearch(50),        // Query-time search depth
        ),
        vectors:  make(map[string][]float32),
        metadata: make(map[string]DecisionMetadata),
    }
}

// Search similar decisions
func (vs *VectorStore) Search(query []float32, k int) ([]SearchResult, error) {
    results := vs.index.Search(query, k)
    // Map results to decision metadata
    return results, nil
}
```

**Pros:**
- ✅ **Zero external dependencies** - No PostgreSQL, no Vald cluster initially
- ✅ **Go-native performance** - Optimized for Go's memory model
- ✅ **Fast time to value** - 3-6 weeks vs 8-10 weeks (custom HNSW)
- ✅ **Production-proven** - Production-tested architecture patterns
- ✅ **Simple deployment** - Single binary, no database setup
- ✅ **Optional persistence** - Add PostgreSQL in Phase 2 if needed

**Cons:**
- ⚠️ **In-memory only initially** - Data lost on restart (acceptable for pattern learning)
- ⚠️ **Single-node scaling** - No distribution (Phase 2 can add PostgreSQL/Vald)
- ⚠️ **Manual tuning** - Requires optimal M, efConstruction, efSearch parameters

**Performance Targets:**
- Search: <1ms p50, <5ms p99 (1M vectors) - **5x faster than pgvector target**
- Insert: <2ms per decision with vector
- Bulk insert: 5,000 decisions/sec (memory-bound)
- Capacity: 1M vectors initially (~2GB RAM), 10M+ with optimization

---

### Phase 2: Optional PostgreSQL Persistence (2-3 months)
**Status**: ⏳ OPTIONAL (DEFERRED)
**Target**: v1.2.0
**Decision**: Only implement if in-memory limitations become critical

Add PostgreSQL persistence for vector storage if restart durability is required.

**Architecture (If Needed):**
```
┌──────────────────────────────────────────────────────┐
│                  Authorization Engine                 │
├──────────────────────────────────────────────────────┤
│  ANALYST Agent Pattern Learning                      │
├──────────────────────────────────────────────────────┤
│  ┌────────────────┐          ┌──────────────────┐   │
│  │  In-Memory     │          │   PostgreSQL     │   │
│  │  (fogfish/     │──backup─→│   (pgvector)     │   │
│  │   hnsw)        │          │   (optional)     │   │
│  │                │          │                  │   │
│  │  - Active data │          │  - Persistence   │   │
│  │  - 1M vectors  │          │  - Restart safe  │   │
│  │  - <1ms p50    │          │  - <10ms p99     │   │
│  │  - CPU-based   │          │  - Backup/restore│   │
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

### Immediate (v1.1.0) - fogfish/hnsw MVP

**Acceptance Criteria:**
- [ ] fogfish/hnsw package integrated into Go codebase
- [ ] In-memory vector store with thread-safe operations
- [ ] HNSW index initialization (M=16, efConstruction=200)
- [ ] Vector similarity search API (k-NN, cosine distance)
- [ ] Performance: <5ms p99 for 100K vectors, <1ms p50
- [ ] Integration tests with real decision embeddings
- [ ] Documentation: setup guide, tuning parameters

**Tasks:**
1. Add `github.com/fogfish/hnsw` to go-core dependencies
2. Implement `internal/vector/store.go` with fogfish/hnsw
3. Create `VectorStore` interface using production HNSW patterns
4. Implement async embedding generation (OpenAI API or local model)
5. Add `searchSimilarDecisions(embedding, k)` to ANALYST agent
6. Create performance benchmarks (100K, 1M vectors)
7. Document index tuning (M, efConstruction, efSearch parameters)

**Risk Mitigation:**
- Start with conservative parameters (M=16, efConstruction=200)
- Async embedding generation (non-blocking authorization checks)
- Graceful degradation (ANALYST works without vectors, just slower)
- Optional persistence via checkpoint serialization (future)
- Memory monitoring and capacity alerts (prevent OOM)

---

### Short-term (v1.2.0) - Optional PostgreSQL Persistence

**Acceptance Criteria (IF NEEDED):**
- [ ] PostgreSQL + pgvector integration for persistence
- [ ] Checkpoint/restore mechanism for in-memory vectors
- [ ] Graceful shutdown with vector serialization
- [ ] Startup vector loading from PostgreSQL
- [ ] Performance: <10ms p99 for persistent queries

**Tasks (DEFERRED UNLESS REQUIRED):**
1. Evaluate if restart durability is critical (decision point)
2. If yes: Implement PostgreSQL persistence layer
3. If no: Continue with in-memory only (acceptable for pattern learning)
4. Add checkpoint serialization for faster restarts
5. Document backup/restore procedures

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
│  - Last rebuild: 2025-11-25 03:00 UTC              │
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

### Phase 1 (fogfish/hnsw In-Memory)
- ✅ **100x faster search** vs current O(n) implementation (<1ms vs 50ms)
- ✅ Support **1M+ vectors** (100x current limit)
- ✅ **<5ms p99** latency for similarity search (5x better than pgvector)
- ✅ **<1ms p50** latency (10x better than target)
- ✅ **Zero external dependencies** (no PostgreSQL setup required)
- ✅ **3-6 week delivery** (50% faster than custom HNSW)

### Phase 2 (Optional PostgreSQL Persistence)
- ✅ <10ms p99 latency with persistence (if implemented)
- ✅ Checkpoint/restore in <5 seconds for 1M vectors
- ✅ Zero data loss on graceful shutdown
- ✅ 90% cost reduction vs cloud vector DB (self-hosted)

### Phase 3 (Enterprise)
- ✅ Multi-region with <1ms p99 within-region
- ✅ 100M+ vector capacity
- ✅ 99.99% uptime
- ✅ $0.001/query cost at scale

---

## Cost Analysis

### Phase 1: fogfish/hnsw (In-Memory)
- **Storage**: In-memory only = **$0/month** (part of application RAM)
- **Compute**: Existing Go service = **$0 incremental**
- **Dependencies**: Zero external services = **$0/month**
- **Total**: **~$0/month for 1M vectors** (100% cost reduction vs alternatives)

### Phase 2: Optional PostgreSQL (If Persistence Needed)
- **Storage**: $0.10/GB/month × 5GB = **$0.50/month** (serialized checkpoints)
- **Compute**: Existing PostgreSQL = **$0 incremental**
- **Total**: **~$0.50/month for 1M vectors with persistence**

### Phase 3: Enterprise (Multi-Region)
- **Hot storage**: $70/month × 3 regions = **$210/month**
- **Queries**: $0.05/1000 queries (volume discount) × 1M/day × 30 = **$1,500/month**
- **Cold storage**: $20/month (larger PostgreSQL)
- **GPU compute**: $500/month (optional acceleration)
- **Total**: **~$2,230/month for 3M hot + 100M cold**

**Cost per decision with vector embedding:**
- Phase 1: $0.000000 (zero cost - in-memory only)
- Phase 2: $0.0000005 (with optional PostgreSQL persistence)
- Phase 3: $0.00001 (if scaling to distributed Vald cluster)

---

## Related ADRs

- **ADR-004**: Memory-first Development - Established memory mode for prototyping
- **ADR-005**: Agentic Authorization - Defined ANALYST agent requirements
- **ADR-007**: Native Agentic Framework - Overall agent architecture

---

## References

- [fogfish/hnsw](https://github.com/fogfish/hnsw) - Go-native HNSW implementation
- [HNSW Paper](https://arxiv.org/abs/1603.09320) - Hierarchical Navigable Small World graphs
- [OpenAI Embeddings](https://platform.openai.com/docs/guides/embeddings) - Text embeddings API
- [TECHNOLOGY-DECISION-MATRIX.md](../TECHNOLOGY-DECISION-MATRIX.md) - Decision analysis for technology selection

---

**Last Updated**: 2025-11-25
**Decision Date**: 2025-11-25
**Next Review**: After Phase 1 implementation (v1.1.0) - ~3-6 weeks
