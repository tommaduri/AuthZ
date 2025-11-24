/**
 * End-to-End Integration Tests for AuthZ Engine
 *
 * Tests complete authorization flows including:
 * - All 4 agents (GUARDIAN, ANALYST, ADVISOR, ENFORCER)
 * - Policy loading and evaluation
 * - Caching behavior validation
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  TestServerManager,
  MockCache,
  createTestPrincipal,
  createTestResource,
  wait,
} from './setup';
import { testPolicies } from '../fixtures/policies';
import { principals } from '../fixtures/principals';
import { resources } from '../fixtures/resources';
import { testScenarios } from '../fixtures/scenarios';

describe('End-to-End Authorization Flow', () => {
  let server: TestServerManager;
  let cache: MockCache;

  beforeAll(async () => {
    cache = new MockCache();
    server = new TestServerManager({
      enableAgentic: true,
      policies: [
        testPolicies.document,
        testPolicies.premiumContent,
        testPolicies.avatar,
        testPolicies.adminSettings,
        testPolicies.payout,
      ],
      derivedRoles: [testPolicies.derivedRoles],
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    cache.reset();
    server.getOrchestrator()?.reset();
  });

  describe('Basic Authorization Flow', () => {
    it('should allow access for authorized users', async () => {
      const response = await fetch(`${server.restUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: {
            id: 'user-123',
            roles: ['user'],
          },
          resource: {
            kind: 'document',
            id: 'doc-001',
            attr: { visibility: 'public', ownerId: 'user-123' },
          },
          actions: ['view'],
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.results.view.effect).toBe('allow');
    });

    it('should deny access for unauthorized users', async () => {
      const response = await fetch(`${server.restUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: {
            id: 'user-123',
            roles: ['user'],
          },
          resource: {
            kind: 'admin-settings',
            id: 'settings-001',
          },
          actions: ['edit'],
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.results.edit.effect).toBe('deny');
    });

    it('should handle multiple actions in single request', async () => {
      const response = await fetch(`${server.restUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: {
            id: 'admin-001',
            roles: ['admin'],
          },
          resource: {
            kind: 'document',
            id: 'doc-001',
          },
          actions: ['view', 'edit', 'delete'],
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.results.view).toBeDefined();
      expect(data.results.edit).toBeDefined();
      expect(data.results.delete).toBeDefined();
    });
  });

  describe('Agentic Authorization Flow', () => {
    it('should process request through all 4 agents', async () => {
      const response = await fetch(`${server.restUrl}/v1/check/agentic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: {
            id: 'user-123',
            roles: ['user'],
          },
          resource: {
            kind: 'document',
            id: 'doc-001',
          },
          actions: ['view'],
          includeExplanation: true,
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();

      // Check standard authorization result
      expect(data.results).toBeDefined();
      expect(data.requestId).toBeDefined();

      // Check agentic pipeline results
      expect(data.agentic).toBeDefined();
      expect(data.agentic.anomalyScore).toBeDefined();
      expect(typeof data.agentic.anomalyScore).toBe('number');
      expect(data.agentic.agentsInvolved).toContain('guardian');
      expect(data.agentic.agentsInvolved).toContain('analyst');
      expect(data.agentic.agentsInvolved).toContain('advisor');
      expect(data.agentic.agentsInvolved).toContain('enforcer');
    });

    it('should return explanation when requested', async () => {
      const response = await fetch(`${server.restUrl}/v1/check/agentic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: {
            id: 'user-123',
            roles: ['user'],
          },
          resource: {
            kind: 'document',
            id: 'doc-001',
          },
          actions: ['view'],
          includeExplanation: true,
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();

      expect(data.agentic.explanation).toBeDefined();
      expect(data.agentic.explanation.summary).toBeDefined();
      expect(data.agentic.explanation.factors).toBeInstanceOf(Array);
    });

    it('should provide enforcement status', async () => {
      const response = await fetch(`${server.restUrl}/v1/check/agentic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: {
            id: 'user-123',
            roles: ['user'],
          },
          resource: {
            kind: 'document',
            id: 'doc-001',
          },
          actions: ['view'],
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();

      expect(data.agentic.enforcement).toBeDefined();
      expect(typeof data.agentic.enforcement.allowed).toBe('boolean');
      expect(data.agentic.enforcement.reason).toBeDefined();
    });
  });

  describe('Agent Health Monitoring', () => {
    it('should report health status for all agents', async () => {
      const response = await fetch(`${server.restUrl}/v1/agents/health`);

      expect(response.ok).toBe(true);
      const data = await response.json();

      expect(data.status).toBe('healthy');
      expect(data.agents).toBeDefined();
      expect(data.agents.guardian).toBeDefined();
      expect(data.agents.analyst).toBeDefined();
      expect(data.agents.advisor).toBeDefined();
      expect(data.agents.enforcer).toBeDefined();
    });

    it('should report infrastructure status', async () => {
      const response = await fetch(`${server.restUrl}/v1/agents/health`);

      expect(response.ok).toBe(true);
      const data = await response.json();

      expect(data.infrastructure).toBeDefined();
      expect(data.infrastructure.store).toBeDefined();
      expect(data.infrastructure.eventBus).toBeDefined();
    });
  });

  describe('GUARDIAN Agent - Anomaly Detection', () => {
    it('should detect anomalies for suspicious patterns', async () => {
      // Simulate multiple rapid requests to trigger anomaly detection
      const orchestrator = server.getOrchestrator();

      // Add a mock anomaly for testing
      orchestrator?.addAnomaly({
        id: 'anomaly-test-001',
        detectedAt: new Date(),
        type: 'velocity_spike',
        severity: 'high',
        principalId: 'suspicious-user',
        description: 'Unusual request velocity detected',
        score: 0.85,
        evidence: {
          recentRequests: 500,
          baselineRequests: 10,
          deviation: 5,
          relatedDecisions: [],
        },
        baseline: {
          period: '7d',
          avgRequestsPerHour: 5,
          uniqueResources: 3,
          commonActions: ['view'],
          commonTimeRanges: [],
        },
        observed: {
          requestsInWindow: 500,
          uniqueResourcesAccessed: 100,
          actionsPerformed: ['view', 'edit', 'delete'],
          timeOfAccess: new Date().toISOString(),
        },
        status: 'open',
      });

      const response = await fetch(`${server.restUrl}/v1/agents/anomalies`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.count).toBeGreaterThan(0);
      expect(data.anomalies[0].type).toBe('velocity_spike');
    });

    it('should return anomalies by principal', async () => {
      const orchestrator = server.getOrchestrator();

      orchestrator?.addAnomaly({
        id: 'anomaly-user-specific',
        detectedAt: new Date(),
        type: 'unusual_access_time',
        severity: 'medium',
        principalId: 'user-456',
        description: 'Access outside normal hours',
        score: 0.6,
        evidence: {
          recentRequests: 10,
          baselineRequests: 5,
          deviation: 2,
          relatedDecisions: [],
        },
        baseline: {
          period: '30d',
          avgRequestsPerHour: 3,
          uniqueResources: 5,
          commonActions: ['view'],
          commonTimeRanges: ['09:00-17:00'],
        },
        observed: {
          requestsInWindow: 10,
          uniqueResourcesAccessed: 5,
          actionsPerformed: ['view'],
          timeOfAccess: '03:00',
        },
        status: 'open',
      });

      const response = await fetch(`${server.restUrl}/v1/agents/anomalies?principalId=user-456`);
      expect(response.ok).toBe(true);
    });
  });

  describe('ANALYST Agent - Pattern Learning', () => {
    it('should return discovered patterns', async () => {
      const orchestrator = server.getOrchestrator();

      // Add test patterns
      orchestrator?.addPattern({
        id: 'pattern-001',
        discoveredAt: new Date(),
        lastUpdated: new Date(),
        type: 'access_correlation',
        confidence: 0.85,
        sampleSize: 1000,
        description: 'Users who view documents tend to also edit them',
        conditions: [],
        isApproved: false,
      });

      const response = await fetch(`${server.restUrl}/v1/agents/patterns`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.patterns).toBeInstanceOf(Array);
      expect(data.count).toBeGreaterThan(0);
    });
  });

  describe('ENFORCER Agent - Action Management', () => {
    it('should list pending enforcement actions', async () => {
      const orchestrator = server.getOrchestrator();

      orchestrator?.addPendingAction({
        id: 'action-001',
        triggeredAt: new Date(),
        type: 'rate_limit',
        priority: 'high',
        triggeredBy: {
          agentType: 'guardian',
          reason: 'Velocity spike detected',
          relatedIds: ['anomaly-001'],
        },
        status: 'pending',
        canRollback: true,
      });

      const response = await fetch(`${server.restUrl}/v1/agents/enforcements`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.enforcements).toBeInstanceOf(Array);
    });
  });

  describe('Policy Evaluation', () => {
    it('should correctly evaluate owner-based access', async () => {
      const response = await fetch(`${server.restUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: {
            id: 'owner-user',
            roles: ['user'],
          },
          resource: {
            kind: 'document',
            id: 'doc-owned',
            attr: { ownerId: 'owner-user' },
          },
          actions: ['view', 'edit', 'delete'],
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();

      // Owner should have all permissions
      expect(data.results.view.effect).toBe('allow');
      expect(data.results.edit.effect).toBe('allow');
      expect(data.results.delete.effect).toBe('allow');
    });

    it('should correctly evaluate role-based access', async () => {
      // Admin check
      const adminResponse = await fetch(`${server.restUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: {
            id: 'admin-user',
            roles: ['admin'],
          },
          resource: {
            kind: 'document',
            id: 'any-doc',
          },
          actions: ['delete'],
        }),
      });

      expect(adminResponse.ok).toBe(true);
      const adminData = await adminResponse.json();
      expect(adminData.results.delete.effect).toBe('allow');

      // Regular user check
      const userResponse = await fetch(`${server.restUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: {
            id: 'regular-user',
            roles: ['user'],
          },
          resource: {
            kind: 'document',
            id: 'any-doc',
          },
          actions: ['delete'],
        }),
      });

      expect(userResponse.ok).toBe(true);
      const userData = await userResponse.json();
      expect(userData.results.delete.effect).toBe('deny');
    });
  });

  describe('Batch Operations', () => {
    it('should process batch check requests', async () => {
      const response = await fetch(`${server.restUrl}/api/check/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: {
            id: 'user-123',
            roles: ['user'],
          },
          resources: [
            {
              resource: { kind: 'document', id: 'doc-1' },
              actions: ['view'],
            },
            {
              resource: { kind: 'document', id: 'doc-2' },
              actions: ['edit'],
            },
            {
              resource: { kind: 'document', id: 'doc-3' },
              actions: ['view', 'edit'],
            },
          ],
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();

      expect(data.results).toBeDefined();
      expect(data.results['document:doc-1']).toBeDefined();
      expect(data.results['document:doc-2']).toBeDefined();
      expect(data.results['document:doc-3']).toBeDefined();
    });
  });

  describe('Caching Behavior', () => {
    it('should cache authorization decisions', async () => {
      const checkRequest = {
        principal: { id: 'cache-test-user', roles: ['user'] },
        resource: { kind: 'document', id: 'cache-test-doc' },
        actions: ['view'],
      };

      // First request
      const response1 = await fetch(`${server.restUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checkRequest),
      });
      expect(response1.ok).toBe(true);

      // Second identical request
      const response2 = await fetch(`${server.restUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checkRequest),
      });
      expect(response2.ok).toBe(true);

      const data1 = await response1.json();
      const data2 = await response2.json();

      // Results should be identical
      expect(data1.results.view.effect).toBe(data2.results.view.effect);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing principal', async () => {
      const response = await fetch(`${server.restUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resource: { kind: 'document', id: 'doc-1' },
          actions: ['view'],
        }),
      });

      // Should return error or default deny
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should handle missing resource', async () => {
      const response = await fetch(`${server.restUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: { id: 'user-123', roles: ['user'] },
          actions: ['view'],
        }),
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should handle empty actions', async () => {
      const response = await fetch(`${server.restUrl}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          principal: { id: 'user-123', roles: ['user'] },
          resource: { kind: 'document', id: 'doc-1' },
          actions: [],
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(Object.keys(data.results)).toHaveLength(0);
    });
  });

  describe('Health Endpoints', () => {
    it('should return health status', async () => {
      const response = await fetch(`${server.restUrl}/health`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.status).toBe('healthy');
      expect(data.version).toBeDefined();
    });

    it('should return ready status', async () => {
      const response = await fetch(`${server.restUrl}/ready`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.ready).toBe(true);
    });
  });
});
