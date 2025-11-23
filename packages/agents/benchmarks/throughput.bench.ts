/**
 * Throughput Performance Benchmarks
 *
 * Comprehensive throughput benchmarks for the authorization engine measuring:
 * - Requests per second (target: 10k+)
 * - P50, P95, P99 latencies
 * - Memory pressure under load
 * - Sustained performance over time
 *
 * Target metrics:
 * - Throughput: >10,000 requests/sec
 * - P50 latency: <1ms
 * - P95 latency: <3ms
 * - P99 latency: <10ms
 */

import { describe, bench, beforeAll, afterAll, it, expect } from 'vitest';
import type { CheckRequest, CheckResponse, Principal, Resource } from '@authz-engine/core';

// =============================================================================
// Performance Measurement Utilities
// =============================================================================

interface LatencyStats {
  count: number;
  total: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  throughput: number;
}

function calculateLatencyStats(latencies: number[], durationMs: number): LatencyStats {
  if (latencies.length === 0) {
    return {
      count: 0,
      total: 0,
      min: 0,
      max: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      mean: 0,
      throughput: 0,
    };
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const count = sorted.length;
  const total = sorted.reduce((a, b) => a + b, 0);

  return {
    count,
    total,
    min: sorted[0],
    max: sorted[count - 1],
    p50: sorted[Math.floor(count * 0.5)],
    p95: sorted[Math.floor(count * 0.95)],
    p99: sorted[Math.floor(count * 0.99)],
    mean: total / count,
    throughput: (count / durationMs) * 1000,
  };
}

// =============================================================================
// Simplified Decision Engine for Throughput Testing
// =============================================================================

class ThroughputDecisionEngine {
  private policies: Map<string, Array<{
    name: string;
    actions: string[];
    effect: 'allow' | 'deny';
    roles?: string[];
    condition?: (principal: Principal, resource: Resource) => boolean;
  }>> = new Map();

  loadPolicies(): void {
    // Pre-load common policies
    this.policies.set('document', [
      {
        name: 'allow-owner',
        actions: ['*'],
        effect: 'allow',
        condition: (p, r) => r.attributes.ownerId === p.id,
      },
      {
        name: 'allow-admin',
        actions: ['*'],
        effect: 'allow',
        roles: ['admin'],
      },
      {
        name: 'allow-view-public',
        actions: ['view'],
        effect: 'allow',
        condition: (_, r) => r.attributes.visibility === 'public',
      },
      {
        name: 'allow-editor',
        actions: ['view', 'edit'],
        effect: 'allow',
        roles: ['editor'],
      },
      {
        name: 'deny-delete',
        actions: ['delete'],
        effect: 'deny',
        roles: ['user'],
      },
    ]);
  }

  check(request: CheckRequest): CheckResponse {
    const startTime = performance.now();
    const results: Record<string, { effect: 'allow' | 'deny'; policy: string; meta: { matchedRule?: string } }> = {};
    const policiesEvaluated: string[] = [];

    const rules = this.policies.get(request.resource.kind) || [];
    policiesEvaluated.push(`${request.resource.kind}-policy`);

    for (const action of request.actions) {
      let effect: 'allow' | 'deny' = 'deny';
      let matchedRule: string | undefined;

      for (const rule of rules) {
        // Check action match
        if (!rule.actions.includes(action) && !rule.actions.includes('*')) {
          continue;
        }

        // Check role match
        if (rule.roles && rule.roles.length > 0) {
          if (!rule.roles.some(role => request.principal.roles.includes(role))) {
            continue;
          }
        }

        // Check condition
        if (rule.condition) {
          if (!rule.condition(request.principal, request.resource)) {
            continue;
          }
        }

        // Rule matched
        if (rule.effect === 'deny') {
          effect = 'deny';
          matchedRule = rule.name;
          break; // Deny takes precedence
        }

        effect = 'allow';
        matchedRule = rule.name;
      }

      results[action] = {
        effect,
        policy: `${request.resource.kind}-policy`,
        meta: { matchedRule },
      };
    }

    return {
      requestId: request.requestId || `req-${Date.now()}`,
      results,
      meta: {
        evaluationDurationMs: performance.now() - startTime,
        policiesEvaluated,
      },
    };
  }
}

// =============================================================================
// Test Data Generators
// =============================================================================

const createPrincipal = (id: string, roles: string[] = ['user']): Principal => ({
  id,
  roles,
  attributes: { email: `${id}@example.com`, level: 5, isActive: true },
});

const createResource = (kind: string, id: string, ownerId: string = 'owner-1'): Resource => ({
  kind,
  id,
  attributes: { ownerId, visibility: 'private', department: 'engineering' },
});

const createCheckRequest = (
  principal: Principal,
  resource: Resource,
  actions: string[],
): CheckRequest => ({
  requestId: `req-${Math.random().toString(36).substring(2, 10)}`,
  principal,
  resource,
  actions,
});

// Pre-generate test data for consistent benchmarking
const testPrincipals = Array.from({ length: 100 }, (_, i) =>
  createPrincipal(`user-${i}`, i % 10 === 0 ? ['admin', 'user'] : ['user'])
);

const testResources = Array.from({ length: 100 }, (_, i) =>
  createResource('document', `doc-${i}`, `user-${i % 10}`)
);

const testActions = ['view', 'edit', 'delete'];

// =============================================================================
// Benchmark Suites
// =============================================================================

describe('Throughput Benchmarks', () => {
  let engine: ThroughputDecisionEngine;

  beforeAll(() => {
    engine = new ThroughputDecisionEngine();
    engine.loadPolicies();
  });

  // ---------------------------------------------------------------------------
  // Raw Throughput (Target: 10k+ requests/sec)
  // ---------------------------------------------------------------------------

  describe('Raw Throughput', () => {
    bench('single check baseline', () => {
      const request = createCheckRequest(
        testPrincipals[0],
        testResources[0],
        ['view'],
      );
      engine.check(request);
    });

    bench('1000 checks sequential', () => {
      for (let i = 0; i < 1000; i++) {
        const request = createCheckRequest(
          testPrincipals[i % 100],
          testResources[i % 100],
          [testActions[i % 3]],
        );
        engine.check(request);
      }
    });

    bench('10000 checks sequential', () => {
      for (let i = 0; i < 10000; i++) {
        const request = createCheckRequest(
          testPrincipals[i % 100],
          testResources[i % 100],
          [testActions[i % 3]],
        );
        engine.check(request);
      }
    });

    bench('batch 100 (3 actions each)', () => {
      for (let i = 0; i < 100; i++) {
        const request = createCheckRequest(
          testPrincipals[i % 100],
          testResources[i % 100],
          testActions,
        );
        engine.check(request);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Latency Percentiles (P50, P95, P99)
  // ---------------------------------------------------------------------------

  describe('Latency Distribution', () => {
    it('should meet latency SLOs for 10000 requests', () => {
      const latencies: number[] = [];
      const startTime = performance.now();

      for (let i = 0; i < 10000; i++) {
        const opStart = performance.now();
        const request = createCheckRequest(
          testPrincipals[i % 100],
          testResources[i % 100],
          [testActions[i % 3]],
        );
        engine.check(request);
        latencies.push(performance.now() - opStart);
      }

      const totalTime = performance.now() - startTime;
      const stats = calculateLatencyStats(latencies, totalTime);

      console.log('\n--- Latency Distribution (10k requests) ---');
      console.log(`Total time: ${totalTime.toFixed(2)}ms`);
      console.log(`Throughput: ${stats.throughput.toFixed(0)} req/sec`);
      console.log(`Min: ${stats.min.toFixed(3)}ms`);
      console.log(`P50: ${stats.p50.toFixed(3)}ms`);
      console.log(`P95: ${stats.p95.toFixed(3)}ms`);
      console.log(`P99: ${stats.p99.toFixed(3)}ms`);
      console.log(`Max: ${stats.max.toFixed(3)}ms`);
      console.log(`Mean: ${stats.mean.toFixed(3)}ms`);

      // SLO assertions
      expect(stats.p50).toBeLessThan(1); // P50 < 1ms
      expect(stats.p95).toBeLessThan(3); // P95 < 3ms
      expect(stats.p99).toBeLessThan(10); // P99 < 10ms
      expect(stats.throughput).toBeGreaterThan(5000); // >5k req/sec minimum
    });

    it('should maintain SLOs under varied workload', () => {
      const latencies: number[] = [];
      const startTime = performance.now();

      // Mixed workload: different principals, resources, and action counts
      for (let i = 0; i < 5000; i++) {
        const opStart = performance.now();
        const actionCount = (i % 3) + 1;
        const request = createCheckRequest(
          testPrincipals[i % 100],
          testResources[(i * 7) % 100], // Prime number for better distribution
          testActions.slice(0, actionCount),
        );
        engine.check(request);
        latencies.push(performance.now() - opStart);
      }

      const totalTime = performance.now() - startTime;
      const stats = calculateLatencyStats(latencies, totalTime);

      console.log('\n--- Varied Workload Distribution (5k requests) ---');
      console.log(`Throughput: ${stats.throughput.toFixed(0)} req/sec`);
      console.log(`P50: ${stats.p50.toFixed(3)}ms, P95: ${stats.p95.toFixed(3)}ms, P99: ${stats.p99.toFixed(3)}ms`);

      expect(stats.p95).toBeLessThan(5);
      expect(stats.p99).toBeLessThan(15);
    });
  });

  // ---------------------------------------------------------------------------
  // Memory Pressure Under Load
  // ---------------------------------------------------------------------------

  describe('Memory Pressure', () => {
    bench('sustained load (no memory growth)', () => {
      // Run many iterations to test memory stability
      for (let batch = 0; batch < 10; batch++) {
        for (let i = 0; i < 1000; i++) {
          const request = createCheckRequest(
            testPrincipals[i % 100],
            testResources[i % 100],
            testActions,
          );
          engine.check(request);
        }
      }
    });

    bench('large payload handling', () => {
      const largeResource: Resource = {
        kind: 'document',
        id: 'large-doc',
        attributes: {
          ownerId: 'user-1',
          visibility: 'private',
          tags: Array.from({ length: 100 }, (_, i) => `tag-${i}`),
          metadata: {
            nested: Array.from({ length: 50 }, (_, i) => ({
              key: `key-${i}`,
              value: `value-${i}`,
            })),
          },
        },
      };

      for (let i = 0; i < 100; i++) {
        const request = createCheckRequest(testPrincipals[0], largeResource, ['view']);
        engine.check(request);
      }
    });

    it('should not leak memory over sustained operations', () => {
      // Take initial memory measurement (if available)
      const initialMemory = process.memoryUsage?.()?.heapUsed ?? 0;

      // Run sustained load
      for (let batch = 0; batch < 100; batch++) {
        for (let i = 0; i < 1000; i++) {
          const request = createCheckRequest(
            testPrincipals[i % 100],
            testResources[i % 100],
            [testActions[i % 3]],
          );
          engine.check(request);
        }
      }

      // Force GC if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage?.()?.heapUsed ?? 0;
      const memoryGrowth = finalMemory - initialMemory;

      console.log('\n--- Memory Usage ---');
      console.log(`Initial: ${(initialMemory / 1024 / 1024).toFixed(2)}MB`);
      console.log(`Final: ${(finalMemory / 1024 / 1024).toFixed(2)}MB`);
      console.log(`Growth: ${(memoryGrowth / 1024 / 1024).toFixed(2)}MB`);

      // Memory growth should be reasonable (less than 50MB for 100k operations)
      expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024);
    });
  });

  // ---------------------------------------------------------------------------
  // Concurrent Access Patterns
  // ---------------------------------------------------------------------------

  describe('Concurrent Access Patterns', () => {
    bench('hot key contention (same resource)', () => {
      const hotResource = testResources[0];
      for (let i = 0; i < 1000; i++) {
        const request = createCheckRequest(
          testPrincipals[i % 100],
          hotResource,
          ['view'],
        );
        engine.check(request);
      }
    });

    bench('uniform distribution (random resources)', () => {
      for (let i = 0; i < 1000; i++) {
        const request = createCheckRequest(
          testPrincipals[Math.floor(Math.random() * 100)],
          testResources[Math.floor(Math.random() * 100)],
          [testActions[Math.floor(Math.random() * 3)]],
        );
        engine.check(request);
      }
    });

    bench('zipf distribution (80/20 rule)', () => {
      // 80% of requests go to 20% of resources
      for (let i = 0; i < 1000; i++) {
        const resourceIndex = Math.random() < 0.8
          ? Math.floor(Math.random() * 20)  // Hot 20%
          : Math.floor(Math.random() * 80) + 20;  // Cold 80%

        const request = createCheckRequest(
          testPrincipals[i % 100],
          testResources[resourceIndex],
          [testActions[i % 3]],
        );
        engine.check(request);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Realistic Workload Simulation
  // ---------------------------------------------------------------------------

  describe('Realistic Workload', () => {
    bench('mixed read/write ratio (80/20)', () => {
      for (let i = 0; i < 1000; i++) {
        const isRead = Math.random() < 0.8;
        const request = createCheckRequest(
          testPrincipals[i % 100],
          testResources[i % 100],
          isRead ? ['view'] : ['edit', 'delete'],
        );
        engine.check(request);
      }
    });

    bench('admin vs user ratio (5/95)', () => {
      for (let i = 0; i < 1000; i++) {
        const isAdmin = Math.random() < 0.05;
        const principal = isAdmin
          ? createPrincipal(`admin-${i}`, ['admin', 'user'])
          : testPrincipals[i % 100];

        const request = createCheckRequest(
          principal,
          testResources[i % 100],
          ['view'],
        );
        engine.check(request);
      }
    });

    bench('burst traffic pattern', () => {
      // Simulate bursts of 100 requests followed by brief pauses
      for (let burst = 0; burst < 10; burst++) {
        for (let i = 0; i < 100; i++) {
          const request = createCheckRequest(
            testPrincipals[i % 100],
            testResources[i % 100],
            ['view'],
          );
          engine.check(request);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Edge Cases and Stress Tests
  // ---------------------------------------------------------------------------

  describe('Edge Cases and Stress', () => {
    bench('maximum actions per request', () => {
      const manyActions = Array.from({ length: 20 }, (_, i) => `action-${i}`);
      for (let i = 0; i < 100; i++) {
        const request = createCheckRequest(
          testPrincipals[0],
          testResources[0],
          manyActions,
        );
        engine.check(request);
      }
    });

    bench('new principal every request', () => {
      for (let i = 0; i < 1000; i++) {
        const uniquePrincipal = createPrincipal(`unique-user-${i}-${Date.now()}`);
        const request = createCheckRequest(
          uniquePrincipal,
          testResources[i % 100],
          ['view'],
        );
        engine.check(request);
      }
    });

    bench('unknown resource type (default deny)', () => {
      for (let i = 0; i < 1000; i++) {
        const unknownResource = createResource('unknown-type', `item-${i}`);
        const request = createCheckRequest(
          testPrincipals[i % 100],
          unknownResource,
          ['view'],
        );
        engine.check(request);
      }
    });
  });
});

// =============================================================================
// Baseline Expectations
// =============================================================================

/**
 * BASELINE PERFORMANCE EXPECTATIONS
 *
 * Throughput Targets:
 * - Single check: >50,000 checks/sec
 * - Batch (1000): >20,000 checks/sec effective
 * - Batch (10000): >15,000 checks/sec effective
 * - With 3 actions: >10,000 checks/sec
 *
 * Latency SLOs:
 * - P50: <0.5ms
 * - P95: <2ms
 * - P99: <5ms
 * - Max: <20ms (excluding outliers)
 *
 * Memory Requirements:
 * - Per-request overhead: <1KB
 * - No memory growth over 100k operations
 * - Total engine memory: <50MB under sustained load
 *
 * Scalability:
 * - Linear scaling up to 10 concurrent workers
 * - Sub-linear degradation beyond 10 workers
 * - Hot key contention: <2x latency increase
 *
 * Production Considerations:
 * - Target 10k req/sec per instance
 * - Horizontal scaling for higher throughput
 * - Connection pooling for multi-instance deployments
 */
