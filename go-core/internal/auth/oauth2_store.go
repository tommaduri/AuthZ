package auth

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// OAuth2Client represents an OAuth2 client credential
type OAuth2Client struct {
	ClientID         uuid.UUID  `json:"client_id"`
	ClientSecretHash string     `json:"-"` // Never expose hash
	Name             string     `json:"name"`
	TenantID         string     `json:"tenant_id"`
	Scopes           []string   `json:"scopes"`
	CreatedAt        time.Time  `json:"created_at"`
	ExpiresAt        *time.Time `json:"expires_at,omitempty"`
	RevokedAt        *time.Time `json:"revoked_at,omitempty"`
}

// IsActive checks if the client is active (not revoked and not expired)
func (c *OAuth2Client) IsActive() bool {
	if c.RevokedAt != nil {
		return false
	}
	if c.ExpiresAt != nil && c.ExpiresAt.Before(time.Now()) {
		return false
	}
	return true
}

// HasScope checks if the client has a specific scope
func (c *OAuth2Client) HasScope(scope string) bool {
	for _, s := range c.Scopes {
		if s == scope {
			return true
		}
	}
	return false
}

// OAuth2ClientStore defines the interface for OAuth2 client storage
type OAuth2ClientStore interface {
	// GetClient retrieves a client by client_id
	GetClient(ctx context.Context, clientID uuid.UUID) (*OAuth2Client, error)

	// CreateClient creates a new OAuth2 client
	CreateClient(ctx context.Context, client *OAuth2Client) error

	// UpdateClient updates an existing client
	UpdateClient(ctx context.Context, client *OAuth2Client) error

	// RevokeClient marks a client as revoked
	RevokeClient(ctx context.Context, clientID uuid.UUID) error

	// ListClientsByTenant lists all clients for a tenant
	ListClientsByTenant(ctx context.Context, tenantID string) ([]*OAuth2Client, error)

	// DeleteClient permanently deletes a client
	DeleteClient(ctx context.Context, clientID uuid.UUID) error
}
