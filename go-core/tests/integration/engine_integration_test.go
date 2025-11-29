// Package integration provides integration tests for the authorization engine
package integration

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
)

// TestIntegration_FullPolicyEvaluation tests complete policy evaluation flow
func TestIntegration_FullPolicyEvaluation(t *testing.T) {
	store := setupTestPolicies()

	cfg := engine.DefaultConfig()
	cfg.CacheEnabled = true
	cfg.CacheSize = 1000

	eng, err := engine.New(cfg, store)
	if err != nil {
		t.Fatalf("Failed to create engine: %v", err)
	}

	tests := []struct {
		name           string
		principal      *types.Principal
		resource       *types.Resource
		actions        []string
		expectedEffect map[string]types.Effect
	}{
		{
			name: "Admin full access",
			principal: &types.Principal{
				ID:    "admin-user-1",
				Roles: []string{"admin"},
			},
			resource: &types.Resource{
				Kind: "document",
				ID:   "doc-123",
			},
			actions: []string{"read", "write", "delete", "share"},
			expectedEffect: map[string]types.Effect{
				"read":   types.EffectAllow,
				"write":  types.EffectAllow,
				"delete": types.EffectAllow,
				"share":  types.EffectAllow,
			},
		},
		{
			name: "Owner write access",
			principal: &types.Principal{
				ID:    "user-456",
				Roles: []string{"user"},
			},
			resource: &types.Resource{
				Kind: "document",
				ID:   "doc-789",
				Attributes: map[string]interface{}{
					"ownerId": "user-456",
				},
			},
			actions: []string{"read", "write", "delete"},
			expectedEffect: map[string]types.Effect{
				"read":   types.EffectAllow,
				"write":  types.EffectAllow,
				"delete": types.EffectDeny, // Only admin can delete
			},
		},
		{
			name: "Non-owner limited access",
			principal: &types.Principal{
				ID:    "user-789",
				Roles: []string{"user"},
			},
			resource: &types.Resource{
				Kind: "document",
				ID:   "doc-123",
				Attributes: map[string]interface{}{
					"ownerId": "user-456",
					"public":  true,
				},
			},
			actions: []string{"read", "write"},
			expectedEffect: map[string]types.Effect{
				"read":  types.EffectAllow, // Public document
				"write": types.EffectDeny,  // Not owner
			},
		},
		{
			name: "Department access",
			principal: &types.Principal{
				ID:    "user-dept",
				Roles: []string{"user"},
				Attributes: map[string]interface{}{
					"department": "engineering",
				},
			},
			resource: &types.Resource{
				Kind: "project",
				ID:   "proj-eng-1",
				Attributes: map[string]interface{}{
					"department": "engineering",
				},
			},
			actions: []string{"read", "contribute"},
			expectedEffect: map[string]types.Effect{
				"read":       types.EffectAllow,
				"contribute": types.EffectAllow,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := &types.CheckRequest{
				RequestID: "test-" + tt.name,
				Principal: tt.principal,
				Resource:  tt.resource,
				Actions:   tt.actions,
			}

			resp, err := eng.Check(context.Background(), req)
			if err != nil {
				t.Fatalf("Check failed: %v", err)
			}

			for action, expected := range tt.expectedEffect {
				result, ok := resp.Results[action]
				if !ok {
					t.Errorf("Missing result for action %s", action)
					continue
				}
				if result.Effect != expected {
					t.Errorf("Action %s: expected %v, got %v", action, expected, result.Effect)
				}
			}
		})
	}
}

// TestIntegration_CacheBehavior tests caching behavior
func TestIntegration_CacheBehavior(t *testing.T) {
	store := policy.NewMemoryStore()
	store.Add(&types.Policy{
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	})

	cfg := engine.DefaultConfig()
	cfg.CacheEnabled = true
	cfg.CacheSize = 100

	eng, _ := engine.New(cfg, store)

	req := &types.CheckRequest{
		RequestID: "cache-test",
		Principal: &types.Principal{ID: "user-1", Roles: []string{"user"}},
		Resource:  &types.Resource{Kind: "document", ID: "doc-1"},
		Actions:   []string{"read"},
	}

	// First request - cache miss
	resp1, _ := eng.Check(context.Background(), req)
	if resp1.Metadata.CacheHit {
		t.Error("Expected cache miss on first request")
	}

	// Second request - cache hit
	resp2, _ := eng.Check(context.Background(), req)
	if !resp2.Metadata.CacheHit {
		t.Error("Expected cache hit on second request")
	}

	// Verify same result
	if resp1.Results["read"].Effect != resp2.Results["read"].Effect {
		t.Error("Cache returned different result")
	}

	// Check stats
	stats := eng.GetCacheStats()
	if stats == nil {
		t.Fatal("Expected cache stats")
	}
	if stats.Hits != 1 {
		t.Errorf("Expected 1 cache hit, got %d", stats.Hits)
	}
	if stats.Misses != 1 {
		t.Errorf("Expected 1 cache miss, got %d", stats.Misses)
	}
}

// TestIntegration_ConcurrentRequests tests concurrent request handling
func TestIntegration_ConcurrentRequests(t *testing.T) {
	store := setupTestPolicies()

	cfg := engine.DefaultConfig()
	cfg.CacheEnabled = true
	cfg.ParallelWorkers = 8

	eng, _ := engine.New(cfg, store)

	numRequests := 100
	var wg sync.WaitGroup
	errors := make(chan error, numRequests)
	results := make(chan *types.CheckResponse, numRequests)

	for i := 0; i < numRequests; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()

			req := &types.CheckRequest{
				RequestID: "concurrent-" + string(rune(idx)),
				Principal: &types.Principal{
					ID:    "user-concurrent",
					Roles: []string{"admin"},
				},
				Resource: &types.Resource{
					Kind: "document",
					ID:   "doc-concurrent",
				},
				Actions: []string{"read", "write"},
			}

			resp, err := eng.Check(context.Background(), req)
			if err != nil {
				errors <- err
				return
			}
			results <- resp
		}(i)
	}

	wg.Wait()
	close(errors)
	close(results)

	// Check for errors
	for err := range errors {
		t.Errorf("Concurrent request failed: %v", err)
	}

	// Verify all results are consistent
	count := 0
	for resp := range results {
		count++
		if resp.Results["read"].Effect != types.EffectAllow {
			t.Errorf("Expected allow for read")
		}
		if resp.Results["write"].Effect != types.EffectAllow {
			t.Errorf("Expected allow for write")
		}
	}

	if count != numRequests {
		t.Errorf("Expected %d results, got %d", numRequests, count)
	}
}

// TestIntegration_BatchRequests tests batch request handling
func TestIntegration_BatchRequests(t *testing.T) {
	store := setupTestPolicies()

	cfg := engine.DefaultConfig()
	cfg.CacheEnabled = false

	eng, _ := engine.New(cfg, store)

	requests := []*types.CheckRequest{
		{
			RequestID: "batch-1",
			Principal: &types.Principal{ID: "admin-1", Roles: []string{"admin"}},
			Resource:  &types.Resource{Kind: "document", ID: "doc-1"},
			Actions:   []string{"delete"},
		},
		{
			RequestID: "batch-2",
			Principal: &types.Principal{ID: "user-1", Roles: []string{"user"}},
			Resource:  &types.Resource{Kind: "document", ID: "doc-2"},
			Actions:   []string{"delete"},
		},
		{
			RequestID: "batch-3",
			Principal: &types.Principal{ID: "user-2", Roles: []string{"user"}},
			Resource: &types.Resource{
				Kind: "document",
				ID:   "doc-3",
				Attributes: map[string]interface{}{
					"ownerId": "user-2",
				},
			},
			Actions: []string{"write"},
		},
	}

	responses, err := eng.CheckBatch(context.Background(), requests)
	if err != nil {
		t.Fatalf("CheckBatch failed: %v", err)
	}

	if len(responses) != 3 {
		t.Fatalf("Expected 3 responses, got %d", len(responses))
	}

	// Admin can delete
	if responses[0].Results["delete"].Effect != types.EffectAllow {
		t.Error("Expected admin to be allowed to delete")
	}

	// User cannot delete
	if responses[1].Results["delete"].Effect != types.EffectDeny {
		t.Error("Expected user to be denied delete")
	}

	// Owner can write
	if responses[2].Results["write"].Effect != types.EffectAllow {
		t.Error("Expected owner to be allowed to write")
	}
}

// TestIntegration_PolicyHotReload tests policy changes
func TestIntegration_PolicyHotReload(t *testing.T) {
	store := policy.NewMemoryStore()
	store.Add(&types.Policy{
		Name:         "initial-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "deny-all",
				Actions: []string{"*"},
				Effect:  types.EffectDeny,
			},
		},
	})

	cfg := engine.DefaultConfig()
	cfg.CacheEnabled = false

	eng, _ := engine.New(cfg, store)

	req := &types.CheckRequest{
		RequestID: "reload-test",
		Principal: &types.Principal{ID: "user-1", Roles: []string{"user"}},
		Resource:  &types.Resource{Kind: "document", ID: "doc-1"},
		Actions:   []string{"read"},
	}

	// Initial check - should deny
	resp1, _ := eng.Check(context.Background(), req)
	if resp1.Results["read"].Effect != types.EffectDeny {
		t.Error("Expected initial deny")
	}

	// Add new policy that allows
	store.Add(&types.Policy{
		Name:         "allow-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	})

	// Check again - should allow now
	resp2, _ := eng.Check(context.Background(), req)
	if resp2.Results["read"].Effect != types.EffectAllow {
		t.Error("Expected allow after policy change")
	}
}

// TestIntegration_PerformanceBaseline establishes performance baseline
func TestIntegration_PerformanceBaseline(t *testing.T) {
	store := setupTestPolicies()

	cfg := engine.DefaultConfig()
	cfg.CacheEnabled = false
	cfg.ParallelWorkers = 16

	eng, _ := engine.New(cfg, store)

	req := &types.CheckRequest{
		RequestID: "perf-baseline",
		Principal: &types.Principal{
			ID:    "user-perf",
			Roles: []string{"user"},
			Attributes: map[string]interface{}{
				"department": "engineering",
			},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-perf",
			Attributes: map[string]interface{}{
				"ownerId": "user-perf",
			},
		},
		Actions: []string{"read", "write", "delete"},
	}

	// Warm up
	for i := 0; i < 100; i++ {
		eng.Check(context.Background(), req)
	}

	// Measure
	numIterations := 1000
	start := time.Now()

	for i := 0; i < numIterations; i++ {
		_, err := eng.Check(context.Background(), req)
		if err != nil {
			t.Fatalf("Check failed: %v", err)
		}
	}

	duration := time.Since(start)
	avgLatency := duration / time.Duration(numIterations)

	t.Logf("Performance baseline: %d iterations in %v (avg: %v per request)",
		numIterations, duration, avgLatency)

	// Assert reasonable performance (< 1ms per request without cache)
	if avgLatency > time.Millisecond {
		t.Errorf("Performance below baseline: %v per request (expected < 1ms)", avgLatency)
	}
}

// setupTestPolicies creates a comprehensive set of test policies
func setupTestPolicies() *policy.MemoryStore {
	store := policy.NewMemoryStore()

	// Admin policy - full access
	store.Add(&types.Policy{
		Name:         "admin-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "admin-all",
				Actions: []string{"*"},
				Effect:  types.EffectAllow,
				Roles:   []string{"admin"},
			},
		},
	})

	// Owner policy - owner can read/write
	store.Add(&types.Policy{
		Name:         "owner-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:      "owner-rw",
				Actions:   []string{"read", "write"},
				Effect:    types.EffectAllow,
				Condition: `resource.attributes.ownerId == principal.id`,
			},
		},
	})

	// Public document policy
	store.Add(&types.Policy{
		Name:         "public-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:      "public-read",
				Actions:   []string{"read"},
				Effect:    types.EffectAllow,
				Condition: `resource.attributes.public == true`,
			},
		},
	})

	// Department policy for projects
	store.Add(&types.Policy{
		Name:         "department-policy",
		ResourceKind: "project",
		Rules: []*types.Rule{
			{
				Name:      "dept-access",
				Actions:   []string{"read", "contribute"},
				Effect:    types.EffectAllow,
				Condition: `principal.attributes.department == resource.attributes.department`,
			},
		},
	})

	return store
}
