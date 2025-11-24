/**
 * Resource Fixtures for Integration Tests
 *
 * Sample resources for testing authorization scenarios
 */

// Local type definition to avoid package dependencies
export interface Resource {
  kind: string;
  id: string;
  attributes: Record<string, unknown>;
}

// =============================================================================
// Document Resources
// =============================================================================

export const publicDocument: Resource = {
  kind: 'document',
  id: 'doc-001',
  attributes: {
    title: 'Public Document',
    visibility: 'public',
    ownerId: 'user-123',
    createdAt: '2024-01-15T10:00:00Z',
    status: 'published',
  },
};

export const privateDocument: Resource = {
  kind: 'document',
  id: 'doc-002',
  attributes: {
    title: 'Private Document',
    visibility: 'private',
    ownerId: 'user-999',
    createdAt: '2024-02-01T10:00:00Z',
    status: 'draft',
  },
};

export const teamDocument: Resource = {
  kind: 'document',
  id: 'doc-003',
  attributes: {
    title: 'Team Shared Document',
    visibility: 'team',
    ownerId: 'manager-400',
    teamMemberIds: ['user-123', 'editor-100', 'manager-400'],
    department: 'engineering',
    createdAt: '2024-01-20T10:00:00Z',
  },
};

export const archivedDocument: Resource = {
  kind: 'document',
  id: 'doc-004',
  attributes: {
    title: 'Archived Document',
    visibility: 'private',
    ownerId: 'user-123',
    status: 'archived',
    archivedAt: '2024-03-01T10:00:00Z',
  },
};

// =============================================================================
// Premium Content Resources
// =============================================================================

export const standardPremiumContent: Resource = {
  kind: 'premium-content',
  id: 'content-001',
  attributes: {
    title: 'Standard Premium Video',
    tier: 'standard',
    contentType: 'video',
    duration: 3600,
    status: 'published',
    creatorId: 'influencer-200',
  },
};

export const exclusivePremiumContent: Resource = {
  kind: 'premium-content',
  id: 'content-002',
  attributes: {
    title: 'Exclusive Premium Series',
    tier: 'exclusive',
    contentType: 'series',
    episodeCount: 10,
    status: 'published',
    creatorId: 'influencer-200',
  },
};

export const draftContent: Resource = {
  kind: 'premium-content',
  id: 'content-003',
  attributes: {
    title: 'Upcoming Content',
    tier: 'premium',
    contentType: 'video',
    status: 'draft',
    scheduledPublishDate: '2025-01-01T00:00:00Z',
    creatorId: 'influencer-200',
  },
};

// =============================================================================
// Avatar Resources
// =============================================================================

export const userAvatar: Resource = {
  kind: 'avatar',
  id: 'avatar-001',
  attributes: {
    name: 'My Avatar',
    ownerId: 'user-123',
    style: 'cartoon',
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
  },
};

export const influencerAvatar: Resource = {
  kind: 'avatar',
  id: 'avatar-002',
  attributes: {
    name: 'Influencer Avatar',
    ownerId: 'influencer-200',
    style: 'realistic',
    status: 'active',
    customizations: ['premium_hair', 'exclusive_outfit'],
    monetizationEnabled: true,
  },
};

export const bulkAvatarOperation: Resource = {
  kind: 'avatar',
  id: 'bulk',
  attributes: {
    operation: 'bulk',
    targetCount: 100,
  },
};

// =============================================================================
// Admin Settings Resources
// =============================================================================

export const globalSettings: Resource = {
  kind: 'admin-settings',
  id: 'settings-001',
  attributes: {
    scope: 'global',
    category: 'system',
    sensitive: true,
  },
};

export const featureFlags: Resource = {
  kind: 'admin-settings',
  id: 'settings-002',
  attributes: {
    scope: 'features',
    category: 'product',
    sensitive: false,
  },
};

// =============================================================================
// Payout Resources
// =============================================================================

export const pendingPayout: Resource = {
  kind: 'payout',
  id: 'payout-001',
  attributes: {
    amount: 1000,
    currency: 'USD',
    recipientId: 'influencer-200',
    status: 'pending',
    requestedAt: '2024-06-01T00:00:00Z',
    paymentMethod: 'bank_transfer',
  },
};

export const approvedPayout: Resource = {
  kind: 'payout',
  id: 'payout-002',
  attributes: {
    amount: 500,
    currency: 'USD',
    recipientId: 'influencer-200',
    status: 'approved',
    approvedBy: 'finance-300',
    approvedAt: '2024-06-15T00:00:00Z',
  },
};

export const largePayout: Resource = {
  kind: 'payout',
  id: 'payout-003',
  attributes: {
    amount: 50000,
    currency: 'USD',
    recipientId: 'influencer-200',
    status: 'pending_review',
    requiresAdditionalApproval: true,
  },
};

// =============================================================================
// Chat Resources
// =============================================================================

export const publicChat: Resource = {
  kind: 'chat',
  id: 'chat-001',
  attributes: {
    name: 'General Chat',
    ownerId: 'influencer-200',
    participantIds: ['user-123', 'subscriber-456', 'influencer-200'],
    visibility: 'public',
    messageCount: 150,
  },
};

export const privateChat: Resource = {
  kind: 'chat',
  id: 'chat-002',
  attributes: {
    name: 'Private Discussion',
    ownerId: 'user-123',
    participantIds: ['user-123', 'editor-100'],
    visibility: 'private',
    messageCount: 50,
  },
};

export const subscriberOnlyChat: Resource = {
  kind: 'chat',
  id: 'chat-003',
  attributes: {
    name: 'Subscriber Lounge',
    ownerId: 'influencer-200',
    participantIds: ['subscriber-456', 'premium-789', 'influencer-200'],
    visibility: 'subscribers_only',
    requiresSubscription: true,
  },
};

// =============================================================================
// All Resources Indexed
// =============================================================================

export const resources = {
  // Documents
  publicDocument,
  privateDocument,
  teamDocument,
  archivedDocument,

  // Premium Content
  standardPremiumContent,
  exclusivePremiumContent,
  draftContent,

  // Avatars
  userAvatar,
  influencerAvatar,
  bulkAvatarOperation,

  // Admin Settings
  globalSettings,
  featureFlags,

  // Payouts
  pendingPayout,
  approvedPayout,
  largePayout,

  // Chats
  publicChat,
  privateChat,
  subscriberOnlyChat,
};

export default resources;
