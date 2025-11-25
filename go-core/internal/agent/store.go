package agent

import (
	"context"

	"github.com/authz-engine/go-core/pkg/types"
)

// AgentStore defines the interface for agent persistence operations
// Supports agent lifecycle management (registration, status updates, revocation)
type AgentStore interface {
	// Register creates a new agent with credentials
	Register(ctx context.Context, agent *types.Agent) error

	// Get retrieves an agent by ID (O(1) lookup required)
	Get(ctx context.Context, id string) (*types.Agent, error)

	// UpdateStatus updates agent status (active, suspended, revoked, expired)
	UpdateStatus(ctx context.Context, id string, status string) error

	// Revoke permanently revokes an agent (sets status to "revoked")
	Revoke(ctx context.Context, id string) error

	// List retrieves agents matching filters
	List(ctx context.Context, filters AgentFilters) ([]*types.Agent, error)

	// AddCredential adds a new credential to an agent
	AddCredential(ctx context.Context, agentID string, credential types.Credential) error

	// RevokeCredential revokes a specific credential
	RevokeCredential(ctx context.Context, agentID string, credentialID string) error
}

// AgentFilters supports querying agents
type AgentFilters struct {
	Type   string // Filter by agent type
	Status string // Filter by status
	Limit  int    // Pagination limit
	Offset int    // Pagination offset
}
