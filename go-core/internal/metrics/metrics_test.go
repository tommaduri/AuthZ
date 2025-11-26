package metrics

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestMetricsInterface_AllMethodsExist verifies the Metrics interface contract
func TestMetricsInterface_AllMethodsExist(t *testing.T) {
	tests := []struct {
		name   string
		metric Metrics
	}{
		{
			name:   "PrometheusMetrics implements all methods",
			metric: NewPrometheusMetrics("authz_test"),
		},
		{
			name:   "NoOpMetrics implements all methods",
			metric: &NoOpMetrics{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Authorization metrics
			tt.metric.RecordCheck("allow", 100*time.Microsecond)
			tt.metric.RecordCacheHit()
			tt.metric.RecordCacheMiss()
			tt.metric.RecordAuthError("cel_eval")
			tt.metric.IncActiveRequests()
			tt.metric.DecActiveRequests()

			// Embedding metrics
			tt.metric.RecordEmbeddingJob("success", 50*time.Millisecond)
			tt.metric.RecordCacheOperation("hit")
			tt.metric.UpdateQueueDepth(10)
			tt.metric.UpdateActiveWorkers(5)
			tt.metric.UpdateCacheEntries(100)

			// Vector store metrics
			tt.metric.RecordVectorOp("search", 25*time.Millisecond)
			tt.metric.RecordVectorError("timeout")
			tt.metric.UpdateVectorStoreSize(1000)
			tt.metric.UpdateIndexSize(1024 * 1024)

			// HTTP handler
			handler := tt.metric.HTTPHandler()
			require.NotNil(t, handler)
		})
	}
}

// TestNoOpMetrics_NoPanics ensures NoOp metrics never crash
func TestNoOpMetrics_NoPanics(t *testing.T) {
	m := &NoOpMetrics{}

	// Run all methods concurrently to ensure thread safety
	var wg sync.WaitGroup
	iterations := 100

	for i := 0; i < iterations; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			m.RecordCheck("allow", 1*time.Microsecond)
			m.RecordCacheHit()
			m.RecordCacheMiss()
			m.RecordAuthError("test")
			m.IncActiveRequests()
			m.DecActiveRequests()
			m.RecordEmbeddingJob("success", 1*time.Millisecond)
			m.RecordCacheOperation("hit")
			m.UpdateQueueDepth(0)
			m.UpdateActiveWorkers(0)
			m.UpdateCacheEntries(0)
			m.RecordVectorOp("search", 1*time.Millisecond)
			m.RecordVectorError("test")
			m.UpdateVectorStoreSize(0)
			m.UpdateIndexSize(0)
			_ = m.HTTPHandler()
		}()
	}

	wg.Wait()
	// If we reach here without panic, test passes
}

// TestNoOpMetrics_HTTPHandler verifies NoOp handler returns valid response
func TestNoOpMetrics_HTTPHandler(t *testing.T) {
	m := &NoOpMetrics{}
	handler := m.HTTPHandler()

	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	// NoOp should return empty or minimal response
}

// TestPrometheusMetrics_RecordCheck verifies authorization check metrics
func TestPrometheusMetrics_RecordCheck(t *testing.T) {
	tests := []struct {
		name     string
		checks   []struct{ effect string; duration time.Duration }
		expected map[string]int
	}{
		{
			name: "Single allow check",
			checks: []struct{ effect string; duration time.Duration }{
				{effect: "allow", duration: 5 * time.Microsecond},
			},
			expected: map[string]int{"allow": 1, "deny": 0},
		},
		{
			name: "Multiple mixed checks",
			checks: []struct{ effect string; duration time.Duration }{
				{effect: "allow", duration: 5 * time.Microsecond},
				{effect: "allow", duration: 10 * time.Microsecond},
				{effect: "deny", duration: 3 * time.Microsecond},
				{effect: "allow", duration: 7 * time.Microsecond},
			},
			expected: map[string]int{"allow": 3, "deny": 1},
		},
		{
			name: "100 allow checks",
			checks: func() []struct{ effect string; duration time.Duration } {
				checks := make([]struct{ effect string; duration time.Duration }, 100)
				for i := 0; i < 100; i++ {
					checks[i] = struct{ effect string; duration time.Duration }{
						effect:   "allow",
						duration: 5 * time.Microsecond,
					}
				}
				return checks
			}(),
			expected: map[string]int{"allow": 100, "deny": 0},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := NewPrometheusMetrics("authz_test")

			// Record all checks
			for _, check := range tt.checks {
				m.RecordCheck(check.effect, check.duration)
			}

			// Verify via HTTP endpoint
			handler := m.HTTPHandler()
			req := httptest.NewRequest("GET", "/metrics", nil)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)

			body := w.Body.String()

			// Verify counter metrics
			for effect, count := range tt.expected {
				if count > 0 {
					expectedLine := "authz_test_checks_total{effect=\"" + effect + "\"} " + itoa(count)
					assert.Contains(t, body, expectedLine,
						"Expected metric line: %s", expectedLine)
				}
			}

			// Verify histogram metrics exist
			assert.Contains(t, body, "authz_test_check_duration_microseconds")
			assert.Contains(t, body, "_bucket{")
			assert.Contains(t, body, "_sum")
			assert.Contains(t, body, "_count")
		})
	}
}

// TestPrometheusMetrics_CacheMetrics verifies cache hit/miss tracking
func TestPrometheusMetrics_CacheMetrics(t *testing.T) {
	tests := []struct {
		name   string
		hits   int
		misses int
	}{
		{name: "Only hits", hits: 10, misses: 0},
		{name: "Only misses", hits: 0, misses: 10},
		{name: "Mixed hits and misses", hits: 75, misses: 25},
		{name: "High cache hit rate", hits: 950, misses: 50},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := NewPrometheusMetrics("authz_test")

			// Record cache operations
			for i := 0; i < tt.hits; i++ {
				m.RecordCacheHit()
			}
			for i := 0; i < tt.misses; i++ {
				m.RecordCacheMiss()
			}

			// Verify via HTTP endpoint
			handler := m.HTTPHandler()
			req := httptest.NewRequest("GET", "/metrics", nil)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)

			body := w.Body.String()

			if tt.hits > 0 {
				assert.Contains(t, body, "authz_test_cache_hits_total "+itoa(tt.hits))
			}
			if tt.misses > 0 {
				assert.Contains(t, body, "authz_test_cache_misses_total "+itoa(tt.misses))
			}
		})
	}
}

// TestPrometheusMetrics_AuthErrors verifies error tracking by type
func TestPrometheusMetrics_AuthErrors(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	// Record different error types
	m.RecordAuthError("cel_eval")
	m.RecordAuthError("cel_eval")
	m.RecordAuthError("policy_not_found")
	m.RecordAuthError("invalid_request")
	m.RecordAuthError("cel_eval")

	// Verify via HTTP endpoint
	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()

	assert.Contains(t, body, "authz_test_errors_total{type=\"cel_eval\"} 3")
	assert.Contains(t, body, "authz_test_errors_total{type=\"policy_not_found\"} 1")
	assert.Contains(t, body, "authz_test_errors_total{type=\"invalid_request\"} 1")
}

// TestPrometheusMetrics_ActiveRequests verifies gauge increments/decrements
func TestPrometheusMetrics_ActiveRequests(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	// Simulate concurrent requests
	m.IncActiveRequests()
	m.IncActiveRequests()
	m.IncActiveRequests()
	m.DecActiveRequests()

	// Current active: 2

	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()
	assert.Contains(t, body, "authz_test_active_requests 2")
}

// TestPrometheusMetrics_EmbeddingJobs verifies job status tracking
func TestPrometheusMetrics_EmbeddingJobs(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	// Record various job outcomes
	m.RecordEmbeddingJob("success", 50*time.Millisecond)
	m.RecordEmbeddingJob("success", 75*time.Millisecond)
	m.RecordEmbeddingJob("failed", 10*time.Millisecond)
	m.RecordEmbeddingJob("timeout", 1000*time.Millisecond)
	m.RecordEmbeddingJob("success", 60*time.Millisecond)

	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()

	assert.Contains(t, body, "authz_test_embedding_jobs_total{status=\"success\"} 3")
	assert.Contains(t, body, "authz_test_embedding_jobs_total{status=\"failed\"} 1")
	assert.Contains(t, body, "authz_test_embedding_jobs_total{status=\"timeout\"} 1")
	assert.Contains(t, body, "authz_test_embedding_job_duration_milliseconds")
}

// TestPrometheusMetrics_EmbeddingCacheOperations verifies cache operation tracking
func TestPrometheusMetrics_EmbeddingCacheOperations(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	// Record cache operations
	for i := 0; i < 80; i++ {
		m.RecordCacheOperation("hit")
	}
	for i := 0; i < 15; i++ {
		m.RecordCacheOperation("miss")
	}
	for i := 0; i < 5; i++ {
		m.RecordCacheOperation("eviction")
	}

	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()

	assert.Contains(t, body, "authz_test_embedding_cache_hits_total 80")
	assert.Contains(t, body, "authz_test_embedding_cache_misses_total 15")
	assert.Contains(t, body, "authz_test_embedding_cache_evictions_total 5")
}

// TestPrometheusMetrics_EmbeddingGauges verifies queue and worker gauges
func TestPrometheusMetrics_EmbeddingGauges(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	m.UpdateQueueDepth(42)
	m.UpdateActiveWorkers(8)
	m.UpdateCacheEntries(256)

	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()

	assert.Contains(t, body, "authz_test_embedding_queue_depth 42")
	assert.Contains(t, body, "authz_test_embedding_workers_active 8")
	assert.Contains(t, body, "authz_test_embedding_cache_entries 256")
}

// TestPrometheusMetrics_VectorOperations verifies vector operation tracking
func TestPrometheusMetrics_VectorOperations(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	// Record vector operations
	m.RecordVectorOp("insert", 15*time.Millisecond)
	m.RecordVectorOp("insert", 20*time.Millisecond)
	m.RecordVectorOp("search", 5*time.Millisecond)
	m.RecordVectorOp("search", 8*time.Millisecond)
	m.RecordVectorOp("search", 6*time.Millisecond)
	m.RecordVectorOp("delete", 3*time.Millisecond)

	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()

	assert.Contains(t, body, "authz_test_vector_operations_total{op=\"insert\"} 2")
	assert.Contains(t, body, "authz_test_vector_operations_total{op=\"search\"} 3")
	assert.Contains(t, body, "authz_test_vector_operations_total{op=\"delete\"} 1")
	assert.Contains(t, body, "authz_test_vector_search_duration_milliseconds")
	assert.Contains(t, body, "authz_test_vector_insert_duration_milliseconds")
}

// TestPrometheusMetrics_VectorErrors verifies error tracking
func TestPrometheusMetrics_VectorErrors(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	m.RecordVectorError("timeout")
	m.RecordVectorError("invalid_query")
	m.RecordVectorError("timeout")
	m.RecordVectorError("not_found")
	m.RecordVectorError("timeout")

	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()

	assert.Contains(t, body, "authz_test_vector_search_errors_total{type=\"timeout\"} 3")
	assert.Contains(t, body, "authz_test_vector_search_errors_total{type=\"invalid_query\"} 1")
	assert.Contains(t, body, "authz_test_vector_search_errors_total{type=\"not_found\"} 1")
}

// TestPrometheusMetrics_VectorStoreMetrics verifies store size tracking
func TestPrometheusMetrics_VectorStoreMetrics(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	m.UpdateVectorStoreSize(5000)
	m.UpdateIndexSize(10 * 1024 * 1024) // 10MB

	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()

	assert.Contains(t, body, "authz_test_vector_store_size 5000")
	assert.Contains(t, body, "authz_test_vector_index_size_bytes 1.048576e+07")
}

// TestPrometheusMetrics_HTTPHandler_ValidFormat verifies Prometheus format
func TestPrometheusMetrics_HTTPHandler_ValidFormat(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	// Record some metrics
	m.RecordCheck("allow", 5*time.Microsecond)
	m.RecordCacheHit()

	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	body := w.Body.String()

	// Verify Prometheus format
	assert.Contains(t, body, "# HELP")
	assert.Contains(t, body, "# TYPE")

	// Verify metric naming conventions (snake_case)
	lines := strings.Split(body, "\n")
	for _, line := range lines {
		if strings.HasPrefix(line, "authz_test_") && !strings.HasPrefix(line, "# ") {
			// Should not contain camelCase or hyphens
			assert.NotContains(t, line, "camelCase")
			assert.NotRegexp(t, `[A-Z]`, strings.Split(line, "{")[0],
				"Metric names should be lowercase snake_case: %s", line)
		}
	}

	// Verify standard Go metrics are included
	assert.Contains(t, body, "go_goroutines")
	assert.Contains(t, body, "go_memstats")
}

// TestPrometheusMetrics_ConcurrentAccess verifies thread safety
func TestPrometheusMetrics_ConcurrentAccess(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	var wg sync.WaitGroup
	iterations := 100

	// Concurrent authorization metrics
	for i := 0; i < iterations; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			m.RecordCheck("allow", 5*time.Microsecond)
			m.RecordCacheHit()
			m.IncActiveRequests()
			m.DecActiveRequests()
		}()
	}

	// Concurrent embedding metrics
	for i := 0; i < iterations; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			m.RecordEmbeddingJob("success", 50*time.Millisecond)
			m.UpdateQueueDepth(i)
			m.UpdateActiveWorkers(i % 10)
		}(i)
	}

	// Concurrent vector metrics
	for i := 0; i < iterations; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			m.RecordVectorOp("search", 10*time.Millisecond)
			m.UpdateVectorStoreSize(i * 100)
		}(i)
	}

	wg.Wait()

	// Verify metrics are accessible
	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	body := w.Body.String()
	assert.Contains(t, body, "authz_test_checks_total")
}

// TestPrometheusMetrics_HistogramBuckets verifies correct bucket configuration
func TestPrometheusMetrics_HistogramBuckets(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	// Record various latencies
	m.RecordCheck("allow", 1*time.Microsecond)
	m.RecordCheck("allow", 10*time.Microsecond)
	m.RecordCheck("allow", 100*time.Microsecond)
	m.RecordCheck("allow", 1000*time.Microsecond)

	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()

	// Verify histogram buckets exist
	expectedBuckets := []string{"1", "5", "10", "25", "50", "100", "250", "500", "1000", "5000", "10000"}
	for _, bucket := range expectedBuckets {
		assert.Contains(t, body, "le=\""+bucket+"\"",
			"Expected histogram bucket: le=\"%s\"", bucket)
	}

	// Verify +Inf bucket
	assert.Contains(t, body, "le=\"+Inf\"")
}

// TestPrometheusMetrics_MultipleNamespaces verifies namespace isolation
func TestPrometheusMetrics_MultipleNamespaces(t *testing.T) {
	m1 := NewPrometheusMetrics("authz_prod")
	m2 := NewPrometheusMetrics("authz_test")

	m1.RecordCheck("allow", 5*time.Microsecond)
	m2.RecordCheck("deny", 3*time.Microsecond)

	// Verify m1 metrics
	handler1 := m1.HTTPHandler()
	req1 := httptest.NewRequest("GET", "/metrics", nil)
	w1 := httptest.NewRecorder()
	handler1.ServeHTTP(w1, req1)
	body1 := w1.Body.String()

	assert.Contains(t, body1, "authz_prod_checks_total")
	assert.NotContains(t, body1, "authz_test_checks_total")

	// Verify m2 metrics
	handler2 := m2.HTTPHandler()
	req2 := httptest.NewRequest("GET", "/metrics", nil)
	w2 := httptest.NewRecorder()
	handler2.ServeHTTP(w2, req2)
	body2 := w2.Body.String()

	assert.Contains(t, body2, "authz_test_checks_total")
	assert.NotContains(t, body2, "authz_prod_checks_total")
}

// Helper function to convert int to string
func itoa(i int) string {
	return fmt.Sprintf("%d", i)
}
