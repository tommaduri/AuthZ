// Package types provides shared types for the authorization engine
package types

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
)

// Effect represents the authorization decision
type Effect string

const (
	EffectAllow Effect = "allow"
	EffectDeny  Effect = "deny"
)

// Principal represents the entity requesting access
type Principal struct {
	ID         string                 `json:"id"`
	Roles      []string               `json:"roles"`
	Attributes map[string]interface{} `json:"attributes"`
	Scope      string                 `json:"scope,omitempty"` // Hierarchical scope (e.g., "acme.corp.engineering")
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

// ToMap converts Principal to a map for CEL evaluation
func (p *Principal) ToMap() map[string]interface{} {
	return map[string]interface{}{
		"id":         p.ID,
		"roles":      p.Roles,
		"attributes": p.Attributes,
		"attr":       p.Attributes, // alias
		"scope":      p.Scope,
	}
}

// Resource represents the resource being accessed
type Resource struct {
	Kind       string                 `json:"kind"`
	ID         string                 `json:"id"`
	Attributes map[string]interface{} `json:"attributes"`
	Scope      string                 `json:"scope,omitempty"` // Hierarchical scope (e.g., "acme.corp.engineering")
}

// ToMap converts Resource to a map for CEL evaluation
func (r *Resource) ToMap() map[string]interface{} {
	return map[string]interface{}{
		"kind":       r.Kind,
		"id":         r.ID,
		"attributes": r.Attributes,
		"attr":       r.Attributes, // alias
		"scope":      r.Scope,
	}
}

// CheckRequest represents an authorization check request
type CheckRequest struct {
	RequestID       string                 `json:"requestId"`
	Principal       *Principal             `json:"principal"`
	Resource        *Resource              `json:"resource"`
	Actions         []string               `json:"actions"`
	Context         map[string]interface{} `json:"context"`
	IncludeMetadata bool                   `json:"includeMetadata"`
}

// CacheKey generates a cache key for this request
// Phase 3: Includes principal roles to distinguish role-based policy results
// (e.g., user:admin vs user:viewer will have different cache entries)
// Roles are sorted for consistent hashing regardless of order
func (r *CheckRequest) CacheKey() string {
	// Sort roles for consistent cache keys (user may have roles in any order)
	roles := make([]string, len(r.Principal.Roles))
	copy(roles, r.Principal.Roles)
	sort.Strings(roles)

	key := fmt.Sprintf("%s:%s:%s:%s:%s:%s:%s",
		r.Principal.ID,
		r.Principal.Scope,
		strings.Join(roles, ","),
		r.Resource.Kind,
		r.Resource.ID,
		r.Resource.Scope,
		strings.Join(r.Actions, ","),
	)
	hash := sha256.Sum256([]byte(key))
	return hex.EncodeToString(hash[:16])
}

// CheckResponse contains the authorization decision
type CheckResponse struct {
	RequestID string                  `json:"requestId"`
	Results   map[string]ActionResult `json:"results"`
	Metadata  *ResponseMetadata       `json:"metadata,omitempty"`
}

// ActionResult contains the decision for a single action
type ActionResult struct {
	Effect  Effect            `json:"effect"`
	Policy  string            `json:"policy,omitempty"`
	Rule    string            `json:"rule,omitempty"`
	Matched bool              `json:"matched"`
	Meta    map[string]string `json:"meta,omitempty"`
}

// IsAllowed returns true if the effect is allow
func (r *ActionResult) IsAllowed() bool {
	return r.Effect == EffectAllow
}

// ResponseMetadata contains evaluation details
type ResponseMetadata struct {
	EvaluationDurationUs float64                `json:"evaluationDurationUs"`
	PoliciesEvaluated    int                    `json:"policiesEvaluated"`
	MatchedPolicies      []string               `json:"matchedPolicies,omitempty"`
	CacheHit             bool                   `json:"cacheHit"`
	ScopeResolution      *ScopeResolutionResult `json:"scopeResolution,omitempty"` // Scope resolution information
	PolicyResolution     *PolicyResolution      `json:"policyResolution,omitempty"` // Phase 3: Policy resolution information
}

// ScopeResolutionResult contains scope resolution result
type ScopeResolutionResult struct {
	MatchedScope        string   `json:"matchedScope"`        // The scope that matched (or "(global)" for unscoped)
	InheritanceChain    []string `json:"inheritanceChain"`    // Scopes checked during resolution (most to least specific)
	ScopedPolicyMatched bool     `json:"scopedPolicyMatched"` // Whether a scoped policy was found
}

// Policy represents an authorization policy
type Policy struct {
	APIVersion   string  `json:"apiVersion" yaml:"apiVersion"`
	Name         string  `json:"name" yaml:"name"`
	ResourceKind string  `json:"resourceKind" yaml:"resourceKind"`
	Rules        []*Rule `json:"rules" yaml:"rules"`
	Scope        string  `json:"scope,omitempty" yaml:"scope,omitempty"` // Hierarchical scope (e.g., "acme.corp.engineering")

	// Phase 3: Principal Policies
	PrincipalPolicy bool                 `json:"principalPolicy,omitempty" yaml:"principalPolicy,omitempty"` // Marks this as a principal policy
	Principal       *PrincipalSelector   `json:"principal,omitempty" yaml:"principal,omitempty"`             // Principal selector (for principal policies)
	Resources       []*ResourceSelector  `json:"resources,omitempty" yaml:"resources,omitempty"`             // Resource selectors (for principal policies)
}

// Rule represents a single authorization rule
type Rule struct {
	Name         string   `json:"name" yaml:"name"`
	Actions      []string `json:"actions" yaml:"actions"`
	Effect       Effect   `json:"effect" yaml:"effect"`
	Condition    string   `json:"condition,omitempty" yaml:"condition,omitempty"`
	Roles        []string `json:"roles,omitempty" yaml:"roles,omitempty"`
	DerivedRoles []string `json:"derivedRoles,omitempty" yaml:"derivedRoles,omitempty"`
}

// MatchesAction checks if the rule applies to an action
func (r *Rule) MatchesAction(action string) bool {
	for _, a := range r.Actions {
		if a == "*" || a == action {
			return true
		}
	}
	return false
}

// MatchesRole checks if any of the principal's roles match
func (r *Rule) MatchesRole(principalRoles []string) bool {
	if len(r.Roles) == 0 {
		return true // No role restriction
	}
	for _, required := range r.Roles {
		for _, has := range principalRoles {
			if required == has {
				return true
			}
		}
	}
	return false
}
