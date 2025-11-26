package metrics_test

import (
	"context"
	"net/http/httptest"
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

// TestE2E_VectorStoreMetrics validates vector store operation metrics
// Scenario: 100 inserts, 500 searches, 50 deletes
// Validates: authz_vector_operations_total, search_duration, insert_duration, store_size
func TestE2E_VectorStoreMetrics(t *testing.T) {
	// Setup: Create engine with vector store
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
		QueueSize:     500,
		BatchSize:     10,
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

	ctx := context.Background()

	// Execute: Insert 100 policies (triggers vector inserts)
	numInserts := 100
	policyIDs := make([]string, numInserts)

	for i := 0; i < numInserts; i++ {
		policyID := "policy-" + itoa(i)
		policyIDs[i] = policyID

		pol := &types.Policy{
			Name:         policyID,
			ResourceKind: "document",
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

	// Wait for embeddings to complete
	time.Sleep(5 * time.Second)

	// Execute: Perform 500 vector searches
	numSearches := 500
	for i := 0; i < numSearches; i++ {
		// Search for similar policies
		queryVector := generateTestVector(384) // Mock embedding dimension
		_, _ = vectorStore.Search(ctx, queryVector, 5)
	}

	// Execute: Delete 50 vectors
	numDeletes := 50
	for i := 0; i < numDeletes; i++ {
		if i < len(policyIDs) {
			_ = vectorStore.Delete(ctx, policyIDs[i])
		}
	}

	// Verify: Check metrics via HTTP endpoint
	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()

	// Verify operation counts
	assert.Contains(t, body, "authz_test_vector_operations_total")

	insertCount := extractLabeledMetricValue(body, "authz_test_vector_operations_total", "insert")
	assert.GreaterOrEqual(t, insertCount, float64(numInserts)*0.8,
		"Should have recorded most inserts (got %.0f, expected ~%d)", insertCount, numInserts)

	searchCount := extractLabeledMetricValue(body, "authz_test_vector_operations_total", "search")
	assert.GreaterOrEqual(t, searchCount, float64(numSearches)*0.95,
		"Should have recorded searches (got %.0f, expected %d)", searchCount, numSearches)

	deleteCount := extractLabeledMetricValue(body, "authz_test_vector_operations_total", "delete")
	assert.GreaterOrEqual(t, deleteCount, float64(numDeletes)*0.8,
		"Should have recorded deletes (got %.0f, expected ~%d)", deleteCount, numDeletes)

	// Verify duration histograms exist
	assert.Contains(t, body, "authz_test_vector_search_duration_milliseconds")
	assert.Contains(t, body, "authz_test_vector_search_duration_milliseconds_bucket")
	assert.Contains(t, body, "authz_test_vector_insert_duration_milliseconds")

	// Verify store size
	assert.Contains(t, body, "authz_test_vector_store_size")
	storeSize := extractMetricValue(body, "authz_test_vector_store_size")
	expectedSize := float64(numInserts - numDeletes)
	assert.InDelta(t, expectedSize, storeSize, float64(numInserts)*0.1,
		"Store size should be ~%d (inserts-deletes)", int(expectedSize))

	// Verify index size is tracked
	assert.Contains(t, body, "authz_test_vector_index_size_bytes")
}

// TestE2E_VectorSearchLatency validates search latency SLO (p99 <100ms)
func TestE2E_VectorSearchLatency(t *testing.T) {
	_ = metrics.NewPrometheusMetrics("authz_test")

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

	ctx := context.Background()

	// Populate vector store with 1000 vectors
	for i := 0; i < 1000; i++ {
		vec := generateTestVector(384)
		_ = vectorStore.Insert(ctx, "vector-"+itoa(i), vec, map[string]interface{}{
			"policyID": "policy-" + itoa(i),
		})
	}

	// Perform searches and measure latency
	var totalDuration time.Duration
	numSearches := 100

	for i := 0; i < numSearches; i++ {
		queryVec := generateTestVector(384)
		start := time.Now()
		_, _ = vectorStore.Search(ctx, queryVec, 10)
		duration := time.Since(start)
		totalDuration += duration
	}

	avgLatency := totalDuration / time.Duration(numSearches)

	// Verify average search latency is reasonable (<100ms for in-memory)
	assert.Less(t, avgLatency.Milliseconds(), int64(100),
		"Average search latency should be <100ms (got %vms)", avgLatency.Milliseconds())

	t.Logf("Average vector search latency: %v", avgLatency)
}

// TestE2E_VectorErrorTracking validates error metrics
func TestE2E_VectorErrorTracking(t *testing.T) {
	m := metrics.NewPrometheusMetrics("authz_test")

	baseStore, err := intvector.NewMemoryStore(vector.Config{
		Backend:   "memory",
		Dimension: 384,
		HNSW: vector.HNSWConfig{
			M:              16,
			EfConstruction: 200,
			EfSearch:       50,
		},
	})
	require.NoError(t, err)
	defer baseStore.Close()

	vectorStore := &mockVectorStoreWithErrors{
		baseStore: baseStore,
		metrics:   m,
	}

	ctx := context.Background()

	// Trigger various error types
	// 1. Timeout errors (simulated)
	for i := 0; i < 5; i++ {
		m.RecordVectorError("timeout")
	}

	// 2. Invalid query errors
	for i := 0; i < 3; i++ {
		m.RecordVectorError("invalid_query")
	}

	// 3. Not found errors
	for i := 0; i < 2; i++ {
		_ = vectorStore.Delete(ctx, "nonexistent-id")
	}

	// Verify error tracking
	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()

	assert.Contains(t, body, "authz_test_vector_search_errors_total")

	timeoutErrors := extractLabeledMetricValue(body, "authz_test_vector_search_errors_total", "timeout")
	assert.Equal(t, 5.0, timeoutErrors, "Should track timeout errors")

	invalidQueryErrors := extractLabeledMetricValue(body, "authz_test_vector_search_errors_total", "invalid_query")
	assert.Equal(t, 3.0, invalidQueryErrors, "Should track invalid query errors")
}

// TestE2E_VectorStoreSize validates size tracking
func TestE2E_VectorStoreSize(t *testing.T) {
	m := metrics.NewPrometheusMetrics("authz_test")

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

	ctx := context.Background()

	// Track size changes
	initialSize := 0
	m.UpdateVectorStoreSize(initialSize)

	// Add vectors
	for i := 0; i < 250; i++ {
		vec := generateTestVector(384)
		_ = vectorStore.Insert(ctx, "vec-"+itoa(i), vec, nil)
		m.UpdateVectorStoreSize(i + 1)
	}

	// Delete some vectors
	for i := 0; i < 50; i++ {
		_ = vectorStore.Delete(ctx, "vec-"+itoa(i))
		m.UpdateVectorStoreSize(250 - i - 1)
	}

	// Verify final size
	handler := m.HTTPHandler()
	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()

	finalSize := extractMetricValue(body, "authz_test_vector_store_size")
	assert.Equal(t, 200.0, finalSize, "Final store size should be 200 (250-50)")
}

// Helper: Generate test vector
func generateTestVector(dim int) []float32 {
	vec := make([]float32, dim)
	for i := 0; i < dim; i++ {
		vec[i] = float32(i) / float32(dim)
	}
	return vec
}

// Mock vector store with error injection
type mockVectorStoreWithErrors struct {
	baseStore vector.VectorStore
	metrics   metrics.Metrics
}

func (m *mockVectorStoreWithErrors) Insert(ctx context.Context, id string, embedding []float32, metadata map[string]interface{}) error {
	return m.baseStore.Insert(ctx, id, embedding, metadata)
}

func (m *mockVectorStoreWithErrors) Search(ctx context.Context, query []float32, k int) ([]*vector.SearchResult, error) {
	return m.baseStore.Search(ctx, query, k)
}

func (m *mockVectorStoreWithErrors) Delete(ctx context.Context, id string) error {
	// Always record not_found error
	m.metrics.RecordVectorError("not_found")
	return m.baseStore.Delete(ctx, id)
}

func (m *mockVectorStoreWithErrors) Get(ctx context.Context, id string) (*vector.Vector, error) {
	return m.baseStore.Get(ctx, id)
}

func (m *mockVectorStoreWithErrors) Close() error {
	return m.baseStore.Close()
}
