package apikey

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Service handles API key management business logic
type Service struct {
	store     APIKeyStore
	generator *Generator
	validator *Validator
}

// NewService creates a new API key service
func NewService(store APIKeyStore, rateLimiter *RateLimiter) *Service {
	gen := NewGenerator()
	validator := NewValidator(store, rateLimiter)

	return &Service{
		store:     store,
		generator: gen,
		validator: validator,
	}
}

// CreateAPIKey creates a new API key
func (s *Service) CreateAPIKey(ctx context.Context, req *APIKeyCreateRequest) (*APIKeyResponse, error) {
	// Validate request
	if req.AgentID == "" {
		return nil, fmt.Errorf("agent_id is required")
	}
	if req.Name == "" {
		return nil, fmt.Errorf("name is required")
	}

	// Set defaults
	if req.RateLimitRPS == 0 {
		req.RateLimitRPS = 100
	}

	// Generate API key
	plainKey, keyHash, err := s.generator.Generate()
	if err != nil {
		return nil, fmt.Errorf("generate api key: %w", err)
	}

	// Create API key record
	key := &APIKey{
		ID:           uuid.New().String(),
		Name:         req.Name,
		KeyHash:      keyHash,
		AgentID:      req.AgentID,
		Scopes:       req.Scopes,
		CreatedAt:    time.Now(),
		ExpiresAt:    req.ExpiresAt,
		RateLimitRPS: req.RateLimitRPS,
		Metadata:     req.Metadata,
	}

	// Store in database
	if err := s.store.Create(ctx, key); err != nil {
		return nil, fmt.Errorf("store api key: %w", err)
	}

	// Return response with plain key (only time it's exposed)
	return &APIKeyResponse{
		APIKey:       plainKey,
		ID:           key.ID,
		Name:         key.Name,
		AgentID:      key.AgentID,
		Scopes:       key.Scopes,
		CreatedAt:    key.CreatedAt,
		ExpiresAt:    key.ExpiresAt,
		RateLimitRPS: key.RateLimitRPS,
	}, nil
}

// ListAPIKeys lists all API keys for an agent
func (s *Service) ListAPIKeys(ctx context.Context, agentID string, includeRevoked bool) ([]*APIKeyResponse, error) {
	keys, err := s.store.List(ctx, agentID, includeRevoked)
	if err != nil {
		return nil, fmt.Errorf("list api keys: %w", err)
	}

	responses := make([]*APIKeyResponse, len(keys))
	for i, key := range keys {
		responses[i] = &APIKeyResponse{
			// Never include the plain API key in list responses
			ID:           key.ID,
			Name:         key.Name,
			AgentID:      key.AgentID,
			Scopes:       key.Scopes,
			CreatedAt:    key.CreatedAt,
			ExpiresAt:    key.ExpiresAt,
			RateLimitRPS: key.RateLimitRPS,
		}
	}

	return responses, nil
}

// RevokeAPIKey revokes an API key
func (s *Service) RevokeAPIKey(ctx context.Context, keyID string) error {
	return s.store.Revoke(ctx, keyID)
}

// GetAPIKey retrieves an API key by ID
func (s *Service) GetAPIKey(ctx context.Context, keyID string) (*APIKeyResponse, error) {
	key, err := s.store.GetByID(ctx, keyID)
	if err != nil {
		return nil, err
	}

	return &APIKeyResponse{
		ID:           key.ID,
		Name:         key.Name,
		AgentID:      key.AgentID,
		Scopes:       key.Scopes,
		CreatedAt:    key.CreatedAt,
		ExpiresAt:    key.ExpiresAt,
		RateLimitRPS: key.RateLimitRPS,
	}, nil
}
