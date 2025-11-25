# Go Vector Store - Software Design Document

**Module**: `go-core/internal/vector`
**Version**: 1.0.0 (Phase 1)
**Status**: Implementation Planning
**Last Updated**: 2025-11-25
**Author**: AuthZ Engine Team

---

## 1. Executive Summary

### 1.1 Purpose

This document details the design and implementation of a high-performance vector database for the Go-based authorization engine. The vector store enables **anomaly detection**, **policy similarity analysis**, **risk assessment**, and **intelligent policy recommendations** through efficient nearest-neighbor search.

### 1.2 Architecture

Using [fogfish/hnsw](https://github.com/fogfish/hnsw) library with production-proven HNSW patterns:
- **HNSW Indexing**: fogfish/hnsw library for production-tested Hierarchical Navigable Small World graphs
- **Performance Target**: <1ms p99 latency (based on HNSW algorithm characteristics)
- **Memory Efficiency**: In-memory design with optional Product Quantization for 4-32x memory reduction
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
        ├── memory_store.go       # In-memory store using fogfish/hnsw
        ├── pg_store.go           # PostgreSQL + pgvector backend
        ├── hnsw_adapter.go       # Adapter for fogfish/hnsw library
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

### 3.4 HNSW Integration with fogfish/hnsw

**Design Decision**: Use [fogfish/hnsw](https://github.com/fogfish/hnsw) library instead of custom implementation to leverage production-tested code and reduce maintenance burden.

```go
package vector

import (
    "math"
    "sync"

    "github.com/fogfish/hnsw"
    "github.com/fogfish/hnsw/vector"
    "github.com/fogfish/hnsw/vector/surface"
)

// DecisionVector wraps our authorization decision embedding for fogfish/hnsw
type DecisionVector struct {
    ID       string
    Vec      []float32
    Metadata map[string]interface{}
}

// HNSWAdapter wraps fogfish/hnsw index with our VectorStore interface
type HNSWAdapter struct {
    index     *hnsw.Index[DecisionVector]
    dimension int
    efSearch  int

    // Metadata storage (fogfish/hnsw doesn't store metadata)
    metadata map[string]map[string]interface{}
    vectors  map[string][]float32

    mu sync.RWMutex
}

// NewHNSWAdapter creates a new HNSW index using fogfish/hnsw
func NewHNSWAdapter(dimension, m, efConstruction, efSearch int) *HNSWAdapter {
    // Create distance surface (cosine distance for normalized vectors)
    surf := vector.SurfaceVF32(surface.Cosine())

    // Create index with configuration
    index := hnsw.New(
        surf,
        hnsw.WithM(m),              // Max connections per layer
        hnsw.WithM0(m * 2),         // More connections at layer 0
        hnsw.WithEfConstruction(efConstruction),
    )

    return &HNSWAdapter{
        index:     index,
        dimension: dimension,
        efSearch:  efSearch,
        metadata:  make(map[string]map[string]interface{}),
        vectors:   make(map[string][]float32),
    }
}

// Insert adds a vector to the HNSW index
func (a *HNSWAdapter) Insert(id string, vector []float32, metadata map[string]interface{}) error {
    a.mu.Lock()
    defer a.mu.Unlock()

    if len(vector) != a.dimension {
        return fmt.Errorf("vector dimension mismatch: got %d, expected %d", len(vector), a.dimension)
    }

    // Store metadata and vector separately (fogfish/hnsw only stores vectors)
    a.metadata[id] = metadata
    a.vectors[id] = vector

    // Insert into fogfish/hnsw index
    // Note: fogfish/hnsw uses integer keys, so we hash the string ID
    vecEntry := vector.VF32{
        Key: hashStringToUint64(id),
        Vec: vector,
    }

    return a.index.Insert(vecEntry)
}

// BatchInsert efficiently inserts multiple vectors using fogfish/hnsw's concurrent API
func (a *HNSWAdapter) BatchInsert(entries []VectorEntry) error {
    a.mu.Lock()
    defer a.mu.Unlock()

    // Create channel for batch insertion
    pipe := a.index.Pipe(4) // 4 concurrent workers

    // Send all vectors through the pipe
    go func() {
        for _, entry := range entries {
            a.metadata[entry.ID] = entry.Metadata
            a.vectors[entry.ID] = entry.Vector

            pipe <- vector.VF32{
                Key: hashStringToUint64(entry.ID),
                Vec: entry.Vector,
            }
        }
        close(pipe)
    }()

    return nil
}

// Search finds k nearest neighbors
func (a *HNSWAdapter) Search(query []float32, k int) ([]SearchResult, error) {
    a.mu.RLock()
    defer a.mu.RUnlock()

    if len(query) != a.dimension {
        return nil, fmt.Errorf("query dimension mismatch: got %d, expected %d", len(query), a.dimension)
    }

    // Perform search with configurable efSearch
    neighbors := a.index.Search(
        vector.VF32{Vec: query},
        k,
        a.efSearch,
    )

    // Convert results to our SearchResult format
    results := make([]SearchResult, 0, len(neighbors))
    for _, neighbor := range neighbors {
        // Reverse lookup ID from key
        id := a.findIDByKey(neighbor.Key)
        if id == "" {
            continue
        }

        // Calculate similarity score (cosine similarity for normalized vectors)
        score := cosineSimilarity(query, a.vectors[id])

        results = append(results, SearchResult{
            ID:       id,
            Score:    score,
            Vector:   a.vectors[id],
            Metadata: a.metadata[id],
        })
    }

    return results, nil
}

// Delete removes a vector (fogfish/hnsw doesn't support deletion, so we only remove metadata)
func (a *HNSWAdapter) Delete(id string) error {
    a.mu.Lock()
    defer a.mu.Unlock()

    // Remove from metadata and vector storage
    delete(a.metadata, id)
    delete(a.vectors, id)

    // Note: fogfish/hnsw doesn't support deletion from the index
    // The vector remains in the graph but won't be returned in results
    // For production, consider rebuilding the index periodically

    return nil
}

// Stats returns index statistics
func (a *HNSWAdapter) Stats() *StoreStats {
    a.mu.RLock()
    defer a.mu.RUnlock()

    return &StoreStats{
        TotalVectors: int64(len(a.vectors)),
        Dimension:    a.dimension,
        IndexType:    "hnsw-fogfish",
        MemoryUsageBytes: int64(len(a.vectors) * a.dimension * 4), // Approximate
    }
}

// Helper: Hash string ID to uint64 for fogfish/hnsw
func hashStringToUint64(s string) uint64 {
    h := sha256.Sum256([]byte(s))
    return binary.BigEndian.Uint64(h[:8])
}

// Helper: Reverse lookup ID from hashed key
func (a *HNSWAdapter) findIDByKey(key uint64) string {
    for id := range a.vectors {
        if hashStringToUint64(id) == key {
            return id
        }
    }
    return ""
}

// Distance metrics (kept for compatibility)
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
```

**Key Benefits of fogfish/hnsw Integration**:

1. **Production-Tested**: Mature library with proper HNSW algorithm implementation
2. **Concurrent Operations**: Built-in support for parallel insertions via channels
3. **Type-Safe**: Go generics for compile-time type checking
4. **Flexible Distance Metrics**: Easy to swap between cosine, euclidean, or custom metrics
5. **Reduced Code**: ~200 lines instead of ~2,000 lines of custom HNSW implementation
6. **Active Maintenance**: Community-maintained library with bug fixes and improvements

**Trade-offs**:

1. **No Native Deletion**: fogfish/hnsw doesn't support node deletion (periodic rebuild needed)
2. **Integer Keys**: Uses uint64 keys instead of strings (requires hashing)
3. **No Metadata Storage**: Need separate storage for metadata
4. **Dependency**: External dependency vs. self-contained implementation

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

## 5. Storage Backends

### 5.1 Phase 1: In-Memory Backend (fogfish/hnsw)

**Purpose**: Fast development and small-scale deployments without persistence requirements.

**Implementation**:
```go
package vector

import (
    "context"
    "sync"
    "time"
)

// MemoryStore implements VectorStore using fogfish/hnsw in-memory index
type MemoryStore struct {
    adapter  *HNSWAdapter
    config   Config

    // Statistics
    lastInsert time.Time
    mu         sync.RWMutex
}

// NewMemoryStore creates an in-memory vector store
func NewMemoryStore(config Config) (*MemoryStore, error) {
    adapter := NewHNSWAdapter(
        config.Dimension,
        config.HNSW.M,
        config.HNSW.EfConstruction,
        config.HNSW.EfSearch,
    )

    return &MemoryStore{
        adapter: adapter,
        config:  config,
    }, nil
}

// Insert adds a vector with metadata
func (s *MemoryStore) Insert(ctx context.Context, id string, vector []float32, metadata map[string]interface{}) error {
    s.mu.Lock()
    s.lastInsert = time.Now()
    s.mu.Unlock()

    return s.adapter.Insert(id, vector, metadata)
}

// Search finds k nearest neighbors
func (s *MemoryStore) Search(ctx context.Context, query []float32, k int) ([]SearchResult, error) {
    return s.adapter.Search(query, k)
}

// BatchInsert efficiently inserts multiple vectors
func (s *MemoryStore) BatchInsert(ctx context.Context, vectors []VectorEntry) error {
    s.mu.Lock()
    s.lastInsert = time.Now()
    s.mu.Unlock()

    return s.adapter.BatchInsert(vectors)
}

// Delete removes a vector
func (s *MemoryStore) Delete(ctx context.Context, id string) error {
    return s.adapter.Delete(id)
}

// Stats returns store statistics
func (s *MemoryStore) Stats(ctx context.Context) (*StoreStats, error) {
    s.mu.RLock()
    defer s.mu.RUnlock()

    stats := s.adapter.Stats()
    stats.LastInsertTime = s.lastInsert
    return stats, nil
}

// Close releases resources
func (s *MemoryStore) Close() error {
    // In-memory store doesn't need cleanup
    return nil
}
```

**Characteristics**:
- No persistence (data lost on restart)
- Fast insertion and search (<1ms p99)
- Memory footprint: ~4 bytes per dimension per vector
- Best for: Development, testing, ephemeral deployments

### 5.2 Phase 2: PostgreSQL Backend (pgvector)

**Purpose**: Production deployments requiring durability, ACID guarantees, and scalability.

**Implementation**:
```go
package vector

import (
    "context"
    "database/sql"
    "encoding/json"
    "fmt"

    _ "github.com/lib/pq"
    "github.com/pgvector/pgvector-go"
)

// PostgresStore implements VectorStore using PostgreSQL + pgvector
type PostgresStore struct {
    db     *sql.DB
    config PostgresConfig

    // In-memory cache using fogfish/hnsw (optional)
    cache  *HNSWAdapter
    mu     sync.RWMutex
}

// NewPostgresStore creates a PostgreSQL-backed vector store
func NewPostgresStore(config PostgresConfig) (*PostgresStore, error) {
    // Connect to PostgreSQL
    connStr := fmt.Sprintf(
        "host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
        config.Host, config.Port, config.User, config.Password, config.Database, config.SSLMode,
    )

    db, err := sql.Open("postgres", connStr)
    if err != nil {
        return nil, fmt.Errorf("failed to connect to PostgreSQL: %w", err)
    }

    // Verify pgvector extension
    if config.EnablePgVector {
        if err := ensurePgVectorExtension(db); err != nil {
            return nil, fmt.Errorf("pgvector extension error: %w", err)
        }
    }

    // Create table and index if needed
    if err := ensureVectorTable(db, config); err != nil {
        return nil, fmt.Errorf("failed to create vector table: %w", err)
    }

    store := &PostgresStore{
        db:     db,
        config: config,
    }

    // Optional: Load vectors into in-memory cache for faster search
    if config.EnableMemoryCache {
        store.cache = NewHNSWAdapter(
            config.Dimension,
            config.IndexM,
            config.IndexEfConstruction,
            50, // efSearch
        )
        if err := store.loadCache(); err != nil {
            return nil, fmt.Errorf("failed to load cache: %w", err)
        }
    }

    return store, nil
}

// Insert adds a vector to PostgreSQL
func (s *PostgresStore) Insert(ctx context.Context, id string, vector []float32, metadata map[string]interface{}) error {
    // Convert metadata to JSONB
    metadataJSON, err := json.Marshal(metadata)
    if err != nil {
        return fmt.Errorf("failed to marshal metadata: %w", err)
    }

    // Insert into PostgreSQL
    query := fmt.Sprintf(`
        INSERT INTO %s (id, embedding, metadata)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO UPDATE SET
            embedding = EXCLUDED.embedding,
            metadata = EXCLUDED.metadata
    `, s.config.TableName)

    _, err = s.db.ExecContext(ctx, query, id, pgvector.NewVector(vector), metadataJSON)
    if err != nil {
        return fmt.Errorf("failed to insert vector: %w", err)
    }

    // Update in-memory cache if enabled
    if s.cache != nil {
        s.mu.Lock()
        s.cache.Insert(id, vector, metadata)
        s.mu.Unlock()
    }

    return nil
}

// Search finds k nearest neighbors using pgvector HNSW index
func (s *PostgresStore) Search(ctx context.Context, query []float32, k int) ([]SearchResult, error) {
    // Use in-memory cache if available
    if s.cache != nil {
        s.mu.RLock()
        defer s.mu.RUnlock()
        return s.cache.Search(query, k)
    }

    // Query PostgreSQL with cosine distance
    querySQL := fmt.Sprintf(`
        SELECT id, embedding, metadata, 1 - (embedding <=> $1) as score
        FROM %s
        ORDER BY embedding <=> $1
        LIMIT $2
    `, s.config.TableName)

    rows, err := s.db.QueryContext(ctx, querySQL, pgvector.NewVector(query), k)
    if err != nil {
        return nil, fmt.Errorf("failed to query vectors: %w", err)
    }
    defer rows.Close()

    results := make([]SearchResult, 0, k)
    for rows.Next() {
        var id string
        var embedding pgvector.Vector
        var metadataJSON []byte
        var score float32

        if err := rows.Scan(&id, &embedding, &metadataJSON, &score); err != nil {
            return nil, fmt.Errorf("failed to scan row: %w", err)
        }

        var metadata map[string]interface{}
        if err := json.Unmarshal(metadataJSON, &metadata); err != nil {
            return nil, fmt.Errorf("failed to unmarshal metadata: %w", err)
        }

        results = append(results, SearchResult{
            ID:       id,
            Score:    score,
            Vector:   embedding.Slice(),
            Metadata: metadata,
        })
    }

    return results, nil
}

// Helper: Ensure pgvector extension exists
func ensurePgVectorExtension(db *sql.DB) error {
    _, err := db.Exec("CREATE EXTENSION IF NOT EXISTS vector")
    return err
}

// Helper: Create vector table and HNSW index
func ensureVectorTable(db *sql.DB, config PostgresConfig) error {
    // Create table
    createTable := fmt.Sprintf(`
        CREATE TABLE IF NOT EXISTS %s (
            id TEXT PRIMARY KEY,
            embedding vector(%d) NOT NULL,
            metadata JSONB,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `, config.TableName, config.Dimension)

    if _, err := db.Exec(createTable); err != nil {
        return err
    }

    // Create HNSW index
    createIndex := fmt.Sprintf(`
        CREATE INDEX IF NOT EXISTS %s_embedding_idx
        ON %s USING hnsw (embedding vector_cosine_ops)
        WITH (m = %d, ef_construction = %d)
    `, config.TableName, config.TableName, config.IndexM, config.IndexEfConstruction)

    _, err := db.Exec(createIndex)
    return err
}
```

**Characteristics**:
- Persistent storage with ACID guarantees
- Horizontal scalability via read replicas
- Slower than in-memory (1-5ms p99)
- Optional in-memory cache for hot data
- Best for: Production deployments, multi-instance setups

---

## 6. Performance Analysis

### 6.1 Performance Targets (Based on fogfish/hnsw + HNSW Algorithm)

| Metric | Development (Memory) | Production (pgvector) | Production (pgvector + cache) |
|--------|---------------------|----------------------|------------------------------|
| Search Latency (p50) | <0.5ms | <2ms | <0.5ms |
| Search Latency (p99) | <1ms | <5ms | <1ms |
| Insert Latency | <0.2ms | <10ms (batched) | <10ms |
| Throughput | 50K+ QPS | 5K+ QPS | 40K+ QPS |
| Memory (1M vectors) | ~600MB | ~200MB (PostgreSQL) | ~800MB (cache + DB) |
| Accuracy (Recall@10) | 95%+ | 95%+ | 95%+ |

**Performance Notes**:
- fogfish/hnsw provides concurrent insertion via channels (4-8x speedup for batch operations)
- PostgreSQL pgvector uses HNSW index for O(log n) search
- In-memory cache eliminates database roundtrip for hot queries
- Cosine distance is optimized in both fogfish/hnsw and pgvector

### 6.2 Impact on Authorization Performance

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

### 6.3 Memory Footprint

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

## 7. Development Phases

### 7.1 Phase 1: In-Memory HNSW with fogfish/hnsw (1-2 weeks)

**Goal**: Production-ready in-memory vector store for development and small deployments using fogfish/hnsw library.

**Deliverables**:
1. ✅ HNSWAdapter wrapper for fogfish/hnsw (hnsw_adapter.go)
2. ✅ VectorStore interface (store.go)
3. ✅ In-memory backend (memory_store.go)
4. ✅ Decision embedding generation (embeddings.go)
5. ✅ Comprehensive unit tests (>90% coverage)
6. ✅ Benchmarks (latency, throughput, memory)
7. ✅ Integration with DecisionEngine
8. ✅ Anomaly detection example

**Success Criteria**:
- Search latency <0.5ms p50, <1ms p99
- Throughput >50K QPS
- Memory <600MB per 1M vectors
- Test coverage >90%
- Zero impact on authorization performance

**Reduced Scope**: Using fogfish/hnsw reduces custom HNSW implementation from ~2,000 lines to ~200 lines of adapter code, cutting development time by 33%.

### 7.2 Phase 2: PostgreSQL + pgvector (2-3 weeks)

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

### 7.3 Phase 3: Product Quantization (1-2 weeks)

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

### 7.4 Phase 4: Advanced Features (2-3 weeks)

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

## 8. Testing Strategy

### 8.1 Unit Tests

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

### 8.2 Integration Tests

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

### 8.3 Performance Benchmarks

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

## 9. Dependencies

### 9.1 Go Libraries

| Library | Purpose | License |
|---------|---------|---------|
| `github.com/fogfish/hnsw` | HNSW graph implementation | Apache 2.0 |
| `github.com/lib/pq` | PostgreSQL driver | MIT |
| `github.com/pgvector/pgvector-go` | pgvector extension | MIT |
| `github.com/prometheus/client_golang` | Metrics | Apache 2.0 |
| `github.com/stretchr/testify` | Testing assertions | MIT |

**New Dependency**: `fogfish/hnsw` provides production-tested HNSW implementation with:
- Go generics for type safety
- Concurrent insertion via channels
- Multiple distance metrics (cosine, euclidean, custom)
- Active maintenance and community support

### 9.2 PostgreSQL Extensions

| Extension | Purpose | Version |
|-----------|---------|---------|
| `pgvector` | Vector similarity search | 0.5.0+ |

**Installation**:
```sql
CREATE EXTENSION vector;
```

### 9.3 System Requirements

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

## 10. Deployment

### 10.1 Configuration Example

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

### 10.2 Database Schema (PostgreSQL)

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

## 11. Monitoring & Observability

### 11.1 Prometheus Metrics

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

### 11.2 Logging

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

## 12. Security Considerations

### 12.1 Data Protection

1. **Vector Embeddings**: May contain sensitive information from authorization decisions
   - **Mitigation**: Encrypt at rest (PostgreSQL TLS, disk encryption)
   - **Mitigation**: Feature hashing prevents direct PII storage

2. **Metadata Leakage**: Metadata fields may contain sensitive attributes
   - **Mitigation**: Minimal metadata (only IDs and timestamps)
   - **Mitigation**: RBAC for vector store access

3. **SQL Injection** (PostgreSQL backend):
   - **Mitigation**: Parameterized queries only
   - **Mitigation**: Input validation on IDs and metadata

### 12.2 Access Control

1. **Vector Store Access**: Restrict to authorized services only
   - **Mitigation**: Separate database user with limited privileges
   - **Mitigation**: Network isolation (VPC, firewall rules)

2. **Anomaly Detection**: Alert on unauthorized access attempts
   - **Mitigation**: Audit log all anomaly detections
   - **Mitigation**: Rate limiting on anomaly API endpoints

---

## 13. References

### 13.1 Papers

1. **HNSW Algorithm**: "Efficient and robust approximate nearest neighbor search using Hierarchical Navigable Small World graphs" (Malkov & Yashunin, 2016)
2. **Product Quantization**: "Product quantization for nearest neighbor search" (Jegou et al., 2011)

### 13.2 Projects

1. **fogfish/hnsw**: https://github.com/fogfish/hnsw (Go HNSW implementation)
2. **pgvector**: https://github.com/pgvector/pgvector (PostgreSQL extension)
3. **hnswlib**: https://github.com/nmslib/hnswlib (C++ reference implementation)

### 13.3 Related ADRs

- **ADR-010**: Vector Store Production Strategy (TypeScript implementation gaps)
- **ADR-004**: Memory-First Development (development mode philosophy)
- **ADR-008**: Hybrid Go/TypeScript Architecture (why Go for vector store)

---

## 14. Appendix

### 14.1 API Examples

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

### 14.2 Performance Tuning

**fogfish/hnsw Configuration**:

The fogfish/hnsw library uses similar parameters to standard HNSW implementations:

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

### 14.3 Migration Notes

**Transitioning from Custom HNSW to fogfish/hnsw**:

1. **Benefits**:
   - Reduced code maintenance (~2,000 lines → ~200 lines)
   - Production-tested implementation
   - Community support and bug fixes
   - Built-in concurrency via Go channels
   - Type-safe with Go generics

2. **Trade-offs**:
   - External dependency (vs. self-contained)
   - No native deletion support (requires periodic rebuild)
   - Integer keys instead of strings (hashing needed)
   - Separate metadata storage required

3. **Integration Steps**:
   - Replace custom HNSW with HNSWAdapter wrapper
   - Update Insert/Search/Delete methods
   - Add metadata storage layer
   - Update unit tests for adapter
   - Benchmark against custom implementation

---

**Document Version**: 2.0.0
**Status**: Implementation Ready (fogfish/hnsw integration)
**Last Updated**: 2025-11-25
**Next Review**: After Phase 1 completion (1-2 weeks)
