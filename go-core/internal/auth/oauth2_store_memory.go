package auth

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
)

// InMemoryOAuth2Store implements OAuth2ClientStore in memory (for testing)
type InMemoryOAuth2Store struct {
	mu      sync.RWMutex
	clients map[uuid.UUID]*OAuth2Client
}

// NewInMemoryOAuth2Store creates a new in-memory OAuth2 client store
func NewInMemoryOAuth2Store() *InMemoryOAuth2Store {
	return &InMemoryOAuth2Store{
		clients: make(map[uuid.UUID]*OAuth2Client),
	}
}

// GetClient retrieves a client by client_id
func (s *InMemoryOAuth2Store) GetClient(ctx context.Context, clientID uuid.UUID) (*OAuth2Client, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	client, exists := s.clients[clientID]
	if !exists {
		return nil, ErrClientNotFound
	}

	// Check if client is active
	if client.RevokedAt != nil {
		return client, ErrClientRevoked
	}
	if client.ExpiresAt != nil && client.ExpiresAt.Before(time.Now()) {
		return client, ErrClientExpired
	}

	return client, nil
}

// CreateClient creates a new OAuth2 client
func (s *InMemoryOAuth2Store) CreateClient(ctx context.Context, client *OAuth2Client) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.clients[client.ClientID]; exists {
		return ErrClientAlreadyExists
	}

	if client.CreatedAt.IsZero() {
		client.CreatedAt = time.Now()
	}

	s.clients[client.ClientID] = client
	return nil
}

// UpdateClient updates an existing client
func (s *InMemoryOAuth2Store) UpdateClient(ctx context.Context, client *OAuth2Client) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.clients[client.ClientID]; !exists {
		return ErrClientNotFound
	}

	s.clients[client.ClientID] = client
	return nil
}

// RevokeClient marks a client as revoked
func (s *InMemoryOAuth2Store) RevokeClient(ctx context.Context, clientID uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	client, exists := s.clients[clientID]
	if !exists {
		return ErrClientNotFound
	}

	if client.RevokedAt != nil {
		return ErrClientNotFound // Already revoked
	}

	now := time.Now()
	client.RevokedAt = &now
	return nil
}

// ListClientsByTenant lists all clients for a tenant
func (s *InMemoryOAuth2Store) ListClientsByTenant(ctx context.Context, tenantID string) ([]*OAuth2Client, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var clients []*OAuth2Client
	for _, client := range s.clients {
		if client.TenantID == tenantID {
			clients = append(clients, client)
		}
	}

	return clients, nil
}

// DeleteClient permanently deletes a client
func (s *InMemoryOAuth2Store) DeleteClient(ctx context.Context, clientID uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.clients[clientID]; !exists {
		return ErrClientNotFound
	}

	delete(s.clients, clientID)
	return nil
}
