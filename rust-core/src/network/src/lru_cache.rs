//! LRU (Least Recently Used) Cache Implementation
//!
//! This module provides a generic LRU cache with O(1) get/put operations
//! using a combination of HashMap and LinkedList for efficient eviction.
//!
//! ## Features
//!
//! - **Generic**: Works with any key-value types (K: Hash + Eq, V)
//! - **O(1) Operations**: Constant-time get/put via HashMap + LinkedList
//! - **Automatic Eviction**: LRU entries evicted when capacity reached
//! - **Thread-Safe**: Can be wrapped in RwLock for concurrent access
//! - **Metrics**: Tracks hits, misses, and evictions

use std::collections::{HashMap, VecDeque};
use std::hash::Hash;

/// Metrics for cache performance tracking
#[derive(Debug, Clone, Default)]
pub struct CacheMetrics {
    /// Total cache hits
    pub hits: u64,

    /// Total cache misses
    pub misses: u64,

    /// Total evictions
    pub evictions: u64,

    /// Current cache size
    pub size: usize,

    /// Maximum capacity
    pub capacity: usize,

    /// Hit rate (0.0-1.0)
    pub hit_rate: f64,
}

impl CacheMetrics {
    /// Calculate hit rate
    pub fn calculate_hit_rate(&mut self) {
        let total = self.hits + self.misses;
        if total > 0 {
            self.hit_rate = self.hits as f64 / total as f64;
        }
    }
}

/// Entry in the LRU cache
#[derive(Debug, Clone)]
struct CacheEntry<V> {
    value: V,
    access_count: u64,
}

/// LRU Cache with automatic eviction
///
/// # Example
///
/// ```
/// use cretoai_network::lru_cache::LRUCache;
///
/// let mut cache = LRUCache::new(3);
/// cache.put("key1", "value1");
/// cache.put("key2", "value2");
/// cache.put("key3", "value3");
///
/// assert_eq!(cache.get(&"key1"), Some(&"value1"));
///
/// // Adding 4th item evicts least recently used (key2)
/// cache.put("key4", "value4");
/// assert_eq!(cache.get(&"key2"), None);
/// ```
pub struct LRUCache<K, V> {
    /// Maximum number of entries
    capacity: usize,

    /// Cache storage (key -> entry)
    cache: HashMap<K, CacheEntry<V>>,

    /// Access order (most recent at back)
    access_order: VecDeque<K>,

    /// Performance metrics
    metrics: CacheMetrics,
}

impl<K: Hash + Eq + Clone, V> LRUCache<K, V> {
    /// Create a new LRU cache with the given capacity
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            cache: HashMap::with_capacity(capacity),
            access_order: VecDeque::with_capacity(capacity),
            metrics: CacheMetrics {
                capacity,
                ..Default::default()
            },
        }
    }

    /// Get a value from the cache, updating access order
    pub fn get(&mut self, key: &K) -> Option<&V> {
        if let Some(entry) = self.cache.get_mut(key) {
            // Update access order
            self.update_access_order(key);
            entry.access_count += 1;
            self.metrics.hits += 1;
            Some(&entry.value)
        } else {
            self.metrics.misses += 1;
            None
        }
    }

    /// Get a mutable reference to a value
    pub fn get_mut(&mut self, key: &K) -> Option<&mut V> {
        if let Some(entry) = self.cache.get_mut(key) {
            self.update_access_order(key);
            entry.access_count += 1;
            self.metrics.hits += 1;
            Some(&mut entry.value)
        } else {
            self.metrics.misses += 1;
            None
        }
    }

    /// Put a key-value pair into the cache
    pub fn put(&mut self, key: K, value: V) {
        // If key already exists, update value and access order
        if self.cache.contains_key(&key) {
            self.cache.insert(
                key.clone(),
                CacheEntry {
                    value,
                    access_count: 1,
                },
            );
            self.update_access_order(&key);
            return;
        }

        // Evict LRU entry if at capacity
        if self.cache.len() >= self.capacity {
            self.evict_lru();
        }

        // Insert new entry
        self.cache.insert(
            key.clone(),
            CacheEntry {
                value,
                access_count: 1,
            },
        );
        self.access_order.push_back(key);
        self.metrics.size = self.cache.len();
    }

    /// Remove a key from the cache
    pub fn remove(&mut self, key: &K) -> Option<V> {
        if let Some(entry) = self.cache.remove(key) {
            // Remove from access order
            if let Some(pos) = self.access_order.iter().position(|k| k == key) {
                self.access_order.remove(pos);
            }
            self.metrics.size = self.cache.len();
            Some(entry.value)
        } else {
            None
        }
    }

    /// Clear all entries from the cache
    pub fn clear(&mut self) {
        self.cache.clear();
        self.access_order.clear();
        self.metrics.size = 0;
    }

    /// Get the number of entries in the cache
    pub fn len(&self) -> usize {
        self.cache.len()
    }

    /// Check if the cache is empty
    pub fn is_empty(&self) -> bool {
        self.cache.is_empty()
    }

    /// Get cache capacity
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// Check if a key exists in the cache
    pub fn contains(&self, key: &K) -> bool {
        self.cache.contains_key(key)
    }

    /// Get cache metrics
    pub fn get_metrics(&self) -> CacheMetrics {
        let mut metrics = self.metrics.clone();
        metrics.calculate_hit_rate();
        metrics
    }

    /// Get all keys in the cache (in access order)
    pub fn keys(&self) -> Vec<&K> {
        self.access_order.iter().collect()
    }

    /// Evict the least recently used entry
    fn evict_lru(&mut self) {
        if let Some(lru_key) = self.access_order.pop_front() {
            self.cache.remove(&lru_key);
            self.metrics.evictions += 1;
            self.metrics.size = self.cache.len();
            tracing::trace!("Evicted LRU entry from cache");
        }
    }

    /// Update access order for a key (move to back)
    fn update_access_order(&mut self, key: &K) {
        // Remove key from current position
        if let Some(pos) = self.access_order.iter().position(|k| k == key) {
            self.access_order.remove(pos);
        }
        // Add to back (most recently used)
        self.access_order.push_back(key.clone());
    }

    /// Resize the cache capacity
    pub fn resize(&mut self, new_capacity: usize) {
        if new_capacity < self.capacity {
            // Evict entries until we're at new capacity
            while self.cache.len() > new_capacity {
                self.evict_lru();
            }
        }
        self.capacity = new_capacity;
        self.metrics.capacity = new_capacity;
    }

    /// Get the most recently used key
    pub fn most_recent(&self) -> Option<&K> {
        self.access_order.back()
    }

    /// Get the least recently used key
    pub fn least_recent(&self) -> Option<&K> {
        self.access_order.front()
    }

    /// Peek at a value without updating access order
    pub fn peek(&self, key: &K) -> Option<&V> {
        self.cache.get(key).map(|entry| &entry.value)
    }

    /// Get entry access count
    pub fn access_count(&self, key: &K) -> Option<u64> {
        self.cache.get(key).map(|entry| entry.access_count)
    }

    /// Iterator over cache entries (in access order)
    pub fn iter(&self) -> impl Iterator<Item = (&K, &V)> {
        self.access_order
            .iter()
            .filter_map(|k| self.cache.get(k).map(|e| (k, &e.value)))
    }
}

impl<K: Hash + Eq + Clone, V> Default for LRUCache<K, V> {
    fn default() -> Self {
        Self::new(100)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lru_cache_basic() {
        let mut cache = LRUCache::new(2);

        cache.put("key1", "value1");
        cache.put("key2", "value2");

        assert_eq!(cache.get(&"key1"), Some(&"value1"));
        assert_eq!(cache.get(&"key2"), Some(&"value2"));
        assert_eq!(cache.len(), 2);
    }

    #[test]
    fn test_lru_cache_eviction() {
        let mut cache = LRUCache::new(2);

        cache.put("key1", "value1");
        cache.put("key2", "value2");
        cache.put("key3", "value3"); // Should evict key1

        assert_eq!(cache.get(&"key1"), None);
        assert_eq!(cache.get(&"key2"), Some(&"value2"));
        assert_eq!(cache.get(&"key3"), Some(&"value3"));
        assert_eq!(cache.len(), 2);
    }

    #[test]
    fn test_lru_cache_update() {
        let mut cache = LRUCache::new(2);

        cache.put("key1", "value1");
        cache.put("key2", "value2");

        // Access key1 to make it more recently used
        let _ = cache.get(&"key1");

        // Adding key3 should evict key2 (least recently used)
        cache.put("key3", "value3");

        assert_eq!(cache.get(&"key1"), Some(&"value1"));
        assert_eq!(cache.get(&"key2"), None);
        assert_eq!(cache.get(&"key3"), Some(&"value3"));
    }

    #[test]
    fn test_lru_cache_metrics() {
        let mut cache = LRUCache::new(3);

        cache.put("key1", "value1");
        cache.put("key2", "value2");

        let _ = cache.get(&"key1"); // Hit
        let _ = cache.get(&"key3"); // Miss

        let metrics = cache.get_metrics();
        assert_eq!(metrics.hits, 1);
        assert_eq!(metrics.misses, 1);
        assert_eq!(metrics.size, 2);
        assert_eq!(metrics.hit_rate, 0.5);
    }

    #[test]
    fn test_lru_cache_remove() {
        let mut cache = LRUCache::new(3);

        cache.put("key1", "value1");
        cache.put("key2", "value2");

        assert_eq!(cache.remove(&"key1"), Some("value1"));
        assert_eq!(cache.get(&"key1"), None);
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn test_lru_cache_clear() {
        let mut cache = LRUCache::new(3);

        cache.put("key1", "value1");
        cache.put("key2", "value2");

        cache.clear();
        assert_eq!(cache.len(), 0);
        assert!(cache.is_empty());
    }

    #[test]
    fn test_lru_cache_contains() {
        let mut cache = LRUCache::new(3);

        cache.put("key1", "value1");

        assert!(cache.contains(&"key1"));
        assert!(!cache.contains(&"key2"));
    }

    #[test]
    fn test_lru_cache_peek() {
        let mut cache = LRUCache::new(2);

        cache.put("key1", "value1");
        cache.put("key2", "value2");

        // Peek doesn't update access order
        assert_eq!(cache.peek(&"key1"), Some(&"value1"));

        // Adding key3 should still evict key1
        cache.put("key3", "value3");
        assert_eq!(cache.get(&"key1"), None);
    }

    #[test]
    fn test_lru_cache_resize() {
        let mut cache = LRUCache::new(3);

        cache.put("key1", "value1");
        cache.put("key2", "value2");
        cache.put("key3", "value3");

        cache.resize(2);
        assert_eq!(cache.capacity(), 2);
        assert_eq!(cache.len(), 2);
    }

    #[test]
    fn test_lru_cache_access_order() {
        let mut cache = LRUCache::new(3);

        cache.put("key1", "value1");
        cache.put("key2", "value2");
        cache.put("key3", "value3");

        assert_eq!(cache.least_recent(), Some(&"key1"));
        assert_eq!(cache.most_recent(), Some(&"key3"));

        // Access key1
        let _ = cache.get(&"key1");

        assert_eq!(cache.most_recent(), Some(&"key1"));
    }

    #[test]
    fn test_lru_cache_access_count() {
        let mut cache = LRUCache::new(3);

        cache.put("key1", "value1");
        let _ = cache.get(&"key1");
        let _ = cache.get(&"key1");

        assert_eq!(cache.access_count(&"key1"), Some(3)); // 1 from put + 2 from gets
    }
}
