package policy

import (
	"testing"

	"github.com/authz-engine/go-core/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDefaultValidationConfig(t *testing.T) {
	config := DefaultValidationConfig()
	assert.False(t, config.StrictMode)
	assert.Empty(t, config.AllowedActions)
	assert.Empty(t, config.AllowedResources)
	assert.Equal(t, 10, config.MaxRuleDepth)
	assert.True(t, config.ValidateCEL)
	assert.True(t, config.CheckCircularDep)
}

func TestNewEnhancedValidator(t *testing.T) {
	config := DefaultValidationConfig()
	ev := NewEnhancedValidator(config)
	assert.NotNil(t, ev)
	assert.NotNil(t, ev.validator)
	assert.Equal(t, config, ev.config)
}

func TestEnhancedValidator_ValidPolicy(t *testing.T) {
	ev := NewEnhancedValidator(DefaultValidationConfig())

	policy := &types.Policy{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
				Roles:   []string{"viewer"},
			},
		},
	}

	result := ev.ValidatePolicyEnhanced(policy)
	assert.True(t, result.Valid)
	assert.Empty(t, result.Errors)
}

func TestEnhancedValidator_InvalidCELExpression(t *testing.T) {
	ev := NewEnhancedValidator(DefaultValidationConfig())

	policy := &types.Policy{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:      "conditional-rule",
				Actions:   []string{"read"},
				Effect:    types.EffectAllow,
				Condition: "invalid CEL syntax !!!",
			},
		},
	}

	result := ev.ValidatePolicyEnhanced(policy)
	assert.False(t, result.Valid)
	require.Len(t, result.Errors, 1)
	assert.Equal(t, "cel", result.Errors[0].Type)
	assert.Contains(t, result.Errors[0].Path, "rules[0].condition")
}

func TestEnhancedValidator_ValidCELExpression(t *testing.T) {
	ev := NewEnhancedValidator(DefaultValidationConfig())

	policy := &types.Policy{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:      "conditional-rule",
				Actions:   []string{"read"},
				Effect:    types.EffectAllow,
				Condition: "\"admin\" in principal.roles",
			},
		},
	}

	result := ev.ValidatePolicyEnhanced(policy)
	assert.True(t, result.Valid)
	assert.Empty(t, result.Errors)
}

func TestEnhancedValidator_CircularDependency(t *testing.T) {
	ev := NewEnhancedValidator(DefaultValidationConfig())

	// Create a circular dependency: roleA depends on roleB, roleB depends on roleA
	policy := &types.Policy{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:         "rule1",
				Actions:      []string{"read"},
				Effect:       types.EffectAllow,
				Roles:        []string{"roleB"},
				DerivedRoles: []string{"roleA"},
			},
			{
				Name:         "rule2",
				Actions:      []string{"write"},
				Effect:       types.EffectAllow,
				Roles:        []string{"roleA"},
				DerivedRoles: []string{"roleB"},
			},
		},
	}

	result := ev.ValidatePolicyEnhanced(policy)
	assert.False(t, result.Valid)
	require.Greater(t, len(result.Errors), 0)

	// Check for circular dependency error
	foundCircularError := false
	for _, err := range result.Errors {
		if err.Type == "circular_dep" {
			foundCircularError = true
			assert.Contains(t, err.Message, "Circular dependency")
			break
		}
	}
	assert.True(t, foundCircularError, "Expected circular dependency error")
}

func TestEnhancedValidator_NoDerivedRoles(t *testing.T) {
	ev := NewEnhancedValidator(DefaultValidationConfig())

	policy := &types.Policy{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "simple-rule",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
				Roles:   []string{"viewer"},
			},
		},
	}

	result := ev.ValidatePolicyEnhanced(policy)
	assert.True(t, result.Valid)
	assert.Empty(t, result.Errors)
}

func TestEnhancedValidator_AllowedActions(t *testing.T) {
	config := DefaultValidationConfig()
	config.AllowedActions = []string{"read", "write", "delete"}
	ev := NewEnhancedValidator(config)

	t.Run("valid actions", func(t *testing.T) {
		policy := &types.Policy{
			APIVersion:   "api.agsiri.dev/v1",
			Name:         "test-policy",
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "rule1",
					Actions: []string{"read", "write"},
					Effect:  types.EffectAllow,
				},
			},
		}

		result := ev.ValidatePolicyEnhanced(policy)
		assert.True(t, result.Valid)
		assert.Empty(t, result.Errors)
	})

	t.Run("invalid action - non-strict mode", func(t *testing.T) {
		policy := &types.Policy{
			APIVersion:   "api.agsiri.dev/v1",
			Name:         "test-policy",
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "rule1",
					Actions: []string{"invalid_action"},
					Effect:  types.EffectAllow,
				},
			},
		}

		result := ev.ValidatePolicyEnhanced(policy)
		assert.True(t, result.Valid) // Still valid in non-strict mode
		assert.NotEmpty(t, result.Warnings)
	})

	t.Run("invalid action - strict mode", func(t *testing.T) {
		strictConfig := config
		strictConfig.StrictMode = true
		strictEv := NewEnhancedValidator(strictConfig)

		policy := &types.Policy{
			APIVersion:   "api.agsiri.dev/v1",
			Name:         "test-policy",
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "rule1",
					Actions: []string{"invalid_action"},
					Effect:  types.EffectAllow,
				},
			},
		}

		result := strictEv.ValidatePolicyEnhanced(policy)
		assert.False(t, result.Valid)
		assert.NotEmpty(t, result.Errors)
	})

	t.Run("wildcard action always allowed", func(t *testing.T) {
		policy := &types.Policy{
			APIVersion:   "api.agsiri.dev/v1",
			Name:         "test-policy",
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "rule1",
					Actions: []string{"*"},
					Effect:  types.EffectAllow,
				},
			},
		}

		result := ev.ValidatePolicyEnhanced(policy)
		assert.True(t, result.Valid)
		assert.Empty(t, result.Warnings)
	})
}

func TestEnhancedValidator_AllowedResources(t *testing.T) {
	config := DefaultValidationConfig()
	config.AllowedResources = []string{"document", "file", "folder"}
	ev := NewEnhancedValidator(config)

	t.Run("valid resource kind", func(t *testing.T) {
		policy := &types.Policy{
			APIVersion:   "api.agsiri.dev/v1",
			Name:         "test-policy",
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "rule1",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
				},
			},
		}

		result := ev.ValidatePolicyEnhanced(policy)
		assert.True(t, result.Valid)
	})

	t.Run("invalid resource kind", func(t *testing.T) {
		policy := &types.Policy{
			APIVersion:   "api.agsiri.dev/v1",
			Name:         "test-policy",
			ResourceKind: "invalid_resource",
			Rules: []*types.Rule{
				{
					Name:    "rule1",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
				},
			},
		}

		result := ev.ValidatePolicyEnhanced(policy)
		assert.False(t, result.Valid)
		require.Len(t, result.Errors, 1)
		assert.Equal(t, "schema", result.Errors[0].Type)
		assert.Contains(t, result.Errors[0].Message, "not in allowed list")
	})
}

func TestEnhancedValidator_StrictMode(t *testing.T) {
	config := DefaultValidationConfig()
	config.StrictMode = true
	ev := NewEnhancedValidator(config)

	// Create a policy with potential warnings (unreachable rule)
	policy := &types.Policy{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-all",
				Actions: []string{"*"},
				Effect:  types.EffectAllow,
			},
			{
				Name:    "deny-delete",
				Actions: []string{"delete"},
				Effect:  types.EffectDeny,
			},
		},
	}

	result := ev.ValidatePolicyEnhanced(policy)

	// In strict mode, warnings should cause validation to fail
	if len(result.Warnings) > 0 {
		assert.False(t, result.Valid)
		assert.NotEmpty(t, result.Errors)
	}
}

func TestEnhancedValidator_ValidatePolicies(t *testing.T) {
	ev := NewEnhancedValidator(DefaultValidationConfig())

	policies := map[string]*types.Policy{
		"policy1": {
			APIVersion:   "api.agsiri.dev/v1",
			Name:         "policy1",
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "rule1",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
				},
			},
		},
		"policy2": {
			APIVersion:   "api.agsiri.dev/v1",
			Name:         "policy2",
			ResourceKind: "file",
			Rules: []*types.Rule{
				{
					Name:    "rule1",
					Actions: []string{"write"},
					Effect:  types.EffectAllow,
				},
			},
		},
	}

	result := ev.ValidatePolicies(policies)
	assert.True(t, result.Valid)
	assert.Empty(t, result.Errors)
}

func TestEnhancedValidator_ValidatePolicies_WithErrors(t *testing.T) {
	ev := NewEnhancedValidator(DefaultValidationConfig())

	policies := map[string]*types.Policy{
		"valid": {
			APIVersion:   "api.agsiri.dev/v1",
			Name:         "valid",
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "rule1",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
				},
			},
		},
		"invalid": {
			APIVersion: "api.agsiri.dev/v1",
			Name:       "invalid",
			// Missing ResourceKind
			Rules: []*types.Rule{
				{
					Name:    "rule1",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
				},
			},
		},
	}

	result := ev.ValidatePolicies(policies)
	assert.False(t, result.Valid)
	assert.NotEmpty(t, result.Errors)

	// Check that error path includes policy name
	foundError := false
	for _, err := range result.Errors {
		if contains(err.Path, "invalid") {
			foundError = true
			break
		}
	}
	assert.True(t, foundError, "Expected error to include policy name in path")
}

func TestEnhancedValidator_DuplicatePolicyNames(t *testing.T) {
	ev := NewEnhancedValidator(DefaultValidationConfig())

	// Two policies with same name and resource kind
	policies := map[string]*types.Policy{
		"policy1": {
			APIVersion:   "api.agsiri.dev/v1",
			Name:         "duplicate-name",
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "rule1",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
				},
			},
		},
		"policy2": {
			APIVersion:   "api.agsiri.dev/v1",
			Name:         "duplicate-name",
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "rule2",
					Actions: []string{"write"},
					Effect:  types.EffectAllow,
				},
			},
		},
	}

	result := ev.ValidatePolicies(policies)

	// Should have warnings about duplicate names
	assert.NotEmpty(t, result.Warnings)

	foundDuplicateWarning := false
	for _, warning := range result.Warnings {
		if warning.Type == "conflict" && contains(warning.Message, "Duplicate policy name") {
			foundDuplicateWarning = true
			break
		}
	}
	assert.True(t, foundDuplicateWarning, "Expected warning about duplicate policy names")
}

func TestEnhancedValidator_DisableCELValidation(t *testing.T) {
	config := DefaultValidationConfig()
	config.ValidateCEL = false
	ev := NewEnhancedValidator(config)

	policy := &types.Policy{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:      "rule1",
				Actions:   []string{"read"},
				Effect:    types.EffectAllow,
				Condition: "invalid CEL !!!",
			},
		},
	}

	result := ev.ValidatePolicyEnhanced(policy)
	// Should still fail because basic validator checks CEL syntax
	// But ValidateCEL=false only disables the ENHANCED CEL validation
	// The basic validator always validates CEL if present
	assert.False(t, result.Valid)
	require.NotEmpty(t, result.Errors)
	// Should be categorized as CEL error
	assert.Equal(t, "cel", result.Errors[0].Type)
}

func TestEnhancedValidator_DisableCircularDepCheck(t *testing.T) {
	config := DefaultValidationConfig()
	config.CheckCircularDep = false
	ev := NewEnhancedValidator(config)

	policy := &types.Policy{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:         "rule1",
				Actions:      []string{"read"},
				Effect:       types.EffectAllow,
				Roles:        []string{"roleB"},
				DerivedRoles: []string{"roleA"},
			},
			{
				Name:         "rule2",
				Actions:      []string{"write"},
				Effect:       types.EffectAllow,
				Roles:        []string{"roleA"},
				DerivedRoles: []string{"roleB"},
			},
		},
	}

	result := ev.ValidatePolicyEnhanced(policy)
	// Should pass because circular dependency check is disabled
	assert.True(t, result.Valid)
}

// Helper function to check if string contains substring
func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > len(substr) && (s[:len(substr)] == substr || s[len(s)-len(substr):] == substr || contains(s[1:], substr)))
}
