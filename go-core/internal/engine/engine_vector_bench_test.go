package engine

import (
	"context"
	"testing"

	"github.com/authz-engine/go-core/internal/embedding"
	"github.com/authz-engine/go-core/internal/policy"
	intvector "github.com/authz-engine/go-core/internal/vector"
	"github.com/authz-engine/go-core/pkg/types"
	"github.com/authz-engine/go-core/pkg/vector"
)

// BenchmarkEngine_Check_WithoutVectorSimilarity establishes baseline authorization latency
func BenchmarkEngine_Check_WithoutVectorSimilarity(b *testing.B) {
	store := policy.NewMemoryStore()

	// Add test policy
	pol := &types.Policy{
		Name:         "test-policy",
		ResourceKind: "document",
		Scope:        "default",
		Rules: []*types.Rule{
			{
				Actions:   []string{"view", "edit"},
				Effect:    types.EffectAllow,
				Roles:     []string{"editor"},
				Condition: "resource.ownerId == principal.id",
			},
		},
	}
	store.Add(pol)

	// Create engine WITHOUT vector similarity
	cfg := Config{
		CacheEnabled:            true,
		CacheSize:               10000,
		VectorSimilarityEnabled: false,
	}

	eng, err := New(cfg, store)
	if err != nil {
		b.Fatal(err)
	}

	req := &types.CheckRequest{
		Principal: &types.Principal{
			ID:    "user-123",
			Roles: []string{"editor"},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-456",
			Attributes: map[string]interface{}{
				"ownerId": "user-123",
			},
		},
		Actions: []string{"view"},
	}

	ctx := context.Background()

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		_, err := eng.Check(ctx, req)
		if err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkEngine_Check_WithVectorSimilarity validates zero-impact on authorization latency
func BenchmarkEngine_Check_WithVectorSimilarity(b *testing.B) {
	store := policy.NewMemoryStore()

	// Add test policy
	pol := &types.Policy{
		Name:         "test-policy",
		ResourceKind: "document",
		Scope:        "default",
		Rules: []*types.Rule{
			{
				Actions:   []string{"view", "edit"},
				Effect:    types.EffectAllow,
				Roles:     []string{"editor"},
				Condition: "resource.ownerId == principal.id",
			},
		},
	}
	store.Add(pol)

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
	if err != nil {
		b.Fatal(err)
	}

	// Create engine WITH vector similarity
	cfg := Config{
		CacheEnabled:            true,
		CacheSize:               10000,
		VectorSimilarityEnabled: true,
		VectorStore:             vectorStore,
		EmbeddingConfig: &embedding.Config{
			NumWorkers: 4,
			QueueSize:  1000,
			Dimension:  384,
		},
	}

	eng, err := New(cfg, store)
	if err != nil {
		b.Fatal(err)
	}
	defer eng.Shutdown(context.Background())

	req := &types.CheckRequest{
		Principal: &types.Principal{
			ID:    "user-123",
			Roles: []string{"editor"},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-456",
			Attributes: map[string]interface{}{
				"ownerId": "user-123",
			},
		},
		Actions: []string{"view"},
	}

	ctx := context.Background()

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		_, err := eng.Check(ctx, req)
		if err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkEngine_FindSimilarPolicies benchmarks similarity search performance
func BenchmarkEngine_FindSimilarPolicies(b *testing.B) {
	store := policy.NewMemoryStore()

	// Add 100 test policies
	for i := 0; i < 100; i++ {
		pol := &types.Policy{
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
		store.Add(pol)
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
	if err != nil {
		b.Fatal(err)
	}

	cfg := Config{
		CacheEnabled:            false,
		VectorSimilarityEnabled: true,
		VectorStore:             vectorStore,
		EmbeddingConfig: &embedding.Config{
			NumWorkers: 4,
			QueueSize:  1000,
			Dimension:  384,
		},
	}

	eng, err := New(cfg, store)
	if err != nil {
		b.Fatal(err)
	}
	defer eng.Shutdown(context.Background())

	ctx := context.Background()

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		_, err := eng.FindSimilarPolicies(ctx, "document editing permissions", 10)
		if err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkEngine_FindSimilarPolicies_LargeDataset benchmarks with 1000 policies
func BenchmarkEngine_FindSimilarPolicies_LargeDataset(b *testing.B) {
	store := policy.NewMemoryStore()

	// Add 1000 test policies
	for i := 0; i < 1000; i++ {
		pol := &types.Policy{
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
		store.Add(pol)
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
	if err != nil {
		b.Fatal(err)
	}

	cfg := Config{
		CacheEnabled:            false,
		VectorSimilarityEnabled: true,
		VectorStore:             vectorStore,
		EmbeddingConfig: &embedding.Config{
			NumWorkers: 8,
			QueueSize:  2000,
			Dimension:  384,
		},
	}

	eng, err := New(cfg, store)
	if err != nil {
		b.Fatal(err)
	}
	defer eng.Shutdown(context.Background())

	ctx := context.Background()

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		_, err := eng.FindSimilarPolicies(ctx, "document editing permissions", 10)
		if err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkEngine_SubmitPolicyForEmbedding benchmarks async submission
func BenchmarkEngine_SubmitPolicyForEmbedding(b *testing.B) {
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
	if err != nil {
		b.Fatal(err)
	}

	cfg := Config{
		CacheEnabled:            false,
		VectorSimilarityEnabled: true,
		VectorStore:             vectorStore,
		EmbeddingConfig: &embedding.Config{
			NumWorkers: 8,
			QueueSize:  10000,
			Dimension:  384,
		},
	}

	eng, err := New(cfg, store)
	if err != nil {
		b.Fatal(err)
	}
	defer eng.Shutdown(context.Background())

	pol := &types.Policy{
		Name:         "bench-policy",
		ResourceKind: "document",
		Scope:        "default",
		Rules: []*types.Rule{
			{
				Actions: []string{"view"},
				Effect:  types.EffectAllow,
				Roles:   []string{"user"},
			},
		},
	}

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		eng.SubmitPolicyForEmbedding(pol, 1)
	}
}
