import { describe, it, expect, beforeEach } from 'vitest';
import { DecisionEngine } from '../../../src/engine/decision-engine';
import type { ValidatedResourcePolicy, ValidatedPrincipalPolicy } from '../../../src/policy/schema';

describe('Principal Policy Integration with DecisionEngine', () => {
  let engine: DecisionEngine;

  beforeEach(() => {
    engine = new DecisionEngine();
  });

  describe('principal policy loading', () => {
    it('should load principal policies', () => {
      const policy: ValidatedPrincipalPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'PrincipalPolicy',
        metadata: { name: 'john-policy' },
        spec: {
          principal: 'john@example.com',
          version: '1.0',
          rules: [
            {
              resource: 'expense',
              actions: [{ action: 'view', effect: 'allow' }],
            },
          ],
        },
      };

      engine.loadPrincipalPolicies([policy]);
      const stats = engine.getStats();
      expect(stats.principalPolicies).toBe(1);
    });
  });

  describe('principal policy evaluation', () => {
    it('should evaluate principal policy for exact principal match', () => {
      const principalPolicy: ValidatedPrincipalPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'PrincipalPolicy',
        metadata: { name: 'john-expense-policy' },
        spec: {
          principal: 'john@example.com',
          version: '1.0',
          rules: [
            {
              resource: 'expense',
              actions: [{ action: 'view', effect: 'allow' }],
            },
          ],
        },
      };

      engine.loadPrincipalPolicies([principalPolicy]);

      const result = engine.check({
        principal: { id: 'john@example.com', roles: [], attributes: {} },
        resource: { kind: 'expense', id: 'exp-1', attributes: {} },
        actions: ['view'],
      });

      expect(result.results['view'].effect).toBe('allow');
      expect(result.results['view'].policy).toBe('john-expense-policy');
    });

    it('should evaluate principal policy for wildcard principal match', () => {
      const principalPolicy: ValidatedPrincipalPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'PrincipalPolicy',
        metadata: { name: 'service-policy' },
        spec: {
          principal: 'service-*',
          version: '1.0',
          rules: [
            {
              resource: 'internal-api',
              actions: [{ action: 'access', effect: 'allow' }],
            },
          ],
        },
      };

      engine.loadPrincipalPolicies([principalPolicy]);

      const result = engine.check({
        principal: { id: 'service-backup', roles: [], attributes: {} },
        resource: { kind: 'internal-api', id: 'api-1', attributes: {} },
        actions: ['access'],
      });

      expect(result.results['access'].effect).toBe('allow');
    });
  });

  describe('deny-override combining algorithm', () => {
    it('should apply deny-override: principal policy ALLOW + resource policy DENY = DENY', () => {
      const principalPolicy: ValidatedPrincipalPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'PrincipalPolicy',
        metadata: { name: 'john-expense-policy' },
        spec: {
          principal: 'john@example.com',
          version: '1.0',
          rules: [
            {
              resource: 'expense',
              actions: [{ action: 'view', effect: 'allow' }],
            },
          ],
        },
      };

      const resourcePolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'expense-policy' },
        spec: {
          resource: 'expense',
          rules: [
            {
              actions: ['view'],
              effect: 'deny',
              condition: { expression: 'resource.amount > 10000' },
            },
          ],
        },
      };

      engine.loadPrincipalPolicies([principalPolicy]);
      engine.loadResourcePolicies([resourcePolicy]);

      // High-value expense should be denied (resource policy deny overrides)
      const result = engine.check({
        principal: { id: 'john@example.com', roles: [], attributes: {} },
        resource: { kind: 'expense', id: 'exp-1', attributes: { amount: 15000 } },
        actions: ['view'],
      });

      expect(result.results['view'].effect).toBe('deny');
    });

    it('should apply deny-override: principal policy DENY = DENY (regardless of resource policy)', () => {
      const principalPolicy: ValidatedPrincipalPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'PrincipalPolicy',
        metadata: { name: 'john-expense-policy' },
        spec: {
          principal: 'john@example.com',
          version: '1.0',
          rules: [
            {
              resource: 'expense',
              actions: [{ action: 'delete', effect: 'deny' }],
            },
          ],
        },
      };

      const resourcePolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'expense-policy' },
        spec: {
          resource: 'expense',
          rules: [
            {
              actions: ['delete'],
              effect: 'allow',
              roles: ['admin'],
            },
          ],
        },
      };

      engine.loadPrincipalPolicies([principalPolicy]);
      engine.loadResourcePolicies([resourcePolicy]);

      // John cannot delete even if resource policy allows admins
      const result = engine.check({
        principal: { id: 'john@example.com', roles: ['admin'], attributes: {} },
        resource: { kind: 'expense', id: 'exp-1', attributes: {} },
        actions: ['delete'],
      });

      expect(result.results['delete'].effect).toBe('deny');
    });

    it('should ALLOW when both principal and resource policies allow', () => {
      const principalPolicy: ValidatedPrincipalPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'PrincipalPolicy',
        metadata: { name: 'john-expense-policy' },
        spec: {
          principal: 'john@example.com',
          version: '1.0',
          rules: [
            {
              resource: 'expense',
              actions: [{ action: 'view', effect: 'allow' }],
            },
          ],
        },
      };

      const resourcePolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'expense-policy' },
        spec: {
          resource: 'expense',
          rules: [
            {
              actions: ['view'],
              effect: 'allow',
              roles: ['user'],
            },
          ],
        },
      };

      engine.loadPrincipalPolicies([principalPolicy]);
      engine.loadResourcePolicies([resourcePolicy]);

      const result = engine.check({
        principal: { id: 'john@example.com', roles: ['user'], attributes: {} },
        resource: { kind: 'expense', id: 'exp-1', attributes: {} },
        actions: ['view'],
      });

      expect(result.results['view'].effect).toBe('allow');
    });
  });

  describe('principal policy conditions', () => {
    it('should evaluate conditions in principal policy rules', () => {
      const principalPolicy: ValidatedPrincipalPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'PrincipalPolicy',
        metadata: { name: 'manager-policy' },
        spec: {
          principal: 'manager@example.com',
          version: '1.0',
          rules: [
            {
              resource: 'expense',
              actions: [
                {
                  action: 'approve',
                  effect: 'allow',
                  condition: { expression: 'resource.amount <= 5000' },
                },
              ],
            },
          ],
        },
      };

      engine.loadPrincipalPolicies([principalPolicy]);

      // Should allow when condition is met
      const allowResult = engine.check({
        principal: { id: 'manager@example.com', roles: [], attributes: {} },
        resource: { kind: 'expense', id: 'exp-1', attributes: { amount: 3000 } },
        actions: ['approve'],
      });
      expect(allowResult.results['approve'].effect).toBe('allow');

      // Should deny when condition is not met (default deny)
      const denyResult = engine.check({
        principal: { id: 'manager@example.com', roles: [], attributes: {} },
        resource: { kind: 'expense', id: 'exp-2', attributes: { amount: 10000 } },
        actions: ['approve'],
      });
      expect(denyResult.results['approve'].effect).toBe('deny');
    });
  });

  describe('fallback to resource policies', () => {
    it('should fall back to resource policy when no principal policy matches', () => {
      const resourcePolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'expense-policy' },
        spec: {
          resource: 'expense',
          rules: [
            {
              actions: ['view'],
              effect: 'allow',
              roles: ['user'],
            },
          ],
        },
      };

      engine.loadResourcePolicies([resourcePolicy]);

      const result = engine.check({
        principal: { id: 'unknown@example.com', roles: ['user'], attributes: {} },
        resource: { kind: 'expense', id: 'exp-1', attributes: {} },
        actions: ['view'],
      });

      expect(result.results['view'].effect).toBe('allow');
      expect(result.results['view'].policy).toBe('expense-policy');
    });
  });

  describe('domain patterns', () => {
    it('should match principals by domain suffix pattern', () => {
      const principalPolicy: ValidatedPrincipalPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'PrincipalPolicy',
        metadata: { name: 'engineering-policy' },
        spec: {
          principal: '*@engineering.corp',
          version: '1.0',
          rules: [
            {
              resource: 'code-repo',
              actions: [
                { action: 'read', effect: 'allow' },
                { action: 'write', effect: 'allow' },
              ],
            },
          ],
        },
      };

      engine.loadPrincipalPolicies([principalPolicy]);

      // Engineering domain user should have access
      const engResult = engine.check({
        principal: { id: 'alice@engineering.corp', roles: [], attributes: {} },
        resource: { kind: 'code-repo', id: 'repo-1', attributes: {} },
        actions: ['write'],
      });
      expect(engResult.results['write'].effect).toBe('allow');

      // Non-engineering domain user should be denied
      const salesResult = engine.check({
        principal: { id: 'bob@sales.corp', roles: [], attributes: {} },
        resource: { kind: 'code-repo', id: 'repo-1', attributes: {} },
        actions: ['write'],
      });
      expect(salesResult.results['write'].effect).toBe('deny');
    });
  });

  describe('multiple actions evaluation', () => {
    it('should evaluate multiple actions in single request', () => {
      const principalPolicy: ValidatedPrincipalPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'PrincipalPolicy',
        metadata: { name: 'john-policy' },
        spec: {
          principal: 'john@example.com',
          version: '1.0',
          rules: [
            {
              resource: 'document',
              actions: [
                { action: 'view', effect: 'allow' },
                { action: 'edit', effect: 'allow' },
                { action: 'delete', effect: 'deny' },
              ],
            },
          ],
        },
      };

      engine.loadPrincipalPolicies([principalPolicy]);

      const result = engine.check({
        principal: { id: 'john@example.com', roles: [], attributes: {} },
        resource: { kind: 'document', id: 'doc-1', attributes: {} },
        actions: ['view', 'edit', 'delete', 'share'],
      });

      expect(result.results['view'].effect).toBe('allow');
      expect(result.results['edit'].effect).toBe('allow');
      expect(result.results['delete'].effect).toBe('deny');
      expect(result.results['share'].effect).toBe('deny'); // No matching rule
    });
  });

  describe('clearPolicies', () => {
    it('should clear principal policies with clearPolicies', () => {
      const principalPolicy: ValidatedPrincipalPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'PrincipalPolicy',
        metadata: { name: 'test-policy' },
        spec: {
          principal: 'test@example.com',
          version: '1.0',
          rules: [{ resource: 'test', actions: [{ action: 'read', effect: 'allow' }] }],
        },
      };

      engine.loadPrincipalPolicies([principalPolicy]);
      expect(engine.getStats().principalPolicies).toBe(1);

      engine.clearPolicies();
      expect(engine.getStats().principalPolicies).toBe(0);
    });
  });
});
