# Go Vector Store - Software Design Document

**Module**: `go-core/internal/vector`
**Version**: 1.0.0 (Phase 1)
**Status**: Implementation Planning
**Last Updated**: 2024-11-25
**Author**: AuthZ Engine Team

---

## 1. Executive Summary

### 1.1 Purpose

This document details the design and implementation of a high-performance vector database for the Go-based authorization engine. The vector store enables **anomaly detection**, **policy similarity analysis**, **risk assessment**, and **intelligent policy recommendations** through efficient nearest-neighbor search.

### 1.2 Reference Implementation

Based on [ruvector](https://github.com/ruvnet/ruvector) architecture with Go-native optimizations:
- **HNSW Indexing**: Hierarchical Navigable Small World graphs for O(log n) search
- **Performance Target**: <1ms p99 latency (inspired by ruvector's <0.5ms)
- **Memory Efficiency**: Product Quantization for 4-32x memory reduction
- **Persistence**: PostgreSQL + pgvector extension for production durability

### 1.3 Integration Context

The vector store integrates with the existing go-core authorization engine (Phase 4 complete):
- **DecisionEngine**: Hook into authorization checks for anomaly detection
- **Policy Store**: Analyze policy similarity for consolidation recommendations
- **Audit Trail**: Vector embeddings of authorization decisions for pattern analysis
- **Performance**: Maintain sub-millisecond authorization checks (<10µs existing baseline)

### 1.4 Key Design Goals

| Goal | Target | Rationale |
|------|--------|-----------|
| **Search Latency** | <1ms p99 | Maintain real-time authorization performance |
| **Throughput** | 10K+ QPS | Handle production authorization loads |
| **Memory** | <500MB per 1M vectors | Cost-effective deployment |
| **Accuracy** | 95%+ recall | Acceptable for anomaly detection use cases |
| **Integration** | Zero impact | Must not slow existing authorization checks |

---

## 2. Architecture Overview

### 2.1 Package Structure

```
go-core/
└── internal/
    └── vector/
        ├── store.go              # VectorStore interface and factory
        ├── memory_store.go       # In-memory HNSW implementation
        ├── pg_store.go           # PostgreSQL + pgvector backend
        ├── hnsw.go               # HNSW graph implementation
        ├── quantization.go       # Product Quantization for compression
        ├── embeddings.go         # Decision embedding generation
        ├── config.go             # Configuration types
        ├── metrics.go            # Prometheus metrics
        └── vector_test.go        # Comprehensive test suite
```

### 2.2 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   Authorization Engine (Existing)                │
├─────────────────────────────────────────────────────────────────┤
│  DecisionEngine → Check() → Evaluate Policies → Return Decision │
│         │                                              │         │
│         │                                              ▼         │
│         │                                    ┌─────────────────┐ │
│         │                                    │  Audit Logger   │ │
│         │                                    └────────┬────────┘ │
│         │                                             │         │
│         ▼                                             │         │
│  ┌──────────────────────────────────────────────────▼────────┐ │
│  │              Vector Store (NEW)                            │ │
│  ├────────────────────────────────────────────────────────────┤ │
│  │  Async Decision Embedding:                                 │ │
│  │  - Generate vector from (principal, resource, action)      │ │
│  │  - Store in HNSW index for future similarity search        │ │
│  │  - Background goroutine (non-blocking)                     │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Anomaly Detection Service (Background)                   │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │  - Periodic vector similarity queries                     │  │
│  │  - Detect outlier authorization patterns                  │  │
│  │  - Alert on suspicious request patterns                   │  │
│  │  - Generate policy optimization recommendations           │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘

        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│              Storage Layer (Backend)                             │
├─────────────────────────────────────────────────────────────────┤
│  Development:     In-Memory HNSW (no persistence)               │
│  Production:      PostgreSQL + pgvector extension               │
│                   - HNSW index: CREATE INDEX ... USING hnsw     │
│                   - Durable storage with ACID guarantees        │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 Integration Flow

**Authorization Check (Hot Path - NO LATENCY IMPACT)**:
```
1. User Request → DecisionEngine.Check()
2. Evaluate policies (existing <10µs performance)
3. Return authorization decision
4. ASYNC: Spawn goroutine to generate + store vector embedding
   └─→ Non-blocking, does not delay response to user
```

**Anomaly Detection (Cold Path - Background Service)**:
```
1. Periodic timer (e.g., every 5 minutes)
2. Query vector store for recent decision patterns
3. Detect anomalies using distance thresholds
4. Generate alerts/recommendations
5. Log to audit system
```

---

## 3. Component Design

### 3.1 VectorStore Interface

```go
package vector

import (
    "context"
    "time"
)

// VectorStore provides vector similarity search capabilities
type VectorStore interface {
    // Insert adds a vector with metadata
    Insert(ctx context.Context, id string, vector []float32, metadata map[string]interface{}) error

    // Search finds k nearest neighbors
    Search(ctx context.Context, query []float32, k int) ([]SearchResult, error)

    // Delete removes a vector by ID
    Delete(ctx context.Context, id string) error

    // BatchInsert adds multiple vectors efficiently
    BatchInsert(ctx context.Context, vectors []VectorEntry) error

    // Stats returns store statistics
    Stats(ctx context.Context) (*StoreStats, error)

    // Close releases resources
    Close() error
}

// SearchResult represents a nearest neighbor result
type SearchResult struct {
    ID       string                 // Vector ID
    Score    float32                // Similarity score (higher = more similar)
    Vector   []float32              // Original vector
    Metadata map[string]interface{} // Associated metadata
}

// VectorEntry represents a vector with metadata
type VectorEntry struct {
    ID       string
    Vector   []float32
    Metadata map[string]interface{}
}

// StoreStats provides store statistics
type StoreStats struct {
    TotalVectors    int64
    Dimension       int
    IndexType       string
    MemoryUsageBytes int64
    LastInsertTime  time.Time
}
```

### 3.2 Configuration

```go
package vector

import "time"

// Config configures the vector store
type Config struct {
    // Backend type: "memory" or "postgres"
    Backend string

    // Vector dimension (e.g., 384 for sentence embeddings)
    Dimension int

    // HNSW parameters
    HNSW HNSWConfig

    // PostgreSQL config (required for Backend="postgres")
    Postgres *PostgresConfig

    // Enable product quantization for memory efficiency
    EnableQuantization bool

    // Quantization bits (4, 8, 16, or 32)
    QuantizationBits int
}

// HNSWConfig configures HNSW indexing
type HNSWConfig struct {
    // M: number of bi-directional links per layer (default: 16)
    M int

    // EfConstruction: size of dynamic candidate list during construction (default: 200)
    EfConstruction int

    // EfSearch: size of dynamic candidate list during search (default: 50)
    EfSearch int

    // MaxLayers: maximum number of layers (default: auto-calculated)
    MaxLayers int
}

// PostgresConfig configures PostgreSQL backend
type PostgresConfig struct {
    Host     string
    Port     int
    Database string
    User     string
    Password string
    SSLMode  string

    // Table name for vector storage
    TableName string

    // Enable pgvector extension
    EnablePgVector bool

    // Index parameters for pgvector HNSW
    IndexM             int // HNSW M parameter
    IndexEfConstruction int // HNSW ef_construction
}

// DefaultConfig returns sensible defaults
func DefaultConfig() Config {
    return Config{
        Backend:            "memory",
        Dimension:          384, // sentence-transformers/all-MiniLM-L6-v2
        EnableQuantization: false,
        QuantizationBits:   8,
        HNSW: HNSWConfig{
            M:              16,
            EfConstruction: 200,
            EfSearch:       50,
        },
    }
}
```

### 3.3 Decision Embedding

```go
package vector

import (
    "crypto/sha256"
    "encoding/binary"
    "math"

    "github.com/authz-engine/go-core/pkg/types"
)

// DecisionEmbedding generates vector embeddings from authorization decisions
type DecisionEmbedding struct {
    dimension int
}

// NewDecisionEmbedding creates a new embedding generator
func NewDecisionEmbedding(dimension int) *DecisionEmbedding {
    return &DecisionEmbedding{dimension: dimension}
}

// Generate creates a vector embedding from a decision
// Uses feature hashing for efficient, deterministic embedding generation
func (e *DecisionEmbedding) Generate(req *types.CheckRequest, resp *types.CheckResponse) []float32 {
    features := make([]float32, e.dimension)

    // Feature 1-10: Principal ID hash
    principalHash := hashString(req.Principal.ID)
    for i := 0; i < 10; i++ {
        features[i] = float32(principalHash>>(i*6)&0x3F) / 64.0
    }

    // Feature 11-20: Principal roles hash
    rolesHash := hashStrings(req.Principal.Roles)
    for i := 0; i < 10; i++ {
        features[10+i] = float32(rolesHash>>(i*6)&0x3F) / 64.0
    }

    // Feature 21-30: Resource kind + ID hash
    resourceHash := hashString(req.Resource.Kind + ":" + req.Resource.ID)
    for i := 0; i < 10; i++ {
        features[20+i] = float32(resourceHash>>(i*6)&0x3F) / 64.0
    }

    // Feature 31-40: Actions hash
    actionsHash := hashStrings(req.Actions)
    for i := 0; i < 10; i++ {
        features[30+i] = float32(actionsHash>>(i*6)&0x3F) / 64.0
    }

    // Feature 41-50: Scope hash
    scopeHash := hashString(req.Principal.Scope + ":" + req.Resource.Scope)
    for i := 0; i < 10; i++ {
        features[40+i] = float32(scopeHash>>(i*6)&0x3F) / 64.0
    }

    // Feature 51: Decision (0.0 = deny, 1.0 = allow)
    allowCount := 0
    for _, result := range resp.Results {
        if result.Effect == types.EffectAllow {
            allowCount++
        }
    }
    features[50] = float32(allowCount) / float32(len(resp.Results))

    // Feature 52: Evaluation duration (normalized)
    features[51] = float32(math.Min(resp.Metadata.EvaluationDurationUs/1000.0, 1.0))

    // Feature 53: Policies evaluated (normalized)
    features[52] = float32(math.Min(float64(resp.Metadata.PoliciesEvaluated)/100.0, 1.0))

    // Feature 54: Cache hit (0.0 or 1.0)
    if resp.Metadata.CacheHit {
        features[53] = 1.0
    }

    // Remaining features: Zero-pad or additional context
    // ... (expand to full dimension)

    // Normalize to unit vector (cosine similarity compatible)
    return normalize(features)
}

// Helper: Hash string to uint64
func hashString(s string) uint64 {
    h := sha256.Sum256([]byte(s))
    return binary.BigEndian.Uint64(h[:8])
}

// Helper: Hash string slice to uint64
func hashStrings(ss []string) uint64 {
    combined := ""
    for _, s := range ss {
        combined += s + "|"
    }
    return hashString(combined)
}

// Helper: Normalize vector to unit length
func normalize(v []float32) []float32 {
    var norm float32
    for _, x := range v {
        norm += x * x
    }
    norm = float32(math.Sqrt(float64(norm)))

    if norm == 0 {
        return v
    }

    result := make([]float32, len(v))
    for i, x := range v {
        result[i] = x / norm
    }
    return result
}
```

### 3.4 HNSW Implementation

```go
package vector

import (
    "container/heap"
    "math"
    "math/rand"
    "sync"
)

// HNSWGraph implements Hierarchical Navigable Small World graph
type HNSWGraph struct {
    dimension int
    m         int // Number of connections per layer
    efConst   int // Size of dynamic candidate list (construction)
    efSearch  int // Size of dynamic candidate list (search)
    ml        float64 // Normalization factor for level generation

    nodes      map[string]*HNSWNode
    entryPoint string
    maxLayer   int

    mu sync.RWMutex
}

// HNSWNode represents a node in the HNSW graph
type HNSWNode struct {
    id       string
    vector   []float32
    metadata map[string]interface{}
    layer    int

    // Connections at each layer (layer -> neighbor IDs)
    connections map[int][]string

    mu sync.RWMutex
}

// NewHNSWGraph creates a new HNSW graph
func NewHNSWGraph(dimension, m, efConst, efSearch int) *HNSWGraph {
    return &HNSWGraph{
        dimension: dimension,
        m:         m,
        efConst:   efConst,
        efSearch:  efSearch,
        ml:        1.0 / math.Log(float64(m)),
        nodes:     make(map[string]*HNSWNode),
        maxLayer:  0,
    }
}

// Insert adds a node to the HNSW graph
func (g *HNSWGraph) Insert(id string, vector []float32, metadata map[string]interface{}) error {
    g.mu.Lock()
    defer g.mu.Unlock()

    // Generate random layer for new node
    layer := g.randomLevel()

    node := &HNSWNode{
        id:          id,
        vector:      vector,
        metadata:    metadata,
        layer:       layer,
        connections: make(map[int][]string),
    }

    // First node becomes entry point
    if len(g.nodes) == 0 {
        g.nodes[id] = node
        g.entryPoint = id
        g.maxLayer = layer
        return nil
    }

    // Find nearest neighbors and insert
    g.nodes[id] = node

    // Phase 1: Find entry point at top layer
    ep := g.entryPoint
    for lc := g.maxLayer; lc > layer; lc-- {
        ep = g.searchLayerNearest(vector, ep, 1, lc)[0]
    }

    // Phase 2: Insert at each layer from top to bottom
    for lc := layer; lc >= 0; lc-- {
        candidates := g.searchLayerNearest(vector, ep, g.efConst, lc)

        // Select M nearest from candidates
        m := g.m
        if lc == 0 {
            m = g.m * 2 // More connections at layer 0
        }

        neighbors := selectNeighbors(candidates, m, g.nodes, vector)

        // Add bidirectional links
        for _, neighborID := range neighbors {
            g.connect(id, neighborID, lc)
        }

        // Update entry point for next layer
        if len(candidates) > 0 {
            ep = candidates[0]
        }
    }

    // Update max layer if needed
    if layer > g.maxLayer {
        g.maxLayer = layer
        g.entryPoint = id
    }

    return nil
}

// Search finds k nearest neighbors
func (g *HNSWGraph) Search(query []float32, k int) []SearchResult {
    g.mu.RLock()
    defer g.mu.RUnlock()

    if len(g.nodes) == 0 {
        return []SearchResult{}
    }

    // Phase 1: Find entry point by traversing top layers
    ep := g.entryPoint
    for lc := g.maxLayer; lc > 0; lc-- {
        ep = g.searchLayerNearest(query, ep, 1, lc)[0]
    }

    // Phase 2: Search layer 0 for k nearest neighbors
    candidates := g.searchLayerNearest(query, ep, max(g.efSearch, k), 0)

    // Convert to results
    results := make([]SearchResult, 0, k)
    for i := 0; i < min(k, len(candidates)); i++ {
        node := g.nodes[candidates[i]]
        if node == nil {
            continue
        }

        score := cosineSimilarity(query, node.vector)
        results = append(results, SearchResult{
            ID:       node.id,
            Score:    score,
            Vector:   node.vector,
            Metadata: node.metadata,
        })
    }

    return results
}

// searchLayerNearest finds nearest neighbors at a specific layer
func (g *HNSWGraph) searchLayerNearest(query []float32, entryPoint string, ef int, layer int) []string {
    visited := make(map[string]bool)
    candidates := &maxHeap{} // Max-heap of worst candidates
    heap.Init(candidates)

    w := &minHeap{} // Min-heap of best results
    heap.Init(w)

    // Start with entry point
    dist := euclideanDistance(query, g.nodes[entryPoint].vector)
    heap.Push(candidates, &heapItem{id: entryPoint, dist: dist})
    heap.Push(w, &heapItem{id: entryPoint, dist: dist})
    visited[entryPoint] = true

    // Greedy search
    for candidates.Len() > 0 {
        c := heap.Pop(candidates).(*heapItem)

        if c.dist > w.Peek().dist {
            break // All remaining candidates are farther than worst result
        }

        // Check neighbors at this layer
        node := g.nodes[c.id]
        if node == nil {
            continue
        }

        node.mu.RLock()
        neighbors := node.connections[layer]
        node.mu.RUnlock()

        for _, neighborID := range neighbors {
            if visited[neighborID] {
                continue
            }
            visited[neighborID] = true

            neighbor := g.nodes[neighborID]
            if neighbor == nil {
                continue
            }

            d := euclideanDistance(query, neighbor.vector)

            if d < w.Peek().dist || w.Len() < ef {
                heap.Push(candidates, &heapItem{id: neighborID, dist: d})
                heap.Push(w, &heapItem{id: neighborID, dist: d})

                // Trim to ef
                if w.Len() > ef {
                    heap.Pop(w)
                }
            }
        }
    }

    // Extract results
    result := make([]string, w.Len())
    for i := len(result) - 1; i >= 0; i-- {
        result[i] = heap.Pop(w).(*heapItem).id
    }

    return result
}

// Helper: Generate random layer with exponential distribution
func (g *HNSWGraph) randomLevel() int {
    layer := 0
    for rand.Float64() < g.ml && layer < 16 {
        layer++
    }
    return layer
}

// Helper: Connect two nodes at a layer (bidirectional)
func (g *HNSWGraph) connect(id1, id2 string, layer int) {
    node1 := g.nodes[id1]
    node2 := g.nodes[id2]

    if node1 == nil || node2 == nil {
        return
    }

    node1.mu.Lock()
    if node1.connections[layer] == nil {
        node1.connections[layer] = []string{}
    }
    node1.connections[layer] = append(node1.connections[layer], id2)
    node1.mu.Unlock()

    node2.mu.Lock()
    if node2.connections[layer] == nil {
        node2.connections[layer] = []string{}
    }
    node2.connections[layer] = append(node2.connections[layer], id1)
    node2.mu.Unlock()
}

// Helper: Select M nearest neighbors using heuristic
func selectNeighbors(candidates []string, m int, nodes map[string]*HNSWNode, query []float32) []string {
    if len(candidates) <= m {
        return candidates
    }

    // Simple heuristic: select M nearest by distance
    type candidate struct {
        id   string
        dist float32
    }

    scored := make([]candidate, len(candidates))
    for i, id := range candidates {
        node := nodes[id]
        if node == nil {
            continue
        }
        scored[i] = candidate{
            id:   id,
            dist: euclideanDistance(query, node.vector),
        }
    }

    // Sort by distance
    // (In production, use a more sophisticated heuristic to maintain diversity)
    for i := 0; i < len(scored)-1; i++ {
        for j := i + 1; j < len(scored); j++ {
            if scored[j].dist < scored[i].dist {
                scored[i], scored[j] = scored[j], scored[i]
            }
        }
    }

    result := make([]string, m)
    for i := 0; i < m; i++ {
        result[i] = scored[i].id
    }

    return result
}

// Distance metrics
func euclideanDistance(a, b []float32) float32 {
    var sum float32
    for i := range a {
        d := a[i] - b[i]
        sum += d * d
    }
    return float32(math.Sqrt(float64(sum)))
}

func cosineSimilarity(a, b []float32) float32 {
    var dot, normA, normB float32
    for i := range a {
        dot += a[i] * b[i]
        normA += a[i] * a[i]
        normB += b[i] * b[i]
    }
    return dot / (float32(math.Sqrt(float64(normA))) * float32(math.Sqrt(float64(normB))))
}

// Heap implementations for nearest neighbor search
type heapItem struct {
    id   string
    dist float32
}

type minHeap []*heapItem

func (h minHeap) Len() int            { return len(h) }
func (h minHeap) Less(i, j int) bool  { return h[i].dist < h[j].dist }
func (h minHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *minHeap) Push(x interface{}) { *h = append(*h, x.(*heapItem)) }
func (h *minHeap) Pop() interface{} {
    old := *h
    n := len(old)
    x := old[n-1]
    *h = old[0 : n-1]
    return x
}
func (h minHeap) Peek() *heapItem { return h[0] }

type maxHeap []*heapItem

func (h maxHeap) Len() int            { return len(h) }
func (h maxHeap) Less(i, j int) bool  { return h[i].dist > h[j].dist }
func (h maxHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *maxHeap) Push(x interface{}) { *h = append(*h, x.(*heapItem)) }
func (h *maxHeap) Pop() interface{} {
    old := *h
    n := len(old)
    x := old[n-1]
    *h = old[0 : n-1]
    return x
}
func (h maxHeap) Peek() *heapItem { return h[0] }

// Utility functions
func min(a, b int) int {
    if a < b {
        return a
    }
    return b
}

func max(a, b int) int {
    if a > b {
        return a
    }
    return b
}
```

---

## 4. Use Cases & Integration

### 4.1 Anomaly Detection

**Use Case**: Detect unusual authorization patterns that may indicate security threats.

**Implementation**:
```go
// AnomalyDetector monitors authorization patterns
type AnomalyDetector struct {
    vectorStore VectorStore
    threshold   float32 // Similarity threshold (e.g., 0.7)
}

// DetectAnomaly checks if a decision is anomalous
func (d *AnomalyDetector) DetectAnomaly(req *types.CheckRequest, resp *types.CheckResponse) (bool, float32, error) {
    // Generate embedding for current decision
    embedding := NewDecisionEmbedding(384).Generate(req, resp)

    // Find similar historical decisions
    results, err := d.vectorStore.Search(context.Background(), embedding, 10)
    if err != nil {
        return false, 0, err
    }

    if len(results) == 0 {
        // No historical data, consider normal
        return false, 0, nil
    }

    // Check if nearest neighbor is below similarity threshold
    maxSimilarity := results[0].Score

    if maxSimilarity < d.threshold {
        // Decision is anomalous (no similar historical patterns)
        return true, maxSimilarity, nil
    }

    return false, maxSimilarity, nil
}
```

**Integration with DecisionEngine**:
```go
// In engine.go Check() method, add after line 156:

// Async anomaly detection (non-blocking)
go func() {
    detector := NewAnomalyDetector(e.vectorStore, 0.7)
    isAnomaly, score, err := detector.DetectAnomaly(req, response)
    if err != nil {
        // Log error
        return
    }

    if isAnomaly {
        // Alert: Unusual authorization pattern detected
        e.auditLogger.LogAnomaly(req, response, score)
    }
}()
```

### 4.2 Policy Similarity Analysis

**Use Case**: Find similar policies for consolidation and optimization.

**Implementation**:
```go
// PolicySimilarityAnalyzer finds similar policies
type PolicySimilarityAnalyzer struct {
    vectorStore VectorStore
}

// FindSimilarPolicies finds policies with similar authorization patterns
func (a *PolicySimilarityAnalyzer) FindSimilarPolicies(policyID string, k int) ([]*Policy, error) {
    // Retrieve policy embedding from metadata
    results, err := a.vectorStore.Search(context.Background(), policyVector, k)
    if err != nil {
        return nil, err
    }

    // Convert results to policies
    policies := make([]*Policy, 0, len(results))
    for _, r := range results {
        if policyID, ok := r.Metadata["policyID"].(string); ok {
            // Fetch policy from store
            policy := store.GetPolicy(policyID)
            policies = append(policies, policy)
        }
    }

    return policies, nil
}
```

### 4.3 Risk Scoring

**Use Case**: Calculate risk score for authorization requests based on historical patterns.

**Implementation**:
```go
// RiskScorer calculates risk scores
type RiskScorer struct {
    vectorStore VectorStore
    weights     map[string]float32
}

// CalculateRisk computes risk score (0.0 = low, 1.0 = high)
func (s *RiskScorer) CalculateRisk(req *types.CheckRequest) (float32, error) {
    // Generate embedding (without decision, since it hasn't happened yet)
    embedding := generateRequestEmbedding(req)

    // Find similar historical requests
    results, err := s.vectorStore.Search(context.Background(), embedding, 50)
    if err != nil {
        return 0, err
    }

    // Analyze denial rate in similar requests
    denials := 0
    for _, r := range results {
        if effect, ok := r.Metadata["effect"].(string); ok && effect == "deny" {
            denials++
        }
    }

    denialRate := float32(denials) / float32(len(results))

    // Risk factors:
    // - High denial rate in similar requests
    // - Low similarity to any historical pattern (novelty)
    // - Privileged actions (from metadata)

    riskScore := denialRate * 0.5 // 50% weight on denial rate

    if len(results) > 0 && results[0].Score < 0.6 {
        riskScore += 0.3 // 30% weight on novelty
    }

    return riskScore, nil
}
```

---

## 5. Performance Analysis

### 5.1 Performance Targets (Inspired by ruvector)

| Metric | Development (Memory) | Production (pgvector) |
|--------|---------------------|----------------------|
| Search Latency (p50) | <0.5ms | <1ms |
| Search Latency (p99) | <2ms | <5ms |
| Insert Latency | <0.1ms | <10ms (batched) |
| Throughput | 50K+ QPS | 10K+ QPS |
| Memory (1M vectors) | ~800MB | ~200MB (quantized) |
| Accuracy (Recall@10) | 95%+ | 95%+ |

### 5.2 Impact on Authorization Performance

**Critical Requirement**: Vector store must NOT impact existing authorization performance (<10µs).

**Solution**: Asynchronous embedding generation and insertion.

```go
// In DecisionEngine.Check(), after line 156:

// Cache result (existing)
if e.cache != nil {
    e.cache.Set(req.CacheKey(), response)
}

// NEW: Async vector embedding (non-blocking)
if e.vectorStore != nil {
    go e.storeDecisionEmbedding(req, response)
}

return response, nil // Return immediately, embedding happens in background
```

**Performance Breakdown**:
- Authorization check: <10µs (existing, unchanged)
- Vector embedding generation: ~50µs (async, non-blocking)
- Vector insertion (memory): ~100µs (async, non-blocking)
- Vector insertion (pgvector): ~5ms (async, batched)

**Result**: Zero impact on authorization latency. Background embedding completes in <10ms.

### 5.3 Memory Footprint

**Uncompressed** (float32):
- 1M vectors × 384 dimensions × 4 bytes = ~1.5GB
- HNSW graph overhead: ~50MB
- **Total**: ~1.6GB

**Compressed** (8-bit quantization):
- 1M vectors × 384 dimensions × 1 byte = ~384MB
- Codebook: ~10MB
- **Total**: ~400MB (75% reduction)

**Recommendation**: Enable quantization for production deployments >100K vectors.

---

## 6. Development Phases

### 6.1 Phase 1: In-Memory HNSW (2-3 weeks)

**Goal**: Production-ready in-memory vector store for development and small deployments.

**Deliverables**:
1. ✅ HNSW graph implementation (hnsw.go)
2. ✅ VectorStore interface (store.go)
3. ✅ In-memory backend (memory_store.go)
4. ✅ Decision embedding generation (embeddings.go)
5. ✅ Comprehensive unit tests (>90% coverage)
6. ✅ Benchmarks (latency, throughput, memory)
7. ✅ Integration with DecisionEngine
8. ✅ Anomaly detection example

**Success Criteria**:
- Search latency <0.5ms p50, <2ms p99
- Throughput >50K QPS
- Memory <800MB per 1M vectors
- Test coverage >90%
- Zero impact on authorization performance

### 6.2 Phase 2: PostgreSQL + pgvector (2-3 weeks)

**Goal**: Durable vector storage with persistence and scalability.

**Deliverables**:
1. ✅ PostgreSQL backend (pg_store.go)
2. ✅ pgvector extension integration
3. ✅ Migration tools (schema, indexing)
4. ✅ Batch insert optimization
5. ✅ Connection pooling
6. ✅ Integration tests with real PostgreSQL
7. ✅ Performance benchmarks vs. memory backend
8. ✅ Documentation

**Success Criteria**:
- Search latency <1ms p50, <5ms p99 (1M vectors)
- Batch insert latency <50ms for 1000 vectors
- ACID guarantees for durability
- Horizontal scalability (read replicas)
- Zero downtime deployment

### 6.3 Phase 3: Product Quantization (1-2 weeks)

**Goal**: Memory efficiency for large-scale deployments.

**Deliverables**:
1. ✅ Product quantization implementation (quantization.go)
2. ✅ 4-bit, 8-bit, 16-bit codebook generation
3. ✅ Quantized search with accuracy benchmarks
4. ✅ Memory footprint comparison
5. ✅ Configuration options

**Success Criteria**:
- 4-32x memory reduction
- <5% accuracy degradation (recall@10)
- Configurable quantization bits
- Transparent to VectorStore interface

### 6.4 Phase 4: Advanced Features (2-3 weeks)

**Goal**: Production hardening and advanced capabilities.

**Deliverables**:
1. ✅ Filtered search (metadata filtering)
2. ✅ Bulk operations (import/export)
3. ✅ Index optimization (rebalancing)
4. ✅ Monitoring and metrics (Prometheus)
5. ✅ Hot-reload configuration
6. ✅ Multi-tenancy support
7. ✅ Backup and restore
8. ✅ Performance tuning guide

**Success Criteria**:
- Production-ready observability
- Operational runbooks
- Performance tuning documentation
- Multi-tenant isolation
- Disaster recovery plan

---

## 7. Testing Strategy

### 7.1 Unit Tests

**Coverage Target**: >90%

**Test Categories**:
1. **HNSW Graph Operations**:
   - Insert single node
   - Insert 1000 nodes
   - Search accuracy (recall@10 vs brute force)
   - Layer generation distribution
   - Connection pruning

2. **Distance Metrics**:
   - Euclidean distance correctness
   - Cosine similarity correctness
   - Edge cases (zero vectors, normalized vectors)

3. **Decision Embedding**:
   - Deterministic generation (same input → same embedding)
   - Dimension correctness
   - Normalization (unit vectors)
   - Feature hashing collision rate

4. **Store Operations**:
   - Insert, search, delete
   - Batch operations
   - Concurrent access (race detection)
   - Error handling

### 7.2 Integration Tests

**Test Scenarios**:
1. **DecisionEngine Integration**:
   - Enable vector store in engine
   - Verify async embedding generation
   - Check no performance impact (<10µs authorization)

2. **PostgreSQL Backend**:
   - Insert 10K vectors
   - Search with pgvector HNSW index
   - Concurrent writes from multiple goroutines
   - Connection failure recovery

3. **Anomaly Detection**:
   - Inject anomalous authorization request
   - Verify detection and alerting
   - False positive rate

### 7.3 Performance Benchmarks

**Benchmark Suite**:
```go
func BenchmarkHNSWInsert(b *testing.B) {
    // Measure insert latency (10K, 100K, 1M vectors)
}

func BenchmarkHNSWSearch(b *testing.B) {
    // Measure search latency at different scales
}

func BenchmarkMemoryFootprint(b *testing.B) {
    // Measure memory usage per vector
}

func BenchmarkConcurrentSearch(b *testing.B) {
    // Measure throughput (QPS) with parallel searches
}

func BenchmarkQuantizedSearch(b *testing.B) {
    // Measure accuracy vs. latency tradeoff
}
```

---

## 8. Dependencies

### 8.1 Go Libraries

| Library | Purpose | License |
|---------|---------|---------|
| `github.com/lib/pq` | PostgreSQL driver | MIT |
| `github.com/pgvector/pgvector-go` | pgvector extension | MIT |
| `github.com/prometheus/client_golang` | Metrics | Apache 2.0 |
| `github.com/stretchr/testify` | Testing assertions | MIT |

### 8.2 PostgreSQL Extensions

| Extension | Purpose | Version |
|-----------|---------|---------|
| `pgvector` | Vector similarity search | 0.5.0+ |

**Installation**:
```sql
CREATE EXTENSION vector;
```

### 8.3 System Requirements

**Development**:
- Go 1.21+
- PostgreSQL 14+ (optional)
- 2GB RAM

**Production**:
- Go 1.21+
- PostgreSQL 14+ with pgvector 0.5.0+
- 8GB+ RAM (for 1M+ vectors)
- SSD storage (recommended)

---

## 9. Deployment

### 9.1 Configuration Example

**Development** (in-memory):
```go
config := vector.Config{
    Backend:   "memory",
    Dimension: 384,
    HNSW: vector.HNSWConfig{
        M:              16,
        EfConstruction: 200,
        EfSearch:       50,
    },
}

store, err := vector.NewVectorStore(config)
```

**Production** (pgvector):
```go
config := vector.Config{
    Backend:   "postgres",
    Dimension: 384,
    HNSW: vector.HNSWConfig{
        M:              16,
        EfConstruction: 200,
        EfSearch:       50,
    },
    Postgres: &vector.PostgresConfig{
        Host:                "postgres.example.com",
        Port:                5432,
        Database:            "authz",
        User:                "authz_user",
        Password:            os.Getenv("PG_PASSWORD"),
        SSLMode:             "require",
        TableName:           "decision_vectors",
        EnablePgVector:      true,
        IndexM:              16,
        IndexEfConstruction: 64,
    },
    EnableQuantization: true,
    QuantizationBits:   8,
}

store, err := vector.NewVectorStore(config)
```

### 9.2 Database Schema (PostgreSQL)

```sql
-- Create pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Decision vectors table
CREATE TABLE decision_vectors (
    id TEXT PRIMARY KEY,
    embedding vector(384) NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- HNSW index for fast similarity search
CREATE INDEX decision_vectors_embedding_idx
ON decision_vectors
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Metadata index for filtering
CREATE INDEX decision_vectors_metadata_idx
ON decision_vectors
USING GIN (metadata);
```

---

## 10. Monitoring & Observability

### 10.1 Prometheus Metrics

```go
var (
    vectorInsertDuration = prometheus.NewHistogram(prometheus.HistogramOpts{
        Name:    "authz_vector_insert_duration_seconds",
        Help:    "Duration of vector insert operations",
        Buckets: prometheus.ExponentialBuckets(0.0001, 2, 15),
    })

    vectorSearchDuration = prometheus.NewHistogram(prometheus.HistogramOpts{
        Name:    "authz_vector_search_duration_seconds",
        Help:    "Duration of vector search operations",
        Buckets: prometheus.ExponentialBuckets(0.0001, 2, 15),
    })

    vectorStoreSize = prometheus.NewGauge(prometheus.GaugeOpts{
        Name: "authz_vector_store_size_total",
        Help: "Total number of vectors in store",
    })

    vectorMemoryUsage = prometheus.NewGauge(prometheus.GaugeOpts{
        Name: "authz_vector_memory_bytes",
        Help: "Memory usage of vector store in bytes",
    })

    anomalyDetectionTotal = prometheus.NewCounter(prometheus.CounterOpts{
        Name: "authz_anomaly_detection_total",
        Help: "Total number of anomalies detected",
    })
)
```

### 10.2 Logging

```go
// Structured logging with context
log.WithFields(log.Fields{
    "store_type":   "postgres",
    "vector_count": stats.TotalVectors,
    "memory_mb":    stats.MemoryUsageBytes / (1024 * 1024),
    "search_p50":   metrics.SearchP50.Seconds() * 1000, // ms
    "search_p99":   metrics.SearchP99.Seconds() * 1000, // ms
}).Info("Vector store statistics")
```

---

## 11. Security Considerations

### 11.1 Data Protection

1. **Vector Embeddings**: May contain sensitive information from authorization decisions
   - **Mitigation**: Encrypt at rest (PostgreSQL TLS, disk encryption)
   - **Mitigation**: Feature hashing prevents direct PII storage

2. **Metadata Leakage**: Metadata fields may contain sensitive attributes
   - **Mitigation**: Minimal metadata (only IDs and timestamps)
   - **Mitigation**: RBAC for vector store access

3. **SQL Injection** (PostgreSQL backend):
   - **Mitigation**: Parameterized queries only
   - **Mitigation**: Input validation on IDs and metadata

### 11.2 Access Control

1. **Vector Store Access**: Restrict to authorized services only
   - **Mitigation**: Separate database user with limited privileges
   - **Mitigation**: Network isolation (VPC, firewall rules)

2. **Anomaly Detection**: Alert on unauthorized access attempts
   - **Mitigation**: Audit log all anomaly detections
   - **Mitigation**: Rate limiting on anomaly API endpoints

---

## 12. References

### 12.1 Papers

1. **HNSW Algorithm**: "Efficient and robust approximate nearest neighbor search using Hierarchical Navigable Small World graphs" (Malkov & Yashunin, 2016)
2. **Product Quantization**: "Product quantization for nearest neighbor search" (Jegou et al., 2011)

### 12.2 Projects

1. **ruvector**: https://github.com/ruvnet/ruvector
2. **pgvector**: https://github.com/pgvector/pgvector
3. **hnswlib**: https://github.com/nmslib/hnswlib

### 12.3 Related ADRs

- **ADR-010**: Vector Store Production Strategy (TypeScript implementation gaps)
- **ADR-004**: Memory-First Development (development mode philosophy)
- **ADR-008**: Hybrid Go/TypeScript Architecture (why Go for vector store)

---

## 13. Appendix

### 13.1 API Examples

**Example 1: Insert Decision Embedding**
```go
// Generate embedding from authorization decision
embedding := vector.NewDecisionEmbedding(384).Generate(checkRequest, checkResponse)

// Insert into store
err := store.Insert(context.Background(),
    checkResponse.RequestID,
    embedding,
    map[string]interface{}{
        "principalID": checkRequest.Principal.ID,
        "resourceKind": checkRequest.Resource.Kind,
        "effect": checkResponse.Results["read"].Effect,
        "timestamp": time.Now(),
    })
```

**Example 2: Find Similar Decisions**
```go
// Find 10 most similar authorization decisions
results, err := store.Search(context.Background(), queryEmbedding, 10)

for _, r := range results {
    fmt.Printf("ID: %s, Score: %.3f, Effect: %s\n",
        r.ID,
        r.Score,
        r.Metadata["effect"])
}
```

**Example 3: Anomaly Detection**
```go
detector := vector.NewAnomalyDetector(store, 0.7)
isAnomaly, score, err := detector.DetectAnomaly(req, resp)

if isAnomaly {
    log.WithFields(log.Fields{
        "requestID": req.RequestID,
        "similarity": score,
        "principal": req.Principal.ID,
    }).Warn("Anomalous authorization pattern detected")
}
```

### 13.2 Performance Tuning

**HNSW Parameter Selection**:

| Use Case | M | ef_construction | ef_search | Trade-off |
|----------|---|----------------|-----------|-----------|
| Fast Insert | 8 | 100 | 30 | Lower accuracy, faster build |
| Balanced | 16 | 200 | 50 | Recommended default |
| High Accuracy | 32 | 400 | 100 | Higher memory, slower |

**Quantization Selection**:

| Bits | Memory Reduction | Accuracy (Recall@10) | Use Case |
|------|-----------------|---------------------|----------|
| 32 (float32) | 1x | 100% | Baseline |
| 16 | 2x | 99.5% | High accuracy required |
| 8 | 4x | 97% | Recommended |
| 4 | 8x | 90% | Extreme memory constraints |

---

**Document Version**: 1.0.0
**Status**: Implementation Ready
**Next Review**: After Phase 1 completion (2-3 weeks)
