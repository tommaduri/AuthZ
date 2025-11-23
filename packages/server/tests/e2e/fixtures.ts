/**
 * Shared Fixtures for E2E Tests
 *
 * Based on Avatar Connex policies - provides realistic test data
 * for comprehensive end-to-end testing scenarios.
 */

import { vi } from 'vitest';
import type { Principal, Resource, CheckRequest, CheckResponse } from '@authz-engine/core';

// =============================================================================
// Principal Fixtures - Based on Connex Roles
// =============================================================================

export const principals = {
  // Regular Users
  fan: {
    id: 'fan-001',
    roles: ['fan', 'user'],
    attributes: {
      email: 'fan@example.com',
      subscriptionStatus: 'active',
      subscriptionTier: 'basic',
      accountStatus: 'active',
    },
  } as Principal,

  premiumFan: {
    id: 'fan-premium-001',
    roles: ['fan', 'user', 'subscriber'],
    attributes: {
      email: 'premium-fan@example.com',
      subscriptionStatus: 'active',
      subscriptionTier: 'premium',
      subscriptionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      accountStatus: 'active',
    },
  } as Principal,

  // Influencers
  influencer: {
    id: 'influencer-001',
    roles: ['influencer', 'user'],
    attributes: {
      email: 'influencer@example.com',
      verificationStatus: 'verified',
      accountStatus: 'active',
      payoutEnabled: true,
      contentCreationEnabled: true,
      followerCount: 50000,
    },
  } as Principal,

  unverifiedInfluencer: {
    id: 'influencer-unverified-001',
    roles: ['influencer', 'user'],
    attributes: {
      email: 'new-influencer@example.com',
      verificationStatus: 'pending',
      accountStatus: 'active',
      payoutEnabled: false,
      contentCreationEnabled: true,
    },
  } as Principal,

  // Admin Users
  admin: {
    id: 'admin-001',
    roles: ['admin', 'user'],
    attributes: {
      email: 'admin@avatarconnex.com',
      department: 'operations',
      canImpersonate: true,
      canDeleteAnyContent: false,
    },
  } as Principal,

  superAdmin: {
    id: 'superadmin-001',
    roles: ['super_admin', 'admin', 'user'],
    attributes: {
      email: 'superadmin@avatarconnex.com',
      department: 'executive',
      canImpersonate: true,
      canDeleteAnyContent: true,
    },
  } as Principal,

  // Finance Team
  financeUser: {
    id: 'finance-001',
    roles: ['finance', 'user'],
    attributes: {
      email: 'finance@avatarconnex.com',
      department: 'finance',
      approvalLimit: 500,
      canOverrideRefund: false,
    },
  } as Principal,

  financeApprover: {
    id: 'finance-approver-001',
    roles: ['finance', 'user'],
    attributes: {
      email: 'finance-senior@avatarconnex.com',
      department: 'finance',
      approvalLimit: 10000,
      canOverrideRefund: true,
    },
  } as Principal,

  // Suspended/Blocked Users
  suspendedUser: {
    id: 'user-suspended-001',
    roles: ['user'],
    attributes: {
      email: 'suspended@example.com',
      accountStatus: 'suspended',
      suspensionReason: 'policy_violation',
    },
  } as Principal,

  // Multi-tenant users
  tenantAUser: {
    id: 'tenant-a-user-001',
    roles: ['user', 'fan'],
    attributes: {
      email: 'user-a@tenant-a.com',
      tenantId: 'tenant-a',
      accountStatus: 'active',
    },
  } as Principal,

  tenantBUser: {
    id: 'tenant-b-user-001',
    roles: ['user', 'fan'],
    attributes: {
      email: 'user-b@tenant-b.com',
      tenantId: 'tenant-b',
      accountStatus: 'active',
    },
  } as Principal,
};

// =============================================================================
// Resource Fixtures - Based on Connex Resources
// =============================================================================

export const resources = {
  // User Profiles
  userProfile: (ownerId: string, visibility: 'public' | 'private' = 'public'): Resource => ({
    kind: 'user',
    id: `user-profile-${ownerId}`,
    attributes: {
      ownerId,
      visibility,
      status: 'active',
    },
  }),

  // Avatars
  publicAvatar: {
    kind: 'avatar',
    id: 'avatar-001',
    attributes: {
      ownerId: 'influencer-001',
      status: 'active',
      visibility: 'public',
    },
  } as Resource,

  privateAvatar: {
    kind: 'avatar',
    id: 'avatar-private-001',
    attributes: {
      ownerId: 'influencer-001',
      status: 'active',
      visibility: 'private',
    },
  } as Resource,

  suspendedAvatar: {
    kind: 'avatar',
    id: 'avatar-suspended-001',
    attributes: {
      ownerId: 'influencer-001',
      status: 'suspended',
      visibility: 'public',
    },
  } as Resource,

  // Content
  publicContent: {
    kind: 'content',
    id: 'content-public-001',
    attributes: {
      creatorId: 'influencer-001',
      contentType: 'public',
      visibility: 'public',
      status: 'published',
      moderationStatus: 'approved',
    },
  } as Resource,

  premiumContent: {
    kind: 'content',
    id: 'content-premium-001',
    attributes: {
      creatorId: 'influencer-001',
      contentType: 'premium',
      visibility: 'subscribers',
      status: 'published',
      moderationStatus: 'approved',
    },
  } as Resource,

  exclusiveContent: {
    kind: 'content',
    id: 'content-exclusive-001',
    attributes: {
      creatorId: 'influencer-001',
      contentType: 'exclusive',
      visibility: 'premium',
      status: 'published',
      moderationStatus: 'approved',
    },
  } as Resource,

  draftContent: {
    kind: 'content',
    id: 'content-draft-001',
    attributes: {
      creatorId: 'influencer-001',
      contentType: 'public',
      status: 'draft',
      moderationStatus: 'pending',
    },
  } as Resource,

  flaggedContent: {
    kind: 'content',
    id: 'content-flagged-001',
    attributes: {
      creatorId: 'influencer-001',
      contentType: 'public',
      status: 'published',
      moderationStatus: 'flagged',
    },
  } as Resource,

  // Subscriptions
  activeSubscription: {
    kind: 'subscription',
    id: 'subscription-001',
    attributes: {
      fanId: 'fan-premium-001',
      influencerId: 'influencer-001',
      status: 'active',
      tier: 'premium',
      canCancel: true,
      pausesRemaining: 2,
      refundEligible: true,
    },
  } as Resource,

  cancelledSubscription: {
    kind: 'subscription',
    id: 'subscription-cancelled-001',
    attributes: {
      fanId: 'fan-001',
      influencerId: 'influencer-001',
      status: 'cancelled',
      tier: 'basic',
      canCancel: false,
      refundEligible: false,
    },
  } as Resource,

  pausedSubscription: {
    kind: 'subscription',
    id: 'subscription-paused-001',
    attributes: {
      fanId: 'fan-001',
      influencerId: 'influencer-001',
      status: 'paused',
      tier: 'premium',
      canCancel: true,
      pausesRemaining: 1,
    },
  } as Resource,

  // Payouts
  pendingPayout: {
    kind: 'payout',
    id: 'payout-pending-001',
    attributes: {
      ownerId: 'influencer-001',
      recipientId: 'influencer-001',
      amount: 500,
      status: 'pending',
      retryCount: 0,
    },
  } as Resource,

  highValuePayout: {
    kind: 'payout',
    id: 'payout-high-value-001',
    attributes: {
      ownerId: 'influencer-001',
      recipientId: 'influencer-001',
      amount: 5000,
      status: 'pending',
      retryCount: 0,
    },
  } as Resource,

  failedPayout: {
    kind: 'payout',
    id: 'payout-failed-001',
    attributes: {
      ownerId: 'influencer-001',
      recipientId: 'influencer-001',
      amount: 200,
      status: 'failed',
      retryCount: 2,
    },
  } as Resource,

  onHoldPayout: {
    kind: 'payout',
    id: 'payout-hold-001',
    attributes: {
      ownerId: 'influencer-001',
      recipientId: 'influencer-001',
      amount: 1500,
      status: 'on_hold',
      retryCount: 0,
    },
  } as Resource,

  // Chat Rooms
  activeChat: {
    kind: 'chat',
    id: 'chat-001',
    attributes: {
      participants: ['fan-001', 'influencer-001'],
      influencerId: 'influencer-001',
      status: 'active',
      blockedUsers: [],
    },
  } as Resource,

  closedChat: {
    kind: 'chat',
    id: 'chat-closed-001',
    attributes: {
      participants: ['fan-001', 'influencer-001'],
      influencerId: 'influencer-001',
      status: 'closed',
      blockedUsers: [],
    },
  } as Resource,

  chatWithBlockedUser: {
    kind: 'chat',
    id: 'chat-blocked-001',
    attributes: {
      participants: ['fan-001', 'influencer-001'],
      influencerId: 'influencer-001',
      status: 'active',
      blockedUsers: ['blocked-user-001'],
    },
  } as Resource,

  // Multi-tenant resources
  tenantAResource: {
    kind: 'content',
    id: 'content-tenant-a-001',
    attributes: {
      tenantId: 'tenant-a',
      creatorId: 'tenant-a-user-001',
      visibility: 'public',
      status: 'published',
    },
  } as Resource,

  tenantBResource: {
    kind: 'content',
    id: 'content-tenant-b-001',
    attributes: {
      tenantId: 'tenant-b',
      creatorId: 'tenant-b-user-001',
      visibility: 'public',
      status: 'published',
    },
  } as Resource,
};

// =============================================================================
// Request Factories
// =============================================================================

let requestCounter = 0;

export function createCheckRequest(
  principal: Principal,
  resource: Resource,
  actions: string[],
  requestId?: string,
): CheckRequest {
  return {
    requestId: requestId || `e2e-req-${Date.now()}-${++requestCounter}`,
    principal,
    resource,
    actions,
  };
}

export function createBatchRequests(
  principal: Principal,
  resource: Resource,
  actions: string[],
  count: number,
): CheckRequest[] {
  return Array.from({ length: count }, (_, i) =>
    createCheckRequest(principal, resource, actions, `batch-${Date.now()}-${i}`),
  );
}

// =============================================================================
// Response Factories
// =============================================================================

export function createAllowedResponse(requestId: string, action: string): CheckResponse {
  return {
    requestId,
    results: {
      [action]: {
        effect: 'allow',
        policy: 'connex-policy',
        meta: { matchedRule: `allow-${action}` },
      },
    },
    meta: {
      evaluationDurationMs: Math.floor(Math.random() * 10) + 1,
      policiesEvaluated: ['connex-policy'],
    },
  };
}

export function createDeniedResponse(requestId: string, action: string, reason?: string): CheckResponse {
  return {
    requestId,
    results: {
      [action]: {
        effect: 'deny',
        policy: 'connex-policy',
        meta: { matchedRule: reason || `deny-${action}` },
      },
    },
    meta: {
      evaluationDurationMs: Math.floor(Math.random() * 10) + 1,
      policiesEvaluated: ['connex-policy'],
    },
  };
}

export function createMultiActionResponse(
  requestId: string,
  actions: string[],
  allowed: boolean[],
): CheckResponse {
  const results: CheckResponse['results'] = {};
  actions.forEach((action, index) => {
    results[action] = {
      effect: allowed[index] ? 'allow' : 'deny',
      policy: 'connex-policy',
      meta: { matchedRule: `${allowed[index] ? 'allow' : 'deny'}-${action}` },
    };
  });

  return {
    requestId,
    results,
    meta: {
      evaluationDurationMs: actions.length * 2,
      policiesEvaluated: ['connex-policy'],
    },
  };
}

// =============================================================================
// Audit Event Types
// =============================================================================

export interface AuditEvent {
  id: string;
  timestamp: Date;
  eventType: string;
  principal: Principal;
  resource: Resource;
  action: string;
  result: 'allow' | 'deny';
  metadata: Record<string, unknown>;
}

export function createAuditEvent(
  principal: Principal,
  resource: Resource,
  action: string,
  result: 'allow' | 'deny',
  eventType: string = 'authorization_decision',
): AuditEvent {
  return {
    id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    timestamp: new Date(),
    eventType,
    principal,
    resource,
    action,
    result,
    metadata: {
      ipAddress: '192.168.1.100',
      userAgent: 'E2E-Test-Agent/1.0',
      sessionId: `session-${principal.id}`,
    },
  };
}

// =============================================================================
// Mock External Dependencies
// =============================================================================

export function setupMocks() {
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
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    })),
  }));

  vi.mock('openai', () => ({
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'Mock AI response for E2E testing' } }],
          }),
        },
      },
    })),
  }));
}

// =============================================================================
// Test Configuration
// =============================================================================

export const testConfig = {
  agents: {
    enabled: true,
    logLevel: 'error' as const,
    guardian: {
      anomalyThreshold: 0.7,
      baselinePeriodDays: 30,
      velocityWindowMinutes: 5,
      enableRealTimeDetection: true,
    },
    analyst: {
      minSampleSize: 5,
      confidenceThreshold: 0.5,
      learningEnabled: false,
    },
    advisor: {
      llmProvider: 'openai' as const,
      llmModel: 'gpt-4',
      enableNaturalLanguage: false,
      maxExplanationLength: 500,
    },
    enforcer: {
      autoEnforceEnabled: false,
      requireApprovalForSeverity: 'high' as const,
      maxActionsPerHour: 100,
      rollbackWindowMinutes: 60,
    },
  },
  store: {
    database: {
      host: 'localhost',
      port: 5432,
      database: 'authz_e2e_test',
      user: 'test',
      password: 'test',
    },
    enableVectorSearch: false,
    embeddingDimension: 1536,
    retentionDays: 90,
  },
  eventBus: {
    mode: 'memory' as const,
  },
};

// =============================================================================
// Performance Testing Utilities
// =============================================================================

export interface PerformanceMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalDurationMs: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  requestsPerSecond: number;
}

export function calculatePerformanceMetrics(latencies: number[]): PerformanceMetrics {
  const sorted = [...latencies].sort((a, b) => a - b);
  const total = latencies.reduce((sum, l) => sum + l, 0);

  return {
    totalRequests: latencies.length,
    successfulRequests: latencies.length,
    failedRequests: 0,
    totalDurationMs: total,
    avgLatencyMs: total / latencies.length,
    minLatencyMs: sorted[0] || 0,
    maxLatencyMs: sorted[sorted.length - 1] || 0,
    p50LatencyMs: sorted[Math.floor(sorted.length * 0.5)] || 0,
    p95LatencyMs: sorted[Math.floor(sorted.length * 0.95)] || 0,
    p99LatencyMs: sorted[Math.floor(sorted.length * 0.99)] || 0,
    requestsPerSecond: (latencies.length / total) * 1000,
  };
}

export default {
  principals,
  resources,
  createCheckRequest,
  createBatchRequests,
  createAllowedResponse,
  createDeniedResponse,
  createMultiActionResponse,
  createAuditEvent,
  setupMocks,
  testConfig,
  calculatePerformanceMetrics,
};
