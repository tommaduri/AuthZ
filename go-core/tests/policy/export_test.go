package policy_test

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

func TestExporter_ExportToJSON(t *testing.T) {
	store := policy.NewMemoryStore()
	exporter := policy.NewExporter(store)

	// Add test policies
	testPolicy := &types.Policy{
		APIVersion:   "v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
				Roles:   []string{"user"},
			},
		},
	}
	require.NoError(t, store.Add(testPolicy))

	// Export to JSON
	req := &policy.ExportRequest{
		Format: policy.FormatJSON,
		Options: &policy.ExportOptions{
			IncludeMetadata: true,
			Pretty:          true,
		},
	}

	var buf bytes.Buffer
	err := exporter.ExportToJSON(req, &buf)
	require.NoError(t, err)

	// Parse and verify
	var result policy.ExportResult
	err = json.Unmarshal(buf.Bytes(), &result)
	require.NoError(t, err)

	assert.Equal(t, 1, len(result.Policies))
	assert.Equal(t, "test-policy", result.Policies[0].Name)
	assert.NotNil(t, result.Metadata)
	assert.Equal(t, 1, result.Metadata.PolicyCount)
}

func TestExporter_ExportToYAML(t *testing.T) {
	store := policy.NewMemoryStore()
	exporter := policy.NewExporter(store)

	// Add test policies
	testPolicy := &types.Policy{
		APIVersion:   "v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-write",
				Actions: []string{"write"},
				Effect:  types.EffectAllow,
			},
		},
	}
	require.NoError(t, store.Add(testPolicy))

	// Export to YAML
	req := &policy.ExportRequest{
		Format: policy.FormatYAML,
		Options: &policy.ExportOptions{
			IncludeMetadata: true,
		},
	}

	var buf bytes.Buffer
	err := exporter.ExportToYAML(req, &buf)
	require.NoError(t, err)

	// Parse and verify
	var result policy.ExportResult
	err = yaml.Unmarshal(buf.Bytes(), &result)
	require.NoError(t, err)

	assert.Equal(t, 1, len(result.Policies))
	assert.Equal(t, "test-policy", result.Policies[0].Name)
}

func TestExporter_ExportToBundle(t *testing.T) {
	store := policy.NewMemoryStore()
	exporter := policy.NewExporter(store)

	// Add test policies
	testPolicy := &types.Policy{
		APIVersion:   "v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-delete",
				Actions: []string{"delete"},
				Effect:  types.EffectAllow,
			},
		},
	}
	require.NoError(t, store.Add(testPolicy))

	// Add derived role
	derivedRole := &types.DerivedRole{
		Name:        "test-derived-role",
		ParentRoles: []string{"user"},
		Condition:   "principal.attr.department == 'engineering'",
	}
	require.NoError(t, store.AddDerivedRole(derivedRole))

	// Export to bundle
	req := &policy.ExportRequest{
		Format: policy.FormatBundle,
		Options: &policy.ExportOptions{
			IncludeMetadata: true,
		},
	}

	var buf bytes.Buffer
	err := exporter.ExportToBundle(req, &buf)
	require.NoError(t, err)

	assert.Greater(t, buf.Len(), 0, "Bundle should not be empty")
}

func TestExporter_FilteredExport(t *testing.T) {
	store := policy.NewMemoryStore()
	exporter := policy.NewExporter(store)

	// Add multiple policies
	resourcePolicy := &types.Policy{
		APIVersion:   "v1",
		Name:         "resource-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	}
	require.NoError(t, store.Add(resourcePolicy))

	principalPolicy := &types.Policy{
		APIVersion:      "v1",
		Name:            "principal-policy",
		PrincipalPolicy: true,
		Principal: &types.PrincipalSelector{
			ID: "user123",
		},
		Resources: []*types.ResourceSelector{
			{Kind: "document"},
		},
		Rules: []*types.Rule{
			{
				Name:    "allow-write",
				Actions: []string{"write"},
				Effect:  types.EffectAllow,
			},
		},
	}
	require.NoError(t, store.Add(principalPolicy))

	// Test filter by kind
	t.Run("FilterByKind", func(t *testing.T) {
		req := &policy.ExportRequest{
			Format: policy.FormatJSON,
			Filters: &policy.ExportFilters{
				Kind: "resource",
			},
		}

		result, err := exporter.Export(req)
		require.NoError(t, err)
		assert.Equal(t, 1, len(result.Policies))
		assert.Equal(t, "resource-policy", result.Policies[0].Name)
	})

	// Test filter by ID
	t.Run("FilterByID", func(t *testing.T) {
		req := &policy.ExportRequest{
			Format: policy.FormatJSON,
			Filters: &policy.ExportFilters{
				IDs: []string{"principal-policy"},
			},
		}

		result, err := exporter.Export(req)
		require.NoError(t, err)
		assert.Equal(t, 1, len(result.Policies))
		assert.Equal(t, "principal-policy", result.Policies[0].Name)
	})
}

func TestExporter_ExportAll(t *testing.T) {
	store := policy.NewMemoryStore()
	exporter := policy.NewExporter(store)

	// Add multiple policies
	for i := 0; i < 10; i++ {
		policy := &types.Policy{
			APIVersion:   "v1",
			Name:         "policy-" + string(rune('a'+i)),
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "rule-1",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
				},
			},
		}
		require.NoError(t, store.Add(policy))
	}

	// Export all
	req := &policy.ExportRequest{
		Format: policy.FormatJSON,
		Options: &policy.ExportOptions{
			IncludeMetadata: true,
		},
	}

	result, err := exporter.Export(req)
	require.NoError(t, err)
	assert.Equal(t, 10, len(result.Policies))
	assert.Equal(t, 10, result.Metadata.PolicyCount)
}

func TestExporter_EmptyStore(t *testing.T) {
	store := policy.NewMemoryStore()
	exporter := policy.NewExporter(store)

	req := &policy.ExportRequest{
		Format: policy.FormatJSON,
	}

	result, err := exporter.Export(req)
	require.NoError(t, err)
	assert.Equal(t, 0, len(result.Policies))
}

// Benchmark export performance
func BenchmarkExporter_ExportJSON(b *testing.B) {
	store := policy.NewMemoryStore()

	// Add 100 policies
	for i := 0; i < 100; i++ {
		policy := &types.Policy{
			APIVersion:   "v1",
			Name:         "policy-" + string(rune(i)),
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "rule-1",
					Actions: []string{"read", "write"},
					Effect:  types.EffectAllow,
				},
			},
		}
		_ = store.Add(policy)
	}

	exporter := policy.NewExporter(store)
	req := &policy.ExportRequest{
		Format: policy.FormatJSON,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		var buf bytes.Buffer
		_ = exporter.ExportToJSON(req, &buf)
	}
}

func BenchmarkExporter_ExportYAML(b *testing.B) {
	store := policy.NewMemoryStore()

	// Add 100 policies
	for i := 0; i < 100; i++ {
		policy := &types.Policy{
			APIVersion:   "v1",
			Name:         "policy-" + string(rune(i)),
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "rule-1",
					Actions: []string{"read", "write"},
					Effect:  types.EffectAllow,
				},
			},
		}
		_ = store.Add(policy)
	}

	exporter := policy.NewExporter(store)
	req := &policy.ExportRequest{
		Format: policy.FormatYAML,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		var buf bytes.Buffer
		_ = exporter.ExportToYAML(req, &buf)
	}
}

func BenchmarkExporter_ExportBundle(b *testing.B) {
	store := policy.NewMemoryStore()

	// Add 100 policies
	for i := 0; i < 100; i++ {
		policy := &types.Policy{
			APIVersion:   "v1",
			Name:         "policy-" + string(rune(i)),
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "rule-1",
					Actions: []string{"read", "write"},
					Effect:  types.EffectAllow,
				},
			},
		}
		_ = store.Add(policy)
	}

	exporter := policy.NewExporter(store)
	req := &policy.ExportRequest{
		Format: policy.FormatBundle,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		var buf bytes.Buffer
		_ = exporter.ExportToBundle(req, &buf)
	}
}

// Test large policy sets
func TestExporter_LargePolicySet(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping large policy set test in short mode")
	}

	store := policy.NewMemoryStore()
	exporter := policy.NewExporter(store)

	// Add 1000 policies
	for i := 0; i < 1000; i++ {
		policy := &types.Policy{
			APIVersion:   "v1",
			Name:         "policy-" + string(rune(i)),
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "rule-1",
					Actions: []string{"read", "write", "delete"},
					Effect:  types.EffectAllow,
					Condition: "principal.attr.department == 'engineering'",
				},
				{
					Name:    "rule-2",
					Actions: []string{"admin"},
					Effect:  types.EffectDeny,
					Roles:   []string{"admin"},
				},
			},
		}
		require.NoError(t, store.Add(policy))
	}

	// Export to JSON
	req := &policy.ExportRequest{
		Format: policy.FormatJSON,
		Options: &policy.ExportOptions{
			IncludeMetadata: true,
		},
	}

	var buf bytes.Buffer
	err := exporter.ExportToJSON(req, &buf)
	require.NoError(t, err)

	// Verify
	var result policy.ExportResult
	err = json.Unmarshal(buf.Bytes(), &result)
	require.NoError(t, err)
	assert.Equal(t, 1000, len(result.Policies))
	assert.Equal(t, 1000, result.Metadata.PolicyCount)

	t.Logf("Exported 1000 policies, size: %d bytes", buf.Len())
}
