package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
)

func setupTestServer(t *testing.T) *Server {
	logger := zap.NewNop()
	store := policy.NewMemoryStore()
	versionStore := policy.NewVersionStore(10)
	validator := policy.NewEnhancedValidator(policy.DefaultValidationConfig())
	rm := policy.NewRollbackManager(store, versionStore, policy.NewValidator())

	server, err := New(DefaultConfig(), store, validator, rm, logger)
	require.NoError(t, err)
	require.NotNil(t, server)

	return server
}

func TestNew(t *testing.T) {
	server := setupTestServer(t)
	assert.NotNil(t, server.router)
	assert.NotNil(t, server.httpServer)
}

func TestHealthCheck(t *testing.T) {
	server := setupTestServer(t)

	req := httptest.NewRequest("GET", "/api/v1/health", nil)
	w := httptest.NewRecorder()

	server.router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response apiResponse
	err := json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)
	assert.True(t, response.Success)
}

func TestListPolicies_Empty(t *testing.T) {
	server := setupTestServer(t)

	req := httptest.NewRequest("GET", "/api/v1/policies", nil)
	w := httptest.NewRecorder()

	server.router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response apiResponse
	err := json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)
	assert.True(t, response.Success)

	data, ok := response.Data.(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, float64(0), data["count"])
}

func TestCreatePolicy_Success(t *testing.T) {
	server := setupTestServer(t)

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

	body, err := json.Marshal(policy)
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/api/v1/policies", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)

	var response apiResponse
	err = json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)
	assert.True(t, response.Success)
}

func TestCreatePolicy_InvalidJSON(t *testing.T) {
	server := setupTestServer(t)

	req := httptest.NewRequest("POST", "/api/v1/policies", bytes.NewReader([]byte("invalid json")))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)

	var response apiResponse
	err := json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)
	assert.False(t, response.Success)
	assert.Equal(t, "INVALID_JSON", response.Error.Code)
}

func TestCreatePolicy_ValidationFailed(t *testing.T) {
	server := setupTestServer(t)

	// Policy with invalid CEL expression
	policy := &types.Policy{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:      "bad-rule",
				Actions:   []string{"read"},
				Effect:    types.EffectAllow,
				Condition: "invalid CEL !!!",
			},
		},
	}

	body, err := json.Marshal(policy)
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/api/v1/policies", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)

	var response apiResponse
	err = json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)
	assert.False(t, response.Success)
	assert.Equal(t, "VALIDATION_FAILED", response.Error.Code)
}

func TestGetPolicy_Success(t *testing.T) {
	server := setupTestServer(t)

	// Create a policy first
	policy := &types.Policy{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	}
	err := server.policyStore.Add(policy)
	require.NoError(t, err)

	req := httptest.NewRequest("GET", "/api/v1/policies/test-policy", nil)
	w := httptest.NewRecorder()

	server.router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response apiResponse
	err = json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)
	assert.True(t, response.Success)
}

func TestGetPolicy_NotFound(t *testing.T) {
	server := setupTestServer(t)

	req := httptest.NewRequest("GET", "/api/v1/policies/nonexistent", nil)
	w := httptest.NewRecorder()

	server.router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)

	var response apiResponse
	err := json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)
	assert.False(t, response.Success)
	assert.Equal(t, "POLICY_NOT_FOUND", response.Error.Code)
}

func TestUpdatePolicy_Success(t *testing.T) {
	server := setupTestServer(t)

	// Create a policy first
	policy := &types.Policy{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	}
	err := server.policyStore.Add(policy)
	require.NoError(t, err)

	// Update the policy
	policy.Rules[0].Actions = []string{"read", "write"}

	body, err := json.Marshal(policy)
	require.NoError(t, err)

	req := httptest.NewRequest("PUT", "/api/v1/policies/test-policy", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response apiResponse
	err = json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)
	assert.True(t, response.Success)
}

func TestUpdatePolicy_NameMismatch(t *testing.T) {
	server := setupTestServer(t)

	policy := &types.Policy{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "different-name",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	}

	body, err := json.Marshal(policy)
	require.NoError(t, err)

	req := httptest.NewRequest("PUT", "/api/v1/policies/test-policy", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)

	var response apiResponse
	err = json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)
	assert.False(t, response.Success)
	assert.Equal(t, "NAME_MISMATCH", response.Error.Code)
}

func TestDeletePolicy_Success(t *testing.T) {
	server := setupTestServer(t)

	// Create a policy first
	policy := &types.Policy{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	}
	err := server.policyStore.Add(policy)
	require.NoError(t, err)

	req := httptest.NewRequest("DELETE", "/api/v1/policies/test-policy", nil)
	w := httptest.NewRecorder()

	server.router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response apiResponse
	err = json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)
	assert.True(t, response.Success)

	// Verify policy was deleted
	_, err = server.policyStore.Get("test-policy")
	assert.Error(t, err)
}

func TestBatchCreatePolicies_Success(t *testing.T) {
	server := setupTestServer(t)

	request := map[string]interface{}{
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
		"comment": "Batch create test",
	}

	body, err := json.Marshal(request)
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/api/v1/policies/batch", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)

	var response apiResponse
	err = json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)
	assert.True(t, response.Success)
}

func TestValidatePolicyPayload_Valid(t *testing.T) {
	server := setupTestServer(t)

	policy := &types.Policy{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	}

	body, err := json.Marshal(policy)
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/api/v1/policies/validate", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response apiResponse
	err = json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)
	assert.True(t, response.Success)

	data, ok := response.Data.(map[string]interface{})
	require.True(t, ok)
	assert.True(t, data["valid"].(bool))
}

func TestGetStats(t *testing.T) {
	server := setupTestServer(t)

	// Add some policies
	policy1 := &types.Policy{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "policy1",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow},
		},
	}
	policy2 := &types.Policy{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "policy2",
		ResourceKind: "file",
		Rules: []*types.Rule{
			{Name: "rule2", Actions: []string{"write"}, Effect: types.EffectAllow},
			{Name: "rule3", Actions: []string{"delete"}, Effect: types.EffectDeny},
		},
	}
	server.policyStore.Add(policy1)
	server.policyStore.Add(policy2)

	req := httptest.NewRequest("GET", "/api/v1/stats", nil)
	w := httptest.NewRecorder()

	server.router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response apiResponse
	err := json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)
	assert.True(t, response.Success)

	data, ok := response.Data.(map[string]interface{})
	require.True(t, ok)

	policies, ok := data["policies"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, float64(2), policies["total"])
	assert.Equal(t, float64(3), policies["total_rules"])
}

func TestRollbackToVersion(t *testing.T) {
	server := setupTestServer(t)

	// Create initial version
	policies1 := map[string]*types.Policy{
		"policy1": {
			APIVersion:   "api.agsiri.dev/v1",
			Name:         "policy1",
			ResourceKind: "document",
			Rules: []*types.Rule{
				{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow},
			},
		},
	}

	ctx := context.Background()
	version1, err := server.rollbackManager.UpdateWithRollback(ctx, policies1, "Version 1")
	require.NoError(t, err)

	// Create second version
	policies2 := map[string]*types.Policy{
		"policy2": {
			APIVersion:   "api.agsiri.dev/v1",
			Name:         "policy2",
			ResourceKind: "file",
			Rules: []*types.Rule{
				{Name: "rule2", Actions: []string{"write"}, Effect: types.EffectAllow},
			},
		},
	}

	_, err = server.rollbackManager.UpdateWithRollback(ctx, policies2, "Version 2")
	require.NoError(t, err)

	// Rollback to version 1
	req := httptest.NewRequest("POST", fmt.Sprintf("/api/v1/versions/%d/rollback", version1.Version), nil)
	w := httptest.NewRecorder()

	server.router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response apiResponse
	err = json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)
	assert.True(t, response.Success)
}

func TestCORSMiddleware(t *testing.T) {
	server := setupTestServer(t)

	req := httptest.NewRequest("GET", "/api/v1/health", nil)
	req.Header.Set("Origin", "http://example.com")
	w := httptest.NewRecorder()

	server.router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.NotEmpty(t, w.Header().Get("Access-Control-Allow-Origin"))
}
