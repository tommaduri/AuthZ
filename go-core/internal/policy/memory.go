package policy

import (
	"fmt"
	"sync"

	"github.com/authz-engine/go-core/pkg/types"
)

// MemoryStore implements an in-memory policy store
type MemoryStore struct {
	policies       map[string]*types.Policy
	index          *Index
	scopeIndex     *ScopeIndex
	principalIndex *PrincipalIndex // Phase 3: Principal policy index
	mu             sync.RWMutex
}

// NewMemoryStore creates a new in-memory policy store
func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		policies:       make(map[string]*types.Policy),
		index:          NewIndex(),
		scopeIndex:     NewScopeIndex(),
		principalIndex: NewPrincipalIndex(), // Phase 3
	}
}

// Get retrieves a policy by name
func (s *MemoryStore) Get(name string) (*types.Policy, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	policy, ok := s.policies[name]
	if !ok {
		return nil, fmt.Errorf("policy not found: %s", name)
	}
	return policy, nil
}

// GetAll retrieves all policies
func (s *MemoryStore) GetAll() []*types.Policy {
	s.mu.RLock()
	defer s.mu.RUnlock()

	policies := make([]*types.Policy, 0, len(s.policies))
	for _, p := range s.policies {
		policies = append(policies, p)
	}
	return policies
}

// FindPolicies finds policies matching resource kind and actions
func (s *MemoryStore) FindPolicies(resourceKind string, actions []string) []*types.Policy {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.index.FindByResource(resourceKind)
}

// Add adds a policy to the store
func (s *MemoryStore) Add(policy *types.Policy) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if policy.Name == "" {
		return fmt.Errorf("policy name is required")
	}

	// Validate principal policies (Phase 3)
	if policy.PrincipalPolicy {
		if policy.Principal == nil {
			return fmt.Errorf("principal policy requires principal selector")
		}
		if policy.Principal.ID == "" && len(policy.Principal.Roles) == 0 {
			return fmt.Errorf("principal policy requires either principal.id or principal.roles")
		}
		if len(policy.Resources) == 0 {
			return fmt.Errorf("principal policy requires at least one resource selector")
		}
		// Validate each resource selector has a kind
		for i, res := range policy.Resources {
			if res.Kind == "" {
				return fmt.Errorf("principal policy resource[%d] requires kind", i)
			}
		}
	}

	s.policies[policy.Name] = policy
	s.index.Add(policy)
	s.scopeIndex.Add(policy)
	s.principalIndex.Add(policy) // Phase 3
	return nil
}

// Remove removes a policy from the store
func (s *MemoryStore) Remove(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	policy, ok := s.policies[name]
	if !ok {
		return fmt.Errorf("policy not found: %s", name)
	}

	delete(s.policies, name)
	s.index.Remove(policy)
	s.scopeIndex.Remove(policy)
	s.principalIndex.Remove(policy) // Phase 3
	return nil
}

// Clear removes all policies
func (s *MemoryStore) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.policies = make(map[string]*types.Policy)
	s.index = NewIndex()
	s.scopeIndex = NewScopeIndex()
	s.principalIndex = NewPrincipalIndex() // Phase 3
}

// Count returns the number of policies
func (s *MemoryStore) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return len(s.policies)
}

// Load loads policies from a source (not implemented for memory store)
func (s *MemoryStore) Load(source string) error {
	return fmt.Errorf("memory store does not support loading from source")
}

// Reload reloads all policies (no-op for memory store)
func (s *MemoryStore) Reload() error {
	return nil
}

// Index provides fast policy lookup by resource kind
type Index struct {
	byResource map[string][]*types.Policy
	mu         sync.RWMutex
}

// NewIndex creates a new policy index
func NewIndex() *Index {
	return &Index{
		byResource: make(map[string][]*types.Policy),
	}
}

// Add adds a policy to the index
func (i *Index) Add(policy *types.Policy) {
	i.mu.Lock()
	defer i.mu.Unlock()

	i.byResource[policy.ResourceKind] = append(i.byResource[policy.ResourceKind], policy)
}

// Remove removes a policy from the index
func (i *Index) Remove(policy *types.Policy) {
	i.mu.Lock()
	defer i.mu.Unlock()

	policies := i.byResource[policy.ResourceKind]
	for j, p := range policies {
		if p.Name == policy.Name {
			i.byResource[policy.ResourceKind] = append(policies[:j], policies[j+1:]...)
			break
		}
	}
}

// FindByResource finds policies for a resource kind
func (i *Index) FindByResource(kind string) []*types.Policy {
	i.mu.RLock()
	defer i.mu.RUnlock()

	// Return copy to avoid race conditions
	policies := i.byResource[kind]
	result := make([]*types.Policy, len(policies))
	copy(result, policies)
	return result
}

// FindPoliciesForScope finds policies for a specific scope and resource kind
func (s *MemoryStore) FindPoliciesForScope(scope, resourceKind string, actions []string) []*types.Policy {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.scopeIndex.FindByScope(scope, resourceKind)
}

// ScopeIndex provides fast policy lookup by scope and resource kind
type ScopeIndex struct {
	// scope -> resourceKind -> policies
	byScope map[string]map[string][]*types.Policy
	mu      sync.RWMutex
}

// NewScopeIndex creates a new scope index
func NewScopeIndex() *ScopeIndex {
	return &ScopeIndex{
		byScope: make(map[string]map[string][]*types.Policy),
	}
}

// Add adds a policy to the scope index
func (i *ScopeIndex) Add(policy *types.Policy) {
	i.mu.Lock()
	defer i.mu.Unlock()

	// Only index scoped policies
	if policy.Scope == "" {
		return
	}

	// Initialize scope map if needed
	if i.byScope[policy.Scope] == nil {
		i.byScope[policy.Scope] = make(map[string][]*types.Policy)
	}

	// Add to scope and resource kind index
	i.byScope[policy.Scope][policy.ResourceKind] = append(
		i.byScope[policy.Scope][policy.ResourceKind],
		policy,
	)
}

// Remove removes a policy from the scope index
func (i *ScopeIndex) Remove(policy *types.Policy) {
	i.mu.Lock()
	defer i.mu.Unlock()

	if policy.Scope == "" {
		return
	}

	if kindMap, ok := i.byScope[policy.Scope]; ok {
		policies := kindMap[policy.ResourceKind]
		for j, p := range policies {
			if p.Name == policy.Name {
				kindMap[policy.ResourceKind] = append(policies[:j], policies[j+1:]...)
				break
			}
		}

		// Clean up empty maps
		if len(kindMap[policy.ResourceKind]) == 0 {
			delete(kindMap, policy.ResourceKind)
		}
		if len(kindMap) == 0 {
			delete(i.byScope, policy.Scope)
		}
	}
}

// FindByScope finds policies for a specific scope and resource kind
func (i *ScopeIndex) FindByScope(scope, resourceKind string) []*types.Policy {
	i.mu.RLock()
	defer i.mu.RUnlock()

	if kindMap, ok := i.byScope[scope]; ok {
		policies := kindMap[resourceKind]
		// Return copy to avoid race conditions
		result := make([]*types.Policy, len(policies))
		copy(result, policies)
		return result
	}

	return nil
}

// Phase 3: Principal policy methods

// FindPoliciesByPrincipal finds principal-specific policies for a principal ID and resource kind
func (s *MemoryStore) FindPoliciesByPrincipal(principalID, resourceKind string) []*types.Policy {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.principalIndex.FindByPrincipal(principalID, resourceKind)
}

// FindPoliciesByRoles finds role-based principal policies for a set of roles and resource kind
func (s *MemoryStore) FindPoliciesByRoles(roles []string, resourceKind string) []*types.Policy {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return s.principalIndex.FindByRoles(roles, resourceKind)
}
