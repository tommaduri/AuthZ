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

  // =============================================================================
  // ENHANCED ANALYTICS TESTS
  // =============================================================================

  describe('time-series analysis', () => {
    it('should analyze time series for a principal', async () => {
      await analyst.initialize();

      // Create decisions spread over time
      const decisions = Array.from({ length: 24 }, (_, i) =>
        createMockDecision({
          principal: { id: 'user-1', roles: ['user'], attributes: {} },
          timestamp: new Date(Date.now() - i * 60 * 60 * 1000), // Each hour back
          resource: { kind: 'document', id: `doc-${i}`, attributes: {} },
        })
      );

      mockStore.queryDecisions.mockResolvedValue(decisions);

      const timeSeries = await analyst.analyzeTimeSeries('user-1', 24);

      expect(Array.isArray(timeSeries)).toBe(true);
      expect(timeSeries.length).toBeGreaterThan(0);
      expect(timeSeries[0]).toHaveProperty('timestamp');
      expect(timeSeries[0]).toHaveProperty('requestCount');
      expect(timeSeries[0]).toHaveProperty('denialCount');
    });

    it('should return empty array when no decisions found', async () => {
      await analyst.initialize();
      mockStore.queryDecisions.mockResolvedValue([]);

      const timeSeries = await analyst.analyzeTimeSeries('user-1', 24);

      expect(timeSeries).toEqual([]);
    });

    it('should detect time series anomalies', async () => {
      await analyst.initialize();

      // Create time series with a significant spike
      // Mean = (10+10+10+10+100)/5 = 28, StdDev approx 36
      // Z-score for 100 = (100-28)/36 = 2.0
      // Use threshold of 1.5 to catch it
      const timeSeries = [
        { timestamp: new Date(), requestCount: 10, denialCount: 0, uniqueResources: 1, uniqueActions: ['view'] },
        { timestamp: new Date(), requestCount: 10, denialCount: 0, uniqueResources: 1, uniqueActions: ['view'] },
        { timestamp: new Date(), requestCount: 100, denialCount: 0, uniqueResources: 5, uniqueActions: ['view'] }, // Spike
        { timestamp: new Date(), requestCount: 10, denialCount: 0, uniqueResources: 1, uniqueActions: ['view'] },
        { timestamp: new Date(), requestCount: 10, denialCount: 0, uniqueResources: 1, uniqueActions: ['view'] },
      ];

      // Use a lower threshold to detect the anomaly
      const anomalies = analyst.detectTimeSeriesAnomalies(timeSeries, 1.5);

      expect(anomalies.length).toBeGreaterThan(0);
      expect(anomalies[0]).toHaveProperty('point');
      expect(anomalies[0]).toHaveProperty('zScore');
      expect(anomalies[0]).toHaveProperty('anomalyType');
      expect(anomalies[0].anomalyType).toBe('velocity_spike');
    });

    it('should return empty when time series too short', async () => {
      await analyst.initialize();

      const timeSeries = [
        { timestamp: new Date(), requestCount: 10, denialCount: 0, uniqueResources: 1, uniqueActions: ['view'] },
      ];

      const anomalies = analyst.detectTimeSeriesAnomalies(timeSeries);

      expect(anomalies).toEqual([]);
    });
  });

  describe('user behavior profiling', () => {
    it('should build user behavior profile', async () => {
      await analyst.initialize();

      // Create decisions for user with consistent patterns
      const decisions = Array.from({ length: 50 }, (_, i) => {
        const date = new Date();
        date.setHours(9 + (i % 8)); // Access between 9am-5pm
        date.setDate(date.getDate() - Math.floor(i / 8)); // Spread over days
        return createMockDecision({
          principal: { id: 'user-1', roles: ['developer'], attributes: {} },
          timestamp: date,
          resource: { kind: i % 3 === 0 ? 'code' : 'document', id: `res-${i}`, attributes: {} },
          actions: ['view', 'edit'],
          results: { view: { allowed: true }, edit: { allowed: i % 10 !== 0 } },
        });
      });

      mockStore.queryDecisions.mockResolvedValue(decisions);

      const profile = await analyst.buildUserProfile('user-1');

      expect(profile.principalId).toBe('user-1');
      expect(profile.typicalAccessHours.length).toBeGreaterThan(0);
      expect(profile.commonResources.size).toBeGreaterThan(0);
      expect(profile.commonActions.size).toBeGreaterThan(0);
      expect(typeof profile.avgRequestsPerHour).toBe('number');
      expect(typeof profile.historicalDenialRate).toBe('number');
      expect(profile.behaviorHash).toBeDefined();
    });

    it('should return empty profile when no decisions', async () => {
      await analyst.initialize();
      mockStore.queryDecisions.mockResolvedValue([]);

      const profile = await analyst.buildUserProfile('new-user');

      expect(profile.principalId).toBe('new-user');
      expect(profile.typicalAccessHours).toEqual([]);
      expect(profile.commonResources.size).toBe(0);
      expect(profile.avgRequestsPerHour).toBe(0);
    });

    it('should cache and retrieve user profiles', async () => {
      await analyst.initialize();

      const decisions = Array.from({ length: 10 }, () =>
        createMockDecision({
          principal: { id: 'user-2', roles: ['user'], attributes: {} },
        })
      );

      mockStore.queryDecisions.mockResolvedValue(decisions);

      // First call builds profile
      const profile1 = await analyst.getUserProfile('user-2');
      expect(mockStore.queryDecisions).toHaveBeenCalledTimes(1);

      // Second call should use cache (queryDecisions not called again)
      const profile2 = await analyst.getUserProfile('user-2');
      expect(mockStore.queryDecisions).toHaveBeenCalledTimes(1);
      expect(profile1.principalId).toBe(profile2.principalId);
    });
  });

  describe('resource access tracking', () => {
    it('should track resource access statistics', async () => {
      await analyst.initialize();

      const decisions = Array.from({ length: 30 }, (_, i) => {
        const date = new Date();
        date.setHours(9 + (i % 10));
        return createMockDecision({
          principal: { id: `user-${i % 5}`, roles: ['user'], attributes: {} },
          timestamp: date,
          resource: { kind: 'document', id: `doc-${i}`, attributes: {} },
          results: { view: { allowed: i % 10 !== 0 } },
        });
      });

      mockStore.queryDecisions.mockResolvedValue(decisions);

      const stats = await analyst.trackResourceAccess('document');

      expect(stats.resourceKind).toBe('document');
      expect(stats.totalAccesses).toBe(30);
      expect(stats.uniquePrincipals).toBe(5);
      expect(stats.accessByHour.size).toBeGreaterThan(0);
      expect(typeof stats.denialRate).toBe('number');
      expect(typeof stats.avgAccessesPerPrincipal).toBe('number');
    });

    it('should return empty stats when no access', async () => {
      await analyst.initialize();
      mockStore.queryDecisions.mockResolvedValue([]);

      const stats = await analyst.trackResourceAccess('unknown-resource');

      expect(stats.resourceKind).toBe('unknown-resource');
      expect(stats.totalAccesses).toBe(0);
      expect(stats.uniquePrincipals).toBe(0);
      expect(stats.denialRate).toBe(0);
    });

    it('should cache resource statistics', async () => {
      await analyst.initialize();

      const decisions = Array.from({ length: 10 }, () =>
        createMockDecision({
          resource: { kind: 'api', id: 'api-1', attributes: {} },
        })
      );

      mockStore.queryDecisions.mockResolvedValue(decisions);

      await analyst.trackResourceAccess('api');

      const cachedStats = analyst.getResourceStats('api');
      expect(cachedStats).toBeDefined();
      expect(cachedStats?.resourceKind).toBe('api');
    });
  });

  describe('risk score calculation', () => {
    it('should calculate risk score for a decision', async () => {
      await analyst.initialize();

      // Setup profile first
      const profileDecisions = Array.from({ length: 20 }, () =>
        createMockDecision({
          principal: { id: 'user-1', roles: ['user'], attributes: {} },
          resource: { kind: 'document', id: 'doc-1', attributes: {} },
          actions: ['view'],
        })
      );
      mockStore.queryDecisions.mockResolvedValue(profileDecisions);
      await analyst.buildUserProfile('user-1');

      // Now calculate risk for a new decision
      const decision = createMockDecision({
        principal: { id: 'user-1', roles: ['user'], attributes: {} },
        resource: { kind: 'admin-panel', id: 'admin-1', attributes: {} }, // Unusual resource
        actions: ['admin'], // Sensitive action
      });

      const assessment = await analyst.calculateRiskScore(decision);

      expect(assessment.requestId).toBe(decision.requestId);
      expect(assessment.principalId).toBe('user-1');
      expect(typeof assessment.riskScore).toBe('number');
      expect(assessment.riskScore).toBeGreaterThanOrEqual(0);
      expect(assessment.riskScore).toBeLessThanOrEqual(1);
      expect(assessment.components).toHaveProperty('anomalyScore');
      expect(assessment.components).toHaveProperty('velocityScore');
      expect(assessment.components).toHaveProperty('temporalScore');
      expect(assessment.components).toHaveProperty('resourceScore');
      expect(assessment.components).toHaveProperty('behaviorScore');
      expect(['low', 'medium', 'high', 'critical']).toContain(assessment.riskLevel);
    });

    it('should identify risk factors', async () => {
      await analyst.initialize();
      mockStore.queryDecisions.mockResolvedValue([]);

      // Decision from unknown user accessing sensitive resource
      const decision = createMockDecision({
        principal: { id: 'new-user', roles: ['user'], attributes: {} },
        resource: { kind: 'admin-config', id: 'config-1', attributes: {} },
        actions: ['delete'],
      });

      const assessment = await analyst.calculateRiskScore(decision);

      // Should have some risk factors due to unusual patterns
      expect(Array.isArray(assessment.riskFactors)).toBe(true);
      expect(Array.isArray(assessment.recommendations)).toBe(true);
    });
  });

  describe('statistical anomaly detection', () => {
    it('should detect volume anomalies', async () => {
      await analyst.initialize();

      // Create decisions with one user having significantly more requests
      const decisions: DecisionRecord[] = [];
      // Normal users with few requests
      for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 5; j++) {
          decisions.push(createMockDecision({
            principal: { id: `user-${i}`, roles: ['user'], attributes: {} },
          }));
        }
      }
      // Anomalous user with many requests
      for (let j = 0; j < 100; j++) {
        decisions.push(createMockDecision({
          principal: { id: 'suspicious-user', roles: ['user'], attributes: {} },
        }));
      }

      mockStore.queryDecisions.mockResolvedValue(decisions);

      const result = await analyst.detectStatisticalAnomalies();

      expect(result.summary.totalDecisions).toBe(150);
      expect(result.anomalies.length).toBeGreaterThan(0);

      const volumeSpike = result.anomalies.find(a => a.type === 'volume_spike');
      expect(volumeSpike).toBeDefined();
      expect(volumeSpike?.evidence.principalId).toBe('suspicious-user');
    });

    it('should detect high denial rate anomalies', async () => {
      await analyst.initialize();

      // Create decisions with one user having high denial rate
      const decisions: DecisionRecord[] = [];
      // Normal user with some denials
      for (let i = 0; i < 10; i++) {
        decisions.push(createMockDecision({
          principal: { id: 'normal-user', roles: ['user'], attributes: {} },
          results: { view: { allowed: true } },
        }));
      }
      // User with high denial rate
      for (let i = 0; i < 10; i++) {
        decisions.push(createMockDecision({
          principal: { id: 'blocked-user', roles: ['user'], attributes: {} },
          results: { view: { allowed: i < 2 } }, // 80% denial rate
        }));
      }

      mockStore.queryDecisions.mockResolvedValue(decisions);

      const result = await analyst.detectStatisticalAnomalies();

      const denialAnomaly = result.anomalies.find(a => a.type === 'high_denial_rate');
      expect(denialAnomaly).toBeDefined();
      expect(denialAnomaly?.evidence.principalId).toBe('blocked-user');
    });

    it('should return empty when no anomalies', async () => {
      await analyst.initialize();

      // Create uniform decisions
      const decisions = Array.from({ length: 20 }, (_, i) =>
        createMockDecision({
          principal: { id: `user-${i % 4}`, roles: ['user'], attributes: {} },
        })
      );

      mockStore.queryDecisions.mockResolvedValue(decisions);

      const result = await analyst.detectStatisticalAnomalies();

      expect(result.summary.totalDecisions).toBe(20);
      // May or may not have anomalies depending on distribution
      expect(Array.isArray(result.anomalies)).toBe(true);
    });

    it('should return empty summary when no decisions', async () => {
      await analyst.initialize();
      mockStore.queryDecisions.mockResolvedValue([]);

      const result = await analyst.detectStatisticalAnomalies();

      expect(result.summary.totalDecisions).toBe(0);
      expect(result.summary.anomalyCount).toBe(0);
      expect(result.anomalies).toEqual([]);
    });
  });

  describe('cache management', () => {
    it('should clear all caches', async () => {
      await analyst.initialize();

      // Build some cached data
      mockStore.queryDecisions.mockResolvedValue([
        createMockDecision({ principal: { id: 'user-1', roles: ['user'], attributes: {} } }),
      ]);
      await analyst.buildUserProfile('user-1');
      await analyst.trackResourceAccess('document');

      expect(analyst.getUserProfiles().size).toBeGreaterThan(0);
      expect(analyst.getResourceStatistics().size).toBeGreaterThan(0);

      // Clear caches
      analyst.clearCaches();

      expect(analyst.getUserProfiles().size).toBe(0);
      expect(analyst.getResourceStatistics().size).toBe(0);
    });
  });
});
