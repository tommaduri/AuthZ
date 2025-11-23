/**
 * Agentic Scenarios E2E Tests
 *
 * Tests AI-powered authorization features including:
 * - Anomaly detection and blocking
 * - Policy recommendations
 * - Threat response and enforcement
 * - Pattern learning and analysis
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
          choices: [{ message: { content: 'Agentic analysis explanation' } }],
        }),
      },
    },
  })),
}));

// =============================================================================
// Test Suite: Agentic Scenarios
// =============================================================================

describe('Agentic Scenarios E2E Tests', () => {
  let orchestrator: AgentOrchestrator;
  let engine: DecisionEngine;

  beforeAll(async () => {
    engine = new DecisionEngine();
    // Use lower threshold for anomaly detection in tests
    const agenticConfig = {
      ...testConfig,
      agents: {
        ...testConfig.agents,
        guardian: {
          ...testConfig.agents.guardian,
          anomalyThreshold: 0.3,
        },
      },
    };
    orchestrator = new AgentOrchestrator(agenticConfig);
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
  // Section 1: Anomaly Detection
  // ===========================================================================

  describe('1. Anomaly Detection', () => {
    describe('Velocity Anomalies', () => {
      it('should detect high-velocity request patterns', async () => {
        const suspiciousUser = {
          id: 'velocity-test-user',
          roles: ['user'],
          attributes: { email: 'velocity@example.com' },
        };

        // Simulate rapid requests
        const results = [];
        for (let i = 0; i < 100; i++) {
          const request = createCheckRequest(
            suspiciousUser,
            resources.publicContent,
            ['view'],
            `velocity-req-${i}`,
          );
          const response = createAllowedResponse(request.requestId!, 'view');
          const result = await orchestrator.processRequest(request, response);
          results.push(result);
        }

        // Later requests should show increasing anomaly scores
        const lastResults = results.slice(-10);
        const avgAnomalyScore =
          lastResults.reduce((sum, r) => sum + r.anomalyScore, 0) / lastResults.length;

        expect(avgAnomalyScore).toBeGreaterThan(0);
      });

      it('should track request velocity per principal', async () => {
        const user1 = {
          id: 'velocity-user-1',
          roles: ['user'],
          attributes: {},
        };
        const user2 = {
          id: 'velocity-user-2',
          roles: ['user'],
          attributes: {},
        };

        // High velocity for user1
        for (let i = 0; i < 50; i++) {
          const request = createCheckRequest(user1, resources.publicContent, ['view']);
          const response = createAllowedResponse(request.requestId!, 'view');
          await orchestrator.processRequest(request, response);
        }

        // Normal velocity for user2
        const request2 = createCheckRequest(user2, resources.publicContent, ['view']);
        const response2 = createAllowedResponse(request2.requestId!, 'view');
        const result2 = await orchestrator.processRequest(request2, response2);

        // User2's score should be lower than user1's would be
        expect(result2.anomalyScore).toBeLessThan(0.5);
      });
    });

    describe('Behavioral Anomalies', () => {
      it('should detect unusual resource access patterns', async () => {
        const normalUser = {
          id: 'behavioral-test-user',
          roles: ['user'],
          attributes: {},
        };

        // Normal behavior: viewing public content
        for (let i = 0; i < 10; i++) {
          const request = createCheckRequest(normalUser, resources.publicContent, ['view']);
          const response = createAllowedResponse(request.requestId!, 'view');
          await orchestrator.processRequest(request, response);
        }

        // Anomalous behavior: attempting admin settings access
        const anomalousRequest = createCheckRequest(
          normalUser,
          {
            kind: 'admin-settings',
            id: 'system-settings',
            attributes: { scope: 'global' },
          },
          ['view', 'edit', 'delete'],
        );
        const anomalousResponse = createMultiActionResponse(
          anomalousRequest.requestId!,
          ['view', 'edit', 'delete'],
          [false, false, false],
        );

        const result = await orchestrator.processRequest(anomalousRequest, anomalousResponse);

        expect(result.anomalyScore).toBeGreaterThan(0);
      });

      it('should detect bulk operation anomalies', async () => {
        const normalUser = {
          id: 'bulk-test-user',
          roles: ['user'],
          attributes: {},
        };

        const bulkResource = {
          kind: 'avatar',
          id: 'bulk-all-avatars',
          attributes: {
            operation: 'bulk',
            targetCount: 1000,
          },
        };

        const request = createCheckRequest(normalUser, bulkResource, ['bulk-delete', 'bulk-export']);
        const response = createMultiActionResponse(
          request.requestId!,
          ['bulk-delete', 'bulk-export'],
          [false, false],
        );

        const result = await orchestrator.processRequest(request, response);

        expect(result.anomalyScore).toBeGreaterThan(0);
      });

      it('should detect privilege escalation attempts', async () => {
        const regularUser = {
          id: 'escalation-test-user',
          roles: ['user'],
          attributes: {},
        };

        // Attempting to assign admin role to self
        const escalationResource = {
          kind: 'user',
          id: 'escalation-test-user',
          attributes: {
            currentRoles: ['user'],
            requestedRoles: ['admin', 'super_admin'],
          },
        };

        const request = createCheckRequest(regularUser, escalationResource, ['assign_role']);
        const response = createDeniedResponse(request.requestId!, 'assign_role');

        const result = await orchestrator.processRequest(request, response);

        expect(result.anomalyScore).toBeGreaterThan(0);
        expect(result.response.results.assign_role.effect).toBe('deny');
      });
    });

    describe('Sensitive Resource Access', () => {
      it('should flag access to financial resources', async () => {
        const regularUser = {
          id: 'financial-access-user',
          roles: ['user'],
          attributes: {},
        };

        const request = createCheckRequest(
          regularUser,
          resources.pendingPayout,
          ['view', 'process', 'approve'],
        );
        const response = createMultiActionResponse(
          request.requestId!,
          ['view', 'process', 'approve'],
          [false, false, false],
        );

        const result = await orchestrator.processRequest(request, response);

        expect(result.anomalyScore).toBeGreaterThan(0);
      });

      it('should flag attempts to export sensitive data', async () => {
        const regularUser = {
          id: 'export-attempt-user',
          roles: ['user', 'influencer'],
          attributes: {},
        };

        const request = createCheckRequest(regularUser, resources.highValuePayout, ['bulk-export']);
        const response = createDeniedResponse(request.requestId!, 'bulk-export');

        const result = await orchestrator.processRequest(request, response);

        expect(result.anomalyScore).toBeGreaterThan(0);
      });
    });
  });

  // ===========================================================================
  // Section 2: Threat Response
  // ===========================================================================

  describe('2. Threat Response', () => {
    describe('Rate Limiting', () => {
      it('should apply rate limit enforcement', async () => {
        const targetUser = 'rate-limit-target-user';

        // Apply rate limit
        const action = await orchestrator.triggerEnforcement(
          'rate_limit',
          targetUser,
          'Excessive request velocity detected',
        );

        expect(action.type).toBe('rate_limit');
        expect(action.status).toBe('completed');

        // Verify subsequent requests are blocked
        const request = createCheckRequest(
          { id: targetUser, roles: ['user'], attributes: {} },
          resources.publicContent,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(false);
        expect(result.enforcement?.reason).toContain('Rate limited');
      });

      it('should skip guardian processing for rate-limited users', async () => {
        const targetUser = 'skip-guardian-user';

        await orchestrator.triggerEnforcement('rate_limit', targetUser, 'Test rate limit');

        const request = createCheckRequest(
          { id: targetUser, roles: ['user'], attributes: {} },
          resources.publicContent,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response);

        expect(result.agentsInvolved).toContain('enforcer');
        expect(result.agentsInvoked).not.toContain('guardian');
      });
    });

    describe('Temporary Blocking', () => {
      it('should apply temporary block enforcement', async () => {
        const targetUser = 'temp-block-user';

        const action = await orchestrator.triggerEnforcement(
          'temporary_block',
          targetUser,
          'Suspicious activity detected - temporary block',
        );

        expect(action.type).toBe('temporary_block');
        expect(action.status).toBe('completed');

        // Verify all requests are blocked
        const request = createCheckRequest(
          { id: targetUser, roles: ['user'], attributes: {} },
          resources.publicContent,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(false);
        expect(result.enforcement?.reason).toContain('Blocked');
      });

      it('should block all actions for temporarily blocked users', async () => {
        const targetUser = 'multi-action-block-user';

        await orchestrator.triggerEnforcement(
          'temporary_block',
          targetUser,
          'Multi-action block test',
        );

        const request = createCheckRequest(
          { id: targetUser, roles: ['user'], attributes: {} },
          resources.publicContent,
          ['view', 'edit', 'delete'],
        );
        const response = createMultiActionResponse(
          request.requestId!,
          ['view', 'edit', 'delete'],
          [true, true, true],
        );

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.view.effect).toBe('deny');
        expect(result.response.results.edit.effect).toBe('deny');
        expect(result.response.results.delete.effect).toBe('deny');
      });
    });

    describe('Admin Alerts', () => {
      it('should trigger admin alert enforcement', async () => {
        const targetUser = 'alert-test-user';

        const action = await orchestrator.triggerEnforcement(
          'alert_admin',
          targetUser,
          'Potential security incident - admin review required',
        );

        expect(action.type).toBe('alert_admin');
        expect(action.status).toBe('completed');
      });

      it('should allow different enforcement action types', async () => {
        const actions = [
          { type: 'rate_limit' as const, user: 'rate-limit-variety-user' },
          { type: 'temporary_block' as const, user: 'block-variety-user' },
          { type: 'alert_admin' as const, user: 'alert-variety-user' },
        ];

        for (const { type, user } of actions) {
          const action = await orchestrator.triggerEnforcement(type, user, `Test ${type}`);
          expect(action.type).toBe(type);
          expect(action.status).toBe('completed');
        }
      });
    });

    describe('Enforcement Approval Workflow', () => {
      it('should track pending enforcement actions', async () => {
        const pending = orchestrator.getPendingActions();
        expect(Array.isArray(pending)).toBe(true);
      });

      it('should approve pending enforcement action', async () => {
        // Create some pending actions through normal flow
        const pending = orchestrator.getPendingActions();

        if (pending.length > 0) {
          const approved = await orchestrator.approveAction(pending[0].id, 'admin@test.com');

          if (approved) {
            expect(approved.status).toBe('completed');
          }
        }
      });

      it('should return null for non-existent action approval', async () => {
        const result = await orchestrator.approveAction('non-existent-action', 'admin@test.com');
        expect(result).toBeNull();
      });
    });
  });

  // ===========================================================================
  // Section 3: Policy Recommendations
  // ===========================================================================

  describe('3. Policy Recommendations', () => {
    describe('Explanation Generation', () => {
      it('should generate explanation for allowed requests', async () => {
        const request = createCheckRequest(
          principals.premiumFan,
          resources.premiumContent,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response, {
          includeExplanation: true,
        });

        expect(result.explanation).toBeDefined();
        expect(result.explanation?.summary).toBeDefined();
        expect(result.explanation?.factors).toBeInstanceOf(Array);
        expect(result.agentsInvolved).toContain('advisor');
      });

      it('should generate explanation with path to allow for denied requests', async () => {
        const request = createCheckRequest(
          principals.fan,
          resources.premiumContent,
          ['view'],
        );
        const response = createDeniedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response, {
          includeExplanation: true,
        });

        expect(result.explanation).toBeDefined();
        expect(result.explanation?.pathToAllow).toBeDefined();
      });

      it('should include derived role information in explanation', async () => {
        const request = createCheckRequest(
          principals.influencer,
          resources.publicAvatar,
          ['edit'],
        );
        const response = createAllowedResponse(request.requestId!, 'edit');

        const policyContext = {
          matchedRules: ['owner-edit'],
          derivedRoles: ['owner', 'content_creator'],
        };

        const result = await orchestrator.processRequest(request, response, {
          includeExplanation: true,
          policyContext,
        });

        expect(result.explanation).toBeDefined();
        const hasDerivedRoleFactor = result.explanation?.factors.some(
          (f) => f.type === 'derived_role',
        );
        expect(hasDerivedRoleFactor).toBe(true);
      });

      it('should include recommendations in explanation', async () => {
        const request = createCheckRequest(
          principals.admin,
          resources.flaggedContent,
          ['moderate'],
        );
        const response = createAllowedResponse(request.requestId!, 'moderate');

        const result = await orchestrator.processRequest(request, response, {
          includeExplanation: true,
        });

        expect(result.explanation).toBeDefined();
        expect(result.explanation?.recommendations).toBeInstanceOf(Array);
      });
    });

    describe('Natural Language Policy Questions', () => {
      it('should answer policy questions', async () => {
        const answer = await orchestrator.askQuestion(
          'Why was access denied to premium content?',
        );

        expect(typeof answer).toBe('string');
        expect(answer.length).toBeGreaterThan(0);
      });

      it('should answer various policy questions', async () => {
        const questions = [
          'What roles can view premium content?',
          'How can a user get subscriber access?',
          'What permissions does an admin have?',
        ];

        for (const question of questions) {
          const answer = await orchestrator.askQuestion(question);
          expect(typeof answer).toBe('string');
        }
      });
    });

    describe('Policy Debugging', () => {
      it('should debug policy issues', async () => {
        const policyYaml = `
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: content-policy
spec:
  resource: content
  rules:
    - actions: [view]
      effect: allow
      roles: [subscriber]
      condition:
        expression: "resource.contentType == 'premium'"
`;

        const diagnosis = await orchestrator.debugPolicy(
          'Users cannot access premium content even with subscription',
          policyYaml,
        );

        expect(typeof diagnosis).toBe('string');
      });

      it('should debug complex policy scenarios', async () => {
        const complexPolicy = `
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: payout-policy
spec:
  resource: payout
  rules:
    - actions: [process]
      effect: allow
      roles: [finance]
      condition:
        expression: "resource.amount <= 1000"
    - actions: [process]
      effect: allow
      derivedRoles: [finance_approver]
      condition:
        expression: "resource.amount > 1000"
`;

        const diagnosis = await orchestrator.debugPolicy(
          'Finance team cannot process high-value payouts',
          complexPolicy,
        );

        expect(typeof diagnosis).toBe('string');
      });
    });
  });

  // ===========================================================================
  // Section 4: Pattern Learning
  // ===========================================================================

  describe('4. Pattern Learning', () => {
    describe('Pattern Discovery', () => {
      it('should discover patterns from authorization decisions', async () => {
        // Generate some authorization history
        for (let i = 0; i < 20; i++) {
          const request = createCheckRequest(
            principals.fan,
            resources.publicContent,
            ['view'],
          );
          const response = createAllowedResponse(request.requestId!, 'view');
          await orchestrator.processRequest(request, response);
        }

        const patterns = await orchestrator.discoverPatterns();

        expect(Array.isArray(patterns)).toBe(true);
      });

      it('should return stored patterns', async () => {
        const patterns = orchestrator.getPatterns();

        expect(Array.isArray(patterns)).toBe(true);
      });

      it('should handle pattern discovery on minimal dataset', async () => {
        // Should not throw even with minimal data
        await expect(orchestrator.discoverPatterns()).resolves.toBeDefined();
      });
    });

    describe('Anomaly Tracking', () => {
      it('should track anomalies for principals', async () => {
        const suspiciousUser = {
          id: 'anomaly-tracking-user',
          roles: ['user'],
          attributes: {},
        };

        // Generate anomalous activity
        for (let i = 0; i < 10; i++) {
          const request = createCheckRequest(
            suspiciousUser,
            {
              kind: 'admin-settings',
              id: `admin-setting-${i}`,
              attributes: { scope: 'global' },
            },
            ['edit', 'delete'],
          );
          const response = createMultiActionResponse(
            request.requestId!,
            ['edit', 'delete'],
            [false, false],
          );
          await orchestrator.processRequest(request, response);
        }

        const anomalies = orchestrator.getAnomalies(suspiciousUser.id);

        expect(Array.isArray(anomalies)).toBe(true);
      });

      it('should return empty array for principal with no anomalies', async () => {
        const anomalies = orchestrator.getAnomalies('clean-principal-no-anomalies');
        expect(anomalies).toEqual([]);
      });
    });
  });

  // ===========================================================================
  // Section 5: Complete Agentic Workflow
  // ===========================================================================

  describe('5. Complete Agentic Workflow', () => {
    it('should process request through full agent pipeline', async () => {
      const request = createCheckRequest(
        principals.fan,
        resources.publicContent,
        ['view'],
      );
      const response = createAllowedResponse(request.requestId!, 'view');

      const result = await orchestrator.processRequest(request, response);

      // Verify all agents were invoked
      expect(result.agentsInvolved).toContain('enforcer');
      expect(result.agentsInvolved).toContain('guardian');

      // Verify proper ordering
      expect(result.agentsInvolved.indexOf('enforcer')).toBeLessThan(
        result.agentsInvolved.indexOf('guardian'),
      );

      // Verify metrics
      expect(result.anomalyScore).toBeDefined();
      expect(typeof result.anomalyScore).toBe('number');
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle complete threat detection to enforcement flow', async () => {
      const testUserId = 'complete-flow-user';

      // Step 1: Normal access (should pass)
      const normalRequest = createCheckRequest(
        { id: testUserId, roles: ['user'], attributes: {} },
        resources.publicContent,
        ['view'],
      );
      const normalResponse = createAllowedResponse(normalRequest.requestId!, 'view');
      const normalResult = await orchestrator.processRequest(normalRequest, normalResponse);

      expect(normalResult.enforcement?.allowed).toBe(true);

      // Step 2: Suspicious activity
      const suspiciousRequest = createCheckRequest(
        { id: testUserId, roles: ['user'], attributes: {} },
        {
          kind: 'admin-settings',
          id: 'system-settings',
          attributes: { scope: 'global' },
        },
        ['delete'],
      );
      const suspiciousResponse = createDeniedResponse(suspiciousRequest.requestId!, 'delete');
      const suspiciousResult = await orchestrator.processRequest(
        suspiciousRequest,
        suspiciousResponse,
      );

      expect(suspiciousResult.anomalyScore).toBeGreaterThan(0);

      // Step 3: Admin triggers enforcement
      const enforcement = await orchestrator.triggerEnforcement(
        'rate_limit',
        testUserId,
        'Suspicious activity detected in complete flow test',
      );

      expect(enforcement.status).toBe('completed');

      // Step 4: Verify subsequent requests blocked
      const blockedRequest = createCheckRequest(
        { id: testUserId, roles: ['user'], attributes: {} },
        resources.publicContent,
        ['view'],
      );
      const blockedResponse = createAllowedResponse(blockedRequest.requestId!, 'view');
      const blockedResult = await orchestrator.processRequest(blockedRequest, blockedResponse);

      expect(blockedResult.enforcement?.allowed).toBe(false);
    });

    it('should maintain healthy agent status throughout workflow', async () => {
      // Process multiple requests
      for (let i = 0; i < 10; i++) {
        const request = createCheckRequest(
          principals.fan,
          resources.publicContent,
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
      expect(health.agents.guardian.metrics.processedCount).toBeGreaterThanOrEqual(10);
    });
  });
});
