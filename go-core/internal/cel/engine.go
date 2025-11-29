// Package cel provides CEL expression compilation and evaluation
package cel

import (
	"fmt"
	"sync"

	"github.com/google/cel-go/cel"
	"github.com/google/cel-go/checker/decls"
	"github.com/google/cel-go/common/types"
	"github.com/google/cel-go/common/types/ref"
	exprpb "google.golang.org/genproto/googleapis/api/expr/v1alpha1"
)

// Engine provides CEL expression compilation and evaluation
type Engine struct {
	env      *cel.Env
	programs sync.Map // map[string]cel.Program - compiled program cache
}

// EvalContext contains all variables available during CEL evaluation
type EvalContext struct {
	Principal map[string]interface{}
	Resource  map[string]interface{}
	Request   map[string]interface{}
	Context   map[string]interface{}
}

// NewEngine creates a new CEL engine with authorization-specific functions
func NewEngine() (*Engine, error) {
	env, err := cel.NewEnv(
		cel.Declarations(
			// Principal declarations
			decls.NewVar("principal", decls.NewMapType(decls.String, decls.Dyn)),
			decls.NewVar("P", decls.NewMapType(decls.String, decls.Dyn)), // alias

			// Resource declarations
			decls.NewVar("resource", decls.NewMapType(decls.String, decls.Dyn)),
			decls.NewVar("R", decls.NewMapType(decls.String, decls.Dyn)), // alias

			// Request context
			decls.NewVar("request", decls.NewMapType(decls.String, decls.Dyn)),
			decls.NewVar("context", decls.NewMapType(decls.String, decls.Dyn)),
		),
		// Custom authorization functions
		cel.Declarations(
			// hasRole(principal, role) -> bool
			decls.NewFunction("hasRole",
				decls.NewOverload("hasRole_map_string",
					[]*exprpb.Type{decls.NewMapType(decls.String, decls.Dyn), decls.String},
					decls.Bool,
				),
			),
			// isOwner(principal, resource) -> bool
			decls.NewFunction("isOwner",
				decls.NewOverload("isOwner_map_map",
					[]*exprpb.Type{
						decls.NewMapType(decls.String, decls.Dyn),
						decls.NewMapType(decls.String, decls.Dyn),
					},
					decls.Bool,
				),
			),
			// inList(value, list) -> bool
			decls.NewFunction("inList",
				decls.NewOverload("inList_string_list",
					[]*exprpb.Type{decls.String, decls.NewListType(decls.String)},
					decls.Bool,
				),
			),
		),
		// Bind custom function implementations
		cel.Function("hasRole",
			cel.Overload("hasRole_map_string",
				[]*cel.Type{cel.MapType(cel.StringType, cel.DynType), cel.StringType},
				cel.BoolType,
				cel.BinaryBinding(hasRoleBinding),
			),
		),
		cel.Function("isOwner",
			cel.Overload("isOwner_map_map",
				[]*cel.Type{cel.MapType(cel.StringType, cel.DynType), cel.MapType(cel.StringType, cel.DynType)},
				cel.BoolType,
				cel.BinaryBinding(isOwnerBinding),
			),
		),
		cel.Function("inList",
			cel.Overload("inList_string_list",
				[]*cel.Type{cel.StringType, cel.ListType(cel.StringType)},
				cel.BoolType,
				cel.BinaryBinding(inListBinding),
			),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create CEL environment: %w", err)
	}

	return &Engine{env: env}, nil
}

// Compile compiles a CEL expression and caches the result
func (e *Engine) Compile(expr string) (cel.Program, error) {
	// Check cache first
	if prog, ok := e.programs.Load(expr); ok {
		return prog.(cel.Program), nil
	}

	// Parse and check the expression
	ast, issues := e.env.Compile(expr)
	if issues != nil && issues.Err() != nil {
		return nil, fmt.Errorf("CEL compilation failed: %w", issues.Err())
	}

	// Create program
	prog, err := e.env.Program(ast)
	if err != nil {
		return nil, fmt.Errorf("CEL program creation failed: %w", err)
	}

	// Cache the compiled program
	e.programs.Store(expr, prog)
	return prog, nil
}

// Evaluate evaluates a compiled program with the given context
func (e *Engine) Evaluate(prog cel.Program, ctx *EvalContext) (bool, error) {
	vars := map[string]interface{}{
		"principal": ctx.Principal,
		"P":         ctx.Principal,
		"resource":  ctx.Resource,
		"R":         ctx.Resource,
		"request":   ctx.Request,
		"context":   ctx.Context,
	}

	result, _, err := prog.Eval(vars)
	if err != nil {
		return false, fmt.Errorf("CEL evaluation failed: %w", err)
	}

	// Handle boolean result
	if boolVal, ok := result.Value().(bool); ok {
		return boolVal, nil
	}

	return false, fmt.Errorf("CEL expression did not return boolean")
}

// EvaluateExpression compiles and evaluates an expression in one call
func (e *Engine) EvaluateExpression(expr string, ctx *EvalContext) (bool, error) {
	prog, err := e.Compile(expr)
	if err != nil {
		return false, err
	}
	return e.Evaluate(prog, ctx)
}

// ClearCache clears the compiled program cache
func (e *Engine) ClearCache() {
	e.programs = sync.Map{}
}

// Custom function binding implementations for cel-go v0.20+

// hasRoleBinding checks if a principal has a specific role
func hasRoleBinding(lhs, rhs ref.Val) ref.Val {
	principalMap, ok := lhs.Value().(map[string]interface{})
	if !ok {
		return types.False
	}

	role, ok := rhs.Value().(string)
	if !ok {
		return types.False
	}

	roles, ok := principalMap["roles"].([]interface{})
	if !ok {
		// Try string slice
		if strRoles, ok := principalMap["roles"].([]string); ok {
			for _, r := range strRoles {
				if r == role {
					return types.True
				}
			}
		}
		return types.False
	}

	for _, r := range roles {
		if r == role {
			return types.True
		}
	}
	return types.False
}

// isOwnerBinding checks if a principal owns a resource
func isOwnerBinding(lhs, rhs ref.Val) ref.Val {
	principalMap, ok := lhs.Value().(map[string]interface{})
	if !ok {
		return types.False
	}

	resourceMap, ok := rhs.Value().(map[string]interface{})
	if !ok {
		return types.False
	}

	principalID, _ := principalMap["id"].(string)

	// Check resource.attributes.ownerId
	if attrs, ok := resourceMap["attributes"].(map[string]interface{}); ok {
		if ownerID, ok := attrs["ownerId"].(string); ok {
			return types.Bool(principalID == ownerID)
		}
	}

	// Check resource.attr.ownerId (alias)
	if attrs, ok := resourceMap["attr"].(map[string]interface{}); ok {
		if ownerID, ok := attrs["ownerId"].(string); ok {
			return types.Bool(principalID == ownerID)
		}
	}

	return types.False
}

// inListBinding checks if a value is in a list
func inListBinding(lhs, rhs ref.Val) ref.Val {
	value, ok := lhs.Value().(string)
	if !ok {
		return types.False
	}

	list, ok := rhs.Value().([]interface{})
	if !ok {
		// Try string slice
		if strList, ok := rhs.Value().([]string); ok {
			for _, item := range strList {
				if item == value {
					return types.True
				}
			}
		}
		return types.False
	}

	for _, item := range list {
		if item == value {
			return types.True
		}
	}
	return types.False
}
