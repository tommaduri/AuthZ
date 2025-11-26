// Package embedding provides background policy embedding generation
package embedding

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

// CachedEmbedding represents a cached policy embedding with metadata
type CachedEmbedding struct {
	PolicyID     string
	PolicyHash   string    // SHA-256 hash of policy content
	ModelVersion string    // Embedding model version for invalidation
	Embedding    []float32
	GeneratedAt  time.Time
	AccessCount  int64
	LastAccess   time.Time
}

// EmbeddingCache provides thread-safe caching of policy embeddings
type EmbeddingCache struct {
	entries map[string]*CachedEmbedding // policyID -> cached embedding
	mu      sync.RWMutex

	// Statistics
	hits         int64
	misses       int64
	evictions    int64
	totalEntries int64

	// Configuration
	maxEntries int           // Maximum cache entries (0 = unlimited)
	ttl        time.Duration // Time-to-live for cache entries (0 = no expiry)
}

// CacheConfig configures the embedding cache
type CacheConfig struct {
	MaxEntries int           // Maximum cache entries (default: 10000, 0 = unlimited)
	TTL        time.Duration // Time-to-live (default: 24h, 0 = no expiry)
}

// DefaultCacheConfig returns default cache configuration
func DefaultCacheConfig() CacheConfig {
	return CacheConfig{
		MaxEntries: 10000,
		TTL:        24 * time.Hour,
	}
}

// NewEmbeddingCache creates a new embedding cache
func NewEmbeddingCache(cfg CacheConfig) *EmbeddingCache {
	if cfg.MaxEntries <= 0 {
		cfg.MaxEntries = 10000 // Default to 10K entries
	}
	if cfg.TTL == 0 {
		cfg.TTL = 24 * time.Hour // Default to 24 hours
	}

	return &EmbeddingCache{
		entries:    make(map[string]*CachedEmbedding),
		maxEntries: cfg.MaxEntries,
		ttl:        cfg.TTL,
	}
}

// Get retrieves a cached embedding if it exists and is valid
// Returns nil if not found, expired, or policy hash doesn't match
func (c *EmbeddingCache) Get(policyID string, policyHash string) []float32 {
	c.mu.RLock()
	entry, exists := c.entries[policyID]
	c.mu.RUnlock()

	if !exists {
		c.mu.Lock()
		c.misses++
		c.mu.Unlock()
		return nil
	}

	// Check if policy has changed (hash mismatch)
	if entry.PolicyHash != policyHash {
		c.mu.Lock()
		delete(c.entries, policyID) // Remove stale entry
		c.misses++
		c.evictions++
		c.mu.Unlock()
		return nil
	}

	// Check if entry has expired
	if c.ttl > 0 && time.Since(entry.GeneratedAt) > c.ttl {
		c.mu.Lock()
		delete(c.entries, policyID)
		c.misses++
		c.evictions++
		c.mu.Unlock()
		return nil
	}

	// Cache hit - update access stats
	c.mu.Lock()
	entry.AccessCount++
	entry.LastAccess = time.Now()
	c.hits++
	c.mu.Unlock()

	return entry.Embedding
}

// GetWithVersion retrieves a cached embedding if it exists and model version matches
// Returns nil if not found, expired, hash doesn't match, or version doesn't match
func (c *EmbeddingCache) GetWithVersion(policyID string, policyHash string, modelVersion string) []float32 {
	c.mu.RLock()
	entry, exists := c.entries[policyID]
	c.mu.RUnlock()

	if !exists {
		c.mu.Lock()
		c.misses++
		c.mu.Unlock()
		return nil
	}

	// Check if policy has changed (hash mismatch)
	if entry.PolicyHash != policyHash {
		c.mu.Lock()
		delete(c.entries, policyID) // Remove stale entry
		c.misses++
		c.evictions++
		c.mu.Unlock()
		return nil
	}

	// Check if model version has changed
	if entry.ModelVersion != modelVersion {
		c.mu.Lock()
		delete(c.entries, policyID) // Remove outdated entry
		c.misses++
		c.evictions++
		c.mu.Unlock()
		return nil
	}

	// Check if entry has expired
	if c.ttl > 0 && time.Since(entry.GeneratedAt) > c.ttl {
		c.mu.Lock()
		delete(c.entries, policyID)
		c.misses++
		c.evictions++
		c.mu.Unlock()
		return nil
	}

	// Cache hit - update access stats
	c.mu.Lock()
	entry.AccessCount++
	entry.LastAccess = time.Now()
	c.hits++
	c.mu.Unlock()

	return entry.Embedding
}

// Put stores an embedding in the cache
// If cache is full, evicts least recently used (LRU) entry
func (c *EmbeddingCache) Put(policyID string, policyHash string, embedding []float32) error {
	if len(embedding) == 0 {
		return fmt.Errorf("embedding cannot be empty")
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	// Check if we need to evict entries (LRU)
	if len(c.entries) >= c.maxEntries {
		c.evictLRU()
	}

	// Store new entry
	c.entries[policyID] = &CachedEmbedding{
		PolicyID:    policyID,
		PolicyHash:  policyHash,
		Embedding:   embedding,
		GeneratedAt: time.Now(),
		AccessCount: 0,
		LastAccess:  time.Now(),
	}
	c.totalEntries++

	return nil
}

// PutWithVersion stores an embedding in the cache with model version
// If cache is full, evicts least recently used (LRU) entry
func (c *EmbeddingCache) PutWithVersion(policyID string, policyHash string, embedding []float32, modelVersion string) error {
	if len(embedding) == 0 {
		return fmt.Errorf("embedding cannot be empty")
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	// Check if we need to evict entries (LRU)
	if len(c.entries) >= c.maxEntries {
		c.evictLRU()
	}

	// Store new entry with version
	c.entries[policyID] = &CachedEmbedding{
		PolicyID:     policyID,
		PolicyHash:   policyHash,
		ModelVersion: modelVersion,
		Embedding:    embedding,
		GeneratedAt:  time.Now(),
		AccessCount:  0,
		LastAccess:   time.Now(),
	}
	c.totalEntries++

	return nil
}

// evictLRU removes the least recently used entry
// Must be called with write lock held
func (c *EmbeddingCache) evictLRU() {
	var oldestID string
	var oldestTime time.Time

	// Find LRU entry
	for id, entry := range c.entries {
		if oldestID == "" || entry.LastAccess.Before(oldestTime) {
			oldestID = id
			oldestTime = entry.LastAccess
		}
	}

	// Evict oldest entry
	if oldestID != "" {
		delete(c.entries, oldestID)
		c.evictions++
	}
}

// Delete removes an entry from the cache
func (c *EmbeddingCache) Delete(policyID string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if _, exists := c.entries[policyID]; exists {
		delete(c.entries, policyID)
		c.evictions++
	}
}

// Clear removes all entries from the cache
func (c *EmbeddingCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.entries = make(map[string]*CachedEmbedding)
}

// Stats returns cache statistics
func (c *EmbeddingCache) Stats() CacheStats {
	c.mu.RLock()
	defer c.mu.RUnlock()

	var hitRate float64
	totalRequests := c.hits + c.misses
	if totalRequests > 0 {
		hitRate = float64(c.hits) / float64(totalRequests)
	}

	return CacheStats{
		Entries:       len(c.entries),
		Hits:          c.hits,
		Misses:        c.misses,
		Evictions:     c.evictions,
		TotalEntries:  c.totalEntries,
		HitRate:       hitRate,
		MaxEntries:    c.maxEntries,
		TTL:           c.ttl,
	}
}

// CacheStats tracks cache performance metrics
type CacheStats struct {
	Entries      int           // Current number of cached entries
	Hits         int64         // Total cache hits
	Misses       int64         // Total cache misses
	Evictions    int64         // Total evictions
	TotalEntries int64         // Total entries stored (including evicted)
	HitRate      float64       // Hit rate (hits / (hits + misses))
	MaxEntries   int           // Maximum cache capacity
	TTL          time.Duration // Cache TTL
}

// String returns a human-readable cache stats summary
func (s CacheStats) String() string {
	return fmt.Sprintf(
		"Cache{entries=%d/%d, hits=%d, misses=%d, evictions=%d, hitRate=%.2f%%, ttl=%v}",
		s.Entries, s.MaxEntries, s.Hits, s.Misses, s.Evictions, s.HitRate*100, s.TTL,
	)
}

// ComputePolicyHash generates a SHA-256 hash of policy content
// Used to detect policy changes for cache invalidation
func ComputePolicyHash(policyText string) string {
	hash := sha256.Sum256([]byte(policyText))
	return hex.EncodeToString(hash[:])
}
