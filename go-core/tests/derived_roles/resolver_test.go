package derived_roles_test

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/authz-engine/go-core/internal/derived_roles"
	"github.com/authz-engine/go-core/pkg/types"
)

// Test Helpers
func createPrincipal(id string, roles []string) *types.Principal {
	return &types.Principal{
		ID:         id,
		Roles:      roles,
		Attributes: make(map[string]interface{}),
	}
}

func createResource(kind, id string) *types.Resource {
	return &types.Resource{
		Kind:       kind,
		ID:         id,
		Attributes: make(map[string]interface{}),
	}
}

// TestBasicRoleDerivation tests basic derived role resolution
func TestBasicRoleDerivation(t *testing.T) {
	t.Run("should derive role when parent role matches and condition is true", func(t *testing.T) {
		resolver, err := derived_roles.NewDerivedRolesResolver()
		require.NoError(t, err)

		derivedRoles := []*types.DerivedRole{
			{
				Name:        "owner",
				ParentRoles: []string{"user"},
				Condition:   "resource.attr.ownerId == principal.id",
			},
		}

		principal := createPrincipal("user123", []string{"user"})
		principal.Attributes["id"] = "user123"

		resource := createResource("document", "doc1")
		resource.Attributes["ownerId"] = "user123"

		roles, err := resolver.Resolve(principal, resource, derivedRoles)
		require.NoError(t, err)
		assert.Contains(t, roles, "owner", "Should contain derived 'owner' role")
		assert.Contains(t, roles, "user", "Should retain original 'user' role")
	})

	t.Run("should not derive role when parent role does not match", func(t *testing.T) {
		resolver, err := derived_roles.NewDerivedRolesResolver()
		require.NoError(t, err)

		derivedRoles := []*types.DerivedRole{
			{
				Name:        "owner",
				ParentRoles: []string{"admin"}, // Requires admin role
				Condition:   "true",
			},
		}

		principal := createPrincipal("user123", []string{"user"}) // Only has user role
		resource := createResource("document", "doc1")

		roles, err := resolver.Resolve(principal, resource, derivedRoles)
		require.NoError(t, err)
		assert.NotContains(t, roles, "owner", "Should not derive 'owner' without admin role")
		assert.Contains(t, roles, "user", "Should retain original 'user' role")
	})

	t.Run("should not derive role when condition is false", func(t *testing.T) {
		resolver, err := derived_roles.NewDerivedRolesResolver()
		require.NoError(t, err)

		derivedRoles := []*types.DerivedRole{
			{
				Name:        "owner",
				ParentRoles: []string{"user"},
				Condition:   "resource.attr.ownerId == principal.id",
			},
		}

		principal := createPrincipal("user123", []string{"user"})
		principal.Attributes["id"] = "user123"

		resource := createResource("document", "doc1")
		resource.Attributes["ownerId"] = "different-user" // Doesn't match

		roles, err := resolver.Resolve(principal, resource, derivedRoles)
		require.NoError(t, err)
		assert.NotContains(t, roles, "owner", "Should not derive 'owner' when condition false")
		assert.Contains(t, roles, "user", "Should retain original 'user' role")
	})

	t.Run("should derive multiple roles when conditions match", func(t *testing.T) {
		resolver, err := derived_roles.NewDerivedRolesResolver()
		require.NoError(t, err)

		derivedRoles := []*types.DerivedRole{
			{
				Name:        "owner",
				ParentRoles: []string{"user"},
				Condition:   "resource.attr.ownerId == principal.id",
			},
			{
				Name:        "editor",
				ParentRoles: []string{"user"},
				Condition:   "resource.attr.department == principal.attr.department",
			},
		}

		principal := createPrincipal("user123", []string{"user"})
		principal.Attributes["id"] = "user123"
		principal.Attributes["department"] = "engineering"

		resource := createResource("document", "doc1")
		resource.Attributes["ownerId"] = "user123"
		resource.Attributes["department"] = "engineering"

		roles, err := resolver.Resolve(principal, resource, derivedRoles)
		require.NoError(t, err)
		assert.Contains(t, roles, "owner")
		assert.Contains(t, roles, "editor")
		assert.Contains(t, roles, "user")
	})
}

// TestWildcardParentRoles tests wildcard pattern matching in parent roles
func TestWildcardParentRoles(t *testing.T) {
	t.Run("should match all roles with asterisk wildcard", func(t *testing.T) {
		resolver, err := derived_roles.NewDerivedRolesResolver()
		require.NoError(t, err)

		derivedRoles := []*types.DerivedRole{
			{
				Name:        "superuser",
				ParentRoles: []string{"*"}, // Match any role
				Condition:   "true",
			},
		}

		principal := createPrincipal("user123", []string{"guest"})
		resource := createResource("document", "doc1")

		roles, err := resolver.Resolve(principal, resource, derivedRoles)
		require.NoError(t, err)
		assert.Contains(t, roles, "superuser", "Should derive role with * wildcard")
	})

	t.Run("should match roles with prefix wildcard", func(t *testing.T) {
		resolver, err := derived_roles.NewDerivedRolesResolver()
		require.NoError(t, err)

		derivedRoles := []*types.DerivedRole{
			{
				Name:        "admin-user",
				ParentRoles: []string{"admin:*"}, // Match admin:* pattern
				Condition:   "true",
			},
		}

		principal := createPrincipal("user123", []string{"admin:operations"})
		resource := createResource("document", "doc1")

		roles, err := resolver.Resolve(principal, resource, derivedRoles)
		require.NoError(t, err)
		assert.Contains(t, roles, "admin-user", "Should match prefix wildcard")
	})

	t.Run("should match roles with suffix wildcard", func(t *testing.T) {
		resolver, err := derived_roles.NewDerivedRolesResolver()
		require.NoError(t, err)

		derivedRoles := []*types.DerivedRole{
			{
				Name:        "manager-role",
				ParentRoles: []string{"*:manager"}, // Match *:manager pattern
				Condition:   "true",
			},
		}

		principal := createPrincipal("user123", []string{"department:manager"})
		resource := createResource("document", "doc1")

		roles, err := resolver.Resolve(principal, resource, derivedRoles)
		require.NoError(t, err)
		assert.Contains(t, roles, "manager-role", "Should match suffix wildcard")
	})
}

// TestRoleDependencies tests dependency resolution between derived roles
func TestRoleDependencies(t *testing.T) {
	t.Run("should resolve dependent roles in correct order", func(t *testing.T) {
		resolver, err := derived_roles.NewDerivedRolesResolver()
		require.NoError(t, err)

		// Role hierarchy: user -> editor -> owner
		derivedRoles := []*types.DerivedRole{
			{
				Name:        "editor",
				ParentRoles: []string{"user"},
				Condition:   "true",
			},
			{
				Name:        "owner",
				ParentRoles: []string{"editor"}, // Depends on editor
				Condition:   "resource.attr.ownerId == principal.id",
			},
		}

		principal := createPrincipal("user123", []string{"user"})
		principal.Attributes["id"] = "user123"

		resource := createResource("document", "doc1")
		resource.Attributes["ownerId"] = "user123"

		roles, err := resolver.Resolve(principal, resource, derivedRoles)
		require.NoError(t, err)
		assert.Contains(t, roles, "editor", "Should derive editor from user")
		assert.Contains(t, roles, "owner", "Should derive owner from editor")
	})

	t.Run("should detect circular dependencies", func(t *testing.T) {
		resolver, err := derived_roles.NewDerivedRolesResolver()
		require.NoError(t, err)

		// Circular dependency: role1 -> role2 -> role1
		derivedRoles := []*types.DerivedRole{
			{
				Name:        "role1",
				ParentRoles: []string{"role2"},
				Condition:   "true",
			},
			{
				Name:        "role2",
				ParentRoles: []string{"role1"},
				Condition:   "true",
			},
		}

		principal := createPrincipal("user123", []string{"role1"})
		resource := createResource("document", "doc1")

		_, err = resolver.Resolve(principal, resource, derivedRoles)
		assert.Error(t, err, "Should detect circular dependency")
		assert.Contains(t, err.Error(), "circular", "Error should mention circular dependency")
	})
}

// TestComplexCELConditions tests complex CEL expressions
func TestComplexCELConditions(t *testing.T) {
	t.Run("should evaluate complex boolean conditions", func(t *testing.T) {
		resolver, err := derived_roles.NewDerivedRolesResolver()
		require.NoError(t, err)

		derivedRoles := []*types.DerivedRole{
			{
				Name:        "senior-engineer",
				ParentRoles: []string{"engineer"},
				Condition:   "principal.attr.experience > 5 && principal.attr.level == 'senior'",
			},
		}

		principal := createPrincipal("user123", []string{"engineer"})
		principal.Attributes["experience"] = int64(7)
		principal.Attributes["level"] = "senior"

		resource := createResource("project", "proj1")

		roles, err := resolver.Resolve(principal, resource, derivedRoles)
		require.NoError(t, err)
		assert.Contains(t, roles, "senior-engineer")
	})

	t.Run("should handle list containment checks", func(t *testing.T) {
		resolver, err := derived_roles.NewDerivedRolesResolver()
		require.NoError(t, err)

		derivedRoles := []*types.DerivedRole{
			{
				Name:        "team-member",
				ParentRoles: []string{"user"},
				Condition:   "principal.id in resource.attr.team_members",
			},
		}

		principal := createPrincipal("user123", []string{"user"})

		resource := createResource("project", "proj1")
		resource.Attributes["team_members"] = []interface{}{"user123", "user456"}

		roles, err := resolver.Resolve(principal, resource, derivedRoles)
		require.NoError(t, err)
		assert.Contains(t, roles, "team-member")
	})
}

// TestEdgeCases tests edge cases and error handling
func TestEdgeCases(t *testing.T) {
	t.Run("should handle nil principal gracefully", func(t *testing.T) {
		resolver, err := derived_roles.NewDerivedRolesResolver()
		require.NoError(t, err)

		derivedRoles := []*types.DerivedRole{
			{Name: "owner", ParentRoles: []string{"user"}, Condition: "true"},
		}

		resource := createResource("document", "doc1")

		_, err = resolver.Resolve(nil, resource, derivedRoles)
		assert.Error(t, err, "Should return error for nil principal")
		assert.Contains(t, err.Error(), "principal", "Error should mention principal")
	})

	t.Run("should handle empty derived roles list", func(t *testing.T) {
		resolver, err := derived_roles.NewDerivedRolesResolver()
		require.NoError(t, err)

		principal := createPrincipal("user123", []string{"user"})
		resource := createResource("document", "doc1")

		roles, err := resolver.Resolve(principal, resource, []*types.DerivedRole{})
		require.NoError(t, err)
		assert.Equal(t, []string{"user"}, roles, "Should return original roles")
	})

	t.Run("should handle invalid CEL expression gracefully", func(t *testing.T) {
		resolver, err := derived_roles.NewDerivedRolesResolver()
		require.NoError(t, err)

		derivedRoles := []*types.DerivedRole{
			{
				Name:        "invalid",
				ParentRoles: []string{"user"},
				Condition:   "invalid syntax ::::",
			},
		}

		principal := createPrincipal("user123", []string{"user"})
		resource := createResource("document", "doc1")

		_, err = resolver.Resolve(principal, resource, derivedRoles)
		assert.Error(t, err, "Should return error for invalid CEL")
	})

	t.Run("should handle missing attributes in condition", func(t *testing.T) {
		resolver, err := derived_roles.NewDerivedRolesResolver()
		require.NoError(t, err)

		derivedRoles := []*types.DerivedRole{
			{
				Name:        "owner",
				ParentRoles: []string{"user"},
				Condition:   "resource.attr.ownerId == principal.attr.userId",
			},
		}

		principal := createPrincipal("user123", []string{"user"})
		// Missing userId attribute

		resource := createResource("document", "doc1")
		resource.Attributes["ownerId"] = "user123"

		roles, err := resolver.Resolve(principal, resource, derivedRoles)
		// Should handle gracefully (either error or false evaluation)
		if err == nil {
			assert.NotContains(t, roles, "owner", "Should not derive role with missing attributes")
		}
	})
}

// TestPerformance tests performance characteristics
func TestPerformance(t *testing.T) {
	t.Run("should handle large number of derived roles efficiently", func(t *testing.T) {
		resolver, err := derived_roles.NewDerivedRolesResolver()
		require.NoError(t, err)

		// Create 100 derived roles
		derivedRoles := make([]*types.DerivedRole, 100)
		for i := 0; i < 100; i++ {
			derivedRoles[i] = &types.DerivedRole{
				Name:        fmt.Sprintf("role-%d", i),
				ParentRoles: []string{"user"},
				Condition:   "true",
			}
		}

		principal := createPrincipal("user123", []string{"user"})
		resource := createResource("document", "doc1")

		// Should complete in reasonable time
		roles, err := resolver.Resolve(principal, resource, derivedRoles)
		require.NoError(t, err)
		assert.GreaterOrEqual(t, len(roles), 100, "Should derive all matching roles")
	})
}
