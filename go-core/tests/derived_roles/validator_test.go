package derived_roles_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/authz-engine/go-core/internal/derived_roles"
	"github.com/authz-engine/go-core/pkg/types"
)

// TestSchemaValidation tests derived roles schema validation
func TestSchemaValidation(t *testing.T) {
	t.Run("should accept valid derived roles policy", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		policy := &types.DerivedRolesPolicy{
			Name: "valid-policy",
			Definitions: []types.DerivedRoleDefinition{
				{
					Name:        "owner",
					ParentRoles: []string{"user"},
					Condition:   types.Condition{Expression: "true"},
				},
			},
		}

		err := validator.Validate([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)
	})

	t.Run("should reject duplicate role names", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		policy := &types.DerivedRolesPolicy{
			Name: "duplicate-policy",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "owner", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "true"}},
				{Name: "owner", ParentRoles: []string{"admin"}, Condition: types.Condition{Expression: "true"}}, // Duplicate
			},
		}

		err := validator.Validate([]*types.DerivedRolesPolicy{policy})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "duplicate", "Should mention duplicate")
		assert.Contains(t, err.Error(), "owner", "Should mention the duplicate role name")
	})

	t.Run("should reject invalid role names with special characters", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		invalidNames := []string{"owner@role", "role#1", "role$test", "role%bad"}
		for _, name := range invalidNames {
			policy := &types.DerivedRolesPolicy{
				Name: "invalid-name-policy",
				Definitions: []types.DerivedRoleDefinition{
					{Name: name, ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "true"}},
				},
			}

			err := validator.Validate([]*types.DerivedRolesPolicy{policy})
			require.Error(t, err, "Should reject role name: %s", name)
			assert.Contains(t, err.Error(), "invalid", "Should mention invalid name")
		}
	})

	t.Run("should accept role names with hyphens and underscores", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		policy := &types.DerivedRolesPolicy{
			Name: "valid-names",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "owner-role", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "true"}},
				{Name: "admin_role", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "true"}},
				{Name: "super-admin_v2", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := validator.Validate([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)
	})

	t.Run("should reject empty role names", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		policy := &types.DerivedRolesPolicy{
			Name: "empty-name-policy",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := validator.Validate([]*types.DerivedRolesPolicy{policy})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "empty", "Should mention empty name")
	})
}

// TestParentRoleValidation tests parent role validation
func TestParentRoleValidation(t *testing.T) {
	t.Run("should accept wildcard '*' parent role", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		policy := &types.DerivedRolesPolicy{
			Name: "wildcard-policy",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "authenticated", ParentRoles: []string{"*"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := validator.Validate([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)
	})

	t.Run("should accept prefix wildcard 'prefix:*' parent role", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		policy := &types.DerivedRolesPolicy{
			Name: "prefix-wildcard-policy",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "admin", ParentRoles: []string{"admin:*"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := validator.Validate([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)
	})

	t.Run("should accept suffix wildcard '*:suffix' parent role", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		policy := &types.DerivedRolesPolicy{
			Name: "suffix-wildcard-policy",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "writer", ParentRoles: []string{"*:write"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := validator.Validate([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)
	})

	t.Run("should reject invalid wildcard patterns", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		invalidPatterns := []string{"admin*", "*admin", "admin:*:role", "ad*min"}
		for _, pattern := range invalidPatterns {
			policy := &types.DerivedRolesPolicy{
				Name: "invalid-wildcard",
				Definitions: []types.DerivedRoleDefinition{
					{Name: "admin", ParentRoles: []string{pattern}, Condition: types.Condition{Expression: "true"}},
				},
			}

			err := validator.Validate([]*types.DerivedRolesPolicy{policy})
			require.Error(t, err, "Should reject pattern: %s", pattern)
			assert.Contains(t, err.Error(), "invalid", "Should mention invalid pattern")
		}
	})

	t.Run("should accept empty parent roles array", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		policy := &types.DerivedRolesPolicy{
			Name: "empty-parents",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "public", ParentRoles: []string{}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := validator.Validate([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)
	})
}

// TestCircularDependencyDetection tests circular dependency validation
func TestCircularDependencyDetectionValidator(t *testing.T) {
	t.Run("should detect simple circular dependency (A -> B -> A)", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		policy := &types.DerivedRolesPolicy{
			Name: "circular",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "roleA", ParentRoles: []string{"roleB"}, Condition: types.Condition{Expression: "true"}},
				{Name: "roleB", ParentRoles: []string{"roleA"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := validator.Validate([]*types.DerivedRolesPolicy{policy})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "circular")
	})

	t.Run("should detect complex circular dependency (A -> B -> C -> A)", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		policy := &types.DerivedRolesPolicy{
			Name: "circular",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "roleA", ParentRoles: []string{"roleB"}, Condition: types.Condition{Expression: "true"}},
				{Name: "roleB", ParentRoles: []string{"roleC"}, Condition: types.Condition{Expression: "true"}},
				{Name: "roleC", ParentRoles: []string{"roleA"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := validator.Validate([]*types.DerivedRolesPolicy{policy})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "circular")
	})

	t.Run("should detect self-referencing role", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		policy := &types.DerivedRolesPolicy{
			Name: "self-ref",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "recursive", ParentRoles: []string{"recursive"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := validator.Validate([]*types.DerivedRolesPolicy{policy})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "circular")
	})

	t.Run("should allow roles depending on base roles (not derived)", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		policy := &types.DerivedRolesPolicy{
			Name: "valid",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "owner", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "true"}},
				{Name: "admin", ParentRoles: []string{"superuser"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := validator.Validate([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)
	})

	t.Run("should allow valid dependency chain without cycles", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		policy := &types.DerivedRolesPolicy{
			Name: "chain",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "level1", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "true"}},
				{Name: "level2", ParentRoles: []string{"level1"}, Condition: types.Condition{Expression: "true"}},
				{Name: "level3", ParentRoles: []string{"level2"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := validator.Validate([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)
	})

	t.Run("should handle diamond dependency (A -> B, A -> C, B -> D, C -> D)", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		policy := &types.DerivedRolesPolicy{
			Name: "diamond",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "roleD", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "true"}},
				{Name: "roleB", ParentRoles: []string{"roleD"}, Condition: types.Condition{Expression: "true"}},
				{Name: "roleC", ParentRoles: []string{"roleD"}, Condition: types.Condition{Expression: "true"}},
				{Name: "roleA", ParentRoles: []string{"roleB", "roleC"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := validator.Validate([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)
	})

	t.Run("should handle multiple independent chains", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		policy := &types.DerivedRolesPolicy{
			Name: "multi-chain",
			Definitions: []types.DerivedRoleDefinition{
				// Chain 1
				{Name: "chain1_a", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "true"}},
				{Name: "chain1_b", ParentRoles: []string{"chain1_a"}, Condition: types.Condition{Expression: "true"}},
				// Chain 2
				{Name: "chain2_a", ParentRoles: []string{"admin"}, Condition: types.Condition{Expression: "true"}},
				{Name: "chain2_b", ParentRoles: []string{"chain2_a"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := validator.Validate([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)
	})

	t.Run("should detect cycle in one chain while others are valid", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		policy := &types.DerivedRolesPolicy{
			Name: "partial-cycle",
			Definitions: []types.DerivedRoleDefinition{
				// Valid chain
				{Name: "valid_a", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "true"}},
				{Name: "valid_b", ParentRoles: []string{"valid_a"}, Condition: types.Condition{Expression: "true"}},
				// Circular chain
				{Name: "circular_a", ParentRoles: []string{"circular_b"}, Condition: types.Condition{Expression: "true"}},
				{Name: "circular_b", ParentRoles: []string{"circular_a"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := validator.Validate([]*types.DerivedRolesPolicy{policy})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "circular")
	})
}

// TestConditionValidation tests condition validation
func TestConditionValidation(t *testing.T) {
	t.Run("should accept valid CEL expressions", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		validExpressions := []string{
			"true",
			"false",
			"P.id == R.attr.ownerId",
			"P.attr.age > 18",
			"R.kind == 'document'",
			"P.attr.department == R.attr.department && A.isWeekday",
		}

		for _, expr := range validExpressions {
			policy := &types.DerivedRolesPolicy{
				Name: "condition-test",
				Definitions: []types.DerivedRoleDefinition{
					{Name: "role1", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: expr}},
				},
			}

			err := validator.Validate([]*types.DerivedRolesPolicy{policy})
			require.NoError(t, err, "Should accept expression: %s", expr)
		}
	})

	t.Run("should reject empty condition expressions", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		policy := &types.DerivedRolesPolicy{
			Name: "empty-condition",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "role1", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: ""}},
			},
		}

		err := validator.Validate([]*types.DerivedRolesPolicy{policy})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "empty", "Should mention empty condition")
	})
}

// TestMultiplePoliciesValidation tests validation across multiple policies
func TestMultiplePoliciesValidation(t *testing.T) {
	t.Run("should handle empty policies array", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		err := validator.Validate([]*types.DerivedRolesPolicy{})
		require.NoError(t, err)
	})

	t.Run("should handle policy with empty definitions", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		policy := &types.DerivedRolesPolicy{
			Name:        "empty",
			Definitions: []types.DerivedRoleDefinition{},
		}

		err := validator.Validate([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)
	})

	t.Run("should handle multiple policies with no conflicts", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		policy1 := &types.DerivedRolesPolicy{
			Name: "policy1",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "role1", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		policy2 := &types.DerivedRolesPolicy{
			Name: "policy2",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "role2", ParentRoles: []string{"admin"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := validator.Validate([]*types.DerivedRolesPolicy{policy1, policy2})
		require.NoError(t, err)
	})

	t.Run("should detect duplicate role names across policies", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		policy1 := &types.DerivedRolesPolicy{
			Name: "policy1",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "owner", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		policy2 := &types.DerivedRolesPolicy{
			Name: "policy2",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "owner", ParentRoles: []string{"admin"}, Condition: types.Condition{Expression: "true"}}, // Duplicate
			},
		}

		err := validator.Validate([]*types.DerivedRolesPolicy{policy1, policy2})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "duplicate")
	})

	t.Run("should detect circular dependencies across policies", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		policy1 := &types.DerivedRolesPolicy{
			Name: "policy1",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "roleA", ParentRoles: []string{"roleB"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		policy2 := &types.DerivedRolesPolicy{
			Name: "policy2",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "roleB", ParentRoles: []string{"roleA"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := validator.Validate([]*types.DerivedRolesPolicy{policy1, policy2})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "circular")
	})
}

// TestEdgeCasesValidator tests validator edge cases
func TestEdgeCasesValidator(t *testing.T) {
	t.Run("should handle nil policy gracefully", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		err := validator.Validate([]*types.DerivedRolesPolicy{nil})
		// Should either error or skip nil policies gracefully
		_ = err
	})

	t.Run("should handle very long role names", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		longName := ""
		for i := 0; i < 1000; i++ {
			longName += "a"
		}

		policy := &types.DerivedRolesPolicy{
			Name: "long-name-test",
			Definitions: []types.DerivedRoleDefinition{
				{Name: longName, ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		// Should either accept or reject with clear error
		err := validator.Validate([]*types.DerivedRolesPolicy{policy})
		_ = err
	})

	t.Run("should handle many parent roles", func(t *testing.T) {
		validator := derived_roles.NewValidator()

		parentRoles := make([]string, 100)
		for i := 0; i < 100; i++ {
			parentRoles[i] = fmt.Sprintf("role%d", i)
		}

		policy := &types.DerivedRolesPolicy{
			Name: "many-parents",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "composite", ParentRoles: parentRoles, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := validator.Validate([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)
	})
}
