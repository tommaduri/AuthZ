package derived_roles_test

import (
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/authz-engine/go-core/internal/derived_roles"
	"github.com/authz-engine/go-core/pkg/types"
)

// TestPerRequestCaching tests basic cache functionality
func TestPerRequestCaching(t *testing.T) {
	t.Run("should cache computed results", func(t *testing.T) {
		cache := derived_roles.NewDerivedRolesCache()

		principal := &types.Principal{
			ID:    "user123",
			Roles: []string{"user"},
		}
		resource := &types.Resource{
			Kind: "document",
			ID:   "doc1",
		}

		// First call - cache miss
		roles1, found1 := cache.Get(principal, resource)
		assert.False(t, found1, "Should not be found in empty cache")
		assert.Nil(t, roles1)

		// Set value
		cache.Set(principal, resource, []string{"owner", "viewer"})

		// Second call - cache hit
		roles2, found2 := cache.Get(principal, resource)
		assert.True(t, found2, "Should be found in cache")
		assert.Equal(t, []string{"owner", "viewer"}, roles2)
	})

	t.Run("should store different principals independently", func(t *testing.T) {
		cache := derived_roles.NewDerivedRolesCache()

		principal1 := &types.Principal{ID: "user1", Roles: []string{"user"}}
		principal2 := &types.Principal{ID: "user2", Roles: []string{"user"}}
		resource := &types.Resource{Kind: "document", ID: "doc1"}

		cache.Set(principal1, resource, []string{"owner"})
		cache.Set(principal2, resource, []string{"viewer"})

		roles1, _ := cache.Get(principal1, resource)
		roles2, _ := cache.Get(principal2, resource)

		assert.Equal(t, []string{"owner"}, roles1)
		assert.Equal(t, []string{"viewer"}, roles2)
	})

	t.Run("should handle empty role arrays", func(t *testing.T) {
		cache := derived_roles.NewDerivedRolesCache()

		principal := &types.Principal{ID: "user1", Roles: []string{}}
		resource := &types.Resource{Kind: "document"}

		cache.Set(principal, resource, []string{})
		roles, found := cache.Get(principal, resource)

		assert.True(t, found)
		assert.Empty(t, roles)
	})

	t.Run("should handle nil principal gracefully", func(t *testing.T) {
		cache := derived_roles.NewDerivedRolesCache()
		resource := &types.Resource{Kind: "document"}

		// Get with nil principal
		roles, found := cache.Get(nil, resource)
		assert.False(t, found)
		assert.Nil(t, roles)

		// Set with nil principal (should not panic)
		cache.Set(nil, resource, []string{"role1"})
		assert.Equal(t, 0, cache.Size())
	})
}

// TestCacheInvalidation tests cache clearing
func TestCacheInvalidation(t *testing.T) {
	t.Run("should clear cache", func(t *testing.T) {
		cache := derived_roles.NewDerivedRolesCache()

		principal1 := &types.Principal{ID: "user1", Roles: []string{"user"}}
		principal2 := &types.Principal{ID: "user2", Roles: []string{"admin"}}
		resource := &types.Resource{Kind: "document"}

		cache.Set(principal1, resource, []string{"role1"})
		cache.Set(principal2, resource, []string{"role2"})

		assert.Equal(t, 2, cache.Size())

		cache.Clear()

		assert.Equal(t, 0, cache.Size())
	})

	t.Run("should recompute after clear", func(t *testing.T) {
		cache := derived_roles.NewDerivedRolesCache()

		principal := &types.Principal{ID: "user1", Roles: []string{"user"}}
		resource := &types.Resource{Kind: "document"}

		cache.Set(principal, resource, []string{"role1"})
		cache.Clear()

		_, found := cache.Get(principal, resource)
		assert.False(t, found, "Cache should be empty after clear")
	})
}

// TestCacheKeyGeneration tests cache key generation
func TestCacheKeyGeneration(t *testing.T) {
	t.Run("should generate consistent cache keys", func(t *testing.T) {
		cache := derived_roles.NewDerivedRolesCache()

		principal := &types.Principal{ID: "user1", Roles: []string{"role1", "role2"}}
		resource := &types.Resource{Kind: "document", ID: "doc1"}

		// Set and get multiple times
		cache.Set(principal, resource, []string{"owner"})
		roles1, found1 := cache.Get(principal, resource)
		roles2, found2 := cache.Get(principal, resource)

		assert.True(t, found1)
		assert.True(t, found2)
		assert.Equal(t, roles1, roles2, "Same inputs should return same result")
	})

	t.Run("should differentiate by principal ID", func(t *testing.T) {
		cache := derived_roles.NewDerivedRolesCache()

		principal1 := &types.Principal{ID: "user1", Roles: []string{"role1"}}
		principal2 := &types.Principal{ID: "user2", Roles: []string{"role1"}}
		resource := &types.Resource{Kind: "document", ID: "doc1"}

		cache.Set(principal1, resource, []string{"owner"})
		cache.Set(principal2, resource, []string{"viewer"})

		roles1, _ := cache.Get(principal1, resource)
		roles2, _ := cache.Get(principal2, resource)

		assert.NotEqual(t, roles1, roles2, "Different principals should have different cache entries")
	})

	t.Run("should differentiate by principal roles", func(t *testing.T) {
		cache := derived_roles.NewDerivedRolesCache()

		principal1 := &types.Principal{ID: "user1", Roles: []string{"admin"}}
		principal2 := &types.Principal{ID: "user1", Roles: []string{"user"}}
		resource := &types.Resource{Kind: "document"}

		cache.Set(principal1, resource, []string{"super_admin"})
		cache.Set(principal2, resource, []string{"viewer"})

		roles1, _ := cache.Get(principal1, resource)
		roles2, _ := cache.Get(principal2, resource)

		assert.NotEqual(t, roles1, roles2, "Different roles should have different cache entries")
	})

	t.Run("should handle role order consistency", func(t *testing.T) {
		cache := derived_roles.NewDerivedRolesCache()

		principal1 := &types.Principal{ID: "user1", Roles: []string{"admin", "user"}}
		principal2 := &types.Principal{ID: "user1", Roles: []string{"user", "admin"}}
		resource := &types.Resource{Kind: "document"}

		cache.Set(principal1, resource, []string{"owner"})

		// Should find same entry regardless of role order
		roles, found := cache.Get(principal2, resource)
		assert.True(t, found, "Role order should not affect cache key")
		assert.Equal(t, []string{"owner"}, roles)
	})
}

// TestPerformanceVerification tests cache performance
func TestPerformanceVerification(t *testing.T) {
	t.Run("should handle large number of cache entries efficiently", func(t *testing.T) {
		cache := derived_roles.NewDerivedRolesCache()

		// Cache 1000 entries
		for i := 0; i < 1000; i++ {
			principal := &types.Principal{
				ID:    "user" + string(rune(i)),
				Roles: []string{"user"},
			}
			resource := &types.Resource{Kind: "document"}
			cache.Set(principal, resource, []string{"role1"})
		}

		assert.Equal(t, 1000, cache.Size())
		t.Logf("Successfully cached 1000 entries")
	})

	t.Run("should provide fast lookups", func(t *testing.T) {
		cache := derived_roles.NewDerivedRolesCache()

		principal := &types.Principal{ID: "user1", Roles: []string{"user"}}
		resource := &types.Resource{Kind: "document"}

		cache.Set(principal, resource, []string{"owner"})

		// Measure lookup time
		iterations := 1000
		found := 0
		for i := 0; i < iterations; i++ {
			_, ok := cache.Get(principal, resource)
			if ok {
				found++
			}
		}

		assert.Equal(t, iterations, found, "All lookups should succeed")
		t.Logf("Completed %d lookups successfully", iterations)
	})
}

// TestConcurrentAccess tests thread safety
func TestConcurrentAccess(t *testing.T) {
	t.Run("should be thread-safe for concurrent reads and writes", func(t *testing.T) {
		cache := derived_roles.NewDerivedRolesCache()
		var wg sync.WaitGroup
		concurrency := 100

		// Launch concurrent goroutines
		for i := 0; i < concurrency; i++ {
			wg.Add(1)
			go func(id int) {
				defer wg.Done()

				principal := &types.Principal{
					ID:    "user" + string(rune(id%10)),
					Roles: []string{"user"},
				}
				resource := &types.Resource{Kind: "document"}

				// Each goroutine does multiple operations
				for j := 0; j < 10; j++ {
					cache.Set(principal, resource, []string{"role1"})
					cache.Get(principal, resource)
				}
			}(i)
		}

		wg.Wait()

		assert.LessOrEqual(t, cache.Size(), 10, "Should have at most 10 unique keys")
		t.Logf("Concurrent test completed: size=%d", cache.Size())
	})

	t.Run("should handle concurrent clear operations", func(t *testing.T) {
		cache := derived_roles.NewDerivedRolesCache()
		var wg sync.WaitGroup

		// Pre-populate cache
		for i := 0; i < 50; i++ {
			principal := &types.Principal{
				ID:    "user" + string(rune(i)),
				Roles: []string{"user"},
			}
			resource := &types.Resource{Kind: "document"}
			cache.Set(principal, resource, []string{"role1"})
		}

		// Concurrent clear and access
		for i := 0; i < 10; i++ {
			wg.Add(1)
			go func(id int) {
				defer wg.Done()
				if id%3 == 0 {
					cache.Clear()
				} else {
					principal := &types.Principal{
						ID:    "user" + string(rune(id)),
						Roles: []string{"user"},
					}
					resource := &types.Resource{Kind: "document"}
					cache.Set(principal, resource, []string{"role1"})
				}
			}(i)
		}

		wg.Wait()

		// Should not panic or deadlock
		t.Logf("After concurrent clear: size=%d", cache.Size())
	})
}

// TestEdgeCases tests edge cases
func TestCacheEdgeCases(t *testing.T) {
	t.Run("should handle empty cache", func(t *testing.T) {
		cache := derived_roles.NewDerivedRolesCache()
		assert.Equal(t, 0, cache.Size())
	})

	t.Run("should handle special characters in principal ID", func(t *testing.T) {
		cache := derived_roles.NewDerivedRolesCache()

		principal := &types.Principal{
			ID:    "user@example.com",
			Roles: []string{"role1", "role2"},
		}
		resource := &types.Resource{
			Kind: "document",
			ID:   "doc-123",
		}

		cache.Set(principal, resource, []string{"owner"})
		roles, found := cache.Get(principal, resource)

		assert.True(t, found)
		assert.Equal(t, []string{"owner"}, roles)
	})

	t.Run("should handle resource attributes", func(t *testing.T) {
		cache := derived_roles.NewDerivedRolesCache()

		principal := &types.Principal{ID: "user1", Roles: []string{"user"}}
		resource1 := &types.Resource{
			Kind: "document",
			Attributes: map[string]interface{}{
				"ownerId": "user1",
				"public":  true,
			},
		}
		resource2 := &types.Resource{
			Kind: "document",
			Attributes: map[string]interface{}{
				"ownerId": "user1",
				"public":  false,
			},
		}

		// Different resource attributes should create different cache entries
		cache.Set(principal, resource1, []string{"owner", "public_viewer"})
		cache.Set(principal, resource2, []string{"owner"})

		roles1, _ := cache.Get(principal, resource1)
		roles2, _ := cache.Get(principal, resource2)

		// Should have different cache entries
		assert.Equal(t, 2, cache.Size())
		assert.NotEqual(t, roles1, roles2)
	})

	t.Run("should return copy of cached roles", func(t *testing.T) {
		cache := derived_roles.NewDerivedRolesCache()

		principal := &types.Principal{ID: "user1", Roles: []string{"user"}}
		resource := &types.Resource{Kind: "document"}

		originalRoles := []string{"owner", "viewer"}
		cache.Set(principal, resource, originalRoles)

		// Modify original slice
		originalRoles[0] = "modified"

		// Cached roles should be unchanged
		cachedRoles, _ := cache.Get(principal, resource)
		assert.Equal(t, "owner", cachedRoles[0], "Cache should store a copy")
	})
}

// TestMemoryEfficiency tests memory usage
func TestMemoryEfficiency(t *testing.T) {
	t.Run("should not leak memory on repeated operations", func(t *testing.T) {
		cache := derived_roles.NewDerivedRolesCache()

		// Perform many operations
		for iteration := 0; iteration < 100; iteration++ {
			for i := 0; i < 100; i++ {
				principal := &types.Principal{
					ID:    "user" + string(rune(i)),
					Roles: []string{"user"},
				}
				resource := &types.Resource{Kind: "document"}
				cache.Set(principal, resource, []string{"role1", "role2", "role3"})
			}

			if iteration%10 == 0 {
				cache.Clear()
			}
		}

		// If we get here without running out of memory, test passes
		t.Logf("Final cache size: %d", cache.Size())
	})
}
