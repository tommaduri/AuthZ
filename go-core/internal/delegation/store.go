package delegation

import (
	"github.com/authz-engine/go-core/pkg/types"
)

// Store defines the interface for delegation persistence operations
type Store interface {
	// Add creates a new delegation
	Add(delegation *types.Delegation) error

	// Get retrieves a delegation by ID
	Get(id string) (*types.Delegation, error)

	// GetByFromAgent retrieves all delegations from a specific agent
	GetByFromAgent(fromAgentID string) ([]*types.Delegation, error)

	// GetByToAgent retrieves all delegations to a specific agent
	GetByToAgent(toAgentID string) ([]*types.Delegation, error)

	// Revoke revokes a delegation (sets Active to false)
	Revoke(id string) error

	// List retrieves all delegations
	List() ([]*types.Delegation, error)
}
