/**
 * @fileoverview Unit tests for ExpressionCache
 * Tests compilation caching, hit rate tracking, and performance
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExpressionCache } from '../../../src/variables/cache';

describe('ExpressionCache', () => {
  let cache: ExpressionCache;

  beforeEach(() => {
    cache = new ExpressionCache();
  });

  describe('getOrCompile', () => {
    it('should compile and cache new expression', () => {
      const expr = 'principal.role === "admin"';
      const compiled = cache.getOrCompile(expr);

      expect(compiled).toBe(expr);
      expect(cache.getCacheStats().misses).toBe(1);
      expect(cache.getCacheStats().hits).toBe(0);
    });

    it('should return cached expression on second access', () => {
      const expr = 'principal.role === "admin"';

      const compiled1 = cache.getOrCompile(expr);
      const compiled2 = cache.getOrCompile(expr);

      expect(compiled1).toBe(compiled2);
      expect(cache.getCacheStats().hits).toBe(1);
      expect(cache.getCacheStats().misses).toBe(1);
    });

    it('should cache multiple different expressions', () => {
      const expr1 = 'principal.role === "admin"';
      const expr2 = 'resource.ownerId === principal.id';
      const expr3 = 'true';

      cache.getOrCompile(expr1);
      cache.getOrCompile(expr2);
      cache.getOrCompile(expr3);

      expect(cache.getCacheStats().misses).toBe(3);
    });

    it('should distinguish between similar expressions', () => {
      const expr1 = 'principal.role === "admin"';
      const expr2 = 'principal.role === "user"';

      const compiled1 = cache.getOrCompile(expr1);
      const compiled2 = cache.getOrCompile(expr2);

      expect(compiled1).not.toBe(compiled2);
      expect(cache.getCacheStats().misses).toBe(2);
    });

    it('should handle complex expressions', () => {
      const expr = '(principal.role === "admin" || resource.ownerId === principal.id) && resource.status === "active"';

      const compiled = cache.getOrCompile(expr);

      expect(compiled).toBe(expr);
    });

    it('should handle empty expression', () => {
      const expr = '';
      const compiled = cache.getOrCompile(expr);

      expect(compiled).toBe('');
    });

    it('should handle whitespace-only expression', () => {
      const expr = '   ';
      const compiled = cache.getOrCompile(expr);

      expect(compiled).toBe(expr);
    });
  });

  describe('getCacheStats', () => {
    it('should return initial stats with zero hits and misses', () => {
      const stats = cache.getCacheStats();

      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it('should track cache hits correctly', () => {
      const expr = 'principal.role === "admin"';

      cache.getOrCompile(expr); // miss
      cache.getOrCompile(expr); // hit
      cache.getOrCompile(expr); // hit

      const stats = cache.getCacheStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });

    it('should track cache misses correctly', () => {
      cache.getOrCompile('expr1');
      cache.getOrCompile('expr2');
      cache.getOrCompile('expr3');

      const stats = cache.getCacheStats();
      expect(stats.misses).toBe(3);
      expect(stats.hits).toBe(0);
    });

    it('should calculate hit rate correctly', () => {
      const expr = 'test';

      cache.getOrCompile(expr); // miss
      cache.getOrCompile(expr); // hit
      cache.getOrCompile(expr); // hit
      cache.getOrCompile(expr); // hit

      const stats = cache.getCacheStats();
      expect(stats.hitRate).toBe(0.75); // 3 hits / 4 total
    });

    it('should calculate hit rate > 99% for typical usage', () => {
      const expr = 'principal.role === "admin"';

      // 1 miss + 99 hits = 99% hit rate
      cache.getOrCompile(expr); // miss
      for (let i = 0; i < 99; i++) {
        cache.getOrCompile(expr); // hit
      }

      const stats = cache.getCacheStats();
      expect(stats.hitRate).toBeGreaterThanOrEqual(0.99);
      expect(stats.hits).toBe(99);
      expect(stats.misses).toBe(1);
    });

    it('should calculate hit rate > 99% with multiple expressions', () => {
      const expr1 = 'expr1';
      const expr2 = 'expr2';

      // 2 misses
      cache.getOrCompile(expr1);
      cache.getOrCompile(expr2);

      // 198 hits (99 per expression)
      for (let i = 0; i < 99; i++) {
        cache.getOrCompile(expr1);
        cache.getOrCompile(expr2);
      }

      const stats = cache.getCacheStats();
      expect(stats.hitRate).toBeGreaterThanOrEqual(0.99);
      expect(stats.hits).toBe(198);
      expect(stats.misses).toBe(2);
    });

    it('should handle 100% hit rate after warming', () => {
      const expr = 'test';

      // Warm cache
      cache.getOrCompile(expr);

      // Clear stats (in real scenario, measure after warming)
      const initialMisses = cache.getCacheStats().misses;

      // All hits
      for (let i = 0; i < 100; i++) {
        cache.getOrCompile(expr);
      }

      const stats = cache.getCacheStats();
      const hitsAfterWarming = stats.hits - (stats.misses - initialMisses);
      expect(hitsAfterWarming).toBe(100);
    });
  });

  describe('clear', () => {
    it('should clear all cached expressions', () => {
      const expr = 'principal.role === "admin"';

      cache.getOrCompile(expr);
      cache.getOrCompile(expr); // hit

      cache.clear();

      const stats = cache.getCacheStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it('should require recompilation after clear', () => {
      const expr = 'test';

      cache.getOrCompile(expr); // miss
      cache.clear();
      cache.getOrCompile(expr); // miss again

      const stats = cache.getCacheStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(0);
    });

    it('should allow caching to continue after clear', () => {
      const expr = 'test';

      cache.getOrCompile(expr);
      cache.clear();

      cache.getOrCompile(expr); // miss
      cache.getOrCompile(expr); // hit

      const stats = cache.getCacheStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });
  });

  describe('performance characteristics', () => {
    it('should handle high-frequency access efficiently', () => {
      const expr = 'principal.role === "admin"';

      const startTime = Date.now();

      // First access (miss)
      cache.getOrCompile(expr);

      // 10,000 cache hits
      for (let i = 0; i < 10000; i++) {
        cache.getOrCompile(expr);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete in reasonable time (< 100ms)
      expect(duration).toBeLessThan(100);

      const stats = cache.getCacheStats();
      expect(stats.hits).toBe(10000);
      expect(stats.hitRate).toBeGreaterThanOrEqual(0.9999);
    });

    it('should handle many unique expressions', () => {
      const expressions: string[] = [];
      for (let i = 0; i < 1000; i++) {
        expressions.push(`expression_${i}`);
      }

      expressions.forEach(expr => cache.getOrCompile(expr));

      // Access each twice
      expressions.forEach(expr => cache.getOrCompile(expr));

      const stats = cache.getCacheStats();
      expect(stats.hits).toBe(1000);
      expect(stats.misses).toBe(1000);
      expect(stats.hitRate).toBe(0.5);
    });

    it('should demonstrate typical policy evaluation pattern', () => {
      // Typical pattern: few unique expressions, many evaluations
      const commonExprs = [
        'principal.role === "admin"',
        'resource.ownerId === principal.id',
        'resource.status === "active"',
      ];

      // Load expressions (misses)
      commonExprs.forEach(expr => cache.getOrCompile(expr));

      // Simulate 1000 policy evaluations
      for (let i = 0; i < 1000; i++) {
        commonExprs.forEach(expr => cache.getOrCompile(expr));
      }

      const stats = cache.getCacheStats();
      expect(stats.hitRate).toBeGreaterThan(0.99);
    });
  });

  describe('edge cases', () => {
    it('should handle very long expressions', () => {
      const longExpr = 'a && '.repeat(1000) + 'true';

      const compiled = cache.getOrCompile(longExpr);
      expect(compiled).toBe(longExpr);
    });

    it('should handle expressions with special characters', () => {
      const expr = 'resource.tags.includes("special!@#$%^&*()")';

      const compiled = cache.getOrCompile(expr);
      expect(compiled).toBe(expr);
    });

    it('should handle unicode expressions', () => {
      const expr = 'principal.名前 === "テスト"';

      const compiled = cache.getOrCompile(expr);
      expect(compiled).toBe(expr);
    });

    it('should handle newlines in expressions', () => {
      const expr = 'principal.role === "admin"\n&& resource.status === "active"';

      const compiled = cache.getOrCompile(expr);
      expect(compiled).toBe(expr);
    });
  });
});
