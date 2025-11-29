package delegation

import (
	"fmt"
	"sync"

	"github.com/authz-engine/go-core/pkg/types"
)

// InMemoryStore provides in-memory delegation storage
type InMemoryStore struct {
	mu          sync.RWMutex
	delegations map[string]*types.Delegation // Delegation ID -> Delegation
	fromIndex   map[string][]string          // From Agent ID -> []Delegation IDs
	toIndex     map[string][]string          // To Agent ID -> []Delegation IDs
}

// NewInMemoryStore creates a new in-memory delegation store
func NewInMemoryStore() *InMemoryStore {
	return &InMemoryStore{
		delegations: make(map[string]*types.Delegation),
		fromIndex:   make(map[string][]string),
		toIndex:     make(map[string][]string),
	}
}

// Add creates a new delegation
func (s *InMemoryStore) Add(delegation *types.Delegation) error {
	if delegation == nil {
		return fmt.Errorf("delegation cannot be nil")
	}
	if delegation.ID == "" {
		return fmt.Errorf("delegation ID is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// Check for duplicate
	if _, exists := s.delegations[delegation.ID]; exists {
		return fmt.Errorf("delegation with ID %s already exists", delegation.ID)
	}

	// Store delegation
	s.delegations[delegation.ID] = delegation

	// Update indexes
	s.fromIndex[delegation.FromAgentID] = append(s.fromIndex[delegation.FromAgentID], delegation.ID)
	s.toIndex[delegation.ToAgentID] = append(s.toIndex[delegation.ToAgentID], delegation.ID)

	return nil
}

// Get retrieves a delegation by ID
func (s *InMemoryStore) Get(id string) (*types.Delegation, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	delegation, exists := s.delegations[id]
	if !exists {
		return nil, fmt.Errorf("delegation with ID %s not found", id)
	}

	return delegation, nil
}

// GetByFromAgent retrieves all delegations from a specific agent
func (s *InMemoryStore) GetByFromAgent(fromAgentID string) ([]*types.Delegation, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	delegationIDs, exists := s.fromIndex[fromAgentID]
	if !exists {
		return []*types.Delegation{}, nil
	}

	result := make([]*types.Delegation, 0, len(delegationIDs))
	for _, id := range delegationIDs {
		if del, exists := s.delegations[id]; exists {
			result = append(result, del)
		}
	}

	return result, nil
}

// GetByToAgent retrieves all delegations to a specific agent
func (s *InMemoryStore) GetByToAgent(toAgentID string) ([]*types.Delegation, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	delegationIDs, exists := s.toIndex[toAgentID]
	if !exists {
		return []*types.Delegation{}, nil
	}

	result := make([]*types.Delegation, 0, len(delegationIDs))
	for _, id := range delegationIDs {
		if del, exists := s.delegations[id]; exists {
			result = append(result, del)
		}
	}

	return result, nil
}

// Revoke revokes a delegation (sets Active to false)
func (s *InMemoryStore) Revoke(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	delegation, exists := s.delegations[id]
	if !exists {
		return fmt.Errorf("delegation with ID %s not found", id)
	}

	delegation.Active = false
	return nil
}

// List retrieves all delegations
func (s *InMemoryStore) List() ([]*types.Delegation, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]*types.Delegation, 0, len(s.delegations))
	for _, del := range s.delegations {
		result = append(result, del)
	}

	return result, nil
}
