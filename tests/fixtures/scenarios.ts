/**
 * Test Scenarios for Integration Tests
 *
 * Pre-built test scenarios with expected results
 */

import { principals, type Principal } from './principals';
import { resources, type Resource } from './resources';

// Local type definition to avoid package dependencies
export interface CheckRequest {
  requestId?: string;
  principal: Principal;
  resource: Resource;
  actions: string[];
  auxData?: Record<string, unknown>;
}

/**
 * Test scenario with expected result
 */
export interface TestScenario {
  name: string;
  description: string;
  request: CheckRequest;
  expectedResults: Record<string, 'allow' | 'deny'>;
  tags?: string[];
}

// =============================================================================
// Allowed Scenarios - Requests that should succeed
// =============================================================================

export const allowedScenarios: TestScenario[] = [
  {
    name: 'user-views-own-document',
    description: 'User viewing their own document should be allowed',
    request: {
      requestId: 'allowed-001',
      principal: principals.regularUser,
      resource: resources.publicDocument,
      actions: ['view'],
    },
    expectedResults: { view: 'allow' },
    tags: ['owner', 'basic'],
  },
  {
    name: 'owner-edits-own-document',
    description: 'Owner editing their own document should be allowed',
    request: {
      requestId: 'allowed-002',
      principal: principals.regularUser,
      resource: resources.publicDocument,
      actions: ['view', 'edit', 'delete'],
    },
    expectedResults: { view: 'allow', edit: 'allow', delete: 'allow' },
    tags: ['owner', 'full-access'],
  },
  {
    name: 'subscriber-views-premium-content',
    description: 'Active subscriber viewing standard premium content',
    request: {
      requestId: 'allowed-003',
      principal: principals.activeSubscriber,
      resource: resources.standardPremiumContent,
      actions: ['view'],
    },
    expectedResults: { view: 'allow' },
    tags: ['subscription', 'content'],
  },
  {
    name: 'premium-subscriber-views-exclusive',
    description: 'Premium subscriber viewing exclusive content',
    request: {
      requestId: 'allowed-004',
      principal: principals.premiumSubscriber,
      resource: resources.exclusivePremiumContent,
      actions: ['view', 'download'],
    },
    expectedResults: { view: 'allow', download: 'allow' },
    tags: ['subscription', 'exclusive'],
  },
  {
    name: 'admin-views-settings',
    description: 'Admin viewing admin settings',
    request: {
      requestId: 'allowed-005',
      principal: principals.adminUser,
      resource: resources.globalSettings,
      actions: ['view'],
    },
    expectedResults: { view: 'allow' },
    tags: ['admin', 'settings'],
  },
  {
    name: 'super-admin-edits-settings',
    description: 'Super admin editing admin settings',
    request: {
      requestId: 'allowed-006',
      principal: principals.superAdmin,
      resource: resources.globalSettings,
      actions: ['view', 'edit', 'configure'],
    },
    expectedResults: { view: 'allow', edit: 'allow', configure: 'allow' },
    tags: ['super-admin', 'settings'],
  },
  {
    name: 'finance-processes-payout',
    description: 'Finance team processing payouts',
    request: {
      requestId: 'allowed-007',
      principal: principals.financeUser,
      resource: resources.pendingPayout,
      actions: ['view', 'approve', 'process'],
    },
    expectedResults: { view: 'allow', approve: 'allow', process: 'allow' },
    tags: ['finance', 'payout'],
  },
  {
    name: 'influencer-views-own-payout',
    description: 'Influencer viewing their own payout',
    request: {
      requestId: 'allowed-008',
      principal: principals.influencer,
      resource: resources.pendingPayout,
      actions: ['view'],
    },
    expectedResults: { view: 'allow' },
    tags: ['owner', 'payout'],
  },
  {
    name: 'owner-manages-avatar',
    description: 'User managing their own avatar',
    request: {
      requestId: 'allowed-009',
      principal: principals.regularUser,
      resource: resources.userAvatar,
      actions: ['view', 'edit', 'customize'],
    },
    expectedResults: { view: 'allow', edit: 'allow', customize: 'allow' },
    tags: ['owner', 'avatar'],
  },
  {
    name: 'admin-bulk-operations',
    description: 'Admin performing bulk avatar operations',
    request: {
      requestId: 'allowed-010',
      principal: principals.adminUser,
      resource: resources.bulkAvatarOperation,
      actions: ['bulk-delete', 'bulk-export'],
    },
    expectedResults: { 'bulk-delete': 'allow', 'bulk-export': 'allow' },
    tags: ['admin', 'bulk'],
  },
];

// =============================================================================
// Denied Scenarios - Requests that should fail
// =============================================================================

export const deniedScenarios: TestScenario[] = [
  {
    name: 'user-views-premium-content',
    description: 'Regular user should not view premium content',
    request: {
      requestId: 'denied-001',
      principal: principals.regularUser,
      resource: resources.standardPremiumContent,
      actions: ['view', 'download'],
    },
    expectedResults: { view: 'deny', download: 'deny' },
    tags: ['subscription', 'denied'],
  },
  {
    name: 'user-edits-admin-settings',
    description: 'Regular user should not edit admin settings',
    request: {
      requestId: 'denied-002',
      principal: principals.regularUser,
      resource: resources.globalSettings,
      actions: ['view', 'edit'],
    },
    expectedResults: { view: 'deny', edit: 'deny' },
    tags: ['admin', 'denied'],
  },
  {
    name: 'user-deletes-others-document',
    description: 'User should not delete document owned by others',
    request: {
      requestId: 'denied-003',
      principal: principals.regularUser,
      resource: resources.privateDocument,
      actions: ['delete'],
    },
    expectedResults: { delete: 'deny' },
    tags: ['ownership', 'denied'],
  },
  {
    name: 'influencer-bulk-export',
    description: 'Influencer should not perform bulk payout export',
    request: {
      requestId: 'denied-004',
      principal: principals.influencer,
      resource: resources.pendingPayout,
      actions: ['bulk-export'],
    },
    expectedResults: { 'bulk-export': 'deny' },
    tags: ['finance', 'bulk', 'denied'],
  },
  {
    name: 'user-edits-others-avatar',
    description: 'User should not edit avatar owned by others',
    request: {
      requestId: 'denied-005',
      principal: principals.regularUser,
      resource: resources.influencerAvatar,
      actions: ['edit', 'customize'],
    },
    expectedResults: { edit: 'deny', customize: 'deny' },
    tags: ['ownership', 'avatar', 'denied'],
  },
  {
    name: 'expired-subscriber-premium',
    description: 'Expired subscriber should not access premium content',
    request: {
      requestId: 'denied-006',
      principal: principals.expiredSubscriber,
      resource: resources.standardPremiumContent,
      actions: ['view', 'download'],
    },
    expectedResults: { view: 'deny', download: 'deny' },
    tags: ['subscription', 'expired', 'denied'],
  },
  {
    name: 'guest-views-private',
    description: 'Guest should not view private documents',
    request: {
      requestId: 'denied-007',
      principal: principals.guestUser,
      resource: resources.privateDocument,
      actions: ['view'],
    },
    expectedResults: { view: 'deny' },
    tags: ['guest', 'denied'],
  },
  {
    name: 'admin-configures-settings',
    description: 'Regular admin should not configure global settings (super-admin only)',
    request: {
      requestId: 'denied-008',
      principal: principals.adminUser,
      resource: resources.globalSettings,
      actions: ['configure'],
    },
    expectedResults: { configure: 'deny' },
    tags: ['admin', 'super-admin', 'denied'],
  },
];

// =============================================================================
// Anomalous Scenarios - Suspicious patterns for GUARDIAN testing
// =============================================================================

export const anomalousScenarios: TestScenario[] = [
  {
    name: 'suspicious-user-rapid-access',
    description: 'Suspicious user with unusual access pattern',
    request: {
      requestId: 'anomaly-001',
      principal: principals.suspiciousUser,
      resource: resources.publicDocument,
      actions: ['view'],
    },
    expectedResults: { view: 'allow' },
    tags: ['anomaly', 'velocity'],
  },
  {
    name: 'bulk-operation-attempt',
    description: 'User attempting bulk operation (potential abuse)',
    request: {
      requestId: 'anomaly-002',
      principal: principals.regularUser,
      resource: resources.bulkAvatarOperation,
      actions: ['bulk-delete'],
    },
    expectedResults: { 'bulk-delete': 'deny' },
    tags: ['anomaly', 'bulk', 'abuse'],
  },
  {
    name: 'sensitive-resource-access',
    description: 'Regular user accessing sensitive admin resources',
    request: {
      requestId: 'anomaly-003',
      principal: principals.regularUser,
      resource: resources.globalSettings,
      actions: ['view'],
    },
    expectedResults: { view: 'deny' },
    tags: ['anomaly', 'sensitive'],
  },
  {
    name: 'finance-bulk-export',
    description: 'Finance user exporting all payout data (requires audit)',
    request: {
      requestId: 'anomaly-004',
      principal: principals.financeUser,
      resource: resources.largePayout,
      actions: ['bulk-export'],
    },
    expectedResults: { 'bulk-export': 'allow' },
    tags: ['anomaly', 'audit', 'finance'],
  },
];

// =============================================================================
// Edge Case Scenarios
// =============================================================================

export const edgeCaseScenarios: TestScenario[] = [
  {
    name: 'multiple-actions-mixed-results',
    description: 'Request with multiple actions having mixed allow/deny results',
    request: {
      requestId: 'edge-001',
      principal: principals.editor,
      resource: resources.publicDocument,
      actions: ['view', 'edit', 'delete'],
    },
    expectedResults: { view: 'allow', edit: 'allow', delete: 'deny' },
    tags: ['edge', 'mixed'],
  },
  {
    name: 'service-account-access',
    description: 'Service account with limited permissions',
    request: {
      requestId: 'edge-002',
      principal: principals.serviceAccount,
      resource: resources.publicDocument,
      actions: ['view'],
    },
    expectedResults: { view: 'deny' },
    tags: ['edge', 'service'],
  },
  {
    name: 'new-user-onboarding',
    description: 'New user during onboarding with unverified email',
    request: {
      requestId: 'edge-003',
      principal: principals.newUser,
      resource: resources.publicDocument,
      actions: ['view'],
    },
    expectedResults: { view: 'allow' },
    tags: ['edge', 'onboarding'],
  },
];

// =============================================================================
// Test Scenario Collections
// =============================================================================

export const testScenarios = {
  allowed: allowedScenarios,
  denied: deniedScenarios,
  anomalous: anomalousScenarios,
  edgeCases: edgeCaseScenarios,
  all: [...allowedScenarios, ...deniedScenarios, ...anomalousScenarios, ...edgeCaseScenarios],
};

/**
 * Get scenarios by tag
 */
export function getScenariosByTag(tag: string): TestScenario[] {
  return testScenarios.all.filter(s => s.tags?.includes(tag));
}

/**
 * Get scenarios for a specific resource kind
 */
export function getScenariosForResource(resourceKind: string): TestScenario[] {
  return testScenarios.all.filter(s => s.request.resource.kind === resourceKind);
}

/**
 * Create a custom test scenario
 */
export function createScenario(
  name: string,
  principal: typeof principals.regularUser,
  resource: typeof resources.publicDocument,
  actions: string[],
  expectedResults: Record<string, 'allow' | 'deny'>,
  description?: string,
  tags?: string[]
): TestScenario {
  return {
    name,
    description: description || `Test scenario: ${name}`,
    request: {
      requestId: `custom-${Date.now()}`,
      principal,
      resource,
      actions,
    },
    expectedResults,
    tags,
  };
}

export default testScenarios;
