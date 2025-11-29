package metrics

import (
	"net/http"
	"sync/atomic"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// PrometheusMetrics implements Metrics using Prometheus with zero-allocation hot path
type PrometheusMetrics struct {
	// Authorization counters (using atomic for zero-allocation)
	checksAllow  atomic.Uint64
	checksDeny   atomic.Uint64
	cacheHits    atomic.Uint64
	cacheMisses  atomic.Uint64

	// Prometheus metrics (for HTTP export)
	checksTotal       *prometheus.CounterVec
	cacheHitsTotal    prometheus.Counter
	cacheMissesTotal  prometheus.Counter
	authErrors        *prometheus.CounterVec
	activeRequests    prometheus.Gauge
	checkDuration     prometheus.Histogram

	// Embedding metrics
	embeddingJobs          *prometheus.CounterVec
	embeddingCacheOps      *prometheus.CounterVec
	embeddingCacheHits     prometheus.Counter
	embeddingCacheMisses   prometheus.Counter
	embeddingCacheEvictions prometheus.Counter
	queueDepth             prometheus.Gauge
	activeWorkers          prometheus.Gauge
	cacheEntries           prometheus.Gauge
	jobDuration            prometheus.Histogram

	// Vector store metrics
	vectorOps              *prometheus.CounterVec
	vectorErrors           *prometheus.CounterVec
	vectorStoreSize        prometheus.Gauge
	indexSize              prometheus.Gauge
	vectorSearchDuration   prometheus.Histogram
	vectorInsertDuration   prometheus.Histogram

	registry *prometheus.Registry
}

// NewPrometheusMetrics creates a new Prometheus metrics instance
func NewPrometheusMetrics(namespace string) *PrometheusMetrics {
	registry := prometheus.NewRegistry()

	// Register standard Go metrics
	registry.MustRegister(collectors.NewGoCollector())
	registry.MustRegister(collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))

	// Authorization metrics
	checksTotal := prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Name:      "checks_total",
			Help:      "Total number of authorization checks by effect",
		},
		[]string{"effect"},
	)

	cacheHitsTotal := prometheus.NewCounter(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "cache",
			Name:      "hits_total",
			Help:      "Total number of cache hits",
		},
	)

	cacheMissesTotal := prometheus.NewCounter(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "cache",
			Name:      "misses_total",
			Help:      "Total number of cache misses",
		},
	)

	authErrors := prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Name:      "errors_total",
			Help:      "Total number of authorization errors by type",
		},
		[]string{"type"},
	)

	activeRequests := prometheus.NewGauge(
		prometheus.GaugeOpts{
			Namespace: namespace,
			Name:      "active_requests",
			Help:      "Number of active authorization requests",
		},
	)

	// Authorization latency: 1µs to 10ms (sub-millisecond expected)
	checkDuration := prometheus.NewHistogram(
		prometheus.HistogramOpts{
			Namespace: namespace,
			Name:      "check_duration_microseconds",
			Help:      "Authorization check latency in microseconds",
			Buckets:   []float64{1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000, 10000},
		},
	)

	// Embedding metrics
	embeddingJobs := prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "embedding",
			Name:      "jobs_total",
			Help:      "Total number of embedding jobs by status",
		},
		[]string{"status"},
	)

	embeddingCacheOps := prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "embedding",
			Name:      "cache_operations_total",
			Help:      "Total number of embedding cache operations",
		},
		[]string{"operation"},
	)

	embeddingCacheHits := prometheus.NewCounter(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "embedding",
			Name:      "cache_hits_total",
			Help:      "Total number of embedding cache hits",
		},
	)

	embeddingCacheMisses := prometheus.NewCounter(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "embedding",
			Name:      "cache_misses_total",
			Help:      "Total number of embedding cache misses",
		},
	)

	embeddingCacheEvictions := prometheus.NewCounter(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "embedding",
			Name:      "cache_evictions_total",
			Help:      "Total number of embedding cache evictions",
		},
	)

	queueDepth := prometheus.NewGauge(
		prometheus.GaugeOpts{
			Namespace: namespace,
			Subsystem: "embedding",
			Name:      "queue_depth",
			Help:      "Current depth of embedding job queue",
		},
	)

	activeWorkers := prometheus.NewGauge(
		prometheus.GaugeOpts{
			Namespace: namespace,
			Subsystem: "embedding",
			Name:      "workers_active",
			Help:      "Number of active embedding workers",
		},
	)

	cacheEntries := prometheus.NewGauge(
		prometheus.GaugeOpts{
			Namespace: namespace,
			Subsystem: "embedding",
			Name:      "cache_entries",
			Help:      "Number of entries in embedding cache",
		},
	)

	// Embedding jobs: 10ms to 1 second (model inference time)
	jobDuration := prometheus.NewHistogram(
		prometheus.HistogramOpts{
			Namespace: namespace,
			Subsystem: "embedding",
			Name:      "job_duration_milliseconds",
			Help:      "Embedding job processing duration in milliseconds",
			Buckets:   []float64{10, 25, 50, 100, 250, 500, 1000},
		},
	)

	// Vector store metrics
	vectorOps := prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "vector",
			Name:      "operations_total",
			Help:      "Total number of vector operations by type",
		},
		[]string{"op"},
	)

	vectorErrors := prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: namespace,
			Subsystem: "vector",
			Name:      "search_errors_total",
			Help:      "Total number of vector search errors by type",
		},
		[]string{"type"},
	)

	vectorStoreSize := prometheus.NewGauge(
		prometheus.GaugeOpts{
			Namespace: namespace,
			Subsystem: "vector",
			Name:      "store_size",
			Help:      "Total number of vectors in store",
		},
	)

	indexSize := prometheus.NewGauge(
		prometheus.GaugeOpts{
			Namespace: namespace,
			Subsystem: "vector",
			Name:      "index_size_bytes",
			Help:      "Size of vector index in bytes",
		},
	)

	// Vector search: 1ms to 500ms (HNSW search time)
	vectorSearchDuration := prometheus.NewHistogram(
		prometheus.HistogramOpts{
			Namespace: namespace,
			Subsystem: "vector",
			Name:      "search_duration_milliseconds",
			Help:      "Vector similarity search latency in milliseconds",
			Buckets:   []float64{1, 5, 10, 25, 50, 100, 250, 500},
		},
	)

	vectorInsertDuration := prometheus.NewHistogram(
		prometheus.HistogramOpts{
			Namespace: namespace,
			Subsystem: "vector",
			Name:      "insert_duration_milliseconds",
			Help:      "Vector insert latency in milliseconds",
			Buckets:   []float64{1, 5, 10, 25, 50, 100, 250, 500},
		},
	)

	// Register all metrics
	registry.MustRegister(
		checksTotal,
		cacheHitsTotal,
		cacheMissesTotal,
		authErrors,
		activeRequests,
		checkDuration,
		embeddingJobs,
		embeddingCacheOps,
		embeddingCacheHits,
		embeddingCacheMisses,
		embeddingCacheEvictions,
		queueDepth,
		activeWorkers,
		cacheEntries,
		jobDuration,
		vectorOps,
		vectorErrors,
		vectorStoreSize,
		indexSize,
		vectorSearchDuration,
		vectorInsertDuration,
	)

	pm := &PrometheusMetrics{
		checksTotal:             checksTotal,
		cacheHitsTotal:          cacheHitsTotal,
		cacheMissesTotal:        cacheMissesTotal,
		authErrors:              authErrors,
		activeRequests:          activeRequests,
		checkDuration:           checkDuration,
		embeddingJobs:           embeddingJobs,
		embeddingCacheOps:       embeddingCacheOps,
		embeddingCacheHits:      embeddingCacheHits,
		embeddingCacheMisses:    embeddingCacheMisses,
		embeddingCacheEvictions: embeddingCacheEvictions,
		queueDepth:              queueDepth,
		activeWorkers:           activeWorkers,
		cacheEntries:            cacheEntries,
		jobDuration:             jobDuration,
		vectorOps:               vectorOps,
		vectorErrors:            vectorErrors,
		vectorStoreSize:         vectorStoreSize,
		indexSize:               indexSize,
		vectorSearchDuration:    vectorSearchDuration,
		vectorInsertDuration:    vectorInsertDuration,
		registry:                registry,
	}

	// Initialize atomic counters to sync with Prometheus
	pm.checksAllow.Store(0)
	pm.checksDeny.Store(0)
	pm.cacheHits.Store(0)
	pm.cacheMisses.Store(0)

	return pm
}

// RecordCheck records an authorization check (zero-allocation hot path)
func (p *PrometheusMetrics) RecordCheck(effect string, duration time.Duration) {
	// Fast path: atomic increment (no allocations)
	if effect == "allow" || effect == "EFFECT_ALLOW" {
		p.checksAllow.Add(1)
	} else {
		p.checksDeny.Add(1)
	}

	// Update Prometheus metrics synchronously
	// Note: Prometheus client is thread-safe and these operations are fast
	p.checksTotal.WithLabelValues(effect).Inc()
	p.checkDuration.Observe(float64(duration.Microseconds()))
}

// RecordCacheHit records a cache hit (zero-allocation)
func (p *PrometheusMetrics) RecordCacheHit() {
	p.cacheHits.Add(1)
	p.cacheHitsTotal.Inc()
}

// RecordCacheMiss records a cache miss (zero-allocation)
func (p *PrometheusMetrics) RecordCacheMiss() {
	p.cacheMisses.Add(1)
	p.cacheMissesTotal.Inc()
}

// RecordAuthError records an authorization error
func (p *PrometheusMetrics) RecordAuthError(errorType string) {
	p.authErrors.WithLabelValues(errorType).Inc()
}

// IncActiveRequests increments active requests
func (p *PrometheusMetrics) IncActiveRequests() {
	p.activeRequests.Inc()
}

// DecActiveRequests decrements active requests
func (p *PrometheusMetrics) DecActiveRequests() {
	p.activeRequests.Dec()
}

// RecordEmbeddingJob records an embedding job
func (p *PrometheusMetrics) RecordEmbeddingJob(status string, duration time.Duration) {
	p.embeddingJobs.WithLabelValues(status).Inc()
	p.jobDuration.Observe(float64(duration.Milliseconds()))
}

// RecordCacheOperation records a cache operation
func (p *PrometheusMetrics) RecordCacheOperation(operation string) {
	p.embeddingCacheOps.WithLabelValues(operation).Inc()

	// Also update specific counters for backward compatibility
	switch operation {
	case "hit":
		p.embeddingCacheHits.Inc()
	case "miss":
		p.embeddingCacheMisses.Inc()
	case "eviction":
		p.embeddingCacheEvictions.Inc()
	}
}

// UpdateQueueDepth updates the embedding queue depth
func (p *PrometheusMetrics) UpdateQueueDepth(depth int) {
	p.queueDepth.Set(float64(depth))
}

// UpdateActiveWorkers updates the number of active workers
func (p *PrometheusMetrics) UpdateActiveWorkers(count int) {
	p.activeWorkers.Set(float64(count))
}

// UpdateCacheEntries updates the number of cache entries
func (p *PrometheusMetrics) UpdateCacheEntries(count int) {
	p.cacheEntries.Set(float64(count))
}

// RecordVectorOp records a vector operation
func (p *PrometheusMetrics) RecordVectorOp(operation string, duration time.Duration) {
	p.vectorOps.WithLabelValues(operation).Inc()

	ms := float64(duration.Milliseconds())
	switch operation {
	case "search":
		p.vectorSearchDuration.Observe(ms)
	case "insert":
		p.vectorInsertDuration.Observe(ms)
	}
}

// RecordVectorError records a vector operation error
func (p *PrometheusMetrics) RecordVectorError(errorType string) {
	p.vectorErrors.WithLabelValues(errorType).Inc()
}

// UpdateVectorStoreSize updates the vector store size
func (p *PrometheusMetrics) UpdateVectorStoreSize(count int) {
	p.vectorStoreSize.Set(float64(count))
}

// UpdateIndexSize updates the index size in bytes
func (p *PrometheusMetrics) UpdateIndexSize(bytes int64) {
	p.indexSize.Set(float64(bytes))
}

// HTTPHandler returns the Prometheus HTTP handler for /metrics endpoint
func (p *PrometheusMetrics) HTTPHandler() http.Handler {
	return promhttp.HandlerFor(p.registry, promhttp.HandlerOpts{})
}
