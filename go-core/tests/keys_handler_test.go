package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/authz-engine/go-core/internal/api/rest"
	"github.com/authz-engine/go-core/internal/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupKeysHandler(t *testing.T) (*rest.KeysHandler, *auth.KeyRotationManager) {
	db := setupTestDB(t)
	encryptor := &mockEncryptor{}
	krm := auth.NewKeyRotationManager(db, encryptor)
	jwksMgr := auth.NewJWKSManager(krm)
	handler := rest.NewKeysHandler(krm, jwksMgr)
	return handler, krm
}

func TestKeysHandler_HandleRotateKeys(t *testing.T) {
	handler, _ := setupKeysHandler(t)

	tests := []struct {
		name           string
		method         string
		expectedStatus int
	}{
		{
			name:           "successful rotation",
			method:         http.MethodPost,
			expectedStatus: http.StatusOK,
		},
		{
			name:           "method not allowed",
			method:         http.MethodGet,
			expectedStatus: http.StatusMethodNotAllowed,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "/v1/auth/keys/rotate", nil)
			w := httptest.NewRecorder()

			handler.HandleRotateKeys(w, req)

			assert.Equal(t, tt.expectedStatus, w.Code)

			if tt.expectedStatus == http.StatusOK {
				var response rest.RotateKeysResponse
				err := json.NewDecoder(w.Body).Decode(&response)
				require.NoError(t, err)
				assert.True(t, response.Success)
				assert.NotEmpty(t, response.NewKeyID)
				assert.Greater(t, response.ActiveKeys, 0)
			}
		})
	}
}

func TestKeysHandler_HandleGetJWKS(t *testing.T) {
	handler, krm := setupKeysHandler(t)

	// Create an active key first
	ctx := context.Background()
	_, err := krm.RotateKeys(ctx)
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodGet, "/v1/auth/.well-known/jwks.json", nil)
	w := httptest.NewRecorder()

	handler.HandleGetJWKS(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "application/json", w.Header().Get("Content-Type"))
	assert.Contains(t, w.Header().Get("Cache-Control"), "public")

	var jwks auth.JWKS
	err = json.NewDecoder(w.Body).Decode(&jwks)
	require.NoError(t, err)
	assert.Len(t, jwks.Keys, 1)
	assert.Equal(t, "RSA", jwks.Keys[0].Kty)
	assert.Equal(t, "sig", jwks.Keys[0].Use)
}

func TestKeysHandler_HandleListKeys(t *testing.T) {
	handler, krm := setupKeysHandler(t)

	// Create multiple active keys
	ctx := context.Background()
	_, err := krm.RotateKeys(ctx)
	require.NoError(t, err)
	_, err = krm.RotateKeys(ctx)
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodGet, "/v1/auth/keys", nil)
	w := httptest.NewRecorder()

	handler.HandleListKeys(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response struct {
		Keys []struct {
			KID       string `json:"kid"`
			Algorithm string `json:"algorithm"`
			Status    string `json:"status"`
		} `json:"keys"`
	}
	err = json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)
	assert.Len(t, response.Keys, 2)

	for _, key := range response.Keys {
		assert.NotEmpty(t, key.KID)
		assert.Equal(t, "RS256", key.Algorithm)
		assert.Equal(t, auth.KeyStatusActive, key.Status)
	}
}

func TestKeysHandler_HandleExpireKeys(t *testing.T) {
	handler, krm := setupKeysHandler(t)

	// Create and expire a key
	ctx := context.Background()
	key, err := krm.RotateKeys(ctx)
	require.NoError(t, err)

	// Set expiration to past
	db := setupTestDB(t)
	_, err = db.ExecContext(ctx,
		"UPDATE signing_keys SET expires_at = NOW() - INTERVAL '1 hour' WHERE kid = $1",
		key.KID)
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodPost, "/v1/auth/keys/expire", nil)
	w := httptest.NewRecorder()

	handler.HandleExpireKeys(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response struct {
		Success      bool `json:"success"`
		ExpiredCount int  `json:"expired_count"`
	}
	err = json.NewDecoder(w.Body).Decode(&response)
	require.NoError(t, err)
	assert.True(t, response.Success)
	assert.Equal(t, 1, response.ExpiredCount)
}

func TestKeysHandler_RegisterRoutes(t *testing.T) {
	handler, _ := setupKeysHandler(t)

	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	// Test that routes are registered
	routes := []string{
		"/v1/auth/keys/rotate",
		"/v1/auth/keys/expire",
		"/v1/auth/keys",
		"/v1/auth/.well-known/jwks.json",
	}

	for _, route := range routes {
		req := httptest.NewRequest(http.MethodGet, route, nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		// Should not return 404
		assert.NotEqual(t, http.StatusNotFound, w.Code, "Route not registered: "+route)
	}
}

func TestKeysHandler_ErrorResponses(t *testing.T) {
	handler, _ := setupKeysHandler(t)

	tests := []struct {
		name           string
		handler        http.HandlerFunc
		method         string
		expectedStatus int
	}{
		{
			name:           "rotate keys - wrong method",
			handler:        handler.HandleRotateKeys,
			method:         http.MethodGet,
			expectedStatus: http.StatusMethodNotAllowed,
		},
		{
			name:           "get jwks - wrong method",
			handler:        handler.HandleGetJWKS,
			method:         http.MethodPost,
			expectedStatus: http.StatusMethodNotAllowed,
		},
		{
			name:           "list keys - wrong method",
			handler:        handler.HandleListKeys,
			method:         http.MethodDelete,
			expectedStatus: http.StatusMethodNotAllowed,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "/test", nil)
			w := httptest.NewRecorder()

			tt.handler(w, req)

			assert.Equal(t, tt.expectedStatus, w.Code)

			var errResp rest.ErrorResponse
			err := json.NewDecoder(w.Body).Decode(&errResp)
			require.NoError(t, err)
			assert.NotEmpty(t, errResp.Error)
			assert.NotEmpty(t, errResp.Message)
			assert.Equal(t, tt.expectedStatus, errResp.Code)
		})
	}
}
