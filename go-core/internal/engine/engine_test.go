package engine

import (
	"context"
	"testing"

	"github.com/authz-engine/go-core/internal/embedding"
	"github.com/authz-engine/go-core/internal/policy"
	intvector "github.com/authz-engine/go-core/internal/vector"
	"github.com/authz-engine/go-core/pkg/types"
	"github.com/authz-engine/go-core/pkg/vector"
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

// Phase 4.2: Incremental Update Tests

// Helper function to create engine with vector similarity for Phase 4.2 tests
func newEngineWithVectorSimilarity(t *testing.T, store policy.Store) *Engine {
	t.Helper()

	// Create vector store
	vectorStore, err := intvector.NewMemoryStore(vector.Config{
		Backend:   "memory",
		Dimension: 384,
		HNSW: vector.HNSWConfig{
			M:              16,
			EfConstruction: 200,
			EfSearch:       50,
		},
	})
	if err != nil {
		t.Fatalf("Failed to create vector store: %v", err)
	}

	// Create engine WITH vector similarity
	cfg := Config{
		CacheEnabled:            false,
		VectorSimilarityEnabled: true,
		VectorStore:             vectorStore,
		EmbeddingConfig: &embedding.Config{
			NumWorkers:    2,
			QueueSize:     100,
			BatchSize:     10,
			Dimension:     384,
			EmbeddingFunc: embedding.DefaultEmbeddingFunction,
		},
	}

	eng, err := New(cfg, store)
	if err != nil {
		t.Fatalf("Failed to create engine: %v", err)
	}

	return eng
}

func TestEngine_DetectChangedPolicies_NewPolicy(t *testing.T) {
	store := policy.NewMemoryStore()

	// Add initial policy
	store.Add(&types.Policy{
		Name:         "policy-1",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
				Roles:   []string{"viewer"},
			},
		},
	})

	// Create engine with vector similarity enabled
	eng := newEngineWithVectorSimilarity(t, store)
	defer eng.Shutdown(context.Background())

	// Add a new policy to the store
	newPolicy := &types.Policy{
		Name:         "policy-2",
		ResourceKind: "folder",
		Rules: []*types.Rule{
			{
				Name:    "allow-edit",
				Actions: []string{"edit"},
				Effect:  types.EffectAllow,
				Roles:   []string{"editor"},
			},
		},
	}
	store.Add(newPolicy)

	// Detect changes - should find the new policy
	changed := eng.DetectChangedPolicies([]string{"policy-1", "policy-2"})

	// Should detect policy-2 as new
	if len(changed) != 1 {
		t.Fatalf("Expected 1 changed policy, got %d", len(changed))
	}

	if changed[0].Name != "policy-2" {
		t.Errorf("Expected changed policy to be 'policy-2', got '%s'", changed[0].Name)
	}
}

func TestEngine_DetectChangedPolicies_ModifiedPolicy(t *testing.T) {
	store := policy.NewMemoryStore()

	// Add initial policy
	store.Add(&types.Policy{
		Name:         "policy-1",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
				Roles:   []string{"viewer"},
			},
		},
	})

	// Create engine
	eng := newEngineWithVectorSimilarity(t, store)
	defer eng.Shutdown(context.Background())

	// Modify the policy (change actions)
	modifiedPolicy := &types.Policy{
		Name:         "policy-1",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-read-write",
				Actions: []string{"read", "write"},
				Effect:  types.EffectAllow,
				Roles:   []string{"viewer", "editor"},
			},
		},
	}
	store.Add(modifiedPolicy) // Overwrites existing

	// Detect changes - should find the modified policy
	changed := eng.DetectChangedPolicies([]string{"policy-1"})

	// Should detect policy-1 as changed
	if len(changed) != 1 {
		t.Fatalf("Expected 1 changed policy, got %d", len(changed))
	}

	if changed[0].Name != "policy-1" {
		t.Errorf("Expected changed policy to be 'policy-1', got '%s'", changed[0].Name)
	}

	// Verify the rule has been updated
	if len(changed[0].Rules) != 1 {
		t.Errorf("Expected 1 rule, got %d", len(changed[0].Rules))
	}

	if len(changed[0].Rules[0].Actions) != 2 {
		t.Errorf("Expected 2 actions in modified policy, got %d", len(changed[0].Rules[0].Actions))
	}
}

func TestEngine_DetectChangedPolicies_UnchangedPolicy(t *testing.T) {
	store := policy.NewMemoryStore()

	// Add policy
	store.Add(&types.Policy{
		Name:         "policy-1",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
				Roles:   []string{"viewer"},
			},
		},
	})

	// Create engine
	eng := newEngineWithVectorSimilarity(t, store)
	defer eng.Shutdown(context.Background())

	// Check for changes without modifying the policy
	changed := eng.DetectChangedPolicies([]string{"policy-1"})

	// Should detect no changes
	if len(changed) != 0 {
		t.Fatalf("Expected 0 changed policies, got %d", len(changed))
	}
}

func TestEngine_DetectChangedPolicies_MixedChanges(t *testing.T) {
	store := policy.NewMemoryStore()

	// Add initial policies
	policy1 := &types.Policy{
		Name:         "policy-1",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
				Roles:   []string{"viewer"},
			},
		},
	}
	policy2 := &types.Policy{
		Name:         "policy-2",
		ResourceKind: "folder",
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
				Roles:   []string{"viewer"},
			},
		},
	}
	store.Add(policy1)
	store.Add(policy2)

	// Create engine
	eng := newEngineWithVectorSimilarity(t, store)
	defer eng.Shutdown(context.Background())

	// Modify policy-1 (add action)
	modifiedPolicy1 := &types.Policy{
		Name:         "policy-1",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-read-write",
				Actions: []string{"read", "write"},
				Effect:  types.EffectAllow,
				Roles:   []string{"viewer"},
			},
		},
	}
	store.Add(modifiedPolicy1)

	// Add new policy-3
	policy3 := &types.Policy{
		Name:         "policy-3",
		ResourceKind: "file",
		Rules: []*types.Rule{
			{
				Name:    "allow-delete",
				Actions: []string{"delete"},
				Effect:  types.EffectAllow,
				Roles:   []string{"admin"},
			},
		},
	}
	store.Add(policy3)

	// Detect changes - should find modified policy-1 and new policy-3, but not unchanged policy-2
	changed := eng.DetectChangedPolicies([]string{"policy-1", "policy-2", "policy-3"})

	// Should detect 2 changed policies
	if len(changed) != 2 {
		t.Fatalf("Expected 2 changed policies, got %d", len(changed))
	}

	// Verify which policies changed
	changedNames := make(map[string]bool)
	for _, pol := range changed {
		changedNames[pol.Name] = true
	}

	if !changedNames["policy-1"] {
		t.Error("Expected policy-1 to be detected as changed")
	}
	if changedNames["policy-2"] {
		t.Error("Expected policy-2 to NOT be detected as changed")
	}
	if !changedNames["policy-3"] {
		t.Error("Expected policy-3 to be detected as new")
	}
}

func TestEngine_UpdatePolicyHashes(t *testing.T) {
	store := policy.NewMemoryStore()

	// Create engine with vector similarity enabled
	eng := newEngineWithVectorSimilarity(t, store)
	defer eng.Shutdown(context.Background())

	// Create policies
	policies := []*types.Policy{
		{
			Name:         "policy-1",
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "allow-read",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
					Roles:   []string{"viewer"},
				},
			},
		},
		{
			Name:         "policy-2",
			ResourceKind: "folder",
			Rules: []*types.Rule{
				{
					Name:    "allow-edit",
					Actions: []string{"edit"},
					Effect:  types.EffectAllow,
					Roles:   []string{"editor"},
				},
			},
		},
	}

	// Update hashes
	count := eng.UpdatePolicyHashes(policies)

	if count != 2 {
		t.Errorf("Expected 2 policies tracked, got %d", count)
	}

	// Verify hashes were stored by checking if policies are detected as unchanged
	for _, pol := range policies {
		store.Add(pol)
	}

	changed := eng.DetectChangedPolicies([]string{"policy-1", "policy-2"})
	if len(changed) != 0 {
		t.Errorf("Expected 0 changed policies after UpdatePolicyHashes, got %d", len(changed))
	}
}

func TestEngine_ReEmbedChangedPolicies(t *testing.T) {
	store := policy.NewMemoryStore()

	// Add initial policy
	store.Add(&types.Policy{
		Name:         "policy-1",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
				Roles:   []string{"viewer"},
			},
		},
	})

	// Create engine
	eng := newEngineWithVectorSimilarity(t, store)
	defer eng.Shutdown(context.Background())

	// Modify the policy
	modifiedPolicy := &types.Policy{
		Name:         "policy-1",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-read-write",
				Actions: []string{"read", "write"},
				Effect:  types.EffectAllow,
				Roles:   []string{"viewer", "editor"},
			},
		},
	}
	store.Add(modifiedPolicy)

	// Add new policy
	newPolicy := &types.Policy{
		Name:         "policy-2",
		ResourceKind: "folder",
		Rules: []*types.Rule{
			{
				Name:    "allow-delete",
				Actions: []string{"delete"},
				Effect:  types.EffectAllow,
				Roles:   []string{"admin"},
			},
		},
	}
	store.Add(newPolicy)

	// Re-embed only changed policies with high priority
	submitted := eng.ReEmbedChangedPolicies([]string{"policy-1", "policy-2"}, 2)

	// Should submit 2 changed policies for re-embedding
	if submitted != 2 {
		t.Errorf("Expected 2 policies submitted for re-embedding, got %d", submitted)
	}

	// Wait a bit for embeddings to be processed
	// Note: In production, you'd subscribe to FileWatcher events
	// For this test, we just verify the submission succeeded
}

func TestEngine_DetectChangedPolicies_Disabled(t *testing.T) {
	store := policy.NewMemoryStore()
	
	// Create engine without vector similarity (hash tracking disabled)
	cfg := DefaultConfig()
	cfg.VectorSimilarityEnabled = false

	eng, err := New(cfg, store)
	if err != nil {
		t.Fatalf("Failed to create engine: %v", err)
	}

	// Attempt to detect changes - should return empty gracefully
	changed := eng.DetectChangedPolicies([]string{"policy-1"})

	if len(changed) != 0 {
		t.Errorf("Expected 0 changed policies when hash tracking disabled, got %d", len(changed))
	}
}

func TestEngine_ReEmbedChangedPolicies_Disabled(t *testing.T) {
	store := policy.NewMemoryStore()
	
	// Create engine without embedding worker
	cfg := DefaultConfig()
	cfg.VectorSimilarityEnabled = false

	eng, err := New(cfg, store)
	if err != nil {
		t.Fatalf("Failed to create engine: %v", err)
	}

	// Attempt to re-embed - should return 0 gracefully
	submitted := eng.ReEmbedChangedPolicies([]string{"policy-1"}, 2)

	if submitted != 0 {
		t.Errorf("Expected 0 policies submitted when worker disabled, got %d", submitted)
	}
}
