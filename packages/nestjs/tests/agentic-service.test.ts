/**
 * Tests for AuthZ Agentic Service
 *
 * Tests the agentic service wrapper including:
 * - Rate limiting (ENFORCER)
 * - Threat detection (GUARDIAN)
 * - Analysis (ANALYST)
 * - Recommendations (ADVISOR)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthzAgenticService } from '../src/authz-agentic.service';

describe('AuthzAgenticService', () => {
  let service: AuthzAgenticService;

  beforeEach(async () => {
    service = new AuthzAgenticService({ enabled: true });
    await service.onModuleInit();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  describe('Rate Limiting (ENFORCER)', () => {
    it('should track request counts within window', async () => {
      const result1 = await service.checkRateLimit('user-1', {
        enabled: true,
        maxRequests: 10,
        windowSeconds: 60,
      });

      expect(result1.remaining).toBe(9);
      expect(result1.limit).toBe(10);
      expect(result1.isLimited).toBe(false);
      expect(result1.currentUsage).toBe(1);
    });

    it('should enforce rate limits', async () => {
      // Make 10 requests (at the limit)
      for (let i = 0; i < 10; i++) {
        await service.checkRateLimit('user-rate-limit', {
          enabled: true,
          maxRequests: 10,
          windowSeconds: 60,
        });
      }

      // 11th request should be limited
      const result = await service.checkRateLimit('user-rate-limit', {
        enabled: true,
        maxRequests: 10,
        windowSeconds: 60,
      });

      expect(result.isLimited).toBe(true);
      expect(result.remaining).toBe(0);
      expect(result.currentUsage).toBe(11);
    });

    it('should use different keys based on keyBy option', async () => {
      const result1 = await service.checkRateLimit('user-1', {
        enabled: true,
        maxRequests: 10,
        windowSeconds: 60,
        keyBy: 'principal',
      });

      const result2 = await service.checkRateLimit('user-1', {
        enabled: true,
        maxRequests: 10,
        windowSeconds: 60,
        keyBy: 'ip',
      });

      // Different keys, so both should have remaining = 9
      expect(result1.remaining).toBe(9);
      expect(result2.remaining).toBe(9);
    });
  });

  describe('Threat Detection (GUARDIAN)', () => {
    it('should return low anomaly score for normal requests', async () => {
      const result = await service.checkThreat(
        'normal-user',
        { kind: 'document', id: 'doc-1', attributes: {} },
        'read',
        { enabled: true },
      );

      expect(result.anomalyScore).toBeLessThan(0.5);
      expect(result.isAnomalous).toBe(false);
    });

    it('should detect velocity spikes', async () => {
      // Make many requests to trigger velocity spike detection
      for (let i = 0; i < 50; i++) {
        await service.checkThreat(
          'spike-user',
          { kind: 'document', id: `doc-${i}`, attributes: {} },
          'read',
          { enabled: true, threatTypes: ['velocity_spike'] },
        );
      }

      const result = await service.checkThreat(
        'spike-user',
        { kind: 'document', id: 'doc-51', attributes: {} },
        'read',
        { enabled: true, threatTypes: ['velocity_spike'] },
      );

      // Should detect velocity spike
      expect(result.riskFactors.some(f => f.factor === 'velocity_spike')).toBe(true);
    });

    it('should detect sensitive actions', async () => {
      const result = await service.checkThreat(
        'test-user',
        { kind: 'admin', id: 'config-1', attributes: {} },
        'admin_delete',
        { enabled: true, threatTypes: ['permission_escalation'] },
      );

      expect(result.detectedThreats.some(t => t.type === 'permission_escalation')).toBe(true);
      expect(result.anomalyScore).toBeGreaterThan(0);
    });

    it('should respect anomaly threshold', async () => {
      // Force high anomaly by using sensitive action
      const result = await service.checkThreat(
        'threshold-user',
        { kind: 'admin', id: 'config-1', attributes: {} },
        'destroy_all',
        { enabled: true, anomalyThreshold: 0.1 },
      );

      // With low threshold, even small anomalies should be flagged
      // The sensitive action adds 0.15 to the score
      expect(result.anomalyScore).toBeGreaterThan(0.1);
      expect(result.isAnomalous).toBe(true);
    });
  });

  describe('Full Agentic Pipeline', () => {
    it('should process request through all agents', async () => {
      const result = await service.processAgenticRequest(
        { id: 'user-1', roles: ['user'], attributes: {} },
        { kind: 'document', id: 'doc-1', attributes: {} },
        'read',
        {
          includeAnalysis: true,
          includeRecommendations: true,
          enableThreatDetection: true,
          enableRateLimiting: true,
          rateLimitConfig: { maxRequests: 100, windowSeconds: 60 },
        },
      );

      expect(result.allowed).toBe(true);
      expect(result.decision).toBe('allow');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.agentsInvolved).toContain('enforcer');
      expect(result.agentsInvolved).toContain('guardian');
      expect(result.agentsInvolved).toContain('analyst');
      expect(result.agentsInvolved).toContain('advisor');
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should generate analysis data', async () => {
      const result = await service.processAgenticRequest(
        { id: 'admin-1', roles: ['admin'], attributes: {} },
        { kind: 'subscription', id: 'sub-1', attributes: {} },
        'create',
        {
          includeAnalysis: true,
          analysisConfig: { includePatterns: true },
        },
      );

      expect(result.analysis).toBeDefined();
      expect(result.analysis?.confidence).toBeGreaterThan(0);
      expect(result.analysis?.patterns).toBeDefined();
      expect(result.analysis?.historicalContext).toBeDefined();
      expect(result.analysis?.riskAssessment).toBeDefined();
    });

    it('should generate recommendations', async () => {
      const result = await service.processAgenticRequest(
        { id: 'user-1', roles: [], attributes: {} },
        { kind: 'payment', id: 'pay-1', attributes: {} },
        'delete',
        {
          includeRecommendations: true,
          recommendationsConfig: { maxRecommendations: 3 },
        },
      );

      expect(result.recommendations).toBeDefined();
      expect(result.recommendations?.length).toBeGreaterThan(0);
      expect(result.recommendations?.length).toBeLessThanOrEqual(3);
    });

    it('should include explanation', async () => {
      const result = await service.processAgenticRequest(
        { id: 'user-1', roles: ['user'], attributes: {} },
        { kind: 'document', id: 'doc-1', attributes: {} },
        'read',
        {},
      );

      expect(result.explanation).toBeDefined();
      expect(result.explanation).toContain('user-1');
    });

    it('should deny when rate limited', async () => {
      // Exhaust rate limit
      for (let i = 0; i < 5; i++) {
        await service.processAgenticRequest(
          { id: 'rate-limited-user', roles: ['user'], attributes: {} },
          { kind: 'api', id: 'endpoint-1', attributes: {} },
          'call',
          {
            enableRateLimiting: true,
            rateLimitConfig: { maxRequests: 5, windowSeconds: 60, onLimitExceeded: 'block' },
          },
        );
      }

      // This should be denied
      const result = await service.processAgenticRequest(
        { id: 'rate-limited-user', roles: ['user'], attributes: {} },
        { kind: 'api', id: 'endpoint-1', attributes: {} },
        'call',
        {
          enableRateLimiting: true,
          rateLimitConfig: { maxRequests: 5, windowSeconds: 60, onLimitExceeded: 'block' },
        },
      );

      expect(result.allowed).toBe(false);
      expect(result.rateLimitInfo?.isLimited).toBe(true);
    });
  });

  describe('Health Check', () => {
    it('should return healthy status when initialized', async () => {
      const health = await service.getHealth();

      expect(health.status).toBe('healthy');
      expect(health.agents.guardian.status).toBe('online');
      expect(health.agents.analyst.status).toBe('online');
      expect(health.agents.advisor.status).toBe('online');
      expect(health.agents.enforcer.status).toBe('online');
    });

    it('should return unhealthy status when not initialized', async () => {
      const uninitializedService = new AuthzAgenticService();
      const health = await uninitializedService.getHealth();

      expect(health.status).toBe('unhealthy');
      expect(health.agents.guardian.status).toBe('offline');
    });
  });

  describe('Admin Operations', () => {
    it('should clear rate limits for specific user', async () => {
      // Create rate limit entry
      await service.checkRateLimit('clear-test-user', {
        enabled: true,
        maxRequests: 10,
        windowSeconds: 60,
      });

      // Clear for specific user
      await service.clearRateLimits('clear-test-user');

      // Check that it's reset
      const result = await service.checkRateLimit('clear-test-user', {
        enabled: true,
        maxRequests: 10,
        windowSeconds: 60,
      });

      expect(result.currentUsage).toBe(1); // Reset to first request
    });

    it('should clear all rate limits', async () => {
      // Create multiple entries
      await service.checkRateLimit('user-a', { enabled: true, maxRequests: 10, windowSeconds: 60 });
      await service.checkRateLimit('user-b', { enabled: true, maxRequests: 10, windowSeconds: 60 });

      // Clear all
      await service.clearRateLimits();

      // Both should be reset
      const resultA = await service.checkRateLimit('user-a', { enabled: true, maxRequests: 10, windowSeconds: 60 });
      const resultB = await service.checkRateLimit('user-b', { enabled: true, maxRequests: 10, windowSeconds: 60 });

      expect(resultA.currentUsage).toBe(1);
      expect(resultB.currentUsage).toBe(1);
    });
  });
});
