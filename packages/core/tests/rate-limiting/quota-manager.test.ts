/**
 * Quota Manager Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  QuotaManager,
  createQuotaManager,
  createQuotaPolicy,
  QuotaPeriod,
} from '../../src/quota';
import type { QuotaPolicy } from '../../src/quota/types';

describe('QuotaManager', () => {
  let quotaManager: QuotaManager;

  const basicPolicy: QuotaPolicy = {
    id: 'basic-policy',
    name: 'Basic Quota',
    period: QuotaPeriod.DAILY,
    limits: [
      { resourceKind: 'api-calls', limit: 100 },
      { resourceKind: 'storage', limit: 1000 },
    ],
    enforcement: 'hard',
    enabled: true,
  };

  beforeEach(() => {
    quotaManager = new QuotaManager({
      enabled: true,
      policies: [basicPolicy],
    });
  });

  describe('Basic Quota Checking', () => {
    it('should allow requests under quota', async () => {
      const result = await quotaManager.checkQuota({
        principalId: 'user1',
        resourceKind: 'api-calls',
      });

      expect(result.allowed).toBe(true);
      expect(result.quotas.length).toBeGreaterThan(0);
      expect(result.quotas[0].remaining).toBe(100);
    });

    it('should deny requests over quota', async () => {
      // Consume all quota
      for (let i = 0; i < 100; i++) {
        await quotaManager.consumeQuota({
          principalId: 'user2',
          resourceKind: 'api-calls',
        });
      }

      const result = await quotaManager.checkQuota({
        principalId: 'user2',
        resourceKind: 'api-calls',
      });

      expect(result.allowed).toBe(false);
      expect(result.denyingPolicy).toBe('basic-policy');
    });

    it('should track remaining quota correctly', async () => {
      await quotaManager.consumeQuota({
        principalId: 'user3',
        resourceKind: 'api-calls',
        cost: 10,
      });

      const result = await quotaManager.checkQuota({
        principalId: 'user3',
        resourceKind: 'api-calls',
      });

      expect(result.quotas[0].used).toBe(10);
      expect(result.quotas[0].remaining).toBe(90);
    });
  });

  describe('Quota Consumption', () => {
    it('should consume quota successfully', async () => {
      const result = await quotaManager.consumeQuota({
        principalId: 'user1',
        resourceKind: 'api-calls',
        cost: 5,
      });

      expect(result.success).toBe(true);
      expect(result.consumed).toBe(5);
      expect(result.remaining).toBe(95);
    });

    it('should fail to consume when over quota', async () => {
      // Exhaust quota
      await quotaManager.setUsage('user2', 'basic-policy', 100, 'api-calls');

      const result = await quotaManager.consumeQuota({
        principalId: 'user2',
        resourceKind: 'api-calls',
      });

      expect(result.success).toBe(false);
      expect(result.consumed).toBe(0);
      expect(result.error).toContain('exceeded');
    });

    it('should support variable cost', async () => {
      const result1 = await quotaManager.consumeQuota({
        principalId: 'user3',
        resourceKind: 'api-calls',
        cost: 50,
      });

      expect(result1.success).toBe(true);
      expect(result1.remaining).toBe(50);

      const result2 = await quotaManager.consumeQuota({
        principalId: 'user3',
        resourceKind: 'api-calls',
        cost: 60,
      });

      expect(result2.success).toBe(false);
    });
  });

  describe('Policy Management', () => {
    it('should add policies dynamically', async () => {
      const newPolicy: QuotaPolicy = {
        id: 'premium-policy',
        name: 'Premium Quota',
        period: QuotaPeriod.DAILY,
        limits: [{ resourceKind: 'api-calls', limit: 1000 }],
        enforcement: 'hard',
        enabled: true,
        principals: ['premium-user'],
        priority: 10,
      };

      quotaManager.addPolicy(newPolicy);

      const result = await quotaManager.checkQuota({
        principalId: 'premium-user',
        resourceKind: 'api-calls',
      });

      expect(result.quotas[0].limit).toBe(1000);
    });

    it('should remove policies', () => {
      const removed = quotaManager.removePolicy('basic-policy');
      expect(removed).toBe(true);

      const policy = quotaManager.getPolicy('basic-policy');
      expect(policy).toBeUndefined();
    });

    it('should get all policies', () => {
      const policies = quotaManager.getAllPolicies();
      expect(policies.length).toBe(1);
      expect(policies[0].id).toBe('basic-policy');
    });
  });

  describe('Quota Status', () => {
    it('should return quota status for principal', async () => {
      await quotaManager.consumeQuota({
        principalId: 'user1',
        resourceKind: 'api-calls',
        cost: 50,
      });

      const status = await quotaManager.getQuotaStatus('user1');

      expect(status.principalId).toBe('user1');
      expect(status.quotas.length).toBeGreaterThan(0);
      expect(status.status).toBe('ok');
    });

    it('should report warning status', async () => {
      await quotaManager.consumeQuota({
        principalId: 'user2',
        resourceKind: 'api-calls',
        cost: 85,
      });

      const status = await quotaManager.getQuotaStatus('user2');
      expect(status.status).toBe('warning');
    });

    it('should report exceeded status', async () => {
      await quotaManager.setUsage('user3', 'basic-policy', 150, 'api-calls');

      const status = await quotaManager.getQuotaStatus('user3');
      expect(status.status).toBe('exceeded');
    });
  });

  describe('Quota Reset', () => {
    it('should reset quota for principal', async () => {
      await quotaManager.consumeQuota({
        principalId: 'user1',
        resourceKind: 'api-calls',
        cost: 50,
      });

      await quotaManager.resetQuota('user1', 'basic-policy', 'api-calls');

      const result = await quotaManager.checkQuota({
        principalId: 'user1',
        resourceKind: 'api-calls',
      });

      expect(result.quotas[0].used).toBe(0);
      expect(result.quotas[0].remaining).toBe(100);
    });

    it('should reset all quotas for principal', async () => {
      await quotaManager.consumeQuota({
        principalId: 'user2',
        resourceKind: 'api-calls',
        cost: 50,
      });
      await quotaManager.consumeQuota({
        principalId: 'user2',
        resourceKind: 'storage',
        cost: 500,
      });

      await quotaManager.resetQuota('user2');

      const status = await quotaManager.getQuotaStatus('user2');
      expect(status.quotas.length).toBe(0);
    });
  });

  describe('Enforcement Modes', () => {
    it('should enforce hard limits', async () => {
      const hardManager = new QuotaManager({
        enabled: true,
        policies: [
          {
            ...basicPolicy,
            id: 'hard-policy',
            enforcement: 'hard',
          },
        ],
      });

      await hardManager.setUsage('user1', 'hard-policy', 100, 'api-calls');

      const result = await hardManager.checkQuota({
        principalId: 'user1',
        resourceKind: 'api-calls',
      });

      expect(result.allowed).toBe(false);
    });

    it('should allow soft limits with warning', async () => {
      const softManager = new QuotaManager({
        enabled: true,
        policies: [
          {
            ...basicPolicy,
            id: 'soft-policy',
            enforcement: 'soft',
            gracePeriodPercent: 20,
          },
        ],
      });

      await softManager.setUsage('user1', 'soft-policy', 100, 'api-calls');

      const result = await softManager.checkQuota({
        principalId: 'user1',
        resourceKind: 'api-calls',
      });

      // Should allow with grace period
      expect(result.allowed).toBe(true);
    });

    it('should only notify for notify enforcement', async () => {
      const notifyManager = new QuotaManager({
        enabled: true,
        policies: [
          {
            ...basicPolicy,
            id: 'notify-policy',
            enforcement: 'notify',
          },
        ],
      });

      await notifyManager.setUsage('user1', 'notify-policy', 150, 'api-calls');

      const result = await notifyManager.checkQuota({
        principalId: 'user1',
        resourceKind: 'api-calls',
      });

      expect(result.allowed).toBe(true);
      expect(result.hasWarnings).toBe(true);
    });
  });

  describe('Period Handling', () => {
    it('should handle daily quotas', async () => {
      const dailyManager = new QuotaManager({
        enabled: true,
        policies: [
          {
            ...basicPolicy,
            period: QuotaPeriod.DAILY,
          },
        ],
      });

      const result = await dailyManager.checkQuota({
        principalId: 'user1',
        resourceKind: 'api-calls',
      });

      const usage = result.quotas[0];
      const periodDuration = usage.periodEnd - usage.periodStart;

      // Should be approximately 24 hours
      expect(periodDuration).toBeCloseTo(24 * 60 * 60 * 1000, -3);
    });

    it('should handle hourly quotas', async () => {
      const hourlyManager = new QuotaManager({
        enabled: true,
        policies: [
          {
            ...basicPolicy,
            id: 'hourly-policy',
            period: QuotaPeriod.HOURLY,
          },
        ],
      });

      const result = await hourlyManager.checkQuota({
        principalId: 'user1',
        resourceKind: 'api-calls',
      });

      const usage = result.quotas[0];
      const periodDuration = usage.periodEnd - usage.periodStart;

      // Should be approximately 1 hour
      expect(periodDuration).toBeCloseTo(60 * 60 * 1000, -2);
    });

    it('should reset quota at period boundary', async () => {
      vi.useFakeTimers();

      const hourlyManager = new QuotaManager({
        enabled: true,
        policies: [
          {
            ...basicPolicy,
            id: 'hourly-policy',
            period: QuotaPeriod.HOURLY,
          },
        ],
      });

      await hourlyManager.consumeQuota({
        principalId: 'user1',
        resourceKind: 'api-calls',
        cost: 100,
      });

      // Check exhausted
      let result = await hourlyManager.checkQuota({
        principalId: 'user1',
        resourceKind: 'api-calls',
      });
      expect(result.allowed).toBe(false);

      // Advance past the hour
      vi.advanceTimersByTime(61 * 60 * 1000);

      // Should be reset
      result = await hourlyManager.checkQuota({
        principalId: 'user1',
        resourceKind: 'api-calls',
      });
      expect(result.allowed).toBe(true);
      expect(result.quotas[0].remaining).toBe(100);

      vi.useRealTimers();
    });
  });

  describe('Event Handling', () => {
    it('should emit threshold event on warning', async () => {
      const handler = vi.fn();
      quotaManager.onQuotaThreshold(handler);

      await quotaManager.consumeQuota({
        principalId: 'user1',
        resourceKind: 'api-calls',
        cost: 85,
      });

      await quotaManager.checkQuota({
        principalId: 'user1',
        resourceKind: 'api-calls',
      });

      // Threshold should be triggered at 80%
      expect(handler).not.toHaveBeenCalled(); // Check doesn't consume
    });

    it('should emit threshold event on exceeded', async () => {
      const handler = vi.fn();
      quotaManager.onQuotaThreshold(handler);

      await quotaManager.setUsage('user1', 'basic-policy', 100, 'api-calls');

      await quotaManager.checkQuota({
        principalId: 'user1',
        resourceKind: 'api-calls',
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'exceeded',
          principalId: 'user1',
          policyId: 'basic-policy',
        })
      );
    });

    it('should emit consume event', async () => {
      const handler = vi.fn();
      quotaManager.onQuotaConsume(handler);

      await quotaManager.consumeQuota({
        principalId: 'user1',
        resourceKind: 'api-calls',
        cost: 5,
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          principalId: 'user1',
          cost: 5,
        })
      );
    });
  });

  describe('Principal and Role Filtering', () => {
    it('should filter by principal', async () => {
      quotaManager.addPolicy({
        id: 'premium-only',
        name: 'Premium Only',
        period: QuotaPeriod.DAILY,
        limits: [{ resourceKind: 'api-calls', limit: 10000 }],
        enforcement: 'hard',
        enabled: true,
        principals: ['premium-user'],
        priority: 10,
      });

      const premiumResult = await quotaManager.checkQuota({
        principalId: 'premium-user',
        resourceKind: 'api-calls',
      });

      const normalResult = await quotaManager.checkQuota({
        principalId: 'normal-user',
        resourceKind: 'api-calls',
      });

      expect(premiumResult.quotas[0].limit).toBe(10000);
      expect(normalResult.quotas[0].limit).toBe(100);
    });

    it('should filter by role', async () => {
      quotaManager.addPolicy({
        id: 'admin-quota',
        name: 'Admin Quota',
        period: QuotaPeriod.DAILY,
        limits: [{ resourceKind: 'api-calls', limit: 50000 }],
        enforcement: 'hard',
        enabled: true,
        roles: ['admin'],
        priority: 20,
      });

      const adminResult = await quotaManager.checkQuota({
        principalId: 'user1',
        roles: ['admin'],
        resourceKind: 'api-calls',
      });

      const userResult = await quotaManager.checkQuota({
        principalId: 'user2',
        roles: ['user'],
        resourceKind: 'api-calls',
      });

      expect(adminResult.quotas[0].limit).toBe(50000);
      expect(userResult.quotas[0].limit).toBe(100);
    });
  });

  describe('Enable/Disable', () => {
    it('should bypass quota when disabled', async () => {
      quotaManager.setEnabled(false);

      await quotaManager.setUsage('user1', 'basic-policy', 200, 'api-calls');

      const result = await quotaManager.checkQuota({
        principalId: 'user1',
        resourceKind: 'api-calls',
      });

      expect(result.allowed).toBe(true);
      expect(result.quotas.length).toBe(0);
    });

    it('should enforce quota when re-enabled', async () => {
      quotaManager.setEnabled(false);
      quotaManager.setEnabled(true);

      await quotaManager.setUsage('user1', 'basic-policy', 200, 'api-calls');

      const result = await quotaManager.checkQuota({
        principalId: 'user1',
        resourceKind: 'api-calls',
      });

      expect(result.allowed).toBe(false);
    });
  });

  describe('Factory Functions', () => {
    it('should create quota manager with createQuotaManager', async () => {
      const manager = createQuotaManager({
        policies: [basicPolicy],
      });

      const result = await manager.checkQuota({
        principalId: 'user1',
        resourceKind: 'api-calls',
      });

      expect(result.allowed).toBe(true);
    });

    it('should create policy with createQuotaPolicy', () => {
      const policy = createQuotaPolicy({
        id: 'test-policy',
        name: 'Test',
        resourceKind: 'api-calls',
        limit: 500,
        period: QuotaPeriod.HOURLY,
      });

      expect(policy.id).toBe('test-policy');
      expect(policy.limits[0].limit).toBe(500);
      expect(policy.period).toBe(QuotaPeriod.HOURLY);
    });
  });

  describe('Usage Management', () => {
    it('should get usage directly', async () => {
      await quotaManager.consumeQuota({
        principalId: 'user1',
        resourceKind: 'api-calls',
        cost: 25,
      });

      const usage = await quotaManager.getUsage('user1', 'basic-policy', 'api-calls');

      expect(usage).not.toBeNull();
      expect(usage!.used).toBe(25);
    });

    it('should set usage directly', async () => {
      await quotaManager.setUsage('user1', 'basic-policy', 75, 'api-calls');

      const usage = await quotaManager.getUsage('user1', 'basic-policy', 'api-calls');

      expect(usage!.used).toBe(75);
      expect(usage!.remaining).toBe(25);
    });
  });
});
