package jwt

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Mock RefreshTokenStore for testing
type mockRefreshStore struct {
	tokens map[string]*RefreshToken
}

func newMockRefreshStore() *mockRefreshStore {
	return &mockRefreshStore{
		tokens: make(map[string]*RefreshToken),
	}
}

func (m *mockRefreshStore) Store(ctx context.Context, token *RefreshToken) error {
	m.tokens[token.TokenHash] = token
	return nil
}

func (m *mockRefreshStore) Get(ctx context.Context, tokenHash string) (*RefreshToken, error) {
	token, ok := m.tokens[tokenHash]
	if !ok {
		return nil, assert.AnError
	}
	return token, nil
}

func (m *mockRefreshStore) Revoke(ctx context.Context, tokenHash string) error {
	if token, ok := m.tokens[tokenHash]; ok {
		now := time.Now()
		token.RevokedAt = &now
	}
	return nil
}

func (m *mockRefreshStore) DeleteExpired(ctx context.Context) error {
	return nil
}

func TestNewJWTIssuer(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	tests := []struct {
		name    string
		config  *IssuerConfig
		wantErr bool
	}{
		{
			name:    "nil config",
			config:  nil,
			wantErr: true,
		},
		{
			name: "missing private key",
			config: &IssuerConfig{
				Issuer:   "test-issuer",
				Audience: "test-audience",
			},
			wantErr: true,
		},
		{
			name: "missing issuer",
			config: &IssuerConfig{
				PrivateKey: privateKey,
				Audience:   "test-audience",
			},
			wantErr: true,
		},
		{
			name: "missing audience",
			config: &IssuerConfig{
				PrivateKey: privateKey,
				Issuer:     "test-issuer",
			},
			wantErr: true,
		},
		{
			name: "valid config with defaults",
			config: &IssuerConfig{
				PrivateKey: privateKey,
				Issuer:     "test-issuer",
				Audience:   "test-audience",
			},
			wantErr: false,
		},
		{
			name: "valid config with custom TTLs",
			config: &IssuerConfig{
				PrivateKey: privateKey,
				Issuer:     "test-issuer",
				Audience:   "test-audience",
				AccessTTL:  30 * time.Minute,
				RefreshTTL: 24 * time.Hour,
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			issuer, err := NewJWTIssuer(tt.config)
			if tt.wantErr {
				assert.Error(t, err)
				assert.Nil(t, issuer)
			} else {
				assert.NoError(t, err)
				assert.NotNil(t, issuer)
				// Check defaults are set
				assert.NotZero(t, issuer.accessTTL)
				assert.NotZero(t, issuer.refreshTTL)
			}
		})
	}
}

func TestIssueToken(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	refreshStore := newMockRefreshStore()

	issuer, err := NewJWTIssuer(&IssuerConfig{
		PrivateKey:   privateKey,
		Issuer:       "authz-engine",
		Audience:     "authz-api",
		AccessTTL:    1 * time.Hour,
		RefreshTTL:   7 * 24 * time.Hour,
		RefreshStore: refreshStore,
	})
	require.NoError(t, err)

	ctx := context.Background()

	t.Run("successful token generation", func(t *testing.T) {
		agentID := "agent:service-123"
		roles := []string{"admin", "policy:write"}
		tenantID := "tenant-abc"
		scopes := []string{"read:*", "write:policies"}

		pair, err := issuer.IssueToken(ctx, agentID, roles, tenantID, scopes)
		require.NoError(t, err)
		assert.NotNil(t, pair)

		// Verify token pair structure
		assert.NotEmpty(t, pair.AccessToken)
		assert.Equal(t, "Bearer", pair.TokenType)
		assert.Equal(t, int64(3600), pair.ExpiresIn)
		assert.NotEmpty(t, pair.RefreshToken)
		assert.Contains(t, pair.Scope, "read:*")
		assert.Contains(t, pair.Scope, "write:policies")

		// Parse and verify access token
		token, err := jwt.ParseWithClaims(pair.AccessToken, &Claims{}, func(token *jwt.Token) (interface{}, error) {
			return &privateKey.PublicKey, nil
		})
		require.NoError(t, err)
		assert.True(t, token.Valid)

		claims, ok := token.Claims.(*Claims)
		require.True(t, ok)
		assert.Equal(t, agentID, claims.Subject)
		assert.Equal(t, "authz-engine", claims.Issuer)
		assert.Contains(t, claims.Audience, "authz-api")
		assert.Equal(t, roles, claims.Roles)
		assert.Equal(t, tenantID, claims.TenantID)
		assert.Equal(t, scopes, claims.Scopes)
		assert.NotEmpty(t, claims.ID) // JTI should be set
		assert.NotNil(t, claims.ExpiresAt)
		assert.NotNil(t, claims.IssuedAt)
	})

	t.Run("token has RS256 algorithm", func(t *testing.T) {
		pair, err := issuer.IssueToken(ctx, "agent:test", []string{}, "", []string{})
		require.NoError(t, err)

		token, _ := jwt.Parse(pair.AccessToken, func(token *jwt.Token) (interface{}, error) {
			return &privateKey.PublicKey, nil
		})

		assert.Equal(t, "RS256", token.Method.Alg())
	})

	t.Run("refresh token is stored", func(t *testing.T) {
		beforeCount := len(refreshStore.tokens)

		_, err := issuer.IssueToken(ctx, "agent:test", []string{}, "", []string{})
		require.NoError(t, err)

		assert.Equal(t, beforeCount+1, len(refreshStore.tokens))
	})

	t.Run("tokens are unique", func(t *testing.T) {
		pair1, err := issuer.IssueToken(ctx, "agent:test", []string{}, "", []string{})
		require.NoError(t, err)

		pair2, err := issuer.IssueToken(ctx, "agent:test", []string{}, "", []string{})
		require.NoError(t, err)

		// Access tokens should be different
		assert.NotEqual(t, pair1.AccessToken, pair2.AccessToken)
		// Refresh tokens should be different
		assert.NotEqual(t, pair1.RefreshToken, pair2.RefreshToken)
	})
}

func TestGenerateRefreshToken(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	refreshStore := newMockRefreshStore()

	issuer, err := NewJWTIssuer(&IssuerConfig{
		PrivateKey:   privateKey,
		Issuer:       "authz-engine",
		Audience:     "authz-api",
		RefreshStore: refreshStore,
	})
	require.NoError(t, err)

	ctx := context.Background()

	t.Run("generates valid refresh token", func(t *testing.T) {
		token, err := issuer.GenerateRefreshToken(ctx, "agent:test", "jti-123")
		require.NoError(t, err)
		assert.NotEmpty(t, token)
		assert.Contains(t, token, "refresh_")
	})

	t.Run("tokens are unique", func(t *testing.T) {
		token1, err := issuer.GenerateRefreshToken(ctx, "agent:test", "jti-1")
		require.NoError(t, err)

		token2, err := issuer.GenerateRefreshToken(ctx, "agent:test", "jti-2")
		require.NoError(t, err)

		assert.NotEqual(t, token1, token2)
	})

	t.Run("token is stored in refresh store", func(t *testing.T) {
		beforeCount := len(refreshStore.tokens)

		token, err := issuer.GenerateRefreshToken(ctx, "agent:test", "jti-456")
		require.NoError(t, err)

		assert.Equal(t, beforeCount+1, len(refreshStore.tokens))

		// Verify we can't directly find the token (should be hashed)
		_, exists := refreshStore.tokens[token]
		assert.False(t, exists, "token should be hashed, not stored in plaintext")
	})
}

func TestTokenExpiration(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	// Short TTL for testing
	issuer, err := NewJWTIssuer(&IssuerConfig{
		PrivateKey: privateKey,
		Issuer:     "authz-engine",
		Audience:   "authz-api",
		AccessTTL:  200 * time.Millisecond,
	})
	require.NoError(t, err)

	ctx := context.Background()

	pair, err := issuer.IssueToken(ctx, "agent:test", []string{}, "", []string{})
	require.NoError(t, err)

	// Token should be valid immediately
	token, err := jwt.ParseWithClaims(pair.AccessToken, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return &privateKey.PublicKey, nil
	}, jwt.WithLeeway(5*time.Second)) // Add 5s leeway for clock skew
	require.NoError(t, err)
	assert.True(t, token.Valid)

	// Wait for expiration with extra buffer
	time.Sleep(300 * time.Millisecond)

	// Token should now be expired
	_, err = jwt.ParseWithClaims(pair.AccessToken, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return &privateKey.PublicKey, nil
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "expired")
}

func BenchmarkIssueToken(b *testing.B) {
	privateKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	refreshStore := newMockRefreshStore()

	issuer, _ := NewJWTIssuer(&IssuerConfig{
		PrivateKey:   privateKey,
		Issuer:       "authz-engine",
		Audience:     "authz-api",
		RefreshStore: refreshStore,
	})

	ctx := context.Background()
	agentID := "agent:benchmark"
	roles := []string{"admin"}
	tenantID := "tenant-test"
	scopes := []string{"read:*"}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := issuer.IssueToken(ctx, agentID, roles, tenantID, scopes)
		if err != nil {
			b.Fatal(err)
		}
	}
}
