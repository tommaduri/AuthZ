/**
 * End-to-End Tests for gRPC Client
 *
 * These tests require the Go gRPC server to be running.
 * Run with: AUTHZ_SERVER=localhost:50051 npm test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  AuthzClient,
  createClient,
  Effect,
  isAllowed,
  isDenied,
  getAllowedActions,
  type CheckRequest,
  type ClientOptions,
} from '../index.js';

// Skip E2E tests if server is not available
const SERVER_ADDRESS = process.env['AUTHZ_SERVER'] ?? 'localhost:50051';
const RUN_E2E = process.env['RUN_E2E'] === 'true';

describe.skipIf(!RUN_E2E)('E2E: gRPC Client Integration', () => {
  let client: AuthzClient;

  beforeAll(async () => {
    const options: ClientOptions = {
      address: SERVER_ADDRESS,
      timeout: 10000,
      maxRetries: 3,
    };

    client = createClient(options);
    await client.connect();
  });

  afterAll(() => {
    client?.disconnect();
  });

  beforeEach(() => {
    client.resetStats();
  });

  describe('Single Check Requests', () => {
    it('should allow admin full access', async () => {
      const request: CheckRequest = {
        requestId: 'e2e-admin-1',
        principal: {
          id: 'admin-user',
          roles: ['admin'],
        },
        resource: {
          kind: 'document',
          id: 'doc-123',
        },
        actions: ['read', 'write', 'delete'],
      };

      const response = await client.check(request);

      expect(response.requestId).toBe('e2e-admin-1');
      expect(isAllowed(response, 'read')).toBe(true);
      expect(isAllowed(response, 'write')).toBe(true);
      expect(isAllowed(response, 'delete')).toBe(true);
    });

    it('should deny non-admin delete', async () => {
      const request: CheckRequest = {
        requestId: 'e2e-user-1',
        principal: {
          id: 'regular-user',
          roles: ['user'],
        },
        resource: {
          kind: 'document',
          id: 'doc-456',
        },
        actions: ['read', 'delete'],
      };

      const response = await client.check(request);

      expect(isDenied(response, 'delete')).toBe(true);
    });

    it('should allow owner to write', async () => {
      const request: CheckRequest = {
        requestId: 'e2e-owner-1',
        principal: {
          id: 'user-owner',
          roles: ['user'],
        },
        resource: {
          kind: 'document',
          id: 'doc-owned',
          attributes: {
            ownerId: 'user-owner',
          },
        },
        actions: ['read', 'write'],
      };

      const response = await client.check(request);

      const allowed = getAllowedActions(response);
      expect(allowed).toContain('read');
      expect(allowed).toContain('write');
    });

    it('should evaluate CEL conditions', async () => {
      const request: CheckRequest = {
        requestId: 'e2e-cel-1',
        principal: {
          id: 'dept-user',
          roles: ['user'],
          attributes: {
            department: 'engineering',
          },
        },
        resource: {
          kind: 'project',
          id: 'proj-eng',
          attributes: {
            department: 'engineering',
          },
        },
        actions: ['read', 'contribute'],
      };

      const response = await client.check(request);

      expect(isAllowed(response, 'read')).toBe(true);
      expect(isAllowed(response, 'contribute')).toBe(true);
    });

    it('should include metadata in response', async () => {
      const request: CheckRequest = {
        requestId: 'e2e-metadata-1',
        principal: {
          id: 'user-meta',
          roles: ['user'],
        },
        resource: {
          kind: 'document',
          id: 'doc-meta',
        },
        actions: ['read'],
      };

      const response = await client.check(request);

      expect(response.metadata).toBeDefined();
      expect(response.metadata?.evaluationDurationUs).toBeGreaterThanOrEqual(0);
      expect(response.metadata?.policiesEvaluated).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Batch Check Requests', () => {
    it('should handle batch requests', async () => {
      const requests: CheckRequest[] = [
        {
          requestId: 'batch-1',
          principal: { id: 'admin', roles: ['admin'] },
          resource: { kind: 'document', id: 'doc-1' },
          actions: ['delete'],
        },
        {
          requestId: 'batch-2',
          principal: { id: 'user', roles: ['user'] },
          resource: { kind: 'document', id: 'doc-2' },
          actions: ['delete'],
        },
        {
          requestId: 'batch-3',
          principal: { id: 'owner', roles: ['user'] },
          resource: {
            kind: 'document',
            id: 'doc-3',
            attributes: { ownerId: 'owner' },
          },
          actions: ['write'],
        },
      ];

      const responses = await client.checkBatch(requests);

      expect(responses).toHaveLength(3);
      expect(isAllowed(responses[0]!, 'delete')).toBe(true);  // admin
      expect(isDenied(responses[1]!, 'delete')).toBe(true);   // user
      expect(isAllowed(responses[2]!, 'write')).toBe(true);   // owner
    });

    it('should handle large batch efficiently', async () => {
      const batchSize = 50;
      const requests: CheckRequest[] = Array.from({ length: batchSize }, (_, i) => ({
        requestId: `large-batch-${i}`,
        principal: { id: `user-${i}`, roles: ['user'] },
        resource: { kind: 'document', id: `doc-${i}` },
        actions: ['read'],
      }));

      const start = Date.now();
      const responses = await client.checkBatch(requests);
      const duration = Date.now() - start;

      expect(responses).toHaveLength(batchSize);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });

  describe('Caching Behavior', () => {
    it('should hit cache on repeated requests', async () => {
      const request: CheckRequest = {
        requestId: 'cache-test',
        principal: { id: 'cache-user', roles: ['user'] },
        resource: { kind: 'document', id: 'doc-cache' },
        actions: ['read'],
      };

      // First request - cache miss
      const response1 = await client.check(request);
      expect(response1.metadata?.cacheHit).toBe(false);

      // Second request - cache hit
      const response2 = await client.check(request);
      expect(response2.metadata?.cacheHit).toBe(true);

      // Results should be the same
      expect(response1.results.get('read')?.effect).toBe(
        response2.results.get('read')?.effect
      );
    });
  });

  describe('Client Statistics', () => {
    it('should track request statistics', async () => {
      const request: CheckRequest = {
        requestId: 'stats-test',
        principal: { id: 'stats-user', roles: ['user'] },
        resource: { kind: 'document', id: 'doc-stats' },
        actions: ['read'],
      };

      // Make several requests
      for (let i = 0; i < 5; i++) {
        await client.check(request);
      }

      const stats = client.getStats();

      expect(stats.totalRequests).toBe(5);
      expect(stats.successfulRequests).toBe(5);
      expect(stats.failedRequests).toBe(0);
      expect(stats.avgLatencyMs).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid resource kind gracefully', async () => {
      const request: CheckRequest = {
        requestId: 'error-test',
        principal: { id: 'user', roles: ['user'] },
        resource: { kind: 'nonexistent-kind', id: 'id' },
        actions: ['read'],
      };

      // Should not throw, but return default deny
      const response = await client.check(request);
      expect(isDenied(response, 'read')).toBe(true);
    });
  });

  describe('Performance', () => {
    it('should meet latency requirements', async () => {
      const request: CheckRequest = {
        requestId: 'perf-test',
        principal: { id: 'perf-user', roles: ['admin'] },
        resource: { kind: 'document', id: 'doc-perf' },
        actions: ['read'],
      };

      const iterations = 100;
      const latencies: number[] = [];

      // Warm up
      for (let i = 0; i < 10; i++) {
        await client.check(request);
      }

      // Measure
      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await client.check(request);
        latencies.push(Date.now() - start);
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / iterations;
      const p99Index = Math.floor(iterations * 0.99);
      const sortedLatencies = [...latencies].sort((a, b) => a - b);
      const p99Latency = sortedLatencies[p99Index];

      console.log(`Average latency: ${avgLatency.toFixed(2)}ms`);
      console.log(`P99 latency: ${p99Latency}ms`);

      // Performance targets
      expect(avgLatency).toBeLessThan(50); // Average < 50ms (includes network)
      expect(p99Latency).toBeLessThan(100); // P99 < 100ms
    });
  });
});

describe('Client Connection', () => {
  it('should handle connection failure gracefully', async () => {
    const client = createClient({
      address: 'invalid-host:99999',
      timeout: 1000,
      maxRetries: 1,
    });

    await expect(client.connect()).rejects.toThrow();
  });

  it('should throw when calling check without connecting', async () => {
    const client = createClient({
      address: 'localhost:50051',
    });

    const request: CheckRequest = {
      requestId: 'test',
      principal: { id: 'user', roles: [] },
      resource: { kind: 'doc', id: '1' },
      actions: ['read'],
    };

    expect(() => client.check(request)).rejects.toThrow('Client not connected');
  });
});
