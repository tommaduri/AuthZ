package derived_roles_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/authz-engine/go-core/internal/derived_roles"
	"github.com/authz-engine/go-core/pkg/types"
)

// mockCELEvaluator is a test double for CEL expression evaluation
type mockCELEvaluator struct {
	returnValue bool
	returnError error
	callCount   int
	lastExpr    string
	lastContext interface{}
}

func (m *mockCELEvaluator) EvaluateBoolean(expr string, context interface{}) (bool, error) {
	m.callCount++
	m.lastExpr = expr
	m.lastContext = context
	if m.returnError != nil {
		return false, m.returnError
	}
	return m.returnValue, nil
}

func (m *mockCELEvaluator) Reset() {
	m.callCount = 0
	m.lastExpr = ""
	m.lastContext = nil
}

// Test Helpers
func createPrincipal(id string, roles []string) types.Principal {
	return types.Principal{
		ID:         id,
		Roles:      roles,
		Attributes: make(map[string]interface{}),
	}
}

func createResource(kind, id string) types.Resource {
	return types.Resource{
		Kind:       kind,
		ID:         id,
		Attributes: make(map[string]interface{}),
	}
}

// TestBasicRoleDerivation tests basic derived role resolution
func TestBasicRoleDerivation(t *testing.T) {
	t.Run("should derive role when parent role matches and condition is true", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "test-derived",
			Definitions: []types.DerivedRoleDefinition{
				{
					Name:        "owner",
					ParentRoles: []string{"user"},
					Condition: types.Condition{
						Expression: "R.attr.ownerId == P.id",
					},
				},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)

		principal := createPrincipal("user123", []string{"user"})
		resource := createResource("document", "doc1")

		roles, err := resolver.Resolve(principal, resource, nil, nil)
		require.NoError(t, err)
		assert.Equal(t, []string{"owner"}, roles)
		assert.Equal(t, 1, mockEval.callCount)
	})

	t.Run("should not derive role when parent role does not match", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "test-derived",
			Definitions: []types.DerivedRoleDefinition{
				{
					Name:        "owner",
					ParentRoles: []string{"user"},
					Condition:   types.Condition{Expression: "true"},
				},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)

		principal := createPrincipal("user123", []string{"guest"})
		resource := createResource("document", "doc1")

		roles, err := resolver.Resolve(principal, resource, nil, nil)
		require.NoError(t, err)
		assert.Empty(t, roles)
		assert.Equal(t, 0, mockEval.callCount, "CEL should not be evaluated when parent role doesn't match")
	})

	t.Run("should not derive role when condition is false", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: false}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "test-derived",
			Definitions: []types.DerivedRoleDefinition{
				{
					Name:        "owner",
					ParentRoles: []string{"user"},
					Condition:   types.Condition{Expression: "R.attr.ownerId == P.id"},
				},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)

		principal := createPrincipal("user123", []string{"user"})
		resource := createResource("document", "doc1")

		roles, err := resolver.Resolve(principal, resource, nil, nil)
		require.NoError(t, err)
		assert.Empty(t, roles)
	})

	t.Run("should derive multiple roles when conditions match", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "test-derived",
			Definitions: []types.DerivedRoleDefinition{
				{
					Name:        "owner",
					ParentRoles: []string{"user"},
					Condition:   types.Condition{Expression: "true"},
				},
				{
					Name:        "editor",
					ParentRoles: []string{"user"},
					Condition:   types.Condition{Expression: "true"},
				},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)

		principal := createPrincipal("user123", []string{"user"})
		resource := createResource("document", "doc1")

		roles, err := resolver.Resolve(principal, resource, nil, nil)
		require.NoError(t, err)
		assert.Equal(t, []string{"owner", "editor"}, roles)
	})

	t.Run("should handle empty parent roles (match any principal)", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "test-derived",
			Definitions: []types.DerivedRoleDefinition{
				{
					Name:        "public",
					ParentRoles: []string{},
					Condition:   types.Condition{Expression: "true"},
				},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)

		principal := createPrincipal("user123", []string{"guest"})
		resource := createResource("document", "doc1")

		roles, err := resolver.Resolve(principal, resource, nil, nil)
		require.NoError(t, err)
		assert.Equal(t, []string{"public"}, roles)
	})
}

// TestWildcardParentRoles tests wildcard matching in parent roles
func TestWildcardParentRoles(t *testing.T) {
	t.Run("should match wildcard '*' when principal has any role", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "test-derived",
			Definitions: []types.DerivedRoleDefinition{
				{
					Name:        "authenticated",
					ParentRoles: []string{"*"},
					Condition:   types.Condition{Expression: "true"},
				},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)

		principal := createPrincipal("user123", []string{"anything"})
		resource := createResource("document", "doc1")

		roles, err := resolver.Resolve(principal, resource, nil, nil)
		require.NoError(t, err)
		assert.Equal(t, []string{"authenticated"}, roles)
	})

	t.Run("should not match wildcard '*' when principal has no roles", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "test-derived",
			Definitions: []types.DerivedRoleDefinition{
				{
					Name:        "authenticated",
					ParentRoles: []string{"*"},
					Condition:   types.Condition{Expression: "true"},
				},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)

		principal := createPrincipal("user123", []string{})
		resource := createResource("document", "doc1")

		roles, err := resolver.Resolve(principal, resource, nil, nil)
		require.NoError(t, err)
		assert.Empty(t, roles)
	})

	t.Run("should match prefix wildcard 'admin:*' for any admin role", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "test-derived",
			Definitions: []types.DerivedRoleDefinition{
				{
					Name:        "super_admin",
					ParentRoles: []string{"admin:*"},
					Condition:   types.Condition{Expression: "true"},
				},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)

		principal := createPrincipal("user123", []string{"admin:read", "user"})
		resource := createResource("document", "doc1")

		roles, err := resolver.Resolve(principal, resource, nil, nil)
		require.NoError(t, err)
		assert.Equal(t, []string{"super_admin"}, roles)
	})

	t.Run("should not match prefix wildcard when principal has no matching prefix", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "test-derived",
			Definitions: []types.DerivedRoleDefinition{
				{
					Name:        "super_admin",
					ParentRoles: []string{"admin:*"},
					Condition:   types.Condition{Expression: "true"},
				},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)

		principal := createPrincipal("user123", []string{"user", "guest"})
		resource := createResource("document", "doc1")

		roles, err := resolver.Resolve(principal, resource, nil, nil)
		require.NoError(t, err)
		assert.Empty(t, roles)
	})

	t.Run("should match suffix wildcard '*:write' for any write role", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "test-derived",
			Definitions: []types.DerivedRoleDefinition{
				{
					Name:        "writer",
					ParentRoles: []string{"*:write"},
					Condition:   types.Condition{Expression: "true"},
				},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)

		principal := createPrincipal("user123", []string{"manager:write", "user"})
		resource := createResource("document", "doc1")

		roles, err := resolver.Resolve(principal, resource, nil, nil)
		require.NoError(t, err)
		assert.Equal(t, []string{"writer"}, roles)
	})

	t.Run("should match exact role before checking wildcards", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "test-derived",
			Definitions: []types.DerivedRoleDefinition{
				{
					Name:        "manager",
					ParentRoles: []string{"admin", "manager:*"},
					Condition:   types.Condition{Expression: "true"},
				},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)

		principal := createPrincipal("user123", []string{"admin"})
		resource := createResource("document", "doc1")

		roles, err := resolver.Resolve(principal, resource, nil, nil)
		require.NoError(t, err)
		assert.Equal(t, []string{"manager"}, roles)
	})

	t.Run("should handle multiple wildcards in parent roles", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "test-derived",
			Definitions: []types.DerivedRoleDefinition{
				{
					Name:        "privileged",
					ParentRoles: []string{"admin:*", "manager:*"},
					Condition:   types.Condition{Expression: "true"},
				},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)

		principal1 := createPrincipal("user1", []string{"admin:read"})
		principal2 := createPrincipal("user2", []string{"manager:write"})
		resource := createResource("document", "doc1")

		roles1, err := resolver.Resolve(principal1, resource, nil, nil)
		require.NoError(t, err)
		assert.Equal(t, []string{"privileged"}, roles1)

		mockEval.Reset()
		roles2, err := resolver.Resolve(principal2, resource, nil, nil)
		require.NoError(t, err)
		assert.Equal(t, []string{"privileged"}, roles2)
	})

	t.Run("should handle mix of exact and wildcard parent roles", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "test-derived",
			Definitions: []types.DerivedRoleDefinition{
				{
					Name:        "elevated",
					ParentRoles: []string{"superuser", "admin:*", "*:write"},
					Condition:   types.Condition{Expression: "true"},
				},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)

		testCases := []struct {
			name  string
			roles []string
		}{
			{"superuser", []string{"superuser"}},
			{"admin role", []string{"admin:read"}},
			{"write role", []string{"manager:write"}},
		}

		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				mockEval.Reset()
				principal := createPrincipal("user", tc.roles)
				resource := createResource("document", "doc1")

				roles, err := resolver.Resolve(principal, resource, nil, nil)
				require.NoError(t, err)
				assert.Equal(t, []string{"elevated"}, roles)
			})
		}
	})

	t.Run("should not match partial prefix without colon", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "test-derived",
			Definitions: []types.DerivedRoleDefinition{
				{
					Name:        "admin_role",
					ParentRoles: []string{"admin:*"},
					Condition:   types.Condition{Expression: "true"},
				},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)

		principal := createPrincipal("user123", []string{"administrator", "adminuser"})
		resource := createResource("document", "doc1")

		roles, err := resolver.Resolve(principal, resource, nil, nil)
		require.NoError(t, err)
		assert.Empty(t, roles, "Should not match 'administrator' or 'adminuser' with 'admin:*'")
	})
}

// TestCELConditionEvaluation tests CEL expression evaluation
func TestCELConditionEvaluation(t *testing.T) {
	t.Run("should pass principal, resource, and auxData to CEL evaluator", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "test-derived",
			Definitions: []types.DerivedRoleDefinition{
				{
					Name:        "owner",
					ParentRoles: []string{"user"},
					Condition: types.Condition{
						Expression: "R.attr.ownerId == P.id && A.isWeekday",
					},
				},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)

		principal := createPrincipal("user123", []string{"user"})
		resource := createResource("document", "doc1")
		auxData := map[string]interface{}{"isWeekday": true}

		roles, err := resolver.Resolve(principal, resource, auxData, nil)
		require.NoError(t, err)
		assert.Equal(t, []string{"owner"}, roles)
		assert.Contains(t, mockEval.lastExpr, "R.attr.ownerId == P.id && A.isWeekday")
	})

	t.Run("should handle CEL evaluation errors gracefully", func(t *testing.T) {
		mockEval := &mockCELEvaluator{
			returnError: assert.AnError,
		}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "test-derived",
			Definitions: []types.DerivedRoleDefinition{
				{
					Name:        "owner",
					ParentRoles: []string{"user"},
					Condition:   types.Condition{Expression: "invalid"},
				},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)

		principal := createPrincipal("user123", []string{"user"})
		resource := createResource("document", "doc1")

		roles, err := resolver.Resolve(principal, resource, nil, nil)
		require.NoError(t, err, "Should not propagate CEL errors")
		assert.Empty(t, roles, "Should return empty roles on CEL error")
	})

	t.Run("should evaluate multiple conditions independently", func(t *testing.T) {
		callCount := 0
		mockEval := &mockCELEvaluator{}
		mockEval.returnValue = true

		// Mock sequential returns: true, false, true
		originalEval := mockEval.EvaluateBoolean
		mockEval.EvaluateBoolean = func(expr string, context interface{}) (bool, error) {
			defer func() { callCount++ }()
			results := []bool{true, false, true}
			return results[callCount], nil
		}
		defer func() { mockEval.EvaluateBoolean = originalEval }()

		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "test-derived",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "role1", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "condition1"}},
				{Name: "role2", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "condition2"}},
				{Name: "role3", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "condition3"}},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)

		principal := createPrincipal("user123", []string{"user"})
		resource := createResource("document", "doc1")

		roles, err := resolver.Resolve(principal, resource, nil, nil)
		require.NoError(t, err)
		assert.Equal(t, []string{"role1", "role3"}, roles)
		assert.Equal(t, 3, callCount)
	})

	t.Run("should not evaluate condition if parent role does not match", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "test-derived",
			Definitions: []types.DerivedRoleDefinition{
				{
					Name:        "owner",
					ParentRoles: []string{"admin"},
					Condition:   types.Condition{Expression: "complex_expression"},
				},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)

		principal := createPrincipal("user123", []string{"user"})
		resource := createResource("document", "doc1")

		roles, err := resolver.Resolve(principal, resource, nil, nil)
		require.NoError(t, err)
		assert.Empty(t, roles)
		assert.Equal(t, 0, mockEval.callCount, "CEL should not be evaluated")
	})
}

// TestCircularDependencyDetection tests circular dependency validation
func TestCircularDependencyDetection(t *testing.T) {
	t.Run("should throw error on simple circular dependency (A -> B -> A)", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "circular-test",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "roleA", ParentRoles: []string{"roleB"}, Condition: types.Condition{Expression: "true"}},
				{Name: "roleB", ParentRoles: []string{"roleA"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "circular")
	})

	t.Run("should throw error on complex circular dependency (A -> B -> C -> A)", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "circular-test",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "roleA", ParentRoles: []string{"roleB"}, Condition: types.Condition{Expression: "true"}},
				{Name: "roleB", ParentRoles: []string{"roleC"}, Condition: types.Condition{Expression: "true"}},
				{Name: "roleC", ParentRoles: []string{"roleA"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "circular")
	})

	t.Run("should detect self-referencing role", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "self-ref-test",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "recursive", ParentRoles: []string{"recursive"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "circular")
	})

	t.Run("should allow roles depending on base roles (not circular)", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "valid-test",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "owner", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)
	})

	t.Run("should allow chain of derived roles without cycles", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "chain-test",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "base_role", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "true"}},
				{Name: "intermediate_role", ParentRoles: []string{"base_role"}, Condition: types.Condition{Expression: "true"}},
				{Name: "advanced_role", ParentRoles: []string{"intermediate_role"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)
	})
}

// TestMultipleDefinitions tests loading multiple policies
func TestMultipleDefinitions(t *testing.T) {
	t.Run("should load definitions from multiple policies", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy1 := &types.DerivedRolesPolicy{
			Name: "policy1",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "role1", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		policy2 := &types.DerivedRolesPolicy{
			Name: "policy2",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "role2", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy1, policy2})
		require.NoError(t, err)
		assert.Equal(t, 2, resolver.GetDefinitionsCount())

		principal := createPrincipal("user123", []string{"user"})
		resource := createResource("document", "doc1")

		roles, err := resolver.Resolve(principal, resource, nil, nil)
		require.NoError(t, err)
		assert.ElementsMatch(t, []string{"role1", "role2"}, roles)
	})

	t.Run("should handle large number of definitions", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		definitions := make([]types.DerivedRoleDefinition, 100)
		for i := 0; i < 100; i++ {
			definitions[i] = types.DerivedRoleDefinition{
				Name:        fmt.Sprintf("role%d", i),
				ParentRoles: []string{"user"},
				Condition:   types.Condition{Expression: "true"},
			}
		}

		policy := &types.DerivedRolesPolicy{
			Name:        "large-policy",
			Definitions: definitions,
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)
		assert.Equal(t, 100, resolver.GetDefinitionsCount())
	})

	t.Run("should clear previously loaded policies", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "policy1",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "role1", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)
		assert.Equal(t, 1, resolver.GetDefinitionsCount())

		resolver.Clear()
		assert.Equal(t, 0, resolver.GetDefinitionsCount())
	})
}

// TestEvaluationTrace tests trace functionality
func TestEvaluationTrace(t *testing.T) {
	t.Run("should provide evaluation trace with timing", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "test-derived",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "owner", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)

		principal := createPrincipal("user123", []string{"user"})
		resource := createResource("document", "doc1")

		result, err := resolver.ResolveWithTrace(principal, resource, nil)
		require.NoError(t, err)
		assert.Equal(t, []string{"owner"}, result.Roles)
		require.Len(t, result.Traces, 1)

		trace := result.Traces[0]
		assert.Equal(t, "owner", trace.RoleName)
		assert.True(t, trace.ParentRoleMatched)
		assert.True(t, trace.ConditionEvaluated)
		assert.True(t, trace.ConditionResult)
		assert.Greater(t, trace.DurationMs, float64(0))
	})

	t.Run("should trace parent role mismatch", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "test-derived",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "owner", ParentRoles: []string{"admin"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)

		principal := createPrincipal("user123", []string{"user"})
		resource := createResource("document", "doc1")

		result, err := resolver.ResolveWithTrace(principal, resource, nil)
		require.NoError(t, err)
		assert.Empty(t, result.Roles)

		trace := result.Traces[0]
		assert.False(t, trace.ParentRoleMatched)
		assert.False(t, trace.ConditionEvaluated)
	})

	t.Run("should trace evaluation errors", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnError: errors.New("Evaluation failed")}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "test-derived",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "owner", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "invalid"}},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)

		principal := createPrincipal("user123", []string{"user"})
		resource := createResource("document", "doc1")

		result, err := resolver.ResolveWithTrace(principal, resource, nil)
		require.NoError(t, err)
		assert.Empty(t, result.Roles)

		trace := result.Traces[0]
		assert.NotEmpty(t, trace.Error)
		assert.Contains(t, trace.Error, "Evaluation failed")
	})
}

// TestEdgeCases tests edge cases
func TestEdgeCases(t *testing.T) {
	t.Run("should handle nil principal", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		policy := &types.DerivedRolesPolicy{
			Name: "test",
			Definitions: []types.DerivedRoleDefinition{
				{Name: "role1", ParentRoles: []string{"user"}, Condition: types.Condition{Expression: "true"}},
			},
		}

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{policy})
		require.NoError(t, err)

		resource := createResource("document", "doc1")

		// This should not panic
		roles, err := resolver.Resolve(types.Principal{}, resource, nil, nil)
		require.NoError(t, err)
		assert.Empty(t, roles)
	})

	t.Run("should handle empty policy list", func(t *testing.T) {
		mockEval := &mockCELEvaluator{returnValue: true}
		resolver := derived_roles.NewResolver(derived_roles.ResolverConfig{
			CELEvaluator: mockEval,
		})

		err := resolver.LoadPolicies([]*types.DerivedRolesPolicy{})
		require.NoError(t, err)
		assert.Equal(t, 0, resolver.GetDefinitionsCount())
	})
}
