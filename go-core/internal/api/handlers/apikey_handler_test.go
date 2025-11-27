package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/mux"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/authz-engine/go-core/internal/auth"
	"github.com/authz-engine/go-core/internal/auth/apikey"
)

// Simple in-memory store for testing
type memoryStore struct {
	mu   sync.RWMutex
	keys map[string]*apikey.APIKey
}

func newMemoryStore() *memoryStore {
	return &memoryStore{
		keys: make(map[string]*apikey.APIKey),
	}
}

func (m *memoryStore) Create(ctx context.Context, key *apikey.APIKey) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.keys[key.ID] = key
	return nil
}

func (m *memoryStore) GetByID(ctx context.Context, id string) (*apikey.APIKey, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	key, ok := m.keys[id]
	if !ok {
		return nil, assert.AnError
	}
	return key, nil
}

func (m *memoryStore) List(ctx context.Context, agentID string, includeRevoked bool) ([]*apikey.APIKey, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var keys []*apikey.APIKey
	for _, key := range m.keys {
		if key.AgentID == agentID {
			if includeRevoked || key.RevokedAt == nil {
				keys = append(keys, key)
			}
		}
	}
	return keys, nil
}

func (m *memoryStore) Revoke(ctx context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	key, ok := m.keys[id]
	if !ok {
		return assert.AnError
	}
	now := time.Now()
	key.RevokedAt = &now
	return nil
}

func (m *memoryStore) DeleteExpired(ctx context.Context) error {
	return nil
}

func TestCreateAPIKey(t *testing.T) {
	logger := zap.NewNop()
	store := newMemoryStore()
	rateLimiter := apikey.NewRateLimiter()
	service := apikey.NewService(store, rateLimiter)
	handler := NewAPIKeyHandler(service, logger)

	tests := []struct {
		name           string
		request        CreateAPIKeyRequest
		principal      *auth.Principal
		expectedStatus int
		expectedKey    bool
	}{
		{
			name: "successful creation",
			request: CreateAPIKeyRequest{
				Name:    "test-key",
				AgentID: "agent-123",
				Scopes:  []string{"read", "write"},
			},
			principal: &auth.Principal{
				ID:       "user-123",
				TenantID: "tenant-abc",
			},
			expectedStatus: http.StatusCreated,
			expectedKey:    true,
		},
		{
			name: "missing name",
			request: CreateAPIKeyRequest{
				AgentID: "agent-123",
			},
			principal: &auth.Principal{
				ID:       "user-123",
				TenantID: "tenant-abc",
			},
			expectedStatus: http.StatusBadRequest,
			expectedKey:    false,
		},
		{
			name: "missing agent_id",
			request: CreateAPIKeyRequest{
				Name: "test-key",
			},
			principal: &auth.Principal{
				ID:       "user-123",
				TenantID: "tenant-abc",
			},
			expectedStatus: http.StatusBadRequest,
			expectedKey:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, _ := json.Marshal(tt.request)
			req := httptest.NewRequest("POST", "/v1/auth/apikeys", bytes.NewReader(body))

			if tt.principal != nil {
				ctx := context.WithValue(req.Context(), auth.PrincipalContextKey, tt.principal)
				req = req.WithContext(ctx)
			}

			w := httptest.NewRecorder()
			handler.CreateAPIKey(w, req)

			assert.Equal(t, tt.expectedStatus, w.Code)

			if tt.expectedKey {
				var response struct {
					Success bool                     `json:"success"`
					Data    CreateAPIKeyResponse `json:"data"`
				}
				err := json.NewDecoder(w.Body).Decode(&response)
				require.NoError(t, err)
				assert.True(t, response.Success)
				assert.NotEmpty(t, response.Data.Key, "Plaintext key should be present")
			}
		})
	}
}

func TestListAPIKeys(t *testing.T) {
	logger := zap.NewNop()
	store := newMemoryStore()
	rateLimiter := apikey.NewRateLimiter()
	service := apikey.NewService(store, rateLimiter)
	handler := NewAPIKeyHandler(service, logger)

	principal := &auth.Principal{
		ID:       "agent-123",
		TenantID: "tenant-abc",
	}

	// Create some test keys
	for i := 0; i < 3; i++ {
		createReq := CreateAPIKeyRequest{
			Name:    "test-key",
			AgentID: "agent-123",
			Scopes:  []string{"read"},
		}
		body, _ := json.Marshal(createReq)
		req := httptest.NewRequest("POST", "/v1/auth/apikeys", bytes.NewReader(body))
		ctx := context.WithValue(req.Context(), auth.PrincipalContextKey, principal)
		req = req.WithContext(ctx)
		w := httptest.NewRecorder()
		handler.CreateAPIKey(w, req)
	}

	tests := []struct {
		name           string
		queryParams    string
		expectedStatus int
		minCount       int
	}{
		{
			name:           "list all keys",
			queryParams:    "",
			expectedStatus: http.StatusOK,
			minCount:       1,
		},
		{
			name:           "list with pagination",
			queryParams:    "?limit=2&offset=1",
			expectedStatus: http.StatusOK,
			minCount:       0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/v1/auth/apikeys"+tt.queryParams, nil)
			ctx := context.WithValue(req.Context(), auth.PrincipalContextKey, principal)
			req = req.WithContext(ctx)

			w := httptest.NewRecorder()
			handler.ListAPIKeys(w, req)

			assert.Equal(t, tt.expectedStatus, w.Code)

			if tt.expectedStatus == http.StatusOK {
				var response struct {
					Success bool                `json:"success"`
					Data    ListAPIKeysResponse `json:"data"`
				}
				err := json.NewDecoder(w.Body).Decode(&response)
				require.NoError(t, err)
				assert.True(t, response.Success)
				assert.GreaterOrEqual(t, len(response.Data.Keys), tt.minCount)
			}
		})
	}
}

func TestGetAPIKey(t *testing.T) {
	logger := zap.NewNop()
	store := newMemoryStore()
	rateLimiter := apikey.NewRateLimiter()
	service := apikey.NewService(store, rateLimiter)
	handler := NewAPIKeyHandler(service, logger)

	principal := &auth.Principal{
		ID:       "user-123",
		TenantID: "tenant-abc",
	}

	// Create a key first
	createReq := CreateAPIKeyRequest{
		Name:    "test-key",
		AgentID: "agent-123",
		Scopes:  []string{"read"},
	}
	body, _ := json.Marshal(createReq)
	req := httptest.NewRequest("POST", "/v1/auth/apikeys", bytes.NewReader(body))
	ctx := context.WithValue(req.Context(), auth.PrincipalContextKey, principal)
	req = req.WithContext(ctx)
	w := httptest.NewRecorder()
	handler.CreateAPIKey(w, req)

	var createResp struct {
		Data CreateAPIKeyResponse `json:"data"`
	}
	json.NewDecoder(w.Body).Decode(&createResp)
	keyID := createResp.Data.ID

	// Test retrieval
	req = httptest.NewRequest("GET", "/v1/auth/apikeys/"+keyID, nil)
	req = mux.SetURLVars(req, map[string]string{"id": keyID})
	ctx = context.WithValue(req.Context(), auth.PrincipalContextKey, principal)
	req = req.WithContext(ctx)

	w = httptest.NewRecorder()
	handler.GetAPIKey(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestRevokeAPIKey(t *testing.T) {
	logger := zap.NewNop()
	store := newMemoryStore()
	rateLimiter := apikey.NewRateLimiter()
	service := apikey.NewService(store, rateLimiter)
	handler := NewAPIKeyHandler(service, logger)

	principal := &auth.Principal{
		ID:       "user-123",
		TenantID: "tenant-abc",
	}

	// Create a key first
	createReq := CreateAPIKeyRequest{
		Name:    "test-key",
		AgentID: "agent-123",
		Scopes:  []string{"read"},
	}
	body, _ := json.Marshal(createReq)
	req := httptest.NewRequest("POST", "/v1/auth/apikeys", bytes.NewReader(body))
	ctx := context.WithValue(req.Context(), auth.PrincipalContextKey, principal)
	req = req.WithContext(ctx)
	w := httptest.NewRecorder()
	handler.CreateAPIKey(w, req)

	var createResp struct {
		Data CreateAPIKeyResponse `json:"data"`
	}
	json.NewDecoder(w.Body).Decode(&createResp)
	keyID := createResp.Data.ID

	// Test revocation
	req = httptest.NewRequest("DELETE", "/v1/auth/apikeys/"+keyID, nil)
	req = mux.SetURLVars(req, map[string]string{"id": keyID})
	ctx = context.WithValue(req.Context(), auth.PrincipalContextKey, principal)
	req = req.WithContext(ctx)

	w = httptest.NewRecorder()
	handler.RevokeAPIKey(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestRotateAPIKey(t *testing.T) {
	logger := zap.NewNop()
	store := newMemoryStore()
	rateLimiter := apikey.NewRateLimiter()
	service := apikey.NewService(store, rateLimiter)
	handler := NewAPIKeyHandler(service, logger)

	principal := &auth.Principal{
		ID:       "user-123",
		TenantID: "tenant-abc",
	}

	// Create a key first
	createReq := CreateAPIKeyRequest{
		Name:    "test-key",
		AgentID: "agent-123",
		Scopes:  []string{"read"},
	}
	body, _ := json.Marshal(createReq)
	req := httptest.NewRequest("POST", "/v1/auth/apikeys", bytes.NewReader(body))
	ctx := context.WithValue(req.Context(), auth.PrincipalContextKey, principal)
	req = req.WithContext(ctx)
	w := httptest.NewRecorder()
	handler.CreateAPIKey(w, req)

	var createResp struct {
		Data CreateAPIKeyResponse `json:"data"`
	}
	json.NewDecoder(w.Body).Decode(&createResp)
	keyID := createResp.Data.ID
	originalKey := createResp.Data.Key

	// Test rotation
	req = httptest.NewRequest("POST", "/v1/auth/apikeys/"+keyID+"/rotate", nil)
	req = mux.SetURLVars(req, map[string]string{"id": keyID})
	ctx = context.WithValue(req.Context(), auth.PrincipalContextKey, principal)
	req = req.WithContext(ctx)

	w = httptest.NewRecorder()
	handler.RotateAPIKey(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response struct {
		Success bool                     `json:"success"`
		Data    RotateAPIKeyResponse `json:"data"`
	}
	err := json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)
	assert.True(t, response.Success)
	assert.NotEmpty(t, response.Data.NewKey)
	assert.NotEqual(t, originalKey, response.Data.NewKey)
}

func TestUnauthorizedAccess(t *testing.T) {
	logger := zap.NewNop()
	store := newMemoryStore()
	rateLimiter := apikey.NewRateLimiter()
	service := apikey.NewService(store, rateLimiter)
	handler := NewAPIKeyHandler(service, logger)

	endpoints := []struct {
		name   string
		method string
		path   string
		body   interface{}
	}{
		{"create", "POST", "/v1/auth/apikeys", CreateAPIKeyRequest{Name: "test", AgentID: "agent"}},
		{"list", "GET", "/v1/auth/apikeys", nil},
		{"get", "GET", "/v1/auth/apikeys/key-123", nil},
		{"revoke", "DELETE", "/v1/auth/apikeys/key-123", nil},
		{"rotate", "POST", "/v1/auth/apikeys/key-123/rotate", nil},
	}

	for _, ep := range endpoints {
		t.Run(ep.name+"_unauthorized", func(t *testing.T) {
			var body []byte
			if ep.body != nil {
				body, _ = json.Marshal(ep.body)
			}

			req := httptest.NewRequest(ep.method, ep.path, bytes.NewReader(body))

			w := httptest.NewRecorder()

			switch ep.name {
			case "create":
				handler.CreateAPIKey(w, req)
			case "list":
				handler.ListAPIKeys(w, req)
			case "get":
				req = mux.SetURLVars(req, map[string]string{"id": "key-123"})
				handler.GetAPIKey(w, req)
			case "revoke":
				req = mux.SetURLVars(req, map[string]string{"id": "key-123"})
				handler.RevokeAPIKey(w, req)
			case "rotate":
				req = mux.SetURLVars(req, map[string]string{"id": "key-123"})
				handler.RotateAPIKey(w, req)
			}

			assert.Equal(t, http.StatusUnauthorized, w.Code)
		})
	}
}
