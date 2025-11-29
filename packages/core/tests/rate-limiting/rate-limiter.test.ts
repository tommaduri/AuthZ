/**
 * Rate Limiter Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  RateLimiter,
  createRateLimiter,
  createRateLimiterWithPreset,
} from '../../src/rate-limiting/index';
import { InMemoryStorage } from '../../src/rate-limiting/storage';

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter({
      enabled: true,
      defaultLimit: 10,
      defaultWindowMs: 1000,
      defaultAlgorithm: 'sliding-window',
    });
  });

  afterEach(async () => {
    await rateLimiter.close();
  });

  describe('Basic Rate Limiting', () => {
    it('should allow requests under the limit', async () => {
      const result = await rateLimiter.check({ principalId: 'user1' });
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThanOrEqual(9);
    });

    it('should deny requests over the limit', async () => {
      // Exhaust the limit
      for (let i = 0; i < 10; i++) {
        await rateLimiter.check({ principalId: 'user2' });
      }

      const result = await rateLimiter.check({ principalId: 'user2' });
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('should return correct remaining count', async () => {
      let result = await rateLimiter.check({ principalId: 'user3' });
      expect(result.remaining).toBe(9);

      result = await rateLimiter.check({ principalId: 'user3' });
      expect(result.remaining).toBe(8);
    });

    it('should reset after window expires', async () => {
      vi.useFakeTimers();

      // Exhaust the limit
      for (let i = 0; i < 10; i++) {
        await rateLimiter.check({ principalId: 'user4' });
      }

      let result = await rateLimiter.check({ principalId: 'user4' });
      expect(result.allowed).toBe(false);

      // Advance time past the window
      vi.advanceTimersByTime(1100);

      result = await rateLimiter.check({ principalId: 'user4' });
      expect(result.allowed).toBe(true);

      vi.useRealTimers();
    });
  });

  describe('Token Bucket Algorithm', () => {
    let tokenBucketLimiter: RateLimiter;

    beforeEach(() => {
      tokenBucketLimiter = new RateLimiter({
        enabled: true,
        defaultAlgorithm: 'token-bucket',
        defaultLimit: 10,
        defaultWindowMs: 1000,
        rules: [
          {
            id: 'token-rule',
            algorithm: 'token-bucket',
            scope: 'principal',
            limit: 10,
            windowMs: 1000,
            bucketCapacity: 10,
            refillRate: 10, // 10 tokens per second
          },
        ],
      });
    });

    afterEach(async () => {
      await tokenBucketLimiter.close();
    });

    it('should allow burst requests up to bucket capacity', async () => {
      for (let i = 0; i < 10; i++) {
        const result = await tokenBucketLimiter.check({ principalId: 'user1' });
        expect(result.allowed).toBe(true);
      }
    });

    it('should deny when bucket is empty', async () => {
      // Drain the bucket
      for (let i = 0; i < 10; i++) {
        await tokenBucketLimiter.check({ principalId: 'user2' });
      }

      const result = await tokenBucketLimiter.check({ principalId: 'user2' });
      expect(result.allowed).toBe(false);
      expect(result.tokens).toBeLessThan(1);
    });

    it('should refill tokens over time', async () => {
      vi.useFakeTimers();

      // Drain the bucket
      for (let i = 0; i < 10; i++) {
        await tokenBucketLimiter.check({ principalId: 'user3' });
      }

      // Wait for some tokens to refill
      vi.advanceTimersByTime(500); // Should refill 5 tokens

      const result = await tokenBucketLimiter.check({ principalId: 'user3' });
      expect(result.allowed).toBe(true);

      vi.useRealTimers();
    });

    it('should support variable cost', async () => {
      const result1 = await tokenBucketLimiter.check({ principalId: 'user4', cost: 5 });
      expect(result1.allowed).toBe(true);
      expect(result1.tokens).toBeCloseTo(5, 0);

      const result2 = await tokenBucketLimiter.check({ principalId: 'user4', cost: 5 });
      expect(result2.allowed).toBe(true);
      expect(result2.tokens).toBeCloseTo(0, 0);

      const result3 = await tokenBucketLimiter.check({ principalId: 'user4', cost: 1 });
      expect(result3.allowed).toBe(false);
    });
  });

  describe('Fixed Window Algorithm', () => {
    let fixedWindowLimiter: RateLimiter;

    beforeEach(() => {
      fixedWindowLimiter = new RateLimiter({
        enabled: true,
        defaultAlgorithm: 'fixed-window',
        defaultLimit: 5,
        defaultWindowMs: 1000,
      });
    });

    afterEach(async () => {
      await fixedWindowLimiter.close();
    });

    it('should count requests in fixed windows', async () => {
      for (let i = 0; i < 5; i++) {
        const result = await fixedWindowLimiter.check({ principalId: 'user1' });
        expect(result.allowed).toBe(true);
      }

      const result = await fixedWindowLimiter.check({ principalId: 'user1' });
      expect(result.allowed).toBe(false);
    });

    it('should reset at window boundary', async () => {
      vi.useFakeTimers();

      // Exhaust the limit
      for (let i = 0; i < 5; i++) {
        await fixedWindowLimiter.check({ principalId: 'user2' });
      }

      // Move to next window
      vi.advanceTimersByTime(1100);

      const result = await fixedWindowLimiter.check({ principalId: 'user2' });
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);

      vi.useRealTimers();
    });
  });

  describe('Rule Matching', () => {
    let ruleLimiter: RateLimiter;

    beforeEach(() => {
      ruleLimiter = new RateLimiter({
        enabled: true,
        defaultLimit: 100,
        defaultWindowMs: 60000,
        rules: [
          {
            id: 'strict-api',
            algorithm: 'sliding-window',
            scope: 'principal',
            limit: 5,
            windowMs: 1000,
            resources: ['api'],
            priority: 10,
          },
          {
            id: 'moderate-docs',
            algorithm: 'sliding-window',
            scope: 'principal',
            limit: 50,
            windowMs: 1000,
            resources: ['docs'],
            priority: 5,
          },
          {
            id: 'admin-bypass',
            algorithm: 'sliding-window',
            scope: 'principal',
            limit: 1000,
            windowMs: 1000,
            principals: ['admin'],
            priority: 20,
          },
        ],
      });
    });

    afterEach(async () => {
      await ruleLimiter.close();
    });

    it('should match rules by resource', async () => {
      const result = await ruleLimiter.check({
        principalId: 'user1',
        resourceKind: 'api',
      });
      expect(result.rule).toBe('strict-api');
      expect(result.limit).toBe(5);
    });

    it('should match rules by principal', async () => {
      const result = await ruleLimiter.check({
        principalId: 'admin',
        resourceKind: 'api',
      });
      expect(result.rule).toBe('admin-bypass');
      expect(result.limit).toBe(1000);
    });

    it('should use default when no rule matches', async () => {
      const result = await ruleLimiter.check({
        principalId: 'user1',
        resourceKind: 'unknown',
      });
      expect(result.rule).toBeUndefined();
      expect(result.limit).toBe(100);
    });

    it('should respect priority order', async () => {
      // Admin should match admin-bypass (priority 20) even for api resource
      const result = await ruleLimiter.check({
        principalId: 'admin',
        resourceKind: 'api',
      });
      expect(result.rule).toBe('admin-bypass');
    });
  });

  describe('Scope Handling', () => {
    it('should handle global scope', async () => {
      const globalLimiter = new RateLimiter({
        enabled: true,
        defaultLimit: 5,
        defaultWindowMs: 1000,
        rules: [
          {
            id: 'global-limit',
            algorithm: 'sliding-window',
            scope: 'global',
            limit: 5,
            windowMs: 1000,
          },
        ],
      });

      // Different principals share the same limit
      await globalLimiter.check({ principalId: 'user1' });
      await globalLimiter.check({ principalId: 'user2' });
      await globalLimiter.check({ principalId: 'user3' });
      await globalLimiter.check({ principalId: 'user4' });
      await globalLimiter.check({ principalId: 'user5' });

      const result = await globalLimiter.check({ principalId: 'user6' });
      expect(result.allowed).toBe(false);

      await globalLimiter.close();
    });

    it('should handle principal-resource scope', async () => {
      const scopedLimiter = new RateLimiter({
        enabled: true,
        defaultLimit: 3,
        defaultWindowMs: 1000,
        rules: [
          {
            id: 'per-resource',
            algorithm: 'sliding-window',
            scope: 'principal-resource',
            limit: 3,
            windowMs: 1000,
          },
        ],
      });

      // Same principal, different resources have separate limits
      for (let i = 0; i < 3; i++) {
        await scopedLimiter.check({ principalId: 'user1', resourceKind: 'api' });
      }

      // API is exhausted
      let result = await scopedLimiter.check({ principalId: 'user1', resourceKind: 'api' });
      expect(result.allowed).toBe(false);

      // But docs still has quota
      result = await scopedLimiter.check({ principalId: 'user1', resourceKind: 'docs' });
      expect(result.allowed).toBe(true);

      await scopedLimiter.close();
    });
  });

  describe('Headers', () => {
    it('should generate correct rate limit headers', async () => {
      const result = await rateLimiter.check({ principalId: 'user1' });
      const headers = rateLimiter.getHeaders(result);

      expect(headers['X-RateLimit-Limit']).toBe('10');
      expect(headers['X-RateLimit-Remaining']).toBe('9');
      expect(headers['X-RateLimit-Reset']).toBeDefined();
      expect(headers['Retry-After']).toBeUndefined();
    });

    it('should include Retry-After when denied', async () => {
      // Exhaust the limit
      for (let i = 0; i < 10; i++) {
        await rateLimiter.check({ principalId: 'user2' });
      }

      const result = await rateLimiter.check({ principalId: 'user2' });
      const headers = rateLimiter.getHeaders(result);

      expect(headers['Retry-After']).toBeDefined();
      expect(parseInt(headers['Retry-After']!)).toBeGreaterThan(0);
    });
  });

  describe('Event Handling', () => {
    it('should emit exceeded event', async () => {
      const handler = vi.fn();
      rateLimiter.onRateLimitExceeded(handler);

      // Exhaust the limit
      for (let i = 0; i < 10; i++) {
        await rateLimiter.check({ principalId: 'user1' });
      }

      // This should trigger the event
      await rateLimiter.check({ principalId: 'user1' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          principalId: 'user1',
          limit: 10,
        })
      );
    });
  });

  describe('Dynamic Rule Management', () => {
    it('should add rules dynamically', async () => {
      rateLimiter.addRule({
        id: 'new-rule',
        algorithm: 'sliding-window',
        scope: 'principal',
        limit: 1,
        windowMs: 1000,
        principals: ['special-user'],
      });

      const result = await rateLimiter.check({ principalId: 'special-user' });
      expect(result.rule).toBe('new-rule');
      expect(result.limit).toBe(1);
    });

    it('should remove rules dynamically', async () => {
      rateLimiter.addRule({
        id: 'temp-rule',
        algorithm: 'sliding-window',
        scope: 'principal',
        limit: 1,
        windowMs: 1000,
        principals: ['temp-user'],
        priority: 100,
      });

      let result = await rateLimiter.check({ principalId: 'temp-user' });
      expect(result.rule).toBe('temp-rule');

      const removed = rateLimiter.removeRule('temp-rule');
      expect(removed).toBe(true);

      result = await rateLimiter.check({ principalId: 'temp-user' });
      expect(result.rule).toBeUndefined();
    });
  });

  describe('Factory Functions', () => {
    it('should create rate limiter with createRateLimiter', async () => {
      const limiter = createRateLimiter({ defaultLimit: 5 });
      const result = await limiter.check({ principalId: 'user1' });
      expect(result.limit).toBe(5);
      await limiter.close();
    });

    it('should create strict preset', async () => {
      const limiter = createRateLimiterWithPreset('strict');
      const result = await limiter.check({ principalId: 'user1' });
      expect(result.limit).toBe(10);
      await limiter.close();
    });

    it('should create moderate preset', async () => {
      const limiter = createRateLimiterWithPreset('moderate');
      const result = await limiter.check({ principalId: 'user1' });
      expect(result.limit).toBe(100);
      await limiter.close();
    });

    it('should create lenient preset', async () => {
      const limiter = createRateLimiterWithPreset('lenient');
      const result = await limiter.check({ principalId: 'user1' });
      expect(result.limit).toBe(1000);
      await limiter.close();
    });
  });

  describe('Enable/Disable', () => {
    it('should bypass rate limiting when disabled', async () => {
      rateLimiter.setEnabled(false);

      // Should always allow when disabled
      for (let i = 0; i < 100; i++) {
        const result = await rateLimiter.check({ principalId: 'user1' });
        expect(result.allowed).toBe(true);
      }
    });

    it('should enforce rate limiting when re-enabled', async () => {
      rateLimiter.setEnabled(false);
      rateLimiter.setEnabled(true);

      // Exhaust the limit
      for (let i = 0; i < 10; i++) {
        await rateLimiter.check({ principalId: 'user1' });
      }

      const result = await rateLimiter.check({ principalId: 'user1' });
      expect(result.allowed).toBe(false);
    });
  });

  describe('Reset', () => {
    it('should reset rate limit for a context', async () => {
      // Exhaust the limit
      for (let i = 0; i < 10; i++) {
        await rateLimiter.check({ principalId: 'user1' });
      }

      let result = await rateLimiter.check({ principalId: 'user1' });
      expect(result.allowed).toBe(false);

      // Reset
      await rateLimiter.reset({ principalId: 'user1' });

      result = await rateLimiter.check({ principalId: 'user1' });
      expect(result.allowed).toBe(true);
    });
  });
});

describe('InMemoryStorage', () => {
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = new InMemoryStorage(100);
  });

  afterEach(async () => {
    await storage.close();
  });

  it('should store and retrieve values', async () => {
    await storage.set('key1', { tokens: 10, lastRefill: Date.now() });
    const value = await storage.get<{ tokens: number; lastRefill: number }>('key1');
    expect(value).toEqual({ tokens: 10, lastRefill: expect.any(Number) });
  });

  it('should return null for missing keys', async () => {
    const value = await storage.get('nonexistent');
    expect(value).toBeNull();
  });

  it('should delete keys', async () => {
    await storage.set('key1', { tokens: 10, lastRefill: Date.now() });
    await storage.delete('key1');
    const value = await storage.get('key1');
    expect(value).toBeNull();
  });

  it('should expire entries', async () => {
    vi.useFakeTimers();

    await storage.set('key1', { tokens: 10, lastRefill: Date.now() }, 100);

    // Before expiry
    let value = await storage.get('key1');
    expect(value).not.toBeNull();

    // After expiry
    vi.advanceTimersByTime(150);
    value = await storage.get('key1');
    expect(value).toBeNull();

    vi.useRealTimers();
  });

  it('should clear by pattern', async () => {
    await storage.set('rate:user1', { tokens: 10, lastRefill: Date.now() });
    await storage.set('rate:user2', { tokens: 10, lastRefill: Date.now() });
    await storage.set('other:key', { tokens: 10, lastRefill: Date.now() });

    await storage.clear('rate:*');

    expect(await storage.get('rate:user1')).toBeNull();
    expect(await storage.get('rate:user2')).toBeNull();
    expect(await storage.get('other:key')).not.toBeNull();
  });

  it('should provide stats', () => {
    const stats = storage.getStats();
    expect(stats.type).toBe('memory');
    expect(stats.keys).toBe(0);
  });
});
