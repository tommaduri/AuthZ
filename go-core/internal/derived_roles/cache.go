// Package derived_roles provides derived role resolution with dependency ordering
package derived_roles

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/authz-engine/go-core/pkg/types"
)

// DerivedRolesCache provides thread-safe caching for derived role resolution results
// Cache keys are generated from principal ID, base roles, and resource attributes
// to ensure cache correctness across different evaluation contexts
type DerivedRolesCache struct {
	mu    sync.RWMutex
	cache map[string][]string // key -> resolved roles
}

// NewDerivedRolesCache creates a new thread-safe derived roles cache
func NewDerivedRolesCache() *DerivedRolesCache {
	return &DerivedRolesCache{
		cache: make(map[string][]string),
	}
}

// Get retrieves cached derived roles for a principal and resource
// Returns (roles, true) if found in cache, (nil, false) otherwise
func (c *DerivedRolesCache) Get(principal *types.Principal, resource *types.Resource) ([]string, bool) {
	if principal == nil {
		return nil, false
	}

	key := c.generateCacheKey(principal, resource)

	c.mu.RLock()
	defer c.mu.RUnlock()

	roles, found := c.cache[key]
	return roles, found
}

// Set stores resolved derived roles in the cache
// Cache key is generated from principal and resource to ensure correctness
func (c *DerivedRolesCache) Set(principal *types.Principal, resource *types.Resource, roles []string) {
	if principal == nil {
		return
	}

	key := c.generateCacheKey(principal, resource)

	c.mu.Lock()
	defer c.mu.Unlock()

	// Store a copy to prevent external modifications
	rolesCopy := make([]string, len(roles))
	copy(rolesCopy, roles)

	c.cache[key] = rolesCopy
}

// Clear removes all entries from the cache
// Useful for testing and cache invalidation scenarios
func (c *DerivedRolesCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.cache = make(map[string][]string)
}

// Size returns the current number of cached entries
func (c *DerivedRolesCache) Size() int {
	c.mu.RLock()
	defer c.mu.RUnlock()

	return len(c.cache)
}

// generateCacheKey creates a deterministic cache key from principal and resource
// Key format: SHA256(principalID:scope:roles:resourceKind:resourceID:resourceScope)
// Roles are sorted to ensure consistent keys regardless of role order
func (c *DerivedRolesCache) generateCacheKey(principal *types.Principal, resource *types.Resource) string {
	// Sort roles for deterministic key generation
	roles := make([]string, len(principal.Roles))
	copy(roles, principal.Roles)
	sort.Strings(roles)

	// Build key components
	keyParts := []string{
		principal.ID,
		principal.Scope,
		strings.Join(roles, ","),
	}

	// Include resource attributes if present
	if resource != nil {
		keyParts = append(keyParts,
			resource.Kind,
			resource.ID,
			resource.Scope,
		)

		// Include relevant resource attributes that might affect derived role resolution
		// Sort attribute keys for deterministic hashing
		if len(resource.Attributes) > 0 {
			attrKeys := make([]string, 0, len(resource.Attributes))
			for k := range resource.Attributes {
				attrKeys = append(attrKeys, k)
			}
			sort.Strings(attrKeys)

			attrParts := make([]string, 0, len(attrKeys))
			for _, k := range attrKeys {
				attrParts = append(attrParts, fmt.Sprintf("%s=%v", k, resource.Attributes[k]))
			}
			keyParts = append(keyParts, strings.Join(attrParts, "&"))
		}
	}

	// Generate SHA256 hash for compact cache key
	keyString := strings.Join(keyParts, ":")
	hash := sha256.Sum256([]byte(keyString))
	return hex.EncodeToString(hash[:])
}
