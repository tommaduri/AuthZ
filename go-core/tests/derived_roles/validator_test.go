package derived_roles_test

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/authz-engine/go-core/internal/derived_roles"
	"github.com/authz-engine/go-core/pkg/types"
)

// TestSchemaValidation tests derived roles schema validation
func TestSchemaValidation(t *testing.T) {
	t.Run("should accept valid derived role", func(t *testing.T) {
		validator, err := derived_roles.NewDerivedRolesValidator()
		require.NoError(t, err)

		derivedRole := &types.DerivedRole{
			Name:        "owner",
			ParentRoles: []string{"user"},
			Condition:   "resource.attr.ownerId == principal.id",
		}

		err = validator.Validate(derivedRole)
		require.NoError(t, err)
	})

	t.Run("should reject nil derived role", func(t *testing.T) {
		validator, err := derived_roles.NewDerivedRolesValidator()
		require.NoError(t, err)

		err = validator.Validate(nil)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "nil", "Should mention nil")
	})

	t.Run("should reject duplicate role names in collection", func(t *testing.T) {
		validator, err := derived_roles.NewDerivedRolesValidator()
		require.NoError(t, err)

		derivedRoles := []*types.DerivedRole{
			{Name: "owner", ParentRoles: []string{"user"}, Condition: "true"},
			{Name: "owner", ParentRoles: []string{"admin"}, Condition: "true"}, // Duplicate
		}

		err = validator.ValidateAll(derivedRoles)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "duplicate", "Should mention duplicate")
		assert.Contains(t, err.Error(), "owner", "Should mention the duplicate role name")
	})

	t.Run("should accept role names with hyphens and underscores", func(t *testing.T) {
		validator, err := derived_roles.NewDerivedRolesValidator()
		require.NoError(t, err)

		validNames := []string{"owner-role", "admin_role", "super-admin_v2"}
		for _, name := range validNames {
			derivedRole := &types.DerivedRole{
				Name:        name,
				ParentRoles: []string{"user"},
				Condition:   "true",
			}

			err = validator.Validate(derivedRole)
			require.NoError(t, err, "Should accept role name: %s", name)
		}
	})

	t.Run("should reject empty role names", func(t *testing.T) {
		validator, err := derived_roles.NewDerivedRolesValidator()
		require.NoError(t, err)

		derivedRole := &types.DerivedRole{
			Name:        "",
			ParentRoles: []string{"user"},
			Condition:   "true",
		}

		err = validator.Validate(derivedRole)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "name", "Should mention name")
	})
}

// TestParentRoleValidation tests parent role validation
func TestParentRoleValidation(t *testing.T) {
	t.Run("should accept valid parent roles", func(t *testing.T) {
		validator, err := derived_roles.NewDerivedRolesValidator()
		require.NoError(t, err)

		derivedRole := &types.DerivedRole{
			Name:        "owner",
			ParentRoles: []string{"user", "admin"},
			Condition:   "true",
		}

		err = validator.Validate(derivedRole)
		require.NoError(t, err)
	})

	t.Run("should reject empty parent roles list", func(t *testing.T) {
		validator, err := derived_roles.NewDerivedRolesValidator()
		require.NoError(t, err)

		derivedRole := &types.DerivedRole{
			Name:        "owner",
			ParentRoles: []string{},
			Condition:   "true",
		}

		err = validator.Validate(derivedRole)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "parent", "Should mention parent roles")
	})

	t.Run("should reject self-reference in parent roles", func(t *testing.T) {
		validator, err := derived_roles.NewDerivedRolesValidator()
		require.NoError(t, err)

		derivedRole := &types.DerivedRole{
			Name:        "owner",
			ParentRoles: []string{"owner"}, // Self-reference
			Condition:   "true",
		}

		err = validator.Validate(derivedRole)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "itself", "Should mention self-reference")
	})

	t.Run("should accept wildcard parent roles", func(t *testing.T) {
		validator, err := derived_roles.NewDerivedRolesValidator()
		require.NoError(t, err)

		wildcards := [][]string{
			{"*"},
			{"admin:*"},
			{"*:manager"},
		}

		for _, parentRoles := range wildcards {
			derivedRole := &types.DerivedRole{
				Name:        "test-role",
				ParentRoles: parentRoles,
				Condition:   "true",
			}

			err = validator.Validate(derivedRole)
			require.NoError(t, err, "Should accept wildcard: %v", parentRoles)
		}
	})
}

// TestConditionValidation tests CEL condition validation
func TestConditionValidation(t *testing.T) {
	t.Run("should accept valid CEL expression", func(t *testing.T) {
		validator, err := derived_roles.NewDerivedRolesValidator()
		require.NoError(t, err)

		derivedRole := &types.DerivedRole{
			Name:        "owner",
			ParentRoles: []string{"user"},
			Condition:   "resource.attr.ownerId == principal.id",
		}

		err = validator.Validate(derivedRole)
		require.NoError(t, err)
	})

	t.Run("should accept empty condition (always true)", func(t *testing.T) {
		validator, err := derived_roles.NewDerivedRolesValidator()
		require.NoError(t, err)

		derivedRole := &types.DerivedRole{
			Name:        "owner",
			ParentRoles: []string{"user"},
			Condition:   "",
		}

		err = validator.Validate(derivedRole)
		require.NoError(t, err)
	})

	t.Run("should reject invalid CEL syntax", func(t *testing.T) {
		validator, err := derived_roles.NewDerivedRolesValidator()
		require.NoError(t, err)

		derivedRole := &types.DerivedRole{
			Name:        "owner",
			ParentRoles: []string{"user"},
			Condition:   "invalid syntax ::::",
		}

		err = validator.Validate(derivedRole)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "condition", "Should mention condition")
	})

	t.Run("should accept complex boolean expressions", func(t *testing.T) {
		validator, err := derived_roles.NewDerivedRolesValidator()
		require.NoError(t, err)

		complexConditions := []string{
			"principal.attr.age > 18 && principal.attr.verified == true",
			"resource.kind == 'document' || resource.kind == 'file'",
			"principal.id in resource.attr.owners",
			"resource.attr.tags.exists(t, t == 'public')",
		}

		for _, condition := range complexConditions {
			derivedRole := &types.DerivedRole{
				Name:        "test-role",
				ParentRoles: []string{"user"},
				Condition:   condition,
			}

			err = validator.Validate(derivedRole)
			require.NoError(t, err, "Should accept condition: %s", condition)
		}
	})
}

// TestCircularDependencyDetection tests circular dependency detection
func TestCircularDependencyDetection(t *testing.T) {
	t.Run("should detect simple circular dependency", func(t *testing.T) {
		validator, err := derived_roles.NewDerivedRolesValidator()
		require.NoError(t, err)

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

		err = validator.ValidateAll(derivedRoles)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "circular", "Should mention circular dependency")
	})

	t.Run("should detect transitive circular dependency", func(t *testing.T) {
		validator, err := derived_roles.NewDerivedRolesValidator()
		require.NoError(t, err)

		derivedRoles := []*types.DerivedRole{
			{
				Name:        "role1",
				ParentRoles: []string{"role2"},
				Condition:   "true",
			},
			{
				Name:        "role2",
				ParentRoles: []string{"role3"},
				Condition:   "true",
			},
			{
				Name:        "role3",
				ParentRoles: []string{"role1"}, // Circular: role1 -> role2 -> role3 -> role1
				Condition:   "true",
			},
		}

		err = validator.ValidateAll(derivedRoles)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "circular", "Should detect transitive circular dependency")
	})

	t.Run("should accept acyclic dependency graph", func(t *testing.T) {
		validator, err := derived_roles.NewDerivedRolesValidator()
		require.NoError(t, err)

		derivedRoles := []*types.DerivedRole{
			{
				Name:        "level1",
				ParentRoles: []string{"user"},
				Condition:   "true",
			},
			{
				Name:        "level2",
				ParentRoles: []string{"level1"},
				Condition:   "true",
			},
			{
				Name:        "level3",
				ParentRoles: []string{"level2"},
				Condition:   "true",
			},
		}

		err = validator.ValidateAll(derivedRoles)
		require.NoError(t, err, "Should accept acyclic graph")
	})
}

// TestComplexValidationScenarios tests complex multi-aspect validation
func TestComplexValidationScenarios(t *testing.T) {
	t.Run("should validate large collection of derived roles", func(t *testing.T) {
		validator, err := derived_roles.NewDerivedRolesValidator()
		require.NoError(t, err)

		// Create 50 derived roles with various dependencies
		derivedRoles := make([]*types.DerivedRole, 50)
		for i := 0; i < 50; i++ {
			parentRoles := []string{"user"}
			if i > 0 {
				// Add dependency on previous role
				parentRoles = append(parentRoles, fmt.Sprintf("role-%d", i-1))
			}

			derivedRoles[i] = &types.DerivedRole{
				Name:        fmt.Sprintf("role-%d", i),
				ParentRoles: parentRoles,
				Condition:   "true",
			}
		}

		err = validator.ValidateAll(derivedRoles)
		require.NoError(t, err, "Should validate large collection efficiently")
	})

	t.Run("should validate complex dependency graph", func(t *testing.T) {
		validator, err := derived_roles.NewDerivedRolesValidator()
		require.NoError(t, err)

		derivedRoles := []*types.DerivedRole{
			{Name: "editor", ParentRoles: []string{"user"}, Condition: "true"},
			{Name: "owner", ParentRoles: []string{"editor"}, Condition: "true"},
			{Name: "admin", ParentRoles: []string{"owner"}, Condition: "true"},
			{Name: "moderator", ParentRoles: []string{"editor"}, Condition: "true"},
			{Name: "superadmin", ParentRoles: []string{"admin", "moderator"}, Condition: "true"},
		}

		err = validator.ValidateAll(derivedRoles)
		require.NoError(t, err, "Should validate complex dependency graph")
	})
}

// TestEdgeCases tests validation edge cases
func TestValidatorEdgeCases(t *testing.T) {
	t.Run("should handle empty derived roles list", func(t *testing.T) {
		validator, err := derived_roles.NewDerivedRolesValidator()
		require.NoError(t, err)

		err = validator.ValidateAll([]*types.DerivedRole{})
		require.NoError(t, err, "Empty list should be valid")
	})

	t.Run("should handle single derived role", func(t *testing.T) {
		validator, err := derived_roles.NewDerivedRolesValidator()
		require.NoError(t, err)

		derivedRoles := []*types.DerivedRole{
			{Name: "owner", ParentRoles: []string{"user"}, Condition: "true"},
		}

		err = validator.ValidateAll(derivedRoles)
		require.NoError(t, err)
	})

	t.Run("should validate role with multiple parent roles", func(t *testing.T) {
		validator, err := derived_roles.NewDerivedRolesValidator()
		require.NoError(t, err)

		derivedRole := &types.DerivedRole{
			Name:        "superuser",
			ParentRoles: []string{"admin", "editor", "moderator"},
			Condition:   "true",
		}

		err = validator.Validate(derivedRole)
		require.NoError(t, err)
	})
}
