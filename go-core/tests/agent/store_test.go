package agent_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/agent"
	"github.com/authz-engine/go-core/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAgentStore_Register tests agent registration (RED phase)
func TestAgentStore_Register(t *testing.T) {
	store := agent.NewInMemoryAgentStore()
	ctx := context.Background()

	now := time.Now()
	testAgent := &types.Agent{
		ID:          "agent-001",
		Type:        types.AgentTypeService,
		DisplayName: "Test Service",
		Status:      types.StatusActive,
		Credentials: []types.Credential{
			{
				ID:       "cred-001",
				Type:     "api-key",
				Value:    "hashed-key-value",
				IssuedAt: now,
			},
		},
		Metadata:  make(map[string]interface{}),
		CreatedAt: now,
		UpdatedAt: now,
	}

	err := store.Register(ctx, testAgent)
	require.NoError(t, err)

	// Retrieve and verify
	retrieved, err := store.Get(ctx, "agent-001")
	require.NoError(t, err)
	assert.Equal(t, testAgent.ID, retrieved.ID)
	assert.Equal(t, testAgent.Type, retrieved.Type)
	assert.Equal(t, testAgent.DisplayName, retrieved.DisplayName)
	assert.Equal(t, testAgent.Status, retrieved.Status)
}

// TestAgentStore_Register_Duplicate tests duplicate agent registration
func TestAgentStore_Register_Duplicate(t *testing.T) {
	store := agent.NewInMemoryAgentStore()
	ctx := context.Background()

	now := time.Now()
	testAgent := &types.Agent{
		ID:          "agent-001",
		Type:        types.AgentTypeService,
		DisplayName: "Test Service",
		Status:      types.StatusActive,
		Credentials: []types.Credential{},
		Metadata:    make(map[string]interface{}),
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	// First registration should succeed
	err := store.Register(ctx, testAgent)
	require.NoError(t, err)

	// Duplicate registration should fail
	err = store.Register(ctx, testAgent)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "already exists")
}

// TestAgentStore_Get tests retrieving an agent by ID
func TestAgentStore_Get(t *testing.T) {
	store := agent.NewInMemoryAgentStore()
	ctx := context.Background()

	// Agent not found should return error
	_, err := store.Get(ctx, "non-existent")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")

	// Register agent
	now := time.Now()
	testAgent := &types.Agent{
		ID:          "agent-002",
		Type:        types.AgentTypeAI,
		DisplayName: "AI Assistant",
		Status:      types.StatusActive,
		Credentials: []types.Credential{},
		Metadata:    make(map[string]interface{}),
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	err = store.Register(ctx, testAgent)
	require.NoError(t, err)

	// Get should succeed
	retrieved, err := store.Get(ctx, "agent-002")
	require.NoError(t, err)
	assert.Equal(t, "agent-002", retrieved.ID)
	assert.Equal(t, types.AgentTypeAI, retrieved.Type)
}

// TestAgentStore_UpdateStatus tests updating agent status
func TestAgentStore_UpdateStatus(t *testing.T) {
	store := agent.NewInMemoryAgentStore()
	ctx := context.Background()

	now := time.Now()
	testAgent := &types.Agent{
		ID:          "agent-003",
		Type:        types.AgentTypeService,
		DisplayName: "Service Agent",
		Status:      types.StatusActive,
		Credentials: []types.Credential{},
		Metadata:    make(map[string]interface{}),
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	err := store.Register(ctx, testAgent)
	require.NoError(t, err)

	// Update status to suspended
	err = store.UpdateStatus(ctx, "agent-003", types.StatusSuspended)
	require.NoError(t, err)

	// Verify status change
	retrieved, err := store.Get(ctx, "agent-003")
	require.NoError(t, err)
	assert.Equal(t, types.StatusSuspended, retrieved.Status)

	// UpdatedAt should be more recent
	assert.True(t, retrieved.UpdatedAt.After(now) || retrieved.UpdatedAt.Equal(now))
}

// TestAgentStore_UpdateStatus_InvalidStatus tests invalid status transition
func TestAgentStore_UpdateStatus_InvalidStatus(t *testing.T) {
	store := agent.NewInMemoryAgentStore()
	ctx := context.Background()

	now := time.Now()
	testAgent := &types.Agent{
		ID:          "agent-004",
		Type:        types.AgentTypeService,
		DisplayName: "Service Agent",
		Status:      types.StatusActive,
		Credentials: []types.Credential{},
		Metadata:    make(map[string]interface{}),
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	err := store.Register(ctx, testAgent)
	require.NoError(t, err)

	// Invalid status should fail
	err = store.UpdateStatus(ctx, "agent-004", "invalid-status")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid status")
}

// TestAgentStore_Revoke tests revoking an agent
func TestAgentStore_Revoke(t *testing.T) {
	store := agent.NewInMemoryAgentStore()
	ctx := context.Background()

	now := time.Now()
	testAgent := &types.Agent{
		ID:          "agent-005",
		Type:        types.AgentTypeService,
		DisplayName: "Service Agent",
		Status:      types.StatusActive,
		Credentials: []types.Credential{},
		Metadata:    make(map[string]interface{}),
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	err := store.Register(ctx, testAgent)
	require.NoError(t, err)

	// Revoke agent
	err = store.Revoke(ctx, "agent-005")
	require.NoError(t, err)

	// Verify status is revoked
	retrieved, err := store.Get(ctx, "agent-005")
	require.NoError(t, err)
	assert.Equal(t, types.StatusRevoked, retrieved.Status)
}

// TestAgentStore_List tests listing agents with filters
func TestAgentStore_List(t *testing.T) {
	store := agent.NewInMemoryAgentStore()
	ctx := context.Background()

	now := time.Now()

	// Register multiple agents
	agents := []*types.Agent{
		{
			ID:          "service-001",
			Type:        types.AgentTypeService,
			DisplayName: "Service 1",
			Status:      types.StatusActive,
			Credentials: []types.Credential{},
			Metadata:    make(map[string]interface{}),
			CreatedAt:   now,
			UpdatedAt:   now,
		},
		{
			ID:          "service-002",
			Type:        types.AgentTypeService,
			DisplayName: "Service 2",
			Status:      types.StatusSuspended,
			Credentials: []types.Credential{},
			Metadata:    make(map[string]interface{}),
			CreatedAt:   now,
			UpdatedAt:   now,
		},
		{
			ID:          "ai-001",
			Type:        types.AgentTypeAI,
			DisplayName: "AI Agent 1",
			Status:      types.StatusActive,
			Credentials: []types.Credential{},
			Metadata:    make(map[string]interface{}),
			CreatedAt:   now,
			UpdatedAt:   now,
		},
	}

	for _, a := range agents {
		err := store.Register(ctx, a)
		require.NoError(t, err)
	}

	// List all agents
	allAgents, err := store.List(ctx, agent.AgentFilters{})
	require.NoError(t, err)
	assert.Len(t, allAgents, 3)

	// Filter by type
	serviceAgents, err := store.List(ctx, agent.AgentFilters{Type: types.AgentTypeService})
	require.NoError(t, err)
	assert.Len(t, serviceAgents, 2)

	// Filter by status
	activeAgents, err := store.List(ctx, agent.AgentFilters{Status: types.StatusActive})
	require.NoError(t, err)
	assert.Len(t, activeAgents, 2)

	// Filter by type AND status
	activeServices, err := store.List(ctx, agent.AgentFilters{
		Type:   types.AgentTypeService,
		Status: types.StatusActive,
	})
	require.NoError(t, err)
	assert.Len(t, activeServices, 1)
	assert.Equal(t, "service-001", activeServices[0].ID)
}

// TestAgentStore_AddCredential tests adding a credential to an agent
func TestAgentStore_AddCredential(t *testing.T) {
	store := agent.NewInMemoryAgentStore()
	ctx := context.Background()

	now := time.Now()
	testAgent := &types.Agent{
		ID:          "agent-006",
		Type:        types.AgentTypeService,
		DisplayName: "Service Agent",
		Status:      types.StatusActive,
		Credentials: []types.Credential{},
		Metadata:    make(map[string]interface{}),
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	err := store.Register(ctx, testAgent)
	require.NoError(t, err)

	// Add credential
	newCred := types.Credential{
		ID:       "cred-new",
		Type:     "oauth-token",
		Value:    "hashed-token",
		IssuedAt: now,
	}

	err = store.AddCredential(ctx, "agent-006", newCred)
	require.NoError(t, err)

	// Verify credential added
	retrieved, err := store.Get(ctx, "agent-006")
	require.NoError(t, err)
	assert.Len(t, retrieved.Credentials, 1)
	assert.Equal(t, "cred-new", retrieved.Credentials[0].ID)
}

// TestAgentStore_RevokeCredential tests revoking a specific credential
func TestAgentStore_RevokeCredential(t *testing.T) {
	store := agent.NewInMemoryAgentStore()
	ctx := context.Background()

	now := time.Now()
	testAgent := &types.Agent{
		ID:          "agent-007",
		Type:        types.AgentTypeService,
		DisplayName: "Service Agent",
		Status:      types.StatusActive,
		Credentials: []types.Credential{
			{
				ID:       "cred-001",
				Type:     "api-key",
				Value:    "hashed-key-1",
				IssuedAt: now,
			},
			{
				ID:       "cred-002",
				Type:     "api-key",
				Value:    "hashed-key-2",
				IssuedAt: now,
			},
		},
		Metadata:  make(map[string]interface{}),
		CreatedAt: now,
		UpdatedAt: now,
	}

	err := store.Register(ctx, testAgent)
	require.NoError(t, err)

	// Revoke one credential
	err = store.RevokeCredential(ctx, "agent-007", "cred-001")
	require.NoError(t, err)

	// Verify credential removed
	retrieved, err := store.Get(ctx, "agent-007")
	require.NoError(t, err)
	assert.Len(t, retrieved.Credentials, 1)
	assert.Equal(t, "cred-002", retrieved.Credentials[0].ID)
}

// TestAgentStore_Performance_O1_Lookup tests O(1) lookup performance
func TestAgentStore_Performance_O1_Lookup(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping performance test in short mode")
	}

	store := agent.NewInMemoryAgentStore()
	ctx := context.Background()

	// Register 1000 agents
	now := time.Now()
	for i := 0; i < 1000; i++ {
		testAgent := &types.Agent{
			ID:          fmt.Sprintf("agent-%04d", i),
			Type:        types.AgentTypeService,
			DisplayName: fmt.Sprintf("Agent %d", i),
			Status:      types.StatusActive,
			Credentials: []types.Credential{},
			Metadata:    make(map[string]interface{}),
			CreatedAt:   now,
			UpdatedAt:   now,
		}

		err := store.Register(ctx, testAgent)
		require.NoError(t, err)
	}

	// Measure lookup time (should be <1µs for O(1))
	start := time.Now()
	_, err := store.Get(ctx, "agent-0500")
	elapsed := time.Since(start)

	require.NoError(t, err)
	assert.Less(t, elapsed.Microseconds(), int64(10), "Lookup should be <10µs (O(1))")
}
