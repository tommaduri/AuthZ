package phase5_test

import (
	"context"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAnalystVectorIntegration tests ANALYST agent using vector store for anomaly detection
// DEPENDENCY: Requires Track A (Vector Store) implementation to be complete
func TestAnalystVectorIntegration(t *testing.T) {
	t.Skip("WAITING FOR TRACK A: Vector Store implementation - see ADR-010")

	// Step 1: Create DecisionEngine with VectorStore enabled
	cfg := engine.Config{
		CacheEnabled:       true,
		CacheSize:          10000,
		ParallelWorkers:    4,
		VectorStoreEnabled: true,
		VectorStoreConfig: &engine.VectorStoreConfig{
			Backend:   "memory",
			Dimension: 384,
			HNSW: engine.HNSWConfig{
				M:              16,
				EfConstruction: 200,
				EfSearch:       50,
			},
		},
	}

	store := memory.NewMemoryStore()
	eng, err := engine.New(cfg, store)
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
	vectorStore := eng.GetVectorStore()
	require.NotNil(t, vectorStore, "Vector store should be available")

	stats, err := vectorStore.Stats(context.Background())
	require.NoError(t, err)
	assert.Equal(t, int64(100), stats.TotalVectors, "Should have 100 vectors embedded")

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

	anomalousResp, err := eng.Check(context.Background(), anomalousReq)
	require.NoError(t, err)

	// Generate embedding for anomalous request
	time.Sleep(100 * time.Millisecond)

	// Search for similar decisions
	// TODO: Implement ANALYST agent search API
	// anomalyScore := analyst.DetectAnomaly(anomalousReq, anomalousResp)
	// assert.Greater(t, anomalyScore, 0.8, "Should detect high anomaly score")
}

// TestVectorStorePerformance validates vector store performance targets
// DEPENDENCY: Requires Track A (Vector Store) implementation
func TestVectorStorePerformance(t *testing.T) {
	t.Skip("WAITING FOR TRACK A: Vector Store implementation - see ADR-010")

	cfg := engine.Config{
		VectorStoreEnabled: true,
		VectorStoreConfig: &engine.VectorStoreConfig{
			Backend:   "memory",
			Dimension: 384,
			HNSW: engine.HNSWConfig{
				M:              16,
				EfConstruction: 200,
				EfSearch:       50,
			},
		},
	}

	store := memory.NewMemoryStore()
	eng, err := engine.New(cfg, store)
	require.NoError(t, err)

	vectorStore := eng.GetVectorStore()
	require.NotNil(t, vectorStore)

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
	t.Skip("WAITING FOR TRACK A: Vector Store implementation - see ADR-010")

	// Test WITHOUT vector store
	cfgWithout := engine.Config{
		CacheEnabled:       true,
		VectorStoreEnabled: false,
	}
	storeWithout := memory.NewMemoryStore()
	engWithout, err := engine.New(cfgWithout, storeWithout)
	require.NoError(t, err)

	// Test WITH vector store
	cfgWith := engine.Config{
		CacheEnabled:       true,
		VectorStoreEnabled: true,
		VectorStoreConfig: &engine.VectorStoreConfig{
			Backend:   "memory",
			Dimension: 384,
		},
	}
	storeWith := memory.NewMemoryStore()
	engWith, err := engine.New(cfgWith, storeWith)
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
	// Simple implementation - sort and find percentile
	sorted := make([]time.Duration, len(durations))
	copy(sorted, durations)
	// TODO: Implement proper sorting
	// For now, return max as conservative estimate
	max := time.Duration(0)
	for _, d := range sorted {
		if d > max {
			max = d
		}
	}
	return max
}
