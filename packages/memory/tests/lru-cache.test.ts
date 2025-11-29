import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LRUCacheImpl } from '../src/cache/LRUCache.js';
import type { CacheConfig } from '../src/cache/types.js';

describe('LRUCache', () => {
  let cache: LRUCacheImpl<string>;
  const config: CacheConfig = {
    maxSize: 3,
    defaultTtl: 60000, // 1 minute
  };

  beforeEach(() => {
    cache = new LRUCacheImpl<string>(config);
  });

  describe('set and get', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined for non-existent keys', () => {
      expect(cache.get('non-existent')).toBeUndefined();
    });

    it('should update existing keys', () => {
      cache.set('key1', 'value1');
      cache.set('key1', 'value2');
      expect(cache.get('key1')).toBe('value2');
      expect(cache.size()).toBe(1);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used item when full', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Cache is now full (maxSize: 3)
      cache.set('key4', 'value4');

      // key1 should be evicted (least recently used)
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.size()).toBe(3);
    });

    it('should update recency on get', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Access key1 to make it most recently used
      cache.get('key1');

      // Add new item
      cache.set('key4', 'value4');

      // key2 should be evicted (now least recently used)
      expect(cache.get('key2')).toBeUndefined();
      expect(cache.get('key1')).toBe('value1');
    });

    it('should update recency on set', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Update key1
      cache.set('key1', 'updated');

      // Add new item
      cache.set('key4', 'value4');

      // key2 should be evicted
      expect(cache.get('key2')).toBeUndefined();
      expect(cache.get('key1')).toBe('updated');
    });
  });

  describe('has', () => {
    it('should return true for existing keys', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
    });

    it('should return false for non-existent keys', () => {
      expect(cache.has('non-existent')).toBe(false);
    });
  });

  describe('delete', () => {
    it('should remove items', () => {
      cache.set('key1', 'value1');
      const deleted = cache.delete('key1');

      expect(deleted).toBe(true);
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.size()).toBe(0);
    });

    it('should return false when deleting non-existent key', () => {
      expect(cache.delete('non-existent')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all items', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();

      expect(cache.size()).toBe(0);
      expect(cache.get('key1')).toBeUndefined();
    });
  });

  describe('peek', () => {
    it('should return value without updating recency', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Peek at key1 (should not update recency)
      expect(cache.peek('key1')).toBe('value1');

      // Add new item
      cache.set('key4', 'value4');

      // key1 should still be evicted (peek doesn't update recency)
      expect(cache.get('key1')).toBeUndefined();
    });
  });

  describe('getLRU and getMRU', () => {
    it('should return least recently used key', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      expect(cache.getLRU()).toBe('key1');
    });

    it('should return most recently used key', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      expect(cache.getMRU()).toBe('key3');
    });

    it('should return undefined for empty cache', () => {
      expect(cache.getLRU()).toBeUndefined();
      expect(cache.getMRU()).toBeUndefined();
    });
  });

  describe('TTL expiration', () => {
    it('should expire items after TTL', () => {
      vi.useFakeTimers();

      cache.set('key1', 'value1', 1000); // 1 second TTL

      expect(cache.get('key1')).toBe('value1');

      vi.advanceTimersByTime(1001);

      expect(cache.get('key1')).toBeUndefined();

      vi.useRealTimers();
    });

    it('should use default TTL if not specified', () => {
      vi.useFakeTimers();

      const shortTtlCache = new LRUCacheImpl<string>({
        maxSize: 10,
        defaultTtl: 500,
      });

      shortTtlCache.set('key1', 'value1');

      vi.advanceTimersByTime(501);

      expect(shortTtlCache.get('key1')).toBeUndefined();

      vi.useRealTimers();
    });
  });

  describe('stats', () => {
    it('should track hits and misses', () => {
      cache.set('key1', 'value1');

      cache.get('key1'); // Hit
      cache.get('key1'); // Hit
      cache.get('key2'); // Miss
      cache.get('key3'); // Miss

      const stats = cache.stats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBeCloseTo(0.5);
    });

    it('should track evictions', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      cache.set('key4', 'value4'); // Evicts key1

      const stats = cache.stats();
      expect(stats.evictions).toBe(1);
    });
  });

  describe('keys', () => {
    it('should return all keys', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      const keys = cache.keys();
      expect(keys).toHaveLength(3);
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys).toContain('key3');
    });
  });

  describe('onEvict callback', () => {
    it('should call onEvict when item is evicted', () => {
      const onEvict = vi.fn();
      const cacheWithCallback = new LRUCacheImpl<string>({
        maxSize: 2,
        onEvict,
      });

      cacheWithCallback.set('key1', 'value1');
      cacheWithCallback.set('key2', 'value2');
      cacheWithCallback.set('key3', 'value3'); // Evicts key1

      expect(onEvict).toHaveBeenCalledWith('key1', 'value1');
    });
  });

  describe('authorization decision caching', () => {
    it('should cache authorization decisions efficiently', () => {
      interface AuthzDecision {
        allowed: boolean;
        reason: string;
        policyId: string;
      }

      const authzCache = new LRUCacheImpl<AuthzDecision>({ maxSize: 1000 });

      // Cache a decision
      const cacheKey = 'user:123:resource:456:action:read';
      const decision: AuthzDecision = {
        allowed: true,
        reason: 'Policy matched',
        policyId: 'policy-1',
      };

      authzCache.set(cacheKey, decision);

      // Retrieve cached decision
      const cached = authzCache.get(cacheKey);
      expect(cached).toEqual(decision);

      // Check stats
      const stats = authzCache.stats();
      expect(stats.hits).toBe(1);
    });
  });
});
