package policy

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/authz-engine/go-core/pkg/types"
	"go.uber.org/zap"
	"gopkg.in/yaml.v3"
)

func TestLoader_LoadFromFile(t *testing.T) {
	tmpDir := t.TempDir()

	testPolicy := &types.Policy{
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

	filePath := filepath.Join(tmpDir, "policy.yaml")
	writePolicy(t, filePath, testPolicy)

	loader := NewLoader(zap.NewNop())
	policy, err := loader.LoadFromFile(filePath)
	if err != nil {
		t.Fatalf("Failed to load policy: %v", err)
	}

	if policy.Name != "test-policy" {
		t.Errorf("Expected policy name 'test-policy', got '%s'", policy.Name)
	}

	if policy.ResourceKind != "document" {
		t.Errorf("Expected resource kind 'document', got '%s'", policy.ResourceKind)
	}

	if len(policy.Rules) != 1 {
		t.Errorf("Expected 1 rule, got %d", len(policy.Rules))
	}

	if policy.Rules[0].Name != "allow-read" {
		t.Errorf("Expected rule name 'allow-read', got '%s'", policy.Rules[0].Name)
	}
}

func TestLoader_LoadFromDirectory(t *testing.T) {
	tmpDir := t.TempDir()

	// Create multiple policy files
	policies := []*types.Policy{
		{
			APIVersion:   "v1",
			Name:         "policy-1",
			ResourceKind: "document",
			Rules: []*types.Rule{
				{Name: "rule-1", Actions: []string{"read"}, Effect: types.EffectAllow},
			},
		},
		{
			APIVersion:   "v1",
			Name:         "policy-2",
			ResourceKind: "resource",
			Rules: []*types.Rule{
				{Name: "rule-2", Actions: []string{"write"}, Effect: types.EffectDeny},
			},
		},
	}

	for i, policy := range policies {
		path := filepath.Join(tmpDir, "policy-"+string(rune(i+1))+".yaml")
		writePolicy(t, path, policy)
	}

	// Create a non-policy file (should be skipped)
	nonPolicyPath := filepath.Join(tmpDir, "readme.txt")
	os.WriteFile(nonPolicyPath, []byte("not a policy"), 0600)

	loader := NewLoader(zap.NewNop())
	loadedPolicies, err := loader.LoadFromDirectory(tmpDir)
	if err != nil {
		t.Fatalf("Failed to load policies: %v", err)
	}

	if len(loadedPolicies) != 2 {
		t.Errorf("Expected 2 policies, got %d", len(loadedPolicies))
	}
}

func TestLoader_CompileCELExpression(t *testing.T) {
	loader := NewLoader(zap.NewNop())

	tests := []struct {
		name      string
		expr      string
		shouldErr bool
	}{
		{
			name:      "valid simple expression",
			expr:      "principal.roles.contains('admin')",
			shouldErr: false,
		},
		{
			name:      "valid complex expression",
			expr:      "principal.roles.contains('admin') && resource.kind == 'document'",
			shouldErr: false,
		},
		{
			name:      "invalid expression",
			expr:      "invalid syntax here ::::",
			shouldErr: true,
		},
		{
			name:      "non-boolean result",
			expr:      "principal.id",
			shouldErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := loader.CompileCELExpression(tt.expr)
			if (err != nil) != tt.shouldErr {
				t.Errorf("Expected error=%v, got %v", tt.shouldErr, err)
			}
		})
	}
}

func TestLoader_EvaluateCELCondition(t *testing.T) {
	loader := NewLoader(zap.NewNop())

	// Compile an expression first
	expr := "principal.roles.contains('admin')"
	if err := loader.CompileCELExpression(expr); err != nil {
		t.Fatalf("Failed to compile expression: %v", err)
	}

	principal := &types.Principal{
		ID:         "user-1",
		Roles:      []string{"admin", "viewer"},
		Attributes: map[string]interface{}{},
	}

	resource := &types.Resource{
		Kind:       "document",
		ID:         "doc-1",
		Attributes: map[string]interface{}{},
	}

	result, err := loader.EvaluateCELCondition(expr, principal, resource, map[string]interface{}{})
	if err != nil {
		t.Fatalf("Failed to evaluate condition: %v", err)
	}

	if !result {
		t.Error("Expected condition to evaluate to true for admin principal")
	}

	// Test with non-admin principal
	principal.Roles = []string{"viewer"}
	result, err = loader.EvaluateCELCondition(expr, principal, resource, map[string]interface{}{})
	if err != nil {
		t.Fatalf("Failed to evaluate condition: %v", err)
	}

	if result {
		t.Error("Expected condition to evaluate to false for non-admin principal")
	}
}

func TestLoader_CacheSize(t *testing.T) {
	loader := NewLoader(zap.NewNop())

	if size := loader.CacheSize(); size != 0 {
		t.Errorf("Expected initial cache size 0, got %d", size)
	}

	// Compile some expressions
	expressions := []string{
		"principal.roles.contains('admin')",
		"resource.kind == 'document'",
		"principal.id != ''",
	}

	for _, expr := range expressions {
		loader.CompileCELExpression(expr)
	}

	if size := loader.CacheSize(); size != 3 {
		t.Errorf("Expected cache size 3, got %d", size)
	}

	// Clear cache
	loader.ClearCache()
	if size := loader.CacheSize(); size != 0 {
		t.Errorf("Expected cache size 0 after clear, got %d", size)
	}
}

func TestLoader_LoadWithCELConditions(t *testing.T) {
	tmpDir := t.TempDir()

	testPolicy := &types.Policy{
		APIVersion:   "v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:      "conditional-allow",
				Actions:   []string{"read"},
				Effect:    types.EffectAllow,
				Condition: "principal.roles.contains('admin')",
			},
		},
	}

	filePath := filepath.Join(tmpDir, "policy.yaml")
	writePolicy(t, filePath, testPolicy)

	loader := NewLoader(zap.NewNop())
	policy, err := loader.LoadFromFile(filePath)
	if err != nil {
		t.Fatalf("Failed to load policy: %v", err)
	}

	// Verify the expression was compiled
	if loader.CacheSize() != 1 {
		t.Errorf("Expected 1 compiled expression, got %d", loader.CacheSize())
	}

	// Verify the policy was loaded correctly
	if len(policy.Rules) != 1 || policy.Rules[0].Condition == "" {
		t.Error("Expected policy with CEL condition to be loaded")
	}
}

func TestLoader_LoadInvalidCELCondition(t *testing.T) {
	tmpDir := t.TempDir()

	testPolicy := &types.Policy{
		APIVersion:   "v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:      "bad-condition",
				Actions:   []string{"read"},
				Effect:    types.EffectAllow,
				Condition: "invalid syntax :::::",
			},
		},
	}

	filePath := filepath.Join(tmpDir, "policy.yaml")
	writePolicy(t, filePath, testPolicy)

	loader := NewLoader(zap.NewNop())
	_, err := loader.LoadFromFile(filePath)
	if err == nil {
		t.Error("Expected error when loading policy with invalid CEL condition, got nil")
	}
}

func TestLoader_LoadFileNotFound(t *testing.T) {
	loader := NewLoader(zap.NewNop())
	_, err := loader.LoadFromFile("/nonexistent/path/policy.yaml")
	if err == nil {
		t.Error("Expected error when loading nonexistent file, got nil")
	}
}
