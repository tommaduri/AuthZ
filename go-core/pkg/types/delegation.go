// Package types provides delegation chain types for MCP/A2A protocol
package types

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// DelegationChain represents an agent-to-agent delegation chain
// Supports MCP/A2A protocol with max 5 hops default
type DelegationChain struct {
	SourceAgentID string    `json:"sourceAgentId"`
	TargetAgentID string    `json:"targetAgentId"`
	Scopes        []string  `json:"scopes"`
	MaxHops       int       `json:"maxHops"`      // Default: 5
	ExpiresAt     time.Time `json:"expiresAt"`
	CreatedAt     time.Time `json:"createdAt"`
}

// DelegationRequest represents an agent-to-agent authorization request
// Note: Uses Agent type from agent.go for identity lifecycle management
type DelegationRequest struct {
	SourceAgent Agent             `json:"sourceAgent"`
	TargetAgent Agent             `json:"targetAgent"`
	Chain       *DelegationChain  `json:"chain"`
	Principal   Principal         `json:"principal"` // Original requester
	Action      string            `json:"action"`
	Resource    Resource          `json:"resource"`
}

const (
	// MaxDelegationHops is the maximum allowed delegation chain length
	MaxDelegationHops = 5
)

// IsExpired checks if the delegation chain has expired
func (dc *DelegationChain) IsExpired() bool {
	return time.Now().After(dc.ExpiresAt)
}

// HasScope checks if the delegation chain includes a specific scope
// Supports wildcards: "read:*", "*:documents", "*"
func (dc *DelegationChain) HasScope(scope string) bool {
	for _, s := range dc.Scopes {
		if s == "*" {
			return true // Full wildcard
		}
		if s == scope {
			return true // Exact match
		}
		// Wildcard matching
		if strings.HasSuffix(s, ":*") {
			prefix := strings.TrimSuffix(s, ":*")
			if strings.HasPrefix(scope, prefix+":") {
				return true
			}
		}
		if strings.HasPrefix(s, "*:") {
			suffix := strings.TrimPrefix(s, "*:")
			if strings.HasSuffix(scope, ":"+suffix) {
				return true
			}
		}
	}
	return false
}

// ValidateMaxHops checks if max hops is within allowed limit
func (dc *DelegationChain) ValidateMaxHops() error {
	if dc.MaxHops <= 0 {
		return errors.New("max hops must be positive")
	}
	if dc.MaxHops > MaxDelegationHops {
		return fmt.Errorf("max hops %d exceeds limit of %d", dc.MaxHops, MaxDelegationHops)
	}
	return nil
}

// CheckCircular detects circular delegation in the chain path
func (dc *DelegationChain) CheckCircular(chainPath []string) error {
	// Self-delegation check
	if dc.SourceAgentID == dc.TargetAgentID {
		return errors.New("circular delegation: agent cannot delegate to itself")
	}

	// Check if target agent is already in the chain path (would create a cycle)
	for _, agentID := range chainPath {
		if agentID == dc.TargetAgentID {
			return fmt.Errorf("circular delegation detected: %s already in chain path", dc.TargetAgentID)
		}
	}

	return nil
}

// Validate performs comprehensive validation of the delegation request
func (dr *DelegationRequest) Validate() error {
	// Source agent validation
	if dr.SourceAgent.ID == "" {
		return errors.New("source agent ID required")
	}
	if dr.SourceAgent.Status != StatusActive {
		return errors.New("source agent not active")
	}

	// Target agent validation
	if dr.TargetAgent.ID == "" {
		return errors.New("target agent ID required")
	}
	if dr.TargetAgent.Status != StatusActive {
		return errors.New("target agent not active")
	}

	// Chain validation
	if dr.Chain == nil {
		return errors.New("delegation chain required")
	}
	if dr.Chain.IsExpired() {
		return errors.New("delegation chain expired")
	}
	if err := dr.Chain.ValidateMaxHops(); err != nil {
		return fmt.Errorf("delegation chain validation failed: %w", err)
	}

	// Action and resource validation
	if dr.Action == "" {
		return errors.New("action required")
	}
	if dr.Resource.Kind == "" {
		return errors.New("resource kind required")
	}

	return nil
}

// Note: Agent.ToPrincipal(), Agent.IsActive(), and Agent.IsExpired() are defined in agent.go
