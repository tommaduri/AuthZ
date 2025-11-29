// Package derived_roles provides derived role resolution with dependency ordering
package derived_roles

import (
	"fmt"
	"sort"
	"strings"

	"github.com/authz-engine/go-core/internal/cel"
	"github.com/authz-engine/go-core/pkg/types"
)

// DerivedRolesResolver resolves derived roles with topological sorting
// and CEL condition evaluation. Thread-safe for concurrent use.
type DerivedRolesResolver struct {
	celEngine *cel.Engine
}

// NewDerivedRolesResolver creates a new derived roles resolver with CEL engine
func NewDerivedRolesResolver() (*DerivedRolesResolver, error) {
	celEngine, err := cel.NewEngine()
	if err != nil {
		return nil, fmt.Errorf("failed to create CEL engine: %w", err)
	}

	return &DerivedRolesResolver{
		celEngine: celEngine,
	}, nil
}

// Resolve resolves all derived roles for a principal in dependency order
// Returns the expanded set of roles (original + derived)
// Algorithm:
// 1. Build dependency graph from derived role definitions
// 2. Topologically sort roles to ensure correct evaluation order
// 3. Evaluate each role's condition using CEL
// 4. Add matched derived roles to principal's role set
func (r *DerivedRolesResolver) Resolve(
	principal *types.Principal,
	resource *types.Resource,
	derivedRoles []*types.DerivedRole,
) ([]string, error) {
	if principal == nil {
		return nil, fmt.Errorf("principal cannot be nil")
	}

	// Start with principal's base roles
	resolvedRoles := make(map[string]bool)
	for _, role := range principal.Roles {
		resolvedRoles[role] = true
	}

	// No derived roles to resolve
	if len(derivedRoles) == 0 {
		return principal.Roles, nil
	}

	// Validate all derived roles first
	for _, dr := range derivedRoles {
		if err := dr.Validate(); err != nil {
			return nil, fmt.Errorf("invalid derived role: %w", err)
		}
	}

	// Build dependency graph
	graph, err := r.buildRoleGraph(derivedRoles)
	if err != nil {
		return nil, fmt.Errorf("failed to build role graph: %w", err)
	}

	// Topologically sort roles for evaluation order
	sortedRoles, err := r.topologicalSort(graph, derivedRoles)
	if err != nil {
		return nil, fmt.Errorf("failed to sort roles: %w", err)
	}

	// Evaluate each derived role in dependency order
	currentRoles := principal.Roles
	for _, derivedRole := range sortedRoles {
		// Check if parent roles match
		if !derivedRole.Match(currentRoles) {
			continue
		}

		// Evaluate condition (empty condition = always true)
		matched, err := r.evaluateCondition(derivedRole, principal, resource)
		if err != nil {
			return nil, fmt.Errorf("failed to evaluate condition for role %q: %w", derivedRole.Name, err)
		}

		if matched {
			// Add derived role to current set
			if !resolvedRoles[derivedRole.Name] {
				resolvedRoles[derivedRole.Name] = true
				currentRoles = append(currentRoles, derivedRole.Name)
			}
		}
	}

	// Convert map to sorted slice for deterministic results
	result := make([]string, 0, len(resolvedRoles))
	for role := range resolvedRoles {
		result = append(result, role)
	}
	sort.Strings(result)

	return result, nil
}

// buildRoleGraph constructs a dependency graph from derived role definitions
// Each node represents a derived role, edges represent dependencies
func (r *DerivedRolesResolver) buildRoleGraph(derivedRoles []*types.DerivedRole) (map[string]*types.RoleGraphNode, error) {
	graph := make(map[string]*types.RoleGraphNode)

	// Create nodes for all derived roles
	for _, dr := range derivedRoles {
		graph[dr.Name] = types.NewRoleGraphNode(dr.Name)
	}

	// Build edges: if role A has role B as a parent, and B is also a derived role,
	// then A depends on B (edge: B -> A, meaning A has incoming edge from B)
	for _, dr := range derivedRoles {
		currentNode := graph[dr.Name]

		for _, parentRole := range dr.ParentRoles {
			// Check if parent is also a derived role
			if _, exists := graph[parentRole]; exists {
				// A depends on B, so A has an incoming edge
				currentNode.AddDependency(parentRole)
			}
		}
	}

	// Detect circular dependencies
	if err := r.detectCircularDependency(graph); err != nil {
		return nil, err
	}

	return graph, nil
}

// topologicalSort performs Kahn's algorithm for topological sorting
// Returns derived roles in evaluation order (dependencies first)
func (r *DerivedRolesResolver) topologicalSort(
	graph map[string]*types.RoleGraphNode,
	derivedRoles []*types.DerivedRole,
) ([]*types.DerivedRole, error) {
	// Build role name -> DerivedRole lookup
	roleMap := make(map[string]*types.DerivedRole)
	for _, dr := range derivedRoles {
		roleMap[dr.Name] = dr
	}

	// Build reverse edges: if A depends on B, add edge B -> A
	// This tells us "who depends on me"
	reverseEdges := make(map[string][]string)
	inDegree := make(map[string]int)

	for name := range graph {
		inDegree[name] = 0
		reverseEdges[name] = []string{}
	}

	// Count in-degrees: if A depends on B, increment A's in-degree
	for name, node := range graph {
		inDegree[name] = len(node.Dependencies)
		for _, dep := range node.Dependencies {
			reverseEdges[dep] = append(reverseEdges[dep], name)
		}
	}

	// Find nodes with no dependencies (in-degree = 0)
	queue := []string{}
	for name, degree := range inDegree {
		if degree == 0 {
			queue = append(queue, name)
		}
	}

	// Kahn's algorithm
	sorted := []string{}
	for len(queue) > 0 {
		// Dequeue
		current := queue[0]
		queue = queue[1:]
		sorted = append(sorted, current)

		// Reduce in-degree for nodes that depend on current
		for _, dependent := range reverseEdges[current] {
			inDegree[dependent]--
			if inDegree[dependent] == 0 {
				queue = append(queue, dependent)
			}
		}
	}

	// Check for cycles (not all nodes processed)
	if len(sorted) != len(graph) {
		return nil, fmt.Errorf("circular dependency detected in derived roles")
	}

	// Convert sorted role names to DerivedRole objects
	result := make([]*types.DerivedRole, 0, len(derivedRoles))
	for _, name := range sorted {
		if dr, exists := roleMap[name]; exists {
			result = append(result, dr)
		}
	}

	// Add roles with no dependencies on other derived roles (only base roles)
	for _, dr := range derivedRoles {
		if _, inGraph := graph[dr.Name]; !inGraph {
			result = append(result, dr)
		}
	}

	return result, nil
}

// evaluateCondition evaluates the CEL condition for a derived role
// Returns true if condition is empty or evaluates to true
func (r *DerivedRolesResolver) evaluateCondition(
	derivedRole *types.DerivedRole,
	principal *types.Principal,
	resource *types.Resource,
) (bool, error) {
	// Empty condition = always true
	if derivedRole.Condition == "" {
		return true, nil
	}

	// Build evaluation context
	ctx := &cel.EvalContext{
		Principal: principal.ToMap(),
		Resource:  map[string]interface{}{},
		Context:   map[string]interface{}{},
	}

	// Add resource if provided
	if resource != nil {
		ctx.Resource = resource.ToMap()
	}

	// Evaluate CEL expression
	result, err := r.celEngine.EvaluateExpression(derivedRole.Condition, ctx)
	if err != nil {
		return false, fmt.Errorf("CEL evaluation error: %w", err)
	}

	return result, nil
}

// detectCircularDependency detects circular dependencies using DFS
func (r *DerivedRolesResolver) detectCircularDependency(graph map[string]*types.RoleGraphNode) error {
	// Track visit state: 0 = unvisited, 1 = visiting, 2 = visited
	state := make(map[string]int)

	var dfs func(string, []string) error
	dfs = func(node string, path []string) error {
		if state[node] == 1 {
			// Found cycle
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
		if graphNode, exists := graph[node]; exists {
			for _, dep := range graphNode.Dependencies {
				if err := dfs(dep, path); err != nil {
					return err
				}
			}
		}

		// Mark as visited
		state[node] = 2
		return nil
	}

	// Run DFS from each node
	for node := range graph {
		if state[node] == 0 {
			if err := dfs(node, []string{}); err != nil {
				return err
			}
		}
	}

	return nil
}
