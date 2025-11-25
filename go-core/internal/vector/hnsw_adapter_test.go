package vector

import (
	"context"
	"fmt"
	"testing"

	"github.com/authz-engine/go-core/pkg/vector"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewHNSWAdapter(t *testing.T) {
	tests := []struct {
		name      string
		dimension int
		config    vector.HNSWConfig
		wantErr   bool
	}{
		{
			name:      "valid config",
			dimension: 384,
			config:    vector.HNSWConfig{M: 16, EfConstruction: 200, EfSearch: 50},
			wantErr:   false,
		},
		{
			name:      "zero dimension",
			dimension: 0,
			config:    vector.HNSWConfig{M: 16, EfConstruction: 200, EfSearch: 50},
			wantErr:   true,
		},
		{
			name:      "negative dimension",
			dimension: -1,
			config:    vector.HNSWConfig{M: 16, EfConstruction: 200, EfSearch: 50},
			wantErr:   true,
		},
		{
			name:      "default parameters",
			dimension: 128,
			config:    vector.HNSWConfig{}, // All zeros, should use defaults
			wantErr:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			adapter, err := NewHNSWAdapter(tt.dimension, tt.config)

			if tt.wantErr {
				assert.Error(t, err)
				assert.Nil(t, adapter)
			} else {
				require.NoError(t, err)
				assert.NotNil(t, adapter)
				assert.Equal(t, tt.dimension, adapter.dimension)

				// Check defaults were applied
				if tt.config.M == 0 {
					assert.Equal(t, 16, adapter.config.M)
				}
				if tt.config.EfConstruction == 0 {
					assert.Equal(t, 200, adapter.config.EfConstruction)
				}
				if tt.config.EfSearch == 0 {
					assert.Equal(t, 50, adapter.config.EfSearch)
				}
			}
		})
	}
}

func TestHNSWAdapter_Insert(t *testing.T) {
	adapter, err := NewHNSWAdapter(3, vector.HNSWConfig{M: 16, EfConstruction: 200, EfSearch: 50})
	require.NoError(t, err)

	ctx := context.Background()

	t.Run("successful insert", func(t *testing.T) {
		vec := []float32{1.0, 2.0, 3.0}
		metadata := map[string]interface{}{"label": "test"}

		err := adapter.Insert(ctx, "vec-1", vec, metadata)
		require.NoError(t, err)

		// Verify inserted
		stats, err := adapter.Stats(ctx)
		require.NoError(t, err)
		assert.Equal(t, int64(1), stats.TotalVectors)
	})

	t.Run("dimension mismatch", func(t *testing.T) {
		vec := []float32{1.0, 2.0} // Only 2 dimensions, expected 3
		metadata := map[string]interface{}{"label": "test"}

		err := adapter.Insert(ctx, "vec-2", vec, metadata)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "dimension mismatch")
	})

	t.Run("context cancellation", func(t *testing.T) {
		cancelCtx, cancel := context.WithCancel(context.Background())
		cancel() // Cancel immediately

		vec := []float32{1.0, 2.0, 3.0}
		err := adapter.Insert(cancelCtx, "vec-3", vec, nil)
		assert.Error(t, err)
	})

	t.Run("insert multiple vectors", func(t *testing.T) {
		for i := 0; i < 100; i++ {
			vec := []float32{float32(i), float32(i + 1), float32(i + 2)}
			metadata := map[string]interface{}{"index": i}

			err := adapter.Insert(ctx, fmt.Sprintf("vec-%d", i), vec, metadata)
			require.NoError(t, err)
		}

		stats, err := adapter.Stats(ctx)
		require.NoError(t, err)
		assert.GreaterOrEqual(t, stats.TotalVectors, int64(100))
	})
}

func TestHNSWAdapter_Search(t *testing.T) {
	adapter, err := NewHNSWAdapter(3, vector.HNSWConfig{M: 16, EfConstruction: 200, EfSearch: 50})
	require.NoError(t, err)

	ctx := context.Background()

	// Insert test vectors
	vectors := []struct {
		id   string
		vec  []float32
		meta map[string]interface{}
	}{
		{"vec-1", []float32{1.0, 0.0, 0.0}, map[string]interface{}{"label": "x-axis"}},
		{"vec-2", []float32{0.0, 1.0, 0.0}, map[string]interface{}{"label": "y-axis"}},
		{"vec-3", []float32{0.0, 0.0, 1.0}, map[string]interface{}{"label": "z-axis"}},
		{"vec-4", []float32{0.9, 0.1, 0.0}, map[string]interface{}{"label": "near-x"}},
	}

	for _, v := range vectors {
		err := adapter.Insert(ctx, v.id, v.vec, v.meta)
		require.NoError(t, err)
	}

	t.Run("find nearest neighbors", func(t *testing.T) {
		query := []float32{1.0, 0.0, 0.0} // Search for x-axis

		results, err := adapter.Search(ctx, query, 2)
		require.NoError(t, err)
		assert.Len(t, results, 2)

		// First result should be exact match (vec-1) or very close (vec-4)
		assert.Contains(t, []string{"vec-1", "vec-4"}, results[0].ID)
		assert.Greater(t, results[0].Score, float32(0.8))
	})

	t.Run("dimension mismatch", func(t *testing.T) {
		query := []float32{1.0, 0.0} // Only 2 dimensions

		_, err := adapter.Search(ctx, query, 2)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "dimension mismatch")
	})

	t.Run("invalid k", func(t *testing.T) {
		query := []float32{1.0, 0.0, 0.0}

		_, err := adapter.Search(ctx, query, 0)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "k must be positive")
	})

	t.Run("context cancellation", func(t *testing.T) {
		cancelCtx, cancel := context.WithCancel(context.Background())
		cancel()

		query := []float32{1.0, 0.0, 0.0}
		_, err := adapter.Search(cancelCtx, query, 2)
		assert.Error(t, err)
	})

	t.Run("k larger than dataset", func(t *testing.T) {
		query := []float32{1.0, 0.0, 0.0}

		results, err := adapter.Search(ctx, query, 100)
		require.NoError(t, err)
		// Should return all available vectors (4 in this case)
		assert.LessOrEqual(t, len(results), 4)
	})
}

func TestHNSWAdapter_Delete(t *testing.T) {
	adapter, err := NewHNSWAdapter(3, vector.HNSWConfig{M: 16, EfConstruction: 200, EfSearch: 50})
	require.NoError(t, err)

	ctx := context.Background()

	// Insert test vector
	vec := []float32{1.0, 2.0, 3.0}
	err = adapter.Insert(ctx, "vec-1", vec, map[string]interface{}{"label": "test"})
	require.NoError(t, err)

	t.Run("successful delete", func(t *testing.T) {
		err := adapter.Delete(ctx, "vec-1")
		require.NoError(t, err)

		// Verify deleted (backend should return error)
		_, err = adapter.Get(ctx, "vec-1")
		assert.Error(t, err)
	})

	t.Run("delete non-existent", func(t *testing.T) {
		err := adapter.Delete(ctx, "non-existent")
		assert.Error(t, err)
	})

	t.Run("context cancellation", func(t *testing.T) {
		cancelCtx, cancel := context.WithCancel(context.Background())
		cancel()

		err := adapter.Delete(cancelCtx, "vec-2")
		assert.Error(t, err)
	})
}

func TestHNSWAdapter_Get(t *testing.T) {
	adapter, err := NewHNSWAdapter(3, vector.HNSWConfig{M: 16, EfConstruction: 200, EfSearch: 50})
	require.NoError(t, err)

	ctx := context.Background()

	// Insert test vector
	vec := []float32{1.0, 2.0, 3.0}
	metadata := map[string]interface{}{"label": "test", "version": 1}
	err = adapter.Insert(ctx, "vec-1", vec, metadata)
	require.NoError(t, err)

	t.Run("get existing vector", func(t *testing.T) {
		result, err := adapter.Get(ctx, "vec-1")
		require.NoError(t, err)
		assert.Equal(t, "vec-1", result.ID)
		assert.Equal(t, vec, result.Vector)
		assert.Equal(t, "test", result.Metadata["label"])
		assert.Equal(t, 1, result.Metadata["version"])
	})

	t.Run("get non-existent vector", func(t *testing.T) {
		_, err := adapter.Get(ctx, "non-existent")
		assert.Error(t, err)
	})

	t.Run("context cancellation", func(t *testing.T) {
		cancelCtx, cancel := context.WithCancel(context.Background())
		cancel()

		_, err := adapter.Get(cancelCtx, "vec-1")
		assert.Error(t, err)
	})
}

func TestHNSWAdapter_BatchInsert(t *testing.T) {
	adapter, err := NewHNSWAdapter(3, vector.HNSWConfig{M: 16, EfConstruction: 200, EfSearch: 50})
	require.NoError(t, err)

	ctx := context.Background()

	t.Run("batch insert multiple vectors", func(t *testing.T) {
		entries := make([]*vector.VectorEntry, 50)
		for i := 0; i < 50; i++ {
			entries[i] = &vector.VectorEntry{
				ID:     fmt.Sprintf("batch-vec-%d", i),
				Vector: []float32{float32(i), float32(i + 1), float32(i + 2)},
				Metadata: map[string]interface{}{
					"batch": true,
					"index": i,
				},
			}
		}

		err := adapter.BatchInsert(ctx, entries)
		require.NoError(t, err)

		// Verify all inserted
		stats, err := adapter.Stats(ctx)
		require.NoError(t, err)
		assert.GreaterOrEqual(t, stats.TotalVectors, int64(50))
	})

	t.Run("batch insert with dimension mismatch", func(t *testing.T) {
		entries := []*vector.VectorEntry{
			{
				ID:       "bad-vec",
				Vector:   []float32{1.0, 2.0}, // Wrong dimension
				Metadata: map[string]interface{}{},
			},
		}

		err := adapter.BatchInsert(ctx, entries)
		assert.Error(t, err)
	})

	t.Run("context cancellation", func(t *testing.T) {
		cancelCtx, cancel := context.WithCancel(context.Background())
		cancel()

		entries := []*vector.VectorEntry{
			{
				ID:       "vec",
				Vector:   []float32{1.0, 2.0, 3.0},
				Metadata: map[string]interface{}{},
			},
		}

		err := adapter.BatchInsert(cancelCtx, entries)
		assert.Error(t, err)
	})
}

func TestHNSWAdapter_Stats(t *testing.T) {
	adapter, err := NewHNSWAdapter(384, vector.HNSWConfig{M: 16, EfConstruction: 200, EfSearch: 50})
	require.NoError(t, err)

	ctx := context.Background()

	t.Run("empty stats", func(t *testing.T) {
		stats, err := adapter.Stats(ctx)
		require.NoError(t, err)
		assert.Equal(t, int64(0), stats.TotalVectors)
		assert.Equal(t, 384, stats.Dimension)
		assert.Equal(t, "hnsw-fogfish", stats.IndexType)
	})

	t.Run("stats after insert", func(t *testing.T) {
		vec := make([]float32, 384)
		for i := range vec {
			vec[i] = float32(i) / 384.0
		}

		err := adapter.Insert(ctx, "vec-1", vec, map[string]interface{}{"test": true})
		require.NoError(t, err)

		stats, err := adapter.Stats(ctx)
		require.NoError(t, err)
		assert.Equal(t, int64(1), stats.TotalVectors)
		assert.Greater(t, stats.MemoryUsageBytes, int64(0))
		assert.False(t, stats.LastInsertTime.IsZero())
	})
}

func TestHNSWAdapter_Close(t *testing.T) {
	adapter, err := NewHNSWAdapter(3, vector.HNSWConfig{M: 16, EfConstruction: 200, EfSearch: 50})
	require.NoError(t, err)

	err = adapter.Close()
	assert.NoError(t, err)
}

func TestHNSWAdapter_SearchAccuracy(t *testing.T) {
	adapter, err := NewHNSWAdapter(128, vector.HNSWConfig{M: 16, EfConstruction: 200, EfSearch: 50})
	require.NoError(t, err)

	ctx := context.Background()

	// Insert 1000 random vectors
	for i := 0; i < 1000; i++ {
		vec := make([]float32, 128)
		for j := range vec {
			vec[j] = float32(i*j) / 1000.0
		}
		// Normalize vector
		var norm float32
		for _, v := range vec {
			norm += v * v
		}
		norm = float32(1.0 / (norm + 0.00001))
		for j := range vec {
			vec[j] *= norm
		}

		err := adapter.Insert(ctx, fmt.Sprintf("vec-%d", i), vec, map[string]interface{}{"index": i})
		require.NoError(t, err)
	}

	// Test search accuracy
	query := make([]float32, 128)
	for i := range query {
		query[i] = float32(i) / 128.0
	}
	// Normalize query
	var norm float32
	for _, v := range query {
		norm += v * v
	}
	norm = float32(1.0 / (norm + 0.00001))
	for i := range query {
		query[i] *= norm
	}

	results, err := adapter.Search(ctx, query, 10)
	require.NoError(t, err)
	assert.Len(t, results, 10)

	// Verify results are sorted by score (descending)
	for i := 1; i < len(results); i++ {
		assert.GreaterOrEqual(t, results[i-1].Score, results[i].Score)
	}
}
