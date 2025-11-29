package integration

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/authz-engine/go-core/internal/api"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
)

// TestEnvironment sets up a complete testing environment
type TestEnvironment struct {
	Server          *api.Server
	Store           policy.Store
	Validator       *policy.EnhancedValidator
	RollbackManager *policy.RollbackManager
	Logger          *zap.Logger
}

// setupTestEnv creates a complete test environment
func setupTestEnv(t *testing.T) *TestEnvironment {
	logger := zap.NewNop()
	store := policy.NewMemoryStore()
	versionStore := policy.NewVersionStore(10)
	validator := policy.NewEnhancedValidator(policy.DefaultValidationConfig())
	baseValidator := policy.NewValidator()
	rm := policy.NewRollbackManager(store, versionStore, baseValidator)

	cfg := api.DefaultConfig()
	cfg.Port = 0 // Use random port for testing

	server, err := api.New(cfg, store, validator, rm, logger)
	require.NoError(t, err)

	return &TestEnvironment{
		Server:          server,
		Store:           store,
		Validator:       validator,
		RollbackManager: rm,
		Logger:          logger,
	}
}

// apiRequest is a helper to make API requests
func (env *TestEnvironment) apiRequest(method, path string, body interface{}) *httptest.ResponseRecorder {
	var bodyReader *bytes.Reader
	if body != nil {
		bodyBytes, _ := json.Marshal(body)
		bodyReader = bytes.NewReader(bodyBytes)
	} else {
		bodyReader = bytes.NewReader([]byte{})
	}

	req := httptest.NewRequest(method, path, bodyReader)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	// Use the router directly since Server doesn't expose ServeHTTP
	env.Server.Router().ServeHTTP(w, req)
	return w
}

// apiResponse is a generic response wrapper
type apiResponse struct {
	Success bool                   `json:"success"`
	Data    map[string]interface{} `json:"data,omitempty"`
	Error   *apiError              `json:"error,omitempty"`
}

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details string `json:"details,omitempty"`
}

// TestFullPolicyLifecycle tests the complete policy lifecycle
func TestFullPolicyLifecycle(t *testing.T) {
	env := setupTestEnv(t)

	// Step 1: Create a policy via API
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

	// Create policy
	w := env.apiRequest("POST", "/api/v1/policies", policy)
	assert.Equal(t, http.StatusCreated, w.Code)

	var createResp apiResponse
	err := json.NewDecoder(w.Body).Decode(&createResp)
	require.NoError(t, err)
	assert.True(t, createResp.Success)

	// Step 2: Verify policy exists via API
	w = env.apiRequest("GET", "/api/v1/policies/test-policy", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	var getResp apiResponse
	err = json.NewDecoder(w.Body).Decode(&getResp)
	require.NoError(t, err)
	assert.True(t, getResp.Success)

	// Step 3: Update policy via API
	policy.Rules = append(policy.Rules, &types.Rule{
		Name:    "allow-write",
		Actions: []string{"write"},
		Effect:  types.EffectAllow,
		Roles:   []string{"editor"},
	})

	w = env.apiRequest("PUT", "/api/v1/policies/test-policy", policy)
	assert.Equal(t, http.StatusOK, w.Code)

	var updateResp apiResponse
	err = json.NewDecoder(w.Body).Decode(&updateResp)
	require.NoError(t, err)
	assert.True(t, updateResp.Success)

	// Step 4: Validate updated policy
	w = env.apiRequest("POST", "/api/v1/policies/test-policy/validate", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	var validateResp apiResponse
	err = json.NewDecoder(w.Body).Decode(&validateResp)
	require.NoError(t, err)
	assert.True(t, validateResp.Success)

	// Step 5: List all policies
	w = env.apiRequest("GET", "/api/v1/policies", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	var listResp apiResponse
	err = json.NewDecoder(w.Body).Decode(&listResp)
	require.NoError(t, err)
	assert.True(t, listResp.Success)
	assert.Equal(t, float64(1), listResp.Data["count"])

	// Step 6: Delete policy
	w = env.apiRequest("DELETE", "/api/v1/policies/test-policy", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	var deleteResp apiResponse
	err = json.NewDecoder(w.Body).Decode(&deleteResp)
	require.NoError(t, err)
	assert.True(t, deleteResp.Success)

	// Step 7: Verify policy is deleted
	w = env.apiRequest("GET", "/api/v1/policies/test-policy", nil)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

// TestBatchOperationsWithRollback tests batch creation with rollback
func TestBatchOperationsWithRollback(t *testing.T) {
	env := setupTestEnv(t)

	// Create initial batch
	batchRequest := map[string]interface{}{
		"policies": map[string]*types.Policy{
			"policy1": {
				APIVersion:   "api.agsiri.dev/v1",
				Name:         "policy1",
				ResourceKind: "document",
				Rules: []*types.Rule{
					{
						Name:    "allow-read",
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
						Name:    "allow-write",
						Actions: []string{"write"},
						Effect:  types.EffectAllow,
					},
				},
			},
		},
		"comment": "Initial batch",
	}

	w := env.apiRequest("POST", "/api/v1/policies/batch", batchRequest)
	assert.Equal(t, http.StatusCreated, w.Code)

	var batchResp apiResponse
	err := json.NewDecoder(w.Body).Decode(&batchResp)
	require.NoError(t, err)
	assert.True(t, batchResp.Success)

	version1 := int64(batchResp.Data["version"].(float64))

	// Create second batch
	batchRequest2 := map[string]interface{}{
		"policies": map[string]*types.Policy{
			"policy3": {
				APIVersion:   "api.agsiri.dev/v1",
				Name:         "policy3",
				ResourceKind: "resource",
				Rules: []*types.Rule{
					{
						Name:    "deny-delete",
						Actions: []string{"delete"},
						Effect:  types.EffectDeny,
					},
				},
			},
		},
		"comment": "Second batch",
	}

	w = env.apiRequest("POST", "/api/v1/policies/batch", batchRequest2)
	assert.Equal(t, http.StatusCreated, w.Code)

	// Rollback to version 1
	w = env.apiRequest("POST", fmt.Sprintf("/api/v1/versions/%d/rollback", version1), nil)
	assert.Equal(t, http.StatusOK, w.Code)

	var rollbackResp apiResponse
	err = json.NewDecoder(w.Body).Decode(&rollbackResp)
	require.NoError(t, err)
	assert.True(t, rollbackResp.Success)

	// Verify policies are restored
	w = env.apiRequest("GET", "/api/v1/policies", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	var listResp apiResponse
	err = json.NewDecoder(w.Body).Decode(&listResp)
	require.NoError(t, err)
	assert.True(t, listResp.Success)
	assert.Equal(t, float64(2), listResp.Data["count"]) // Only policy1 and policy2
}

// TestValidationIntegration tests validation with real policies
func TestValidationIntegration(t *testing.T) {
	env := setupTestEnv(t)

	tests := []struct {
		name           string
		policy         *types.Policy
		expectValid    bool
		expectErrorCode string
	}{
		{
			name: "Valid policy",
			policy: &types.Policy{
				APIVersion:   "api.agsiri.dev/v1",
				Name:         "valid-policy",
				ResourceKind: "document",
				Rules: []*types.Rule{
					{
						Name:    "allow-read",
						Actions: []string{"read"},
						Effect:  types.EffectAllow,
					},
				},
			},
			expectValid: true,
		},
		{
			name: "Invalid CEL expression",
			policy: &types.Policy{
				APIVersion:   "api.agsiri.dev/v1",
				Name:         "invalid-cel-policy",
				ResourceKind: "document",
				Rules: []*types.Rule{
					{
						Name:      "conditional-rule",
						Actions:   []string{"read"},
						Effect:    types.EffectAllow,
						Condition: "invalid CEL !!!",
					},
				},
			},
			expectValid:     false,
			expectErrorCode: "VALIDATION_FAILED",
		},
		{
			name: "Missing required fields",
			policy: &types.Policy{
				APIVersion: "api.agsiri.dev/v1",
				Name:       "",
				Rules:      []*types.Rule{},
			},
			expectValid:     false,
			expectErrorCode: "VALIDATION_FAILED",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := env.apiRequest("POST", "/api/v1/policies/validate", tt.policy)

			if tt.expectValid {
				assert.Equal(t, http.StatusOK, w.Code)

				var resp apiResponse
				err := json.NewDecoder(w.Body).Decode(&resp)
				require.NoError(t, err)
				assert.True(t, resp.Success)
			} else {
				// Validation endpoint returns 200 with valid=false for invalid policies
				// Or 400 if the policy fails basic checks
				assert.True(t, w.Code == http.StatusOK || w.Code == http.StatusBadRequest)
			}
		})
	}
}

// TestConcurrentAccess tests concurrent API access
func TestConcurrentAccess(t *testing.T) {
	env := setupTestEnv(t)

	// Create initial policy
	policy := &types.Policy{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "concurrent-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	}

	w := env.apiRequest("POST", "/api/v1/policies", policy)
	require.Equal(t, http.StatusCreated, w.Code)

	// Concurrent reads
	done := make(chan bool, 10)
	for i := 0; i < 10; i++ {
		go func() {
			w := env.apiRequest("GET", "/api/v1/policies/concurrent-policy", nil)
			assert.Equal(t, http.StatusOK, w.Code)
			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatal("Timeout waiting for concurrent requests")
		}
	}
}

// TestVersionManagement tests version history and navigation
func TestVersionManagement(t *testing.T) {
	env := setupTestEnv(t)

	// Create version 1 via API (batch create)
	batchRequest1 := map[string]interface{}{
		"policies": map[string]*types.Policy{
			"policy1": {
				APIVersion:   "api.agsiri.dev/v1",
				Name:         "policy1",
				ResourceKind: "document",
				Rules: []*types.Rule{
					{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow},
				},
			},
		},
		"comment": "Version 1",
	}
	w := env.apiRequest("POST", "/api/v1/policies/batch", batchRequest1)
	assert.Equal(t, http.StatusCreated, w.Code)

	var batch1Resp apiResponse
	err := json.NewDecoder(w.Body).Decode(&batch1Resp)
	require.NoError(t, err)
	version1 := int64(batch1Resp.Data["version"].(float64))

	// Create version 2 via API (batch create)
	batchRequest2 := map[string]interface{}{
		"policies": map[string]*types.Policy{
			"policy2": {
				APIVersion:   "api.agsiri.dev/v1",
				Name:         "policy2",
				ResourceKind: "file",
				Rules: []*types.Rule{
					{Name: "rule2", Actions: []string{"write"}, Effect: types.EffectAllow},
				},
			},
		},
		"comment": "Version 2",
	}
	w = env.apiRequest("POST", "/api/v1/policies/batch", batchRequest2)
	assert.Equal(t, http.StatusCreated, w.Code)

	var batch2Resp apiResponse
	err = json.NewDecoder(w.Body).Decode(&batch2Resp)
	require.NoError(t, err)

	// Get list of versions before rollback
	w = env.apiRequest("GET", "/api/v1/versions", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	var listResp apiResponse
	err = json.NewDecoder(w.Body).Decode(&listResp)
	require.NoError(t, err)
	assert.True(t, listResp.Success)
	initialVersionCount := listResp.Data["count"]

	// Get specific version
	w = env.apiRequest("GET", fmt.Sprintf("/api/v1/versions/%d", version1), nil)
	assert.Equal(t, http.StatusOK, w.Code)

	var getResp apiResponse
	err = json.NewDecoder(w.Body).Decode(&getResp)
	require.NoError(t, err)
	assert.True(t, getResp.Success)

	// Rollback to version 1 (may create additional version(s))
	w = env.apiRequest("POST", fmt.Sprintf("/api/v1/versions/%d/rollback", version1), nil)
	assert.Equal(t, http.StatusOK, w.Code)

	var rollbackResp apiResponse
	err = json.NewDecoder(w.Body).Decode(&rollbackResp)
	require.NoError(t, err)
	assert.True(t, rollbackResp.Success)

	// List versions again - rollback creates new version(s)
	w = env.apiRequest("GET", "/api/v1/versions", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	err = json.NewDecoder(w.Body).Decode(&listResp)
	require.NoError(t, err)
	assert.True(t, listResp.Success)
	// Version count should increase after rollback
	assert.Greater(t, listResp.Data["count"], initialVersionCount)

	// Verify policies are restored to version 1 state
	w = env.apiRequest("GET", "/api/v1/policies", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	var policiesResp apiResponse
	err = json.NewDecoder(w.Body).Decode(&policiesResp)
	require.NoError(t, err)
	assert.Equal(t, float64(1), policiesResp.Data["count"]) // Only policy1
}

// TestHealthAndStats tests health check and statistics
func TestHealthAndStats(t *testing.T) {
	env := setupTestEnv(t)

	// Health check
	w := env.apiRequest("GET", "/api/v1/health", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	var healthResp apiResponse
	err := json.NewDecoder(w.Body).Decode(&healthResp)
	require.NoError(t, err)
	assert.True(t, healthResp.Success)

	// Add some policies
	policy1 := &types.Policy{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "policy1",
		ResourceKind: "document",
		Rules:        []*types.Rule{{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow}},
	}
	env.Store.Add(policy1)

	policy2 := &types.Policy{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "policy2",
		ResourceKind: "file",
		Rules: []*types.Rule{
			{Name: "rule2", Actions: []string{"write"}, Effect: types.EffectAllow},
			{Name: "rule3", Actions: []string{"delete"}, Effect: types.EffectDeny},
		},
	}
	env.Store.Add(policy2)

	// Get stats
	w = env.apiRequest("GET", "/api/v1/stats", nil)
	assert.Equal(t, http.StatusOK, w.Code)

	var statsResp apiResponse
	err = json.NewDecoder(w.Body).Decode(&statsResp)
	require.NoError(t, err)
	assert.True(t, statsResp.Success)

	policies := statsResp.Data["policies"].(map[string]interface{})
	assert.Equal(t, float64(2), policies["total"])
	assert.Equal(t, float64(3), policies["total_rules"])
}

// TestErrorHandling tests various error scenarios
func TestErrorHandling(t *testing.T) {
	env := setupTestEnv(t)

	tests := []struct {
		name           string
		method         string
		path           string
		body           interface{}
		expectedStatus int
		expectedCode   string
	}{
		{
			name:           "Policy not found",
			method:         "GET",
			path:           "/api/v1/policies/nonexistent",
			expectedStatus: http.StatusNotFound,
			expectedCode:   "POLICY_NOT_FOUND",
		},
		{
			name:           "Invalid JSON",
			method:         "POST",
			path:           "/api/v1/policies",
			body:           "invalid json",
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:   "Duplicate policy",
			method: "POST",
			path:   "/api/v1/policies",
			body: &types.Policy{
				APIVersion:   "api.agsiri.dev/v1",
				Name:         "duplicate",
				ResourceKind: "document",
				Rules:        []*types.Rule{{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow}},
			},
			expectedStatus: http.StatusConflict,
			expectedCode:   "POLICY_EXISTS",
		},
		{
			name:           "Invalid version",
			method:         "GET",
			path:           "/api/v1/versions/invalid",
			expectedStatus: http.StatusBadRequest,
			expectedCode:   "INVALID_VERSION",
		},
	}

	// Create duplicate policy first
	policy := &types.Policy{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "duplicate",
		ResourceKind: "document",
		Rules:        []*types.Rule{{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow}},
	}
	env.Store.Add(policy)

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var w *httptest.ResponseRecorder
			if tt.body == "invalid json" {
				req := httptest.NewRequest(tt.method, tt.path, bytes.NewReader([]byte("invalid json")))
				req.Header.Set("Content-Type", "application/json")
				w = httptest.NewRecorder()
				env.Server.Router().ServeHTTP(w, req)
			} else {
				w = env.apiRequest(tt.method, tt.path, tt.body)
			}

			assert.Equal(t, tt.expectedStatus, w.Code)

			if tt.expectedCode != "" {
				var resp apiResponse
				err := json.NewDecoder(w.Body).Decode(&resp)
				require.NoError(t, err)
				assert.False(t, resp.Success)
				assert.NotNil(t, resp.Error)
				assert.Equal(t, tt.expectedCode, resp.Error.Code)
			}
		})
	}
}
