package vector

import (
	"context"
	"fmt"
	"testing"

	"github.com/authz-engine/go-core/pkg/vector"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewMemoryStore(t *testing.T) {
	tests := []struct {
		name    string
		config  vector.Config
		wantErr bool
	}{
		{
			name: "valid config",
			config: vector.Config{
				Backend:   "memory",
				Dimension: 384,
				HNSW: vector.HNSWConfig{
					M:              16,
					EfConstruction: 200,
					EfSearch:       50,
				},
			},
			wantErr: false,
		},
		{
			name: "default config",
			config: vector.DefaultConfig(),
			wantErr: false,
		},
		{
			name: "zero dimension",
			config: vector.Config{
				Backend:   "memory",
				Dimension: 0,
			},
			wantErr: true,
		},
		{
			name: "negative dimension",
			config: vector.Config{
				Backend:   "memory",
				Dimension: -1,
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store, err := NewMemoryStore(tt.config)

			if tt.wantErr {
				assert.Error(t, err)
				assert.Nil(t, store)
			} else {
				require.NoError(t, err)
				assert.NotNil(t, store)
				assert.NotNil(t, store.adapter)
				assert.Equal(t, tt.config.Dimension, store.adapter.dimension)
			}
		})
	}
}

func TestMemoryStore_CRUD(t *testing.T) {
	config := vector.DefaultConfig()
	config.Dimension = 4 // Must be multiple of 4 for SIMD optimization

	store, err := NewMemoryStore(config)
	require.NoError(t, err)
	defer store.Close()

	ctx := context.Background()

	t.Run("insert and get", func(t *testing.T) {
		vec := []float32{1.0, 2.0, 3.0, 4.0}
		metadata := map[string]interface{}{
			"label": "test",
			"value": 42,
		}

		// Insert
		err := store.Insert(ctx, "vec-1", vec, metadata)
		require.NoError(t, err)

		// Get
		result, err := store.Get(ctx, "vec-1")
		require.NoError(t, err)
		assert.Equal(t, "vec-1", result.ID)
		assert.Equal(t, vec, result.Vector)
		assert.Equal(t, "test", result.Metadata["label"])
		assert.Equal(t, 42, result.Metadata["value"])
	})

	t.Run("delete", func(t *testing.T) {
		vec := []float32{4.0, 5.0, 6.0, 7.0}

		// Insert
		err := store.Insert(ctx, "vec-2", vec, map[string]interface{}{})
		require.NoError(t, err)

		// Delete
		err = store.Delete(ctx, "vec-2")
		require.NoError(t, err)

		// Verify deleted
		_, err = store.Get(ctx, "vec-2")
		assert.Error(t, err)
	})
}

func TestMemoryStore_Search(t *testing.T) {
	config := vector.DefaultConfig()
	config.Dimension = 4 // Must be multiple of 4 for SIMD optimization

	store, err := NewMemoryStore(config)
	require.NoError(t, err)
	defer store.Close()

	ctx := context.Background()

	// Insert test vectors
	testVectors := []struct {
		id   string
		vec  []float32
		meta map[string]interface{}
	}{
		{"vec-1", []float32{1.0, 0.0, 0.0, 0.0}, map[string]interface{}{"axis": "x"}},
		{"vec-2", []float32{0.0, 1.0, 0.0, 0.0}, map[string]interface{}{"axis": "y"}},
		{"vec-3", []float32{0.0, 0.0, 1.0, 0.0}, map[string]interface{}{"axis": "z"}},
		{"vec-4", []float32{0.9, 0.1, 0.0, 0.0}, map[string]interface{}{"axis": "near-x"}},
		{"vec-5", []float32{0.1, 0.9, 0.0, 0.0}, map[string]interface{}{"axis": "near-y"}},
	}

	for _, v := range testVectors {
		err := store.Insert(ctx, v.id, v.vec, v.meta)
		require.NoError(t, err)
	}

	t.Run("find nearest neighbors", func(t *testing.T) {
		query := []float32{1.0, 0.0, 0.0, 0.0}

		results, err := store.Search(ctx, query, 3)
		require.NoError(t, err)
		assert.Len(t, results, 3)

		// First result should be exact match (vec-1) or very close (vec-4)
		assert.Contains(t, []string{"vec-1", "vec-4"}, results[0].ID)

		// Verify scores are in descending order
		for i := 1; i < len(results); i++ {
			assert.GreaterOrEqual(t, results[i-1].Score, results[i].Score)
		}
	})

	t.Run("search with k=1", func(t *testing.T) {
		query := []float32{0.0, 1.0, 0.0, 0.0}

		results, err := store.Search(ctx, query, 1)
		require.NoError(t, err)
		assert.Len(t, results, 1)

		// Should find vec-2 (y-axis) or vec-5 (near-y)
		assert.Contains(t, []string{"vec-2", "vec-5"}, results[0].ID)
	})
}

func TestMemoryStore_BatchInsert(t *testing.T) {
	config := vector.DefaultConfig()
	config.Dimension = 4 // Must be multiple of 4 for SIMD optimization

	store, err := NewMemoryStore(config)
	require.NoError(t, err)
	defer store.Close()

	ctx := context.Background()

	t.Run("batch insert 100 vectors", func(t *testing.T) {
		entries := make([]*vector.VectorEntry, 100)
		for i := 0; i < 100; i++ {
			entries[i] = &vector.VectorEntry{
				ID:     fmt.Sprintf("batch-vec-%d", i),
				Vector: []float32{float32(i), float32(i + 1), float32(i + 2), float32(i + 3)},
				Metadata: map[string]interface{}{
					"batch": true,
					"index": i,
				},
			}
		}

		err := store.BatchInsert(ctx, entries)
		require.NoError(t, err)

		// Verify count
		stats, err := store.Stats(ctx)
		require.NoError(t, err)
		assert.GreaterOrEqual(t, stats.TotalVectors, int64(100))
	})

	t.Run("search after batch insert", func(t *testing.T) {
		query := []float32{50.0, 51.0, 52.0, 53.0}

		results, err := store.Search(ctx, query, 5)
		require.NoError(t, err)
		assert.Len(t, results, 5)

		// Verify we can find vectors from the batch
		foundBatch := false
		for _, r := range results {
			if batch, ok := r.Metadata["batch"]; ok && batch.(bool) {
				foundBatch = true
				break
			}
		}
		assert.True(t, foundBatch)
	})
}

func TestMemoryStore_Stats(t *testing.T) {
	config := vector.DefaultConfig()

	store, err := NewMemoryStore(config)
	require.NoError(t, err)
	defer store.Close()

	ctx := context.Background()

	t.Run("empty store stats", func(t *testing.T) {
		stats, err := store.Stats(ctx)
		require.NoError(t, err)

		assert.Equal(t, int64(0), stats.TotalVectors)
		assert.Equal(t, 384, stats.Dimension)
		assert.Equal(t, "hnsw-fogfish", stats.IndexType)
		assert.Equal(t, int64(0), stats.MemoryUsageBytes)
	})

	t.Run("stats after inserts", func(t *testing.T) {
		// Insert 10 vectors
		for i := 0; i < 10; i++ {
			vec := make([]float32, 384)
			for j := range vec {
				vec[j] = float32(i*j) / 384.0
			}

			err := store.Insert(ctx, fmt.Sprintf("vec-%d", i), vec, map[string]interface{}{"index": i})
			require.NoError(t, err)
		}

		stats, err := store.Stats(ctx)
		require.NoError(t, err)

		assert.Equal(t, int64(10), stats.TotalVectors)
		assert.Greater(t, stats.MemoryUsageBytes, int64(0))
		assert.False(t, stats.LastInsertTime.IsZero())
	})
}

func TestMemoryStore_Close(t *testing.T) {
	config := vector.DefaultConfig()

	store, err := NewMemoryStore(config)
	require.NoError(t, err)

	err = store.Close()
	assert.NoError(t, err)
}

func TestNewVectorStore(t *testing.T) {
	tests := []struct {
		name    string
		config  vector.Config
		wantErr bool
		errMsg  string
	}{
		{
			name:    "memory backend",
			config:  vector.DefaultConfig(),
			wantErr: false,
		},
		{
			name: "postgres backend not implemented",
			config: vector.Config{
				Backend:   "postgres",
				Dimension: 384,
			},
			wantErr: true,
			errMsg:  "not yet implemented",
		},
		{
			name: "unknown backend",
			config: vector.Config{
				Backend:   "unknown",
				Dimension: 384,
			},
			wantErr: true,
			errMsg:  "unknown backend",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store, err := NewVectorStore(tt.config)

			if tt.wantErr {
				assert.Error(t, err)
				assert.Nil(t, store)
				if tt.errMsg != "" {
					assert.Contains(t, err.Error(), tt.errMsg)
				}
			} else {
				require.NoError(t, err)
				assert.NotNil(t, store)
				defer store.Close()
			}
		})
	}
}

func TestMemoryStore_LargeScale(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping large-scale test in short mode")
	}

	config := vector.DefaultConfig()
	config.Dimension = 128

	store, err := NewMemoryStore(config)
	require.NoError(t, err)
	defer store.Close()

	ctx := context.Background()

	t.Run("insert 10K vectors", func(t *testing.T) {
		for i := 0; i < 10000; i++ {
			vec := make([]float32, 128)
			for j := range vec {
				vec[j] = float32(i*j) / 10000.0
			}

			// Normalize
			var norm float32
			for _, v := range vec {
				norm += v * v
			}
			if norm > 0 {
				norm = 1.0 / norm
				for j := range vec {
					vec[j] *= norm
				}
			}

			err := store.Insert(ctx, fmt.Sprintf("vec-%d", i), vec, map[string]interface{}{"index": i})
			require.NoError(t, err)

			if i%1000 == 0 {
				t.Logf("Inserted %d vectors", i)
			}
		}

		stats, err := store.Stats(ctx)
		require.NoError(t, err)
		assert.Equal(t, int64(10000), stats.TotalVectors)
		t.Logf("Memory usage for 10K vectors: %d MB", stats.MemoryUsageBytes/(1024*1024))
	})

	t.Run("search in 10K vectors", func(t *testing.T) {
		query := make([]float32, 128)
		for i := range query {
			query[i] = float32(i) / 128.0
		}

		// Normalize
		var norm float32
		for _, v := range query {
			norm += v * v
		}
		if norm > 0 {
			norm = 1.0 / norm
			for i := range query {
				query[i] *= norm
			}
		}

		results, err := store.Search(ctx, query, 10)
		require.NoError(t, err)
		assert.Len(t, results, 10)

		// Verify results are sorted (descending by score)
		// Use InDelta for floating point comparison tolerance
		for i := 1; i < len(results); i++ {
			if results[i-1].Score < results[i].Score-0.0001 {
				t.Errorf("Results not properly sorted: results[%d].Score=%f < results[%d].Score=%f",
					i-1, results[i-1].Score, i, results[i].Score)
			}
		}
	})
}
