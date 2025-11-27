// Package policy provides enhanced validation for import operations
package policy

import (
	"fmt"
	"strings"

	"github.com/authz-engine/go-core/internal/cel"
	"github.com/authz-engine/go-core/pkg/types"
)

// ValidationError represents a policy validation error
type ValidationError struct {
	PolicyName string `json:"policy,omitempty"`
	Field      string `json:"field"`
	Message    string `json:"message"`
	Line       int    `json:"line,omitempty"`
}

// Error implements the error interface
func (e *ValidationError) Error() string {
	if e.PolicyName != "" {
		return fmt.Sprintf("policy %s: %s: %s", e.PolicyName, e.Field, e.Message)
	}
	return fmt.Sprintf("%s: %s", e.Field, e.Message)
}

// ValidationResult contains validation results
type ValidationResult struct {
	Valid    bool               `json:"valid"`
	Errors   []*ValidationError `json:"errors,omitempty"`
	Warnings []*ValidationError `json:"warnings,omitempty"`
}

// ImportValidator validates policies during import
type ImportValidator struct {
	celEngine *cel.Engine
	store     Store
}

// NewImportValidator creates a new import validator
func NewImportValidator(store Store) (*ImportValidator, error) {
	celEngine, err := cel.NewEngine()
	if err != nil {
		return nil, fmt.Errorf("failed to create CEL engine: %w", err)
	}

	return &ImportValidator{
		celEngine: celEngine,
		store:     store,
	}, nil
}

// ValidatePolicy validates a single policy
func (v *ImportValidator) ValidatePolicy(policy *types.Policy) *ValidationResult {
	result := &ValidationResult{
		Valid:    true,
		Errors:   make([]*ValidationError, 0),
		Warnings: make([]*ValidationError, 0),
	}

	// Required fields
	if policy.Name == "" {
		result.Valid = false
		result.Errors = append(result.Errors, &ValidationError{
			Field:   "name",
			Message: "policy name is required",
		})
	}

	if policy.APIVersion == "" {
		result.Valid = false
		result.Errors = append(result.Errors, &ValidationError{
			PolicyName: policy.Name,
			Field:      "apiVersion",
			Message:    "API version is required",
		})
	}

	// Validate resource policies
	if !policy.PrincipalPolicy {
		if policy.ResourceKind == "" {
			result.Valid = false
			result.Errors = append(result.Errors, &ValidationError{
				PolicyName: policy.Name,
				Field:      "resourceKind",
				Message:    "resource kind is required for resource policies",
			})
		}
	}

	// Validate principal policies
	if policy.PrincipalPolicy {
		if policy.Principal == nil {
			result.Valid = false
			result.Errors = append(result.Errors, &ValidationError{
				PolicyName: policy.Name,
				Field:      "principal",
				Message:    "principal selector is required for principal policies",
			})
		} else {
			if policy.Principal.ID == "" && len(policy.Principal.Roles) == 0 {
				result.Valid = false
				result.Errors = append(result.Errors, &ValidationError{
					PolicyName: policy.Name,
					Field:      "principal",
					Message:    "principal must have either id or roles",
				})
			}
		}

		if len(policy.Resources) == 0 {
			result.Valid = false
			result.Errors = append(result.Errors, &ValidationError{
				PolicyName: policy.Name,
				Field:      "resources",
				Message:    "at least one resource selector is required for principal policies",
			})
		} else {
			for i, res := range policy.Resources {
				if res.Kind == "" {
					result.Valid = false
					result.Errors = append(result.Errors, &ValidationError{
						PolicyName: policy.Name,
						Field:      fmt.Sprintf("resources[%d].kind", i),
						Message:    "resource kind is required",
					})
				}
			}
		}
	}

	// Validate rules
	if len(policy.Rules) == 0 {
		result.Warnings = append(result.Warnings, &ValidationError{
			PolicyName: policy.Name,
			Field:      "rules",
			Message:    "policy has no rules",
		})
	}

	for i, rule := range policy.Rules {
		v.validateRule(policy.Name, i, rule, result)
	}

	return result
}

// validateRule validates a single rule
func (v *ImportValidator) validateRule(policyName string, index int, rule *types.Rule, result *ValidationResult) {
	rulePrefix := fmt.Sprintf("rules[%d]", index)

	// Required fields
	if rule.Name == "" {
		result.Valid = false
		result.Errors = append(result.Errors, &ValidationError{
			PolicyName: policyName,
			Field:      fmt.Sprintf("%s.name", rulePrefix),
			Message:    "rule name is required",
		})
	}

	if len(rule.Actions) == 0 {
		result.Valid = false
		result.Errors = append(result.Errors, &ValidationError{
			PolicyName: policyName,
			Field:      fmt.Sprintf("%s.actions", rulePrefix),
			Message:    "at least one action is required",
		})
	}

	if rule.Effect != types.EffectAllow && rule.Effect != types.EffectDeny {
		result.Valid = false
		result.Errors = append(result.Errors, &ValidationError{
			PolicyName: policyName,
			Field:      fmt.Sprintf("%s.effect", rulePrefix),
			Message:    "effect must be 'allow' or 'deny'",
		})
	}

	// Validate CEL condition
	if rule.Condition != "" {
		if err := v.validateCELExpression(rule.Condition); err != nil {
			result.Valid = false
			result.Errors = append(result.Errors, &ValidationError{
				PolicyName: policyName,
				Field:      fmt.Sprintf("%s.condition", rulePrefix),
				Message:    fmt.Sprintf("invalid CEL expression: %v", err),
			})
		}
	}

	// Validate derived roles exist
	for _, drName := range rule.DerivedRoles {
		if _, err := v.store.GetDerivedRole(drName); err != nil {
			result.Warnings = append(result.Warnings, &ValidationError{
				PolicyName: policyName,
				Field:      fmt.Sprintf("%s.derivedRoles", rulePrefix),
				Message:    fmt.Sprintf("derived role %q not found in store", drName),
			})
		}
	}
}

// validateCELExpression validates a CEL expression
func (v *ImportValidator) validateCELExpression(expr string) error {
	// Try to compile the expression
	_, err := v.celEngine.Compile(expr)
	if err != nil {
		return err
	}

	return nil
}

// ValidateDerivedRole validates a derived role
func (v *ImportValidator) ValidateDerivedRole(dr *types.DerivedRole) *ValidationResult {
	result := &ValidationResult{
		Valid:    true,
		Errors:   make([]*ValidationError, 0),
		Warnings: make([]*ValidationError, 0),
	}

	if dr.Name == "" {
		result.Valid = false
		result.Errors = append(result.Errors, &ValidationError{
			Field:   "name",
			Message: "derived role name is required",
		})
	}

	if len(dr.ParentRoles) == 0 {
		result.Warnings = append(result.Warnings, &ValidationError{
			PolicyName: dr.Name,
			Field:      "parentRoles",
			Message:    "derived role has no parent roles",
		})
	}

	if dr.Condition != "" {
		if err := v.validateCELExpression(dr.Condition); err != nil {
			result.Valid = false
			result.Errors = append(result.Errors, &ValidationError{
				PolicyName: dr.Name,
				Field:      "condition",
				Message:    fmt.Sprintf("invalid CEL expression: %v", err),
			})
		}
	}

	return result
}

// ValidateBatch validates multiple policies and derived roles
func (v *ImportValidator) ValidateBatch(policies []*types.Policy, derivedRoles []*types.DerivedRole) *ValidationResult {
	result := &ValidationResult{
		Valid:    true,
		Errors:   make([]*ValidationError, 0),
		Warnings: make([]*ValidationError, 0),
	}

	// Check for duplicate policy names
	policyNames := make(map[string]bool)
	for _, policy := range policies {
		if policy.Name == "" {
			continue
		}
		if policyNames[policy.Name] {
			result.Valid = false
			result.Errors = append(result.Errors, &ValidationError{
				PolicyName: policy.Name,
				Field:      "name",
				Message:    "duplicate policy name",
			})
		}
		policyNames[policy.Name] = true

		// Validate individual policy
		policyResult := v.ValidatePolicy(policy)
		if !policyResult.Valid {
			result.Valid = false
		}
		result.Errors = append(result.Errors, policyResult.Errors...)
		result.Warnings = append(result.Warnings, policyResult.Warnings...)
	}

	// Check for duplicate derived role names
	drNames := make(map[string]bool)
	for _, dr := range derivedRoles {
		if dr.Name == "" {
			continue
		}
		if drNames[dr.Name] {
			result.Valid = false
			result.Errors = append(result.Errors, &ValidationError{
				PolicyName: dr.Name,
				Field:      "name",
				Message:    "duplicate derived role name",
			})
		}
		drNames[dr.Name] = true

		// Validate individual derived role
		drResult := v.ValidateDerivedRole(dr)
		if !drResult.Valid {
			result.Valid = false
		}
		result.Errors = append(result.Errors, drResult.Errors...)
		result.Warnings = append(result.Warnings, drResult.Warnings...)
	}

	// Validate cross-references
	v.validateCrossReferences(policies, derivedRoles, result)

	return result
}

// validateCrossReferences validates references between policies and derived roles
func (v *ImportValidator) validateCrossReferences(policies []*types.Policy, derivedRoles []*types.DerivedRole, result *ValidationResult) {
	// Build derived role name set
	drNameSet := make(map[string]bool)
	for _, dr := range derivedRoles {
		drNameSet[dr.Name] = true
	}

	// Check that all derived role references exist
	for _, policy := range policies {
		for _, rule := range policy.Rules {
			for _, drName := range rule.DerivedRoles {
				// Check in import batch
				if !drNameSet[drName] {
					// Check in store
					if _, err := v.store.GetDerivedRole(drName); err != nil {
						result.Warnings = append(result.Warnings, &ValidationError{
							PolicyName: policy.Name,
							Field:      "derivedRoles",
							Message:    fmt.Sprintf("derived role %q not found", drName),
						})
					}
				}
			}
		}
	}
}

// FormatValidationErrors formats validation errors for display
func FormatValidationErrors(result *ValidationResult) string {
	if result.Valid {
		return "Validation passed"
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Validation failed with %d error(s)\n", len(result.Errors)))

	for _, err := range result.Errors {
		sb.WriteString(fmt.Sprintf("  - %s\n", err.Error()))
	}

	if len(result.Warnings) > 0 {
		sb.WriteString(fmt.Sprintf("\nWarnings (%d):\n", len(result.Warnings)))
		for _, warn := range result.Warnings {
			sb.WriteString(fmt.Sprintf("  - %s\n", warn.Error()))
		}
	}

	return sb.String()
}
