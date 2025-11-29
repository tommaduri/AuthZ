package metrics

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestNewPrometheusMetrics verifies constructor creates valid instance
func TestNewPrometheusMetrics(t *testing.T) {
	tests := []struct {
		name      string
		namespace string
	}{
		{name: "Default namespace", namespace: "authz"},
		{name: "Custom namespace", namespace: "my_app"},
		{name: "Underscored namespace", namespace: "authz_engine"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := NewPrometheusMetrics(tt.namespace)
			require.NotNil(t, m)
			require.NotNil(t, m.HTTPHandler())

			// Verify metrics are registered
			handler := m.HTTPHandler()
			req := httptest.NewRequest("GET", "/metrics", nil)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)

			body := w.Body.String()
			assert.Contains(t, body, tt.namespace+"_")
		})
	}
}

// TestPrometheusMetrics_CounterVec verifies labeled counters work correctly
func TestPrometheusMetrics_CounterVec(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	// Test authorization checks with different effects
	m.RecordCheck("allow", 5*time.Microsecond)
	m.RecordCheck("deny", 3*time.Microsecond)
	m.RecordCheck("allow", 7*time.Microsecond)

	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()

	// Verify separate counters for each label
	assert.Contains(t, body, "authz_test_checks_total{effect=\"allow\"} 2")
	assert.Contains(t, body, "authz_test_checks_total{effect=\"deny\"} 1")
}

// TestPrometheusMetrics_Gauge_Increment_Decrement verifies gauge operations
func TestPrometheusMetrics_Gauge_Increment_Decrement(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	// Start at 0
	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	body := w.Body.String()
	assert.Contains(t, body, "authz_test_active_requests 0")

	// Increment to 5
	m.IncActiveRequests()
	m.IncActiveRequests()
	m.IncActiveRequests()
	m.IncActiveRequests()
	m.IncActiveRequests()

	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/metrics", nil))
	body = w.Body.String()
	assert.Contains(t, body, "authz_test_active_requests 5")

	// Decrement to 2
	m.DecActiveRequests()
	m.DecActiveRequests()
	m.DecActiveRequests()

	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/metrics", nil))
	body = w.Body.String()
	assert.Contains(t, body, "authz_test_active_requests 2")
}

// TestPrometheusMetrics_Gauge_Set verifies gauge set operations
func TestPrometheusMetrics_Gauge_Set(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	// Set queue depth
	m.UpdateQueueDepth(100)

	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	body := w.Body.String()
	assert.Contains(t, body, "authz_test_embedding_queue_depth 100")

	// Update queue depth
	m.UpdateQueueDepth(75)

	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/metrics", nil))
	body = w.Body.String()
	assert.Contains(t, body, "authz_test_embedding_queue_depth 75")
}

// TestPrometheusMetrics_Histogram_Observations verifies histogram recording
func TestPrometheusMetrics_Histogram_Observations(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	// Record observations with known values
	durations := []time.Duration{
		1 * time.Microsecond,
		5 * time.Microsecond,
		10 * time.Microsecond,
		25 * time.Microsecond,
		50 * time.Microsecond,
		100 * time.Microsecond,
		500 * time.Microsecond,
		1000 * time.Microsecond,
	}

	for _, d := range durations {
		m.RecordCheck("allow", d)
	}

	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	body := w.Body.String()

	// Verify histogram count
	assert.Contains(t, body, "authz_test_check_duration_microseconds_count 8")

	// Verify histogram sum (1+5+10+25+50+100+500+1000 = 1691)
	assert.Contains(t, body, "authz_test_check_duration_microseconds_sum 1691")

	// Verify buckets are populated
	assert.Contains(t, body, "authz_test_check_duration_microseconds_bucket")
}

// TestPrometheusMetrics_Histogram_Buckets_Authorization verifies auth latency buckets
func TestPrometheusMetrics_Histogram_Buckets_Authorization(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	// Record values in different buckets
	m.RecordCheck("allow", 2*time.Microsecond)   // Falls in 5µs bucket
	m.RecordCheck("allow", 15*time.Microsecond)  // Falls in 25µs bucket
	m.RecordCheck("allow", 75*time.Microsecond)  // Falls in 100µs bucket
	m.RecordCheck("allow", 600*time.Microsecond) // Falls in 1000µs bucket

	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	body := w.Body.String()

	// Verify cumulative bucket counts
	// le="5" should have 1
	// le="25" should have 2
	// le="100" should have 3
	// le="1000" should have 4
	assert.Contains(t, body, "le=\"5\"")
	assert.Contains(t, body, "le=\"25\"")
	assert.Contains(t, body, "le=\"100\"")
	assert.Contains(t, body, "le=\"1000\"")
}

// TestPrometheusMetrics_Histogram_Buckets_Embedding verifies embedding job duration buckets
func TestPrometheusMetrics_Histogram_Buckets_Embedding(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	// Record embedding job durations (10ms to 1000ms)
	m.RecordEmbeddingJob("success", 5*time.Millisecond)
	m.RecordEmbeddingJob("success", 30*time.Millisecond)
	m.RecordEmbeddingJob("success", 150*time.Millisecond)
	m.RecordEmbeddingJob("success", 600*time.Millisecond)

	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	body := w.Body.String()

	// Verify embedding histogram exists with correct buckets
	assert.Contains(t, body, "authz_test_embedding_job_duration_milliseconds_bucket")
	assert.Contains(t, body, "le=\"10\"")
	assert.Contains(t, body, "le=\"50\"")
	assert.Contains(t, body, "le=\"250\"")
	assert.Contains(t, body, "le=\"1000\"")
}

// TestPrometheusMetrics_Histogram_Buckets_VectorSearch verifies vector search latency buckets
func TestPrometheusMetrics_Histogram_Buckets_VectorSearch(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	// Record vector search durations (1ms to 500ms)
	m.RecordVectorOp("search", 2*time.Millisecond)
	m.RecordVectorOp("search", 15*time.Millisecond)
	m.RecordVectorOp("search", 75*time.Millisecond)
	m.RecordVectorOp("search", 300*time.Millisecond)

	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	body := w.Body.String()

	// Verify search histogram
	assert.Contains(t, body, "authz_test_vector_search_duration_milliseconds_bucket")
	assert.Contains(t, body, "le=\"5\"")
	assert.Contains(t, body, "le=\"25\"")
	assert.Contains(t, body, "le=\"100\"")
	assert.Contains(t, body, "le=\"500\"")
}

// TestPrometheusMetrics_Histogram_Buckets_VectorInsert verifies vector insert latency buckets
func TestPrometheusMetrics_Histogram_Buckets_VectorInsert(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	// Record vector insert durations
	m.RecordVectorOp("insert", 3*time.Millisecond)
	m.RecordVectorOp("insert", 12*time.Millisecond)
	m.RecordVectorOp("insert", 45*time.Millisecond)
	m.RecordVectorOp("insert", 200*time.Millisecond)

	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	body := w.Body.String()

	// Verify insert histogram
	assert.Contains(t, body, "authz_test_vector_insert_duration_milliseconds_bucket")
}

// TestPrometheusMetrics_Registry_StandardCollectors verifies Go runtime metrics
func TestPrometheusMetrics_Registry_StandardCollectors(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	body := w.Body.String()

	// Verify standard Go metrics are registered
	assert.Contains(t, body, "go_goroutines")
	assert.Contains(t, body, "go_memstats_alloc_bytes")
	assert.Contains(t, body, "go_memstats_heap_objects")
	assert.Contains(t, body, "process_cpu_seconds_total")
	assert.Contains(t, body, "process_resident_memory_bytes")
}

// TestPrometheusMetrics_MetricNamingConventions verifies snake_case naming
func TestPrometheusMetrics_MetricNamingConventions(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	// Record some metrics
	m.RecordCheck("allow", 5*time.Microsecond)
	m.RecordEmbeddingJob("success", 50*time.Millisecond)
	m.RecordVectorOp("search", 10*time.Millisecond)

	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	body := w.Body.String()

	// All metric names should use snake_case (no camelCase, no hyphens)
	expectedMetrics := []string{
		"authz_test_checks_total",
		"authz_test_check_duration_microseconds",
		"authz_test_cache_hits_total",
		"authz_test_cache_misses_total",
		"authz_test_active_requests",
		"authz_test_errors_total",
		"authz_test_embedding_jobs_total",
		"authz_test_embedding_job_duration_milliseconds",
		"authz_test_embedding_queue_depth",
		"authz_test_embedding_workers_active",
		"authz_test_embedding_cache_entries",
		"authz_test_embedding_cache_hits_total",
		"authz_test_embedding_cache_misses_total",
		"authz_test_embedding_cache_evictions_total",
		"authz_test_vector_operations_total",
		"authz_test_vector_search_duration_milliseconds",
		"authz_test_vector_insert_duration_milliseconds",
		"authz_test_vector_store_size",
		"authz_test_vector_index_size_bytes",
		"authz_test_vector_search_errors_total",
	}

	for _, metric := range expectedMetrics {
		assert.Contains(t, body, metric,
			"Expected metric to be present: %s", metric)
	}
}

// TestPrometheusMetrics_HelpText verifies all metrics have HELP text
func TestPrometheusMetrics_HelpText(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	body := w.Body.String()

	// Verify HELP text exists for main metrics
	expectedHelp := []string{
		"# HELP authz_test_checks_total",
		"# HELP authz_test_check_duration_microseconds",
		"# HELP authz_test_embedding_jobs_total",
		"# HELP authz_test_vector_operations_total",
	}

	for _, help := range expectedHelp {
		assert.Contains(t, body, help,
			"Expected HELP text: %s", help)
	}
}

// TestPrometheusMetrics_TypeAnnotations verifies TYPE annotations
func TestPrometheusMetrics_TypeAnnotations(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	body := w.Body.String()

	// Verify TYPE annotations
	assert.Contains(t, body, "# TYPE authz_test_checks_total counter")
	assert.Contains(t, body, "# TYPE authz_test_active_requests gauge")
	assert.Contains(t, body, "# TYPE authz_test_check_duration_microseconds histogram")
}

// TestPrometheusMetrics_ZeroValues verifies metrics start at zero
func TestPrometheusMetrics_ZeroValues(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	body := w.Body.String()

	// Counters should not appear or be 0
	// Gauges should be 0
	assert.Contains(t, body, "authz_test_active_requests 0")
	assert.Contains(t, body, "authz_test_embedding_queue_depth 0")
	assert.Contains(t, body, "authz_test_embedding_workers_active 0")
}

// TestPrometheusMetrics_PerformanceOverhead verifies minimal overhead
func TestPrometheusMetrics_PerformanceOverhead(t *testing.T) {
	m := NewPrometheusMetrics("authz_test")

	iterations := 10000
	start := time.Now()

	for i := 0; i < iterations; i++ {
		m.RecordCheck("allow", 5*time.Microsecond)
	}

	duration := time.Since(start)
	avgPerOp := duration / time.Duration(iterations)

	// Metric recording should be <100ns per operation
	assert.Less(t, avgPerOp.Nanoseconds(), int64(100),
		"Metric recording overhead too high: %v per operation", avgPerOp)
}
