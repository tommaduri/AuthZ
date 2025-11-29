package tests

import (
	"context"
	"testing"
	"time"

	"authz-engine/internal/auth"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
)

// mockOAuth2Store is an in-memory implementation for testing
type mockOAuth2Store struct {
	clients map[uuid.UUID]*auth.OAuth2Client
}

func newMockOAuth2Store() *mockOAuth2Store {
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
	if _, exists := m.clients[client.ClientID]; exists {
		return auth.ErrClientAlreadyExists
	}
	m.clients[client.ClientID] = client
	return nil
}

func (m *mockOAuth2Store) UpdateClient(ctx context.Context, client *auth.OAuth2Client) error {
	if _, exists := m.clients[client.ClientID]; !exists {
		return auth.ErrClientNotFound
	}
	m.clients[client.ClientID] = client
	return nil
}

func (m *mockOAuth2Store) RevokeClient(ctx context.Context, clientID uuid.UUID) error {
	client, exists := m.clients[clientID]
	if !exists {
		return auth.ErrClientNotFound
	}
	now := time.Now()
	client.RevokedAt = &now
	return nil
}

func (m *mockOAuth2Store) ListClientsByTenant(ctx context.Context, tenantID string) ([]*auth.OAuth2Client, error) {
	var clients []*auth.OAuth2Client
	for _, client := range m.clients {
		if client.TenantID == tenantID {
			clients = append(clients, client)
		}
	}
	return clients, nil
}

func (m *mockOAuth2Store) DeleteClient(ctx context.Context, clientID uuid.UUID) error {
	if _, exists := m.clients[clientID]; !exists {
		return auth.ErrClientNotFound
	}
	delete(m.clients, clientID)
	return nil
}

func TestOAuth2Handler_IssueToken_Success(t *testing.T) {
	// Setup
	store := newMockOAuth2Store()
	jwtIssuer, err := auth.NewJWTIssuer("test-issuer", []byte("test-secret-key-32-bytes-long!!"))
	require.NoError(t, err)

	handler := auth.NewOAuth2Handler(store, jwtIssuer)

	// Create test client
	clientID := uuid.New()
	clientSecret := "super-secret-password"
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

	// Test token issuance
	req := &auth.TokenRequest{
		GrantType:    auth.GrantTypeClientCredentials,
		ClientID:     clientID.String(),
		ClientSecret: clientSecret,
		Scope:        "read write",
	}

	resp, err := handler.IssueToken(context.Background(), req)
	require.NoError(t, err)
	assert.NotEmpty(t, resp.AccessToken)
	assert.Equal(t, "Bearer", resp.TokenType)
	assert.Greater(t, resp.ExpiresIn, int64(0))
	assert.Equal(t, "read write", resp.Scope)
}

func TestOAuth2Handler_IssueToken_InvalidGrantType(t *testing.T) {
	store := newMockOAuth2Store()
	jwtIssuer, err := auth.NewJWTIssuer("test-issuer", []byte("test-secret-key-32-bytes-long!!"))
	require.NoError(t, err)

	handler := auth.NewOAuth2Handler(store, jwtIssuer)

	req := &auth.TokenRequest{
		GrantType:    "authorization_code",
		ClientID:     uuid.New().String(),
		ClientSecret: "secret",
	}

	_, err = handler.IssueToken(context.Background(), req)
	assert.ErrorIs(t, err, auth.ErrInvalidGrantType)
}

func TestOAuth2Handler_IssueToken_InvalidCredentials(t *testing.T) {
	store := newMockOAuth2Store()
	jwtIssuer, err := auth.NewJWTIssuer("test-issuer", []byte("test-secret-key-32-bytes-long!!"))
	require.NoError(t, err)

	handler := auth.NewOAuth2Handler(store, jwtIssuer)

	// Create client with known password
	clientID := uuid.New()
	secretHash, _ := bcrypt.GenerateFromPassword([]byte("correct-password"), auth.BcryptCost)

	client := &auth.OAuth2Client{
		ClientID:         clientID,
		ClientSecretHash: string(secretHash),
		Name:             "Test Client",
		TenantID:         "tenant-123",
		Scopes:           []string{"read"},
		CreatedAt:        time.Now(),
	}

	store.CreateClient(context.Background(), client)

	// Try with wrong password
	req := &auth.TokenRequest{
		GrantType:    auth.GrantTypeClientCredentials,
		ClientID:     clientID.String(),
		ClientSecret: "wrong-password",
	}

	_, err = handler.IssueToken(context.Background(), req)
	assert.ErrorIs(t, err, auth.ErrInvalidClientCredentials)
}

func TestOAuth2Handler_IssueToken_InvalidScope(t *testing.T) {
	store := newMockOAuth2Store()
	jwtIssuer, err := auth.NewJWTIssuer("test-issuer", []byte("test-secret-key-32-bytes-long!!"))
	require.NoError(t, err)

	handler := auth.NewOAuth2Handler(store, jwtIssuer)

	clientID := uuid.New()
	clientSecret := "password"
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

	// Request unauthorized scope
	req := &auth.TokenRequest{
		GrantType:    auth.GrantTypeClientCredentials,
		ClientID:     clientID.String(),
		ClientSecret: clientSecret,
		Scope:        "admin delete",
	}

	_, err = handler.IssueToken(context.Background(), req)
	assert.ErrorIs(t, err, auth.ErrInvalidScope)
}

func TestOAuth2Handler_IssueToken_RevokedClient(t *testing.T) {
	store := newMockOAuth2Store()
	jwtIssuer, err := auth.NewJWTIssuer("test-issuer", []byte("test-secret-key-32-bytes-long!!"))
	require.NoError(t, err)

	handler := auth.NewOAuth2Handler(store, jwtIssuer)

	clientID := uuid.New()
	clientSecret := "password"
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
	store.RevokeClient(context.Background(), clientID)

	req := &auth.TokenRequest{
		GrantType:    auth.GrantTypeClientCredentials,
		ClientID:     clientID.String(),
		ClientSecret: clientSecret,
	}

	_, err = handler.IssueToken(context.Background(), req)
	assert.ErrorIs(t, err, auth.ErrInvalidClientCredentials)
}

func TestOAuth2Handler_CreateClient(t *testing.T) {
	store := newMockOAuth2Store()
	jwtIssuer, err := auth.NewJWTIssuer("test-issuer", []byte("test-secret-key-32-bytes-long!!"))
	require.NoError(t, err)

	handler := auth.NewOAuth2Handler(store, jwtIssuer)

	secret := "client-secret-123"
	expiresAt := time.Now().Add(24 * time.Hour)

	client, err := handler.CreateClient(
		context.Background(),
		"Test Client",
		"tenant-123",
		[]string{"read", "write"},
		secret,
		&expiresAt,
	)

	require.NoError(t, err)
	assert.NotEqual(t, uuid.Nil, client.ClientID)
	assert.Equal(t, "Test Client", client.Name)
	assert.Equal(t, "tenant-123", client.TenantID)
	assert.Equal(t, []string{"read", "write"}, client.Scopes)

	// Verify secret is hashed correctly
	err = bcrypt.CompareHashAndPassword([]byte(client.ClientSecretHash), []byte(secret))
	assert.NoError(t, err)
}

func TestOAuth2Client_IsActive(t *testing.T) {
	tests := []struct {
		name      string
		client    *auth.OAuth2Client
		expected  bool
	}{
		{
			name: "Active client",
			client: &auth.OAuth2Client{
				ClientID:  uuid.New(),
				RevokedAt: nil,
				ExpiresAt: nil,
			},
			expected: true,
		},
		{
			name: "Revoked client",
			client: &auth.OAuth2Client{
				ClientID:  uuid.New(),
				RevokedAt: &time.Time{},
			},
			expected: false,
		},
		{
			name: "Expired client",
			client: func() *auth.OAuth2Client {
				past := time.Now().Add(-1 * time.Hour)
				return &auth.OAuth2Client{
					ClientID:  uuid.New(),
					ExpiresAt: &past,
				}
			}(),
			expected: false,
		},
		{
			name: "Not yet expired",
			client: func() *auth.OAuth2Client {
				future := time.Now().Add(1 * time.Hour)
				return &auth.OAuth2Client{
					ClientID:  uuid.New(),
					ExpiresAt: &future,
				}
			}(),
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, tt.client.IsActive())
		})
	}
}

func TestOAuth2Client_HasScope(t *testing.T) {
	client := &auth.OAuth2Client{
		Scopes: []string{"read", "write", "admin"},
	}

	assert.True(t, client.HasScope("read"))
	assert.True(t, client.HasScope("write"))
	assert.True(t, client.HasScope("admin"))
	assert.False(t, client.HasScope("delete"))
	assert.False(t, client.HasScope(""))
}
