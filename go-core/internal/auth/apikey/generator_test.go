package apikey

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerator_Generate(t *testing.T) {
	gen := NewGenerator()

	t.Run("generates valid API key", func(t *testing.T) {
		plainKey, keyHash, err := gen.Generate()
		require.NoError(t, err)
		assert.NotEmpty(t, plainKey)
		assert.NotEmpty(t, keyHash)

		// Check format
		assert.True(t, strings.HasPrefix(plainKey, "ak_live_"))

		// Check hash length (SHA-256 = 64 hex chars)
		assert.Len(t, keyHash, 64)
	})

	t.Run("generates unique keys", func(t *testing.T) {
		key1, hash1, err1 := gen.Generate()
		key2, hash2, err2 := gen.Generate()

		require.NoError(t, err1)
		require.NoError(t, err2)

		// Keys should be different
		assert.NotEqual(t, key1, key2)
		assert.NotEqual(t, hash1, hash2)
	})

	t.Run("hash is deterministic", func(t *testing.T) {
		plainKey, originalHash, err := gen.Generate()
		require.NoError(t, err)

		// Hashing the same key should produce the same hash
		newHash := gen.Hash(plainKey)
		assert.Equal(t, originalHash, newHash)
	})
}

func TestGenerator_Hash(t *testing.T) {
	gen := NewGenerator()

	t.Run("consistent hashing", func(t *testing.T) {
		plainKey := "ak_live_test12345678901234567890123456"
		hash1 := gen.Hash(plainKey)
		hash2 := gen.Hash(plainKey)

		assert.Equal(t, hash1, hash2)
		assert.Len(t, hash1, 64) // SHA-256 hex length
	})

	t.Run("different keys produce different hashes", func(t *testing.T) {
		key1 := "ak_live_test1"
		key2 := "ak_live_test2"

		hash1 := gen.Hash(key1)
		hash2 := gen.Hash(key2)

		assert.NotEqual(t, hash1, hash2)
	})
}

func TestGenerator_ValidateFormat(t *testing.T) {
	gen := NewGenerator()

	t.Run("valid generated key", func(t *testing.T) {
		plainKey, _, err := gen.Generate()
		require.NoError(t, err)

		err = gen.ValidateFormat(plainKey)
		assert.NoError(t, err)
	})

	t.Run("invalid prefix", func(t *testing.T) {
		err := gen.ValidateFormat("invalid_live_abc123")
		assert.ErrorIs(t, err, ErrInvalidAPIKey)
		assert.Contains(t, err.Error(), "invalid prefix")
	})

	t.Run("invalid environment", func(t *testing.T) {
		err := gen.ValidateFormat("ak_prod_abc123")
		assert.ErrorIs(t, err, ErrInvalidAPIKey)
		assert.Contains(t, err.Error(), "invalid environment")
	})

	t.Run("missing parts", func(t *testing.T) {
		err := gen.ValidateFormat("ak_live")
		assert.ErrorIs(t, err, ErrInvalidAPIKey)
		assert.Contains(t, err.Error(), "expected format")
	})

	t.Run("invalid base64", func(t *testing.T) {
		err := gen.ValidateFormat("ak_live_invalid!!!")
		assert.ErrorIs(t, err, ErrInvalidAPIKey)
		assert.Contains(t, err.Error(), "invalid base64")
	})

	t.Run("test environment accepted", func(t *testing.T) {
		// Generate a valid test key
		plainKey, _, err := gen.Generate()
		require.NoError(t, err)

		testKey := strings.Replace(plainKey, "live", "test", 1)
		err = gen.ValidateFormat(testKey)
		assert.NoError(t, err)
	})
}

func BenchmarkGenerator_Generate(b *testing.B) {
	gen := NewGenerator()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_, _, _ = gen.Generate()
	}
}

func BenchmarkGenerator_Hash(b *testing.B) {
	gen := NewGenerator()
	plainKey, _, _ := gen.Generate()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_ = gen.Hash(plainKey)
	}
}
