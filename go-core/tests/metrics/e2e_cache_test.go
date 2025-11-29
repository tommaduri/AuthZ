package metrics_test

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/metrics"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestE2E_CacheMetrics validates cache effectiveness metrics
// Scenario: 1000 unique requests, 900 repeated requests
// Validates: Cache hit rate = 90%, authz_cache_hits_total, authz_cache_misses_total
func TestE2E_CacheMetrics(t *testing.T) {
	// Setup: Create engine with cache enabled
	m := metrics.NewPrometheusMetrics("authz_test")
	store := policy.NewMemoryStore()

	loadTestPolicies(t, store, 50)

	cfg := engine.Config{
		CacheEnabled:    true,
		CacheSize:       10000, // Large enough to hold all unique requests
		CacheTTL:        5 * time.Minute,
		ParallelWorkers: 4,
		Metrics:         m,
	}

	eng, err := engine.New(cfg, store)
	require.NoError(t, err)
	defer eng.Shutdown(context.Background())

	ctx := context.Background()

	// Execute: Phase 1 - 1000 unique requests (cold cache)
	uniqueRequests := 100
	requests := make([]*types.CheckRequest, uniqueRequests)

	for i := 0; i < uniqueRequests; i++ {
		requests[i] = &types.CheckRequest{
			Principal: &types.Principal{
				ID:    "user:" + itoa(i),
				Roles: []string{"viewer"},
			},
			Resource: &types.Resource{
				Kind: "document",
				ID:   "doc-" + itoa(i),
			},
			Actions: []string{"read"},
		}

		resp, err := eng.Check(ctx, requests[i])
		require.NoError(t, err)
		require.NotNil(t, resp)
	}

	// Execute: Phase 2 - 900 repeated requests (warm cache)
	repeatedRequests := 900
	for i := 0; i < repeatedRequests; i++ {
		reqIdx := i % uniqueRequests
		resp, err := eng.Check(ctx, requests[reqIdx])
		require.NoError(t, err)
		require.NotNil(t, resp)
	}

	// Verify: Check cache metrics
	handler := m.HTTPHandler()
	httpReq := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httpReq)

	body := w.Body.String()

	hits := extractMetricValue(body, "authz_test_cache_hits_total")
	misses := extractMetricValue(body, "authz_test_cache_misses_total")

	t.Logf("Cache hits: %.0f, misses: %.0f", hits, misses)

	// Calculate hit rate
	totalOps := hits + misses
	hitRate := hits / totalOps

	// Expected: 100 misses (unique), 900 hits (repeated) = 90% hit rate
	expectedHitRate := float64(repeatedRequests) / float64(uniqueRequests+repeatedRequests)

	assert.InDelta(t, expectedHitRate, hitRate, 0.05,
		"Cache hit rate should be ~%.0f%% (got %.1f%%)", expectedHitRate*100, hitRate*100)

	assert.InDelta(t, float64(uniqueRequests), misses, float64(uniqueRequests)*0.1,
		"Cache misses should be ~%d (unique requests)", uniqueRequests)

	assert.InDelta(t, float64(repeatedRequests), hits, float64(repeatedRequests)*0.1,
		"Cache hits should be ~%d (repeated requests)", repeatedRequests)
}

// TestE2E_CacheHitRateTarget validates >90% hit rate target
func TestE2E_CacheHitRateTarget(t *testing.T) {
	m := metrics.NewPrometheusMetrics("authz_test")
	store := policy.NewMemoryStore()

	loadTestPolicies(t, store, 20)

	cfg := engine.Config{
		CacheEnabled:    true,
		CacheSize:       5000,
		CacheTTL:        10 * time.Minute,
		ParallelWorkers: 4,
		Metrics:         m,
	}

	eng, err := engine.New(cfg, store)
	require.NoError(t, err)
	defer eng.Shutdown(context.Background())

	ctx := context.Background()

	// Create workload with high repetition (realistic access pattern)
	// 10% unique requests, 90% repeated requests
	uniqueCount := 50
	totalRequests := 500

	uniqueRequests := make([]*types.CheckRequest, uniqueCount)
	for i := 0; i < uniqueCount; i++ {
		uniqueRequests[i] = &types.CheckRequest{
			Principal: &types.Principal{
				ID:    "user:" + itoa(i%10), // Reuse principals
				Roles: []string{"viewer"},
			},
			Resource: &types.Resource{
				Kind: "document",
				ID:   "doc-" + itoa(i%20), // Reuse resources
			},
			Actions: []string{"read"},
		}
	}

	// Execute mixed workload
	for i := 0; i < totalRequests; i++ {
		reqIdx := i % uniqueCount
		_, _ = eng.Check(ctx, uniqueRequests[reqIdx])
	}

	// Verify hit rate target
	handler := m.HTTPHandler()
	httpReq := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httpReq)

	body := w.Body.String()

	hitRate := calculateCacheHitRate(body)

	t.Logf("Cache hit rate: %.2f%%", hitRate*100)
	assert.Greater(t, hitRate, 0.9, "Cache hit rate should exceed 90%% target")
}

// TestE2E_CacheEviction validates cache eviction under pressure
func TestE2E_CacheEviction(t *testing.T) {
	m := metrics.NewPrometheusMetrics("authz_test")
	store := policy.NewMemoryStore()

	loadTestPolicies(t, store, 10)

	// Small cache to force evictions
	cfg := engine.Config{
		CacheEnabled:    true,
		CacheSize:       50,  // Small cache
		CacheTTL:        1 * time.Minute,
		ParallelWorkers: 4,
		Metrics:         m,
	}

	eng, err := engine.New(cfg, store)
	require.NoError(t, err)
	defer eng.Shutdown(context.Background())

	ctx := context.Background()

	// Phase 1: Fill cache with 50 unique requests
	for i := 0; i < 50; i++ {
		req := &types.CheckRequest{
			Principal: &types.Principal{
				ID:    "user:" + itoa(i),
				Roles: []string{"viewer"},
			},
			Resource: &types.Resource{
				Kind: "document",
				ID:   "doc-" + itoa(i),
			},
			Actions: []string{"read"},
		}
		_, _ = eng.Check(ctx, req)
	}

	// Phase 2: Add 100 more unique requests (will cause evictions)
	for i := 50; i < 150; i++ {
		req := &types.CheckRequest{
			Principal: &types.Principal{
				ID:    "user:" + itoa(i),
				Roles: []string{"viewer"},
			},
			Resource: &types.Resource{
				Kind: "document",
				ID:   "doc-" + itoa(i),
			},
			Actions: []string{"read"},
		}
		_, _ = eng.Check(ctx, req)
	}

	// Verify metrics
	handler := m.HTTPHandler()
	httpReq := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httpReq)

	body := w.Body.String()

	misses := extractMetricValue(body, "authz_test_cache_misses_total")

	// Should have 150 misses (all unique requests)
	assert.InDelta(t, 150.0, misses, 10.0, "Should have ~150 cache misses")

	// Cache hit rate should be low due to evictions
	hitRate := calculateCacheHitRate(body)
	t.Logf("Cache hit rate with evictions: %.2f%%", hitRate*100)
}

// TestE2E_CacheTTL validates cache TTL expiration
func TestE2E_CacheTTL(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping TTL test in short mode")
	}

	m := metrics.NewPrometheusMetrics("authz_test")
	store := policy.NewMemoryStore()

	loadTestPolicies(t, store, 5)

	cfg := engine.Config{
		CacheEnabled:    true,
		CacheSize:       1000,
		CacheTTL:        2 * time.Second, // Short TTL for testing
		ParallelWorkers: 4,
		Metrics:         m,
	}

	eng, err := engine.New(cfg, store)
	require.NoError(t, err)
	defer eng.Shutdown(context.Background())

	ctx := context.Background()

	req := &types.CheckRequest{
		Principal: &types.Principal{
			ID:    "user:ttl",
			Roles: []string{"viewer"},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-ttl",
		},
		Actions: []string{"read"},
	}

	// First request: cache miss
	_, _ = eng.Check(ctx, req)

	// Second request: cache hit
	_, _ = eng.Check(ctx, req)

	// Wait for TTL expiration
	time.Sleep(3 * time.Second)

	// Third request: cache miss (TTL expired)
	_, _ = eng.Check(ctx, req)

	// Verify metrics
	handler := m.HTTPHandler()
	httpReq := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httpReq)

	body := w.Body.String()

	hits := extractMetricValue(body, "authz_test_cache_hits_total")
	misses := extractMetricValue(body, "authz_test_cache_misses_total")

	// Expected: 2 misses (initial + after TTL), 1 hit (before TTL)
	assert.Equal(t, 1.0, hits, "Should have 1 cache hit")
	assert.Equal(t, 2.0, misses, "Should have 2 cache misses (initial + post-TTL)")
}

// TestE2E_CacheDisabled validates metrics with cache disabled
func TestE2E_CacheDisabled(t *testing.T) {
	m := metrics.NewPrometheusMetrics("authz_test")
	store := policy.NewMemoryStore()

	loadTestPolicies(t, store, 10)

	cfg := engine.Config{
		CacheEnabled:    false, // Cache disabled
		ParallelWorkers: 4,
		Metrics:         m,
	}

	eng, err := engine.New(cfg, store)
	require.NoError(t, err)
	defer eng.Shutdown(context.Background())

	ctx := context.Background()

	req := &types.CheckRequest{
		Principal: &types.Principal{
			ID:    "user:nocache",
			Roles: []string{"viewer"},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-1",
		},
		Actions: []string{"read"},
	}

	// Execute same request 100 times
	for i := 0; i < 100; i++ {
		_, _ = eng.Check(ctx, req)
	}

	// Verify: Should have 0 cache hits (cache disabled)
	handler := m.HTTPHandler()
	httpReq := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httpReq)

	body := w.Body.String()

	hits := extractMetricValue(body, "authz_test_cache_hits_total")
	misses := extractMetricValue(body, "authz_test_cache_misses_total")

	assert.Equal(t, 0.0, hits, "Should have 0 cache hits when cache disabled")
	assert.Equal(t, 0.0, misses, "Should have 0 cache misses when cache disabled")
}

// TestE2E_CacheWarmup validates cache warming pattern
func TestE2E_CacheWarmup(t *testing.T) {
	m := metrics.NewPrometheusMetrics("authz_test")
	store := policy.NewMemoryStore()

	loadTestPolicies(t, store, 20)

	cfg := engine.Config{
		CacheEnabled:    true,
		CacheSize:       1000,
		CacheTTL:        10 * time.Minute,
		ParallelWorkers: 4,
		Metrics:         m,
	}

	eng, err := engine.New(cfg, store)
	require.NoError(t, err)
	defer eng.Shutdown(context.Background())

	ctx := context.Background()

	// Create common requests for warmup
	commonRequests := make([]*types.CheckRequest, 20)
	for i := 0; i < 20; i++ {
		commonRequests[i] = &types.CheckRequest{
			Principal: &types.Principal{
				ID:    "user:common:" + itoa(i),
				Roles: []string{"viewer"},
			},
			Resource: &types.Resource{
				Kind: "document",
				ID:   "doc-" + itoa(i),
			},
			Actions: []string{"read"},
		}
	}

	// Warmup phase: Execute each request once
	for _, req := range commonRequests {
		_, _ = eng.Check(ctx, req)
	}

	// Measure hit rate before warmup completes
	handler := m.HTTPHandler()
	httpReq := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httpReq)

	body := w.Body.String()
	hitRateBefore := calculateCacheHitRate(body)

	// Production phase: Execute requests repeatedly
	for i := 0; i < 100; i++ {
		reqIdx := i % len(commonRequests)
		_, _ = eng.Check(ctx, commonRequests[reqIdx])
	}

	// Measure hit rate after warmup
	httpReq = httptest.NewRequest("GET", "/metrics", nil)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httpReq)

	body = w.Body.String()
	hitRateAfter := calculateCacheHitRate(body)

	t.Logf("Hit rate before: %.2f%%, after: %.2f%%", hitRateBefore*100, hitRateAfter*100)

	// Hit rate should improve significantly after warmup
	assert.Greater(t, hitRateAfter, hitRateBefore,
		"Hit rate should improve after cache warmup")
	assert.Greater(t, hitRateAfter, 0.8,
		"Hit rate after warmup should exceed 80%%")
}
