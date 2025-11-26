package engine

import (
	"context"
	"fmt"
	"math/rand"
	"sync"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/embedding"
	"github.com/authz-engine/go-core/internal/policy"
	intvector "github.com/authz-engine/go-core/internal/vector"
	"github.com/authz-engine/go-core/pkg/types"
	"github.com/authz-engine/go-core/pkg/vector"
)

// BenchmarkAuthz_DuringMigration measures authorization latency during migration
// Target: Maintain <10µs p99 latency even during background migration
func BenchmarkAuthz_DuringMigration(b *testing.B) {
	ctx := context.Background()
	store := policy.NewMemoryStore()

	// Add authorization policies
	authPolicies := []*types.Policy{
		{
			Name:         "document-view",
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Actions: []string{"view"},
					Effect:  types.EffectAllow,
					Roles:   []string{"viewer", "editor"},
				},
			},
		},
		{
			Name:         "document-edit",
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Actions: []string{"edit"},
					Effect:  types.EffectAllow,
					Roles:   []string{"editor"},
				},
			},
		},
	}

	for _, pol := range authPolicies {
		store.Add(pol)
	}

	// Add 1000 more policies to create realistic migration load
	for i := 0; i < 1000; i++ {
		pol := &types.Policy{
			Name:         fmt.Sprintf("policy-%d", i),
			ResourceKind: "resource",
			Rules: []*types.Rule{
				{
					Actions: []string{"action"},
					Effect:  types.EffectAllow,
					Roles:   []string{"role"},
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
		CacheEnabled:            true,
		CacheSize:               10000,
		CacheTTL:                5 * time.Minute,
		VectorSimilarityEnabled: true,
		VectorStore:             vectorStore,
		DefaultEffect:           types.EffectDeny,
		ParallelWorkers:         16,
		EmbeddingConfig: &embedding.Config{
			NumWorkers:   8,
			QueueSize:    2000,
			Dimension:    384,
			ModelVersion: "v2",
		},
	}

	eng, err := New(cfg, store)
	if err != nil {
		b.Fatal(err)
	}
	defer eng.Shutdown(ctx)

	// Start background migration
	go func() {
		allPolicies := store.GetAll()
		for _, pol := range allPolicies {
			eng.SubmitPolicyForEmbedding(pol, 1)
			time.Sleep(100 * time.Microsecond) // Slow but continuous migration
		}
	}()

	// Benchmark authorization requests during migration
	req := &types.CheckRequest{
		RequestID: "bench-request",
		Principal: &types.Principal{
			ID:    "user-123",
			Roles: []string{"viewer"},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-456",
		},
		Actions: []string{"view"},
	}

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		req.RequestID = fmt.Sprintf("req-%d", i)
		resp, err := eng.Check(ctx, req)
		if err != nil {
			b.Fatal(err)
		}
		if resp == nil {
			b.Fatal("nil response")
		}
	}
}

// BenchmarkAuthz_DuringMigration_Parallel measures parallel authorization during migration
func BenchmarkAuthz_DuringMigration_Parallel(b *testing.B) {
	ctx := context.Background()
	store := policy.NewMemoryStore()

	// Add policies
	for i := 0; i < 100; i++ {
		pol := &types.Policy{
			Name:         fmt.Sprintf("policy-%d", i),
			ResourceKind: "document",
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
		CacheEnabled:            true,
		CacheSize:               10000,
		CacheTTL:                5 * time.Minute,
		VectorSimilarityEnabled: true,
		VectorStore:             vectorStore,
		DefaultEffect:           types.EffectDeny,
		ParallelWorkers:         16,
		EmbeddingConfig: &embedding.Config{
			NumWorkers:   8,
			QueueSize:    2000,
			Dimension:    384,
			ModelVersion: "v2",
		},
	}

	eng, err := New(cfg, store)
	if err != nil {
		b.Fatal(err)
	}
	defer eng.Shutdown(ctx)

	// Start continuous migration
	stopMigration := make(chan bool)
	go func() {
		allPolicies := store.GetAll()
		for {
			select {
			case <-stopMigration:
				return
			default:
				for _, pol := range allPolicies {
					eng.SubmitPolicyForEmbedding(pol, 1)
					time.Sleep(50 * time.Microsecond)
				}
			}
		}
	}()

	b.ResetTimer()
	b.ReportAllocs()

	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			req := &types.CheckRequest{
				RequestID: fmt.Sprintf("req-%d", i),
				Principal: &types.Principal{
					ID:    fmt.Sprintf("user-%d", i%100),
					Roles: []string{"user"},
				},
				Resource: &types.Resource{
					Kind: "document",
					ID:   fmt.Sprintf("doc-%d", i%100),
				},
				Actions: []string{"view"},
			}

			resp, err := eng.Check(ctx, req)
			if err != nil {
				b.Fatal(err)
			}
			if resp == nil {
				b.Fatal("nil response")
			}
			i++
		}
	})

	close(stopMigration)
}

// BenchmarkAuthz_CachePerformance_DuringMigration measures cache effectiveness during migration
func BenchmarkAuthz_CachePerformance_DuringMigration(b *testing.B) {
	ctx := context.Background()
	store := policy.NewMemoryStore()

	pol := &types.Policy{
		Name:         "document-view",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Actions: []string{"view"},
				Effect:  types.EffectAllow,
				Roles:   []string{"viewer"},
			},
		},
	}
	store.Add(pol)

	// Add policies for migration
	for i := 0; i < 500; i++ {
		store.Add(&types.Policy{
			Name:         fmt.Sprintf("policy-%d", i),
			ResourceKind: "resource",
			Rules: []*types.Rule{
				{
					Actions: []string{"action"},
					Effect:  types.EffectAllow,
					Roles:   []string{"role"},
				},
			},
		})
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
		CacheEnabled:            true,
		CacheSize:               10000,
		CacheTTL:                5 * time.Minute,
		VectorSimilarityEnabled: true,
		VectorStore:             vectorStore,
		DefaultEffect:           types.EffectDeny,
		EmbeddingConfig: &embedding.Config{
			NumWorkers:   8,
			QueueSize:    1000,
			Dimension:    384,
			ModelVersion: "v2",
		},
	}

	eng, err := New(cfg, store)
	if err != nil {
		b.Fatal(err)
	}
	defer eng.Shutdown(ctx)

	// Start migration
	go func() {
		allPolicies := store.GetAll()
		for _, p := range allPolicies {
			eng.SubmitPolicyForEmbedding(p, 1)
			time.Sleep(100 * time.Microsecond)
		}
	}()

	// Same request repeated (should hit cache)
	req := &types.CheckRequest{
		RequestID: "cache-test",
		Principal: &types.Principal{
			ID:    "user-123",
			Roles: []string{"viewer"},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-456",
		},
		Actions: []string{"view"},
	}

	// Warm up cache
	eng.Check(ctx, req)

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		resp, err := eng.Check(ctx, req)
		if err != nil {
			b.Fatal(err)
		}
		if !resp.Metadata.CacheHit {
			b.Fatal("expected cache hit")
		}
	}

	b.StopTimer()

	// Report cache stats
	stats := eng.GetCacheStats()
	if stats != nil {
		b.Logf("Cache hit rate: %.2f%%", stats.HitRate*100)
		b.Logf("Cache hits: %d, misses: %d", stats.Hits, stats.Misses)
	}
}

// BenchmarkAuthz_P99Latency_DuringMigration measures p99 latency during migration
func BenchmarkAuthz_P99Latency_DuringMigration(b *testing.B) {
	ctx := context.Background()
	store := policy.NewMemoryStore()

	// Add policies
	for i := 0; i < 100; i++ {
		pol := &types.Policy{
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
		CacheEnabled:            false, // Disable cache to measure real latency
		VectorSimilarityEnabled: true,
		VectorStore:             vectorStore,
		DefaultEffect:           types.EffectDeny,
		ParallelWorkers:         16,
		EmbeddingConfig: &embedding.Config{
			NumWorkers:   8,
			QueueSize:    1000,
			Dimension:    384,
			ModelVersion: "v2",
		},
	}

	eng, err := New(cfg, store)
	if err != nil {
		b.Fatal(err)
	}
	defer eng.Shutdown(ctx)

	// Start heavy migration load
	stopMigration := make(chan bool)
	go func() {
		allPolicies := store.GetAll()
		for {
			select {
			case <-stopMigration:
				return
			default:
				for _, pol := range allPolicies {
					eng.SubmitPolicyForEmbedding(pol, 2) // High priority
				}
				time.Sleep(10 * time.Millisecond)
			}
		}
	}()

	// Collect latencies
	latencies := make([]time.Duration, 0, b.N)
	var mu sync.Mutex

	req := &types.CheckRequest{
		RequestID: "latency-test",
		Principal: &types.Principal{
			ID:    "user-123",
			Roles: []string{"user"},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-456",
		},
		Actions: []string{"view"},
	}

	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		start := time.Now()
		_, err := eng.Check(ctx, req)
		latency := time.Since(start)

		if err != nil {
			b.Fatal(err)
		}

		mu.Lock()
		latencies = append(latencies, latency)
		mu.Unlock()
	}

	b.StopTimer()
	close(stopMigration)

	// Calculate percentiles
	if len(latencies) > 0 {
		// Sort latencies
		for i := 0; i < len(latencies); i++ {
			for j := i + 1; j < len(latencies); j++ {
				if latencies[i] > latencies[j] {
					latencies[i], latencies[j] = latencies[j], latencies[i]
				}
			}
		}

		p50 := latencies[len(latencies)*50/100]
		p95 := latencies[len(latencies)*95/100]
		p99 := latencies[len(latencies)*99/100]
		max := latencies[len(latencies)-1]

		b.Logf("Latency p50: %v", p50)
		b.Logf("Latency p95: %v", p95)
		b.Logf("Latency p99: %v (target: <10µs)", p99)
		b.Logf("Latency max: %v", max)

		// Verify p99 is under 10µs target
		if p99 > 10*time.Microsecond {
			b.Logf("WARNING: p99 latency %v exceeds 10µs target", p99)
		}
	}
}

// BenchmarkMigration_ImpactOnAuthorization measures authorization throughput degradation
func BenchmarkMigration_ImpactOnAuthorization(b *testing.B) {
	scenarios := []struct {
		name               string
		migrationActive    bool
		migrationIntensity int // policies per second
	}{
		{"no_migration", false, 0},
		{"light_migration", true, 10},
		{"medium_migration", true, 100},
		{"heavy_migration", true, 1000},
	}

	for _, scenario := range scenarios {
		b.Run(scenario.name, func(b *testing.B) {
			ctx := context.Background()
			store := policy.NewMemoryStore()

			// Add policies
			for i := 0; i < 200; i++ {
				pol := &types.Policy{
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
				CacheEnabled:            true,
				CacheSize:               10000,
				CacheTTL:                5 * time.Minute,
				VectorSimilarityEnabled: true,
				VectorStore:             vectorStore,
				DefaultEffect:           types.EffectDeny,
				ParallelWorkers:         16,
				EmbeddingConfig: &embedding.Config{
					NumWorkers:   8,
					QueueSize:    2000,
					Dimension:    384,
					ModelVersion: "v2",
				},
			}

			eng, err := New(cfg, store)
			if err != nil {
				b.Fatal(err)
			}
			defer eng.Shutdown(ctx)

			// Start migration if active
			stopMigration := make(chan bool)
			if scenario.migrationActive {
				go func() {
					allPolicies := store.GetAll()
					interval := time.Second / time.Duration(scenario.migrationIntensity)

					for {
						select {
						case <-stopMigration:
							return
						default:
							for _, pol := range allPolicies {
								eng.SubmitPolicyForEmbedding(pol, 1)
								time.Sleep(interval)
							}
						}
					}
				}()
			}

			b.ResetTimer()
			b.ReportAllocs()

			b.RunParallel(func(pb *testing.PB) {
				i := 0
				for pb.Next() {
					req := &types.CheckRequest{
						RequestID: fmt.Sprintf("req-%d", i),
						Principal: &types.Principal{
							ID:    fmt.Sprintf("user-%d", i%100),
							Roles: []string{"user"},
						},
						Resource: &types.Resource{
							Kind: "document",
							ID:   fmt.Sprintf("doc-%d", i%100),
						},
						Actions: []string{"view"},
					}

					_, err := eng.Check(ctx, req)
					if err != nil {
						b.Fatal(err)
					}
					i++
				}
			})

			if scenario.migrationActive {
				close(stopMigration)
			}
		})
	}
}

// BenchmarkVersionedEmbedding_StorageOverhead measures storage overhead of version metadata
func BenchmarkVersionedEmbedding_StorageOverhead(b *testing.B) {
	b.Run("without_version", func(b *testing.B) {
		b.ReportAllocs()

		for i := 0; i < b.N; i++ {
			metadata := map[string]interface{}{
				"policy_id":   fmt.Sprintf("policy-%d", i),
				"policy_kind": "document",
				"timestamp":   time.Now().Unix(),
			}
			_ = metadata
		}
	})

	b.Run("with_version", func(b *testing.B) {
		b.ReportAllocs()

		for i := 0; i < b.N; i++ {
			metadata := map[string]interface{}{
				"policy_id":     fmt.Sprintf("policy-%d", i),
				"policy_kind":   "document",
				"timestamp":     time.Now().Unix(),
				"model_version": "v2",
			}
			_ = metadata
		}
	})
}

// BenchmarkRandomAuthz_DuringMigration simulates realistic mixed workload
func BenchmarkRandomAuthz_DuringMigration(b *testing.B) {
	ctx := context.Background()
	store := policy.NewMemoryStore()
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))

	// Add diverse policies
	resources := []string{"document", "folder", "file", "project"}
	actions := []string{"view", "edit", "delete", "share", "manage"}
	roles := []string{"viewer", "editor", "admin", "owner"}

	for i := 0; i < 200; i++ {
		pol := &types.Policy{
			Name:         fmt.Sprintf("policy-%d", i),
			ResourceKind: resources[i%len(resources)],
			Rules: []*types.Rule{
				{
					Actions: []string{actions[i%len(actions)]},
					Effect:  types.EffectAllow,
					Roles:   []string{roles[i%len(roles)]},
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
		CacheEnabled:            true,
		CacheSize:               10000,
		CacheTTL:                5 * time.Minute,
		VectorSimilarityEnabled: true,
		VectorStore:             vectorStore,
		DefaultEffect:           types.EffectDeny,
		ParallelWorkers:         16,
		EmbeddingConfig: &embedding.Config{
			NumWorkers:   8,
			QueueSize:    2000,
			Dimension:    384,
			ModelVersion: "v2",
		},
	}

	eng, err := New(cfg, store)
	if err != nil {
		b.Fatal(err)
	}
	defer eng.Shutdown(ctx)

	// Start migration
	stopMigration := make(chan bool)
	go func() {
		allPolicies := store.GetAll()
		for {
			select {
			case <-stopMigration:
				return
			default:
				for _, pol := range allPolicies {
					eng.SubmitPolicyForEmbedding(pol, 1)
					time.Sleep(100 * time.Microsecond)
				}
			}
		}
	}()

	b.ResetTimer()
	b.ReportAllocs()

	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			// Random request
			req := &types.CheckRequest{
				RequestID: fmt.Sprintf("req-%d", rng.Int()),
				Principal: &types.Principal{
					ID:    fmt.Sprintf("user-%d", rng.Intn(100)),
					Roles: []string{roles[rng.Intn(len(roles))]},
				},
				Resource: &types.Resource{
					Kind: resources[rng.Intn(len(resources))],
					ID:   fmt.Sprintf("resource-%d", rng.Intn(1000)),
				},
				Actions: []string{actions[rng.Intn(len(actions))]},
			}

			_, err := eng.Check(ctx, req)
			if err != nil {
				b.Fatal(err)
			}
		}
	})

	close(stopMigration)
}
