package metrics_test

import (
	"context"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/metrics"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestE2E_ConcurrentLoadMetrics validates metrics under concurrent load
// Scenario: 10 goroutines × 100 checks/sec for 5 seconds (5000 total)
// Validates: Thread safety, counter accuracy, no dropped metrics, gauge correctness
func TestE2E_ConcurrentLoadMetrics(t *testing.T) {
	// Setup: Create engine with metrics
	m := metrics.NewPrometheusMetrics("authz_test")
	store := policy.NewMemoryStore()

	loadTestPolicies(t, store, 50)

	cfg := engine.Config{
		CacheEnabled:    true,
		CacheSize:       10000,
		ParallelWorkers: 8,
		Metrics:         m,
	}

	eng, err := engine.New(cfg, store)
	require.NoError(t, err)
	defer eng.Shutdown(context.Background())

	ctx := context.Background()

	// Execute: 10 goroutines × 500 requests each = 5000 total
	numGoroutines := 10
	requestsPerGoroutine := 500
	totalExpected := numGoroutines * requestsPerGoroutine

	var wg sync.WaitGroup
	var completedCount atomic.Int64
	var errorCount atomic.Int64

	startTime := time.Now()

	for g := 0; g < numGoroutines; g++ {
		wg.Add(1)
		go func(goroutineID int) {
			defer wg.Done()

			for i := 0; i < requestsPerGoroutine; i++ {
				req := &types.CheckRequest{
					Principal: &types.Principal{
						ID:    "user:" + itoa(goroutineID) + "-" + itoa(i),
						Roles: []string{"viewer"},
					},
					Resource: &types.Resource{
						Kind: "document",
						ID:   "doc-" + itoa(i%100), // Reuse docs for cache hits
					},
					Actions: []string{"read"},
				}

				resp, err := eng.Check(ctx, req)
				if err != nil {
					errorCount.Add(1)
					continue
				}

				if resp != nil {
					completedCount.Add(1)
				}
			}
		}(g)
	}

	wg.Wait()
	duration := time.Since(startTime)

	// Verify: All requests completed
	completed := completedCount.Load()
	errors := errorCount.Load()

	assert.Equal(t, int64(totalExpected), completed,
		"All %d requests should complete successfully", totalExpected)
	assert.Equal(t, int64(0), errors, "Should have zero errors")

	t.Logf("Completed %d requests in %v (%.0f req/sec)",
		completed, duration, float64(completed)/duration.Seconds())

	// Verify metrics accuracy
	handler := m.HTTPHandler()
	httpReq := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httpReq)

	body := w.Body.String()

	// Verify total checks
	totalChecks := extractMetricValue(body, "authz_test_check_duration_microseconds_count")
	assert.GreaterOrEqual(t, totalChecks, float64(totalExpected),
		"Should record all %d checks", totalExpected)

	// Verify active requests returned to 0
	activeRequests := extractMetricValue(body, "authz_test_active_requests")
	assert.Equal(t, 0.0, activeRequests, "Active requests should return to 0")

	// Verify cache metrics are consistent
	hits := extractMetricValue(body, "authz_test_cache_hits_total")
	misses := extractMetricValue(body, "authz_test_cache_misses_total")
	totalCacheOps := hits + misses

	assert.InDelta(t, float64(totalExpected), totalCacheOps, float64(totalExpected)*0.01,
		"Cache operations should match total checks (within 1%%)")

	// Verify no race conditions in metrics collection
	assert.NotContains(t, body, "NaN", "Should not have NaN values (indicates race condition)")
}

// TestE2E_ConcurrentActiveRequestsGauge validates active requests gauge accuracy
func TestE2E_ConcurrentActiveRequestsGauge(t *testing.T) {
	m := metrics.NewPrometheusMetrics("authz_test")
	store := policy.NewMemoryStore()
	loadTestPolicies(t, store, 10)

	cfg := engine.Config{
		CacheEnabled:    false, // Disable cache to slow down requests
		ParallelWorkers: 4,
		Metrics:         m,
	}

	eng, err := engine.New(cfg, store)
	require.NoError(t, err)
	defer eng.Shutdown(context.Background())

	ctx := context.Background()

	// Launch goroutines that hold requests open briefly
	numConcurrent := 20
	var wg sync.WaitGroup
	var maxObservedActive atomic.Int64

	startBarrier := make(chan struct{})

	for i := 0; i < numConcurrent; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			<-startBarrier // Wait for all goroutines to be ready

			req := &types.CheckRequest{
				Principal: &types.Principal{
					ID:    "user:concurrent",
					Roles: []string{"viewer"},
				},
				Resource: &types.Resource{
					Kind: "document",
					ID:   "doc-1",
				},
				Actions: []string{"read"},
			}

			_, _ = eng.Check(ctx, req)
		}()
	}

	// Monitor active requests during execution
	monitorDone := make(chan struct{})
	go func() {
		defer close(monitorDone)

		ticker := time.NewTicker(10 * time.Millisecond)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				handler := m.HTTPHandler()
				httpReq := httptest.NewRequest("GET", "/metrics", nil)
				w := httptest.NewRecorder()
				handler.ServeHTTP(w, httpReq)

				body := w.Body.String()
				active := int64(extractMetricValue(body, "authz_test_active_requests"))

				current := maxObservedActive.Load()
				if active > current {
					maxObservedActive.Store(active)
				}
			case <-ctx.Done():
				return
			}

			// Check if all goroutines completed
			select {
			case <-monitorDone:
				return
			default:
			}
		}
	}()

	// Start all goroutines simultaneously
	close(startBarrier)

	// Wait for all to complete
	wg.Wait()
	time.Sleep(100 * time.Millisecond) // Let monitor catch final state

	// Stop monitoring
	close(monitorDone)

	// Verify final state
	handler := m.HTTPHandler()
	httpReq := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httpReq)

	body := w.Body.String()
	finalActive := extractMetricValue(body, "authz_test_active_requests")

	assert.Equal(t, 0.0, finalActive, "Active requests should be 0 after completion")

	maxActive := maxObservedActive.Load()
	t.Logf("Max observed active requests: %d", maxActive)
	assert.Greater(t, maxActive, int64(0), "Should have observed active requests during execution")
}

// TestE2E_ConcurrentMetricsRaceDetection validates no race conditions
// Run with: go test -race
func TestE2E_ConcurrentMetricsRaceDetection(t *testing.T) {
	m := metrics.NewPrometheusMetrics("authz_test")

	// Hammer all metric methods concurrently
	var wg sync.WaitGroup
	iterations := 100
	goroutines := 10

	for g := 0; g < goroutines; g++ {
		// Authorization metrics
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < iterations; i++ {
				m.RecordCheck("allow", 5*time.Microsecond)
				m.RecordCacheHit()
				m.RecordCacheMiss()
				m.RecordAuthError("test_error")
				m.IncActiveRequests()
				m.DecActiveRequests()
			}
		}()

		// Embedding metrics
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < iterations; i++ {
				m.RecordEmbeddingJob("success", 50*time.Millisecond)
				m.RecordCacheOperation("hit")
				m.UpdateQueueDepth(i)
				m.UpdateActiveWorkers(i % 10)
				m.UpdateCacheEntries(i * 2)
			}
		}()

		// Vector metrics
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < iterations; i++ {
				m.RecordVectorOp("search", 10*time.Millisecond)
				m.RecordVectorOp("insert", 15*time.Millisecond)
				m.RecordVectorError("timeout")
				m.UpdateVectorStoreSize(i * 10)
				m.UpdateIndexSize(int64(i * 1024))
			}
		}()

		// HTTP handler access
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < iterations; i++ {
				handler := m.HTTPHandler()
				req := httptest.NewRequest("GET", "/metrics", nil)
				w := httptest.NewRecorder()
				handler.ServeHTTP(w, req)
			}
		}()
	}

	wg.Wait()

	// Verify metrics are still accessible and valid
	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()

	assert.Contains(t, body, "authz_test_checks_total")
	assert.Contains(t, body, "authz_test_embedding_jobs_total")
	assert.Contains(t, body, "authz_test_vector_operations_total")
	assert.NotContains(t, body, "NaN")
	assert.NotContains(t, body, "Inf")
}

// TestE2E_ConcurrentBurstLoad validates metrics under burst traffic
func TestE2E_ConcurrentBurstLoad(t *testing.T) {
	m := metrics.NewPrometheusMetrics("authz_test")
	store := policy.NewMemoryStore()
	loadTestPolicies(t, store, 20)

	cfg := engine.Config{
		CacheEnabled:    true,
		CacheSize:       5000,
		ParallelWorkers: 8,
		Metrics:         m,
	}

	eng, err := engine.New(cfg, store)
	require.NoError(t, err)
	defer eng.Shutdown(context.Background())

	ctx := context.Background()

	// Simulate burst: 50 goroutines × 100 requests in quick succession
	numGoroutines := 50
	requestsPerGoroutine := 100

	var wg sync.WaitGroup
	burstStart := make(chan struct{})

	for g := 0; g < numGoroutines; g++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()

			<-burstStart // Synchronized start

			for i := 0; i < requestsPerGoroutine; i++ {
				req := &types.CheckRequest{
					Principal: &types.Principal{
						ID:    "burst-user:" + itoa(id),
						Roles: []string{"viewer"},
					},
					Resource: &types.Resource{
						Kind: "document",
						ID:   "doc-" + itoa(i%10),
					},
					Actions: []string{"read"},
				}

				_, _ = eng.Check(ctx, req)
			}
		}(g)
	}

	// Trigger burst
	close(burstStart)
	startTime := time.Now()

	wg.Wait()
	duration := time.Since(startTime)

	totalRequests := numGoroutines * requestsPerGoroutine
	t.Logf("Burst load: %d requests in %v (%.0f req/sec)",
		totalRequests, duration, float64(totalRequests)/duration.Seconds())

	// Verify metrics integrity after burst
	handler := m.HTTPHandler()
	httpReq := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httpReq)

	body := w.Body.String()

	// All metrics should be present and valid
	assert.Contains(t, body, "authz_test_checks_total")
	assert.Contains(t, body, "authz_test_cache_hits_total")
	assert.Contains(t, body, "authz_test_active_requests 0")

	// Verify no counter rollover or corruption
	totalChecks := extractMetricValue(body, "authz_test_check_duration_microseconds_count")
	assert.InDelta(t, float64(totalRequests), totalChecks, float64(totalRequests)*0.02,
		"Check count should match total requests (within 2%%)")
}
