package types

import (
	"errors"
	"time"
)

// Agent status constants
const (
	StatusActive    = "active"
	StatusSuspended = "suspended"
	StatusRevoked   = "revoked"
	StatusExpired   = "expired"
)

// Agent type constants
const (
	AgentTypeService  = "service"
	AgentTypeHuman    = "human"
	AgentTypeAI       = "ai-agent"
	AgentTypeMCP      = "mcp-agent"
)

// Agent represents an entity with identity lifecycle management
// Separate from Principal to maintain clean separation of concerns:
// - Agent: Identity lifecycle (registration, credentials, status)
// - Principal: Authorization context (roles, attributes, scope)
type Agent struct {
	ID          string                 `json:"id"`
	Type        string                 `json:"type"`        // "service", "human", "ai-agent", "mcp-agent"
	DisplayName string                 `json:"displayName"` // Human-readable name
	Status      string                 `json:"status"`      // "active", "suspended", "revoked", "expired"
	Credentials []Credential           `json:"credentials"` // Authentication credentials
	Metadata    map[string]interface{} `json:"metadata"`    // Custom metadata
	CreatedAt   time.Time              `json:"createdAt"`   // Registration timestamp
	UpdatedAt   time.Time              `json:"updatedAt"`   // Last modification timestamp
	ExpiresAt   *time.Time             `json:"expiresAt,omitempty"` // Optional expiration (nil = no expiration)
}

// Credential represents an authentication credential
type Credential struct {
	ID        string     `json:"id"`
	Type      string     `json:"type"`      // "api-key", "oauth-token", "certificate", "ed25519-key"
	Value     string     `json:"value"`     // Hashed/encrypted credential value
	IssuedAt  time.Time  `json:"issuedAt"`  // Credential issue timestamp
	ExpiresAt *time.Time `json:"expiresAt,omitempty"` // Optional expiration (nil = no expiration)
}

// IsActive returns true if the agent status is "active"
func (a *Agent) IsActive() bool {
	return a.Status == StatusActive
}

// IsExpired returns true if the agent has expired
func (a *Agent) IsExpired() bool {
	if a.ExpiresAt == nil {
		return false
	}
	return time.Now().After(*a.ExpiresAt)
}

// HasValidCredential returns true if the agent has at least one valid (non-expired) credential
func (a *Agent) HasValidCredential() bool {
	for _, cred := range a.Credentials {
		if !cred.IsExpired() {
			return true
		}
	}
	return false
}

// ToPrincipal converts an Agent to a Principal for authorization
// Maps Agent.ID to Principal.ID and derives roles from agent type and metadata
func (a *Agent) ToPrincipal() *Principal {
	principal := &Principal{
		ID:         a.ID,
		Roles:      []string{"agent:" + a.Type}, // Base role: "agent:service", "agent:ai-agent", etc.
		Attributes: make(map[string]interface{}),
	}

	// Copy metadata to principal attributes
	for k, v := range a.Metadata {
		principal.Attributes[k] = v
	}

	// Extract custom roles from metadata if present
	if rolesInterface, ok := a.Metadata["roles"]; ok {
		if roles, ok := rolesInterface.([]string); ok {
			principal.Roles = append(principal.Roles, roles...)
		} else if rolesAny, ok := rolesInterface.([]interface{}); ok {
			// Handle []interface{} from JSON unmarshaling
			for _, r := range rolesAny {
				if roleStr, ok := r.(string); ok {
					principal.Roles = append(principal.Roles, roleStr)
				}
			}
		}
	}

	return principal
}

// IsExpired returns true if the credential has expired
func (c *Credential) IsExpired() bool {
	if c.ExpiresAt == nil {
		return false
	}
	return time.Now().After(*c.ExpiresAt)
}

// Validate validates the agent fields
func (a *Agent) Validate() error {
	if a.ID == "" {
		return errors.New("agent ID is required")
	}

	// Validate type
	validTypes := map[string]bool{
		AgentTypeService: true,
		AgentTypeHuman:   true,
		AgentTypeAI:      true,
		AgentTypeMCP:     true,
	}
	if !validTypes[a.Type] {
		return errors.New("invalid agent type: must be one of 'service', 'human', 'ai-agent', 'mcp-agent'")
	}

	// Validate status
	validStatuses := map[string]bool{
		StatusActive:    true,
		StatusSuspended: true,
		StatusRevoked:   true,
		StatusExpired:   true,
	}
	if !validStatuses[a.Status] {
		return errors.New("invalid agent status: must be one of 'active', 'suspended', 'revoked', 'expired'")
	}

	if a.DisplayName == "" {
		return errors.New("agent display name is required")
	}

	return nil
}
