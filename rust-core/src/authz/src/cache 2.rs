//! LRU caching for authorization decisions

use crate::types::{AuthzRequest, Decision};
use lru::LruCache;
use std::num::NonZeroUsize;
use std::sync::Arc;
use tokio::sync::Mutex;
use blake3::Hasher;

/// Cache key for authorization requests
type CacheKey = [u8; 32];  // BLAKE3 hash

/// Authorization decision cache
pub struct AuthzCache {
    cache: Arc<Mutex<LruCache<CacheKey, Decision>>>,
}

impl AuthzCache {
    /// Create a new cache with the specified capacity
    pub fn new(capacity: usize) -> Self {
        let capacity = NonZeroUsize::new(capacity).unwrap_or(NonZeroUsize::new(1000).unwrap());

        Self {
            cache: Arc::new(Mutex::new(LruCache::new(capacity))),
        }
    }

    /// Compute cache key for a request
    fn compute_key(request: &AuthzRequest) -> CacheKey {
        let mut hasher = Hasher::new();
        hasher.update(request.principal.id.as_bytes());
        hasher.update(request.resource.id.as_bytes());
        hasher.update(request.action.name.as_bytes());

        // Include principal attributes
        let mut attrs: Vec<_> = request.principal.attributes.iter().collect();
        attrs.sort_by_key(|(k, _)| *k);
        for (k, v) in attrs {
            hasher.update(k.as_bytes());
            hasher.update(v.as_bytes());
        }

        // Include resource attributes
        let mut attrs: Vec<_> = request.resource.attributes.iter().collect();
        attrs.sort_by_key(|(k, _)| *k);
        for (k, v) in attrs {
            hasher.update(k.as_bytes());
            hasher.update(v.as_bytes());
        }

        *hasher.finalize().as_bytes()
    }

    /// Get a cached decision
    pub async fn get(&self, request: &AuthzRequest) -> Option<Decision> {
        let key = Self::compute_key(request);
        let mut cache = self.cache.lock().await;
        cache.get(&key).cloned()
    }

    /// Store a decision in the cache
    pub async fn put(&self, request: &AuthzRequest, decision: Decision) {
        let key = Self::compute_key(request);
        let mut cache = self.cache.lock().await;
        cache.put(key, decision);
    }

    /// Clear the cache
    pub async fn clear(&self) {
        let mut cache = self.cache.lock().await;
        cache.clear();
    }

    /// Get cache statistics
    pub async fn len(&self) -> usize {
        let cache = self.cache.lock().await;
        cache.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Principal, Resource, Action};
    use std::collections::HashMap;

    #[tokio::test]
    async fn test_cache_operations() {
        let cache = AuthzCache::new(10);

        let request = AuthzRequest {
            principal: Principal::new("user:alice@example.com"),
            resource: Resource::new("document:123"),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        let decision = Decision::allow("policy-1", "User has permission");

        // Initially empty
        assert!(cache.get(&request).await.is_none());

        // Store decision
        cache.put(&request, decision.clone()).await;

        // Retrieve decision
        let cached = cache.get(&request).await;
        assert!(cached.is_some());
        assert_eq!(cached.unwrap().policy_id, "policy-1");

        // Cache size
        assert_eq!(cache.len().await, 1);

        // Clear cache
        cache.clear().await;
        assert_eq!(cache.len().await, 0);
    }

    #[tokio::test]
    async fn test_cache_key_consistency() {
        let request1 = AuthzRequest {
            principal: Principal::new("user:alice@example.com"),
            resource: Resource::new("document:123"),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        let request2 = AuthzRequest {
            principal: Principal::new("user:alice@example.com"),
            resource: Resource::new("document:123"),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        let key1 = AuthzCache::compute_key(&request1);
        let key2 = AuthzCache::compute_key(&request2);

        assert_eq!(key1, key2, "Same requests should produce same cache key");
    }
}
