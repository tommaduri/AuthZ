import { describe, it, expect, beforeEach } from 'vitest';
import { DecisionEngine } from '../../../src/engine/decision-engine';
import type { ValidatedResourcePolicy, ValidatedDerivedRolesPolicy } from '../../../src/policy/schema';

describe('DecisionEngine', () => {
  let engine: DecisionEngine;

  beforeEach(() => {
    engine = new DecisionEngine();
  });

  describe('basic authorization', () => {
    const subscriptionPolicy: ValidatedResourcePolicy = {
      apiVersion: 'authz.engine/v1',
      kind: 'ResourcePolicy',
      metadata: { name: 'subscription-policy' },
      spec: {
        resource: 'subscription',
        rules: [
          {
            actions: ['view'],
            effect: 'allow',
            roles: ['user'],
          },
          {
            actions: ['create', 'update'],
            effect: 'allow',
            roles: ['influencer'],
          },
          {
            actions: ['delete'],
            effect: 'allow',
            roles: ['admin'],
          },
        ],
      },
    };

    beforeEach(() => {
      engine.loadResourcePolicies([subscriptionPolicy]);
    });

    it('should allow action when role matches', () => {
      const result = engine.check({
        principal: {
          id: 'user-1',
          roles: ['user'],
          attributes: {},
        },
        resource: {
          kind: 'subscription',
          id: 'sub-1',
          attributes: {},
        },
        actions: ['view'],
      });

      expect(result.results['view'].effect).toBe('allow');
    });

    it('should deny action when role does not match', () => {
      const result = engine.check({
        principal: {
          id: 'user-1',
          roles: ['user'],
          attributes: {},
        },
        resource: {
          kind: 'subscription',
          id: 'sub-1',
          attributes: {},
        },
        actions: ['delete'],
      });

      expect(result.results['delete'].effect).toBe('deny');
    });

    it('should check multiple actions in one request', () => {
      const result = engine.check({
        principal: {
          id: 'admin-1',
          roles: ['admin', 'user'],
          attributes: {},
        },
        resource: {
          kind: 'subscription',
          id: 'sub-1',
          attributes: {},
        },
        actions: ['view', 'delete', 'create'],
      });

      expect(result.results['view'].effect).toBe('allow');
      expect(result.results['delete'].effect).toBe('allow');
      expect(result.results['create'].effect).toBe('deny'); // admin doesn't have influencer role
    });
  });

  describe('conditional policies', () => {
    const avatarPolicy: ValidatedResourcePolicy = {
      apiVersion: 'authz.engine/v1',
      kind: 'ResourcePolicy',
      metadata: { name: 'avatar-policy' },
      spec: {
        resource: 'avatar',
        rules: [
          {
            actions: ['view'],
            effect: 'allow',
            roles: ['user'],
          },
          {
            actions: ['edit', 'delete'],
            effect: 'allow',
            roles: ['user'],
            condition: {
              expression: 'resource.ownerId == principal.id',
            },
          },
        ],
      },
    };

    beforeEach(() => {
      engine.loadResourcePolicies([avatarPolicy]);
    });

    it('should allow when condition is met', () => {
      const result = engine.check({
        principal: {
          id: 'user-123',
          roles: ['user'],
          attributes: {},
        },
        resource: {
          kind: 'avatar',
          id: 'avatar-1',
          attributes: { ownerId: 'user-123' },
        },
        actions: ['edit'],
      });

      expect(result.results['edit'].effect).toBe('allow');
    });

    it('should deny when condition is not met', () => {
      const result = engine.check({
        principal: {
          id: 'user-123',
          roles: ['user'],
          attributes: {},
        },
        resource: {
          kind: 'avatar',
          id: 'avatar-1',
          attributes: { ownerId: 'user-456' }, // Different owner
        },
        actions: ['edit'],
      });

      expect(result.results['edit'].effect).toBe('deny');
    });
  });

  describe('derived roles', () => {
    const derivedRoles: ValidatedDerivedRolesPolicy = {
      apiVersion: 'authz.engine/v1',
      kind: 'DerivedRoles',
      metadata: { name: 'connex-derived-roles' },
      spec: {
        definitions: [
          {
            name: 'owner',
            parentRoles: ['user'],
            condition: {
              expression: 'resource.ownerId == principal.id',
            },
          },
        ],
      },
    };

    const chatPolicy: ValidatedResourcePolicy = {
      apiVersion: 'authz.engine/v1',
      kind: 'ResourcePolicy',
      metadata: { name: 'chat-policy' },
      spec: {
        resource: 'chat',
        rules: [
          {
            actions: ['view'],
            effect: 'allow',
            roles: ['user'],
          },
          {
            actions: ['delete'],
            effect: 'allow',
            derivedRoles: ['owner'],
          },
        ],
      },
    };

    beforeEach(() => {
      engine.loadDerivedRolesPolicies([derivedRoles]);
      engine.loadResourcePolicies([chatPolicy]);
    });

    it('should compute and apply derived roles', () => {
      const result = engine.check({
        principal: {
          id: 'user-123',
          roles: ['user'],
          attributes: {},
        },
        resource: {
          kind: 'chat',
          id: 'chat-1',
          attributes: { ownerId: 'user-123' },
        },
        actions: ['delete'],
      });

      expect(result.results['delete'].effect).toBe('allow');
      expect(result.results['delete'].meta?.effectiveDerivedRoles).toContain('owner');
    });

    it('should not apply derived role when condition not met', () => {
      const result = engine.check({
        principal: {
          id: 'user-123',
          roles: ['user'],
          attributes: {},
        },
        resource: {
          kind: 'chat',
          id: 'chat-1',
          attributes: { ownerId: 'user-456' }, // Not the owner
        },
        actions: ['delete'],
      });

      expect(result.results['delete'].effect).toBe('deny');
    });
  });

  describe('deny overrides', () => {
    const policyWithDeny: ValidatedResourcePolicy = {
      apiVersion: 'authz.engine/v1',
      kind: 'ResourcePolicy',
      metadata: { name: 'deny-test-policy' },
      spec: {
        resource: 'sensitive',
        rules: [
          {
            actions: ['access'],
            effect: 'allow',
            roles: ['user'],
          },
          {
            actions: ['access'],
            effect: 'deny',
            condition: {
              expression: 'resource.restricted == true',
            },
          },
        ],
      },
    };

    beforeEach(() => {
      engine.loadResourcePolicies([policyWithDeny]);
    });

    it('should deny even if allow rule exists', () => {
      const result = engine.check({
        principal: {
          id: 'user-1',
          roles: ['user'],
          attributes: {},
        },
        resource: {
          kind: 'sensitive',
          id: 'doc-1',
          attributes: { restricted: true },
        },
        actions: ['access'],
      });

      expect(result.results['access'].effect).toBe('deny');
    });

    it('should allow when deny condition not met', () => {
      const result = engine.check({
        principal: {
          id: 'user-1',
          roles: ['user'],
          attributes: {},
        },
        resource: {
          kind: 'sensitive',
          id: 'doc-1',
          attributes: { restricted: false },
        },
        actions: ['access'],
      });

      expect(result.results['access'].effect).toBe('allow');
    });
  });

  describe('metadata', () => {
    it('should include evaluation metadata in response', () => {
      const policy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'meta-test' },
        spec: {
          resource: 'test',
          rules: [{ actions: ['read'], effect: 'allow', roles: ['user'] }],
        },
      };

      engine.loadResourcePolicies([policy]);

      const result = engine.check({
        requestId: 'test-request-123',
        principal: { id: 'u1', roles: ['user'], attributes: {} },
        resource: { kind: 'test', id: 't1', attributes: {} },
        actions: ['read'],
      });

      expect(result.requestId).toBe('test-request-123');
      expect(result.meta?.evaluationDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.meta?.policiesEvaluated).toContain('meta-test');
    });
  });
});
