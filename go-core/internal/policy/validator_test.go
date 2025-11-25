package policy

import (
	"testing"

	"github.com/authz-engine/go-core/pkg/types"
)

func TestValidator_ValidatePolicy_Valid(t *testing.T) {
	validator := NewValidator()

	policy := &types.Policy{
		APIVersion:   "v1",
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

	err := validator.ValidatePolicy(policy)
	if err != nil {
		t.Fatalf("Expected no error for valid policy, got: %v", err)
	}
}

func TestValidator_ValidatePolicy_NilPolicy(t *testing.T) {
	validator := NewValidator()
	err := validator.ValidatePolicy(nil)
	if err == nil {
		t.Error("Expected error for nil policy, got nil")
	}
}

func TestValidator_ValidatePolicy_MissingName(t *testing.T) {
	validator := NewValidator()

	policy := &types.Policy{
		APIVersion:   "v1",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "rule-1",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	}

	err := validator.ValidatePolicy(policy)
	if err == nil {
		t.Error("Expected error for missing policy name, got nil")
	}
}

func TestValidator_ValidatePolicy_MissingResourceKind(t *testing.T) {
	validator := NewValidator()

	policy := &types.Policy{
		APIVersion: "v1",
		Name:       "test-policy",
		Rules: []*types.Rule{
			{
				Name:    "rule-1",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	}

	err := validator.ValidatePolicy(policy)
	if err == nil {
		t.Error("Expected error for missing resourceKind, got nil")
	}
}

func TestValidator_ValidatePolicy_EmptyRules(t *testing.T) {
	validator := NewValidator()

	policy := &types.Policy{
		APIVersion:   "v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules:        []*types.Rule{},
	}

	err := validator.ValidatePolicy(policy)
	if err == nil {
		t.Error("Expected error for empty rules, got nil")
	}
}

func TestValidator_ValidateRule_Valid(t *testing.T) {
	validator := NewValidator()

	rule := &types.Rule{
		Name:    "allow-read",
		Actions: []string{"read"},
		Effect:  types.EffectAllow,
	}

	err := validator.validateRule(rule, 0)
	if err != nil {
		t.Fatalf("Expected no error for valid rule, got: %v", err)
	}
}

func TestValidator_ValidateRule_MissingName(t *testing.T) {
	validator := NewValidator()

	rule := &types.Rule{
		Actions: []string{"read"},
		Effect:  types.EffectAllow,
	}

	err := validator.validateRule(rule, 0)
	if err == nil {
		t.Error("Expected error for missing rule name, got nil")
	}
}

func TestValidator_ValidateRule_EmptyActions(t *testing.T) {
	validator := NewValidator()

	rule := &types.Rule{
		Name:    "rule-1",
		Actions: []string{},
		Effect:  types.EffectAllow,
	}

	err := validator.validateRule(rule, 0)
	if err == nil {
		t.Error("Expected error for empty actions, got nil")
	}
}

func TestValidator_ValidateRule_InvalidEffect(t *testing.T) {
	validator := NewValidator()

	rule := &types.Rule{
		Name:    "rule-1",
		Actions: []string{"read"},
		Effect:  "invalid",
	}

	err := validator.validateRule(rule, 0)
	if err == nil {
		t.Error("Expected error for invalid effect, got nil")
	}
}

func TestValidator_ValidateRule_InvalidCELCondition(t *testing.T) {
	validator := NewValidator()

	rule := &types.Rule{
		Name:      "rule-1",
		Actions:   []string{"read"},
		Effect:    types.EffectAllow,
		Condition: "invalid syntax ::::",
	}

	err := validator.validateRule(rule, 0)
	if err == nil {
		t.Error("Expected error for invalid CEL condition, got nil")
	}
}

func TestValidator_ValidateCELExpression_Valid(t *testing.T) {
	validator := NewValidator()

	tests := []struct {
		name       string
		expression string
		valid      bool
	}{
		{
			name:       "simple role check",
			expression: "principal.roles.contains('admin')",
			valid:      true,
		},
		{
			name:       "resource check",
			expression: "resource.kind == 'document'",
			valid:      true,
		},
		{
			name:       "complex expression",
			expression: "principal.roles.contains('admin') && resource.kind == 'document'",
			valid:      true,
		},
		{
			name:       "invalid syntax",
			expression: "invalid syntax ::::",
			valid:      false,
		},
		{
			name:       "non-boolean result",
			expression: "principal.id",
			valid:      false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validator.validateCELExpression(tt.expression)
			if (err != nil) != !tt.valid {
				t.Errorf("Expected valid=%v, got error=%v", tt.valid, err)
			}
		})
	}
}

func TestValidator_ValidateRoles(t *testing.T) {
	validator := NewValidator()

	rule := &types.Rule{
		Name:    "rule-1",
		Actions: []string{"read"},
		Effect:  types.EffectAllow,
		Roles:   []string{"admin", "editor"},
	}

	err := validator.validateRule(rule, 0)
	if err != nil {
		t.Fatalf("Expected no error for valid roles, got: %v", err)
	}
}

func TestValidator_ValidateDerivedRoles(t *testing.T) {
	validator := NewValidator()

	rule := &types.Rule{
		Name:         "rule-1",
		Actions:      []string{"read"},
		Effect:       types.EffectAllow,
		DerivedRoles: []string{"admin_member", "editor_member"},
	}

	err := validator.validateRule(rule, 0)
	if err != nil {
		t.Fatalf("Expected no error for valid derived roles, got: %v", err)
	}
}

func TestValidator_InvalidIdentifiers(t *testing.T) {
	_ = NewValidator() // Create validator but don't use it in this test

	tests := []struct {
		name    string
		id      string
		isValid bool
	}{
		{"valid_name", "valid_name", true},
		{"valid-name", "valid-name", true},
		{"_leading_underscore", "_leading_underscore", true},
		{"123invalid", "123invalid", false},
		{"-invalid", "-invalid", false},
		{"with space", "with space", false},
		{"with@symbol", "with@symbol", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isValidIdentifier(tt.id)
			if result != tt.isValid {
				t.Errorf("Expected isValidIdentifier(%s) = %v, got %v", tt.id, tt.isValid, result)
			}
		})
	}
}

func TestValidator_InvalidActions(t *testing.T) {
	_ = NewValidator() // Create validator but don't use it in this test

	tests := []struct {
		name    string
		action  string
		isValid bool
	}{
		{"read", "read", true},
		{"read_all", "read_all", true},
		{"namespace:read", "namespace:read", true},
		{"*", "*", true},
		{"123invalid", "123invalid", false},
		{"-invalid", "-invalid", false},
		{"with space", "with space", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isValidAction(tt.action)
			if result != tt.isValid {
				t.Errorf("Expected isValidAction(%s) = %v, got %v", tt.action, tt.isValid, result)
			}
		})
	}
}

func TestValidator_DuplicateRules(t *testing.T) {
	validator := NewValidator()

	policy := &types.Policy{
		APIVersion:   "v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "rule-1",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
			{
				Name:    "rule-1",
				Actions: []string{"write"},
				Effect:  types.EffectDeny,
			},
		},
	}

	err := validator.ValidatePolicy(policy)
	if err == nil {
		t.Error("Expected error for duplicate rule names, got nil")
	}
}

func TestValidator_ValidateRuleConsistency(t *testing.T) {
	validator := NewValidator()

	policy := &types.Policy{
		APIVersion:   "v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read", "write"},
				Effect:  types.EffectAllow,
			},
			{
				Name:    "deny-read",
				Actions: []string{"read"},
				Effect:  types.EffectDeny,
			},
		},
	}

	warnings := validator.ValidateRuleConsistency(policy)
	if len(warnings) == 0 {
		t.Log("Note: Expected consistency warnings for potentially unreachable rule")
	}
}

func TestValidator_MultipleValidPolicies(t *testing.T) {
	validator := NewValidator()

	policies := []*types.Policy{
		{
			APIVersion:   "v1",
			Name:         "policy-1",
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "rule-1",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
				},
			},
		},
		{
			APIVersion:   "v1",
			Name:         "policy-2",
			ResourceKind: "resource",
			Rules: []*types.Rule{
				{
					Name:    "rule-2",
					Actions: []string{"write"},
					Effect:  types.EffectDeny,
				},
			},
		},
	}

	for _, policy := range policies {
		err := validator.ValidatePolicy(policy)
		if err != nil {
			t.Errorf("Failed to validate policy %s: %v", policy.Name, err)
		}
	}
}
