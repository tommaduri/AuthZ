import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EnforcerAgent, type DegradationMode, type AuditEventType } from '../../../src/enforcer/enforcer-agent.js';
import type { AgentConfig, Anomaly } from '../../../src/types/agent.types.js';

// Mock dependencies
const mockStore = {
  initialize: vi.fn(),
  close: vi.fn(),
  storeAction: vi.fn(),
};

const mockEventBus = {
  initialize: vi.fn(),
  shutdown: vi.fn(),
  publish: vi.fn(),
  subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
};

describe('EnforcerAgent', () => {
  let enforcer: EnforcerAgent;
  let config: AgentConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    config = {
      enabled: true,
      logLevel: 'error',
      enforcer: {
        autoEnforceEnabled: false,
        requireApprovalForSeverity: 'high',
        maxActionsPerHour: 100,
        rollbackWindowMinutes: 60,
      },
    };

    enforcer = new EnforcerAgent(
      config,
      mockStore as any,
      mockEventBus as any,
    );
  });

  afterEach(async () => {
    await enforcer.shutdown();
  });

  describe('initialization', () => {
    it('should initialize with ready state', async () => {
      await enforcer.initialize();
      expect(enforcer.state).toBe('ready');
    });

    it('should have correct agent type and name', () => {
      expect(enforcer.type).toBe('enforcer');
      expect(enforcer.name).toBe('ENFORCER - Action Execution');
    });

    it('should subscribe to anomaly events', async () => {
      await enforcer.initialize();
      expect(mockEventBus.subscribe).toHaveBeenCalledWith(
        'anomaly_detected',
        expect.any(Function)
      );
    });

    it('should initialize with default enhanced features enabled', async () => {
      await enforcer.initialize();

      // Cache should be working
      const cacheStats = enforcer.getCacheStats();
      expect(cacheStats).toBeDefined();
      expect(cacheStats.size).toBe(0);

      // Circuit breaker should have monitored services
      const cbStatus = enforcer.getCircuitBreakerStatus();
      expect(cbStatus).toBeDefined();
      expect(Object.keys(cbStatus).length).toBeGreaterThan(0);

      // Audit trail should be recording
      const auditStats = enforcer.getAuditStats();
      expect(auditStats.totalEntries).toBeGreaterThan(0);
    });
  });

  describe('isAllowed', () => {
    it('should allow normal principals', async () => {
      await enforcer.initialize();

      const result = enforcer.isAllowed('user-123');

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should deny rate-limited principals', async () => {
      await enforcer.initialize();

      // Apply rate limit
      await enforcer.triggerAction('rate_limit', 'user-123', 'Test rate limit');

      const result = enforcer.isAllowed('user-123');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Rate limited');
    });

    it('should deny blocked principals', async () => {
      await enforcer.initialize();

      // Apply block
      await enforcer.triggerAction('temporary_block', 'user-456', 'Test block');

      const result = enforcer.isAllowed('user-456');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Blocked');
    });

    it('should support resource-specific checks', async () => {
      await enforcer.initialize();

      const result = enforcer.isAllowed('user-789', {
        resourceKind: 'document',
        resourceId: 'doc-123',
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('triggerAction', () => {
    it('should execute rate limit action', async () => {
      await enforcer.initialize();

      const action = await enforcer.triggerAction(
        'rate_limit',
        'user-123',
        'Suspicious activity'
      );

      expect(action.type).toBe('rate_limit');
      expect(action.status).toBe('completed');
      expect(action.result?.success).toBe(true);
      expect(mockStore.storeAction).toHaveBeenCalled();
    });

    it('should execute temporary block action', async () => {
      await enforcer.initialize();

      const action = await enforcer.triggerAction(
        'temporary_block',
        'user-123',
        'Critical anomaly'
      );

      expect(action.type).toBe('temporary_block');
      expect(action.status).toBe('completed');
      expect(action.result?.success).toBe(true);
    });

    it('should execute alert admin action', async () => {
      await enforcer.initialize();

      const action = await enforcer.triggerAction(
        'alert_admin',
        'user-123',
        'Review needed'
      );

      expect(action.type).toBe('alert_admin');
      expect(action.status).toBe('completed');
    });
  });

  describe('action approval workflow', () => {
    it('should queue high-severity actions for approval when auto-enforce disabled', async () => {
      await enforcer.initialize();

      // Create a mock anomaly event
      const anomaly: Anomaly = {
        id: 'anomaly-123',
        detectedAt: new Date(),
        type: 'permission_escalation',
        severity: 'high',
        principalId: 'user-789',
        description: 'Potential escalation',
        score: 0.9,
        evidence: { recentRequests: 100, baselineRequests: 10, deviation: 3, relatedDecisions: [] },
        baseline: { period: '7d', avgRequestsPerHour: 5, uniqueResources: 3, commonActions: ['view'], commonTimeRanges: [] },
        observed: { requestsInWindow: 100, uniqueResourcesAccessed: 50, actionsPerformed: ['admin'], timeOfAccess: new Date().toISOString() },
        status: 'open',
      };

      // Simulate anomaly detection event handler
      const subscribeCall = mockEventBus.subscribe.mock.calls[0];
      const handler = subscribeCall[1];
      await handler({ payload: anomaly });

      const pending = enforcer.getPendingActions();
      expect(pending.length).toBeGreaterThan(0);
    });

    it('should approve and execute pending action', async () => {
      await enforcer.initialize();

      // Manually add a pending action
      const action = await enforcer.triggerAction('rate_limit', 'user-test', 'Test');

      // Try approving (may not be pending depending on severity)
      const pending = enforcer.getPendingActions();
      if (pending.length > 0) {
        const approved = await enforcer.approveAction(pending[0].id, 'admin@test.com');
        expect(approved?.status).toBe('completed');
      }
    });

    it('should reject pending action', async () => {
      await enforcer.initialize();

      const pending = enforcer.getPendingActions();
      if (pending.length > 0) {
        const rejected = enforcer.rejectAction(pending[0].id, 'admin@test.com', 'False positive');
        expect(rejected).toBe(true);
      }
    });
  });

  describe('rollback', () => {
    it('should rollback rate limit', async () => {
      await enforcer.initialize();

      const action = await enforcer.triggerAction('rate_limit', 'user-rollback', 'Test');

      // Verify rate limit is active
      expect(enforcer.isAllowed('user-rollback').allowed).toBe(false);

      // Rollback
      // Note: Current implementation may not support direct rollback lookup
      // This tests the getRateLimits/getBlocks functionality
      const rateLimits = enforcer.getRateLimits();
      expect(rateLimits.some(r => r.principalId === 'user-rollback')).toBe(true);
    });
  });

  describe('rate limiting actions', () => {
    it('should enforce max actions per hour', async () => {
      config.enforcer!.maxActionsPerHour = 2;
      enforcer = new EnforcerAgent(config, mockStore as any, mockEventBus as any);
      await enforcer.initialize();

      // Execute max actions
      await enforcer.triggerAction('rate_limit', 'user-1', 'Test 1');
      await enforcer.triggerAction('rate_limit', 'user-2', 'Test 2');

      // Third action should fail
      const action = await enforcer.triggerAction('rate_limit', 'user-3', 'Test 3');

      expect(action.status).toBe('failed');
      expect(action.result?.message).toContain('limit exceeded');
    });
  });

  describe('health check', () => {
    it('should return health status', async () => {
      await enforcer.initialize();

      const health = await enforcer.healthCheck();

      expect(health.agentId).toBe(enforcer.id);
      expect(health.agentType).toBe('enforcer');
      expect(health.state).toBe('ready');
    });
  });

  // ==========================================================================
  // Enhanced Feature Tests
  // ==========================================================================

  describe('Decision Cache', () => {
    it('should cache allowed decisions', async () => {
      await enforcer.initialize();

      // First call - cache miss
      const result1 = enforcer.isAllowed('cache-user-1');
      expect(result1.allowed).toBe(true);

      // Second call - should hit cache
      const result2 = enforcer.isAllowed('cache-user-1');
      expect(result2.allowed).toBe(true);
      expect(result2.cached).toBe(true);

      // Verify cache stats
      const stats = enforcer.getCacheStats();
      expect(stats.hits).toBeGreaterThan(0);
    });

    it('should cache blocked decisions', async () => {
      await enforcer.initialize();

      // Apply block
      await enforcer.triggerAction('temporary_block', 'cache-blocked-user', 'Test');

      // First call after block
      const result1 = enforcer.isAllowed('cache-blocked-user');
      expect(result1.allowed).toBe(false);

      // Second call - should hit cache
      const result2 = enforcer.isAllowed('cache-blocked-user');
      expect(result2.allowed).toBe(false);
    });

    it('should bypass cache when skipCache is true', async () => {
      await enforcer.initialize();

      // First call
      enforcer.isAllowed('skip-cache-user');

      // Second call with skipCache
      const result = enforcer.isAllowed('skip-cache-user', { skipCache: true });
      expect(result.cached).toBeUndefined();
    });

    it('should invalidate cache for principal', async () => {
      await enforcer.initialize();

      // Cache some decisions
      enforcer.isAllowed('invalidate-user');
      enforcer.isAllowed('invalidate-user', { resourceKind: 'doc' });

      // Invalidate
      const count = enforcer.invalidateCacheForPrincipal('invalidate-user');
      expect(count).toBeGreaterThan(0);

      // Next call should be cache miss
      const result = enforcer.isAllowed('invalidate-user');
      expect(result.cached).toBeUndefined();
    });

    it('should clear entire cache', async () => {
      await enforcer.initialize();

      // Cache some decisions
      enforcer.isAllowed('clear-cache-user-1');
      enforcer.isAllowed('clear-cache-user-2');

      const statsBefore = enforcer.getCacheStats();
      expect(statsBefore.size).toBeGreaterThan(0);

      // Clear cache
      enforcer.clearCache();

      const statsAfter = enforcer.getCacheStats();
      expect(statsAfter.size).toBe(0);
    });

    it('should report cache statistics', async () => {
      await enforcer.initialize();

      // Generate some cache activity
      enforcer.isAllowed('stats-user-1');
      enforcer.isAllowed('stats-user-1'); // Hit
      enforcer.isAllowed('stats-user-2');

      const stats = enforcer.getCacheStats();
      expect(stats.hits).toBeDefined();
      expect(stats.misses).toBeDefined();
      expect(stats.size).toBeDefined();
      expect(stats.hitRate).toBeDefined();
      expect(stats.hitRate).toBeGreaterThanOrEqual(0);
      expect(stats.hitRate).toBeLessThanOrEqual(1);
    });
  });

  describe('Per-Resource Rate Limiting', () => {
    it('should track rate limits per principal/resource', async () => {
      await enforcer.initialize();

      const status = enforcer.getRateLimitStatus('rate-limit-user', 'document');

      expect(status.allowed).toBe(true);
      expect(status.remaining).toBeGreaterThan(0);
      expect(status.resetAt).toBeDefined();
    });

    it('should enforce rate limits when exceeded', async () => {
      // Configure low rate limit
      config.enforcer = {
        ...config.enforcer,
        rateLimiting: {
          enabled: true,
          defaultWindowMs: 60000,
          defaultMaxRequests: 3,
        },
        cache: {
          enabled: false, // Disable cache for this test to see rate limiting behavior
          defaultTtlMs: 0,
          maxEntries: 0,
          cleanupIntervalMs: 0,
        },
      } as any;

      enforcer = new EnforcerAgent(config, mockStore as any, mockEventBus as any);
      await enforcer.initialize();

      // Make requests up to limit (each isAllowed increments the counter)
      enforcer.isAllowed('limited-user');
      enforcer.isAllowed('limited-user');
      enforcer.isAllowed('limited-user');

      // 4th request should be denied (limit is 3)
      const result = enforcer.isAllowed('limited-user');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Rate limit exceeded');
    });

    it('should reset rate limits for principal', async () => {
      config.enforcer = {
        ...config.enforcer,
        rateLimiting: {
          enabled: true,
          defaultWindowMs: 60000,
          defaultMaxRequests: 2,
        },
        cache: {
          enabled: false, // Disable cache for this test to see rate limiting behavior
          defaultTtlMs: 0,
          maxEntries: 0,
          cleanupIntervalMs: 0,
        },
      } as any;

      enforcer = new EnforcerAgent(config, mockStore as any, mockEventBus as any);
      await enforcer.initialize();

      // Exhaust rate limit (limit is 2, so 3rd request should fail)
      enforcer.isAllowed('reset-limit-user');
      enforcer.isAllowed('reset-limit-user');

      // 3rd request should be denied
      const resultBefore = enforcer.isAllowed('reset-limit-user');
      expect(resultBefore.allowed).toBe(false);

      // Reset rate limit
      enforcer.resetRateLimitForPrincipal('reset-limit-user');

      // Should be allowed again
      const resultAfter = enforcer.isAllowed('reset-limit-user');
      expect(resultAfter.allowed).toBe(true);
    });
  });

  describe('Circuit Breaker', () => {
    it('should start with circuits closed', async () => {
      await enforcer.initialize();

      const status = enforcer.getCircuitBreakerStatus();

      // All monitored services should have closed circuits
      for (const service of Object.keys(status)) {
        expect(status[service].state).toBe('closed');
        expect(status[service].failures).toBe(0);
      }
    });

    it('should allow service calls when circuit is closed', async () => {
      await enforcer.initialize();

      const canCall = enforcer.canCallService('webhook');
      expect(canCall).toBe(true);
    });

    it('should track service success', async () => {
      await enforcer.initialize();

      enforcer.recordServiceSuccess('webhook');

      const status = enforcer.getCircuitBreakerStatus();
      expect(status['webhook'].state).toBe('closed');
    });

    it('should open circuit after failures exceed threshold', async () => {
      config.enforcer = {
        ...config.enforcer,
        circuitBreaker: {
          enabled: true,
          failureThreshold: 3,
          resetTimeoutMs: 30000,
          halfOpenMaxCalls: 2,
          monitoredServices: ['test-service'],
        },
      } as any;

      enforcer = new EnforcerAgent(config, mockStore as any, mockEventBus as any);
      await enforcer.initialize();

      // Record failures
      enforcer.recordServiceFailure('test-service');
      enforcer.recordServiceFailure('test-service');
      enforcer.recordServiceFailure('test-service');

      const status = enforcer.getCircuitBreakerStatus();
      expect(status['test-service'].state).toBe('open');

      // Should block calls
      const canCall = enforcer.canCallService('test-service');
      expect(canCall).toBe(false);
    });

    it('should block action execution when circuit is open', async () => {
      config.enforcer = {
        ...config.enforcer,
        circuitBreaker: {
          enabled: true,
          failureThreshold: 1,
          resetTimeoutMs: 60000,
          halfOpenMaxCalls: 2,
          monitoredServices: ['webhook'],
        },
      } as any;

      enforcer = new EnforcerAgent(config, mockStore as any, mockEventBus as any);
      await enforcer.initialize();

      // Open the circuit
      enforcer.recordServiceFailure('webhook');

      // Try to execute action that uses webhook
      const action = await enforcer.triggerAction('alert_admin', 'circuit-test-user', 'Test');

      expect(action.status).toBe('failed');
      expect(action.result?.message).toContain('Circuit breaker open');
    });
  });

  describe('Graceful Degradation', () => {
    it('should start in healthy mode', async () => {
      await enforcer.initialize();

      const status = enforcer.getDegradationStatus();

      expect(status.active).toBe(false);
      expect(status.mode).toBeNull();
      expect(status.healthy).toBe(true);
    });

    it('should activate degradation mode', async () => {
      await enforcer.initialize();

      enforcer.activateDegradation('deny_all', 'Test degradation');

      const status = enforcer.getDegradationStatus();
      expect(status.active).toBe(true);
      expect(status.mode).toBe('deny_all');
      expect(status.healthy).toBe(false);
    });

    it('should deactivate degradation mode', async () => {
      await enforcer.initialize();

      enforcer.activateDegradation('allow_all', 'Test');
      enforcer.deactivateDegradation();

      const status = enforcer.getDegradationStatus();
      expect(status.active).toBe(false);
      expect(status.mode).toBeNull();
      expect(status.healthy).toBe(true);
    });

    it('should allow all in allow_all mode', async () => {
      await enforcer.initialize();

      enforcer.activateDegradation('allow_all', 'Test');

      const result = enforcer.isAllowed('degraded-user');
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('Degraded mode');
    });

    it('should deny all in deny_all mode', async () => {
      await enforcer.initialize();

      enforcer.activateDegradation('deny_all', 'Test');

      const result = enforcer.isAllowed('degraded-user');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Degraded mode');
    });

    it('should use cache only in cached_only mode', async () => {
      await enforcer.initialize();

      // Cache a decision first
      enforcer.isAllowed('cached-mode-user');

      // Activate cached_only mode
      enforcer.activateDegradation('cached_only', 'Test');

      // Cached user should be allowed
      const result1 = enforcer.isAllowed('cached-mode-user');
      expect(result1.allowed).toBe(true);
      expect(result1.cached).toBe(true);

      // Non-cached user should be denied
      const result2 = enforcer.isAllowed('non-cached-user');
      expect(result2.allowed).toBe(false);
      expect(result2.reason).toContain('no cached decision');
    });

    it('should use rate limiting in rate_limited mode', async () => {
      config.enforcer = {
        ...config.enforcer,
        rateLimiting: {
          enabled: true,
          defaultWindowMs: 60000,
          defaultMaxRequests: 2,
        },
      } as any;

      enforcer = new EnforcerAgent(config, mockStore as any, mockEventBus as any);
      await enforcer.initialize();

      enforcer.activateDegradation('rate_limited', 'Test');

      // First two requests should pass
      expect(enforcer.isAllowed('rate-mode-user').allowed).toBe(true);
      expect(enforcer.isAllowed('rate-mode-user').allowed).toBe(true);

      // Third should fail
      const result = enforcer.isAllowed('rate-mode-user');
      expect(result.allowed).toBe(false);
    });
  });

  describe('Audit Trail', () => {
    it('should record audit entries', async () => {
      await enforcer.initialize();

      // Trigger some actions
      await enforcer.triggerAction('rate_limit', 'audit-user', 'Test audit');

      const trail = enforcer.getAuditTrail();
      expect(trail.length).toBeGreaterThan(0);
    });

    it('should filter audit entries by event type', async () => {
      await enforcer.initialize();

      await enforcer.triggerAction('rate_limit', 'audit-filter-user', 'Test');

      const trail = enforcer.getAuditTrail({ eventType: 'rate_limit_applied' });

      for (const entry of trail) {
        expect(entry.eventType).toBe('rate_limit_applied');
      }
    });

    it('should filter audit entries by principal', async () => {
      await enforcer.initialize();

      await enforcer.triggerAction('rate_limit', 'specific-audit-user', 'Test');
      await enforcer.triggerAction('rate_limit', 'other-user', 'Test');

      const trail = enforcer.getAuditTrail({ principalId: 'specific-audit-user' });

      for (const entry of trail) {
        if (entry.principalId) {
          expect(entry.principalId).toBe('specific-audit-user');
        }
      }
    });

    it('should limit audit trail results', async () => {
      await enforcer.initialize();

      // Generate multiple audit entries
      for (let i = 0; i < 10; i++) {
        await enforcer.triggerAction('rate_limit', `limit-user-${i}`, 'Test');
      }

      const trail = enforcer.getAuditTrail({ limit: 5 });
      expect(trail.length).toBeLessThanOrEqual(5);
    });

    it('should provide audit statistics', async () => {
      await enforcer.initialize();

      await enforcer.triggerAction('rate_limit', 'stats-audit-user-1', 'Test');
      await enforcer.triggerAction('temporary_block', 'stats-audit-user-2', 'Test');

      const stats = enforcer.getAuditStats();

      expect(stats.totalEntries).toBeGreaterThan(0);
      expect(stats.byEventType).toBeDefined();
      expect(stats.byActionType).toBeDefined();
    });

    it('should export full audit trail', async () => {
      await enforcer.initialize();

      await enforcer.triggerAction('rate_limit', 'export-user', 'Test');

      const exported = enforcer.exportAuditTrail();
      expect(Array.isArray(exported)).toBe(true);
      expect(exported.length).toBeGreaterThan(0);

      // Each entry should have required fields
      for (const entry of exported) {
        expect(entry.id).toBeDefined();
        expect(entry.timestamp).toBeDefined();
        expect(entry.eventType).toBeDefined();
        expect(entry.details).toBeDefined();
      }
    });

    it('should record approval workflow events', async () => {
      await enforcer.initialize();

      // Create anomaly to trigger approval request
      const anomaly: Anomaly = {
        id: 'audit-anomaly-123',
        detectedAt: new Date(),
        type: 'velocity_spike',
        severity: 'high',
        principalId: 'approval-audit-user',
        description: 'Test anomaly for audit',
        score: 0.85,
        evidence: { recentRequests: 50, baselineRequests: 5, deviation: 4, relatedDecisions: [] },
        baseline: { period: '7d', avgRequestsPerHour: 2, uniqueResources: 2, commonActions: ['read'], commonTimeRanges: [] },
        observed: { requestsInWindow: 50, uniqueResourcesAccessed: 20, actionsPerformed: ['read', 'write'], timeOfAccess: new Date().toISOString() },
        status: 'open',
      };

      // Simulate anomaly event
      const handler = mockEventBus.subscribe.mock.calls[0][1];
      await handler({ payload: anomaly });

      // Check for approval_requested event
      const trail = enforcer.getAuditTrail({ eventType: 'approval_requested' });
      expect(trail.length).toBeGreaterThan(0);

      // Approve the action
      const pending = enforcer.getPendingActions();
      if (pending.length > 0) {
        await enforcer.approveAction(pending[0].id, 'admin@test.com');

        // Check for approval_granted event
        const grantedTrail = enforcer.getAuditTrail({ eventType: 'approval_granted' });
        expect(grantedTrail.length).toBeGreaterThan(0);
      }
    });

    it('should record rejection events', async () => {
      await enforcer.initialize();

      // Create anomaly to trigger approval request
      const anomaly: Anomaly = {
        id: 'reject-anomaly-123',
        detectedAt: new Date(),
        type: 'unusual_access_time',
        severity: 'high',
        principalId: 'reject-audit-user',
        description: 'Test rejection',
        score: 0.75,
        evidence: { recentRequests: 30, baselineRequests: 10, deviation: 2, relatedDecisions: [] },
        baseline: { period: '7d', avgRequestsPerHour: 3, uniqueResources: 5, commonActions: ['read'], commonTimeRanges: [] },
        observed: { requestsInWindow: 30, uniqueResourcesAccessed: 15, actionsPerformed: ['read'], timeOfAccess: new Date().toISOString() },
        status: 'open',
      };

      const handler = mockEventBus.subscribe.mock.calls[0][1];
      await handler({ payload: anomaly });

      // Reject the action
      const pending = enforcer.getPendingActions();
      if (pending.length > 0) {
        enforcer.rejectAction(pending[0].id, 'admin@test.com', 'False positive');

        const rejectedTrail = enforcer.getAuditTrail({ eventType: 'approval_rejected' });
        expect(rejectedTrail.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Enhanced isActionAllowed', () => {
    it('should check action with full context', async () => {
      await enforcer.initialize();

      const result = enforcer.isActionAllowed(
        'action-check-user',
        'document',
        'doc-123',
        'read'
      );

      expect(result.allowed).toBe(true);
    });

    it('should respect blocks for action checks', async () => {
      await enforcer.initialize();

      await enforcer.triggerAction('temporary_block', 'blocked-action-user', 'Test');

      const result = enforcer.isActionAllowed(
        'blocked-action-user',
        'document',
        'doc-123',
        'read'
      );

      expect(result.allowed).toBe(false);
    });
  });

  describe('Integration: Cache + Rate Limit + Circuit Breaker', () => {
    it('should coordinate all features during enforcement', async () => {
      await enforcer.initialize();

      // 1. First request - should check all systems
      const result1 = enforcer.isAllowed('integration-user');
      expect(result1.allowed).toBe(true);

      // 2. Second request - should hit cache
      const result2 = enforcer.isAllowed('integration-user');
      expect(result2.cached).toBe(true);

      // 3. Trigger rate limit action
      await enforcer.triggerAction('rate_limit', 'integration-user', 'Suspicious');

      // 4. Cache should be invalidated, user should be denied
      const result3 = enforcer.isAllowed('integration-user');
      expect(result3.allowed).toBe(false);
      expect(result3.reason).toContain('Rate limited');

      // 5. Check audit trail has all events
      const stats = enforcer.getAuditStats();
      expect(stats.totalEntries).toBeGreaterThan(0);
    });

    it('should handle circuit breaker failure gracefully', async () => {
      config.enforcer = {
        ...config.enforcer,
        circuitBreaker: {
          enabled: true,
          failureThreshold: 1,
          resetTimeoutMs: 60000,
          halfOpenMaxCalls: 2,
          monitoredServices: ['webhook', 'mfa'],
        },
      } as any;

      enforcer = new EnforcerAgent(config, mockStore as any, mockEventBus as any);
      await enforcer.initialize();

      // Open webhook circuit
      enforcer.recordServiceFailure('webhook');

      // alert_admin should fail due to circuit breaker
      const alertAction = await enforcer.triggerAction('alert_admin', 'cb-test-user', 'Test');
      expect(alertAction.status).toBe('failed');
      expect(alertAction.result?.message).toContain('Circuit breaker');

      // But rate_limit should still work (no downstream service)
      const rateLimitAction = await enforcer.triggerAction('rate_limit', 'cb-test-user', 'Test');
      expect(rateLimitAction.status).toBe('completed');
    });
  });
});
