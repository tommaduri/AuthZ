// Package scope provides hierarchical scope resolution for authorization policies
package scope

import (
	"fmt"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Config for scope resolution
type Config struct {
	MaxDepth          int           // Maximum depth of scope hierarchy
	AllowWildcards    bool          // Allow wildcard patterns in scope matching
	CacheTTL          time.Duration // Time-to-live for cache entries
	AllowedCharsRegex *regexp.Regexp // Regex for validating scope segment characters
}

// DefaultConfig returns a default resolver configuration
func DefaultConfig() Config {
	return Config{
		MaxDepth:          10,
		AllowWildcards:    true,
		CacheTTL:          time.Minute,
		AllowedCharsRegex: regexp.MustCompile(`^[a-zA-Z0-9_-]+$`),
	}
}

// Resolver handles scope resolution and validation
type Resolver struct {
	config     Config
	chainCache *scopeChainCache
}

// scopeChainCache for computed scope chains with LRU eviction
type scopeChainCache struct {
	mu        sync.RWMutex
	entries   map[string]*chainEntry
	maxSize   int
	hitCount  atomic.Int64
	missCount atomic.Int64
}

type chainEntry struct {
	chain   []string
	expires int64
}

// NewResolver creates a new scope resolver
func NewResolver(config Config) *Resolver {
	if config.MaxDepth == 0 {
		config.MaxDepth = 10
	}
	if config.CacheTTL == 0 {
		config.CacheTTL = time.Minute
	}
	if config.AllowedCharsRegex == nil {
		config.AllowedCharsRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
	}

	return &Resolver{
		config: config,
		chainCache: &scopeChainCache{
			entries: make(map[string]*chainEntry),
			maxSize: 10000, // Max 10k cached scope chains
		},
	}
}

// BuildScopeChain builds inheritance chain from most to least specific
// Example: "acme.corp.engineering" -> ["acme.corp.engineering", "acme.corp", "acme"]
func (r *Resolver) BuildScopeChain(scope string) ([]string, error) {
	if scope == "" {
		return []string{}, nil
	}

	// Check cache first
	if chain := r.chainCache.get(scope, r.config.CacheTTL); chain != nil {
		return chain, nil
	}

	// Split scope into segments
	segments := strings.Split(scope, ".")
	if len(segments) > r.config.MaxDepth {
		return nil, fmt.Errorf("scope depth %d exceeds maximum %d", len(segments), r.config.MaxDepth)
	}

	// Validate each segment
	for _, seg := range segments {
		if seg == "" {
			return nil, fmt.Errorf("scope contains empty segment")
		}
		if !r.config.AllowedCharsRegex.MatchString(seg) {
			return nil, fmt.Errorf("invalid scope segment: %s (allowed: alphanumeric, underscore, hyphen)", seg)
		}
	}

	// Build chain from most to least specific
	chain := make([]string, len(segments))
	for i := len(segments); i > 0; i-- {
		chain[len(segments)-i] = strings.Join(segments[:i], ".")
	}

	// Cache result
	r.chainCache.set(scope, chain, r.config.CacheTTL)

	return chain, nil
}

// MatchScope checks if a pattern matches a scope
// Supports wildcards: * (single segment), ** (multiple segments)
// Examples:
//   - "acme.*" matches "acme.corp" but not "acme.corp.eng"
//   - "acme.**" matches "acme.corp.eng" and "acme.corp"
func (r *Resolver) MatchScope(pattern, scope string) bool {
	// Exact match
	if pattern == scope {
		return true
	}

	if !r.config.AllowWildcards {
		return false
	}

	// Convert pattern to regex
	regexPattern := regexp.QuoteMeta(pattern)

	// Handle double star wildcard (matches multiple segments including none)
	// Note: QuoteMeta converts . to \. so we replace \.\*\* with (\..*)?
	regexPattern = strings.ReplaceAll(regexPattern, `\.\*\*`, `(\..*)?`)
	regexPattern = strings.ReplaceAll(regexPattern, `\*\*`, `.*`)

	// Handle single star wildcard (matches single segment)
	regexPattern = strings.ReplaceAll(regexPattern, `\*`, `[^.]+`)

	regex, err := regexp.Compile("^" + regexPattern + "$")
	if err != nil {
		return false
	}

	return regex.MatchString(scope)
}

// ValidateScope checks if a scope string is valid
func (r *Resolver) ValidateScope(scope string) error {
	if scope == "" {
		return nil // Empty scope is valid (global)
	}

	segments := strings.Split(scope, ".")
	if len(segments) > r.config.MaxDepth {
		return fmt.Errorf("scope depth %d exceeds maximum %d", len(segments), r.config.MaxDepth)
	}

	for _, seg := range segments {
		if seg == "" {
			return fmt.Errorf("scope contains empty segment")
		}
		if !r.config.AllowedCharsRegex.MatchString(seg) {
			return fmt.Errorf("invalid scope segment: %s (allowed: alphanumeric, underscore, hyphen)", seg)
		}
	}

	return nil
}

// ClearCache clears the scope chain cache
func (r *Resolver) ClearCache() {
	r.chainCache.clear()
}

// GetStats returns cache statistics
func (r *Resolver) GetStats() CacheStats {
	return r.chainCache.stats()
}

// CacheStats contains cache performance metrics
type CacheStats struct {
	Size     int
	HitCount int64
	MissCount int64
	HitRate  float64
}

// Cache methods

func (c *scopeChainCache) get(key string, ttl time.Duration) []string {
	c.mu.RLock()
	entry, ok := c.entries[key]
	c.mu.RUnlock()

	if !ok {
		c.missCount.Add(1)
		return nil
	}

	// Check expiration
	if entry.expires < time.Now().UnixMilli() {
		c.missCount.Add(1)
		return nil
	}

	c.hitCount.Add(1)
	return entry.chain
}

func (c *scopeChainCache) set(key string, chain []string, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Simple LRU eviction: if cache is full, clear it
	if len(c.entries) >= c.maxSize {
		c.entries = make(map[string]*chainEntry)
	}

	c.entries[key] = &chainEntry{
		chain:   chain,
		expires: time.Now().Add(ttl).UnixMilli(),
	}
}

func (c *scopeChainCache) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.entries = make(map[string]*chainEntry)
	c.hitCount.Store(0)
	c.missCount.Store(0)
}

func (c *scopeChainCache) stats() CacheStats {
	c.mu.RLock()
	size := len(c.entries)
	c.mu.RUnlock()

	hits := c.hitCount.Load()
	misses := c.missCount.Load()
	total := float64(hits + misses)
	hitRate := 0.0
	if total > 0 {
		hitRate = float64(hits) / total
	}

	return CacheStats{
		Size:      size,
		HitCount:  hits,
		MissCount: misses,
		HitRate:   hitRate,
	}
}
