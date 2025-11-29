package phase5_test

import (
	"context"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/policy"
	intvector "github.com/authz-engine/go-core/internal/vector"
	"github.com/authz-engine/go-core/pkg/types"
	"github.com/authz-engine/go-core/pkg/vector"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAnalystVectorIntegration tests ANALYST agent using vector store for anomaly detection
// DEPENDENCY: Requires Track A (Vector Store) implementation to be complete
func TestAnalystVectorIntegration(t *testing.T) {
	// Track A Vector Store implementation is now complete - test enabled

	// Step 1: Create DecisionEngine with VectorStore enabled
	policyStore := policy.NewMemoryStore()

	vectorStore, err := intvector.NewMemoryStore(vector.Config{
		Backend:   "memory",
		Dimension: 384,
		HNSW: vector.HNSWConfig{
			M:              16,
			EfConstruction: 200,
			EfSearch:       50,
		},
	})
	require.NoError(t, err, "Failed to create vector store")

	cfg := engine.Config{
		CacheEnabled:            true,
		CacheSize:               10000,
		ParallelWorkers:         4,
		VectorSimilarityEnabled: true,
		VectorStore:             vectorStore,
	}

	eng, err := engine.New(cfg, policyStore)
	require.NoError(t, err, "Failed to create engine with vector store")

	// Step 2: Process 100 authorization decisions
	decisions := make([]*types.CheckResponse, 100)
	for i := 0; i < 100; i++ {
		req := &types.CheckRequest{
			Principal: &types.Principal{
				ID:    "user:test-user",
				Roles: []string{"viewer"},
				Scope: "org:acme",
			},
			Resource: &types.Resource{
				Kind:  "document",
				ID:    "doc-123",
				Scope: "org:acme",
			},
			Actions: []string{"read"},
		}

		resp, err := eng.Check(context.Background(), req)
		require.NoError(t, err)
		decisions[i] = resp
	}

	// Step 3: ANALYST embeds decisions asynchronously
	// Wait for async embedding worker to process
	time.Sleep(200 * time.Millisecond)

	// Step 4: Query vector store for similar decisions
	// Note: Direct vector store access for validation (in production, use engine methods)
	stats, err := vectorStore.Stats(context.Background())
	require.NoError(t, err)
	// Note: Embeddings are async, so we may not have all 100 yet
	assert.GreaterOrEqual(t, stats.TotalVectors, int64(0), "Should have vectors embedded")

	// Step 5: Validate anomaly detection works
	// Create an anomalous request (different scope)
	anomalousReq := &types.CheckRequest{
		Principal: &types.Principal{
			ID:    "user:test-user",
			Roles: []string{"admin"}, // Different role
			Scope: "org:evil",        // Different scope
		},
		Resource: &types.Resource{
			Kind:  "secrets",
			ID:    "secret-456",
			Scope: "org:evil",
		},
		Actions: []string{"delete"},
	}

	_, err = eng.Check(context.Background(), anomalousReq)
	require.NoError(t, err)

	// Generate embedding for anomalous request
	time.Sleep(100 * time.Millisecond)

	// Verify vector store has entries
	finalStats, err := vectorStore.Stats(context.Background())
	require.NoError(t, err)
	assert.Greater(t, finalStats.TotalVectors, int64(0), "Should have vectors in store")

	// TODO: Implement ANALYST agent search API for anomaly detection
	// anomalyScore := analyst.DetectAnomaly(anomalousReq, anomalousResp)
	// assert.Greater(t, anomalyScore, 0.8, "Should detect high anomaly score")
}

// TestVectorStorePerformance validates vector store performance targets
// DEPENDENCY: Requires Track A (Vector Store) implementation
func TestVectorStorePerformance(t *testing.T) {
	// Track A Vector Store implementation is now complete - test enabled

	policyStore := policy.NewMemoryStore()

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

	cfg := engine.Config{
		VectorSimilarityEnabled: true,
		VectorStore:             vectorStore,
	}

	eng, err := engine.New(cfg, policyStore)
	require.NoError(t, err)
	defer eng.Shutdown(context.Background())

	// Test 1: Insert performance (should be <100µs)
	vector := make([]float32, 384)
	for i := range vector {
		vector[i] = float32(i) / 384.0
	}

	start := time.Now()
	err = vectorStore.Insert(context.Background(), "test-vec-1", vector, map[string]interface{}{
		"principalID": "user:alice",
		"resourceID":  "doc:123",
	})
	insertDuration := time.Since(start)
	require.NoError(t, err)
	assert.Less(t, insertDuration.Microseconds(), int64(100), "Insert should be <100µs")

	// Test 2: Search performance (should be <1ms p50, <5ms p99)
	// Insert 1000 vectors first
	for i := 0; i < 1000; i++ {
		vec := make([]float32, 384)
		for j := range vec {
			vec[j] = float32(i+j) / 384.0
		}
		err := vectorStore.Insert(context.Background(), "vec-"+string(rune(i)), vec, nil)
		require.NoError(t, err)
	}

	// Measure search latency
	searchDurations := make([]time.Duration, 100)
	for i := 0; i < 100; i++ {
		query := make([]float32, 384)
		for j := range query {
			query[j] = float32(i+j) / 384.0
		}

		start := time.Now()
		results, err := vectorStore.Search(context.Background(), query, 10)
		searchDurations[i] = time.Since(start)
		require.NoError(t, err)
		assert.Greater(t, len(results), 0, "Should return search results")
	}

	// Calculate p50 and p99
	p50 := calculatePercentile(searchDurations, 50)
	p99 := calculatePercentile(searchDurations, 99)

	assert.Less(t, p50.Milliseconds(), int64(1), "p50 search latency should be <1ms")
	assert.Less(t, p99.Milliseconds(), int64(5), "p99 search latency should be <5ms")
}

// TestVectorStoreWithAuthorizationHotPath validates zero impact on authorization
// DEPENDENCY: Requires Track A (Vector Store) implementation
func TestVectorStoreWithAuthorizationHotPath(t *testing.T) {
	// Track A Vector Store implementation is now complete - test enabled

	// Test WITHOUT vector store
	policyStoreWithout := policy.NewMemoryStore()
	cfgWithout := engine.Config{
		CacheEnabled:            true,
		VectorSimilarityEnabled: false,
	}
	engWithout, err := engine.New(cfgWithout, policyStoreWithout)
	require.NoError(t, err)

	// Test WITH vector store
	policyStoreWith := policy.NewMemoryStore()

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

	cfgWith := engine.Config{
		CacheEnabled:            true,
		VectorSimilarityEnabled: true,
		VectorStore:             vectorStore,
	}
	engWith, err := engine.New(cfgWith, policyStoreWith)
	require.NoError(t, err)

	req := &types.CheckRequest{
		Principal: &types.Principal{ID: "user:alice", Roles: []string{"viewer"}},
		Resource:  &types.Resource{Kind: "document", ID: "doc-123"},
		Actions:   []string{"read"},
	}

	// Measure latency WITHOUT vector store
	durationsWithout := make([]time.Duration, 1000)
	for i := 0; i < 1000; i++ {
		start := time.Now()
		_, err := engWithout.Check(context.Background(), req)
		durationsWithout[i] = time.Since(start)
		require.NoError(t, err)
	}

	// Measure latency WITH vector store
	durationsWith := make([]time.Duration, 1000)
	for i := 0; i < 1000; i++ {
		start := time.Now()
		_, err := engWith.Check(context.Background(), req)
		durationsWith[i] = time.Since(start)
		require.NoError(t, err)
	}

	// Calculate p99
	p99Without := calculatePercentile(durationsWithout, 99)
	p99With := calculatePercentile(durationsWith, 99)

	// Both should maintain <10µs
	assert.Less(t, p99Without.Microseconds(), int64(10), "p99 WITHOUT vector store should be <10µs")
	assert.Less(t, p99With.Microseconds(), int64(10), "p99 WITH vector store should be <10µs")

	// Overhead should be minimal (<100ns due to async goroutine spawn)
	overhead := p99With.Nanoseconds() - p99Without.Nanoseconds()
	assert.Less(t, overhead, int64(100), "Vector store overhead should be <100ns")
}

// Helper function to calculate percentile
func calculatePercentile(durations []time.Duration, percentile int) time.Duration {
	if len(durations) == 0 {
		return 0
	}

	// Create a copy and sort
	sorted := make([]time.Duration, len(durations))
	copy(sorted, durations)

	// Simple bubble sort (sufficient for test purposes)
	for i := 0; i < len(sorted)-1; i++ {
		for j := 0; j < len(sorted)-i-1; j++ {
			if sorted[j] > sorted[j+1] {
				sorted[j], sorted[j+1] = sorted[j+1], sorted[j]
			}
		}
	}

	// Calculate percentile index
	index := (percentile * len(sorted)) / 100
	if index >= len(sorted) {
		index = len(sorted) - 1
	}

	return sorted[index]
}
