package vector

import (
	"context"
	"fmt"
	"time"

	"github.com/authz-engine/go-core/internal/metrics"
	"github.com/authz-engine/go-core/pkg/vector"
)

// MemoryStore implements VectorStore using fogfish/hnsw in-memory index
type MemoryStore struct {
	adapter *HNSWAdapter
	config  vector.Config
	metrics metrics.Metrics // Phase 4.4: Prometheus metrics
}

// NewMemoryStore creates an in-memory vector store
func NewMemoryStore(config vector.Config) (*MemoryStore, error) {
	if config.Dimension <= 0 {
		return nil, fmt.Errorf("dimension must be positive, got %d", config.Dimension)
	}

	adapter, err := NewHNSWAdapter(config.Dimension, config.HNSW)
	if err != nil {
		return nil, fmt.Errorf("failed to create HNSW adapter: %w", err)
	}

	// Phase 4.4: Initialize metrics (default to NoOp if not provided)
	var m metrics.Metrics = metrics.NewNoOpMetrics()
	if config.Metrics != nil {
		if metricsImpl, ok := config.Metrics.(metrics.Metrics); ok {
			m = metricsImpl
		}
	}

	return &MemoryStore{
		adapter: adapter,
		config:  config,
		metrics: m,
	}, nil
}

// Insert adds a vector with metadata
func (s *MemoryStore) Insert(ctx context.Context, id string, vec []float32, metadata map[string]interface{}) error {
	start := time.Now()
	err := s.adapter.Insert(ctx, id, vec, metadata)
	duration := time.Since(start)

	// Phase 4.4: Record metrics
	if err == nil {
		s.metrics.RecordVectorOp("insert", duration)
		// Update store size
		if stats, statErr := s.adapter.Stats(ctx); statErr == nil {
			s.metrics.UpdateVectorStoreSize(int(stats.TotalVectors))
			s.metrics.UpdateIndexSize(stats.MemoryUsageBytes)
		}
	} else {
		s.metrics.RecordVectorError("insert_failed")
	}

	return err
}

// Search finds k nearest neighbors
func (s *MemoryStore) Search(ctx context.Context, query []float32, k int) ([]*vector.SearchResult, error) {
	start := time.Now()
	results, err := s.adapter.Search(ctx, query, k)
	duration := time.Since(start)

	// Phase 4.4: Record metrics
	if err == nil {
		s.metrics.RecordVectorOp("search", duration)
	} else {
		s.metrics.RecordVectorError("search_failed")
	}

	return results, err
}

// Delete removes a vector
func (s *MemoryStore) Delete(ctx context.Context, id string) error {
	start := time.Now()
	err := s.adapter.Delete(ctx, id)
	duration := time.Since(start)

	// Phase 4.4: Record metrics
	if err == nil {
		s.metrics.RecordVectorOp("delete", duration)
		// Update store size
		if stats, statErr := s.adapter.Stats(ctx); statErr == nil {
			s.metrics.UpdateVectorStoreSize(int(stats.TotalVectors))
			s.metrics.UpdateIndexSize(stats.MemoryUsageBytes)
		}
	} else {
		s.metrics.RecordVectorError("delete_failed")
	}

	return err
}

// Get retrieves a vector by ID
func (s *MemoryStore) Get(ctx context.Context, id string) (*vector.Vector, error) {
	return s.adapter.Get(ctx, id)
}

// BatchInsert efficiently inserts multiple vectors
func (s *MemoryStore) BatchInsert(ctx context.Context, vectors []*vector.VectorEntry) error {
	start := time.Now()
	err := s.adapter.BatchInsert(ctx, vectors)
	duration := time.Since(start)

	// Phase 4.4: Record metrics
	if err == nil {
		s.metrics.RecordVectorOp("insert", duration)
		// Update store size
		if stats, statErr := s.adapter.Stats(ctx); statErr == nil {
			s.metrics.UpdateVectorStoreSize(int(stats.TotalVectors))
			s.metrics.UpdateIndexSize(stats.MemoryUsageBytes)
		}
	} else {
		s.metrics.RecordVectorError("batch_insert_failed")
	}

	return err
}

// Stats returns store statistics
func (s *MemoryStore) Stats(ctx context.Context) (*vector.StoreStats, error) {
	return s.adapter.Stats(ctx)
}

// Close releases resources
func (s *MemoryStore) Close() error {
	return s.adapter.Close()
}

// NewVectorStore creates a new vector store based on configuration
func NewVectorStore(config vector.Config) (vector.VectorStore, error) {
	switch config.Backend {
	case "memory":
		return NewMemoryStore(config)
	case "postgres":
		return nil, fmt.Errorf("PostgreSQL backend not yet implemented")
	default:
		return nil, fmt.Errorf("unknown backend: %s", config.Backend)
	}
}
