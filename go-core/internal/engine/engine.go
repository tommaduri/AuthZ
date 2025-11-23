// Package engine provides the core decision engine for authorization
package engine

import (
	"context"
	"sync"
	"time"

	"github.com/authz-engine/go-core/internal/cache"
	"github.com/authz-engine/go-core/internal/cel"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
)

// Engine is the core authorization decision engine
type Engine struct {
	cel        *cel.Engine
	store      policy.Store
	cache      cache.Cache
	workerPool *WorkerPool

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

	return &Engine{
		cel:        celEngine,
		store:      store,
		cache:      c,
		workerPool: NewWorkerPool(cfg.ParallelWorkers),
		config:     cfg,
	}, nil
}

// Check evaluates an authorization request
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

	// Find matching policies
	policies := e.store.FindPolicies(req.Resource.Kind, req.Actions)

	// If no policies found, return default response
	if len(policies) == 0 {
		return e.defaultResponse(req, start), nil
	}

	// Evaluate policies in parallel
	results := e.evaluateParallel(ctx, req, policies)

	// Build response
	response := &types.CheckResponse{
		RequestID: req.RequestID,
		Results:   results,
		Metadata: &types.ResponseMetadata{
			EvaluationDurationUs: float64(time.Since(start).Microseconds()),
			PoliciesEvaluated:    len(policies),
			CacheHit:             false,
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

// defaultResponse creates a response when no policies match
func (e *Engine) defaultResponse(req *types.CheckRequest, start time.Time) *types.CheckResponse {
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
		},
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
