package auth

// Principal represents an authenticated entity (agent, user, or service)
type Principal struct {
	ID       string                 `json:"id"`        // Agent ID or user ID
	Type     string                 `json:"type"`      // "agent", "user", "service"
	Roles    []string               `json:"roles"`     // Principal roles
	Scopes   []string               `json:"scopes"`    // OAuth2/API scopes
	TenantID string                 `json:"tenant_id"` // Multi-tenant isolation
	Metadata map[string]interface{} `json:"metadata"`  // Additional attributes
}

// HasScope checks if the principal has a specific scope
func (p *Principal) HasScope(scope string) bool {
	for _, s := range p.Scopes {
		if s == scope || s == "*" {
			return true
		}
	}
	return false
}

// HasRole checks if the principal has a specific role
func (p *Principal) HasRole(role string) bool {
	for _, r := range p.Roles {
		if r == role {
			return true
		}
	}
	return false
}
