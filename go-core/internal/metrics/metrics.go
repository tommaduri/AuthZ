// Package metrics provides observability for the authorization engine
package metrics

import (
	"net/http"
	"time"
)

// Metrics provides observability for the authorization engine
type Metrics interface {
	// Authorization metrics
	RecordCheck(effect string, duration time.Duration)
	RecordCacheHit()
	RecordCacheMiss()
	RecordAuthError(errorType string)
	IncActiveRequests()
	DecActiveRequests()

	// Embedding metrics
	RecordEmbeddingJob(status string, duration time.Duration)
	RecordCacheOperation(operation string) // hit, miss, eviction
	UpdateQueueDepth(depth int)
	UpdateActiveWorkers(count int)
	UpdateCacheEntries(count int)

	// Vector store metrics
	RecordVectorOp(operation string, duration time.Duration) // insert, search, delete
	RecordVectorError(errorType string)
	UpdateVectorStoreSize(count int)
	UpdateIndexSize(bytes int64)

	// HTTP handler for Prometheus scraping
	HTTPHandler() http.Handler
}

// NoOpMetrics provides a no-op implementation for testing/disabled monitoring
type NoOpMetrics struct{}

// NewNoOpMetrics creates a new no-op metrics instance
func NewNoOpMetrics() *NoOpMetrics {
	return &NoOpMetrics{}
}

// Authorization metrics
func (n *NoOpMetrics) RecordCheck(effect string, duration time.Duration)   {}
func (n *NoOpMetrics) RecordCacheHit()                                     {}
func (n *NoOpMetrics) RecordCacheMiss()                                    {}
func (n *NoOpMetrics) RecordAuthError(errorType string)                    {}
func (n *NoOpMetrics) IncActiveRequests()                                  {}
func (n *NoOpMetrics) DecActiveRequests()                                  {}

// Embedding metrics
func (n *NoOpMetrics) RecordEmbeddingJob(status string, duration time.Duration) {}
func (n *NoOpMetrics) RecordCacheOperation(operation string)                     {}
func (n *NoOpMetrics) UpdateQueueDepth(depth int)                                {}
func (n *NoOpMetrics) UpdateActiveWorkers(count int)                             {}
func (n *NoOpMetrics) UpdateCacheEntries(count int)                              {}

// Vector store metrics
func (n *NoOpMetrics) RecordVectorOp(operation string, duration time.Duration) {}
func (n *NoOpMetrics) RecordVectorError(errorType string)                       {}
func (n *NoOpMetrics) UpdateVectorStoreSize(count int)                          {}
func (n *NoOpMetrics) UpdateIndexSize(bytes int64)                              {}

// HTTPHandler returns a no-op handler
func (n *NoOpMetrics) HTTPHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("# NoOp metrics - monitoring disabled\n"))
	})
}
