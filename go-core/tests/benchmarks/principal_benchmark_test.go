package benchmarks_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
)

// ============================================================================
// PHASE 3.5 PERFORMANCE BENCHMARKS
// Testing Principal Policies Performance
// Target: O(1) lookup performance for principal index
// ============================================================================

// ============================================================================
// Category 1: Principal Index Benchmarks (5 benchmarks)
// Testing the core O(1) data structures
// ============================================================================

// BenchmarkPrincipalIndexAdd tests adding policies to the principal index
// Expected: < 500ns per operation (hash map insertion is O(1))
func BenchmarkPrincipalIndexAdd(b *testing.B) {
	index := policy.NewPrincipalIndex()

	policies := make([]*types.Policy, b.N)
	for i := 0; i < b.N; i++ {
		policies[i] = &types.Policy{
			Name:            fmt.Sprintf("policy-%d", i),
			PrincipalPolicy: true,
			Principal: &types.PrincipalSelector{
				ID: fmt.Sprintf("user:%d", i%100), // 100 unique users
			},
			Resources: []*types.ResourceSelector{
				{Kind: "document", Scope: ""},
			},
			Rules: []*types.Rule{
				{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow},
			},
		}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		index.Add(policies[i])
	}
}

// BenchmarkPrincipalIndexFindByPrincipal tests O(1) principal ID lookup
// Expected: < 100ns per operation (direct hash map lookup)
// This is the critical path for principal-specific policies
func BenchmarkPrincipalIndexFindByPrincipal(b *testing.B) {
	index := policy.NewPrincipalIndex()

	// Add 1000 policies across 100 users (10 policies per user)
	for i := 0; i < 1000; i++ {
		pol := &types.Policy{
			Name:            fmt.Sprintf("policy-%d", i),
			PrincipalPolicy: true,
			Principal: &types.PrincipalSelector{
				ID: fmt.Sprintf("user:%d", i%100),
			},
			Resources: []*types.ResourceSelector{
				{Kind: "document"},
			},
			Rules: []*types.Rule{
				{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow},
			},
		}
		index.Add(pol)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// Rotate through 100 different users
		_ = index.FindByPrincipal(fmt.Sprintf("user:%d", i%100), "document")
	}
}

// BenchmarkPrincipalIndexFindByRoles tests O(1) role-based lookup
// Expected: < 150ns per operation (hash map lookup + small array iteration)
func BenchmarkPrincipalIndexFindByRoles(b *testing.B) {
	index := policy.NewPrincipalIndex()

	roles := []string{"admin", "manager", "viewer", "editor", "owner"}

	// Add 500 policies across 5 roles (100 policies per role)
	for i := 0; i < 500; i++ {
		pol := &types.Policy{
			Name:            fmt.Sprintf("policy-%d", i),
			PrincipalPolicy: true,
			Principal: &types.PrincipalSelector{
				Roles: []string{roles[i%len(roles)]},
			},
			Resources: []*types.ResourceSelector{
				{Kind: "document"},
			},
			Rules: []*types.Rule{
				{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow},
			},
		}
		index.Add(pol)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// Rotate through different roles
		role := roles[i%len(roles)]
		_ = index.FindByRoles([]string{role}, "document")
	}
}

// BenchmarkPrincipalIndexConcurrentLookup tests concurrent read performance
// Expected: Linear scalability with number of cores
// RWMutex should allow concurrent readers without contention
func BenchmarkPrincipalIndexConcurrentLookup(b *testing.B) {
	index := policy.NewPrincipalIndex()

	// Add 1000 policies
	for i := 0; i < 1000; i++ {
		pol := &types.Policy{
			Name:            fmt.Sprintf("policy-%d", i),
			PrincipalPolicy: true,
			Principal: &types.PrincipalSelector{
				ID: fmt.Sprintf("user:%d", i%100),
			},
			Resources: []*types.ResourceSelector{
				{Kind: "document"},
			},
			Rules: []*types.Rule{
				{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow},
			},
		}
		index.Add(pol)
	}

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			_ = index.FindByPrincipal(fmt.Sprintf("user:%d", i%100), "document")
			i++
		}
	})
}

// BenchmarkPrincipalIndexLargeDataset tests performance with 10k policies
// Expected: Still < 200ns per lookup (O(1) should scale independently of dataset size)
func BenchmarkPrincipalIndexLargeDataset(b *testing.B) {
	index := policy.NewPrincipalIndex()

	// Add 10,000 policies across 1000 users
	for i := 0; i < 10000; i++ {
		pol := &types.Policy{
			Name:            fmt.Sprintf("policy-%d", i),
			PrincipalPolicy: true,
			Principal: &types.PrincipalSelector{
				ID: fmt.Sprintf("user:%d", i%1000),
			},
			Resources: []*types.ResourceSelector{
				{Kind: "document"},
			},
			Rules: []*types.Rule{
				{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow},
			},
		}
		index.Add(pol)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = index.FindByPrincipal(fmt.Sprintf("user:%d", i%1000), "document")
	}
}

// ============================================================================
// Category 2: Engine Evaluation Benchmarks (5 benchmarks)
// Testing end-to-end authorization decision performance
// ============================================================================

// BenchmarkEnginePrincipalSpecificPolicy tests principal-specific policy evaluation
// Expected: < 1μs for simple policies without CEL conditions
func BenchmarkEnginePrincipalSpecificPolicy(b *testing.B) {
	store := policy.NewMemoryStore()
	eng, _ := engine.New(engine.DefaultConfig(), store)

	// Add principal-specific policy
	pol := &types.Policy{
		Name:            "alice-docs-policy",
		PrincipalPolicy: true,
		Principal: &types.PrincipalSelector{
			ID: "user:alice",
		},
		Resources: []*types.ResourceSelector{
			{Kind: "document", Scope: ""},
		},
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	}
	store.Add(pol)

	req := &types.CheckRequest{
		RequestID: "bench-1",
		Principal: &types.Principal{
			ID:    "user:alice",
			Roles: []string{},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-1",
		},
		Actions: []string{"read"},
		Context: map[string]interface{}{},
	}

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = eng.Check(ctx, req)
	}
}

// BenchmarkEngineRoleBasedPolicy tests role-based principal policy evaluation
// Expected: < 1.5μs (includes role matching overhead)
func BenchmarkEngineRoleBasedPolicy(b *testing.B) {
	store := policy.NewMemoryStore()
	eng, _ := engine.New(engine.DefaultConfig(), store)

	// Add role-based policy
	pol := &types.Policy{
		Name:            "admin-policy",
		PrincipalPolicy: true,
		Principal: &types.PrincipalSelector{
			Roles: []string{"admin"},
		},
		Resources: []*types.ResourceSelector{
			{Kind: "document", Scope: "**"},
		},
		Rules: []*types.Rule{
			{
				Name:    "allow-all",
				Actions: []string{"*"},
				Effect:  types.EffectAllow,
			},
		},
	}
	store.Add(pol)

	req := &types.CheckRequest{
		RequestID: "bench-2",
		Principal: &types.Principal{
			ID:    "user:bob",
			Roles: []string{"admin", "viewer"},
		},
		Resource: &types.Resource{
			Kind:  "document",
			ID:    "doc-1",
			Scope: "acme.corp",
		},
		Actions: []string{"read"},
		Context: map[string]interface{}{},
	}

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = eng.Check(ctx, req)
	}
}

// BenchmarkEngineResourcePolicy tests traditional resource policy evaluation (baseline)
// Expected: < 2μs (Phase 2 performance baseline)
func BenchmarkEngineResourcePolicy(b *testing.B) {
	store := policy.NewMemoryStore()
	eng, _ := engine.New(engine.DefaultConfig(), store)

	// Add traditional resource policy (NOT principal policy)
	pol := &types.Policy{
		Name:         "docs-policy",
		ResourceKind: "document",
		PrincipalPolicy: false, // Traditional resource policy
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

	req := &types.CheckRequest{
		RequestID: "bench-3",
		Principal: &types.Principal{
			ID:    "user:charlie",
			Roles: []string{"viewer"},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-1",
		},
		Actions: []string{"read"},
		Context: map[string]interface{}{},
	}

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = eng.Check(ctx, req)
	}
}

// BenchmarkEngineMixedPolicies tests evaluation with both principal and resource policies
// Expected: < 2μs (should evaluate principal policies first, skip resource policies)
func BenchmarkEngineMixedPolicies(b *testing.B) {
	store := policy.NewMemoryStore()
	eng, _ := engine.New(engine.DefaultConfig(), store)

	// Add principal-specific policy (highest priority)
	principalPol := &types.Policy{
		Name:            "alice-docs-specific",
		PrincipalPolicy: true,
		Principal: &types.PrincipalSelector{
			ID: "user:alice",
		},
		Resources: []*types.ResourceSelector{
			{Kind: "document", Scope: ""},
		},
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	}
	store.Add(principalPol)

	// Add resource policy (lower priority, should not be evaluated)
	resourcePol := &types.Policy{
		Name:            "docs-resource-policy",
		ResourceKind:    "document",
		PrincipalPolicy: false,
		Rules: []*types.Rule{
			{
				Name:    "allow-all",
				Actions: []string{"*"},
				Effect:  types.EffectAllow,
			},
		},
	}
	store.Add(resourcePol)

	req := &types.CheckRequest{
		RequestID: "bench-4",
		Principal: &types.Principal{
			ID:    "user:alice",
			Roles: []string{},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-1",
		},
		Actions: []string{"read"},
		Context: map[string]interface{}{},
	}

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = eng.Check(ctx, req)
	}
}

// BenchmarkEngineDenyOverrides tests deny-overrides performance within a tier
// Expected: < 1.5μs (early termination on deny)
func BenchmarkEngineDenyOverrides(b *testing.B) {
	store := policy.NewMemoryStore()
	eng, _ := engine.New(engine.DefaultConfig(), store)

	// Add allow policy
	allowPol := &types.Policy{
		Name:            "alice-allow-read",
		PrincipalPolicy: true,
		Principal: &types.PrincipalSelector{
			ID: "user:alice",
		},
		Resources: []*types.ResourceSelector{
			{Kind: "document", Scope: ""},
		},
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	}
	store.Add(allowPol)

	// Add deny policy (should override)
	denyPol := &types.Policy{
		Name:            "alice-deny-delete",
		PrincipalPolicy: true,
		Principal: &types.PrincipalSelector{
			ID: "user:alice",
		},
		Resources: []*types.ResourceSelector{
			{Kind: "document", Scope: ""},
		},
		Rules: []*types.Rule{
			{
				Name:    "deny-delete",
				Actions: []string{"delete"},
				Effect:  types.EffectDeny,
			},
		},
	}
	store.Add(denyPol)

	req := &types.CheckRequest{
		RequestID: "bench-5",
		Principal: &types.Principal{
			ID:    "user:alice",
			Roles: []string{},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-1",
		},
		Actions: []string{"delete"},
		Context: map[string]interface{}{},
	}

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = eng.Check(ctx, req)
	}
}

// ============================================================================
// Category 3: Cache Benchmarks (3 benchmarks)
// Testing cache performance with principal policies
// ============================================================================

// BenchmarkCacheWithRoles tests cache lookup with role combinations
// Expected: < 50ns (direct cache hit)
// Cache key includes sorted roles for consistent hashing
func BenchmarkCacheWithRoles(b *testing.B) {
	store := policy.NewMemoryStore()
	cfg := engine.DefaultConfig()
	cfg.CacheEnabled = true
	eng, _ := engine.New(cfg, store)

	// Add role-based policy
	pol := &types.Policy{
		Name:            "admin-policy",
		PrincipalPolicy: true,
		Principal: &types.PrincipalSelector{
			Roles: []string{"admin"},
		},
		Resources: []*types.ResourceSelector{
			{Kind: "document", Scope: ""},
		},
		Rules: []*types.Rule{
			{
				Name:    "allow-all",
				Actions: []string{"*"},
				Effect:  types.EffectAllow,
			},
		},
	}
	store.Add(pol)

	req := &types.CheckRequest{
		RequestID: "bench-6",
		Principal: &types.Principal{
			ID:    "user:admin1",
			Roles: []string{"admin", "viewer"}, // Multiple roles
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-1",
		},
		Actions: []string{"read"},
		Context: map[string]interface{}{},
	}

	ctx := context.Background()

	// Prime the cache
	eng.Check(ctx, req)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = eng.Check(ctx, req)
	}
}

// BenchmarkCacheInvalidation tests cache invalidation on policy change
// Expected: < 100ns (cache clear is fast)
func BenchmarkCacheInvalidation(b *testing.B) {
	store := policy.NewMemoryStore()
	cfg := engine.DefaultConfig()
	cfg.CacheEnabled = true
	eng, _ := engine.New(cfg, store)

	// Add initial policy
	pol := &types.Policy{
		Name:            "test-policy",
		PrincipalPolicy: true,
		Principal: &types.PrincipalSelector{
			ID: "user:test",
		},
		Resources: []*types.ResourceSelector{
			{Kind: "document", Scope: ""},
		},
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	}
	store.Add(pol)

	req := &types.CheckRequest{
		RequestID: "bench-7",
		Principal: &types.Principal{
			ID:    "user:test",
			Roles: []string{},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-1",
		},
		Actions: []string{"read"},
		Context: map[string]interface{}{},
	}

	ctx := context.Background()
	eng.Check(ctx, req) // Prime cache

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		eng.ClearCache()
	}
}

// BenchmarkCacheConcurrentAccess tests concurrent cache access
// Expected: Linear scalability (LRU cache uses sync.RWMutex)
func BenchmarkCacheConcurrentAccess(b *testing.B) {
	store := policy.NewMemoryStore()
	cfg := engine.DefaultConfig()
	cfg.CacheEnabled = true
	eng, _ := engine.New(cfg, store)

	// Add policy
	pol := &types.Policy{
		Name:            "shared-policy",
		PrincipalPolicy: true,
		Principal: &types.PrincipalSelector{
			Roles: []string{"user"},
		},
		Resources: []*types.ResourceSelector{
			{Kind: "document", Scope: ""},
		},
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	}
	store.Add(pol)

	ctx := context.Background()

	// Prime cache with different requests
	for i := 0; i < 10; i++ {
		req := &types.CheckRequest{
			RequestID: fmt.Sprintf("bench-8-%d", i),
			Principal: &types.Principal{
				ID:    fmt.Sprintf("user:%d", i),
				Roles: []string{"user"},
			},
			Resource: &types.Resource{
				Kind: "document",
				ID:   fmt.Sprintf("doc-%d", i),
			},
			Actions: []string{"read"},
			Context: map[string]interface{}{},
		}
		eng.Check(ctx, req)
	}

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			req := &types.CheckRequest{
				RequestID: fmt.Sprintf("bench-8-%d", i%10),
				Principal: &types.Principal{
					ID:    fmt.Sprintf("user:%d", i%10),
					Roles: []string{"user"},
				},
				Resource: &types.Resource{
					Kind: "document",
					ID:   fmt.Sprintf("doc-%d", i%10),
				},
				Actions: []string{"read"},
				Context: map[string]interface{}{},
			}
			eng.Check(ctx, req)
			i++
		}
	})
}

// ============================================================================
// Category 4: Comparison Benchmarks (2 benchmarks)
// Direct comparison between principal and resource policies
// ============================================================================

// BenchmarkPrincipalVsResourcePolicy compares principal vs resource policy performance
// This benchmark runs both approaches side-by-side
func BenchmarkPrincipalVsResourcePolicy(b *testing.B) {
	b.Run("PrincipalPolicy", func(b *testing.B) {
		store := policy.NewMemoryStore()
		eng, _ := engine.New(engine.DefaultConfig(), store)

		pol := &types.Policy{
			Name:            "alice-principal-policy",
			PrincipalPolicy: true,
			Principal: &types.PrincipalSelector{
				ID: "user:alice",
			},
			Resources: []*types.ResourceSelector{
				{Kind: "document", Scope: ""},
			},
			Rules: []*types.Rule{
				{
					Name:    "allow-read",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
				},
			},
		}
		store.Add(pol)

		req := &types.CheckRequest{
			RequestID: "comparison-principal",
			Principal: &types.Principal{
				ID:    "user:alice",
				Roles: []string{},
			},
			Resource: &types.Resource{
				Kind: "document",
				ID:   "doc-1",
			},
			Actions: []string{"read"},
			Context: map[string]interface{}{},
		}

		ctx := context.Background()

		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_, _ = eng.Check(ctx, req)
		}
	})

	b.Run("ResourcePolicy", func(b *testing.B) {
		store := policy.NewMemoryStore()
		eng, _ := engine.New(engine.DefaultConfig(), store)

		pol := &types.Policy{
			Name:            "docs-resource-policy",
			ResourceKind:    "document",
			PrincipalPolicy: false,
			Rules: []*types.Rule{
				{
					Name:    "allow-read",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
				},
			},
		}
		store.Add(pol)

		req := &types.CheckRequest{
			RequestID: "comparison-resource",
			Principal: &types.Principal{
				ID:    "user:alice",
				Roles: []string{},
			},
			Resource: &types.Resource{
				Kind: "document",
				ID:   "doc-1",
			},
			Actions: []string{"read"},
			Context: map[string]interface{}{},
		}

		ctx := context.Background()

		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_, _ = eng.Check(ctx, req)
		}
	})
}

// BenchmarkPriorityEvaluationOverhead tests overhead of priority-based evaluation
// Measures the cost of checking multiple policy tiers vs single tier
func BenchmarkPriorityEvaluationOverhead(b *testing.B) {
	b.Run("SingleTier", func(b *testing.B) {
		store := policy.NewMemoryStore()
		eng, _ := engine.New(engine.DefaultConfig(), store)

		// Only principal-specific policy
		pol := &types.Policy{
			Name:            "alice-docs",
			PrincipalPolicy: true,
			Principal: &types.PrincipalSelector{
				ID: "user:alice",
			},
			Resources: []*types.ResourceSelector{
				{Kind: "document", Scope: ""},
			},
			Rules: []*types.Rule{
				{
					Name:    "allow-read",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
				},
			},
		}
		store.Add(pol)

		req := &types.CheckRequest{
			RequestID: "priority-single",
			Principal: &types.Principal{
				ID:    "user:alice",
				Roles: []string{},
			},
			Resource: &types.Resource{
				Kind: "document",
				ID:   "doc-1",
			},
			Actions: []string{"read"},
			Context: map[string]interface{}{},
		}

		ctx := context.Background()

		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_, _ = eng.Check(ctx, req)
		}
	})

	b.Run("MultipleTiers", func(b *testing.B) {
		store := policy.NewMemoryStore()
		eng, _ := engine.New(engine.DefaultConfig(), store)

		// Principal-specific policy (will match)
		principalPol := &types.Policy{
			Name:            "alice-docs",
			PrincipalPolicy: true,
			Principal: &types.PrincipalSelector{
				ID: "user:alice",
			},
			Resources: []*types.ResourceSelector{
				{Kind: "document", Scope: ""},
			},
			Rules: []*types.Rule{
				{
					Name:    "allow-read",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
				},
			},
		}
		store.Add(principalPol)

		// Role-based policy (not evaluated due to priority)
		rolePol := &types.Policy{
			Name:            "admin-docs",
			PrincipalPolicy: true,
			Principal: &types.PrincipalSelector{
				Roles: []string{"admin"},
			},
			Resources: []*types.ResourceSelector{
				{Kind: "document", Scope: ""},
			},
			Rules: []*types.Rule{
				{
					Name:    "allow-all",
					Actions: []string{"*"},
					Effect:  types.EffectAllow,
				},
			},
		}
		store.Add(rolePol)

		// Resource policy (not evaluated due to priority)
		resourcePol := &types.Policy{
			Name:            "docs-policy",
			ResourceKind:    "document",
			PrincipalPolicy: false,
			Rules: []*types.Rule{
				{
					Name:    "allow-read",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
				},
			},
		}
		store.Add(resourcePol)

		req := &types.CheckRequest{
			RequestID: "priority-multiple",
			Principal: &types.Principal{
				ID:    "user:alice",
				Roles: []string{"admin"},
			},
			Resource: &types.Resource{
				Kind: "document",
				ID:   "doc-1",
			},
			Actions: []string{"read"},
			Context: map[string]interface{}{},
		}

		ctx := context.Background()

		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_, _ = eng.Check(ctx, req)
		}
	})
}

// ============================================================================
// Additional Utility Benchmarks
// ============================================================================

// BenchmarkPolicyResolutionMetadata tests overhead of collecting policy resolution metadata
func BenchmarkPolicyResolutionMetadata(b *testing.B) {
	store := policy.NewMemoryStore()
	eng, _ := engine.New(engine.DefaultConfig(), store)

	pol := &types.Policy{
		Name:            "alice-docs",
		PrincipalPolicy: true,
		Principal: &types.PrincipalSelector{
			ID: "user:alice",
		},
		Resources: []*types.ResourceSelector{
			{Kind: "document", Scope: ""},
		},
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	}
	store.Add(pol)

	req := &types.CheckRequest{
		RequestID:       "metadata-bench",
		IncludeMetadata: true, // Request metadata
		Principal: &types.Principal{
			ID:    "user:alice",
			Roles: []string{},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-1",
		},
		Actions: []string{"read"},
		Context: map[string]interface{}{},
	}

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = eng.Check(ctx, req)
	}
}

// BenchmarkMultiActionEvaluation tests evaluating multiple actions in one request
func BenchmarkMultiActionEvaluation(b *testing.B) {
	store := policy.NewMemoryStore()
	eng, _ := engine.New(engine.DefaultConfig(), store)

	pol := &types.Policy{
		Name:            "alice-docs",
		PrincipalPolicy: true,
		Principal: &types.PrincipalSelector{
			ID: "user:alice",
		},
		Resources: []*types.ResourceSelector{
			{Kind: "document", Scope: ""},
		},
		Rules: []*types.Rule{
			{
				Name:    "allow-read-write",
				Actions: []string{"read", "write", "delete"},
				Effect:  types.EffectAllow,
			},
		},
	}
	store.Add(pol)

	req := &types.CheckRequest{
		RequestID: "multi-action",
		Principal: &types.Principal{
			ID:    "user:alice",
			Roles: []string{},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-1",
		},
		Actions: []string{"read", "write", "delete"}, // Multiple actions
		Context: map[string]interface{}{},
	}

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = eng.Check(ctx, req)
	}
}

// BenchmarkWildcardResourceMatching tests wildcard * resource kind matching performance
func BenchmarkWildcardResourceMatching(b *testing.B) {
	store := policy.NewMemoryStore()
	eng, _ := engine.New(engine.DefaultConfig(), store)

	pol := &types.Policy{
		Name:            "alice-all-resources",
		PrincipalPolicy: true,
		Principal: &types.PrincipalSelector{
			ID: "user:alice",
		},
		Resources: []*types.ResourceSelector{
			{Kind: "*", Scope: "**"}, // Wildcard everything
		},
		Rules: []*types.Rule{
			{
				Name:    "allow-all",
				Actions: []string{"*"},
				Effect:  types.EffectAllow,
			},
		},
	}
	store.Add(pol)

	req := &types.CheckRequest{
		RequestID: "wildcard",
		Principal: &types.Principal{
			ID:    "user:alice",
			Roles: []string{},
		},
		Resource: &types.Resource{
			Kind:  "document",
			ID:    "doc-1",
			Scope: "acme.corp.engineering",
		},
		Actions: []string{"read"},
		Context: map[string]interface{}{},
	}

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = eng.Check(ctx, req)
	}
}

// BenchmarkBatchCheckRequests tests batch evaluation performance
func BenchmarkBatchCheckRequests(b *testing.B) {
	store := policy.NewMemoryStore()
	eng, _ := engine.New(engine.DefaultConfig(), store)

	pol := &types.Policy{
		Name:            "user-policy",
		PrincipalPolicy: true,
		Principal: &types.PrincipalSelector{
			Roles: []string{"user"},
		},
		Resources: []*types.ResourceSelector{
			{Kind: "document", Scope: ""},
		},
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	}
	store.Add(pol)

	// Create batch of 10 requests
	requests := make([]*types.CheckRequest, 10)
	for i := 0; i < 10; i++ {
		requests[i] = &types.CheckRequest{
			RequestID: fmt.Sprintf("batch-%d", i),
			Principal: &types.Principal{
				ID:    fmt.Sprintf("user:%d", i),
				Roles: []string{"user"},
			},
			Resource: &types.Resource{
				Kind: "document",
				ID:   fmt.Sprintf("doc-%d", i),
			},
			Actions: []string{"read"},
			Context: map[string]interface{}{},
		}
	}

	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = eng.CheckBatch(ctx, requests)
	}
}
