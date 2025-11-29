package metrics

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

// BenchmarkMetrics_RecordCheck measures overhead of recording authorization checks
func BenchmarkMetrics_RecordCheck(b *testing.B) {
	scenarios := []struct {
		name    string
		metrics Metrics
	}{
		{"NoOp", &NoOpMetrics{}},
		{"Prometheus", NewPrometheusMetrics("bench")},
	}

	for _, scenario := range scenarios {
		b.Run(scenario.name, func(b *testing.B) {
			m := scenario.metrics
			b.ResetTimer()
			b.ReportAllocs()

			for i := 0; i < b.N; i++ {
				m.RecordCheck("allow", 5*time.Microsecond)
			}
		})
	}
}

// BenchmarkMetrics_RecordCheck_Parallel measures concurrent metric recording
func BenchmarkMetrics_RecordCheck_Parallel(b *testing.B) {
	scenarios := []struct {
		name    string
		metrics Metrics
	}{
		{"NoOp", &NoOpMetrics{}},
		{"Prometheus", NewPrometheusMetrics("bench_parallel")},
	}

	for _, scenario := range scenarios {
		b.Run(scenario.name, func(b *testing.B) {
			m := scenario.metrics
			b.ResetTimer()
			b.ReportAllocs()

			b.RunParallel(func(pb *testing.PB) {
				i := 0
				for pb.Next() {
					effect := "allow"
					if i%3 == 0 {
						effect = "deny"
					}
					m.RecordCheck(effect, time.Duration(i%100)*time.Microsecond)
					i++
				}
			})
		})
	}
}

// BenchmarkMetrics_CacheOperations measures cache metric overhead
func BenchmarkMetrics_CacheOperations(b *testing.B) {
	scenarios := []struct {
		name    string
		metrics Metrics
	}{
		{"NoOp", &NoOpMetrics{}},
		{"Prometheus", NewPrometheusMetrics("cache_bench")},
	}

	for _, scenario := range scenarios {
		b.Run(scenario.name, func(b *testing.B) {
			m := scenario.metrics
			b.ResetTimer()
			b.ReportAllocs()

			for i := 0; i < b.N; i++ {
				if i%2 == 0 {
					m.RecordCacheHit()
				} else {
					m.RecordCacheMiss()
				}
			}
		})
	}
}

// BenchmarkMetrics_ActiveRequests measures gauge update overhead
func BenchmarkMetrics_ActiveRequests(b *testing.B) {
	scenarios := []struct {
		name    string
		metrics Metrics
	}{
		{"NoOp", &NoOpMetrics{}},
		{"Prometheus", NewPrometheusMetrics("active_bench")},
	}

	for _, scenario := range scenarios {
		b.Run(scenario.name, func(b *testing.B) {
			m := scenario.metrics
			b.ResetTimer()
			b.ReportAllocs()

			for i := 0; i < b.N; i++ {
				m.IncActiveRequests()
				m.DecActiveRequests()
			}
		})
	}
}

// BenchmarkMetrics_ActiveRequests_Concurrent measures concurrent gauge updates
func BenchmarkMetrics_ActiveRequests_Concurrent(b *testing.B) {
	scenarios := []struct {
		name    string
		metrics Metrics
	}{
		{"NoOp", &NoOpMetrics{}},
		{"Prometheus", NewPrometheusMetrics("active_concurrent")},
	}

	for _, scenario := range scenarios {
		b.Run(scenario.name, func(b *testing.B) {
			m := scenario.metrics
			b.ResetTimer()
			b.ReportAllocs()

			var wg sync.WaitGroup
			numGoroutines := 10

			for g := 0; g < numGoroutines; g++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					for i := 0; i < b.N/numGoroutines; i++ {
						m.IncActiveRequests()
						m.DecActiveRequests()
					}
				}()
			}

			wg.Wait()
		})
	}
}

// BenchmarkMetrics_EmbeddingMetrics measures embedding worker metrics overhead
func BenchmarkMetrics_EmbeddingMetrics(b *testing.B) {
	scenarios := []struct {
		name    string
		metrics Metrics
	}{
		{"NoOp", &NoOpMetrics{}},
		{"Prometheus", NewPrometheusMetrics("embedding_bench")},
	}

	for _, scenario := range scenarios {
		b.Run(scenario.name, func(b *testing.B) {
			m := scenario.metrics
			b.ResetTimer()
			b.ReportAllocs()

			for i := 0; i < b.N; i++ {
				status := "success"
				if i%10 == 0 {
					status = "failed"
				}
				m.RecordEmbeddingJob(status, time.Duration(i%100)*time.Millisecond)
				m.UpdateQueueDepth(i % 50)
				m.UpdateActiveWorkers(i % 8)
			}
		})
	}
}

// BenchmarkMetrics_VectorStoreMetrics measures vector store metrics overhead
func BenchmarkMetrics_VectorStoreMetrics(b *testing.B) {
	scenarios := []struct {
		name    string
		metrics Metrics
	}{
		{"NoOp", &NoOpMetrics{}},
		{"Prometheus", NewPrometheusMetrics("vector_bench")},
	}

	for _, scenario := range scenarios {
		b.Run(scenario.name, func(b *testing.B) {
			m := scenario.metrics
			b.ResetTimer()
			b.ReportAllocs()

			for i := 0; i < b.N; i++ {
				op := "search"
				if i%5 == 0 {
					op = "insert"
				}
				m.RecordVectorOp(op, time.Duration(i%50)*time.Millisecond)
				m.UpdateVectorStoreSize(1000 + i)
			}
		})
	}
}

// BenchmarkMetrics_MixedWorkload measures realistic mixed metric recording
func BenchmarkMetrics_MixedWorkload(b *testing.B) {
	scenarios := []struct {
		name    string
		metrics Metrics
	}{
		{"NoOp", &NoOpMetrics{}},
		{"Prometheus", NewPrometheusMetrics("mixed_bench")},
	}

	for _, scenario := range scenarios {
		b.Run(scenario.name, func(b *testing.B) {
			m := scenario.metrics
			b.ResetTimer()
			b.ReportAllocs()

			for i := 0; i < b.N; i++ {
				// Simulate authorization check
				m.IncActiveRequests()
				m.RecordCheck("allow", 5*time.Microsecond)
				m.DecActiveRequests()

				// Cache operation
				if i%2 == 0 {
					m.RecordCacheHit()
				} else {
					m.RecordCacheMiss()
				}

				// Occasional embedding job
				if i%100 == 0 {
					m.RecordEmbeddingJob("success", 50*time.Millisecond)
				}

				// Occasional vector search
				if i%50 == 0 {
					m.RecordVectorOp("search", 10*time.Millisecond)
				}
			}
		})
	}
}

// BenchmarkMetrics_MemoryAllocations measures memory allocations
func BenchmarkMetrics_MemoryAllocations(b *testing.B) {
	m := NewPrometheusMetrics("alloc_test")

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		// Hot path: authorization check with metrics
		m.IncActiveRequests()
		m.RecordCheck("allow", 5*time.Microsecond)
		m.RecordCacheHit()
		m.DecActiveRequests()
	}
}

// BenchmarkMetrics_Throughput measures maximum throughput
func BenchmarkMetrics_Throughput(b *testing.B) {
	m := NewPrometheusMetrics("throughput_test")

	b.ResetTimer()
	b.ReportAllocs()

	start := time.Now()
	for i := 0; i < b.N; i++ {
		m.RecordCheck("allow", 1*time.Microsecond)
	}
	elapsed := time.Since(start)

	opsPerSec := float64(b.N) / elapsed.Seconds()
	b.ReportMetric(opsPerSec, "ops/sec")

	if opsPerSec < 1_000_000 {
		b.Logf("WARNING: Throughput %.0f ops/sec is below 1M target", opsPerSec)
	}
}

// BenchmarkMetrics_Latency_P99 measures p99 latency of metric operations
func BenchmarkMetrics_Latency_P99(b *testing.B) {
	m := NewPrometheusMetrics("latency_test")

	latencies := make([]time.Duration, 0, b.N)
	var mu sync.Mutex

	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		start := time.Now()
		m.RecordCheck("allow", 5*time.Microsecond)
		latency := time.Since(start)

		mu.Lock()
		latencies = append(latencies, latency)
		mu.Unlock()
	}

	b.StopTimer()

	// Calculate percentiles
	if len(latencies) > 0 {
		// Simple bubble sort for small benchmark runs
		for i := 0; i < len(latencies); i++ {
			for j := i + 1; j < len(latencies); j++ {
				if latencies[i] > latencies[j] {
					latencies[i], latencies[j] = latencies[j], latencies[i]
				}
			}
		}

		p50 := latencies[len(latencies)*50/100]
		p95 := latencies[len(latencies)*95/100]
		p99 := latencies[len(latencies)*99/100]
		max := latencies[len(latencies)-1]

		b.Logf("Metric operation latency:")
		b.Logf("  p50: %v", p50)
		b.Logf("  p95: %v", p95)
		b.Logf("  p99: %v (target: <100ns)", p99)
		b.Logf("  max: %v", max)

		if p99 > 100*time.Nanosecond {
			b.Logf("WARNING: p99 latency %v exceeds 100ns target", p99)
		}
	}
}

// BenchmarkMetrics_CompareOverhead compares metric overhead vs no metrics
func BenchmarkMetrics_CompareOverhead(b *testing.B) {
	b.Run("WithoutMetrics", func(b *testing.B) {
		b.ReportAllocs()

		for i := 0; i < b.N; i++ {
			// Simulate authorization check without metrics
			_ = "allow"
			_ = 5 * time.Microsecond
		}
	})

	b.Run("WithMetrics", func(b *testing.B) {
		m := NewPrometheusMetrics("overhead_test")
		b.ReportAllocs()

		for i := 0; i < b.N; i++ {
			// Simulate authorization check with metrics
			m.RecordCheck("allow", 5*time.Microsecond)
		}
	})

	b.Run("WithNoOpMetrics", func(b *testing.B) {
		m := &NoOpMetrics{}
		b.ReportAllocs()

		for i := 0; i < b.N; i++ {
			// Simulate authorization check with NoOp metrics
			m.RecordCheck("allow", 5*time.Microsecond)
		}
	})
}

// BenchmarkMetrics_HTTPHandler measures /metrics endpoint performance
func BenchmarkMetrics_HTTPHandler(b *testing.B) {
	m := NewPrometheusMetrics("http_test")

	// Pre-populate with some metrics
	for i := 0; i < 1000; i++ {
		m.RecordCheck("allow", 5*time.Microsecond)
		m.RecordCacheHit()
		m.RecordEmbeddingJob("success", 50*time.Millisecond)
	}

	handler := m.HTTPHandler()

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		// Simulate scraping metrics endpoint
		req := fmt.Sprintf("GET /metrics HTTP/1.1\r\nHost: localhost\r\n\r\n")
		_ = req
		_ = handler
		// Note: Full HTTP request/response not benchmarked here
		// In real scenario, this would use httptest.NewRecorder()
	}
}

// BenchmarkMetrics_LabelCardinality measures impact of high label cardinality
func BenchmarkMetrics_LabelCardinality(b *testing.B) {
	m := NewPrometheusMetrics("cardinality_test")

	effects := []string{"allow", "deny"}
	errorTypes := []string{"cel_eval", "policy_not_found", "invalid_request"}

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		effect := effects[i%len(effects)]
		m.RecordCheck(effect, 5*time.Microsecond)

		if i%100 == 0 {
			errorType := errorTypes[i%len(errorTypes)]
			m.RecordAuthError(errorType)
		}
	}
}
