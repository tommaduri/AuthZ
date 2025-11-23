/**
 * Performance E2E Tests
 *
 * Tests performance characteristics including:
 * - Load testing scenarios
 * - Stress testing
 * - Failover testing
 * - Latency benchmarks
 *
 * Based on Avatar Connex policies in policies/connex/
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { AgentOrchestrator } from '@authz-engine/agents';
import { DecisionEngine } from '@authz-engine/core';
import {
  principals,
  resources,
  createCheckRequest,
  createAllowedResponse,
  createDeniedResponse,
  createMultiActionResponse,
  createBatchRequests,
  calculatePerformanceMetrics,
  testConfig,
} from './fixtures.js';

// =============================================================================
// Mock External Dependencies
// =============================================================================

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn(),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }),
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
          choices: [{ message: { content: 'Performance test response' } }],
        }),
      },
    },
  })),
}));

// =============================================================================
// Test Suite: Performance
// =============================================================================

describe('Performance E2E Tests', () => {
  let orchestrator: AgentOrchestrator;
  let engine: DecisionEngine;

  beforeAll(async () => {
    engine = new DecisionEngine();
    orchestrator = new AgentOrchestrator(testConfig);
    await orchestrator.initialize();
  });

  afterAll(async () => {
    try {
      await orchestrator.shutdown();
    } catch {
      // Ignore shutdown errors
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Section 1: Load Testing Scenarios
  // ===========================================================================

  describe('1. Load Testing Scenarios', () => {
    describe('Sustained Load', () => {
      it('should handle 100 concurrent requests without errors', async () => {
        const requests = Array.from({ length: 100 }, (_, i) =>
          createCheckRequest(
            { id: `load-user-${i}`, roles: ['user'], attributes: {} },
            resources.publicContent,
            ['view'],
            `load-req-${i}`,
          ),
        );

        const startTime = Date.now();
        const results = await Promise.all(
          requests.map((request) => {
            const response = createAllowedResponse(request.requestId!, 'view');
            return orchestrator.processRequest(request, response);
          }),
        );
        const totalTime = Date.now() - startTime;

        expect(results).toHaveLength(100);
        results.forEach((result) => {
          expect(result.enforcement?.allowed).toBe(true);
          expect(result.anomalyScore).toBeDefined();
        });

        // Should complete within reasonable time (10 seconds)
        expect(totalTime).toBeLessThan(10000);
      });

      it('should maintain consistent latency under load', async () => {
        const latencies: number[] = [];
        const iterations = 50;

        for (let i = 0; i < iterations; i++) {
          const request = createCheckRequest(
            principals.fan,
            resources.publicContent,
            ['view'],
            `latency-req-${i}`,
          );
          const response = createAllowedResponse(request.requestId!, 'view');

          const start = Date.now();
          await orchestrator.processRequest(request, response);
          latencies.push(Date.now() - start);
        }

        const metrics = calculatePerformanceMetrics(latencies);

        // Average latency should be reasonable
        expect(metrics.avgLatencyMs).toBeLessThan(100);

        // P95 should not be more than 5x average (no major outliers)
        expect(metrics.p95LatencyMs).toBeLessThan(metrics.avgLatencyMs * 5);
      });

      it('should handle mixed request types under load', async () => {
        const requestTypes = [
          { principal: principals.fan, resource: resources.publicContent, actions: ['view'] },
          { principal: principals.premiumFan, resource: resources.premiumContent, actions: ['view'] },
          { principal: principals.influencer, resource: resources.publicAvatar, actions: ['edit'] },
          { principal: principals.admin, resource: resources.flaggedContent, actions: ['moderate'] },
          { principal: principals.financeUser, resource: resources.pendingPayout, actions: ['view'] },
        ];

        const requests = Array.from({ length: 50 }, (_, i) => {
          const type = requestTypes[i % requestTypes.length];
          return createCheckRequest(
            type.principal,
            type.resource,
            type.actions,
            `mixed-req-${i}`,
          );
        });

        const results = await Promise.all(
          requests.map((request, i) => {
            const type = requestTypes[i % requestTypes.length];
            const response = createAllowedResponse(request.requestId!, type.actions[0]);
            return orchestrator.processRequest(request, response);
          }),
        );

        expect(results).toHaveLength(50);
        results.forEach((result) => {
          expect(result).toBeDefined();
          expect(result.anomalyScore).toBeDefined();
        });
      });
    });

    describe('Request Throughput', () => {
      it('should achieve minimum throughput of 50 requests/second', async () => {
        const requestCount = 100;
        const requests = Array.from({ length: requestCount }, (_, i) =>
          createCheckRequest(
            principals.fan,
            resources.publicContent,
            ['view'],
            `throughput-req-${i}`,
          ),
        );

        const startTime = Date.now();
        await Promise.all(
          requests.map((request) => {
            const response = createAllowedResponse(request.requestId!, 'view');
            return orchestrator.processRequest(request, response);
          }),
        );
        const totalTimeSeconds = (Date.now() - startTime) / 1000;

        const throughput = requestCount / totalTimeSeconds;

        // Should achieve at least 50 requests/second
        expect(throughput).toBeGreaterThan(50);
      });

      it('should handle burst traffic patterns', async () => {
        const burstSize = 30;
        const bursts = 3;
        const results: unknown[][] = [];

        for (let burst = 0; burst < bursts; burst++) {
          const requests = Array.from({ length: burstSize }, (_, i) =>
            createCheckRequest(
              principals.fan,
              resources.publicContent,
              ['view'],
              `burst-${burst}-req-${i}`,
            ),
          );

          const burstResults = await Promise.all(
            requests.map((request) => {
              const response = createAllowedResponse(request.requestId!, 'view');
              return orchestrator.processRequest(request, response);
            }),
          );

          results.push(burstResults);

          // Brief pause between bursts
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        expect(results).toHaveLength(bursts);
        results.forEach((burstResults) => {
          expect(burstResults).toHaveLength(burstSize);
        });
      });
    });

    describe('Multi-Action Requests', () => {
      it('should handle multi-action requests efficiently', async () => {
        const latencies: number[] = [];
        const iterations = 30;

        for (let i = 0; i < iterations; i++) {
          const request = createCheckRequest(
            principals.admin,
            resources.flaggedContent,
            ['view', 'edit', 'delete', 'moderate', 'flag'],
            `multi-action-${i}`,
          );
          const response = createMultiActionResponse(
            request.requestId!,
            ['view', 'edit', 'delete', 'moderate', 'flag'],
            [true, true, true, true, true],
          );

          const start = Date.now();
          await orchestrator.processRequest(request, response);
          latencies.push(Date.now() - start);
        }

        const metrics = calculatePerformanceMetrics(latencies);

        // Multi-action requests should still be reasonably fast
        expect(metrics.avgLatencyMs).toBeLessThan(200);
      });
    });
  });

  // ===========================================================================
  // Section 2: Stress Testing
  // ===========================================================================

  describe('2. Stress Testing', () => {
    describe('High Concurrency', () => {
      it('should handle 200 concurrent requests', async () => {
        const requests = Array.from({ length: 200 }, (_, i) =>
          createCheckRequest(
            { id: `stress-user-${i}`, roles: ['user'], attributes: {} },
            resources.publicContent,
            ['view'],
            `stress-req-${i}`,
          ),
        );

        const results = await Promise.allSettled(
          requests.map((request) => {
            const response = createAllowedResponse(request.requestId!, 'view');
            return orchestrator.processRequest(request, response);
          }),
        );

        const successful = results.filter((r) => r.status === 'fulfilled').length;
        const failed = results.filter((r) => r.status === 'rejected').length;

        // Should have high success rate (>95%)
        expect(successful / results.length).toBeGreaterThan(0.95);
      });

      it('should recover from temporary overload', async () => {
        // First burst - high load
        const burst1 = Array.from({ length: 100 }, (_, i) =>
          createCheckRequest(
            principals.fan,
            resources.publicContent,
            ['view'],
            `overload-1-${i}`,
          ),
        );

        await Promise.allSettled(
          burst1.map((request) => {
            const response = createAllowedResponse(request.requestId!, 'view');
            return orchestrator.processRequest(request, response);
          }),
        );

        // Brief recovery period
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Second burst - verify system recovered
        const request = createCheckRequest(
          principals.fan,
          resources.publicContent,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');

        const start = Date.now();
        const result = await orchestrator.processRequest(request, response);
        const latency = Date.now() - start;

        // Should respond quickly after recovery
        expect(latency).toBeLessThan(100);
        expect(result.enforcement?.allowed).toBe(true);
      });
    });

    describe('Memory Stability', () => {
      it('should maintain stable memory under sustained load', async () => {
        const initialMemory = process.memoryUsage().heapUsed;

        // Process many requests
        for (let batch = 0; batch < 10; batch++) {
          const requests = Array.from({ length: 50 }, (_, i) =>
            createCheckRequest(
              { id: `memory-user-${batch}-${i}`, roles: ['user'], attributes: {} },
              resources.publicContent,
              ['view'],
            ),
          );

          await Promise.all(
            requests.map((request) => {
              const response = createAllowedResponse(request.requestId!, 'view');
              return orchestrator.processRequest(request, response);
            }),
          );
        }

        // Allow garbage collection
        if (global.gc) {
          global.gc();
        }

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = finalMemory - initialMemory;

        // Memory increase should be reasonable (<100MB)
        expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024);
      });
    });

    describe('Error Resilience', () => {
      it('should handle mix of valid and invalid requests', async () => {
        const requests = Array.from({ length: 50 }, (_, i) => {
          // Mix of valid and potentially problematic requests
          if (i % 10 === 0) {
            // Empty principal ID
            return createCheckRequest(
              { id: '', roles: [], attributes: {} },
              resources.publicContent,
              ['view'],
              `error-mix-${i}`,
            );
          }
          return createCheckRequest(
            principals.fan,
            resources.publicContent,
            ['view'],
            `error-mix-${i}`,
          );
        });

        const results = await Promise.allSettled(
          requests.map((request) => {
            const response = createAllowedResponse(request.requestId!, 'view');
            return orchestrator.processRequest(request, response);
          }),
        );

        // Most requests should succeed
        const successful = results.filter((r) => r.status === 'fulfilled').length;
        expect(successful).toBeGreaterThan(40);
      });
    });
  });

  // ===========================================================================
  // Section 3: Failover Testing
  // ===========================================================================

  describe('3. Failover Testing', () => {
    describe('Graceful Degradation', () => {
      it('should continue operating when explanation is disabled', async () => {
        const request = createCheckRequest(
          principals.fan,
          resources.publicContent,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');

        // Request without explanation should still work
        const result = await orchestrator.processRequest(request, response, {
          includeExplanation: false,
        });

        expect(result.enforcement?.allowed).toBe(true);
        expect(result.explanation).toBeUndefined();
      });

      it('should maintain core functionality under component stress', async () => {
        // Simulate high load that might stress individual components
        const requests = Array.from({ length: 100 }, (_, i) =>
          createCheckRequest(
            principals.fan,
            resources.publicContent,
            ['view'],
            `failover-${i}`,
          ),
        );

        const results = await Promise.all(
          requests.map((request) => {
            const response = createAllowedResponse(request.requestId!, 'view');
            return orchestrator.processRequest(request, response);
          }),
        );

        // All core decisions should be made
        results.forEach((result) => {
          expect(result.enforcement).toBeDefined();
          expect(result.anomalyScore).toBeDefined();
        });
      });
    });

    describe('Health Monitoring Under Load', () => {
      it('should report accurate health status during load', async () => {
        // Start background load
        const loadPromise = Promise.all(
          Array.from({ length: 50 }, (_, i) => {
            const request = createCheckRequest(
              principals.fan,
              resources.publicContent,
              ['view'],
              `health-load-${i}`,
            );
            const response = createAllowedResponse(request.requestId!, 'view');
            return orchestrator.processRequest(request, response);
          }),
        );

        // Check health during load
        const health = await orchestrator.getHealth();

        expect(health.status).toBe('healthy');
        expect(health.agents.guardian.state).toBe('ready');
        expect(health.agents.enforcer.state).toBe('ready');

        await loadPromise;
      });

      it('should track metrics accurately under load', async () => {
        const initialHealth = await orchestrator.getHealth();
        const initialCount = initialHealth.agents.guardian.metrics.processedCount;

        // Process additional requests
        for (let i = 0; i < 20; i++) {
          const request = createCheckRequest(
            principals.fan,
            resources.publicContent,
            ['view'],
          );
          const response = createAllowedResponse(request.requestId!, 'view');
          await orchestrator.processRequest(request, response);
        }

        const finalHealth = await orchestrator.getHealth();
        const finalCount = finalHealth.agents.guardian.metrics.processedCount;

        expect(finalCount).toBeGreaterThanOrEqual(initialCount + 20);
      });
    });

    describe('Initialization and Shutdown', () => {
      it('should handle multiple initialization calls idempotently', async () => {
        // Second initialization should be no-op
        await orchestrator.initialize();
        await orchestrator.initialize();

        const health = await orchestrator.getHealth();
        expect(health.status).toBe('healthy');
      });

      it('should be able to process requests after re-initialization', async () => {
        const request = createCheckRequest(
          principals.fan,
          resources.publicContent,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Section 4: Latency Benchmarks
  // ===========================================================================

  describe('4. Latency Benchmarks', () => {
    describe('Single Request Latency', () => {
      it('should process simple request under 50ms', async () => {
        const request = createCheckRequest(
          principals.fan,
          resources.publicContent,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');

        const start = Date.now();
        await orchestrator.processRequest(request, response);
        const latency = Date.now() - start;

        expect(latency).toBeLessThan(50);
      });

      it('should process request with explanation under 100ms', async () => {
        const request = createCheckRequest(
          principals.fan,
          resources.premiumContent,
          ['view'],
        );
        const response = createDeniedResponse(request.requestId!, 'view');

        const start = Date.now();
        await orchestrator.processRequest(request, response, {
          includeExplanation: true,
        });
        const latency = Date.now() - start;

        expect(latency).toBeLessThan(100);
      });
    });

    describe('Batch Processing Latency', () => {
      it('should process batch of 10 requests under 200ms', async () => {
        const requests = Array.from({ length: 10 }, (_, i) =>
          createCheckRequest(
            principals.fan,
            resources.publicContent,
            ['view'],
            `batch-latency-${i}`,
          ),
        );

        const start = Date.now();
        await Promise.all(
          requests.map((request) => {
            const response = createAllowedResponse(request.requestId!, 'view');
            return orchestrator.processRequest(request, response);
          }),
        );
        const totalLatency = Date.now() - start;

        expect(totalLatency).toBeLessThan(200);
      });
    });

    describe('Percentile Latencies', () => {
      it('should have P99 latency under 200ms', async () => {
        const latencies: number[] = [];
        const iterations = 100;

        for (let i = 0; i < iterations; i++) {
          const request = createCheckRequest(
            principals.fan,
            resources.publicContent,
            ['view'],
            `p99-test-${i}`,
          );
          const response = createAllowedResponse(request.requestId!, 'view');

          const start = Date.now();
          await orchestrator.processRequest(request, response);
          latencies.push(Date.now() - start);
        }

        const metrics = calculatePerformanceMetrics(latencies);

        expect(metrics.p99LatencyMs).toBeLessThan(200);
        expect(metrics.p95LatencyMs).toBeLessThan(150);
        expect(metrics.p50LatencyMs).toBeLessThan(50);
      });
    });

    describe('Processing Time Tracking', () => {
      it('should accurately track processing time in results', async () => {
        const request = createCheckRequest(
          principals.fan,
          resources.publicContent,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');

        const start = Date.now();
        const result = await orchestrator.processRequest(request, response);
        const measuredLatency = Date.now() - start;

        // Reported processing time should be close to measured time
        expect(result.processingTimeMs).toBeDefined();
        expect(result.processingTimeMs).toBeLessThanOrEqual(measuredLatency + 10);
      });
    });
  });

  // ===========================================================================
  // Section 5: Resource Utilization
  // ===========================================================================

  describe('5. Resource Utilization', () => {
    describe('Agent Efficiency', () => {
      it('should process requests with minimal agent overhead', async () => {
        const request = createCheckRequest(
          principals.fan,
          resources.publicContent,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response);

        // Should use minimal agents for simple requests
        expect(result.agentsInvolved.length).toBeLessThanOrEqual(4);
      });

      it('should report accurate agent metrics', async () => {
        const health = await orchestrator.getHealth();

        // Verify all agents report metrics
        expect(health.agents.guardian.metrics).toBeDefined();
        expect(health.agents.analyst.metrics).toBeDefined();
        expect(health.agents.advisor.metrics).toBeDefined();
        expect(health.agents.enforcer.metrics).toBeDefined();

        // Metrics should be non-negative
        expect(health.agents.guardian.metrics.processedCount).toBeGreaterThanOrEqual(0);
        expect(health.agents.enforcer.metrics.processedCount).toBeGreaterThanOrEqual(0);
      });
    });
  });
});
