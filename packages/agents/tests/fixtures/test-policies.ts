/**
 * Test Policies for Agentic Authorization Integration Tests
 *
 * These fixtures provide sample policies for testing the full agent pipeline.
 */

import type { ResourcePolicy, DerivedRolesPolicy } from '@authz-engine/core';

/**
 * Basic document access policy
 */
export const documentPolicy: ResourcePolicy = {
  apiVersion: 'authz.engine/v1',
  kind: 'ResourcePolicy',
  metadata: {
    name: 'document-access',
    description: 'Controls access to documents',
  },
  spec: {
    resource: 'document',
    rules: [
      {
        name: 'allow-view-all-users',
        actions: ['view'],
        effect: 'allow',
        roles: ['user', 'admin', 'editor'],
      },
      {
        name: 'allow-edit-editors',
        actions: ['edit'],
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
        actions: ['view', 'edit', 'delete'],
        effect: 'allow',
        condition: {
          expression: 'resource.ownerId == principal.id',
        },
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
    description: 'Controls access to premium content based on subscription',
  },
  spec: {
    resource: 'premium-content',
    rules: [
      {
        name: 'allow-subscribers',
        actions: ['view', 'download'],
        effect: 'allow',
        roles: ['subscriber', 'premium', 'admin'],
      },
      {
        name: 'deny-non-subscribers',
        actions: ['view', 'download'],
        effect: 'deny',
        roles: ['user', 'guest'],
      },
      {
        name: 'allow-preview',
        actions: ['preview'],
        effect: 'allow',
        roles: ['user', 'guest', 'subscriber', 'premium', 'admin'],
      },
    ],
  },
};

/**
 * Avatar policy for avatar management
 */
export const avatarPolicy: ResourcePolicy = {
  apiVersion: 'authz.engine/v1',
  kind: 'ResourcePolicy',
  metadata: {
    name: 'avatar-access',
    description: 'Controls access to avatar resources',
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
        actions: ['edit', 'customize'],
        effect: 'allow',
        condition: {
          expression: 'resource.ownerId == principal.id',
        },
      },
      {
        name: 'allow-admin-all',
        actions: ['view', 'edit', 'delete', 'customize', 'transfer'],
        effect: 'allow',
        roles: ['admin'],
      },
      {
        name: 'deny-bulk-operations-non-admin',
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
  },
  spec: {
    resource: 'admin-settings',
    rules: [
      {
        name: 'allow-super-admin',
        actions: ['view', 'edit', 'delete'],
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
        actions: ['view', 'edit', 'delete'],
        effect: 'deny',
        roles: ['user', 'editor', 'manager'],
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
  },
  spec: {
    resource: 'payout',
    rules: [
      {
        name: 'allow-view-owner',
        actions: ['view'],
        effect: 'allow',
        condition: {
          expression: 'resource.recipientId == principal.id',
        },
      },
      {
        name: 'allow-finance-team',
        actions: ['view', 'approve', 'process'],
        effect: 'allow',
        roles: ['finance', 'admin'],
      },
      {
        name: 'deny-bulk-export-non-finance',
        actions: ['bulk-export'],
        effect: 'deny',
        roles: ['user', 'influencer'],
      },
    ],
  },
};

/**
 * Derived roles for owner relationships
 */
export const ownerDerivedRoles: DerivedRolesPolicy = {
  apiVersion: 'authz.engine/v1',
  kind: 'DerivedRoles',
  metadata: {
    name: 'owner-derived-roles',
    description: 'Compute owner-based derived roles',
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
  derivedRoles: ownerDerivedRoles,
};

export default testPolicies;
