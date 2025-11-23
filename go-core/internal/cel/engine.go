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
		cel.Functions(
			&cel.Decl{
				Name: "hasRole",
				Impl: &hasRoleImpl{},
			},
			&cel.Decl{
				Name: "isOwner",
				Impl: &isOwnerImpl{},
			},
			&cel.Decl{
				Name: "inList",
				Impl: &inListImpl{},
			},
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

// Custom function implementations

type hasRoleImpl struct{}

func (h *hasRoleImpl) Impl(args ...ref.Val) ref.Val {
	if len(args) != 2 {
		return types.NewErr("hasRole requires 2 arguments")
	}

	principalMap, ok := args[0].Value().(map[string]interface{})
	if !ok {
		return types.False
	}

	role, ok := args[1].Value().(string)
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

type isOwnerImpl struct{}

func (o *isOwnerImpl) Impl(args ...ref.Val) ref.Val {
	if len(args) != 2 {
		return types.NewErr("isOwner requires 2 arguments")
	}

	principalMap, ok := args[0].Value().(map[string]interface{})
	if !ok {
		return types.False
	}

	resourceMap, ok := args[1].Value().(map[string]interface{})
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

type inListImpl struct{}

func (i *inListImpl) Impl(args ...ref.Val) ref.Val {
	if len(args) != 2 {
		return types.NewErr("inList requires 2 arguments")
	}

	value, ok := args[0].Value().(string)
	if !ok {
		return types.False
	}

	list, ok := args[1].Value().([]interface{})
	if !ok {
		// Try string slice
		if strList, ok := args[1].Value().([]string); ok {
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
