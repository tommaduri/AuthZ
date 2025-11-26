package policy

import (
	"fmt"
	"strings"

	"github.com/authz-engine/go-core/pkg/types"
)

// ValidationConfig configures enhanced validator behavior
type ValidationConfig struct {
	StrictMode       bool     // Fail on warnings
	AllowedActions   []string // Whitelist of valid actions (empty = allow all)
	AllowedResources []string // Whitelist of resource kinds (empty = allow all)
	MaxRuleDepth     int      // Prevent infinite recursion (default: 10)
	ValidateCEL      bool     // Enable CEL expression validation (default: true)
	CheckCircularDep bool     // Check for circular derived role dependencies (default: true)
}

// DefaultValidationConfig returns default validation configuration
func DefaultValidationConfig() ValidationConfig {
	return ValidationConfig{
		StrictMode:       false,
		AllowedActions:   []string{}, // Allow all by default
		AllowedResources: []string{}, // Allow all by default
		MaxRuleDepth:     10,
		ValidateCEL:      true,
		CheckCircularDep: true,
	}
}

// ValidationResult contains detailed validation outcome
type ValidationResult struct {
	Valid    bool
	Errors   []ValidationError
	Warnings []ValidationWarning
}

// ValidationError represents a validation error
type ValidationError struct {
	Type    string // "syntax", "semantic", "cel", "circular_dep", "schema"
	Message string
	Path    string // e.g., "rules[0].condition"
	Details string // Additional context
}

// ValidationWarning represents a validation warning
type ValidationWarning struct {
	Type    string
	Message string
	Path    string
}

// EnhancedValidator provides comprehensive policy validation
type EnhancedValidator struct {
	config    ValidationConfig
	validator *Validator // Base validator
}

// NewEnhancedValidator creates a new enhanced validator
func NewEnhancedValidator(config ValidationConfig) *EnhancedValidator {
	return &EnhancedValidator{
		config:    config,
		validator: NewValidator(),
	}
}

// ValidatePolicyEnhanced performs comprehensive validation
func (ev *EnhancedValidator) ValidatePolicyEnhanced(policy *types.Policy) *ValidationResult {
	result := &ValidationResult{
		Valid:    true,
		Errors:   make([]ValidationError, 0),
		Warnings: make([]ValidationWarning, 0),
	}

	// 1. Basic validation using existing validator (without CEL if we handle it)
	// The basic validator will still check CEL if present, so we need to check first
	// and categorize the error properly
	if err := ev.validator.ValidatePolicy(policy); err != nil {
		result.Valid = false

		// Check if this is a CEL-related error and extract the path
		errorType := "basic"
		errorPath := "policy"

		if strings.Contains(err.Error(), "CEL") || strings.Contains(err.Error(), "condition") {
			errorType = "cel"
			// Try to extract the rule index from the error message
			// Error format: "invalid rule at index X: invalid CEL condition: ..."
			if strings.Contains(err.Error(), "invalid rule at index") {
				// Extract rule index
				var ruleIndex int
				if _, scanErr := fmt.Sscanf(err.Error(), "invalid rule at index %d", &ruleIndex); scanErr == nil {
					errorPath = fmt.Sprintf("rules[%d].condition", ruleIndex)
				}
			}
		}

		result.Errors = append(result.Errors, ValidationError{
			Type:    errorType,
			Message: err.Error(),
			Path:    errorPath,
		})

		// Don't return early - continue with other validations to collect all errors
	}

	// 2. Enhanced CEL validation (only if enabled and no basic CEL errors found)
	if ev.config.ValidateCEL && result.Valid {
		ev.validateCELExpressions(policy, result)
	}

	// 3. Check for circular dependencies in derived roles
	if ev.config.CheckCircularDep && result.Valid {
		ev.checkCircularDependencies(policy, result)
	}

	// 4. Validate against allowed actions/resources
	if result.Valid {
		ev.validateAllowedValues(policy, result)
	}

	// 5. Check rule consistency (only warnings, don't affect Valid status)
	warnings := ev.validator.ValidateRuleConsistency(policy)
	for _, warning := range warnings {
		result.Warnings = append(result.Warnings, ValidationWarning{
			Type:    "consistency",
			Message: warning,
			Path:    "rules",
		})
	}

	// In strict mode, warnings become errors
	if ev.config.StrictMode && len(result.Warnings) > 0 {
		result.Valid = false
		for _, warning := range result.Warnings {
			result.Errors = append(result.Errors, ValidationError{
				Type:    "warning_as_error",
				Message: warning.Message,
				Path:    warning.Path,
			})
		}
	}

	return result
}

// validateCELExpressions validates all CEL expressions in the policy
func (ev *EnhancedValidator) validateCELExpressions(policy *types.Policy, result *ValidationResult) {
	for i, rule := range policy.Rules {
		if rule.Condition != "" {
			if err := ev.validator.validateCELExpression(rule.Condition); err != nil {
				result.Valid = false
				result.Errors = append(result.Errors, ValidationError{
					Type:    "cel",
					Message: fmt.Sprintf("Invalid CEL expression: %v", err),
					Path:    fmt.Sprintf("rules[%d].condition", i),
					Details: rule.Condition,
				})
			}
		}
	}
}

// checkCircularDependencies detects circular dependencies in derived roles
func (ev *EnhancedValidator) checkCircularDependencies(policy *types.Policy, result *ValidationResult) {
	// Build dependency graph for derived roles
	graph := make(map[string][]string)

	for _, rule := range policy.Rules {
		if len(rule.DerivedRoles) > 0 {
			for _, derivedRole := range rule.DerivedRoles {
				// Track which roles this derived role depends on
				if len(rule.Roles) > 0 {
					graph[derivedRole] = append(graph[derivedRole], rule.Roles...)
				}
			}
		}
	}

	// Detect cycles using DFS
	visited := make(map[string]bool)
	recStack := make(map[string]bool)

	var detectCycle func(string, []string) bool
	detectCycle = func(role string, path []string) bool {
		visited[role] = true
		recStack[role] = true
		path = append(path, role)

		for _, dep := range graph[role] {
			if !visited[dep] {
				if detectCycle(dep, path) {
					return true
				}
			} else if recStack[dep] {
				// Cycle detected
				cyclePath := append(path, dep)
				result.Valid = false
				result.Errors = append(result.Errors, ValidationError{
					Type:    "circular_dep",
					Message: fmt.Sprintf("Circular dependency detected in derived roles: %s", strings.Join(cyclePath, " -> ")),
					Path:    "derived_roles",
					Details: fmt.Sprintf("Role '%s' creates a circular dependency", role),
				})
				return true
			}
		}

		recStack[role] = false
		return false
	}

	for role := range graph {
		if !visited[role] {
			if detectCycle(role, []string{}) {
				break
			}
		}
	}
}

// validateAllowedValues checks actions and resources against allowed lists
func (ev *EnhancedValidator) validateAllowedValues(policy *types.Policy, result *ValidationResult) {
	// Check resource kind
	if len(ev.config.AllowedResources) > 0 {
		allowed := false
		for _, allowedResource := range ev.config.AllowedResources {
			if policy.ResourceKind == allowedResource {
				allowed = true
				break
			}
		}
		if !allowed {
			result.Valid = false
			result.Errors = append(result.Errors, ValidationError{
				Type:    "schema",
				Message: fmt.Sprintf("Resource kind '%s' not in allowed list: %v", policy.ResourceKind, ev.config.AllowedResources),
				Path:    "resourceKind",
			})
		}
	}

	// Check actions
	if len(ev.config.AllowedActions) > 0 {
		for i, rule := range policy.Rules {
			for _, action := range rule.Actions {
				if action == "*" {
					continue // Wildcard always allowed
				}

				allowed := false
				for _, allowedAction := range ev.config.AllowedActions {
					if action == allowedAction {
						allowed = true
						break
					}
				}

				if !allowed {
					if ev.config.StrictMode {
						result.Valid = false
						result.Errors = append(result.Errors, ValidationError{
							Type:    "schema",
							Message: fmt.Sprintf("Action '%s' not in allowed list", action),
							Path:    fmt.Sprintf("rules[%d].actions", i),
						})
					} else {
						result.Warnings = append(result.Warnings, ValidationWarning{
							Type:    "schema",
							Message: fmt.Sprintf("Action '%s' not in allowed list", action),
							Path:    fmt.Sprintf("rules[%d].actions", i),
						})
					}
				}
			}
		}
	}
}

// ValidatePolicies validates multiple policies and checks for conflicts
func (ev *EnhancedValidator) ValidatePolicies(policies map[string]*types.Policy) *ValidationResult {
	result := &ValidationResult{
		Valid:    true,
		Errors:   make([]ValidationError, 0),
		Warnings: make([]ValidationWarning, 0),
	}

	// Validate each policy individually
	for name, policy := range policies {
		policyResult := ev.ValidatePolicyEnhanced(policy)
		if !policyResult.Valid {
			result.Valid = false
			// Prefix errors with policy name
			for _, err := range policyResult.Errors {
				err.Path = fmt.Sprintf("%s.%s", name, err.Path)
				result.Errors = append(result.Errors, err)
			}
		}
		// Add warnings
		for _, warning := range policyResult.Warnings {
			warning.Path = fmt.Sprintf("%s.%s", name, warning.Path)
			result.Warnings = append(result.Warnings, warning)
		}
	}

	// Check for cross-policy conflicts
	ev.checkPolicyConflicts(policies, result)

	return result
}

// checkPolicyConflicts checks for conflicts between multiple policies
func (ev *EnhancedValidator) checkPolicyConflicts(policies map[string]*types.Policy, result *ValidationResult) {
	// Group policies by resource kind
	byResourceKind := make(map[string][]*types.Policy)
	for _, policy := range policies {
		byResourceKind[policy.ResourceKind] = append(byResourceKind[policy.ResourceKind], policy)
	}

	// Check for duplicate policy names within same resource kind
	for resourceKind, kindPolicies := range byResourceKind {
		names := make(map[string]bool)
		for _, policy := range kindPolicies {
			if names[policy.Name] {
				result.Warnings = append(result.Warnings, ValidationWarning{
					Type:    "conflict",
					Message: fmt.Sprintf("Duplicate policy name '%s' for resource kind '%s'", policy.Name, resourceKind),
					Path:    "policies",
				})
			}
			names[policy.Name] = true
		}
	}
}
