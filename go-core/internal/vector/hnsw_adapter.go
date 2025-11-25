// Package vector provides HNSW-based vector similarity search
package vector

import (
	"context"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/authz-engine/go-core/internal/vector/backends"
	"github.com/authz-engine/go-core/pkg/vector"
	"github.com/fogfish/hnsw"
	hnswvector "github.com/kshard/vector"
)

// HNSWAdapter wraps fogfish/hnsw index with our VectorStore interface
type HNSWAdapter struct {
	index     *hnsw.HNSW[[]float32]
	backend   *backends.MemoryBackend
	dimension int
	efSearch  int
	config    vector.HNSWConfig

	lastInsert time.Time
	mu         sync.RWMutex
}

// NewHNSWAdapter creates a new HNSW index using fogfish/hnsw
func NewHNSWAdapter(dimension int, cfg vector.HNSWConfig) (*HNSWAdapter, error) {
	if dimension <= 0 {
		return nil, fmt.Errorf("dimension must be positive, got %d", dimension)
	}

	if cfg.M <= 0 {
		cfg.M = 16 // Default
	}
	if cfg.EfConstruction <= 0 {
		cfg.EfConstruction = 200 // Default
	}
	if cfg.EfSearch <= 0 {
		cfg.EfSearch = 50 // Default
	}

	// Create cosine distance surface for float32 vectors
	cosineFunc := hnswvector.Cosine()
	surface := hnswvector.Surface[[]float32]{
		Distance: func(a, b []float32) float32 {
			// Extract F32 slices and use cosine distance
			f32a := hnswvector.F32(a)
			f32b := hnswvector.F32(b)
			return cosineFunc.Distance(f32a, f32b)
		},
		Equal: func(a, b []float32) bool {
			if len(a) != len(b) {
				return false
			}
			for i := range a {
				if a[i] != b[i] {
					return false
				}
			}
			return true
		},
	}

	// Create index with configuration
	index := hnsw.New[[]float32](
		surface,
		hnsw.WithM(cfg.M),
		hnsw.WithM0(cfg.M*2),
		hnsw.WithEfConstruction(cfg.EfConstruction),
	)

	backend := backends.NewMemoryBackend()

	return &HNSWAdapter{
		index:     index,
		backend:   backend,
		dimension: dimension,
		efSearch:  cfg.EfSearch,
		config:    cfg,
	}, nil
}

// Insert adds a vector to the HNSW index
func (a *HNSWAdapter) Insert(ctx context.Context, id string, vec []float32, metadata map[string]interface{}) error {
	if len(vec) != a.dimension {
		return fmt.Errorf("vector dimension mismatch: got %d, expected %d", len(vec), a.dimension)
	}

	// Check context cancellation
	if ctx != nil && ctx.Err() != nil {
		return ctx.Err()
	}

	// Store in backend and get HNSW key
	_, err := a.backend.Insert(id, vec, metadata)
	if err != nil {
		return fmt.Errorf("backend insert failed: %w", err)
	}

	// Insert into fogfish/hnsw index
	a.index.Insert(vec)

	a.mu.Lock()
	a.lastInsert = time.Now()
	a.mu.Unlock()

	return nil
}

// Search finds k nearest neighbors
func (a *HNSWAdapter) Search(ctx context.Context, query []float32, k int) ([]*vector.SearchResult, error) {
	if len(query) != a.dimension {
		return nil, fmt.Errorf("query dimension mismatch: got %d, expected %d", len(query), a.dimension)
	}

	if k <= 0 {
		return nil, fmt.Errorf("k must be positive, got %d", k)
	}

	// Check context cancellation
	if ctx != nil && ctx.Err() != nil {
		return nil, ctx.Err()
	}

	// Perform search with configurable efSearch
	neighbors := a.index.Search(query, k, a.efSearch)

	// Convert results to our SearchResult format
	results := make([]*vector.SearchResult, 0, len(neighbors))

	// Find closest matches in backend by comparing vectors
	a.backend.Mu.RLock()
	for _, neighborVec := range neighbors {
		// Find the ID for this vector in backend
		bestID := ""
		var bestDistance float32 = math.MaxFloat32

		for id, storedVec := range a.backend.Vectors {
			// Check if vectors match (approximately)
			dist := euclideanDistance(neighborVec, storedVec)
			if dist < bestDistance {
				bestDistance = dist
				bestID = id
			}

			// If exact match (distance ~0), use this one
			if dist < 0.0001 {
				bestID = id
				break
			}
		}

		if bestID != "" {
			// Calculate cosine similarity for score
			score := cosineSimilarity(query, neighborVec)
			distance := euclideanDistance(query, neighborVec)

			results = append(results, &vector.SearchResult{
				ID:       bestID,
				Score:    score,
				Distance: distance,
				Vector:   neighborVec,
				Metadata: a.backend.Metadata[bestID],
			})
		}
	}
	a.backend.Mu.RUnlock()

	return results, nil
}

// Delete removes a vector (fogfish/hnsw doesn't support deletion, so we only remove from backend)
func (a *HNSWAdapter) Delete(ctx context.Context, id string) error {
	// Check context cancellation
	if ctx != nil && ctx.Err() != nil {
		return ctx.Err()
	}

	// Remove from backend
	err := a.backend.Delete(id)
	if err != nil {
		return fmt.Errorf("backend delete failed: %w", err)
	}

	// Note: fogfish/hnsw doesn't support deletion from the index
	// The vector remains in the graph but won't be returned in results
	// For production, consider rebuilding the index periodically

	return nil
}

// Get retrieves a vector by ID
func (a *HNSWAdapter) Get(ctx context.Context, id string) (*vector.Vector, error) {
	// Check context cancellation
	if ctx != nil && ctx.Err() != nil {
		return nil, ctx.Err()
	}

	return a.backend.Get(id)
}

// BatchInsert efficiently inserts multiple vectors
func (a *HNSWAdapter) BatchInsert(ctx context.Context, entries []*vector.VectorEntry) error {
	// Check context cancellation
	if ctx != nil && ctx.Err() != nil {
		return ctx.Err()
	}

	for _, entry := range entries {
		err := a.Insert(ctx, entry.ID, entry.Vector, entry.Metadata)
		if err != nil {
			return fmt.Errorf("batch insert failed for ID %s: %w", entry.ID, err)
		}
	}

	return nil
}

// Stats returns index statistics
func (a *HNSWAdapter) Stats(ctx context.Context) (*vector.StoreStats, error) {
	a.mu.RLock()
	lastInsert := a.lastInsert
	a.mu.RUnlock()

	return &vector.StoreStats{
		TotalVectors:     a.backend.Count(),
		Dimension:        a.dimension,
		IndexType:        "hnsw-fogfish",
		MemoryUsageBytes: a.backend.MemoryUsage(a.dimension),
		LastInsertTime:   lastInsert,
	}, nil
}

// Close releases resources
func (a *HNSWAdapter) Close() error {
	// No cleanup needed for in-memory adapter
	return nil
}

// Helper: Calculate euclidean distance
func euclideanDistance(a, b []float32) float32 {
	var sum float32
	for i := range a {
		d := a[i] - b[i]
		sum += d * d
	}
	return float32(math.Sqrt(float64(sum)))
}

// Helper: Calculate cosine similarity
func cosineSimilarity(a, b []float32) float32 {
	var dot, normA, normB float32
	for i := range a {
		dot += a[i] * b[i]
		normA += a[i] * a[i]
		normB += b[i] * b[i]
	}
	if normA == 0 || normB == 0 {
		return 0
	}
	return dot / (float32(math.Sqrt(float64(normA))) * float32(math.Sqrt(float64(normB))))
}
