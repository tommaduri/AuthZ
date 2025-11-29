package backends

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewMemoryBackend(t *testing.T) {
	backend := NewMemoryBackend()

	assert.NotNil(t, backend)
	assert.NotNil(t, backend.Metadata)
	assert.NotNil(t, backend.Vectors)
	assert.Equal(t, uint64(1), backend.nextKey)
}

func TestMemoryBackend_Insert(t *testing.T) {
	backend := NewMemoryBackend()

	vec := []float32{1.0, 2.0, 3.0}
	metadata := map[string]interface{}{"label": "test"}

	key, err := backend.Insert("vec-1", vec, metadata)
	require.NoError(t, err)
	assert.Equal(t, uint64(1), key)

	// Verify count
	assert.Equal(t, int64(1), backend.Count())

	// Insert another
	key2, err := backend.Insert("vec-2", vec, metadata)
	require.NoError(t, err)
	assert.Equal(t, uint64(2), key2)
	assert.Equal(t, int64(2), backend.Count())
}

func TestMemoryBackend_Get(t *testing.T) {
	backend := NewMemoryBackend()

	vec := []float32{1.0, 2.0, 3.0}
	metadata := map[string]interface{}{"label": "test"}

	_, err := backend.Insert("vec-1", vec, metadata)
	require.NoError(t, err)

	// Get by ID
	result, err := backend.Get("vec-1")
	require.NoError(t, err)
	assert.Equal(t, "vec-1", result.ID)
	assert.Equal(t, vec, result.Vector)
	assert.Equal(t, "test", result.Metadata["label"])

	// Get non-existent
	_, err = backend.Get("non-existent")
	assert.Error(t, err)
}

func TestMemoryBackend_Delete(t *testing.T) {
	backend := NewMemoryBackend()

	vec := []float32{1.0, 2.0, 3.0}
	metadata := map[string]interface{}{"label": "test"}

	_, err := backend.Insert("vec-1", vec, metadata)
	require.NoError(t, err)
	assert.Equal(t, int64(1), backend.Count())

	// Delete
	err = backend.Delete("vec-1")
	require.NoError(t, err)
	assert.Equal(t, int64(0), backend.Count())

	// Delete non-existent
	err = backend.Delete("non-existent")
	assert.Error(t, err)
}

func TestMemoryBackend_GetByKey(t *testing.T) {
	backend := NewMemoryBackend()

	vec := []float32{1.0, 2.0, 3.0}
	metadata := map[string]interface{}{"label": "test"}

	key, err := backend.Insert("vec-1", vec, metadata)
	require.NoError(t, err)

	// Get by key
	id, exists := backend.GetByKey(key)
	assert.True(t, exists)
	assert.Equal(t, "vec-1", id)

	// Get non-existent key
	_, exists = backend.GetByKey(999)
	assert.False(t, exists)
}

func TestMemoryBackend_GetKey(t *testing.T) {
	backend := NewMemoryBackend()

	vec := []float32{1.0, 2.0, 3.0}
	metadata := map[string]interface{}{"label": "test"}

	expectedKey, err := backend.Insert("vec-1", vec, metadata)
	require.NoError(t, err)

	// Get key by ID
	key, exists := backend.GetKey("vec-1")
	assert.True(t, exists)
	assert.Equal(t, expectedKey, key)

	// Get non-existent ID
	_, exists = backend.GetKey("non-existent")
	assert.False(t, exists)
}

func TestMemoryBackend_MemoryUsage(t *testing.T) {
	backend := NewMemoryBackend()

	// Empty backend
	assert.Equal(t, int64(0), backend.MemoryUsage(384))

	// Add vector
	vec := make([]float32, 384)
	metadata := map[string]interface{}{"label": "test"}

	_, err := backend.Insert("vec-1", vec, metadata)
	require.NoError(t, err)

	// Memory usage should be > 0
	usage := backend.MemoryUsage(384)
	assert.Greater(t, usage, int64(0))

	// Expected: 1 × 384 × 4 + 200 + 100 = 1536 + 300 = 1836 bytes
	expectedMin := int64(1536) // Vector data only
	assert.GreaterOrEqual(t, usage, expectedMin)
}

func TestMemoryBackend_UpdateExisting(t *testing.T) {
	backend := NewMemoryBackend()

	vec1 := []float32{1.0, 2.0, 3.0}
	metadata1 := map[string]interface{}{"version": 1}

	key1, err := backend.Insert("vec-1", vec1, metadata1)
	require.NoError(t, err)

	// Update same ID
	vec2 := []float32{4.0, 5.0, 6.0}
	metadata2 := map[string]interface{}{"version": 2}

	key2, err := backend.Insert("vec-1", vec2, metadata2)
	require.NoError(t, err)

	// Should reuse same key
	assert.Equal(t, key1, key2)

	// Verify updated data
	result, err := backend.Get("vec-1")
	require.NoError(t, err)
	assert.Equal(t, vec2, result.Vector)
	assert.Equal(t, 2, result.Metadata["version"])
}

func TestMemoryBackend_Concurrent(t *testing.T) {
	backend := NewMemoryBackend()

	// Concurrent inserts
	done := make(chan bool)
	for i := 0; i < 100; i++ {
		go func(idx int) {
			vec := []float32{float32(idx), float32(idx + 1), float32(idx + 2)}
			metadata := map[string]interface{}{"index": idx}
			_, _ = backend.Insert(string(rune(idx)), vec, metadata)
			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 100; i++ {
		<-done
	}

	// Verify count (should be 100 unique inserts)
	assert.Equal(t, int64(100), backend.Count())
}
