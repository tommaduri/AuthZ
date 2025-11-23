package engine

import (
	"context"
	"testing"

	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
)

func TestEngine_Check_SimpleAllow(t *testing.T) {
	store := policy.NewMemoryStore()
	store.Add(&types.Policy{
		Name:         "allow-admin",
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

	cfg := DefaultConfig()
	cfg.CacheEnabled = false

	eng, err := New(cfg, store)
	if err != nil {
		t.Fatalf("Failed to create engine: %v", err)
	}

	req := &types.CheckRequest{
		RequestID: "test-1",
		Principal: &types.Principal{
			ID:    "user-1",
			Roles: []string{"admin"},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-1",
		},
		Actions: []string{"read"},
	}

	resp, err := eng.Check(context.Background(), req)
	if err != nil {
		t.Fatalf("Check failed: %v", err)
	}

	if resp.Results["read"].Effect != types.EffectAllow {
		t.Errorf("Expected allow, got %v", resp.Results["read"].Effect)
	}
}

func TestEngine_Check_SimpleDeny(t *testing.T) {
	store := policy.NewMemoryStore()
	store.Add(&types.Policy{
		Name:         "allow-admin",
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

	cfg := DefaultConfig()
	cfg.CacheEnabled = false

	eng, err := New(cfg, store)
	if err != nil {
		t.Fatalf("Failed to create engine: %v", err)
	}

	req := &types.CheckRequest{
		RequestID: "test-2",
		Principal: &types.Principal{
			ID:    "user-2",
			Roles: []string{"user"}, // Not admin
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-1",
		},
		Actions: []string{"read"},
	}

	resp, err := eng.Check(context.Background(), req)
	if err != nil {
		t.Fatalf("Check failed: %v", err)
	}

	if resp.Results["read"].Effect != types.EffectDeny {
		t.Errorf("Expected deny, got %v", resp.Results["read"].Effect)
	}
}

func TestEngine_Check_CELCondition(t *testing.T) {
	store := policy.NewMemoryStore()
	store.Add(&types.Policy{
		Name:         "owner-access",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:      "owner-read",
				Actions:   []string{"read", "write"},
				Effect:    types.EffectAllow,
				Condition: `resource.attributes.ownerId == principal.id`,
			},
		},
	})

	cfg := DefaultConfig()
	cfg.CacheEnabled = false

	eng, err := New(cfg, store)
	if err != nil {
		t.Fatalf("Failed to create engine: %v", err)
	}

	// Owner should be allowed
	req := &types.CheckRequest{
		RequestID: "test-3",
		Principal: &types.Principal{
			ID:    "user-123",
			Roles: []string{"user"},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-1",
			Attributes: map[string]interface{}{
				"ownerId": "user-123",
			},
		},
		Actions: []string{"read"},
	}

	resp, err := eng.Check(context.Background(), req)
	if err != nil {
		t.Fatalf("Check failed: %v", err)
	}

	if resp.Results["read"].Effect != types.EffectAllow {
		t.Errorf("Expected allow for owner, got %v", resp.Results["read"].Effect)
	}

	// Non-owner should be denied
	req.Principal.ID = "user-456"
	resp, err = eng.Check(context.Background(), req)
	if err != nil {
		t.Fatalf("Check failed: %v", err)
	}

	if resp.Results["read"].Effect != types.EffectDeny {
		t.Errorf("Expected deny for non-owner, got %v", resp.Results["read"].Effect)
	}
}

func TestEngine_Check_MultipleActions(t *testing.T) {
	store := policy.NewMemoryStore()
	store.Add(&types.Policy{
		Name:         "document-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "all-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
			{
				Name:    "admin-write",
				Actions: []string{"write", "delete"},
				Effect:  types.EffectAllow,
				Roles:   []string{"admin"},
			},
		},
	})

	cfg := DefaultConfig()
	cfg.CacheEnabled = false

	eng, err := New(cfg, store)
	if err != nil {
		t.Fatalf("Failed to create engine: %v", err)
	}

	req := &types.CheckRequest{
		RequestID: "test-4",
		Principal: &types.Principal{
			ID:    "user-1",
			Roles: []string{"user"},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-1",
		},
		Actions: []string{"read", "write", "delete"},
	}

	resp, err := eng.Check(context.Background(), req)
	if err != nil {
		t.Fatalf("Check failed: %v", err)
	}

	if resp.Results["read"].Effect != types.EffectAllow {
		t.Errorf("Expected read to be allowed")
	}
	if resp.Results["write"].Effect != types.EffectDeny {
		t.Errorf("Expected write to be denied for non-admin")
	}
	if resp.Results["delete"].Effect != types.EffectDeny {
		t.Errorf("Expected delete to be denied for non-admin")
	}
}

func TestEngine_Check_CacheHit(t *testing.T) {
	store := policy.NewMemoryStore()
	store.Add(&types.Policy{
		Name:         "allow-all",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	})

	cfg := DefaultConfig()
	cfg.CacheEnabled = true
	cfg.CacheSize = 1000

	eng, err := New(cfg, store)
	if err != nil {
		t.Fatalf("Failed to create engine: %v", err)
	}

	req := &types.CheckRequest{
		RequestID: "test-5",
		Principal: &types.Principal{
			ID:    "user-1",
			Roles: []string{"user"},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-1",
		},
		Actions: []string{"read"},
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
}

func TestEngine_CheckBatch(t *testing.T) {
	store := policy.NewMemoryStore()
	store.Add(&types.Policy{
		Name:         "allow-all",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	})

	cfg := DefaultConfig()
	cfg.CacheEnabled = false

	eng, err := New(cfg, store)
	if err != nil {
		t.Fatalf("Failed to create engine: %v", err)
	}

	requests := []*types.CheckRequest{
		{
			RequestID: "batch-1",
			Principal: &types.Principal{ID: "user-1", Roles: []string{"user"}},
			Resource:  &types.Resource{Kind: "document", ID: "doc-1"},
			Actions:   []string{"read"},
		},
		{
			RequestID: "batch-2",
			Principal: &types.Principal{ID: "user-2", Roles: []string{"user"}},
			Resource:  &types.Resource{Kind: "document", ID: "doc-2"},
			Actions:   []string{"read"},
		},
		{
			RequestID: "batch-3",
			Principal: &types.Principal{ID: "user-3", Roles: []string{"user"}},
			Resource:  &types.Resource{Kind: "document", ID: "doc-3"},
			Actions:   []string{"read"},
		},
	}

	responses, err := eng.CheckBatch(context.Background(), requests)
	if err != nil {
		t.Fatalf("CheckBatch failed: %v", err)
	}

	if len(responses) != 3 {
		t.Errorf("Expected 3 responses, got %d", len(responses))
	}

	for i, resp := range responses {
		if resp.Results["read"].Effect != types.EffectAllow {
			t.Errorf("Request %d: expected allow, got %v", i, resp.Results["read"].Effect)
		}
	}
}

func BenchmarkEngine_Check(b *testing.B) {
	store := policy.NewMemoryStore()
	store.Add(&types.Policy{
		Name:         "bench-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:      "owner-access",
				Actions:   []string{"read", "write"},
				Effect:    types.EffectAllow,
				Condition: `resource.attributes.ownerId == principal.id`,
			},
		},
	})

	cfg := DefaultConfig()
	cfg.CacheEnabled = false

	eng, _ := New(cfg, store)

	req := &types.CheckRequest{
		RequestID: "bench",
		Principal: &types.Principal{
			ID:    "user-123",
			Roles: []string{"user"},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-1",
			Attributes: map[string]interface{}{
				"ownerId": "user-123",
			},
		},
		Actions: []string{"read"},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		eng.Check(context.Background(), req)
	}
}

func BenchmarkEngine_Check_Cached(b *testing.B) {
	store := policy.NewMemoryStore()
	store.Add(&types.Policy{
		Name:         "bench-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-all",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	})

	cfg := DefaultConfig()
	cfg.CacheEnabled = true

	eng, _ := New(cfg, store)

	req := &types.CheckRequest{
		RequestID: "bench",
		Principal: &types.Principal{
			ID:    "user-123",
			Roles: []string{"user"},
		},
		Resource: &types.Resource{
			Kind: "document",
			ID:   "doc-1",
		},
		Actions: []string{"read"},
	}

	// Warm up cache
	eng.Check(context.Background(), req)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		eng.Check(context.Background(), req)
	}
}
