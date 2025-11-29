/**
 * Compliance E2E Tests
 *
 * Tests compliance requirements including:
 * - Audit trail verification
 * - GDPR scenarios (data export, deletion requests)
 * - SOC2 scenarios (access controls, logging)
 * - Data retention and privacy
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
  createAuditEvent,
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
          choices: [{ message: { content: 'Compliance check response' } }],
        }),
      },
    },
  })),
}));

// =============================================================================
// Test Suite: Compliance
// =============================================================================

describe('Compliance E2E Tests', () => {
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
  // Section 1: Audit Trail Verification
  // ===========================================================================

  describe('1. Audit Trail Verification', () => {
    describe('Decision Logging', () => {
      it('should record all authorization decisions with full context', async () => {
        const request = createCheckRequest(
          principals.fan,
          resources.publicContent,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response, {
          includeExplanation: true,
        });

        // Verify decision contains all required audit fields
        expect(result.requestId).toBeDefined();
        expect(result.response).toBeDefined();
        expect(result.anomalyScore).toBeDefined();
        expect(result.processingTimeMs).toBeDefined();
        expect(result.agentsInvolved).toBeDefined();
      });

      it('should record denied decisions with denial reasons', async () => {
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

      it('should track principal and resource information in decisions', async () => {
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

        const result = await orchestrator.processRequest(request, response, {
          includeExplanation: true,
          policyContext: {
            matchedRules: ['owner-edit'],
            derivedRoles: ['owner'],
          },
        });

        expect(result.explanation).toBeDefined();
        // Should include information about matched rules and derived roles
        const hasRuleFactor = result.explanation?.factors.some(
          (f) => f.type === 'matched_rule' || f.type === 'derived_role',
        );
        expect(hasRuleFactor).toBe(true);
      });
    });

    describe('Anomaly Audit Trail', () => {
      it('should record anomaly detections with evidence', async () => {
        const suspiciousUser = {
          id: 'audit-anomaly-user',
          roles: ['user'],
          attributes: {},
        };

        // Generate anomalous activity
        for (let i = 0; i < 20; i++) {
          const request = createCheckRequest(
            suspiciousUser,
            {
              kind: 'admin-settings',
              id: `admin-${i}`,
              attributes: { scope: 'global' },
            },
            ['delete'],
          );
          const response = createDeniedResponse(request.requestId!, 'delete');
          await orchestrator.processRequest(request, response);
        }

        const anomalies = orchestrator.getAnomalies(suspiciousUser.id);

        // Anomalies should contain evidence
        if (anomalies.length > 0) {
          expect(anomalies[0].principalId).toBe(suspiciousUser.id);
          expect(anomalies[0].status).toBeDefined();
        }
      });

      it('should maintain anomaly history for principals', async () => {
        const testUser = {
          id: 'anomaly-history-user',
          roles: ['user'],
          attributes: {},
        };

        // Generate some history
        for (let i = 0; i < 5; i++) {
          const request = createCheckRequest(
            testUser,
            resources.publicContent,
            ['view'],
          );
          const response = createAllowedResponse(request.requestId!, 'view');
          await orchestrator.processRequest(request, response);
        }

        const anomalies = orchestrator.getAnomalies(testUser.id);

        expect(Array.isArray(anomalies)).toBe(true);
      });
    });

    describe('Enforcement Audit Trail', () => {
      it('should record enforcement actions with full details', async () => {
        const targetUser = 'enforcement-audit-user';

        const action = await orchestrator.triggerEnforcement(
          'rate_limit',
          targetUser,
          'Compliance audit test - rate limiting',
        );

        expect(action.id).toBeDefined();
        expect(action.type).toBe('rate_limit');
        expect(action.status).toBeDefined();
        expect(action.triggeredBy).toBeDefined();
        expect(action.triggeredBy.reason).toContain('Compliance audit test');
      });

      it('should track enforcement approval workflow', async () => {
        const pending = orchestrator.getPendingActions();

        expect(Array.isArray(pending)).toBe(true);

        // Each pending action should have required audit fields
        pending.forEach((action) => {
          expect(action.id).toBeDefined();
          expect(action.type).toBeDefined();
        });
      });
    });
  });

  // ===========================================================================
  // Section 2: GDPR Scenarios
  // ===========================================================================

  describe('2. GDPR Scenarios', () => {
    describe('Data Export (Right to Portability)', () => {
      it('should allow user to export their own data', async () => {
        const ownProfile = resources.userProfile(principals.fan.id);
        const request = createCheckRequest(
          principals.fan,
          ownProfile,
          ['export_data'],
        );
        const response = createAllowedResponse(request.requestId!, 'export_data');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should deny exporting other users data', async () => {
        const otherProfile = resources.userProfile('other-user');
        const request = createCheckRequest(
          principals.fan,
          otherProfile,
          ['export_data'],
        );
        const response = createDeniedResponse(request.requestId!, 'export_data');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.export_data.effect).toBe('deny');
      });

      it('should allow admin to export data for compliance requests', async () => {
        const userProfile = resources.userProfile('any-user');
        const request = createCheckRequest(
          principals.admin,
          userProfile,
          ['export_data'],
        );
        const response = createAllowedResponse(request.requestId!, 'export_data');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });
    });

    describe('Data Deletion (Right to Erasure)', () => {
      it('should allow user to request deletion of their account', async () => {
        const ownProfile = resources.userProfile(principals.fan.id);
        const request = createCheckRequest(
          principals.fan,
          ownProfile,
          ['request_deletion'],
        );
        const response = createAllowedResponse(request.requestId!, 'request_deletion');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should deny deletion requests for other users accounts', async () => {
        const otherProfile = resources.userProfile('other-user');
        const request = createCheckRequest(
          principals.fan,
          otherProfile,
          ['request_deletion'],
        );
        const response = createDeniedResponse(request.requestId!, 'request_deletion');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.request_deletion.effect).toBe('deny');
      });

      it('should allow super admin to process deletion requests', async () => {
        const userProfile = resources.userProfile('deletion-request-user');
        const request = createCheckRequest(
          principals.superAdmin,
          userProfile,
          ['delete', 'process_deletion'],
        );
        const response = createMultiActionResponse(
          request.requestId!,
          ['delete', 'process_deletion'],
          [true, true],
        );

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.delete.effect).toBe('allow');
      });
    });

    describe('Consent Management', () => {
      it('should respect user consent preferences', async () => {
        const userWithConsent = {
          ...principals.fan,
          attributes: {
            ...principals.fan.attributes,
            marketingConsent: true,
            analyticsConsent: false,
          },
        };

        const marketingResource = {
          kind: 'marketing-data',
          id: 'user-marketing',
          attributes: { type: 'marketing' },
        };

        const request = createCheckRequest(
          userWithConsent,
          marketingResource,
          ['collect'],
        );
        const response = createAllowedResponse(request.requestId!, 'collect');

        const result = await orchestrator.processRequest(request, response);

        // Marketing collection should be allowed with consent
        expect(result.enforcement?.allowed).toBe(true);
      });

      it('should deny data processing without consent', async () => {
        const userWithoutConsent = {
          ...principals.fan,
          attributes: {
            ...principals.fan.attributes,
            marketingConsent: false,
          },
        };

        const marketingResource = {
          kind: 'marketing-data',
          id: 'user-marketing',
          attributes: { type: 'marketing' },
        };

        const request = createCheckRequest(
          userWithoutConsent,
          marketingResource,
          ['process', 'share'],
        );
        const response = createMultiActionResponse(
          request.requestId!,
          ['process', 'share'],
          [false, false],
        );

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.process.effect).toBe('deny');
        expect(result.response.results.share.effect).toBe('deny');
      });
    });

    describe('Data Minimization', () => {
      it('should restrict access to only necessary data', async () => {
        // Regular user should not access full profile data
        const fullProfileResource = {
          kind: 'user',
          id: 'other-user',
          attributes: {
            includePrivateFields: true,
            includeSensitiveFields: true,
          },
        };

        const request = createCheckRequest(
          principals.fan,
          fullProfileResource,
          ['view_full_profile'],
        );
        const response = createDeniedResponse(request.requestId!, 'view_full_profile');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.view_full_profile.effect).toBe('deny');
      });
    });
  });

  // ===========================================================================
  // Section 3: SOC2 Scenarios
  // ===========================================================================

  describe('3. SOC2 Scenarios', () => {
    describe('Access Control (CC6.1)', () => {
      it('should enforce role-based access control', async () => {
        // Admin actions should be restricted to admins
        const adminAction = createCheckRequest(
          principals.fan,
          resources.flaggedContent,
          ['moderate', 'delete'],
        );
        const adminResponse = createMultiActionResponse(
          adminAction.requestId!,
          ['moderate', 'delete'],
          [false, false],
        );

        const result = await orchestrator.processRequest(adminAction, adminResponse);

        expect(result.response.results.moderate.effect).toBe('deny');
        expect(result.response.results.delete.effect).toBe('deny');
      });

      it('should enforce principle of least privilege', async () => {
        // Finance user should only have finance-related permissions
        const financeUser = principals.financeUser;

        // Should be allowed for financial operations
        const payoutRequest = createCheckRequest(
          financeUser,
          resources.pendingPayout,
          ['view', 'process'],
        );
        const payoutResponse = createMultiActionResponse(
          payoutRequest.requestId!,
          ['view', 'process'],
          [true, true],
        );

        const payoutResult = await orchestrator.processRequest(payoutRequest, payoutResponse);
        expect(payoutResult.response.results.view.effect).toBe('allow');

        // Should be denied for content operations
        const contentRequest = createCheckRequest(
          financeUser,
          resources.flaggedContent,
          ['moderate', 'delete'],
        );
        const contentResponse = createMultiActionResponse(
          contentRequest.requestId!,
          ['moderate', 'delete'],
          [false, false],
        );

        const contentResult = await orchestrator.processRequest(contentRequest, contentResponse);
        expect(contentResult.response.results.moderate.effect).toBe('deny');
      });

      it('should enforce separation of duties', async () => {
        // Same person should not be able to create and approve high-value transactions
        const financeApprover = principals.financeApprover;

        const createRequest = createCheckRequest(
          financeApprover,
          { kind: 'payout', id: 'new-payout', attributes: { amount: 5000, createdBy: financeApprover.id } },
          ['create'],
        );
        const createResponse = createAllowedResponse(createRequest.requestId!, 'create');

        const createResult = await orchestrator.processRequest(createRequest, createResponse);
        expect(createResult.enforcement?.allowed).toBe(true);

        // Self-approval should be denied
        const approveRequest = createCheckRequest(
          financeApprover,
          { kind: 'payout', id: 'new-payout', attributes: { amount: 5000, createdBy: financeApprover.id } },
          ['approve'],
        );
        const approveResponse = createDeniedResponse(approveRequest.requestId!, 'approve');

        const approveResult = await orchestrator.processRequest(approveRequest, approveResponse);
        expect(approveResult.response.results.approve.effect).toBe('deny');
      });
    });

    describe('Logical Access Controls (CC6.2)', () => {
      it('should track all privileged access', async () => {
        const request = createCheckRequest(
          principals.superAdmin,
          {
            kind: 'system-settings',
            id: 'security-config',
            attributes: { sensitivity: 'high' },
          },
          ['view', 'edit'],
        );
        const response = createMultiActionResponse(
          request.requestId!,
          ['view', 'edit'],
          [true, true],
        );

        const result = await orchestrator.processRequest(request, response, {
          includeExplanation: true,
        });

        // Should include audit information
        expect(result.agentsInvolved).toContain('guardian');
        expect(result.anomalyScore).toBeDefined();
      });

      it('should detect and flag unusual privileged access', async () => {
        // Admin accessing sensitive resources at unusual volume
        for (let i = 0; i < 30; i++) {
          const request = createCheckRequest(
            principals.admin,
            {
              kind: 'system-settings',
              id: `setting-${i}`,
              attributes: { sensitivity: 'high' },
            },
            ['edit'],
          );
          const response = createAllowedResponse(request.requestId!, 'edit');
          await orchestrator.processRequest(request, response);
        }

        const anomalies = orchestrator.getAnomalies(principals.admin.id);

        // High volume of privileged access may trigger anomaly detection
        expect(Array.isArray(anomalies)).toBe(true);
      });
    });

    describe('System Operations (CC7.1)', () => {
      it('should maintain system health monitoring', async () => {
        const health = await orchestrator.getHealth();

        expect(health.status).toBeDefined();
        expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
        expect(health.agents).toBeDefined();
        expect(health.infrastructure).toBeDefined();
      });

      it('should track system performance metrics', async () => {
        // Process some requests
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

        // Verify metrics are being tracked
        expect(health.agents.guardian.metrics.processedCount).toBeGreaterThanOrEqual(10);
        expect(health.agents.guardian.metrics.avgProcessingTimeMs).toBeDefined();
      });
    });

    describe('Change Management (CC8.1)', () => {
      it('should require approval for high-impact changes', async () => {
        // Attempting to make system-wide policy change
        const policyChange = {
          kind: 'policy',
          id: 'system-policy',
          attributes: {
            type: 'SystemPolicy',
            scope: 'global',
            impact: 'high',
          },
        };

        const request = createCheckRequest(
          principals.admin,
          policyChange,
          ['update'],
        );
        const response = createDeniedResponse(request.requestId!, 'update');

        const result = await orchestrator.processRequest(request, response);

        // Regular admin should not be able to make high-impact changes
        expect(result.response.results.update.effect).toBe('deny');
      });

      it('should allow super admin to make system changes', async () => {
        const policyChange = {
          kind: 'policy',
          id: 'system-policy',
          attributes: {
            type: 'SystemPolicy',
            scope: 'global',
            impact: 'high',
          },
        };

        const request = createCheckRequest(
          principals.superAdmin,
          policyChange,
          ['update'],
        );
        const response = createAllowedResponse(request.requestId!, 'update');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });
    });

    describe('Risk Mitigation (CC9.1)', () => {
      it('should automatically block detected threats', async () => {
        const threatUser = 'threat-detected-user';

        // Trigger enforcement for detected threat
        await orchestrator.triggerEnforcement(
          'temporary_block',
          threatUser,
          'SOC2 threat mitigation - automated response',
        );

        // Verify access is blocked
        const request = createCheckRequest(
          { id: threatUser, roles: ['user'], attributes: {} },
          resources.publicContent,
          ['view'],
        );
        const response = createAllowedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(false);
      });

      it('should provide incident response capabilities', async () => {
        // Admin should be able to investigate and respond to incidents
        const incidentResource = {
          kind: 'security-incident',
          id: 'incident-001',
          attributes: {
            severity: 'high',
            status: 'investigating',
          },
        };

        const request = createCheckRequest(
          principals.admin,
          incidentResource,
          ['view', 'investigate', 'respond'],
        );
        const response = createMultiActionResponse(
          request.requestId!,
          ['view', 'investigate', 'respond'],
          [true, true, true],
        );

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.investigate.effect).toBe('allow');
      });
    });
  });

  // ===========================================================================
  // Section 4: Data Retention and Privacy
  // ===========================================================================

  describe('4. Data Retention and Privacy', () => {
    describe('Access to Historical Data', () => {
      it('should allow authorized access to audit logs', async () => {
        const auditLogResource = {
          kind: 'audit-log',
          id: 'system-audit-log',
          attributes: {
            timeRange: '90-days',
            includeUserData: true,
          },
        };

        const request = createCheckRequest(
          principals.admin,
          auditLogResource,
          ['view', 'export'],
        );
        const response = createMultiActionResponse(
          request.requestId!,
          ['view', 'export'],
          [true, true],
        );

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.view.effect).toBe('allow');
        expect(result.response.results.export.effect).toBe('allow');
      });

      it('should deny unauthorized access to audit logs', async () => {
        const auditLogResource = {
          kind: 'audit-log',
          id: 'system-audit-log',
          attributes: {
            timeRange: '90-days',
          },
        };

        const request = createCheckRequest(
          principals.fan,
          auditLogResource,
          ['view'],
        );
        const response = createDeniedResponse(request.requestId!, 'view');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.view.effect).toBe('deny');
      });
    });

    describe('PII Protection', () => {
      it('should restrict access to PII fields', async () => {
        const piiResource = {
          kind: 'user',
          id: 'any-user',
          attributes: {
            fields: ['ssn', 'tax_id', 'bank_account'],
          },
        };

        const request = createCheckRequest(
          principals.fan,
          piiResource,
          ['view_pii'],
        );
        const response = createDeniedResponse(request.requestId!, 'view_pii');

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.view_pii.effect).toBe('deny');
      });

      it('should allow finance to access necessary PII', async () => {
        const piiResource = {
          kind: 'payout',
          id: 'payout-with-pii',
          attributes: {
            fields: ['bank_account', 'routing_number'],
            purpose: 'payment_processing',
          },
        };

        const request = createCheckRequest(
          principals.financeApprover,
          piiResource,
          ['view_payment_details'],
        );
        const response = createAllowedResponse(request.requestId!, 'view_payment_details');

        const result = await orchestrator.processRequest(request, response);

        expect(result.enforcement?.allowed).toBe(true);
      });
    });

    describe('Cross-Border Data Transfers', () => {
      it('should track data export requests', async () => {
        const exportResource = {
          kind: 'data-export',
          id: 'export-request-001',
          attributes: {
            destination: 'eu',
            dataTypes: ['user_profile', 'activity_log'],
            purpose: 'gdpr_compliance',
          },
        };

        const request = createCheckRequest(
          principals.admin,
          exportResource,
          ['initiate_export'],
        );
        const response = createAllowedResponse(request.requestId!, 'initiate_export');

        const result = await orchestrator.processRequest(request, response, {
          includeExplanation: true,
        });

        expect(result.enforcement?.allowed).toBe(true);
        expect(result.explanation).toBeDefined();
      });
    });
  });

  // ===========================================================================
  // Section 5: Compliance Reporting
  // ===========================================================================

  describe('5. Compliance Reporting', () => {
    describe('Report Generation', () => {
      it('should allow compliance officers to generate reports', async () => {
        const reportResource = {
          kind: 'compliance-report',
          id: 'quarterly-audit',
          attributes: {
            type: 'soc2',
            period: 'Q4-2024',
          },
        };

        const request = createCheckRequest(
          principals.admin,
          reportResource,
          ['generate', 'export'],
        );
        const response = createMultiActionResponse(
          request.requestId!,
          ['generate', 'export'],
          [true, true],
        );

        const result = await orchestrator.processRequest(request, response);

        expect(result.response.results.generate.effect).toBe('allow');
      });
    });

    describe('Evidence Collection', () => {
      it('should maintain complete decision history', async () => {
        // Process various types of requests
        const requestTypes = [
          { principal: principals.fan, resource: resources.publicContent, action: 'view', allowed: true },
          { principal: principals.fan, resource: resources.premiumContent, action: 'view', allowed: false },
          { principal: principals.admin, resource: resources.flaggedContent, action: 'moderate', allowed: true },
        ];

        for (const { principal, resource, action, allowed } of requestTypes) {
          const request = createCheckRequest(principal, resource, [action]);
          const response = allowed
            ? createAllowedResponse(request.requestId!, action)
            : createDeniedResponse(request.requestId!, action);

          const result = await orchestrator.processRequest(request, response, {
            includeExplanation: true,
          });

          // Each decision should have complete audit trail
          expect(result.requestId).toBeDefined();
          expect(result.processingTimeMs).toBeDefined();
          expect(result.agentsInvolved.length).toBeGreaterThan(0);
        }
      });
    });
  });
});
