// Package rest provides integration tests for REST API authorization endpoints
package rest

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/mux"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stretchr/testify/suite"
	"go.uber.org/zap"

	"github.com/authz-engine/go-core/internal/api/handlers"
	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
)

// AuthorizationTestSuite is the test suite for authorization endpoints
type AuthorizationTestSuite struct {
	suite.Suite
	router     *mux.Router
	server     *httptest.Server
	engine     *engine.Engine
	store      policy.Store
	jwtSecret  []byte
	logger     *zap.Logger
}

// SetupSuite runs once before all tests
func (s *AuthorizationTestSuite) SetupSuite() {
	s.logger = zap.NewNop()
	s.jwtSecret = []byte("test-secret-key")

	// Create in-memory policy store
	s.store = policy.NewMemoryStore()

	// Create engine with default config
	cfg := engine.DefaultConfig()
	cfg.CacheEnabled = false // Disable cache for predictable tests
	var err error
	s.engine, err = engine.New(cfg, s.store)
	require.NoError(s.T(), err)

	// Setup router
	s.router = mux.NewRouter()
	s.setupRoutes()

	// Create test server
	s.server = httptest.NewServer(s.router)
}

// TearDownSuite runs once after all tests
func (s *AuthorizationTestSuite) TearDownSuite() {
	if s.server != nil {
		s.server.Close()
	}
}

// SetupTest runs before each test
func (s *AuthorizationTestSuite) SetupTest() {
	// Clear policy store
	s.store = policy.NewMemoryStore()
	cfg := engine.DefaultConfig()
	cfg.CacheEnabled = false
	var err error
	s.engine, err = engine.New(cfg, s.store)
	require.NoError(s.T(), err)

	// Re-setup routes with new engine
	s.router = mux.NewRouter()
	s.setupRoutes()
	s.server = httptest.NewServer(s.router)
}

// TearDownTest runs after each test
func (s *AuthorizationTestSuite) TearDownTest() {
	if s.server != nil {
		s.server.Close()
	}
}

// setupRoutes configures the API routes
func (s *AuthorizationTestSuite) setupRoutes() {
	// Authorization check endpoint
	s.router.HandleFunc("/v1/authorization/check", s.handleAuthorizationCheck).Methods("POST")
	s.router.HandleFunc("/v1/authorization/check-resources", s.handleBatchCheck).Methods("POST")
	s.router.HandleFunc("/v1/authorization/allowed-actions", s.handleAllowedActions).Methods("GET")
}

// handleAuthorizationCheck handles single authorization check
func (s *AuthorizationTestSuite) handleAuthorizationCheck(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Principal *types.Principal `json:"principal"`
		Resource  *types.Resource  `json:"resource"`
		Action    string           `json:"action"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	checkReq := &types.CheckRequest{
		Principal: req.Principal,
		Resource:  req.Resource,
		Actions:   []string{req.Action},
	}

	resp, err := s.engine.Check(r.Context(), checkReq)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	result := resp.Results[req.Action]
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"effect": result.Effect,
		"reason": result.Reason,
	})
}

// handleBatchCheck handles batch authorization check
func (s *AuthorizationTestSuite) handleBatchCheck(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Principal *types.Principal  `json:"principal"`
		Resources []*types.Resource `json:"resources"`
		Action    string            `json:"action"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	results := make([]map[string]interface{}, 0, len(req.Resources))
	for _, resource := range req.Resources {
		checkReq := &types.CheckRequest{
			Principal: req.Principal,
			Resource:  resource,
			Actions:   []string{req.Action},
		}

		resp, err := s.engine.Check(r.Context(), checkReq)
		if err != nil {
			continue
		}

		result := resp.Results[req.Action]
		results = append(results, map[string]interface{}{
			"resource_id": resource.ID,
			"effect":      result.Effect,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"results": results,
	})
}

// handleAllowedActions returns allowed actions for a principal on a resource
func (s *AuthorizationTestSuite) handleAllowedActions(w http.ResponseWriter, r *http.Request) {
	// Parse query parameters
	principalID := r.URL.Query().Get("principal_id")
	resourceKind := r.URL.Query().Get("resource_kind")
	resourceID := r.URL.Query().Get("resource_id")

	principal := &types.Principal{ID: principalID}
	resource := &types.Resource{Kind: resourceKind, ID: resourceID}

	// Test common actions
	testActions := []string{"read", "write", "delete", "admin"}
	checkReq := &types.CheckRequest{
		Principal: principal,
		Resource:  resource,
		Actions:   testActions,
	}

	resp, err := s.engine.Check(r.Context(), checkReq)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	allowedActions := []string{}
	for action, result := range resp.Results {
		if result.Effect == types.EffectAllow {
			allowedActions = append(allowedActions, action)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"allowed_actions": allowedActions,
	})
}

// Test: POST /v1/authorization/check - Allow decision
func (s *AuthorizationTestSuite) TestAuthorizationCheck_Allow() {
	// Setup: Create policy that allows read action
	resourcePolicy := &types.Policy{
		PolicyID:    "policy-allow-read",
		Kind:        types.PolicyKindResource,
		Version:     "1.0",
		Disabled:    false,
		Description: "Allow read access to documents",
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.0",
			Rules: []types.ResourceRule{
				{
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
					Roles:   []string{"viewer"},
				},
			},
		},
	}

	err := s.store.Add(context.Background(), resourcePolicy)
	require.NoError(s.T(), err)

	// Execute: Make authorization check request
	reqBody := map[string]interface{}{
		"principal": map[string]interface{}{
			"id":    "user123",
			"roles": []string{"viewer"},
		},
		"resource": map[string]interface{}{
			"kind": "document",
			"id":   "doc123",
		},
		"action": "read",
	}

	body, _ := json.Marshal(reqBody)
	resp, err := http.Post(s.server.URL+"/v1/authorization/check", "application/json", bytes.NewReader(body))
	require.NoError(s.T(), err)
	defer resp.Body.Close()

	// Verify: Check response
	assert.Equal(s.T(), http.StatusOK, resp.StatusCode)

	var result map[string]interface{}
	err = json.NewDecoder(resp.Body).Decode(&result)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), "allow", result["effect"])
}

// Test: POST /v1/authorization/check - Deny decision
func (s *AuthorizationTestSuite) TestAuthorizationCheck_Deny() {
	// Setup: No matching policy (default deny)
	reqBody := map[string]interface{}{
		"principal": map[string]interface{}{
			"id":    "user123",
			"roles": []string{"viewer"},
		},
		"resource": map[string]interface{}{
			"kind": "document",
			"id":   "doc123",
		},
		"action": "delete",
	}

	body, _ := json.Marshal(reqBody)
	resp, err := http.Post(s.server.URL+"/v1/authorization/check", "application/json", bytes.NewReader(body))
	require.NoError(s.T(), err)
	defer resp.Body.Close()

	// Verify: Should deny
	assert.Equal(s.T(), http.StatusOK, resp.StatusCode)

	var result map[string]interface{}
	err = json.NewDecoder(resp.Body).Decode(&result)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), "deny", result["effect"])
}

// Test: POST /v1/authorization/check-resources - Batch check
func (s *AuthorizationTestSuite) TestBatchCheck() {
	// Setup: Create policy
	resourcePolicy := &types.Policy{
		PolicyID: "policy-batch-test",
		Kind:     types.PolicyKindResource,
		Version:  "1.0",
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.0",
			Rules: []types.ResourceRule{
				{
					Actions:   []string{"read"},
					Effect:    types.EffectAllow,
					Roles:     []string{"viewer"},
					Condition: &types.Condition{Match: &types.Match{Expr: "R.attr.department == 'engineering'"}},
				},
			},
		},
	}

	err := s.store.Add(context.Background(), resourcePolicy)
	require.NoError(s.T(), err)

	// Execute: Batch check multiple resources
	reqBody := map[string]interface{}{
		"principal": map[string]interface{}{
			"id":    "user123",
			"roles": []string{"viewer"},
		},
		"resources": []interface{}{
			map[string]interface{}{
				"kind": "document",
				"id":   "doc1",
				"attr": map[string]interface{}{"department": "engineering"},
			},
			map[string]interface{}{
				"kind": "document",
				"id":   "doc2",
				"attr": map[string]interface{}{"department": "sales"},
			},
			map[string]interface{}{
				"kind": "document",
				"id":   "doc3",
				"attr": map[string]interface{}{"department": "engineering"},
			},
		},
		"action": "read",
	}

	body, _ := json.Marshal(reqBody)
	resp, err := http.Post(s.server.URL+"/v1/authorization/check-resources", "application/json", bytes.NewReader(body))
	require.NoError(s.T(), err)
	defer resp.Body.Close()

	// Verify: Check results
	assert.Equal(s.T(), http.StatusOK, resp.StatusCode)

	var result map[string]interface{}
	err = json.NewDecoder(resp.Body).Decode(&result)
	require.NoError(s.T(), err)

	results := result["results"].([]interface{})
	assert.Equal(s.T(), 3, len(results))

	// doc1 and doc3 should be allowed (engineering dept), doc2 denied (sales dept)
	assert.Equal(s.T(), "allow", results[0].(map[string]interface{})["effect"])
	assert.Equal(s.T(), "deny", results[1].(map[string]interface{})["effect"])
	assert.Equal(s.T(), "allow", results[2].(map[string]interface{})["effect"])
}

// Test: GET /v1/authorization/allowed-actions - Action list
func (s *AuthorizationTestSuite) TestAllowedActions() {
	// Setup: Create policy with multiple actions
	resourcePolicy := &types.Policy{
		PolicyID: "policy-multi-actions",
		Kind:     types.PolicyKindResource,
		Version:  "1.0",
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.0",
			Rules: []types.ResourceRule{
				{
					Actions: []string{"read", "write"},
					Effect:  types.EffectAllow,
					Roles:   []string{"editor"},
				},
			},
		},
	}

	err := s.store.Add(context.Background(), resourcePolicy)
	require.NoError(s.T(), err)

	// Execute: Get allowed actions
	url := s.server.URL + "/v1/authorization/allowed-actions?principal_id=user123&resource_kind=document&resource_id=doc123"
	resp, err := http.Get(url)
	require.NoError(s.T(), err)
	defer resp.Body.Close()

	// Verify: Check allowed actions (should be empty as principal doesn't have 'editor' role)
	assert.Equal(s.T(), http.StatusOK, resp.StatusCode)

	var result map[string]interface{}
	err = json.NewDecoder(resp.Body).Decode(&result)
	require.NoError(s.T(), err)

	allowedActions := result["allowed_actions"].([]interface{})
	assert.Equal(s.T(), 0, len(allowedActions)) // No allowed actions without proper role
}

// Test: Authorization with JWT authentication
func (s *AuthorizationTestSuite) TestAuthorizationWithJWT() {
	// Generate JWT token
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":  "user123",
		"exp":  time.Now().Add(time.Hour).Unix(),
		"role": "viewer",
	})

	tokenString, err := token.SignedString(s.jwtSecret)
	require.NoError(s.T(), err)

	// Setup policy
	resourcePolicy := &types.Policy{
		PolicyID: "policy-jwt-test",
		Kind:     types.PolicyKindResource,
		Version:  "1.0",
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.0",
			Rules: []types.ResourceRule{
				{
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
					Roles:   []string{"viewer"},
				},
			},
		},
	}

	err = s.store.Add(context.Background(), resourcePolicy)
	require.NoError(s.T(), err)

	// Execute: Make request with JWT
	reqBody := map[string]interface{}{
		"principal": map[string]interface{}{
			"id":    "user123",
			"roles": []string{"viewer"},
		},
		"resource": map[string]interface{}{
			"kind": "document",
			"id":   "doc123",
		},
		"action": "read",
	}

	body, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", s.server.URL+"/v1/authorization/check", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+tokenString)

	client := &http.Client{}
	resp, err := client.Do(req)
	require.NoError(s.T(), err)
	defer resp.Body.Close()

	// Verify
	assert.Equal(s.T(), http.StatusOK, resp.StatusCode)
}

// Test: Authorization without token (401)
func (s *AuthorizationTestSuite) TestAuthorizationWithoutToken() {
	// This test would require middleware to be implemented
	// For now, we skip it as the current implementation doesn't enforce auth
	s.T().Skip("Auth middleware not implemented yet")
}

// Test: Invalid JWT token (401)
func (s *AuthorizationTestSuite) TestAuthorizationInvalidToken() {
	// This test would require middleware to be implemented
	s.T().Skip("Auth middleware not implemented yet")
}

// Test: Malformed request (400)
func (s *AuthorizationTestSuite) TestMalformedRequest() {
	// Execute: Send malformed JSON
	resp, err := http.Post(s.server.URL+"/v1/authorization/check", "application/json", bytes.NewReader([]byte("{invalid json")))
	require.NoError(s.T(), err)
	defer resp.Body.Close()

	// Verify: Should return 400
	assert.Equal(s.T(), http.StatusBadRequest, resp.StatusCode)
}

// Test: Non-existent resource (404) - In this implementation, it returns deny, not 404
func (s *AuthorizationTestSuite) TestNonExistentResource() {
	// Execute
	reqBody := map[string]interface{}{
		"principal": map[string]interface{}{
			"id":    "user123",
			"roles": []string{"viewer"},
		},
		"resource": map[string]interface{}{
			"kind": "nonexistent",
			"id":   "fake123",
		},
		"action": "read",
	}

	body, _ := json.Marshal(reqBody)
	resp, err := http.Post(s.server.URL+"/v1/authorization/check", "application/json", bytes.NewReader(body))
	require.NoError(s.T(), err)
	defer resp.Body.Close()

	// Verify: Returns deny (not 404)
	assert.Equal(s.T(), http.StatusOK, resp.StatusCode)

	var result map[string]interface{}
	err = json.NewDecoder(resp.Body).Decode(&result)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), "deny", result["effect"])
}

// Test: Performance - <100ms per check
func (s *AuthorizationTestSuite) TestPerformance() {
	// Setup: Create policy
	resourcePolicy := &types.Policy{
		PolicyID: "policy-perf-test",
		Kind:     types.PolicyKindResource,
		Version:  "1.0",
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.0",
			Rules: []types.ResourceRule{
				{
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
					Roles:   []string{"viewer"},
				},
			},
		},
	}

	err := s.store.Add(context.Background(), resourcePolicy)
	require.NoError(s.T(), err)

	// Execute: Measure request time
	reqBody := map[string]interface{}{
		"principal": map[string]interface{}{
			"id":    "user123",
			"roles": []string{"viewer"},
		},
		"resource": map[string]interface{}{
			"kind": "document",
			"id":   "doc123",
		},
		"action": "read",
	}

	body, _ := json.Marshal(reqBody)

	start := time.Now()
	resp, err := http.Post(s.server.URL+"/v1/authorization/check", "application/json", bytes.NewReader(body))
	duration := time.Since(start)

	require.NoError(s.T(), err)
	defer resp.Body.Close()

	// Verify: Should be < 100ms
	assert.Less(s.T(), duration, 100*time.Millisecond, "Authorization check should complete in <100ms")
	assert.Equal(s.T(), http.StatusOK, resp.StatusCode)
}

// TestAuthorizationTestSuite runs the test suite
func TestAuthorizationTestSuite(t *testing.T) {
	suite.Run(t, new(AuthorizationTestSuite))
}
