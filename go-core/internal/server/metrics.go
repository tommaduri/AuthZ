// Package server provides the gRPC server implementation
package server

import (
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

// MetricsCollector collects Prometheus metrics for authorization engine
type MetricsCollector struct {
	mu sync.RWMutex

	// Request counters
	requestsTotal       int64
	requestsSuccess     int64
	requestsFailed      int64
	requestDurationMs   int64 // Total duration in milliseconds

	// Cache metrics
	cacheHitsTotal      int64
	cacheMissesTotal    int64
	policiesLoadedGauge int64

	// Histograms (buckets for latency)
	durationBuckets map[string]int64 // millisecond buckets
}

// NewMetricsCollector creates a new metrics collector
func NewMetricsCollector() *MetricsCollector {
	return &MetricsCollector{
		durationBuckets: make(map[string]int64),
	}
}

// RecordRequest records a successful authorization request
func (m *MetricsCollector) RecordRequest(durationMs float64, success bool) {
	atomic.AddInt64(&m.requestsTotal, 1)

	durationMsInt := int64(durationMs)
	atomic.AddInt64(&m.requestDurationMs, durationMsInt)

	if success {
		atomic.AddInt64(&m.requestsSuccess, 1)
	} else {
		atomic.AddInt64(&m.requestsFailed, 1)
	}

	// Record in histogram buckets
	m.mu.Lock()
	defer m.mu.Unlock()

	bucket := m.getBucket(durationMs)
	m.durationBuckets[bucket]++
}

// RecordCacheHit records a cache hit
func (m *MetricsCollector) RecordCacheHit() {
	atomic.AddInt64(&m.cacheHitsTotal, 1)
}

// RecordCacheMiss records a cache miss
func (m *MetricsCollector) RecordCacheMiss() {
	atomic.AddInt64(&m.cacheMissesTotal, 1)
}

// SetPoliciesLoaded sets the gauge for loaded policies
func (m *MetricsCollector) SetPoliciesLoaded(count int64) {
	atomic.StoreInt64(&m.policiesLoadedGauge, count)
}

// GetMetrics returns current metrics
func (m *MetricsCollector) GetMetrics() map[string]interface{} {
	m.mu.RLock()
	defer m.mu.RUnlock()

	total := atomic.LoadInt64(&m.requestsTotal)
	success := atomic.LoadInt64(&m.requestsSuccess)
	failed := atomic.LoadInt64(&m.requestsFailed)
	totalDuration := atomic.LoadInt64(&m.requestDurationMs)
	cacheHits := atomic.LoadInt64(&m.cacheHitsTotal)
	cacheMisses := atomic.LoadInt64(&m.cacheMissesTotal)
	policiesLoaded := atomic.LoadInt64(&m.policiesLoadedGauge)

	avgDuration := float64(0)
	if total > 0 {
		avgDuration = float64(totalDuration) / float64(total)
	}

	metrics := map[string]interface{}{
		"authz_requests_total":        total,
		"authz_requests_success":      success,
		"authz_requests_failed":       failed,
		"authz_request_duration_avg_ms": avgDuration,
		"authz_cache_hits_total":      cacheHits,
		"authz_cache_misses_total":    cacheMisses,
		"authz_policies_loaded":       policiesLoaded,
	}

	// Add histogram buckets
	histogramBuckets := make(map[string]int64)
	for bucket, count := range m.durationBuckets {
		histogramBuckets[bucket] = count
	}
	metrics["authz_request_duration_histogram"] = histogramBuckets

	// Calculate cache hit ratio
	totalCacheAccess := cacheHits + cacheMisses
	if totalCacheAccess > 0 {
		hitRatio := float64(cacheHits) / float64(totalCacheAccess)
		metrics["authz_cache_hit_ratio"] = hitRatio
	}

	return metrics
}

// getBucket returns the histogram bucket for a duration
func (m *MetricsCollector) getBucket(durationMs float64) string {
	buckets := []struct {
		name  string
		value float64
	}{
		{"le_1", 1},
		{"le_5", 5},
		{"le_10", 10},
		{"le_50", 50},
		{"le_100", 100},
		{"le_500", 500},
		{"le_1000", 1000},
		{"le_5000", 5000},
	}

	for _, bucket := range buckets {
		if durationMs <= bucket.value {
			return bucket.name
		}
	}
	return "le_inf"
}

// MetricsHandler handles metrics HTTP endpoints
type MetricsHandler struct {
	collector *MetricsCollector
}

// NewMetricsHandler creates a new metrics handler
func NewMetricsHandler(collector *MetricsCollector) *MetricsHandler {
	return &MetricsHandler{
		collector: collector,
	}
}

// ServePrometheus serves metrics in Prometheus format
func (h *MetricsHandler) ServePrometheus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	metrics := h.collector.GetMetrics()

	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	w.WriteHeader(http.StatusOK)

	// Write TYPE declarations
	fmt.Fprintf(w, "# HELP authz_requests_total Total number of authorization requests\n")
	fmt.Fprintf(w, "# TYPE authz_requests_total counter\n")
	fmt.Fprintf(w, "authz_requests_total %d\n\n", metrics["authz_requests_total"])

	fmt.Fprintf(w, "# HELP authz_requests_success Total number of successful authorization requests\n")
	fmt.Fprintf(w, "# TYPE authz_requests_success counter\n")
	fmt.Fprintf(w, "authz_requests_success %d\n\n", metrics["authz_requests_success"])

	fmt.Fprintf(w, "# HELP authz_requests_failed Total number of failed authorization requests\n")
	fmt.Fprintf(w, "# TYPE authz_requests_failed counter\n")
	fmt.Fprintf(w, "authz_requests_failed %d\n\n", metrics["authz_requests_failed"])

	fmt.Fprintf(w, "# HELP authz_request_duration_seconds Authorization request duration histogram\n")
	fmt.Fprintf(w, "# TYPE authz_request_duration_seconds histogram\n")
	fmt.Fprintf(w, "authz_request_duration_seconds_bucket{le=\"0.001\"} 0\n")
	fmt.Fprintf(w, "authz_request_duration_seconds_bucket{le=\"0.005\"} 0\n")
	fmt.Fprintf(w, "authz_request_duration_seconds_bucket{le=\"0.01\"} 0\n")
	fmt.Fprintf(w, "authz_request_duration_seconds_bucket{le=\"0.05\"} 0\n")
	fmt.Fprintf(w, "authz_request_duration_seconds_bucket{le=\"0.1\"} 0\n")
	fmt.Fprintf(w, "authz_request_duration_seconds_bucket{le=\"0.5\"} 0\n")
	fmt.Fprintf(w, "authz_request_duration_seconds_bucket{le=\"1\"} 0\n")
	fmt.Fprintf(w, "authz_request_duration_seconds_bucket{le=\"5\"} 0\n")
	fmt.Fprintf(w, "authz_request_duration_seconds_bucket{le=\"+Inf\"} %d\n", metrics["authz_requests_total"])
	fmt.Fprintf(w, "authz_request_duration_seconds_sum %f\n", metrics["authz_request_duration_avg_ms"])
	fmt.Fprintf(w, "authz_request_duration_seconds_count %d\n\n", metrics["authz_requests_total"])

	fmt.Fprintf(w, "# HELP authz_cache_hits_total Total number of cache hits\n")
	fmt.Fprintf(w, "# TYPE authz_cache_hits_total counter\n")
	fmt.Fprintf(w, "authz_cache_hits_total %d\n\n", metrics["authz_cache_hits_total"])

	fmt.Fprintf(w, "# HELP authz_cache_misses_total Total number of cache misses\n")
	fmt.Fprintf(w, "# TYPE authz_cache_misses_total counter\n")
	fmt.Fprintf(w, "authz_cache_misses_total %d\n\n", metrics["authz_cache_misses_total"])

	fmt.Fprintf(w, "# HELP authz_cache_hit_ratio Cache hit ratio\n")
	fmt.Fprintf(w, "# TYPE authz_cache_hit_ratio gauge\n")
	if hitRatio, ok := metrics["authz_cache_hit_ratio"].(float64); ok {
		fmt.Fprintf(w, "authz_cache_hit_ratio %f\n\n", hitRatio)
	} else {
		fmt.Fprintf(w, "authz_cache_hit_ratio 0\n\n")
	}

	fmt.Fprintf(w, "# HELP authz_policies_loaded Number of policies currently loaded\n")
	fmt.Fprintf(w, "# TYPE authz_policies_loaded gauge\n")
	fmt.Fprintf(w, "authz_policies_loaded %d\n\n", metrics["authz_policies_loaded"])

	fmt.Fprintf(w, "# HELP process_uptime_seconds Process uptime in seconds\n")
	fmt.Fprintf(w, "# TYPE process_uptime_seconds counter\n")
	fmt.Fprintf(w, "process_uptime_seconds %d\n", int64(time.Since(serverStartTime).Seconds()))
}

// ServeJSON serves metrics in JSON format
func (h *MetricsHandler) ServeJSON(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	metrics := h.collector.GetMetrics()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	// Manually construct JSON to ensure proper formatting
	fmt.Fprintf(w, "{\n")
	fmt.Fprintf(w, "  \"timestamp\": \"%s\",\n", time.Now().UTC().Format(time.RFC3339))
	fmt.Fprintf(w, "  \"uptime_seconds\": %d,\n", int64(time.Since(serverStartTime).Seconds()))

	// Counters
	fmt.Fprintf(w, "  \"counters\": {\n")
	fmt.Fprintf(w, "    \"requests_total\": %d,\n", metrics["authz_requests_total"])
	fmt.Fprintf(w, "    \"requests_success\": %d,\n", metrics["authz_requests_success"])
	fmt.Fprintf(w, "    \"requests_failed\": %d,\n", metrics["authz_requests_failed"])
	fmt.Fprintf(w, "    \"cache_hits_total\": %d,\n", metrics["authz_cache_hits_total"])
	fmt.Fprintf(w, "    \"cache_misses_total\": %d\n", metrics["authz_cache_misses_total"])
	fmt.Fprintf(w, "  },\n")

	// Gauges
	fmt.Fprintf(w, "  \"gauges\": {\n")
	fmt.Fprintf(w, "    \"policies_loaded\": %d,\n", metrics["authz_policies_loaded"])
	if hitRatio, ok := metrics["authz_cache_hit_ratio"].(float64); ok {
		fmt.Fprintf(w, "    \"cache_hit_ratio\": %.4f\n", hitRatio)
	} else {
		fmt.Fprintf(w, "    \"cache_hit_ratio\": 0\n")
	}
	fmt.Fprintf(w, "  },\n")

	// Histograms
	fmt.Fprintf(w, "  \"histograms\": {\n")
	fmt.Fprintf(w, "    \"request_duration_avg_ms\": %.2f\n", metrics["authz_request_duration_avg_ms"])
	fmt.Fprintf(w, "  }\n")
	fmt.Fprintf(w, "}\n")
}

// RegisterMetricsHandlers registers metrics handlers with the HTTP mux
func RegisterMetricsHandlers(mux *http.ServeMux, handler *MetricsHandler) {
	mux.HandleFunc("/metrics", handler.ServePrometheus)
	mux.HandleFunc("/metrics/json", handler.ServeJSON)
}

// Track server start time
var serverStartTime = time.Now()
