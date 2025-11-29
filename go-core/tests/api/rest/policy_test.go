package rest_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/authz-engine/go-core/internal/api/rest"
	"github.com/authz-engine/go-core/pkg/types"
)

func TestListPolicies(t *testing.T) {
	server, store := setupTestServer(t)

	// Add more test policies
	for i := 1; i <= 5; i++ {
		policy := &types.Policy{
			APIVersion:   "api.agsiri.dev/v1",
			Name:         fmt.Sprintf("policy-%d", i),
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "test-rule",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
				},
			},
		}
		require.NoError(t, store.Add(policy))
	}

	req := httptest.NewRequest("GET", "/v1/policies", nil)
	w := httptest.NewRecorder()

	server.(*rest.Server).ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response rest.PolicyListResponse
	err := json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)

	assert.GreaterOrEqual(t, len(response.Policies), 5)
	assert.GreaterOrEqual(t, response.Total, 5)
}

func TestListPolicies_Pagination(t *testing.T) {
	server, store := setupTestServer(t)

	// Add test policies
	for i := 1; i <= 10; i++ {
		policy := &types.Policy{
			APIVersion:   "api.agsiri.dev/v1",
			Name:         fmt.Sprintf("policy-%d", i),
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "test-rule",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
				},
			},
		}
		require.NoError(t, store.Add(policy))
	}

	// Test pagination
	req := httptest.NewRequest("GET", "/v1/policies?limit=5&offset=0", nil)
	w := httptest.NewRecorder()

	server.(*rest.Server).ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response rest.PolicyListResponse
	err := json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)

	assert.Equal(t, 5, len(response.Policies))
	assert.Equal(t, 5, response.Limit)
	assert.Equal(t, 0, response.Offset)
	assert.NotNil(t, response.NextOffset)
	assert.Equal(t, 5, *response.NextOffset)
}

func TestGetPolicy(t *testing.T) {
	server, _ := setupTestServer(t)

	req := httptest.NewRequest("GET", "/v1/policies/test-policy", nil)
	w := httptest.NewRecorder()

	server.(*rest.Server).ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response rest.PolicyResponse
	err := json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)

	assert.Equal(t, "test-policy", response.Name)
	assert.Equal(t, "document", response.ResourceKind)
	assert.NotEmpty(t, response.Rules)
}

func TestGetPolicy_NotFound(t *testing.T) {
	server, _ := setupTestServer(t)

	req := httptest.NewRequest("GET", "/v1/policies/non-existent", nil)
	w := httptest.NewRecorder()

	server.(*rest.Server).ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)

	var errResp rest.ErrorResponse
	err := json.NewDecoder(w.Body).Decode(&errResp)
	require.NoError(t, err)
	assert.Contains(t, errResp.Error, "not found")
}

func TestCreatePolicy(t *testing.T) {
	server, _ := setupTestServer(t)

	policyReq := rest.PolicyRequest{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "new-policy",
		ResourceKind: "file",
		Rules: []rest.RuleRequest{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  "allow",
				Roles:   []string{"viewer"},
			},
		},
	}

	body, err := json.Marshal(policyReq)
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/v1/policies", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.(*rest.Server).ServeHTTP(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)

	var response rest.PolicyResponse
	err = json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)

	assert.Equal(t, "new-policy", response.Name)
	assert.Equal(t, "file", response.ResourceKind)
	assert.Len(t, response.Rules, 1)
}

func TestCreatePolicy_Conflict(t *testing.T) {
	server, _ := setupTestServer(t)

	policyReq := rest.PolicyRequest{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "test-policy", // Already exists
		ResourceKind: "document",
		Rules: []rest.RuleRequest{
			{
				Name:    "test-rule",
				Actions: []string{"read"},
				Effect:  "allow",
			},
		},
	}

	body, err := json.Marshal(policyReq)
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/v1/policies", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.(*rest.Server).ServeHTTP(w, req)

	assert.Equal(t, http.StatusConflict, w.Code)
}

func TestUpdatePolicy(t *testing.T) {
	server, _ := setupTestServer(t)

	policyReq := rest.PolicyRequest{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []rest.RuleRequest{
			{
				Name:    "updated-rule",
				Actions: []string{"read", "write", "update"},
				Effect:  "allow",
				Roles:   []string{"admin"},
			},
		},
	}

	body, err := json.Marshal(policyReq)
	require.NoError(t, err)

	req := httptest.NewRequest("PUT", "/v1/policies/test-policy", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.(*rest.Server).ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response rest.PolicyResponse
	err = json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)

	assert.Equal(t, "test-policy", response.Name)
	assert.Len(t, response.Rules, 1)
	assert.Equal(t, "updated-rule", response.Rules[0].Name)
}

func TestUpdatePolicy_NotFound(t *testing.T) {
	server, _ := setupTestServer(t)

	policyReq := rest.PolicyRequest{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "non-existent",
		ResourceKind: "document",
		Rules:        []rest.RuleRequest{},
	}

	body, err := json.Marshal(policyReq)
	require.NoError(t, err)

	req := httptest.NewRequest("PUT", "/v1/policies/non-existent", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.(*rest.Server).ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestDeletePolicy(t *testing.T) {
	server, store := setupTestServer(t)

	// Add a policy to delete
	policy := &types.Policy{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "to-delete",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "test-rule",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	}
	require.NoError(t, store.Add(policy))

	req := httptest.NewRequest("DELETE", "/v1/policies/to-delete", nil)
	w := httptest.NewRecorder()

	server.(*rest.Server).ServeHTTP(w, req)

	assert.Equal(t, http.StatusNoContent, w.Code)

	// Verify policy was deleted
	_, err := store.Get("to-delete")
	assert.Error(t, err)
}

func TestDeletePolicy_NotFound(t *testing.T) {
	server, _ := setupTestServer(t)

	req := httptest.NewRequest("DELETE", "/v1/policies/non-existent", nil)
	w := httptest.NewRecorder()

	server.(*rest.Server).ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestCreatePolicy_ValidationErrors(t *testing.T) {
	server, _ := setupTestServer(t)

	testCases := []struct {
		name     string
		request  rest.PolicyRequest
		wantCode int
	}{
		{
			name: "missing name",
			request: rest.PolicyRequest{
				APIVersion:   "api.agsiri.dev/v1",
				ResourceKind: "document",
				Rules:        []rest.RuleRequest{},
			},
			wantCode: http.StatusBadRequest,
		},
		{
			name: "missing resource kind",
			request: rest.PolicyRequest{
				APIVersion: "api.agsiri.dev/v1",
				Name:       "test",
				Rules:      []rest.RuleRequest{},
			},
			wantCode: http.StatusBadRequest,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			body, err := json.Marshal(tc.request)
			require.NoError(t, err)

			req := httptest.NewRequest("POST", "/v1/policies", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			server.(*rest.Server).ServeHTTP(w, req)

			assert.Equal(t, tc.wantCode, w.Code)
		})
	}
}
