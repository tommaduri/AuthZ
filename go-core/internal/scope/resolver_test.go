package scope

import (
	"fmt"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
)

// TestBuildScopeChain tests basic scope chain building
func TestBuildScopeChain(t *testing.T) {
	resolver := NewResolver(DefaultConfig())

	tests := []struct {
		name     string
		scope    string
		expected []string
		wantErr  bool
	}{
		{
			name:     "empty scope",
			scope:    "",
			expected: []string{},
			wantErr:  false,
		},
		{
			name:     "single segment",
			scope:    "acme",
			expected: []string{"acme"},
			wantErr:  false,
		},
		{
			name:     "two segments",
			scope:    "acme.corp",
			expected: []string{"acme.corp", "acme"},
			wantErr:  false,
		},
		{
			name:     "three segments",
			scope:    "acme.corp.engineering",
			expected: []string{"acme.corp.engineering", "acme.corp", "acme"},
			wantErr:  false,
		},
		{
			name:     "with hyphens",
			scope:    "my-company.my-department",
			expected: []string{"my-company.my-department", "my-company"},
			wantErr:  false,
		},
		{
			name:     "with underscores",
			scope:    "my_company.my_department",
			expected: []string{"my_company.my_department", "my_company"},
			wantErr:  false,
		},
		{
			name:    "invalid characters",
			scope:   "acme.corp@invalid",
			wantErr: true,
		},
		{
			name:    "empty segment",
			scope:   "acme..corp",
			wantErr: true,
		},
		{
			name:    "exceeds max depth",
			scope:   "a.b.c.d.e.f.g.h.i.j.k",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			chain, err := resolver.BuildScopeChain(tt.scope)

			if tt.wantErr {
				if err == nil {
					t.Errorf("expected error, got nil")
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}

			if len(chain) != len(tt.expected) {
				t.Errorf("chain length mismatch: got %d, expected %d", len(chain), len(tt.expected))
				return
			}

			for i, scope := range chain {
				if scope != tt.expected[i] {
					t.Errorf("chain[%d] mismatch: got %q, expected %q", i, scope, tt.expected[i])
				}
			}
		})
	}
}

// TestBuildScopeChainCaching tests that scope chains are cached
func TestBuildScopeChainCaching(t *testing.T) {
	resolver := NewResolver(DefaultConfig())

	scope := "acme.corp.engineering"

	// First call should be a cache miss
	chain1, err := resolver.BuildScopeChain(scope)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	stats1 := resolver.GetStats()
	if stats1.MissCount != 1 {
		t.Errorf("expected 1 cache miss, got %d", stats1.MissCount)
	}

	// Second call should be a cache hit
	chain2, err := resolver.BuildScopeChain(scope)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	stats2 := resolver.GetStats()
	if stats2.HitCount != 1 {
		t.Errorf("expected 1 cache hit, got %d", stats2.HitCount)
	}

	// Chains should be identical
	if len(chain1) != len(chain2) {
		t.Errorf("cached chain length mismatch")
	}
}

// TestMatchScope tests scope pattern matching
func TestMatchScope(t *testing.T) {
	resolver := NewResolver(DefaultConfig())

	tests := []struct {
		name     string
		pattern  string
		scope    string
		expected bool
	}{
		// Exact matches
		{
			name:     "exact match",
			pattern:  "acme.corp",
			scope:    "acme.corp",
			expected: true,
		},
		{
			name:     "no match",
			pattern:  "acme.corp",
			scope:    "acme.other",
			expected: false,
		},
		// Single wildcard
		{
			name:     "single wildcard matches one segment",
			pattern:  "acme.*",
			scope:    "acme.corp",
			expected: true,
		},
		{
			name:     "single wildcard does not match multiple segments",
			pattern:  "acme.*",
			scope:    "acme.corp.engineering",
			expected: false,
		},
		{
			name:     "wildcard in middle",
			pattern:  "acme.*.engineering",
			scope:    "acme.corp.engineering",
			expected: true,
		},
		// Double wildcard
		{
			name:     "double wildcard matches multiple segments",
			pattern:  "acme.**",
			scope:    "acme.corp.engineering",
			expected: true,
		},
		{
			name:     "double wildcard matches one segment",
			pattern:  "acme.**",
			scope:    "acme.corp",
			expected: true,
		},
		{
			name:     "double wildcard matches none",
			pattern:  "acme.**",
			scope:    "acme",
			expected: true,
		},
		{
			name:     "double wildcard in middle",
			pattern:  "acme.**.dev",
			scope:    "acme.corp.engineering.dev",
			expected: true,
		},
		// Edge cases
		{
			name:     "wildcard does not match empty",
			pattern:  "acme.*",
			scope:    "acme",
			expected: false,
		},
		{
			name:     "pattern longer than scope",
			pattern:  "acme.corp.engineering",
			scope:    "acme.corp",
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := resolver.MatchScope(tt.pattern, tt.scope)
			if result != tt.expected {
				t.Errorf("MatchScope(%q, %q) = %v, expected %v", tt.pattern, tt.scope, result, tt.expected)
			}
		})
	}
}

// TestMatchScopeWithoutWildcards tests matching when wildcards are disabled
func TestMatchScopeWithoutWildcards(t *testing.T) {
	config := DefaultConfig()
	config.AllowWildcards = false
	resolver := NewResolver(config)

	tests := []struct {
		name     string
		pattern  string
		scope    string
		expected bool
	}{
		{
			name:     "exact match still works",
			pattern:  "acme.corp",
			scope:    "acme.corp",
			expected: true,
		},
		{
			name:     "wildcard is treated literally",
			pattern:  "acme.*",
			scope:    "acme.corp",
			expected: false,
		},
		{
			name:     "wildcard matches literal wildcard",
			pattern:  "acme.*",
			scope:    "acme.*",
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := resolver.MatchScope(tt.pattern, tt.scope)
			if result != tt.expected {
				t.Errorf("MatchScope(%q, %q) = %v, expected %v", tt.pattern, tt.scope, result, tt.expected)
			}
		})
	}
}

// TestValidateScope tests scope validation
func TestValidateScope(t *testing.T) {
	resolver := NewResolver(DefaultConfig())

	tests := []struct {
		name    string
		scope   string
		wantErr bool
	}{
		{
			name:    "empty scope is valid",
			scope:   "",
			wantErr: false,
		},
		{
			name:    "valid single segment",
			scope:   "acme",
			wantErr: false,
		},
		{
			name:    "valid multiple segments",
			scope:   "acme.corp.engineering",
			wantErr: false,
		},
		{
			name:    "valid with hyphens",
			scope:   "my-company.my-department",
			wantErr: false,
		},
		{
			name:    "valid with underscores",
			scope:   "my_company.my_department",
			wantErr: false,
		},
		{
			name:    "invalid with special characters",
			scope:   "acme@corp",
			wantErr: true,
		},
		{
			name:    "invalid with space",
			scope:   "acme corp",
			wantErr: true,
		},
		{
			name:    "invalid with empty segment",
			scope:   "acme..corp",
			wantErr: true,
		},
		{
			name:    "invalid exceeds max depth",
			scope:   "a.b.c.d.e.f.g.h.i.j.k",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := resolver.ValidateScope(tt.scope)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateScope(%q) error = %v, wantErr %v", tt.scope, err, tt.wantErr)
			}
		})
	}
}

// TestCustomMaxDepth tests custom max depth configuration
func TestCustomMaxDepth(t *testing.T) {
	config := DefaultConfig()
	config.MaxDepth = 3
	resolver := NewResolver(config)

	tests := []struct {
		name    string
		scope   string
		wantErr bool
	}{
		{
			name:    "within max depth",
			scope:   "a.b.c",
			wantErr: false,
		},
		{
			name:    "exceeds max depth",
			scope:   "a.b.c.d",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := resolver.BuildScopeChain(tt.scope)
			if (err != nil) != tt.wantErr {
				t.Errorf("BuildScopeChain(%q) error = %v, wantErr %v", tt.scope, err, tt.wantErr)
			}
		})
	}
}

// TestCustomAllowedChars tests custom character validation
func TestCustomAllowedChars(t *testing.T) {
	config := DefaultConfig()
	config.AllowedCharsRegex = regexp.MustCompile(`^[a-z]+$`) // Only lowercase letters
	resolver := NewResolver(config)

	tests := []struct {
		name    string
		scope   string
		wantErr bool
	}{
		{
			name:    "valid lowercase",
			scope:   "acme.corp",
			wantErr: false,
		},
		{
			name:    "invalid uppercase",
			scope:   "Acme.Corp",
			wantErr: true,
		},
		{
			name:    "invalid with numbers",
			scope:   "acme123",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := resolver.ValidateScope(tt.scope)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateScope(%q) error = %v, wantErr %v", tt.scope, err, tt.wantErr)
			}
		})
	}
}

// TestCacheTTL tests cache expiration
func TestCacheTTL(t *testing.T) {
	config := DefaultConfig()
	config.CacheTTL = 50 * time.Millisecond
	resolver := NewResolver(config)

	scope := "acme.corp.engineering"

	// First call - cache miss
	_, err := resolver.BuildScopeChain(scope)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	stats1 := resolver.GetStats()
	if stats1.MissCount != 1 {
		t.Errorf("expected 1 cache miss, got %d", stats1.MissCount)
	}

	// Second call immediately - cache hit
	_, err = resolver.BuildScopeChain(scope)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	stats2 := resolver.GetStats()
	if stats2.HitCount != 1 {
		t.Errorf("expected 1 cache hit, got %d", stats2.HitCount)
	}

	// Wait for cache to expire
	time.Sleep(100 * time.Millisecond)

	// Third call after expiration - cache miss again
	_, err = resolver.BuildScopeChain(scope)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	stats3 := resolver.GetStats()
	if stats3.MissCount != 2 {
		t.Errorf("expected 2 cache misses after expiration, got %d", stats3.MissCount)
	}
}

// TestClearCache tests cache clearing
func TestClearCache(t *testing.T) {
	resolver := NewResolver(DefaultConfig())

	scope := "acme.corp"

	// Build chain and cache it
	_, err := resolver.BuildScopeChain(scope)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	stats1 := resolver.GetStats()
	if stats1.Size == 0 {
		t.Errorf("expected cache to have entries")
	}

	// Clear cache
	resolver.ClearCache()

	stats2 := resolver.GetStats()
	if stats2.Size != 0 {
		t.Errorf("expected cache size 0 after clear, got %d", stats2.Size)
	}
	if stats2.HitCount != 0 || stats2.MissCount != 0 {
		t.Errorf("expected stats to be reset")
	}
}

// TestConcurrentAccess tests thread-safe concurrent access
func TestConcurrentAccess(t *testing.T) {
	resolver := NewResolver(DefaultConfig())

	scopes := []string{
		"acme.corp",
		"acme.corp.engineering",
		"acme.corp.sales",
		"beta.company",
		"beta.company.dev",
	}

	var wg sync.WaitGroup
	errors := make(chan error, 100)

	// Spawn 100 goroutines
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			scope := scopes[idx%len(scopes)]

			// Build chain
			chain, err := resolver.BuildScopeChain(scope)
			if err != nil {
				errors <- fmt.Errorf("BuildScopeChain error: %w", err)
				return
			}

			// Validate
			if len(chain) == 0 {
				errors <- fmt.Errorf("empty chain for scope %q", scope)
				return
			}

			// Match pattern
			_ = resolver.MatchScope("acme.*", scope)
		}(i)
	}

	wg.Wait()
	close(errors)

	// Check for errors
	for err := range errors {
		t.Errorf("concurrent access error: %v", err)
	}

	// Verify cache stats make sense
	stats := resolver.GetStats()
	if stats.Size == 0 {
		t.Errorf("expected cache to have entries after concurrent access")
	}
}

// TestCacheHitRate tests cache hit rate calculation
func TestCacheHitRate(t *testing.T) {
	resolver := NewResolver(DefaultConfig())

	scope := "acme.corp"

	// First call - miss
	resolver.BuildScopeChain(scope)

	// Next 9 calls - hits
	for i := 0; i < 9; i++ {
		resolver.BuildScopeChain(scope)
	}

	stats := resolver.GetStats()
	expectedHitRate := 0.9 // 9 hits out of 10 total calls

	if stats.HitCount != 9 {
		t.Errorf("expected 9 hits, got %d", stats.HitCount)
	}
	if stats.MissCount != 1 {
		t.Errorf("expected 1 miss, got %d", stats.MissCount)
	}
	if stats.HitRate < expectedHitRate-0.01 || stats.HitRate > expectedHitRate+0.01 {
		t.Errorf("expected hit rate ~%.2f, got %.2f", expectedHitRate, stats.HitRate)
	}
}

// TestComplexWildcardPatterns tests complex wildcard scenarios
func TestComplexWildcardPatterns(t *testing.T) {
	resolver := NewResolver(DefaultConfig())

	tests := []struct {
		name     string
		pattern  string
		scope    string
		expected bool
	}{
		{
			name:     "multiple wildcards",
			pattern:  "*.corp.*",
			scope:    "acme.corp.engineering",
			expected: true,
		},
		{
			name:     "mixed wildcards",
			pattern:  "acme.**.dev",
			scope:    "acme.corp.engineering.dev",
			expected: true,
		},
		{
			name:     "double wildcard at start",
			pattern:  "**.engineering",
			scope:    "acme.corp.engineering",
			expected: true,
		},
		{
			name:     "double wildcard matches empty",
			pattern:  "acme.**.engineering",
			scope:    "acme.engineering",
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := resolver.MatchScope(tt.pattern, tt.scope)
			if result != tt.expected {
				t.Errorf("MatchScope(%q, %q) = %v, expected %v", tt.pattern, tt.scope, result, tt.expected)
			}
		})
	}
}

// Benchmark tests for performance validation

func BenchmarkBuildScopeChain(b *testing.B) {
	resolver := NewResolver(DefaultConfig())
	scope := "acme.corp.engineering.team.project"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = resolver.BuildScopeChain(scope)
	}
}

func BenchmarkBuildScopeChainCached(b *testing.B) {
	resolver := NewResolver(DefaultConfig())
	scope := "acme.corp.engineering.team.project"

	// Warm up cache
	resolver.BuildScopeChain(scope)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = resolver.BuildScopeChain(scope)
	}
}

func BenchmarkMatchScopeExact(b *testing.B) {
	resolver := NewResolver(DefaultConfig())

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = resolver.MatchScope("acme.corp", "acme.corp")
	}
}

func BenchmarkMatchScopeWildcard(b *testing.B) {
	resolver := NewResolver(DefaultConfig())

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = resolver.MatchScope("acme.*", "acme.corp")
	}
}

func BenchmarkMatchScopeDoubleWildcard(b *testing.B) {
	resolver := NewResolver(DefaultConfig())

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = resolver.MatchScope("acme.**", "acme.corp.engineering")
	}
}

func BenchmarkValidateScope(b *testing.B) {
	resolver := NewResolver(DefaultConfig())
	scope := "acme.corp.engineering"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = resolver.ValidateScope(scope)
	}
}

func BenchmarkConcurrentBuildScopeChain(b *testing.B) {
	resolver := NewResolver(DefaultConfig())
	scopes := []string{
		"acme.corp",
		"acme.corp.engineering",
		"acme.corp.sales",
		"beta.company",
	}

	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			scope := scopes[i%len(scopes)]
			_, _ = resolver.BuildScopeChain(scope)
			i++
		}
	})
}

// TestDeepScopeChain tests performance with deep hierarchies
func TestDeepScopeChain(t *testing.T) {
	resolver := NewResolver(DefaultConfig())

	// Build a 10-level deep scope (at max depth)
	segments := []string{"a", "b", "c", "d", "e", "f", "g", "h", "i", "j"}
	scope := strings.Join(segments, ".")

	chain, err := resolver.BuildScopeChain(scope)
	if err != nil {
		t.Fatalf("unexpected error for max depth scope: %v", err)
	}

	if len(chain) != 10 {
		t.Errorf("expected chain length 10, got %d", len(chain))
	}

	// Verify chain is correct
	for i, expected := range []string{
		"a.b.c.d.e.f.g.h.i.j",
		"a.b.c.d.e.f.g.h.i",
		"a.b.c.d.e.f.g.h",
		"a.b.c.d.e.f.g",
		"a.b.c.d.e.f",
		"a.b.c.d.e",
		"a.b.c.d",
		"a.b.c",
		"a.b",
		"a",
	} {
		if chain[i] != expected {
			t.Errorf("chain[%d] = %q, expected %q", i, chain[i], expected)
		}
	}
}
