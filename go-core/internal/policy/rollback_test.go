package policy

import (
	"context"
	"testing"

	"github.com/authz-engine/go-core/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewRollbackManager(t *testing.T) {
	store := NewMemoryStore()
	versionStore := NewVersionStore(10)
	validator := NewValidator()

	rm := NewRollbackManager(store, versionStore, validator)
	assert.NotNil(t, rm)
	assert.Equal(t, store, rm.store)
	assert.Equal(t, versionStore, rm.versionStore)
	assert.Equal(t, validator, rm.validator)
}

func TestRollbackManager_UpdateWithRollback_Success(t *testing.T) {
	store := NewMemoryStore()
	versionStore := NewVersionStore(10)
	validator := NewValidator()
	rm := NewRollbackManager(store, versionStore, validator)

	ctx := context.Background()

	// Initial policies
	initialPolicies := map[string]*types.Policy{
		"policy1": {
			APIVersion:   "api.agsiri.dev/v1",
			Name:         "policy1",
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "allow-read",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
				},
			},
		},
	}

	// Add initial policies
	for _, p := range initialPolicies {
		require.NoError(t, store.Add(p))
	}

	// Update with new valid policies
	newPolicies := map[string]*types.Policy{
		"policy1": {
			APIVersion:   "api.agsiri.dev/v1",
			Name:         "policy1",
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "allow-read-write",
					Actions: []string{"read", "write"},
					Effect:  types.EffectAllow,
				},
			},
		},
		"policy2": {
			APIVersion:   "api.agsiri.dev/v1",
			Name:         "policy2",
			ResourceKind: "file",
			Rules: []*types.Rule{
				{
					Name:    "allow-delete",
					Actions: []string{"delete"},
					Effect:  types.EffectAllow,
				},
			},
		},
	}

	version, err := rm.UpdateWithRollback(ctx, newPolicies, "Add policy2 and update policy1")
	require.NoError(t, err)
	require.NotNil(t, version)

	// Verify new policies are applied
	assert.Equal(t, 2, store.Count())
	p1, _ := store.Get("policy1")
	require.NotNil(t, p1)
	assert.Len(t, p1.Rules, 1)
	assert.Equal(t, "allow-read-write", p1.Rules[0].Name)

	p2, _ := store.Get("policy2")
	require.NotNil(t, p2)
	assert.Equal(t, "policy2", p2.Name)
}

func TestRollbackManager_UpdateWithRollback_ValidationFailure(t *testing.T) {
	store := NewMemoryStore()
	versionStore := NewVersionStore(10)
	validator := NewValidator()
	rm := NewRollbackManager(store, versionStore, validator)

	ctx := context.Background()

	// Initial policies
	initialPolicies := map[string]*types.Policy{
		"policy1": {
			APIVersion:   "api.agsiri.dev/v1",
			Name:         "policy1",
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "allow-read",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
				},
			},
		},
	}

	for _, p := range initialPolicies {
		require.NoError(t, store.Add(p))
	}

	// Try to update with invalid policy (missing required fields)
	invalidPolicies := map[string]*types.Policy{
		"invalid": {
			Name: "invalid",
			// Missing APIVersion and ResourceKind - should fail validation
		},
	}

	_, err := rm.UpdateWithRollback(ctx, invalidPolicies, "Try invalid update")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "validation failed")

	// Verify original policy is still there (no rollback needed since validation failed before apply)
	assert.Equal(t, 1, store.Count())
	p1, _ := store.Get("policy1")
	require.NotNil(t, p1)
	assert.Equal(t, "policy1", p1.Name)
}

func TestRollbackManager_Rollback(t *testing.T) {
	store := NewMemoryStore()
	versionStore := NewVersionStore(10)
	validator := NewValidator()
	rm := NewRollbackManager(store, versionStore, validator)

	ctx := context.Background()

	// Version 1: Initial policy
	v1Policies := map[string]*types.Policy{
		"policy1": {
			APIVersion:   "api.agsiri.dev/v1",
			Name:         "policy1",
			ResourceKind: "document",
			Scope:        "v1",
			Rules: []*types.Rule{
				{Name: "rule1", Actions: []string{"read"}, Effect: types.EffectAllow},
			},
		},
	}

	for _, p := range v1Policies {
		require.NoError(t, store.Add(p))
	}
	v1, err := rm.UpdateWithRollback(ctx, v1Policies, "Version 1")
	require.NoError(t, err)

	// Version 2: Add second policy
	v2Policies := map[string]*types.Policy{
		"policy1": {
			APIVersion:   "api.agsiri.dev/v1",
			Name:         "policy1",
			ResourceKind: "document",
			Scope:        "v2",
			Rules: []*types.Rule{
				{Name: "rule1", Actions: []string{"read", "write"}, Effect: types.EffectAllow},
			},
		},
		"policy2": {
			APIVersion:   "api.agsiri.dev/v1",
			Name:         "policy2",
			ResourceKind: "file",
			Scope:        "v2",
			Rules: []*types.Rule{
				{Name: "rule2", Actions: []string{"delete"}, Effect: types.EffectAllow},
			},
		},
	}

	_, err = rm.UpdateWithRollback(ctx, v2Policies, "Version 2")
	require.NoError(t, err)

	// Verify version 2 is applied
	assert.Equal(t, 2, store.Count())

	// Rollback to version 1
	err = rm.Rollback(ctx, v1.Version)
	require.NoError(t, err)

	// Verify rollback restored version 1
	assert.Equal(t, 1, store.Count())
	p1, _ := store.Get("policy1")
	require.NotNil(t, p1)
	assert.Equal(t, "v1", p1.Scope)
	assert.Len(t, p1.Rules, 1)
	assert.Equal(t, []string{"read"}, p1.Rules[0].Actions)
}

func TestRollbackManager_RollbackToPrevious(t *testing.T) {
	store := NewMemoryStore()
	versionStore := NewVersionStore(10)
	validator := NewValidator()
	rm := NewRollbackManager(store, versionStore, validator)

	ctx := context.Background()

	// Create version 1
	v1Policies := map[string]*types.Policy{
		"policy1": {
			APIVersion:   "api.agsiri.dev/v1",
			Name:         "policy1",
			ResourceKind: "doc",
			Scope:        "v1",
			Rules:        []*types.Rule{{Name: "r1", Actions: []string{"read"}, Effect: types.EffectAllow}},
		},
	}
	for _, p := range v1Policies {
		require.NoError(t, store.Add(p))
	}
	_, err := rm.UpdateWithRollback(ctx, v1Policies, "V1")
	require.NoError(t, err)

	// Create version 2
	v2Policies := map[string]*types.Policy{
		"policy1": {
			APIVersion:   "api.agsiri.dev/v1",
			Name:         "policy1",
			ResourceKind: "doc",
			Scope:        "v2",
			Rules:        []*types.Rule{{Name: "r2", Actions: []string{"write"}, Effect: types.EffectAllow}},
		},
	}
	_, err = rm.UpdateWithRollback(ctx, v2Policies, "V2")
	require.NoError(t, err)

	// Verify v2 is active
	p, _ := store.Get("policy1")
	require.NotNil(t, p)
	assert.Equal(t, "v2", p.Scope)

	// Rollback to previous (v1)
	err = rm.RollbackToPrevious(ctx)
	require.NoError(t, err)

	// Verify v1 is restored
	p, _ = store.Get("policy1")
	require.NotNil(t, p)
	assert.Equal(t, "v1", p.Scope)
}

func TestRollbackManager_PerformRollbackWithInfo(t *testing.T) {
	store := NewMemoryStore()
	versionStore := NewVersionStore(10)
	validator := NewValidator()
	rm := NewRollbackManager(store, versionStore, validator)

	ctx := context.Background()

	// Create two versions
	v1Policies := map[string]*types.Policy{
		"p1": {APIVersion: "api.agsiri.dev/v1", Name: "p1", ResourceKind: "doc", Scope: "v1",
			Rules: []*types.Rule{{Name: "r", Actions: []string{"read"}, Effect: types.EffectAllow}}},
	}
	for _, p := range v1Policies {
		require.NoError(t, store.Add(p))
	}
	v1, err := rm.UpdateWithRollback(ctx, v1Policies, "V1")
	require.NoError(t, err)

	v2Policies := map[string]*types.Policy{
		"p1": {APIVersion: "api.agsiri.dev/v1", Name: "p1", ResourceKind: "doc", Scope: "v2",
			Rules: []*types.Rule{{Name: "r", Actions: []string{"write"}, Effect: types.EffectAllow}}},
	}
	_, err = rm.UpdateWithRollback(ctx, v2Policies, "V2")
	require.NoError(t, err)

	// Rollback with info
	info := rm.PerformRollbackWithInfo(ctx, v1.Version)
	require.NotNil(t, info)
	assert.True(t, info.Success)
	assert.Equal(t, v1.Version, info.ToVersion)
	assert.Equal(t, 1, info.PoliciesCount)
	assert.NoError(t, info.Error)
	assert.False(t, info.RollbackTime.IsZero())
}

func TestRollbackManager_GetVersion(t *testing.T) {
	store := NewMemoryStore()
	versionStore := NewVersionStore(10)
	validator := NewValidator()
	rm := NewRollbackManager(store, versionStore, validator)

	ctx := context.Background()

	// Create a version
	policies := map[string]*types.Policy{
		"p1": {APIVersion: "api.agsiri.dev/v1", Name: "p1", ResourceKind: "doc",
			Rules: []*types.Rule{{Name: "r", Actions: []string{"read"}, Effect: types.EffectAllow}}},
	}
	for _, p := range policies {
		require.NoError(t, store.Add(p))
	}
	v, err := rm.UpdateWithRollback(ctx, policies, "Test")
	require.NoError(t, err)

	// Get version through manager
	retrieved, err := rm.GetVersion(v.Version)
	require.NoError(t, err)
	assert.Equal(t, v.Version, retrieved.Version)
}

func TestRollbackManager_ListVersions(t *testing.T) {
	store := NewMemoryStore()
	versionStore := NewVersionStore(10)
	validator := NewValidator()
	rm := NewRollbackManager(store, versionStore, validator)

	ctx := context.Background()

	// Create multiple versions
	for i := 1; i <= 3; i++ {
		policies := map[string]*types.Policy{
			"p1": {
				APIVersion:   "api.agsiri.dev/v1",
				Name:         "p1",
				ResourceKind: "doc",
				Scope:        string(rune(i)), // Make unique
				Rules:        []*types.Rule{{Name: "r", Actions: []string{"read"}, Effect: types.EffectAllow}},
			},
		}
		for _, p := range policies {
			require.NoError(t, store.Add(p))
		}
		_, err := rm.UpdateWithRollback(ctx, policies, "Version")
		require.NoError(t, err)
	}

	versions := rm.ListVersions()
	assert.GreaterOrEqual(t, len(versions), 3)
}

func TestRollbackManager_GetStats(t *testing.T) {
	store := NewMemoryStore()
	versionStore := NewVersionStore(10)
	validator := NewValidator()
	rm := NewRollbackManager(store, versionStore, validator)

	ctx := context.Background()

	// Create a version
	policies := map[string]*types.Policy{
		"p1": {APIVersion: "api.agsiri.dev/v1", Name: "p1", ResourceKind: "doc",
			Rules: []*types.Rule{{Name: "r", Actions: []string{"read"}, Effect: types.EffectAllow}}},
	}
	for _, p := range policies {
		require.NoError(t, store.Add(p))
	}
	_, err := rm.UpdateWithRollback(ctx, policies, "Test")
	require.NoError(t, err)

	stats := rm.GetStats()
	assert.Greater(t, stats.TotalVersions, 0)
	assert.Equal(t, 10, stats.MaxVersions)
}
