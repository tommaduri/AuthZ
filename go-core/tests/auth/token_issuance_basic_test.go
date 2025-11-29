package auth_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"fmt"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/agent"
	"github.com/authz-engine/go-core/internal/auth"
	"github.com/authz-engine/go-core/internal/auth/jwt"
	"github.com/authz-engine/go-core/internal/cache"
	"github.com/authz-engine/go-core/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// MockAgentStore implements agent.AgentStore for testing
type MockAgentStore struct {
	agents map[string]*types.Agent
}

func NewMockAgentStore() *MockAgentStore {
	return &MockAgentStore{
		agents: make(map[string]*types.Agent),
	}
}

func (m *MockAgentStore) Register(ctx context.Context, agent *types.Agent) error {
	m.agents[agent.ID] = agent
	return nil
}

func (m *MockAgentStore) Get(ctx context.Context, id string) (*types.Agent, error) {
	agent, ok := m.agents[id]
	if !ok {
		return nil, fmt.Errorf("agent not found")
	}
	return agent, nil
}

func (m *MockAgentStore) UpdateStatus(ctx context.Context, id string, status string) error {
	if agent, ok := m.agents[id]; ok {
		agent.Status = status
		return nil
	}
	return fmt.Errorf("agent not found")
}

func (m *MockAgentStore) Revoke(ctx context.Context, id string) error {
	return m.UpdateStatus(ctx, id, types.StatusRevoked)
}

func (m *MockAgentStore) List(ctx context.Context, filters agent.AgentFilters) ([]*types.Agent, error) {
	result := []*types.Agent{}
	for _, agent := range m.agents {
		result = append(result, agent)
	}
	return result, nil
}

func (m *MockAgentStore) AddCredential(ctx context.Context, agentID string, credential types.Credential) error {
	if agent, ok := m.agents[agentID]; ok {
		agent.Credentials = append(agent.Credentials, credential)
		return nil
	}
	return fmt.Errorf("agent not found")
}

func (m *MockAgentStore) RevokeCredential(ctx context.Context, agentID string, credentialID string) error {
	return nil
}

// MockRefreshStore implements jwt.RefreshTokenStore for testing
type MockRefreshStore struct {
	tokens map[string]*jwt.RefreshToken
}

func NewMockRefreshStore() *MockRefreshStore {
	return &MockRefreshStore{
		tokens: make(map[string]*jwt.RefreshToken),
	}
}

func (m *MockRefreshStore) Store(ctx context.Context, token *jwt.RefreshToken) error {
	m.tokens[token.TokenHash] = token
	return nil
}

func (m *MockRefreshStore) Get(ctx context.Context, tokenHash string) (*jwt.RefreshToken, error) {
	token, ok := m.tokens[tokenHash]
	if !ok {
		return nil, fmt.Errorf("refresh token not found")
	}
	return token, nil
}

func (m *MockRefreshStore) Revoke(ctx context.Context, tokenHash string) error {
	if token, ok := m.tokens[tokenHash]; ok {
		now := time.Now()
		token.RevokedAt = &now
	}
	return nil
}

func (m *MockRefreshStore) DeleteExpired(ctx context.Context) error {
	return nil
}

// TestPasswordValidation tests password validation rules
func TestPasswordValidation(t *testing.T) {
	tests := []struct {
		name     string
		password string
		wantErr  bool
	}{
		{"valid password", "SecureP@ss123", false},
		{"too short", "Pass1!", true},
		{"no uppercase", "securep@ss123", true},
		{"no lowercase", "SECUREP@SS123", true},
		{"no digit", "SecureP@ss", true},
		{"no special char", "SecurePass123", true},
		{"empty", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := auth.ValidatePassword(tt.password)
			if tt.wantErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

// TestPasswordHashing tests password hashing and verification
func TestPasswordHashing(t *testing.T) {
	password := "SecureP@ss123"

	// Hash password
	hash, err := auth.HashPassword(password)
	require.NoError(t, err)
	assert.NotEmpty(t, hash)
	assert.NotEqual(t, password, hash, "Hash should not equal plaintext")

	// Verify correct password
	valid := auth.VerifyPassword(password, hash)
	assert.True(t, valid)

	// Verify incorrect password
	valid = auth.VerifyPassword("WrongPassword", hash)
	assert.False(t, valid)
}

// TestTokenIssuerBasic tests basic token issuance functionality
func TestTokenIssuerBasic(t *testing.T) {
	// Setup
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	agentStore := NewMockAgentStore()
	refreshStore := NewMockRefreshStore()
	agentCache := cache.NewLRU(100, 5*time.Minute)

	issuer, err := auth.NewTokenIssuer(&auth.TokenIssuerConfig{
		PrivateKey:   privateKey,
		Issuer:       "authz-engine-test",
		Audience:     "authz-api-test",
		AccessTTL:    1 * time.Hour,
		RefreshTTL:   7 * 24 * time.Hour,
		RefreshStore: refreshStore,
		AgentStore:   agentStore,
		AgentCache:   agentCache,
		RedisClient:  nil, // Mock or nil for basic tests
		Logger:       zap.NewNop(),
	})
	require.NoError(t, err)

	// Create test agent
	agentID := "test-agent-123"
	password := "SecureP@ss123"
	tenantID := "tenant-123"

	passwordHash, err := auth.HashPassword(password)
	require.NoError(t, err)

	testAgent := &types.Agent{
		ID:          agentID,
		Type:        types.AgentTypeService,
		Status:      types.StatusActive,
		DisplayName: "Test Agent",
		Metadata: map[string]interface{}{
			"tenant_id":     tenantID,
			"password_hash": passwordHash,
			"roles":         []string{"admin", "policy:write"},
			"scopes":        []string{"read:*", "write:policies"},
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	err = agentStore.Register(context.Background(), testAgent)
	require.NoError(t, err)

	// Test: Issue token with valid credentials
	t.Run("IssueTokenSuccess", func(t *testing.T) {
		tokenPair, err := issuer.IssueToken(agentID, password, tenantID)
		require.NoError(t, err)
		assert.NotEmpty(t, tokenPair.AccessToken)
		assert.NotEmpty(t, tokenPair.RefreshToken)
		assert.Equal(t, "Bearer", tokenPair.TokenType)
		assert.Greater(t, tokenPair.ExpiresIn, int64(0))
	})

	// Test: Issue token with invalid password
	t.Run("IssueTokenInvalidPassword", func(t *testing.T) {
		_, err := issuer.IssueToken(agentID, "WrongPassword123!", tenantID)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid credentials")
	})

	// Test: Issue token for nonexistent agent
	t.Run("IssueTokenNonexistentAgent", func(t *testing.T) {
		_, err := issuer.IssueToken("nonexistent-agent", password, tenantID)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "agent not found")
	})

	// Test: Issue token for inactive agent
	t.Run("IssueTokenInactiveAgent", func(t *testing.T) {
		inactiveAgent := &types.Agent{
			ID:          "inactive-agent",
			Type:        types.AgentTypeService,
			Status:      types.StatusSuspended,
			DisplayName: "Inactive Agent",
			Metadata: map[string]interface{}{
				"tenant_id":     tenantID,
				"password_hash": passwordHash,
			},
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		err := agentStore.Register(context.Background(), inactiveAgent)
		require.NoError(t, err)

		_, err = issuer.IssueToken("inactive-agent", password, tenantID)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "not active")
	})
}

// Note: TestPasswordStrength commented out as ValidatePasswordStrength is not required for MVP
// Uncomment if/when password strength scoring is needed
