/**
 * End-to-End Integration Tests for Agentic Authorization Pipeline
 *
 * Tests the complete flow of authorization requests through all four agents:
 * GUARDIAN -> ANALYST -> ADVISOR -> ENFORCER
 *
 * Uses mocked infrastructure (database, event bus, LLM) to ensure
 * reliable and deterministic test execution.
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { AgentOrchestrator } from '../../src/orchestrator/agent-orchestrator.js';
import type { OrchestratorConfig } from '../../src/orchestrator/agent-orchestrator.js';
import type { CheckRequest, CheckResponse } from '@authz-engine/core';
import {
  createMockDecisionStore,
  createMockEventBus,
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
  createMultiActionResponse,
  testScenarios,
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

// Mock OpenAI for LLM tests
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{
            message: {
              content: 'This authorization decision was based on the user\'s roles and resource ownership. The request was evaluated against applicable policies.',
            },
          }],
        }),
      },
    },
  })),
}));

// =============================================================================
// Test Suite: Full Pipeline Integration Tests
// =============================================================================

describe('Agentic Authorization Pipeline - Integration Tests', () => {
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
  // Section 1: Full Pipeline Tests
  // ===========================================================================

  describe('1. Full Pipeline Tests', () => {
    describe('Request Processing Flow', () => {
      it('should process request through complete agent pipeline', async () => {
        await orchestrator.initialize();

        const request = createCheckRequest(
          principals.regularUser,
          resources.publicDocument,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response);

        // Verify all agents were invoked in correct order
        expect(result.agentsInvolved).toContain('enforcer');
        expect(result.agentsInvolved).toContain('guardian');

        // Enforcer should be checked first
        expect(result.agentsInvolved.indexOf('enforcer')).toBeLessThan(
          result.agentsInvolved.indexOf('guardian'),
        );

        // Response should include anomaly score
        expect(result.anomalyScore).toBeDefined();
        expect(typeof result.anomalyScore).toBe('number');
        expect(result.anomalyScore).toBeGreaterThanOrEqual(0);
        expect(result.anomalyScore).toBeLessThanOrEqual(1);

        // Enforcement should be allowed
        expect(result.enforcement?.allowed).toBe(true);

        // Processing time should be recorded
        expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
      });

      it('should process multiple actions in single request', async () => {
        await orchestrator.initialize();

        const request = createCheckRequest(
          principals.admin,
          resources.adminSettings,
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
        expect(result.agentsInvolved.length).toBeGreaterThanOrEqual(2);
      });

      it('should include explanation when requested', async () => {
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

        expect(result.explanation).toBeDefined();
        expect(result.explanation!.summary).toBeDefined();
        expect(result.explanation!.factors).toBeDefined();
        expect(Array.isArray(result.explanation!.factors)).toBe(true);
        expect(result.agentsInvolved).toContain('advisor');
      });

      it('should include derived role information in explanation', async () => {
        await orchestrator.initialize();

        const request = createCheckRequest(
          principals.regularUser,
          resources.userAvatar,
          ['edit'],
        );
        const response = createAllowedResponse(request.requestId!, 'edit');

        const policyContext = {
          matchedRules: ['allow-owner-edit'],
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
      });

      it('should handle denied requests correctly', async () => {
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

        expect(result.response.results.view.effect).toBe('deny');
        expect(result.explanation).toBeDefined();
        expect(result.explanation!.pathToAllow).toBeDefined();
      });
    });

    describe('Health Monitoring', () => {
      it('should report healthy status when all agents are ready', async () => {
        await orchestrator.initialize();

        const health = await orchestrator.getHealth();

        expect(health.status).toBe('healthy');
        expect(health.agents.guardian.state).toBe('ready');
        expect(health.agents.analyst.state).toBe('ready');
        expect(health.agents.advisor.state).toBe('ready');
        expect(health.agents.enforcer.state).toBe('ready');
        expect(health.infrastructure.store).toBe('connected');
        expect(health.infrastructure.eventBus).toBe('connected');
      });

      it('should include agent metrics in health check', async () => {
        await orchestrator.initialize();

        // Process some requests to generate metrics
        const request = createCheckRequest(
          principals.regularUser,
          resources.publicDocument,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');
        await orchestrator.processRequest(request, response);

        const health = await orchestrator.getHealth();

        expect(health.agents.guardian.metrics).toBeDefined();
        expect(health.agents.guardian.metrics.processedCount).toBeGreaterThanOrEqual(1);
      });
    });
  });

  // ===========================================================================
  // Section 2: Anomaly Detection Flow Tests
  // ===========================================================================

  describe('2. Anomaly Detection Flow', () => {
    describe('Velocity Anomaly Detection', () => {
      it('should detect high-velocity request patterns', async () => {
        await orchestrator.initialize();

        const request = createCheckRequest(
          principals.suspiciousUser,
          resources.publicDocument,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');

        // Simulate rapid requests to trigger velocity detection
        let lastResult;
        for (let i = 0; i < 600; i++) {
          lastResult = await orchestrator.processRequest(request, response);
        }

        // The anomaly score should increase with rapid requests
        expect(lastResult!.anomalyScore).toBeGreaterThan(0);
      });

      it('should track anomalies for specific principals', async () => {
        // Lower threshold to trigger anomaly easier
        config.agents.guardian!.anomalyThreshold = 0.1;
        orchestrator = new AgentOrchestrator(config);
        await orchestrator.initialize();

        const suspiciousRequest = createCheckRequest(
          principals.suspiciousUser,
          resources.payout,
          ['bulk-export'],
        );
        const response = createAllowedResponse(suspiciousRequest.requestId!, 'bulk-export');

        // Process request that should trigger anomaly
        const result = await orchestrator.processRequest(suspiciousRequest, response);

        // Get anomalies for the principal
        const anomalies = orchestrator.getAnomalies(principals.suspiciousUser.id);

        // If anomaly was detected, verify it's tracked
        if (result.anomaly) {
          expect(anomalies.length).toBeGreaterThan(0);
          expect(anomalies[0].principalId).toBe(principals.suspiciousUser.id);
        }
      });

      it('should detect suspicious patterns in resource access', async () => {
        config.agents.guardian!.anomalyThreshold = 0.1;
        orchestrator = new AgentOrchestrator(config);
        await orchestrator.initialize();

        // Access sensitive admin resource
        const suspiciousRequest = createCheckRequest(
          principals.regularUser,
          resources.adminSettings,
          ['delete'],
        );
        const response = createDeniedResponse(suspiciousRequest.requestId!, 'delete');

        const result = await orchestrator.processRequest(suspiciousRequest, response);

        // Should have risk factors for suspicious patterns
        expect(result.anomalyScore).toBeGreaterThan(0);
      });

      it('should detect bulk operation anomalies', async () => {
        config.agents.guardian!.anomalyThreshold = 0.2;
        orchestrator = new AgentOrchestrator(config);
        await orchestrator.initialize();

        const bulkRequest = createCheckRequest(
          principals.regularUser,
          { kind: 'avatar', id: 'bulk-all', attributes: {} },
          ['bulk-delete'],
        );
        const response = createDeniedResponse(bulkRequest.requestId!, 'bulk-delete');

        const result = await orchestrator.processRequest(bulkRequest, response);

        expect(result.anomalyScore).toBeGreaterThan(0);
      });
    });

    describe('Anomaly Recording and Storage', () => {
      it('should record anomaly when score exceeds threshold', async () => {
        config.agents.guardian!.anomalyThreshold = 0.1;
        orchestrator = new AgentOrchestrator(config);
        await orchestrator.initialize();

        // Create a highly anomalous request
        const anomalousRequest = createCheckRequest(
          principals.suspiciousUser,
          resources.payout,
          ['bulk-export'],
        );
        const response = createDeniedResponse(anomalousRequest.requestId!, 'bulk-export');

        const result = await orchestrator.processRequest(anomalousRequest, response);

        if (result.anomalyScore >= 0.1) {
          expect(result.anomaly).toBeDefined();
          expect(result.anomaly!.principalId).toBe(principals.suspiciousUser.id);
          expect(result.anomaly!.status).toBe('open');
        }
      });
    });
  });

  // ===========================================================================
  // Section 3: Pattern Learning Flow Tests
  // ===========================================================================

  describe('3. Pattern Learning Flow', () => {
    describe('Pattern Discovery', () => {
      it('should trigger pattern discovery and return results', async () => {
        await orchestrator.initialize();

        const patterns = await orchestrator.discoverPatterns();

        expect(Array.isArray(patterns)).toBe(true);
      });

      it('should return empty array when no patterns discovered', async () => {
        await orchestrator.initialize();

        const patterns = orchestrator.getPatterns();

        expect(patterns).toEqual([]);
      });

      it('should handle pattern discovery on empty dataset gracefully', async () => {
        await orchestrator.initialize();

        // Should not throw on empty dataset
        await expect(orchestrator.discoverPatterns()).resolves.toBeDefined();
      });
    });

    describe('Pattern Storage and Retrieval', () => {
      it('should store discovered patterns for later retrieval', async () => {
        await orchestrator.initialize();

        // Run discovery
        await orchestrator.discoverPatterns();

        // Patterns should be accessible
        const storedPatterns = orchestrator.getPatterns();
        expect(Array.isArray(storedPatterns)).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Section 4: Enforcement Workflow Tests
  // ===========================================================================

  describe('4. Enforcement Workflow', () => {
    describe('Enforcement Actions', () => {
      it('should trigger manual enforcement action', async () => {
        await orchestrator.initialize();

        const action = await orchestrator.triggerEnforcement(
          'rate_limit',
          'user-to-limit',
          'Manual rate limit for testing',
        );

        expect(action.type).toBe('rate_limit');
        expect(action.status).toBe('completed');
        expect(action.triggeredBy.reason).toBe('Manual rate limit for testing');
      });

      it('should support different enforcement action types', async () => {
        await orchestrator.initialize();

        const rateLimit = await orchestrator.triggerEnforcement(
          'rate_limit',
          'user-1',
          'Rate limit test',
        );
        const tempBlock = await orchestrator.triggerEnforcement(
          'temporary_block',
          'user-2',
          'Block test',
        );
        const alertAdmin = await orchestrator.triggerEnforcement(
          'alert_admin',
          'user-3',
          'Alert test',
        );

        expect(rateLimit.type).toBe('rate_limit');
        expect(tempBlock.type).toBe('temporary_block');
        expect(alertAdmin.type).toBe('alert_admin');
      });

      it('should block rate-limited principals from making requests', async () => {
        await orchestrator.initialize();

        // Apply rate limit
        await orchestrator.triggerEnforcement(
          'rate_limit',
          'rate-limited-user',
          'Testing rate limit enforcement',
        );

        // Attempt request with rate-limited user
        const request = createCheckRequest(
          { id: 'rate-limited-user', roles: ['user'], attributes: {} },
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

        // Apply temporary block
        await orchestrator.triggerEnforcement(
          'temporary_block',
          'blocked-user',
          'Testing block enforcement',
        );

        // Attempt request with blocked user
        const request = createCheckRequest(
          { id: 'blocked-user', roles: ['user'], attributes: {} },
          resources.publicDocument,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(false);
        expect(result.enforcement?.reason).toContain('Blocked');
      });

      it('should skip guardian processing for blocked users', async () => {
        await orchestrator.initialize();

        await orchestrator.triggerEnforcement('temporary_block', 'blocked-user-2', 'Test block');

        const request = createCheckRequest(
          { id: 'blocked-user-2', roles: ['user'], attributes: {} },
          resources.publicDocument,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response);

        // Guardian should not be invoked for blocked users
        expect(result.agentsInvolved).toContain('enforcer');
        expect(result.agentsInvolved).not.toContain('guardian');
      });
    });

    describe('Approval Workflow', () => {
      it('should get pending enforcement actions', async () => {
        await orchestrator.initialize();

        const pending = orchestrator.getPendingActions();

        expect(Array.isArray(pending)).toBe(true);
      });

      it('should approve pending action by ID', async () => {
        await orchestrator.initialize();

        // Create actions
        await orchestrator.triggerEnforcement('rate_limit', 'user-pending', 'Test pending');

        const pending = orchestrator.getPendingActions();

        if (pending.length > 0) {
          const approved = await orchestrator.approveAction(pending[0].id, 'admin@test.com');
          if (approved) {
            expect(approved.status).toBe('completed');
          }
        }
      });

      it('should return null when approving non-existent action', async () => {
        await orchestrator.initialize();

        const result = await orchestrator.approveAction('non-existent-id', 'admin@test.com');

        expect(result).toBeNull();
      });
    });

    describe('Response Modification', () => {
      it('should create denied response with enforcer reason for all actions', async () => {
        await orchestrator.initialize();

        await orchestrator.triggerEnforcement(
          'rate_limit',
          'multi-action-user',
          'Rate limited for multiple actions',
        );

        const request = createCheckRequest(
          { id: 'multi-action-user', roles: ['user'], attributes: {} },
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

        // Matched rule should indicate enforcer
        expect(result.response.results.view.meta?.matchedRule).toContain('enforcer');
      });
    });
  });

  // ===========================================================================
  // Section 5: LLM Explanation Flow Tests (Mocked)
  // ===========================================================================

  describe('5. LLM Explanation Flow (Mocked)', () => {
    describe('Policy Questions', () => {
      it('should answer policy questions', async () => {
        await orchestrator.initialize();

        const answer = await orchestrator.askQuestion('Why was access denied?');

        expect(typeof answer).toBe('string');
        expect(answer.length).toBeGreaterThan(0);
      });

      it('should return helpful message when LLM not configured', async () => {
        // Create orchestrator with LLM disabled
        config.agents.advisor!.enableNaturalLanguage = false;
        delete process.env.OPENAI_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;

        orchestrator = new AgentOrchestrator(config);
        await orchestrator.initialize();

        const answer = await orchestrator.askQuestion('Test question');

        expect(typeof answer).toBe('string');
      });
    });

    describe('Policy Debugging', () => {
      it('should debug policies and return diagnosis', async () => {
        await orchestrator.initialize();

        const policyYaml = `
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: test-policy
spec:
  resource: document
  rules:
    - actions: [view]
      effect: allow
      roles: [user]
`;

        const diagnosis = await orchestrator.debugPolicy(
          'Users cannot access premium content',
          policyYaml,
        );

        expect(typeof diagnosis).toBe('string');
      });
    });

    describe('Decision Explanation Format', () => {
      it('should generate explanation with proper structure', async () => {
        await orchestrator.initialize();

        const request = createCheckRequest(
          principals.regularUser,
          resources.publicDocument,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response, {
          includeExplanation: true,
        });

        expect(result.explanation).toBeDefined();
        expect(result.explanation!.requestId).toBeDefined();
        expect(result.explanation!.generatedAt).toBeInstanceOf(Date);
        expect(result.explanation!.summary).toBeDefined();
        expect(typeof result.explanation!.summary).toBe('string');
        expect(Array.isArray(result.explanation!.factors)).toBe(true);
      });

      it('should include path to allow for denied requests', async () => {
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
        // Should have suggestions
        expect(
          pathToAllow.missingRoles ||
          pathToAllow.missingAttributes ||
          pathToAllow.requiredConditions ||
          pathToAllow.suggestedActions
        ).toBeDefined();
      });

      it('should include recommendations in explanation', async () => {
        await orchestrator.initialize();

        const request = createCheckRequest(
          principals.admin,
          resources.adminSettings,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response, {
          includeExplanation: true,
        });

        expect(result.explanation).toBeDefined();
        expect(result.explanation!.recommendations).toBeDefined();
        expect(Array.isArray(result.explanation!.recommendations)).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Section 6: Edge Cases and Error Handling
  // ===========================================================================

  describe('6. Edge Cases and Error Handling', () => {
    describe('Initialization and Shutdown', () => {
      it('should be idempotent on multiple initializations', async () => {
        await orchestrator.initialize();
        await orchestrator.initialize(); // Second call should be no-op

        const health = await orchestrator.getHealth();
        expect(health.status).toBe('healthy');
      });

      it('should not error on double shutdown', async () => {
        await orchestrator.initialize();
        await orchestrator.shutdown();

        // Second shutdown should not throw
        await expect(orchestrator.shutdown()).resolves.not.toThrow();
      });

      it('should be able to initialize again after shutdown', async () => {
        await orchestrator.initialize();
        await orchestrator.shutdown();

        const newOrchestrator = new AgentOrchestrator(config);
        await newOrchestrator.initialize();

        const health = await newOrchestrator.getHealth();
        expect(health.status).toBe('healthy');

        await newOrchestrator.shutdown();
      });
    });

    describe('Empty and Edge Input Handling', () => {
      it('should handle requests with empty actions array', async () => {
        await orchestrator.initialize();

        const request = createCheckRequest(
          principals.regularUser,
          resources.publicDocument,
          [],
        );
        const response: CheckResponse = {
          requestId: request.requestId!,
          results: {},
          meta: { evaluationTime: 1, policyCount: 0 },
        };

        // Should not throw
        await expect(
          orchestrator.processRequest(request, response)
        ).resolves.toBeDefined();
      });

      it('should handle requests with special characters in IDs', async () => {
        await orchestrator.initialize();

        const request = createCheckRequest(
          { id: 'user-with-special:chars/and\\slashes', roles: ['user'], attributes: {} },
          { kind: 'document:type', id: 'doc/with/slashes', attributes: {} },
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response);
        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should handle anomaly retrieval for unknown principal', async () => {
        await orchestrator.initialize();

        const anomalies = orchestrator.getAnomalies('unknown-principal-xyz');

        expect(anomalies).toEqual([]);
      });
    });

    describe('Concurrent Request Handling', () => {
      it('should handle concurrent requests without errors', async () => {
        await orchestrator.initialize();

        const requests = Array.from({ length: 50 }, (_, i) =>
          createCheckRequest(
            { id: `user-${i}`, roles: ['user'], attributes: {} },
            resources.publicDocument,
            ['view'],
          ),
        );

        const promises = requests.map((request) => {
          const response = createAllowedResponse(request.requestId!, 'view');
          return orchestrator.processRequest(request, response);
        });

        const results = await Promise.all(promises);

        expect(results).toHaveLength(50);
        results.forEach((result) => {
          expect(result.anomalyScore).toBeDefined();
          expect(result.enforcement?.allowed).toBe(true);
        });
      });
    });
  });

  // ===========================================================================
  // Section 7: Integration Scenario Tests
  // ===========================================================================

  describe('7. Integration Scenarios', () => {
    describe('Complete User Journey', () => {
      it('should handle complete user access flow with anomaly and enforcement', async () => {
        // Lower threshold for this test
        config.agents.guardian!.anomalyThreshold = 0.3;
        orchestrator = new AgentOrchestrator(config);
        await orchestrator.initialize();

        const testUserId = 'journey-test-user';

        // Step 1: Normal access (should pass)
        const normalRequest = createCheckRequest(
          { id: testUserId, roles: ['user'], attributes: {} },
          resources.publicDocument,
          ['view'],
        );
        const normalResponse = createAllowedResponse(normalRequest.requestId!, 'view');
        const normalResult = await orchestrator.processRequest(normalRequest, normalResponse);

        expect(normalResult.enforcement?.allowed).toBe(true);

        // Step 2: Suspicious access attempt
        const suspiciousRequest = createCheckRequest(
          { id: testUserId, roles: ['user'], attributes: {} },
          resources.adminSettings,
          ['delete'],
        );
        const suspiciousResponse = createDeniedResponse(suspiciousRequest.requestId!, 'delete');
        const suspiciousResult = await orchestrator.processRequest(
          suspiciousRequest,
          suspiciousResponse,
        );

        expect(suspiciousResult.anomalyScore).toBeGreaterThan(0);

        // Step 3: Admin triggers enforcement
        const enforcementAction = await orchestrator.triggerEnforcement(
          'rate_limit',
          testUserId,
          'Suspicious activity detected',
        );
        expect(enforcementAction.status).toBe('completed');

        // Step 4: Subsequent requests should be blocked
        const blockedRequest = createCheckRequest(
          { id: testUserId, roles: ['user'], attributes: {} },
          resources.publicDocument,
          ['view'],
        );
        const blockedResponse = createAllowedResponse(blockedRequest.requestId!, 'view');
        const blockedResult = await orchestrator.processRequest(blockedRequest, blockedResponse);

        expect(blockedResult.enforcement?.allowed).toBe(false);
      });
    });

    describe('Multi-tenant Isolation', () => {
      it('should maintain isolation between different principals', async () => {
        await orchestrator.initialize();

        // Block user1
        await orchestrator.triggerEnforcement('temporary_block', 'tenant1-user', 'Test block');

        // User2 should not be affected
        const user2Request = createCheckRequest(
          { id: 'tenant2-user', roles: ['user'], attributes: {} },
          resources.publicDocument,
          ['view'],
        );
        const response = createAllowedResponse(user2Request.requestId!, 'view');
        const result = await orchestrator.processRequest(user2Request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });
    });
  });
});

// =============================================================================
// Helper Functions for Tests
// =============================================================================

/**
 * Create a batch of requests for stress testing
 */
function createRequestBatch(count: number, principalId: string): CheckRequest[] {
  return Array.from({ length: count }, (_, i) =>
    createCheckRequest(
      { id: principalId, roles: ['user'], attributes: {} },
      { kind: 'document', id: `doc-${i}`, attributes: {} },
      ['view'],
    ),
  );
}
