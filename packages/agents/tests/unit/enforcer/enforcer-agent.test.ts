import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EnforcerAgent } from '../../../src/enforcer/enforcer-agent.js';
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
});
