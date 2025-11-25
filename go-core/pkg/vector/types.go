// Package vector provides vector similarity search capabilities for the authorization engine
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
	Search(ctx context.Context, query []float32, k int) ([]*SearchResult, error)

	// Delete removes a vector by ID
	Delete(ctx context.Context, id string) error

	// Get retrieves a vector by ID
	Get(ctx context.Context, id string) (*Vector, error)

	// BatchInsert adds multiple vectors efficiently
	BatchInsert(ctx context.Context, vectors []*VectorEntry) error

	// Stats returns store statistics
	Stats(ctx context.Context) (*StoreStats, error)

	// Close releases resources
	Close() error
}

// SearchResult represents a nearest neighbor result
type SearchResult struct {
	ID       string                 // Vector ID
	Score    float32                // Similarity score (higher = more similar)
	Distance float32                // Distance metric (lower = more similar)
	Vector   []float32              // Original vector
	Metadata map[string]interface{} // Associated metadata
}

// Vector represents a stored vector with metadata
type Vector struct {
	ID       string
	Vector   []float32
	Metadata map[string]interface{}
}

// VectorEntry represents a vector with metadata for batch operations
type VectorEntry struct {
	ID       string
	Vector   []float32
	Metadata map[string]interface{}
}

// StoreStats provides store statistics
type StoreStats struct {
	TotalVectors     int64
	Dimension        int
	IndexType        string
	MemoryUsageBytes int64
	LastInsertTime   time.Time
}

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
	IndexM              int // HNSW M parameter
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
