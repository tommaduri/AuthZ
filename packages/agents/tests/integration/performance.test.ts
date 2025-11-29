/**
 * Performance Integration Tests
 *
 * Tests for:
 * - Performance under load
 * - Concurrent request handling
 * - Throughput benchmarks
 * - Memory efficiency
 * - Latency percentiles
 * - Cache effectiveness
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';
import { AgentOrchestrator } from '../../src/orchestrator/agent-orchestrator.js';
import type { OrchestratorConfig, ProcessingResult } from '../../src/orchestrator/agent-orchestrator.js';
import type { CheckRequest } from '@authz-engine/core';
import {
  createTestOrchestratorConfig,
} from '../mocks/index.js';
import {
  principals,
  resources,
  createCheckRequest,
  createAllowedResponse,
  createDeniedResponse,
} from '../fixtures/test-requests.js';

// =============================================================================
// Mock External Dependencies
// =============================================================================

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn(),
  })),
}));

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    psubscribe: vi.fn(),
    publish: vi.fn(),
    quit: vi.fn(),
  })),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{
            message: {
              content: 'Mock LLM response for performance tests.',
            },
          }],
        }),
      },
    },
  })),
}));

// =============================================================================
// Performance Test Utilities
// =============================================================================

interface PerformanceMetrics {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  totalDurationMs: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  throughputRps: number;
}

function calculateMetrics(latencies: number[], durationMs: number): PerformanceMetrics {
  const sorted = [...latencies].sort((a, b) => a - b);
  const total = latencies.length;

  return {
    totalRequests: total,
    successCount: total,
    failureCount: 0,
    totalDurationMs: durationMs,
    avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / total,
    minLatencyMs: sorted[0] || 0,
    maxLatencyMs: sorted[total - 1] || 0,
    p50LatencyMs: sorted[Math.floor(total * 0.5)] || 0,
    p95LatencyMs: sorted[Math.floor(total * 0.95)] || 0,
    p99LatencyMs: sorted[Math.floor(total * 0.99)] || 0,
    throughputRps: (total / durationMs) * 1000,
  };
}

function generateRequests(count: number, baseUserId = 'perf-user'): CheckRequest[] {
  return Array.from({ length: count }, (_, i) =>
    createCheckRequest(
      { id: `${baseUserId}-${i % 100}`, roles: ['user'], attributes: {} },
      { kind: 'document', id: `doc-${i}`, attributes: {} },
      ['view'],
    ),
  );
}

// =============================================================================
// Test Suite: Performance Tests
// =============================================================================

describe('Performance Integration Tests', () => {
  let orchestrator: AgentOrchestrator;
  let config: OrchestratorConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    config = createTestOrchestratorConfig({
      agents: {
        enabled: true,
        logLevel: 'error',
        guardian: {
          anomalyThreshold: 0.7,
          baselinePeriodDays: 30,
          velocityWindowMinutes: 5,
          enableRealTimeDetection: true,
        },
        analyst: {
          minSampleSize: 10,
          confidenceThreshold: 0.5,
          learningEnabled: false,
        },
        advisor: {
          llmProvider: 'openai',
          llmModel: 'gpt-4',
          enableNaturalLanguage: false,
          maxExplanationLength: 500,
        },
        enforcer: {
          autoEnforceEnabled: false,
          requireApprovalForSeverity: 'high',
          maxActionsPerHour: 1000, // Higher limit for perf tests
          rollbackWindowMinutes: 60,
        },
      },
    });
    orchestrator = new AgentOrchestrator(config);
  });

  afterEach(async () => {
    try {
      await orchestrator.shutdown();
    } catch {
      // Ignore shutdown errors
    }
  });

  // ===========================================================================
  // Section 1: Throughput Tests
  // ===========================================================================

  describe('Throughput Tests', () => {
    it('should process 100 requests under 2 seconds', async () => {
      await orchestrator.initialize();

      const requests = generateRequests(100);
      const latencies: number[] = [];

      const startTime = Date.now();

      for (const request of requests) {
        const requestStart = Date.now();
        const response = createAllowedResponse(request.requestId!, 'view');
        await orchestrator.processRequest(request, response);
        latencies.push(Date.now() - requestStart);
      }

      const totalDuration = Date.now() - startTime;
      const metrics = calculateMetrics(latencies, totalDuration);

      expect(totalDuration).toBeLessThan(2000);
      expect(metrics.avgLatencyMs).toBeLessThan(20);
      expect(metrics.throughputRps).toBeGreaterThan(50);
    });

    it('should maintain throughput with explanations disabled', async () => {
      await orchestrator.initialize();

      const requests = generateRequests(50);
      const latencies: number[] = [];

      const startTime = Date.now();

      for (const request of requests) {
        const requestStart = Date.now();
        const response = createAllowedResponse(request.requestId!, 'view');
        await orchestrator.processRequest(request, response);
        latencies.push(Date.now() - requestStart);
      }

      const totalDuration = Date.now() - startTime;
      const metrics = calculateMetrics(latencies, totalDuration);

      // Without explanations, should be fast
      expect(metrics.avgLatencyMs).toBeLessThan(15);
      expect(metrics.p95LatencyMs).toBeLessThan(30);
    });

    it('should measure throughput with explanations enabled', async () => {
      await orchestrator.initialize();

      const requests = generateRequests(20);
      const latencies: number[] = [];

      const startTime = Date.now();

      for (const request of requests) {
        const requestStart = Date.now();
        const response = createAllowedResponse(request.requestId!, 'view');
        await orchestrator.processRequest(request, response, {
          includeExplanation: true,
        });
        latencies.push(Date.now() - requestStart);
      }

      const totalDuration = Date.now() - startTime;
      const metrics = calculateMetrics(latencies, totalDuration);

      // With explanations, still reasonable
      expect(metrics.avgLatencyMs).toBeLessThan(50);
      expect(metrics.p95LatencyMs).toBeLessThan(100);
    });
  });

  // ===========================================================================
  // Section 2: Concurrent Request Handling
  // ===========================================================================

  describe('Concurrent Request Handling', () => {
    it('should handle 50 concurrent requests without errors', async () => {
      await orchestrator.initialize();

      const requests = generateRequests(50);

      const promises = requests.map(async (request) => {
        const response = createAllowedResponse(request.requestId!, 'view');
        return orchestrator.processRequest(request, response);
      });

      const results = await Promise.all(promises);

      expect(results).toHaveLength(50);
      results.forEach((result) => {
        expect(result.enforcement?.allowed).toBe(true);
        expect(result.anomalyScore).toBeDefined();
      });
    });

    it('should handle concurrent requests from different principals', async () => {
      await orchestrator.initialize();

      const principalTypes = [
        principals.regularUser,
        principals.subscriber,
        principals.admin,
        principals.influencer,
        principals.financeUser,
      ];

      const promises = principalTypes.flatMap((principal, idx) =>
        Array.from({ length: 10 }, (_, i) => {
          const request = createCheckRequest(
            { ...principal, id: `${principal.id}-${i}` },
            resources.publicDocument,
            ['view'],
          );
          const response = createAllowedResponse(request.requestId!, 'view');
          return orchestrator.processRequest(request, response);
        }),
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(50);
      results.forEach((result) => {
        expect(result.enforcement?.allowed).toBe(true);
      });
    });

    it('should handle concurrent requests with mixed actions', async () => {
      await orchestrator.initialize();

      const actions = ['view', 'edit', 'delete', 'list', 'search'];

      const promises = actions.flatMap((action) =>
        Array.from({ length: 10 }, (_, i) => {
          const request = createCheckRequest(
            { id: `mixed-user-${i}`, roles: ['admin'], attributes: {} },
            resources.publicDocument,
            [action],
          );
          const response = createAllowedResponse(request.requestId!, action);
          return orchestrator.processRequest(request, response);
        }),
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(50);
    });

    it('should handle concurrent enforcement checks correctly', async () => {
      await orchestrator.initialize();

      // Block one user
      await orchestrator.triggerEnforcement(
        'temporary_block',
        'concurrent-blocked-user',
        'Testing concurrent block',
      );

      // Mix of blocked and allowed users
      const promises = Array.from({ length: 20 }, (_, i) => {
        const isBlocked = i % 2 === 0;
        const userId = isBlocked ? 'concurrent-blocked-user' : `allowed-user-${i}`;
        const request = createCheckRequest(
          { id: userId, roles: ['user'], attributes: {} },
          resources.publicDocument,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');
        return orchestrator.processRequest(request, response);
      });

      const results = await Promise.all(promises);

      const blockedResults = results.filter((_, i) => i % 2 === 0);
      const allowedResults = results.filter((_, i) => i % 2 !== 0);

      blockedResults.forEach((result) => {
        expect(result.enforcement?.allowed).toBe(false);
      });
      allowedResults.forEach((result) => {
        expect(result.enforcement?.allowed).toBe(true);
      });
    });

    it('should maintain data integrity under concurrent load', async () => {
      await orchestrator.initialize();

      const principalId = 'integrity-test-user';
      const requests = Array.from({ length: 30 }, (_, i) =>
        createCheckRequest(
          { id: principalId, roles: ['user'], attributes: {} },
          { kind: 'document', id: `doc-${i}`, attributes: {} },
          ['view'],
        ),
      );

      const promises = requests.map(async (request) => {
        const response = createAllowedResponse(request.requestId!, 'view');
        return orchestrator.processRequest(request, response);
      });

      const results = await Promise.all(promises);

      // All results should be consistent
      results.forEach((result) => {
        expect(result.enforcement?.allowed).toBe(true);
        expect(typeof result.anomalyScore).toBe('number');
      });
    });
  });

  // ===========================================================================
  // Section 3: Latency Tests
  // ===========================================================================

  describe('Latency Tests', () => {
    it('should maintain sub-20ms average latency for simple requests', async () => {
      await orchestrator.initialize();

      const requests = generateRequests(100);
      const latencies: number[] = [];

      for (const request of requests) {
        const start = Date.now();
        const response = createAllowedResponse(request.requestId!, 'view');
        await orchestrator.processRequest(request, response);
        latencies.push(Date.now() - start);
      }

      const metrics = calculateMetrics(latencies, latencies.reduce((a, b) => a + b, 0));

      expect(metrics.avgLatencyMs).toBeLessThan(20);
    });

    it('should have acceptable p95 latency', async () => {
      await orchestrator.initialize();

      const requests = generateRequests(100);
      const latencies: number[] = [];

      for (const request of requests) {
        const start = Date.now();
        const response = createAllowedResponse(request.requestId!, 'view');
        await orchestrator.processRequest(request, response);
        latencies.push(Date.now() - start);
      }

      const metrics = calculateMetrics(latencies, latencies.reduce((a, b) => a + b, 0));

      // p95 should be under 50ms
      expect(metrics.p95LatencyMs).toBeLessThan(50);
    });

    it('should have acceptable p99 latency', async () => {
      await orchestrator.initialize();

      const requests = generateRequests(100);
      const latencies: number[] = [];

      for (const request of requests) {
        const start = Date.now();
        const response = createAllowedResponse(request.requestId!, 'view');
        await orchestrator.processRequest(request, response);
        latencies.push(Date.now() - start);
      }

      const metrics = calculateMetrics(latencies, latencies.reduce((a, b) => a + b, 0));

      // p99 should be under 100ms
      expect(metrics.p99LatencyMs).toBeLessThan(100);
    });

    it('should maintain consistent latency over time', async () => {
      await orchestrator.initialize();

      const batchSize = 50;
      const batches = 3;
      const batchLatencies: number[][] = [];

      for (let batch = 0; batch < batches; batch++) {
        const requests = generateRequests(batchSize, `batch-${batch}-user`);
        const latencies: number[] = [];

        for (const request of requests) {
          const start = Date.now();
          const response = createAllowedResponse(request.requestId!, 'view');
          await orchestrator.processRequest(request, response);
          latencies.push(Date.now() - start);
        }

        batchLatencies.push(latencies);
      }

      // Calculate average latency for each batch
      const avgLatencies = batchLatencies.map(
        (batch) => batch.reduce((a, b) => a + b, 0) / batch.length,
      );

      // Latency should not increase significantly over batches
      const firstBatchAvg = avgLatencies[0];
      const lastBatchAvg = avgLatencies[batches - 1];

      // Allow for 50% variance
      expect(lastBatchAvg).toBeLessThan(firstBatchAvg * 1.5 + 10);
    });
  });

  // ===========================================================================
  // Section 4: Memory Efficiency Tests
  // ===========================================================================

  describe('Memory Efficiency Tests', () => {
    it('should handle large request batches without memory issues', async () => {
      await orchestrator.initialize();

      // Process a large batch
      const requests = generateRequests(200);

      for (const request of requests) {
        const response = createAllowedResponse(request.requestId!, 'view');
        await orchestrator.processRequest(request, response);
      }

      // If we get here without OOM, test passes
      const health = await orchestrator.getHealth();
      expect(health.status).toBe('healthy');
    });

    it('should clean up after processing', async () => {
      await orchestrator.initialize();

      // Process requests
      for (let i = 0; i < 50; i++) {
        const request = createCheckRequest(
          { id: `cleanup-user-${i}`, roles: ['user'], attributes: {} },
          resources.publicDocument,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');
        await orchestrator.processRequest(request, response);
      }

      // Shutdown and reinitialize
      await orchestrator.shutdown();

      const newOrchestrator = new AgentOrchestrator(config);
      await newOrchestrator.initialize();

      // Should be able to process more requests
      const request = createCheckRequest(
        principals.regularUser,
        resources.publicDocument,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');
      const result = await newOrchestrator.processRequest(request, response);

      expect(result.enforcement?.allowed).toBe(true);

      await newOrchestrator.shutdown();
    });

    it('should handle repeated initialization cycles', async () => {
      for (let cycle = 0; cycle < 5; cycle++) {
        const cycleOrchestrator = new AgentOrchestrator(config);
        await cycleOrchestrator.initialize();

        // Process some requests
        for (let i = 0; i < 10; i++) {
          const request = createCheckRequest(
            { id: `cycle-${cycle}-user-${i}`, roles: ['user'], attributes: {} },
            resources.publicDocument,
            ['view'],
          );
          const response = createAllowedResponse(request.requestId!, 'view');
          await cycleOrchestrator.processRequest(request, response);
        }

        await cycleOrchestrator.shutdown();
      }

      // Final check - create fresh orchestrator
      const finalOrchestrator = new AgentOrchestrator(config);
      await finalOrchestrator.initialize();

      const health = await finalOrchestrator.getHealth();
      expect(health.status).toBe('healthy');

      await finalOrchestrator.shutdown();
    });
  });

  // ===========================================================================
  // Section 5: Cache Performance Tests
  // ===========================================================================

  describe('Cache Performance Tests', () => {
    it('should benefit from explanation caching', async () => {
      await orchestrator.initialize();

      const request = createCheckRequest(
        principals.regularUser,
        resources.publicDocument,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');

      // First request - cold cache
      const startCold = Date.now();
      await orchestrator.processRequest(request, response, {
        includeExplanation: true,
      });
      const coldLatency = Date.now() - startCold;

      // Second request - warm cache (same request)
      const startWarm = Date.now();
      await orchestrator.processRequest(request, response, {
        includeExplanation: true,
      });
      const warmLatency = Date.now() - startWarm;

      // Warm cache should be equal or faster
      expect(warmLatency).toBeLessThanOrEqual(coldLatency + 5);
    });

    it('should maintain cache effectiveness over time', async () => {
      await orchestrator.initialize();

      const request = createCheckRequest(
        principals.regularUser,
        resources.publicDocument,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');

      // Multiple requests with explanations
      const latencies: number[] = [];

      for (let i = 0; i < 10; i++) {
        const start = Date.now();
        await orchestrator.processRequest(request, response, {
          includeExplanation: true,
        });
        latencies.push(Date.now() - start);
      }

      // Later requests should not be slower than earlier ones
      const firstHalfAvg = latencies.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
      const secondHalfAvg = latencies.slice(5).reduce((a, b) => a + b, 0) / 5;

      expect(secondHalfAvg).toBeLessThanOrEqual(firstHalfAvg + 5);
    });

    it('should handle cache for different request types', async () => {
      await orchestrator.initialize();

      const requestTypes = [
        { principal: principals.regularUser, resource: resources.publicDocument },
        { principal: principals.subscriber, resource: resources.premiumContent },
        { principal: principals.admin, resource: resources.adminSettings },
      ];

      for (const { principal, resource } of requestTypes) {
        const request = createCheckRequest(principal, resource, ['view']);
        const response = createAllowedResponse(request.requestId!, 'view');

        // Process same request twice
        for (let i = 0; i < 2; i++) {
          const result = await orchestrator.processRequest(request, response, {
            includeExplanation: true,
          });
          expect(result.explanation).toBeDefined();
        }
      }
    });
  });

  // ===========================================================================
  // Section 6: Load Testing
  // ===========================================================================

  describe('Load Testing', () => {
    it('should sustain load over extended period', async () => {
      await orchestrator.initialize();

      const duration = 2000; // 2 seconds
      const startTime = Date.now();
      let requestCount = 0;
      const errors: Error[] = [];

      while (Date.now() - startTime < duration) {
        try {
          const request = createCheckRequest(
            { id: `load-user-${requestCount % 50}`, roles: ['user'], attributes: {} },
            resources.publicDocument,
            ['view'],
          );
          const response = createAllowedResponse(request.requestId!, 'view');
          await orchestrator.processRequest(request, response);
          requestCount++;
        } catch (error) {
          errors.push(error as Error);
        }
      }

      // Should process significant number of requests
      expect(requestCount).toBeGreaterThan(50);
      // Error rate should be low
      expect(errors.length / requestCount).toBeLessThan(0.05);
    });

    it('should handle burst traffic', async () => {
      await orchestrator.initialize();

      // Burst of 50 concurrent requests
      const burstRequests = generateRequests(50);
      const startTime = Date.now();

      const results = await Promise.all(
        burstRequests.map(async (request) => {
          const response = createAllowedResponse(request.requestId!, 'view');
          return orchestrator.processRequest(request, response);
        }),
      );

      const burstDuration = Date.now() - startTime;

      // All requests should succeed
      expect(results.filter((r) => r.enforcement?.allowed).length).toBe(50);

      // Burst should complete in reasonable time
      expect(burstDuration).toBeLessThan(3000);
    });

    it('should recover from high load', async () => {
      await orchestrator.initialize();

      // High load phase
      const highLoadRequests = generateRequests(100);
      await Promise.all(
        highLoadRequests.map(async (request) => {
          const response = createAllowedResponse(request.requestId!, 'view');
          return orchestrator.processRequest(request, response);
        }),
      );

      // Recovery phase - single request should be fast
      const recoveryRequest = createCheckRequest(
        principals.regularUser,
        resources.publicDocument,
        ['view'],
      );
      const recoveryResponse = createAllowedResponse(recoveryRequest.requestId!, 'view');

      const startRecovery = Date.now();
      const result = await orchestrator.processRequest(recoveryRequest, recoveryResponse);
      const recoveryLatency = Date.now() - startRecovery;

      expect(result.enforcement?.allowed).toBe(true);
      expect(recoveryLatency).toBeLessThan(50);
    });
  });

  // ===========================================================================
  // Section 7: Stress Testing
  // ===========================================================================

  describe('Stress Testing', () => {
    it('should handle rapid sequential requests', async () => {
      await orchestrator.initialize();

      const requests = generateRequests(200);
      let successCount = 0;

      for (const request of requests) {
        const response = createAllowedResponse(request.requestId!, 'view');
        const result = await orchestrator.processRequest(request, response);
        if (result.enforcement?.allowed) {
          successCount++;
        }
      }

      // High success rate
      expect(successCount / requests.length).toBeGreaterThan(0.99);
    });

    it('should handle mixed enforcement states under load', async () => {
      await orchestrator.initialize();

      // Set up various enforcement states
      await orchestrator.triggerEnforcement('rate_limit', 'stress-limited-user', 'Stress test');
      await orchestrator.triggerEnforcement('temporary_block', 'stress-blocked-user', 'Stress test');

      // Mixed requests
      const requests = [
        ...Array.from({ length: 30 }, () =>
          createCheckRequest(
            { id: 'stress-normal-user', roles: ['user'], attributes: {} },
            resources.publicDocument,
            ['view'],
          ),
        ),
        ...Array.from({ length: 10 }, () =>
          createCheckRequest(
            { id: 'stress-limited-user', roles: ['user'], attributes: {} },
            resources.publicDocument,
            ['view'],
          ),
        ),
        ...Array.from({ length: 10 }, () =>
          createCheckRequest(
            { id: 'stress-blocked-user', roles: ['user'], attributes: {} },
            resources.publicDocument,
            ['view'],
          ),
        ),
      ];

      const results = await Promise.all(
        requests.map(async (request) => {
          const response = createAllowedResponse(request.requestId!, 'view');
          return orchestrator.processRequest(request, response);
        }),
      );

      // Verify correct enforcement
      const normalResults = results.slice(0, 30);
      const limitedResults = results.slice(30, 40);
      const blockedResults = results.slice(40);

      expect(normalResults.every((r) => r.enforcement?.allowed)).toBe(true);
      expect(limitedResults.every((r) => !r.enforcement?.allowed)).toBe(true);
      expect(blockedResults.every((r) => !r.enforcement?.allowed)).toBe(true);
    });

    it('should maintain health under stress', async () => {
      await orchestrator.initialize();

      // Stress test
      const requests = generateRequests(150);
      await Promise.all(
        requests.map(async (request) => {
          const response = createAllowedResponse(request.requestId!, 'view');
          return orchestrator.processRequest(request, response);
        }),
      );

      // Health check after stress
      const health = await orchestrator.getHealth();

      expect(health.status).toBe('healthy');
      expect(health.agents.guardian.state).toBe('ready');
      expect(health.agents.enforcer.state).toBe('ready');
    });

    it('should not degrade over repeated stress cycles', async () => {
      await orchestrator.initialize();

      const cycles = 3;
      const requestsPerCycle = 50;
      const cycleMetrics: PerformanceMetrics[] = [];

      for (let cycle = 0; cycle < cycles; cycle++) {
        const requests = generateRequests(requestsPerCycle, `cycle-${cycle}`);
        const latencies: number[] = [];

        const cycleStart = Date.now();
        for (const request of requests) {
          const requestStart = Date.now();
          const response = createAllowedResponse(request.requestId!, 'view');
          await orchestrator.processRequest(request, response);
          latencies.push(Date.now() - requestStart);
        }
        const cycleDuration = Date.now() - cycleStart;

        cycleMetrics.push(calculateMetrics(latencies, cycleDuration));
      }

      // Performance should not degrade significantly
      const firstAvg = cycleMetrics[0].avgLatencyMs;
      const lastAvg = cycleMetrics[cycles - 1].avgLatencyMs;

      // Allow for up to 100% increase (generous for stress test)
      expect(lastAvg).toBeLessThan(firstAvg * 2 + 10);
    });
  });
});
