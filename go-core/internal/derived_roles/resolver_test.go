package derived_roles

import (
	"testing"

	"github.com/authz-engine/go-core/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewDerivedRolesResolver(t *testing.T) {
	resolver, err := NewDerivedRolesResolver()
	require.NoError(t, err)
	assert.NotNil(t, resolver)
	assert.NotNil(t, resolver.celEngine)
}

func TestResolve_NoDerivation(t *testing.T) {
	resolver, err := NewDerivedRolesResolver()
	require.NoError(t, err)

	principal := &types.Principal{
		ID:    "user:alice",
		Roles: []string{"employee", "engineer"},
	}

	// No derived roles defined
	resolved, err := resolver.Resolve(principal, nil, []*types.DerivedRole{})
	require.NoError(t, err)
	assert.Equal(t, []string{"employee", "engineer"}, resolved)
}

func TestResolve_SimpleDerivation(t *testing.T) {
	resolver, err := NewDerivedRolesResolver()
	require.NoError(t, err)

	principal := &types.Principal{
		ID:    "user:alice",
		Roles: []string{"employee", "manager"},
		Attributes: map[string]interface{}{
			"department": "engineering",
		},
	}

	derivedRoles := []*types.DerivedRole{
		{
			Name:        "senior_manager",
			ParentRoles: []string{"manager"},
			Condition:   `principal.attr.department == "engineering"`,
		},
	}

	resolved, err := resolver.Resolve(principal, nil, derivedRoles)
	require.NoError(t, err)
	assert.Contains(t, resolved, "employee")
	assert.Contains(t, resolved, "manager")
	assert.Contains(t, resolved, "senior_manager")
}

func TestResolve_WildcardMatching(t *testing.T) {
	resolver, err := NewDerivedRolesResolver()
	require.NoError(t, err)

	tests := []struct {
		name          string
		principalRole []string
		parentRoles   []string
		shouldMatch   bool
	}{
		{
			name:          "exact match",
			principalRole: []string{"admin"},
			parentRoles:   []string{"admin"},
			shouldMatch:   true,
		},
		{
			name:          "wildcard *",
			principalRole: []string{"anything"},
			parentRoles:   []string{"*"},
			shouldMatch:   true,
		},
		{
			name:          "prefix wildcard",
			principalRole: []string{"admin:read", "admin:write"},
			parentRoles:   []string{"admin:*"},
			shouldMatch:   true,
		},
		{
			name:          "suffix wildcard",
			principalRole: []string{"document:viewer", "project:viewer"},
			parentRoles:   []string{"*:viewer"},
			shouldMatch:   true,
		},
		{
			name:          "no match",
			principalRole: []string{"employee"},
			parentRoles:   []string{"admin"},
			shouldMatch:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			principal := &types.Principal{
				ID:    "user:test",
				Roles: tt.principalRole,
			}

			derivedRole := &types.DerivedRole{
				Name:        "test_role",
				ParentRoles: tt.parentRoles,
				Condition:   "", // Always true
			}

			resolved, err := resolver.Resolve(principal, nil, []*types.DerivedRole{derivedRole})
			require.NoError(t, err)

			if tt.shouldMatch {
				assert.Contains(t, resolved, "test_role", "Expected derived role to be granted")
			} else {
				assert.NotContains(t, resolved, "test_role", "Expected derived role NOT to be granted")
			}
		})
	}
}

func TestResolve_DependencyChain(t *testing.T) {
	resolver, err := NewDerivedRolesResolver()
	require.NoError(t, err)

	principal := &types.Principal{
		ID:    "user:alice",
		Roles: []string{"employee"},
	}

	// Chain: employee -> team_lead -> senior_lead -> director
	derivedRoles := []*types.DerivedRole{
		{
			Name:        "team_lead",
			ParentRoles: []string{"employee"},
			Condition:   "", // Always true
		},
		{
			Name:        "senior_lead",
			ParentRoles: []string{"team_lead"},
			Condition:   "", // Always true
		},
		{
			Name:        "director",
			ParentRoles: []string{"senior_lead"},
			Condition:   "", // Always true
		},
	}

	resolved, err := resolver.Resolve(principal, nil, derivedRoles)
	require.NoError(t, err)
	assert.Contains(t, resolved, "employee")
	assert.Contains(t, resolved, "team_lead")
	assert.Contains(t, resolved, "senior_lead")
	assert.Contains(t, resolved, "director")
	assert.Len(t, resolved, 4)
}

func TestResolve_CircularDependency(t *testing.T) {
	resolver, err := NewDerivedRolesResolver()
	require.NoError(t, err)

	principal := &types.Principal{
		ID:    "user:alice",
		Roles: []string{"employee"},
	}

	// Circular: role_a -> role_b -> role_c -> role_a
	derivedRoles := []*types.DerivedRole{
		{
			Name:        "role_a",
			ParentRoles: []string{"role_c"},
		},
		{
			Name:        "role_b",
			ParentRoles: []string{"role_a"},
		},
		{
			Name:        "role_c",
			ParentRoles: []string{"role_b"},
		},
	}

	_, err = resolver.Resolve(principal, nil, derivedRoles)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "circular dependency")
}

func TestResolve_ConditionFalse(t *testing.T) {
	resolver, err := NewDerivedRolesResolver()
	require.NoError(t, err)

	principal := &types.Principal{
		ID:    "user:alice",
		Roles: []string{"manager"},
		Attributes: map[string]interface{}{
			"department": "sales",
		},
	}

	derivedRoles := []*types.DerivedRole{
		{
			Name:        "engineering_manager",
			ParentRoles: []string{"manager"},
			Condition:   `principal.attr.department == "engineering"`,
		},
	}

	resolved, err := resolver.Resolve(principal, nil, derivedRoles)
	require.NoError(t, err)
	assert.Contains(t, resolved, "manager")
	assert.NotContains(t, resolved, "engineering_manager")
}

func TestResolve_NilPrincipal(t *testing.T) {
	resolver, err := NewDerivedRolesResolver()
	require.NoError(t, err)

	_, err = resolver.Resolve(nil, nil, []*types.DerivedRole{})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "principal cannot be nil")
}
