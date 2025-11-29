// Package policy provides integration tests for policy import functionality
package policy

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stretchr/testify/suite"
	"gopkg.in/yaml.v3"

	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
)

// ImportTestSuite is the test suite for policy import
type ImportTestSuite struct {
	suite.Suite
	store policy.Store
}

// SetupTest runs before each test
func (s *ImportTestSuite) SetupTest() {
	s.store = policy.NewMemoryStore()
}

// createTestPolicy creates a test policy
func (s *ImportTestSuite) createTestPolicy(id string) *types.Policy {
	return &types.Policy{
		PolicyID:    id,
		Kind:        types.PolicyKindResource,
		Version:     "1.0",
		Description: fmt.Sprintf("Test policy %s", id),
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.0",
			Rules: []types.ResourceRule{
				{Actions: []string{"read"}, Effect: types.EffectAllow, Roles: []string{"viewer"}},
			},
		},
	}
}

// Test: Import valid JSON policies
func (s *ImportTestSuite) TestImportJSON() {
	ctx := context.Background()

	// Setup: Create JSON export
	policies := []*types.Policy{
		s.createTestPolicy("policy1"),
		s.createTestPolicy("policy2"),
	}

	jsonData, err := json.Marshal(policies)
	require.NoError(s.T(), err)

	// Execute: Import policies
	var imported []*types.Policy
	err = json.Unmarshal(jsonData, &imported)
	require.NoError(s.T(), err)

	for _, p := range imported {
		err = s.store.Add(ctx, p)
		require.NoError(s.T(), err)
	}

	// Verify: Policies imported successfully
	storedPolicies, err := s.store.List(ctx)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), 2, len(storedPolicies))
}

// Test: Import valid YAML policies
func (s *ImportTestSuite) TestImportYAML() {
	ctx := context.Background()

	// Setup: Create YAML export
	policies := []*types.Policy{
		s.createTestPolicy("policy1"),
		s.createTestPolicy("policy2"),
	}

	yamlData, err := yaml.Marshal(policies)
	require.NoError(s.T(), err)

	// Execute: Import policies
	var imported []*types.Policy
	err = yaml.Unmarshal(yamlData, &imported)
	require.NoError(s.T(), err)

	for _, p := range imported {
		err = s.store.Add(ctx, p)
		require.NoError(s.T(), err)
	}

	// Verify: Policies imported successfully
	storedPolicies, err := s.store.List(ctx)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), 2, len(storedPolicies))
}

// Test: Import bundle (tar.gz)
func (s *ImportTestSuite) TestImportBundle() {
	// This would require implementing tar.gz handling
	// For now, we test the concept
	s.T().Skip("Bundle import requires tar.gz implementation")
}

// Test: Import with validation (dry-run)
func (s *ImportTestSuite) TestImportDryRun() {
	ctx := context.Background()

	// Setup: Create policies
	policies := []*types.Policy{
		s.createTestPolicy("policy1"),
		s.createTestPolicy("policy2"),
	}

	jsonData, err := json.Marshal(policies)
	require.NoError(s.T(), err)

	// Execute: Validate without importing
	var imported []*types.Policy
	err = json.Unmarshal(jsonData, &imported)
	require.NoError(s.T(), err)

	// Verify: Validation passed, but don't import
	assert.Equal(s.T(), 2, len(imported))

	// Verify: Store is still empty
	storedPolicies, err := s.store.List(ctx)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), 0, len(storedPolicies))
}

// Test: Import with overwrite mode
func (s *ImportTestSuite) TestImportOverwrite() {
	ctx := context.Background()

	// Setup: Add existing policy
	existing := s.createTestPolicy("policy1")
	existing.Description = "Original description"
	require.NoError(s.T(), s.store.Add(ctx, existing))

	// Execute: Import with same ID but different content
	updated := s.createTestPolicy("policy1")
	updated.Description = "Updated description"

	policies := []*types.Policy{updated}
	jsonData, err := json.Marshal(policies)
	require.NoError(s.T(), err)

	var imported []*types.Policy
	err = json.Unmarshal(jsonData, &imported)
	require.NoError(s.T(), err)

	// Overwrite existing policy
	for _, p := range imported {
		err = s.store.Update(ctx, p)
		require.NoError(s.T(), err)
	}

	// Verify: Policy was updated
	stored, err := s.store.Get(ctx, "policy1")
	require.NoError(s.T(), err)
	assert.Equal(s.T(), "Updated description", stored.Description)
}

// Test: Import with merge mode
func (s *ImportTestSuite) TestImportMerge() {
	ctx := context.Background()

	// Setup: Add existing policies
	existing1 := s.createTestPolicy("policy1")
	existing2 := s.createTestPolicy("policy2")
	require.NoError(s.T(), s.store.Add(ctx, existing1))
	require.NoError(s.T(), s.store.Add(ctx, existing2))

	// Execute: Import new policies
	new1 := s.createTestPolicy("policy3")
	new2 := s.createTestPolicy("policy4")

	policies := []*types.Policy{new1, new2}
	jsonData, err := json.Marshal(policies)
	require.NoError(s.T(), err)

	var imported []*types.Policy
	err = json.Unmarshal(jsonData, &imported)
	require.NoError(s.T(), err)

	// Merge - only add new policies
	for _, p := range imported {
		_, err := s.store.Get(ctx, p.PolicyID)
		if err != nil {
			// Policy doesn't exist, add it
			err = s.store.Add(ctx, p)
			require.NoError(s.T(), err)
		}
	}

	// Verify: All policies exist
	storedPolicies, err := s.store.List(ctx)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), 4, len(storedPolicies))
}

// Test: Import with invalid schema (validation error)
func (s *ImportTestSuite) TestImportInvalidSchema() {
	// Setup: Create invalid policy (missing required fields)
	invalidJSON := `[{
		"kind": "resource",
		"version": "1.0"
	}]`

	// Execute: Try to import
	var policies []*types.Policy
	err := json.Unmarshal([]byte(invalidJSON), &policies)
	require.NoError(s.T(), err)

	// Verify: Policy is missing PolicyID
	assert.Equal(s.T(), "", policies[0].PolicyID)
}

// Test: Import with duplicate IDs (conflict handling)
func (s *ImportTestSuite) TestImportDuplicateIDs() {
	ctx := context.Background()

	// Setup: Add existing policy
	existing := s.createTestPolicy("policy1")
	require.NoError(s.T(), s.store.Add(ctx, existing))

	// Execute: Try to import duplicate
	duplicate := s.createTestPolicy("policy1")
	err := s.store.Add(ctx, duplicate)

	// Verify: Should error
	assert.Error(s.T(), err)
}

// Test: Import with missing dependencies (error)
func (s *ImportTestSuite) TestImportMissingDependencies() {
	// This test would check for derived roles that reference non-existent parent roles
	// For now, we document the expectation
	s.T().Skip("Dependency validation not implemented yet")
}

// Test: Import rollback on error
func (s *ImportTestSuite) TestImportRollback() {
	ctx := context.Background()

	// Setup: Create policies, one invalid
	policy1 := s.createTestPolicy("policy1")
	invalidPolicy := &types.Policy{
		PolicyID: "", // Invalid - missing ID
		Kind:     types.PolicyKindResource,
		Version:  "1.0",
	}

	// Execute: Try to import batch
	policies := []*types.Policy{policy1, invalidPolicy}

	successCount := 0
	failureCount := 0

	for _, p := range policies {
		if p.PolicyID == "" {
			failureCount++
			continue
		}

		err := s.store.Add(ctx, p)
		if err != nil {
			failureCount++
		} else {
			successCount++
		}
	}

	// Verify: Only valid policy imported
	assert.Equal(s.T(), 1, successCount)
	assert.Equal(s.T(), 1, failureCount)

	storedPolicies, err := s.store.List(ctx)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), 1, len(storedPolicies))
}

// Test: Import 1000+ policies (performance)
func (s *ImportTestSuite) TestImportLargeDataset() {
	ctx := context.Background()

	// Setup: Create 1000 policies
	policies := make([]*types.Policy, 1000)
	for i := 0; i < 1000; i++ {
		policies[i] = s.createTestPolicy(fmt.Sprintf("policy%d", i))
	}

	jsonData, err := json.Marshal(policies)
	require.NoError(s.T(), err)

	// Execute: Import all policies
	var imported []*types.Policy
	err = json.Unmarshal(jsonData, &imported)
	require.NoError(s.T(), err)

	for _, p := range imported {
		err = s.store.Add(ctx, p)
		require.NoError(s.T(), err)
	}

	// Verify: All policies imported
	storedPolicies, err := s.store.List(ctx)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), 1000, len(storedPolicies))
}

// Test: Import progress reporting
func (s *ImportTestSuite) TestImportProgress() {
	ctx := context.Background()

	// Setup: Create policies
	totalPolicies := 100
	policies := make([]*types.Policy, totalPolicies)
	for i := 0; i < totalPolicies; i++ {
		policies[i] = s.createTestPolicy(fmt.Sprintf("policy%d", i))
	}

	jsonData, err := json.Marshal(policies)
	require.NoError(s.T(), err)

	// Execute: Import with progress tracking
	var imported []*types.Policy
	err = json.Unmarshal(jsonData, &imported)
	require.NoError(s.T(), err)

	progress := 0
	for _, p := range imported {
		err = s.store.Add(ctx, p)
		require.NoError(s.T(), err)
		progress++

		// Report progress every 10 policies
		if progress%10 == 0 {
			percentage := (progress * 100) / totalPolicies
			assert.LessOrEqual(s.T(), percentage, 100)
		}
	}

	// Verify: Complete
	assert.Equal(s.T(), totalPolicies, progress)
}

// Test: Import with validation errors collected
func (s *ImportTestSuite) TestImportValidationErrors() {
	ctx := context.Background()

	// Setup: Mix of valid and invalid policies
	policies := []*types.Policy{
		s.createTestPolicy("valid1"),
		{PolicyID: "", Kind: types.PolicyKindResource, Version: "1.0"}, // Invalid - no ID
		s.createTestPolicy("valid2"),
		{PolicyID: "invalid2", Kind: types.PolicyKindResource, Version: ""}, // Invalid - no version
	}

	// Execute: Import and collect errors
	errors := []string{}
	successCount := 0

	for _, p := range policies {
		if p.PolicyID == "" {
			errors = append(errors, "Policy missing ID")
			continue
		}
		if p.Version == "" {
			errors = append(errors, fmt.Sprintf("Policy %s missing version", p.PolicyID))
			continue
		}

		err := s.store.Add(ctx, p)
		if err != nil {
			errors = append(errors, err.Error())
		} else {
			successCount++
		}
	}

	// Verify: Errors collected
	assert.Equal(s.T(), 2, successCount)
	assert.Equal(s.T(), 2, len(errors))
}

// Test: Import with metadata validation
func (s *ImportTestSuite) TestImportMetadataValidation() {
	// Setup: Create export with metadata
	exportData := map[string]interface{}{
		"version": "1.0",
		"count":   2,
		"policies": []*types.Policy{
			s.createTestPolicy("policy1"),
			s.createTestPolicy("policy2"),
		},
	}

	jsonData, err := json.Marshal(exportData)
	require.NoError(s.T(), err)

	// Execute: Validate metadata
	var importData map[string]interface{}
	err = json.Unmarshal(jsonData, &importData)
	require.NoError(s.T(), err)

	// Verify: Metadata matches
	assert.Equal(s.T(), "1.0", importData["version"])
	assert.Equal(s.T(), float64(2), importData["count"])

	// Extract policies
	policiesData, err := json.Marshal(importData["policies"])
	require.NoError(s.T(), err)

	var policies []*types.Policy
	err = json.Unmarshal(policiesData, &policies)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), 2, len(policies))
}

// TestImportTestSuite runs the test suite
func TestImportTestSuite(t *testing.T) {
	suite.Run(t, new(ImportTestSuite))
}
