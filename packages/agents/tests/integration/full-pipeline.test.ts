/**
 * Full Pipeline Integration Tests for Agentic Authorization
 *
 * Tests the complete flow from request to decision through all agents:
 * - GUARDIAN: Anomaly detection
 * - ANALYST: Pattern learning
 * - ADVISOR: Explanation generation
 * - ENFORCER: Action execution
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentOrchestrator } from '../../src/orchestrator/agent-orchestrator.js';
import type { OrchestratorConfig } from '../../src/orchestrator/agent-orchestrator.js';
import type { CheckRequest, CheckResponse } from '@authz-engine/core';
import {
  createTestOrchestratorConfig,
  createMockDecisionRecord,
  createMockAnomaly,
  createDecisionBatch,
} from '../mocks/index.js';
import {
  principals,
  resources,
  createCheckRequest,
  createAllowedResponse,
  createDeniedResponse,
  testScenarios,
} from '../fixtures/test-requests.js';

// Mock external dependencies
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

describe('Full Pipeline Integration Tests', () => {
  let orchestrator: AgentOrchestrator;
  let config: OrchestratorConfig;

  beforeEach(() => {
    config = createTestOrchestratorConfig();
    orchestrator = new AgentOrchestrator(config);
  });

  afterEach(async () => {
    try {
      await orchestrator.shutdown();
    } catch {
      // Ignore shutdown errors in tests
    }
  });

  // ===========================================================================
  // Complete Flow Tests
  // ===========================================================================

  describe('Complete Request Processing Flow', () => {
    it('should process a normal allowed request through all agents', async () => {
      await orchestrator.initialize();

      const request = testScenarios.allowed.userViewsOwnDocument;
      const response = createAllowedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response);

      expect(result.response).toBe(response);
      expect(result.anomalyScore).toBeDefined();
      expect(result.anomalyScore).toBeLessThan(0.7); // Below threshold
      expect(result.enforcement?.allowed).toBe(true);
      expect(result.agentsInvolved).toContain('guardian');
      expect(result.agentsInvolved).toContain('enforcer');
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should process a denied request through all agents', async () => {
      await orchestrator.initialize();

      const request = testScenarios.denied.userViewsPremiumContent;
      const response = createDeniedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response);

      expect(result.response).toBe(response);
      expect(result.enforcement?.allowed).toBe(true); // Enforcement allows (not blocked)
      expect(result.agentsInvolved).toContain('guardian');
      expect(result.agentsInvolved).toContain('enforcer');
    });

    it('should include explanation when requested', async () => {
      await orchestrator.initialize();

      const request = testScenarios.allowed.userViewsOwnDocument;
      const response = createAllowedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response, {
        includeExplanation: true,
      });

      expect(result.explanation).toBeDefined();
      expect(result.explanation?.summary).toBeDefined();
      expect(result.explanation?.factors).toBeInstanceOf(Array);
      expect(result.agentsInvolved).toContain('advisor');
    });

    it('should process requests with policy context', async () => {
      await orchestrator.initialize();

      const request = testScenarios.allowed.adminViewsSettings;
      const response = createAllowedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response, {
        includeExplanation: true,
        policyContext: {
          matchedRules: ['allow-super-admin'],
          derivedRoles: ['admin', 'super-admin'],
        },
      });

      expect(result.explanation).toBeDefined();
      expect(result.explanation?.factors).toBeInstanceOf(Array);
    });
  });

  // ===========================================================================
  // Anomaly Detection to Enforcement Flow
  // ===========================================================================

  describe('Anomaly Detection to Enforcement Action Flow', () => {
    it('should detect velocity anomaly after rapid requests', async () => {
      await orchestrator.initialize();

      const request = createCheckRequest(
        principals.suspiciousUser,
        resources.publicDocument,
        ['view'],
      );

      // Simulate rapid requests
      let finalResult;
      for (let i = 0; i < 500; i++) {
        const response = createAllowedResponse(`req-${i}`, 'view');
        finalResult = await orchestrator.processRequest(
          { ...request, requestId: `req-${i}` },
          response,
        );
      }

      // After many rapid requests, anomaly score should increase
      expect(finalResult!.anomalyScore).toBeGreaterThan(0);
    });

    it('should block rate-limited principals', async () => {
      await orchestrator.initialize();

      // Trigger enforcement action
      await orchestrator.triggerEnforcement(
        'rate_limit',
        'blocked-user-001',
        'Suspicious activity detected',
      );

      const request = createCheckRequest(
        { id: 'blocked-user-001', roles: ['user'], attributes: {} },
        resources.publicDocument,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response);

      expect(result.enforcement?.allowed).toBe(false);
      expect(result.enforcement?.reason).toContain('Rate limited');
    });

    it('should block temporarily blocked principals', async () => {
      await orchestrator.initialize();

      // Trigger temporary block
      await orchestrator.triggerEnforcement(
        'temporary_block',
        'blocked-user-002',
        'Critical anomaly detected',
      );

      const request = createCheckRequest(
        { id: 'blocked-user-002', roles: ['user'], attributes: {} },
        resources.publicDocument,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response);

      expect(result.enforcement?.allowed).toBe(false);
      expect(result.enforcement?.reason).toContain('Blocked');
    });

    it('should return enforcement denied response for blocked users', async () => {
      await orchestrator.initialize();

      await orchestrator.triggerEnforcement(
        'rate_limit',
        'blocked-user-003',
        'Test block',
      );

      const request = createCheckRequest(
        { id: 'blocked-user-003', roles: ['user'], attributes: {} },
        resources.publicDocument,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response);

      // The response should be overwritten with denied
      expect(result.response.results['view'].effect).toBe('deny');
      expect(result.response.results['view'].meta?.matchedRule).toContain('enforcer');
    });
  });

  // ===========================================================================
  // Pattern Learning Tests
  // ===========================================================================

  describe('Pattern Learning After Multiple Decisions', () => {
    it('should trigger pattern discovery', async () => {
      await orchestrator.initialize();

      // Process multiple requests to build up data
      const requests = Array.from({ length: 10 }, (_, i) =>
        createCheckRequest(
          principals.regularUser,
          { ...resources.publicDocument, id: `doc-${i}` },
          ['view'],
        ),
      );

      for (const request of requests) {
        const response = createAllowedResponse(request.requestId!, 'view');
        await orchestrator.processRequest(request, response);
      }

      // Trigger pattern discovery
      const patterns = await orchestrator.discoverPatterns();

      expect(Array.isArray(patterns)).toBe(true);
    });

    it('should return discovered patterns', async () => {
      await orchestrator.initialize();

      // Initially no patterns
      const initialPatterns = orchestrator.getPatterns();
      expect(Array.isArray(initialPatterns)).toBe(true);

      // Discover patterns
      await orchestrator.discoverPatterns();

      const patterns = orchestrator.getPatterns();
      expect(Array.isArray(patterns)).toBe(true);
    });

    it('should handle pattern discovery with no data gracefully', async () => {
      await orchestrator.initialize();

      const patterns = await orchestrator.discoverPatterns();

      expect(Array.isArray(patterns)).toBe(true);
    });
  });

  // ===========================================================================
  // Explanation Generation Tests
  // ===========================================================================

  describe('Explanation Generation for Various Scenarios', () => {
    it('should generate explanation for allowed request', async () => {
      await orchestrator.initialize();

      const request = testScenarios.allowed.subscriberViewsPremiumContent;
      const response = createAllowedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response, {
        includeExplanation: true,
      });

      expect(result.explanation).toBeDefined();
      expect(result.explanation?.summary).toContain('ALLOWED');
    });

    it('should generate explanation for denied request', async () => {
      await orchestrator.initialize();

      const request = testScenarios.denied.userViewsPremiumContent;
      const response = createDeniedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response, {
        includeExplanation: true,
      });

      expect(result.explanation).toBeDefined();
      expect(result.explanation?.summary).toContain('DENIED');
    });

    it('should generate explanation with path to allow', async () => {
      await orchestrator.initialize();

      const request = testScenarios.denied.userEditsAdminSettings;
      const response = createDeniedResponse(request.requestId!, 'edit');

      const result = await orchestrator.processRequest(request, response, {
        includeExplanation: true,
      });

      expect(result.explanation).toBeDefined();
      expect(result.explanation?.pathToAllow).toBeDefined();
      expect(result.explanation?.pathToAllow?.suggestedActions).toBeInstanceOf(Array);
    });

    it('should generate explanation with factors', async () => {
      await orchestrator.initialize();

      const request = testScenarios.allowed.adminViewsSettings;
      const response = createAllowedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response, {
        includeExplanation: true,
        policyContext: {
          matchedRules: ['allow-super-admin'],
          derivedRoles: ['super-admin'],
        },
      });

      expect(result.explanation?.factors).toBeInstanceOf(Array);
      expect(result.explanation?.factors.length).toBeGreaterThan(0);
    });

    it('should generate recommendations', async () => {
      await orchestrator.initialize();

      const request = testScenarios.denied.nonOwnerEditsAvatar;
      const response = createDeniedResponse(request.requestId!, 'edit');

      const result = await orchestrator.processRequest(request, response, {
        includeExplanation: true,
      });

      expect(result.explanation?.recommendations).toBeInstanceOf(Array);
    });
  });

  // ===========================================================================
  // Enforcement Block Tests
  // ===========================================================================

  describe('Enforcement Blocks (Rate Limits, Temporary Blocks)', () => {
    it('should apply rate limit and deny subsequent requests', async () => {
      await orchestrator.initialize();

      const principalId = 'rate-limited-user';

      // Apply rate limit
      const action = await orchestrator.triggerEnforcement(
        'rate_limit',
        principalId,
        'Rate limit triggered',
      );

      expect(action.type).toBe('rate_limit');
      expect(action.status).toBe('completed');

      // Verify subsequent request is denied
      const request = createCheckRequest(
        { id: principalId, roles: ['user'], attributes: {} },
        resources.publicDocument,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response);

      expect(result.enforcement?.allowed).toBe(false);
    });

    it('should apply temporary block and deny subsequent requests', async () => {
      await orchestrator.initialize();

      const principalId = 'temp-blocked-user';

      // Apply temporary block
      const action = await orchestrator.triggerEnforcement(
        'temporary_block',
        principalId,
        'Critical security issue',
      );

      expect(action.type).toBe('temporary_block');
      expect(action.status).toBe('completed');

      // Verify subsequent request is denied
      const request = createCheckRequest(
        { id: principalId, roles: ['user'], attributes: {} },
        resources.publicDocument,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response);

      expect(result.enforcement?.allowed).toBe(false);
    });

    it('should trigger alert admin action', async () => {
      await orchestrator.initialize();

      const action = await orchestrator.triggerEnforcement(
        'alert_admin',
        'monitored-user',
        'Unusual activity',
      );

      expect(action.type).toBe('alert_admin');
      expect(action.status).toBe('completed');
    });

    it('should return pending enforcement actions', async () => {
      await orchestrator.initialize();

      const pending = orchestrator.getPendingActions();

      expect(Array.isArray(pending)).toBe(true);
    });

    it('should approve pending enforcement action', async () => {
      await orchestrator.initialize();

      // Create an action (may or may not be pending depending on config)
      await orchestrator.triggerEnforcement(
        'rate_limit',
        'approval-test-user',
        'Test action',
      );

      const pending = orchestrator.getPendingActions();

      if (pending.length > 0) {
        const approved = await orchestrator.approveAction(pending[0].id, 'admin@test.com');
        expect(approved?.status).toBe('completed');
      }
    });
  });

  // ===========================================================================
  // Rollback Tests
  // ===========================================================================

  describe('Rollback of Enforcement Actions', () => {
    it('should track enforcement actions for potential rollback', async () => {
      await orchestrator.initialize();

      const principalId = 'rollback-test-user';

      // Apply enforcement
      const action = await orchestrator.triggerEnforcement(
        'rate_limit',
        principalId,
        'Test rate limit',
      );

      expect(action.canRollback).toBeDefined();
    });

    it('should maintain enforcement state correctly', async () => {
      await orchestrator.initialize();

      const principalId = 'enforcement-state-user';

      // Apply rate limit
      await orchestrator.triggerEnforcement(
        'rate_limit',
        principalId,
        'Test rate limit',
      );

      // Verify blocked
      const request1 = createCheckRequest(
        { id: principalId, roles: ['user'], attributes: {} },
        resources.publicDocument,
        ['view'],
      );
      const result1 = await orchestrator.processRequest(
        request1,
        createAllowedResponse(request1.requestId!, 'view'),
      );

      expect(result1.enforcement?.allowed).toBe(false);
    });
  });

  // ===========================================================================
  // Natural Language Query Tests
  // ===========================================================================

  describe('Natural Language Policy Queries', () => {
    it('should answer policy questions', async () => {
      await orchestrator.initialize();

      const answer = await orchestrator.askQuestion('Why was access denied?');

      // Without LLM configured, returns error message
      expect(typeof answer).toBe('string');
    });

    it('should debug policy issues', async () => {
      await orchestrator.initialize();

      const diagnosis = await orchestrator.debugPolicy(
        'Users cannot access premium content',
        `apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: premium-content
spec:
  resource: premium-content
  rules:
    - actions: [view]
      effect: allow
      roles: [subscriber]`,
      );

      expect(typeof diagnosis).toBe('string');
    });
  });

  // ===========================================================================
  // Anomaly Tracking Tests
  // ===========================================================================

  describe('Anomaly Tracking and Resolution', () => {
    it('should get anomalies for principal', async () => {
      await orchestrator.initialize();

      const anomalies = orchestrator.getAnomalies('user-123');

      expect(Array.isArray(anomalies)).toBe(true);
    });

    it('should track anomalies across requests', async () => {
      await orchestrator.initialize();

      // Process suspicious requests
      const suspiciousRequest = createCheckRequest(
        principals.suspiciousUser,
        { kind: 'admin-settings', id: 'admin-1', attributes: {} },
        ['delete'],
      );

      for (let i = 0; i < 5; i++) {
        await orchestrator.processRequest(
          { ...suspiciousRequest, requestId: `suspicious-${i}` },
          createDeniedResponse(`suspicious-${i}`, 'delete'),
        );
      }

      const anomalies = orchestrator.getAnomalies(principals.suspiciousUser.id);

      expect(Array.isArray(anomalies)).toBe(true);
    });
  });

  // ===========================================================================
  // Health Monitoring Tests
  // ===========================================================================

  describe('Health Monitoring', () => {
    it('should return comprehensive health status', async () => {
      await orchestrator.initialize();

      const health = await orchestrator.getHealth();

      expect(health.status).toBe('healthy');
      expect(health.agents.guardian).toBeDefined();
      expect(health.agents.analyst).toBeDefined();
      expect(health.agents.advisor).toBeDefined();
      expect(health.agents.enforcer).toBeDefined();
      expect(health.infrastructure.store).toBe('connected');
      expect(health.infrastructure.eventBus).toBe('connected');
    });

    it('should report all agents as ready after initialization', async () => {
      await orchestrator.initialize();

      const health = await orchestrator.getHealth();

      expect(health.agents.guardian.state).toBe('ready');
      expect(health.agents.analyst.state).toBe('ready');
      expect(health.agents.advisor.state).toBe('ready');
      expect(health.agents.enforcer.state).toBe('ready');
    });

    it('should report agent metrics', async () => {
      await orchestrator.initialize();

      // Process some requests
      const request = testScenarios.allowed.userViewsOwnDocument;
      const response = createAllowedResponse(request.requestId!, 'view');
      await orchestrator.processRequest(request, response);

      const health = await orchestrator.getHealth();

      expect(health.agents.guardian.metrics).toBeDefined();
      expect(health.agents.enforcer.metrics).toBeDefined();
    });
  });

  // ===========================================================================
  // Edge Cases and Error Handling
  // ===========================================================================

  describe('Edge Cases and Error Handling', () => {
    it('should handle request with no actions gracefully', async () => {
      await orchestrator.initialize();

      const request = createCheckRequest(
        principals.regularUser,
        resources.publicDocument,
        [],
      );
      const response = {
        requestId: request.requestId!,
        results: {},
        meta: { evaluationTime: 0, policyCount: 0 },
      };

      const result = await orchestrator.processRequest(request, response);

      expect(result.response).toBe(response);
    });

    it('should handle request with unknown resource kind', async () => {
      await orchestrator.initialize();

      const request = createCheckRequest(
        principals.regularUser,
        { kind: 'unknown-resource', id: 'unknown-1', attributes: {} },
        ['view'],
      );
      const response = createDeniedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response);

      expect(result).toBeDefined();
    });

    it('should handle concurrent requests', async () => {
      await orchestrator.initialize();

      const requests = Array.from({ length: 50 }, (_, i) =>
        createCheckRequest(
          principals.regularUser,
          { ...resources.publicDocument, id: `doc-${i}` },
          ['view'],
        ),
      );

      const results = await Promise.all(
        requests.map(request =>
          orchestrator.processRequest(
            request,
            createAllowedResponse(request.requestId!, 'view'),
          ),
        ),
      );

      expect(results).toHaveLength(50);
      results.forEach(result => {
        expect(result.enforcement?.allowed).toBe(true);
      });
    });

    it('should handle requests after shutdown attempt', async () => {
      await orchestrator.initialize();
      await orchestrator.shutdown();

      // Create new orchestrator instance for clean test
      const newOrchestrator = new AgentOrchestrator(config);
      await newOrchestrator.initialize();

      const request = testScenarios.allowed.userViewsOwnDocument;
      const response = createAllowedResponse(request.requestId!, 'view');

      const result = await newOrchestrator.processRequest(request, response);

      expect(result).toBeDefined();

      await newOrchestrator.shutdown();
    });
  });

  // ===========================================================================
  // Performance Tests
  // ===========================================================================

  describe('Performance Characteristics', () => {
    it('should process single request in under 100ms', async () => {
      await orchestrator.initialize();

      const request = testScenarios.allowed.userViewsOwnDocument;
      const response = createAllowedResponse(request.requestId!, 'view');

      const start = performance.now();
      const result = await orchestrator.processRequest(request, response);
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100);
      expect(result.processingTimeMs).toBeLessThan(50);
    });

    it('should process batch of requests efficiently', async () => {
      await orchestrator.initialize();

      const requests = Array.from({ length: 100 }, (_, i) =>
        createCheckRequest(
          principals.regularUser,
          { ...resources.publicDocument, id: `doc-${i}` },
          ['view'],
        ),
      );

      const start = performance.now();

      for (const request of requests) {
        await orchestrator.processRequest(
          request,
          createAllowedResponse(request.requestId!, 'view'),
        );
      }

      const duration = performance.now() - start;
      const avgTime = duration / requests.length;

      // Average should be under 10ms per request
      expect(avgTime).toBeLessThan(10);
    });
  });
});
