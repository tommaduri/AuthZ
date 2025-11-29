import { describe, it, expect, beforeEach } from 'vitest';
import { DerivedRolesCache } from '../../../src/derived-roles/cache';

describe('DerivedRolesCache', () => {
  let cache: DerivedRolesCache;

  beforeEach(() => {
    cache = new DerivedRolesCache();
  });

  describe('Per-Request Caching', () => {
    it('should cache computed results', () => {
      const compute = vi.fn(() => ['role1', 'role2']);

      const result1 = cache.getOrCompute('key1', compute);
      const result2 = cache.getOrCompute('key1', compute);

      expect(result1).toEqual(['role1', 'role2']);
      expect(result2).toEqual(['role1', 'role2']);
      expect(compute).toHaveBeenCalledTimes(1);
    });

    it('should compute different keys independently', () => {
      const compute1 = vi.fn(() => ['role1']);
      const compute2 = vi.fn(() => ['role2']);

      const result1 = cache.getOrCompute('key1', compute1);
      const result2 = cache.getOrCompute('key2', compute2);

      expect(result1).toEqual(['role1']);
      expect(result2).toEqual(['role2']);
      expect(compute1).toHaveBeenCalledTimes(1);
      expect(compute2).toHaveBeenCalledTimes(1);
    });

    it('should handle empty role arrays', () => {
      const compute = vi.fn(() => []);

      const result1 = cache.getOrCompute('key1', compute);
      const result2 = cache.getOrCompute('key1', compute);

      expect(result1).toEqual([]);
      expect(result2).toEqual([]);
      expect(compute).toHaveBeenCalledTimes(1);
    });

    it('should track cache hits and misses', () => {
      const compute = vi.fn(() => ['role1']);

      cache.getOrCompute('key1', compute); // Miss
      cache.getOrCompute('key1', compute); // Hit
      cache.getOrCompute('key2', compute); // Miss
      cache.getOrCompute('key1', compute); // Hit

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.size).toBe(2);
    });

    it('should calculate hit rate correctly', () => {
      const compute = vi.fn(() => ['role1']);

      cache.getOrCompute('key1', compute); // Miss
      cache.getOrCompute('key1', compute); // Hit
      cache.getOrCompute('key1', compute); // Hit
      cache.getOrCompute('key1', compute); // Hit

      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0.75); // 3 hits / 4 total
    });
  });

  describe('Cache Invalidation', () => {
    it('should clear cache', () => {
      const compute = vi.fn(() => ['role1']);

      cache.getOrCompute('key1', compute);
      cache.getOrCompute('key2', compute);

      expect(cache.getStats().size).toBe(2);

      cache.clear();

      expect(cache.getStats().size).toBe(0);
      expect(cache.getStats().hits).toBe(0);
      expect(cache.getStats().misses).toBe(0);
    });

    it('should recompute after clear', () => {
      const compute = vi.fn(() => ['role1']);

      cache.getOrCompute('key1', compute);
      cache.clear();
      cache.getOrCompute('key1', compute);

      expect(compute).toHaveBeenCalledTimes(2);
    });

    it('should reset statistics on clear', () => {
      const compute = vi.fn(() => ['role1']);

      cache.getOrCompute('key1', compute);
      cache.getOrCompute('key1', compute);

      let stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);

      cache.clear();

      stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });
  });

  describe('Performance Verification', () => {
    it('should generate consistent cache keys', () => {
      const key1 = DerivedRolesCache.generateKey('user1', ['role1', 'role2'], 'document', 'doc1');
      const key2 = DerivedRolesCache.generateKey('user1', ['role1', 'role2'], 'document', 'doc1');

      expect(key1).toBe(key2);
    });

    it('should generate different keys for different principals', () => {
      const key1 = DerivedRolesCache.generateKey('user1', ['role1'], 'document', 'doc1');
      const key2 = DerivedRolesCache.generateKey('user2', ['role1'], 'document', 'doc1');

      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different roles', () => {
      const key1 = DerivedRolesCache.generateKey('user1', ['role1'], 'document', 'doc1');
      const key2 = DerivedRolesCache.generateKey('user1', ['role2'], 'document', 'doc1');

      expect(key1).not.toBe(key2);
    });

    it('should sort roles for consistent keys', () => {
      const key1 = DerivedRolesCache.generateKey('user1', ['role1', 'role2'], 'document', 'doc1');
      const key2 = DerivedRolesCache.generateKey('user1', ['role2', 'role1'], 'document', 'doc1');

      expect(key1).toBe(key2);
    });

    it('should handle large number of cache entries efficiently', () => {
      const compute = () => ['role1'];
      const startTime = performance.now();

      // Cache 1000 entries
      for (let i = 0; i < 1000; i++) {
        cache.getOrCompute(`key${i}`, compute);
      }

      const insertTime = performance.now() - startTime;

      // Retrieve all entries (should be fast)
      const retrieveStart = performance.now();
      for (let i = 0; i < 1000; i++) {
        cache.getOrCompute(`key${i}`, compute);
      }
      const retrieveTime = performance.now() - retrieveStart;

      expect(cache.getStats().size).toBe(1000);
      expect(cache.getStats().hits).toBe(1000);
      expect(cache.getStats().misses).toBe(1000);
      expect(retrieveTime).toBeLessThan(insertTime); // Retrieval should be faster
    });

    it('should maintain O(1) lookup performance', () => {
      const compute = () => ['role1'];

      // Warm up cache with 100 entries
      for (let i = 0; i < 100; i++) {
        cache.getOrCompute(`key${i}`, compute);
      }

      // Measure lookup time
      const iterations = 1000;
      const startTime = performance.now();
      for (let i = 0; i < iterations; i++) {
        cache.getOrCompute('key50', compute); // Lookup middle entry
      }
      const totalTime = performance.now() - startTime;
      const avgTime = totalTime / iterations;

      expect(avgTime).toBeLessThan(0.01); // < 0.01ms per lookup
    });

    it('should handle concurrent-like access patterns', () => {
      const compute = vi.fn(() => ['role1']);

      // Simulate multiple "concurrent" requests for same key
      const results = [];
      for (let i = 0; i < 10; i++) {
        results.push(cache.getOrCompute('key1', compute));
      }

      // All results should be identical
      expect(results.every(r => r[0] === 'role1')).toBe(true);
      expect(compute).toHaveBeenCalledTimes(1); // Only computed once
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero hits and misses', () => {
      const stats = cache.getStats();

      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
      expect(stats.size).toBe(0);
    });

    it('should handle special characters in keys', () => {
      const compute = vi.fn(() => ['role1']);

      const key1 = cache.getOrCompute('user@example.com:role1,role2:document:doc-123', compute);
      const key2 = cache.getOrCompute('user@example.com:role1,role2:document:doc-123', compute);

      expect(key1).toEqual(key2);
      expect(compute).toHaveBeenCalledTimes(1);
    });

    it('should handle very long keys', () => {
      const compute = vi.fn(() => ['role1']);
      const longKey = 'key' + 'x'.repeat(1000);

      const result1 = cache.getOrCompute(longKey, compute);
      const result2 = cache.getOrCompute(longKey, compute);

      expect(result1).toEqual(result2);
      expect(compute).toHaveBeenCalledTimes(1);
    });

    it('should handle empty principal roles array in key generation', () => {
      const key = DerivedRolesCache.generateKey('user1', [], 'document', 'doc1');

      expect(key).toBe('user1::document:doc1');
    });

    it('should handle role arrays with many roles in key generation', () => {
      const roles = Array.from({ length: 50 }, (_, i) => `role${i}`);
      const key = DerivedRolesCache.generateKey('user1', roles, 'document', 'doc1');

      expect(key).toContain('user1:');
      expect(key).toContain(':document:doc1');
    });
  });
});
