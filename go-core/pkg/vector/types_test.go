package vector

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()

	assert.Equal(t, "memory", cfg.Backend)
	assert.Equal(t, 384, cfg.Dimension)
	assert.Equal(t, 16, cfg.HNSW.M)
	assert.Equal(t, 200, cfg.HNSW.EfConstruction)
	assert.Equal(t, 50, cfg.HNSW.EfSearch)
	assert.False(t, cfg.EnableQuantization)
	assert.Equal(t, 8, cfg.QuantizationBits)
}

func TestSearchResult(t *testing.T) {
	result := &SearchResult{
		ID:       "test-1",
		Score:    0.95,
		Distance: 0.05,
		Vector:   []float32{1.0, 2.0, 3.0},
		Metadata: map[string]interface{}{
			"type": "test",
		},
	}

	assert.Equal(t, "test-1", result.ID)
	assert.Equal(t, float32(0.95), result.Score)
	assert.Equal(t, float32(0.05), result.Distance)
	assert.Len(t, result.Vector, 3)
	assert.Equal(t, "test", result.Metadata["type"])
}

func TestVectorEntry(t *testing.T) {
	entry := &VectorEntry{
		ID:     "entry-1",
		Vector: []float32{1.0, 2.0, 3.0},
		Metadata: map[string]interface{}{
			"label": "test",
		},
	}

	assert.Equal(t, "entry-1", entry.ID)
	assert.Len(t, entry.Vector, 3)
	assert.Equal(t, "test", entry.Metadata["label"])
}
