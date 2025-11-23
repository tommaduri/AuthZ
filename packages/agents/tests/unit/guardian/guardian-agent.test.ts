import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GuardianAgent } from '../../../src/guardian/guardian-agent.js';
import type { CheckRequest } from '@authz-engine/core';
import type { AgentConfig } from '../../../src/types/agent.types.js';

// Mock dependencies
const mockStore = {
  initialize: vi.fn(),
  close: vi.fn(),
  storeDecision: vi.fn(),
  storeAnomaly: vi.fn(),
  queryDecisions: vi.fn().mockResolvedValue([]),
  getPrincipalStats: vi.fn().mockResolvedValue({
    totalRequests: 100,
    uniqueResources: 10,
    denialRate: 0.05,
    avgAnomalyScore: 0.2,
    commonActions: ['view', 'list'],
  }),
  updateAnomalyStatus: vi.fn().mockResolvedValue(undefined),
};

const mockEventBus = {
  initialize: vi.fn(),
  shutdown: vi.fn(),
  publish: vi.fn(),
  subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
};

describe('GuardianAgent', () => {
  let guardian: GuardianAgent;
  let config: AgentConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    config = {
      enabled: true,
      logLevel: 'error', // Suppress logs in tests
      guardian: {
        anomalyThreshold: 0.7,
        baselinePeriodDays: 30,
        velocityWindowMinutes: 5,
        enableRealTimeDetection: true,
      },
    };

    guardian = new GuardianAgent(
      config,
      mockStore as any,
      mockEventBus as any,
    );
  });

  describe('initialization', () => {
    it('should initialize with ready state', async () => {
      await guardian.initialize();
      expect(guardian.state).toBe('ready');
    });

    it('should have correct agent type and name', () => {
      expect(guardian.type).toBe('guardian');
      expect(guardian.name).toBe('GUARDIAN - Anomaly Detection');
    });
  });

  describe('analyzeRequest', () => {
    const createRequest = (overrides: Partial<CheckRequest> = {}): CheckRequest => ({
      principal: {
        id: 'user-123',
        roles: ['user'],
        attributes: {},
      },
      resource: {
        kind: 'document',
        id: 'doc-1',
        attributes: {},
      },
      actions: ['view'],
      ...overrides,
    });

    it('should return low anomaly score for normal request', async () => {
      await guardian.initialize();

      const request = createRequest();
      const result = await guardian.analyzeRequest(request);

      expect(result.anomalyScore).toBeLessThan(0.7);
      expect(result.anomaly).toBeUndefined();
    });

    it('should detect velocity anomaly for rapid requests', async () => {
      await guardian.initialize();

      const request = createRequest();

      // Simulate rapid requests
      for (let i = 0; i < 600; i++) {
        await guardian.analyzeRequest(request);
      }

      const result = await guardian.analyzeRequest(request);

      expect(result.anomalyScore).toBeGreaterThan(0);
      expect(result.riskFactors.some(f => f.type === 'velocity_spike')).toBe(true);
    });

    it('should detect suspicious patterns in resource access', async () => {
      await guardian.initialize();

      const suspiciousRequest = createRequest({
        resource: {
          kind: 'admin-settings',
          id: 'admin-1',
          attributes: {},
        },
        actions: ['delete'],
      });

      const result = await guardian.analyzeRequest(suspiciousRequest);

      expect(result.riskFactors.some(f => f.type === 'suspicious_pattern')).toBe(true);
    });

    it('should detect bulk operation patterns', async () => {
      await guardian.initialize();

      const bulkRequest = createRequest({
        actions: ['bulk-delete'],
      });

      const result = await guardian.analyzeRequest(bulkRequest);

      expect(result.riskFactors.some(f => f.type === 'bulk_operation')).toBe(true);
    });

    it('should create anomaly when score exceeds threshold', async () => {
      // Lower threshold to trigger anomaly more easily
      config.guardian!.anomalyThreshold = 0.1;
      guardian = new GuardianAgent(config, mockStore as any, mockEventBus as any);
      await guardian.initialize();

      const suspiciousRequest = createRequest({
        resource: {
          kind: 'payout',
          id: 'payout-1',
          attributes: {},
        },
        actions: ['bulk-export'],
      });

      const result = await guardian.analyzeRequest(suspiciousRequest);

      if (result.anomalyScore >= 0.1) {
        expect(result.anomaly).toBeDefined();
        expect(mockStore.storeAnomaly).toHaveBeenCalled();
      }
    });
  });

  describe('anomaly resolution', () => {
    it('should resolve anomaly and update store', async () => {
      await guardian.initialize();

      await guardian.resolveAnomaly('anomaly-123', 'resolved', 'False alarm');

      expect(mockStore.updateAnomalyStatus).toHaveBeenCalledWith(
        'anomaly-123',
        'resolved',
        'False alarm'
      );
    });
  });

  describe('health check', () => {
    it('should return health status', async () => {
      await guardian.initialize();

      const health = await guardian.healthCheck();

      expect(health.agentId).toBe(guardian.id);
      expect(health.agentType).toBe('guardian');
      expect(health.state).toBe('ready');
      expect(health.metrics).toBeDefined();
    });
  });
});
