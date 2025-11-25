package policy_test

import (
	"fmt"
	"sync"
	"testing"

	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
)

// ============================================================================
// Category 1: PrincipalSelector Matching Tests (5 tests)
// ============================================================================

// TestPrincipalSelectorMatchByID tests matching by principal ID only
func TestPrincipalSelectorMatchByID(t *testing.T) {
	selector := &types.PrincipalSelector{
		ID: "user:alice",
	}

	tests := []struct {
		name      string
		principal *types.Principal
		expected  bool
	}{
		{
			name: "exact ID match",
			principal: &types.Principal{
				ID:    "user:alice",
				Roles: []string{"admin"},
				Scope: "acme.corp",
			},
			expected: true,
		},
		{
			name: "ID mismatch",
			principal: &types.Principal{
				ID:    "user:bob",
				Roles: []string{"admin"},
				Scope: "acme.corp",
			},
			expected: false,
		},
		{
			name: "match ignores roles",
			principal: &types.Principal{
				ID:    "user:alice",
				Roles: []string{}, // No roles
				Scope: "acme.corp",
			},
			expected: true,
		},
		{
			name: "match ignores scope",
			principal: &types.Principal{
				ID:    "user:alice",
				Roles: []string{"admin"},
				Scope: "different.scope",
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := selector.MatchesPrincipal(tt.principal)
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}

// TestPrincipalSelectorMatchByRoles tests matching by roles (ANY match)
func TestPrincipalSelectorMatchByRoles(t *testing.T) {
	selector := &types.PrincipalSelector{
		Roles: []string{"admin", "manager"},
	}

	tests := []struct {
		name      string
		principal *types.Principal
		expected  bool
	}{
		{
			name: "has admin role",
			principal: &types.Principal{
				ID:    "user:alice",
				Roles: []string{"admin", "viewer"},
				Scope: "acme.corp",
			},
			expected: true,
		},
		{
			name: "has manager role",
			principal: &types.Principal{
				ID:    "user:bob",
				Roles: []string{"manager"},
				Scope: "acme.corp",
			},
			expected: true,
		},
		{
			name: "has both roles",
			principal: &types.Principal{
				ID:    "user:charlie",
				Roles: []string{"admin", "manager", "viewer"},
				Scope: "acme.corp",
			},
			expected: true,
		},
		{
			name: "has no matching roles",
			principal: &types.Principal{
				ID:    "user:dave",
				Roles: []string{"viewer", "guest"},
				Scope: "acme.corp",
			},
			expected: false,
		},
		{
			name: "no roles",
			principal: &types.Principal{
				ID:    "user:eve",
				Roles: []string{},
				Scope: "acme.corp",
			},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := selector.MatchesPrincipal(tt.principal)
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}

// TestPrincipalSelectorMatchByScope tests matching by scope
func TestPrincipalSelectorMatchByScope(t *testing.T) {
	selector := &types.PrincipalSelector{
		Scope: "acme.corp",
	}

	tests := []struct {
		name      string
		principal *types.Principal
		expected  bool
	}{
		{
			name: "exact scope match",
			principal: &types.Principal{
				ID:    "user:alice",
				Roles: []string{"admin"},
				Scope: "acme.corp",
			},
			expected: true,
		},
		{
			name: "scope mismatch",
			principal: &types.Principal{
				ID:    "user:bob",
				Roles: []string{"admin"},
				Scope: "beta.company",
			},
			expected: false,
		},
		{
			name: "empty principal scope",
			principal: &types.Principal{
				ID:    "user:charlie",
				Roles: []string{"admin"},
				Scope: "",
			},
			expected: false,
		},
		{
			name: "child scope no match",
			principal: &types.Principal{
				ID:    "user:dave",
				Roles: []string{"admin"},
				Scope: "acme.corp.engineering",
			},
			expected: false, // Exact match only for now
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := selector.MatchesPrincipal(tt.principal)
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}

// TestPrincipalSelectorCombined tests combined ID + roles + scope matching
func TestPrincipalSelectorCombined(t *testing.T) {
	selector := &types.PrincipalSelector{
		ID:    "user:alice",
		Roles: []string{"admin"},
		Scope: "acme.corp",
	}

	tests := []struct {
		name      string
		principal *types.Principal
		expected  bool
	}{
		{
			name: "all criteria match",
			principal: &types.Principal{
				ID:    "user:alice",
				Roles: []string{"admin", "viewer"},
				Scope: "acme.corp",
			},
			expected: true,
		},
		{
			name: "ID mismatch",
			principal: &types.Principal{
				ID:    "user:bob",
				Roles: []string{"admin"},
				Scope: "acme.corp",
			},
			expected: false,
		},
		{
			name: "role mismatch",
			principal: &types.Principal{
				ID:    "user:alice",
				Roles: []string{"viewer"},
				Scope: "acme.corp",
			},
			expected: false,
		},
		{
			name: "scope mismatch",
			principal: &types.Principal{
				ID:    "user:alice",
				Roles: []string{"admin"},
				Scope: "beta.company",
			},
			expected: false,
		},
		{
			name: "all mismatch",
			principal: &types.Principal{
				ID:    "user:bob",
				Roles: []string{"viewer"},
				Scope: "beta.company",
			},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := selector.MatchesPrincipal(tt.principal)
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}

// TestPrincipalSelectorNoMatch tests scenarios where nothing matches
func TestPrincipalSelectorNoMatch(t *testing.T) {
	tests := []struct {
		name      string
		selector  *types.PrincipalSelector
		principal *types.Principal
		expected  bool
	}{
		{
			name: "empty selector matches all",
			selector: &types.PrincipalSelector{
				// All fields empty
			},
			principal: &types.Principal{
				ID:    "user:alice",
				Roles: []string{"admin"},
				Scope: "acme.corp",
			},
			expected: true, // Empty selector matches any principal
		},
		{
			name: "ID specified but principal ID different",
			selector: &types.PrincipalSelector{
				ID: "user:alice",
			},
			principal: &types.Principal{
				ID:    "user:bob",
				Roles: []string{"admin"},
				Scope: "acme.corp",
			},
			expected: false,
		},
		{
			name: "roles specified but principal has none",
			selector: &types.PrincipalSelector{
				Roles: []string{"admin"},
			},
			principal: &types.Principal{
				ID:    "user:alice",
				Roles: []string{},
				Scope: "acme.corp",
			},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.selector.MatchesPrincipal(tt.principal)
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}

// ============================================================================
// Category 2: ResourceSelector Matching Tests (5 tests)
// ============================================================================

// TestResourceSelectorExactKindMatch tests exact kind matching
func TestResourceSelectorExactKindMatch(t *testing.T) {
	selector := &types.ResourceSelector{
		Kind:  "document",
		Scope: "",
	}

	tests := []struct {
		name     string
		resource *types.Resource
		expected bool
	}{
		{
			name: "exact kind match",
			resource: &types.Resource{
				Kind:  "document",
				ID:    "doc-1",
				Scope: "acme.corp",
			},
			expected: true,
		},
		{
			name: "kind mismatch",
			resource: &types.Resource{
				Kind:  "avatar",
				ID:    "avatar-1",
				Scope: "acme.corp",
			},
			expected: false,
		},
		{
			name: "case sensitive",
			resource: &types.Resource{
				Kind:  "Document",
				ID:    "doc-1",
				Scope: "acme.corp",
			},
			expected: false, // Case sensitive
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := selector.MatchesResource(tt.resource)
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}

// TestResourceSelectorWildcardKind tests wildcard * kind matching
func TestResourceSelectorWildcardKind(t *testing.T) {
	selector := &types.ResourceSelector{
		Kind:  "*",
		Scope: "",
	}

	tests := []struct {
		name     string
		resource *types.Resource
		expected bool
	}{
		{
			name: "matches document",
			resource: &types.Resource{
				Kind:  "document",
				ID:    "doc-1",
				Scope: "acme.corp",
			},
			expected: true,
		},
		{
			name: "matches avatar",
			resource: &types.Resource{
				Kind:  "avatar",
				ID:    "avatar-1",
				Scope: "acme.corp",
			},
			expected: true,
		},
		{
			name: "matches any kind",
			resource: &types.Resource{
				Kind:  "anything",
				ID:    "id-1",
				Scope: "any.scope",
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := selector.MatchesResource(tt.resource)
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}

// TestResourceSelectorExactScopeMatch tests exact scope matching
func TestResourceSelectorExactScopeMatch(t *testing.T) {
	selector := &types.ResourceSelector{
		Kind:  "document",
		Scope: "acme.corp",
	}

	tests := []struct {
		name     string
		resource *types.Resource
		expected bool
	}{
		{
			name: "exact scope match",
			resource: &types.Resource{
				Kind:  "document",
				ID:    "doc-1",
				Scope: "acme.corp",
			},
			expected: true,
		},
		{
			name: "scope mismatch",
			resource: &types.Resource{
				Kind:  "document",
				ID:    "doc-2",
				Scope: "beta.company",
			},
			expected: false,
		},
		{
			name: "child scope no match",
			resource: &types.Resource{
				Kind:  "document",
				ID:    "doc-3",
				Scope: "acme.corp.engineering",
			},
			expected: false, // Exact match only for now
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := selector.MatchesResource(tt.resource)
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}

// TestResourceSelectorWildcardScope tests wildcard ** scope matching
func TestResourceSelectorWildcardScope(t *testing.T) {
	selector := &types.ResourceSelector{
		Kind:  "document",
		Scope: "**",
	}

	tests := []struct {
		name     string
		resource *types.Resource
		expected bool
	}{
		{
			name: "matches any scope",
			resource: &types.Resource{
				Kind:  "document",
				ID:    "doc-1",
				Scope: "acme.corp",
			},
			expected: true,
		},
		{
			name: "matches different scope",
			resource: &types.Resource{
				Kind:  "document",
				ID:    "doc-2",
				Scope: "beta.company.dept",
			},
			expected: true,
		},
		{
			name: "matches empty scope",
			resource: &types.Resource{
				Kind:  "document",
				ID:    "doc-3",
				Scope: "",
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := selector.MatchesResource(tt.resource)
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}

// TestResourceSelectorEmptyScope tests empty scope (matches any)
func TestResourceSelectorEmptyScope(t *testing.T) {
	selector := &types.ResourceSelector{
		Kind:  "document",
		Scope: "", // Empty scope matches any
	}

	tests := []struct {
		name     string
		resource *types.Resource
		expected bool
	}{
		{
			name: "matches resource with scope",
			resource: &types.Resource{
				Kind:  "document",
				ID:    "doc-1",
				Scope: "acme.corp",
			},
			expected: true,
		},
		{
			name: "matches resource without scope",
			resource: &types.Resource{
				Kind:  "document",
				ID:    "doc-2",
				Scope: "",
			},
			expected: true,
		},
		{
			name: "matches any scope",
			resource: &types.Resource{
				Kind:  "document",
				ID:    "doc-3",
				Scope: "any.scope.here",
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := selector.MatchesResource(tt.resource)
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}

// ============================================================================
// Category 3: PrincipalIndex Add/Remove Tests (5 tests)
// ============================================================================

// TestPrincipalIndexAddPrincipalSpecific tests adding principal-specific policies
func TestPrincipalIndexAddPrincipalSpecific(t *testing.T) {
	index := policy.NewPrincipalIndex()

	policy1 := &types.Policy{
		Name:            "alice-docs-policy",
		PrincipalPolicy: true,
		Principal: &types.PrincipalSelector{
			ID: "user:alice",
		},
		Resources: []*types.ResourceSelector{
			{Kind: "document", Scope: "acme.corp"},
		},
		Rules: []*types.Rule{
			{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow},
		},
	}

	index.Add(policy1)

	// Verify policy is indexed by principal ID
	found := index.FindByPrincipal("user:alice", "document")
	if len(found) != 1 {
		t.Errorf("expected 1 policy, got %d", len(found))
	}
	if found[0].Name != "alice-docs-policy" {
		t.Errorf("expected 'alice-docs-policy', got %q", found[0].Name)
	}

	// Non-existent principal should return nil
	notFound := index.FindByPrincipal("user:bob", "document")
	if notFound != nil {
		t.Errorf("expected nil for non-existent principal, got %d policies", len(notFound))
	}
}

// TestPrincipalIndexAddRoleBased tests adding role-based policies
func TestPrincipalIndexAddRoleBased(t *testing.T) {
	index := policy.NewPrincipalIndex()

	policy1 := &types.Policy{
		Name:            "admin-docs-policy",
		PrincipalPolicy: true,
		Principal: &types.PrincipalSelector{
			Roles: []string{"admin", "manager"},
		},
		Resources: []*types.ResourceSelector{
			{Kind: "document", Scope: "**"},
		},
		Rules: []*types.Rule{
			{Name: "rule1", Actions: []string{"*"}, Effect: types.EffectAllow},
		},
	}

	index.Add(policy1)

	// Verify policy is indexed by admin role
	foundAdmin := index.FindByRoles([]string{"admin"}, "document")
	if len(foundAdmin) != 1 {
		t.Errorf("expected 1 policy for admin, got %d", len(foundAdmin))
	}
	if foundAdmin[0].Name != "admin-docs-policy" {
		t.Errorf("expected 'admin-docs-policy', got %q", foundAdmin[0].Name)
	}

	// Verify policy is indexed by manager role
	foundManager := index.FindByRoles([]string{"manager"}, "document")
	if len(foundManager) != 1 {
		t.Errorf("expected 1 policy for manager, got %d", len(foundManager))
	}

	// Multiple roles should deduplicate
	foundBoth := index.FindByRoles([]string{"admin", "manager"}, "document")
	if len(foundBoth) != 1 {
		t.Errorf("expected 1 deduplicated policy, got %d", len(foundBoth))
	}
}

// TestPrincipalIndexAddWildcardKind tests adding wildcard * resource kind policies
func TestPrincipalIndexAddWildcardKind(t *testing.T) {
	index := policy.NewPrincipalIndex()

	policy1 := &types.Policy{
		Name:            "alice-all-resources",
		PrincipalPolicy: true,
		Principal: &types.PrincipalSelector{
			ID: "user:alice",
		},
		Resources: []*types.ResourceSelector{
			{Kind: "*", Scope: "acme.corp"}, // Wildcard kind
		},
		Rules: []*types.Rule{
			{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow},
		},
	}

	index.Add(policy1)

	// Should match any resource kind
	foundDoc := index.FindByPrincipal("user:alice", "document")
	if len(foundDoc) != 1 {
		t.Errorf("expected 1 policy for document, got %d", len(foundDoc))
	}

	foundAvatar := index.FindByPrincipal("user:alice", "avatar")
	if len(foundAvatar) != 1 {
		t.Errorf("expected 1 policy for avatar, got %d", len(foundAvatar))
	}

	foundAny := index.FindByPrincipal("user:alice", "anything")
	if len(foundAny) != 1 {
		t.Errorf("expected 1 policy for anything, got %d", len(foundAny))
	}
}

// TestPrincipalIndexRemoveUpdatesAllIndices tests that removing a policy updates all indices
func TestPrincipalIndexRemoveUpdatesAllIndices(t *testing.T) {
	index := policy.NewPrincipalIndex()

	policy1 := &types.Policy{
		Name:            "admin-docs-policy",
		PrincipalPolicy: true,
		Principal: &types.PrincipalSelector{
			ID:    "user:alice",
			Roles: []string{"admin"},
			Scope: "acme.corp",
		},
		Resources: []*types.ResourceSelector{
			{Kind: "document", Scope: "**"},
		},
		Rules: []*types.Rule{
			{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow},
		},
	}

	// Add policy
	index.Add(policy1)

	// Verify it's in both indices
	foundByPrincipal := index.FindByPrincipal("user:alice", "document")
	if len(foundByPrincipal) != 1 {
		t.Fatalf("expected 1 policy by principal before removal, got %d", len(foundByPrincipal))
	}

	foundByRole := index.FindByRoles([]string{"admin"}, "document")
	if len(foundByRole) != 1 {
		t.Fatalf("expected 1 policy by role before removal, got %d", len(foundByRole))
	}

	// Remove policy
	index.Remove(policy1)

	// Verify it's removed from principal index
	afterPrincipal := index.FindByPrincipal("user:alice", "document")
	if afterPrincipal != nil {
		t.Errorf("policy should be removed from principal index, found %d", len(afterPrincipal))
	}

	// Verify it's removed from role index
	afterRole := index.FindByRoles([]string{"admin"}, "document")
	if afterRole != nil {
		t.Errorf("policy should be removed from role index, found %d", len(afterRole))
	}
}

// TestPrincipalIndexClearRemovesAll tests that Clear removes all entries
func TestPrincipalIndexClearRemovesAll(t *testing.T) {
	index := policy.NewPrincipalIndex()

	policies := []*types.Policy{
		{
			Name:            "alice-policy",
			PrincipalPolicy: true,
			Principal:       &types.PrincipalSelector{ID: "user:alice"},
			Resources:       []*types.ResourceSelector{{Kind: "document", Scope: ""}},
			Rules:           []*types.Rule{{Name: "r1", Actions: []string{"read"}, Effect: types.EffectAllow}},
		},
		{
			Name:            "bob-policy",
			PrincipalPolicy: true,
			Principal:       &types.PrincipalSelector{ID: "user:bob"},
			Resources:       []*types.ResourceSelector{{Kind: "avatar", Scope: ""}},
			Rules:           []*types.Rule{{Name: "r2", Actions: []string{"view"}, Effect: types.EffectAllow}},
		},
		{
			Name:            "admin-policy",
			PrincipalPolicy: true,
			Principal:       &types.PrincipalSelector{Roles: []string{"admin"}},
			Resources:       []*types.ResourceSelector{{Kind: "document", Scope: ""}},
			Rules:           []*types.Rule{{Name: "r3", Actions: []string{"*"}, Effect: types.EffectAllow}},
		},
	}

	for _, p := range policies {
		index.Add(p)
	}

	// Verify policies are indexed
	if len(index.FindByPrincipal("user:alice", "document")) == 0 {
		t.Fatal("expected policies before clear")
	}

	// Clear index
	index.Clear()

	// Verify all indices are empty
	if found := index.FindByPrincipal("user:alice", "document"); found != nil {
		t.Errorf("principal index should be empty after clear, found %d", len(found))
	}

	if found := index.FindByPrincipal("user:bob", "avatar"); found != nil {
		t.Errorf("principal index should be empty after clear, found %d", len(found))
	}

	if found := index.FindByRoles([]string{"admin"}, "document"); found != nil {
		t.Errorf("role index should be empty after clear, found %d", len(found))
	}
}

// ============================================================================
// Category 4: FindByPrincipal Lookups (5 tests)
// ============================================================================

// TestFindByPrincipalIDAndKind tests finding by principal ID + resource kind
func TestFindByPrincipalIDAndKind(t *testing.T) {
	index := policy.NewPrincipalIndex()

	policies := []*types.Policy{
		{
			Name:            "alice-docs",
			PrincipalPolicy: true,
			Principal:       &types.PrincipalSelector{ID: "user:alice"},
			Resources:       []*types.ResourceSelector{{Kind: "document", Scope: ""}},
			Rules:           []*types.Rule{{Name: "r1", Actions: []string{"read"}, Effect: types.EffectAllow}},
		},
		{
			Name:            "alice-avatars",
			PrincipalPolicy: true,
			Principal:       &types.PrincipalSelector{ID: "user:alice"},
			Resources:       []*types.ResourceSelector{{Kind: "avatar", Scope: ""}},
			Rules:           []*types.Rule{{Name: "r2", Actions: []string{"view"}, Effect: types.EffectAllow}},
		},
		{
			Name:            "bob-docs",
			PrincipalPolicy: true,
			Principal:       &types.PrincipalSelector{ID: "user:bob"},
			Resources:       []*types.ResourceSelector{{Kind: "document", Scope: ""}},
			Rules:           []*types.Rule{{Name: "r3", Actions: []string{"read"}, Effect: types.EffectAllow}},
		},
	}

	for _, p := range policies {
		index.Add(p)
	}

	tests := []struct {
		name         string
		principalID  string
		resourceKind string
		expected     []string
	}{
		{
			name:         "alice documents",
			principalID:  "user:alice",
			resourceKind: "document",
			expected:     []string{"alice-docs"},
		},
		{
			name:         "alice avatars",
			principalID:  "user:alice",
			resourceKind: "avatar",
			expected:     []string{"alice-avatars"},
		},
		{
			name:         "bob documents",
			principalID:  "user:bob",
			resourceKind: "document",
			expected:     []string{"bob-docs"},
		},
		{
			name:         "alice unknown kind",
			principalID:  "user:alice",
			resourceKind: "unknown",
			expected:     nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			found := index.FindByPrincipal(tt.principalID, tt.resourceKind)

			if tt.expected == nil {
				if found != nil && len(found) > 0 {
					t.Errorf("expected nil, got %d policies", len(found))
				}
				return
			}

			if len(found) != len(tt.expected) {
				t.Errorf("expected %d policies, got %d", len(tt.expected), len(found))
			}

			for _, expectedName := range tt.expected {
				foundName := false
				for _, p := range found {
					if p.Name == expectedName {
						foundName = true
						break
					}
				}
				if !foundName {
					t.Errorf("expected policy %q not found", expectedName)
				}
			}
		})
	}
}

// TestFindByPrincipalIncludesWildcard tests including wildcard * resource policies
func TestFindByPrincipalIncludesWildcard(t *testing.T) {
	index := policy.NewPrincipalIndex()

	policies := []*types.Policy{
		{
			Name:            "alice-docs-specific",
			PrincipalPolicy: true,
			Principal:       &types.PrincipalSelector{ID: "user:alice"},
			Resources:       []*types.ResourceSelector{{Kind: "document", Scope: ""}},
			Rules:           []*types.Rule{{Name: "r1", Actions: []string{"read"}, Effect: types.EffectAllow}},
		},
		{
			Name:            "alice-all-resources",
			PrincipalPolicy: true,
			Principal:       &types.PrincipalSelector{ID: "user:alice"},
			Resources:       []*types.ResourceSelector{{Kind: "*", Scope: ""}}, // Wildcard
			Rules:           []*types.Rule{{Name: "r2", Actions: []string{"*"}, Effect: types.EffectAllow}},
		},
	}

	for _, p := range policies {
		index.Add(p)
	}

	// Find documents should include both specific and wildcard
	found := index.FindByPrincipal("user:alice", "document")
	if len(found) != 2 {
		t.Errorf("expected 2 policies (specific + wildcard), got %d", len(found))
	}

	foundNames := make(map[string]bool)
	for _, p := range found {
		foundNames[p.Name] = true
	}

	if !foundNames["alice-docs-specific"] {
		t.Errorf("expected specific document policy")
	}
	if !foundNames["alice-all-resources"] {
		t.Errorf("expected wildcard policy")
	}

	// Find avatars should only include wildcard
	foundAvatars := index.FindByPrincipal("user:alice", "avatar")
	if len(foundAvatars) != 1 {
		t.Errorf("expected 1 policy (wildcard only), got %d", len(foundAvatars))
	}
	if foundAvatars[0].Name != "alice-all-resources" {
		t.Errorf("expected wildcard policy for avatars, got %q", foundAvatars[0].Name)
	}
}

// TestFindByPrincipalNonExistent tests non-existent principal returns nil
func TestFindByPrincipalNonExistent(t *testing.T) {
	index := policy.NewPrincipalIndex()

	policy1 := &types.Policy{
		Name:            "alice-docs",
		PrincipalPolicy: true,
		Principal:       &types.PrincipalSelector{ID: "user:alice"},
		Resources:       []*types.ResourceSelector{{Kind: "document", Scope: ""}},
		Rules:           []*types.Rule{{Name: "r1", Actions: []string{"read"}, Effect: types.EffectAllow}},
	}

	index.Add(policy1)

	// Non-existent principal
	found := index.FindByPrincipal("user:nonexistent", "document")
	if found != nil {
		t.Errorf("expected nil for non-existent principal, got %d policies", len(found))
	}

	// Existing principal but non-existent kind
	found = index.FindByPrincipal("user:alice", "nonexistent-kind")
	if found != nil {
		t.Errorf("expected nil for non-existent kind, got %d policies", len(found))
	}
}

// TestFindByPrincipalMultiplePolicies tests multiple policies for same principal
func TestFindByPrincipalMultiplePolicies(t *testing.T) {
	index := policy.NewPrincipalIndex()

	policies := []*types.Policy{
		{
			Name:            "alice-docs-read",
			PrincipalPolicy: true,
			Principal:       &types.PrincipalSelector{ID: "user:alice"},
			Resources:       []*types.ResourceSelector{{Kind: "document", Scope: "acme.corp"}},
			Rules:           []*types.Rule{{Name: "r1", Actions: []string{"read"}, Effect: types.EffectAllow}},
		},
		{
			Name:            "alice-docs-write",
			PrincipalPolicy: true,
			Principal:       &types.PrincipalSelector{ID: "user:alice"},
			Resources:       []*types.ResourceSelector{{Kind: "document", Scope: "acme.corp"}},
			Rules:           []*types.Rule{{Name: "r2", Actions: []string{"write"}, Effect: types.EffectAllow}},
		},
		{
			Name:            "alice-docs-delete",
			PrincipalPolicy: true,
			Principal:       &types.PrincipalSelector{ID: "user:alice"},
			Resources:       []*types.ResourceSelector{{Kind: "document", Scope: "acme.corp"}},
			Rules:           []*types.Rule{{Name: "r3", Actions: []string{"delete"}, Effect: types.EffectDeny}},
		},
	}

	for _, p := range policies {
		index.Add(p)
	}

	found := index.FindByPrincipal("user:alice", "document")
	if len(found) != 3 {
		t.Errorf("expected 3 policies, got %d", len(found))
	}

	expectedNames := map[string]bool{
		"alice-docs-read":   true,
		"alice-docs-write":  true,
		"alice-docs-delete": true,
	}

	for _, p := range found {
		if !expectedNames[p.Name] {
			t.Errorf("unexpected policy %q", p.Name)
		}
	}
}

// TestFindByPrincipalThreadSafe tests thread-safe concurrent access
func TestFindByPrincipalThreadSafe(t *testing.T) {
	index := policy.NewPrincipalIndex()

	// Add initial policy
	policy1 := &types.Policy{
		Name:            "alice-docs",
		PrincipalPolicy: true,
		Principal:       &types.PrincipalSelector{ID: "user:alice"},
		Resources:       []*types.ResourceSelector{{Kind: "document", Scope: ""}},
		Rules:           []*types.Rule{{Name: "r1", Actions: []string{"read"}, Effect: types.EffectAllow}},
	}
	index.Add(policy1)

	var wg sync.WaitGroup
	errors := make(chan error, 200)

	// Concurrent readers
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			policies := index.FindByPrincipal("user:alice", "document")
			if len(policies) == 0 {
				errors <- fmt.Errorf("expected at least 1 policy")
			}
		}()
	}

	// Concurrent writers
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			policy := &types.Policy{
				Name:            fmt.Sprintf("concurrent-policy-%d", idx),
				PrincipalPolicy: true,
				Principal:       &types.PrincipalSelector{ID: "user:alice"},
				Resources:       []*types.ResourceSelector{{Kind: "document", Scope: ""}},
				Rules:           []*types.Rule{{Name: "r1", Actions: []string{"read"}, Effect: types.EffectAllow}},
			}
			index.Add(policy)
		}(i)
	}

	wg.Wait()
	close(errors)

	for err := range errors {
		t.Errorf("concurrent access error: %v", err)
	}
}

// ============================================================================
// Category 5: FindByRoles Lookups (5 tests)
// ============================================================================

// TestFindByRolesSingleRole tests finding by single role
func TestFindByRolesSingleRole(t *testing.T) {
	index := policy.NewPrincipalIndex()

	policies := []*types.Policy{
		{
			Name:            "admin-docs",
			PrincipalPolicy: true,
			Principal:       &types.PrincipalSelector{Roles: []string{"admin"}},
			Resources:       []*types.ResourceSelector{{Kind: "document", Scope: ""}},
			Rules:           []*types.Rule{{Name: "r1", Actions: []string{"*"}, Effect: types.EffectAllow}},
		},
		{
			Name:            "viewer-docs",
			PrincipalPolicy: true,
			Principal:       &types.PrincipalSelector{Roles: []string{"viewer"}},
			Resources:       []*types.ResourceSelector{{Kind: "document", Scope: ""}},
			Rules:           []*types.Rule{{Name: "r2", Actions: []string{"read"}, Effect: types.EffectAllow}},
		},
	}

	for _, p := range policies {
		index.Add(p)
	}

	// Find by admin role
	foundAdmin := index.FindByRoles([]string{"admin"}, "document")
	if len(foundAdmin) != 1 {
		t.Errorf("expected 1 admin policy, got %d", len(foundAdmin))
	}
	if foundAdmin[0].Name != "admin-docs" {
		t.Errorf("expected 'admin-docs', got %q", foundAdmin[0].Name)
	}

	// Find by viewer role
	foundViewer := index.FindByRoles([]string{"viewer"}, "document")
	if len(foundViewer) != 1 {
		t.Errorf("expected 1 viewer policy, got %d", len(foundViewer))
	}
	if foundViewer[0].Name != "viewer-docs" {
		t.Errorf("expected 'viewer-docs', got %q", foundViewer[0].Name)
	}
}

// TestFindByRolesMultipleRoles tests finding by multiple roles with deduplication
func TestFindByRolesMultipleRoles(t *testing.T) {
	index := policy.NewPrincipalIndex()

	policies := []*types.Policy{
		{
			Name:            "admin-manager-docs",
			PrincipalPolicy: true,
			Principal:       &types.PrincipalSelector{Roles: []string{"admin", "manager"}},
			Resources:       []*types.ResourceSelector{{Kind: "document", Scope: ""}},
			Rules:           []*types.Rule{{Name: "r1", Actions: []string{"*"}, Effect: types.EffectAllow}},
		},
		{
			Name:            "admin-only-avatars",
			PrincipalPolicy: true,
			Principal:       &types.PrincipalSelector{Roles: []string{"admin"}},
			Resources:       []*types.ResourceSelector{{Kind: "avatar", Scope: ""}},
			Rules:           []*types.Rule{{Name: "r2", Actions: []string{"view"}, Effect: types.EffectAllow}},
		},
	}

	for _, p := range policies {
		index.Add(p)
	}

	// Find by both admin and manager roles for documents
	// Should return only 1 policy (deduplicated)
	found := index.FindByRoles([]string{"admin", "manager"}, "document")
	if len(found) != 1 {
		t.Errorf("expected 1 deduplicated policy, got %d", len(found))
	}
	if found[0].Name != "admin-manager-docs" {
		t.Errorf("expected 'admin-manager-docs', got %q", found[0].Name)
	}

	// Find by admin only for avatars
	foundAvatars := index.FindByRoles([]string{"admin"}, "avatar")
	if len(foundAvatars) != 1 {
		t.Errorf("expected 1 avatar policy, got %d", len(foundAvatars))
	}

	// Find by multiple roles for avatars
	// Admin role appears in avatar policy
	foundMulti := index.FindByRoles([]string{"admin", "manager"}, "avatar")
	if len(foundMulti) != 1 {
		t.Errorf("expected 1 policy, got %d", len(foundMulti))
	}
}

// TestFindByRolesIncludesWildcard tests including wildcard * resource policies
func TestFindByRolesIncludesWildcard(t *testing.T) {
	index := policy.NewPrincipalIndex()

	policies := []*types.Policy{
		{
			Name:            "admin-docs-specific",
			PrincipalPolicy: true,
			Principal:       &types.PrincipalSelector{Roles: []string{"admin"}},
			Resources:       []*types.ResourceSelector{{Kind: "document", Scope: ""}},
			Rules:           []*types.Rule{{Name: "r1", Actions: []string{"read"}, Effect: types.EffectAllow}},
		},
		{
			Name:            "admin-all-resources",
			PrincipalPolicy: true,
			Principal:       &types.PrincipalSelector{Roles: []string{"admin"}},
			Resources:       []*types.ResourceSelector{{Kind: "*", Scope: ""}}, // Wildcard
			Rules:           []*types.Rule{{Name: "r2", Actions: []string{"*"}, Effect: types.EffectAllow}},
		},
	}

	for _, p := range policies {
		index.Add(p)
	}

	// Find documents should include both specific and wildcard
	found := index.FindByRoles([]string{"admin"}, "document")
	if len(found) != 2 {
		t.Errorf("expected 2 policies (specific + wildcard), got %d", len(found))
	}

	foundNames := make(map[string]bool)
	for _, p := range found {
		foundNames[p.Name] = true
	}

	if !foundNames["admin-docs-specific"] {
		t.Errorf("expected specific document policy")
	}
	if !foundNames["admin-all-resources"] {
		t.Errorf("expected wildcard policy")
	}

	// Find avatars should only include wildcard
	foundAvatars := index.FindByRoles([]string{"admin"}, "avatar")
	if len(foundAvatars) != 1 {
		t.Errorf("expected 1 policy (wildcard only), got %d", len(foundAvatars))
	}
	if foundAvatars[0].Name != "admin-all-resources" {
		t.Errorf("expected wildcard policy for avatars, got %q", foundAvatars[0].Name)
	}
}

// TestFindByRolesNonExistent tests non-existent role returns nil
func TestFindByRolesNonExistent(t *testing.T) {
	index := policy.NewPrincipalIndex()

	policy1 := &types.Policy{
		Name:            "admin-docs",
		PrincipalPolicy: true,
		Principal:       &types.PrincipalSelector{Roles: []string{"admin"}},
		Resources:       []*types.ResourceSelector{{Kind: "document", Scope: ""}},
		Rules:           []*types.Rule{{Name: "r1", Actions: []string{"*"}, Effect: types.EffectAllow}},
	}

	index.Add(policy1)

	// Non-existent role
	found := index.FindByRoles([]string{"nonexistent"}, "document")
	if found != nil {
		t.Errorf("expected nil for non-existent role, got %d policies", len(found))
	}

	// Existing role but non-existent kind
	found = index.FindByRoles([]string{"admin"}, "nonexistent-kind")
	if found != nil {
		t.Errorf("expected nil for non-existent kind, got %d policies", len(found))
	}

	// Mix of existing and non-existent roles
	foundMix := index.FindByRoles([]string{"admin", "nonexistent"}, "document")
	if len(foundMix) != 1 {
		t.Errorf("expected 1 policy for mixed roles, got %d", len(foundMix))
	}
}

// TestFindByRolesConcurrentAccess tests role-based concurrent access
func TestFindByRolesConcurrentAccess(t *testing.T) {
	index := policy.NewPrincipalIndex()

	roles := []string{"admin", "manager", "viewer"}

	// Add initial policies
	for i, role := range roles {
		policy := &types.Policy{
			Name:            fmt.Sprintf("%s-policy", role),
			PrincipalPolicy: true,
			Principal:       &types.PrincipalSelector{Roles: []string{role}},
			Resources:       []*types.ResourceSelector{{Kind: "document", Scope: ""}},
			Rules: []*types.Rule{
				{Name: fmt.Sprintf("rule-%d", i), Actions: []string{"read"}, Effect: types.EffectAllow},
			},
		}
		index.Add(policy)
	}

	var wg sync.WaitGroup
	errors := make(chan error, 300)

	// Concurrent readers
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			role := roles[idx%len(roles)]
			policies := index.FindByRoles([]string{role}, "document")
			if len(policies) == 0 {
				errors <- fmt.Errorf("expected policies for role %q", role)
			}
		}(i)
	}

	// Concurrent writers
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			role := roles[idx%len(roles)]
			policy := &types.Policy{
				Name:            fmt.Sprintf("concurrent-%s-%d", role, idx),
				PrincipalPolicy: true,
				Principal:       &types.PrincipalSelector{Roles: []string{role}},
				Resources:       []*types.ResourceSelector{{Kind: "document", Scope: ""}},
				Rules:           []*types.Rule{{Name: "r1", Actions: []string{"read"}, Effect: types.EffectAllow}},
			}
			index.Add(policy)
		}(i)
	}

	// Concurrent removers
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			role := roles[idx%len(roles)]
			policy := &types.Policy{
				Name:            fmt.Sprintf("concurrent-%s-%d", role, idx),
				PrincipalPolicy: true,
				Principal:       &types.PrincipalSelector{Roles: []string{role}},
				Resources:       []*types.ResourceSelector{{Kind: "document", Scope: ""}},
			}
			index.Remove(policy)
		}(i)
	}

	wg.Wait()
	close(errors)

	for err := range errors {
		t.Errorf("concurrent access error: %v", err)
	}
}

// ============================================================================
// Benchmark Tests
// ============================================================================

func BenchmarkFindByPrincipal(b *testing.B) {
	index := policy.NewPrincipalIndex()

	// Add 100 policies for different principals
	for i := 0; i < 100; i++ {
		policy := &types.Policy{
			Name:            fmt.Sprintf("policy-%d", i),
			PrincipalPolicy: true,
			Principal:       &types.PrincipalSelector{ID: fmt.Sprintf("user:%d", i%10)},
			Resources:       []*types.ResourceSelector{{Kind: "document", Scope: ""}},
			Rules:           []*types.Rule{{Name: "r1", Actions: []string{"read"}, Effect: types.EffectAllow}},
		}
		index.Add(policy)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		principalID := fmt.Sprintf("user:%d", i%10)
		_ = index.FindByPrincipal(principalID, "document")
	}
}

func BenchmarkFindByRoles(b *testing.B) {
	index := policy.NewPrincipalIndex()

	roles := []string{"admin", "manager", "viewer"}

	// Add 100 policies for different roles
	for i := 0; i < 100; i++ {
		policy := &types.Policy{
			Name:            fmt.Sprintf("policy-%d", i),
			PrincipalPolicy: true,
			Principal:       &types.PrincipalSelector{Roles: []string{roles[i%len(roles)]}},
			Resources:       []*types.ResourceSelector{{Kind: "document", Scope: ""}},
			Rules:           []*types.Rule{{Name: "r1", Actions: []string{"read"}, Effect: types.EffectAllow}},
		}
		index.Add(policy)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		role := roles[i%len(roles)]
		_ = index.FindByRoles([]string{role}, "document")
	}
}

func BenchmarkAddPrincipalPolicy(b *testing.B) {
	index := policy.NewPrincipalIndex()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		policy := &types.Policy{
			Name:            fmt.Sprintf("policy-%d", i),
			PrincipalPolicy: true,
			Principal:       &types.PrincipalSelector{ID: fmt.Sprintf("user:%d", i)},
			Resources:       []*types.ResourceSelector{{Kind: "document", Scope: ""}},
			Rules:           []*types.Rule{{Name: "r1", Actions: []string{"read"}, Effect: types.EffectAllow}},
		}
		index.Add(policy)
	}
}

func BenchmarkRemovePrincipalPolicy(b *testing.B) {
	index := policy.NewPrincipalIndex()

	// Pre-add policies
	policies := make([]*types.Policy, b.N)
	for i := 0; i < b.N; i++ {
		policies[i] = &types.Policy{
			Name:            fmt.Sprintf("policy-%d", i),
			PrincipalPolicy: true,
			Principal:       &types.PrincipalSelector{ID: fmt.Sprintf("user:%d", i)},
			Resources:       []*types.ResourceSelector{{Kind: "document", Scope: ""}},
			Rules:           []*types.Rule{{Name: "r1", Actions: []string{"read"}, Effect: types.EffectAllow}},
		}
		index.Add(policies[i])
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		index.Remove(policies[i])
	}
}
