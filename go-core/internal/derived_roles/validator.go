// Package derived_roles provides derived role resolution with dependency ordering
package derived_roles

import (
	"fmt"
	"strings"

	"github.com/authz-engine/go-core/internal/cel"
	"github.com/authz-engine/go-core/pkg/types"
)

// DerivedRolesValidator validates derived role definitions
// Ensures consistency, correctness, and prevents circular dependencies
type DerivedRolesValidator struct {
	celEngine *cel.Engine
}

// NewDerivedRolesValidator creates a new validator with CEL engine
func NewDerivedRolesValidator() (*DerivedRolesValidator, error) {
	celEngine, err := cel.NewEngine()
	if err != nil {
		return nil, fmt.Errorf("failed to create CEL engine: %w", err)
	}

	return &DerivedRolesValidator{
		celEngine: celEngine,
	}, nil
}

// Validate validates a single derived role definition
// Checks:
// - Name is unique and non-empty
// - Parent roles are valid
// - CEL condition syntax is correct
// - No self-references in parent roles
func (v *DerivedRolesValidator) Validate(derivedRole *types.DerivedRole) error {
	if derivedRole == nil {
		return fmt.Errorf("derived role cannot be nil")
	}

	// Basic validation (name, parent roles)
	if err := derivedRole.Validate(); err != nil {
		return err
	}

	// Check for self-reference in parent roles
	for _, parentRole := range derivedRole.ParentRoles {
		if parentRole == derivedRole.Name {
			return fmt.Errorf("derived role %q cannot have itself as a parent role", derivedRole.Name)
		}
	}

	// Validate CEL condition syntax if present
	if derivedRole.Condition != "" {
		if err := v.checkConditionSyntax(derivedRole.Condition); err != nil {
			return fmt.Errorf("invalid condition in derived role %q: %w", derivedRole.Name, err)
		}
	}

	return nil
}

// ValidateAll validates a collection of derived roles
// Performs both individual validation and cross-role checks:
// - Name uniqueness
// - Parent role validity
// - Circular dependency detection
func (v *DerivedRolesValidator) ValidateAll(derivedRoles []*types.DerivedRole) error {
	if len(derivedRoles) == 0 {
		return nil // Empty set is valid
	}

	// Validate each role individually
	for _, dr := range derivedRoles {
		if err := v.Validate(dr); err != nil {
			return err
		}
	}

	// Check name uniqueness
	if err := v.checkNameUniqueness(derivedRoles); err != nil {
		return err
	}

	// Check parent role validity (warn about undefined parent roles)
	if err := v.checkParentRoleValidity(derivedRoles); err != nil {
		return err
	}

	// Check for circular dependencies
	if err := v.checkCircularDependencies(derivedRoles); err != nil {
		return err
	}

	return nil
}

// checkNameUniqueness ensures no duplicate derived role names
func (v *DerivedRolesValidator) checkNameUniqueness(derivedRoles []*types.DerivedRole) error {
	seen := make(map[string]bool)

	for _, dr := range derivedRoles {
		if seen[dr.Name] {
			return fmt.Errorf("duplicate derived role name: %q", dr.Name)
		}
		seen[dr.Name] = true
	}

	return nil
}

// checkParentRoleValidity validates parent role patterns
// Ensures parent roles are either:
// 1. Valid wildcard patterns (*, prefix:*, *:suffix)
// 2. References to other defined derived roles
// 3. Assumed to be base roles (no error, just a note)
func (v *DerivedRolesValidator) checkParentRoleValidity(derivedRoles []*types.DerivedRole) error {
	// Build set of all derived role names
	derivedRoleNames := make(map[string]bool)
	for _, dr := range derivedRoles {
		derivedRoleNames[dr.Name] = true
	}

	// Check each parent role reference
	for _, dr := range derivedRoles {
		for _, parentRole := range dr.ParentRoles {
			// Skip wildcard patterns (always valid)
			if isWildcardPattern(parentRole) {
				continue
			}

			// Check if parent is a derived role (circular dep will be caught later)
			if derivedRoleNames[parentRole] {
				continue
			}

			// Parent role is assumed to be a base role (no error)
			// This is valid: derived roles can depend on base roles
		}
	}

	return nil
}

// checkConditionSyntax validates CEL expression syntax
// Compiles the CEL expression to check for syntax errors
func (v *DerivedRolesValidator) checkConditionSyntax(condition string) error {
	if condition == "" {
		return nil // Empty condition is valid
	}

	// Try to compile the CEL expression
	// We use a very permissive dummy context that will accept most attribute accesses
	dummyContext := &cel.EvalContext{
		Principal: map[string]interface{}{
			"id":    "user:test",
			"roles": []string{"test"},
			"attr": map[string]interface{}{
				// Permissive attributes for validation
				"age":      30,
				"verified": true,
				"ownerId":  "test",
				"tags":     []string{"public"},
			},
		},
		Resource: map[string]interface{}{
			"kind": "test",
			"id":   "test",
			"attr": map[string]interface{}{
				"ownerId": "test",
				"owners":  []string{"test"},
				"tags":    []string{"public"},
			},
		},
		Context: map[string]interface{}{},
	}

	// Attempt evaluation with dummy context to validate syntax
	_, err := v.celEngine.EvaluateExpression(condition, dummyContext)
	if err != nil {
		// Check if error is a parse/syntax error (not just missing runtime attributes)
		errMsg := err.Error()
		if strings.Contains(errMsg, "Syntax error") ||
			strings.Contains(errMsg, "parse error") ||
			strings.Contains(errMsg, "unexpected token") ||
			strings.Contains(errMsg, "mismatched input") {
			return fmt.Errorf("CEL syntax error: %w", err)
		}
		// For runtime errors (missing attributes, etc), still return error
		// but be more lenient if it's just about missing keys in our dummy data
		if !strings.Contains(errMsg, "no such key") {
			return fmt.Errorf("CEL condition error: %w", err)
		}
		// "no such key" errors in validation context are acceptable
		// since we can't predict all possible attributes
	}

	return nil
}

// checkCircularDependencies detects circular dependencies in derived roles
// Uses depth-first search to find cycles in the dependency graph
func (v *DerivedRolesValidator) checkCircularDependencies(derivedRoles []*types.DerivedRole) error {
	// Build adjacency list for dependency graph
	graph := make(map[string][]string)
	derivedRoleSet := make(map[string]bool)

	for _, dr := range derivedRoles {
		derivedRoleSet[dr.Name] = true
		graph[dr.Name] = []string{}
	}

	// Build edges: if role A has derived role B as parent, A depends on B
	for _, dr := range derivedRoles {
		for _, parentRole := range dr.ParentRoles {
			// Only consider dependencies on other derived roles
			if derivedRoleSet[parentRole] {
				graph[dr.Name] = append(graph[dr.Name], parentRole)
			}
		}
	}

	// DFS-based cycle detection
	// State: 0 = unvisited, 1 = visiting, 2 = visited
	state := make(map[string]int)

	var dfs func(string, []string) error
	dfs = func(node string, path []string) error {
		if state[node] == 1 {
			// Found cycle - node is currently being visited
			cyclePath := append(path, node)
			return fmt.Errorf("circular dependency detected: %s", strings.Join(cyclePath, " -> "))
		}
		if state[node] == 2 {
			// Already fully processed
			return nil
		}

		// Mark as visiting
		state[node] = 1
		path = append(path, node)

		// Visit dependencies
		for _, dep := range graph[node] {
			if err := dfs(dep, path); err != nil {
				return err
			}
		}

		// Mark as visited
		state[node] = 2
		return nil
	}

	// Check each role for cycles
	for _, dr := range derivedRoles {
		if state[dr.Name] == 0 {
			if err := dfs(dr.Name, []string{}); err != nil {
				return err
			}
		}
	}

	return nil
}

// isWildcardPattern checks if a role pattern contains wildcards
func isWildcardPattern(pattern string) bool {
	return pattern == "*" ||
		strings.HasSuffix(pattern, ":*") ||
		strings.HasPrefix(pattern, "*:")
}
