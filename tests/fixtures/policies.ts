/**
 * Policy Fixtures for Integration Tests
 *
 * Sample policies in TypeScript format for testing
 */

// Local type definitions to avoid package dependencies
export interface ResourcePolicy {
  apiVersion: string;
  kind: 'ResourcePolicy';
  metadata: {
    name: string;
    description?: string;
    version?: string;
  };
  spec: {
    resource: string;
    rules: Array<{
      name: string;
      actions: string[];
      effect: 'allow' | 'deny';
      roles?: string[];
      derivedRoles?: string[];
      condition?: {
        expression: string;
      };
    }>;
  };
}

export interface DerivedRolesPolicy {
  apiVersion: string;
  kind: 'DerivedRoles';
  metadata: {
    name: string;
    description?: string;
    version?: string;
  };
  spec: {
    definitions: Array<{
      name: string;
      parentRoles: string[];
      condition?: {
        expression: string;
      };
    }>;
  };
}

/**
 * Document access policy
 */
export const documentPolicy: ResourcePolicy = {
  apiVersion: 'authz.engine/v1',
  kind: 'ResourcePolicy',
  metadata: {
    name: 'document-access',
    description: 'Controls access to document resources',
    version: '1.0.0',
  },
  spec: {
    resource: 'document',
    rules: [
      {
        name: 'allow-view-all-users',
        actions: ['view', 'list'],
        effect: 'allow',
        roles: ['user', 'admin', 'editor'],
      },
      {
        name: 'allow-edit-editors',
        actions: ['edit', 'update'],
        effect: 'allow',
        roles: ['editor', 'admin'],
      },
      {
        name: 'allow-delete-admin',
        actions: ['delete'],
        effect: 'allow',
        roles: ['admin'],
      },
      {
        name: 'allow-owner-all',
        actions: ['view', 'edit', 'delete', 'share'],
        effect: 'allow',
        condition: {
          expression: 'resource.ownerId == principal.id',
        },
      },
      {
        name: 'allow-team-view-edit',
        actions: ['view', 'edit'],
        effect: 'allow',
        derivedRoles: ['team-member'],
      },
    ],
  },
};

/**
 * Premium content policy for subscription-based access
 */
export const premiumContentPolicy: ResourcePolicy = {
  apiVersion: 'authz.engine/v1',
  kind: 'ResourcePolicy',
  metadata: {
    name: 'premium-content-access',
    description: 'Controls access to premium subscription content',
    version: '1.0.0',
  },
  spec: {
    resource: 'premium-content',
    rules: [
      {
        name: 'allow-preview-all',
        actions: ['preview'],
        effect: 'allow',
        roles: ['user', 'subscriber', 'premium', 'admin'],
      },
      {
        name: 'allow-view-subscribers',
        actions: ['view', 'download'],
        effect: 'allow',
        roles: ['subscriber', 'premium', 'admin'],
      },
      {
        name: 'deny-free-users',
        actions: ['view', 'download'],
        effect: 'deny',
        roles: ['user', 'guest'],
      },
      {
        name: 'allow-exclusive-premium',
        actions: ['view', 'download', 'offline'],
        effect: 'allow',
        roles: ['premium', 'admin'],
        condition: {
          expression: "resource.tier == 'exclusive'",
        },
      },
    ],
  },
};

/**
 * Avatar management policy
 */
export const avatarPolicy: ResourcePolicy = {
  apiVersion: 'authz.engine/v1',
  kind: 'ResourcePolicy',
  metadata: {
    name: 'avatar-access',
    description: 'Controls access to avatar resources',
    version: '1.0.0',
  },
  spec: {
    resource: 'avatar',
    rules: [
      {
        name: 'allow-view-public',
        actions: ['view'],
        effect: 'allow',
        roles: ['user', 'influencer', 'admin'],
      },
      {
        name: 'allow-edit-owner',
        actions: ['edit', 'customize', 'delete'],
        effect: 'allow',
        condition: {
          expression: 'resource.ownerId == principal.id',
        },
      },
      {
        name: 'allow-admin-all',
        actions: ['view', 'edit', 'delete', 'customize', 'transfer', 'bulk-delete', 'bulk-export'],
        effect: 'allow',
        roles: ['admin'],
      },
      {
        name: 'deny-bulk-operations',
        actions: ['bulk-delete', 'bulk-export'],
        effect: 'deny',
        roles: ['user', 'influencer'],
      },
    ],
  },
};

/**
 * Admin settings policy with strict access control
 */
export const adminSettingsPolicy: ResourcePolicy = {
  apiVersion: 'authz.engine/v1',
  kind: 'ResourcePolicy',
  metadata: {
    name: 'admin-settings-access',
    description: 'Strict access control for admin settings',
    version: '1.0.0',
  },
  spec: {
    resource: 'admin-settings',
    rules: [
      {
        name: 'allow-super-admin-all',
        actions: ['view', 'edit', 'delete', 'configure'],
        effect: 'allow',
        roles: ['super-admin'],
      },
      {
        name: 'allow-admin-view',
        actions: ['view'],
        effect: 'allow',
        roles: ['admin'],
      },
      {
        name: 'deny-all-others',
        actions: ['view', 'edit', 'delete', 'configure'],
        effect: 'deny',
        roles: ['user', 'editor', 'manager', 'influencer'],
      },
    ],
  },
};

/**
 * Payout policy for financial operations
 */
export const payoutPolicy: ResourcePolicy = {
  apiVersion: 'authz.engine/v1',
  kind: 'ResourcePolicy',
  metadata: {
    name: 'payout-access',
    description: 'Controls access to payout operations',
    version: '1.0.0',
  },
  spec: {
    resource: 'payout',
    rules: [
      {
        name: 'allow-view-recipient',
        actions: ['view'],
        effect: 'allow',
        condition: {
          expression: 'resource.recipientId == principal.id',
        },
      },
      {
        name: 'allow-finance-team',
        actions: ['view', 'approve', 'process', 'reject'],
        effect: 'allow',
        roles: ['finance', 'admin'],
      },
      {
        name: 'allow-bulk-export-finance',
        actions: ['bulk-export'],
        effect: 'allow',
        roles: ['finance', 'admin'],
      },
      {
        name: 'deny-bulk-export-others',
        actions: ['bulk-export'],
        effect: 'deny',
        roles: ['user', 'influencer'],
      },
    ],
  },
};

/**
 * Chat room policy
 */
export const chatPolicy: ResourcePolicy = {
  apiVersion: 'authz.engine/v1',
  kind: 'ResourcePolicy',
  metadata: {
    name: 'chat-access',
    description: 'Controls access to chat resources',
    version: '1.0.0',
  },
  spec: {
    resource: 'chat',
    rules: [
      {
        name: 'allow-participants-view',
        actions: ['view', 'read'],
        effect: 'allow',
        derivedRoles: ['chat-participant'],
      },
      {
        name: 'allow-participants-send',
        actions: ['send', 'reply'],
        effect: 'allow',
        derivedRoles: ['chat-participant'],
      },
      {
        name: 'allow-owner-manage',
        actions: ['view', 'read', 'send', 'delete', 'invite', 'kick'],
        effect: 'allow',
        condition: {
          expression: 'resource.ownerId == principal.id',
        },
      },
      {
        name: 'allow-admin-moderate',
        actions: ['view', 'read', 'delete', 'mute', 'ban'],
        effect: 'allow',
        roles: ['admin'],
      },
    ],
  },
};

/**
 * Derived roles for owner and team relationships
 */
export const ownerDerivedRoles: DerivedRolesPolicy = {
  apiVersion: 'authz.engine/v1',
  kind: 'DerivedRoles',
  metadata: {
    name: 'owner-derived-roles',
    description: 'Compute owner-based derived roles',
    version: '1.0.0',
  },
  spec: {
    definitions: [
      {
        name: 'owner',
        parentRoles: ['user'],
        condition: {
          expression: 'resource.ownerId == principal.id',
        },
      },
      {
        name: 'team-member',
        parentRoles: ['user'],
        condition: {
          expression: 'principal.id in resource.teamMemberIds',
        },
      },
      {
        name: 'manager',
        parentRoles: ['user'],
        condition: {
          expression: 'principal.attributes.department == resource.attributes.department && principal.attributes.isManager == true',
        },
      },
      {
        name: 'chat-participant',
        parentRoles: ['user'],
        condition: {
          expression: 'principal.id in resource.participantIds',
        },
      },
    ],
  },
};

/**
 * Subscription-based derived roles
 */
export const subscriptionDerivedRoles: DerivedRolesPolicy = {
  apiVersion: 'authz.engine/v1',
  kind: 'DerivedRoles',
  metadata: {
    name: 'subscription-derived-roles',
    description: 'Compute subscription-based derived roles',
    version: '1.0.0',
  },
  spec: {
    definitions: [
      {
        name: 'active_subscriber',
        parentRoles: ['user', 'subscriber'],
        condition: {
          expression: "principal.attributes.subscriptionStatus == 'active'",
        },
      },
      {
        name: 'premium_subscriber',
        parentRoles: ['subscriber'],
        condition: {
          expression: "principal.attributes.subscriptionTier == 'premium' && principal.attributes.subscriptionStatus == 'active'",
        },
      },
      {
        name: 'content_creator',
        parentRoles: ['influencer'],
        condition: {
          expression: 'resource.creatorId == principal.id',
        },
      },
    ],
  },
};

/**
 * All test policies combined
 */
export const testPolicies = {
  document: documentPolicy,
  premiumContent: premiumContentPolicy,
  avatar: avatarPolicy,
  adminSettings: adminSettingsPolicy,
  payout: payoutPolicy,
  chat: chatPolicy,
  derivedRoles: ownerDerivedRoles,
  subscriptionRoles: subscriptionDerivedRoles,
};

export default testPolicies;
