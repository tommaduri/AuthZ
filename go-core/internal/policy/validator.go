package policy

import (
	"fmt"
	"regexp"

	"github.com/authz-engine/go-core/pkg/types"
	"github.com/google/cel-go/cel"
)

// Validator provides policy validation functionality
type Validator struct {
	// Track seen rules to detect conflicts
	seenRules map[string]bool
}

// NewValidator creates a new policy validator
func NewValidator() *Validator {
	return &Validator{
		seenRules: make(map[string]bool),
	}
}

// ValidatePolicy validates the structure and syntax of a policy
func (v *Validator) ValidatePolicy(policy *types.Policy) error {
	if policy == nil {
		return fmt.Errorf("policy cannot be nil")
	}

	// Validate basic structure
	if err := v.validateBasicStructure(policy); err != nil {
		return err
	}

	// Validate rules
	if err := v.validateRules(policy); err != nil {
		return err
	}

	// Check for conflicts
	if err := v.checkForConflicts(policy); err != nil {
		return err
	}

	return nil
}

// validateBasicStructure validates the basic structure of a policy
func (v *Validator) validateBasicStructure(policy *types.Policy) error {
	if policy.Name == "" {
		return fmt.Errorf("policy name is required")
	}

	if policy.ResourceKind == "" {
		return fmt.Errorf("policy resourceKind is required")
	}

	// Validate policy name format (alphanumeric, hyphens, underscores)
	if !isValidIdentifier(policy.Name) {
		return fmt.Errorf("invalid policy name format: %s (must be alphanumeric with hyphens/underscores)", policy.Name)
	}

	// Validate resource kind format
	if !isValidIdentifier(policy.ResourceKind) {
		return fmt.Errorf("invalid resourceKind format: %s (must be alphanumeric with hyphens/underscores)", policy.ResourceKind)
	}

	if len(policy.Rules) == 0 {
		return fmt.Errorf("policy must have at least one rule")
	}

	return nil
}

// validateRules validates all rules in a policy
func (v *Validator) validateRules(policy *types.Policy) error {
	for i, rule := range policy.Rules {
		if err := v.validateRule(rule, i); err != nil {
			return fmt.Errorf("invalid rule at index %d: %w", i, err)
		}
	}
	return nil
}

// validateRule validates a single rule
func (v *Validator) validateRule(rule *types.Rule, index int) error {
	if rule.Name == "" {
		return fmt.Errorf("rule name is required")
	}

	if !isValidIdentifier(rule.Name) {
		return fmt.Errorf("invalid rule name format: %s", rule.Name)
	}

	if len(rule.Actions) == 0 {
		return fmt.Errorf("rule must have at least one action")
	}

	// Validate actions
	for _, action := range rule.Actions {
		if action == "" {
			return fmt.Errorf("action cannot be empty")
		}
		if !isValidAction(action) {
			return fmt.Errorf("invalid action format: %s", action)
		}
	}

	// Validate effect
	if rule.Effect != types.EffectAllow && rule.Effect != types.EffectDeny {
		return fmt.Errorf("invalid effect: %s (must be 'allow' or 'deny')", rule.Effect)
	}

	// Validate CEL condition if present
	if rule.Condition != "" {
		if err := v.validateCELExpression(rule.Condition); err != nil {
			return fmt.Errorf("invalid CEL condition: %w", err)
		}
	}

	// Validate roles if present
	if len(rule.Roles) > 0 {
		for _, role := range rule.Roles {
			if role == "" {
				return fmt.Errorf("role cannot be empty")
			}
			if !isValidIdentifier(role) {
				return fmt.Errorf("invalid role format: %s", role)
			}
		}
	}

	// Validate derived roles if present
	if len(rule.DerivedRoles) > 0 {
		for _, drole := range rule.DerivedRoles {
			if drole == "" {
				return fmt.Errorf("derived role cannot be empty")
			}
			if !isValidIdentifier(drole) {
				return fmt.Errorf("invalid derived role format: %s", drole)
			}
		}
	}

	return nil
}

// validateCELExpression validates the syntax of a CEL expression
func (v *Validator) validateCELExpression(expression string) error {
	if expression == "" {
		return fmt.Errorf("CEL expression cannot be empty")
	}

	// Create a CEL environment
	env, err := cel.NewEnv(
		cel.Variable("principal", cel.MapType(cel.StringType, cel.DynType)),
		cel.Variable("resource", cel.MapType(cel.StringType, cel.DynType)),
		cel.Variable("context", cel.MapType(cel.StringType, cel.DynType)),
	)
	if err != nil {
		return fmt.Errorf("failed to create CEL environment: %w", err)
	}

	// Parse the expression
	parsed, issues := env.Parse(expression)
	if issues != nil && issues.Err() != nil {
		return fmt.Errorf("parse error: %w", issues.Err())
	}

	// Check expression type
	checked, issues := env.Check(parsed)
	if issues != nil && issues.Err() != nil {
		return fmt.Errorf("type check error: %w", issues.Err())
	}

	// Verify it returns a boolean
	if checked.OutputType() != cel.BoolType {
		return fmt.Errorf("expression must return boolean, got %v", checked.OutputType())
	}

	return nil
}

// checkForConflicts checks for conflicting rules within a policy
func (v *Validator) checkForConflicts(policy *types.Policy) error {
	// Reset seen rules for this policy
	v.seenRules = make(map[string]bool)

	for i, rule := range policy.Rules {
		ruleKey := rule.Name
		if v.seenRules[ruleKey] {
			return fmt.Errorf("duplicate rule name at index %d: %s", i, rule.Name)
		}
		v.seenRules[ruleKey] = true

		// Check for allow/deny conflict on overlapping actions
		if i > 0 {
			for j := 0; j < i; j++ {
				prevRule := policy.Rules[j]
				if hasOverlappingActions(rule.Actions, prevRule.Actions) &&
					rule.Effect != prevRule.Effect {
					// Log warning but don't fail - overlapping rules with different effects
					// are allowed, the engine will evaluate them in order
				}
			}
		}
	}

	return nil
}

// hasOverlappingActions checks if two action lists have overlapping actions
func hasOverlappingActions(actions1, actions2 []string) bool {
	for _, a1 := range actions1 {
		for _, a2 := range actions2 {
			if a1 == "*" || a2 == "*" || a1 == a2 {
				return true
			}
		}
	}
	return false
}

// isValidIdentifier checks if a string is a valid identifier
func isValidIdentifier(s string) bool {
	// Allow alphanumeric, hyphens, and underscores
	// Must start with letter or underscore
	pattern := `^[a-zA-Z_][a-zA-Z0-9_-]*$`
	matched, err := regexp.MatchString(pattern, s)
	return err == nil && matched
}

// isValidAction checks if an action name is valid
func isValidAction(action string) bool {
	// Allow alphanumeric, hyphens, underscores, and wildcard
	if action == "*" {
		return true
	}
	pattern := `^[a-zA-Z_][a-zA-Z0-9_-:]*$`
	matched, err := regexp.MatchString(pattern, action)
	return err == nil && matched
}

// ValidateRuleConsistency checks if rules are consistent within a policy
// (e.g., no contradictory conditions that would make a rule unreachable)
func (v *Validator) ValidateRuleConsistency(policy *types.Policy) []string {
	var warnings []string

	for i, rule := range policy.Rules {
		// Check if a rule might be unreachable due to earlier rules
		if i > 0 && rule.Effect == types.EffectDeny {
			// If a deny rule comes after an allow rule with the same actions,
			// the deny rule might be unreachable
			for j := 0; j < i; j++ {
				prevRule := policy.Rules[j]
				if prevRule.Effect == types.EffectAllow && hasOverlappingActions(rule.Actions, prevRule.Actions) {
					warnings = append(warnings,
						fmt.Sprintf("Rule %d (%s) might be unreachable: earlier allow rule (index %d) has overlapping actions",
							i, rule.Name, j))
				}
			}
		}
	}

	return warnings
}
