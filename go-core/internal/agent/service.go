package agent

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/authz-engine/go-core/pkg/types"
)

// Service provides business logic for agent lifecycle management
type Service struct {
	store AgentStore
}

// NewService creates a new agent service
func NewService(store AgentStore) *Service {
	return &Service{
		store: store,
	}
}

// RegisterAgent registers a new agent with validation
func (s *Service) RegisterAgent(ctx context.Context, req *RegisterAgentRequest) (*types.Agent, error) {
	if req == nil {
		return nil, errors.New("registration request cannot be nil")
	}

	// Validate required fields
	if req.ID == "" {
		return nil, errors.New("agent ID is required")
	}
	if req.Type == "" {
		return nil, errors.New("agent type is required")
	}
	if req.DisplayName == "" {
		return nil, errors.New("agent display name is required")
	}

	now := time.Now()
	agent := &types.Agent{
		ID:          req.ID,
		Type:        req.Type,
		DisplayName: req.DisplayName,
		Status:      types.StatusActive, // New agents are active by default
		Credentials: req.Credentials,
		Metadata:    req.Metadata,
		CreatedAt:   now,
		UpdatedAt:   now,
		ExpiresAt:   req.ExpiresAt,
	}

	// Initialize metadata if nil
	if agent.Metadata == nil {
		agent.Metadata = make(map[string]interface{})
	}

	// Validate agent
	if err := agent.Validate(); err != nil {
		return nil, fmt.Errorf("agent validation failed: %w", err)
	}

	// Register in store
	if err := s.store.Register(ctx, agent); err != nil {
		return nil, fmt.Errorf("failed to register agent: %w", err)
	}

	return agent, nil
}

// GetAgent retrieves an agent by ID with validation
func (s *Service) GetAgent(ctx context.Context, id string) (*types.Agent, error) {
	if id == "" {
		return nil, errors.New("agent ID is required")
	}

	agent, err := s.store.Get(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("failed to get agent: %w", err)
	}

	return agent, nil
}

// SuspendAgent suspends an active agent
func (s *Service) SuspendAgent(ctx context.Context, id string, reason string) error {
	agent, err := s.store.Get(ctx, id)
	if err != nil {
		return fmt.Errorf("failed to get agent: %w", err)
	}

	// Validate status transition
	if agent.Status == types.StatusRevoked {
		return errors.New("cannot suspend a revoked agent")
	}

	// Store suspension reason in metadata
	if agent.Metadata == nil {
		agent.Metadata = make(map[string]interface{})
	}
	agent.Metadata["suspension_reason"] = reason
	agent.Metadata["suspended_at"] = time.Now().Format(time.RFC3339)

	return s.store.UpdateStatus(ctx, id, types.StatusSuspended)
}

// ReactivateAgent reactivates a suspended agent
func (s *Service) ReactivateAgent(ctx context.Context, id string) error {
	agent, err := s.store.Get(ctx, id)
	if err != nil {
		return fmt.Errorf("failed to get agent: %w", err)
	}

	// Validate status transition
	if agent.Status == types.StatusRevoked {
		return errors.New("cannot reactivate a revoked agent")
	}
	if agent.Status != types.StatusSuspended {
		return fmt.Errorf("agent must be suspended to reactivate (current status: %s)", agent.Status)
	}

	// Check if agent is expired
	if agent.IsExpired() {
		return s.store.UpdateStatus(ctx, id, types.StatusExpired)
	}

	return s.store.UpdateStatus(ctx, id, types.StatusActive)
}

// RevokeAgent permanently revokes an agent
func (s *Service) RevokeAgent(ctx context.Context, id string, reason string) error {
	agent, err := s.store.Get(ctx, id)
	if err != nil {
		return fmt.Errorf("failed to get agent: %w", err)
	}

	// Store revocation reason in metadata
	if agent.Metadata == nil {
		agent.Metadata = make(map[string]interface{})
	}
	agent.Metadata["revocation_reason"] = reason
	agent.Metadata["revoked_at"] = time.Now().Format(time.RFC3339)

	return s.store.Revoke(ctx, id)
}

// ListAgents retrieves agents with filters
func (s *Service) ListAgents(ctx context.Context, filters AgentFilters) ([]*types.Agent, error) {
	agents, err := s.store.List(ctx, filters)
	if err != nil {
		return nil, fmt.Errorf("failed to list agents: %w", err)
	}

	return agents, nil
}

// AddCredential adds a new credential to an agent with validation
func (s *Service) AddCredential(ctx context.Context, agentID string, req *AddCredentialRequest) error {
	if req == nil {
		return errors.New("add credential request cannot be nil")
	}
	if req.ID == "" {
		return errors.New("credential ID is required")
	}
	if req.Type == "" {
		return errors.New("credential type is required")
	}
	if req.Value == "" {
		return errors.New("credential value is required")
	}

	// Check agent exists and is active
	agent, err := s.store.Get(ctx, agentID)
	if err != nil {
		return fmt.Errorf("failed to get agent: %w", err)
	}

	if agent.Status != types.StatusActive {
		return fmt.Errorf("cannot add credential to non-active agent (status: %s)", agent.Status)
	}

	cred := types.Credential{
		ID:        req.ID,
		Type:      req.Type,
		Value:     req.Value, // Should be hashed/encrypted by caller
		IssuedAt:  time.Now(),
		ExpiresAt: req.ExpiresAt,
	}

	return s.store.AddCredential(ctx, agentID, cred)
}

// RevokeCredential revokes a specific credential
func (s *Service) RevokeCredential(ctx context.Context, agentID string, credentialID string) error {
	if agentID == "" {
		return errors.New("agent ID is required")
	}
	if credentialID == "" {
		return errors.New("credential ID is required")
	}

	return s.store.RevokeCredential(ctx, agentID, credentialID)
}

// RotateCredential rotates a credential (revoke old, add new)
func (s *Service) RotateCredential(ctx context.Context, agentID string, oldCredID string, req *AddCredentialRequest) error {
	// Revoke old credential
	if err := s.RevokeCredential(ctx, agentID, oldCredID); err != nil {
		return fmt.Errorf("failed to revoke old credential: %w", err)
	}

	// Add new credential
	if err := s.AddCredential(ctx, agentID, req); err != nil {
		// Attempt rollback (best effort)
		_ = s.store.AddCredential(ctx, agentID, types.Credential{ID: oldCredID})
		return fmt.Errorf("failed to add new credential: %w", err)
	}

	return nil
}

// ValidateAgentForAuthorization validates that an agent is eligible for authorization
func (s *Service) ValidateAgentForAuthorization(ctx context.Context, agentID string) error {
	agent, err := s.store.Get(ctx, agentID)
	if err != nil {
		return fmt.Errorf("agent not found: %w", err)
	}

	// Check agent is active
	if !agent.IsActive() {
		return fmt.Errorf("agent is not active (status: %s)", agent.Status)
	}

	// Check agent is not expired
	if agent.IsExpired() {
		// Auto-update status to expired
		_ = s.store.UpdateStatus(ctx, agentID, types.StatusExpired)
		return errors.New("agent has expired")
	}

	// Check agent has at least one valid credential
	if !agent.HasValidCredential() {
		return errors.New("agent has no valid credentials")
	}

	return nil
}

// RegisterAgentRequest contains agent registration data
type RegisterAgentRequest struct {
	ID          string
	Type        string
	DisplayName string
	Credentials []types.Credential
	Metadata    map[string]interface{}
	ExpiresAt   *time.Time
}

// AddCredentialRequest contains credential addition data
type AddCredentialRequest struct {
	ID        string
	Type      string
	Value     string // Should be hashed/encrypted
	ExpiresAt *time.Time
}
