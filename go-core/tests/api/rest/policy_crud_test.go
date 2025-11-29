// Package rest provides integration tests for REST API policy CRUD operations
package rest

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stretchr/testify/suite"
	"go.uber.org/zap"

	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
)

// PolicyCRUDTestSuite is the test suite for policy CRUD endpoints
type PolicyCRUDTestSuite struct {
	suite.Suite
	router *mux.Router
	server *httptest.Server
	store  policy.Store
	logger *zap.Logger
}

// SetupSuite runs once before all tests
func (s *PolicyCRUDTestSuite) SetupSuite() {
	s.logger = zap.NewNop()
	s.store = policy.NewMemoryStore()

	// Setup router
	s.router = mux.NewRouter()
	s.setupRoutes()

	// Create test server
	s.server = httptest.NewServer(s.router)
}

// TearDownSuite runs once after all tests
func (s *PolicyCRUDTestSuite) TearDownSuite() {
	if s.server != nil {
		s.server.Close()
	}
}

// SetupTest runs before each test
func (s *PolicyCRUDTestSuite) SetupTest() {
	// Clear policy store
	s.store = policy.NewMemoryStore()
	s.router = mux.NewRouter()
	s.setupRoutes()
	s.server = httptest.NewServer(s.router)
}

// TearDownTest runs after each test
func (s *PolicyCRUDTestSuite) TearDownTest() {
	if s.server != nil {
		s.server.Close()
	}
}

// setupRoutes configures the API routes
func (s *PolicyCRUDTestSuite) setupRoutes() {
	s.router.HandleFunc("/v1/policies", s.handleListPolicies).Methods("GET")
	s.router.HandleFunc("/v1/policies/{id}", s.handleGetPolicy).Methods("GET")
	s.router.HandleFunc("/v1/policies", s.handleCreatePolicy).Methods("POST")
	s.router.HandleFunc("/v1/policies/{id}", s.handleUpdatePolicy).Methods("PUT")
	s.router.HandleFunc("/v1/policies/{id}", s.handleDeletePolicy).Methods("DELETE")
}

// handleListPolicies lists all policies with optional filters
func (s *PolicyCRUDTestSuite) handleListPolicies(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Parse query parameters
	kindFilter := r.URL.Query().Get("kind")
	limit := 50
	offset := 0

	// Get all policies
	policies, err := s.store.List(ctx)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Filter by kind if specified
	filtered := []*types.Policy{}
	for _, p := range policies {
		if kindFilter == "" || string(p.Kind) == kindFilter {
			filtered = append(filtered, p)
		}
	}

	// Apply pagination
	start := offset
	end := offset + limit
	if start > len(filtered) {
		start = len(filtered)
	}
	if end > len(filtered) {
		end = len(filtered)
	}

	result := filtered[start:end]

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"policies":    result,
		"total_count": len(filtered),
		"limit":       limit,
		"offset":      offset,
	})
}

// handleGetPolicy gets a specific policy by ID
func (s *PolicyCRUDTestSuite) handleGetPolicy(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	policyID := vars["id"]

	policy, err := s.store.Get(ctx, policyID)
	if err != nil {
		http.Error(w, "Policy not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(policy)
}

// handleCreatePolicy creates a new policy
func (s *PolicyCRUDTestSuite) handleCreatePolicy(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var policy types.Policy
	if err := json.NewDecoder(r.Body).Decode(&policy); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate policy
	if policy.PolicyID == "" {
		http.Error(w, "Policy ID is required", http.StatusBadRequest)
		return
	}

	// Check for duplicate
	existing, _ := s.store.Get(ctx, policy.PolicyID)
	if existing != nil {
		http.Error(w, "Policy already exists", http.StatusConflict)
		return
	}

	// Add policy
	if err := s.store.Add(ctx, &policy); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(policy)
}

// handleUpdatePolicy updates an existing policy
func (s *PolicyCRUDTestSuite) handleUpdatePolicy(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	policyID := vars["id"]

	// Check if policy exists
	existing, err := s.store.Get(ctx, policyID)
	if err != nil || existing == nil {
		http.Error(w, "Policy not found", http.StatusNotFound)
		return
	}

	var policy types.Policy
	if err := json.NewDecoder(r.Body).Decode(&policy); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Ensure ID matches
	policy.PolicyID = policyID

	// Update policy
	if err := s.store.Update(ctx, &policy); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(policy)
}

// handleDeletePolicy deletes a policy
func (s *PolicyCRUDTestSuite) handleDeletePolicy(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	policyID := vars["id"]

	// Check if policy exists
	existing, err := s.store.Get(ctx, policyID)
	if err != nil || existing == nil {
		http.Error(w, "Policy not found", http.StatusNotFound)
		return
	}

	// Delete policy
	if err := s.store.Delete(ctx, policyID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// Test: GET /v1/policies - List all policies
func (s *PolicyCRUDTestSuite) TestListPolicies() {
	ctx := context.Background()

	// Setup: Add test policies
	policy1 := &types.Policy{
		PolicyID: "policy1",
		Kind:     types.PolicyKindResource,
		Version:  "1.0",
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.0",
			Rules: []types.ResourceRule{
				{Actions: []string{"read"}, Effect: types.EffectAllow, Roles: []string{"viewer"}},
			},
		},
	}

	policy2 := &types.Policy{
		PolicyID: "policy2",
		Kind:     types.PolicyKindPrincipal,
		Version:  "1.0",
		PrincipalPolicy: &types.PrincipalPolicy{
			Principal: "user123",
			Version:   "1.0",
			Rules: []types.PrincipalRule{
				{Resource: "document", Actions: []types.PrincipalAction{{Action: "write", Effect: types.EffectAllow}}},
			},
		},
	}

	require.NoError(s.T(), s.store.Add(ctx, policy1))
	require.NoError(s.T(), s.store.Add(ctx, policy2))

	// Execute: List policies
	resp, err := http.Get(s.server.URL + "/v1/policies")
	require.NoError(s.T(), err)
	defer resp.Body.Close()

	// Verify
	assert.Equal(s.T(), http.StatusOK, resp.StatusCode)

	var result map[string]interface{}
	err = json.NewDecoder(resp.Body).Decode(&result)
	require.NoError(s.T(), err)

	policies := result["policies"].([]interface{})
	assert.Equal(s.T(), 2, len(policies))
	assert.Equal(s.T(), float64(2), result["total_count"])
}

// Test: GET /v1/policies - Pagination
func (s *PolicyCRUDTestSuite) TestListPoliciesPagination() {
	ctx := context.Background()

	// Setup: Add multiple policies
	for i := 0; i < 10; i++ {
		policy := &types.Policy{
			PolicyID: fmt.Sprintf("policy%d", i),
			Kind:     types.PolicyKindResource,
			Version:  "1.0",
			ResourcePolicy: &types.ResourcePolicy{
				Resource: "document",
				Version:  "1.0",
				Rules:    []types.ResourceRule{},
			},
		}
		require.NoError(s.T(), s.store.Add(ctx, policy))
	}

	// Execute: List with limit
	resp, err := http.Get(s.server.URL + "/v1/policies?limit=5&offset=0")
	require.NoError(s.T(), err)
	defer resp.Body.Close()

	// Verify
	assert.Equal(s.T(), http.StatusOK, resp.StatusCode)

	var result map[string]interface{}
	err = json.NewDecoder(resp.Body).Decode(&result)
	require.NoError(s.T(), err)

	policies := result["policies"].([]interface{})
	assert.Equal(s.T(), 5, len(policies))
	assert.Equal(s.T(), float64(10), result["total_count"])
}

// Test: GET /v1/policies - Filter by kind
func (s *PolicyCRUDTestSuite) TestListPoliciesFilterByKind() {
	ctx := context.Background()

	// Setup: Add policies of different kinds
	resourcePolicy := &types.Policy{
		PolicyID: "resource-policy",
		Kind:     types.PolicyKindResource,
		Version:  "1.0",
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.0",
			Rules:    []types.ResourceRule{},
		},
	}

	principalPolicy := &types.Policy{
		PolicyID: "principal-policy",
		Kind:     types.PolicyKindPrincipal,
		Version:  "1.0",
		PrincipalPolicy: &types.PrincipalPolicy{
			Principal: "user123",
			Version:   "1.0",
			Rules:     []types.PrincipalRule{},
		},
	}

	require.NoError(s.T(), s.store.Add(ctx, resourcePolicy))
	require.NoError(s.T(), s.store.Add(ctx, principalPolicy))

	// Execute: Filter by resource kind
	resp, err := http.Get(s.server.URL + "/v1/policies?kind=resource")
	require.NoError(s.T(), err)
	defer resp.Body.Close()

	// Verify
	assert.Equal(s.T(), http.StatusOK, resp.StatusCode)

	var result map[string]interface{}
	err = json.NewDecoder(resp.Body).Decode(&result)
	require.NoError(s.T(), err)

	policies := result["policies"].([]interface{})
	assert.Equal(s.T(), 1, len(policies))
}

// Test: GET /v1/policies/:id - Get specific policy
func (s *PolicyCRUDTestSuite) TestGetPolicy() {
	ctx := context.Background()

	// Setup: Add policy
	policy := &types.Policy{
		PolicyID:    "test-policy",
		Kind:        types.PolicyKindResource,
		Version:     "1.0",
		Description: "Test policy",
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.0",
			Rules:    []types.ResourceRule{},
		},
	}

	require.NoError(s.T(), s.store.Add(ctx, policy))

	// Execute: Get policy
	resp, err := http.Get(s.server.URL + "/v1/policies/test-policy")
	require.NoError(s.T(), err)
	defer resp.Body.Close()

	// Verify
	assert.Equal(s.T(), http.StatusOK, resp.StatusCode)

	var result types.Policy
	err = json.NewDecoder(resp.Body).Decode(&result)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), "test-policy", result.PolicyID)
	assert.Equal(s.T(), "Test policy", result.Description)
}

// Test: POST /v1/policies - Create resource policy
func (s *PolicyCRUDTestSuite) TestCreateResourcePolicy() {
	// Execute: Create policy
	policy := &types.Policy{
		PolicyID:    "new-resource-policy",
		Kind:        types.PolicyKindResource,
		Version:     "1.0",
		Description: "New resource policy",
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.0",
			Rules: []types.ResourceRule{
				{Actions: []string{"read"}, Effect: types.EffectAllow, Roles: []string{"viewer"}},
			},
		},
	}

	body, _ := json.Marshal(policy)
	resp, err := http.Post(s.server.URL+"/v1/policies", "application/json", bytes.NewReader(body))
	require.NoError(s.T(), err)
	defer resp.Body.Close()

	// Verify
	assert.Equal(s.T(), http.StatusCreated, resp.StatusCode)

	var result types.Policy
	err = json.NewDecoder(resp.Body).Decode(&result)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), "new-resource-policy", result.PolicyID)

	// Verify it's in the store
	stored, err := s.store.Get(context.Background(), "new-resource-policy")
	require.NoError(s.T(), err)
	assert.Equal(s.T(), "new-resource-policy", stored.PolicyID)
}

// Test: POST /v1/policies - Create principal policy
func (s *PolicyCRUDTestSuite) TestCreatePrincipalPolicy() {
	// Execute: Create principal policy
	policy := &types.Policy{
		PolicyID:    "new-principal-policy",
		Kind:        types.PolicyKindPrincipal,
		Version:     "1.0",
		Description: "New principal policy",
		PrincipalPolicy: &types.PrincipalPolicy{
			Principal: "user123",
			Version:   "1.0",
			Rules: []types.PrincipalRule{
				{Resource: "document", Actions: []types.PrincipalAction{{Action: "write", Effect: types.EffectAllow}}},
			},
		},
	}

	body, _ := json.Marshal(policy)
	resp, err := http.Post(s.server.URL+"/v1/policies", "application/json", bytes.NewReader(body))
	require.NoError(s.T(), err)
	defer resp.Body.Close()

	// Verify
	assert.Equal(s.T(), http.StatusCreated, resp.StatusCode)

	var result types.Policy
	err = json.NewDecoder(resp.Body).Decode(&result)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), "new-principal-policy", result.PolicyID)
}

// Test: POST /v1/policies - Create derived role
func (s *PolicyCRUDTestSuite) TestCreateDerivedRole() {
	// Execute: Create derived role policy
	policy := &types.Policy{
		PolicyID:    "derived-role-policy",
		Kind:        types.PolicyKindDerivedRole,
		Version:     "1.0",
		Description: "Derived role policy",
		DerivedRoles: &types.DerivedRoles{
			Name: "admin-team",
			Definitions: []types.RoleDef{
				{Name: "admin", ParentRoles: []string{"manager"}},
			},
		},
	}

	body, _ := json.Marshal(policy)
	resp, err := http.Post(s.server.URL+"/v1/policies", "application/json", bytes.NewReader(body))
	require.NoError(s.T(), err)
	defer resp.Body.Close()

	// Verify
	assert.Equal(s.T(), http.StatusCreated, resp.StatusCode)
}

// Test: PUT /v1/policies/:id - Update policy
func (s *PolicyCRUDTestSuite) TestUpdatePolicy() {
	ctx := context.Background()

	// Setup: Add policy
	policy := &types.Policy{
		PolicyID:    "update-test",
		Kind:        types.PolicyKindResource,
		Version:     "1.0",
		Description: "Original description",
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.0",
			Rules:    []types.ResourceRule{},
		},
	}

	require.NoError(s.T(), s.store.Add(ctx, policy))

	// Execute: Update policy
	updatedPolicy := &types.Policy{
		PolicyID:    "update-test",
		Kind:        types.PolicyKindResource,
		Version:     "1.1",
		Description: "Updated description",
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.1",
			Rules:    []types.ResourceRule{},
		},
	}

	body, _ := json.Marshal(updatedPolicy)
	req, _ := http.NewRequest("PUT", s.server.URL+"/v1/policies/update-test", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	require.NoError(s.T(), err)
	defer resp.Body.Close()

	// Verify
	assert.Equal(s.T(), http.StatusOK, resp.StatusCode)

	var result types.Policy
	err = json.NewDecoder(resp.Body).Decode(&result)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), "Updated description", result.Description)
	assert.Equal(s.T(), "1.1", result.Version)
}

// Test: DELETE /v1/policies/:id - Delete policy
func (s *PolicyCRUDTestSuite) TestDeletePolicy() {
	ctx := context.Background()

	// Setup: Add policy
	policy := &types.Policy{
		PolicyID: "delete-test",
		Kind:     types.PolicyKindResource,
		Version:  "1.0",
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.0",
			Rules:    []types.ResourceRule{},
		},
	}

	require.NoError(s.T(), s.store.Add(ctx, policy))

	// Execute: Delete policy
	req, _ := http.NewRequest("DELETE", s.server.URL+"/v1/policies/delete-test", nil)
	client := &http.Client{}
	resp, err := client.Do(req)
	require.NoError(s.T(), err)
	defer resp.Body.Close()

	// Verify
	assert.Equal(s.T(), http.StatusNoContent, resp.StatusCode)

	// Verify it's gone from store
	_, err = s.store.Get(ctx, "delete-test")
	assert.Error(s.T(), err)
}

// Test: POST /v1/policies - Duplicate ID (409)
func (s *PolicyCRUDTestSuite) TestCreateDuplicatePolicy() {
	ctx := context.Background()

	// Setup: Add policy
	policy := &types.Policy{
		PolicyID: "duplicate-test",
		Kind:     types.PolicyKindResource,
		Version:  "1.0",
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.0",
			Rules:    []types.ResourceRule{},
		},
	}

	require.NoError(s.T(), s.store.Add(ctx, policy))

	// Execute: Try to create duplicate
	body, _ := json.Marshal(policy)
	resp, err := http.Post(s.server.URL+"/v1/policies", "application/json", bytes.NewReader(body))
	require.NoError(s.T(), err)
	defer resp.Body.Close()

	// Verify: Should return 409
	assert.Equal(s.T(), http.StatusConflict, resp.StatusCode)
}

// Test: GET /v1/policies/:id - Not found (404)
func (s *PolicyCRUDTestSuite) TestGetNonExistentPolicy() {
	// Execute: Get non-existent policy
	resp, err := http.Get(s.server.URL + "/v1/policies/nonexistent")
	require.NoError(s.T(), err)
	defer resp.Body.Close()

	// Verify: Should return 404
	assert.Equal(s.T(), http.StatusNotFound, resp.StatusCode)
}

// Test: POST /v1/policies - Invalid schema (400)
func (s *PolicyCRUDTestSuite) TestCreateInvalidPolicy() {
	// Execute: Create policy with missing required fields
	invalidPolicy := map[string]interface{}{
		"kind":    "resource",
		"version": "1.0",
		// Missing PolicyID
	}

	body, _ := json.Marshal(invalidPolicy)
	resp, err := http.Post(s.server.URL+"/v1/policies", "application/json", bytes.NewReader(body))
	require.NoError(s.T(), err)
	defer resp.Body.Close()

	// Verify: Should return 400
	assert.Equal(s.T(), http.StatusBadRequest, resp.StatusCode)
}

// TestPolicyCRUDTestSuite runs the test suite
func TestPolicyCRUDTestSuite(t *testing.T) {
	suite.Run(t, new(PolicyCRUDTestSuite))
}
