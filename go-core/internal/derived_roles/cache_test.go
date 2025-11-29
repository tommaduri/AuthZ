package derived_roles

import (
	"sync"
	"testing"

	"github.com/authz-engine/go-core/pkg/types"
	"github.com/stretchr/testify/assert"
)

func TestNewDerivedRolesCache(t *testing.T) {
	cache := NewDerivedRolesCache()
	assert.NotNil(t, cache)
	assert.Equal(t, 0, cache.Size())
}

func TestCache_SetGet(t *testing.T) {
	cache := NewDerivedRolesCache()

	principal := &types.Principal{
		ID:    "user:alice",
		Roles: []string{"employee", "engineer"},
	}

	resource := &types.Resource{
		Kind: "document",
		ID:   "doc:123",
	}

	roles := []string{"employee", "engineer", "senior_engineer"}

	// Initially not in cache
	cached, found := cache.Get(principal, resource)
	assert.False(t, found)
	assert.Nil(t, cached)

	// Set in cache
	cache.Set(principal, resource, roles)
	assert.Equal(t, 1, cache.Size())

	// Retrieve from cache
	cached, found = cache.Get(principal, resource)
	assert.True(t, found)
	assert.Equal(t, roles, cached)
}

func TestCache_DifferentPrincipals(t *testing.T) {
	cache := NewDerivedRolesCache()

	principal1 := &types.Principal{
		ID:    "user:alice",
		Roles: []string{"employee"},
	}

	principal2 := &types.Principal{
		ID:    "user:bob",
		Roles: []string{"employee"},
	}

	roles1 := []string{"employee", "engineer"}
	roles2 := []string{"employee", "manager"}

	cache.Set(principal1, nil, roles1)
	cache.Set(principal2, nil, roles2)

	cached1, found1 := cache.Get(principal1, nil)
	assert.True(t, found1)
	assert.Equal(t, roles1, cached1)

	cached2, found2 := cache.Get(principal2, nil)
	assert.True(t, found2)
	assert.Equal(t, roles2, cached2)

	assert.Equal(t, 2, cache.Size())
}

func TestCache_RoleSorting(t *testing.T) {
	cache := NewDerivedRolesCache()

	// Same principal with roles in different order should produce same cache key
	principal1 := &types.Principal{
		ID:    "user:alice",
		Roles: []string{"admin", "employee", "manager"},
	}

	principal2 := &types.Principal{
		ID:    "user:alice",
		Roles: []string{"manager", "employee", "admin"},
	}

	roles := []string{"admin", "employee", "manager", "senior_manager"}

	cache.Set(principal1, nil, roles)

	// Should find cached entry with different role order
	cached, found := cache.Get(principal2, nil)
	assert.True(t, found)
	assert.Equal(t, roles, cached)
	assert.Equal(t, 1, cache.Size()) // Only one cache entry
}

func TestCache_WithResource(t *testing.T) {
	cache := NewDerivedRolesCache()

	principal := &types.Principal{
		ID:    "user:alice",
		Roles: []string{"employee"},
	}

	resource1 := &types.Resource{
		Kind: "document",
		ID:   "doc:123",
	}

	resource2 := &types.Resource{
		Kind: "project",
		ID:   "proj:456",
	}

	roles1 := []string{"employee", "document_editor"}
	roles2 := []string{"employee", "project_manager"}

	cache.Set(principal, resource1, roles1)
	cache.Set(principal, resource2, roles2)

	cached1, found1 := cache.Get(principal, resource1)
	assert.True(t, found1)
	assert.Equal(t, roles1, cached1)

	cached2, found2 := cache.Get(principal, resource2)
	assert.True(t, found2)
	assert.Equal(t, roles2, cached2)

	assert.Equal(t, 2, cache.Size())
}

func TestCache_Clear(t *testing.T) {
	cache := NewDerivedRolesCache()

	principal := &types.Principal{
		ID:    "user:alice",
		Roles: []string{"employee"},
	}

	roles := []string{"employee", "engineer"}
	cache.Set(principal, nil, roles)
	assert.Equal(t, 1, cache.Size())

	cache.Clear()
	assert.Equal(t, 0, cache.Size())

	cached, found := cache.Get(principal, nil)
	assert.False(t, found)
	assert.Nil(t, cached)
}

func TestCache_NilPrincipal(t *testing.T) {
	cache := NewDerivedRolesCache()

	roles := []string{"employee"}

	// Set with nil principal should not panic
	cache.Set(nil, nil, roles)
	assert.Equal(t, 0, cache.Size())

	// Get with nil principal should return not found
	cached, found := cache.Get(nil, nil)
	assert.False(t, found)
	assert.Nil(t, cached)
}

func TestCache_ThreadSafety(t *testing.T) {
	cache := NewDerivedRolesCache()

	principal := &types.Principal{
		ID:    "user:alice",
		Roles: []string{"employee"},
	}

	roles := []string{"employee", "engineer"}

	// Run concurrent operations
	var wg sync.WaitGroup
	concurrency := 100

	// Concurrent writes
	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			p := &types.Principal{
				ID:    "user:alice",
				Roles: []string{"employee"},
			}
			cache.Set(p, nil, roles)
		}(i)
	}

	// Concurrent reads
	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cache.Get(principal, nil)
		}()
	}

	// Concurrent size checks
	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cache.Size()
		}()
	}

	wg.Wait()

	// Should have exactly one entry (all writes had same key)
	assert.Equal(t, 1, cache.Size())
}

func TestCache_Immutability(t *testing.T) {
	cache := NewDerivedRolesCache()

	principal := &types.Principal{
		ID:    "user:alice",
		Roles: []string{"employee"},
	}

	originalRoles := []string{"employee", "engineer"}
	cache.Set(principal, nil, originalRoles)

	// Modify original slice
	originalRoles[1] = "hacker"

	// Cached value should be unchanged
	cached, found := cache.Get(principal, nil)
	assert.True(t, found)
	assert.Equal(t, []string{"employee", "engineer"}, cached)
	assert.NotEqual(t, originalRoles, cached)
}
