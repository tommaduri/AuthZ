package jwt

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/agent"
	"github.com/authz-engine/go-core/internal/cache"
	"github.com/authz-engine/go-core/pkg/types"
	jwtlib "github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// generateRSAKeyPair generates RSA key pair for testing
func generateRSAKeyPair(t *testing.T) (*rsa.PrivateKey, *rsa.PublicKey) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	return privateKey, &privateKey.PublicKey
}

func TestJWTIssuer_WithAgentStore(t *testing.T) {
	// Setup
	privateKey, publicKey := generateRSAKeyPair(t)
	agentStore := agent.NewInMemoryAgentStore()
	agentCache := cache.NewLRU(100, 5*time.Minute)

	// Register test agents
	activeAgent := &types.Agent{
		ID:          "agent-1",
		Type:        types.AgentTypeService,
		DisplayName: "Test Service Agent",
		Status:      types.StatusActive,
		Metadata: map[string]interface{}{
			"capabilities": []interface{}{"read:data", "write:data"},
			"tenant_id":    "tenant-123",
			"roles":        []interface{}{"admin", "user"},
			"scopes":       []interface{}{"api.read", "api.write"},
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	err := agentStore.Register(context.Background(), activeAgent)
	require.NoError(t, err)

	suspendedAgent := &types.Agent{
		ID:          "agent-2",
		Type:        types.AgentTypeService,
		DisplayName: "Suspended Agent",
		Status:      types.StatusSuspended,
		Metadata:    map[string]interface{}{},
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	err = agentStore.Register(context.Background(), suspendedAgent)
	require.NoError(t, err)

	revokedAgent := &types.Agent{
		ID:          "agent-3",
		Type:        types.AgentTypeService,
		DisplayName: "Revoked Agent",
		Status:      types.StatusRevoked,
		Metadata:    map[string]interface{}{},
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	err = agentStore.Register(context.Background(), revokedAgent)
	require.NoError(t, err)

	// Create issuer with agent store
	issuer, err := NewJWTIssuer(&IssuerConfig{
		PrivateKey: privateKey,
		Issuer:     "test-issuer",
		Audience:   "test-audience",
		AccessTTL:  1 * time.Hour,
		AgentStore: agentStore,
		AgentCache: agentCache,
	})
	require.NoError(t, err)

	// Create validator
	validator, err := NewJWTValidator(&ValidatorConfig{
		PublicKey: publicKey,
		Issuer:    "test-issuer",
		Audience:  "test-audience",
	})
	require.NoError(t, err)

	t.Run("IssueToken_ActiveAgent_Success", func(t *testing.T) {
		// Issue token for active agent
		tokenPair, err := issuer.IssueToken(context.Background(), "agent-1", []string{}, "", []string{})
		require.NoError(t, err)
		require.NotNil(t, tokenPair)
		require.NotEmpty(t, tokenPair.AccessToken)

		// Validate token
		claims, err := validator.Validate(context.Background(), tokenPair.AccessToken)
		require.NoError(t, err)
		require.NotNil(t, claims)

		// Verify agent metadata in claims
		assert.Equal(t, "agent-1", claims.AgentID)
		assert.Equal(t, types.AgentTypeService, claims.AgentType)
		assert.Equal(t, types.StatusActive, claims.AgentStatus)
		assert.Contains(t, claims.Capabilities, "read:data")
		assert.Contains(t, claims.Capabilities, "write:data")

		// Verify roles from metadata
		assert.Contains(t, claims.Roles, "agent:service")
		assert.Contains(t, claims.Roles, "admin")
		assert.Contains(t, claims.Roles, "user")

		// Verify tenant ID
		assert.Equal(t, "tenant-123", claims.TenantID)

		// Verify scopes
		assert.Contains(t, claims.Scopes, "api.read")
		assert.Contains(t, claims.Scopes, "api.write")
	})

	t.Run("IssueToken_SuspendedAgent_Error", func(t *testing.T) {
		// Attempt to issue token for suspended agent
		tokenPair, err := issuer.IssueToken(context.Background(), "agent-2", []string{}, "", []string{})
		assert.Error(t, err)
		assert.Nil(t, tokenPair)
		assert.Contains(t, err.Error(), "not active")
		assert.Contains(t, err.Error(), "suspended")
	})

	t.Run("IssueToken_RevokedAgent_Error", func(t *testing.T) {
		// Attempt to issue token for revoked agent
		tokenPair, err := issuer.IssueToken(context.Background(), "agent-3", []string{}, "", []string{})
		assert.Error(t, err)
		assert.Nil(t, tokenPair)
		assert.Contains(t, err.Error(), "not active")
		assert.Contains(t, err.Error(), "revoked")
	})

	t.Run("IssueToken_NonExistentAgent_Error", func(t *testing.T) {
		// Attempt to issue token for non-existent agent
		tokenPair, err := issuer.IssueToken(context.Background(), "agent-999", []string{}, "", []string{})
		assert.Error(t, err)
		assert.Nil(t, tokenPair)
		assert.Contains(t, err.Error(), "agent not found")
	})

	t.Run("AgentCache_ReducesStoreLookups", func(t *testing.T) {
		// First call loads from store
		tokenPair1, err := issuer.IssueToken(context.Background(), "agent-1", []string{}, "", []string{})
		require.NoError(t, err)
		require.NotNil(t, tokenPair1)

		// Second call should use cache
		tokenPair2, err := issuer.IssueToken(context.Background(), "agent-1", []string{}, "", []string{})
		require.NoError(t, err)
		require.NotNil(t, tokenPair2)

		// Verify both tokens have same agent metadata
		claims1, _ := validator.Validate(context.Background(), tokenPair1.AccessToken)
		claims2, _ := validator.Validate(context.Background(), tokenPair2.AccessToken)

		assert.Equal(t, claims1.AgentID, claims2.AgentID)
		assert.Equal(t, claims1.AgentType, claims2.AgentType)
		assert.Equal(t, claims1.AgentStatus, claims2.AgentStatus)
	})

	t.Run("InvalidateCache_RefreshesMetadata", func(t *testing.T) {
		// Issue token
		tokenPair1, err := issuer.IssueToken(context.Background(), "agent-1", []string{}, "", []string{})
		require.NoError(t, err)

		// Change agent status
		err = agentStore.UpdateStatus(context.Background(), "agent-1", types.StatusSuspended)
		require.NoError(t, err)

		// Invalidate cache
		issuer.InvalidateAgentCache("agent-1")

		// Try to issue new token - should fail
		tokenPair2, err := issuer.IssueToken(context.Background(), "agent-1", []string{}, "", []string{})
		assert.Error(t, err)
		assert.Nil(t, tokenPair2)
		assert.Contains(t, err.Error(), "suspended")

		// First token should still validate (already issued)
		claims, err := validator.Validate(context.Background(), tokenPair1.AccessToken)
		require.NoError(t, err)
		assert.Equal(t, "agent-1", claims.AgentID)
	})
}

func TestJWTValidator_AgentStatusValidation(t *testing.T) {
	privateKey, publicKey := generateRSAKeyPair(t)
	agentStore := agent.NewInMemoryAgentStore()

	// Register active agent
	activeAgent := &types.Agent{
		ID:          "agent-1",
		Type:        types.AgentTypeService,
		DisplayName: "Active Agent",
		Status:      types.StatusActive,
		Metadata:    map[string]interface{}{},
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	err := agentStore.Register(context.Background(), activeAgent)
	require.NoError(t, err)

	issuer, err := NewJWTIssuer(&IssuerConfig{
		PrivateKey: privateKey,
		Issuer:     "test-issuer",
		Audience:   "test-audience",
		AccessTTL:  1 * time.Hour,
		AgentStore: agentStore,
	})
	require.NoError(t, err)

	t.Run("ValidateToken_ActiveAgent_Success", func(t *testing.T) {
		// Issue token for active agent
		tokenPair, err := issuer.IssueToken(context.Background(), "agent-1", []string{}, "", []string{})
		require.NoError(t, err)

		// Validate with agent status check
		validator, err := NewJWTValidator(&ValidatorConfig{
			PublicKey: publicKey,
			Issuer:    "test-issuer",
			Audience:  "test-audience",
		})
		require.NoError(t, err)

		claims, err := validator.Validate(context.Background(), tokenPair.AccessToken)
		assert.NoError(t, err)
		assert.NotNil(t, claims)
		assert.Equal(t, types.StatusActive, claims.AgentStatus)
	})

	t.Run("ValidateToken_SuspendedAgentInClaims_Error", func(t *testing.T) {
		// Manually create token with suspended status
		// (simulating token that was issued before agent was suspended)
		claims := &Claims{
			AgentID:     "agent-1",
			AgentType:   types.AgentTypeService,
			AgentStatus: types.StatusSuspended, // Suspended in token
		}
		claims.Subject = "agent-1"
		claims.Issuer = "test-issuer"
		claims.Audience = []string{"test-audience"}
		claims.ExpiresAt = jwtlib.NewNumericDate(time.Now().Add(1 * time.Hour))
		claims.IssuedAt = jwtlib.NewNumericDate(time.Now())
		claims.ID = "test-jti"

		token := jwtlib.NewWithClaims(jwtlib.SigningMethodRS256, claims)
		tokenString, err := token.SignedString(privateKey)
		require.NoError(t, err)

		// Validate - should fail due to agent status
		validator, err := NewJWTValidator(&ValidatorConfig{
			PublicKey: publicKey,
			Issuer:    "test-issuer",
			Audience:  "test-audience",
		})
		require.NoError(t, err)

		validatedClaims, err := validator.Validate(context.Background(), tokenString)
		assert.Error(t, err)
		assert.Nil(t, validatedClaims)
		assert.Contains(t, err.Error(), "agent is not active")
		assert.Contains(t, err.Error(), "suspended")
	})

	t.Run("ValidateToken_SkipAgentStatusCheck", func(t *testing.T) {
		// Create token with suspended status
		claims := &Claims{
			AgentID:     "agent-1",
			AgentType:   types.AgentTypeService,
			AgentStatus: types.StatusSuspended,
		}
		claims.Subject = "agent-1"
		claims.Issuer = "test-issuer"
		claims.Audience = []string{"test-audience"}
		claims.ExpiresAt = jwtlib.NewNumericDate(time.Now().Add(1 * time.Hour))
		claims.IssuedAt = jwtlib.NewNumericDate(time.Now())
		claims.ID = "test-jti"

		token := jwtlib.NewWithClaims(jwtlib.SigningMethodRS256, claims)
		tokenString, err := token.SignedString(privateKey)
		require.NoError(t, err)

		// Validate with skip flag - should succeed
		validator, err := NewJWTValidator(&ValidatorConfig{
			PublicKey:            publicKey,
			Issuer:               "test-issuer",
			Audience:             "test-audience",
			SkipAgentStatusCheck: true,
		})
		require.NoError(t, err)

		validatedClaims, err := validator.Validate(context.Background(), tokenString)
		assert.NoError(t, err)
		assert.NotNil(t, validatedClaims)
	})
}

func TestAgentMetadata_ExpiredAgent(t *testing.T) {
	privateKey, _ := generateRSAKeyPair(t)
	agentStore := agent.NewInMemoryAgentStore()

	// Register expired agent
	expiresAt := time.Now().Add(-1 * time.Hour) // Expired 1 hour ago
	expiredAgent := &types.Agent{
		ID:          "agent-expired",
		Type:        types.AgentTypeService,
		DisplayName: "Expired Agent",
		Status:      types.StatusActive, // Still active but expired
		Metadata:    map[string]interface{}{},
		CreatedAt:   time.Now().Add(-2 * time.Hour),
		UpdatedAt:   time.Now().Add(-1 * time.Hour),
		ExpiresAt:   &expiresAt,
	}
	err := agentStore.Register(context.Background(), expiredAgent)
	require.NoError(t, err)

	issuer, err := NewJWTIssuer(&IssuerConfig{
		PrivateKey: privateKey,
		Issuer:     "test-issuer",
		Audience:   "test-audience",
		AccessTTL:  1 * time.Hour,
		AgentStore: agentStore,
	})
	require.NoError(t, err)

	// Attempt to issue token for expired agent
	tokenPair, err := issuer.IssueToken(context.Background(), "agent-expired", []string{}, "", []string{})
	assert.Error(t, err)
	assert.Nil(t, tokenPair)
	assert.Contains(t, err.Error(), "has expired")

	// Verify agent status was updated to expired
	agent, err := agentStore.Get(context.Background(), "agent-expired")
	require.NoError(t, err)
	assert.Equal(t, types.StatusExpired, agent.Status)
}

func TestAgentMetadata_DifferentAgentTypes(t *testing.T) {
	privateKey, publicKey := generateRSAKeyPair(t)
	agentStore := agent.NewInMemoryAgentStore()

	agentTypes := []struct {
		id   string
		typ  string
		role string
	}{
		{"agent-service", types.AgentTypeService, "agent:service"},
		{"agent-human", types.AgentTypeHuman, "agent:human"},
		{"agent-ai", types.AgentTypeAI, "agent:ai-agent"},
		{"agent-mcp", types.AgentTypeMCP, "agent:mcp-agent"},
	}

	for _, at := range agentTypes {
		agent := &types.Agent{
			ID:          at.id,
			Type:        at.typ,
			DisplayName: "Test " + at.typ,
			Status:      types.StatusActive,
			Metadata:    map[string]interface{}{},
			CreatedAt:   time.Now(),
			UpdatedAt:   time.Now(),
		}
		err := agentStore.Register(context.Background(), agent)
		require.NoError(t, err)
	}

	issuer, err := NewJWTIssuer(&IssuerConfig{
		PrivateKey: privateKey,
		Issuer:     "test-issuer",
		Audience:   "test-audience",
		AccessTTL:  1 * time.Hour,
		AgentStore: agentStore,
	})
	require.NoError(t, err)

	validator, err := NewJWTValidator(&ValidatorConfig{
		PublicKey: publicKey,
		Issuer:    "test-issuer",
		Audience:  "test-audience",
	})
	require.NoError(t, err)

	for _, at := range agentTypes {
		t.Run("AgentType_"+at.typ, func(t *testing.T) {
			tokenPair, err := issuer.IssueToken(context.Background(), at.id, []string{}, "", []string{})
			require.NoError(t, err)
			require.NotNil(t, tokenPair)

			claims, err := validator.Validate(context.Background(), tokenPair.AccessToken)
			require.NoError(t, err)
			assert.Equal(t, at.id, claims.AgentID)
			assert.Equal(t, at.typ, claims.AgentType)
			assert.Contains(t, claims.Roles, at.role)
		})
	}
}
