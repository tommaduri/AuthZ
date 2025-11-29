package jwt

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-redis/redismock/v9"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestRevokeHandler_ServeHTTP(t *testing.T) {
	// Create test validator and handler
	client, mock := redismock.NewClientMock()
	validator := &JWTValidator{
		redisClient: client,
		logger:      zap.NewNop(),
	}
	handler := NewRevokeHandler(validator, client, zap.NewNop())

	tests := []struct {
		name           string
		method         string
		body           interface{}
		tokenString    string
		setupMock      func()
		expectedStatus int
		expectedError  string
	}{
		{
			name:   "successful revocation",
			method: http.MethodPost,
			body: RevokeRequest{
				Token: createTestToken(t, "test-jti-1", time.Now().Add(1*time.Hour)),
			},
			setupMock: func() {
				mock.ExpectSet("revoked:jwt:test-jti-1", mock.AnyArg(), mock.AnyArg()).SetVal("OK")
			},
			expectedStatus: http.StatusOK,
		},
		{
			name:           "method not allowed",
			method:         http.MethodGet,
			body:           RevokeRequest{},
			setupMock:      func() {},
			expectedStatus: http.StatusMethodNotAllowed,
			expectedError:  "method_not_allowed",
		},
		{
			name:           "invalid json body",
			method:         http.MethodPost,
			body:           "invalid-json",
			setupMock:      func() {},
			expectedStatus: http.StatusBadRequest,
			expectedError:  "invalid_request",
		},
		{
			name:           "missing token",
			method:         http.MethodPost,
			body:           RevokeRequest{Token: ""},
			setupMock:      func() {},
			expectedStatus: http.StatusBadRequest,
			expectedError:  "invalid_request",
		},
		{
			name:   "invalid token format",
			method: http.MethodPost,
			body: RevokeRequest{
				Token: "not-a-valid-jwt",
			},
			setupMock:      func() {},
			expectedStatus: http.StatusBadRequest,
			expectedError:  "invalid_token",
		},
		{
			name:   "redis error",
			method: http.MethodPost,
			body: RevokeRequest{
				Token: createTestToken(t, "test-jti-error", time.Now().Add(1*time.Hour)),
			},
			setupMock: func() {
				mock.ExpectSet("revoked:jwt:test-jti-error", mock.AnyArg(), mock.AnyArg()).
					SetErr(redis.TxFailedErr)
			},
			expectedStatus: http.StatusInternalServerError,
			expectedError:  "revocation_failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.setupMock()

			// Create request
			var bodyBytes []byte
			var err error
			if str, ok := tt.body.(string); ok {
				bodyBytes = []byte(str)
			} else {
				bodyBytes, err = json.Marshal(tt.body)
				require.NoError(t, err)
			}

			req := httptest.NewRequest(tt.method, "/v1/auth/revoke", bytes.NewReader(bodyBytes))
			req.Header.Set("Content-Type", "application/json")

			// Record response
			rr := httptest.NewRecorder()

			// Serve request
			handler.ServeHTTP(rr, req)

			// Check status code
			assert.Equal(t, tt.expectedStatus, rr.Code)

			// Check error if expected
			if tt.expectedError != "" {
				var errResp ErrorResponse
				err := json.NewDecoder(rr.Body).Decode(&errResp)
				require.NoError(t, err)
				assert.Equal(t, tt.expectedError, errResp.Error)
			}

			// Verify mock expectations
			assert.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestBatchRevokeHandler_ServeHTTP(t *testing.T) {
	client, mock := redismock.NewClientMock()
	handler := NewBatchRevokeHandler(client, zap.NewNop())

	tests := []struct {
		name           string
		method         string
		body           interface{}
		setupMock      func()
		expectedStatus int
		expectedCount  int
		expectedFailed int
	}{
		{
			name:   "successful batch revocation",
			method: http.MethodPost,
			body: BatchRevokeRequest{
				Tokens: []string{
					createTestToken(t, "batch-1", time.Now().Add(1*time.Hour)),
					createTestToken(t, "batch-2", time.Now().Add(1*time.Hour)),
					createTestToken(t, "batch-3", time.Now().Add(1*time.Hour)),
				},
			},
			setupMock: func() {
				// Pipeline expects multiple sets
				mock.ExpectSet("revoked:jwt:batch-1", mock.AnyArg(), mock.AnyArg()).SetVal("OK")
				mock.ExpectSet("revoked:jwt:batch-2", mock.AnyArg(), mock.AnyArg()).SetVal("OK")
				mock.ExpectSet("revoked:jwt:batch-3", mock.AnyArg(), mock.AnyArg()).SetVal("OK")
			},
			expectedStatus: http.StatusOK,
			expectedCount:  3,
			expectedFailed: 0,
		},
		{
			name:   "partial success with invalid tokens",
			method: http.MethodPost,
			body: BatchRevokeRequest{
				Tokens: []string{
					createTestToken(t, "valid-1", time.Now().Add(1*time.Hour)),
					"invalid-token",
					createTestToken(t, "valid-2", time.Now().Add(1*time.Hour)),
				},
			},
			setupMock: func() {
				mock.ExpectSet("revoked:jwt:valid-1", mock.AnyArg(), mock.AnyArg()).SetVal("OK")
				mock.ExpectSet("revoked:jwt:valid-2", mock.AnyArg(), mock.AnyArg()).SetVal("OK")
			},
			expectedStatus: http.StatusOK,
			expectedCount:  2,
			expectedFailed: 1,
		},
		{
			name:           "method not allowed",
			method:         http.MethodGet,
			body:           BatchRevokeRequest{},
			setupMock:      func() {},
			expectedStatus: http.StatusMethodNotAllowed,
		},
		{
			name:           "empty tokens list",
			method:         http.MethodPost,
			body:           BatchRevokeRequest{Tokens: []string{}},
			setupMock:      func() {},
			expectedStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.setupMock()

			bodyBytes, err := json.Marshal(tt.body)
			require.NoError(t, err)

			req := httptest.NewRequest(tt.method, "/v1/auth/revoke/batch", bytes.NewReader(bodyBytes))
			req.Header.Set("Content-Type", "application/json")

			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)

			assert.Equal(t, tt.expectedStatus, rr.Code)

			if tt.expectedStatus == http.StatusOK {
				var resp BatchRevokeResponse
				err := json.NewDecoder(rr.Body).Decode(&resp)
				require.NoError(t, err)
				assert.True(t, resp.Success)
				assert.Equal(t, tt.expectedCount, resp.RevokedCount)
				assert.Equal(t, tt.expectedFailed, len(resp.FailedTokens))
			}

			assert.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestRevokeHandler_Integration(t *testing.T) {
	// Integration test with real Redis
	client := redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
		DB:   1,
	})

	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		t.Skip("Redis not available")
	}
	defer client.Close()
	defer client.FlushDB(ctx)

	validator := &JWTValidator{
		redisClient: client,
		logger:      zap.NewNop(),
	}
	handler := NewRevokeHandler(validator, client, zap.NewNop())

	// Create a test token
	jti := "integration-test-token"
	expiresAt := time.Now().Add(1 * time.Hour)
	tokenString := createTestToken(t, jti, expiresAt)

	// Revoke the token via HTTP handler
	reqBody, _ := json.Marshal(RevokeRequest{Token: tokenString})
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/revoke", bytes.NewReader(reqBody))
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)

	// Verify token is revoked
	revoker := NewTokenRevoker(client)
	isRevoked, err := revoker.IsRevoked(ctx, jti)
	require.NoError(t, err)
	assert.True(t, isRevoked)
}

// Helper function to create a test JWT token
func createTestToken(t *testing.T, jti string, expiresAt time.Time) string {
	// This creates a minimal JWT for testing parsing
	// Note: Signature is not valid, but we only need to parse claims
	token := jwt.NewWithClaims(jwt.SigningMethodNone, &Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        jti,
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	})

	// Sign with "none" algorithm for testing
	tokenString, err := token.SignedString(jwt.UnsafeAllowNoneSignatureType)
	require.NoError(t, err)
	return tokenString
}
