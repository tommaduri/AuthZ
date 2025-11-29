package integration_test

import (
	"context"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/agent"
	"github.com/authz-engine/go-core/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAgentService_RegisterAndValidate tests agent registration and authorization validation
func TestAgentService_RegisterAndValidate(t *testing.T) {
	store := agent.NewInMemoryAgentStore()
	service := agent.NewService(store)
	ctx := context.Background()

	// Register agent
	expiry := time.Now().Add(24 * time.Hour)
	req := &agent.RegisterAgentRequest{
		ID:          "service-api-001",
		Type:        types.AgentTypeService,
		DisplayName: "Payment API Service",
		Credentials: []types.Credential{
			{
				ID:       "api-key-001",
				Type:     "api-key",
				Value:    "hashed-api-key-value",
				IssuedAt: time.Now(),
			},
		},
		Metadata: map[string]interface{}{
			"service": "payment-api",
			"version": "v1.0.0",
		},
		ExpiresAt: &expiry,
	}

	registeredAgent, err := service.RegisterAgent(ctx, req)
	require.NoError(t, err)
	assert.Equal(t, "service-api-001", registeredAgent.ID)
	assert.Equal(t, types.StatusActive, registeredAgent.Status)

	// Validate agent for authorization
	err = service.ValidateAgentForAuthorization(ctx, "service-api-001")
	require.NoError(t, err)
}

// TestAgentService_StatusTransitions tests agent status lifecycle
func TestAgentService_StatusTransitions(t *testing.T) {
	store := agent.NewInMemoryAgentStore()
	service := agent.NewService(store)
	ctx := context.Background()

	// Register agent
	req := &agent.RegisterAgentRequest{
		ID:          "ai-agent-001",
		Type:        types.AgentTypeAI,
		DisplayName: "GitHub Assistant",
		Credentials: []types.Credential{
			{
				ID:       "oauth-token-001",
				Type:     "oauth-token",
				Value:    "hashed-token",
				IssuedAt: time.Now(),
			},
		},
		Metadata: make(map[string]interface{}),
	}

	_, err := service.RegisterAgent(ctx, req)
	require.NoError(t, err)

	// Suspend agent
	err = service.SuspendAgent(ctx, "ai-agent-001", "Policy violation")
	require.NoError(t, err)

	// Validate should fail (suspended)
	err = service.ValidateAgentForAuthorization(ctx, "ai-agent-001")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not active")

	// Reactivate agent
	err = service.ReactivateAgent(ctx, "ai-agent-001")
	require.NoError(t, err)

	// Validate should succeed (active)
	err = service.ValidateAgentForAuthorization(ctx, "ai-agent-001")
	require.NoError(t, err)

	// Revoke agent
	err = service.RevokeAgent(ctx, "ai-agent-001", "Security breach")
	require.NoError(t, err)

	// Validate should fail (revoked)
	err = service.ValidateAgentForAuthorization(ctx, "ai-agent-001")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not active")

	// Reactivate should fail (cannot reactivate revoked)
	err = service.ReactivateAgent(ctx, "ai-agent-001")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "cannot reactivate a revoked agent")
}

// TestAgentService_CredentialRotation tests credential lifecycle
func TestAgentService_CredentialRotation(t *testing.T) {
	store := agent.NewInMemoryAgentStore()
	service := agent.NewService(store)
	ctx := context.Background()

	// Register agent with initial credential
	req := &agent.RegisterAgentRequest{
		ID:          "service-002",
		Type:        types.AgentTypeService,
		DisplayName: "Data Service",
		Credentials: []types.Credential{
			{
				ID:       "old-api-key",
				Type:     "api-key",
				Value:    "old-hashed-key",
				IssuedAt: time.Now(),
			},
		},
		Metadata: make(map[string]interface{}),
	}

	_, err := service.RegisterAgent(ctx, req)
	require.NoError(t, err)

	// Rotate credential
	newCredReq := &agent.AddCredentialRequest{
		ID:    "new-api-key",
		Type:  "api-key",
		Value: "new-hashed-key",
	}

	err = service.RotateCredential(ctx, "service-002", "old-api-key", newCredReq)
	require.NoError(t, err)

	// Verify only new credential exists
	retrievedAgent, err := service.GetAgent(ctx, "service-002")
	require.NoError(t, err)
	assert.Len(t, retrievedAgent.Credentials, 1)
	assert.Equal(t, "new-api-key", retrievedAgent.Credentials[0].ID)
}

// TestAgent_ToPrincipal_Integration tests Agent to Principal conversion
func TestAgent_ToPrincipal_Integration(t *testing.T) {
	store := agent.NewInMemoryAgentStore()
	service := agent.NewService(store)
	ctx := context.Background()

	// Register agent with custom roles in metadata
	req := &agent.RegisterAgentRequest{
		ID:          "mcp-agent-001",
		Type:        types.AgentTypeMCP,
		DisplayName: "GitHub MCP Agent",
		Credentials: []types.Credential{
			{
				ID:       "ed25519-key-001",
				Type:     "ed25519-key",
				Value:    "hashed-ed25519-public-key",
				IssuedAt: time.Now(),
			},
		},
		Metadata: map[string]interface{}{
			"roles":              []string{"github-reader", "issue-manager"},
			"mcp_protocol_version": "1.0",
			"capabilities":       []string{"github.read", "github.write"},
		},
	}

	registeredAgent, err := service.RegisterAgent(ctx, req)
	require.NoError(t, err)

	// Convert to Principal for authorization
	principal := registeredAgent.ToPrincipal()

	require.NotNil(t, principal)
	assert.Equal(t, "mcp-agent-001", principal.ID)

	// Check base role
	assert.Contains(t, principal.Roles, "agent:mcp-agent")

	// Check custom roles from metadata
	assert.Contains(t, principal.Roles, "github-reader")
	assert.Contains(t, principal.Roles, "issue-manager")

	// Check metadata copied to attributes
	assert.Equal(t, "1.0", principal.Attributes["mcp_protocol_version"])
}

// TestAgentService_ExpirationHandling tests automatic expiration detection
func TestAgentService_ExpirationHandling(t *testing.T) {
	store := agent.NewInMemoryAgentStore()
	service := agent.NewService(store)
	ctx := context.Background()

	// Register agent that will expire soon
	expiry := time.Now().Add(100 * time.Millisecond)
	req := &agent.RegisterAgentRequest{
		ID:          "temp-agent-001",
		Type:        types.AgentTypeService,
		DisplayName: "Temporary Service",
		Credentials: []types.Credential{
			{
				ID:       "temp-key",
				Type:     "api-key",
				Value:    "hashed-temp-key",
				IssuedAt: time.Now(),
			},
		},
		Metadata:  make(map[string]interface{}),
		ExpiresAt: &expiry,
	}

	_, err := service.RegisterAgent(ctx, req)
	require.NoError(t, err)

	// Initially should be valid
	err = service.ValidateAgentForAuthorization(ctx, "temp-agent-001")
	require.NoError(t, err)

	// Wait for expiration
	time.Sleep(150 * time.Millisecond)

	// Validation should fail and auto-update status to expired
	err = service.ValidateAgentForAuthorization(ctx, "temp-agent-001")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "expired")

	// Verify status updated
	expiredAgent, err := service.GetAgent(ctx, "temp-agent-001")
	require.NoError(t, err)
	assert.Equal(t, types.StatusExpired, expiredAgent.Status)
}
