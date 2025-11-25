package vector

import (
	"context"
	"fmt"

	"github.com/authz-engine/go-core/pkg/vector"
)

// MemoryStore implements VectorStore using fogfish/hnsw in-memory index
type MemoryStore struct {
	adapter *HNSWAdapter
	config  vector.Config
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

	return &MemoryStore{
		adapter: adapter,
		config:  config,
	}, nil
}

// Insert adds a vector with metadata
func (s *MemoryStore) Insert(ctx context.Context, id string, vec []float32, metadata map[string]interface{}) error {
	return s.adapter.Insert(ctx, id, vec, metadata)
}

// Search finds k nearest neighbors
func (s *MemoryStore) Search(ctx context.Context, query []float32, k int) ([]*vector.SearchResult, error) {
	return s.adapter.Search(ctx, query, k)
}

// Delete removes a vector
func (s *MemoryStore) Delete(ctx context.Context, id string) error {
	return s.adapter.Delete(ctx, id)
}

// Get retrieves a vector by ID
func (s *MemoryStore) Get(ctx context.Context, id string) (*vector.Vector, error) {
	return s.adapter.Get(ctx, id)
}

// BatchInsert efficiently inserts multiple vectors
func (s *MemoryStore) BatchInsert(ctx context.Context, vectors []*vector.VectorEntry) error {
	return s.adapter.BatchInsert(ctx, vectors)
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
