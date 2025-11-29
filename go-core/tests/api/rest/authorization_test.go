package rest_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/authz-engine/go-core/internal/api/rest"
	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
)

func setupTestServer(t *testing.T) (*rest.Server, *policy.MemoryStore) {
	// Create policy store
	store := policy.NewMemoryStore()

	// Add test policy
	testPolicy := &types.Policy{
		APIVersion:   "api.agsiri.dev/v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
				Roles:   []string{"viewer", "editor"},
			},
			{
				Name:    "allow-write",
				Actions: []string{"write"},
				Effect:  types.EffectAllow,
				Roles:   []string{"editor"},
			},
			{
				Name:    "deny-delete",
				Actions: []string{"delete"},
				Effect:  types.EffectDeny,
				Roles:   []string{"*"},
			},
		},
	}
	require.NoError(t, store.Add(testPolicy))

	// Create engine
	cfg := engine.DefaultConfig()
	cfg.CacheEnabled = true
	eng, err := engine.New(cfg, store)
	require.NoError(t, err)

	// Create REST server
	logger := zap.NewNop()
	serverCfg := rest.DefaultConfig()
	serverCfg.EnableAuth = false // Disable auth for testing

	server, err := rest.New(serverCfg, eng, store, logger)
	require.NoError(t, err)

	return server, store
}

func TestAuthorizationCheck_Allow(t *testing.T) {
	server, _ := setupTestServer(t)

	reqBody := rest.AuthorizationCheckRequest{
		Principal: rest.Principal{
			ID:    "user123",
			Roles: []string{"viewer"},
		},
		Resource: rest.Resource{
			Kind: "document",
			ID:   "doc456",
		},
		Action: "read",
	}

	body, err := json.Marshal(reqBody)
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/v1/authorization/check", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	// Call handler directly through router
	server.(*rest.Server).ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response rest.AuthorizationCheckResponse
	err = json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)

	assert.True(t, response.Allowed)
	assert.Equal(t, "allow", response.Effect)
	assert.NotEmpty(t, response.Policy)
	assert.NotEmpty(t, response.Rule)
	assert.NotNil(t, response.Metadata)
}

func TestAuthorizationCheck_Deny(t *testing.T) {
	server, _ := setupTestServer(t)

	reqBody := rest.AuthorizationCheckRequest{
		Principal: rest.Principal{
			ID:    "user123",
			Roles: []string{"viewer"},
		},
		Resource: rest.Resource{
			Kind: "document",
			ID:   "doc456",
		},
		Action: "write",
	}

	body, err := json.Marshal(reqBody)
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/v1/authorization/check", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.(*rest.Server).ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response rest.AuthorizationCheckResponse
	err = json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)

	assert.False(t, response.Allowed)
	assert.Equal(t, "deny", response.Effect)
}

func TestAuthorizationCheck_ValidationErrors(t *testing.T) {
	server, _ := setupTestServer(t)

	testCases := []struct {
		name     string
		request  rest.AuthorizationCheckRequest
		wantCode int
		wantErr  string
	}{
		{
			name: "missing principal ID",
			request: rest.AuthorizationCheckRequest{
				Principal: rest.Principal{
					Roles: []string{"viewer"},
				},
				Resource: rest.Resource{
					Kind: "document",
					ID:   "doc456",
				},
				Action: "read",
			},
			wantCode: http.StatusBadRequest,
			wantErr:  "principal.id is required",
		},
		{
			name: "missing resource kind",
			request: rest.AuthorizationCheckRequest{
				Principal: rest.Principal{
					ID:    "user123",
					Roles: []string{"viewer"},
				},
				Resource: rest.Resource{
					ID: "doc456",
				},
				Action: "read",
			},
			wantCode: http.StatusBadRequest,
			wantErr:  "resource.kind is required",
		},
		{
			name: "missing action",
			request: rest.AuthorizationCheckRequest{
				Principal: rest.Principal{
					ID:    "user123",
					Roles: []string{"viewer"},
				},
				Resource: rest.Resource{
					Kind: "document",
					ID:   "doc456",
				},
			},
			wantCode: http.StatusBadRequest,
			wantErr:  "action is required",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			body, err := json.Marshal(tc.request)
			require.NoError(t, err)

			req := httptest.NewRequest("POST", "/v1/authorization/check", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			server.(*rest.Server).ServeHTTP(w, req)

			assert.Equal(t, tc.wantCode, w.Code)

			var errResp rest.ErrorResponse
			err = json.NewDecoder(w.Body).Decode(&errResp)
			require.NoError(t, err)
			assert.Contains(t, errResp.Error, tc.wantErr)
		})
	}
}

func TestBatchCheckResources(t *testing.T) {
	server, _ := setupTestServer(t)

	reqBody := rest.BatchCheckRequest{
		Principal: rest.Principal{
			ID:    "user123",
			Roles: []string{"editor"},
		},
		Resources: []rest.ResourceWithAction{
			{
				Resource: rest.Resource{
					Kind: "document",
					ID:   "doc1",
				},
				Action: "read",
			},
			{
				Resource: rest.Resource{
					Kind: "document",
					ID:   "doc2",
				},
				Action: "write",
			},
			{
				Resource: rest.Resource{
					Kind: "document",
					ID:   "doc3",
				},
				Action: "delete",
			},
		},
	}

	body, err := json.Marshal(reqBody)
	require.NoError(t, err)

	req := httptest.NewRequest("POST", "/v1/authorization/check-resources", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.(*rest.Server).ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response rest.BatchCheckResponse
	err = json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)

	assert.Len(t, response.Results, 3)
	assert.True(t, response.Results[0].Allowed)   // read allowed
	assert.True(t, response.Results[1].Allowed)   // write allowed
	assert.False(t, response.Results[2].Allowed)  // delete denied
	assert.NotNil(t, response.Metadata)
}

func TestAllowedActions(t *testing.T) {
	server, _ := setupTestServer(t)

	req := httptest.NewRequest("GET", "/v1/authorization/allowed-actions?principal.id=user123&principal.roles=editor&resource.kind=document&resource.id=doc456", nil)
	w := httptest.NewRecorder()

	server.(*rest.Server).ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response rest.AllowedActionsResponse
	err := json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)

	assert.NotEmpty(t, response.Actions)
	assert.Contains(t, response.Actions, "read")
	assert.Contains(t, response.Actions, "write")
	assert.NotContains(t, response.Actions, "delete")
	assert.NotNil(t, response.Metadata)
}

func TestAuthorizationCheck_Performance(t *testing.T) {
	server, _ := setupTestServer(t)

	reqBody := rest.AuthorizationCheckRequest{
		Principal: rest.Principal{
			ID:    "user123",
			Roles: []string{"viewer"},
		},
		Resource: rest.Resource{
			Kind: "document",
			ID:   "doc456",
		},
		Action: "read",
	}

	body, err := json.Marshal(reqBody)
	require.NoError(t, err)

	// Measure performance
	start := time.Now()
	for i := 0; i < 100; i++ {
		req := httptest.NewRequest("POST", "/v1/authorization/check", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()

		server.(*rest.Server).ServeHTTP(w, req)
		assert.Equal(t, http.StatusOK, w.Code)
	}
	duration := time.Since(start)
	avgDuration := duration / 100

	t.Logf("Average authorization check time: %v", avgDuration)
	assert.Less(t, avgDuration, 100*time.Millisecond, "Authorization check should be <100ms")
}

func TestAuthorizationCheck_CacheHit(t *testing.T) {
	server, _ := setupTestServer(t)

	reqBody := rest.AuthorizationCheckRequest{
		Principal: rest.Principal{
			ID:    "user123",
			Roles: []string{"viewer"},
		},
		Resource: rest.Resource{
			Kind: "document",
			ID:   "doc456",
		},
		Action: "read",
	}

	body, err := json.Marshal(reqBody)
	require.NoError(t, err)

	// First request (cache miss)
	req1 := httptest.NewRequest("POST", "/v1/authorization/check", bytes.NewReader(body))
	req1.Header.Set("Content-Type", "application/json")
	w1 := httptest.NewRecorder()
	server.(*rest.Server).ServeHTTP(w1, req1)

	var response1 rest.AuthorizationCheckResponse
	err = json.NewDecoder(w1.Body).Decode(&response1)
	require.NoError(t, err)
	assert.False(t, response1.Metadata.CacheHit)

	// Second request (cache hit)
	req2 := httptest.NewRequest("POST", "/v1/authorization/check", bytes.NewReader(body))
	req2.Header.Set("Content-Type", "application/json")
	w2 := httptest.NewRecorder()
	server.(*rest.Server).ServeHTTP(w2, req2)

	var response2 rest.AuthorizationCheckResponse
	err = json.NewDecoder(w2.Body).Decode(&response2)
	require.NoError(t, err)
	assert.True(t, response2.Metadata.CacheHit)
}
