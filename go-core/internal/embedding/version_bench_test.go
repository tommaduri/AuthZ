package embedding

import (
	"context"
	"fmt"
	"testing"

	"github.com/authz-engine/go-core/pkg/types"
)

// BenchmarkVersionCheck measures overhead of version comparison
// Target: <1µs per check
func BenchmarkVersionCheck(b *testing.B) {
	currentVersion := "v2"

	b.Run("version_match", func(b *testing.B) {
		metadata := map[string]interface{}{
			"model_version": "v2",
		}

		b.ResetTimer()
		b.ReportAllocs()

		for i := 0; i < b.N; i++ {
			version, ok := metadata["model_version"]
			if ok && version == currentVersion {
				// Version matches
				_ = version
			}
		}
	})

	b.Run("version_mismatch", func(b *testing.B) {
		metadata := map[string]interface{}{
			"model_version": "v1",
		}

		b.ResetTimer()
		b.ReportAllocs()

		for i := 0; i < b.N; i++ {
			version, ok := metadata["model_version"]
			if !ok || version != currentVersion {
				// Version mismatch - needs re-embedding
				_ = version
			}
		}
	})

	b.Run("version_missing", func(b *testing.B) {
		metadata := map[string]interface{}{
			"policy_kind": "document",
			// No model_version field
		}

		b.ResetTimer()
		b.ReportAllocs()

		for i := 0; i < b.N; i++ {
			_, ok := metadata["model_version"]
			if !ok {
				// No version - legacy embedding
				_ = ok
			}
		}
	})
}

// BenchmarkMigration_1000Policies measures migration performance
// Target: Complete migration of 1000 policies in <30 seconds
func BenchmarkMigration_1000Policies(b *testing.B) {
	policyStore := NewMockPolicyStore()
	vectorStore := NewMockVectorStore()

	// Create 1000 test policies
	policies := make([]*types.Policy, 1000)
	for i := 0; i < 1000; i++ {
		policies[i] = &types.Policy{
			Name:         fmt.Sprintf("policy-%d", i),
			ResourceKind: "document",
			Scope:        "default",
			Rules: []*types.Rule{
				{
					Name:    fmt.Sprintf("rule-%d", i),
					Actions: []string{"view", "edit"},
					Effect:  types.EffectAllow,
					Roles:   []string{"user"},
				},
			},
		}
		policyStore.Add(policies[i])
	}

	cfg := Config{
		NumWorkers:   8,
		QueueSize:    2000,
		Dimension:    384,
		ModelVersion: "v2",
	}

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		b.StopTimer()
		worker, err := NewEmbeddingWorker(cfg, policyStore, vectorStore)
		if err != nil {
			b.Fatal(err)
		}
		b.StartTimer()

		// Submit all policies for migration
		submitted := worker.SubmitBatch(policies, 2) // High priority
		if submitted != len(policies) {
			b.Errorf("expected %d submitted, got %d", len(policies), submitted)
		}

		b.StopTimer()
		ctx := context.Background()
		worker.Shutdown(ctx)
		b.StartTimer()
	}
}

// BenchmarkMigration_ParallelWorkers compares migration speed with different worker counts
func BenchmarkMigration_ParallelWorkers(b *testing.B) {
	workerCounts := []int{1, 2, 4, 8, 16}

	for _, numWorkers := range workerCounts {
		b.Run(fmt.Sprintf("workers_%d", numWorkers), func(b *testing.B) {
			policyStore := NewMockPolicyStore()
			vectorStore := NewMockVectorStore()

			// Create 100 policies for each benchmark
			policies := make([]*types.Policy, 100)
			for i := 0; i < 100; i++ {
				policies[i] = &types.Policy{
					Name:         fmt.Sprintf("policy-%d", i),
					ResourceKind: "document",
					Rules: []*types.Rule{
						{
							Actions: []string{"view"},
							Effect:  types.EffectAllow,
							Roles:   []string{"user"},
						},
					},
				}
				policyStore.Add(policies[i])
			}

			cfg := Config{
				NumWorkers:   numWorkers,
				QueueSize:    200,
				Dimension:    384,
				ModelVersion: "v2",
			}

			b.ResetTimer()
			b.ReportAllocs()

			for i := 0; i < b.N; i++ {
				b.StopTimer()
				worker, err := NewEmbeddingWorker(cfg, policyStore, vectorStore)
				if err != nil {
					b.Fatal(err)
				}
				b.StartTimer()

				worker.SubmitBatch(policies, 2)

				b.StopTimer()
				ctx := context.Background()
				worker.Shutdown(ctx)
				b.StartTimer()
			}
		})
	}
}

// BenchmarkEmbedding_WithVersionMetadata measures overhead of adding version to metadata
func BenchmarkEmbedding_WithVersionMetadata(b *testing.B) {
	b.Run("without_version", func(b *testing.B) {
		b.ReportAllocs()

		for i := 0; i < b.N; i++ {
			metadata := map[string]interface{}{
				"policy_kind": "document",
				"policy_name": "test-policy",
			}
			_ = metadata
		}
	})

	b.Run("with_version", func(b *testing.B) {
		b.ReportAllocs()

		for i := 0; i < b.N; i++ {
			metadata := map[string]interface{}{
				"policy_kind":   "document",
				"policy_name":   "test-policy",
				"model_version": "v2",
			}
			_ = metadata
		}
	})
}

// BenchmarkVersionedHashComputation measures hash computation with version
func BenchmarkVersionedHashComputation(b *testing.B) {
	policy := &types.Policy{
		Name:         "document-edit-policy",
		ResourceKind: "document",
		Scope:        "acme.corp",
		Rules: []*types.Rule{
			{
				Name:      "allow-edit",
				Actions:   []string{"view", "edit"},
				Effect:    types.EffectAllow,
				Roles:     []string{"editor"},
				Condition: "resource.ownerId == principal.id",
			},
		},
	}

	b.Run("hash_without_version", func(b *testing.B) {
		b.ReportAllocs()

		for i := 0; i < b.N; i++ {
			text := SerializePolicyToText(policy)
			hash := ComputePolicyHash(text)
			_ = hash
		}
	})

	b.Run("hash_with_version", func(b *testing.B) {
		modelVersion := "v2"
		b.ReportAllocs()

		for i := 0; i < b.N; i++ {
			text := SerializePolicyToText(policy) + "\nModel: " + modelVersion
			hash := ComputePolicyHash(text)
			_ = hash
		}
	})
}

// BenchmarkConcurrentVersionCheck measures version checking under concurrent load
func BenchmarkConcurrentVersionCheck(b *testing.B) {
	embeddings := make([]map[string]interface{}, 1000)
	for i := 0; i < 1000; i++ {
		embeddings[i] = map[string]interface{}{
			"model_version": "v2",
			"policy_id":     fmt.Sprintf("policy-%d", i),
		}
	}

	currentVersion := "v2"

	b.ResetTimer()
	b.ReportAllocs()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			metadata := embeddings[i%len(embeddings)]
			version, ok := metadata["model_version"]
			if ok && version == currentVersion {
				_ = version
			}
			i++
		}
	})
}

// BenchmarkMigrationDetection measures cost of detecting which policies need migration
func BenchmarkMigrationDetection(b *testing.B) {
	// Create 1000 policies with mixed versions
	embeddings := make([]map[string]interface{}, 1000)
	for i := 0; i < 1000; i++ {
		var version string
		if i%3 == 0 {
			version = "v1" // Old version
		} else if i%3 == 1 {
			version = "v2" // Current version
		}
		// i%3 == 2 has no version (legacy)

		embeddings[i] = map[string]interface{}{
			"policy_id": fmt.Sprintf("policy-%d", i),
		}

		if version != "" {
			embeddings[i]["model_version"] = version
		}
	}

	currentVersion := "v2"

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		needsMigration := make([]int, 0, len(embeddings))

		for idx, metadata := range embeddings {
			version, ok := metadata["model_version"]
			if !ok || version != currentVersion {
				needsMigration = append(needsMigration, idx)
			}
		}

		_ = needsMigration
	}
}
