package integration

import (
	"context"
	"testing"

	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestDerivedRolesIntegration verifies validator and engine integration
func TestDerivedRolesIntegration(t *testing.T) {
	store := policy.NewMemoryStore()
	cfg := engine.DefaultConfig()
	eng, err := engine.New(cfg, store)
	require.NoError(t, err)

	// Add a simple derived role
	derivedRole := &types.DerivedRole{
		Name:        "senior_engineer",
		ParentRoles: []string{"engineer"},
		Condition:   "", // No condition
	}
	require.NoError(t, store.AddDerivedRole(derivedRole))

	// Add policy that requires the derived role
	pol := &types.Policy{
		APIVersion:      "authz.engine/v1",
		Name:            "senior-policy",
		PrincipalPolicy: true,
		Principal: &types.PrincipalSelector{
			Roles: []string{"senior_engineer"},
		},
		Resources: []*types.ResourceSelector{
			{Kind: "document"},
		},
		Rules: []*types.Rule{
			{
				Name:    "senior-access",
				Actions: []string{"approve"},
				Effect:  types.EffectAllow,
			},
		},
	}
	require.NoError(t, store.Add(pol))

	// Test: User with engineer role should get senior_engineer derived role
	req := &types.CheckRequest{
		RequestID: "derived-test",
		Principal: &types.Principal{
			ID:    "user:alice",
			Roles: []string{"engineer"},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc1",
		},
		Actions: []string{"approve"},
	}

	resp, err := eng.Check(context.Background(), req)
	require.NoError(t, err)

	// Should be allowed
	assert.Equal(t, types.EffectAllow, resp.Results["approve"].Effect)
	assert.Contains(t, resp.Metadata.DerivedRoles, "senior_engineer")
}

// TestDerivedRolesValidatorErrors tests validation error cases
func TestDerivedRolesValidatorErrors(t *testing.T) {
	store := policy.NewMemoryStore()

	// Invalid: Empty name
	err := store.AddDerivedRole(&types.DerivedRole{
		Name:        "",
		ParentRoles: []string{"engineer"},
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "name cannot be empty")

	// Invalid: No parent roles
	err = store.AddDerivedRole(&types.DerivedRole{
		Name:        "invalid",
		ParentRoles: []string{},
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "must have at least one parent role")

	// Invalid: Duplicate name
	err = store.AddDerivedRole(&types.DerivedRole{
		Name:        "senior",
		ParentRoles: []string{"engineer"},
	})
	assert.NoError(t, err)

	err = store.AddDerivedRole(&types.DerivedRole{
		Name:        "senior",
		ParentRoles: []string{"developer"},
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "already exists")
}

// TestDerivedRolesWithConditions tests CEL condition evaluation
func TestDerivedRolesWithConditions(t *testing.T) {
	store := policy.NewMemoryStore()
	cfg := engine.DefaultConfig()
	eng, err := engine.New(cfg, store)
	require.NoError(t, err)

	// Derived role with seniority condition
	derivedRole := &types.DerivedRole{
		Name:        "senior_engineer",
		ParentRoles: []string{"engineer"},
		Condition:   `principal.attr.seniority >= 5.0`,
	}
	require.NoError(t, store.AddDerivedRole(derivedRole))

	pol := &types.Policy{
		APIVersion:      "authz.engine/v1",
		Name:            "senior-policy",
		PrincipalPolicy: true,
		Principal: &types.PrincipalSelector{
			Roles: []string{"senior_engineer"},
		},
		Resources: []*types.ResourceSelector{
			{Kind: "document"},
		},
		Rules: []*types.Rule{
			{
				Name:    "senior-access",
				Actions: []string{"approve"},
				Effect:  types.EffectAllow,
			},
		},
	}
	require.NoError(t, store.Add(pol))

	// Test 1: Engineer with seniority >= 5
	reqSenior := &types.CheckRequest{
		RequestID: "senior",
		Principal: &types.Principal{
			ID:    "user:alice",
			Roles: []string{"engineer"},
			Attributes: map[string]interface{}{
				"seniority": 5.0,
			},
		},
		Resource: &types.Resource{Kind: "document", ID: "doc1"},
		Actions:  []string{"approve"},
	}

	respSenior, err := eng.Check(context.Background(), reqSenior)
	require.NoError(t, err)
	assert.Equal(t, types.EffectAllow, respSenior.Results["approve"].Effect)
	assert.Contains(t, respSenior.Metadata.DerivedRoles, "senior_engineer")

	// Test 2: Engineer with seniority < 5
	reqJunior := &types.CheckRequest{
		RequestID: "junior",
		Principal: &types.Principal{
			ID:    "user:bob",
			Roles: []string{"engineer"},
			Attributes: map[string]interface{}{
				"seniority": 3.0,
			},
		},
		Resource: &types.Resource{Kind: "document", ID: "doc1"},
		Actions:  []string{"approve"},
	}

	respJunior, err := eng.Check(context.Background(), reqJunior)
	require.NoError(t, err)
	assert.Equal(t, types.EffectDeny, respJunior.Results["approve"].Effect)
	assert.NotContains(t, respJunior.Metadata.DerivedRoles, "senior_engineer")
}
