package vector

import (
	"context"
	"fmt"
	"math/rand"
	"runtime"
	"testing"
	"time"

	"github.com/authz-engine/go-core/pkg/vector"
	"github.com/stretchr/testify/require"
)

// BenchmarkHNSWAdapter_Insert measures insert throughput
// Target: >97K ops/sec (>97,000 inserts per second)
func BenchmarkHNSWAdapter_Insert(b *testing.B) {
	tests := []struct {
		name      string
		dimension int
		count     int
	}{
		{"Dim128_10K", 128, 10000},
		{"Dim384_10K", 384, 10000},
		{"Dim128_100K", 128, 100000},
		{"Dim384_100K", 384, 100000},
	}

	for _, tt := range tests {
		b.Run(tt.name, func(b *testing.B) {
			adapter, err := NewHNSWAdapter(tt.dimension, vector.HNSWConfig{
				M:              16,
				EfConstruction: 200,
				EfSearch:       50,
			})
			require.NoError(b, err)
			defer adapter.Close()

			ctx := context.Background()

			// Pre-generate vectors for benchmark
			vectors := make([][]float32, tt.count)
			for i := 0; i < tt.count; i++ {
				vectors[i] = generateRandomVector(tt.dimension, i)
			}

			b.ResetTimer()
			b.ReportAllocs()

			start := time.Now()
			for i := 0; i < b.N; i++ {
				idx := i % tt.count
				err := adapter.Insert(ctx, fmt.Sprintf("vec-%d", i), vectors[idx], map[string]interface{}{
					"index": i,
				})
				if err != nil {
					b.Fatal(err)
				}
			}
			elapsed := time.Since(start)

			opsPerSec := float64(b.N) / elapsed.Seconds()
			b.ReportMetric(opsPerSec, "ops/sec")
			b.ReportMetric(elapsed.Seconds()/float64(b.N)*1e6, "µs/op")

			// Log throughput for Week 1-2 validation
			if !testing.Short() {
				b.Logf("Insert throughput: %.2f ops/sec (target: >97K)", opsPerSec)
			}
		})
	}
}

// BenchmarkHNSWAdapter_Search measures search latency
// Target: <0.5ms p50, <2ms p99 (100K vectors)
func BenchmarkHNSWAdapter_Search(b *testing.B) {
	tests := []struct {
		name      string
		dimension int
		dataSize  int
		k         int
	}{
		{"Dim128_10K_K10", 128, 10000, 10},
		{"Dim384_10K_K10", 384, 10000, 10},
		{"Dim128_100K_K10", 128, 100000, 10},
		{"Dim384_100K_K10", 384, 100000, 10},
		{"Dim128_100K_K50", 128, 100000, 50},
	}

	for _, tt := range tests {
		b.Run(tt.name, func(b *testing.B) {
			adapter, err := NewHNSWAdapter(tt.dimension, vector.HNSWConfig{
				M:              16,
				EfConstruction: 200,
				EfSearch:       50,
			})
			require.NoError(b, err)
			defer adapter.Close()

			ctx := context.Background()

			// Insert test data
			for i := 0; i < tt.dataSize; i++ {
				vec := generateRandomVector(tt.dimension, i)
				err := adapter.Insert(ctx, fmt.Sprintf("vec-%d", i), vec, map[string]interface{}{"index": i})
				require.NoError(b, err)
			}

			// Pre-generate query vectors
			queries := make([][]float32, 100)
			for i := 0; i < 100; i++ {
				queries[i] = generateRandomVector(tt.dimension, i+tt.dataSize)
			}

			b.ResetTimer()
			b.ReportAllocs()

			latencies := make([]time.Duration, 0, b.N)
			for i := 0; i < b.N; i++ {
				query := queries[i%100]
				start := time.Now()
				_, err := adapter.Search(ctx, query, tt.k)
				elapsed := time.Since(start)
				latencies = append(latencies, elapsed)

				if err != nil {
					b.Fatal(err)
				}
			}

			// Calculate percentiles
			p50, p95, p99 := calculatePercentiles(latencies)
			b.ReportMetric(p50.Seconds()*1000, "p50_ms")
			b.ReportMetric(p95.Seconds()*1000, "p95_ms")
			b.ReportMetric(p99.Seconds()*1000, "p99_ms")

			// Log for Week 1-2 validation
			if !testing.Short() {
				b.Logf("Search latency: p50=%.2fms, p95=%.2fms, p99=%.2fms (target: <0.5ms p50, <2ms p99)",
					p50.Seconds()*1000, p95.Seconds()*1000, p99.Seconds()*1000)
			}
		})
	}
}

// BenchmarkHNSWAdapter_MemoryUsage measures memory consumption
// Target: <800MB per 1M vectors (dim=384)
func BenchmarkHNSWAdapter_MemoryUsage(b *testing.B) {
	if testing.Short() {
		b.Skip("Skipping memory benchmark in short mode")
	}

	tests := []struct {
		name      string
		dimension int
		count     int
	}{
		{"Dim128_100K", 128, 100000},
		{"Dim384_100K", 384, 100000},
		{"Dim128_1M", 128, 1000000},
		{"Dim384_1M", 384, 1000000},
	}

	for _, tt := range tests {
		b.Run(tt.name, func(b *testing.B) {
			// Force GC before measurement
			runtime.GC()
			var m1 runtime.MemStats
			runtime.ReadMemStats(&m1)

			adapter, err := NewHNSWAdapter(tt.dimension, vector.HNSWConfig{
				M:              16,
				EfConstruction: 200,
				EfSearch:       50,
			})
			require.NoError(b, err)
			defer adapter.Close()

			ctx := context.Background()

			// Insert vectors
			b.Logf("Inserting %d vectors of dimension %d...", tt.count, tt.dimension)
			for i := 0; i < tt.count; i++ {
				vec := generateRandomVector(tt.dimension, i)
				err := adapter.Insert(ctx, fmt.Sprintf("vec-%d", i), vec, map[string]interface{}{"index": i})
				require.NoError(b, err)

				if i%10000 == 0 && i > 0 {
					b.Logf("Inserted %d vectors", i)
				}
			}

			// Force GC and measure memory
			runtime.GC()
			var m2 runtime.MemStats
			runtime.ReadMemStats(&m2)

			// Get stats from adapter
			stats, err := adapter.Stats(ctx)
			require.NoError(b, err)

			allocatedMB := float64(m2.Alloc-m1.Alloc) / (1024 * 1024)
			heapMB := float64(m2.HeapAlloc-m1.HeapAlloc) / (1024 * 1024)
			statsMB := float64(stats.MemoryUsageBytes) / (1024 * 1024)

			b.ReportMetric(allocatedMB, "allocated_MB")
			b.ReportMetric(heapMB, "heap_MB")
			b.ReportMetric(statsMB, "stats_MB")
			b.ReportMetric(allocatedMB/float64(tt.count)*1e6, "bytes_per_vector")

			// Log for Week 1-2 validation
			b.Logf("Memory usage for %d vectors (dim=%d):", tt.count, tt.dimension)
			b.Logf("  Allocated: %.2f MB", allocatedMB)
			b.Logf("  Heap:      %.2f MB", heapMB)
			b.Logf("  Stats:     %.2f MB", statsMB)
			b.Logf("  Per Vector: %.2f bytes", allocatedMB/float64(tt.count)*1e6)

			if tt.count == 1000000 {
				b.Logf("TARGET CHECK: %.2f MB for 1M vectors (target: <800MB)", allocatedMB)
			}
		})
	}
}

// BenchmarkHNSWAdapter_ConcurrentInsert measures thread-safety and concurrent throughput
func BenchmarkHNSWAdapter_ConcurrentInsert(b *testing.B) {
	workers := []int{1, 2, 4, 8}

	for _, w := range workers {
		b.Run(fmt.Sprintf("Workers%d", w), func(b *testing.B) {
			adapter, err := NewHNSWAdapter(128, vector.HNSWConfig{
				M:              16,
				EfConstruction: 200,
				EfSearch:       50,
			})
			require.NoError(b, err)
			defer adapter.Close()

			b.ResetTimer()
			b.SetParallelism(w)
			b.RunParallel(func(pb *testing.PB) {
				ctx := context.Background()
				i := 0
				for pb.Next() {
					vec := generateRandomVector(128, i)
					err := adapter.Insert(ctx, fmt.Sprintf("vec-%d-%d", w, i), vec, nil)
					if err != nil {
						b.Error(err)
					}
					i++
				}
			})
		})
	}
}

// BenchmarkHNSWAdapter_ConcurrentSearch measures concurrent read throughput
func BenchmarkHNSWAdapter_ConcurrentSearch(b *testing.B) {
	workers := []int{1, 2, 4, 8}

	for _, w := range workers {
		b.Run(fmt.Sprintf("Workers%d", w), func(b *testing.B) {
			adapter, err := NewHNSWAdapter(128, vector.HNSWConfig{
				M:              16,
				EfConstruction: 200,
				EfSearch:       50,
			})
			require.NoError(b, err)
			defer adapter.Close()

			ctx := context.Background()

			// Insert 10K vectors
			for i := 0; i < 10000; i++ {
				vec := generateRandomVector(128, i)
				err := adapter.Insert(ctx, fmt.Sprintf("vec-%d", i), vec, nil)
				require.NoError(b, err)
			}

			b.ResetTimer()
			b.SetParallelism(w)
			b.RunParallel(func(pb *testing.PB) {
				ctx := context.Background()
				i := 0
				for pb.Next() {
					query := generateRandomVector(128, i+10000)
					_, err := adapter.Search(ctx, query, 10)
					if err != nil {
						b.Error(err)
					}
					i++
				}
			})
		})
	}
}

// BenchmarkHNSWAdapter_BatchInsert measures batch insert performance
func BenchmarkHNSWAdapter_BatchInsert(b *testing.B) {
	batchSizes := []int{10, 50, 100, 500}

	for _, size := range batchSizes {
		b.Run(fmt.Sprintf("Batch%d", size), func(b *testing.B) {
			adapter, err := NewHNSWAdapter(128, vector.HNSWConfig{
				M:              16,
				EfConstruction: 200,
				EfSearch:       50,
			})
			require.NoError(b, err)
			defer adapter.Close()

			ctx := context.Background()

			// Pre-generate batches
			batches := make([][]*vector.VectorEntry, b.N)
			for i := 0; i < b.N; i++ {
				batch := make([]*vector.VectorEntry, size)
				for j := 0; j < size; j++ {
					batch[j] = &vector.VectorEntry{
						ID:       fmt.Sprintf("vec-%d-%d", i, j),
						Vector:   generateRandomVector(128, i*size+j),
						Metadata: map[string]interface{}{"batch": i, "idx": j},
					}
				}
				batches[i] = batch
			}

			b.ResetTimer()
			b.ReportAllocs()

			for i := 0; i < b.N; i++ {
				err := adapter.BatchInsert(ctx, batches[i])
				if err != nil {
					b.Fatal(err)
				}
			}

			b.ReportMetric(float64(size*b.N)/b.Elapsed().Seconds(), "vectors/sec")
		})
	}
}

// Helper: Generate random normalized vector for benchmarking
func generateRandomVector(dim, seed int) []float32 {
	rng := rand.New(rand.NewSource(int64(seed)))
	vec := make([]float32, dim)

	// Generate random values
	var norm float32
	for i := 0; i < dim; i++ {
		vec[i] = rng.Float32()*2 - 1 // Range [-1, 1]
		norm += vec[i] * vec[i]
	}

	// Normalize to unit length
	if norm > 0 {
		norm = float32(1.0 / (norm + 0.00001))
		for i := 0; i < dim; i++ {
			vec[i] *= norm
		}
	}

	return vec
}

// Helper: Calculate percentiles from latency measurements
func calculatePercentiles(latencies []time.Duration) (p50, p95, p99 time.Duration) {
	if len(latencies) == 0 {
		return 0, 0, 0
	}

	// Simple sorting for percentile calculation
	sorted := make([]time.Duration, len(latencies))
	copy(sorted, latencies)

	// Bubble sort (good enough for benchmark data)
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[i] > sorted[j] {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}

	p50 = sorted[len(sorted)*50/100]
	p95 = sorted[len(sorted)*95/100]
	p99 = sorted[len(sorted)*99/100]

	return p50, p95, p99
}
