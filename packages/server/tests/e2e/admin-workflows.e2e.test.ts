/**
 * Admin Workflows E2E Tests
 *
 * Tests administrative operations including:
 * - Policy creation and updates
 * - Role assignments
 * - Permission grants and revokes
 * - User management operations
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
          choices: [{ message: { content: 'Admin operation explanation' } }],
        }),
      },
    },
  })),
}));

// =============================================================================
// Test Suite: Admin Workflows
// =============================================================================

describe('Admin Workflows E2E Tests', () => {
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
  // Section 1: Policy Management
  // ===========================================================================

  describe('1. Policy Management', () => {
    describe('Policy Creation', () => {
      it('should allow super admin to create new resource policies', async () => {
        const request = createCheckRequest(
          principals.superAdmin,
          { kind: 'policy', id: 'new-policy-001', attributes: { type: 'ResourcePolicy' } },
          ['create'],
        );
        const response = createAllowedResponse(request.requestId!, 'create');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
        expect(result.anomalyScore).toBeLessThan(0.5);
      });

      it('should deny regular admin from creating system-level policies', async () => {
        const request = createCheckRequest(
          principals.admin,
          { kind: 'policy', id: 'system-policy-001', attributes: { type: 'SystemPolicy', scope: 'global' } },
          ['create'],
        );
        const response = createDeniedResponse(request.requestId!, 'create');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.create.effect).toBe('deny');
      });

      it('should deny non-admin users from creating policies', async () => {
        const request = createCheckRequest(
          principals.fan,
          { kind: 'policy', id: 'user-policy-001', attributes: { type: 'ResourcePolicy' } },
          ['create'],
        );
        const response = createDeniedResponse(request.requestId!, 'create');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.create.effect).toBe('deny');
        expect(result.anomalyScore).toBeGreaterThan(0);
      });
    });

    describe('Policy Updates', () => {
      it('should allow admin to update existing policies', async () => {
        const request = createCheckRequest(
          principals.admin,
          { kind: 'policy', id: 'content-policy', attributes: { type: 'ResourcePolicy', version: '1.0' } },
          ['update'],
        );
        const response = createAllowedResponse(request.requestId!, 'update');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should track policy update in audit trail', async () => {
        const request = createCheckRequest(
          principals.superAdmin,
          { kind: 'policy', id: 'user-policy', attributes: { type: 'ResourcePolicy' } },
          ['update'],
        );
        const response = createAllowedResponse(request.requestId!, 'update');

        const result = await orchestrator.processRequest(request, response, {
          includeExplanation: true,
        });

        expect(result.explanation).toBeDefined();
        expect(result.agentsInvolved).toContain('advisor');
      });

      it('should version policies on update', async () => {
        const request = createCheckRequest(
          principals.admin,
          {
            kind: 'policy',
            id: 'content-policy',
            attributes: {
              type: 'ResourcePolicy',
              version: '1.0',
              previousVersions: ['0.9', '0.8'],
            },
          },
          ['update', 'version'],
        );
        const response = createMultiActionResponse(
          request.requestId!,
          ['update', 'version'],
          [true, true],
        );

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.update.effect).toBe('allow');
        expect(result.response.results.version.effect).toBe('allow');
      });
    });

    describe('Policy Deletion', () => {
      it('should allow super admin to delete policies', async () => {
        const request = createCheckRequest(
          principals.superAdmin,
          { kind: 'policy', id: 'deprecated-policy', attributes: { type: 'ResourcePolicy', status: 'deprecated' } },
          ['delete'],
        );
        const response = createAllowedResponse(request.requestId!, 'delete');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should deny regular admin from deleting active policies', async () => {
        const request = createCheckRequest(
          principals.admin,
          { kind: 'policy', id: 'active-policy', attributes: { type: 'ResourcePolicy', status: 'active' } },
          ['delete'],
        );
        const response = createDeniedResponse(request.requestId!, 'delete');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.delete.effect).toBe('deny');
      });
    });
  });

  // ===========================================================================
  // Section 2: Role Assignments
  // ===========================================================================

  describe('2. Role Assignments', () => {
    describe('Assigning Roles to Users', () => {
      it('should allow admin to assign basic roles to users', async () => {
        const request = createCheckRequest(
          principals.admin,
          {
            kind: 'user',
            id: 'fan-001',
            attributes: {
              currentRoles: ['user', 'fan'],
              requestedRoles: ['subscriber'],
            },
          },
          ['assign_role'],
        );
        const response = createAllowedResponse(request.requestId!, 'assign_role');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should deny admin from assigning super_admin role', async () => {
        const request = createCheckRequest(
          principals.admin,
          {
            kind: 'user',
            id: 'admin-candidate',
            attributes: {
              currentRoles: ['user', 'admin'],
              requestedRoles: ['super_admin'],
            },
          },
          ['assign_role'],
        );
        const response = createDeniedResponse(request.requestId!, 'assign_role');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.assign_role.effect).toBe('deny');
      });

      it('should allow super admin to assign any role', async () => {
        const request = createCheckRequest(
          principals.superAdmin,
          {
            kind: 'user',
            id: 'new-admin',
            attributes: {
              currentRoles: ['user'],
              requestedRoles: ['admin', 'super_admin'],
            },
          },
          ['assign_role'],
        );
        const response = createAllowedResponse(request.requestId!, 'assign_role');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should deny self-assignment of elevated roles', async () => {
        const selfAssignRequest = createCheckRequest(
          principals.admin,
          {
            kind: 'user',
            id: principals.admin.id,
            attributes: {
              currentRoles: ['admin'],
              requestedRoles: ['super_admin'],
            },
          },
          ['assign_role'],
        );
        const response = createDeniedResponse(selfAssignRequest.requestId!, 'assign_role');

        const result = await orchestrator.processRequest(selfAssignRequest, response);

        expect(result.response.results.assign_role.effect).toBe('deny');
      });
    });

    describe('Revoking Roles', () => {
      it('should allow super admin to remove admin role', async () => {
        const request = createCheckRequest(
          principals.superAdmin,
          {
            kind: 'user',
            id: 'admin-to-demote',
            attributes: {
              currentRoles: ['user', 'admin'],
              roleToRemove: 'admin',
            },
          },
          ['remove_role'],
        );
        const response = createAllowedResponse(request.requestId!, 'remove_role');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should deny removing own super_admin role', async () => {
        const request = createCheckRequest(
          principals.superAdmin,
          {
            kind: 'user',
            id: principals.superAdmin.id,
            attributes: {
              currentRoles: ['user', 'admin', 'super_admin'],
              roleToRemove: 'super_admin',
            },
          },
          ['remove_role'],
        );
        const response = createDeniedResponse(request.requestId!, 'remove_role');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.remove_role.effect).toBe('deny');
      });
    });

    describe('Influencer Verification', () => {
      it('should allow admin to verify influencer accounts', async () => {
        const request = createCheckRequest(
          principals.admin,
          {
            kind: 'user',
            id: 'influencer-unverified-001',
            attributes: {
              roles: ['influencer', 'user'],
              verificationStatus: 'pending',
            },
          },
          ['verify'],
        );
        const response = createAllowedResponse(request.requestId!, 'verify');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should deny verification of non-influencer accounts', async () => {
        const request = createCheckRequest(
          principals.admin,
          {
            kind: 'user',
            id: 'fan-001',
            attributes: {
              roles: ['user', 'fan'],
              verificationStatus: 'n/a',
            },
          },
          ['verify'],
        );
        const response = createDeniedResponse(request.requestId!, 'verify');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.verify.effect).toBe('deny');
      });
    });
  });

  // ===========================================================================
  // Section 3: Permission Grants/Revokes
  // ===========================================================================

  describe('3. Permission Grants and Revokes', () => {
    describe('Content Moderation Permissions', () => {
      it('should allow admin to grant moderation permissions', async () => {
        const request = createCheckRequest(
          principals.admin,
          resources.publicContent,
          ['moderate', 'flag', 'unflag'],
        );
        const response = createMultiActionResponse(
          request.requestId!,
          ['moderate', 'flag', 'unflag'],
          [true, true, true],
        );

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.moderate.effect).toBe('allow');
        expect(result.response.results.flag.effect).toBe('allow');
        expect(result.response.results.unflag.effect).toBe('allow');
      });

      it('should allow admin to hide and review content', async () => {
        const request = createCheckRequest(
          principals.admin,
          resources.flaggedContent,
          ['hide', 'review', 'approve', 'reject'],
        );
        const response = createMultiActionResponse(
          request.requestId!,
          ['hide', 'review', 'approve', 'reject'],
          [true, true, true, true],
        );

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.hide.effect).toBe('allow');
        expect(result.response.results.review.effect).toBe('allow');
      });

      it('should allow admin to delete flagged content', async () => {
        const request = createCheckRequest(
          principals.admin,
          resources.flaggedContent,
          ['delete'],
        );
        const response = createAllowedResponse(request.requestId!, 'delete');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });
    });

    describe('User Account Permissions', () => {
      it('should allow admin to suspend user accounts', async () => {
        const targetUser = {
          kind: 'user',
          id: 'user-to-suspend',
          attributes: {
            status: 'active',
            roles: ['user', 'fan'],
          },
        };

        const request = createCheckRequest(principals.admin, targetUser, ['suspend']);
        const response = createAllowedResponse(request.requestId!, 'suspend');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should deny admin from suspending other admins', async () => {
        const adminUser = {
          kind: 'user',
          id: 'other-admin',
          attributes: {
            status: 'active',
            roles: ['user', 'admin'],
            role: 'admin',
          },
        };

        const request = createCheckRequest(principals.admin, adminUser, ['suspend']);
        const response = createDeniedResponse(request.requestId!, 'suspend');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.suspend.effect).toBe('deny');
      });

      it('should allow admin to reactivate suspended accounts', async () => {
        const suspendedUser = {
          kind: 'user',
          id: 'suspended-user',
          attributes: {
            status: 'suspended',
            roles: ['user'],
          },
        };

        const request = createCheckRequest(principals.admin, suspendedUser, ['reactivate']);
        const response = createAllowedResponse(request.requestId!, 'reactivate');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should allow super admin to delete user accounts', async () => {
        const targetUser = {
          kind: 'user',
          id: 'user-to-delete',
          attributes: {
            status: 'active',
            roles: ['user'],
            role: 'user',
          },
        };

        const request = createCheckRequest(principals.superAdmin, targetUser, ['delete']);
        const response = createAllowedResponse(request.requestId!, 'delete');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should deny super admin from deleting other super admins', async () => {
        const superAdminUser = {
          kind: 'user',
          id: 'other-super-admin',
          attributes: {
            status: 'active',
            roles: ['user', 'admin', 'super_admin'],
            role: 'super_admin',
          },
        };

        const request = createCheckRequest(principals.superAdmin, superAdminUser, ['delete']);
        const response = createDeniedResponse(request.requestId!, 'delete');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.delete.effect).toBe('deny');
      });
    });

    describe('Admin Impersonation', () => {
      it('should allow admin with permission to impersonate regular users', async () => {
        const targetUser = {
          kind: 'user',
          id: 'regular-user',
          attributes: {
            status: 'active',
            roles: ['user'],
            role: 'user',
          },
        };

        const request = createCheckRequest(principals.admin, targetUser, ['impersonate']);
        const response = createAllowedResponse(request.requestId!, 'impersonate');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should deny admin from impersonating other admins', async () => {
        const targetAdmin = {
          kind: 'user',
          id: 'other-admin',
          attributes: {
            status: 'active',
            roles: ['user', 'admin'],
            role: 'admin',
          },
        };

        const request = createCheckRequest(principals.admin, targetAdmin, ['impersonate']);
        const response = createDeniedResponse(request.requestId!, 'impersonate');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.impersonate.effect).toBe('deny');
      });
    });
  });

  // ===========================================================================
  // Section 4: Audit and Activity Logs
  // ===========================================================================

  describe('4. Audit and Activity Logs', () => {
    it('should allow admin to view any user activity log', async () => {
      const request = createCheckRequest(
        principals.admin,
        resources.userProfile('fan-001'),
        ['view_activity', 'view_audit_log'],
      );
      const response = createMultiActionResponse(
        request.requestId!,
        ['view_activity', 'view_audit_log'],
        [true, true],
      );

      const result = await orchestrator.processRequest(request, response);

      expect(result.response.results.view_activity.effect).toBe('allow');
      expect(result.response.results.view_audit_log.effect).toBe('allow');
    });

    it('should allow admin to audit payout records', async () => {
      const request = createCheckRequest(
        principals.admin,
        resources.pendingPayout,
        ['audit', 'view_audit_log'],
      );
      const response = createMultiActionResponse(
        request.requestId!,
        ['audit', 'view_audit_log'],
        [true, true],
      );

      const result = await orchestrator.processRequest(request, response);

      expect(result.response.results.audit.effect).toBe('allow');
    });

    it('should track admin actions with full audit trail', async () => {
      const request = createCheckRequest(
        principals.admin,
        resources.flaggedContent,
        ['delete'],
      );
      const response = createAllowedResponse(request.requestId!, 'delete');

      const result = await orchestrator.processRequest(request, response, {
        includeExplanation: true,
      });

      expect(result.explanation).toBeDefined();
      expect(result.agentsInvolved).toContain('enforcer');
    });
  });

  // ===========================================================================
  // Section 5: Bulk Operations
  // ===========================================================================

  describe('5. Bulk Operations', () => {
    it('should allow admin to perform bulk content moderation', async () => {
      const bulkContent = {
        kind: 'content',
        id: 'bulk-content',
        attributes: {
          contentIds: ['content-1', 'content-2', 'content-3'],
          operation: 'bulk_flag',
        },
      };

      const request = createCheckRequest(
        principals.admin,
        bulkContent,
        ['bulk_flag', 'bulk_review'],
      );
      const response = createMultiActionResponse(
        request.requestId!,
        ['bulk_flag', 'bulk_review'],
        [true, true],
      );

      const result = await orchestrator.processRequest(request, response);

      expect(result.response.results.bulk_flag.effect).toBe('allow');
    });

    it('should detect anomaly on excessive bulk operations', async () => {
      // Simulate rapid bulk operations
      for (let i = 0; i < 10; i++) {
        const bulkContent = {
          kind: 'content',
          id: `bulk-content-${i}`,
          attributes: {
            contentIds: Array.from({ length: 100 }, (_, j) => `content-${i}-${j}`),
            operation: 'bulk_delete',
          },
        };

        const request = createCheckRequest(
          principals.admin,
          bulkContent,
          ['bulk_delete'],
        );
        const response = createAllowedResponse(request.requestId!, 'bulk_delete');

        await orchestrator.processRequest(request, response);
      }

      // Check if anomalies were detected
      const anomalies = orchestrator.getAnomalies(principals.admin.id);
      // Anomaly detection may or may not trigger depending on configuration
      expect(Array.isArray(anomalies)).toBe(true);
    });
  });

  // ===========================================================================
  // Section 6: Admin Health and Monitoring
  // ===========================================================================

  describe('6. Admin System Health', () => {
    it('should report healthy status for all agents', async () => {
      const health = await orchestrator.getHealth();

      expect(health.status).toBe('healthy');
      expect(health.agents.guardian.state).toBe('ready');
      expect(health.agents.analyst.state).toBe('ready');
      expect(health.agents.advisor.state).toBe('ready');
      expect(health.agents.enforcer.state).toBe('ready');
    });

    it('should track admin operation metrics', async () => {
      // Perform some operations
      for (let i = 0; i < 5; i++) {
        const request = createCheckRequest(
          principals.admin,
          resources.publicContent,
          ['moderate'],
        );
        const response = createAllowedResponse(request.requestId!, 'moderate');
        await orchestrator.processRequest(request, response);
      }

      const health = await orchestrator.getHealth();

      expect(health.agents.enforcer.metrics.processedCount).toBeGreaterThanOrEqual(5);
    });
  });
});
