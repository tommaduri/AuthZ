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
