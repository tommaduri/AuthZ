package integration_test

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
)

// TestEndToEndScopedEvaluation tests complete scoped authorization workflow
func TestEndToEndScopedEvaluation(t *testing.T) {
	store := policy.NewMemoryStore()
	cfg := engine.DefaultConfig()
	cfg.CacheEnabled = true
	eng, err := engine.New(cfg, store)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	// Setup multi-tenant policies
	policies := []*types.Policy{
		// Global baseline policies
		{
			Name:         "global-read-only",
			ResourceKind: "document",
			Scope:        "",
			Rules: []*types.Rule{
				{
					Name:    "baseline-read",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
					Roles:   []string{"guest"},
				},
			},
		},
		// Acme organization policies
		{
			Name:         "acme-member-policy",
			ResourceKind: "document",
			Scope:        "acme",
			Rules: []*types.Rule{
				{
					Name:    "member-read-write",
					Actions: []string{"read", "write"},
					Effect:  types.EffectAllow,
					Roles:   []string{"member"},
				},
			},
		},
		{
			Name:         "acme-corp-admin-policy",
			ResourceKind: "document",
			Scope:        "acme.corp",
			Rules: []*types.Rule{
				{
					Name:    "admin-full-access",
					Actions: []string{"read", "write", "delete"},
					Effect:  types.EffectAllow,
					Roles:   []string{"admin"},
				},
			},
		},
		{
			Name:         "acme-corp-eng-policy",
			ResourceKind: "document",
			Scope:        "acme.corp.engineering",
			Rules: []*types.Rule{
				{
					Name:    "eng-wildcard",
					Actions: []string{"*"},
					Effect:  types.EffectAllow,
					Roles:   []string{"engineer"},
				},
			},
		},
		// Beta organization policies
		{
			Name:         "beta-lockdown-policy",
			ResourceKind: "document",
			Scope:        "beta",
			Rules: []*types.Rule{
				{
					Name:    "lockdown-deny",
					Actions: []string{"write", "delete"},
					Effect:  types.EffectDeny,
					Roles:   []string{"member"},
				},
			},
		},
	}

	for _, p := range policies {
		if err := store.Add(p); err != nil {
			t.Fatalf("failed to add policy %q: %v", p.Name, err)
		}
	}

	tests := []struct {
		name            string
		principal       *types.Principal
		resource        *types.Resource
		actions         []string
		expectedResults map[string]types.Effect
		expectedScope   string
	}{
		{
			name: "guest uses global policy",
			principal: &types.Principal{
				ID:    "guest1",
				Roles: []string{"guest"},
			},
			resource: &types.Resource{
				Kind: "document",
				ID:   "doc1",
			},
			actions: []string{"read", "write"},
			expectedResults: map[string]types.Effect{
				"read":  types.EffectAllow,
				"write": types.EffectDeny,
			},
			expectedScope: "(global)",
		},
		{
			name: "acme member gets read-write",
			principal: &types.Principal{
				ID:    "user1",
				Roles: []string{"member"},
			},
			resource: &types.Resource{
				Kind:  "document",
				ID:    "doc1",
				Scope: "acme",
			},
			actions: []string{"read", "write", "delete"},
			expectedResults: map[string]types.Effect{
				"read":   types.EffectAllow,
				"write":  types.EffectAllow,
				"delete": types.EffectDeny,
			},
			expectedScope: "acme",
		},
		{
			name: "acme corp admin gets full access",
			principal: &types.Principal{
				ID:    "admin1",
				Roles: []string{"admin"},
			},
			resource: &types.Resource{
				Kind:  "document",
				ID:    "doc1",
				Scope: "acme.corp",
			},
			actions: []string{"read", "write", "delete"},
			expectedResults: map[string]types.Effect{
				"read":   types.EffectAllow,
				"write":  types.EffectAllow,
				"delete": types.EffectAllow,
			},
			expectedScope: "acme.corp",
		},
		{
			name: "engineer in deep scope inherits from engineering",
			principal: &types.Principal{
				ID:    "eng1",
				Roles: []string{"engineer"},
			},
			resource: &types.Resource{
				Kind:  "document",
				ID:    "doc1",
				Scope: "acme.corp.engineering.team.project",
			},
			actions: []string{"read", "write", "delete", "deploy"},
			expectedResults: map[string]types.Effect{
				"read":   types.EffectAllow,
				"write":  types.EffectAllow,
				"delete": types.EffectAllow,
				"deploy": types.EffectAllow,
			},
			expectedScope: "acme.corp.engineering",
		},
		{
			name: "beta member gets lockdown deny",
			principal: &types.Principal{
				ID:    "user2",
				Roles: []string{"member"},
			},
			resource: &types.Resource{
				Kind:  "document",
				ID:    "doc1",
				Scope: "beta",
			},
			actions: []string{"read", "write", "delete"},
			expectedResults: map[string]types.Effect{
				"read":   types.EffectDeny,
				"write":  types.EffectDeny,
				"delete": types.EffectDeny,
			},
			expectedScope: "beta",
		},
		{
			name: "unknown scope falls back to global",
			principal: &types.Principal{
				ID:    "guest1",
				Roles: []string{"guest"},
			},
			resource: &types.Resource{
				Kind:  "document",
				ID:    "doc1",
				Scope: "unknown.org",
			},
			actions: []string{"read"},
			expectedResults: map[string]types.Effect{
				"read": types.EffectAllow,
			},
			expectedScope: "(global)",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := &types.CheckRequest{
				RequestID: "test",
				Principal: tt.principal,
				Resource:  tt.resource,
				Actions:   tt.actions,
			}

			resp, err := eng.Check(context.Background(), req)
			if err != nil {
				t.Fatalf("check failed: %v", err)
			}

			// Verify results for each action
			for action, expectedEffect := range tt.expectedResults {
				result, ok := resp.Results[action]
				if !ok {
					t.Errorf("no result for action %q", action)
					continue
				}

				if result.Effect != expectedEffect {
					t.Errorf("action %q: expected effect %v, got %v", action, expectedEffect, result.Effect)
				}
			}

			// Verify scope resolution
			if resp.Metadata.ScopeResolution.MatchedScope != tt.expectedScope {
				t.Errorf("expected matched scope %q, got %q", tt.expectedScope, resp.Metadata.ScopeResolution.MatchedScope)
			}
		})
	}
}

// TestMultiTenantScenario tests realistic multi-tenant authorization
func TestMultiTenantScenario(t *testing.T) {
	store := policy.NewMemoryStore()
	eng, err := engine.New(engine.DefaultConfig(), store)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	// Simulate three tenants: acme, beta, gamma
	tenants := []string{"acme", "beta", "gamma"}

	// Add tenant-specific policies
	for _, tenant := range tenants {
		// Member policy for each tenant
		memberPolicy := &types.Policy{
			Name:         fmt.Sprintf("%s-member-policy", tenant),
			ResourceKind: "document",
			Scope:        tenant,
			Rules: []*types.Rule{
				{
					Name:    "member-read-write",
					Actions: []string{"read", "write"},
					Effect:  types.EffectAllow,
					Roles:   []string{fmt.Sprintf("%s-member", tenant)},
				},
			},
		}

		// Admin policy for each tenant
		adminPolicy := &types.Policy{
			Name:         fmt.Sprintf("%s-admin-policy", tenant),
			ResourceKind: "document",
			Scope:        tenant,
			Rules: []*types.Rule{
				{
					Name:    "admin-full-access",
					Actions: []string{"*"},
					Effect:  types.EffectAllow,
					Roles:   []string{fmt.Sprintf("%s-admin", tenant)},
				},
			},
		}

		if err := store.Add(memberPolicy); err != nil {
			t.Fatalf("failed to add member policy: %v", err)
		}
		if err := store.Add(adminPolicy); err != nil {
			t.Fatalf("failed to add admin policy: %v", err)
		}
	}

	// Test cross-tenant isolation
	t.Run("cross-tenant isolation", func(t *testing.T) {
		// Acme member tries to access beta document
		req := &types.CheckRequest{
			RequestID: "test",
			Principal: &types.Principal{
				ID:    "user1",
				Roles: []string{"acme-member"},
			},
			Resource: &types.Resource{
				Kind:  "document",
				ID:    "doc1",
				Scope: "beta",
			},
			Actions: []string{"read", "write"},
		}

		resp, err := eng.Check(context.Background(), req)
		if err != nil {
			t.Fatalf("check failed: %v", err)
		}

		// Should deny (no matching role in beta scope)
		if resp.Results["read"].Effect != types.EffectDeny {
			t.Errorf("expected deny for cross-tenant access")
		}
	})

	// Test same-tenant access
	t.Run("same-tenant access", func(t *testing.T) {
		for _, tenant := range tenants {
			req := &types.CheckRequest{
				RequestID: "test",
				Principal: &types.Principal{
					ID:    fmt.Sprintf("user-%s", tenant),
					Roles: []string{fmt.Sprintf("%s-member", tenant)},
				},
				Resource: &types.Resource{
					Kind:  "document",
					ID:    "doc1",
					Scope: tenant,
				},
				Actions: []string{"read", "write"},
			}

			resp, err := eng.Check(context.Background(), req)
			if err != nil {
				t.Fatalf("check failed for tenant %s: %v", tenant, err)
			}

			// Should allow
			if resp.Results["read"].Effect != types.EffectAllow {
				t.Errorf("expected allow for same-tenant access in %s", tenant)
			}
		}
	})
}

// TestScopePerformanceBenchmark tests performance under realistic load
func TestScopePerformanceBenchmark(t *testing.T) {
	store := policy.NewMemoryStore()
	cfg := engine.DefaultConfig()
	cfg.CacheEnabled = true
	eng, err := engine.New(cfg, store)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	// Add 100 policies across different scopes and resource kinds
	for i := 0; i < 100; i++ {
		scope := fmt.Sprintf("org%d.dept%d", i%10, i%5)
		resourceKind := fmt.Sprintf("resource-type-%d", i%5)

		policy := &types.Policy{
			Name:         fmt.Sprintf("policy-%d", i),
			ResourceKind: resourceKind,
			Scope:        scope,
			Rules: []*types.Rule{
				{
					Name:    "rule1",
					Actions: []string{"read", "write"},
					Effect:  types.EffectAllow,
					Roles:   []string{fmt.Sprintf("role-%d", i%10)},
				},
			},
		}

		if err := store.Add(policy); err != nil {
			t.Fatalf("failed to add policy: %v", err)
		}
	}

	// Generate test requests
	requests := make([]*types.CheckRequest, 1000)
	for i := 0; i < 1000; i++ {
		scope := fmt.Sprintf("org%d.dept%d", i%10, i%5)
		resourceKind := fmt.Sprintf("resource-type-%d", i%5)

		requests[i] = &types.CheckRequest{
			RequestID: fmt.Sprintf("req-%d", i),
			Principal: &types.Principal{
				ID:    fmt.Sprintf("user-%d", i%100),
				Roles: []string{fmt.Sprintf("role-%d", i%10)},
			},
			Resource: &types.Resource{
				Kind:  resourceKind,
				ID:    fmt.Sprintf("resource-%d", i),
				Scope: scope,
			},
			Actions: []string{"read", "write"},
		}
	}

	// Warmup
	for i := 0; i < 100; i++ {
		eng.Check(context.Background(), requests[i])
	}

	// Benchmark single-threaded throughput
	start := time.Now()
	for i := 0; i < 1000; i++ {
		_, err := eng.Check(context.Background(), requests[i])
		if err != nil {
			t.Fatalf("check failed: %v", err)
		}
	}
	duration := time.Since(start)

	checksPerSec := float64(1000) / duration.Seconds()
	avgLatency := duration / 1000

	t.Logf("Single-threaded performance:")
	t.Logf("  Throughput: %.0f checks/sec", checksPerSec)
	t.Logf("  Avg latency: %v", avgLatency)

	if checksPerSec < 100000 {
		t.Errorf("throughput too low: %.0f checks/sec (expected > 100K)", checksPerSec)
	}

	if avgLatency > 10*time.Microsecond {
		t.Errorf("latency too high: %v (expected < 10μs)", avgLatency)
	}
}

// TestConcurrentScopedAccess tests concurrent authorization checks
func TestConcurrentScopedAccess(t *testing.T) {
	store := policy.NewMemoryStore()
	cfg := engine.DefaultConfig()
	cfg.CacheEnabled = true
	eng, err := engine.New(cfg, store)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	// Add policies
	policies := []*types.Policy{
		{
			Name:         "acme-policy",
			ResourceKind: "document",
			Scope:        "acme",
			Rules: []*types.Rule{
				{
					Name:    "member-read-write",
					Actions: []string{"read", "write"},
					Effect:  types.EffectAllow,
					Roles:   []string{"member"},
				},
			},
		},
		{
			Name:         "beta-policy",
			ResourceKind: "document",
			Scope:        "beta",
			Rules: []*types.Rule{
				{
					Name:    "member-read",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
					Roles:   []string{"member"},
				},
			},
		},
	}

	for _, p := range policies {
		if err := store.Add(p); err != nil {
			t.Fatalf("failed to add policy: %v", err)
		}
	}

	// Concurrent checks
	var wg sync.WaitGroup
	errors := make(chan error, 100)

	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()

			scope := "acme"
			if idx%2 == 0 {
				scope = "beta"
			}

			req := &types.CheckRequest{
				RequestID: fmt.Sprintf("req-%d", idx),
				Principal: &types.Principal{
					ID:    fmt.Sprintf("user-%d", idx),
					Roles: []string{"member"},
				},
				Resource: &types.Resource{
					Kind:  "document",
					ID:    fmt.Sprintf("doc-%d", idx),
					Scope: scope,
				},
				Actions: []string{"read"},
			}

			resp, err := eng.Check(context.Background(), req)
			if err != nil {
				errors <- fmt.Errorf("check failed: %w", err)
				return
			}

			if resp.Results["read"].Effect != types.EffectAllow {
				errors <- fmt.Errorf("expected allow for read")
			}
		}(i)
	}

	wg.Wait()
	close(errors)

	// Check for errors
	for err := range errors {
		t.Errorf("concurrent check error: %v", err)
	}
}

// TestScopeResolutionCaching tests that scope resolution benefits from caching
func TestScopeResolutionCaching(t *testing.T) {
	store := policy.NewMemoryStore()
	cfg := engine.DefaultConfig()
	cfg.CacheEnabled = true
	eng, err := engine.New(cfg, store)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	policy1 := &types.Policy{
		Name:         "acme-policy",
		ResourceKind: "document",
		Scope:        "acme.corp",
		Rules: []*types.Rule{
			{
				Name:    "read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
				Roles:   []string{"member"},
			},
		},
	}

	if err := store.Add(policy1); err != nil {
		t.Fatalf("failed to add policy: %v", err)
	}

	req := &types.CheckRequest{
		RequestID: "test",
		Principal: &types.Principal{
			ID:    "user1",
			Roles: []string{"member"},
		},
		Resource: &types.Resource{
			Kind:  "document",
			ID:    "doc1",
			Scope: "acme.corp.engineering",
		},
		Actions: []string{"read"},
	}

	// First call - cache miss
	start := time.Now()
	resp1, err := eng.Check(context.Background(), req)
	if err != nil {
		t.Fatalf("first check failed: %v", err)
	}
	firstDuration := time.Since(start)

	if resp1.Metadata.CacheHit {
		t.Error("first call should not be cache hit")
	}

	// Second call - cache hit
	start = time.Now()
	resp2, err := eng.Check(context.Background(), req)
	if err != nil {
		t.Fatalf("second check failed: %v", err)
	}
	secondDuration := time.Since(start)

	if !resp2.Metadata.CacheHit {
		t.Error("second call should be cache hit")
	}

	// Cache hit should be significantly faster
	if secondDuration > firstDuration {
		t.Errorf("cache hit slower than cache miss: %v vs %v", secondDuration, firstDuration)
	}

	t.Logf("Cache miss: %v, Cache hit: %v (%.1fx faster)",
		firstDuration, secondDuration, float64(firstDuration)/float64(secondDuration))
}

// TestComplexScopeHierarchy tests deeply nested scope hierarchies
func TestComplexScopeHierarchy(t *testing.T) {
	store := policy.NewMemoryStore()
	eng, err := engine.New(engine.DefaultConfig(), store)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	// Add policies at different hierarchy levels
	policies := []*types.Policy{
		{
			Name:         "level1-policy",
			ResourceKind: "document",
			Scope:        "a",
			Rules: []*types.Rule{
				{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow, Roles: []string{"user"}},
			},
		},
		{
			Name:         "level3-policy",
			ResourceKind: "document",
			Scope:        "a.b.c",
			Rules: []*types.Rule{
				{Name: "rule3", Actions: []string{"write"}, Effect: types.EffectAllow, Roles: []string{"user"}},
			},
		},
		{
			Name:         "level5-policy",
			ResourceKind: "document",
			Scope:        "a.b.c.d.e",
			Rules: []*types.Rule{
				{Name: "rule5", Actions: []string{"delete"}, Effect: types.EffectAllow, Roles: []string{"user"}},
			},
		},
	}

	for _, p := range policies {
		if err := store.Add(p); err != nil {
			t.Fatalf("failed to add policy: %v", err)
		}
	}

	// Test inheritance at different levels
	tests := []struct {
		scope          string
		action         string
		expectedEffect types.Effect
		expectedScope  string
	}{
		{"a", "read", types.EffectAllow, "a"},
		{"a.b", "read", types.EffectAllow, "a"},
		{"a.b.c", "read", types.EffectAllow, "a"},
		{"a.b.c", "write", types.EffectAllow, "a.b.c"},
		{"a.b.c.d", "write", types.EffectAllow, "a.b.c"},
		{"a.b.c.d.e", "delete", types.EffectAllow, "a.b.c.d.e"},
		{"a.b.c.d.e.f", "delete", types.EffectAllow, "a.b.c.d.e"},
	}

	for _, tt := range tests {
		t.Run(fmt.Sprintf("scope=%s,action=%s", tt.scope, tt.action), func(t *testing.T) {
			req := &types.CheckRequest{
				RequestID: "test",
				Principal: &types.Principal{
					ID:    "user1",
					Roles: []string{"user"},
				},
				Resource: &types.Resource{
					Kind:  "document",
					ID:    "doc1",
					Scope: tt.scope,
				},
				Actions: []string{tt.action},
			}

			resp, err := eng.Check(context.Background(), req)
			if err != nil {
				t.Fatalf("check failed: %v", err)
			}

			if resp.Results[tt.action].Effect != tt.expectedEffect {
				t.Errorf("expected effect %v, got %v", tt.expectedEffect, resp.Results[tt.action].Effect)
			}

			if resp.Metadata.ScopeResolution.MatchedScope != tt.expectedScope {
				t.Errorf("expected matched scope %q, got %q", tt.expectedScope, resp.Metadata.ScopeResolution.MatchedScope)
			}
		})
	}
}

// Benchmark tests

func BenchmarkIntegrationScopedCheck(b *testing.B) {
	store := policy.NewMemoryStore()
	cfg := engine.DefaultConfig()
	cfg.CacheEnabled = false // Disable cache for pure evaluation
	eng, _ := engine.New(cfg, store)

	// Add realistic policy set
	for i := 0; i < 10; i++ {
		policy := &types.Policy{
			Name:         fmt.Sprintf("policy-%d", i),
			ResourceKind: "document",
			Scope:        fmt.Sprintf("org%d.dept%d", i%3, i%2),
			Rules: []*types.Rule{
				{
					Name:    "rule1",
					Actions: []string{"read", "write"},
					Effect:  types.EffectAllow,
					Roles:   []string{fmt.Sprintf("role-%d", i%5)},
				},
			},
		}
		store.Add(policy)
	}

	req := &types.CheckRequest{
		RequestID: "bench",
		Principal: &types.Principal{
			ID:    "user1",
			Roles: []string{"role-1"},
		},
		Resource: &types.Resource{
			Kind:  "document",
			ID:    "doc1",
			Scope: "org1.dept1.team3",
		},
		Actions: []string{"read"},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		eng.Check(context.Background(), req)
	}
}

func BenchmarkIntegrationScopedCheckCached(b *testing.B) {
	store := policy.NewMemoryStore()
	cfg := engine.DefaultConfig()
	cfg.CacheEnabled = true
	eng, _ := engine.New(cfg, store)

	policy := &types.Policy{
		Name:         "test-policy",
		ResourceKind: "document",
		Scope:        "org.dept",
		Rules: []*types.Rule{
			{
				Name:    "rule1",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
				Roles:   []string{"member"},
			},
		},
	}
	store.Add(policy)

	req := &types.CheckRequest{
		RequestID: "bench",
		Principal: &types.Principal{
			ID:    "user1",
			Roles: []string{"member"},
		},
		Resource: &types.Resource{
			Kind:  "document",
			ID:    "doc1",
			Scope: "org.dept.team",
		},
		Actions: []string{"read"},
	}

	// Warmup cache
	eng.Check(context.Background(), req)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		eng.Check(context.Background(), req)
	}
}
