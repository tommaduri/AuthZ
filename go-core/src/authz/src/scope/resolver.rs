//! Scope resolution and pattern matching with caching

use super::types::{Scope, ScopeError};
use dashmap::DashMap;
use regex::Regex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Configuration for the scope resolver
#[derive(Debug, Clone)]
pub struct ScopeConfig {
    /// Maximum depth of scope hierarchy
    pub max_depth: usize,

    /// Allow wildcard patterns in scope matching
    pub allow_wildcards: bool,

    /// Time-to-live for cache entries
    pub cache_ttl: Duration,

    /// Regex for validating scope segment characters
    pub allowed_chars_regex: Regex,

    /// Maximum number of entries in the scope chain cache
    pub max_cache_size: usize,
}

impl Default for ScopeConfig {
    fn default() -> Self {
        Self {
            max_depth: 10,
            allow_wildcards: true,
            cache_ttl: Duration::from_secs(60),
            allowed_chars_regex: Regex::new(r"^[a-zA-Z0-9_-]+$").unwrap(),
            max_cache_size: 10_000,
        }
    }
}

/// Cache statistics for monitoring performance
#[derive(Debug, Clone, Default)]
pub struct CacheStats {
    pub size: usize,
    pub hit_count: u64,
    pub miss_count: u64,
    pub hit_rate: f64,
}

/// Entry in the scope chain cache with expiration
#[derive(Debug, Clone)]
struct ChainEntry {
    chain: Vec<String>,
    expires_at: u64,
}

/// Scope resolver handles hierarchical scope resolution and pattern matching
///
/// # Thread Safety
///
/// ScopeResolver uses DashMap for thread-safe caching and can be safely
/// shared across threads.
///
/// # Examples
///
/// ```
/// use authz::{ScopeResolver, ScopeConfig};
///
/// let resolver = ScopeResolver::new(ScopeConfig::default());
///
/// // Build scope chain
/// let chain = resolver.build_scope_chain("org.acme.dept.engineering").unwrap();
/// assert_eq!(chain, vec![
///     "org.acme.dept.engineering",
///     "org.acme.dept",
///     "org.acme",
///     "org"
/// ]);
///
/// // Pattern matching
/// assert!(resolver.match_scope("org.acme.*", "org.acme.dept"));
/// assert!(resolver.match_scope("org.acme.**", "org.acme.dept.engineering"));
/// ```
pub struct ScopeResolver {
    config: ScopeConfig,
    chain_cache: DashMap<String, ChainEntry>,
    hit_count: AtomicU64,
    miss_count: AtomicU64,
}

impl ScopeResolver {
    /// Creates a new scope resolver with the given configuration
    pub fn new(config: ScopeConfig) -> Self {
        Self {
            config,
            chain_cache: DashMap::new(),
            hit_count: AtomicU64::new(0),
            miss_count: AtomicU64::new(0),
        }
    }

    /// Builds the inheritance chain from most to least specific
    ///
    /// Example: "org.acme.dept.engineering" ->
    /// ["org.acme.dept.engineering", "org.acme.dept", "org.acme", "org"]
    ///
    /// # Arguments
    ///
    /// * `scope` - The scope string to build a chain for
    ///
    /// # Errors
    ///
    /// Returns `ScopeError` if:
    /// - Scope depth exceeds maximum
    /// - Scope contains empty segments
    /// - Segments contain invalid characters
    pub fn build_scope_chain(&self, scope: &str) -> Result<Vec<String>, ScopeError> {
        if scope.is_empty() {
            return Ok(Vec::new());
        }

        // Check cache first
        let now = current_timestamp_ms();
        if let Some(entry) = self.chain_cache.get(scope) {
            if entry.expires_at > now {
                self.hit_count.fetch_add(1, Ordering::Relaxed);
                return Ok(entry.chain.clone());
            }
        }

        self.miss_count.fetch_add(1, Ordering::Relaxed);

        // Parse and validate scope
        let parsed_scope = Scope::new(scope)?;
        let segments = parsed_scope.segments();

        // Check depth
        if segments.len() > self.config.max_depth {
            return Err(ScopeError::DepthExceeded {
                depth: segments.len(),
                max_depth: self.config.max_depth,
            });
        }

        // Validate each segment
        for segment in segments {
            Scope::validate_segment(segment, &self.config.allowed_chars_regex)?;
        }

        // Build chain from most to least specific
        let mut chain = Vec::with_capacity(segments.len());
        for i in (1..=segments.len()).rev() {
            chain.push(segments[..i].join("."));
        }

        // Cache the result
        let expires_at = now + self.config.cache_ttl.as_millis() as u64;
        self.chain_cache.insert(
            scope.to_string(),
            ChainEntry {
                chain: chain.clone(),
                expires_at,
            },
        );

        // Evict old entries if cache is too large
        if self.chain_cache.len() > self.config.max_cache_size {
            self.evict_expired_entries();
        }

        Ok(chain)
    }

    /// Matches a pattern against a scope with wildcard support
    ///
    /// Supports:
    /// - `*` matches a single segment (e.g., "org.*.dept")
    /// - `**` matches zero or more segments (e.g., "org.**")
    ///
    /// # Arguments
    ///
    /// * `pattern` - Pattern to match (may contain wildcards)
    /// * `scope` - Scope to match against
    ///
    /// # Examples
    ///
    /// ```
    /// use authz::{ScopeResolver, ScopeConfig};
    ///
    /// let resolver = ScopeResolver::new(ScopeConfig::default());
    ///
    /// assert!(resolver.match_scope("org.acme", "org.acme"));
    /// assert!(resolver.match_scope("org.*", "org.acme"));
    /// assert!(resolver.match_scope("org.**", "org.acme.dept"));
    /// assert!(!resolver.match_scope("org.*", "org.acme.dept"));
    /// ```
    pub fn match_scope(&self, pattern: &str, scope: &str) -> bool {
        // Exact match
        if pattern == scope {
            return true;
        }

        if !self.config.allow_wildcards {
            return false;
        }

        // Build regex from pattern
        let regex_pattern = self.pattern_to_regex(pattern);

        match Regex::new(&regex_pattern) {
            Ok(regex) => regex.is_match(scope),
            Err(_) => false,
        }
    }

    /// Validates a scope string
    ///
    /// # Errors
    ///
    /// Returns `ScopeError` if validation fails
    pub fn validate_scope(&self, scope: &str) -> Result<(), ScopeError> {
        if scope.is_empty() {
            return Ok(());
        }

        let parsed = Scope::new(scope)?;
        let segments = parsed.segments();

        if segments.len() > self.config.max_depth {
            return Err(ScopeError::DepthExceeded {
                depth: segments.len(),
                max_depth: self.config.max_depth,
            });
        }

        for segment in segments {
            Scope::validate_segment(segment, &self.config.allowed_chars_regex)?;
        }

        Ok(())
    }

    /// Clears the scope chain cache and resets statistics
    pub fn clear_cache(&self) {
        self.chain_cache.clear();
        self.hit_count.store(0, Ordering::Relaxed);
        self.miss_count.store(0, Ordering::Relaxed);
    }

    /// Returns cache statistics
    pub fn get_stats(&self) -> CacheStats {
        let size = self.chain_cache.len();
        let hits = self.hit_count.load(Ordering::Relaxed);
        let misses = self.miss_count.load(Ordering::Relaxed);
        let total = hits + misses;
        let hit_rate = if total > 0 {
            hits as f64 / total as f64
        } else {
            0.0
        };

        CacheStats {
            size,
            hit_count: hits,
            miss_count: misses,
            hit_rate,
        }
    }

    /// Converts a wildcard pattern to a regex pattern
    fn pattern_to_regex(&self, pattern: &str) -> String {
        let mut regex = regex::escape(pattern);

        // Handle double wildcard (matches multiple segments including none)
        // Replace .\*\* with (\..*)?
        regex = regex.replace(r"\.\*\*", r"(\..*)?");
        regex = regex.replace(r"\*\*", ".*");

        // Handle single wildcard (matches single segment)
        regex = regex.replace(r"\*", r"[^.]+");

        format!("^{}$", regex)
    }

    /// Evicts expired entries from the cache
    fn evict_expired_entries(&self) {
        let now = current_timestamp_ms();
        self.chain_cache.retain(|_, entry| entry.expires_at > now);
    }
}

/// Returns current timestamp in milliseconds
fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_scope_chain() {
        let resolver = ScopeResolver::new(ScopeConfig::default());

        let chain = resolver.build_scope_chain("org.acme.dept.engineering").unwrap();
        assert_eq!(
            chain,
            vec![
                "org.acme.dept.engineering",
                "org.acme.dept",
                "org.acme",
                "org"
            ]
        );
    }

    #[test]
    fn test_build_scope_chain_caching() {
        let resolver = ScopeResolver::new(ScopeConfig::default());

        // First call - cache miss
        let _chain1 = resolver.build_scope_chain("org.acme.dept").unwrap();
        let stats1 = resolver.get_stats();
        assert_eq!(stats1.miss_count, 1);

        // Second call - cache hit
        let _chain2 = resolver.build_scope_chain("org.acme.dept").unwrap();
        let stats2 = resolver.get_stats();
        assert_eq!(stats2.hit_count, 1);
    }

    #[test]
    fn test_match_scope_exact() {
        let resolver = ScopeResolver::new(ScopeConfig::default());
        assert!(resolver.match_scope("org.acme", "org.acme"));
        assert!(!resolver.match_scope("org.acme", "org.beta"));
    }

    #[test]
    fn test_match_scope_single_wildcard() {
        let resolver = ScopeResolver::new(ScopeConfig::default());

        assert!(resolver.match_scope("org.*", "org.acme"));
        assert!(!resolver.match_scope("org.*", "org.acme.dept"));
        assert!(resolver.match_scope("org.*.dept", "org.acme.dept"));
    }

    #[test]
    fn test_match_scope_double_wildcard() {
        let resolver = ScopeResolver::new(ScopeConfig::default());

        assert!(resolver.match_scope("org.**", "org.acme.dept.engineering"));
        assert!(resolver.match_scope("org.**", "org.acme"));
        assert!(resolver.match_scope("org.**", "org"));
        assert!(resolver.match_scope("org.**.dev", "org.acme.dept.dev"));
    }

    #[test]
    fn test_validate_scope() {
        let resolver = ScopeResolver::new(ScopeConfig::default());

        assert!(resolver.validate_scope("org.acme.dept").is_ok());
        assert!(resolver.validate_scope("").is_ok());
        assert!(resolver.validate_scope("org-name.dept_1").is_ok());
        assert!(resolver.validate_scope("org..dept").is_err());
    }

    #[test]
    fn test_cache_ttl() {
        let mut config = ScopeConfig::default();
        config.cache_ttl = Duration::from_millis(50);
        let resolver = ScopeResolver::new(config);

        // Build and cache
        let _chain1 = resolver.build_scope_chain("org.acme").unwrap();
        let stats1 = resolver.get_stats();
        assert_eq!(stats1.miss_count, 1);

        // Immediate hit
        let _chain2 = resolver.build_scope_chain("org.acme").unwrap();
        let stats2 = resolver.get_stats();
        assert_eq!(stats2.hit_count, 1);

        // Wait for expiration
        std::thread::sleep(Duration::from_millis(100));

        // Should be miss again
        let _chain3 = resolver.build_scope_chain("org.acme").unwrap();
        let stats3 = resolver.get_stats();
        assert_eq!(stats3.miss_count, 2);
    }

    #[test]
    fn test_max_depth() {
        let mut config = ScopeConfig::default();
        config.max_depth = 3;
        let resolver = ScopeResolver::new(config);

        assert!(resolver.build_scope_chain("a.b.c").is_ok());
        assert!(resolver.build_scope_chain("a.b.c.d").is_err());
    }

    #[test]
    fn test_clear_cache() {
        let resolver = ScopeResolver::new(ScopeConfig::default());

        resolver.build_scope_chain("org.acme").unwrap();
        let stats1 = resolver.get_stats();
        assert!(stats1.size > 0);

        resolver.clear_cache();
        let stats2 = resolver.get_stats();
        assert_eq!(stats2.size, 0);
        assert_eq!(stats2.hit_count, 0);
        assert_eq!(stats2.miss_count, 0);
    }
}
