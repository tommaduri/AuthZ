package phase5_test

import (
	"context"
	"testing"

	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestPhase1RegressionBasicAuthorization validates Phase 1 still works
func TestPhase1RegressionBasicAuthorization(t *testing.T) {
	ctx := context.Background()

	// Create engine WITHOUT Phase 5 features (regression test)
	cfg := engine.Config{
		CacheEnabled:       false,
		VectorStoreEnabled: false, // Phase 5 disabled
	}

	store := memory.NewMemoryStore()
	eng, err := engine.New(cfg, store)
	require.NoError(t, err, "Engine creation should work without Phase 5")

	// Add basic policy
	policy := &types.Policy{
		APIVersion: "api.authz.engine/v1",
		Name:       "basic-policy",
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.0",
			Rules: []*types.ResourceRule{
				{
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
					Roles:   []string{"viewer"},
				},
			},
		},
	}

	err = store.Add(ctx, policy)
	require.NoError(t, err)

	// Test basic authorization
	req := &types.CheckRequest{
		Principal: &types.Principal{
			ID:    "user:alice",
			Roles: []string{"viewer"},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-123",
		},
		Actions: []string{"read"},
	}

	resp, err := eng.Check(ctx, req)
	require.NoError(t, err)
	assert.Equal(t, types.EffectAllow, resp.Results["read"].Effect, "Phase 1 authorization should work")
}

// TestPhase2RegressionScopeResolution validates Phase 2 still works
func TestPhase2RegressionScopeResolution(t *testing.T) {
	ctx := context.Background()

	cfg := engine.Config{
		VectorStoreEnabled: false, // Phase 5 disabled
	}

	store := memory.NewMemoryStore()
	eng, err := engine.New(cfg, store)
	require.NoError(t, err)

	// Add scoped policies
	policies := []*types.Policy{
		{
			APIVersion: "api.authz.engine/v1",
			Name:       "org-policy",
			ResourcePolicy: &types.ResourcePolicy{
				Resource: "document",
				Scope:    "org:acme",
				Version:  "1.0",
				Rules: []*types.ResourceRule{
					{
						Actions: []string{"read"},
						Effect:  types.EffectAllow,
						Roles:   []string{"viewer"},
					},
				},
			},
		},
		{
			APIVersion: "api.authz.engine/v1",
			Name:       "team-policy",
			ResourcePolicy: &types.ResourcePolicy{
				Resource: "document",
				Scope:    "org:acme.team:engineering",
				Version:  "1.0",
				Rules: []*types.ResourceRule{
					{
						Actions: []string{"write"},
						Effect:  types.EffectAllow,
						Roles:   []string{"editor"},
					},
				},
			},
		},
	}

	for _, policy := range policies {
		err := store.Add(ctx, policy)
		require.NoError(t, err)
	}

	// Test scope resolution
	req := &types.CheckRequest{
		Principal: &types.Principal{
			ID:    "user:alice",
			Roles: []string{"viewer", "editor"},
			Scope: "org:acme.team:engineering",
		},
		Resource: &types.Resource{
			Kind:  "document",
			ID:    "doc-123",
			Scope: "org:acme.team:engineering",
		},
		Actions: []string{"read", "write"},
	}

	resp, err := eng.Check(ctx, req)
	require.NoError(t, err)
	assert.Equal(t, types.EffectAllow, resp.Results["read"].Effect, "Scope resolution should work")
	assert.Equal(t, types.EffectAllow, resp.Results["write"].Effect, "Team scope should work")
}

// TestPhase3RegressionPrincipalPolicies validates Phase 3 still works
func TestPhase3RegressionPrincipalPolicies(t *testing.T) {
	ctx := context.Background()

	cfg := engine.Config{
		VectorStoreEnabled: false,
	}

	store := memory.NewMemoryStore()
	eng, err := engine.New(cfg, store)
	require.NoError(t, err)

	// Add principal policy
	principalPolicy := &types.Policy{
		APIVersion:      "api.authz.engine/v1",
		Name:            "vip-policy",
		PrincipalPolicy: true,
		Principal: &types.PrincipalSelector{
			ID: "user:vip",
		},
		Resources: []*types.ResourceSelector{
			{Kind: "*", Scope: "**"},
		},
		Rules: []*types.PrincipalRule{
			{
				Actions: []string{"*"},
				Effect:  types.EffectAllow,
			},
		},
	}

	err = store.Add(ctx, principalPolicy)
	require.NoError(t, err)

	// Test principal policy
	req := &types.CheckRequest{
		Principal: &types.Principal{
			ID:    "user:vip",
			Roles: []string{},
		},
		Resource: &types.Resource{
			Kind:  "document",
			ID:    "doc-123",
			Scope: "org:acme",
		},
		Actions: []string{"read", "write", "delete"},
	}

	resp, err := eng.Check(ctx, req)
	require.NoError(t, err)
	assert.Equal(t, types.EffectAllow, resp.Results["read"].Effect, "VIP should have access")
	assert.Equal(t, types.EffectAllow, resp.Results["write"].Effect, "VIP should have access")
	assert.Equal(t, types.EffectAllow, resp.Results["delete"].Effect, "VIP should have access")
}

// TestPhase4RegressionDerivedRoles validates Phase 4 still works
func TestPhase4RegressionDerivedRoles(t *testing.T) {
	ctx := context.Background()

	cfg := engine.Config{
		VectorStoreEnabled: false,
	}

	store := memory.NewMemoryStore()
	eng, err := engine.New(cfg, store)
	require.NoError(t, err)

	// Add derived roles policy
	derivedRolesPolicy := &types.Policy{
		APIVersion: "api.authz.engine/v1",
		Name:       "derived-roles",
		DerivedRoles: &types.DerivedRoles{
			Name: "test-derived-roles",
			Definitions: []*types.RoleDef{
				{
					Name:        "org-admin",
					ParentRoles: []string{"admin"},
					Condition: &types.Condition{
						Match: &types.Match{
							Expr: `P.attr.org == R.scope`,
						},
					},
				},
			},
		},
	}

	resourcePolicy := &types.Policy{
		APIVersion: "api.authz.engine/v1",
		Name:       "admin-policy",
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.0",
			ImportDerivedRoles: []string{"test-derived-roles"},
			Rules: []*types.ResourceRule{
				{
					Actions:      []string{"*"},
					Effect:       types.EffectAllow,
					DerivedRoles: []string{"org-admin"},
				},
			},
		},
	}

	err = store.Add(ctx, derivedRolesPolicy)
	require.NoError(t, err)
	err = store.Add(ctx, resourcePolicy)
	require.NoError(t, err)

	// Test derived roles
	req := &types.CheckRequest{
		Principal: &types.Principal{
			ID:    "user:alice",
			Roles: []string{"admin"},
			Scope: "org:acme",
			Attributes: map[string]interface{}{
				"org": "acme",
			},
		},
		Resource: &types.Resource{
			Kind:  "document",
			ID:    "doc-123",
			Scope: "acme",
		},
		Actions: []string{"read", "write"},
	}

	resp, err := eng.Check(ctx, req)
	require.NoError(t, err)
	assert.Equal(t, types.EffectAllow, resp.Results["read"].Effect, "Derived roles should work")
	assert.Equal(t, types.EffectAllow, resp.Results["write"].Effect, "Derived roles should work")
}

// TestAllPhasesRegressionWithPhase5Disabled validates all phases work with Phase 5 disabled
func TestAllPhasesRegressionWithPhase5Disabled(t *testing.T) {
	ctx := context.Background()

	// Create engine with Phase 5 EXPLICITLY disabled
	cfg := engine.Config{
		CacheEnabled:       true,
		VectorStoreEnabled: false, // ← Phase 5 disabled
	}

	store := memory.NewMemoryStore()
	eng, err := engine.New(cfg, store)
	require.NoError(t, err, "Engine should work with Phase 5 disabled")

	// Add policies from all phases
	policies := []*types.Policy{
		// Phase 2: Scoped policy
		{
			APIVersion: "api.authz.engine/v1",
			Name:       "scoped-policy",
			ResourcePolicy: &types.ResourcePolicy{
				Resource: "document",
				Scope:    "org:acme",
				Version:  "1.0",
				Rules: []*types.ResourceRule{
					{
						Actions: []string{"read"},
						Effect:  types.EffectAllow,
						Roles:   []string{"viewer"},
					},
				},
			},
		},
		// Phase 3: Principal policy
		{
			APIVersion:      "api.authz.engine/v1",
			Name:            "principal-policy",
			PrincipalPolicy: true,
			Principal: &types.PrincipalSelector{
				ID: "user:vip",
			},
			Resources: []*types.ResourceSelector{
				{Kind: "*", Scope: "**"},
			},
			Rules: []*types.PrincipalRule{
				{
					Actions: []string{"*"},
					Effect:  types.EffectAllow,
				},
			},
		},
	}

	for _, policy := range policies {
		err := store.Add(ctx, policy)
		require.NoError(t, err)
	}

	// Test authorization works
	req := &types.CheckRequest{
		Principal: &types.Principal{
			ID:    "user:alice",
			Roles: []string{"viewer"},
			Scope: "org:acme",
		},
		Resource: &types.Resource{
			Kind:  "document",
			ID:    "doc-123",
			Scope: "org:acme",
		},
		Actions: []string{"read"},
	}

	resp, err := eng.Check(ctx, req)
	require.NoError(t, err)
	assert.Equal(t, types.EffectAllow, resp.Results["read"].Effect, "Authorization should work without Phase 5")

	// Verify NO vector store available
	vectorStore := eng.GetVectorStore()
	assert.Nil(t, vectorStore, "Vector store should be nil when disabled")
}
