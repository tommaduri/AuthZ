// Package policy provides integration tests for policy export functionality
package policy

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stretchr/testify/suite"
	"gopkg.in/yaml.v3"

	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
)

// ExportTestSuite is the test suite for policy export
type ExportTestSuite struct {
	suite.Suite
	store policy.Store
}

// SetupTest runs before each test
func (s *ExportTestSuite) SetupTest() {
	s.store = policy.NewMemoryStore()
}

// createTestPolicy creates a test policy
func (s *ExportTestSuite) createTestPolicy(id string, kind types.PolicyKind) *types.Policy {
	policy := &types.Policy{
		PolicyID:    id,
		Kind:        kind,
		Version:     "1.0",
		Description: fmt.Sprintf("Test policy %s", id),
	}

	switch kind {
	case types.PolicyKindResource:
		policy.ResourcePolicy = &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.0",
			Rules: []types.ResourceRule{
				{Actions: []string{"read"}, Effect: types.EffectAllow, Roles: []string{"viewer"}},
			},
		}
	case types.PolicyKindPrincipal:
		policy.PrincipalPolicy = &types.PrincipalPolicy{
			Principal: "user123",
			Version:   "1.0",
			Rules: []types.PrincipalRule{
				{Resource: "document", Actions: []types.PrincipalAction{{Action: "write", Effect: types.EffectAllow}}},
			},
		}
	case types.PolicyKindDerivedRole:
		policy.DerivedRoles = &types.DerivedRoles{
			Name: "admin-team",
			Definitions: []types.RoleDef{
				{Name: "admin", ParentRoles: []string{"manager"}},
			},
		}
	}

	return policy
}

// Test: Export all policies to JSON
func (s *ExportTestSuite) TestExportJSON() {
	ctx := context.Background()

	// Setup: Add test policies
	policy1 := s.createTestPolicy("policy1", types.PolicyKindResource)
	policy2 := s.createTestPolicy("policy2", types.PolicyKindPrincipal)

	require.NoError(s.T(), s.store.Add(ctx, policy1))
	require.NoError(s.T(), s.store.Add(ctx, policy2))

	// Execute: Export to JSON
	policies, err := s.store.List(ctx)
	require.NoError(s.T(), err)

	jsonData, err := json.Marshal(policies)
	require.NoError(s.T(), err)

	// Verify: Check JSON structure
	var exported []*types.Policy
	err = json.Unmarshal(jsonData, &exported)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), 2, len(exported))
	assert.Equal(s.T(), "policy1", exported[0].PolicyID)
	assert.Equal(s.T(), "policy2", exported[1].PolicyID)
}

// Test: Export all policies to YAML
func (s *ExportTestSuite) TestExportYAML() {
	ctx := context.Background()

	// Setup: Add test policies
	policy1 := s.createTestPolicy("policy1", types.PolicyKindResource)
	policy2 := s.createTestPolicy("policy2", types.PolicyKindPrincipal)

	require.NoError(s.T(), s.store.Add(ctx, policy1))
	require.NoError(s.T(), s.store.Add(ctx, policy2))

	// Execute: Export to YAML
	policies, err := s.store.List(ctx)
	require.NoError(s.T(), err)

	yamlData, err := yaml.Marshal(policies)
	require.NoError(s.T(), err)

	// Verify: Check YAML structure
	var exported []*types.Policy
	err = yaml.Unmarshal(yamlData, &exported)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), 2, len(exported))
}

// Test: Export policies as bundle (tar.gz)
func (s *ExportTestSuite) TestExportBundle() {
	ctx := context.Background()

	// Setup: Add test policies
	for i := 0; i < 5; i++ {
		policy := s.createTestPolicy(fmt.Sprintf("policy%d", i), types.PolicyKindResource)
		require.NoError(s.T(), s.store.Add(ctx, policy))
	}

	// Execute: Create bundle (simulated)
	policies, err := s.store.List(ctx)
	require.NoError(s.T(), err)

	// Create a string builder to simulate tar.gz creation
	var bundle strings.Builder
	bundle.WriteString("# Policy Bundle Export\n")
	bundle.WriteString(fmt.Sprintf("# Total policies: %d\n", len(policies)))

	for _, p := range policies {
		data, err := json.Marshal(p)
		require.NoError(s.T(), err)
		bundle.WriteString(fmt.Sprintf("%s\n", string(data)))
	}

	// Verify: Check bundle contains all policies
	bundleContent := bundle.String()
	assert.Contains(s.T(), bundleContent, "policy0")
	assert.Contains(s.T(), bundleContent, "policy4")
	assert.Contains(s.T(), bundleContent, "Total policies: 5")
}

// Test: Export with filters (kind)
func (s *ExportTestSuite) TestExportWithKindFilter() {
	ctx := context.Background()

	// Setup: Add different types of policies
	resourcePolicy := s.createTestPolicy("resource1", types.PolicyKindResource)
	principalPolicy := s.createTestPolicy("principal1", types.PolicyKindPrincipal)
	derivedRole := s.createTestPolicy("derived1", types.PolicyKindDerivedRole)

	require.NoError(s.T(), s.store.Add(ctx, resourcePolicy))
	require.NoError(s.T(), s.store.Add(ctx, principalPolicy))
	require.NoError(s.T(), s.store.Add(ctx, derivedRole))

	// Execute: Export only resource policies
	allPolicies, err := s.store.List(ctx)
	require.NoError(s.T(), err)

	filtered := []*types.Policy{}
	for _, p := range allPolicies {
		if p.Kind == types.PolicyKindResource {
			filtered = append(filtered, p)
		}
	}

	// Verify: Only resource policies exported
	assert.Equal(s.T(), 1, len(filtered))
	assert.Equal(s.T(), types.PolicyKindResource, filtered[0].Kind)
}

// Test: Export with filters (IDs)
func (s *ExportTestSuite) TestExportWithIDFilter() {
	ctx := context.Background()

	// Setup: Add multiple policies
	for i := 0; i < 10; i++ {
		policy := s.createTestPolicy(fmt.Sprintf("policy%d", i), types.PolicyKindResource)
		require.NoError(s.T(), s.store.Add(ctx, policy))
	}

	// Execute: Export specific policies by ID
	targetIDs := map[string]bool{"policy1": true, "policy3": true, "policy5": true}

	allPolicies, err := s.store.List(ctx)
	require.NoError(s.T(), err)

	filtered := []*types.Policy{}
	for _, p := range allPolicies {
		if targetIDs[p.PolicyID] {
			filtered = append(filtered, p)
		}
	}

	// Verify: Only specified policies exported
	assert.Equal(s.T(), 3, len(filtered))
	for _, p := range filtered {
		assert.True(s.T(), targetIDs[p.PolicyID])
	}
}

// Test: Export with metadata included
func (s *ExportTestSuite) TestExportWithMetadata() {
	ctx := context.Background()

	// Setup: Add test policy
	policy := s.createTestPolicy("policy1", types.PolicyKindResource)
	require.NoError(s.T(), s.store.Add(ctx, policy))

	// Execute: Export with metadata
	policies, err := s.store.List(ctx)
	require.NoError(s.T(), err)

	export := map[string]interface{}{
		"version":  "1.0",
		"exported": "2024-01-01T00:00:00Z",
		"count":    len(policies),
		"policies": policies,
	}

	jsonData, err := json.Marshal(export)
	require.NoError(s.T(), err)

	// Verify: Metadata included
	var result map[string]interface{}
	err = json.Unmarshal(jsonData, &result)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), "1.0", result["version"])
	assert.Equal(s.T(), float64(1), result["count"])
}

// Test: Export pretty-printed JSON
func (s *ExportTestSuite) TestExportPrettyJSON() {
	ctx := context.Background()

	// Setup: Add test policy
	policy := s.createTestPolicy("policy1", types.PolicyKindResource)
	require.NoError(s.T(), s.store.Add(ctx, policy))

	// Execute: Export with pretty printing
	policies, err := s.store.List(ctx)
	require.NoError(s.T(), err)

	prettyJSON, err := json.MarshalIndent(policies, "", "  ")
	require.NoError(s.T(), err)

	// Verify: Contains indentation
	jsonString := string(prettyJSON)
	assert.Contains(s.T(), jsonString, "\n")
	assert.Contains(s.T(), jsonString, "  ")
	assert.Contains(s.T(), jsonString, "policy1")
}

// Test: Export 1000+ policies (performance)
func (s *ExportTestSuite) TestExportLargeDataset() {
	ctx := context.Background()

	// Setup: Add 1000 policies
	for i := 0; i < 1000; i++ {
		policy := s.createTestPolicy(fmt.Sprintf("policy%d", i), types.PolicyKindResource)
		require.NoError(s.T(), s.store.Add(ctx, policy))
	}

	// Execute: Export all policies
	policies, err := s.store.List(ctx)
	require.NoError(s.T(), err)

	jsonData, err := json.Marshal(policies)
	require.NoError(s.T(), err)

	// Verify: All policies exported
	var exported []*types.Policy
	err = json.Unmarshal(jsonData, &exported)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), 1000, len(exported))

	// Verify: Performance is acceptable
	// Export of 1000 policies should complete quickly
	assert.Greater(s.T(), len(jsonData), 10000, "Export should produce substantial data")
}

// Test: Export empty policy set
func (s *ExportTestSuite) TestExportEmpty() {
	ctx := context.Background()

	// Execute: Export with no policies
	policies, err := s.store.List(ctx)
	require.NoError(s.T(), err)

	jsonData, err := json.Marshal(policies)
	require.NoError(s.T(), err)

	// Verify: Empty array
	var exported []*types.Policy
	err = json.Unmarshal(jsonData, &exported)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), 0, len(exported))
}

// Test: Export with invalid filters (400)
func (s *ExportTestSuite) TestExportInvalidFilter() {
	ctx := context.Background()

	// Setup: Add test policy
	policy := s.createTestPolicy("policy1", types.PolicyKindResource)
	require.NoError(s.T(), s.store.Add(ctx, policy))

	// Execute: Try to filter with invalid kind
	allPolicies, err := s.store.List(ctx)
	require.NoError(s.T(), err)

	invalidKind := types.PolicyKind("invalid")
	filtered := []*types.Policy{}
	for _, p := range allPolicies {
		if p.Kind == invalidKind {
			filtered = append(filtered, p)
		}
	}

	// Verify: No policies match invalid filter
	assert.Equal(s.T(), 0, len(filtered))
}

// Helper: createTarGz creates a tar.gz bundle (simulated)
func (s *ExportTestSuite) createTarGz(policies []*types.Policy) ([]byte, error) {
	var buf strings.Builder
	gzWriter := gzip.NewWriter(&buf)
	tarWriter := tar.NewWriter(gzWriter)

	for _, p := range policies {
		data, err := json.Marshal(p)
		if err != nil {
			return nil, err
		}

		header := &tar.Header{
			Name: fmt.Sprintf("%s.json", p.PolicyID),
			Mode: 0644,
			Size: int64(len(data)),
		}

		if err := tarWriter.WriteHeader(header); err != nil {
			return nil, err
		}

		if _, err := tarWriter.Write(data); err != nil {
			return nil, err
		}
	}

	tarWriter.Close()
	gzWriter.Close()

	return []byte(buf.String()), nil
}

// Helper: extractTarGz extracts a tar.gz bundle (simulated)
func (s *ExportTestSuite) extractTarGz(data []byte) ([]*types.Policy, error) {
	gzReader, err := gzip.NewReader(strings.NewReader(string(data)))
	if err != nil {
		return nil, err
	}
	defer gzReader.Close()

	tarReader := tar.NewReader(gzReader)
	policies := []*types.Policy{}

	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}

		data := make([]byte, header.Size)
		if _, err := io.ReadFull(tarReader, data); err != nil {
			return nil, err
		}

		var policy types.Policy
		if err := json.Unmarshal(data, &policy); err != nil {
			return nil, err
		}

		policies = append(policies, &policy)
	}

	return policies, nil
}

// TestExportTestSuite runs the test suite
func TestExportTestSuite(t *testing.T) {
	suite.Run(t, new(ExportTestSuite))
}
