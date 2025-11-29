// Package policy provides policy storage and management
package policy

import (
	"github.com/authz-engine/go-core/pkg/types"
)

// Store defines the policy storage interface
type Store interface {
	// Get retrieves a policy by name
	Get(name string) (*types.Policy, error)

	// GetAll retrieves all policies
	GetAll() []*types.Policy

	// FindPolicies finds policies matching resource kind and actions
	FindPolicies(resourceKind string, actions []string) []*types.Policy

	// FindPoliciesForScope finds policies for a specific scope and resource kind
	FindPoliciesForScope(scope, resourceKind string, actions []string) []*types.Policy

	// Phase 3: Principal policy lookups
	// FindPoliciesByPrincipal finds policies for a specific principal ID and resource kind
	FindPoliciesByPrincipal(principalID, resourceKind string) []*types.Policy

	// FindPoliciesByRoles finds policies for a set of roles and resource kind
	FindPoliciesByRoles(roles []string, resourceKind string) []*types.Policy

	// Add adds a policy to the store
	Add(policy *types.Policy) error

	// Remove removes a policy from the store
	Remove(name string) error

	// Clear removes all policies
	Clear()

	// Count returns the number of policies
	Count() int

	// Load loads policies from a source
	Load(source string) error

	// Reload reloads all policies
	Reload() error

	// Phase 4: Derived roles methods
	// GetDerivedRoles returns all derived role definitions
	GetDerivedRoles() []*types.DerivedRole

	// GetDerivedRole retrieves a specific derived role by name
	GetDerivedRole(name string) (*types.DerivedRole, error)

	// AddDerivedRole adds a derived role definition
	AddDerivedRole(derivedRole *types.DerivedRole) error

	// RemoveDerivedRole removes a derived role by name
	RemoveDerivedRole(name string) error

	// ClearDerivedRoles removes all derived role definitions
	ClearDerivedRoles()
}

// PolicyEvent represents a policy change event
type PolicyEvent struct {
	Type   EventType
	Policy *types.Policy
}

// EventType represents the type of policy event
type EventType int

const (
	EventAdded EventType = iota
	EventModified
	EventDeleted
)
