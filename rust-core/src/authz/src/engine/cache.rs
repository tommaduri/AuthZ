//! Multi-level decision cache with LRU and optional Redis backend

use dashmap::DashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use blake3::Hasher;

use super::decision::{AuthRequest, AuthDecision};
use crate::error::{Result, AuthzError};

/// Cache configuration
#[derive(Debug, Clone)]
pub struct CacheConfig {
    /// Maximum number of entries in the cache
    pub capacity: usize,

    /// Time-to-live for cached decisions
    pub ttl: Duration,

    /// Enable Redis backend for distributed caching
    pub enable_redis: bool,

    /// Redis connection URL (if enabled)
    pub redis_url: Option<String>,
}

impl Default for CacheConfig {
    fn default() -> Self {
        Self {
            capacity: 10_000,
            ttl: Duration::from_secs(60),
            enable_redis: false,
            redis_url: None,
        }
    }
}

/// Cache key type (BLAKE3 hash)
type CacheKey = [u8; 32];

/// Cached entry with TTL
#[derive(Clone)]
struct CachedEntry {
    decision: AuthDecision,
    cached_at: Instant,
}

impl CachedEntry {
    fn new(decision: AuthDecision) -> Self {
        Self {
            decision,
            cached_at: Instant::now(),
        }
    }

    fn is_expired(&self, ttl: Duration) -> bool {
        self.cached_at.elapsed() > ttl
    }
}

/// Multi-level decision cache
///
/// Provides:
/// - In-memory LRU cache with DashMap (thread-safe, lock-free)
/// - TTL-based expiration
/// - Optional Redis backend for distributed caching
/// - BLAKE3 hashing for cache keys
pub struct DecisionCache {
    /// In-memory cache (thread-safe)
    memory_cache: Arc<DashMap<CacheKey, CachedEntry>>,

    /// Cache configuration
    config: CacheConfig,

    /// Cache statistics
    stats: Arc<DashMap<String, usize>>,
}

impl DecisionCache {
    /// Create a new decision cache
    pub async fn new(config: CacheConfig) -> Result<Self> {
        // TODO: Initialize Redis connection if enabled
        if config.enable_redis {
            // let redis_client = redis::Client::open(config.redis_url.as_ref().unwrap())?;
            // ... connect and test
        }

        Ok(Self {
            memory_cache: Arc::new(DashMap::new()),
            config,
            stats: Arc::new(DashMap::new()),
        })
    }

    /// Get a cached decision
    pub async fn get(&self, request: &AuthRequest) -> Option<AuthDecision> {
        let key = Self::compute_key(request);

        // Check memory cache
        if let Some(entry) = self.memory_cache.get(&key) {
            if entry.is_expired(self.config.ttl) {
                // Expired - remove and return None
                drop(entry);
                self.memory_cache.remove(&key);
                self.increment_stat("expirations");
                return None;
            }

            self.increment_stat("hits");
            return Some(entry.decision.clone());
        }

        // TODO: Check Redis if enabled

        self.increment_stat("misses");
        None
    }

    /// Store a decision in the cache
    pub async fn put(&self, request: &AuthRequest, decision: AuthDecision) {
        let key = Self::compute_key(request);

        // Evict old entries if at capacity
        if self.memory_cache.len() >= self.config.capacity {
            self.evict_oldest().await;
        }

        // Store in memory cache
        self.memory_cache.insert(key, CachedEntry::new(decision.clone()));

        // TODO: Store in Redis if enabled
    }

    /// Clear the entire cache
    pub async fn clear(&self) {
        self.memory_cache.clear();
        self.stats.clear();

        // TODO: Clear Redis if enabled
    }

    /// Get cache statistics
    pub async fn stats(&self) -> CacheStats {
        CacheStats {
            hits: self.get_stat("hits"),
            misses: self.get_stat("misses"),
            expirations: self.get_stat("expirations"),
            entries: self.memory_cache.len(),
            max_entries: self.config.capacity,
        }
    }

    /// Compute cache key from request
    fn compute_key(request: &AuthRequest) -> CacheKey {
        let mut hasher = Hasher::new();

        // Hash principal
        hasher.update(request.principal.id.as_bytes());

        // Hash principal roles (sorted)
        let mut roles = request.principal.roles.clone();
        roles.sort();
        for role in &roles {
            hasher.update(role.as_bytes());
        }

        // Hash principal attributes (sorted by key)
        let mut attrs: Vec<_> = request.principal.attributes.iter().collect();
        attrs.sort_by_key(|(k, _)| *k);
        for (k, v) in attrs {
            hasher.update(k.as_bytes());
            hasher.update(v.as_bytes());
        }

        // Hash resource
        hasher.update(request.resource.id.as_bytes());

        // Hash resource attributes (sorted by key)
        let mut attrs: Vec<_> = request.resource.attributes.iter().collect();
        attrs.sort_by_key(|(k, _)| *k);
        for (k, v) in attrs {
            hasher.update(k.as_bytes());
            hasher.update(v.as_bytes());
        }

        // Hash action
        hasher.update(request.action.name.as_bytes());

        *hasher.finalize().as_bytes()
    }

    /// Evict oldest entries (simple approximation)
    async fn evict_oldest(&self) {
        // Remove up to 10% of entries
        let to_remove = self.config.capacity / 10;
        let mut removed = 0;

        // Simple eviction: remove first N entries encountered
        // TODO: Implement proper LRU eviction
        self.memory_cache.retain(|_, _| {
            if removed < to_remove {
                removed += 1;
                false
            } else {
                true
            }
        });
    }

    fn increment_stat(&self, key: &str) {
        self.stats
            .entry(key.to_string())
            .and_modify(|count| *count += 1)
            .or_insert(1);
    }

    fn get_stat(&self, key: &str) -> usize {
        self.stats.get(key).map(|v| *v).unwrap_or(0)
    }
}

/// Cache statistics
#[derive(Debug, Clone)]
pub struct CacheStats {
    pub hits: usize,
    pub misses: usize,
    pub expirations: usize,
    pub entries: usize,
    pub max_entries: usize,
}

impl CacheStats {
    /// Calculate cache hit rate
    pub fn hit_rate(&self) -> f64 {
        let total = self.hits + self.misses;
        if total == 0 {
            0.0
        } else {
            self.hits as f64 / total as f64
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn create_test_request() -> AuthRequest {
        use super::super::decision::{RequestPrincipal, RequestResource, RequestAction};

        AuthRequest {
            principal: RequestPrincipal {
                id: "user:alice".to_string(),
                roles: vec!["employee".to_string()],
                attributes: HashMap::new(),
            },
            resource: RequestResource {
                id: "document:123".to_string(),
                attributes: HashMap::new(),
            },
            action: RequestAction::new("read"),
            context: HashMap::new(),
        }
    }

    #[tokio::test]
    async fn test_cache_creation() {
        let config = CacheConfig::default();
        let cache = DecisionCache::new(config).await.unwrap();

        let stats = cache.stats().await;
        assert_eq!(stats.entries, 0);
    }

    #[tokio::test]
    async fn test_cache_put_get() {
        let config = CacheConfig::default();
        let cache = DecisionCache::new(config).await.unwrap();

        let request = create_test_request();
        let decision = AuthDecision::allow(
            "policy-1".to_string(),
            "Test".to_string(),
            vec![],
        );

        // Initially not in cache
        assert!(cache.get(&request).await.is_none());

        // Put in cache
        cache.put(&request, decision.clone()).await;

        // Now in cache
        let cached = cache.get(&request).await;
        assert!(cached.is_some());
        assert_eq!(cached.unwrap().policy_id, "policy-1");

        let stats = cache.stats().await;
        assert_eq!(stats.hits, 1);
        assert_eq!(stats.misses, 1);
    }

    #[tokio::test]
    async fn test_cache_ttl() {
        let config = CacheConfig {
            ttl: Duration::from_millis(50),
            ..Default::default()
        };
        let cache = DecisionCache::new(config).await.unwrap();

        let request = create_test_request();
        let decision = AuthDecision::allow(
            "policy-1".to_string(),
            "Test".to_string(),
            vec![],
        );

        cache.put(&request, decision).await;

        // Immediately available
        assert!(cache.get(&request).await.is_some());

        // Wait for expiration
        tokio::time::sleep(Duration::from_millis(100)).await;

        // Should be expired
        assert!(cache.get(&request).await.is_none());

        let stats = cache.stats().await;
        assert!(stats.expirations > 0);
    }

    #[tokio::test]
    async fn test_cache_clear() {
        let config = CacheConfig::default();
        let cache = DecisionCache::new(config).await.unwrap();

        let request = create_test_request();
        let decision = AuthDecision::allow(
            "policy-1".to_string(),
            "Test".to_string(),
            vec![],
        );

        cache.put(&request, decision).await;
        assert_eq!(cache.stats().await.entries, 1);

        cache.clear().await;
        assert_eq!(cache.stats().await.entries, 0);
    }
}
