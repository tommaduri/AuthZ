// Package delegation provides validation for agent-to-agent delegation chains
package delegation

import (
	"errors"
	"fmt"
	"strings"

	"github.com/authz-engine/go-core/pkg/types"
)

// Validator validates delegation chains and requests
type Validator struct {
	// Future: Add caching, metrics
}

// NewValidator creates a new delegation validator
func NewValidator() *Validator {
	return &Validator{}
}

// ValidateChain validates a delegation chain structure
func (v *Validator) ValidateChain(chain *types.DelegationChain) error {
	if chain == nil {
		return errors.New("delegation chain is nil")
	}

	// Validate source agent
	if chain.SourceAgentID == "" {
		return errors.New("source agent ID required")
	}

	// Validate target agent
	if chain.TargetAgentID == "" {
		return errors.New("target agent ID required")
	}

	// Validate scopes
	if len(chain.Scopes) == 0 {
		return errors.New("at least one scope required")
	}

	// Validate expiration
	if chain.IsExpired() {
		return errors.New("delegation chain expired")
	}

	// Validate max hops
	if err := chain.ValidateMaxHops(); err != nil {
		return err
	}

	return nil
}

// ValidateAgentStatus validates an agent's active status
func (v *Validator) ValidateAgentStatus(agent *types.Agent) error {
	if agent == nil {
		return errors.New("agent is nil")
	}

	// Check agent status
	if agent.Status != "active" {
		return fmt.Errorf("agent %s not active (status: %s)", agent.ID, agent.Status)
	}

	// Check if agent has expired
	if !agent.IsActive() {
		return fmt.Errorf("agent %s expired or revoked", agent.ID)
	}

	return nil
}

// ValidateCredentials validates agent credentials
func (v *Validator) ValidateCredentials(agent *types.Agent) error {
	if agent == nil {
		return errors.New("agent is nil")
	}

	if len(agent.Credentials) == 0 {
		return fmt.Errorf("agent %s missing credentials", agent.ID)
	}

	// Validate known credential types
	validTypes := map[string]bool{
		"api-key":      true,
		"oauth-token":  true,
		"certificate":  true,
		"ed25519-key":  true,
		"jwt":          true,
		"public-key":   true,
	}

	// Check that at least one credential is valid
	hasValidCred := false
	for _, cred := range agent.Credentials {
		if !validTypes[cred.Type] {
			return fmt.Errorf("agent %s has invalid credential type: %s", agent.ID, cred.Type)
		}

		if cred.Value == "" {
			return fmt.Errorf("agent %s credential %s missing value", agent.ID, cred.ID)
		}

		// Check if credential is not expired
		if !cred.IsExpired() {
			hasValidCred = true
		}
	}

	if !hasValidCred {
		return fmt.Errorf("agent %s has no valid (non-expired) credentials", agent.ID)
	}

	return nil
}

// ValidateScopeMatch validates that the requested scope matches the chain scopes
func (v *Validator) ValidateScopeMatch(chain *types.DelegationChain, requestedScope string) error {
	if chain == nil {
		return errors.New("delegation chain is nil")
	}

	if !chain.HasScope(requestedScope) {
		return fmt.Errorf("requested scope %s not allowed by delegation chain scopes: %v",
			requestedScope, chain.Scopes)
	}

	return nil
}

// ValidateDelegationRequest performs comprehensive validation of a delegation request
func (v *Validator) ValidateDelegationRequest(req *types.DelegationRequest) error {
	if req == nil {
		return errors.New("delegation request is nil")
	}

	// Validate basic request structure
	if err := req.Validate(); err != nil {
		return fmt.Errorf("request validation failed: %w", err)
	}

	// Validate source agent status and credentials
	if err := v.ValidateAgentStatus(&req.SourceAgent); err != nil {
		return fmt.Errorf("source agent validation failed: %w", err)
	}
	if err := v.ValidateCredentials(&req.SourceAgent); err != nil {
		return fmt.Errorf("source agent credential validation failed: %w", err)
	}

	// Validate target agent status and credentials
	if err := v.ValidateAgentStatus(&req.TargetAgent); err != nil {
		return fmt.Errorf("target agent validation failed: %w", err)
	}
	if err := v.ValidateCredentials(&req.TargetAgent); err != nil {
		return fmt.Errorf("target agent credential validation failed: %w", err)
	}

	// Validate delegation chain
	if err := v.ValidateChain(req.Chain); err != nil {
		return fmt.Errorf("chain validation failed: %w", err)
	}

	// Validate scope match (action:resource_kind format)
	requestedScope := fmt.Sprintf("%s:%s", req.Action, req.Resource.Kind)
	if err := v.ValidateScopeMatch(req.Chain, requestedScope); err != nil {
		return err
	}

	// Validate agent IDs match chain
	if req.SourceAgent.ID != req.Chain.SourceAgentID {
		return fmt.Errorf("source agent ID mismatch: %s != %s",
			req.SourceAgent.ID, req.Chain.SourceAgentID)
	}
	if req.TargetAgent.ID != req.Chain.TargetAgentID {
		return fmt.Errorf("target agent ID mismatch: %s != %s",
			req.TargetAgent.ID, req.Chain.TargetAgentID)
	}

	return nil
}

// CheckChainLength validates delegation chain length against max hops
func (v *Validator) CheckChainLength(chainLength int, maxHops int) error {
	if chainLength > maxHops {
		return fmt.Errorf("delegation chain length %d exceeds max hops %d", chainLength, maxHops)
	}
	return nil
}

// BuildScopeString builds a scope string from action and resource
func BuildScopeString(action string, resource *types.Resource) string {
	if resource == nil {
		return action
	}
	return fmt.Sprintf("%s:%s", action, resource.Kind)
}

// ParseScopeString parses a scope string into action and resource kind
func ParseScopeString(scope string) (action string, resourceKind string) {
	parts := strings.SplitN(scope, ":", 2)
	if len(parts) == 2 {
		return parts[0], parts[1]
	}
	return parts[0], ""
}
