// Package rest provides error handling integration tests
package rest

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stretchr/testify/suite"
	"go.uber.org/zap"

	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
)

// ErrorHandlingTestSuite tests error scenarios
type ErrorHandlingTestSuite struct {
	suite.Suite
	router *mux.Router
	server *httptest.Server
	engine *engine.Engine
	store  policy.Store
	logger *zap.Logger
}

// SetupTest runs before each test
func (s *ErrorHandlingTestSuite) SetupTest() {
	s.logger = zap.NewNop()
	s.store = policy.NewMemoryStore()

	cfg := engine.DefaultConfig()
	var err error
	s.engine, err = engine.New(cfg, s.store)
	require.NoError(s.T(), err)

	s.router = mux.NewRouter()
	s.setupRoutes()
	s.server = httptest.NewServer(s.router)
}

// TearDownTest runs after each test
func (s *ErrorHandlingTestSuite) TearDownTest() {
	if s.server != nil {
		s.server.Close()
	}
}

// setupRoutes configures API routes
func (s *ErrorHandlingTestSuite) setupRoutes() {
	s.router.HandleFunc("/v1/authorization/check", s.handleAuthCheck).Methods("POST")
	s.router.HandleFunc("/v1/policies", s.handleCreatePolicy).Methods("POST")
	s.router.HandleFunc("/v1/policies/{id}", s.handleGetPolicy).Methods("GET")
	s.router.HandleFunc("/v1/policies/{id}", s.handleDeletePolicy).Methods("DELETE")
}

// Handler implementations with proper error handling
func (s *ErrorHandlingTestSuite) handleAuthCheck(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Principal *types.Principal `json:"principal"`
		Resource  *types.Resource  `json:"resource"`
		Action    string           `json:"action"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.respondError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid JSON", err.Error())
		return
	}

	// Validate required fields
	if req.Principal == nil {
		s.respondError(w, http.StatusBadRequest, "MISSING_PRINCIPAL", "Principal is required", "")
		return
	}
	if req.Resource == nil {
		s.respondError(w, http.StatusBadRequest, "MISSING_RESOURCE", "Resource is required", "")
		return
	}
	if req.Action == "" {
		s.respondError(w, http.StatusBadRequest, "MISSING_ACTION", "Action is required", "")
		return
	}

	checkReq := &types.CheckRequest{
		Principal: req.Principal,
		Resource:  req.Resource,
		Actions:   []string{req.Action},
	}

	resp, err := s.engine.Check(r.Context(), checkReq)
	if err != nil {
		s.respondError(w, http.StatusInternalServerError, "ENGINE_ERROR", "Authorization check failed", err.Error())
		return
	}

	result := resp.Results[req.Action]
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"effect": result.Effect,
	})
}

func (s *ErrorHandlingTestSuite) handleCreatePolicy(w http.ResponseWriter, r *http.Request) {
	var policy types.Policy

	if err := json.NewDecoder(r.Body).Decode(&policy); err != nil {
		s.respondError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid JSON", err.Error())
		return
	}

	// Validate required fields
	if policy.PolicyID == "" {
		s.respondError(w, http.StatusBadRequest, "MISSING_POLICY_ID", "Policy ID is required", "")
		return
	}

	// Check for duplicates
	existing, _ := s.store.Get(r.Context(), policy.PolicyID)
	if existing != nil {
		s.respondError(w, http.StatusConflict, "DUPLICATE_POLICY", "Policy already exists", "")
		return
	}

	if err := s.store.Add(r.Context(), &policy); err != nil {
		s.respondError(w, http.StatusInternalServerError, "STORE_ERROR", "Failed to store policy", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(policy)
}

func (s *ErrorHandlingTestSuite) handleGetPolicy(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	policyID := vars["id"]

	policy, err := s.store.Get(r.Context(), policyID)
	if err != nil {
		s.respondError(w, http.StatusNotFound, "POLICY_NOT_FOUND", "Policy not found", policyID)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(policy)
}

func (s *ErrorHandlingTestSuite) handleDeletePolicy(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	policyID := vars["id"]

	// Check if exists
	_, err := s.store.Get(r.Context(), policyID)
	if err != nil {
		s.respondError(w, http.StatusNotFound, "POLICY_NOT_FOUND", "Policy not found", policyID)
		return
	}

	if err := s.store.Delete(r.Context(), policyID); err != nil {
		s.respondError(w, http.StatusInternalServerError, "DELETE_ERROR", "Failed to delete policy", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// respondError writes an error response
func (s *ErrorHandlingTestSuite) respondError(w http.ResponseWriter, statusCode int, code, message, details string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)

	response := map[string]interface{}{
		"success": false,
		"error": map[string]interface{}{
			"code":    code,
			"message": message,
			"details": details,
		},
	}

	json.NewEncoder(w).Encode(response)
}

// Test: Invalid JSON (400)
func (s *ErrorHandlingTestSuite) TestInvalidJSON() {
	// Execute: Send malformed JSON
	resp, err := http.Post(
		s.server.URL+"/v1/authorization/check",
		"application/json",
		bytes.NewReader([]byte("{invalid json}")),
	)
	require.NoError(s.T(), err)
	defer resp.Body.Close()

	// Verify: 400 Bad Request
	assert.Equal(s.T(), http.StatusBadRequest, resp.StatusCode)

	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	assert.False(s.T(), result["success"].(bool))
	assert.Equal(s.T(), "INVALID_JSON", result["error"].(map[string]interface{})["code"])
}

// Test: Missing required fields (400)
func (s *ErrorHandlingTestSuite) TestMissingRequiredFields() {
	// Test 1: Missing principal
	reqBody := map[string]interface{}{
		"resource": map[string]interface{}{"kind": "document", "id": "doc123"},
		"action":   "read",
	}

	body, _ := json.Marshal(reqBody)
	resp, err := http.Post(s.server.URL+"/v1/authorization/check", "application/json", bytes.NewReader(body))
	require.NoError(s.T(), err)
	defer resp.Body.Close()

	assert.Equal(s.T(), http.StatusBadRequest, resp.StatusCode)

	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	assert.Equal(s.T(), "MISSING_PRINCIPAL", result["error"].(map[string]interface{})["code"])

	// Test 2: Missing resource
	reqBody2 := map[string]interface{}{
		"principal": map[string]interface{}{"id": "user123"},
		"action":    "read",
	}

	body2, _ := json.Marshal(reqBody2)
	resp2, err := http.Post(s.server.URL+"/v1/authorization/check", "application/json", bytes.NewReader(body2))
	require.NoError(s.T(), err)
	defer resp2.Body.Close()

	assert.Equal(s.T(), http.StatusBadRequest, resp2.StatusCode)

	// Test 3: Missing action
	reqBody3 := map[string]interface{}{
		"principal": map[string]interface{}{"id": "user123"},
		"resource":  map[string]interface{}{"kind": "document", "id": "doc123"},
	}

	body3, _ := json.Marshal(reqBody3)
	resp3, err := http.Post(s.server.URL+"/v1/authorization/check", "application/json", bytes.NewReader(body3))
	require.NoError(s.T(), err)
	defer resp3.Body.Close()

	assert.Equal(s.T(), http.StatusBadRequest, resp3.StatusCode)
}

// Test: Invalid JWT (401) - Skipped as auth middleware not implemented
func (s *ErrorHandlingTestSuite) TestInvalidJWT() {
	s.T().Skip("Auth middleware not implemented yet")
}

// Test: Expired JWT (401) - Skipped as auth middleware not implemented
func (s *ErrorHandlingTestSuite) TestExpiredJWT() {
	s.T().Skip("Auth middleware not implemented yet")
}

// Test: Insufficient permissions (403) - Skipped as auth middleware not implemented
func (s *ErrorHandlingTestSuite) TestInsufficientPermissions() {
	s.T().Skip("Auth middleware not implemented yet")
}

// Test: Resource not found (404)
func (s *ErrorHandlingTestSuite) TestResourceNotFound() {
	// Execute: Try to get non-existent policy
	resp, err := http.Get(s.server.URL + "/v1/policies/nonexistent")
	require.NoError(s.T(), err)
	defer resp.Body.Close()

	// Verify: 404 Not Found
	assert.Equal(s.T(), http.StatusNotFound, resp.StatusCode)

	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	assert.False(s.T(), result["success"].(bool))
	assert.Equal(s.T(), "POLICY_NOT_FOUND", result["error"].(map[string]interface{})["code"])
}

// Test: Duplicate resource (409)
func (s *ErrorHandlingTestSuite) TestDuplicateResource() {
	ctx := context.Background()

	// Setup: Create policy
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

	// Verify: 409 Conflict
	assert.Equal(s.T(), http.StatusConflict, resp.StatusCode)

	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	assert.False(s.T(), result["success"].(bool))
	assert.Equal(s.T(), "DUPLICATE_POLICY", result["error"].(map[string]interface{})["code"])
}

// Test: Internal server error (500)
func (s *ErrorHandlingTestSuite) TestInternalServerError() {
	// This would require mocking the store to return an error
	// For now, we verify error response structure
	s.T().Skip("Requires mock store implementation")
}

// Test: Database connection failure
func (s *ErrorHandlingTestSuite) TestDatabaseConnectionFailure() {
	// This would require a database-backed store
	s.T().Skip("Requires database store implementation")
}

// Test: Redis connection failure
func (s *ErrorHandlingTestSuite) TestRedisConnectionFailure() {
	// This would require a Redis-backed cache
	s.T().Skip("Requires Redis cache implementation")
}

// Test: Error response format consistency
func (s *ErrorHandlingTestSuite) TestErrorResponseFormat() {
	// Execute: Trigger various errors
	testCases := []struct {
		name           string
		url            string
		method         string
		body           string
		expectedStatus int
		expectedCode   string
	}{
		{
			name:           "Invalid JSON",
			url:            "/v1/authorization/check",
			method:         "POST",
			body:           "{invalid}",
			expectedStatus: http.StatusBadRequest,
			expectedCode:   "INVALID_JSON",
		},
		{
			name:           "Not Found",
			url:            "/v1/policies/nonexistent",
			method:         "GET",
			body:           "",
			expectedStatus: http.StatusNotFound,
			expectedCode:   "POLICY_NOT_FOUND",
		},
	}

	for _, tc := range testCases {
		s.T().Run(tc.name, func(t *testing.T) {
			var resp *http.Response
			var err error

			switch tc.method {
			case "GET":
				resp, err = http.Get(s.server.URL + tc.url)
			case "POST":
				resp, err = http.Post(s.server.URL+tc.url, "application/json", bytes.NewReader([]byte(tc.body)))
			}

			require.NoError(t, err)
			defer resp.Body.Close()

			assert.Equal(t, tc.expectedStatus, resp.StatusCode)

			var result map[string]interface{}
			json.NewDecoder(resp.Body).Decode(&result)

			// Verify consistent error format
			assert.False(t, result["success"].(bool))
			assert.NotNil(t, result["error"])

			errorObj := result["error"].(map[string]interface{})
			assert.Equal(t, tc.expectedCode, errorObj["code"])
			assert.NotEmpty(t, errorObj["message"])
		})
	}
}

// Test: Error logging
func (s *ErrorHandlingTestSuite) TestErrorLogging() {
	// In production, errors should be logged
	// This test verifies the error handling pathway works
	// Actual logging verification would require a test logger

	// Execute: Trigger error
	resp, err := http.Post(
		s.server.URL+"/v1/authorization/check",
		"application/json",
		bytes.NewReader([]byte("{invalid}")),
	)
	require.NoError(s.T(), err)
	defer resp.Body.Close()

	// Verify: Error handled gracefully
	assert.Equal(s.T(), http.StatusBadRequest, resp.StatusCode)

	// In a real test, we would verify logger was called
	// e.g., assert.Equal(t, 1, testLogger.ErrorCallCount())
}

// Test: Validation error details
func (s *ErrorHandlingTestSuite) TestValidationErrorDetails() {
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

	// Verify: Error includes validation details
	assert.Equal(s.T(), http.StatusBadRequest, resp.StatusCode)

	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)

	errorObj := result["error"].(map[string]interface{})
	assert.Equal(s.T(), "MISSING_POLICY_ID", errorObj["code"])
	assert.Contains(s.T(), errorObj["message"], "required")
}

// TestErrorHandlingTestSuite runs the test suite
func TestErrorHandlingTestSuite(t *testing.T) {
	suite.Run(t, new(ErrorHandlingTestSuite))
}
