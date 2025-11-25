package integration_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
)

// TestDerivedRolesWithDecisionEngine tests end-to-end integration
func TestDerivedRolesWithDecisionEngine(t *testing.T) {
	t.Run("should integrate derived roles with decision engine", func(t *testing.T) {
		// Create policy store
		store := policy.NewMemoryStore()

		// Add resource policy
		resourcePolicy := &types.Policy{
			Name:         "document-policy",
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "read-rule",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
					Roles:   []string{"owner"}, // Requires derived role "owner"
				},
			},
		}
		err := store.Add(resourcePolicy)
		require.NoError(t, err)

		// Add derived roles
		derivedRole := &types.DerivedRole{
			Name:        "owner",
			ParentRoles: []string{"user"},
			Condition:   "R.attr.ownerId == P.id",
		}
		err = store.AddDerivedRole(derivedRole)
		require.NoError(t, err)

		// Create engine
		cfg := engine.DefaultConfig()
		eng, err := engine.New(cfg, store)
		require.NoError(t, err)

		// Test: Principal is owner (should allow)
		req := &types.CheckRequest{
			RequestID: "req1",
			Principal: &types.Principal{
				ID:    "user123",
				Roles: []string{"user"},
			},
			Resource: &types.Resource{
				Kind: "document",
				ID:   "doc1",
				Attributes: map[string]interface{}{
					"ownerId": "user123",
				},
			},
			Actions: []string{"read"},
		}

		resp, err := eng.Check(context.Background(), req)
		require.NoError(t, err)
		assert.Equal(t, types.EffectAllow, resp.Results["read"].Effect, "Owner should be allowed to read")

		// Test: Principal is not owner (should deny)
		req2 := &types.CheckRequest{
			RequestID: "req2",
			Principal: &types.Principal{
				ID:    "user456",
				Roles: []string{"user"},
			},
			Resource: &types.Resource{
				Kind: "document",
				ID:   "doc1",
				Attributes: map[string]interface{}{
					"ownerId": "user123",
				},
			},
			Actions: []string{"read"},
		}

		resp2, err := eng.Check(context.Background(), req2)
		require.NoError(t, err)
		assert.Equal(t, types.EffectDeny, resp2.Results["read"].Effect, "Non-owner should be denied")
	})

	t.Run("should handle derived roles with principal policies", func(t *testing.T) {
		store := policy.NewMemoryStore()

		// Add principal policy that uses derived role
		principalPolicy := &types.Policy{
			Name:            "admin-policy",
			PrincipalPolicy: true,
			Principal: &types.PrincipalSelector{
				Roles: []string{"super_admin"}, // Derived role
			},
			Resources: []*types.ResourceSelector{
				{Kind: "*", Scope: "**"},
			},
			Rules: []*types.Rule{
				{
					Name:    "allow-all",
					Actions: []string{"*"},
					Effect:  types.EffectAllow,
				},
			},
		}
		err := store.Add(principalPolicy)
		require.NoError(t, err)

		// Add derived role
		derivedRole := &types.DerivedRole{
			Name:        "super_admin",
			ParentRoles: []string{"admin:*"},
			Condition:   "P.attr.seniorityYears > 5",
		}
		err = store.AddDerivedRole(derivedRole)
		require.NoError(t, err)

		// Create engine
		cfg := engine.DefaultConfig()
		eng, err := engine.New(cfg, store)
		require.NoError(t, err)

		// Test: Admin with high seniority (should get super_admin)
		req := &types.CheckRequest{
			RequestID: "req1",
			Principal: &types.Principal{
				ID:    "admin1",
				Roles: []string{"admin:level3"},
				Attributes: map[string]interface{}{
					"seniorityYears": 7,
				},
			},
			Resource: &types.Resource{
				Kind: "document",
				ID:   "sensitive-doc",
			},
			Actions: []string{"delete"},
		}

		resp, err := eng.Check(context.Background(), req)
		require.NoError(t, err)
		assert.Equal(t, types.EffectAllow, resp.Results["delete"].Effect, "Senior admin should have super_admin role")
	})
}

// TestDerivedRolesWithResourcePolicies tests interaction with resource policies
func TestDerivedRolesWithResourcePolicies(t *testing.T) {
	t.Run("should use derived roles in resource policy evaluation", func(t *testing.T) {
		store := policy.NewMemoryStore()

		// Resource policy with scoped access
		resourcePolicy := &types.Policy{
			Name:         "scoped-document-policy",
			ResourceKind: "document",
			Scope:        "acme.corp.*",
			Rules: []*types.Rule{
				{
					Name:    "write-rule",
					Actions: []string{"write"},
					Effect:  types.EffectAllow,
					Roles:   []string{"department_editor"},
				},
			},
		}
		err := store.Add(resourcePolicy)
		require.NoError(t, err)

		// Derived role based on department matching
		derivedRole := &types.DerivedRole{
			Name:        "department_editor",
			ParentRoles: []string{"employee"},
			Condition:   "P.attr.department == R.attr.department",
		}
		err = store.AddDerivedRole(derivedRole)
		require.NoError(t, err)

		// Create engine
		cfg := engine.DefaultConfig()
		eng, err := engine.New(cfg, store)
		require.NoError(t, err)

		// Test: Same department (should allow)
		req := &types.CheckRequest{
			RequestID: "req1",
			Principal: &types.Principal{
				ID:    "emp123",
				Roles: []string{"employee"},
				Attributes: map[string]interface{}{
					"department": "engineering",
				},
			},
			Resource: &types.Resource{
				Kind:  "document",
				Scope: "acme.corp.docs",
				Attributes: map[string]interface{}{
					"department": "engineering",
				},
			},
			Actions: []string{"write"},
		}

		resp, err := eng.Check(context.Background(), req)
		require.NoError(t, err)
		assert.Equal(t, types.EffectAllow, resp.Results["write"].Effect)

		// Test: Different department (should deny)
		req2 := &types.CheckRequest{
			RequestID: "req2",
			Principal: &types.Principal{
				ID:    "emp456",
				Roles: []string{"employee"},
				Attributes: map[string]interface{}{
					"department": "sales",
				},
			},
			Resource: &types.Resource{
				Kind:  "document",
				Scope: "acme.corp.docs",
				Attributes: map[string]interface{}{
					"department": "engineering",
				},
			},
			Actions: []string{"write"},
		}

		resp2, err := eng.Check(context.Background(), req2)
		require.NoError(t, err)
		assert.Equal(t, types.EffectDeny, resp2.Results["write"].Effect)
	})

	t.Run("should handle multiple derived roles in single policy", func(t *testing.T) {
		store := policy.NewMemoryStore()

		// Resource policy accepts multiple roles
		resourcePolicy := &types.Policy{
			Name:         "collaborative-document",
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "read-rule",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
					Roles:   []string{"owner", "collaborator", "viewer"},
				},
			},
		}
		err := store.Add(resourcePolicy)
		require.NoError(t, err)

		// Multiple derived roles
		store.AddDerivedRole(&types.DerivedRole{
			Name:        "owner",
			ParentRoles: []string{"user"},
			Condition:   "R.attr.ownerId == P.id",
		})
		store.AddDerivedRole(&types.DerivedRole{
			Name:        "collaborator",
			ParentRoles: []string{"user"},
			Condition:   "P.id in R.attr.collaborators",
		})
		store.AddDerivedRole(&types.DerivedRole{
			Name:        "viewer",
			ParentRoles: []string{"user"},
			Condition:   "R.attr.public == true",
		})

		// Create engine
		cfg := engine.DefaultConfig()
		eng, err := engine.New(cfg, store)
		require.NoError(t, err)

		// Test: Owner can read
		req := &types.CheckRequest{
			RequestID: "req1",
			Principal: &types.Principal{ID: "user1", Roles: []string{"user"}},
			Resource: &types.Resource{
				Kind: "document",
				Attributes: map[string]interface{}{
					"ownerId":       "user1",
					"collaborators": []string{"user2", "user3"},
					"public":        false,
				},
			},
			Actions: []string{"read"},
		}

		resp, err := eng.Check(context.Background(), req)
		require.NoError(t, err)
		assert.Equal(t, types.EffectAllow, resp.Results["read"].Effect, "Owner should be allowed")

		// Test: Collaborator can read
		req2 := &types.CheckRequest{
			RequestID: "req2",
			Principal: &types.Principal{ID: "user2", Roles: []string{"user"}},
			Resource: &types.Resource{
				Kind: "document",
				Attributes: map[string]interface{}{
					"ownerId":       "user1",
					"collaborators": []string{"user2", "user3"},
					"public":        false,
				},
			},
			Actions: []string{"read"},
		}

		resp2, err := eng.Check(context.Background(), req2)
		require.NoError(t, err)
		assert.Equal(t, types.EffectAllow, resp2.Results["read"].Effect, "Collaborator should be allowed")

		// Test: Public viewer can read
		req3 := &types.CheckRequest{
			RequestID: "req3",
			Principal: &types.Principal{ID: "user999", Roles: []string{"user"}},
			Resource: &types.Resource{
				Kind: "document",
				Attributes: map[string]interface{}{
					"ownerId":       "user1",
					"collaborators": []string{"user2", "user3"},
					"public":        true,
				},
			},
			Actions: []string{"read"},
		}

		resp3, err := eng.Check(context.Background(), req3)
		require.NoError(t, err)
		assert.Equal(t, types.EffectAllow, resp3.Results["read"].Effect, "Public viewer should be allowed")
	})
}

// TestCacheEffectiveness tests caching in real scenarios
func TestCacheEffectiveness(t *testing.T) {
	t.Run("should cache derived roles across multiple requests", func(t *testing.T) {
		store := policy.NewMemoryStore()

		// Add policies
		resourcePolicy := &types.Policy{
			Name:         "cached-document-policy",
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "read-rule",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
					Roles:   []string{"owner"},
				},
			},
		}
		err := store.Add(resourcePolicy)
		require.NoError(t, err)

		derivedRole := &types.DerivedRole{
			Name:        "owner",
			ParentRoles: []string{"user"},
			Condition:   "R.attr.ownerId == P.id",
		}
		err = store.AddDerivedRole(derivedRole)
		require.NoError(t, err)

		// Create engine with caching enabled
		cfg := engine.DefaultConfig()
		cfg.CacheEnabled = true
		eng, err := engine.New(cfg, store)
		require.NoError(t, err)

		// Make same request multiple times
		principal := &types.Principal{ID: "user123", Roles: []string{"user"}}
		resource := &types.Resource{
			Kind:       "document",
			ID:         "doc1",
			Attributes: map[string]interface{}{"ownerId": "user123"},
		}

		for i := 0; i < 100; i++ {
			req := &types.CheckRequest{
				RequestID: fmt.Sprintf("req%d", i),
				Principal: principal,
				Resource:  resource,
				Actions:   []string{"read"},
			}

			resp, err := eng.Check(context.Background(), req)
			require.NoError(t, err)
			assert.Equal(t, types.EffectAllow, resp.Results["read"].Effect)
		}

		// Check engine cache statistics
		stats := eng.GetCacheStats()
		if stats != nil {
			t.Logf("Cache stats: hits=%d, misses=%d, hit rate=%.2f%%",
				stats.Hits, stats.Misses, stats.HitRate*100)
		}
	})
}

// TestComplexScenarios tests complex real-world scenarios
func TestComplexScenarios(t *testing.T) {
	t.Run("should handle multi-tenant isolation with derived roles", func(t *testing.T) {
		store := policy.NewMemoryStore()

		// Derived role for tenant membership
		derivedRole := &types.DerivedRole{
			Name:        "tenant_member",
			ParentRoles: []string{"user"},
			Condition:   "P.attr.tenantId == R.attr.tenantId",
		}
		err := store.AddDerivedRole(derivedRole)
		require.NoError(t, err)

		// Resource policy requires tenant membership
		resourcePolicy := &types.Policy{
			Name:         "tenant-document-policy",
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "access-rule",
					Actions: []string{"read", "write"},
					Effect:  types.EffectAllow,
					Roles:   []string{"tenant_member"},
				},
			},
		}
		err = store.Add(resourcePolicy)
		require.NoError(t, err)

		// Create engine
		cfg := engine.DefaultConfig()
		eng, err := engine.New(cfg, store)
		require.NoError(t, err)

		// Test: Same tenant (should allow)
		req := &types.CheckRequest{
			RequestID: "req1",
			Principal: &types.Principal{
				ID:         "user1",
				Roles:      []string{"user"},
				Attributes: map[string]interface{}{"tenantId": "tenant-a"},
			},
			Resource: &types.Resource{
				Kind:       "document",
				Attributes: map[string]interface{}{"tenantId": "tenant-a"},
			},
			Actions: []string{"read"},
		}

		resp, err := eng.Check(context.Background(), req)
		require.NoError(t, err)
		assert.Equal(t, types.EffectAllow, resp.Results["read"].Effect, "Same tenant should be allowed")

		// Test: Different tenant (should deny)
		req2 := &types.CheckRequest{
			RequestID: "req2",
			Principal: &types.Principal{
				ID:         "user1",
				Roles:      []string{"user"},
				Attributes: map[string]interface{}{"tenantId": "tenant-a"},
			},
			Resource: &types.Resource{
				Kind:       "document",
				Attributes: map[string]interface{}{"tenantId": "tenant-b"},
			},
			Actions: []string{"read"},
		}

		resp2, err := eng.Check(context.Background(), req2)
		require.NoError(t, err)
		assert.Equal(t, types.EffectDeny, resp2.Results["read"].Effect, "Different tenant should be denied")
	})
}
