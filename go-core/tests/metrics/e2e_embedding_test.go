package metrics_test

import (
	"context"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/embedding"
	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/metrics"
	"github.com/authz-engine/go-core/internal/policy"
	intvector "github.com/authz-engine/go-core/internal/vector"
	"github.com/authz-engine/go-core/pkg/types"
	"github.com/authz-engine/go-core/pkg/vector"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestE2E_EmbeddingPipeline validates embedding pipeline metrics
// Scenario: Submit 500 policies for embedding with 4 workers
// Validates: authz_embedding_jobs_total, queue_depth, workers_active, job_duration
func TestE2E_EmbeddingPipeline(t *testing.T) {
	// Setup: Create engine with embedding worker
	m := metrics.NewPrometheusMetrics("authz_test")
	store := policy.NewMemoryStore()

	vectorStore, err := intvector.NewMemoryStore(vector.Config{
		Backend:   "memory",
		Dimension: 384,
		HNSW: vector.HNSWConfig{
			M:              16,
			EfConstruction: 200,
			EfSearch:       50,
		},
	})
	require.NoError(t, err)
	defer vectorStore.Close()

	embedConfig := &embedding.Config{
		NumWorkers:    4,
		QueueSize:     1000,
		BatchSize:     10,
		Dimension:     384,
		EmbeddingFunc: embedding.DefaultEmbeddingFunction,
		CacheConfig:   &embedding.CacheConfig{MaxEntries: 500},
		Metrics:       m,
	}

	cfg := engine.Config{
		CacheEnabled:            true,
		CacheSize:               1000,
		ParallelWorkers:         4,
		VectorSimilarityEnabled: true,
		VectorStore:             vectorStore,
		EmbeddingConfig:         embedConfig,
		Metrics:                 m,
	}

	eng, err2 := engine.New(cfg, store)
	require.NoError(t, err2)
	defer eng.Shutdown(context.Background())

	// Execute: Submit 500 policies for embedding
	numPolicies := 500
	for i := 0; i < numPolicies; i++ {
		pol := &types.Policy{
			Name:         "policy-" + itoa(i),
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "allow-read-write",
					Actions: []string{"read", "write"},
					Effect:  types.EffectAllow,
					Roles:   []string{"user"},
				},
			},
		}
		store.Add(pol)
	}

	// Wait for embedding jobs to complete (with timeout)
	timeout := time.After(30 * time.Second)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-timeout:
			t.Fatal("Timeout waiting for embedding jobs to complete")
		case <-ticker.C:
			// Check if queue is empty
			handler := m.HTTPHandler()
			req := httptest.NewRequest("GET", "/metrics", nil)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)

			body := w.Body.String()
			queueDepth := extractMetricValue(body, "authz_test_embedding_queue_depth")

			if queueDepth == 0 {
				// Queue empty, jobs complete
				goto VerifyMetrics
			}
		}
	}

VerifyMetrics:
	// Verify: Check metrics via HTTP endpoint
	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()

	// Verify job completion
	assert.Contains(t, body, "authz_test_embedding_jobs_total")

	// Parse success count
	successCount := extractLabeledMetricValue(body, "authz_test_embedding_jobs_total", "success")
	assert.Greater(t, successCount, float64(numPolicies)*0.9,
		"At least 90%% of jobs should succeed (got %.0f/%d)", successCount, numPolicies)

	// Verify queue returned to 0
	queueDepth := extractMetricValue(body, "authz_test_embedding_queue_depth")
	assert.Equal(t, 0.0, queueDepth, "Queue should be empty after completion")

	// Verify workers were active during processing
	assert.Contains(t, body, "authz_test_embedding_workers_active")

	// Verify job duration histogram exists
	assert.Contains(t, body, "authz_test_embedding_job_duration_milliseconds")
	assert.Contains(t, body, "authz_test_embedding_job_duration_milliseconds_bucket")

	// Verify cache metrics
	assert.Contains(t, body, "authz_test_embedding_cache_entries")
	assert.Contains(t, body, "authz_test_embedding_cache_hits_total")

	// Verify no failures (or very few)
	failedCount := extractLabeledMetricValue(body, "authz_test_embedding_jobs_total", "failed")
	assert.Less(t, failedCount, float64(numPolicies)*0.05,
		"Failure rate should be <5%% (got %.0f/%d)", failedCount, numPolicies)
}

// TestE2E_EmbeddingWorkerUtilization validates worker metrics
func TestE2E_EmbeddingWorkerUtilization(t *testing.T) {
	m := metrics.NewPrometheusMetrics("authz_test")
	store := policy.NewMemoryStore()

	vectorStore, err := intvector.NewMemoryStore(vector.Config{
		Backend:   "memory",
		Dimension: 384,
		HNSW: vector.HNSWConfig{
			M:              16,
			EfConstruction: 200,
			EfSearch:       50,
		},
	})
	require.NoError(t, err)
	defer vectorStore.Close()

	// Use only 2 workers to make utilization more observable
	embedConfig := &embedding.Config{
		NumWorkers:    2,
		QueueSize:     100,
		BatchSize:     5,
		Dimension:     384,
		EmbeddingFunc: embedding.DefaultEmbeddingFunction,
		Metrics:       m,
	}

	cfg := engine.Config{
		VectorSimilarityEnabled: true,
		VectorStore:             vectorStore,
		EmbeddingConfig:         embedConfig,
		Metrics:                 m,
	}

	eng, err2 := engine.New(cfg, store)
	require.NoError(t, err2)
	defer eng.Shutdown(context.Background())

	// Submit policies in batches to observe worker activity
	for i := 0; i < 50; i++ {
		pol := &types.Policy{
			Name:         "policy-" + itoa(i),
			ResourceKind: "resource-" + itoa(i),
			Rules: []*types.Rule{
				{
					Name:    "allow-read",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
					Roles:   []string{"user"},
				},
			},
		}
		store.Add(pol)

		// Check metrics periodically
		if i%10 == 0 {
			time.Sleep(50 * time.Millisecond)

			handler := m.HTTPHandler()
			req := httptest.NewRequest("GET", "/metrics", nil)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)

			body := w.Body.String()

			// During processing, queue depth should be > 0
			if i < 40 {
				queueDepth := extractMetricValue(body, "authz_test_embedding_queue_depth")
				t.Logf("Queue depth at policy %d: %.0f", i, queueDepth)
			}
		}
	}

	// Wait for completion
	time.Sleep(2 * time.Second)

	// Verify final state
	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()

	// Queue should be empty
	queueDepth := extractMetricValue(body, "authz_test_embedding_queue_depth")
	assert.Equal(t, 0.0, queueDepth)

	// Workers should have processed jobs
	totalJobs := extractMetricValue(body, "authz_test_embedding_jobs_total")
	assert.Greater(t, totalJobs, 0.0, "Workers should have processed jobs")
}

// TestE2E_EmbeddingCacheEffectiveness validates cache hit rate
func TestE2E_EmbeddingCacheEffectiveness(t *testing.T) {
	m := metrics.NewPrometheusMetrics("authz_test")
	store := policy.NewMemoryStore()

	vectorStore, err := intvector.NewMemoryStore(vector.Config{
		Backend:   "memory",
		Dimension: 384,
		HNSW: vector.HNSWConfig{
			M:              16,
			EfConstruction: 200,
			EfSearch:       50,
		},
	})
	require.NoError(t, err)
	defer vectorStore.Close()

	embedConfig := &embedding.Config{
		NumWorkers:    4,
		QueueSize:     100,
		BatchSize:     10,
		Dimension:     384,
		EmbeddingFunc: embedding.DefaultEmbeddingFunction,
		CacheConfig:   &embedding.CacheConfig{MaxEntries: 50}, // Small cache to test evictions
		Metrics:       m,
	}

	cfg := engine.Config{
		VectorSimilarityEnabled: true,
		VectorStore:             vectorStore,
		EmbeddingConfig:         embedConfig,
		Metrics:                 m,
	}

	eng, err2 := engine.New(cfg, store)
	require.NoError(t, err2)
	defer eng.Shutdown(context.Background())

	// Phase 1: Add unique policies (should be cache misses)
	for i := 0; i < 30; i++ {
		pol := &types.Policy{
			Name:         "unique-" + itoa(i),
			ResourceKind: "unique-" + itoa(i),
			Rules: []*types.Rule{
				{
					Name:    "allow-read",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
					Roles:   []string{"user"},
				},
			},
		}
		store.Add(pol)
	}

	time.Sleep(2 * time.Second)

	// Phase 2: Re-add same policies (should be cache hits)
	for i := 0; i < 30; i++ {
		pol := &types.Policy{
			Name:         "unique-" + itoa(i),
			ResourceKind: "unique-" + itoa(i),
			Rules: []*types.Rule{
				{
					Name:    "allow-read",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
					Roles:   []string{"user"},
				},
			},
		}
		store.Add(pol)
	}

	time.Sleep(2 * time.Second)

	// Verify cache effectiveness
	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()

	hits := extractMetricValue(body, "authz_test_embedding_cache_hits_total")
	misses := extractMetricValue(body, "authz_test_embedding_cache_misses_total")

	t.Logf("Cache hits: %.0f, misses: %.0f", hits, misses)

	// We expect some cache hits from the second batch
	assert.Greater(t, hits, 0.0, "Should have some cache hits")

	// Cache hit rate should be reasonable (>30% given our test pattern)
	if hits+misses > 0 {
		hitRate := hits / (hits + misses)
		assert.Greater(t, hitRate, 0.3, "Cache hit rate should be >30%%")
	}
}

// Helper: Extract labeled metric value (e.g., status="success")
func extractLabeledMetricValue(body, metricName, labelValue string) float64 {
	lines := strings.Split(body, "\n")
	searchStr := metricName + `{`

	for _, line := range lines {
		if strings.HasPrefix(line, searchStr) && strings.Contains(line, `="`+labelValue+`"`) {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				var value float64
				_, _ = fmt.Sscanf(parts[len(parts)-1], "%f", &value)
				return value
			}
		}
	}
	return 0
}
