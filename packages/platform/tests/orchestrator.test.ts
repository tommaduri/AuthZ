/**
 * Platform Orchestrator Tests
 *
 * TDD tests for the master platform orchestrator that coordinates
 * all subsystems: swarm, neural, consensus, memory, and agents.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PlatformOrchestrator } from '../src/orchestrator/PlatformOrchestrator.js';
import type {
  PlatformConfig,
  AuthorizationRequest,
  AuthorizationResult,
  PlatformHealth,
} from '../src/orchestrator/types.js';

// =============================================================================
// Test Fixtures
// =============================================================================

const createTestConfig = (): PlatformConfig => ({
  instanceId: 'test-platform-001',
  swarm: {
    topology: {
      type: 'mesh',
      maxConnections: 10,
      failoverEnabled: true,
    },
    loadBalancing: {
      strategy: 'round-robin',
      healthCheckIntervalMs: 5000,
      failoverThreshold: 3,
    },
    scaling: {
      minAgents: 2,
      maxAgents: 10,
      scaleUpThreshold: 0.8,
      scaleDownThreshold: 0.2,
      cooldownPeriodMs: 60000,
    },
  },
  neural: {
    patterns: [
      { type: 'anomaly', enabled: true, threshold: 0.7 },
      { type: 'behavioral', enabled: true, threshold: 0.6 },
      { type: 'temporal', enabled: false },
    ],
    training: {
      batchSize: 32,
      epochs: 10,
      learningRate: 0.001,
      validationSplit: 0.2,
      useWasmAcceleration: false,
    },
    inferenceCache: {
      enabled: true,
      maxSize: 1000,
      ttlMs: 60000,
    },
  },
  consensus: {
    default: 'pbft',
    thresholds: {
      quorum: 0.67,
      timeoutMs: 5000,
      maxRetries: 3,
    },
    enableForHighRisk: true,
    highRiskThreshold: 0.8,
  },
  memory: {
    vectorStore: {
      enabled: false,
      dimension: 384,
      indexType: 'ivfflat',
      distanceMetric: 'cosine',
    },
    cache: {
      enabled: true,
      maxSize: 10000,
      ttlMs: 300000,
      namespaces: ['decisions', 'patterns', 'context'],
    },
    eventStore: {
      enabled: true,
      retentionDays: 30,
      compactionIntervalMs: 86400000,
    },
  },
  logging: {
    level: 'info',
    format: 'json',
  },
  metrics: {
    enabled: true,
    collectIntervalMs: 10000,
    retentionDays: 7,
  },
});

const createTestRequest = (): AuthorizationRequest => ({
  requestId: 'req-test-001',
  correlationId: 'corr-test-001',
  principal: {
    id: 'user-123',
    roles: ['developer', 'team-lead'],
    attributes: {
      department: 'engineering',
      level: 'senior',
    },
  },
  resource: {
    kind: 'document',
    id: 'doc-456',
    attributes: {
      owner: 'user-123',
      classification: 'internal',
    },
  },
  actions: ['read', 'write'],
  priority: 'medium',
  includeExplanation: true,
  includeNeuralAnalysis: true,
});

// =============================================================================
// Test Suites
// =============================================================================

describe('PlatformOrchestrator', () => {
  let orchestrator: PlatformOrchestrator;
  let config: PlatformConfig;

  beforeEach(() => {
    config = createTestConfig();
    orchestrator = new PlatformOrchestrator();
  });

  afterEach(async () => {
    // Ensure cleanup
    try {
      await orchestrator.shutdown();
    } catch {
      // Ignore errors during cleanup
    }
  });

  // ===========================================================================
  // Initialization Tests
  // ===========================================================================

  describe('initialization', () => {
    it('should initialize with valid configuration', async () => {
      await expect(orchestrator.initialize(config)).resolves.not.toThrow();
    });

    it('should store configuration after initialization', async () => {
      await orchestrator.initialize(config);
      const storedConfig = orchestrator.getConfig();
      expect(storedConfig.instanceId).toBe(config.instanceId);
      expect(storedConfig.swarm.topology.type).toBe('mesh');
    });

    it('should generate instance ID if not provided', async () => {
      const configWithoutId = { ...config };
      delete configWithoutId.instanceId;
      await orchestrator.initialize(configWithoutId);
      const storedConfig = orchestrator.getConfig();
      expect(storedConfig.instanceId).toBeDefined();
      expect(typeof storedConfig.instanceId).toBe('string');
    });

    it('should reject double initialization', async () => {
      await orchestrator.initialize(config);
      await expect(orchestrator.initialize(config)).rejects.toThrow('already initialized');
    });

    it('should validate configuration on initialization', async () => {
      const invalidConfig = {
        ...config,
        swarm: {
          ...config.swarm,
          scaling: {
            ...config.swarm.scaling,
            minAgents: 10,
            maxAgents: 5, // Invalid: min > max
          },
        },
      };
      await expect(orchestrator.initialize(invalidConfig)).rejects.toThrow();
    });
  });

  // ===========================================================================
  // Request Processing Tests
  // ===========================================================================

  describe('processRequest', () => {
    beforeEach(async () => {
      await orchestrator.initialize(config);
    });

    it('should process a valid authorization request', async () => {
      const request = createTestRequest();
      const result = await orchestrator.processRequest(request);

      expect(result).toBeDefined();
      expect(result.requestId).toBe(request.requestId);
      expect(result.platform).toBeDefined();
      expect(result.platform.instanceId).toBe(config.instanceId);
    });

    it('should include processing time in result', async () => {
      const request = createTestRequest();
      const result = await orchestrator.processRequest(request);

      expect(result.platform.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should list agents involved in processing', async () => {
      const request = createTestRequest();
      const result = await orchestrator.processRequest(request);

      expect(result.platform.agentsInvolved).toBeDefined();
      expect(Array.isArray(result.platform.agentsInvolved)).toBe(true);
    });

    it('should include neural analysis when requested', async () => {
      const request = createTestRequest();
      request.includeNeuralAnalysis = true;
      const result = await orchestrator.processRequest(request);

      expect(result.neural).toBeDefined();
      expect(result.neural?.anomalyScore).toBeGreaterThanOrEqual(0);
      expect(result.neural?.anomalyScore).toBeLessThanOrEqual(1);
    });

    it('should include explanation when requested', async () => {
      const request = createTestRequest();
      request.includeExplanation = true;
      const result = await orchestrator.processRequest(request);

      expect(result.explanation).toBeDefined();
      expect(result.explanation?.summary).toBeDefined();
    });

    it('should trigger consensus for high-risk requests', async () => {
      // Configure to always trigger consensus
      const highRiskConfig = {
        ...config,
        consensus: {
          ...config.consensus,
          enableForHighRisk: true,
          highRiskThreshold: 0.0, // Always trigger
        },
      };

      const highRiskOrchestrator = new PlatformOrchestrator();
      await highRiskOrchestrator.initialize(highRiskConfig);

      const request = createTestRequest();
      request.requireConsensus = true;
      const result = await highRiskOrchestrator.processRequest(request);

      expect(result.consensus).toBeDefined();
      expect(result.consensus?.required).toBe(true);
      expect(result.platform.processingMode).toBe('consensus');

      await highRiskOrchestrator.shutdown();
    });

    it('should reject requests when not initialized', async () => {
      const uninitializedOrchestrator = new PlatformOrchestrator();
      const request = createTestRequest();

      await expect(uninitializedOrchestrator.processRequest(request)).rejects.toThrow(
        'not initialized'
      );
    });

    it('should handle missing optional fields gracefully', async () => {
      const minimalRequest: AuthorizationRequest = {
        principal: {
          id: 'user-1',
          roles: ['user'],
          attributes: {},
        },
        resource: {
          kind: 'document',
          id: 'doc-1',
          attributes: {},
        },
        actions: ['read'],
      };

      const result = await orchestrator.processRequest(minimalRequest);
      expect(result).toBeDefined();
      expect(result.results).toBeDefined();
    });

    it('should return results for all requested actions', async () => {
      const request = createTestRequest();
      const result = await orchestrator.processRequest(request);

      for (const action of request.actions) {
        expect(result.results[action]).toBeDefined();
        expect(['allow', 'deny']).toContain(result.results[action].effect);
      }
    });
  });

  // ===========================================================================
  // Health Monitoring Tests
  // ===========================================================================

  describe('getHealth', () => {
    beforeEach(async () => {
      await orchestrator.initialize(config);
    });

    it('should return health status', async () => {
      const health = await orchestrator.getHealth();

      expect(health).toBeDefined();
      expect(health.status).toBeDefined();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
    });

    it('should include subsystem health', async () => {
      const health = await orchestrator.getHealth();

      expect(health.subsystems).toBeDefined();
      expect(health.subsystems.swarm).toBeDefined();
      expect(health.subsystems.neural).toBeDefined();
      expect(health.subsystems.consensus).toBeDefined();
      expect(health.subsystems.memory).toBeDefined();
      expect(health.subsystems.agents).toBeDefined();
    });

    it('should include platform metrics', async () => {
      const health = await orchestrator.getHealth();

      expect(health.metrics).toBeDefined();
      expect(typeof health.metrics.requestsProcessed).toBe('number');
      expect(typeof health.metrics.avgLatencyMs).toBe('number');
    });

    it('should track uptime', async () => {
      const health = await orchestrator.getHealth();

      expect(health.uptime).toBeGreaterThanOrEqual(0);
      expect(health.timestamp).toBeInstanceOf(Date);
    });
  });

  // ===========================================================================
  // Configuration Management Tests
  // ===========================================================================

  describe('configuration management', () => {
    beforeEach(async () => {
      await orchestrator.initialize(config);
    });

    it('should return current configuration', () => {
      const currentConfig = orchestrator.getConfig();

      expect(currentConfig).toBeDefined();
      expect(currentConfig.swarm).toEqual(config.swarm);
    });

    it('should update configuration at runtime', async () => {
      await orchestrator.updateConfig({
        logging: {
          level: 'debug',
          format: 'pretty',
        },
      });

      const updatedConfig = orchestrator.getConfig();
      expect(updatedConfig.logging.level).toBe('debug');
    });

    it('should validate partial configuration updates', async () => {
      await expect(
        orchestrator.updateConfig({
          swarm: {
            ...config.swarm,
            scaling: {
              ...config.swarm.scaling,
              minAgents: 100,
              maxAgents: 5, // Invalid
            },
          },
        })
      ).rejects.toThrow();
    });
  });

  // ===========================================================================
  // Metrics Tests
  // ===========================================================================

  describe('metrics', () => {
    beforeEach(async () => {
      await orchestrator.initialize(config);
    });

    it('should return platform metrics', () => {
      const metrics = orchestrator.getMetrics();

      expect(metrics).toBeDefined();
      expect(typeof metrics.requestsProcessed).toBe('number');
      expect(typeof metrics.requestsPerSecond).toBe('number');
      expect(typeof metrics.avgLatencyMs).toBe('number');
      expect(typeof metrics.errorRate).toBe('number');
    });

    it('should update metrics after processing requests', async () => {
      const initialMetrics = orchestrator.getMetrics();
      const initialCount = initialMetrics.requestsProcessed;

      await orchestrator.processRequest(createTestRequest());

      const updatedMetrics = orchestrator.getMetrics();
      expect(updatedMetrics.requestsProcessed).toBe(initialCount + 1);
    });
  });

  // ===========================================================================
  // Shutdown Tests
  // ===========================================================================

  describe('shutdown', () => {
    it('should shutdown gracefully', async () => {
      await orchestrator.initialize(config);
      await expect(orchestrator.shutdown()).resolves.not.toThrow();
    });

    it('should reject requests after shutdown', async () => {
      await orchestrator.initialize(config);
      await orchestrator.shutdown();

      await expect(orchestrator.processRequest(createTestRequest())).rejects.toThrow();
    });

    it('should allow re-initialization after shutdown', async () => {
      await orchestrator.initialize(config);
      await orchestrator.shutdown();
      await expect(orchestrator.initialize(config)).resolves.not.toThrow();
    });
  });
});
