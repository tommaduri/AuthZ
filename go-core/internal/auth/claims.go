// Package auth provides authentication and authorization utilities
package auth

import (
	"github.com/golang-jwt/jwt/v5"
)

// Claims represents JWT claims with standard and custom fields
// Unified Claims structure supporting both user and agent authentication
type Claims struct {
	jwt.RegisteredClaims

	// User claims
	UserID   string   `json:"user_id,omitempty"`
	Username string   `json:"username,omitempty"`
	Email    string   `json:"email,omitempty"`

	// Authorization claims
	Roles    []string `json:"roles,omitempty"`
	Scope    string   `json:"scope,omitempty"` // Single scope string for backward compatibility
	TenantID string   `json:"tenant_id,omitempty"`
	Scopes   []string `json:"scopes,omitempty"` // Array of scopes (OAuth2 standard)

	// Agent claims (for agent-to-agent authentication)
	AgentID      string   `json:"agent_id,omitempty"`
	AgentType    string   `json:"agent_type,omitempty"`
	AgentStatus  string   `json:"agent_status,omitempty"`
	Capabilities []string `json:"capabilities,omitempty"`
}

// HasRole checks if the claims contain a specific role
func (c *Claims) HasRole(role string) bool {
	for _, r := range c.Roles {
		if r == role {
			return true
		}
	}
	return false
}

// HasAnyRole checks if the claims contain any of the specified roles
func (c *Claims) HasAnyRole(roles ...string) bool {
	for _, required := range roles {
		if c.HasRole(required) {
			return true
		}
	}
	return false
}

// HasAllRoles checks if the claims contain all of the specified roles
func (c *Claims) HasAllRoles(roles ...string) bool {
	for _, required := range roles {
		if !c.HasRole(required) {
			return false
		}
	}
	return true
}
