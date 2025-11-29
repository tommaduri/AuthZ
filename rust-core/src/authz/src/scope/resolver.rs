/// Scope resolver with caching and hierarchical chain building
///
/// Provides efficient scope resolution with TTL-based caching
/// for high-performance policy filtering.

use std::sync::Arc;
use std::time::{Duration, Instant};
use dashmap::DashMap;

use super::types::{Scope, ScopeResult, ScopeError};

/// Default cache TTL (60 seconds)
const DEFAULT_CACHE_TTL: Duration = Duration::from_secs(60);

/// Cache entry with TTL
#[derive(Debug, Clone)]
struct CacheEntry<T> {
    /// Cached value
    value: T,
    /// Timestamp when entry was created
    created_at: Instant,
    /// Time-to-live duration
    ttl: Duration,
}

impl<T> CacheEntry<T> {
    /// Creates a new cache entry
    fn new(value: T, ttl: Duration) -> Self {
        Self {
            value,
            created_at: Instant::now(),
            ttl,
        }
    }

    /// Checks if this cache entry is expired
    fn is_expired(&self) -> bool {
        self.created_at.elapsed() > self.ttl
    }

    /// Returns the value if not expired, None otherwise
    fn get(&self) -> Option<&T> {
        if self.is_expired() {
            None
        } else {
            Some(&self.value)
        }
    }
}

/// Statistics about cache performance
#[derive(Debug, Clone, Default)]
pub struct CacheStats {
    /// Number of cache hits
    pub hits: usize,
    /// Number of cache misses
    pub misses: usize,
    /// Number of expired entries encountered
    pub expirations: usize,
    /// Total number of entries in cache
    pub entries: usize,
}

impl CacheStats {
    /// Calculates the cache hit rate
    pub fn hit_rate(&self) -> f64 {
        let total = self.hits + self.misses;
        if total == 0 {
            0.0
        } else {
            self.hits as f64 / total as f64
        }
    }
}

/// Resolves scopes with hierarchical chain building and caching
///
/// The ScopeResolver provides efficient scope matching with:
/// - Hierarchical chain building (org:acme:dept → [org, org:acme, org:acme:dept])
/// - Pattern matching with wildcards
/// - TTL-based caching for performance
/// - Thread-safe concurrent access
///
/// # Examples
///
/// ```
/// use authz::scope::{Scope, ScopeResolver};
///
/// let resolver = ScopeResolver::new();
/// let scope = Scope::from_str("org:acme:dept:engineering").unwrap();
///
/// // Build hierarchical chain
/// let chain = resolver.build_chain(&scope);
/// assert_eq!(chain.len(), 4);
///
/// // Pattern matching
/// assert!(resolver.matches_pattern(&scope, "org:acme:*").unwrap());
/// ```
pub struct ScopeResolver {
    /// Cache for scope chains
    chain_cache: Arc<DashMap<String, CacheEntry<Vec<Scope>>>>,
    /// Cache for pattern matches
    pattern_cache: Arc<DashMap<String, CacheEntry<bool>>>,
    /// Cache TTL duration
    ttl: Duration,
    /// Cache statistics
    stats: Arc<DashMap<String, usize>>,
}

impl ScopeResolver {
    /// Creates a new ScopeResolver with default TTL
    pub fn new() -> Self {
        Self::with_ttl(DEFAULT_CACHE_TTL)
    }

    /// Creates a new ScopeResolver with custom TTL
    ///
    /// # Arguments
    ///
    /// * `ttl` - Time-to-live duration for cache entries
    pub fn with_ttl(ttl: Duration) -> Self {
        Self {
            chain_cache: Arc::new(DashMap::new()),
            pattern_cache: Arc::new(DashMap::new()),
            ttl,
            stats: Arc::new(DashMap::new()),
        }
    }

    /// Builds a hierarchical chain from a scope
    ///
    /// Converts a scope like "org:acme:dept:engineering" into a chain:
    /// ["org", "org:acme", "org:acme:dept", "org:acme:dept:engineering"]
    ///
    /// Results are cached for performance.
    ///
    /// # Arguments
    ///
    /// * `scope` - The scope to build a chain from
    ///
    /// # Returns
    ///
    /// Returns a vector of scopes representing the hierarchy
    pub fn build_chain(&self, scope: &Scope) -> Vec<Scope> {
        let cache_key = scope.as_str().to_string();

        // Check cache first
        if let Some(entry) = self.chain_cache.get(&cache_key) {
            if let Some(chain) = entry.get() {
                self.increment_stat("chain_hits");
                return chain.clone();
            } else {
                self.increment_stat("chain_expirations");
            }
        } else {
            self.increment_stat("chain_misses");
        }

        // Build chain
        let chain = self.build_chain_uncached(scope);

        // Cache result
        self.chain_cache.insert(
            cache_key,
            CacheEntry::new(chain.clone(), self.ttl),
        );

        chain
    }

    /// Builds a chain without using the cache
    fn build_chain_uncached(&self, scope: &Scope) -> Vec<Scope> {
        let segments = scope.segments();
        let mut chain = Vec::with_capacity(segments.len());

        for i in 1..=segments.len() {
            let scope_str = segments[..i].join(":");
            if let Ok(scope) = Scope::new(&scope_str) {
                chain.push(scope);
            }
        }

        chain
    }

    /// Checks if a scope matches a pattern with caching
    ///
    /// # Arguments
    ///
    /// * `scope` - The scope to check
    /// * `pattern` - The pattern to match against
    ///
    /// # Returns
    ///
    /// Returns `true` if the scope matches the pattern
    pub fn matches_pattern(&self, scope: &Scope, pattern: &str) -> ScopeResult<bool> {
        let cache_key = format!("{}|{}", scope.as_str(), pattern);

        // Check cache first
        if let Some(entry) = self.pattern_cache.get(&cache_key) {
            if let Some(result) = entry.get() {
                self.increment_stat("pattern_hits");
                return Ok(*result);
            } else {
                self.increment_stat("pattern_expirations");
            }
        } else {
            self.increment_stat("pattern_misses");
        }

        // Compute result
        let result = scope.matches(pattern)?;

        // Cache result
        self.pattern_cache.insert(
            cache_key,
            CacheEntry::new(result, self.ttl),
        );

        Ok(result)
    }

    /// Checks if a scope matches any pattern in a list
    ///
    /// # Arguments
    ///
    /// * `scope` - The scope to check
    /// * `patterns` - The patterns to match against
    ///
    /// # Returns
    ///
    /// Returns `true` if the scope matches any pattern
    pub fn matches_any(&self, scope: &Scope, patterns: &[&str]) -> ScopeResult<bool> {
        for pattern in patterns {
            if self.matches_pattern(scope, pattern)? {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// Checks if a scope matches all patterns in a list
    ///
    /// # Arguments
    ///
    /// * `scope` - The scope to check
    /// * `patterns` - The patterns to match against
    ///
    /// # Returns
    ///
    /// Returns `true` if the scope matches all patterns
    pub fn matches_all(&self, scope: &Scope, patterns: &[&str]) -> ScopeResult<bool> {
        for pattern in patterns {
            if !self.matches_pattern(scope, pattern)? {
                return Ok(false);
            }
        }
        Ok(true)
    }

    /// Finds all scopes in a list that match a pattern
    ///
    /// # Arguments
    ///
    /// * `scopes` - The scopes to filter
    /// * `pattern` - The pattern to match against
    ///
    /// # Returns
    ///
    /// Returns a vector of scopes that match the pattern
    pub fn filter_matching(&self, scopes: &[Scope], pattern: &str) -> ScopeResult<Vec<Scope>> {
        let mut matching = Vec::new();

        for scope in scopes {
            if self.matches_pattern(scope, pattern)? {
                matching.push(scope.clone());
            }
        }

        Ok(matching)
    }

    /// Clears the cache
    pub fn clear_cache(&self) {
        self.chain_cache.clear();
        self.pattern_cache.clear();
        self.stats.clear();
    }

    /// Removes expired entries from the cache
    pub fn cleanup_expired(&self) {
        // Clean chain cache
        self.chain_cache.retain(|_, entry| !entry.is_expired());

        // Clean pattern cache
        self.pattern_cache.retain(|_, entry| !entry.is_expired());
    }

    /// Returns cache statistics
    pub fn stats(&self) -> CacheStats {
        let hits = self.get_stat("chain_hits") + self.get_stat("pattern_hits");
        let misses = self.get_stat("chain_misses") + self.get_stat("pattern_misses");
        let expirations = self.get_stat("chain_expirations") + self.get_stat("pattern_expirations");

        CacheStats {
            hits,
            misses,
            expirations,
            entries: self.chain_cache.len() + self.pattern_cache.len(),
        }
    }

    /// Resets cache statistics
    pub fn reset_stats(&self) {
        self.stats.clear();
    }

    /// Increments a statistic counter
    fn increment_stat(&self, key: &str) {
        self.stats
            .entry(key.to_string())
            .and_modify(|count| *count += 1)
            .or_insert(1);
    }

    /// Gets a statistic value
    fn get_stat(&self, key: &str) -> usize {
        self.stats.get(key).map(|v| *v).unwrap_or(0)
    }

    /// Returns the current cache TTL
    pub fn ttl(&self) -> Duration {
        self.ttl
    }

    /// Returns the number of entries in the chain cache
    pub fn chain_cache_size(&self) -> usize {
        self.chain_cache.len()
    }

    /// Returns the number of entries in the pattern cache
    pub fn pattern_cache_size(&self) -> usize {
        self.pattern_cache.len()
    }
}

impl Default for ScopeResolver {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_chain() {
        let resolver = ScopeResolver::new();
        let scope = Scope::new("org:acme:dept:engineering").unwrap();

        let chain = resolver.build_chain(&scope);
        assert_eq!(chain.len(), 4);
        assert_eq!(chain[0].as_str(), "org");
        assert_eq!(chain[1].as_str(), "org:acme");
        assert_eq!(chain[2].as_str(), "org:acme:dept");
        assert_eq!(chain[3].as_str(), "org:acme:dept:engineering");
    }

    #[test]
    fn test_chain_caching() {
        let resolver = ScopeResolver::new();
        let scope = Scope::new("org:acme:dept").unwrap();

        // First call - cache miss
        let chain1 = resolver.build_chain(&scope);
        let stats1 = resolver.stats();
        assert_eq!(stats1.misses, 1);

        // Second call - cache hit
        let chain2 = resolver.build_chain(&scope);
        let stats2 = resolver.stats();
        assert_eq!(stats2.hits, 1);

        assert_eq!(chain1, chain2);
    }

    #[test]
    fn test_pattern_matching() {
        let resolver = ScopeResolver::new();
        let scope = Scope::new("org:acme:dept").unwrap();

        assert!(resolver.matches_pattern(&scope, "org:acme:*").unwrap());
        assert!(resolver.matches_pattern(&scope, "org:*:dept").unwrap());
        assert!(!resolver.matches_pattern(&scope, "other:*").unwrap());
    }

    #[test]
    fn test_pattern_caching() {
        let resolver = ScopeResolver::new();
        let scope = Scope::new("org:acme:dept").unwrap();

        // First call - cache miss
        resolver.matches_pattern(&scope, "org:acme:*").unwrap();
        let stats1 = resolver.stats();
        assert_eq!(stats1.misses, 1);

        // Second call - cache hit
        resolver.matches_pattern(&scope, "org:acme:*").unwrap();
        let stats2 = resolver.stats();
        assert_eq!(stats2.hits, 1);
    }

    #[test]
    fn test_matches_any() {
        let resolver = ScopeResolver::new();
        let scope = Scope::new("org:acme:dept").unwrap();

        let patterns = vec!["other:*", "org:acme:*", "different:**"];
        assert!(resolver.matches_any(&scope, &patterns).unwrap());

        let patterns = vec!["other:*", "different:**"];
        assert!(!resolver.matches_any(&scope, &patterns).unwrap());
    }

    #[test]
    fn test_matches_all() {
        let resolver = ScopeResolver::new();
        let scope = Scope::new("org:acme:dept").unwrap();

        let patterns = vec!["org:*:dept", "org:acme:*"];
        assert!(resolver.matches_all(&scope, &patterns).unwrap());

        let patterns = vec!["org:*:dept", "other:*"];
        assert!(!resolver.matches_all(&scope, &patterns).unwrap());
    }

    #[test]
    fn test_filter_matching() {
        let resolver = ScopeResolver::new();
        let scopes = vec![
            Scope::new("org:acme:dept").unwrap(),
            Scope::new("org:acme:sales").unwrap(),
            Scope::new("org:other:dept").unwrap(),
        ];

        let matching = resolver.filter_matching(&scopes, "org:acme:*").unwrap();
        assert_eq!(matching.len(), 2);
        assert_eq!(matching[0].as_str(), "org:acme:dept");
        assert_eq!(matching[1].as_str(), "org:acme:sales");
    }

    #[test]
    fn test_cache_expiration() {
        let resolver = ScopeResolver::with_ttl(Duration::from_millis(50));
        let scope = Scope::new("org:acme:dept").unwrap();

        // Add to cache
        resolver.build_chain(&scope);
        assert_eq!(resolver.chain_cache_size(), 1);

        // Wait for expiration
        std::thread::sleep(Duration::from_millis(100));

        // Access should detect expiration
        resolver.build_chain(&scope);
        let stats = resolver.stats();
        assert!(stats.expirations > 0);

        // Cleanup should remove expired entries
        resolver.cleanup_expired();
    }

    #[test]
    fn test_clear_cache() {
        let resolver = ScopeResolver::new();
        let scope = Scope::new("org:acme:dept").unwrap();

        resolver.build_chain(&scope);
        resolver.matches_pattern(&scope, "org:acme:*").unwrap();

        assert!(resolver.chain_cache_size() > 0);
        assert!(resolver.pattern_cache_size() > 0);

        resolver.clear_cache();

        assert_eq!(resolver.chain_cache_size(), 0);
        assert_eq!(resolver.pattern_cache_size(), 0);
    }

    #[test]
    fn test_stats() {
        let resolver = ScopeResolver::new();
        let scope = Scope::new("org:acme:dept").unwrap();

        // Generate some cache activity
        resolver.build_chain(&scope);
        resolver.build_chain(&scope);
        resolver.matches_pattern(&scope, "org:acme:*").unwrap();

        let stats = resolver.stats();
        assert_eq!(stats.hits, 1);
        assert_eq!(stats.misses, 2);
        assert!(stats.hit_rate() > 0.0);
    }

    #[test]
    fn test_concurrent_access() {
        use std::sync::Arc;
        use std::thread;

        let resolver = Arc::new(ScopeResolver::new());
        let mut handles = vec![];

        for i in 0..10 {
            let resolver = Arc::clone(&resolver);
            let handle = thread::spawn(move || {
                let scope = Scope::new(&format!("org:acme:dept{}", i)).unwrap();
                resolver.build_chain(&scope);
                resolver.matches_pattern(&scope, "org:acme:*").unwrap()
            });
            handles.push(handle);
        }

        for handle in handles {
            assert!(handle.join().unwrap());
        }

        let stats = resolver.stats();
        assert_eq!(stats.hits + stats.misses, 20); // 10 build_chain + 10 matches_pattern
    }
}
