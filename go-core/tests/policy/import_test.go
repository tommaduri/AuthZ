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

func TestImporter_ImportFromJSON(t *testing.T) {
	store := policy.NewMemoryStore()
	importer, err := policy.NewImporter(store)
	require.NoError(t, err)

	// Create export result
	exportResult := &policy.ExportResult{
		Policies: []*types.Policy{
			{
				APIVersion:   "v1",
				Name:         "test-policy",
				ResourceKind: "document",
				Rules: []*types.Rule{
					{
						Name:    "allow-read",
						Actions: []string{"read"},
						Effect:  types.EffectAllow,
					},
				},
			},
		},
	}

	// Marshal to JSON
	data, err := json.Marshal(exportResult)
	require.NoError(t, err)

	// Import
	req := &policy.ImportRequest{
		Format: policy.FormatJSON,
		Options: &policy.ImportOptions{
			Validate: true,
		},
	}

	result, err := importer.Import(req, bytes.NewReader(data))
	require.NoError(t, err)
	assert.Equal(t, 1, result.Imported)
	assert.Equal(t, 0, result.Skipped)

	// Verify policy was added
	imported, err := store.Get("test-policy")
	require.NoError(t, err)
	assert.Equal(t, "test-policy", imported.Name)
}

func TestImporter_ImportFromYAML(t *testing.T) {
	store := policy.NewMemoryStore()
	importer, err := policy.NewImporter(store)
	require.NoError(t, err)

	// Create export result
	exportResult := &policy.ExportResult{
		Policies: []*types.Policy{
			{
				APIVersion:   "v1",
				Name:         "yaml-policy",
				ResourceKind: "document",
				Rules: []*types.Rule{
					{
						Name:    "allow-write",
						Actions: []string{"write"},
						Effect:  types.EffectAllow,
					},
				},
			},
		},
	}

	// Marshal to YAML
	data, err := yaml.Marshal(exportResult)
	require.NoError(t, err)

	// Import
	req := &policy.ImportRequest{
		Format: policy.FormatYAML,
		Options: &policy.ImportOptions{
			Validate: true,
		},
	}

	result, err := importer.Import(req, bytes.NewReader(data))
	require.NoError(t, err)
	assert.Equal(t, 1, result.Imported)

	// Verify policy was added
	imported, err := store.Get("yaml-policy")
	require.NoError(t, err)
	assert.Equal(t, "yaml-policy", imported.Name)
}

func TestImporter_ValidationErrors(t *testing.T) {
	store := policy.NewMemoryStore()
	importer, err := policy.NewImporter(store)
	require.NoError(t, err)

	// Create invalid policy (missing name)
	exportResult := &policy.ExportResult{
		Policies: []*types.Policy{
			{
				APIVersion:   "v1",
				Name:         "", // Invalid: empty name
				ResourceKind: "document",
				Rules: []*types.Rule{
					{
						Name:    "rule-1",
						Actions: []string{"read"},
						Effect:  types.EffectAllow,
					},
				},
			},
		},
	}

	data, err := json.Marshal(exportResult)
	require.NoError(t, err)

	// Import with validation
	req := &policy.ImportRequest{
		Format: policy.FormatJSON,
		Options: &policy.ImportOptions{
			Validate: true,
		},
	}

	_, err = importer.Import(req, bytes.NewReader(data))
	assert.Error(t, err, "Should fail validation")
}

func TestImporter_DryRun(t *testing.T) {
	store := policy.NewMemoryStore()
	importer, err := policy.NewImporter(store)
	require.NoError(t, err)

	exportResult := &policy.ExportResult{
		Policies: []*types.Policy{
			{
				APIVersion:   "v1",
				Name:         "dry-run-policy",
				ResourceKind: "document",
				Rules: []*types.Rule{
					{
						Name:    "rule-1",
						Actions: []string{"read"},
						Effect:  types.EffectAllow,
					},
				},
			},
		},
	}

	data, err := json.Marshal(exportResult)
	require.NoError(t, err)

	// Import with dry-run
	req := &policy.ImportRequest{
		Format: policy.FormatJSON,
		Options: &policy.ImportOptions{
			Validate: true,
			DryRun:   true,
		},
	}

	result, err := importer.Import(req, bytes.NewReader(data))
	require.NoError(t, err)
	assert.Equal(t, 1, result.Imported) // Reports as imported

	// Verify policy was NOT actually added
	_, err = store.Get("dry-run-policy")
	assert.Error(t, err, "Policy should not exist in store")
}

func TestImporter_Overwrite(t *testing.T) {
	store := policy.NewMemoryStore()
	importer, err := policy.NewImporter(store)
	require.NoError(t, err)

	// Add existing policy
	existing := &types.Policy{
		APIVersion:   "v1",
		Name:         "existing-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "old-rule",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	}
	require.NoError(t, store.Add(existing))

	// Import updated policy
	exportResult := &policy.ExportResult{
		Policies: []*types.Policy{
			{
				APIVersion:   "v1",
				Name:         "existing-policy",
				ResourceKind: "document",
				Rules: []*types.Rule{
					{
						Name:    "new-rule",
						Actions: []string{"write"},
						Effect:  types.EffectAllow,
					},
				},
			},
		},
	}

	data, err := json.Marshal(exportResult)
	require.NoError(t, err)

	// Import without overwrite (should skip)
	t.Run("WithoutOverwrite", func(t *testing.T) {
		req := &policy.ImportRequest{
			Format: policy.FormatJSON,
			Options: &policy.ImportOptions{
				Overwrite: false,
			},
		}

		result, err := importer.Import(req, bytes.NewReader(data))
		require.NoError(t, err)
		assert.Equal(t, 0, result.Imported)
		assert.Equal(t, 1, result.Skipped)
	})

	// Import with overwrite
	t.Run("WithOverwrite", func(t *testing.T) {
		req := &policy.ImportRequest{
			Format: policy.FormatJSON,
			Options: &policy.ImportOptions{
				Overwrite: true,
			},
		}

		result, err := importer.Import(req, bytes.NewReader(data))
		require.NoError(t, err)
		assert.Equal(t, 1, result.Imported)
		assert.Equal(t, 0, result.Skipped)

		// Verify policy was updated
		updated, err := store.Get("existing-policy")
		require.NoError(t, err)
		assert.Equal(t, "new-rule", updated.Rules[0].Name)
	})
}

func TestImporter_Merge(t *testing.T) {
	store := policy.NewMemoryStore()
	importer, err := policy.NewImporter(store)
	require.NoError(t, err)

	// Add existing policy
	existing := &types.Policy{
		APIVersion:   "v1",
		Name:         "merge-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "existing-rule",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	}
	require.NoError(t, store.Add(existing))

	// Import policy with additional rules
	exportResult := &policy.ExportResult{
		Policies: []*types.Policy{
			{
				APIVersion:   "v1",
				Name:         "merge-policy",
				ResourceKind: "document",
				Rules: []*types.Rule{
					{
						Name:    "new-rule",
						Actions: []string{"write"},
						Effect:  types.EffectAllow,
					},
				},
			},
		},
	}

	data, err := json.Marshal(exportResult)
	require.NoError(t, err)

	// Import with merge
	req := &policy.ImportRequest{
		Format: policy.FormatJSON,
		Options: &policy.ImportOptions{
			Merge: true,
		},
	}

	result, err := importer.Import(req, bytes.NewReader(data))
	require.NoError(t, err)
	assert.Equal(t, 1, result.Imported)

	// Verify both rules exist
	merged, err := store.Get("merge-policy")
	require.NoError(t, err)
	assert.Equal(t, 2, len(merged.Rules))
}

func TestImporter_DerivedRoles(t *testing.T) {
	store := policy.NewMemoryStore()
	importer, err := policy.NewImporter(store)
	require.NoError(t, err)

	exportResult := &policy.ExportResult{
		DerivedRoles: []*types.DerivedRole{
			{
				Name:        "test-derived-role",
				ParentRoles: []string{"user"},
				Condition:   "principal.attr.department == 'engineering'",
			},
		},
	}

	data, err := json.Marshal(exportResult)
	require.NoError(t, err)

	// Import
	req := &policy.ImportRequest{
		Format: policy.FormatJSON,
		Options: &policy.ImportOptions{
			Validate: true,
		},
	}

	result, err := importer.Import(req, bytes.NewReader(data))
	require.NoError(t, err)
	assert.Equal(t, 1, result.Imported)
	assert.Equal(t, 1, result.Summary.DerivedRoles)

	// Verify derived role was added
	derivedRole, err := store.GetDerivedRole("test-derived-role")
	require.NoError(t, err)
	assert.Equal(t, "test-derived-role", derivedRole.Name)
}

func TestImporter_MultiplePolicies(t *testing.T) {
	store := policy.NewMemoryStore()
	importer, err := policy.NewImporter(store)
	require.NoError(t, err)

	// Create export result with multiple policies
	exportResult := &policy.ExportResult{
		Policies: make([]*types.Policy, 0),
	}

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
		exportResult.Policies = append(exportResult.Policies, policy)
	}

	data, err := json.Marshal(exportResult)
	require.NoError(t, err)

	// Import
	req := &policy.ImportRequest{
		Format: policy.FormatJSON,
		Options: &policy.ImportOptions{
			Validate: true,
		},
	}

	result, err := importer.Import(req, bytes.NewReader(data))
	require.NoError(t, err)
	assert.Equal(t, 10, result.Imported)
	assert.Equal(t, 10, result.Summary.ResourcePolicies)
}

// Test large policy sets
func TestImporter_LargePolicySet(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping large policy set test in short mode")
	}

	store := policy.NewMemoryStore()
	importer, err := policy.NewImporter(store)
	require.NoError(t, err)

	// Create 1000 policies
	exportResult := &policy.ExportResult{
		Policies: make([]*types.Policy, 0),
	}

	for i := 0; i < 1000; i++ {
		policy := &types.Policy{
			APIVersion:   "v1",
			Name:         "large-policy-" + string(rune(i)),
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "rule-1",
					Actions: []string{"read", "write"},
					Effect:  types.EffectAllow,
				},
			},
		}
		exportResult.Policies = append(exportResult.Policies, policy)
	}

	data, err := json.Marshal(exportResult)
	require.NoError(t, err)

	// Import
	req := &policy.ImportRequest{
		Format: policy.FormatJSON,
		Options: &policy.ImportOptions{
			Validate: true,
		},
	}

	result, err := importer.Import(req, bytes.NewReader(data))
	require.NoError(t, err)
	assert.Equal(t, 1000, result.Imported)

	// Verify all policies were added
	assert.Equal(t, 1000, store.Count())

	t.Logf("Imported 1000 policies successfully")
}

// Benchmark import performance
func BenchmarkImporter_ImportJSON(b *testing.B) {
	// Create export result with 100 policies
	exportResult := &policy.ExportResult{
		Policies: make([]*types.Policy, 0),
	}

	for i := 0; i < 100; i++ {
		policy := &types.Policy{
			APIVersion:   "v1",
			Name:         "bench-policy-" + string(rune(i)),
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "rule-1",
					Actions: []string{"read", "write"},
					Effect:  types.EffectAllow,
				},
			},
		}
		exportResult.Policies = append(exportResult.Policies, policy)
	}

	data, _ := json.Marshal(exportResult)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		store := policy.NewMemoryStore()
		importer, _ := policy.NewImporter(store)

		req := &policy.ImportRequest{
			Format: policy.FormatJSON,
			Options: &policy.ImportOptions{
				Validate: true,
			},
		}

		_, _ = importer.Import(req, bytes.NewReader(data))
	}
}
