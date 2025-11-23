package policy

import (
	"fmt"
	"sync"

	"github.com/authz-engine/go-core/pkg/types"
)

// MemoryStore implements an in-memory policy store
type MemoryStore struct {
	policies map[string]*types.Policy
	index    *Index
	mu       sync.RWMutex
}

// NewMemoryStore creates a new in-memory policy store
func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		policies: make(map[string]*types.Policy),
		index:    NewIndex(),
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

	s.policies[policy.Name] = policy
	s.index.Add(policy)
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
	return nil
}

// Clear removes all policies
func (s *MemoryStore) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.policies = make(map[string]*types.Policy)
	s.index = NewIndex()
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
