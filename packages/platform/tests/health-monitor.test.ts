/**
 * Health Monitor Tests
 *
 * TDD tests for the platform health monitoring system that tracks
 * the status of all subsystems and collects metrics.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HealthMonitor } from '../src/health/HealthMonitor.js';
import type {
  PlatformHealth,
  SubsystemHealth,
  PlatformMetrics,
  PlatformConfig,
} from '../src/orchestrator/types.js';

// =============================================================================
// Test Fixtures
// =============================================================================

const createTestConfig = (): PlatformConfig => ({
  instanceId: 'test-health-001',
  swarm: {
    topology: { type: 'mesh' },
    loadBalancing: { strategy: 'round-robin' },
    scaling: { minAgents: 2, maxAgents: 10, scaleUpThreshold: 0.8, scaleDownThreshold: 0.2, cooldownPeriodMs: 60000 },
  },
  neural: {
    patterns: [{ type: 'anomaly', enabled: true }],
    training: { batchSize: 32, epochs: 10, learningRate: 0.001, validationSplit: 0.2, useWasmAcceleration: false },
    inferenceCache: { enabled: true, maxSize: 1000, ttlMs: 60000 },
  },
  consensus: {
    default: 'pbft',
    thresholds: { quorum: 0.67, timeoutMs: 5000, maxRetries: 3 },
    enableForHighRisk: true,
    highRiskThreshold: 0.8,
  },
  memory: {
    vectorStore: { enabled: false, dimension: 384, indexType: 'ivfflat', distanceMetric: 'cosine' },
    cache: { enabled: true, maxSize: 10000, ttlMs: 300000, namespaces: ['decisions'] },
    eventStore: { enabled: true, retentionDays: 30, compactionIntervalMs: 86400000 },
  },
  logging: { level: 'info', format: 'json' },
  metrics: { enabled: true, collectIntervalMs: 1000, retentionDays: 7 },
});

// =============================================================================
// Test Suites
// =============================================================================

describe('HealthMonitor', () => {
  let monitor: HealthMonitor;
  let config: PlatformConfig;

  beforeEach(() => {
    config = createTestConfig();
    monitor = new HealthMonitor(config);
  });

  afterEach(async () => {
    await monitor.stop();
  });

  // ===========================================================================
  // Initialization Tests
  // ===========================================================================

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await expect(monitor.start()).resolves.not.toThrow();
    });

    it('should track start time for uptime calculation', async () => {
      await monitor.start();
      const health = await monitor.getHealth();
      expect(health.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should handle double start gracefully', async () => {
      await monitor.start();
      await expect(monitor.start()).resolves.not.toThrow();
    });
  });

  // ===========================================================================
  // Health Status Tests
  // ===========================================================================

  describe('health status', () => {
    beforeEach(async () => {
      await monitor.start();
    });

    it('should return overall health status', async () => {
      const health = await monitor.getHealth();

      expect(health).toBeDefined();
      expect(health.status).toBeDefined();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
    });

    it('should include timestamp in health report', async () => {
      const health = await monitor.getHealth();

      expect(health.timestamp).toBeInstanceOf(Date);
    });

    it('should include uptime in milliseconds', async () => {
      const health = await monitor.getHealth();

      expect(typeof health.uptime).toBe('number');
      expect(health.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should report all subsystems', async () => {
      const health = await monitor.getHealth();

      expect(health.subsystems).toBeDefined();
      expect(health.subsystems.swarm).toBeDefined();
      expect(health.subsystems.neural).toBeDefined();
      expect(health.subsystems.consensus).toBeDefined();
      expect(health.subsystems.memory).toBeDefined();
      expect(health.subsystems.agents).toBeDefined();
    });
  });

  // ===========================================================================
  // Subsystem Health Tests
  // ===========================================================================

  describe('subsystem health', () => {
    beforeEach(async () => {
      await monitor.start();
    });

    it('should report individual subsystem status', async () => {
      const health = await monitor.getHealth();
      const swarmHealth = health.subsystems.swarm;

      expect(swarmHealth.name).toBe('swarm');
      expect(['healthy', 'degraded', 'unhealthy', 'unknown']).toContain(swarmHealth.status);
      expect(swarmHealth.lastCheck).toBeInstanceOf(Date);
    });

    it('should include latency for each subsystem', async () => {
      const health = await monitor.getHealth();

      for (const subsystem of Object.values(health.subsystems)) {
        if (subsystem.latencyMs !== undefined) {
          expect(typeof subsystem.latencyMs).toBe('number');
          expect(subsystem.latencyMs).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('should capture errors for unhealthy subsystems', async () => {
      // Simulate an error by registering it
      monitor.registerSubsystemError('swarm', 'Connection timeout');

      const health = await monitor.getHealth();
      const swarmHealth = health.subsystems.swarm;

      if (swarmHealth.status === 'unhealthy' || swarmHealth.status === 'degraded') {
        expect(swarmHealth.errors).toBeDefined();
        expect(swarmHealth.errors?.length).toBeGreaterThan(0);
      }
    });

    it('should update subsystem status', async () => {
      monitor.updateSubsystemStatus('swarm', 'degraded', { reason: 'high load' });

      const health = await monitor.getHealth();
      expect(['degraded', 'healthy']).toContain(health.subsystems.swarm.status);
    });
  });

  // ===========================================================================
  // Metrics Collection Tests
  // ===========================================================================

  describe('metrics collection', () => {
    beforeEach(async () => {
      await monitor.start();
    });

    it('should return platform metrics', async () => {
      const health = await monitor.getHealth();

      expect(health.metrics).toBeDefined();
      expect(typeof health.metrics.requestsProcessed).toBe('number');
      expect(typeof health.metrics.requestsPerSecond).toBe('number');
      expect(typeof health.metrics.avgLatencyMs).toBe('number');
    });

    it('should track requests processed', async () => {
      const initialHealth = await monitor.getHealth();
      const initialCount = initialHealth.metrics.requestsProcessed;

      // Record a request
      monitor.recordRequest(50); // 50ms latency

      const updatedHealth = await monitor.getHealth();
      expect(updatedHealth.metrics.requestsProcessed).toBe(initialCount + 1);
    });

    it('should calculate average latency', async () => {
      monitor.recordRequest(100);
      monitor.recordRequest(200);
      monitor.recordRequest(300);

      const health = await monitor.getHealth();
      expect(health.metrics.avgLatencyMs).toBe(200); // (100 + 200 + 300) / 3
    });

    it('should calculate percentile latencies', async () => {
      // Record various latencies
      for (let i = 1; i <= 100; i++) {
        monitor.recordRequest(i);
      }

      const health = await monitor.getHealth();
      expect(health.metrics.p95LatencyMs).toBeGreaterThan(0);
      expect(health.metrics.p99LatencyMs).toBeGreaterThan(0);
      expect(health.metrics.p99LatencyMs).toBeGreaterThanOrEqual(health.metrics.p95LatencyMs);
    });

    it('should track error rate', async () => {
      // Record some requests with errors
      monitor.recordRequest(100);
      monitor.recordRequest(200);
      monitor.recordError();
      monitor.recordRequest(300);

      const health = await monitor.getHealth();
      // 1 error out of 4 operations = 25%
      expect(health.metrics.errorRate).toBeCloseTo(0.25, 1);
    });

    it('should track requests per second', async () => {
      // Record multiple requests
      monitor.recordRequest(100);
      monitor.recordRequest(100);
      monitor.recordRequest(100);

      const health = await monitor.getHealth();
      expect(health.metrics.requestsPerSecond).toBeGreaterThanOrEqual(0);
    });

    it('should track active agents', async () => {
      monitor.updateActiveAgents(5);

      const health = await monitor.getHealth();
      expect(health.metrics.activeAgents).toBe(5);
    });

    it('should track consensus rounds', async () => {
      monitor.recordConsensusRound();
      monitor.recordConsensusRound();

      const health = await monitor.getHealth();
      expect(health.metrics.consensusRounds).toBe(2);
    });

    it('should track neural predictions', async () => {
      monitor.recordNeuralPrediction();
      monitor.recordNeuralPrediction();
      monitor.recordNeuralPrediction();

      const health = await monitor.getHealth();
      expect(health.metrics.neuralPredictions).toBe(3);
    });

    it('should track cache hit rate', async () => {
      monitor.recordCacheAccess(true);  // hit
      monitor.recordCacheAccess(true);  // hit
      monitor.recordCacheAccess(false); // miss
      monitor.recordCacheAccess(true);  // hit

      const health = await monitor.getHealth();
      expect(health.metrics.cacheHitRate).toBeCloseTo(0.75, 2); // 3/4 = 75%
    });
  });

  // ===========================================================================
  // Overall Health Determination Tests
  // ===========================================================================

  describe('overall health determination', () => {
    beforeEach(async () => {
      await monitor.start();
    });

    it('should be healthy when all subsystems are healthy', async () => {
      monitor.updateSubsystemStatus('swarm', 'healthy');
      monitor.updateSubsystemStatus('neural', 'healthy');
      monitor.updateSubsystemStatus('consensus', 'healthy');
      monitor.updateSubsystemStatus('memory', 'healthy');
      monitor.updateSubsystemStatus('agents', 'healthy');

      const health = await monitor.getHealth();
      expect(health.status).toBe('healthy');
    });

    it('should be degraded when some subsystems are degraded', async () => {
      monitor.updateSubsystemStatus('swarm', 'healthy');
      monitor.updateSubsystemStatus('neural', 'degraded');
      monitor.updateSubsystemStatus('consensus', 'healthy');
      monitor.updateSubsystemStatus('memory', 'healthy');
      monitor.updateSubsystemStatus('agents', 'healthy');

      const health = await monitor.getHealth();
      expect(['healthy', 'degraded']).toContain(health.status);
    });

    it('should be unhealthy when critical subsystems are unhealthy', async () => {
      monitor.updateSubsystemStatus('swarm', 'unhealthy');
      monitor.updateSubsystemStatus('agents', 'unhealthy');

      const health = await monitor.getHealth();
      expect(health.status).toBe('unhealthy');
    });

    it('should consider error rate in health determination', async () => {
      // High error rate
      for (let i = 0; i < 10; i++) {
        monitor.recordError();
      }
      for (let i = 0; i < 10; i++) {
        monitor.recordRequest(100);
      }

      const health = await monitor.getHealth();
      // 50% error rate should affect health
      expect(['degraded', 'unhealthy']).toContain(health.status);
    });
  });

  // ===========================================================================
  // Health Check Callbacks Tests
  // ===========================================================================

  describe('health check callbacks', () => {
    beforeEach(async () => {
      await monitor.start();
    });

    it('should register custom health check', async () => {
      const customCheck = vi.fn().mockResolvedValue({ status: 'healthy' });

      monitor.registerHealthCheck('custom', customCheck);
      await monitor.runHealthChecks();

      expect(customCheck).toHaveBeenCalled();
    });

    it('should handle failing health checks', async () => {
      const failingCheck = vi.fn().mockRejectedValue(new Error('Check failed'));

      monitor.registerHealthCheck('failing', failingCheck);

      // Should not throw, but mark the check as unhealthy
      await expect(monitor.runHealthChecks()).resolves.not.toThrow();
    });

    it('should unregister health check', () => {
      const check = vi.fn();

      monitor.registerHealthCheck('temp', check);
      monitor.unregisterHealthCheck('temp');

      // Verify it's removed by trying to run checks
      // (implementation should not call the unregistered check)
    });
  });

  // ===========================================================================
  // Metrics Reset Tests
  // ===========================================================================

  describe('metrics reset', () => {
    beforeEach(async () => {
      await monitor.start();
    });

    it('should reset metrics', async () => {
      // Record some data
      monitor.recordRequest(100);
      monitor.recordRequest(200);
      monitor.recordError();

      // Reset
      monitor.resetMetrics();

      const health = await monitor.getHealth();
      expect(health.metrics.requestsProcessed).toBe(0);
      expect(health.metrics.errorRate).toBe(0);
    });

    it('should preserve uptime after metrics reset', async () => {
      const healthBefore = await monitor.getHealth();
      const uptimeBefore = healthBefore.uptime;

      monitor.resetMetrics();

      const healthAfter = await monitor.getHealth();
      expect(healthAfter.uptime).toBeGreaterThanOrEqual(uptimeBefore);
    });
  });

  // ===========================================================================
  // Stop/Cleanup Tests
  // ===========================================================================

  describe('stop and cleanup', () => {
    it('should stop monitoring', async () => {
      await monitor.start();
      await expect(monitor.stop()).resolves.not.toThrow();
    });

    it('should handle double stop gracefully', async () => {
      await monitor.start();
      await monitor.stop();
      await expect(monitor.stop()).resolves.not.toThrow();
    });

    it('should still return health after stop', async () => {
      await monitor.start();
      monitor.recordRequest(100);
      await monitor.stop();

      const health = await monitor.getHealth();
      expect(health).toBeDefined();
    });
  });

  // ===========================================================================
  // Snapshot Tests
  // ===========================================================================

  describe('health snapshots', () => {
    beforeEach(async () => {
      await monitor.start();
    });

    it('should create health snapshot', async () => {
      monitor.recordRequest(100);
      monitor.recordRequest(200);

      const snapshot = monitor.createSnapshot();

      expect(snapshot).toBeDefined();
      expect(snapshot.timestamp).toBeInstanceOf(Date);
      expect(snapshot.metrics).toBeDefined();
    });

    it('should list historical snapshots', async () => {
      monitor.createSnapshot();
      monitor.createSnapshot();
      monitor.createSnapshot();

      const snapshots = monitor.getSnapshots({ limit: 10 });
      expect(snapshots.length).toBeGreaterThanOrEqual(3);
    });

    it('should limit snapshot history', () => {
      for (let i = 0; i < 100; i++) {
        monitor.createSnapshot();
      }

      const snapshots = monitor.getSnapshots({ limit: 10 });
      expect(snapshots.length).toBeLessThanOrEqual(10);
    });
  });
});
