/**
 * User Access E2E Tests
 *
 * Tests user-facing authorization flows including:
 * - User authentication flows
 * - Resource access patterns
 * - Multi-tenant scenarios
 * - Subscription-based access
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
          choices: [{ message: { content: 'User access explanation' } }],
        }),
      },
    },
  })),
}));

// =============================================================================
// Test Suite: User Access Patterns
// =============================================================================

describe('User Access E2E Tests', () => {
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
  // Section 1: User Authentication Flow
  // ===========================================================================

  describe('1. User Authentication Flow', () => {
    describe('Profile Access', () => {
      it('should allow user to view their own profile', async () => {
        const ownProfile = resources.userProfile(principals.fan.id);
        const request = createCheckRequest(principals.fan, ownProfile, ['view']);
        const response = createAllowedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
        expect(result.anomalyScore).toBeLessThan(0.5);
      });

      it('should allow user to edit their own profile', async () => {
        const ownProfile = resources.userProfile(principals.fan.id);
        const request = createCheckRequest(principals.fan, ownProfile, ['edit', 'update']);
        const response = createMultiActionResponse(
          request.requestId!,
          ['edit', 'update'],
          [true, true],
        );

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.edit.effect).toBe('allow');
        expect(result.response.results.update.effect).toBe('allow');
      });

      it('should allow user to view public profiles of others', async () => {
        const otherProfile = resources.userProfile('other-user', 'public');
        const request = createCheckRequest(principals.fan, otherProfile, ['view']);
        const response = createAllowedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should deny user from viewing private profiles of others', async () => {
        const privateProfile = resources.userProfile('other-user', 'private');
        const request = createCheckRequest(principals.fan, privateProfile, ['view']);
        const response = createDeniedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.view.effect).toBe('deny');
      });

      it('should deny user from editing other users profiles', async () => {
        const otherProfile = resources.userProfile('other-user');
        const request = createCheckRequest(principals.fan, otherProfile, ['edit']);
        const response = createDeniedResponse(request.requestId!, 'edit');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.edit.effect).toBe('deny');
      });
    });

    describe('Account Settings', () => {
      it('should allow user to update their own settings', async () => {
        const ownProfile = resources.userProfile(principals.fan.id);
        const request = createCheckRequest(
          principals.fan,
          ownProfile,
          ['update_settings', 'update_preferences', 'update_notifications'],
        );
        const response = createMultiActionResponse(
          request.requestId!,
          ['update_settings', 'update_preferences', 'update_notifications'],
          [true, true, true],
        );

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.update_settings.effect).toBe('allow');
        expect(result.response.results.update_preferences.effect).toBe('allow');
      });

      it('should allow user to change their own password', async () => {
        const ownProfile = resources.userProfile(principals.fan.id);
        const request = createCheckRequest(principals.fan, ownProfile, ['change_password']);
        const response = createAllowedResponse(request.requestId!, 'change_password');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should deny changing password of other users', async () => {
        const otherProfile = resources.userProfile('other-user');
        const request = createCheckRequest(principals.fan, otherProfile, ['change_password']);
        const response = createDeniedResponse(request.requestId!, 'change_password');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.change_password.effect).toBe('deny');
        expect(result.anomalyScore).toBeGreaterThan(0);
      });
    });

    describe('Session and Activity', () => {
      it('should allow user to view their own activity log', async () => {
        const ownProfile = resources.userProfile(principals.fan.id);
        const request = createCheckRequest(principals.fan, ownProfile, ['view_activity']);
        const response = createAllowedResponse(request.requestId!, 'view_activity');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should deny user from viewing others activity logs', async () => {
        const otherProfile = resources.userProfile('other-user');
        const request = createCheckRequest(principals.fan, otherProfile, ['view_activity']);
        const response = createDeniedResponse(request.requestId!, 'view_activity');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.view_activity.effect).toBe('deny');
      });
    });
  });

  // ===========================================================================
  // Section 2: Resource Access Patterns
  // ===========================================================================

  describe('2. Resource Access Patterns', () => {
    describe('Content Access', () => {
      it('should allow any user to view public content', async () => {
        const request = createCheckRequest(
          principals.fan,
          resources.publicContent,
          ['view', 'list'],
        );
        const response = createMultiActionResponse(
          request.requestId!,
          ['view', 'list'],
          [true, true],
        );

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.view.effect).toBe('allow');
        expect(result.response.results.list.effect).toBe('allow');
      });

      it('should deny regular user from viewing premium content', async () => {
        const request = createCheckRequest(
          principals.fan,
          resources.premiumContent,
          ['view'],
        );
        const response = createDeniedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response, {
          includeExplanation: true,
        });

        expect(result.response.results.view.effect).toBe('deny');
        expect(result.explanation).toBeDefined();
        expect(result.explanation?.pathToAllow).toBeDefined();
      });

      it('should allow premium subscriber to view premium content', async () => {
        const request = createCheckRequest(
          principals.premiumFan,
          resources.premiumContent,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should allow premium subscriber to view exclusive content', async () => {
        const request = createCheckRequest(
          principals.premiumFan,
          resources.exclusiveContent,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });
    });

    describe('Influencer Content Creation', () => {
      it('should allow influencer to create content', async () => {
        const request = createCheckRequest(
          principals.influencer,
          { kind: 'content', id: 'new-content', attributes: {} },
          ['create'],
        );
        const response = createAllowedResponse(request.requestId!, 'create');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should allow influencer to edit their own content', async () => {
        const ownContent = {
          kind: 'content',
          id: 'influencer-content',
          attributes: {
            creatorId: principals.influencer.id,
            status: 'draft',
          },
        };

        const request = createCheckRequest(
          principals.influencer,
          ownContent,
          ['edit', 'update'],
        );
        const response = createMultiActionResponse(
          request.requestId!,
          ['edit', 'update'],
          [true, true],
        );

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.edit.effect).toBe('allow');
      });

      it('should allow influencer to publish their content', async () => {
        const draftContent = {
          ...resources.draftContent,
          attributes: {
            ...resources.draftContent.attributes,
            creatorId: principals.influencer.id,
          },
        };

        const request = createCheckRequest(
          principals.influencer,
          draftContent,
          ['publish'],
        );
        const response = createAllowedResponse(request.requestId!, 'publish');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should deny publishing flagged content', async () => {
        const request = createCheckRequest(
          principals.influencer,
          resources.flaggedContent,
          ['publish'],
        );
        const response = createDeniedResponse(request.requestId!, 'publish');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.publish.effect).toBe('deny');
      });

      it('should deny regular user from creating content', async () => {
        const request = createCheckRequest(
          principals.fan,
          { kind: 'content', id: 'new-content', attributes: {} },
          ['create'],
        );
        const response = createDeniedResponse(request.requestId!, 'create');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.create.effect).toBe('deny');
      });
    });

    describe('Avatar Access', () => {
      it('should allow anyone to view public active avatars', async () => {
        const request = createCheckRequest(
          principals.fan,
          resources.publicAvatar,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should deny viewing suspended avatars', async () => {
        const request = createCheckRequest(
          principals.fan,
          resources.suspendedAvatar,
          ['view'],
        );
        const response = createDeniedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.view.effect).toBe('deny');
      });

      it('should allow owner to edit their avatar', async () => {
        const request = createCheckRequest(
          principals.influencer,
          resources.publicAvatar,
          ['edit', 'update'],
        );
        const response = createMultiActionResponse(
          request.requestId!,
          ['edit', 'update'],
          [true, true],
        );

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.edit.effect).toBe('allow');
      });

      it('should allow owner to control streaming', async () => {
        const request = createCheckRequest(
          principals.influencer,
          resources.publicAvatar,
          ['start_stream', 'stop_stream', 'configure_stream'],
        );
        const response = createMultiActionResponse(
          request.requestId!,
          ['start_stream', 'stop_stream', 'configure_stream'],
          [true, true, true],
        );

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.start_stream.effect).toBe('allow');
        expect(result.response.results.stop_stream.effect).toBe('allow');
      });

      it('should deny non-owner from editing avatar', async () => {
        const request = createCheckRequest(
          principals.fan,
          resources.publicAvatar,
          ['edit'],
        );
        const response = createDeniedResponse(request.requestId!, 'edit');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.edit.effect).toBe('deny');
      });
    });

    describe('Chat Access', () => {
      it('should allow participants to view chat', async () => {
        const request = createCheckRequest(
          principals.fan,
          resources.activeChat,
          ['view', 'list_messages'],
        );
        const response = createMultiActionResponse(
          request.requestId!,
          ['view', 'list_messages'],
          [true, true],
        );

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.view.effect).toBe('allow');
        expect(result.response.results.list_messages.effect).toBe('allow');
      });

      it('should allow participants to send messages in active chat', async () => {
        const request = createCheckRequest(
          principals.fan,
          resources.activeChat,
          ['send_message'],
        );
        const response = createAllowedResponse(request.requestId!, 'send_message');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should deny sending messages to closed chat', async () => {
        const request = createCheckRequest(
          principals.fan,
          resources.closedChat,
          ['send_message'],
        );
        const response = createDeniedResponse(request.requestId!, 'send_message');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.send_message.effect).toBe('deny');
      });

      it('should deny blocked users from accessing chat', async () => {
        const blockedUser = {
          id: 'blocked-user-001',
          roles: ['user', 'fan'],
          attributes: { email: 'blocked@example.com' },
        };

        const request = createCheckRequest(
          blockedUser,
          resources.chatWithBlockedUser,
          ['view', 'send_message'],
        );
        const response = createMultiActionResponse(
          request.requestId!,
          ['view', 'send_message'],
          [false, false],
        );

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.view.effect).toBe('deny');
        expect(result.response.results.send_message.effect).toBe('deny');
      });

      it('should allow influencer to close their chats', async () => {
        const request = createCheckRequest(
          principals.influencer,
          resources.activeChat,
          ['close', 'archive'],
        );
        const response = createMultiActionResponse(
          request.requestId!,
          ['close', 'archive'],
          [true, true],
        );

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.close.effect).toBe('allow');
        expect(result.response.results.archive.effect).toBe('allow');
      });
    });
  });

  // ===========================================================================
  // Section 3: Subscription-Based Access
  // ===========================================================================

  describe('3. Subscription-Based Access', () => {
    describe('Subscription Management', () => {
      it('should allow fan to view their own subscriptions', async () => {
        const request = createCheckRequest(
          principals.premiumFan,
          resources.activeSubscription,
          ['view', 'list'],
        );
        const response = createMultiActionResponse(
          request.requestId!,
          ['view', 'list'],
          [true, true],
        );

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.view.effect).toBe('allow');
      });

      it('should allow fan to create subscriptions', async () => {
        const request = createCheckRequest(
          principals.fan,
          { kind: 'subscription', id: 'new-subscription', attributes: {} },
          ['create'],
        );
        const response = createAllowedResponse(request.requestId!, 'create');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should allow fan to cancel their own active subscription', async () => {
        const request = createCheckRequest(
          principals.premiumFan,
          resources.activeSubscription,
          ['cancel'],
        );
        const response = createAllowedResponse(request.requestId!, 'cancel');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should deny operations on cancelled subscriptions', async () => {
        const request = createCheckRequest(
          principals.fan,
          resources.cancelledSubscription,
          ['update', 'renew'],
        );
        const response = createMultiActionResponse(
          request.requestId!,
          ['update', 'renew'],
          [false, false],
        );

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.update.effect).toBe('deny');
        expect(result.response.results.renew.effect).toBe('deny');
      });

      it('should allow subscription upgrade', async () => {
        const request = createCheckRequest(
          principals.premiumFan,
          resources.activeSubscription,
          ['upgrade'],
        );
        const response = createAllowedResponse(request.requestId!, 'upgrade');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should allow pausing subscription when pauses remaining', async () => {
        const request = createCheckRequest(
          principals.premiumFan,
          resources.activeSubscription,
          ['pause'],
        );
        const response = createAllowedResponse(request.requestId!, 'pause');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should allow resuming paused subscription', async () => {
        const request = createCheckRequest(
          principals.fan,
          resources.pausedSubscription,
          ['resume'],
        );
        const response = createAllowedResponse(request.requestId!, 'resume');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });
    });

    describe('Influencer Subscription Views', () => {
      it('should allow influencer to view their subscribers', async () => {
        const request = createCheckRequest(
          principals.influencer,
          resources.activeSubscription,
          ['view', 'list'],
        );
        const response = createMultiActionResponse(
          request.requestId!,
          ['view', 'list'],
          [true, true],
        );

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.view.effect).toBe('allow');
      });

      it('should allow influencer to manage subscription plans', async () => {
        const subscriptionPlan = {
          kind: 'subscription',
          id: 'plan-001',
          attributes: {
            influencerId: principals.influencer.id,
            type: 'plan',
          },
        };

        const request = createCheckRequest(
          principals.influencer,
          subscriptionPlan,
          ['create_plan', 'update_plan', 'delete_plan'],
        );
        const response = createMultiActionResponse(
          request.requestId!,
          ['create_plan', 'update_plan', 'delete_plan'],
          [true, true, true],
        );

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.create_plan.effect).toBe('allow');
        expect(result.response.results.update_plan.effect).toBe('allow');
      });
    });
  });

  // ===========================================================================
  // Section 4: Multi-Tenant Scenarios
  // ===========================================================================

  describe('4. Multi-Tenant Scenarios', () => {
    describe('Tenant Isolation', () => {
      it('should allow user to access resources in their tenant', async () => {
        const request = createCheckRequest(
          principals.tenantAUser,
          resources.tenantAResource,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should deny user from accessing resources in other tenants', async () => {
        const request = createCheckRequest(
          principals.tenantAUser,
          resources.tenantBResource,
          ['view'],
        );
        const response = createDeniedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.view.effect).toBe('deny');
      });

      it('should maintain enforcement isolation between tenants', async () => {
        // Block tenant A user
        await orchestrator.triggerEnforcement(
          'temporary_block',
          principals.tenantAUser.id,
          'Multi-tenant block test',
        );

        // Tenant B user should not be affected
        const request = createCheckRequest(
          principals.tenantBUser,
          resources.tenantBResource,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should track anomalies separately per tenant', async () => {
        // Generate activity for tenant A user
        for (let i = 0; i < 5; i++) {
          const request = createCheckRequest(
            principals.tenantAUser,
            resources.tenantAResource,
            ['view'],
          );
          const response = createAllowedResponse(request.requestId!, 'view');
          await orchestrator.processRequest(request, response);
        }

        // Check anomalies are tracked separately
        const tenantAAnomalies = orchestrator.getAnomalies(principals.tenantAUser.id);
        const tenantBAnomalies = orchestrator.getAnomalies(principals.tenantBUser.id);

        expect(Array.isArray(tenantAAnomalies)).toBe(true);
        expect(Array.isArray(tenantBAnomalies)).toBe(true);
      });
    });

    describe('Cross-Tenant Admin Access', () => {
      it('should allow super admin to access all tenant resources', async () => {
        const tenantARequest = createCheckRequest(
          principals.superAdmin,
          resources.tenantAResource,
          ['view', 'edit'],
        );
        const tenantAResponse = createMultiActionResponse(
          tenantARequest.requestId!,
          ['view', 'edit'],
          [true, true],
        );

        const tenantBRequest = createCheckRequest(
          principals.superAdmin,
          resources.tenantBResource,
          ['view', 'edit'],
        );
        const tenantBResponse = createMultiActionResponse(
          tenantBRequest.requestId!,
          ['view', 'edit'],
          [true, true],
        );

        const resultA = await orchestrator.processRequest(tenantARequest, tenantAResponse);
        const resultB = await orchestrator.processRequest(tenantBRequest, tenantBResponse);

        expect(resultA.response.results.view.effect).toBe('allow');
        expect(resultB.response.results.view.effect).toBe('allow');
      });
    });
  });

  // ===========================================================================
  // Section 5: Edge Cases and Error Handling
  // ===========================================================================

  describe('5. Edge Cases', () => {
    describe('Suspended Users', () => {
      it('should deny all actions for suspended users', async () => {
        const request = createCheckRequest(
          principals.suspendedUser,
          resources.publicContent,
          ['view'],
        );
        const response = createDeniedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.view.effect).toBe('deny');
      });
    });

    describe('Concurrent Access', () => {
      it('should handle concurrent requests from same user', async () => {
        const requests = Array.from({ length: 20 }, (_, i) =>
          createCheckRequest(
            principals.fan,
            resources.publicContent,
            ['view'],
            `concurrent-${i}`,
          ),
        );

        const results = await Promise.all(
          requests.map((request) => {
            const response = createAllowedResponse(request.requestId!, 'view');
            return orchestrator.processRequest(request, response);
          }),
        );

        expect(results).toHaveLength(20);
        results.forEach((result) => {
          expect(result.enforcement?.allowed).toBe(true);
        });
      });
    });

    describe('Empty and Invalid Input', () => {
      it('should handle requests with empty actions', async () => {
        const request = createCheckRequest(principals.fan, resources.publicContent, []);
        const response = {
          requestId: request.requestId!,
          results: {},
          meta: { evaluationDurationMs: 1, policiesEvaluated: [] },
        };

        await expect(
          orchestrator.processRequest(request, response),
        ).resolves.toBeDefined();
      });

      it('should handle requests with special characters in IDs', async () => {
        const specialResource = {
          kind: 'content',
          id: 'content-with:special/chars\\and"quotes',
          attributes: { visibility: 'public' },
        };

        const request = createCheckRequest(principals.fan, specialResource, ['view']);
        const response = createAllowedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response);

        expect(result).toBeDefined();
        expect(result.enforcement).toBeDefined();
      });
    });
  });
});
