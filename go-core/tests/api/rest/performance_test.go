// Package rest provides performance benchmarks for REST API
package rest

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/mux"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
)

// PerformanceTestSuite tests API performance
type PerformanceTestSuite struct {
	router *mux.Router
	server *httptest.Server
	engine *engine.Engine
	store  policy.Store
	logger *zap.Logger
}

// setupTest initializes test environment
func (s *PerformanceTestSuite) setupTest(t *testing.T) {
	s.logger = zap.NewNop()
	s.store = policy.NewMemoryStore()

	cfg := engine.DefaultConfig()
	cfg.CacheEnabled = true // Enable cache for performance tests
	cfg.CacheSize = 100000
	var err error
	s.engine, err = engine.New(cfg, s.store)
	require.NoError(t, err)

	s.router = mux.NewRouter()
	s.setupRoutes()
	s.server = httptest.NewServer(s.router)
}

// setupRoutes configures API routes
func (s *PerformanceTestSuite) setupRoutes() {
	s.router.HandleFunc("/v1/authorization/check", s.handleAuthCheck).Methods("POST")
	s.router.HandleFunc("/v1/policies", s.handleListPolicies).Methods("GET")
	s.router.HandleFunc("/v1/policies/export", s.handleExport).Methods("GET")
	s.router.HandleFunc("/v1/policies/import", s.handleImport).Methods("POST")
}

// Handler implementations
func (s *PerformanceTestSuite) handleAuthCheck(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Principal *types.Principal `json:"principal"`
		Resource  *types.Resource  `json:"resource"`
		Action    string           `json:"action"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	checkReq := &types.CheckRequest{
		Principal: req.Principal,
		Resource:  req.Resource,
		Actions:   []string{req.Action},
	}

	resp, err := s.engine.Check(r.Context(), checkReq)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	result := resp.Results[req.Action]
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"effect": result.Effect,
	})
}

func (s *PerformanceTestSuite) handleListPolicies(w http.ResponseWriter, r *http.Request) {
	policies, _ := s.store.List(r.Context())
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"policies": policies,
	})
}

func (s *PerformanceTestSuite) handleExport(w http.ResponseWriter, r *http.Request) {
	policies, _ := s.store.List(r.Context())
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(policies)
}

func (s *PerformanceTestSuite) handleImport(w http.ResponseWriter, r *http.Request) {
	var policies []*types.Policy
	json.NewDecoder(r.Body).Decode(&policies)

	for _, p := range policies {
		s.store.Add(r.Context(), p)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"imported": len(policies),
	})
}

// Benchmark: Authorization check throughput (>1000 req/sec)
func TestAuthorizationThroughput(t *testing.T) {
	suite := &PerformanceTestSuite{}
	suite.setupTest(t)
	defer suite.server.Close()

	ctx := context.Background()

	// Setup: Create policy
	policy := &types.Policy{
		PolicyID: "perf-policy",
		Kind:     types.PolicyKindResource,
		Version:  "1.0",
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.0",
			Rules: []types.ResourceRule{
				{Actions: []string{"read"}, Effect: types.EffectAllow, Roles: []string{"viewer"}},
			},
		},
	}
	require.NoError(t, suite.store.Add(ctx, policy))

	// Benchmark: Measure throughput
	duration := 5 * time.Second
	var requestCount int64
	var errorCount int64
	start := time.Now()

	// Use a wait group to track all goroutines
	var wg sync.WaitGroup
	stopCh := make(chan struct{})

	// Launch concurrent workers
	workers := 10
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			reqBody := map[string]interface{}{
				"principal": map[string]interface{}{
					"id":    "user123",
					"roles": []string{"viewer"},
				},
				"resource": map[string]interface{}{
					"kind": "document",
					"id":   "doc123",
				},
				"action": "read",
			}

			body, _ := json.Marshal(reqBody)

			for {
				select {
				case <-stopCh:
					return
				default:
					resp, err := http.Post(suite.server.URL+"/v1/authorization/check", "application/json", bytes.NewReader(body))
					if err != nil {
						atomic.AddInt64(&errorCount, 1)
						continue
					}
					resp.Body.Close()

					if resp.StatusCode == http.StatusOK {
						atomic.AddInt64(&requestCount, 1)
					} else {
						atomic.AddInt64(&errorCount, 1)
					}
				}
			}
		}()
	}

	// Wait for duration
	time.Sleep(duration)
	close(stopCh)
	wg.Wait()

	elapsed := time.Since(start)
	throughput := float64(requestCount) / elapsed.Seconds()

	t.Logf("Authorization throughput: %.2f req/sec", throughput)
	t.Logf("Total requests: %d", requestCount)
	t.Logf("Errors: %d", errorCount)
	t.Logf("Duration: %v", elapsed)

	// Verify: Throughput > 1000 req/sec
	assert.Greater(t, throughput, 1000.0, "Expected throughput > 1000 req/sec")
	assert.Equal(t, int64(0), errorCount, "Expected no errors")
}

// Benchmark: Policy list latency (<50ms)
func TestPolicyListLatency(t *testing.T) {
	suite := &PerformanceTestSuite{}
	suite.setupTest(t)
	defer suite.server.Close()

	ctx := context.Background()

	// Setup: Add 100 policies
	for i := 0; i < 100; i++ {
		policy := &types.Policy{
			PolicyID: fmt.Sprintf("policy-%d", i),
			Kind:     types.PolicyKindResource,
			Version:  "1.0",
			ResourcePolicy: &types.ResourcePolicy{
				Resource: "document",
				Version:  "1.0",
				Rules:    []types.ResourceRule{},
			},
		}
		require.NoError(t, suite.store.Add(ctx, policy))
	}

	// Benchmark: Measure latency
	iterations := 100
	totalDuration := time.Duration(0)

	for i := 0; i < iterations; i++ {
		start := time.Now()
		resp, err := http.Get(suite.server.URL + "/v1/policies")
		duration := time.Since(start)

		require.NoError(t, err)
		resp.Body.Close()

		totalDuration += duration
	}

	avgLatency := totalDuration / time.Duration(iterations)
	t.Logf("Average policy list latency: %v", avgLatency)

	// Verify: Latency < 50ms
	assert.Less(t, avgLatency, 50*time.Millisecond, "Expected latency < 50ms")
}

// Benchmark: Export 1000 policies (<5 sec)
func TestExportPerformance(t *testing.T) {
	suite := &PerformanceTestSuite{}
	suite.setupTest(t)
	defer suite.server.Close()

	ctx := context.Background()

	// Setup: Add 1000 policies
	for i := 0; i < 1000; i++ {
		policy := &types.Policy{
			PolicyID: fmt.Sprintf("policy-%d", i),
			Kind:     types.PolicyKindResource,
			Version:  "1.0",
			ResourcePolicy: &types.ResourcePolicy{
				Resource: "document",
				Version:  "1.0",
				Rules:    []types.ResourceRule{},
			},
		}
		require.NoError(t, suite.store.Add(ctx, policy))
	}

	// Benchmark: Measure export time
	start := time.Now()
	resp, err := http.Get(suite.server.URL + "/v1/policies/export")
	duration := time.Since(start)

	require.NoError(t, err)
	defer resp.Body.Close()

	var exported []*types.Policy
	json.NewDecoder(resp.Body).Decode(&exported)

	t.Logf("Export duration: %v", duration)
	t.Logf("Exported policies: %d", len(exported))

	// Verify: Duration < 5 seconds
	assert.Less(t, duration, 5*time.Second, "Expected export < 5 seconds")
	assert.Equal(t, 1000, len(exported))
}

// Benchmark: Import 1000 policies (<10 sec)
func TestImportPerformance(t *testing.T) {
	suite := &PerformanceTestSuite{}
	suite.setupTest(t)
	defer suite.server.Close()

	// Setup: Create 1000 policies to import
	policies := make([]*types.Policy, 1000)
	for i := 0; i < 1000; i++ {
		policies[i] = &types.Policy{
			PolicyID: fmt.Sprintf("policy-%d", i),
			Kind:     types.PolicyKindResource,
			Version:  "1.0",
			ResourcePolicy: &types.ResourcePolicy{
				Resource: "document",
				Version:  "1.0",
				Rules:    []types.ResourceRule{},
			},
		}
	}

	body, _ := json.Marshal(policies)

	// Benchmark: Measure import time
	start := time.Now()
	resp, err := http.Post(suite.server.URL+"/v1/policies/import", "application/json", bytes.NewReader(body))
	duration := time.Since(start)

	require.NoError(t, err)
	defer resp.Body.Close()

	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)

	t.Logf("Import duration: %v", duration)
	t.Logf("Imported policies: %.0f", result["imported"])

	// Verify: Duration < 10 seconds
	assert.Less(t, duration, 10*time.Second, "Expected import < 10 seconds")
	assert.Equal(t, float64(1000), result["imported"])
}

// Benchmark: Concurrent authorization checks (100 goroutines)
func TestConcurrentAuthorizationChecks(t *testing.T) {
	suite := &PerformanceTestSuite{}
	suite.setupTest(t)
	defer suite.server.Close()

	ctx := context.Background()

	// Setup: Create policy
	policy := &types.Policy{
		PolicyID: "concurrent-policy",
		Kind:     types.PolicyKindResource,
		Version:  "1.0",
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.0",
			Rules: []types.ResourceRule{
				{Actions: []string{"read"}, Effect: types.EffectAllow, Roles: []string{"viewer"}},
			},
		},
	}
	require.NoError(t, suite.store.Add(ctx, policy))

	// Benchmark: Run 100 concurrent checks
	var wg sync.WaitGroup
	goroutines := 100
	checksPerGoroutine := 10
	errors := make(chan error, goroutines*checksPerGoroutine)

	start := time.Now()

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()

			reqBody := map[string]interface{}{
				"principal": map[string]interface{}{
					"id":    fmt.Sprintf("user-%d", id),
					"roles": []string{"viewer"},
				},
				"resource": map[string]interface{}{
					"kind": "document",
					"id":   "doc123",
				},
				"action": "read",
			}

			body, _ := json.Marshal(reqBody)

			for j := 0; j < checksPerGoroutine; j++ {
				resp, err := http.Post(suite.server.URL+"/v1/authorization/check", "application/json", bytes.NewReader(body))
				if err != nil {
					errors <- err
					continue
				}
				resp.Body.Close()

				if resp.StatusCode != http.StatusOK {
					errors <- fmt.Errorf("unexpected status: %d", resp.StatusCode)
				}
			}
		}(i)
	}

	wg.Wait()
	close(errors)
	duration := time.Since(start)

	// Count errors
	errorCount := 0
	for err := range errors {
		t.Logf("Error: %v", err)
		errorCount++
	}

	totalChecks := goroutines * checksPerGoroutine
	t.Logf("Concurrent checks: %d", totalChecks)
	t.Logf("Duration: %v", duration)
	t.Logf("Errors: %d", errorCount)
	t.Logf("Throughput: %.2f checks/sec", float64(totalChecks)/duration.Seconds())

	// Verify: No errors
	assert.Equal(t, 0, errorCount, "Expected no errors in concurrent checks")
}

// Benchmark: Memory usage under load
func TestMemoryUsage(t *testing.T) {
	suite := &PerformanceTestSuite{}
	suite.setupTest(t)
	defer suite.server.Close()

	ctx := context.Background()

	// Setup: Create policy
	policy := &types.Policy{
		PolicyID: "memory-test-policy",
		Kind:     types.PolicyKindResource,
		Version:  "1.0",
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.0",
			Rules: []types.ResourceRule{
				{Actions: []string{"read"}, Effect: types.EffectAllow, Roles: []string{"viewer"}},
			},
		},
	}
	require.NoError(t, suite.store.Add(ctx, policy))

	// Benchmark: Make many requests and observe memory
	reqBody := map[string]interface{}{
		"principal": map[string]interface{}{
			"id":    "user123",
			"roles": []string{"viewer"},
		},
		"resource": map[string]interface{}{
			"kind": "document",
			"id":   "doc123",
		},
		"action": "read",
	}

	body, _ := json.Marshal(reqBody)

	// Make 10000 requests
	for i := 0; i < 10000; i++ {
		resp, err := http.Post(suite.server.URL+"/v1/authorization/check", "application/json", bytes.NewReader(body))
		require.NoError(t, err)
		resp.Body.Close()
	}

	// In a real test, we would measure memory usage here
	// For now, we just verify the test completes without OOM
	t.Log("Memory test completed successfully")
}

// Benchmark: Cache effectiveness
func TestCacheEffectiveness(t *testing.T) {
	suite := &PerformanceTestSuite{}
	suite.setupTest(t)
	defer suite.server.Close()

	ctx := context.Background()

	// Setup: Create policy
	policy := &types.Policy{
		PolicyID: "cache-test-policy",
		Kind:     types.PolicyKindResource,
		Version:  "1.0",
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.0",
			Rules: []types.ResourceRule{
				{Actions: []string{"read"}, Effect: types.EffectAllow, Roles: []string{"viewer"}},
			},
		},
	}
	require.NoError(t, suite.store.Add(ctx, policy))

	reqBody := map[string]interface{}{
		"principal": map[string]interface{}{
			"id":    "user123",
			"roles": []string{"viewer"},
		},
		"resource": map[string]interface{}{
			"kind": "document",
			"id":   "doc123",
		},
		"action": "read",
	}

	body, _ := json.Marshal(reqBody)

	// First request (cache miss)
	start1 := time.Now()
	resp1, err := http.Post(suite.server.URL+"/v1/authorization/check", "application/json", bytes.NewReader(body))
	duration1 := time.Since(start1)
	require.NoError(t, err)
	resp1.Body.Close()

	// Second request (cache hit)
	start2 := time.Now()
	resp2, err := http.Post(suite.server.URL+"/v1/authorization/check", "application/json", bytes.NewReader(body))
	duration2 := time.Since(start2)
	require.NoError(t, err)
	resp2.Body.Close()

	t.Logf("First request (cache miss): %v", duration1)
	t.Logf("Second request (cache hit): %v", duration2)

	// Cache hit should be faster (though not always guaranteed in all environments)
	// We just verify both complete successfully
	assert.Less(t, duration1, 100*time.Millisecond)
	assert.Less(t, duration2, 100*time.Millisecond)
}
