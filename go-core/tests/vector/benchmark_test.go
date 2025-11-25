package vector_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/authz-engine/go-core/internal/vector"
	pkgvector "github.com/authz-engine/go-core/pkg/vector"
)

// BenchmarkMemoryStore_Insert measures insert performance
func BenchmarkMemoryStore_Insert(b *testing.B) {
	config := pkgvector.DefaultConfig()
	config.Dimension = 384

	store, err := vector.NewMemoryStore(config)
	if err != nil {
		b.Fatal(err)
	}
	defer store.Close()

	ctx := context.Background()
	vec := make([]float32, 384)
	for i := range vec {
		vec[i] = float32(i) / 384.0
	}

	metadata := map[string]interface{}{
		"test": true,
		"index": 0,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		id := fmt.Sprintf("vec-%d", i)
		_ = store.Insert(ctx, id, vec, metadata)
	}
}

// BenchmarkMemoryStore_Search_1K measures search performance with 1K vectors
func BenchmarkMemoryStore_Search_1K(b *testing.B) {
	benchmarkSearch(b, 1000)
}

// BenchmarkMemoryStore_Search_10K measures search performance with 10K vectors
func BenchmarkMemoryStore_Search_10K(b *testing.B) {
	benchmarkSearch(b, 10000)
}

// BenchmarkMemoryStore_Search_100K measures search performance with 100K vectors
func BenchmarkMemoryStore_Search_100K(b *testing.B) {
	benchmarkSearch(b, 100000)
}

func benchmarkSearch(b *testing.B, numVectors int) {
	config := pkgvector.DefaultConfig()
	config.Dimension = 384

	store, err := vector.NewMemoryStore(config)
	if err != nil {
		b.Fatal(err)
	}
	defer store.Close()

	ctx := context.Background()

	// Pre-populate with vectors
	b.Logf("Pre-populating with %d vectors...", numVectors)
	for i := 0; i < numVectors; i++ {
		vec := make([]float32, 384)
		for j := range vec {
			vec[j] = float32(i*j) / float32(numVectors)
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
		if err != nil {
			b.Fatal(err)
		}
	}

	// Query vector
	query := make([]float32, 384)
	for i := range query {
		query[i] = float32(i) / 384.0
	}

	// Normalize query
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

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := store.Search(ctx, query, 10)
		if err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkMemoryStore_BatchInsert measures batch insert performance
func BenchmarkMemoryStore_BatchInsert(b *testing.B) {
	config := pkgvector.DefaultConfig()
	config.Dimension = 384

	store, err := vector.NewMemoryStore(config)
	if err != nil {
		b.Fatal(err)
	}
	defer store.Close()

	ctx := context.Background()

	// Create batch of 1000 vectors
	entries := make([]*pkgvector.VectorEntry, 1000)
	for i := range entries {
		vec := make([]float32, 384)
		for j := range vec {
			vec[j] = float32(i*j) / 1000.0
		}

		entries[i] = &pkgvector.VectorEntry{
			ID:     fmt.Sprintf("batch-vec-%d", i),
			Vector: vec,
			Metadata: map[string]interface{}{
				"batch": true,
				"index": i,
			},
		}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = store.BatchInsert(ctx, entries)
	}
}

// BenchmarkMemoryStore_ConcurrentSearch measures concurrent search performance
func BenchmarkMemoryStore_ConcurrentSearch(b *testing.B) {
	config := pkgvector.DefaultConfig()
	config.Dimension = 384

	store, err := vector.NewMemoryStore(config)
	if err != nil {
		b.Fatal(err)
	}
	defer store.Close()

	ctx := context.Background()

	// Pre-populate with 10K vectors
	b.Logf("Pre-populating with 10K vectors...")
	for i := 0; i < 10000; i++ {
		vec := make([]float32, 384)
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
		if err != nil {
			b.Fatal(err)
		}
	}

	query := make([]float32, 384)
	for i := range query {
		query[i] = float32(i) / 384.0
	}

	// Normalize query
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

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			_, err := store.Search(ctx, query, 10)
			if err != nil {
				b.Fatal(err)
			}
		}
	})
}

// BenchmarkMemoryStore_Get measures Get performance
func BenchmarkMemoryStore_Get(b *testing.B) {
	config := pkgvector.DefaultConfig()
	config.Dimension = 384

	store, err := vector.NewMemoryStore(config)
	if err != nil {
		b.Fatal(err)
	}
	defer store.Close()

	ctx := context.Background()

	// Insert test vector
	vec := make([]float32, 384)
	for i := range vec {
		vec[i] = float32(i) / 384.0
	}

	err = store.Insert(ctx, "test-vec", vec, map[string]interface{}{"test": true})
	if err != nil {
		b.Fatal(err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := store.Get(ctx, "test-vec")
		if err != nil {
			b.Fatal(err)
		}
	}
}
