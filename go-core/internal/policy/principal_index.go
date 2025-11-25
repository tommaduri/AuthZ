package policy

import (
	"sync"

	"github.com/authz-engine/go-core/pkg/types"
)

// PrincipalIndex provides O(1) principal policy lookup
type PrincipalIndex struct {
	// principalID -> resourceKind -> policies
	byPrincipal map[string]map[string][]*types.Policy

	// role -> resourceKind -> policies
	byRole map[string]map[string][]*types.Policy

	mu sync.RWMutex
}

// NewPrincipalIndex creates a new principal index
func NewPrincipalIndex() *PrincipalIndex {
	return &PrincipalIndex{
		byPrincipal: make(map[string]map[string][]*types.Policy),
		byRole:      make(map[string]map[string][]*types.Policy),
	}
}

// Add adds a principal policy to the index
func (i *PrincipalIndex) Add(policy *types.Policy) {
	i.mu.Lock()
	defer i.mu.Unlock()

	// Only index principal policies
	if !policy.PrincipalPolicy || policy.Principal == nil {
		return
	}

	// Index by principal ID if specified
	if policy.Principal.ID != "" {
		// For each resource selector in the policy
		for _, res := range policy.Resources {
			// Initialize maps if needed
			if i.byPrincipal[policy.Principal.ID] == nil {
				i.byPrincipal[policy.Principal.ID] = make(map[string][]*types.Policy)
			}

			// Add policy to principal + resource kind index
			i.byPrincipal[policy.Principal.ID][res.Kind] = append(
				i.byPrincipal[policy.Principal.ID][res.Kind],
				policy,
			)

			// Also index wildcard * kind
			if res.Kind == "*" {
				// This policy applies to ALL resource kinds for this principal
				// We'll handle this in FindByPrincipal by checking for "*" key
			}
		}
	}

	// Index by roles if specified
	if len(policy.Principal.Roles) > 0 {
		for _, role := range policy.Principal.Roles {
			// For each resource selector in the policy
			for _, res := range policy.Resources {
				// Initialize maps if needed
				if i.byRole[role] == nil {
					i.byRole[role] = make(map[string][]*types.Policy)
				}

				// Add policy to role + resource kind index
				i.byRole[role][res.Kind] = append(
					i.byRole[role][res.Kind],
					policy,
				)
			}
		}
	}
}

// Remove removes a principal policy from the index
func (i *PrincipalIndex) Remove(policy *types.Policy) {
	i.mu.Lock()
	defer i.mu.Unlock()

	if !policy.PrincipalPolicy || policy.Principal == nil {
		return
	}

	// Remove from principal ID index
	if policy.Principal.ID != "" {
		if kindMap, ok := i.byPrincipal[policy.Principal.ID]; ok {
			for _, res := range policy.Resources {
				policies := kindMap[res.Kind]
				for j, p := range policies {
					if p.Name == policy.Name {
						kindMap[res.Kind] = append(policies[:j], policies[j+1:]...)
						break
					}
				}

				// Clean up empty maps
				if len(kindMap[res.Kind]) == 0 {
					delete(kindMap, res.Kind)
				}
			}

			if len(kindMap) == 0 {
				delete(i.byPrincipal, policy.Principal.ID)
			}
		}
	}

	// Remove from role index
	if len(policy.Principal.Roles) > 0 {
		for _, role := range policy.Principal.Roles {
			if kindMap, ok := i.byRole[role]; ok {
				for _, res := range policy.Resources {
					policies := kindMap[res.Kind]
					for j, p := range policies {
						if p.Name == policy.Name {
							kindMap[res.Kind] = append(policies[:j], policies[j+1:]...)
							break
						}
					}

					// Clean up empty maps
					if len(kindMap[res.Kind]) == 0 {
						delete(kindMap, res.Kind)
					}
				}

				if len(kindMap) == 0 {
					delete(i.byRole, role)
				}
			}
		}
	}
}

// FindByPrincipal finds principal-specific policies for a principal ID and resource kind
func (i *PrincipalIndex) FindByPrincipal(principalID, resourceKind string) []*types.Policy {
	i.mu.RLock()
	defer i.mu.RUnlock()

	var result []*types.Policy

	if kindMap, ok := i.byPrincipal[principalID]; ok {
		// Find policies for this specific resource kind
		if policies := kindMap[resourceKind]; len(policies) > 0 {
			result = append(result, policies...)
		}

		// Also include wildcard * policies (apply to all resource kinds)
		if policies := kindMap["*"]; len(policies) > 0 {
			result = append(result, policies...)
		}
	}

	// Return copy to avoid race conditions
	if len(result) > 0 {
		copied := make([]*types.Policy, len(result))
		copy(copied, result)
		return copied
	}

	return nil
}

// FindByRoles finds role-based principal policies for a set of roles and resource kind
func (i *PrincipalIndex) FindByRoles(roles []string, resourceKind string) []*types.Policy {
	i.mu.RLock()
	defer i.mu.RUnlock()

	var result []*types.Policy
	seen := make(map[string]bool) // Deduplicate policies

	for _, role := range roles {
		if kindMap, ok := i.byRole[role]; ok {
			// Find policies for this specific resource kind
			if policies := kindMap[resourceKind]; len(policies) > 0 {
				for _, p := range policies {
					if !seen[p.Name] {
						result = append(result, p)
						seen[p.Name] = true
					}
				}
			}

			// Also include wildcard * policies (apply to all resource kinds)
			if policies := kindMap["*"]; len(policies) > 0 {
				for _, p := range policies {
					if !seen[p.Name] {
						result = append(result, p)
						seen[p.Name] = true
					}
				}
			}
		}
	}

	// Return copy to avoid race conditions
	if len(result) > 0 {
		copied := make([]*types.Policy, len(result))
		copy(copied, result)
		return copied
	}

	return nil
}

// Clear removes all entries
func (i *PrincipalIndex) Clear() {
	i.mu.Lock()
	defer i.mu.Unlock()

	i.byPrincipal = make(map[string]map[string][]*types.Policy)
	i.byRole = make(map[string]map[string][]*types.Policy)
}
