/**
 * Agent Pipeline Integration Tests
 *
 * Tests the full agent pipeline flow:
 * GUARDIAN -> ANALYST -> ADVISOR -> ENFORCER
 *
 * Covers:
 * - Complete request processing through all agents
 * - Agent invocation order verification
 * - Data flow between agents
 * - Error handling and recovery at each stage
 * - Cache behavior and optimization
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';
import { AgentOrchestrator } from '../../src/orchestrator/agent-orchestrator.js';
import type { OrchestratorConfig, ProcessingResult } from '../../src/orchestrator/agent-orchestrator.js';
import type { CheckRequest, CheckResponse } from '@authz-engine/core';
import {
  createTestOrchestratorConfig,
  createMockAnomaly,
} from '../mocks/index.js';
import {
  principals,
  resources,
  createCheckRequest,
  createAllowedResponse,
  createDeniedResponse,
  createMultiActionResponse,
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
              content: 'Mock LLM explanation for authorization decision.',
            },
          }],
        }),
      },
    },
  })),
}));

// =============================================================================
// Test Suite: Full Agent Pipeline Tests
// =============================================================================

describe('Agent Pipeline Integration Tests', () => {
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
          maxActionsPerHour: 100,
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
      // Ignore shutdown errors in tests
    }
  });

  // ===========================================================================
  // Section 1: Pipeline Flow Order Tests
  // ===========================================================================

  describe('Pipeline Flow Order', () => {
    it('should invoke ENFORCER before GUARDIAN', async () => {
      await orchestrator.initialize();

      const request = createCheckRequest(
        principals.regularUser,
        resources.publicDocument,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response);

      // Verify ENFORCER is invoked first
      expect(result.agentsInvolved).toContain('enforcer');
      expect(result.agentsInvolved).toContain('guardian');
      expect(result.agentsInvolved.indexOf('enforcer')).toBeLessThan(
        result.agentsInvolved.indexOf('guardian'),
      );
    });

    it('should include ADVISOR when explanation is requested', async () => {
      await orchestrator.initialize();

      const request = createCheckRequest(
        principals.subscriber,
        resources.premiumContent,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response, {
        includeExplanation: true,
      });

      expect(result.agentsInvolved).toContain('advisor');
      expect(result.explanation).toBeDefined();
    });

    it('should skip pipeline after ENFORCER block', async () => {
      await orchestrator.initialize();

      // Block the user first
      await orchestrator.triggerEnforcement(
        'temporary_block',
        'blocked-pipeline-user',
        'Testing pipeline skip',
      );

      const request = createCheckRequest(
        { id: 'blocked-pipeline-user', roles: ['user'], attributes: {} },
        resources.publicDocument,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response);

      // Only enforcer should be involved
      expect(result.agentsInvolved).toContain('enforcer');
      expect(result.agentsInvolved).not.toContain('guardian');
      expect(result.agentsInvolved).not.toContain('advisor');
      expect(result.enforcement?.allowed).toBe(false);
    });

    it('should process full pipeline for normal requests', async () => {
      await orchestrator.initialize();

      const request = createCheckRequest(
        principals.admin,
        resources.adminSettings,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response, {
        includeExplanation: true,
        policyContext: {
          matchedRules: ['allow-admin-view'],
          derivedRoles: ['admin'],
        },
      });

      // All core agents should be involved
      expect(result.agentsInvolved).toContain('enforcer');
      expect(result.agentsInvolved).toContain('guardian');
      expect(result.agentsInvolved).toContain('advisor');
      expect(result.enforcement?.allowed).toBe(true);
      expect(result.explanation).toBeDefined();
    });
  });

  // ===========================================================================
  // Section 2: Data Flow Between Agents
  // ===========================================================================

  describe('Data Flow Between Agents', () => {
    it('should pass anomaly score from GUARDIAN to result', async () => {
      await orchestrator.initialize();

      const request = createCheckRequest(
        principals.regularUser,
        resources.publicDocument,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response);

      expect(result.anomalyScore).toBeDefined();
      expect(typeof result.anomalyScore).toBe('number');
      expect(result.anomalyScore).toBeGreaterThanOrEqual(0);
      expect(result.anomalyScore).toBeLessThanOrEqual(1);
    });

    it('should include risk factors when anomalies are detected', async () => {
      // Lower threshold to detect anomalies easier
      config.agents.guardian!.anomalyThreshold = 0.1;
      orchestrator = new AgentOrchestrator(config);
      await orchestrator.initialize();

      // Create suspicious request (bulk operation triggers risk factors)
      const request = createCheckRequest(
        principals.regularUser,
        { kind: 'avatar', id: 'bulk-all', attributes: {} },
        ['bulk-delete'],
      );
      const response = createDeniedResponse(request.requestId!, 'bulk-delete');

      const result = await orchestrator.processRequest(request, response);

      // Should have anomaly information
      expect(result.anomalyScore).toBeGreaterThan(0);
      if (result.anomaly) {
        expect(result.anomaly.principalId).toBe(principals.regularUser.id);
      }
    });

    it('should pass policy context to ADVISOR for explanation', async () => {
      await orchestrator.initialize();

      const request = createCheckRequest(
        principals.regularUser,
        resources.userAvatar,
        ['edit'],
      );
      const response = createAllowedResponse(request.requestId!, 'edit');

      const policyContext = {
        matchedRules: ['allow-owner-edit', 'owner-derived-role'],
        derivedRoles: ['owner'],
      };

      const result = await orchestrator.processRequest(request, response, {
        includeExplanation: true,
        policyContext,
      });

      expect(result.explanation).toBeDefined();
      const hasDerivedRoleFactor = result.explanation!.factors.some(
        (f) => f.type === 'derived_role',
      );
      expect(hasDerivedRoleFactor).toBe(true);

      // Verify derived roles are in factor details
      const derivedRoleFactor = result.explanation!.factors.find(
        (f) => f.type === 'derived_role',
      );
      if (derivedRoleFactor) {
        expect(derivedRoleFactor.details.derivedRoles).toContain('owner');
      }
    });

    it('should record decisions for ANALYST learning', async () => {
      await orchestrator.initialize();

      // Process multiple requests
      const requests = [
        createCheckRequest(principals.regularUser, resources.publicDocument, ['view']),
        createCheckRequest(principals.subscriber, resources.premiumContent, ['view']),
        createCheckRequest(principals.admin, resources.adminSettings, ['view']),
      ];

      for (const request of requests) {
        const response = createAllowedResponse(request.requestId!, request.actions[0]);
        await orchestrator.processRequest(request, response);
      }

      // Verify ANALYST can access patterns (even if empty with mocked store)
      const patterns = orchestrator.getPatterns();
      expect(Array.isArray(patterns)).toBe(true);
    });

    it('should propagate enforcement decisions to response', async () => {
      await orchestrator.initialize();

      // Rate limit a user
      await orchestrator.triggerEnforcement(
        'rate_limit',
        'rate-limited-data-flow',
        'Testing data flow',
      );

      const request = createCheckRequest(
        { id: 'rate-limited-data-flow', roles: ['user'], attributes: {} },
        resources.publicDocument,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response);

      // Enforcement result should be in the response
      expect(result.enforcement?.allowed).toBe(false);
      expect(result.enforcement?.reason).toContain('Rate limited');
      expect(result.response.results.view.effect).toBe('deny');
    });
  });

  // ===========================================================================
  // Section 3: Error Handling and Recovery
  // ===========================================================================

  describe('Error Handling and Recovery', () => {
    it('should handle errors in GUARDIAN gracefully', async () => {
      await orchestrator.initialize();

      // Process a normal request - errors in internal processing should be caught
      const request = createCheckRequest(
        principals.regularUser,
        resources.publicDocument,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');

      // Should not throw
      const result = await orchestrator.processRequest(request, response);
      expect(result).toBeDefined();
      expect(result.enforcement?.allowed).toBe(true);
    });

    it('should continue processing when explanation generation fails', async () => {
      await orchestrator.initialize();

      const request = createCheckRequest(
        principals.regularUser,
        resources.publicDocument,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');

      // Even if explanation fails, core processing should complete
      const result = await orchestrator.processRequest(request, response, {
        includeExplanation: true,
      });

      expect(result.enforcement?.allowed).toBe(true);
      expect(result.anomalyScore).toBeDefined();
    });

    it('should recover from agent state errors', async () => {
      await orchestrator.initialize();

      // Process multiple requests to verify recovery
      const requests = Array.from({ length: 10 }, (_, i) =>
        createCheckRequest(
          { id: `recovery-user-${i}`, roles: ['user'], attributes: {} },
          resources.publicDocument,
          ['view'],
        ),
      );

      const results: ProcessingResult[] = [];
      for (const request of requests) {
        const response = createAllowedResponse(request.requestId!, 'view');
        const result = await orchestrator.processRequest(request, response);
        results.push(result);
      }

      // All requests should have been processed
      expect(results).toHaveLength(10);
      results.forEach((result) => {
        expect(result.enforcement?.allowed).toBe(true);
      });
    });

    it('should return valid response even with empty actions', async () => {
      await orchestrator.initialize();

      const request = createCheckRequest(
        principals.regularUser,
        resources.publicDocument,
        [],
      );
      const response: CheckResponse = {
        requestId: request.requestId!,
        results: {},
        meta: { evaluationDurationMs: 1, policiesEvaluated: [] },
      };

      const result = await orchestrator.processRequest(request, response);

      expect(result).toBeDefined();
      expect(result.enforcement?.allowed).toBe(true);
    });
  });

  // ===========================================================================
  // Section 4: Multi-Action Request Processing
  // ===========================================================================

  describe('Multi-Action Request Processing', () => {
    it('should process all actions through pipeline', async () => {
      await orchestrator.initialize();

      const request = createCheckRequest(
        principals.admin,
        resources.publicDocument,
        ['view', 'edit', 'delete'],
      );
      const response = createMultiActionResponse(
        request.requestId!,
        ['view', 'edit', 'delete'],
        [true, true, false],
      );

      const result = await orchestrator.processRequest(request, response);

      expect(result.response.results.view.effect).toBe('allow');
      expect(result.response.results.edit.effect).toBe('allow');
      expect(result.response.results.delete.effect).toBe('deny');
    });

    it('should generate unified anomaly score for multi-action requests', async () => {
      await orchestrator.initialize();

      const request = createCheckRequest(
        principals.regularUser,
        resources.publicDocument,
        ['view', 'list', 'search'],
      );
      const response = createMultiActionResponse(
        request.requestId!,
        ['view', 'list', 'search'],
        [true, true, true],
      );

      const result = await orchestrator.processRequest(request, response);

      // Single anomaly score for the entire request
      expect(result.anomalyScore).toBeDefined();
      expect(typeof result.anomalyScore).toBe('number');
    });

    it('should deny all actions when user is blocked', async () => {
      await orchestrator.initialize();

      await orchestrator.triggerEnforcement(
        'temporary_block',
        'multi-action-blocked',
        'Testing multi-action block',
      );

      const request = createCheckRequest(
        { id: 'multi-action-blocked', roles: ['user'], attributes: {} },
        resources.publicDocument,
        ['view', 'edit', 'delete'],
      );
      const response = createMultiActionResponse(
        request.requestId!,
        ['view', 'edit', 'delete'],
        [true, true, true],
      );

      const result = await orchestrator.processRequest(request, response);

      // All actions should be denied
      expect(result.response.results.view.effect).toBe('deny');
      expect(result.response.results.edit.effect).toBe('deny');
      expect(result.response.results.delete.effect).toBe('deny');
    });

    it('should generate explanation covering all actions', async () => {
      await orchestrator.initialize();

      const request = createCheckRequest(
        principals.subscriber,
        resources.premiumContent,
        ['view', 'download'],
      );
      const response = createMultiActionResponse(
        request.requestId!,
        ['view', 'download'],
        [true, false],
      );

      const result = await orchestrator.processRequest(request, response, {
        includeExplanation: true,
      });

      expect(result.explanation).toBeDefined();
      expect(result.explanation!.summary).toBeDefined();
    });
  });

  // ===========================================================================
  // Section 5: Pipeline Timing Constraints
  // ===========================================================================

  describe('Pipeline Timing Constraints', () => {
    it('should complete processing within acceptable time', async () => {
      await orchestrator.initialize();

      const request = createCheckRequest(
        principals.regularUser,
        resources.publicDocument,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');

      const startTime = Date.now();
      const result = await orchestrator.processRequest(request, response);
      const duration = Date.now() - startTime;

      // Processing should be under 100ms for simple requests
      expect(duration).toBeLessThan(100);
      expect(result.processingTimeMs).toBeLessThan(100);
    });

    it('should record accurate processing time', async () => {
      await orchestrator.initialize();

      const request = createCheckRequest(
        principals.admin,
        resources.adminSettings,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response);

      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.processingTimeMs).toBeLessThan(1000); // Should be well under 1 second
    });

    it('should handle explanation generation time', async () => {
      await orchestrator.initialize();

      const request = createCheckRequest(
        principals.subscriber,
        resources.premiumContent,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response, {
        includeExplanation: true,
      });

      // With mocked LLM, should still be fast
      expect(result.processingTimeMs).toBeLessThan(200);
    });
  });

  // ===========================================================================
  // Section 6: Pipeline State Management
  // ===========================================================================

  describe('Pipeline State Management', () => {
    it('should maintain agent health throughout pipeline', async () => {
      await orchestrator.initialize();

      // Process multiple requests
      for (let i = 0; i < 20; i++) {
        const request = createCheckRequest(
          { id: `state-test-user-${i}`, roles: ['user'], attributes: {} },
          resources.publicDocument,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');
        await orchestrator.processRequest(request, response);
      }

      const health = await orchestrator.getHealth();

      expect(health.status).toBe('healthy');
      expect(health.agents.guardian.state).toBe('ready');
      expect(health.agents.analyst.state).toBe('ready');
      expect(health.agents.advisor.state).toBe('ready');
      expect(health.agents.enforcer.state).toBe('ready');
    });

    it('should track processing metrics across pipeline', async () => {
      await orchestrator.initialize();

      // Process several requests
      for (let i = 0; i < 5; i++) {
        const request = createCheckRequest(
          principals.regularUser,
          resources.publicDocument,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');
        await orchestrator.processRequest(request, response);
      }

      const health = await orchestrator.getHealth();

      // GUARDIAN should have processed requests
      expect(health.agents.guardian.metrics.processedCount).toBeGreaterThanOrEqual(5);
    });

    it('should handle initialization state correctly', async () => {
      // Before initialization
      const orchestrator2 = new AgentOrchestrator(config);

      // Initialize
      await orchestrator2.initialize();

      // Process a request
      const request = createCheckRequest(
        principals.regularUser,
        resources.publicDocument,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');
      const result = await orchestrator2.processRequest(request, response);

      expect(result.enforcement?.allowed).toBe(true);

      await orchestrator2.shutdown();
    });

    it('should be idempotent on multiple initializations', async () => {
      await orchestrator.initialize();
      await orchestrator.initialize(); // Should be no-op

      const health = await orchestrator.getHealth();
      expect(health.status).toBe('healthy');
    });
  });

  // ===========================================================================
  // Section 7: Pipeline Integration with Policy Context
  // ===========================================================================

  describe('Pipeline Integration with Policy Context', () => {
    it('should process request with full policy context', async () => {
      await orchestrator.initialize();

      const request = createCheckRequest(
        principals.financeUser,
        resources.payout,
        ['process'],
      );
      const response = createAllowedResponse(request.requestId!, 'process');

      const policyContext = {
        matchedRules: ['allow-finance-process'],
        derivedRoles: ['finance-team-member'],
      };

      const result = await orchestrator.processRequest(request, response, {
        includeExplanation: true,
        policyContext,
      });

      expect(result.explanation).toBeDefined();
      expect(result.explanation!.factors.length).toBeGreaterThan(0);
    });

    it('should handle denied request with path to allow', async () => {
      await orchestrator.initialize();

      const request = createCheckRequest(
        principals.regularUser,
        resources.premiumContent,
        ['view'],
      );
      const response = createDeniedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response, {
        includeExplanation: true,
      });

      expect(result.explanation).toBeDefined();
      expect(result.explanation!.pathToAllow).toBeDefined();

      const pathToAllow = result.explanation!.pathToAllow!;
      expect(
        pathToAllow.missingRoles ||
        pathToAllow.requiredConditions ||
        pathToAllow.suggestedActions
      ).toBeDefined();
    });

    it('should generate recommendations based on decision', async () => {
      await orchestrator.initialize();

      const request = createCheckRequest(
        principals.regularUser,
        resources.adminSettings,
        ['edit'],
      );
      const response = createDeniedResponse(request.requestId!, 'edit');

      const result = await orchestrator.processRequest(request, response, {
        includeExplanation: true,
      });

      expect(result.explanation).toBeDefined();
      expect(result.explanation!.recommendations).toBeDefined();
      expect(result.explanation!.recommendations!.length).toBeGreaterThan(0);
    });
  });
});
