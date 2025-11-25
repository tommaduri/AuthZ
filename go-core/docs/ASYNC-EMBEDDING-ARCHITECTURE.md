# Async Embedding Architecture - Phase 5 GREEN Week 2-3

**Status**: Implementation
**Date**: 2025-11-25
**Goal**: Zero-impact vector similarity with async embedding

---

## Overview

Integrate HNSW vector store with DecisionEngine for policy similarity search **without impacting authorization latency**. All embedding generation happens asynchronously in background workers.

---

## Architecture Principles

### 1. **Zero-Impact Authorization**
- Authorization path: **NO embedding generation**
- Authorization latency target: **<10µs p99** (unchanged)
- Vector search: **Optional enhancement**, never blocks auth

### 2. **Async Embedding Pipeline**
- Background workers generate embeddings for policies
- Queue-based job processing (channel-based)
- Eventual consistency (embeddings lag policy updates by ~100ms)

### 3. **Graceful Degradation**
- System works normally if embeddings aren't ready
- Vector search returns empty if no embeddings exist
- Cache hit rate improves over time as embeddings populate

---

## Component Design

### 1. DecisionEngine Integration

```go
type Engine struct {
    // Existing fields
    cel          *cel.Engine
    store        policy.Store
    cache        cache.Cache
    workerPool   *WorkerPool

    // NEW: Vector similarity (optional)
    vectorStore  vector.VectorStore // nil if not enabled
    embedWorker  *EmbeddingWorker   // nil if not enabled
}
```

**Configuration**:
```go
type Config struct {
    // Existing config...

    // NEW: Vector similarity config
    VectorSimilarityEnabled bool
    VectorStore             vector.VectorStore
    EmbeddingWorkerEnabled  bool
    EmbeddingQueueSize      int    // Default: 1000
    EmbeddingBatchSize      int    // Default: 10
}
```

### 2. EmbeddingWorker

**Purpose**: Background worker that:
1. Listens for policy change events
2. Generates text embeddings from policy definitions
3. Stores embeddings in VectorStore

**Architecture**:
```go
type EmbeddingWorker struct {
    store         policy.Store        // Policy source
    vectorStore   vector.VectorStore  // Embedding destination
    embeddingFunc EmbeddingFunction   // Generates embeddings

    jobs          chan EmbeddingJob   // Job queue (buffered channel)
    workers       []*worker           // Worker goroutines

    shutdown      chan struct{}       // Graceful shutdown
    wg            sync.WaitGroup      // Worker coordination
}

type EmbeddingJob struct {
    PolicyID   string
    PolicyText string    // Serialized policy definition
    Priority   int       // 0=low, 1=normal, 2=high
}

type EmbeddingFunction func(text string) ([]float32, error)
```

**Worker Flow**:
```
1. Policy Updated → Event
2. Event → Embedding Job (channel)
3. Worker picks up job
4. Generate embedding (CPU-intensive)
5. Store in VectorStore (async)
6. Update metadata (last embedded timestamp)
```

**Concurrency**:
- 4-8 worker goroutines (CPU-bound work)
- Buffered channel (1000 jobs)
- Batch processing (10 policies at a time for efficiency)

### 3. Policy Similarity Search

**New DecisionEngine Method**:
```go
// FindSimilarPolicies returns policies similar to a query
// Returns empty slice if vector store not enabled
func (e *Engine) FindSimilarPolicies(ctx context.Context, query string, k int) ([]*types.Policy, error) {
    if e.vectorStore == nil {
        return []*types.Policy{}, nil // Graceful degradation
    }

    // Generate query embedding (synchronous, <5ms)
    queryVec, err := e.embedWorker.Embed(query)
    if err != nil {
        return nil, err
    }

    // Vector similarity search (synchronous, <1ms)
    results, err := e.vectorStore.Search(ctx, queryVec, k)
    if err != nil {
        return nil, err
    }

    // Load full policies from store
    policies := make([]*types.Policy, 0, len(results))
    for _, res := range results {
        pol := e.store.GetPolicy(res.ID)
        if pol != nil {
            policies = append(policies, pol)
        }
    }

    return policies, nil
}
```

---

## Implementation Phases

### Phase 1: EmbeddingWorker Foundation (Current)
- [x] VectorStore interface and implementation
- [ ] EmbeddingWorker core implementation
- [ ] Job queue and worker pool
- [ ] Policy-to-text serialization

### Phase 2: DecisionEngine Integration
- [ ] Add VectorStore field to Engine
- [ ] Add EmbeddingWorker field to Engine
- [ ] Initialize workers in Engine.New()
- [ ] Policy change event hooks

### Phase 3: Similarity Search API
- [ ] FindSimilarPolicies() method
- [ ] Optional "related policies" in CheckResponse
- [ ] Admin API for embedding status/stats

### Phase 4: Production Optimization
- [ ] Embedding caching (avoid regenerating)
- [ ] Incremental embedding updates
- [ ] Embedding versioning (model changes)
- [ ] Monitoring and metrics

---

## Text Embedding Strategy

### Policy-to-Text Serialization

**What to Embed**:
```go
type PolicyText struct {
    Name        string   // "document-editor-policy"
    Description string   // Human-readable description
    Resources   []string // ["document", "folder"]
    Actions     []string // ["view", "edit", "delete"]
    Roles       []string // ["editor", "admin"]
    Conditions  []string // CEL expressions (simplified)
}

// Serialize to embedding-friendly text
func (p *PolicyText) ToEmbeddingText() string {
    return fmt.Sprintf(
        "Policy: %s. Description: %s. "+
        "Resources: %s. Actions: %s. Roles: %s. Conditions: %s",
        p.Name, p.Description,
        strings.Join(p.Resources, ", "),
        strings.Join(p.Actions, ", "),
        strings.Join(p.Roles, ", "),
        strings.Join(p.Conditions, ", "),
    )
}
```

**Embedding Model** (Phase 5):
- **Default**: Local `all-MiniLM-L6-v2` (384 dimensions, 120MB model)
- **Production**: External API (OpenAI, Cohere) or larger model
- **Dimension**: 384 (SIMD-compatible, 4x96 = 384)

**Example**:
```
Input Policy:
{
  "name": "document-editor-policy",
  "description": "Editors can view and edit documents they own",
  "resource": "document",
  "actions": ["view", "edit"],
  "roles": ["editor"],
  "condition": "resource.ownerId == principal.id"
}

Embedding Text:
"Policy: document-editor-policy. Description: Editors can view and edit documents they own. Resources: document. Actions: view, edit. Roles: editor. Conditions: resource.ownerId equals principal.id"

Embedding Vector:
[0.234, -0.112, 0.445, ..., 0.089] (384 dimensions)
```

---

## Performance Characteristics

### Authorization Path (No Change)
- **Check() latency**: <10µs p99 ✅
- **No embedding generation**: All async
- **Vector search**: Optional, not in critical path

### Embedding Generation (Background)
- **Single policy**: ~50-100ms (model-dependent)
- **Batch (10 policies)**: ~200-400ms
- **Queue throughput**: ~100-200 policies/sec
- **Latency**: Policy changes reflected in ~100-500ms

### Vector Similarity Search (Optional Enhancement)
- **Query embedding**: <5ms
- **HNSW search**: <1ms (100K policies)
- **Total overhead**: <10ms (acceptable for admin/analytics)

---

## Use Cases

### 1. Policy Discovery (Admin UI)
```go
// "Find policies related to document editing"
similarPolicies, _ := engine.FindSimilarPolicies(ctx, "document editing permissions", 10)
```

### 2. Policy Recommendation
```go
// Suggest policies when creating new resource type
existingPolicies := store.FindPolicies("folder", nil)
if len(existingPolicies) == 0 {
    // No folder policies, suggest similar resource policies
    similar, _ := engine.FindSimilarPolicies(ctx, "folder view edit delete", 5)
}
```

### 3. Policy Analysis
```go
// Find all policies that might conflict with new policy
newPolicy := "admins can delete any document"
conflicts, _ := engine.FindSimilarPolicies(ctx, newPolicy, 20)
```

---

## Testing Strategy

### Unit Tests
- [x] VectorStore operations (insert, search, delete)
- [ ] EmbeddingWorker job processing
- [ ] Policy-to-text serialization
- [ ] Graceful degradation (nil vectorStore)

### Integration Tests
- [ ] End-to-end embedding pipeline
- [ ] Policy change → Embedding update flow
- [ ] Similarity search accuracy
- [ ] Concurrent policy updates

### Performance Tests
- [ ] Authorization latency unchanged (<10µs p99)
- [ ] Embedding throughput (>100 policies/sec)
- [ ] Vector search latency (<1ms @ 100K policies)
- [ ] Memory overhead (<800MB @ 1M policies)

---

## Configuration Example

```go
// Production config with vector similarity
cfg := engine.Config{
    // Standard config
    CacheEnabled:    true,
    CacheSize:       100000,
    ParallelWorkers: 16,

    // Vector similarity (NEW)
    VectorSimilarityEnabled: true,
    VectorStore: vector.NewMemoryStore(vector.Config{
        Backend:   "memory",
        Dimension: 384,
        HNSW: vector.HNSWConfig{
            M:              16,
            EfConstruction: 200,
            EfSearch:       50,
        },
    }),
    EmbeddingWorkerEnabled: true,
    EmbeddingQueueSize:     1000,
    EmbeddingBatchSize:     10,
}

eng, err := engine.New(cfg, policyStore)
```

---

## Migration Path

### Week 2-3 (Current)
1. ✅ VectorStore implementation complete
2. Create EmbeddingWorker
3. Integrate with DecisionEngine
4. Basic similarity search

### Week 3-4 (Future)
1. External embedding API support
2. Embedding versioning/upgrades
3. Advanced similarity algorithms
4. Production monitoring

---

## Success Criteria

**Week 2-3 Goals**:
- [x] VectorStore passing all tests (100%)
- [x] Insert throughput >97K ops/sec ✅ (148K achieved)
- [ ] EmbeddingWorker processes >100 policies/sec
- [ ] Authorization latency unchanged (<10µs p99)
- [ ] Similarity search functional (<10ms)
- [ ] 24 E2E integration tests passing

**Zero-Impact Validation**:
```bash
# Before vector integration
go test -bench=BenchmarkEngine_Check ./internal/engine/
# Target: <10µs p99

# After vector integration
go test -bench=BenchmarkEngine_Check ./internal/engine/
# Target: SAME <10µs p99 (no regression)
```

---

**Next Steps**:
1. Implement EmbeddingWorker core
2. Add Engine integration
3. Create similarity search API
4. Run integration tests

