package policy

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/authz-engine/go-core/pkg/types"
	"github.com/google/cel-go/cel"
	"github.com/google/cel-go/common/types/ref"
	"go.uber.org/zap"
	"gopkg.in/yaml.v3"
)

// Loader loads and parses policy files from disk
type Loader struct {
	logger *zap.Logger
	mu     sync.RWMutex
	// cache stores compiled CEL expressions by policy condition string
	celCache map[string]cel.Program
}

// NewLoader creates a new policy loader
func NewLoader(logger *zap.Logger) *Loader {
	if logger == nil {
		logger = zap.NewNop()
	}

	return &Loader{
		logger:   logger,
		celCache: make(map[string]cel.Program),
	}
}

// LoadFromDirectory loads all policy files from a directory
func (l *Loader) LoadFromDirectory(path string) ([]*types.Policy, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read directory: %w", err)
	}

	var policies []*types.Policy
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		ext := filepath.Ext(entry.Name())
		if ext != ".yaml" && ext != ".yml" && ext != ".json" {
			continue
		}

		filePath := filepath.Join(path, entry.Name())
		policy, err := l.LoadFromFile(filePath)
		if err != nil {
			l.logger.Warn("Failed to load policy file",
				zap.String("file", filePath),
				zap.Error(err),
			)
			continue
		}

		policies = append(policies, policy)
	}

	return policies, nil
}

// LoadFromFile loads a single policy file
func (l *Loader) LoadFromFile(filePath string) (*types.Policy, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	policy := &types.Policy{}

	// Parse YAML/JSON
	ext := filepath.Ext(filePath)
	if ext == ".json" {
		// For JSON, we'll use yaml.Unmarshal which supports JSON as a subset
		if err := yaml.Unmarshal(content, policy); err != nil {
			return nil, fmt.Errorf("failed to parse JSON policy: %w", err)
		}
	} else {
		if err := yaml.Unmarshal(content, policy); err != nil {
			return nil, fmt.Errorf("failed to parse YAML policy: %w", err)
		}
	}

	// Validate and compile CEL expressions
	if err := l.compileCELExpressions(policy); err != nil {
		return nil, fmt.Errorf("failed to compile CEL expressions: %w", err)
	}

	return policy, nil
}

// compileCELExpressions pre-compiles all CEL conditions in a policy
func (l *Loader) compileCELExpressions(policy *types.Policy) error {
	for i, rule := range policy.Rules {
		if rule.Condition == "" {
			continue
		}

		if err := l.CompileCELExpression(rule.Condition); err != nil {
			return fmt.Errorf("failed to compile condition in rule %d (%s): %w",
				i, rule.Name, err)
		}
	}

	return nil
}

// CompileCELExpression compiles a CEL expression and caches it
func (l *Loader) CompileCELExpression(expression string) error {
	l.mu.RLock()
	if _, exists := l.celCache[expression]; exists {
		l.mu.RUnlock()
		return nil
	}
	l.mu.RUnlock()

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
		return fmt.Errorf("failed to parse CEL expression: %w", issues.Err())
	}

	// Check expression type is boolean
	checked, issues := env.Check(parsed)
	if issues != nil && issues.Err() != nil {
		return fmt.Errorf("failed to check CEL expression: %w", issues.Err())
	}

	if checked.OutputType() != cel.BoolType {
		return fmt.Errorf("CEL expression must return boolean, got %v", checked.OutputType())
	}

	// Compile the program
	program, err := env.Program(checked)
	if err != nil {
		return fmt.Errorf("failed to compile CEL program: %w", err)
	}

	l.mu.Lock()
	l.celCache[expression] = program
	l.mu.Unlock()

	return nil
}

// EvaluateCELCondition evaluates a pre-compiled CEL expression
func (l *Loader) EvaluateCELCondition(expression string, principal *types.Principal,
	resource *types.Resource, context map[string]interface{}) (bool, error) {

	l.mu.RLock()
	program, exists := l.celCache[expression]
	l.mu.RUnlock()

	if !exists {
		return false, fmt.Errorf("CEL expression not found in cache: %s", expression)
	}

	// Prepare evaluation variables
	vars := map[string]interface{}{
		"principal": principal.ToMap(),
		"resource":  resource.ToMap(),
		"context":   context,
	}

	// Evaluate the program
	result, _, err := program.Eval(vars)
	if err != nil {
		return false, fmt.Errorf("failed to evaluate CEL expression: %w", err)
	}

	// Convert result to boolean
	boolVal, ok := result.(ref.Val)
	if !ok {
		return false, fmt.Errorf("CEL expression did not return a boolean value")
	}

	val := boolVal.Value()
	boolResult, ok := val.(bool)
	if !ok {
		return false, fmt.Errorf("CEL expression did not return a boolean value, got %T", val)
	}

	return boolResult, nil
}

// ClearCache clears the CEL expression cache
func (l *Loader) ClearCache() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.celCache = make(map[string]cel.Program)
}

// CacheSize returns the number of cached expressions
func (l *Loader) CacheSize() int {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return len(l.celCache)
}
