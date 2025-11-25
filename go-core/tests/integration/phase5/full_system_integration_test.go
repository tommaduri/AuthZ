package phase5_test

import (
	"context"
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestPhase5FullIntegration tests all Phase 5 systems working together
// DEPENDENCY: Requires both Track A (Vector Store) AND Track B (Agent + MCP/A2A) complete
func TestPhase5FullIntegration(t *testing.T) {
	t.Skip("WAITING FOR TRACKS A & B: Complete Phase 5 implementation")

	ctx := context.Background()

	// Step 1: Agent registration + credentials
	agentStore := getAgentStore(t)
	agent := &types.Agent{
		ID:          "agent:avatar-connex",
		Type:        "ai-assistant",
		DisplayName: "Avatar Connex AI Agent",
		Status:      "active",
		Credentials: []types.Credential{
			{
				ID:       "cred-avatar-123",
				Type:     "ed25519-key",
				Value:    "hashed-public-key",
				IssuedAt: time.Now(),
			},
		},
		Metadata: map[string]interface{}{
			"avatar_id":       "avatar-001",
			"capabilities":    []string{"reasoning", "memory", "learning"},
			"trust_level":     "high",
			"max_delegation":  3,
		},
		CreatedAt: time.Now(),
	}

	err := agentStore.Register(ctx, agent)
	require.NoError(t, err)

	// Step 2: Authorization with delegation
	delegationStore := getDelegationStore(t)
	delegation := &types.Delegation{
		FromAgentID: "user:alice",
		ToAgentID:   "agent:avatar-connex",
		Action:      "*",
		Resource: &types.Resource{
			Kind:  "document",
			Scope: "user:alice:workspace",
		},
		ExpiresAt: ptrTime(time.Now().Add(24 * time.Hour)),
	}

	err = delegationStore.Create(ctx, delegation)
	require.NoError(t, err)

	// Create engine with Vector Store enabled
	cfg := engine.Config{
		CacheEnabled:       true,
		VectorStoreEnabled: true,
		VectorStoreConfig: &engine.VectorStoreConfig{
			Backend:   "memory",
			Dimension: 384,
			HNSW: engine.HNSWConfig{
				M:              16,
				EfConstruction: 200,
				EfSearch:       50,
			},
		},
	}

	store := memory.NewMemoryStore()
	eng, err := engine.New(cfg, store)
	require.NoError(t, err)

	// Authorization request from agent with delegation
	req := &types.CheckRequest{
		Principal: &types.Principal{
			ID:    "agent:avatar-connex",
			Roles: []string{"ai-assistant"},
			Scope: "user:alice:workspace",
		},
		Resource: &types.Resource{
			Kind:  "document",
			ID:    "doc:project-plan",
			Scope: "user:alice:workspace",
		},
		Actions: []string{"read", "write"},
		Metadata: map[string]interface{}{
			"delegation_chain": []string{"user:alice", "agent:avatar-connex"},
		},
	}

	// Step 3: Vector embedding for anomaly detection
	resp, err := eng.Check(ctx, req)
	require.NoError(t, err)
	assert.Equal(t, types.EffectAllow, resp.Results["read"].Effect)
	assert.Equal(t, types.EffectAllow, resp.Results["write"].Effect)

	// Wait for async embedding
	time.Sleep(200 * time.Millisecond)

	vectorStore := eng.GetVectorStore()
	stats, err := vectorStore.Stats(ctx)
	require.NoError(t, err)
	assert.Greater(t, stats.TotalVectors, int64(0), "Should have embedded decision")

	// Step 4: ANALYST detects unusual pattern
	// Create anomalous request (different scope, unusual action)
	anomalousReq := &types.CheckRequest{
		Principal: &types.Principal{
			ID:    "agent:avatar-connex",
			Roles: []string{"ai-assistant"},
			Scope: "user:bob:workspace", // Different user's workspace!
		},
		Resource: &types.Resource{
			Kind:  "secrets",
			ID:    "secret:api-keys",
			Scope: "user:bob:workspace",
		},
		Actions: []string{"delete"}, // Unusual action
		Metadata: map[string]interface{}{
			"delegation_chain": []string{"user:alice", "agent:avatar-connex"},
		},
	}

	anomalousResp, err := eng.Check(ctx, anomalousReq)
	require.NoError(t, err)

	// Should be denied (different scope, no delegation for Bob's workspace)
	assert.Equal(t, types.EffectDeny, anomalousResp.Results["delete"].Effect)

	// Wait for embedding
	time.Sleep(200 * time.Millisecond)

	// TODO: Implement ANALYST anomaly detection API
	// anomalyScore := analyst.DetectAnomaly(anomalousResp.RequestID)
	// assert.Greater(t, anomalyScore, 0.8, "Should detect high anomaly score")

	// Step 5: System maintains <10µs authorization hot path
	// Measure 1000 authorization checks
	durations := make([]time.Duration, 1000)
	for i := 0; i < 1000; i++ {
		start := time.Now()
		_, err := eng.Check(ctx, req)
		durations[i] = time.Since(start)
		require.NoError(t, err)
	}

	p99 := calculatePercentile(durations, 99)
	assert.Less(t, p99.Microseconds(), int64(10), "p99 latency should be <10µs")
}

// TestAvatarConnexMultiAgentScenario tests Avatar Connex multi-agent delegation
// DEPENDENCY: Requires both Track A & B complete
func TestAvatarConnexMultiAgentScenario(t *testing.T) {
	t.Skip("WAITING FOR TRACKS A & B: Complete Phase 5 implementation")

	ctx := context.Background()

	// Scenario: User → Avatar Agent → GitHub Agent → Deploy Agent
	// User delegates to Avatar, Avatar delegates to GitHub, GitHub delegates to Deploy

	// Register all agents
	agents := []*types.Agent{
		createTestAgent("agent:avatar", "ai-assistant"),
		createTestAgent("agent:github", "integration"),
		createTestAgent("agent:deploy", "automation"),
	}

	agentStore := getAgentStore(t)
	for _, agent := range agents {
		err := agentStore.Register(ctx, agent)
		require.NoError(t, err)
	}

	// Create delegation chain
	delegations := []*types.Delegation{
		{
			FromAgentID: "user:alice",
			ToAgentID:   "agent:avatar",
			Action:      "deploy",
			Resource: &types.Resource{
				Kind:  "service",
				Scope: "production",
			},
		},
		{
			FromAgentID: "agent:avatar",
			ToAgentID:   "agent:github",
			Action:      "deploy",
			Resource: &types.Resource{
				Kind:  "service",
				Scope: "production",
			},
		},
		{
			FromAgentID: "agent:github",
			ToAgentID:   "agent:deploy",
			Action:      "deploy",
			Resource: &types.Resource{
				Kind:  "service",
				Scope: "production",
			},
		},
	}

	delegationStore := getDelegationStore(t)
	for _, delegation := range delegations {
		err := delegationStore.Create(ctx, delegation)
		require.NoError(t, err)
	}

	// Deploy agent performs deployment with full chain
	cfg := engine.Config{
		CacheEnabled:       true,
		VectorStoreEnabled: true,
		VectorStoreConfig: &engine.VectorStoreConfig{
			Backend:   "memory",
			Dimension: 384,
		},
	}

	store := memory.NewMemoryStore()
	eng, err := engine.New(cfg, store)
	require.NoError(t, err)

	req := &types.CheckRequest{
		Principal: &types.Principal{
			ID:    "agent:deploy",
			Roles: []string{"automation"},
		},
		Resource: &types.Resource{
			Kind:  "service",
			ID:    "service:api-gateway",
			Scope: "production",
		},
		Actions: []string{"deploy"},
		Metadata: map[string]interface{}{
			"delegation_chain": []string{
				"user:alice",
				"agent:avatar",
				"agent:github",
				"agent:deploy",
			},
		},
	}

	resp, err := eng.Check(ctx, req)
	require.NoError(t, err)
	assert.Equal(t, types.EffectAllow, resp.Results["deploy"].Effect,
		"Delegation chain should authorize deployment")

	// Verify vector embedding captured this complex scenario
	time.Sleep(200 * time.Millisecond)

	vectorStore := eng.GetVectorStore()
	stats, err := vectorStore.Stats(ctx)
	require.NoError(t, err)
	assert.Greater(t, stats.TotalVectors, int64(0))

	// TODO: Query vector store for similar delegation patterns
}

// TestSystemIntegrationWithAllPhases tests Phase 5 + Phases 1-4 integration
// DEPENDENCY: Requires complete Phase 5 implementation
func TestSystemIntegrationWithAllPhases(t *testing.T) {
	t.Skip("WAITING FOR TRACKS A & B: Complete Phase 5 implementation")

	ctx := context.Background()

	// Test that Phase 5 features work with:
	// - Phase 1: Basic authorization
	// - Phase 2: Scope resolution
	// - Phase 3: Principal policies
	// - Phase 4: Derived roles

	store := memory.NewMemoryStore()

	// Add policies from all phases
	// Phase 2: Scoped policy
	scopedPolicy := &types.Policy{
		APIVersion: "api.authz.engine/v1",
		Name:       "scoped-document-policy",
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Scope:    "org:acme",
			Version:  "1.0",
			Rules: []*types.ResourceRule{
				{
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
					Roles:   []string{"viewer"},
				},
			},
		},
	}

	// Phase 3: Principal policy
	principalPolicy := &types.Policy{
		APIVersion:     "api.authz.engine/v1",
		Name:           "vip-user-policy",
		PrincipalPolicy: true,
		Principal: &types.PrincipalSelector{
			ID: "user:vip",
		},
		Resources: []*types.ResourceSelector{
			{Kind: "*", Scope: "**"},
		},
		Rules: []*types.PrincipalRule{
			{
				Actions: []string{"*"},
				Effect:  types.EffectAllow,
			},
		},
	}

	// Phase 4: Derived roles policy
	derivedRolesPolicy := &types.Policy{
		APIVersion: "api.authz.engine/v1",
		Name:       "derived-roles",
		DerivedRoles: &types.DerivedRoles{
			Name: "org-derived-roles",
			Definitions: []*types.RoleDef{
				{
					Name:        "org-admin",
					ParentRoles: []string{"admin"},
					Condition: &types.Condition{
						Match: &types.Match{
							Expr: `P.attr.org == R.scope`,
						},
					},
				},
			},
		},
	}

	// Phase 5: Agent policy
	agentPolicy := &types.Policy{
		APIVersion:      "api.authz.engine/v1",
		Name:            "agent-access-policy",
		PrincipalPolicy: true,
		Principal: &types.PrincipalSelector{
			Roles: []string{"ai-assistant"},
		},
		Resources: []*types.ResourceSelector{
			{Kind: "document", Scope: "**"},
		},
		Rules: []*types.PrincipalRule{
			{
				Actions: []string{"read", "analyze"},
				Effect:  types.EffectAllow,
			},
		},
	}

	// Add all policies
	policies := []*types.Policy{
		scopedPolicy,
		principalPolicy,
		derivedRolesPolicy,
		agentPolicy,
	}

	for _, policy := range policies {
		err := store.Add(ctx, policy)
		require.NoError(t, err)
	}

	// Create engine with all features
	cfg := engine.Config{
		CacheEnabled:       true,
		VectorStoreEnabled: true,
		VectorStoreConfig: &engine.VectorStoreConfig{
			Backend:   "memory",
			Dimension: 384,
		},
	}

	eng, err := engine.New(cfg, store)
	require.NoError(t, err)

	// Test authorization with all phases integrated
	req := &types.CheckRequest{
		Principal: &types.Principal{
			ID:    "agent:avatar",
			Roles: []string{"ai-assistant", "viewer"},
			Scope: "org:acme",
			Attributes: map[string]interface{}{
				"org": "acme",
			},
		},
		Resource: &types.Resource{
			Kind:  "document",
			ID:    "doc:project-plan",
			Scope: "org:acme",
		},
		Actions: []string{"read", "analyze"},
	}

	resp, err := eng.Check(ctx, req)
	require.NoError(t, err)

	// Should allow both actions (agent policy + scoped policy)
	assert.Equal(t, types.EffectAllow, resp.Results["read"].Effect)
	assert.Equal(t, types.EffectAllow, resp.Results["analyze"].Effect)

	// Should maintain <10µs latency
	assert.Less(t, resp.Metadata.EvaluationDurationUs, 10.0)

	// Should embed in vector store
	time.Sleep(200 * time.Millisecond)
	vectorStore := eng.GetVectorStore()
	stats, err := vectorStore.Stats(ctx)
	require.NoError(t, err)
	assert.Greater(t, stats.TotalVectors, int64(0))
}
