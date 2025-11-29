// Package types provides shared types for the authorization engine
package types

import (
	"fmt"
	"strings"
)

// DerivedRole represents a role computed from parent roles and conditions
// Derived roles enable dynamic role assignment based on runtime evaluation
// of CEL expressions against principal and resource attributes
type DerivedRole struct {
	Name        string   `json:"name" yaml:"name"`               // Unique derived role name (e.g., "document_approver")
	ParentRoles []string `json:"parentRoles" yaml:"parentRoles"` // Parent roles required (supports wildcards: *, prefix:*, *:suffix)
	Condition   string   `json:"condition" yaml:"condition"`     // CEL expression for conditional activation
}

// Match checks if a principal qualifies for this derived role
// Returns true if principal has ALL required parent roles (AND logic)
// Each parent role pattern must match at least one of the principal's roles
// Supports wildcard patterns: *, prefix:*, *:suffix
func (d *DerivedRole) Match(principalRoles []string) bool {
	if len(d.ParentRoles) == 0 {
		return false // No parent roles defined - invalid derived role
	}

	// ALL parent roles must match (AND logic)
	for _, parentPattern := range d.ParentRoles {
		foundMatch := false
		for _, principalRole := range principalRoles {
			if matchesPattern(principalRole, parentPattern) {
				foundMatch = true
				break
			}
		}
		if !foundMatch {
			return false // This parent role requirement not met
		}
	}

	return true // All parent role requirements met
}

// Validate checks if the derived role definition is valid
func (d *DerivedRole) Validate() error {
	if d.Name == "" {
		return fmt.Errorf("derived role name cannot be empty")
	}

	if len(d.ParentRoles) == 0 {
		return fmt.Errorf("derived role %q must have at least one parent role", d.Name)
	}

	// Validate parent role patterns
	for _, parentRole := range d.ParentRoles {
		if parentRole == "" {
			return fmt.Errorf("derived role %q has empty parent role", d.Name)
		}
		// Check for invalid wildcard patterns
		if strings.Count(parentRole, "*") > 1 {
			return fmt.Errorf("derived role %q has invalid parent role pattern %q (multiple wildcards not supported)", d.Name, parentRole)
		}
	}

	// Note: Condition validation (CEL compilation) is done separately by the CEL engine
	// Empty conditions are valid and always evaluate to true

	return nil
}

// RoleGraphNode represents a node in the derived roles dependency graph
// Used for topological sorting to resolve roles in correct dependency order
type RoleGraphNode struct {
	Role         string          // The derived role name
	Dependencies []string        // Other derived roles this role depends on (via parent roles)
	InDegree     int             // Number of incoming edges (for Kahn's algorithm)
	Resolved     bool            // Whether this role has been resolved in current pass
	AdjList      map[string]bool // Adjacency list for efficient lookups
}

// NewRoleGraphNode creates a new graph node for topological sorting
func NewRoleGraphNode(roleName string) *RoleGraphNode {
	return &RoleGraphNode{
		Role:         roleName,
		Dependencies: []string{},
		InDegree:     0,
		Resolved:     false,
		AdjList:      make(map[string]bool),
	}
}

// AddDependency adds a dependency to this node
func (n *RoleGraphNode) AddDependency(dependsOn string) {
	if !n.AdjList[dependsOn] {
		n.Dependencies = append(n.Dependencies, dependsOn)
		n.AdjList[dependsOn] = true
		n.InDegree++
	}
}

// matchesPattern checks if a role matches a wildcard pattern
// Supports three pattern types:
// 1. Exact match: "admin" matches "admin"
// 2. Wildcard: "*" matches any role
// 3. Prefix wildcard: "admin:*" matches "admin:read", "admin:write"
// 4. Suffix wildcard: "*:viewer" matches "document:viewer", "project:viewer"
func matchesPattern(role, pattern string) bool {
	// Exact match
	if role == pattern {
		return true
	}

	// Universal wildcard
	if pattern == "*" {
		return true
	}

	// Prefix wildcard: "prefix:*"
	if strings.HasSuffix(pattern, ":*") {
		prefix := strings.TrimSuffix(pattern, ":*")
		return strings.HasPrefix(role, prefix+":")
	}

	// Suffix wildcard: "*:suffix"
	if strings.HasPrefix(pattern, "*:") {
		suffix := strings.TrimPrefix(pattern, "*:")
		return strings.HasSuffix(role, ":"+suffix)
	}

	return false
}
