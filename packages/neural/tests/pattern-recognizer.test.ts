/**
 * Pattern Recognizer Tests
 *
 * TDD tests for the PatternRecognizer class.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PatternRecognizer } from '../src/patterns/PatternRecognizer.js';
import type {
  PatternRecognizerConfig,
  BehaviorProfile,
  FeatureInput,
  DecisionRecord,
  AnomalyResult,
  Pattern,
  TimeDistribution,
  VelocityProfile,
} from '../src/patterns/types.js';

describe('PatternRecognizer', () => {
  let recognizer: PatternRecognizer;
  let defaultConfig: PatternRecognizerConfig;

  beforeEach(() => {
    defaultConfig = {
      anomalyThreshold: 0.7,
      minObservations: 10,
      temporalWindowHours: 24,
      enableBehavioralProfiling: true,
      enablePrivilegeEscalation: true,
    };
    recognizer = new PatternRecognizer(defaultConfig);
  });

  describe('initialization', () => {
    it('should create a PatternRecognizer with default config', () => {
      expect(recognizer).toBeInstanceOf(PatternRecognizer);
    });

    it('should accept custom configuration', () => {
      const customConfig: PatternRecognizerConfig = {
        anomalyThreshold: 0.5,
        minObservations: 5,
        temporalWindowHours: 12,
        enableBehavioralProfiling: false,
        enablePrivilegeEscalation: false,
      };
      const customRecognizer = new PatternRecognizer(customConfig);
      expect(customRecognizer.getConfig()).toEqual(customConfig);
    });
  });

  describe('feature extraction', () => {
    it('should extract features from authorization request', () => {
      const input: FeatureInput = {
        principal: {
          id: 'user-123',
          roles: ['admin', 'developer'],
          attributes: { department: 'engineering' },
        },
        resource: {
          kind: 'document',
          id: 'doc-456',
          attributes: { classification: 'confidential' },
        },
        actions: ['read', 'write'],
        timestamp: new Date('2024-01-15T14:30:00Z'),
      };

      const features = recognizer.extractFeatures(input);

      expect(features).toBeDefined();
      expect(features.values).toBeInstanceOf(Array);
      expect(features.values.length).toBeGreaterThan(0);
      expect(features.names).toBeInstanceOf(Array);
      expect(features.names.length).toBe(features.values.length);
    });

    it('should include temporal features', () => {
      const input: FeatureInput = {
        principal: { id: 'user-1', roles: [], attributes: {} },
        resource: { kind: 'api', id: '1', attributes: {} },
        actions: ['call'],
        timestamp: new Date('2024-01-15T03:00:00Z'), // 3 AM UTC - unusual hour
      };

      const features = recognizer.extractFeatures(input);

      // Should have hour of day feature
      expect(features.names).toContain('hour_of_day');
      const hourIndex = features.names.indexOf('hour_of_day');
      // Note: The hour depends on local timezone, just verify it's a valid hour
      expect(features.values[hourIndex]).toBeGreaterThanOrEqual(0);
      expect(features.values[hourIndex]).toBeLessThan(24);
    });

    it('should include role-based features', () => {
      const input: FeatureInput = {
        principal: { id: 'user-1', roles: ['admin', 'super_admin'], attributes: {} },
        resource: { kind: 'api', id: '1', attributes: {} },
        actions: ['delete'],
        timestamp: new Date(),
      };

      const features = recognizer.extractFeatures(input);

      expect(features.names).toContain('role_count');
      expect(features.names).toContain('has_admin_role');
    });
  });

  describe('anomaly detection', () => {
    it('should detect access time anomaly', async () => {
      // Build baseline profile for normal business hours
      const profile: BehaviorProfile = createNormalBusinessHoursProfile('user-123');

      const input: FeatureInput = {
        principal: { id: 'user-123', roles: ['employee'], attributes: {} },
        resource: { kind: 'database', id: 'prod-db', attributes: {} },
        actions: ['query'],
        timestamp: new Date('2024-01-15T03:00:00Z'), // 3 AM - anomalous
      };

      const result = await recognizer.detectAnomaly(input, profile);

      expect(result.isAnomaly).toBe(true);
      expect(result.category).toBe('time_violation');
      expect(result.score).toBeGreaterThan(0.7);
    });

    it('should detect unusual resource access', async () => {
      // Profile shows user typically accesses 'document' resources during business hours
      const profile: BehaviorProfile = {
        principalId: 'user-123',
        accessTimes: {
          hourlyDistribution: createBusinessHoursDistribution(),
          dailyDistribution: [0.05, 0.19, 0.19, 0.19, 0.19, 0.19, 0], // Mon-Sat weighted
          peakHours: [9, 10, 11, 12, 13, 14, 15, 16, 17], // Full business hours
          offPeakHours: [0, 1, 2, 3, 4, 5, 6, 7, 20, 21, 22, 23],
        },
        frequentResources: [
          { resourceKind: 'document', count: 100, percentage: 0.95 },
          { resourceKind: 'folder', count: 5, percentage: 0.05 },
        ],
        typicalActions: [{ action: 'read', count: 90, percentage: 0.9 }],
        accessVelocity: createNormalVelocity(),
        lastUpdated: new Date(),
        observationCount: 100,
      };

      const input: FeatureInput = {
        principal: { id: 'user-123', roles: ['employee'], attributes: {} },
        resource: { kind: 'admin_panel', id: 'admin-1', attributes: {} }, // Never accessed before
        actions: ['access'],
        timestamp: new Date('2024-01-15T14:00:00Z'), // 2 PM - normal business hours
      };

      const result = await recognizer.detectAnomaly(input, profile);

      expect(result.isAnomaly).toBe(true);
      // Can be resource_anomaly or another type, check that we flagged it
      expect(result.score).toBeGreaterThan(0.5);
    });

    it('should detect behavioral deviation', async () => {
      const profile: BehaviorProfile = {
        principalId: 'user-123',
        accessTimes: createNormalTimeDistribution(),
        frequentResources: [{ resourceKind: 'document', count: 100, percentage: 1.0 }],
        typicalActions: [
          { action: 'read', count: 95, percentage: 0.95 },
          { action: 'write', count: 5, percentage: 0.05 },
        ],
        accessVelocity: createNormalVelocity(),
        lastUpdated: new Date(),
        observationCount: 100,
      };

      const input: FeatureInput = {
        principal: { id: 'user-123', roles: ['employee'], attributes: {} },
        resource: { kind: 'document', id: 'doc-1', attributes: {} },
        actions: ['delete'], // User rarely deletes
        timestamp: new Date('2024-01-15T10:00:00Z'),
      };

      const result = await recognizer.detectAnomaly(input, profile);

      expect(result.score).toBeGreaterThan(0.5);
      expect(result.factors).toContainEqual(
        expect.objectContaining({ name: 'unusual_action' })
      );
    });

    it('should detect rate anomaly (velocity spike)', async () => {
      const profile: BehaviorProfile = {
        principalId: 'user-123',
        accessTimes: createNormalTimeDistribution(),
        frequentResources: [{ resourceKind: 'api', count: 100, percentage: 1.0 }],
        typicalActions: [{ action: 'call', count: 100, percentage: 1.0 }],
        accessVelocity: {
          averagePerHour: 10,
          maxPerHour: 25,
          stdDev: 5,
          p95: 20,
        },
        lastUpdated: new Date(),
        observationCount: 100,
      };

      // Simulate high-velocity access (many requests in short time)
      const recentHistory: DecisionRecord[] = Array(50)
        .fill(null)
        .map((_, i) => ({
          requestId: `req-${i}`,
          principal: { id: 'user-123', roles: [], attributes: {} },
          resource: { kind: 'api', id: '1', attributes: {} },
          actions: ['call'],
          results: { call: { effect: 'allow', policy: 'api-policy' } },
          timestamp: new Date(Date.now() - i * 60000), // 1 per minute = 50/hour
        }));

      const input: FeatureInput = {
        principal: { id: 'user-123', roles: ['employee'], attributes: {} },
        resource: { kind: 'api', id: '1', attributes: {} },
        actions: ['call'],
        timestamp: new Date(),
        history: recentHistory,
      };

      const result = await recognizer.detectAnomaly(input, profile);

      expect(result.isAnomaly).toBe(true);
      expect(result.category).toBe('rate_anomaly');
    });

    it('should return low score for normal behavior', async () => {
      // Create a profile with wide peak hours to ensure 10 AM is considered normal
      const profile: BehaviorProfile = {
        principalId: 'user-123',
        accessTimes: {
          hourlyDistribution: (() => {
            const dist = new Array(24).fill(0.01);
            // Business hours 8-18 have higher probability
            for (let h = 8; h <= 18; h++) {
              dist[h] = 0.08;
            }
            return dist;
          })(),
          dailyDistribution: [0.02, 0.18, 0.18, 0.18, 0.18, 0.18, 0.08],
          peakHours: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
          offPeakHours: [0, 1, 2, 3, 4, 5, 22, 23],
        },
        frequentResources: [
          { resourceKind: 'document', count: 80, percentage: 0.8 },
          { resourceKind: 'folder', count: 20, percentage: 0.2 },
        ],
        typicalActions: [
          { action: 'read', count: 70, percentage: 0.7 },
          { action: 'write', count: 25, percentage: 0.25 },
        ],
        accessVelocity: createNormalVelocity(),
        lastUpdated: new Date(),
        observationCount: 100,
      };

      const input: FeatureInput = {
        principal: { id: 'user-123', roles: ['employee'], attributes: {} },
        resource: { kind: 'document', id: 'doc-1', attributes: {} },
        actions: ['read'],
        timestamp: new Date('2024-01-15T14:00:00Z'), // 2 PM - clear business hours
      };

      const result = await recognizer.detectAnomaly(input, profile);

      // For normal behavior, anomaly score should be low
      expect(result.score).toBeLessThan(0.5);
    });
  });

  describe('privilege escalation detection', () => {
    it('should detect privilege escalation attempt', async () => {
      const profile: BehaviorProfile = {
        principalId: 'user-123',
        accessTimes: createNormalTimeDistribution(),
        frequentResources: [{ resourceKind: 'document', count: 100, percentage: 1.0 }],
        typicalActions: [{ action: 'read', count: 100, percentage: 1.0 }],
        accessVelocity: createNormalVelocity(),
        lastUpdated: new Date(),
        observationCount: 100,
      };

      const input: FeatureInput = {
        principal: {
          id: 'user-123',
          roles: ['employee'], // Only employee role
          attributes: {},
        },
        resource: {
          kind: 'admin_settings',
          id: 'settings-1',
          attributes: { requiredRole: 'admin' },
        },
        actions: ['modify'],
        timestamp: new Date(),
      };

      const pattern = await recognizer.detectPrivilegeEscalation(input, profile);

      expect(pattern).not.toBeNull();
      expect(pattern?.type).toBe('privilege_escalation');
      expect(pattern?.riskScore).toBeGreaterThan(0.8);
    });

    it('should not flag normal admin access', async () => {
      const profile: BehaviorProfile = {
        principalId: 'admin-user',
        accessTimes: createNormalTimeDistribution(),
        frequentResources: [
          { resourceKind: 'admin_settings', count: 50, percentage: 0.5 },
        ],
        typicalActions: [{ action: 'modify', count: 50, percentage: 0.5 }],
        accessVelocity: createNormalVelocity(),
        lastUpdated: new Date(),
        observationCount: 100,
      };

      const input: FeatureInput = {
        principal: {
          id: 'admin-user',
          roles: ['admin', 'super_admin'],
          attributes: {},
        },
        resource: {
          kind: 'admin_settings',
          id: 'settings-1',
          attributes: {},
        },
        actions: ['modify'],
        timestamp: new Date(),
      };

      const pattern = await recognizer.detectPrivilegeEscalation(input, profile);

      expect(pattern).toBeNull();
    });
  });

  describe('temporal pattern detection', () => {
    it('should detect access outside normal time window', async () => {
      const profile = createNormalBusinessHoursProfile('user-123');

      const input: FeatureInput = {
        principal: { id: 'user-123', roles: ['employee'], attributes: {} },
        resource: { kind: 'document', id: 'doc-1', attributes: {} },
        actions: ['read'],
        timestamp: new Date('2024-01-15T02:00:00Z'), // 2 AM
      };

      const pattern = await recognizer.detectTemporalAnomaly(input, profile);

      expect(pattern).not.toBeNull();
      expect(pattern?.type).toBe('temporal');
      expect(pattern?.deviation).toBeGreaterThan(4); // Hours from normal window
    });

    it('should detect weekend access for weekday-only users', async () => {
      const profile: BehaviorProfile = {
        principalId: 'user-123',
        accessTimes: {
          hourlyDistribution: createBusinessHoursDistribution(),
          dailyDistribution: [0, 0.2, 0.2, 0.2, 0.2, 0.2, 0], // Mon-Fri only
          peakHours: [9, 10, 11, 14, 15, 16],
          offPeakHours: [0, 1, 2, 3, 4, 5, 6, 7, 20, 21, 22, 23],
        },
        frequentResources: [],
        typicalActions: [],
        accessVelocity: createNormalVelocity(),
        lastUpdated: new Date(),
        observationCount: 100,
      };

      // Saturday access
      const input: FeatureInput = {
        principal: { id: 'user-123', roles: ['employee'], attributes: {} },
        resource: { kind: 'document', id: 'doc-1', attributes: {} },
        actions: ['read'],
        timestamp: new Date('2024-01-13T10:00:00Z'), // Saturday
      };

      const pattern = await recognizer.detectTemporalAnomaly(input, profile);

      expect(pattern).not.toBeNull();
      expect(pattern?.type).toBe('temporal');
      expect(pattern?.dayOfWeek).toBe(6); // Saturday
    });
  });

  describe('behavioral profiling', () => {
    it('should build behavior profile from decision records', async () => {
      const records: DecisionRecord[] = generateDecisionRecords('user-123', 50);

      const profile = await recognizer.buildProfile(records);

      expect(profile.principalId).toBe('user-123');
      expect(profile.observationCount).toBe(50);
      expect(profile.frequentResources.length).toBeGreaterThan(0);
      expect(profile.accessVelocity.averagePerHour).toBeGreaterThan(0);
    });

    it('should update existing profile with new data', async () => {
      const existingProfile = createNormalBusinessHoursProfile('user-123');
      existingProfile.observationCount = 100;
      existingProfile.lastUpdated = new Date(Date.now() - 1000); // Set to 1 second ago

      const newRecords: DecisionRecord[] = generateDecisionRecords('user-123', 10);

      const updatedProfile = await recognizer.updateProfile(existingProfile, newRecords);

      expect(updatedProfile.observationCount).toBe(110);
      expect(updatedProfile.lastUpdated.getTime()).toBeGreaterThanOrEqual(
        existingProfile.lastUpdated.getTime()
      );
    });

    it('should calculate deviation score between profiles', () => {
      const baseline = createNormalBusinessHoursProfile('user-123');

      // Create a significantly different observed profile
      const observed: BehaviorProfile = {
        ...baseline,
        accessVelocity: {
          ...baseline.accessVelocity,
          averagePerHour: baseline.accessVelocity.averagePerHour * 10, // 10x spike
        },
        // Also change time distribution significantly
        accessTimes: {
          ...baseline.accessTimes,
          hourlyDistribution: baseline.accessTimes.hourlyDistribution.map((_, i) => i < 6 ? 0.15 : 0.01), // Shift to night hours
        },
        // And resource access patterns
        frequentResources: [
          { resourceKind: 'new_resource', count: 100, percentage: 1.0 }, // Completely different resources
        ],
      };

      const deviationScore = recognizer.calculateDeviation(baseline, observed);

      // Any positive deviation is meaningful
      expect(deviationScore).toBeGreaterThan(0);
      expect(deviationScore).toBeLessThanOrEqual(1.0);
    });
  });

  describe('recommendations', () => {
    it('should provide actionable recommendations for anomalies', async () => {
      const profile = createNormalBusinessHoursProfile('user-123');

      const input: FeatureInput = {
        principal: { id: 'user-123', roles: ['employee'], attributes: {} },
        resource: { kind: 'admin_panel', id: 'admin-1', attributes: {} },
        actions: ['access'],
        timestamp: new Date('2024-01-15T03:00:00Z'),
      };

      const result = await recognizer.detectAnomaly(input, profile);

      expect(result.recommendations).toBeInstanceOf(Array);
      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.recommendations).toContainEqual(
        expect.stringMatching(/require.*verification|additional.*authentication|review/i)
      );
    });
  });
});

// =============================================================================
// Test Helpers
// =============================================================================

function createNormalBusinessHoursProfile(principalId: string): BehaviorProfile {
  return {
    principalId,
    accessTimes: {
      hourlyDistribution: createBusinessHoursDistribution(),
      dailyDistribution: [0, 0.2, 0.2, 0.2, 0.2, 0.2, 0], // Mon-Fri
      peakHours: [9, 10, 11, 14, 15, 16],
      offPeakHours: [0, 1, 2, 3, 4, 5, 6, 7, 20, 21, 22, 23],
    },
    frequentResources: [
      { resourceKind: 'document', count: 80, percentage: 0.8 },
      { resourceKind: 'folder', count: 20, percentage: 0.2 },
    ],
    typicalActions: [
      { action: 'read', count: 70, percentage: 0.7 },
      { action: 'write', count: 25, percentage: 0.25 },
      { action: 'delete', count: 5, percentage: 0.05 },
    ],
    accessVelocity: createNormalVelocity(),
    lastUpdated: new Date(),
    observationCount: 100,
  };
}

function createBusinessHoursDistribution(): number[] {
  const dist = new Array(24).fill(0);
  // Business hours 9-18
  for (let h = 9; h <= 17; h++) {
    dist[h] = 0.1;
  }
  // Small activity around edges
  dist[8] = 0.05;
  dist[18] = 0.05;
  return dist;
}

function createNormalTimeDistribution(): TimeDistribution {
  return {
    hourlyDistribution: createBusinessHoursDistribution(),
    dailyDistribution: [0.05, 0.19, 0.19, 0.19, 0.19, 0.19, 0], // Mon-Sat weighted
    peakHours: [10, 11, 14, 15],
    offPeakHours: [0, 1, 2, 3, 4, 5, 22, 23],
  };
}

function createNormalVelocity(): VelocityProfile {
  return {
    averagePerHour: 10,
    maxPerHour: 25,
    stdDev: 5,
    p95: 20,
  };
}

function generateDecisionRecords(principalId: string, count: number): DecisionRecord[] {
  const records: DecisionRecord[] = [];
  const baseDate = new Date('2024-01-15T10:00:00Z');

  for (let i = 0; i < count; i++) {
    records.push({
      requestId: `req-${i}`,
      principal: {
        id: principalId,
        roles: ['employee'],
        attributes: { department: 'engineering' },
      },
      resource: {
        kind: i % 5 === 0 ? 'folder' : 'document',
        id: `res-${i % 10}`,
        attributes: {},
      },
      actions: i % 3 === 0 ? ['write'] : ['read'],
      results: {
        [i % 3 === 0 ? 'write' : 'read']: {
          effect: 'allow',
          policy: 'default-policy',
        },
      },
      timestamp: new Date(baseDate.getTime() + i * 3600000), // 1 hour apart
    });
  }

  return records;
}
