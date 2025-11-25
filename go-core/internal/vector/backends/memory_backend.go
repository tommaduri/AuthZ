// Package backends provides storage backends for vector metadata
package backends

import (
	"fmt"
	"sync"

	"github.com/authz-engine/go-core/pkg/vector"
)

// MemoryBackend provides in-memory storage for vector metadata
type MemoryBackend struct {
	// Metadata storage: string ID → metadata (exported for HNSW adapter)
	Metadata map[string]map[string]interface{}

	// Vector storage: string ID → vector (exported for HNSW adapter)
	Vectors map[string][]float32

	// ID to uint64 mapping for fogfish/hnsw
	idToKey map[string]uint64
	keyToID map[uint64]string

	// Counter for generating unique keys
	nextKey uint64

	// Thread safety (exported for HNSW adapter)
	Mu sync.RWMutex
}

// NewMemoryBackend creates a new in-memory backend
func NewMemoryBackend() *MemoryBackend {
	return &MemoryBackend{
		Metadata: make(map[string]map[string]interface{}),
		Vectors:  make(map[string][]float32),
		idToKey:  make(map[string]uint64),
		keyToID:  make(map[uint64]string),
		nextKey:  1,
	}
}

// Insert stores vector and metadata
func (b *MemoryBackend) Insert(id string, vec []float32, metadata map[string]interface{}) (uint64, error) {
	b.Mu.Lock()
	defer b.Mu.Unlock()

	// Check if ID already exists
	if key, exists := b.idToKey[id]; exists {
		// Update existing
		b.Vectors[id] = vec
		b.Metadata[id] = metadata
		return key, nil
	}

	// Generate new key
	key := b.nextKey
	b.nextKey++

	// Store mappings
	b.idToKey[id] = key
	b.keyToID[key] = id

	// Store vector and metadata
	b.Vectors[id] = vec
	b.Metadata[id] = metadata

	return key, nil
}

// Get retrieves vector and metadata by ID
func (b *MemoryBackend) Get(id string) (*vector.Vector, error) {
	b.Mu.RLock()
	defer b.Mu.RUnlock()

	vec, vecExists := b.Vectors[id]
	if !vecExists {
		return nil, fmt.Errorf("vector not found: %s", id)
	}

	meta := b.Metadata[id]

	return &vector.Vector{
		ID:       id,
		Vector:   vec,
		Metadata: meta,
	}, nil
}

// Delete removes vector and metadata
func (b *MemoryBackend) Delete(id string) error {
	b.Mu.Lock()
	defer b.Mu.Unlock()

	key, exists := b.idToKey[id]
	if !exists {
		return fmt.Errorf("vector not found: %s", id)
	}

	// Remove all mappings
	delete(b.idToKey, id)
	delete(b.keyToID, key)
	delete(b.Vectors, id)
	delete(b.Metadata, id)

	return nil
}

// GetByKey retrieves ID by HNSW key
func (b *MemoryBackend) GetByKey(key uint64) (string, bool) {
	b.Mu.RLock()
	defer b.Mu.RUnlock()

	id, exists := b.keyToID[key]
	return id, exists
}

// GetKey retrieves HNSW key by ID
func (b *MemoryBackend) GetKey(id string) (uint64, bool) {
	b.Mu.RLock()
	defer b.Mu.RUnlock()

	key, exists := b.idToKey[id]
	return key, exists
}

// Count returns total number of vectors
func (b *MemoryBackend) Count() int64 {
	b.Mu.RLock()
	defer b.Mu.RUnlock()

	return int64(len(b.Vectors))
}

// MemoryUsage estimates memory usage in bytes
func (b *MemoryBackend) MemoryUsage(dimension int) int64 {
	b.Mu.RLock()
	defer b.Mu.RUnlock()

	// Rough estimate:
	// - Vector data: count × dimension × 4 bytes (float32)
	// - Metadata: count × 200 bytes (average)
	// - Maps overhead: count × 100 bytes (average)

	count := int64(len(b.Vectors))
	vectorBytes := count * int64(dimension) * 4
	metadataBytes := count * 200
	mapBytes := count * 100

	return vectorBytes + metadataBytes + mapBytes
}
