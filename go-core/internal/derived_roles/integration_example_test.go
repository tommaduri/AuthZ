package derived_roles_test

import (
	"testing"

	"github.com/authz-engine/go-core/internal/derived_roles"
	"github.com/authz-engine/go-core/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestComplexHierarchy demonstrates a realistic organizational hierarchy
// with multiple levels of derived roles and conditional activation
func TestComplexHierarchy(t *testing.T) {
	resolver, err := derived_roles.NewDerivedRolesResolver()
	require.NoError(t, err)

	// Define organizational hierarchy with derived roles
	derivedRoles := []*types.DerivedRole{
		// Level 1: Team lead requires employee + 2 years experience
		{
			Name:        "team_lead",
			ParentRoles: []string{"employee"},
			Condition:   `principal.attr.yearsOfService >= 2`,
		},
		// Level 2: Senior lead requires team_lead + 5 years
		{
			Name:        "senior_lead",
			ParentRoles: []string{"team_lead"},
			Condition:   `principal.attr.yearsOfService >= 5`,
		},
		// Level 3: Director requires senior_lead + 8 years
		{
			Name:        "director",
			ParentRoles: []string{"senior_lead"},
			Condition:   `principal.attr.yearsOfService >= 8`,
		},
		// Specialist role: Engineering manager requires manager + engineering dept
		{
			Name:        "engineering_manager",
			ParentRoles: []string{"manager"},
			Condition:   `principal.attr.department == "engineering"`,
		},
		// Cross-functional: Tech director requires both director + engineering_manager
		{
			Name:        "tech_director",
			ParentRoles: []string{"director", "engineering_manager"},
			Condition:   "",
		},
	}

	tests := []struct {
		name           string
		principal      *types.Principal
		expectedRoles  []string
		unexpectedRoles []string
	}{
		{
			name: "junior employee - no derivation",
			principal: &types.Principal{
				ID:    "user:bob",
				Roles: []string{"employee"},
				Attributes: map[string]interface{}{
					"yearsOfService": 1,
				},
			},
			expectedRoles:  []string{"employee"},
			unexpectedRoles: []string{"team_lead", "senior_lead", "director"},
		},
		{
			name: "mid-level employee - team_lead only",
			principal: &types.Principal{
				ID:    "user:charlie",
				Roles: []string{"employee"},
				Attributes: map[string]interface{}{
					"yearsOfService": 3,
				},
			},
			expectedRoles:  []string{"employee", "team_lead"},
			unexpectedRoles: []string{"senior_lead", "director"},
		},
		{
			name: "senior employee - full chain to senior_lead",
			principal: &types.Principal{
				ID:    "user:diana",
				Roles: []string{"employee"},
				Attributes: map[string]interface{}{
					"yearsOfService": 6,
				},
			},
			expectedRoles:  []string{"employee", "team_lead", "senior_lead"},
			unexpectedRoles: []string{"director"},
		},
		{
			name: "veteran employee - full chain to director",
			principal: &types.Principal{
				ID:    "user:eve",
				Roles: []string{"employee"},
				Attributes: map[string]interface{}{
					"yearsOfService": 10,
				},
			},
			expectedRoles:  []string{"employee", "team_lead", "senior_lead", "director"},
			unexpectedRoles: []string{"engineering_manager", "tech_director"},
		},
		{
			name: "engineering manager - specialist path",
			principal: &types.Principal{
				ID:    "user:frank",
				Roles: []string{"employee", "manager"},
				Attributes: map[string]interface{}{
					"yearsOfService": 4,
					"department":     "engineering",
				},
			},
			expectedRoles:  []string{"employee", "manager", "team_lead", "engineering_manager"},
			unexpectedRoles: []string{"tech_director"},
		},
		{
			name: "tech director - full cross-functional",
			principal: &types.Principal{
				ID:    "user:grace",
				Roles: []string{"employee", "manager"},
				Attributes: map[string]interface{}{
					"yearsOfService": 10,
					"department":     "engineering",
				},
			},
			expectedRoles: []string{
				"employee", "manager", "team_lead", "senior_lead",
				"director", "engineering_manager", "tech_director",
			},
			unexpectedRoles: []string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolved, err := resolver.Resolve(tt.principal, nil, derivedRoles)
			require.NoError(t, err)

			for _, expectedRole := range tt.expectedRoles {
				assert.Contains(t, resolved, expectedRole,
					"Expected role %q to be granted", expectedRole)
			}

			for _, unexpectedRole := range tt.unexpectedRoles {
				assert.NotContains(t, resolved, unexpectedRole,
					"Expected role %q NOT to be granted", unexpectedRole)
			}
		})
	}
}

// TestResourceContextDerivation demonstrates derived roles based on resource attributes
func TestResourceContextDerivation(t *testing.T) {
	resolver, err := derived_roles.NewDerivedRolesResolver()
	require.NoError(t, err)

	derivedRoles := []*types.DerivedRole{
		{
			Name:        "document_owner",
			ParentRoles: []string{"employee"},
			Condition:   `principal.id == resource.attr.ownerId`,
		},
		{
			Name:        "document_approver",
			ParentRoles: []string{"document_owner", "manager"},
			Condition:   `resource.attr.status == "pending_approval"`,
		},
	}

	principal := &types.Principal{
		ID:    "user:alice",
		Roles: []string{"employee", "manager"},
	}

	// Alice owns this document
	ownedDocument := &types.Resource{
		Kind: "document",
		ID:   "doc:123",
		Attributes: map[string]interface{}{
			"ownerId": "user:alice",
			"status":  "pending_approval",
		},
	}

	resolved, err := resolver.Resolve(principal, ownedDocument, derivedRoles)
	require.NoError(t, err)
	assert.Contains(t, resolved, "employee")
	assert.Contains(t, resolved, "manager")
	assert.Contains(t, resolved, "document_owner")
	assert.Contains(t, resolved, "document_approver")

	// Alice does not own this document
	otherDocument := &types.Resource{
		Kind: "document",
		ID:   "doc:456",
		Attributes: map[string]interface{}{
			"ownerId": "user:bob",
			"status":  "pending_approval",
		},
	}

	resolved2, err := resolver.Resolve(principal, otherDocument, derivedRoles)
	require.NoError(t, err)
	assert.Contains(t, resolved2, "employee")
	assert.Contains(t, resolved2, "manager")
	assert.NotContains(t, resolved2, "document_owner")
	assert.NotContains(t, resolved2, "document_approver")
}

// TestCacheIntegration verifies cache behavior with resolver
func TestCacheIntegration(t *testing.T) {
	cache := derived_roles.NewDerivedRolesCache()

	principal := &types.Principal{
		ID:    "user:alice",
		Roles: []string{"employee", "manager"},
		Attributes: map[string]interface{}{
			"yearsOfService": 6,
		},
	}

	resource := &types.Resource{
		Kind: "document",
		ID:   "doc:123",
	}

	// Initially not cached
	cached, found := cache.Get(principal, resource)
	assert.False(t, found)
	assert.Nil(t, cached)

	// Simulate resolver result
	resolvedRoles := []string{"employee", "manager", "senior_manager"}
	cache.Set(principal, resource, resolvedRoles)

	// Now cached
	cached, found = cache.Get(principal, resource)
	assert.True(t, found)
	assert.Equal(t, resolvedRoles, cached)

	// Different resource = different cache entry
	otherResource := &types.Resource{
		Kind: "project",
		ID:   "proj:456",
	}

	cached, found = cache.Get(principal, otherResource)
	assert.False(t, found) // Not cached for this resource
}
