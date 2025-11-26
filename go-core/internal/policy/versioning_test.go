package policy

import (
	"testing"

	"github.com/authz-engine/go-core/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Simple test to validate the versioning implementation works
func TestVersionStore_Simple(t *testing.T) {
	store := NewVersionStore(10)

	t.Run("save and retrieve version", func(t *testing.T) {
		policies := map[string]*types.Policy{
			"policy-1": {
				Name:         "TestPolicy",
				ResourceKind: "document",
			},
		}

		// Save version
		v1, err := store.SaveVersion(policies, "Initial version")
		require.NoError(t, err)
		assert.Equal(t, int64(1), v1.Version)
		assert.Equal(t, "Initial version", v1.Comment)

		// Retrieve version
		retrieved, err := store.GetVersion(1)
		require.NoError(t, err)
		assert.Equal(t, v1.Version, retrieved.Version)
		assert.Equal(t, "TestPolicy", retrieved.Policies["policy-1"].Name)
	})

	t.Run("LRU eviction", func(t *testing.T) {
		store2 := NewVersionStore(3) // Max 3 versions

		// Add 5 versions with different content
		for i := 1; i <= 5; i++ {
			policies := map[string]*types.Policy{
				"policy-1": {
					Name:         "Test",
					ResourceKind: "doc",
					Scope:        string(rune(i)), // Make each version unique
				},
			}
			_, err := store2.SaveVersion(policies, "Version")
			require.NoError(t, err)
		}

		// Should only keep 3 most recent (3, 4, 5)
		assert.Equal(t, 3, store2.GetVersionCount())

		// Version 1 and 2 should be evicted
		_, err := store2.GetVersion(1)
		assert.Error(t, err)

		// Version 5 should exist
		v5, err := store2.GetVersion(5)
		require.NoError(t, err)
		assert.Equal(t, int64(5), v5.Version)
	})

	t.Run("duplicate detection", func(t *testing.T) {
		store3 := NewVersionStore(10)

		policies := map[string]*types.Policy{
			"policy-1": {Name: "Same", ResourceKind: "doc"},
		}

		// First save
		v1, err := store3.SaveVersion(policies, "First")
		require.NoError(t, err)
		assert.Equal(t, int64(1), v1.Version)

		// Second save with same policies (should return existing)
		v2, err := store3.SaveVersion(policies, "Duplicate")
		require.NoError(t, err)
		assert.Equal(t, int64(1), v2.Version) // Same version
		assert.Equal(t, 1, store3.GetVersionCount()) // Only 1 version
	})
}
