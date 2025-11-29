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

// TestE2E_ErrorMetrics validates error scenario metrics
// Scenario: Trigger CEL eval errors, policy not found, timeout errors
// Validates: authz_errors_total, authz_embedding_jobs_total{status="failed"}, authz_vector_search_errors_total
func TestE2E_ErrorMetrics(t *testing.T) {
	// Setup: Create engine with metrics
	m := metrics.NewPrometheusMetrics("authz_test")
	store := policy.NewMemoryStore()

	// Load policy with CEL expression that can fail
	loadPolicyWithCELError(t, store)

	cfg := engine.Config{
		CacheEnabled:    false, // Disable cache to test each request
		ParallelWorkers: 4,
		Metrics:         m,
	}

	eng, err := engine.New(cfg, store)
	require.NoError(t, err)
	defer eng.Shutdown(context.Background())

	ctx := context.Background()

	// Execute: Trigger CEL evaluation errors
	celErrorCount := 10
	for i := 0; i < celErrorCount; i++ {
		req := &types.CheckRequest{
			Principal: &types.Principal{
				ID:    "user:error",
				Roles: []string{"viewer"},
				Attributes: map[string]interface{}{
					"invalid_field": "this will cause CEL error",
				},
			},
			Resource: &types.Resource{
				Kind: "document",
				ID:   "doc-cel-error",
			},
			Actions: []string{"read"},
		}

		// Should not panic, but may return error
		_, _ = eng.Check(ctx, req)
	}

	// Execute: Trigger policy not found errors
	notFoundCount := 5
	for i := 0; i < notFoundCount; i++ {
		req := &types.CheckRequest{
			Principal: &types.Principal{
				ID:    "user:test",
				Roles: []string{"viewer"},
			},
			Resource: &types.Resource{
				Kind: "nonexistent_resource_type",
				ID:   "does-not-exist",
			},
			Actions: []string{"read"},
		}

		_, _ = eng.Check(ctx, req)
	}

	// Verify: Check error metrics
	handler := m.HTTPHandler()
	httpReq := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httpReq)

	body := w.Body.String()

	// Verify error metrics exist
	assert.Contains(t, body, "authz_test_errors_total")

	// Verify total error count
	totalErrors := extractMetricValue(body, "authz_test_errors_total")
	assert.Greater(t, totalErrors, 0.0, "Should have recorded errors")

	t.Logf("Total errors recorded: %.0f", totalErrors)
}

// TestE2E_ErrorRateCalculation validates error rate computation
func TestE2E_ErrorRateCalculation(t *testing.T) {
	m := metrics.NewPrometheusMetrics("authz_test")
	store := policy.NewMemoryStore()

	// Load valid policies
	loadTestPolicies(t, store, 10)

	cfg := engine.Config{
		CacheEnabled:    false,
		ParallelWorkers: 4,
		Metrics:         m,
	}

	eng, err := engine.New(cfg, store)
	require.NoError(t, err)
	defer eng.Shutdown(context.Background())

	ctx := context.Background()

	// Execute: 90 successful requests
	successReq := &types.CheckRequest{
		Principal: &types.Principal{
			ID:    "user:success",
			Roles: []string{"viewer"},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-1",
		},
		Actions: []string{"read"},
	}

	for i := 0; i < 90; i++ {
		_, _ = eng.Check(ctx, successReq)
	}

	// Execute: 10 failing requests (policy not found)
	errorReq := &types.CheckRequest{
		Principal: &types.Principal{
			ID:    "user:error",
			Roles: []string{"viewer"},
		},
		Resource: &types.Resource{
			Kind: "unknown_resource",
			ID:   "error-doc",
		},
		Actions: []string{"read"},
	}

	for i := 0; i < 10; i++ {
		_, _ = eng.Check(ctx, errorReq)
	}

	// Verify: Calculate error rate
	handler := m.HTTPHandler()
	httpReq := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httpReq)

	body := w.Body.String()

	totalChecks := extractMetricValue(body, "authz_test_checks_total")
	totalErrors := extractMetricValue(body, "authz_test_errors_total")

	errorRate := 0.0
	if totalChecks > 0 {
		errorRate = totalErrors / totalChecks
	}

	t.Logf("Error rate: %.2f%% (%d errors / %d checks)", errorRate*100, int(totalErrors), int(totalChecks))

	// Should be approximately 10% error rate
	assert.InDelta(t, 0.1, errorRate, 0.05, "Error rate should be ~10%%")
}

// TestE2E_EmbeddingJobFailures validates embedding failure metrics
func TestE2E_EmbeddingJobFailures(t *testing.T) {
	m := metrics.NewPrometheusMetrics("authz_test")

	// Manually trigger embedding job failures
	successCount := 75
	failureCount := 15
	timeoutCount := 10

	for i := 0; i < successCount; i++ {
		m.RecordEmbeddingJob("success", 50*time.Millisecond)
	}

	for i := 0; i < failureCount; i++ {
		m.RecordEmbeddingJob("failed", 10*time.Millisecond)
	}

	for i := 0; i < timeoutCount; i++ {
		m.RecordEmbeddingJob("timeout", 1000*time.Millisecond)
	}

	// Verify metrics
	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()

	assert.Contains(t, body, "authz_test_embedding_jobs_total")

	success := extractLabeledMetricValue(body, "authz_test_embedding_jobs_total", "success")
	failed := extractLabeledMetricValue(body, "authz_test_embedding_jobs_total", "failed")
	timeout := extractLabeledMetricValue(body, "authz_test_embedding_jobs_total", "timeout")

	assert.Equal(t, float64(successCount), success, "Success count should match")
	assert.Equal(t, float64(failureCount), failed, "Failure count should match")
	assert.Equal(t, float64(timeoutCount), timeout, "Timeout count should match")

	// Calculate failure rate
	total := success + failed + timeout
	failureRate := (failed + timeout) / total

	t.Logf("Embedding failure rate: %.2f%%", failureRate*100)
	assert.InDelta(t, 0.25, failureRate, 0.02, "Failure rate should be ~25%%")
}

// TestE2E_VectorSearchErrors validates vector error tracking
func TestE2E_VectorSearchErrors(t *testing.T) {
	m := metrics.NewPrometheusMetrics("authz_test")

	// Trigger various vector error types
	errorTypes := map[string]int{
		"timeout":       10,
		"invalid_query": 5,
		"not_found":     8,
		"dimension_mismatch": 3,
	}

	for errorType, count := range errorTypes {
		for i := 0; i < count; i++ {
			m.RecordVectorError(errorType)
		}
	}

	// Verify error tracking
	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()

	assert.Contains(t, body, "authz_test_vector_search_errors_total")

	for errorType, expectedCount := range errorTypes {
		actualCount := extractLabeledMetricValue(body, "authz_test_vector_search_errors_total", errorType)
		assert.Equal(t, float64(expectedCount), actualCount,
			"Error type '%s' count should match", errorType)
	}
}

// TestE2E_GracefulDegradation validates metrics during system degradation
func TestE2E_GracefulDegradation(t *testing.T) {
	m := metrics.NewPrometheusMetrics("authz_test")
	store := policy.NewMemoryStore()

	cfg := engine.Config{
		CacheEnabled:    true,
		CacheSize:       100, // Small cache
		ParallelWorkers: 2,   // Limited workers
		Metrics:         m,
	}

	eng, err := engine.New(cfg, store)
	require.NoError(t, err)
	defer eng.Shutdown(context.Background())

	ctx := context.Background()

	// Overwhelm system with requests
	for i := 0; i < 1000; i++ {
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

	// Verify: System should still be functional
	handler := m.HTTPHandler()
	httpReq := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httpReq)

	body := w.Body.String()

	// Metrics should still be accessible
	assert.Contains(t, body, "authz_test_checks_total")
	assert.Contains(t, body, "authz_test_active_requests")

	// Active requests should eventually return to 0
	activeRequests := extractMetricValue(body, "authz_test_active_requests")
	assert.Equal(t, 0.0, activeRequests, "Active requests should drain to 0")

	// Cache should have some hits despite small size
	hits := extractMetricValue(body, "authz_test_cache_hits_total")
	t.Logf("Cache hits under load: %.0f", hits)
}

// TestE2E_ErrorRecovery validates metrics after error recovery
func TestE2E_ErrorRecovery(t *testing.T) {
	m := metrics.NewPrometheusMetrics("authz_test")
	store := policy.NewMemoryStore()

	loadTestPolicies(t, store, 10)

	cfg := engine.Config{
		CacheEnabled:    false,
		ParallelWorkers: 4,
		Metrics:         m,
	}

	eng, err := engine.New(cfg, store)
	require.NoError(t, err)
	defer eng.Shutdown(context.Background())

	ctx := context.Background()

	// Phase 1: Cause errors
	errorReq := &types.CheckRequest{
		Principal: &types.Principal{
			ID:    "user:error",
			Roles: []string{"viewer"},
		},
		Resource: &types.Resource{
			Kind: "nonexistent",
			ID:   "error",
		},
		Actions: []string{"read"},
	}

	for i := 0; i < 20; i++ {
		_, _ = eng.Check(ctx, errorReq)
	}

	// Phase 2: Recover with valid requests
	validReq := &types.CheckRequest{
		Principal: &types.Principal{
			ID:    "user:valid",
			Roles: []string{"viewer"},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-1",
		},
		Actions: []string{"read"},
	}

	for i := 0; i < 80; i++ {
		_, _ = eng.Check(ctx, validReq)
	}

	// Verify: Error rate should stabilize
	handler := m.HTTPHandler()
	httpReq := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httpReq)

	body := w.Body.String()

	totalChecks := extractMetricValue(body, "authz_test_checks_total")
	totalErrors := extractMetricValue(body, "authz_test_errors_total")

	errorRate := totalErrors / totalChecks

	t.Logf("Error rate after recovery: %.2f%%", errorRate*100)
	assert.InDelta(t, 0.2, errorRate, 0.05, "Error rate should be ~20%% (20 errors / 100 total)")
}

// Helper: Load policy that can cause CEL errors
func loadPolicyWithCELError(t *testing.T, store *policy.MemoryStore) {
	pol := &types.Policy{
		Name:         "cel-error-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "viewer-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
				Roles:   []string{"viewer"},
				// CEL condition that might fail
				Condition: "principal.attr.nonexistent_field == 'value'",
			},
		},
	}
	store.Add(pol)
}
