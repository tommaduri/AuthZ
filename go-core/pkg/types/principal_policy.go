// Package types provides shared types for the authorization engine
package types

// PrincipalSelector defines which principals a policy applies to
type PrincipalSelector struct {
	ID    string   `json:"id,omitempty" yaml:"id,omitempty"`       // Specific principal ID (e.g., "user:alice")
	Roles []string `json:"roles,omitempty" yaml:"roles,omitempty"` // Match ANY of these roles
	Scope string   `json:"scope,omitempty" yaml:"scope,omitempty"` // Principal's scope context
}

// MatchesPrincipal checks if this selector matches a principal
func (s *PrincipalSelector) MatchesPrincipal(principal *Principal) bool {
	// Defensive: nil principal matches nothing
	if principal == nil {
		return false
	}

	// If ID is specified, must match exactly
	if s.ID != "" && s.ID != principal.ID {
		return false
	}

	// If roles are specified, principal must have at least one
	if len(s.Roles) > 0 {
		hasRole := false
		for _, requiredRole := range s.Roles {
			if principal.HasRole(requiredRole) {
				hasRole = true
				break
			}
		}
		if !hasRole {
			return false
		}
	}

	// If scope is specified, principal scope must match
	// TODO: In future, could add scope pattern matching like resource scopes
	if s.Scope != "" && s.Scope != principal.Scope {
		return false
	}

	return true
}

// ResourceSelector defines which resources a principal policy applies to
type ResourceSelector struct {
	Kind  string `json:"kind" yaml:"kind"`                           // Resource kind (supports wildcard *)
	Scope string `json:"scope,omitempty" yaml:"scope,omitempty"`     // Scope pattern (supports ** wildcard)
}

// MatchesResource checks if this selector matches a resource
func (s *ResourceSelector) MatchesResource(resource *Resource) bool {
	// Defensive: nil resource matches nothing
	if resource == nil {
		return false
	}

	// Kind matching (supports wildcard *)
	if s.Kind != "*" && s.Kind != resource.Kind {
		return false
	}

	// Scope matching (supports wildcard **)
	// Empty selector scope matches any resource scope
	if s.Scope == "" {
		return true
	}

	// Wildcard ** matches any scope
	if s.Scope == "**" {
		return true
	}

	// Exact scope match
	if s.Scope == resource.Scope {
		return true
	}

	// TODO: In future, add wildcard pattern matching like Phase 2 scope resolver
	// For now, only exact match and ** supported

	return false
}

// PolicyResolution contains policy resolution details
type PolicyResolution struct {
	PrincipalPoliciesMatched bool                   `json:"principalPoliciesMatched"`
	ResourcePoliciesMatched  bool                   `json:"resourcePoliciesMatched"`
	EvaluationOrder          []string               `json:"evaluationOrder"`     // e.g., ["principal-specific", "resource-scoped"]
	ScopeResolution          *ScopeResolutionResult `json:"scopeResolution,omitempty"` // Nested scope info
}
