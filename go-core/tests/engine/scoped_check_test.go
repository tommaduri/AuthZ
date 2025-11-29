package engine_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
)

// TestCheckWithScope tests authorization checks with scoped policies
func TestCheckWithScope(t *testing.T) {
	store := policy.NewMemoryStore()
	eng, err := engine.New(engine.DefaultConfig(), store)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	// Add policies with different scopes
	policies := []*types.Policy{
		{
			Name:         "global-policy",
			ResourceKind: "document",
			Scope:        "",
			Rules: []*types.Rule{
				{
					Name:    "global-read",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
					Roles:   []string{"viewer"},
				},
			},
		},
		{
			Name:         "acme-policy",
			ResourceKind: "document",
			Scope:        "acme",
			Rules: []*types.Rule{
				{
					Name:    "acme-read-write",
					Actions: []string{"read", "write"},
					Effect:  types.EffectAllow,
					Roles:   []string{"member"},
				},
			},
		},
		{
			Name:         "acme-corp-policy",
			ResourceKind: "document",
			Scope:        "acme.corp",
			Rules: []*types.Rule{
				{
					Name:    "corp-full-access",
					Actions: []string{"read", "write", "delete"},
					Effect:  types.EffectAllow,
					Roles:   []string{"admin"},
				},
			},
		},
	}

	for _, p := range policies {
		if err := store.Add(p); err != nil {
			t.Fatalf("failed to add policy: %v", err)
		}
	}

	tests := []struct {
		name           string
		principal      *types.Principal
		resource       *types.Resource
		actions        []string
		expectedEffect types.Effect
		expectedScope  string
	}{
		{
			name: "scoped resource uses scoped policy",
			principal: &types.Principal{
				ID:    "user1",
				Roles: []string{"member"},
			},
			resource: &types.Resource{
				Kind:  "document",
				ID:    "doc1",
				Scope: "acme",
			},
			actions:        []string{"read"},
			expectedEffect: types.EffectAllow,
			expectedScope:  "acme",
		},
		{
			name: "more specific scope takes precedence",
			principal: &types.Principal{
				ID:    "user1",
				Roles: []string{"admin"},
			},
			resource: &types.Resource{
				Kind:  "document",
				ID:    "doc1",
				Scope: "acme.corp",
			},
			actions:        []string{"delete"},
			expectedEffect: types.EffectAllow,
			expectedScope:  "acme.corp",
		},
		{
			name: "no scope uses global policy",
			principal: &types.Principal{
				ID:    "user1",
				Roles: []string{"viewer"},
			},
			resource: &types.Resource{
				Kind: "document",
				ID:   "doc1",
			},
			actions:        []string{"read"},
			expectedEffect: types.EffectAllow,
			expectedScope:  "(global)",
		},
		{
			name: "scope with no policy falls back to global",
			principal: &types.Principal{
				ID:    "user1",
				Roles: []string{"viewer"},
			},
			resource: &types.Resource{
				Kind:  "document",
				ID:    "doc1",
				Scope: "beta.company",
			},
			actions:        []string{"read"},
			expectedEffect: types.EffectAllow,
			expectedScope:  "(global)",
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

			for _, action := range tt.actions {
				result, ok := resp.Results[action]
				if !ok {
					t.Errorf("no result for action %q", action)
					continue
				}

				if result.Effect != tt.expectedEffect {
					t.Errorf("action %q: expected effect %v, got %v", action, tt.expectedEffect, result.Effect)
				}
			}

			if resp.Metadata.ScopeResolution.MatchedScope != tt.expectedScope {
				t.Errorf("expected matched scope %q, got %q", tt.expectedScope, resp.Metadata.ScopeResolution.MatchedScope)
			}
		})
	}
}

// TestScopeInheritance tests hierarchical scope resolution
func TestScopeInheritance(t *testing.T) {
	store := policy.NewMemoryStore()
	eng, err := engine.New(engine.DefaultConfig(), store)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	// Add policy for parent scope only
	policy1 := &types.Policy{
		Name:         "acme-policy",
		ResourceKind: "document",
		Scope:        "acme",
		Rules: []*types.Rule{
			{
				Name:    "acme-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
				Roles:   []string{"member"},
			},
		},
	}

	if err := store.Add(policy1); err != nil {
		t.Fatalf("failed to add policy: %v", err)
	}

	// Request with more specific scope should inherit parent policy
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

	resp, err := eng.Check(context.Background(), req)
	if err != nil {
		t.Fatalf("check failed: %v", err)
	}

	// Should allow (inherited from acme scope)
	if resp.Results["read"].Effect != types.EffectAllow {
		t.Errorf("expected allow effect, got %v", resp.Results["read"].Effect)
	}

	// Should match parent scope
	if resp.Metadata.ScopeResolution.MatchedScope != "acme" {
		t.Errorf("expected matched scope 'acme', got %q", resp.Metadata.ScopeResolution.MatchedScope)
	}

	// Should have correct inheritance chain
	expectedChain := []string{"acme.corp.engineering", "acme.corp", "acme"}
	chain := resp.Metadata.ScopeResolution.InheritanceChain
	if len(chain) != len(expectedChain) {
		t.Errorf("expected chain length %d, got %d", len(expectedChain), len(chain))
	} else {
		for i, expected := range expectedChain {
			if chain[i] != expected {
				t.Errorf("chain[%d]: expected %q, got %q", i, expected, chain[i])
			}
		}
	}
}

// TestPrincipalScope tests using principal scope when resource scope is not set
func TestPrincipalScope(t *testing.T) {
	store := policy.NewMemoryStore()
	eng, err := engine.New(engine.DefaultConfig(), store)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	policy1 := &types.Policy{
		Name:         "acme-policy",
		ResourceKind: "document",
		Scope:        "acme",
		Rules: []*types.Rule{
			{
				Name:    "acme-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
				Roles:   []string{"member"},
			},
		},
	}

	if err := store.Add(policy1); err != nil {
		t.Fatalf("failed to add policy: %v", err)
	}

	// Request with principal scope but no resource scope
	req := &types.CheckRequest{
		RequestID: "test",
		Principal: &types.Principal{
			ID:    "user1",
			Roles: []string{"member"},
			Scope: "acme",
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc1",
		},
		Actions: []string{"read"},
	}

	resp, err := eng.Check(context.Background(), req)
	if err != nil {
		t.Fatalf("check failed: %v", err)
	}

	if resp.Results["read"].Effect != types.EffectAllow {
		t.Errorf("expected allow effect, got %v", resp.Results["read"].Effect)
	}

	if resp.Metadata.ScopeResolution.MatchedScope != "acme" {
		t.Errorf("expected matched scope 'acme', got %q", resp.Metadata.ScopeResolution.MatchedScope)
	}
}

// TestResourceScopeTakesPrecedence tests that resource scope overrides principal scope
func TestResourceScopeTakesPrecedence(t *testing.T) {
	store := policy.NewMemoryStore()
	eng, err := engine.New(engine.DefaultConfig(), store)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	policies := []*types.Policy{
		{
			Name:         "acme-policy",
			ResourceKind: "document",
			Scope:        "acme",
			Rules: []*types.Rule{
				{
					Name:    "acme-read",
					Actions: []string{"read"},
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
					Name:    "beta-read",
					Actions: []string{"read"},
					Effect:  types.EffectDeny,
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

	// Resource scope should take precedence over principal scope
	req := &types.CheckRequest{
		RequestID: "test",
		Principal: &types.Principal{
			ID:    "user1",
			Roles: []string{"member"},
			Scope: "acme",
		},
		Resource: &types.Resource{
			Kind:  "document",
			ID:    "doc1",
			Scope: "beta",
		},
		Actions: []string{"read"},
	}

	resp, err := eng.Check(context.Background(), req)
	if err != nil {
		t.Fatalf("check failed: %v", err)
	}

	// Should use beta policy (deny)
	if resp.Results["read"].Effect != types.EffectDeny {
		t.Errorf("expected deny effect, got %v", resp.Results["read"].Effect)
	}

	if resp.Metadata.ScopeResolution.MatchedScope != "beta" {
		t.Errorf("expected matched scope 'beta', got %q", resp.Metadata.ScopeResolution.MatchedScope)
	}
}

// TestInvalidScopeFailsClosed tests that invalid scopes result in deny
func TestInvalidScopeFailsClosed(t *testing.T) {
	store := policy.NewMemoryStore()
	eng, err := engine.New(engine.DefaultConfig(), store)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	// Request with invalid scope (contains invalid characters)
	req := &types.CheckRequest{
		RequestID: "test",
		Principal: &types.Principal{
			ID:    "user1",
			Roles: []string{"admin"},
		},
		Resource: &types.Resource{
			Kind:  "document",
			ID:    "doc1",
			Scope: "acme@corp",
		},
		Actions: []string{"read"},
	}

	resp, err := eng.Check(context.Background(), req)
	if err != nil {
		t.Fatalf("check failed: %v", err)
	}

	// Should deny (fail closed)
	if resp.Results["read"].Effect != types.EffectDeny {
		t.Errorf("expected deny effect for invalid scope, got %v", resp.Results["read"].Effect)
	}

	if resp.Metadata.ScopeResolution.MatchedScope != "(invalid)" {
		t.Errorf("expected matched scope '(invalid)', got %q", resp.Metadata.ScopeResolution.MatchedScope)
	}
}

// TestGlobalFallback tests fallback to global policies
func TestGlobalFallback(t *testing.T) {
	store := policy.NewMemoryStore()
	eng, err := engine.New(engine.DefaultConfig(), store)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	// Add only a global policy
	globalPolicy := &types.Policy{
		Name:         "global-policy",
		ResourceKind: "document",
		Scope:        "",
		Rules: []*types.Rule{
			{
				Name:    "global-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
				Roles:   []string{"member"},
			},
		},
	}

	if err := store.Add(globalPolicy); err != nil {
		t.Fatalf("failed to add policy: %v", err)
	}

	// Request with scope that has no matching policy
	req := &types.CheckRequest{
		RequestID: "test",
		Principal: &types.Principal{
			ID:    "user1",
			Roles: []string{"member"},
		},
		Resource: &types.Resource{
			Kind:  "document",
			ID:    "doc1",
			Scope: "acme.corp",
		},
		Actions: []string{"read"},
	}

	resp, err := eng.Check(context.Background(), req)
	if err != nil {
		t.Fatalf("check failed: %v", err)
	}

	// Should allow (using global policy)
	if resp.Results["read"].Effect != types.EffectAllow {
		t.Errorf("expected allow effect, got %v", resp.Results["read"].Effect)
	}

	// Should indicate global fallback
	if resp.Metadata.ScopeResolution.MatchedScope != "(global)" {
		t.Errorf("expected matched scope '(global)', got %q", resp.Metadata.ScopeResolution.MatchedScope)
	}

	if resp.Metadata.ScopeResolution.ScopedPolicyMatched {
		t.Error("expected ScopedPolicyMatched to be false")
	}
}

// TestScopeResolutionMetadata tests that scope resolution metadata is populated correctly
func TestScopeResolutionMetadata(t *testing.T) {
	store := policy.NewMemoryStore()
	eng, err := engine.New(engine.DefaultConfig(), store)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	policy1 := &types.Policy{
		Name:         "acme-policy",
		ResourceKind: "document",
		Scope:        "acme",
		Rules: []*types.Rule{
			{
				Name:    "acme-read",
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

	resp, err := eng.Check(context.Background(), req)
	if err != nil {
		t.Fatalf("check failed: %v", err)
	}

	// Check metadata
	if resp.Metadata == nil {
		t.Fatal("metadata is nil")
	}

	if resp.Metadata.ScopeResolution == nil {
		t.Fatal("scope resolution is nil")
	}

	sr := resp.Metadata.ScopeResolution

	// Should match parent scope
	if sr.MatchedScope != "acme" {
		t.Errorf("expected matched scope 'acme', got %q", sr.MatchedScope)
	}

	// Should have inheritance chain
	expectedChain := []string{"acme.corp.engineering", "acme.corp", "acme"}
	if len(sr.InheritanceChain) != len(expectedChain) {
		t.Errorf("expected chain length %d, got %d", len(expectedChain), len(sr.InheritanceChain))
	}

	// Should indicate scoped policy matched
	if !sr.ScopedPolicyMatched {
		t.Error("expected ScopedPolicyMatched to be true")
	}
}

// TestMultipleActions tests scope resolution with multiple actions
func TestMultipleActions(t *testing.T) {
	store := policy.NewMemoryStore()
	eng, err := engine.New(engine.DefaultConfig(), store)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	policy1 := &types.Policy{
		Name:         "acme-policy",
		ResourceKind: "document",
		Scope:        "acme",
		Rules: []*types.Rule{
			{
				Name:    "acme-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
				Roles:   []string{"member"},
			},
			{
				Name:    "acme-write",
				Actions: []string{"write"},
				Effect:  types.EffectDeny,
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
			Scope: "acme",
		},
		Actions: []string{"read", "write"},
	}

	resp, err := eng.Check(context.Background(), req)
	if err != nil {
		t.Fatalf("check failed: %v", err)
	}

	// Check individual action results
	if resp.Results["read"].Effect != types.EffectAllow {
		t.Errorf("expected allow for read, got %v", resp.Results["read"].Effect)
	}

	if resp.Results["write"].Effect != types.EffectDeny {
		t.Errorf("expected deny for write, got %v", resp.Results["write"].Effect)
	}

	// Scope resolution should be the same for all actions
	if resp.Metadata.ScopeResolution.MatchedScope != "acme" {
		t.Errorf("expected matched scope 'acme', got %q", resp.Metadata.ScopeResolution.MatchedScope)
	}
}

// Benchmark tests

func BenchmarkCheckWithScope(b *testing.B) {
	store := policy.NewMemoryStore()
	eng, _ := engine.New(engine.DefaultConfig(), store)

	policy1 := &types.Policy{
		Name:         "acme-policy",
		ResourceKind: "document",
		Scope:        "acme.corp",
		Rules: []*types.Rule{
			{
				Name:    "acme-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
				Roles:   []string{"member"},
			},
		},
	}
	store.Add(policy1)

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

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		eng.Check(context.Background(), req)
	}
}

func BenchmarkCheckGlobal(b *testing.B) {
	store := policy.NewMemoryStore()
	eng, _ := engine.New(engine.DefaultConfig(), store)

	policy1 := &types.Policy{
		Name:         "global-policy",
		ResourceKind: "document",
		Scope:        "",
		Rules: []*types.Rule{
			{
				Name:    "global-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
				Roles:   []string{"member"},
			},
		},
	}
	store.Add(policy1)

	req := &types.CheckRequest{
		RequestID: "test",
		Principal: &types.Principal{
			ID:    "user1",
			Roles: []string{"member"},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc1",
		},
		Actions: []string{"read"},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		eng.Check(context.Background(), req)
	}
}

func BenchmarkCheckWithScopeInheritance(b *testing.B) {
	store := policy.NewMemoryStore()
	eng, _ := engine.New(engine.DefaultConfig(), store)

	// Add policy at root level
	policy1 := &types.Policy{
		Name:         "acme-policy",
		ResourceKind: "document",
		Scope:        "acme",
		Rules: []*types.Rule{
			{
				Name:    "acme-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
				Roles:   []string{"member"},
			},
		},
	}
	store.Add(policy1)

	// Request at deep level
	req := &types.CheckRequest{
		RequestID: "test",
		Principal: &types.Principal{
			ID:    "user1",
			Roles: []string{"member"},
		},
		Resource: &types.Resource{
			Kind:  "document",
			ID:    "doc1",
			Scope: "acme.corp.engineering.team.project",
		},
		Actions: []string{"read"},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		eng.Check(context.Background(), req)
	}
}

func BenchmarkCheckMultipleScopes(b *testing.B) {
	store := policy.NewMemoryStore()
	eng, _ := engine.New(engine.DefaultConfig(), store)

	// Add policies at different levels
	scopes := []string{"acme", "acme.corp", "acme.corp.engineering", "beta", "beta.company"}
	for i, scope := range scopes {
		policy := &types.Policy{
			Name:         fmt.Sprintf("policy-%d", i),
			ResourceKind: "document",
			Scope:        scope,
			Rules: []*types.Rule{
				{
					Name:    "read",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
					Roles:   []string{"member"},
				},
			},
		}
		store.Add(policy)
	}

	requests := []*types.CheckRequest{}
	for _, scope := range scopes {
		req := &types.CheckRequest{
			RequestID: "test",
			Principal: &types.Principal{
				ID:    "user1",
				Roles: []string{"member"},
			},
			Resource: &types.Resource{
				Kind:  "document",
				ID:    "doc1",
				Scope: scope,
			},
			Actions: []string{"read"},
		}
		requests = append(requests, req)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := requests[i%len(requests)]
		eng.Check(context.Background(), req)
	}
}
