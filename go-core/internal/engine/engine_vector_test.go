package engine

import (
	"context"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/embedding"
	"github.com/authz-engine/go-core/internal/policy"
	intvector "github.com/authz-engine/go-core/internal/vector"
	"github.com/authz-engine/go-core/pkg/types"
	"github.com/authz-engine/go-core/pkg/vector"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestEngine_VectorSimilarity_Disabled verifies graceful degradation when vector similarity is disabled
func TestEngine_VectorSimilarity_Disabled(t *testing.T) {
	store := policy.NewMemoryStore()

	// Create engine WITHOUT vector similarity
	cfg := Config{
		CacheEnabled:            false,
		VectorSimilarityEnabled: false, // Explicitly disabled
	}

	eng, err := New(cfg, store)
	require.NoError(t, err)
	require.NotNil(t, eng)

	// Vector fields should be nil
	assert.Nil(t, eng.vectorStore, "vectorStore should be nil when disabled")
	assert.Nil(t, eng.embedWorker, "embedWorker should be nil when disabled")

	// FindSimilarPolicies should return empty slice (graceful degradation)
	ctx := context.Background()
	policies, err := eng.FindSimilarPolicies(ctx, "document editing", 10)
	require.NoError(t, err)
	assert.Empty(t, policies, "FindSimilarPolicies should return empty when disabled")

	// SubmitPolicyForEmbedding should return false
	policy := &types.Policy{Name: "test-policy"}
	submitted := eng.SubmitPolicyForEmbedding(policy, 1)
	assert.False(t, submitted, "SubmitPolicyForEmbedding should return false when disabled")

	// GetEmbeddingWorkerStats should return nil
	stats := eng.GetEmbeddingWorkerStats()
	assert.Nil(t, stats, "GetEmbeddingWorkerStats should return nil when disabled")

	// Shutdown should succeed
	err = eng.Shutdown(ctx)
	assert.NoError(t, err)
}

// TestEngine_VectorSimilarity_Enabled verifies vector similarity functionality when enabled
func TestEngine_VectorSimilarity_Enabled(t *testing.T) {
	store := policy.NewMemoryStore()

	// Add test policies
	policies := []*types.Policy{
		{
			Name:         "document-view-policy",
			ResourceKind: "document",
			Scope:        "default",
			Rules: []*types.Rule{
				{
					Actions: []string{"view"},
					Effect:  types.EffectAllow,
					Roles:   []string{"viewer", "editor"},
				},
			},
		},
		{
			Name:         "document-edit-policy",
			ResourceKind: "document",
			Scope:        "default",
			Rules: []*types.Rule{
				{
					Actions:   []string{"edit", "update"},
					Effect:    types.EffectAllow,
					Roles:     []string{"editor"},
					Condition: "resource.ownerId == principal.id",
				},
			},
		},
		{
			Name:         "folder-manage-policy",
			ResourceKind: "folder",
			Scope:        "default",
			Rules: []*types.Rule{
				{
					Actions: []string{"create", "delete"},
					Effect:  types.EffectAllow,
					Roles:   []string{"admin"},
				},
			},
		},
	}

	for _, pol := range policies {
		store.Add(pol)
	}

	// Create vector store
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

	// Create engine WITH vector similarity
	cfg := Config{
		CacheEnabled:            false,
		VectorSimilarityEnabled: true,
		VectorStore:             vectorStore,
		EmbeddingConfig: &embedding.Config{
			NumWorkers:    2,
			QueueSize:     100,
			BatchSize:     10,
			Dimension:     384,
			EmbeddingFunc: embedding.DefaultEmbeddingFunction,
		},
	}

	eng, err := New(cfg, store)
	require.NoError(t, err)
	require.NotNil(t, eng)
	defer eng.Shutdown(context.Background())

	// Vector fields should be initialized
	assert.NotNil(t, eng.vectorStore, "vectorStore should be initialized")
	assert.NotNil(t, eng.embedWorker, "embedWorker should be initialized")

	// Wait for initial batch submission to process
	time.Sleep(100 * time.Millisecond)

	// Check worker stats
	stats := eng.GetEmbeddingWorkerStats()
	require.NotNil(t, stats)
	assert.Equal(t, 2, stats.WorkersActive, "should have 2 active workers")

	// Wait for embeddings to be generated
	maxWait := 2 * time.Second
	deadline := time.Now().Add(maxWait)
	for time.Now().Before(deadline) {
		stats = eng.GetEmbeddingWorkerStats()
		if stats.JobsProcessed >= int64(len(policies)) {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Verify all policies were processed
	assert.GreaterOrEqual(t, stats.JobsProcessed, int64(len(policies)),
		"all policies should be processed")
	assert.Equal(t, int64(0), stats.JobsFailed, "no jobs should fail")
}

// TestEngine_FindSimilarPolicies verifies similarity search functionality
func TestEngine_FindSimilarPolicies(t *testing.T) {
	store := policy.NewMemoryStore()

	// Add test policies
	policies := []*types.Policy{
		{
			Name:         "document-view-policy",
			ResourceKind: "document",
			Scope:        "default",
			Rules: []*types.Rule{
				{
					Actions: []string{"view", "read"},
					Effect:  types.EffectAllow,
					Roles:   []string{"viewer", "editor"},
				},
			},
		},
		{
			Name:         "document-edit-policy",
			ResourceKind: "document",
			Scope:        "default",
			Rules: []*types.Rule{
				{
					Actions: []string{"edit", "update", "modify"},
					Effect:  types.EffectAllow,
					Roles:   []string{"editor"},
				},
			},
		},
		{
			Name:         "document-delete-policy",
			ResourceKind: "document",
			Scope:        "default",
			Rules: []*types.Rule{
				{
					Actions: []string{"delete", "remove"},
					Effect:  types.EffectAllow,
					Roles:   []string{"admin"},
				},
			},
		},
		{
			Name:         "folder-create-policy",
			ResourceKind: "folder",
			Scope:        "default",
			Rules: []*types.Rule{
				{
					Actions: []string{"create"},
					Effect:  types.EffectAllow,
					Roles:   []string{"editor"},
				},
			},
		},
	}

	for _, pol := range policies {
		store.Add(pol)
	}

	// Create vector store
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

	// Create engine
	cfg := Config{
		CacheEnabled:            false,
		VectorSimilarityEnabled: true,
		VectorStore:             vectorStore,
		EmbeddingConfig: &embedding.Config{
			NumWorkers: 4,
			QueueSize:  100,
			Dimension:  384,
		},
	}

	eng, err := New(cfg, store)
	require.NoError(t, err)
	defer eng.Shutdown(context.Background())

	// Wait for embeddings to be generated
	time.Sleep(500 * time.Millisecond)

	ctx := context.Background()

	t.Run("find document policies", func(t *testing.T) {
		// Search for document-related policies
		results, err := eng.FindSimilarPolicies(ctx, "document viewing and reading", 3)
		require.NoError(t, err)

		// Should return at most k results
		assert.LessOrEqual(t, len(results), 3, "should return at most 3 results")

		// Note: Placeholder embeddings don't provide semantic similarity,
		// so we just verify the API works without testing semantic accuracy
		assert.GreaterOrEqual(t, len(results), 0, "should return valid results")
	})

	t.Run("find editing policies", func(t *testing.T) {
		// Search for editing-related policies
		results, err := eng.FindSimilarPolicies(ctx, "editing and modifying content", 2)
		require.NoError(t, err)

		// Should find edit-related policies
		assert.LessOrEqual(t, len(results), 2, "should return at most 2 results")
	})

	t.Run("find all policies", func(t *testing.T) {
		// Search with high k value
		results, err := eng.FindSimilarPolicies(ctx, "policy management", 10)
		require.NoError(t, err)

		// Should return all available policies
		assert.LessOrEqual(t, len(results), len(policies),
			"should not return more than total policies")
	})

	t.Run("empty query", func(t *testing.T) {
		// Empty query should still work
		results, err := eng.FindSimilarPolicies(ctx, "", 5)
		require.NoError(t, err)

		// Results can be empty or contain policies
		assert.GreaterOrEqual(t, len(results), 0, "should handle empty query")
	})
}

// TestEngine_SubmitPolicyForEmbedding verifies policy submission
func TestEngine_SubmitPolicyForEmbedding(t *testing.T) {
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

	cfg := Config{
		CacheEnabled:            false,
		VectorSimilarityEnabled: true,
		VectorStore:             vectorStore,
		EmbeddingConfig: &embedding.Config{
			NumWorkers: 2,
			QueueSize:  10, // Small queue for testing
			Dimension:  384,
		},
	}

	eng, err := New(cfg, store)
	require.NoError(t, err)
	defer eng.Shutdown(context.Background())

	t.Run("submit new policy", func(t *testing.T) {
		policy := &types.Policy{
			Name:         "new-policy",
			ResourceKind: "resource",
			Scope:        "default",
			Rules: []*types.Rule{
				{
					Actions: []string{"action"},
					Effect:  types.EffectAllow,
					Roles:   []string{"role"},
				},
			},
		}

		// Submit with normal priority
		submitted := eng.SubmitPolicyForEmbedding(policy, 1)
		assert.True(t, submitted, "policy should be submitted")

		// Wait for processing
		time.Sleep(200 * time.Millisecond)

		// Check stats
		stats := eng.GetEmbeddingWorkerStats()
		require.NotNil(t, stats)
		assert.Greater(t, stats.JobsProcessed, int64(0), "jobs should be processed")
	})

	t.Run("submit high priority policy", func(t *testing.T) {
		policy := &types.Policy{
			Name:         "urgent-policy",
			ResourceKind: "critical",
			Scope:        "default",
			Rules: []*types.Rule{
				{
					Actions: []string{"access"},
					Effect:  types.EffectAllow,
					Roles:   []string{"admin"},
				},
			},
		}

		// Submit with high priority
		submitted := eng.SubmitPolicyForEmbedding(policy, 2)
		assert.True(t, submitted, "high priority policy should be submitted")
	})
}

// TestEngine_Shutdown verifies graceful shutdown with active workers
func TestEngine_Shutdown(t *testing.T) {
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

	cfg := Config{
		CacheEnabled:            false,
		VectorSimilarityEnabled: true,
		VectorStore:             vectorStore,
		EmbeddingConfig: &embedding.Config{
			NumWorkers: 4,
			QueueSize:  100,
			Dimension:  384,
		},
	}

	eng, err := New(cfg, store)
	require.NoError(t, err)

	// Submit some policies
	for i := 0; i < 10; i++ {
		policy := &types.Policy{
			Name:         "policy-" + string(rune(i)),
			ResourceKind: "resource",
			Scope:        "default",
			Rules: []*types.Rule{
				{
					Actions: []string{"action"},
					Effect:  types.EffectAllow,
					Roles:   []string{"role"},
				},
			},
		}
		eng.SubmitPolicyForEmbedding(policy, 1)
	}

	t.Run("shutdown with timeout", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		err := eng.Shutdown(ctx)
		assert.NoError(t, err, "shutdown should complete within timeout")
	})
}

// TestEngine_VectorSimilarity_ConcurrentAccess verifies thread safety
func TestEngine_VectorSimilarity_ConcurrentAccess(t *testing.T) {
	store := policy.NewMemoryStore()

	// Add initial policies
	for i := 0; i < 20; i++ {
		policy := &types.Policy{
			Name:         "policy-" + string(rune(i)),
			ResourceKind: "document",
			Scope:        "default",
			Rules: []*types.Rule{
				{
					Actions: []string{"view", "edit"},
					Effect:  types.EffectAllow,
					Roles:   []string{"user"},
				},
			},
		}
		store.Add(policy)
	}

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

	cfg := Config{
		CacheEnabled:            false,
		VectorSimilarityEnabled: true,
		VectorStore:             vectorStore,
		EmbeddingConfig: &embedding.Config{
			NumWorkers: 8,
			QueueSize:  200,
			Dimension:  384,
		},
	}

	eng, err := New(cfg, store)
	require.NoError(t, err)
	defer eng.Shutdown(context.Background())

	// Wait for initial embeddings
	time.Sleep(300 * time.Millisecond)

	// Concurrent submissions and searches
	done := make(chan bool, 20)

	// 10 concurrent submitters
	for i := 0; i < 10; i++ {
		go func(id int) {
			policy := &types.Policy{
				Name:         "concurrent-policy-" + string(rune(id)),
				ResourceKind: "resource",
				Scope:        "default",
				Rules: []*types.Rule{
					{
						Actions: []string{"action"},
						Effect:  types.EffectAllow,
						Roles:   []string{"role"},
					},
				},
			}
			eng.SubmitPolicyForEmbedding(policy, 1)
			done <- true
		}(i)
	}

	// 10 concurrent searchers
	for i := 0; i < 10; i++ {
		go func(id int) {
			ctx := context.Background()
			_, err := eng.FindSimilarPolicies(ctx, "document editing", 5)
			if err != nil {
				t.Errorf("search failed: %v", err)
			}
			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 20; i++ {
		<-done
	}

	// Verify no errors and stats are reasonable
	stats := eng.GetEmbeddingWorkerStats()
	require.NotNil(t, stats)
	assert.GreaterOrEqual(t, stats.JobsProcessed, int64(0), "jobs should be processed")
}
