package embedding

import (
	"context"
	"testing"
	"time"

	"github.com/authz-engine/go-core/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Phase 4.3: Embedding Versioning Tests
// These tests follow TDD methodology - they MUST FAIL before implementation

// TestEmbeddingWorker_ModelVersionTracking verifies that model version is tracked in metadata
func TestEmbeddingWorker_ModelVersionTracking(t *testing.T) {
	tests := []struct {
		name           string
		modelVersion   string
		expectMetadata bool
	}{
		{
			name:           "version tracked in metadata",
			modelVersion:   "all-MiniLM-L6-v2",
			expectMetadata: true,
		},
		{
			name:           "version tracked for custom model",
			modelVersion:   "custom-v1.0.0",
			expectMetadata: true,
		},
		{
			name:           "empty version should use default",
			modelVersion:   "",
			expectMetadata: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			policyStore := NewMockPolicyStore()
			vectorStore := NewMockVectorStore()

			cfg := Config{
				NumWorkers:   2,
				QueueSize:    100,
				Dimension:    384,
				ModelVersion: tt.modelVersion, // NOT IMPLEMENTED YET
			}

			worker, err := NewEmbeddingWorker(cfg, policyStore, vectorStore)
			require.NoError(t, err)
			defer func() {
				ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
				defer cancel()
				_ = worker.Shutdown(ctx)
			}()

			policy := &types.Policy{
				Name:         "test-policy",
				ResourceKind: "document",
				Rules: []*types.Rule{
					{
						Name:    "allow-read",
						Actions: []string{"read"},
						Effect:  types.EffectAllow,
						Roles:   []string{"viewer"},
					},
				},
			}

			// Submit policy for embedding
			success := worker.SubmitPolicy(policy, 1)
			assert.True(t, success)

			// Wait for processing
			time.Sleep(200 * time.Millisecond)

			// Verify vector was inserted with version metadata
			ctx := context.Background()
			vec, err := vectorStore.Get(ctx, "test-policy")
			require.NoError(t, err)
			require.NotNil(t, vec)

			if tt.expectMetadata {
				// Check that model_version is in metadata
				assert.Contains(t, vec.Metadata, "model_version")
				if tt.modelVersion != "" {
					assert.Equal(t, tt.modelVersion, vec.Metadata["model_version"])
				} else {
					// Should have a default version
					assert.NotEmpty(t, vec.Metadata["model_version"])
				}
			}
		})
	}
}

// TestEmbeddingWorker_VersionMismatchDetection detects when model version changes
func TestEmbeddingWorker_VersionMismatchDetection(t *testing.T) {
	policyStore := NewMockPolicyStore()
	vectorStore := NewMockVectorStore()

	// Create worker with version v1
	cfg := Config{
		NumWorkers:   2,
		QueueSize:    100,
		Dimension:    384,
		ModelVersion: "v1.0.0", // NOT IMPLEMENTED YET
	}

	worker, err := NewEmbeddingWorker(cfg, policyStore, vectorStore)
	require.NoError(t, err)

	policy := &types.Policy{
		Name:         "versioned-policy",
		ResourceKind: "document",
	}

	// Embed with v1
	worker.SubmitPolicy(policy, 1)
	time.Sleep(200 * time.Millisecond)

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()
	worker.Shutdown(ctx)

	// Create new worker with version v2
	cfg.ModelVersion = "v2.0.0"
	worker2, err := NewEmbeddingWorker(cfg, policyStore, vectorStore)
	require.NoError(t, err)
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
		defer cancel()
		_ = worker2.Shutdown(ctx)
	}()

	// Detect version mismatch
	ctx2 := context.Background()
	vec, err := vectorStore.Get(ctx2, "versioned-policy")
	require.NoError(t, err)

	// Should detect mismatch between stored version (v1.0.0) and current version (v2.0.0)
	storedVersion, ok := vec.Metadata["model_version"].(string)
	require.True(t, ok)
	assert.Equal(t, "v1.0.0", storedVersion)

	// Worker should have a method to detect this mismatch
	mismatch := worker2.DetectVersionMismatch(vec) // NOT IMPLEMENTED YET
	assert.True(t, mismatch, "Should detect version mismatch between v1.0.0 and v2.0.0")
}

// TestEmbeddingCache_VersionInvalidation verifies cache invalidates on version change
func TestEmbeddingCache_VersionInvalidation(t *testing.T) {
	policyStore := NewMockPolicyStore()
	vectorStore := NewMockVectorStore()

	// Create worker with cache enabled and version v1
	cfg := Config{
		NumWorkers:   2,
		QueueSize:    100,
		Dimension:    384,
		ModelVersion: "v1.0.0", // NOT IMPLEMENTED YET
		CacheConfig: &CacheConfig{
			MaxEntries: 100,
			TTL:        5 * time.Minute,
		},
	}

	worker, err := NewEmbeddingWorker(cfg, policyStore, vectorStore)
	require.NoError(t, err)

	policy := &types.Policy{
		Name:         "cached-policy",
		ResourceKind: "document",
	}

	// Embed and cache with v1
	worker.SubmitPolicy(policy, 1)
	time.Sleep(200 * time.Millisecond)

	// Verify cache hit
	stats := worker.Stats()
	initialHits := stats.CacheHits

	// Submit same policy again (should hit cache)
	worker.SubmitPolicy(policy, 1)
	time.Sleep(200 * time.Millisecond)

	stats = worker.Stats()
	assert.Greater(t, stats.CacheHits, initialHits, "Cache should have been hit")

	// Shutdown and recreate with v2
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()
	worker.Shutdown(ctx)

	cfg.ModelVersion = "v2.0.0"
	worker2, err := NewEmbeddingWorker(cfg, policyStore, vectorStore)
	require.NoError(t, err)
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
		defer cancel()
		_ = worker2.Shutdown(ctx)
	}()

	// Cache should be invalidated for version mismatch
	worker2.SubmitPolicy(policy, 1)
	time.Sleep(200 * time.Millisecond)

	stats = worker2.Stats()
	// Should be cache miss because version changed
	assert.Equal(t, int64(0), stats.CacheHits, "Cache should be invalidated due to version change")
	assert.Greater(t, stats.CacheMisses, int64(0), "Should have cache misses")
}

// TestEngine_InvalidModelVersion_Error verifies invalid version format is rejected
func TestEngine_InvalidModelVersion_Error(t *testing.T) {
	tests := []struct {
		name          string
		modelVersion  string
		shouldError   bool
		errorContains string
	}{
		{
			name:         "valid semantic version",
			modelVersion: "v1.2.3",
			shouldError:  false,
		},
		{
			name:         "valid model name",
			modelVersion: "all-MiniLM-L6-v2",
			shouldError:  false,
		},
		{
			name:         "empty version defaults to v1",
			modelVersion: "",
			shouldError:  false, // Empty defaults to "v1" for backward compatibility
		},
		{
			name:          "invalid characters",
			modelVersion:  "v1.0@invalid!",
			shouldError:   true,
			errorContains: "invalid version format",
		},
		{
			name:          "too long",
			modelVersion:  string(make([]byte, 256)), // 256 chars
			shouldError:   true,
			errorContains: "version too long",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			policyStore := NewMockPolicyStore()
			vectorStore := NewMockVectorStore()

			cfg := Config{
				NumWorkers:   2,
				QueueSize:    100,
				Dimension:    384,
				ModelVersion: tt.modelVersion,
			}

			worker, err := NewEmbeddingWorker(cfg, policyStore, vectorStore)

			if tt.shouldError {
				assert.Error(t, err, "Expected error for invalid version: %s", tt.modelVersion)
				if tt.errorContains != "" && err != nil {
					assert.Contains(t, err.Error(), tt.errorContains)
				}
				assert.Nil(t, worker)
			} else {
				assert.NoError(t, err)
				assert.NotNil(t, worker)
				if worker != nil {
					ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
					defer cancel()
					_ = worker.Shutdown(ctx)
				}
			}
		})
	}
}

// DetectVersionMismatch is implemented in worker.go
