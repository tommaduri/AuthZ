package policy_test

import (
	"fmt"
	"sync"
	"testing"

	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
)

// TestFindPoliciesForScope tests finding policies by scope
func TestFindPoliciesForScope(t *testing.T) {
	store := policy.NewMemoryStore()

	// Add policies with different scopes
	policies := []*types.Policy{
		{
			Name:         "global-policy",
			ResourceKind: "document",
			Scope:        "", // Global policy
			Rules: []*types.Rule{
				{Name: "global-rule", Actions: []string{"read"}, Effect: types.EffectAllow},
			},
		},
		{
			Name:         "acme-policy",
			ResourceKind: "document",
			Scope:        "acme",
			Rules: []*types.Rule{
				{Name: "acme-rule", Actions: []string{"read", "write"}, Effect: types.EffectAllow},
			},
		},
		{
			Name:         "acme-corp-policy",
			ResourceKind: "document",
			Scope:        "acme.corp",
			Rules: []*types.Rule{
				{Name: "corp-rule", Actions: []string{"read", "write", "delete"}, Effect: types.EffectAllow},
			},
		},
		{
			Name:         "acme-corp-eng-policy",
			ResourceKind: "document",
			Scope:        "acme.corp.engineering",
			Rules: []*types.Rule{
				{Name: "eng-rule", Actions: []string{"*"}, Effect: types.EffectAllow},
			},
		},
		{
			Name:         "beta-policy",
			ResourceKind: "document",
			Scope:        "beta",
			Rules: []*types.Rule{
				{Name: "beta-rule", Actions: []string{"read"}, Effect: types.EffectAllow},
			},
		},
	}

	for _, p := range policies {
		if err := store.Add(p); err != nil {
			t.Fatalf("failed to add policy: %v", err)
		}
	}

	tests := []struct {
		name         string
		scope        string
		resourceKind string
		expected     []string // Expected policy names
	}{
		{
			name:         "find acme scope",
			scope:        "acme",
			resourceKind: "document",
			expected:     []string{"acme-policy"},
		},
		{
			name:         "find acme.corp scope",
			scope:        "acme.corp",
			resourceKind: "document",
			expected:     []string{"acme-corp-policy"},
		},
		{
			name:         "find acme.corp.engineering scope",
			scope:        "acme.corp.engineering",
			resourceKind: "document",
			expected:     []string{"acme-corp-eng-policy"},
		},
		{
			name:         "find beta scope",
			scope:        "beta",
			resourceKind: "document",
			expected:     []string{"beta-policy"},
		},
		{
			name:         "non-existent scope returns nil",
			scope:        "nonexistent",
			resourceKind: "document",
			expected:     nil,
		},
		{
			name:         "empty scope returns nil (global not in scope index)",
			scope:        "",
			resourceKind: "document",
			expected:     nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			found := store.FindPoliciesForScope(tt.scope, tt.resourceKind, nil)

			if tt.expected == nil {
				if found != nil && len(found) > 0 {
					t.Errorf("expected nil or empty, got %d policies", len(found))
				}
				return
			}

			if len(found) != len(tt.expected) {
				t.Errorf("expected %d policies, got %d", len(tt.expected), len(found))
				return
			}

			foundNames := make(map[string]bool)
			for _, p := range found {
				foundNames[p.Name] = true
			}

			for _, expectedName := range tt.expected {
				if !foundNames[expectedName] {
					t.Errorf("expected policy %q not found", expectedName)
				}
			}
		})
	}
}

// TestScopeIndexing tests that scope indexing works correctly
func TestScopeIndexing(t *testing.T) {
	store := policy.NewMemoryStore()

	// Add a scoped policy
	policy1 := &types.Policy{
		Name:         "scoped-policy",
		ResourceKind: "document",
		Scope:        "acme.corp",
		Rules: []*types.Rule{
			{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow},
		},
	}

	if err := store.Add(policy1); err != nil {
		t.Fatalf("failed to add policy: %v", err)
	}

	// Should be findable by scope
	found := store.FindPoliciesForScope("acme.corp", "document", nil)
	if len(found) != 1 {
		t.Errorf("expected 1 policy, got %d", len(found))
	}
	if found[0].Name != "scoped-policy" {
		t.Errorf("expected policy 'scoped-policy', got %q", found[0].Name)
	}

	// Should still be findable by resource kind (phase 1 behavior)
	foundByKind := store.FindPolicies("document", []string{"read"})
	if len(foundByKind) != 1 {
		t.Errorf("expected 1 policy by kind, got %d", len(foundByKind))
	}
}

// TestGlobalPoliciesNotInScopeIndex tests that global policies are not indexed by scope
func TestGlobalPoliciesNotInScopeIndex(t *testing.T) {
	store := policy.NewMemoryStore()

	// Add a global policy (no scope)
	globalPolicy := &types.Policy{
		Name:         "global-policy",
		ResourceKind: "document",
		Scope:        "",
		Rules: []*types.Rule{
			{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow},
		},
	}

	if err := store.Add(globalPolicy); err != nil {
		t.Fatalf("failed to add policy: %v", err)
	}

	// Should NOT be findable by scope
	found := store.FindPoliciesForScope("", "document", nil)
	if found != nil && len(found) > 0 {
		t.Errorf("global policies should not be in scope index, found %d", len(found))
	}

	// Should be findable by resource kind
	foundByKind := store.FindPolicies("document", []string{"read"})
	if len(foundByKind) != 1 {
		t.Errorf("expected 1 policy by kind, got %d", len(foundByKind))
	}
}

// TestMultiplePoliciesSameScope tests multiple policies with the same scope
func TestMultiplePoliciesSameScope(t *testing.T) {
	store := policy.NewMemoryStore()

	policies := []*types.Policy{
		{
			Name:         "policy1",
			ResourceKind: "document",
			Scope:        "acme.corp",
			Rules: []*types.Rule{
				{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow},
			},
		},
		{
			Name:         "policy2",
			ResourceKind: "document",
			Scope:        "acme.corp",
			Rules: []*types.Rule{
				{Name: "rule2", Actions: []string{"write"}, Effect: types.EffectAllow},
			},
		},
		{
			Name:         "policy3",
			ResourceKind: "document",
			Scope:        "acme.corp",
			Rules: []*types.Rule{
				{Name: "rule3", Actions: []string{"delete"}, Effect: types.EffectDeny},
			},
		},
	}

	for _, p := range policies {
		if err := store.Add(p); err != nil {
			t.Fatalf("failed to add policy: %v", err)
		}
	}

	found := store.FindPoliciesForScope("acme.corp", "document", nil)
	if len(found) != 3 {
		t.Errorf("expected 3 policies, got %d", len(found))
	}

	// Verify all policies are present
	foundNames := make(map[string]bool)
	for _, p := range found {
		foundNames[p.Name] = true
	}

	for _, expected := range []string{"policy1", "policy2", "policy3"} {
		if !foundNames[expected] {
			t.Errorf("expected policy %q not found", expected)
		}
	}
}

// TestScopeIndexByResourceKind tests that scope index is separated by resource kind
func TestScopeIndexByResourceKind(t *testing.T) {
	store := policy.NewMemoryStore()

	policies := []*types.Policy{
		{
			Name:         "doc-policy",
			ResourceKind: "document",
			Scope:        "acme.corp",
			Rules: []*types.Rule{
				{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow},
			},
		},
		{
			Name:         "avatar-policy",
			ResourceKind: "avatar",
			Scope:        "acme.corp",
			Rules: []*types.Rule{
				{Name: "rule2", Actions: []string{"view"}, Effect: types.EffectAllow},
			},
		},
	}

	for _, p := range policies {
		if err := store.Add(p); err != nil {
			t.Fatalf("failed to add policy: %v", err)
		}
	}

	// Find document policies
	docPolicies := store.FindPoliciesForScope("acme.corp", "document", nil)
	if len(docPolicies) != 1 {
		t.Errorf("expected 1 document policy, got %d", len(docPolicies))
	}
	if docPolicies[0].Name != "doc-policy" {
		t.Errorf("expected 'doc-policy', got %q", docPolicies[0].Name)
	}

	// Find avatar policies
	avatarPolicies := store.FindPoliciesForScope("acme.corp", "avatar", nil)
	if len(avatarPolicies) != 1 {
		t.Errorf("expected 1 avatar policy, got %d", len(avatarPolicies))
	}
	if avatarPolicies[0].Name != "avatar-policy" {
		t.Errorf("expected 'avatar-policy', got %q", avatarPolicies[0].Name)
	}
}

// TestRemoveScopedPolicy tests removing policies from scope index
func TestRemoveScopedPolicy(t *testing.T) {
	store := policy.NewMemoryStore()

	policy1 := &types.Policy{
		Name:         "policy-to-remove",
		ResourceKind: "document",
		Scope:        "acme.corp",
		Rules: []*types.Rule{
			{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow},
		},
	}

	// Add policy
	if err := store.Add(policy1); err != nil {
		t.Fatalf("failed to add policy: %v", err)
	}

	// Verify it's in the scope index
	found := store.FindPoliciesForScope("acme.corp", "document", nil)
	if len(found) != 1 {
		t.Fatalf("expected 1 policy before removal, got %d", len(found))
	}

	// Remove policy
	if err := store.Remove("policy-to-remove"); err != nil {
		t.Fatalf("failed to remove policy: %v", err)
	}

	// Verify it's no longer in the scope index
	found = store.FindPoliciesForScope("acme.corp", "document", nil)
	if found != nil && len(found) > 0 {
		t.Errorf("policy should be removed from scope index, found %d", len(found))
	}
}

// TestClearScopeIndex tests clearing all policies clears scope index
func TestClearScopeIndex(t *testing.T) {
	store := policy.NewMemoryStore()

	policies := []*types.Policy{
		{
			Name:         "policy1",
			ResourceKind: "document",
			Scope:        "acme.corp",
			Rules: []*types.Rule{
				{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow},
			},
		},
		{
			Name:         "policy2",
			ResourceKind: "document",
			Scope:        "beta.company",
			Rules: []*types.Rule{
				{Name: "rule2", Actions: []string{"read"}, Effect: types.EffectAllow},
			},
		},
	}

	for _, p := range policies {
		if err := store.Add(p); err != nil {
			t.Fatalf("failed to add policy: %v", err)
		}
	}

	// Verify policies are in scope index
	if len(store.FindPoliciesForScope("acme.corp", "document", nil)) == 0 {
		t.Fatal("expected policies in scope index before clear")
	}

	// Clear store
	store.Clear()

	// Verify scope index is cleared
	found := store.FindPoliciesForScope("acme.corp", "document", nil)
	if found != nil && len(found) > 0 {
		t.Errorf("scope index should be cleared, found %d policies", len(found))
	}

	// Verify total count is 0
	if store.Count() != 0 {
		t.Errorf("expected count 0 after clear, got %d", store.Count())
	}
}

// TestConcurrentScopeAccess tests thread-safe concurrent access to scope index
func TestConcurrentScopeAccess(t *testing.T) {
	store := policy.NewMemoryStore()

	scopes := []string{"acme.corp", "beta.company", "gamma.org"}

	// Add initial policies
	for i, scope := range scopes {
		policy := &types.Policy{
			Name:         fmt.Sprintf("policy-%d", i),
			ResourceKind: "document",
			Scope:        scope,
			Rules: []*types.Rule{
				{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow},
			},
		}
		if err := store.Add(policy); err != nil {
			t.Fatalf("failed to add initial policy: %v", err)
		}
	}

	var wg sync.WaitGroup
	errors := make(chan error, 300)

	// Concurrent readers
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			scope := scopes[idx%len(scopes)]
			policies := store.FindPoliciesForScope(scope, "document", nil)
			if len(policies) == 0 {
				errors <- fmt.Errorf("expected policies for scope %q", scope)
			}
		}(i)
	}

	// Concurrent writers
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			scope := scopes[idx%len(scopes)]
			policy := &types.Policy{
				Name:         fmt.Sprintf("concurrent-policy-%d", idx),
				ResourceKind: "document",
				Scope:        scope,
				Rules: []*types.Rule{
					{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow},
				},
			}
			if err := store.Add(policy); err != nil {
				errors <- fmt.Errorf("failed to add policy: %w", err)
			}
		}(i)
	}

	// Concurrent removers
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			policyName := fmt.Sprintf("concurrent-policy-%d", idx)
			_ = store.Remove(policyName) // May fail if already removed, that's ok
		}(i)
	}

	wg.Wait()
	close(errors)

	// Check for errors
	for err := range errors {
		t.Errorf("concurrent access error: %v", err)
	}
}

// TestScopeIndexIsolation tests that scope index doesn't interfere with kind index
func TestScopeIndexIsolation(t *testing.T) {
	store := policy.NewMemoryStore()

	policies := []*types.Policy{
		{
			Name:         "scoped-policy",
			ResourceKind: "document",
			Scope:        "acme.corp",
			Rules: []*types.Rule{
				{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow},
			},
		},
		{
			Name:         "global-policy",
			ResourceKind: "document",
			Scope:        "",
			Rules: []*types.Rule{
				{Name: "rule2", Actions: []string{"read"}, Effect: types.EffectAllow},
			},
		},
	}

	for _, p := range policies {
		if err := store.Add(p); err != nil {
			t.Fatalf("failed to add policy: %v", err)
		}
	}

	// FindPolicies (by kind) should return both
	byKind := store.FindPolicies("document", []string{"read"})
	if len(byKind) != 2 {
		t.Errorf("expected 2 policies by kind, got %d", len(byKind))
	}

	// FindPoliciesForScope should only return scoped policy
	byScope := store.FindPoliciesForScope("acme.corp", "document", nil)
	if len(byScope) != 1 {
		t.Errorf("expected 1 policy by scope, got %d", len(byScope))
	}
	if byScope[0].Name != "scoped-policy" {
		t.Errorf("expected 'scoped-policy', got %q", byScope[0].Name)
	}

	// Empty scope should return nil
	emptyScope := store.FindPoliciesForScope("", "document", nil)
	if emptyScope != nil && len(emptyScope) > 0 {
		t.Errorf("empty scope should return nil, got %d policies", len(emptyScope))
	}
}

// Benchmark tests

func BenchmarkFindPoliciesForScope(b *testing.B) {
	store := policy.NewMemoryStore()

	// Add 100 policies across different scopes
	for i := 0; i < 100; i++ {
		scope := fmt.Sprintf("scope-%d", i%10)
		policy := &types.Policy{
			Name:         fmt.Sprintf("policy-%d", i),
			ResourceKind: "document",
			Scope:        scope,
			Rules: []*types.Rule{
				{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow},
			},
		}
		store.Add(policy)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		scope := fmt.Sprintf("scope-%d", i%10)
		_ = store.FindPoliciesForScope(scope, "document", nil)
	}
}

func BenchmarkAddScopedPolicy(b *testing.B) {
	store := policy.NewMemoryStore()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		policy := &types.Policy{
			Name:         fmt.Sprintf("policy-%d", i),
			ResourceKind: "document",
			Scope:        fmt.Sprintf("scope-%d", i%100),
			Rules: []*types.Rule{
				{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow},
			},
		}
		store.Add(policy)
	}
}

func BenchmarkRemoveScopedPolicy(b *testing.B) {
	store := policy.NewMemoryStore()

	// Pre-add policies
	for i := 0; i < b.N; i++ {
		policy := &types.Policy{
			Name:         fmt.Sprintf("policy-%d", i),
			ResourceKind: "document",
			Scope:        fmt.Sprintf("scope-%d", i%100),
			Rules: []*types.Rule{
				{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow},
			},
		}
		store.Add(policy)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		store.Remove(fmt.Sprintf("policy-%d", i))
	}
}
