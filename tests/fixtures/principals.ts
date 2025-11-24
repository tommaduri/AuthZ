/**
 * Principal Fixtures for Integration Tests
 *
 * Sample principals representing different user types and roles
 */

// Local type definition to avoid package dependencies
export interface Principal {
  id: string;
  roles: string[];
  attributes: Record<string, unknown>;
}

/**
 * Regular user with basic permissions
 */
export const regularUser: Principal = {
  id: 'user-123',
  roles: ['user'],
  attributes: {
    email: 'user@example.com',
    department: 'engineering',
    accountStatus: 'active',
    createdAt: '2024-01-01T00:00:00Z',
  },
};

/**
 * Subscriber with active subscription
 */
export const activeSubscriber: Principal = {
  id: 'subscriber-456',
  roles: ['user', 'subscriber'],
  attributes: {
    email: 'subscriber@example.com',
    subscriptionTier: 'standard',
    subscriptionStatus: 'active',
    subscriptionStartDate: '2024-06-01T00:00:00Z',
    subscriptionEndDate: '2025-06-01T00:00:00Z',
  },
};

/**
 * Premium subscriber with full access
 */
export const premiumSubscriber: Principal = {
  id: 'premium-789',
  roles: ['user', 'subscriber', 'premium'],
  attributes: {
    email: 'premium@example.com',
    subscriptionTier: 'premium',
    subscriptionStatus: 'active',
    subscriptionStartDate: '2024-01-01T00:00:00Z',
    subscriptionEndDate: '2025-01-01T00:00:00Z',
    benefits: ['exclusive_content', 'offline_access', 'priority_support'],
  },
};

/**
 * Admin user with elevated permissions
 */
export const adminUser: Principal = {
  id: 'admin-001',
  roles: ['user', 'admin'],
  attributes: {
    email: 'admin@example.com',
    department: 'operations',
    adminLevel: 1,
    canDeleteAnyContent: true,
  },
};

/**
 * Super admin with full system access
 */
export const superAdmin: Principal = {
  id: 'superadmin-000',
  roles: ['user', 'admin', 'super-admin'],
  attributes: {
    email: 'superadmin@example.com',
    adminLevel: 0,
    canDeleteAnyContent: true,
    canManageAdmins: true,
  },
};

/**
 * Editor user with content editing permissions
 */
export const editor: Principal = {
  id: 'editor-100',
  roles: ['user', 'editor'],
  attributes: {
    email: 'editor@example.com',
    department: 'content',
    editingCategories: ['articles', 'guides'],
  },
};

/**
 * Influencer/Content creator
 */
export const influencer: Principal = {
  id: 'influencer-200',
  roles: ['user', 'influencer'],
  attributes: {
    email: 'influencer@example.com',
    followerCount: 50000,
    verifiedStatus: true,
    accountStatus: 'active',
    contentCreationEnabled: true,
  },
};

/**
 * Finance team member
 */
export const financeUser: Principal = {
  id: 'finance-300',
  roles: ['user', 'finance'],
  attributes: {
    email: 'finance@example.com',
    department: 'finance',
    payoutApprovalLimit: 10000,
    canExportData: true,
  },
};

/**
 * Manager user
 */
export const manager: Principal = {
  id: 'manager-400',
  roles: ['user', 'manager'],
  attributes: {
    email: 'manager@example.com',
    department: 'engineering',
    isManager: true,
    teamSize: 10,
    directReports: ['user-123', 'editor-100'],
  },
};

/**
 * Guest user with minimal permissions
 */
export const guestUser: Principal = {
  id: 'guest-500',
  roles: ['guest'],
  attributes: {
    sessionId: 'session-xyz',
    ipAddress: '192.168.1.100',
    createdAt: new Date().toISOString(),
  },
};

/**
 * Suspicious user for anomaly testing
 */
export const suspiciousUser: Principal = {
  id: 'suspicious-999',
  roles: ['user'],
  attributes: {
    email: 'suspicious@example.com',
    recentFailedLogins: 10,
    flaggedForReview: true,
    lastKnownIp: '1.2.3.4',
    unusualActivity: true,
  },
};

/**
 * Expired subscription user
 */
export const expiredSubscriber: Principal = {
  id: 'expired-600',
  roles: ['user', 'subscriber'],
  attributes: {
    email: 'expired@example.com',
    subscriptionTier: 'standard',
    subscriptionStatus: 'expired',
    subscriptionEndDate: '2023-12-31T00:00:00Z',
  },
};

/**
 * New user with onboarding status
 */
export const newUser: Principal = {
  id: 'new-700',
  roles: ['user'],
  attributes: {
    email: 'newuser@example.com',
    accountStatus: 'onboarding',
    emailVerified: false,
    createdAt: new Date().toISOString(),
  },
};

/**
 * Service account for automation
 */
export const serviceAccount: Principal = {
  id: 'service-api-001',
  roles: ['service'],
  attributes: {
    serviceName: 'batch-processor',
    apiKeyId: 'key-abc123',
    rateLimit: 1000,
    allowedActions: ['read', 'process'],
  },
};

/**
 * All principals indexed by name
 */
export const principals = {
  regularUser,
  activeSubscriber,
  premiumSubscriber,
  adminUser,
  superAdmin,
  editor,
  influencer,
  financeUser,
  manager,
  guestUser,
  suspiciousUser,
  expiredSubscriber,
  newUser,
  serviceAccount,
};

export default principals;
