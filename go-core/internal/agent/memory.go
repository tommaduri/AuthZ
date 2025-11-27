package agent

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/authz-engine/go-core/pkg/types"
)

// InMemoryAgentStore provides in-memory agent storage with O(1) lookups
// Thread-safe using sync.RWMutex for concurrent access
type InMemoryAgentStore struct {
	mu     sync.RWMutex
	agents map[string]*types.Agent // Agent ID -> Agent (O(1) lookup)
}

// NewInMemoryAgentStore creates a new in-memory agent store
func NewInMemoryAgentStore() *InMemoryAgentStore {
	return &InMemoryAgentStore{
		agents: make(map[string]*types.Agent),
	}
}

// NewInMemoryStore creates a new in-memory agent store (alias for compatibility)
func NewInMemoryStore() Store {
	return &InMemoryAgentStore{
		agents: make(map[string]*types.Agent),
	}
}

// Add creates a new agent (simpler non-context version)
func (s *InMemoryAgentStore) Add(agent *types.Agent) error {
	return s.Register(context.Background(), agent)
}

// Update updates an existing agent
func (s *InMemoryAgentStore) Update(agent *types.Agent) error {
	if agent == nil {
		return errors.New("agent cannot be nil")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.agents[agent.ID]; !exists {
		return fmt.Errorf("agent with ID %s not found", agent.ID)
	}

	// Make a copy to avoid external mutations
	agentCopy := *agent
	if agent.Metadata != nil {
		agentCopy.Metadata = make(map[string]interface{})
		for k, v := range agent.Metadata {
			agentCopy.Metadata[k] = v
		}
	}

	s.agents[agent.ID] = &agentCopy
	return nil
}

// Register creates a new agent with credentials
func (s *InMemoryAgentStore) Register(ctx context.Context, agent *types.Agent) error {
	if agent == nil {
		return errors.New("agent cannot be nil")
	}

	// Validate agent
	if err := agent.Validate(); err != nil {
		return fmt.Errorf("invalid agent: %w", err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// Check for duplicate
	if _, exists := s.agents[agent.ID]; exists {
		return fmt.Errorf("agent with ID %s already exists", agent.ID)
	}

	// Make a copy to avoid external mutations
	agentCopy := *agent
	if agent.Metadata != nil {
		agentCopy.Metadata = make(map[string]interface{})
		for k, v := range agent.Metadata {
			agentCopy.Metadata[k] = v
		}
	}

	s.agents[agent.ID] = &agentCopy
	return nil
}

// Get retrieves an agent by ID (O(1) lookup) - non-context version
func (s *InMemoryAgentStore) Get(id string) (*types.Agent, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	agent, exists := s.agents[id]
	if !exists {
		return nil, fmt.Errorf("agent with ID %s not found", id)
	}

	// Return a copy to avoid external mutations
	agentCopy := *agent
	if agent.Metadata != nil {
		agentCopy.Metadata = make(map[string]interface{})
		for k, v := range agent.Metadata {
			agentCopy.Metadata[k] = v
		}
	}

	return &agentCopy, nil
}

// GetWithContext retrieves an agent by ID (O(1) lookup) - context version for AgentStore interface
func (s *InMemoryAgentStore) GetWithContext(ctx context.Context, id string) (*types.Agent, error) {
	return s.Get(id)
}

// UpdateStatus updates agent status (active, suspended, revoked, expired)
func (s *InMemoryAgentStore) UpdateStatus(ctx context.Context, id string, status string) error {
	// Validate status
	validStatuses := map[string]bool{
		types.StatusActive:    true,
		types.StatusSuspended: true,
		types.StatusRevoked:   true,
		types.StatusExpired:   true,
	}
	if !validStatuses[status] {
		return fmt.Errorf("invalid status: must be one of 'active', 'suspended', 'revoked', 'expired'")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	agent, exists := s.agents[id]
	if !exists {
		return fmt.Errorf("agent with ID %s not found", id)
	}

	agent.Status = status
	agent.UpdatedAt = time.Now()

	return nil
}

// Revoke permanently revokes an agent (sets status to "revoked")
func (s *InMemoryAgentStore) Revoke(ctx context.Context, id string) error {
	return s.UpdateStatus(ctx, id, types.StatusRevoked)
}

// List retrieves agents matching filters
func (s *InMemoryAgentStore) List(ctx context.Context, filters AgentFilters) ([]*types.Agent, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var results []*types.Agent

	for _, agent := range s.agents {
		// Apply filters
		if filters.Type != "" && agent.Type != filters.Type {
			continue
		}
		if filters.Status != "" && agent.Status != filters.Status {
			continue
		}

		// Make a copy
		agentCopy := *agent
		if agent.Metadata != nil {
			agentCopy.Metadata = make(map[string]interface{})
			for k, v := range agent.Metadata {
				agentCopy.Metadata[k] = v
			}
		}

		results = append(results, &agentCopy)
	}

	// Apply pagination
	if filters.Offset > 0 {
		if filters.Offset >= len(results) {
			return []*types.Agent{}, nil
		}
		results = results[filters.Offset:]
	}

	if filters.Limit > 0 && filters.Limit < len(results) {
		results = results[:filters.Limit]
	}

	return results, nil
}

// AddCredential adds a new credential to an agent
func (s *InMemoryAgentStore) AddCredential(ctx context.Context, agentID string, credential types.Credential) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	agent, exists := s.agents[agentID]
	if !exists {
		return fmt.Errorf("agent with ID %s not found", agentID)
	}

	// Check for duplicate credential ID
	for _, cred := range agent.Credentials {
		if cred.ID == credential.ID {
			return fmt.Errorf("credential with ID %s already exists for agent %s", credential.ID, agentID)
		}
	}

	agent.Credentials = append(agent.Credentials, credential)
	agent.UpdatedAt = time.Now()

	return nil
}

// RevokeCredential revokes a specific credential (removes it from the agent)
func (s *InMemoryAgentStore) RevokeCredential(ctx context.Context, agentID string, credentialID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	agent, exists := s.agents[agentID]
	if !exists {
		return fmt.Errorf("agent with ID %s not found", agentID)
	}

	// Find and remove credential
	found := false
	newCredentials := make([]types.Credential, 0, len(agent.Credentials)-1)
	for _, cred := range agent.Credentials {
		if cred.ID == credentialID {
			found = true
			continue // Skip this credential (revoke it)
		}
		newCredentials = append(newCredentials, cred)
	}

	if !found {
		return fmt.Errorf("credential with ID %s not found for agent %s", credentialID, agentID)
	}

	agent.Credentials = newCredentials
	agent.UpdatedAt = time.Now()

	return nil
}
