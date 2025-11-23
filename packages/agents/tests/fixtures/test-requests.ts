/**
 * Test Request Fixtures for Agentic Authorization Integration Tests
 *
 * These fixtures provide sample requests and responses for testing scenarios.
 */

import type { CheckRequest, Principal, Resource } from '@authz-engine/core';

// =============================================================================
// Principal Fixtures
// =============================================================================

export const principals: Record<string, Principal> = {
  regularUser: {
    id: 'user-123',
    roles: ['user'],
    attributes: {
      email: 'user@example.com',
      department: 'engineering',
    },
  },
  subscriber: {
    id: 'subscriber-456',
    roles: ['subscriber', 'user'],
    attributes: {
      email: 'subscriber@example.com',
      subscriptionTier: 'premium',
    },
  },
  admin: {
    id: 'admin-789',
    roles: ['admin', 'user'],
    attributes: {
      email: 'admin@example.com',
      department: 'operations',
    },
  },
  superAdmin: {
    id: 'superadmin-001',
    roles: ['super-admin', 'admin', 'user'],
    attributes: {
      email: 'superadmin@example.com',
    },
  },
  influencer: {
    id: 'influencer-100',
    roles: ['influencer', 'user'],
    attributes: {
      email: 'influencer@example.com',
      followerCount: 50000,
    },
  },
  financeUser: {
    id: 'finance-200',
    roles: ['finance', 'user'],
    attributes: {
      email: 'finance@example.com',
      department: 'finance',
    },
  },
  suspiciousUser: {
    id: 'suspicious-999',
    roles: ['user'],
    attributes: {
      email: 'suspicious@example.com',
      recentFailedLogins: 10,
    },
  },
};

// =============================================================================
// Resource Fixtures
// =============================================================================

export const resources: Record<string, Resource> = {
  publicDocument: {
    kind: 'document',
    id: 'doc-001',
    attributes: {
      visibility: 'public',
      ownerId: 'user-123',
    },
  },
  privateDocument: {
    kind: 'document',
    id: 'doc-002',
    attributes: {
      visibility: 'private',
      ownerId: 'user-999',
    },
  },
  premiumContent: {
    kind: 'premium-content',
    id: 'content-001',
    attributes: {
      tier: 'premium',
      category: 'exclusive',
    },
  },
  userAvatar: {
    kind: 'avatar',
    id: 'avatar-001',
    attributes: {
      ownerId: 'user-123',
      style: 'cartoon',
    },
  },
  otherUserAvatar: {
    kind: 'avatar',
    id: 'avatar-002',
    attributes: {
      ownerId: 'influencer-100',
      style: 'realistic',
    },
  },
  adminSettings: {
    kind: 'admin-settings',
    id: 'settings-001',
    attributes: {
      scope: 'global',
    },
  },
  payout: {
    kind: 'payout',
    id: 'payout-001',
    attributes: {
      amount: 1000,
      recipientId: 'influencer-100',
      status: 'pending',
    },
  },
};

// =============================================================================
// Request Factories
// =============================================================================

export function createCheckRequest(
  principal: Principal,
  resource: Resource,
  actions: string[],
  requestId?: string,
): CheckRequest {
  return {
    requestId: requestId || `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    principal,
    resource,
    actions,
  };
}

// =============================================================================
// Standard Test Scenarios
// =============================================================================

export const testScenarios = {
  // Normal operations that should be allowed
  allowed: {
    userViewsOwnDocument: createCheckRequest(
      principals.regularUser,
      resources.publicDocument,
      ['view'],
    ),
    subscriberViewsPremiumContent: createCheckRequest(
      principals.subscriber,
      resources.premiumContent,
      ['view'],
    ),
    adminViewsSettings: createCheckRequest(
      principals.superAdmin,
      resources.adminSettings,
      ['view'],
    ),
    ownerEditsOwnAvatar: createCheckRequest(
      principals.regularUser,
      resources.userAvatar,
      ['edit'],
    ),
    financeProcessesPayout: createCheckRequest(
      principals.financeUser,
      resources.payout,
      ['process'],
    ),
  },

  // Operations that should be denied
  denied: {
    userViewsPremiumContent: createCheckRequest(
      principals.regularUser,
      resources.premiumContent,
      ['view'],
    ),
    userEditsAdminSettings: createCheckRequest(
      principals.regularUser,
      resources.adminSettings,
      ['edit'],
    ),
    userDeletesOthersDocument: createCheckRequest(
      principals.regularUser,
      resources.privateDocument,
      ['delete'],
    ),
    influencerBulkExport: createCheckRequest(
      principals.influencer,
      resources.payout,
      ['bulk-export'],
    ),
    nonOwnerEditsAvatar: createCheckRequest(
      principals.regularUser,
      resources.otherUserAvatar,
      ['edit'],
    ),
  },

  // Anomalous/suspicious patterns
  anomalous: {
    rapidRequests: createCheckRequest(
      principals.suspiciousUser,
      resources.publicDocument,
      ['view'],
    ),
    bulkOperation: createCheckRequest(
      principals.regularUser,
      { kind: 'avatar', id: 'bulk', attributes: {} },
      ['bulk-delete'],
    ),
    sensitiveResourceAccess: createCheckRequest(
      principals.regularUser,
      resources.adminSettings,
      ['view'],
    ),
    payoutExport: createCheckRequest(
      principals.regularUser,
      resources.payout,
      ['bulk-export'],
    ),
  },
};

// =============================================================================
// Response Factories
// =============================================================================

export function createAllowedResponse(requestId: string, action: string) {
  return {
    requestId,
    results: {
      [action]: { effect: 'allow' as const, policy: 'test-policy', meta: { matchedRule: 'test-allow-rule' } },
    },
    meta: {
      evaluationDurationMs: 5,
      policiesEvaluated: ['test-policy'],
    },
  };
}

export function createDeniedResponse(requestId: string, action: string) {
  return {
    requestId,
    results: {
      [action]: { effect: 'deny' as const, policy: 'test-policy', meta: { matchedRule: 'test-deny-rule' } },
    },
    meta: {
      evaluationDurationMs: 3,
      policiesEvaluated: ['test-policy'],
    },
  };
}

export function createMultiActionResponse(
  requestId: string,
  actions: string[],
  allowed: boolean[],
) {
  const results: Record<string, { effect: 'allow' | 'deny'; policy: string; meta: { matchedRule: string } }> = {};
  actions.forEach((action, index) => {
    results[action] = {
      effect: (allowed[index] ?? false) ? 'allow' : 'deny',
      policy: 'test-policy',
      meta: { matchedRule: (allowed[index] ?? false) ? 'test-allow-rule' : 'test-deny-rule' },
    };
  });

  return {
    requestId,
    results,
    meta: {
      evaluationDurationMs: actions.length * 2,
      policiesEvaluated: ['test-policy'],
    },
  };
}

export default {
  principals,
  resources,
  createCheckRequest,
  testScenarios,
  createAllowedResponse,
  createDeniedResponse,
  createMultiActionResponse,
};
