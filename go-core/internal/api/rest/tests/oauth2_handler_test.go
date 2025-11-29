package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"authz-engine/internal/api/rest"
	"authz-engine/internal/auth"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
)

// mockOAuth2Store is a simple in-memory store for testing
type mockOAuth2Store struct {
	clients map[uuid.UUID]*auth.OAuth2Client
}

func newMockStore() *mockOAuth2Store {
	return &mockOAuth2Store{
		clients: make(map[uuid.UUID]*auth.OAuth2Client),
	}
}

func (m *mockOAuth2Store) GetClient(ctx context.Context, clientID uuid.UUID) (*auth.OAuth2Client, error) {
	client, exists := m.clients[clientID]
	if !exists {
		return nil, auth.ErrClientNotFound
	}

	if client.RevokedAt != nil {
		return client, auth.ErrClientRevoked
	}

	if client.ExpiresAt != nil && client.ExpiresAt.Before(time.Now()) {
		return client, auth.ErrClientExpired
	}

	return client, nil
}

func (m *mockOAuth2Store) CreateClient(ctx context.Context, client *auth.OAuth2Client) error {
	m.clients[client.ClientID] = client
	return nil
}

func (m *mockOAuth2Store) UpdateClient(ctx context.Context, client *auth.OAuth2Client) error {
	return nil
}

func (m *mockOAuth2Store) RevokeClient(ctx context.Context, clientID uuid.UUID) error {
	return nil
}

func (m *mockOAuth2Store) ListClientsByTenant(ctx context.Context, tenantID string) ([]*auth.OAuth2Client, error) {
	return nil, nil
}

func (m *mockOAuth2Store) DeleteClient(ctx context.Context, clientID uuid.UUID) error {
	return nil
}

func setupTestHandler(t *testing.T) (*rest.OAuth2HTTPHandler, *mockOAuth2Store, uuid.UUID, string) {
	store := newMockStore()
	jwtIssuer, err := auth.NewJWTIssuer("test-issuer", []byte("test-secret-key-32-bytes-long!!"))
	require.NoError(t, err)

	oauth2Handler := auth.NewOAuth2Handler(store, jwtIssuer)
	httpHandler := rest.NewOAuth2HTTPHandler(oauth2Handler, &rest.OAuth2Config{
		RateLimitPerClient: 100,
		RateLimitWindow:    time.Minute,
	})

	// Create test client
	clientID := uuid.New()
	clientSecret := "test-secret"
	secretHash, err := bcrypt.GenerateFromPassword([]byte(clientSecret), auth.BcryptCost)
	require.NoError(t, err)

	client := &auth.OAuth2Client{
		ClientID:         clientID,
		ClientSecretHash: string(secretHash),
		Name:             "Test Client",
		TenantID:         "tenant-123",
		Scopes:           []string{"read", "write"},
		CreatedAt:        time.Now(),
	}

	err = store.CreateClient(context.Background(), client)
	require.NoError(t, err)

	return httpHandler, store, clientID, clientSecret
}

func TestOAuth2HTTPHandler_HandleTokenRequest_Success_JSON(t *testing.T) {
	handler, _, clientID, clientSecret := setupTestHandler(t)

	reqBody := auth.TokenRequest{
		GrantType:    "client_credentials",
		ClientID:     clientID.String(),
		ClientSecret: clientSecret,
		Scope:        "read write",
	}

	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/oauth/token", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	handler.HandleTokenRequest(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp auth.TokenResponse
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	require.NoError(t, err)

	assert.NotEmpty(t, resp.AccessToken)
	assert.Equal(t, "Bearer", resp.TokenType)
	assert.Greater(t, resp.ExpiresIn, int64(0))
	assert.Equal(t, "read write", resp.Scope)

	// Check headers
	assert.Equal(t, "application/json", w.Header().Get("Content-Type"))
	assert.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	assert.Equal(t, "no-cache", w.Header().Get("Pragma"))
}

func TestOAuth2HTTPHandler_HandleTokenRequest_Success_FormEncoded(t *testing.T) {
	handler, _, clientID, clientSecret := setupTestHandler(t)

	formData := url.Values{}
	formData.Set("grant_type", "client_credentials")
	formData.Set("client_id", clientID.String())
	formData.Set("client_secret", clientSecret)
	formData.Set("scope", "read")

	req := httptest.NewRequest(http.MethodPost, "/oauth/token", strings.NewReader(formData.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	w := httptest.NewRecorder()
	handler.HandleTokenRequest(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp auth.TokenResponse
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	require.NoError(t, err)

	assert.NotEmpty(t, resp.AccessToken)
	assert.Equal(t, "Bearer", resp.TokenType)
	assert.Equal(t, "read", resp.Scope)
}

func TestOAuth2HTTPHandler_HandleTokenRequest_InvalidMethod(t *testing.T) {
	handler, _, _, _ := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/oauth/token", nil)
	w := httptest.NewRecorder()

	handler.HandleTokenRequest(w, req)

	assert.Equal(t, http.StatusMethodNotAllowed, w.Code)

	var errResp auth.ErrorResponse
	json.Unmarshal(w.Body.Bytes(), &errResp)
	assert.Equal(t, "invalid_request", errResp.Error)
}

func TestOAuth2HTTPHandler_HandleTokenRequest_UnsupportedGrantType(t *testing.T) {
	handler, _, clientID, clientSecret := setupTestHandler(t)

	reqBody := auth.TokenRequest{
		GrantType:    "authorization_code",
		ClientID:     clientID.String(),
		ClientSecret: clientSecret,
	}

	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/oauth/token", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	handler.HandleTokenRequest(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)

	var errResp auth.ErrorResponse
	json.Unmarshal(w.Body.Bytes(), &errResp)
	assert.Equal(t, "unsupported_grant_type", errResp.Error)
}

func TestOAuth2HTTPHandler_HandleTokenRequest_InvalidClient(t *testing.T) {
	handler, _, clientID, _ := setupTestHandler(t)

	reqBody := auth.TokenRequest{
		GrantType:    "client_credentials",
		ClientID:     clientID.String(),
		ClientSecret: "wrong-secret",
	}

	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/oauth/token", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	handler.HandleTokenRequest(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)

	var errResp auth.ErrorResponse
	json.Unmarshal(w.Body.Bytes(), &errResp)
	assert.Equal(t, "invalid_client", errResp.Error)
}

func TestOAuth2HTTPHandler_HandleTokenRequest_InvalidScope(t *testing.T) {
	handler, _, clientID, clientSecret := setupTestHandler(t)

	reqBody := auth.TokenRequest{
		GrantType:    "client_credentials",
		ClientID:     clientID.String(),
		ClientSecret: clientSecret,
		Scope:        "admin delete", // Not allowed scopes
	}

	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/oauth/token", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	handler.HandleTokenRequest(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)

	var errResp auth.ErrorResponse
	json.Unmarshal(w.Body.Bytes(), &errResp)
	assert.Equal(t, "invalid_scope", errResp.Error)
}

func TestOAuth2HTTPHandler_HandleTokenRequest_MissingClientID(t *testing.T) {
	handler, _, _, clientSecret := setupTestHandler(t)

	reqBody := auth.TokenRequest{
		GrantType:    "client_credentials",
		ClientID:     "",
		ClientSecret: clientSecret,
	}

	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/oauth/token", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	handler.HandleTokenRequest(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)

	var errResp auth.ErrorResponse
	json.Unmarshal(w.Body.Bytes(), &errResp)
	assert.Equal(t, "invalid_request", errResp.Error)
}

func TestOAuth2HTTPHandler_RateLimiting(t *testing.T) {
	// Setup handler with low rate limit
	store := newMockStore()
	jwtIssuer, _ := auth.NewJWTIssuer("test", []byte("test-secret-key-32-bytes-long!!"))
	oauth2Handler := auth.NewOAuth2Handler(store, jwtIssuer)
	httpHandler := rest.NewOAuth2HTTPHandler(oauth2Handler, &rest.OAuth2Config{
		RateLimitPerClient: 2, // Very low limit for testing
		RateLimitWindow:    time.Second,
	})

	clientID := uuid.New()
	clientSecret := "secret"
	secretHash, _ := bcrypt.GenerateFromPassword([]byte(clientSecret), auth.BcryptCost)

	client := &auth.OAuth2Client{
		ClientID:         clientID,
		ClientSecretHash: string(secretHash),
		Name:             "Test Client",
		TenantID:         "tenant-123",
		Scopes:           []string{"read"},
		CreatedAt:        time.Now(),
	}
	store.CreateClient(context.Background(), client)

	reqBody := auth.TokenRequest{
		GrantType:    "client_credentials",
		ClientID:     clientID.String(),
		ClientSecret: clientSecret,
	}

	// First request should succeed
	body, _ := json.Marshal(reqBody)
	req1 := httptest.NewRequest(http.MethodPost, "/oauth/token", bytes.NewReader(body))
	req1.Header.Set("Content-Type", "application/json")
	w1 := httptest.NewRecorder()
	httpHandler.HandleTokenRequest(w1, req1)
	assert.Equal(t, http.StatusOK, w1.Code)

	// Second request should succeed
	body, _ = json.Marshal(reqBody)
	req2 := httptest.NewRequest(http.MethodPost, "/oauth/token", bytes.NewReader(body))
	req2.Header.Set("Content-Type", "application/json")
	w2 := httptest.NewRecorder()
	httpHandler.HandleTokenRequest(w2, req2)
	assert.Equal(t, http.StatusOK, w2.Code)

	// Third request should be rate limited
	body, _ = json.Marshal(reqBody)
	req3 := httptest.NewRequest(http.MethodPost, "/oauth/token", bytes.NewReader(body))
	req3.Header.Set("Content-Type", "application/json")
	w3 := httptest.NewRecorder()
	httpHandler.HandleTokenRequest(w3, req3)
	assert.Equal(t, http.StatusTooManyRequests, w3.Code)

	var errResp auth.ErrorResponse
	json.Unmarshal(w3.Body.Bytes(), &errResp)
	assert.Equal(t, "invalid_request", errResp.Error)
	assert.Contains(t, errResp.ErrorDescription, "Rate limit exceeded")
}

func TestOAuth2HTTPHandler_InvalidJSON(t *testing.T) {
	handler, _, _, _ := setupTestHandler(t)

	req := httptest.NewRequest(http.MethodPost, "/oauth/token", strings.NewReader("{invalid json"))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	handler.HandleTokenRequest(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)

	var errResp auth.ErrorResponse
	json.Unmarshal(w.Body.Bytes(), &errResp)
	assert.Equal(t, "invalid_request", errResp.Error)
}
