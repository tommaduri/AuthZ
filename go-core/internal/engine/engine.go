// Package engine provides the core decision engine for authorization
package engine

import (
	"context"
	"sync"
	"time"

	"github.com/authz-engine/go-core/internal/cache"
	"github.com/authz-engine/go-core/internal/cel"
	"github.com/authz-engine/go-core/internal/derived_roles"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/internal/scope"
	"github.com/authz-engine/go-core/pkg/types"
)

// Engine is the core authorization decision engine
type Engine struct {
	cel                  *cel.Engine
	store                policy.Store
	cache                cache.Cache
	workerPool           *WorkerPool
	scopeResolver        *scope.Resolver
	derivedRolesResolver *derived_roles.DerivedRolesResolver

	config Config
}

// Config configures the decision engine
type Config struct {
	// CacheEnabled enables caching of authorization decisions
	CacheEnabled bool
	// CacheSize is the maximum number of cached entries
	CacheSize int
	// CacheTTL is the time-to-live for cached entries
	CacheTTL time.Duration
	// ParallelWorkers is the number of parallel workers for policy evaluation
	ParallelWorkers int
	// DefaultEffect is the effect when no policy matches
	DefaultEffect types.Effect
}

// DefaultConfig returns a default engine configuration
func DefaultConfig() Config {
	return Config{
		CacheEnabled:    true,
		CacheSize:       100000,
		CacheTTL:        5 * time.Minute,
		ParallelWorkers: 16,
		DefaultEffect:   types.EffectDeny,
	}
}

// New creates a new decision engine
func New(cfg Config, store policy.Store) (*Engine, error) {
	celEngine, err := cel.NewEngine()
	if err != nil {
		return nil, err
	}

	var c cache.Cache
	if cfg.CacheEnabled {
		c = cache.NewLRU(cfg.CacheSize, cfg.CacheTTL)
	}

	// Initialize scope resolver with default config
	scopeResolver := scope.NewResolver(scope.DefaultConfig())

	// Initialize derived roles resolver
	derivedRolesResolver, err := derived_roles.NewDerivedRolesResolver()
	if err != nil {
		return nil, err
	}

	return &Engine{
		cel:                  celEngine,
		store:                store,
		cache:                c,
		workerPool:           NewWorkerPool(cfg.ParallelWorkers),
		scopeResolver:        scopeResolver,
		derivedRolesResolver: derivedRolesResolver,
		config:               cfg,
	}, nil
}

// Check evaluates an authorization request with principal-first policy resolution
func (e *Engine) Check(ctx context.Context, req *types.CheckRequest) (*types.CheckResponse, error) {
	start := time.Now()

	// Check cache first
	if e.cache != nil {
		cacheKey := req.CacheKey()
		if cached, ok := e.cache.Get(cacheKey); ok {
			resp := cached.(*types.CheckResponse)
			resp.Metadata.CacheHit = true
			return resp, nil
		}
	}

	// Phase 4: Resolve derived roles before policy evaluation
	derivedRoles := e.store.GetDerivedRoles()
	originalRoles := req.Principal.Roles
	derivedRolesAdded := []string{}

	if len(derivedRoles) > 0 {
		resolvedRoles, err := e.derivedRolesResolver.Resolve(req.Principal, req.Resource, derivedRoles)
		if err != nil {
			// Log error but continue with original roles (graceful degradation)
			// In production, you might want to return the error instead
			resolvedRoles = originalRoles
		} else {
			// Update principal roles with derived roles
			req.Principal.Roles = resolvedRoles

			// Track which derived roles were added (for metadata)
			derivedRolesMap := make(map[string]bool)
			for _, role := range originalRoles {
				derivedRolesMap[role] = false // original roles
			}
			for _, role := range resolvedRoles {
				if !derivedRolesMap[role] {
					derivedRolesAdded = append(derivedRolesAdded, role)
				}
			}
		}
	}

	// Phase 3: Find matching policies with principal-first resolution
	principalPolicies, rolePolicies, resourcePolicies, policyResolution := e.findPoliciesWithPrincipalSeparate(req)

	// Evaluate with priority: principal-specific > role-based > resource policies
	results := e.evaluateWithPriority(ctx, req, principalPolicies, rolePolicies, resourcePolicies)

	totalPolicies := len(principalPolicies) + len(rolePolicies) + len(resourcePolicies)

	// Build response with policy resolution information
	response := &types.CheckResponse{
		RequestID: req.RequestID,
		Results:   results,
		Metadata: &types.ResponseMetadata{
			EvaluationDurationUs: float64(time.Since(start).Microseconds()),
			PoliciesEvaluated:    totalPolicies,
			CacheHit:             false,
			ScopeResolution:      policyResolution.ScopeResolution,
			PolicyResolution:     policyResolution,
			DerivedRoles:         derivedRolesAdded,
		},
	}

	// Cache result
	if e.cache != nil {
		e.cache.Set(req.CacheKey(), response)
	}

	return response, nil
}

// CheckBatch evaluates multiple authorization requests
func (e *Engine) CheckBatch(ctx context.Context, requests []*types.CheckRequest) ([]*types.CheckResponse, error) {
	responses := make([]*types.CheckResponse, len(requests))
	var wg sync.WaitGroup
	var mu sync.Mutex
	var firstErr error

	for i, req := range requests {
		wg.Add(1)
		go func(idx int, r *types.CheckRequest) {
			defer wg.Done()

			resp, err := e.Check(ctx, r)
			if err != nil {
				mu.Lock()
				if firstErr == nil {
					firstErr = err
				}
				mu.Unlock()
				return
			}

			responses[idx] = resp
		}(i, req)
	}

	wg.Wait()
	return responses, firstErr
}

// evaluateParallel evaluates multiple policies concurrently
func (e *Engine) evaluateParallel(ctx context.Context, req *types.CheckRequest, policies []*types.Policy) map[string]types.ActionResult {
	results := make(map[string]types.ActionResult)
	var mu sync.Mutex
	var wg sync.WaitGroup

	// Initialize results with default deny
	for _, action := range req.Actions {
		results[action] = types.ActionResult{
			Effect:  e.config.DefaultEffect,
			Matched: false,
		}
	}

	for _, action := range req.Actions {
		for _, pol := range policies {
			wg.Add(1)
			action := action
			pol := pol

			e.workerPool.Submit(func() {
				defer wg.Done()

				result := e.evaluatePolicy(ctx, req, pol, action)

				mu.Lock()
				existing := results[action]
				// Deny takes precedence, or update if we found a match
				if result.Matched && (result.Effect == types.EffectDeny || !existing.Matched) {
					results[action] = result
				}
				mu.Unlock()
			})
		}
	}

	wg.Wait()
	return results
}

// evaluatePolicy evaluates a single policy for an action
func (e *Engine) evaluatePolicy(ctx context.Context, req *types.CheckRequest, pol *types.Policy, action string) types.ActionResult {
	// For principal policies, check if resource matches any resource selector
	if pol.PrincipalPolicy {
		resourceMatched := false
		for _, resSelector := range pol.Resources {
			if resSelector.MatchesResource(req.Resource) {
				resourceMatched = true
				break
			}
		}
		if !resourceMatched {
			// Resource doesn't match any selector in this principal policy
			return types.ActionResult{
				Effect:  e.config.DefaultEffect,
				Matched: false,
			}
		}
	}

	for _, rule := range pol.Rules {
		// Check if rule applies to this action
		if !rule.MatchesAction(action) {
			continue
		}

		// Check if principal has required role
		if !rule.MatchesRole(req.Principal.Roles) {
			continue
		}

		// Evaluate CEL condition if present
		if rule.Condition != "" {
			evalCtx := &cel.EvalContext{
				Principal: req.Principal.ToMap(),
				Resource:  req.Resource.ToMap(),
				Request:   req.Context,
				Context:   req.Context,
			}

			match, err := e.cel.EvaluateExpression(rule.Condition, evalCtx)
			if err != nil || !match {
				continue
			}
		}

		// Rule matched
		return types.ActionResult{
			Effect:  rule.Effect,
			Policy:  pol.Name,
			Rule:    rule.Name,
			Matched: true,
		}
	}

	// No matching rule found
	return types.ActionResult{
		Effect:  e.config.DefaultEffect,
		Matched: false,
	}
}

// computeEffectiveScope determines which scope to use for policy resolution
// Resource scope takes precedence over principal scope
func (e *Engine) computeEffectiveScope(req *types.CheckRequest) string {
	if req.Resource.Scope != "" {
		return req.Resource.Scope
	}
	if req.Principal.Scope != "" {
		return req.Principal.Scope
	}
	return ""
}

// findPoliciesWithScope finds policies using hierarchical scope resolution
// Returns policies and scope resolution metadata
// IMPORTANT: Only returns resource policies (filters out principal policies)
func (e *Engine) findPoliciesWithScope(requestScope, resourceKind string, actions []string) ([]*types.Policy, *types.ScopeResolutionResult) {
	scopeResult := &types.ScopeResolutionResult{
		InheritanceChain:    []string{},
		ScopedPolicyMatched: false,
	}

	// If no scope, use ONLY global policies (filter out scoped policies AND principal policies)
	if requestScope == "" {
		allPolicies := e.store.FindPolicies(resourceKind, actions)
		globalPolicies := make([]*types.Policy, 0, len(allPolicies))
		for _, p := range allPolicies {
			// Only include resource policies (not principal policies)
			if p.Scope == "" && !p.PrincipalPolicy {
				globalPolicies = append(globalPolicies, p)
			}
		}
		scopeResult.MatchedScope = "(global)"
		return globalPolicies, scopeResult
	}

	// Build scope chain (most to least specific)
	chain, err := e.scopeResolver.BuildScopeChain(requestScope)
	if err != nil {
		// Invalid scope, fail closed (deny)
		scopeResult.MatchedScope = "(invalid)"
		scopeResult.InheritanceChain = []string{requestScope}
		return []*types.Policy{}, scopeResult
	}

	scopeResult.InheritanceChain = chain

	// Try each scope from most to least specific (filter out principal policies)
	for _, currentScope := range chain {
		allPolicies := e.store.FindPoliciesForScope(currentScope, resourceKind, actions)
		scopedPolicies := make([]*types.Policy, 0, len(allPolicies))
		for _, p := range allPolicies {
			// Only include resource policies (not principal policies)
			if !p.PrincipalPolicy {
				scopedPolicies = append(scopedPolicies, p)
			}
		}
		if len(scopedPolicies) > 0 {
			scopeResult.MatchedScope = currentScope
			scopeResult.ScopedPolicyMatched = true
			return scopedPolicies, scopeResult
		}
	}

	// Fall back to ONLY global resource policies (filter out scoped policies AND principal policies)
	allPolicies := e.store.FindPolicies(resourceKind, actions)
	globalPolicies := make([]*types.Policy, 0, len(allPolicies))
	for _, p := range allPolicies {
		// Only include resource policies (not principal policies)
		if p.Scope == "" && !p.PrincipalPolicy {
			globalPolicies = append(globalPolicies, p)
		}
	}
	scopeResult.MatchedScope = "(global)"
	return globalPolicies, scopeResult
}

// defaultResponse creates a response when no policies match (backwards compatibility)
func (e *Engine) defaultResponse(req *types.CheckRequest, start time.Time) *types.CheckResponse {
	return e.defaultResponseWithScope(req, start, &types.ScopeResolutionResult{
		MatchedScope:        "(global)",
		InheritanceChain:    []string{},
		ScopedPolicyMatched: false,
	})
}

// defaultResponseWithScope creates a response when no policies match, with scope info
func (e *Engine) defaultResponseWithScope(req *types.CheckRequest, start time.Time, scopeResult *types.ScopeResolutionResult) *types.CheckResponse {
	results := make(map[string]types.ActionResult)
	for _, action := range req.Actions {
		results[action] = types.ActionResult{
			Effect:  e.config.DefaultEffect,
			Matched: false,
		}
	}

	return &types.CheckResponse{
		RequestID: req.RequestID,
		Results:   results,
		Metadata: &types.ResponseMetadata{
			EvaluationDurationUs: float64(time.Since(start).Microseconds()),
			PoliciesEvaluated:    0,
			CacheHit:             false,
			ScopeResolution:      scopeResult,
		},
	}
}

// defaultResponseWithPolicyResolution creates a response when no policies match, with policy resolution info
func (e *Engine) defaultResponseWithPolicyResolution(req *types.CheckRequest, start time.Time, policyResolution *types.PolicyResolution) *types.CheckResponse {
	results := make(map[string]types.ActionResult)
	for _, action := range req.Actions {
		results[action] = types.ActionResult{
			Effect:  e.config.DefaultEffect,
			Matched: false,
		}
	}

	return &types.CheckResponse{
		RequestID: req.RequestID,
		Results:   results,
		Metadata: &types.ResponseMetadata{
			EvaluationDurationUs: float64(time.Since(start).Microseconds()),
			PoliciesEvaluated:    0,
			CacheHit:             false,
			ScopeResolution:      policyResolution.ScopeResolution,
			PolicyResolution:     policyResolution,
		},
	}
}

// findPoliciesWithPrincipalSeparate finds policies using principal-first resolution
// Returns policies in separate buckets for priority-based evaluation
func (e *Engine) findPoliciesWithPrincipalSeparate(req *types.CheckRequest) ([]*types.Policy, []*types.Policy, []*types.Policy, *types.PolicyResolution) {
	resolution := &types.PolicyResolution{
		PrincipalPoliciesMatched: false,
		ResourcePoliciesMatched:  false,
		EvaluationOrder:          []string{},
	}

	// 1. Principal-specific policies (highest priority)
	principalPolicies := e.store.FindPoliciesByPrincipal(req.Principal.ID, req.Resource.Kind)
	if len(principalPolicies) > 0 {
		resolution.PrincipalPoliciesMatched = true
		resolution.EvaluationOrder = append(resolution.EvaluationOrder, "principal-specific")
	}

	// 2. Role-based principal policies
	var rolePolicies []*types.Policy
	if len(req.Principal.Roles) > 0 {
		rolePolicies = e.store.FindPoliciesByRoles(req.Principal.Roles, req.Resource.Kind)
		if len(rolePolicies) > 0 {
			resolution.PrincipalPoliciesMatched = true
			resolution.EvaluationOrder = append(resolution.EvaluationOrder, "role-based-principal")
		}
	}

	// 3. Resource policies (Phase 2 scope resolution)
	effectiveScope := e.computeEffectiveScope(req)
	resourcePolicies, scopeResult := e.findPoliciesWithScope(effectiveScope, req.Resource.Kind, req.Actions)
	if len(resourcePolicies) > 0 {
		resolution.ResourcePoliciesMatched = true
		resolution.EvaluationOrder = append(resolution.EvaluationOrder, "resource-scoped")
	}
	resolution.ScopeResolution = scopeResult

	return principalPolicies, rolePolicies, resourcePolicies, resolution
}

// evaluateWithPriority evaluates policies with priority-based resolution
// Priority: principal-specific > role-based > resource policies
// Within each tier, deny-overrides applies
func (e *Engine) evaluateWithPriority(ctx context.Context, req *types.CheckRequest, principalPolicies, rolePolicies, resourcePolicies []*types.Policy) map[string]types.ActionResult {
	results := make(map[string]types.ActionResult)

	// Initialize all actions with default deny
	for _, action := range req.Actions {
		results[action] = types.ActionResult{
			Effect:  e.config.DefaultEffect,
			Matched: false,
		}
	}

	// Evaluate each action
	for _, action := range req.Actions {
		// Try principal-specific policies first (highest priority)
		if len(principalPolicies) > 0 {
			result := e.evaluatePolicyTier(ctx, req, principalPolicies, action)
			if result.Matched {
				results[action] = result
				continue // Found match in highest priority tier, skip lower tiers
			}
		}

		// Try role-based principal policies next
		if len(rolePolicies) > 0 {
			result := e.evaluatePolicyTier(ctx, req, rolePolicies, action)
			if result.Matched {
				results[action] = result
				continue // Found match, skip resource policies
			}
		}

		// Fall back to resource policies
		if len(resourcePolicies) > 0 {
			result := e.evaluatePolicyTier(ctx, req, resourcePolicies, action)
			if result.Matched {
				results[action] = result
			}
		}
	}

	return results
}

// evaluatePolicyTier evaluates a tier of policies for an action with deny-overrides
func (e *Engine) evaluatePolicyTier(ctx context.Context, req *types.CheckRequest, policies []*types.Policy, action string) types.ActionResult {
	var allowResult *types.ActionResult

	for _, pol := range policies {
		result := e.evaluatePolicy(ctx, req, pol, action)

		if !result.Matched {
			continue
		}

		// Deny immediately wins within a tier
		if result.Effect == types.EffectDeny {
			return result
		}

		// Keep first allow result
		if allowResult == nil {
			allowResult = &result
		}
	}

	// Return allow if found, otherwise no match
	if allowResult != nil {
		return *allowResult
	}

	return types.ActionResult{
		Effect:  e.config.DefaultEffect,
		Matched: false,
	}
}

// GetStore returns the policy store
func (e *Engine) GetStore() policy.Store {
	return e.store
}

// GetCacheStats returns cache statistics
func (e *Engine) GetCacheStats() *cache.Stats {
	if e.cache == nil {
		return nil
	}
	stats := e.cache.Stats()
	return &stats
}

// ClearCache clears the decision cache
func (e *Engine) ClearCache() {
	if e.cache != nil {
		e.cache.Clear()
	}
}
