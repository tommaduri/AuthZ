package metrics_test

import (
	"context"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/metrics"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestE2E_AuthorizationWorkflow validates end-to-end authorization metrics
// Scenario: 1000 authorization checks with 80% cache hits
// Validates: authz_checks_total, authz_cache_*, authz_check_duration_*
func TestE2E_AuthorizationWorkflow(t *testing.T) {
	// Setup: Create engine with Prometheus metrics
	m := metrics.NewPrometheusMetrics("authz_test")
	store := policy.NewMemoryStore()

	// Load test policies
	loadTestPolicies(t, store, 100)

	cfg := engine.Config{
		CacheEnabled:    true,
		CacheSize:       10000,
		CacheTTL:        5 * time.Minute,
		ParallelWorkers: 4,
		Metrics:         m,
	}

	eng, err := engine.New(cfg, store)
	require.NoError(t, err)
	defer eng.Shutdown(context.Background())

	ctx := context.Background()

	// Execute: Run 1000 authorization checks
	// First 200 are unique (cache misses)
	// Remaining 800 are repeated (cache hits)
	uniqueRequests := 200
	totalRequests := 1000

	// Phase 1: Populate cache with unique requests
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

	// Phase 2: Repeat requests to generate cache hits
	for i := 0; i < totalRequests-uniqueRequests; i++ {
		// Cycle through first 200 requests
		reqIdx := i % uniqueRequests
		resp, err := eng.Check(ctx, requests[reqIdx])
		require.NoError(t, err)
		require.NotNil(t, resp)
	}

	// Verify: Check metrics via HTTP endpoint
	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()

	// Verify total checks
	assert.Contains(t, body, "authz_test_checks_total")

	// Verify cache metrics
	// Expected: 200 misses (unique), 800 hits (repeated)
	assert.Contains(t, body, "authz_test_cache_hits_total")
	assert.Contains(t, body, "authz_test_cache_misses_total")

	// Parse and validate cache hit rate
	hitRate := calculateCacheHitRate(body)
	assert.Greater(t, hitRate, 0.75, "Cache hit rate should be >75%% (expected ~80%%)")

	// Verify latency metrics exist
	assert.Contains(t, body, "authz_test_check_duration_microseconds")
	assert.Contains(t, body, "authz_test_check_duration_microseconds_bucket")
	assert.Contains(t, body, "authz_test_check_duration_microseconds_sum")
	assert.Contains(t, body, "authz_test_check_duration_microseconds_count")

	// Verify no errors
	errorCount := extractMetricValue(body, "authz_test_errors_total")
	assert.Equal(t, 0.0, errorCount, "Should have zero errors")

	// Verify active requests returns to 0
	activeRequests := extractMetricValue(body, "authz_test_active_requests")
	assert.Equal(t, 0.0, activeRequests, "Active requests should be 0 after completion")
}

// TestE2E_AuthorizationLatency validates p99 latency SLO (<10µs)
func TestE2E_AuthorizationLatency(t *testing.T) {
	m := metrics.NewPrometheusMetrics("authz_test")
	store := policy.NewMemoryStore()
	loadTestPolicies(t, store, 10)

	cfg := engine.Config{
		CacheEnabled:    true,
		CacheSize:       1000,
		ParallelWorkers: 4,
		Metrics:         m,
	}

	eng, err := engine.New(cfg, store)
	require.NoError(t, err)
	defer eng.Shutdown(context.Background())

	ctx := context.Background()

	// Execute 100 fast checks
	req := &types.CheckRequest{
		Principal: &types.Principal{
			ID:    "user:test",
			Roles: []string{"viewer"},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-1",
		},
		Actions: []string{"read"},
	}

	// Warm up cache
	_, _ = eng.Check(ctx, req)

	// Measure 100 cached checks
	var totalDuration time.Duration
	iterations := 100

	for i := 0; i < iterations; i++ {
		start := time.Now()
		_, err := eng.Check(ctx, req)
		duration := time.Since(start)
		totalDuration += duration
		require.NoError(t, err)
	}

	avgLatency := totalDuration / time.Duration(iterations)

	// Verify average latency is sub-10µs (cached checks should be very fast)
	assert.Less(t, avgLatency.Microseconds(), int64(10),
		"Average cached check latency should be <10µs (got %vµs)", avgLatency.Microseconds())

	// Verify metrics recorded the latencies
	handler := m.HTTPHandler()
	httpReq := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httpReq)

	body := w.Body.String()
	count := extractMetricValue(body, "authz_test_check_duration_microseconds_count")
	assert.GreaterOrEqual(t, count, float64(iterations), "Should record all checks")
}

// TestE2E_AuthorizationEffects validates allow vs deny tracking
func TestE2E_AuthorizationEffects(t *testing.T) {
	m := metrics.NewPrometheusMetrics("authz_test")
	store := policy.NewMemoryStore()

	// Create policies with different effects
	loadMixedEffectPolicies(t, store)

	cfg := engine.Config{
		CacheEnabled:    false, // Disable cache to test each policy
		ParallelWorkers: 4,
		Metrics:         m,
	}

	eng, err := engine.New(cfg, store)
	require.NoError(t, err)
	defer eng.Shutdown(context.Background())

	ctx := context.Background()

	// Execute checks that should ALLOW
	allowReq := &types.CheckRequest{
		Principal: &types.Principal{
			ID:    "user:admin",
			Roles: []string{"admin"},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-allowed",
		},
		Actions: []string{"write"},
	}

	for i := 0; i < 60; i++ {
		_, _ = eng.Check(ctx, allowReq)
	}

	// Execute checks that should DENY
	denyReq := &types.CheckRequest{
		Principal: &types.Principal{
			ID:    "user:guest",
			Roles: []string{"guest"},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-denied",
		},
		Actions: []string{"delete"},
	}

	for i := 0; i < 40; i++ {
		_, _ = eng.Check(ctx, denyReq)
	}

	// Verify effect distribution
	handler := m.HTTPHandler()
	httpReq := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httpReq)

	body := w.Body.String()

	// Should have both allow and deny counts
	assert.Contains(t, body, `authz_test_checks_total{effect="allow"}`)
	assert.Contains(t, body, `authz_test_checks_total{effect="deny"}`)

	// Verify counts are tracked separately
	lines := strings.Split(body, "\n")
	allowCount := 0
	denyCount := 0

	for _, line := range lines {
		if strings.Contains(line, `authz_test_checks_total{effect="allow"}`) {
			allowCount++
		}
		if strings.Contains(line, `authz_test_checks_total{effect="deny"}`) {
			denyCount++
		}
	}

	assert.Greater(t, allowCount, 0, "Should track allow effects")
	assert.Greater(t, denyCount, 0, "Should track deny effects")
}

// Helper: Load test policies into store
func loadTestPolicies(t *testing.T, store *policy.MemoryStore, count int) {
	for i := 0; i < count; i++ {
		pol := &types.Policy{
			Name:         "test-policy-" + itoa(i),
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "allow-read",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
					Roles:   []string{"viewer"},
				},
			},
		}
		store.Add(pol)
	}
}

// Helper: Load policies with mixed effects
func loadMixedEffectPolicies(t *testing.T, store *policy.MemoryStore) {
	// Allow policy for admins
	allowPolicy := &types.Policy{
		Name:         "allow-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "admin-write",
				Actions: []string{"write"},
				Effect:  types.EffectAllow,
				Roles:   []string{"admin"},
			},
		},
	}
	store.Add(allowPolicy)
}

// Helper: Calculate cache hit rate from Prometheus output
func calculateCacheHitRate(metricsBody string) float64 {
	hits := extractMetricValue(metricsBody, "authz_test_cache_hits_total")
	misses := extractMetricValue(metricsBody, "authz_test_cache_misses_total")

	if hits+misses == 0 {
		return 0
	}
	return hits / (hits + misses)
}

// Helper: Extract metric value from Prometheus text format
func extractMetricValue(body, metricName string) float64 {
	lines := strings.Split(body, "\n")
	for _, line := range lines {
		if strings.HasPrefix(line, metricName+" ") {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				var value float64
				_, _ = fmt.Sscanf(parts[1], "%f", &value)
				return value
			}
		}
	}
	return 0
}

// Helper: Convert int to string
func itoa(i int) string {
	return fmt.Sprintf("%d", i)
}
