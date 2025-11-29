package apikey

import (
	"time"

	"github.com/authz-engine/go-core/internal/auth"
)

// APIKey represents an API key with metadata
type APIKey struct {
	ID           string                 `json:"id"`
	Name         string                 `json:"name"`
	KeyHash      string                 `json:"-"` // Never expose hash
	AgentID      string                 `json:"agent_id"`
	Scopes       []string               `json:"scopes"`
	CreatedAt    time.Time              `json:"created_at"`
	ExpiresAt    *time.Time             `json:"expires_at,omitempty"`
	LastUsedAt   *time.Time             `json:"last_used_at,omitempty"`
	RevokedAt    *time.Time             `json:"revoked_at,omitempty"`
	RateLimitRPS int                    `json:"rate_limit_rps"`
	Metadata     map[string]interface{} `json:"metadata,omitempty"`
}

// APIKeyCreateRequest represents a request to create an API key
type APIKeyCreateRequest struct {
	Name         string                 `json:"name"`
	AgentID      string                 `json:"agent_id"`
	Scopes       []string               `json:"scopes"`
	ExpiresAt    *time.Time             `json:"expires_at,omitempty"`
	RateLimitRPS int                    `json:"rate_limit_rps,omitempty"`
	Metadata     map[string]interface{} `json:"metadata,omitempty"`
}

// APIKeyResponse represents the response when creating an API key
// The plain key is only returned once during creation
type APIKeyResponse struct {
	APIKey       string     `json:"api_key,omitempty"` // Only set on creation
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	AgentID      string     `json:"agent_id"`
	Scopes       []string   `json:"scopes"`
	CreatedAt    time.Time  `json:"created_at"`
	ExpiresAt    *time.Time `json:"expires_at,omitempty"`
	RateLimitRPS int        `json:"rate_limit_rps"`
}

// IsExpired checks if the API key has expired
func (k *APIKey) IsExpired() bool {
	if k.ExpiresAt == nil {
		return false
	}
	return time.Now().After(*k.ExpiresAt)
}

// IsRevoked checks if the API key has been revoked
func (k *APIKey) IsRevoked() bool {
	return k.RevokedAt != nil
}

// IsValid checks if the API key is valid (not expired and not revoked)
func (k *APIKey) IsValid() bool {
	return !k.IsExpired() && !k.IsRevoked()
}

// ToPrincipal converts an API key to a Principal for authorization
func (k *APIKey) ToPrincipal() *auth.Principal {
	return &auth.Principal{
		ID:     k.AgentID,
		Type:   "agent",
		Scopes: k.Scopes,
		Metadata: map[string]interface{}{
			"auth_method": "api_key",
			"key_id":      k.ID,
			"key_name":    k.Name,
		},
	}
}
