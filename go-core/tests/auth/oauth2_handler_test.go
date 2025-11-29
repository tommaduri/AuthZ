package auth_test

import (
	"context"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/auth"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
)

// mockJWTIssuer implements auth.OAuth2JWTIssuer for testing
type mockJWTIssuer struct {
	tokenToReturn string
	errorToReturn error
}

func (m *mockJWTIssuer) IssueTokenWithClaims(ctx context.Context, subject, tenantID string, scopes []string, extra map[string]interface{}) (string, error) {
	if m.errorToReturn != nil {
		return "", m.errorToReturn
	}
	return m.tokenToReturn, nil
}

// TestOAuth2Handler_IssueToken_Success tests successful token issuance
func TestOAuth2Handler_IssueToken_Success(t *testing.T) {
	// Setup in-memory store
	store := auth.NewInMemoryOAuth2Store()
	ctx := context.Background()

	// Create test client
	clientSecret := "test-secret-12345"
	secretHash, err := bcrypt.GenerateFromPassword([]byte(clientSecret), auth.BcryptCost)
	require.NoError(t, err)

	client := &auth.OAuth2Client{
		ClientID:         uuid.New(),
		ClientSecretHash: string(secretHash),
		Name:             "Test Client",
		TenantID:         "tenant-1",
		Scopes:           []string{"read:policies", "write:policies"},
		CreatedAt:        time.Now(),
	}
	require.NoError(t, store.CreateClient(ctx, client))

	// Create handler with mock issuer
	mockIssuer := &mockJWTIssuer{
		tokenToReturn: "mock.jwt.token",
	}
	handler := auth.NewOAuth2Handler(store, mockIssuer)

	// Issue token
	req := &auth.TokenRequest{
		GrantType:    "client_credentials",
		ClientID:     client.ClientID.String(),
		ClientSecret: clientSecret,
		Scope:        "read:policies",
	}

	resp, err := handler.IssueToken(ctx, req)
	require.NoError(t, err)
	require.NotNil(t, resp)

	assert.Equal(t, "mock.jwt.token", resp.AccessToken)
	assert.Equal(t, "Bearer", resp.TokenType)
	assert.Equal(t, int64(3600), resp.ExpiresIn)
	assert.Equal(t, "read:policies", resp.Scope)
}

// TestOAuth2Handler_IssueToken_InvalidGrantType tests invalid grant type
func TestOAuth2Handler_IssueToken_InvalidGrantType(t *testing.T) {
	store := auth.NewInMemoryOAuth2Store()
	mockIssuer := &mockJWTIssuer{tokenToReturn: "mock.jwt.token"}
	handler := auth.NewOAuth2Handler(store, mockIssuer)

	req := &auth.TokenRequest{
		GrantType:    "authorization_code",
		ClientID:     uuid.New().String(),
		ClientSecret: "secret",
	}

	resp, err := handler.IssueToken(context.Background(), req)
	assert.Nil(t, resp)
	assert.ErrorIs(t, err, auth.ErrInvalidGrantType)
}

// TestOAuth2Handler_IssueToken_MissingClientID tests missing client_id
func TestOAuth2Handler_IssueToken_MissingClientID(t *testing.T) {
	store := auth.NewInMemoryOAuth2Store()
	mockIssuer := &mockJWTIssuer{tokenToReturn: "mock.jwt.token"}
	handler := auth.NewOAuth2Handler(store, mockIssuer)

	req := &auth.TokenRequest{
		GrantType:    "client_credentials",
		ClientID:     "",
		ClientSecret: "secret",
	}

	resp, err := handler.IssueToken(context.Background(), req)
	assert.Nil(t, resp)
	assert.ErrorIs(t, err, auth.ErrMissingClientID)
}

// TestOAuth2Handler_IssueToken_MissingClientSecret tests missing client_secret
func TestOAuth2Handler_IssueToken_MissingClientSecret(t *testing.T) {
	store := auth.NewInMemoryOAuth2Store()
	mockIssuer := &mockJWTIssuer{tokenToReturn: "mock.jwt.token"}
	handler := auth.NewOAuth2Handler(store, mockIssuer)

	req := &auth.TokenRequest{
		GrantType:    "client_credentials",
		ClientID:     uuid.New().String(),
		ClientSecret: "",
	}

	resp, err := handler.IssueToken(context.Background(), req)
	assert.Nil(t, resp)
	assert.ErrorIs(t, err, auth.ErrMissingClientSecret)
}

// TestOAuth2Handler_IssueToken_ClientNotFound tests non-existent client
func TestOAuth2Handler_IssueToken_ClientNotFound(t *testing.T) {
	store := auth.NewInMemoryOAuth2Store()
	mockIssuer := &mockJWTIssuer{tokenToReturn: "mock.jwt.token"}
	handler := auth.NewOAuth2Handler(store, mockIssuer)

	req := &auth.TokenRequest{
		GrantType:    "client_credentials",
		ClientID:     uuid.New().String(),
		ClientSecret: "secret",
	}

	resp, err := handler.IssueToken(context.Background(), req)
	assert.Nil(t, resp)
	assert.ErrorIs(t, err, auth.ErrInvalidClientCredentials)
}

// TestOAuth2Handler_IssueToken_WrongSecret tests incorrect client_secret
func TestOAuth2Handler_IssueToken_WrongSecret(t *testing.T) {
	store := auth.NewInMemoryOAuth2Store()
	ctx := context.Background()

	// Create test client
	secretHash, err := bcrypt.GenerateFromPassword([]byte("correct-secret"), auth.BcryptCost)
	require.NoError(t, err)

	client := &auth.OAuth2Client{
		ClientID:         uuid.New(),
		ClientSecretHash: string(secretHash),
		Name:             "Test Client",
		TenantID:         "tenant-1",
		Scopes:           []string{"read:policies"},
		CreatedAt:        time.Now(),
	}
	require.NoError(t, store.CreateClient(ctx, client))

	mockIssuer := &mockJWTIssuer{tokenToReturn: "mock.jwt.token"}
	handler := auth.NewOAuth2Handler(store, mockIssuer)

	req := &auth.TokenRequest{
		GrantType:    "client_credentials",
		ClientID:     client.ClientID.String(),
		ClientSecret: "wrong-secret",
	}

	resp, err := handler.IssueToken(ctx, req)
	assert.Nil(t, resp)
	assert.ErrorIs(t, err, auth.ErrInvalidClientCredentials)
}

// TestOAuth2Handler_IssueToken_RevokedClient tests revoked client
func TestOAuth2Handler_IssueToken_RevokedClient(t *testing.T) {
	store := auth.NewInMemoryOAuth2Store()
	ctx := context.Background()

	// Create test client
	secretHash, err := bcrypt.GenerateFromPassword([]byte("secret"), auth.BcryptCost)
	require.NoError(t, err)

	client := &auth.OAuth2Client{
		ClientID:         uuid.New(),
		ClientSecretHash: string(secretHash),
		Name:             "Test Client",
		TenantID:         "tenant-1",
		Scopes:           []string{"read:policies"},
		CreatedAt:        time.Now(),
	}
	require.NoError(t, store.CreateClient(ctx, client))

	// Revoke the client
	require.NoError(t, store.RevokeClient(ctx, client.ClientID))

	mockIssuer := &mockJWTIssuer{tokenToReturn: "mock.jwt.token"}
	handler := auth.NewOAuth2Handler(store, mockIssuer)

	req := &auth.TokenRequest{
		GrantType:    "client_credentials",
		ClientID:     client.ClientID.String(),
		ClientSecret: "secret",
	}

	resp, err := handler.IssueToken(ctx, req)
	assert.Nil(t, resp)
	assert.ErrorIs(t, err, auth.ErrInvalidClientCredentials)
}

// TestOAuth2Handler_IssueToken_ExpiredClient tests expired client
func TestOAuth2Handler_IssueToken_ExpiredClient(t *testing.T) {
	store := auth.NewInMemoryOAuth2Store()
	ctx := context.Background()

	// Create test client with past expiration
	secretHash, err := bcrypt.GenerateFromPassword([]byte("secret"), auth.BcryptCost)
	require.NoError(t, err)

	pastTime := time.Now().Add(-1 * time.Hour)
	client := &auth.OAuth2Client{
		ClientID:         uuid.New(),
		ClientSecretHash: string(secretHash),
		Name:             "Test Client",
		TenantID:         "tenant-1",
		Scopes:           []string{"read:policies"},
		CreatedAt:        time.Now(),
		ExpiresAt:        &pastTime,
	}
	require.NoError(t, store.CreateClient(ctx, client))

	mockIssuer := &mockJWTIssuer{tokenToReturn: "mock.jwt.token"}
	handler := auth.NewOAuth2Handler(store, mockIssuer)

	req := &auth.TokenRequest{
		GrantType:    "client_credentials",
		ClientID:     client.ClientID.String(),
		ClientSecret: "secret",
	}

	resp, err := handler.IssueToken(ctx, req)
	assert.Nil(t, resp)
	assert.ErrorIs(t, err, auth.ErrInvalidClientCredentials)
}

// TestOAuth2Handler_IssueToken_InvalidScope tests requesting invalid scope
func TestOAuth2Handler_IssueToken_InvalidScope(t *testing.T) {
	store := auth.NewInMemoryOAuth2Store()
	ctx := context.Background()

	// Create test client with limited scopes
	secretHash, err := bcrypt.GenerateFromPassword([]byte("secret"), auth.BcryptCost)
	require.NoError(t, err)

	client := &auth.OAuth2Client{
		ClientID:         uuid.New(),
		ClientSecretHash: string(secretHash),
		Name:             "Test Client",
		TenantID:         "tenant-1",
		Scopes:           []string{"read:policies"},
		CreatedAt:        time.Now(),
	}
	require.NoError(t, store.CreateClient(ctx, client))

	mockIssuer := &mockJWTIssuer{tokenToReturn: "mock.jwt.token"}
	handler := auth.NewOAuth2Handler(store, mockIssuer)

	req := &auth.TokenRequest{
		GrantType:    "client_credentials",
		ClientID:     client.ClientID.String(),
		ClientSecret: "secret",
		Scope:        "write:policies", // Not allowed
	}

	resp, err := handler.IssueToken(ctx, req)
	assert.Nil(t, resp)
	assert.ErrorIs(t, err, auth.ErrInvalidScope)
}

// TestOAuth2Handler_CreateClient tests client creation
func TestOAuth2Handler_CreateClient(t *testing.T) {
	store := auth.NewInMemoryOAuth2Store()
	mockIssuer := &mockJWTIssuer{tokenToReturn: "mock.jwt.token"}
	handler := auth.NewOAuth2Handler(store, mockIssuer)

	client, err := handler.CreateClient(
		context.Background(),
		"New Client",
		"tenant-1",
		[]string{"read:policies"},
		"client-secret-123",
		nil,
	)

	require.NoError(t, err)
	require.NotNil(t, client)
	assert.NotEqual(t, uuid.Nil, client.ClientID)
	assert.Equal(t, "New Client", client.Name)
	assert.Equal(t, "tenant-1", client.TenantID)
	assert.Equal(t, []string{"read:policies"}, client.Scopes)
	assert.NotEmpty(t, client.ClientSecretHash)

	// Verify secret is hashed with bcrypt
	err = bcrypt.CompareHashAndPassword([]byte(client.ClientSecretHash), []byte("client-secret-123"))
	assert.NoError(t, err)
}

// TestOAuth2Handler_RevokeClient tests client revocation
func TestOAuth2Handler_RevokeClient(t *testing.T) {
	store := auth.NewInMemoryOAuth2Store()
	ctx := context.Background()

	// Create test client
	secretHash, err := bcrypt.GenerateFromPassword([]byte("secret"), auth.BcryptCost)
	require.NoError(t, err)

	client := &auth.OAuth2Client{
		ClientID:         uuid.New(),
		ClientSecretHash: string(secretHash),
		Name:             "Test Client",
		TenantID:         "tenant-1",
		Scopes:           []string{"read:policies"},
		CreatedAt:        time.Now(),
	}
	require.NoError(t, store.CreateClient(ctx, client))

	mockIssuer := &mockJWTIssuer{tokenToReturn: "mock.jwt.token"}
	handler := auth.NewOAuth2Handler(store, mockIssuer)

	// Revoke client
	err = handler.RevokeClient(ctx, client.ClientID)
	require.NoError(t, err)

	// Verify client is revoked
	revokedClient, err := store.GetClient(ctx, client.ClientID)
	assert.ErrorIs(t, err, auth.ErrClientRevoked)
	assert.NotNil(t, revokedClient)
	assert.NotNil(t, revokedClient.RevokedAt)
}

// TestOAuth2Client_IsActive tests client active status check
func TestOAuth2Client_IsActive(t *testing.T) {
	tests := []struct {
		name     string
		client   *auth.OAuth2Client
		expected bool
	}{
		{
			name: "Active client",
			client: &auth.OAuth2Client{
				CreatedAt: time.Now(),
			},
			expected: true,
		},
		{
			name: "Revoked client",
			client: &auth.OAuth2Client{
				CreatedAt: time.Now(),
				RevokedAt: func() *time.Time { t := time.Now(); return &t }(),
			},
			expected: false,
		},
		{
			name: "Expired client",
			client: &auth.OAuth2Client{
				CreatedAt: time.Now(),
				ExpiresAt: func() *time.Time { t := time.Now().Add(-1 * time.Hour); return &t }(),
			},
			expected: false,
		},
		{
			name: "Client with future expiration",
			client: &auth.OAuth2Client{
				CreatedAt: time.Now(),
				ExpiresAt: func() *time.Time { t := time.Now().Add(1 * time.Hour); return &t }(),
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, tt.client.IsActive())
		})
	}
}

// TestOAuth2Client_HasScope tests scope checking
func TestOAuth2Client_HasScope(t *testing.T) {
	client := &auth.OAuth2Client{
		Scopes: []string{"read:policies", "write:policies"},
	}

	assert.True(t, client.HasScope("read:policies"))
	assert.True(t, client.HasScope("write:policies"))
	assert.False(t, client.HasScope("admin:policies"))
	assert.False(t, client.HasScope(""))
}

// Benchmark OAuth2 token issuance
func BenchmarkOAuth2Handler_IssueToken(b *testing.B) {
	store := auth.NewInMemoryOAuth2Store()
	ctx := context.Background()

	// Create test client
	secretHash, _ := bcrypt.GenerateFromPassword([]byte("secret"), auth.BcryptCost)
	client := &auth.OAuth2Client{
		ClientID:         uuid.New(),
		ClientSecretHash: string(secretHash),
		Name:             "Test Client",
		TenantID:         "tenant-1",
		Scopes:           []string{"read:policies"},
		CreatedAt:        time.Now(),
	}
	store.CreateClient(ctx, client)

	mockIssuer := &mockJWTIssuer{tokenToReturn: "mock.jwt.token"}
	handler := auth.NewOAuth2Handler(store, mockIssuer)

	req := &auth.TokenRequest{
		GrantType:    "client_credentials",
		ClientID:     client.ClientID.String(),
		ClientSecret: "secret",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		handler.IssueToken(ctx, req)
	}
}
