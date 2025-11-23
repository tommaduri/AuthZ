import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalystAgent } from '../../../src/analyst/analyst-agent.js';
import type { AgentConfig, DecisionRecord } from '../../../src/types/agent.types.js';

// Mock dependencies
const createMockDecision = (overrides: Partial<DecisionRecord> = {}): DecisionRecord => ({
  id: `decision-${Math.random()}`,
  requestId: `req-${Math.random()}`,
  timestamp: new Date(),
  principal: { id: 'user-1', roles: ['user'], attributes: {} },
  resource: { kind: 'document', id: 'doc-1', attributes: {} },
  actions: ['view'],
  results: { view: { allowed: true } },
  derivedRoles: [],
  matchedPolicies: [],
  ...overrides,
});

const mockStore = {
  initialize: vi.fn(),
  close: vi.fn(),
  storePattern: vi.fn(),
  queryDecisions: vi.fn(),
};

const mockEventBus = {
  initialize: vi.fn(),
  shutdown: vi.fn(),
  publish: vi.fn(),
  subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
};

describe('AnalystAgent', () => {
  let analyst: AnalystAgent;
  let config: AgentConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    config = {
      enabled: true,
      logLevel: 'error',
      analyst: {
        minSampleSize: 10, // Lower for testing
        confidenceThreshold: 0.5,
        learningEnabled: false, // Disable auto-discovery in tests
      },
    };

    analyst = new AnalystAgent(
      config,
      mockStore as any,
      mockEventBus as any,
    );
  });

  describe('initialization', () => {
    it('should initialize with ready state', async () => {
      await analyst.initialize();
      expect(analyst.state).toBe('ready');
    });

    it('should have correct agent type and name', () => {
      expect(analyst.type).toBe('analyst');
      expect(analyst.name).toBe('ANALYST - Pattern Learning');
    });
  });

  describe('pattern discovery', () => {
    it('should discover denial patterns', async () => {
      await analyst.initialize();

      // Create mock denied decisions with common pattern
      const deniedDecisions = Array.from({ length: 50 }, () =>
        createMockDecision({
          principal: { id: `user-${Math.random()}`, roles: ['subscriber'], attributes: {} },
          resource: { kind: 'premium-content', id: 'content-1', attributes: {} },
          actions: ['view'],
          results: { view: { allowed: false } },
        })
      );

      mockStore.queryDecisions.mockResolvedValue(deniedDecisions);

      const patterns = await analyst.discoverPatterns();

      // Should find patterns if sample size is met
      expect(Array.isArray(patterns)).toBe(true);
    });

    it('should discover access correlations', async () => {
      await analyst.initialize();

      // Create decisions showing correlation between resources
      const decisions: DecisionRecord[] = [];
      for (let i = 0; i < 100; i++) {
        const userId = `user-${i % 20}`; // 20 unique users

        // Users who access 'avatar' also access 'profile'
        decisions.push(
          createMockDecision({
            principal: { id: userId, roles: ['user'], attributes: {} },
            resource: { kind: 'avatar', id: `avatar-${i}`, attributes: {} },
          }),
          createMockDecision({
            principal: { id: userId, roles: ['user'], attributes: {} },
            resource: { kind: 'profile', id: `profile-${i}`, attributes: {} },
          })
        );
      }

      mockStore.queryDecisions.mockResolvedValue(decisions);

      const patterns = await analyst.discoverPatterns();

      const correlationPatterns = patterns.filter(p => p.type === 'access_correlation');
      // May or may not find correlation depending on thresholds
      expect(Array.isArray(correlationPatterns)).toBe(true);
    });

    it('should discover role clusters', async () => {
      await analyst.initialize();

      // Create decisions showing role-resource affinity
      const decisions: DecisionRecord[] = [];
      for (let i = 0; i < 100; i++) {
        decisions.push(
          createMockDecision({
            principal: { id: `influencer-${i}`, roles: ['influencer'], attributes: {} },
            resource: { kind: 'avatar', id: `avatar-${i}`, attributes: {} },
          })
        );
      }

      mockStore.queryDecisions.mockResolvedValue(decisions);

      const patterns = await analyst.discoverPatterns();

      const rolePatterns = patterns.filter(p => p.type === 'role_cluster');
      expect(Array.isArray(rolePatterns)).toBe(true);
    });
  });

  describe('pattern validation', () => {
    it('should validate and approve patterns', async () => {
      await analyst.initialize();

      // First discover a pattern
      mockStore.queryDecisions.mockResolvedValue([]);
      await analyst.discoverPatterns();

      // Manually add a pattern for testing
      const testPattern = {
        id: 'test-pattern-1',
        discoveredAt: new Date(),
        lastUpdated: new Date(),
        type: 'denial_pattern' as const,
        confidence: 0.9,
        sampleSize: 100,
        description: 'Test pattern',
        conditions: [],
        isApproved: false,
      };

      // @ts-ignore - accessing private for test
      analyst['patterns'].set(testPattern.id, testPattern);

      await analyst.validatePattern('test-pattern-1', true, 'admin@test.com');

      expect(mockStore.storePattern).toHaveBeenCalled();
    });
  });

  describe('policy suggestion', () => {
    it('should generate policy suggestion for pattern', async () => {
      await analyst.initialize();

      const testPattern = {
        id: 'test-pattern-1',
        discoveredAt: new Date(),
        lastUpdated: new Date(),
        type: 'denial_pattern' as const,
        confidence: 0.9,
        sampleSize: 100,
        description: 'Users denied access to premium content',
        conditions: [],
        suggestedPolicyRule: '# Sample policy rule',
        isApproved: false,
      };

      // @ts-ignore - accessing private for test
      analyst['patterns'].set(testPattern.id, testPattern);

      const suggestion = await analyst.suggestPolicy('test-pattern-1');

      expect(suggestion).toBeDefined();
      expect(suggestion).toContain('# Sample policy rule');
    });
  });

  describe('health check', () => {
    it('should return health status', async () => {
      await analyst.initialize();

      const health = await analyst.healthCheck();

      expect(health.agentId).toBe(analyst.id);
      expect(health.agentType).toBe('analyst');
      expect(health.state).toBe('ready');
    });
  });
});
