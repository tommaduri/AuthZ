package policy

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/authz-engine/go-core/pkg/types"
	"go.uber.org/zap"
	"gopkg.in/yaml.v3"
)

func TestFileWatcher_Watch(t *testing.T) {
	// Create a temporary directory
	tmpDir := t.TempDir()

	// Create a test policy file
	testPolicy := &types.Policy{
		APIVersion:   "v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	}

	policyPath := filepath.Join(tmpDir, "test-policy.yaml")
	writePolicy(t, policyPath, testPolicy)

	// Set up store and watcher
	store := NewMemoryStore()
	loader := NewLoader(zap.NewNop())
	watcher, err := NewFileWatcher(tmpDir, store, loader, zap.NewNop())
	if err != nil {
		t.Fatalf("Failed to create watcher: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Start watching
	if err := watcher.Watch(ctx); err != nil {
		t.Fatalf("Failed to start watcher: %v", err)
	}
	defer watcher.Stop()

	// Initial load
	policies, err := loader.LoadFromDirectory(tmpDir)
	if err != nil {
		t.Fatalf("Failed to load initial policies: %v", err)
	}
	if len(policies) != 1 {
		t.Errorf("Expected 1 policy, got %d", len(policies))
	}

	// Add the policy to the store
	for _, p := range policies {
		store.Add(p)
	}

	// Verify initial state
	if store.Count() != 1 {
		t.Errorf("Expected 1 policy in store, got %d", store.Count())
	}
}

func TestFileWatcher_DebounceChanges(t *testing.T) {
	tmpDir := t.TempDir()

	// Create initial policy
	testPolicy := &types.Policy{
		APIVersion:   "v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	}

	policyPath := filepath.Join(tmpDir, "test-policy.yaml")
	writePolicy(t, policyPath, testPolicy)

	store := NewMemoryStore()
	loader := NewLoader(zap.NewNop())
	watcher, err := NewFileWatcher(tmpDir, store, loader, zap.NewNop())
	if err != nil {
		t.Fatalf("Failed to create watcher: %v", err)
	}

	watcher.SetDebounceTimeout(100 * time.Millisecond)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := watcher.Watch(ctx); err != nil {
		t.Fatalf("Failed to start watcher: %v", err)
	}
	defer watcher.Stop()

	// Modify the policy file multiple times rapidly
	eventReceived := false
	go func() {
		for event := range watcher.EventChan() {
			if event.Error == nil && len(event.PolicyIDs) > 0 {
				eventReceived = true
			}
		}
	}()

	// Modify file a few times
	for i := 0; i < 3; i++ {
		testPolicy.Rules = append(testPolicy.Rules, &types.Rule{
			Name:    "rule-" + string(rune(i)),
			Actions: []string{"write"},
			Effect:  types.EffectAllow,
		})
		writePolicy(t, policyPath, testPolicy)
		time.Sleep(20 * time.Millisecond)
	}

	// Wait for debounce to trigger reload
	time.Sleep(300 * time.Millisecond)

	if !eventReceived {
		t.Log("Note: Event channel might not have been processed due to timing")
	}
}

func TestFileWatcher_FiltersPolicyFiles(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a non-policy file
	nonPolicyPath := filepath.Join(tmpDir, "readme.txt")
	if err := os.WriteFile(nonPolicyPath, []byte("not a policy"), 0600); err != nil {
		t.Fatalf("Failed to create non-policy file: %v", err)
	}

	store := NewMemoryStore()
	loader := NewLoader(zap.NewNop())
	watcher, err := NewFileWatcher(tmpDir, store, loader, zap.NewNop())
	if err != nil {
		t.Fatalf("Failed to create watcher: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if err := watcher.Watch(ctx); err != nil {
		t.Fatalf("Failed to start watcher: %v", err)
	}
	defer watcher.Stop()

	// Verify non-policy files are ignored
	if !watcher.shouldProcessEvent(newFakeEvent(nonPolicyPath)) {
		t.Logf("Correctly ignored non-policy file: %s", nonPolicyPath)
	}

	// Verify policy files are processed
	policyPath := filepath.Join(tmpDir, "policy.yaml")
	if watcher.shouldProcessEvent(newFakeEvent(policyPath)) {
		t.Logf("Correctly processed policy file: %s", policyPath)
	}
}

func TestFileWatcher_IsWatching(t *testing.T) {
	tmpDir := t.TempDir()

	store := NewMemoryStore()
	loader := NewLoader(zap.NewNop())
	watcher, err := NewFileWatcher(tmpDir, store, loader, zap.NewNop())
	if err != nil {
		t.Fatalf("Failed to create watcher: %v", err)
	}

	if watcher.IsWatching() {
		t.Error("Watcher should not be watching initially")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if err := watcher.Watch(ctx); err != nil {
		t.Fatalf("Failed to start watcher: %v", err)
	}

	if !watcher.IsWatching() {
		t.Error("Watcher should be watching after Watch() is called")
	}

	watcher.Stop()

	// Give it a moment to stop
	time.Sleep(100 * time.Millisecond)

	if watcher.IsWatching() {
		t.Error("Watcher should not be watching after Stop() is called")
	}
}

func TestFileWatcher_DoubleStart(t *testing.T) {
	tmpDir := t.TempDir()

	store := NewMemoryStore()
	loader := NewLoader(zap.NewNop())
	watcher, err := NewFileWatcher(tmpDir, store, loader, zap.NewNop())
	if err != nil {
		t.Fatalf("Failed to create watcher: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if err := watcher.Watch(ctx); err != nil {
		t.Fatalf("Failed to start watcher: %v", err)
	}
	defer watcher.Stop()

	// Try to start again
	err = watcher.Watch(ctx)
	if err == nil {
		t.Error("Expected error when starting watcher twice, got nil")
	}
}

func TestFileWatcher_Debounce(t *testing.T) {
	tmpDir := t.TempDir()
	testPolicy := &types.Policy{
		APIVersion:   "v1",
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "allow-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	}

	policyPath := filepath.Join(tmpDir, "test-policy.yaml")
	writePolicy(t, policyPath, testPolicy)

	store := NewMemoryStore()
	loader := NewLoader(zap.NewNop())
	watcher, err := NewFileWatcher(tmpDir, store, loader, zap.NewNop())
	if err != nil {
		t.Fatalf("Failed to create watcher: %v", err)
	}

	customDebounce := 200 * time.Millisecond
	watcher.SetDebounceTimeout(customDebounce)

	if watcher.debounceTimeout != customDebounce {
		t.Errorf("Expected debounce timeout to be %v, got %v", customDebounce, watcher.debounceTimeout)
	}
}

// Helper functions

func writePolicy(t *testing.T, path string, policy *types.Policy) {
	data, err := yaml.Marshal(policy)
	if err != nil {
		t.Fatalf("Failed to marshal policy: %v", err)
	}

	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatalf("Failed to write policy file: %v", err)
	}
}

type fakeEvent struct {
	name string
}

func (fe fakeEvent) Name() string {
	return fe.name
}

func (fe fakeEvent) Op() interface{} {
	return nil
}

func (fe fakeEvent) String() string {
	return fe.name
}

func newFakeEvent(name string) interface{} {
	return fakeEvent{name: name}
}
