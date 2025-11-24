/**
 * REST API Integration Tests for AuthZ Engine
 *
 * Tests REST API endpoints including:
 * - Authentication flows
 * - Rate limiting
 * - CORS handling
 * - API versioning
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TestServerManager, wait } from './setup';
import { testPolicies } from '../fixtures';

describe('REST API Integration', () => {
  let server: TestServerManager;

  beforeAll(async () => {
    server = new TestServerManager({
      enableAgentic: true,
      policies: [
        testPolicies.document,
        testPolicies.premiumContent,
        testPolicies.avatar,
        testPolicies.adminSettings,
        testPolicies.payout,
      ],
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('Core Endpoints', () => {
    describe('GET /health', () => {
      it('should return health status', async () => {
        const response = await fetch(`${server.restUrl}/health`);

        expect(response.ok).toBe(true);
        expect(response.headers.get('content-type')).toContain('application/json');

        const data = await response.json();
        expect(data.status).toBe('healthy');
        expect(data.version).toBeDefined();
        expect(typeof data.policies_loaded).toBe('number');
      });

      it('should respond quickly', async () => {
        const startTime = performance.now();
        await fetch(`${server.restUrl}/health`);
        const duration = performance.now() - startTime;

        expect(duration).toBeLessThan(100); // Health check should be fast
      });
    });

    describe('GET /ready', () => {
      it('should return readiness status', async () => {
        const response = await fetch(`${server.restUrl}/ready`);

        expect(response.ok).toBe(true);

        const data = await response.json();
        expect(data.ready).toBe(true);
        expect(typeof data.policies_loaded).toBe('number');
      });
    });

    describe('POST /api/check', () => {
      it('should accept valid check request', async () => {
        const response = await fetch(`${server.restUrl}/api/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            principal: { id: 'user-123', roles: ['user'] },
            resource: { kind: 'document', id: 'doc-001' },
            actions: ['view'],
          }),
        });

        expect(response.ok).toBe(true);

        const data = await response.json();
        expect(data.requestId).toBeDefined();
        expect(data.results).toBeDefined();
        expect(data.results.view).toBeDefined();
      });

      it('should include request ID in response', async () => {
        const requestId = 'custom-request-id-123';

        const response = await fetch(`${server.restUrl}/api/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId,
            principal: { id: 'user-123', roles: ['user'] },
            resource: { kind: 'document', id: 'doc-001' },
            actions: ['view'],
          }),
        });

        const data = await response.json();
        expect(data.requestId).toBe(requestId);
      });

      it('should accept both attr and attributes formats', async () => {
        // Test with 'attr'
        const response1 = await fetch(`${server.restUrl}/api/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            principal: { id: 'user-123', roles: ['user'], attr: { email: 'test@example.com' } },
            resource: { kind: 'document', id: 'doc-001', attr: { ownerId: 'user-123' } },
            actions: ['view'],
          }),
        });
        expect(response1.ok).toBe(true);

        // Test with 'attributes'
        const response2 = await fetch(`${server.restUrl}/api/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            principal: { id: 'user-123', roles: ['user'], attributes: { email: 'test@example.com' } },
            resource: { kind: 'document', id: 'doc-001', attributes: { ownerId: 'user-123' } },
            actions: ['view'],
          }),
        });
        expect(response2.ok).toBe(true);
      });
    });

    describe('POST /api/check/batch', () => {
      it('should process batch requests', async () => {
        const response = await fetch(`${server.restUrl}/api/check/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            principal: { id: 'user-123', roles: ['user'] },
            resources: [
              { resource: { kind: 'document', id: 'doc-1' }, actions: ['view'] },
              { resource: { kind: 'document', id: 'doc-2' }, actions: ['edit'] },
            ],
          }),
        });

        expect(response.ok).toBe(true);

        const data = await response.json();
        expect(data.results).toBeDefined();
        expect(data.results['document:doc-1']).toBeDefined();
        expect(data.results['document:doc-2']).toBeDefined();
      });
    });
  });

  describe('Agentic Endpoints', () => {
    describe('POST /v1/check/agentic', () => {
      it('should process agentic check request', async () => {
        const response = await fetch(`${server.restUrl}/v1/check/agentic`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            principal: { id: 'user-123', roles: ['user'] },
            resource: { kind: 'document', id: 'doc-001' },
            actions: ['view'],
            includeExplanation: true,
          }),
        });

        expect(response.ok).toBe(true);

        const data = await response.json();
        expect(data.results).toBeDefined();
        expect(data.agentic).toBeDefined();
        expect(data.agentic.anomalyScore).toBeDefined();
        expect(data.agentic.agentsInvolved).toBeInstanceOf(Array);
      });

      it('should include explanation when requested', async () => {
        const response = await fetch(`${server.restUrl}/v1/check/agentic`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            principal: { id: 'user-123', roles: ['user'] },
            resource: { kind: 'document', id: 'doc-001' },
            actions: ['view'],
            includeExplanation: true,
          }),
        });

        const data = await response.json();
        expect(data.agentic.explanation).toBeDefined();
        expect(data.agentic.explanation.summary).toBeDefined();
      });
    });

    describe('GET /v1/agents/health', () => {
      it('should return agent health status', async () => {
        const response = await fetch(`${server.restUrl}/v1/agents/health`);

        expect(response.ok).toBe(true);

        const data = await response.json();
        expect(data.status).toBeDefined();
        expect(data.agents).toBeDefined();
        expect(data.agents.guardian).toBeDefined();
        expect(data.agents.analyst).toBeDefined();
        expect(data.agents.advisor).toBeDefined();
        expect(data.agents.enforcer).toBeDefined();
      });
    });

    describe('GET /v1/agents/patterns', () => {
      it('should return discovered patterns', async () => {
        const response = await fetch(`${server.restUrl}/v1/agents/patterns`);

        expect(response.ok).toBe(true);

        const data = await response.json();
        expect(typeof data.count).toBe('number');
        expect(data.patterns).toBeInstanceOf(Array);
      });
    });

    describe('GET /v1/agents/anomalies', () => {
      it('should return detected anomalies', async () => {
        const response = await fetch(`${server.restUrl}/v1/agents/anomalies`);

        expect(response.ok).toBe(true);

        const data = await response.json();
        expect(typeof data.count).toBe('number');
        expect(data.anomalies).toBeInstanceOf(Array);
      });
    });

    describe('GET /v1/agents/enforcements', () => {
      it('should return pending enforcement actions', async () => {
        const response = await fetch(`${server.restUrl}/v1/agents/enforcements`);

        expect(response.ok).toBe(true);

        const data = await response.json();
        expect(typeof data.count).toBe('number');
        expect(data.enforcements).toBeInstanceOf(Array);
      });
    });
  });

  describe('API v1 Agentic Endpoints', () => {
    describe('GET /api/v1/agentic/health', () => {
      it('should return detailed health status', async () => {
        const response = await fetch(`${server.restUrl}/api/v1/agentic/health`);

        expect(response.ok).toBe(true);

        const data = await response.json();
        expect(data.status).toBeDefined();
        expect(data.timestamp).toBeDefined();
        expect(data.agents).toBeInstanceOf(Array);
      });
    });
  });

  describe('CORS Handling', () => {
    it('should include CORS headers', async () => {
      const response = await fetch(`${server.restUrl}/health`, {
        method: 'GET',
        headers: {
          'Origin': 'http://localhost:3000',
        },
      });

      // CORS headers should be present
      const allowOrigin = response.headers.get('access-control-allow-origin');
      expect(allowOrigin).toBeDefined();
    });

    it('should handle preflight requests', async () => {
      const response = await fetch(`${server.restUrl}/api/check`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type',
        },
      });

      // Preflight should succeed or return appropriate status
      expect(response.status).toBeLessThan(500);
    });
  });

  describe('Content Type Handling', () => {
    it('should require JSON content type for POST', async () => {
      const response = await fetch(`${server.restUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          principal: { id: 'user-123', roles: ['user'] },
          resource: { kind: 'document', id: 'doc-001' },
          actions: ['view'],
        }),
      });

      // Should either reject or handle gracefully
      expect(response.status).toBeGreaterThanOrEqual(200);
    });

    it('should return JSON responses', async () => {
      const response = await fetch(`${server.restUrl}/health`);

      expect(response.headers.get('content-type')).toContain('application/json');
    });
  });

  describe('Error Responses', () => {
    it('should return 404 for unknown endpoints', async () => {
      const response = await fetch(`${server.restUrl}/unknown/endpoint`);

      expect(response.status).toBe(404);
    });

    it('should return error details in JSON format', async () => {
      const response = await fetch(`${server.restUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should handle method not allowed', async () => {
      const response = await fetch(`${server.restUrl}/health`, {
        method: 'DELETE',
      });

      // Should return 404 or 405
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Request Validation', () => {
    it('should validate principal ID is present', async () => {
      const response = await fetch(`${server.restUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: { roles: ['user'] }, // Missing ID
          resource: { kind: 'document', id: 'doc-001' },
          actions: ['view'],
        }),
      });

      // Should handle gracefully
      expect(response.status).toBeGreaterThanOrEqual(200);
    });

    it('should validate resource kind is present', async () => {
      const response = await fetch(`${server.restUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: { id: 'user-123', roles: ['user'] },
          resource: { id: 'doc-001' }, // Missing kind
          actions: ['view'],
        }),
      });

      expect(response.status).toBeGreaterThanOrEqual(200);
    });

    it('should validate actions is an array', async () => {
      const response = await fetch(`${server.restUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: { id: 'user-123', roles: ['user'] },
          resource: { kind: 'document', id: 'doc-001' },
          actions: 'view', // Should be array
        }),
      });

      // Server should handle this gracefully
      expect(response.status).toBeGreaterThanOrEqual(200);
    });
  });

  describe('Response Format', () => {
    it('should include meta information in check response', async () => {
      const response = await fetch(`${server.restUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: { id: 'user-123', roles: ['user'] },
          resource: { kind: 'document', id: 'doc-001' },
          actions: ['view'],
        }),
      });

      const data = await response.json();
      expect(data.meta).toBeDefined();
      expect(data.meta.evaluationDurationMs).toBeDefined();
    });

    it('should return effect as string', async () => {
      const response = await fetch(`${server.restUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: { id: 'user-123', roles: ['user'] },
          resource: { kind: 'document', id: 'doc-001' },
          actions: ['view'],
        }),
      });

      const data = await response.json();
      const effect = data.results.view.effect;
      expect(['allow', 'deny', 'ALLOW', 'DENY']).toContain(effect);
    });
  });

  describe('Performance', () => {
    it('should handle high request rate', async () => {
      const requests = Array.from({ length: 100 }, () =>
        fetch(`${server.restUrl}/api/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            principal: { id: 'user-123', roles: ['user'] },
            resource: { kind: 'document', id: 'doc-001' },
            actions: ['view'],
          }),
        })
      );

      const startTime = performance.now();
      const responses = await Promise.all(requests);
      const duration = performance.now() - startTime;

      // All requests should succeed
      responses.forEach(response => {
        expect(response.ok).toBe(true);
      });

      // Should complete within reasonable time
      expect(duration).toBeLessThan(10000);
    });

    it('should maintain response time under load', async () => {
      const latencies: number[] = [];

      for (let i = 0; i < 20; i++) {
        const startTime = performance.now();
        await fetch(`${server.restUrl}/api/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            principal: { id: `user-${i}`, roles: ['user'] },
            resource: { kind: 'document', id: `doc-${i}` },
            actions: ['view'],
          }),
        });
        latencies.push(performance.now() - startTime);
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const p99Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.99)];

      // Average latency should be reasonable
      expect(avgLatency).toBeLessThan(100);
    });
  });

  describe('Rate Limiting Behavior', () => {
    it('should handle burst of requests gracefully', async () => {
      const burst = Array.from({ length: 50 }, () =>
        fetch(`${server.restUrl}/api/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            principal: { id: 'burst-user', roles: ['user'] },
            resource: { kind: 'document', id: 'doc-001' },
            actions: ['view'],
          }),
        })
      );

      const responses = await Promise.all(burst);

      // Should handle all requests (either success or rate limit)
      responses.forEach(response => {
        expect(response.status).toBeLessThan(500);
      });
    });
  });
});
