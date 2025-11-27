// Package rest provides REST API types and request/response structures
package rest

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/authz-engine/go-core/pkg/types"
)

// ErrorResponse represents an API error response
type ErrorResponse struct {
	Error   string                 `json:"error"`
	Message string                 `json:"message,omitempty"`
	Details map[string]interface{} `json:"details,omitempty"`
	Code    string                 `json:"code,omitempty"`
}

// AuthorizationCheckRequest represents a REST authorization check request
type AuthorizationCheckRequest struct {
	Principal Principal              `json:"principal"`
	Resource  Resource               `json:"resource"`
	Action    string                 `json:"action"`
	Context   map[string]interface{} `json:"context,omitempty"`
}

// AuthorizationCheckResponse represents a REST authorization check response
type AuthorizationCheckResponse struct {
	Allowed  bool                   `json:"allowed"`
	Effect   string                 `json:"effect"`
	Policy   string                 `json:"policy,omitempty"`
	Rule     string                 `json:"rule,omitempty"`
	Metadata *ResponseMetadata      `json:"metadata,omitempty"`
	Context  map[string]interface{} `json:"context,omitempty"`
}

// BatchCheckRequest represents a batch authorization check request
type BatchCheckRequest struct {
	Principal Principal          `json:"principal"`
	Resources []ResourceWithAction `json:"resources"`
	Context   map[string]interface{} `json:"context,omitempty"`
}

// ResourceWithAction combines a resource with an action
type ResourceWithAction struct {
	Resource Resource `json:"resource"`
	Action   string   `json:"action"`
}

// BatchCheckResponse represents a batch authorization check response
type BatchCheckResponse struct {
	Results  []AuthorizationCheckResponse `json:"results"`
	Metadata *ResponseMetadata            `json:"metadata,omitempty"`
}

// AllowedActionsRequest represents a request for allowed actions (URL params)
type AllowedActionsRequest struct {
	PrincipalID       string                 `json:"principal_id"`
	PrincipalRoles    []string               `json:"principal_roles,omitempty"`
	ResourceKind      string                 `json:"resource_kind"`
	ResourceID        string                 `json:"resource_id"`
	PrincipalAttrs    map[string]interface{} `json:"principal_attributes,omitempty"`
	ResourceAttrs     map[string]interface{} `json:"resource_attributes,omitempty"`
}

// AllowedActionsResponse represents allowed actions response
type AllowedActionsResponse struct {
	Actions  []string          `json:"actions"`
	Metadata *ResponseMetadata `json:"metadata,omitempty"`
}

// Principal represents the requester in REST API
type Principal struct {
	ID         string                 `json:"id"`
	Roles      []string               `json:"roles,omitempty"`
	Attributes map[string]interface{} `json:"attributes,omitempty"`
	Scope      string                 `json:"scope,omitempty"`
}

// Resource represents the resource being accessed in REST API
type Resource struct {
	Kind       string                 `json:"kind"`
	ID         string                 `json:"id"`
	Attributes map[string]interface{} `json:"attributes,omitempty"`
	Scope      string                 `json:"scope,omitempty"`
}

// ResponseMetadata contains evaluation details for REST API
type ResponseMetadata struct {
	EvaluationDurationMs float64                    `json:"evaluation_duration_ms"`
	PoliciesEvaluated    int                        `json:"policies_evaluated"`
	CacheHit             bool                       `json:"cache_hit"`
	Timestamp            time.Time                  `json:"timestamp"`
	RequestID            string                     `json:"request_id,omitempty"`
	ScopeResolution      *types.ScopeResolutionResult `json:"scope_resolution,omitempty"`
	PolicyResolution     *types.PolicyResolution      `json:"policy_resolution,omitempty"`
	DerivedRoles         []string                   `json:"derived_roles,omitempty"`
}

// PolicyRequest represents a policy create/update request
type PolicyRequest struct {
	APIVersion   string                 `json:"apiVersion"`
	Name         string                 `json:"name"`
	ResourceKind string                 `json:"resourceKind"`
	Rules        []RuleRequest          `json:"rules"`
	Scope        string                 `json:"scope,omitempty"`
	Principal    *PrincipalSelector     `json:"principal,omitempty"`
	Resources    []ResourceSelector     `json:"resources,omitempty"`
	Metadata     map[string]interface{} `json:"metadata,omitempty"`
}

// RuleRequest represents a policy rule in REST API
type RuleRequest struct {
	Name         string   `json:"name"`
	Actions      []string `json:"actions"`
	Effect       string   `json:"effect"`
	Condition    string   `json:"condition,omitempty"`
	Roles        []string `json:"roles,omitempty"`
	DerivedRoles []string `json:"derivedRoles,omitempty"`
}

// PrincipalSelector represents principal selection criteria
type PrincipalSelector struct {
	ID    string   `json:"id,omitempty"`
	Roles []string `json:"roles,omitempty"`
}

// ResourceSelector represents resource selection criteria
type ResourceSelector struct {
	Kind       string                 `json:"kind"`
	IDPattern  string                 `json:"idPattern,omitempty"`
	Attributes map[string]interface{} `json:"attributes,omitempty"`
}

// PolicyResponse represents a policy in REST API response
type PolicyResponse struct {
	ID           string                 `json:"id"`
	APIVersion   string                 `json:"apiVersion"`
	Name         string                 `json:"name"`
	ResourceKind string                 `json:"resourceKind"`
	Rules        []RuleRequest          `json:"rules"`
	Scope        string                 `json:"scope,omitempty"`
	Principal    *PrincipalSelector     `json:"principal,omitempty"`
	Resources    []ResourceSelector     `json:"resources,omitempty"`
	CreatedAt    time.Time              `json:"created_at"`
	UpdatedAt    time.Time              `json:"updated_at"`
	Metadata     map[string]interface{} `json:"metadata,omitempty"`
}

// PolicyListResponse represents a list of policies
type PolicyListResponse struct {
	Policies   []PolicyResponse `json:"policies"`
	Total      int              `json:"total"`
	Offset     int              `json:"offset"`
	Limit      int              `json:"limit"`
	NextOffset *int             `json:"next_offset,omitempty"`
}

// PrincipalRequest represents a principal create/update request
type PrincipalRequest struct {
	ID         string                 `json:"id"`
	Roles      []string               `json:"roles,omitempty"`
	Attributes map[string]interface{} `json:"attributes,omitempty"`
	Scope      string                 `json:"scope,omitempty"`
}

// PrincipalResponse represents a principal in REST API response
type PrincipalResponse struct {
	ID         string                 `json:"id"`
	Roles      []string               `json:"roles,omitempty"`
	Attributes map[string]interface{} `json:"attributes,omitempty"`
	Scope      string                 `json:"scope,omitempty"`
	CreatedAt  time.Time              `json:"created_at"`
	UpdatedAt  time.Time              `json:"updated_at"`
}

// HealthResponse represents health check response
type HealthResponse struct {
	Status    string                 `json:"status"`
	Timestamp time.Time              `json:"timestamp"`
	Checks    map[string]interface{} `json:"checks,omitempty"`
}

// StatusResponse represents service status response
type StatusResponse struct {
	Version      string                 `json:"version"`
	Uptime       string                 `json:"uptime"`
	CacheEnabled bool                   `json:"cache_enabled"`
	CacheStats   map[string]interface{} `json:"cache_stats,omitempty"`
	Timestamp    time.Time              `json:"timestamp"`
}

// ToInternalPrincipal converts REST Principal to internal types.Principal
func (p *Principal) ToInternalPrincipal() *types.Principal {
	return &types.Principal{
		ID:         p.ID,
		Roles:      p.Roles,
		Attributes: p.Attributes,
		Scope:      p.Scope,
	}
}

// ToInternalResource converts REST Resource to internal types.Resource
func (r *Resource) ToInternalResource() *types.Resource {
	return &types.Resource{
		Kind:       r.Kind,
		ID:         r.ID,
		Attributes: r.Attributes,
		Scope:      r.Scope,
	}
}

// FromInternalPolicy converts internal types.Policy to REST PolicyResponse
func FromInternalPolicy(p *types.Policy) *PolicyResponse {
	rules := make([]RuleRequest, len(p.Rules))
	for i, r := range p.Rules {
		rules[i] = RuleRequest{
			Name:         r.Name,
			Actions:      r.Actions,
			Effect:       string(r.Effect),
			Condition:    r.Condition,
			Roles:        r.Roles,
			DerivedRoles: r.DerivedRoles,
		}
	}

	resp := &PolicyResponse{
		ID:           p.Name,
		APIVersion:   p.APIVersion,
		Name:         p.Name,
		ResourceKind: p.ResourceKind,
		Rules:        rules,
		Scope:        p.Scope,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	// Convert principal selector if present
	if p.Principal != nil {
		resp.Principal = &PrincipalSelector{
			ID:    p.Principal.ID,
			Roles: p.Principal.Roles,
		}
	}

	// Convert resource selectors if present
	if len(p.Resources) > 0 {
		resp.Resources = make([]ResourceSelector, len(p.Resources))
		for i, r := range p.Resources {
			resp.Resources[i] = ResourceSelector{
				Kind:       r.Kind,
				IDPattern:  r.IDPattern,
				Attributes: r.Attributes,
			}
		}
	}

	return resp
}

// ToInternalPolicy converts REST PolicyRequest to internal types.Policy
func (pr *PolicyRequest) ToInternalPolicy() (*types.Policy, error) {
	if pr.Name == "" {
		return nil, fmt.Errorf("policy name is required")
	}
	if pr.ResourceKind == "" {
		return nil, fmt.Errorf("resourceKind is required")
	}

	rules := make([]*types.Rule, len(pr.Rules))
	for i, r := range pr.Rules {
		effect := types.EffectDeny
		if r.Effect == "allow" || r.Effect == "EFFECT_ALLOW" {
			effect = types.EffectAllow
		}

		rules[i] = &types.Rule{
			Name:         r.Name,
			Actions:      r.Actions,
			Effect:       effect,
			Condition:    r.Condition,
			Roles:        r.Roles,
			DerivedRoles: r.DerivedRoles,
		}
	}

	policy := &types.Policy{
		APIVersion:   pr.APIVersion,
		Name:         pr.Name,
		ResourceKind: pr.ResourceKind,
		Rules:        rules,
		Scope:        pr.Scope,
	}

	// Convert principal selector if present
	if pr.Principal != nil {
		policy.PrincipalPolicy = true
		policy.Principal = &types.PrincipalSelector{
			ID:    pr.Principal.ID,
			Roles: pr.Principal.Roles,
		}
	}

	// Convert resource selectors if present
	if len(pr.Resources) > 0 {
		policy.Resources = make([]*types.ResourceSelector, len(pr.Resources))
		for i, r := range pr.Resources {
			policy.Resources[i] = &types.ResourceSelector{
				Kind:       r.Kind,
				IDPattern:  r.IDPattern,
				Attributes: r.Attributes,
			}
		}
	}

	return policy, nil
}

// WriteJSON writes a JSON response with the given status code
func WriteJSON(w interface{}, statusCode int, data interface{}) error {
	type httpResponseWriter interface {
		Header() map[string][]string
		WriteHeader(int)
		Write([]byte) (int, error)
	}

	writer, ok := w.(httpResponseWriter)
	if !ok {
		return fmt.Errorf("invalid response writer type")
	}

	writer.Header()["Content-Type"] = []string{"application/json"}
	writer.WriteHeader(statusCode)

	if data != nil {
		return json.NewEncoder(writer).Encode(data)
	}
	return nil
}

// WriteError writes a JSON error response
func WriteError(w interface{}, statusCode int, message string, details map[string]interface{}) {
	type httpResponseWriter interface {
		Header() map[string][]string
		WriteHeader(int)
		Write([]byte) (int, error)
	}

	writer, ok := w.(httpResponseWriter)
	if !ok {
		return
	}

	writer.Header()["Content-Type"] = []string{"application/json"}
	writer.WriteHeader(statusCode)

	errResp := ErrorResponse{
		Error:   message,
		Message: message,
		Details: details,
	}

	json.NewEncoder(writer).Encode(errResp)
}
