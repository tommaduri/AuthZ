/**
 * Production Middleware Tests
 *
 * Tests for circuit breaker, rate limiter, health checks, and retry logic.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  CircuitBreaker,
  CircuitBreakerError,
  RateLimiter,
  HealthCheckSystem,
  withRetry,
} from '../production';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      failureWindow: 1000,
      resetTimeout: 500,
      requestTimeout: 100,
    });
  });

  describe('closed state', () => {
    it('should execute function successfully', async () => {
      const result = await breaker.execute(async () => 'success');
      expect(result).toBe('success');
      expect(breaker.getState()).toBe('closed');
    });

    it('should count failures within window', async () => {
      const failFn = async () => {
        throw new Error('failure');
      };

      // First two failures should not open circuit
      await expect(breaker.execute(failFn)).rejects.toThrow('failure');
      await expect(breaker.execute(failFn)).rejects.toThrow('failure');
      expect(breaker.getState()).toBe('closed');
      expect(breaker.getFailureCount()).toBe(2);
    });

    it('should open circuit after threshold failures', async () => {
      const failFn = async () => {
        throw new Error('failure');
      };

      await expect(breaker.execute(failFn)).rejects.toThrow('failure');
      await expect(breaker.execute(failFn)).rejects.toThrow('failure');
      await expect(breaker.execute(failFn)).rejects.toThrow('failure');

      expect(breaker.getState()).toBe('open');
    });
  });

  describe('open state', () => {
    it('should reject requests immediately when open', async () => {
      // Force open state
      const failFn = async () => {
        throw new Error('failure');
      };
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(failFn);
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe('open');

      await expect(breaker.execute(async () => 'success')).rejects.toThrow(
        CircuitBreakerError
      );
    });

    it('should transition to half-open after reset timeout', async () => {
      // Force open state
      const failFn = async () => {
        throw new Error('failure');
      };
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(failFn);
        } catch {
          // Expected
        }
      }

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 600));

      // Next request should succeed and close circuit
      const result = await breaker.execute(async () => 'success');
      expect(result).toBe('success');
      expect(breaker.getState()).toBe('closed');
    });
  });

  describe('half-open state', () => {
    it('should close circuit on successful probe', async () => {
      // Force open, then wait for half-open
      const failFn = async () => {
        throw new Error('failure');
      };
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(failFn);
        } catch {
          // Expected
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 600));

      const result = await breaker.execute(async () => 'recovered');
      expect(result).toBe('recovered');
      expect(breaker.getState()).toBe('closed');
      expect(breaker.getFailureCount()).toBe(0);
    });

    it('should reopen circuit on probe failure', async () => {
      // Force open, then wait for half-open
      const failFn = async () => {
        throw new Error('failure');
      };
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(failFn);
        } catch {
          // Expected
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 600));

      // Probe fails
      await expect(breaker.execute(failFn)).rejects.toThrow('failure');
      expect(breaker.getState()).toBe('open');
    });
  });

  describe('reset', () => {
    it('should reset circuit to closed state', async () => {
      // Force open state
      const failFn = async () => {
        throw new Error('failure');
      };
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(failFn);
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe('open');

      breaker.reset();

      expect(breaker.getState()).toBe('closed');
      expect(breaker.getFailureCount()).toBe(0);
    });
  });

  describe('timeout', () => {
    it('should timeout slow requests', async () => {
      const slowFn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'slow';
      };

      await expect(breaker.execute(slowFn)).rejects.toThrow('Request timeout');
    });
  });
});

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({
      max: 5,
      windowMs: 1000,
    });
  });

  const createMockRequest = (ip: string = '127.0.0.1') => ({
    ip,
    headers: {},
  } as any);

  it('should allow requests under limit', () => {
    const request = createMockRequest();

    for (let i = 0; i < 5; i++) {
      const result = limiter.check(request);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4 - i);
    }
  });

  it('should block requests over limit', () => {
    const request = createMockRequest();

    // Use up all requests
    for (let i = 0; i < 5; i++) {
      limiter.check(request);
    }

    // Next request should be blocked
    const result = limiter.check(request);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('should track requests per IP', () => {
    const request1 = createMockRequest('192.168.1.1');
    const request2 = createMockRequest('192.168.1.2');

    // Use up limit for first IP
    for (let i = 0; i < 5; i++) {
      limiter.check(request1);
    }

    // Second IP should still have full quota
    const result = limiter.check(request2);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('should reset after window expires', async () => {
    const request = createMockRequest();

    // Use up all requests
    for (let i = 0; i < 5; i++) {
      limiter.check(request);
    }

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Should have fresh quota
    const result = limiter.check(request);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('should skip requests when skip function returns true', () => {
    const skipLimiter = new RateLimiter({
      max: 1,
      windowMs: 1000,
      skip: (req) => req.ip === '10.0.0.1',
    });

    const skipRequest = createMockRequest('10.0.0.1');
    const normalRequest = createMockRequest('192.168.1.1');

    // Normal request uses quota
    skipLimiter.check(normalRequest);
    expect(skipLimiter.check(normalRequest).allowed).toBe(false);

    // Skip request always allowed
    expect(skipLimiter.check(skipRequest).allowed).toBe(true);
    expect(skipLimiter.check(skipRequest).allowed).toBe(true);
  });

  it('should use custom key generator', () => {
    const customLimiter = new RateLimiter({
      max: 2,
      windowMs: 1000,
      keyGenerator: (req) => req.headers['x-api-key'] as string || 'anonymous',
    });

    const apiKey1 = { ip: '127.0.0.1', headers: { 'x-api-key': 'key1' } } as any;
    const apiKey2 = { ip: '127.0.0.1', headers: { 'x-api-key': 'key2' } } as any;

    // Both keys have separate quotas
    customLimiter.check(apiKey1);
    customLimiter.check(apiKey1);

    expect(customLimiter.check(apiKey1).allowed).toBe(false);
    expect(customLimiter.check(apiKey2).allowed).toBe(true);
  });
});

describe('HealthCheckSystem', () => {
  let healthSystem: HealthCheckSystem;

  beforeEach(() => {
    healthSystem = new HealthCheckSystem();
  });

  it('should return healthy when no checks registered', async () => {
    const result = await healthSystem.runChecks();
    expect(result.status).toBe('healthy');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(Object.keys(result.checks)).toHaveLength(0);
  });

  it('should return healthy when all checks pass', async () => {
    healthSystem.register({
      name: 'database',
      check: async () => ({ healthy: true, latencyMs: 5 }),
      critical: true,
    });

    healthSystem.register({
      name: 'cache',
      check: async () => ({ healthy: true, latencyMs: 2 }),
      critical: false,
    });

    const result = await healthSystem.runChecks();
    expect(result.status).toBe('healthy');
    expect(result.checks.database.status).toBe('pass');
    expect(result.checks.cache.status).toBe('pass');
  });

  it('should return degraded for non-critical failure', async () => {
    healthSystem.register({
      name: 'database',
      check: async () => ({ healthy: true, latencyMs: 5 }),
      critical: true,
    });

    healthSystem.register({
      name: 'analytics',
      check: async () => ({ healthy: false, latencyMs: 100 }),
      critical: false,
    });

    const result = await healthSystem.runChecks();
    expect(result.status).toBe('degraded');
    expect(result.checks.database.status).toBe('pass');
    expect(result.checks.analytics.status).toBe('fail');
  });

  it('should return unhealthy for critical failure', async () => {
    healthSystem.register({
      name: 'database',
      check: async () => ({ healthy: false, latencyMs: 0 }),
      critical: true,
    });

    const result = await healthSystem.runChecks();
    expect(result.status).toBe('unhealthy');
    expect(result.checks.database.status).toBe('fail');
  });

  it('should handle check exceptions', async () => {
    healthSystem.register({
      name: 'broken',
      check: async () => {
        throw new Error('Connection refused');
      },
      critical: true,
    });

    const result = await healthSystem.runChecks();
    expect(result.status).toBe('unhealthy');
    expect(result.checks.broken.status).toBe('fail');
    expect(result.checks.broken.message).toBe('Connection refused');
  });

  it('should include latency in results', async () => {
    healthSystem.register({
      name: 'slow-service',
      check: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { healthy: true, latencyMs: 50 };
      },
    });

    const result = await healthSystem.runChecks();
    expect(result.checks['slow-service'].latencyMs).toBeGreaterThanOrEqual(50);
  });

  it('should include details from checks', async () => {
    healthSystem.register({
      name: 'database',
      check: async () => ({
        healthy: true,
        latencyMs: 5,
        details: {
          connections: 10,
          maxConnections: 100,
          version: '15.2',
        },
      }),
    });

    const result = await healthSystem.runChecks();
    expect(result.checks.database.details).toEqual({
      connections: 10,
      maxConnections: 100,
      version: '15.2',
    });
  });
});

describe('withRetry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return on first success', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const result = await withRetry(fn, { maxRetries: 3 });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('success');

    const result = await withRetry(fn, {
      maxRetries: 3,
      initialDelay: 10,
    });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should throw after max retries exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('persistent failure'));

    await expect(
      withRetry(fn, { maxRetries: 2, initialDelay: 10 })
    ).rejects.toThrow('persistent failure');

    expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });

  it('should respect retryOn predicate', async () => {
    class NonRetryableError extends Error {
      retryable = false;
    }

    const fn = vi.fn().mockRejectedValue(new NonRetryableError('no retry'));

    await expect(
      withRetry(fn, {
        maxRetries: 3,
        initialDelay: 10,
        retryOn: (error: any) => error.retryable === true,
      })
    ).rejects.toThrow('no retry');

    // Should not retry non-retryable errors
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should apply exponential backoff', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('success');

    const startTime = Date.now();

    await withRetry(fn, {
      maxRetries: 3,
      initialDelay: 50,
      backoffMultiplier: 2,
      jitter: 0,
    });

    const elapsed = Date.now() - startTime;

    // First retry after 50ms, second after 100ms = 150ms minimum
    expect(elapsed).toBeGreaterThanOrEqual(140); // Some tolerance
  });

  it('should respect maxDelay', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockRejectedValueOnce(new Error('fail3'))
      .mockResolvedValue('success');

    const startTime = Date.now();

    await withRetry(fn, {
      maxRetries: 3,
      initialDelay: 100,
      maxDelay: 50, // Cap at 50ms
      backoffMultiplier: 10,
      jitter: 0,
    });

    const elapsed = Date.now() - startTime;

    // Should be capped to ~150ms (3 retries * 50ms max)
    expect(elapsed).toBeLessThan(500);
  });
});
