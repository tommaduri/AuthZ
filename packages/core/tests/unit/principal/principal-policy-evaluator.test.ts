import { describe, it, expect, beforeEach } from 'vitest';
import { PrincipalPolicyEvaluator } from '../../../src/principal/principal-policy-evaluator';
import { CelEvaluator } from '../../../src/cel/evaluator';
import type { ValidatedPrincipalPolicy } from '../../../src/policy/schema';
import type { CheckRequest } from '../../../src/types';

describe('PrincipalPolicyEvaluator', () => {
  let evaluator: PrincipalPolicyEvaluator;
  let celEvaluator: CelEvaluator;

  beforeEach(() => {
    celEvaluator = new CelEvaluator();
    evaluator = new PrincipalPolicyEvaluator({ celEvaluator });
  });

  describe('loadPolicies', () => {
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

      evaluator.loadPolicies([policy]);
      const stats = evaluator.getStats();
      expect(stats.totalPolicies).toBe(1);
      expect(stats.uniquePrincipals).toBe(1);
    });

    it('should load multiple policies', () => {
      const policies: ValidatedPrincipalPolicy[] = [
        {
          apiVersion: 'authz.engine/v1',
          kind: 'PrincipalPolicy',
          metadata: { name: 'john-policy' },
          spec: {
            principal: 'john@example.com',
            version: '1.0',
            rules: [{ resource: 'expense', actions: [{ action: 'view', effect: 'allow' }] }],
          },
        },
        {
          apiVersion: 'authz.engine/v1',
          kind: 'PrincipalPolicy',
          metadata: { name: 'jane-policy' },
          spec: {
            principal: 'jane@example.com',
            version: '1.0',
            rules: [{ resource: 'expense', actions: [{ action: 'view', effect: 'allow' }] }],
          },
        },
      ];

      evaluator.loadPolicies(policies);
      const stats = evaluator.getStats();
      expect(stats.totalPolicies).toBe(2);
      expect(stats.uniquePrincipals).toBe(2);
    });
  });

  describe('clearPolicies', () => {
    it('should clear all loaded policies', () => {
      const policy: ValidatedPrincipalPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'PrincipalPolicy',
        metadata: { name: 'test-policy' },
        spec: {
          principal: 'test@example.com',
          version: '1.0',
          rules: [{ resource: 'test', actions: [{ action: 'read', effect: 'allow' }] }],
        },
      };

      evaluator.loadPolicies([policy]);
      expect(evaluator.getStats().totalPolicies).toBe(1);

      evaluator.clearPolicies();
      expect(evaluator.getStats().totalPolicies).toBe(0);
    });
  });

  describe('findPolicies', () => {
    const johnPolicy: ValidatedPrincipalPolicy = {
      apiVersion: 'authz.engine/v1',
      kind: 'PrincipalPolicy',
      metadata: { name: 'john-policy' },
      spec: {
        principal: 'john@example.com',
        version: '1.0',
        rules: [{ resource: 'expense', actions: [{ action: 'view', effect: 'allow' }] }],
      },
    };

    const servicePolicy: ValidatedPrincipalPolicy = {
      apiVersion: 'authz.engine/v1',
      kind: 'PrincipalPolicy',
      metadata: { name: 'service-policy' },
      spec: {
        principal: 'service-*',
        version: '1.0',
        rules: [{ resource: 'internal', actions: [{ action: 'access', effect: 'allow' }] }],
      },
    };

    beforeEach(() => {
      evaluator.loadPolicies([johnPolicy, servicePolicy]);
    });

    it('should find policies by exact principal match', () => {
      const policies = evaluator.findPolicies('john@example.com');
      expect(policies).toHaveLength(1);
      expect(policies[0].metadata.name).toBe('john-policy');
    });

    it('should find policies by wildcard pattern', () => {
      const policies = evaluator.findPolicies('service-backup');
      expect(policies).toHaveLength(1);
      expect(policies[0].metadata.name).toBe('service-policy');
    });

    it('should return empty array when no policies match', () => {
      const policies = evaluator.findPolicies('unknown@example.com');
      expect(policies).toHaveLength(0);
    });

    it('should find multiple matching policies', () => {
      const wildcardPolicy: ValidatedPrincipalPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'PrincipalPolicy',
        metadata: { name: 'all-policy' },
        spec: {
          principal: '*',
          version: '1.0',
          rules: [{ resource: 'public', actions: [{ action: 'read', effect: 'allow' }] }],
        },
      };
      evaluator.loadPolicies([wildcardPolicy]);

      const policies = evaluator.findPolicies('john@example.com');
      expect(policies).toHaveLength(2); // john-policy and all-policy
    });

    it('should filter by version when specified', () => {
      const v2Policy: ValidatedPrincipalPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'PrincipalPolicy',
        metadata: { name: 'john-policy-v2' },
        spec: {
          principal: 'john@example.com',
          version: '2.0',
          rules: [{ resource: 'expense', actions: [{ action: 'approve', effect: 'allow' }] }],
        },
      };
      evaluator.loadPolicies([v2Policy]);

      const v1Policies = evaluator.findPolicies('john@example.com', '1.0');
      expect(v1Policies).toHaveLength(1);
      expect(v1Policies[0].spec.version).toBe('1.0');

      const v2Policies = evaluator.findPolicies('john@example.com', '2.0');
      expect(v2Policies).toHaveLength(1);
      expect(v2Policies[0].spec.version).toBe('2.0');
    });
  });

  describe('evaluate', () => {
    it('should return null when no policies match principal', () => {
      const request: CheckRequest = {
        principal: { id: 'unknown@example.com', roles: [], attributes: {} },
        resource: { kind: 'expense', id: 'exp-1', attributes: {} },
        actions: ['view'],
      };

      const result = evaluator.evaluate(request);
      expect(result).toBeNull();
    });

    it('should allow action when principal policy allows', () => {
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
      evaluator.loadPolicies([policy]);

      const request: CheckRequest = {
        principal: { id: 'john@example.com', roles: [], attributes: {} },
        resource: { kind: 'expense', id: 'exp-1', attributes: {} },
        actions: ['view'],
      };

      const result = evaluator.evaluate(request);
      expect(result).not.toBeNull();
      expect(result?.effect).toBe('allow');
      expect(result?.policy).toBe('john-policy');
    });

    it('should deny action when principal policy denies', () => {
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
              actions: [{ action: 'delete', effect: 'deny' }],
            },
          ],
        },
      };
      evaluator.loadPolicies([policy]);

      const request: CheckRequest = {
        principal: { id: 'john@example.com', roles: [], attributes: {} },
        resource: { kind: 'expense', id: 'exp-1', attributes: {} },
        actions: ['delete'],
      };

      const result = evaluator.evaluate(request);
      expect(result).not.toBeNull();
      expect(result?.effect).toBe('deny');
    });

    it('should evaluate conditions', () => {
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
              actions: [
                {
                  action: 'approve',
                  effect: 'allow',
                  condition: { expression: 'resource.amount <= 10000' },
                },
              ],
            },
          ],
        },
      };
      evaluator.loadPolicies([policy]);

      // Should allow when condition is met
      const allowRequest: CheckRequest = {
        principal: { id: 'john@example.com', roles: [], attributes: {} },
        resource: { kind: 'expense', id: 'exp-1', attributes: { amount: 5000 } },
        actions: ['approve'],
      };
      const allowResult = evaluator.evaluate(allowRequest);
      expect(allowResult?.effect).toBe('allow');

      // Should return null when condition is not met (no rule matches)
      const denyRequest: CheckRequest = {
        principal: { id: 'john@example.com', roles: [], attributes: {} },
        resource: { kind: 'expense', id: 'exp-2', attributes: { amount: 15000 } },
        actions: ['approve'],
      };
      const denyResult = evaluator.evaluate(denyRequest);
      expect(denyResult).toBeNull();
    });

    it('should match resource by wildcard', () => {
      const policy: ValidatedPrincipalPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'PrincipalPolicy',
        metadata: { name: 'admin-policy' },
        spec: {
          principal: 'admin@example.com',
          version: '1.0',
          rules: [
            {
              resource: '*',
              actions: [{ action: 'view', effect: 'allow' }],
            },
          ],
        },
      };
      evaluator.loadPolicies([policy]);

      const request: CheckRequest = {
        principal: { id: 'admin@example.com', roles: [], attributes: {} },
        resource: { kind: 'any-resource', id: 'res-1', attributes: {} },
        actions: ['view'],
      };

      const result = evaluator.evaluate(request);
      expect(result?.effect).toBe('allow');
    });

    it('should return null for unmatched action', () => {
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
      evaluator.loadPolicies([policy]);

      const request: CheckRequest = {
        principal: { id: 'john@example.com', roles: [], attributes: {} },
        resource: { kind: 'expense', id: 'exp-1', attributes: {} },
        actions: ['delete'], // Different action
      };

      const result = evaluator.evaluate(request);
      expect(result).toBeNull();
    });

    it('should handle action wildcards', () => {
      const policy: ValidatedPrincipalPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'PrincipalPolicy',
        metadata: { name: 'admin-policy' },
        spec: {
          principal: 'admin@example.com',
          version: '1.0',
          rules: [
            {
              resource: 'expense',
              actions: [{ action: '*', effect: 'allow' }],
            },
          ],
        },
      };
      evaluator.loadPolicies([policy]);

      const request: CheckRequest = {
        principal: { id: 'admin@example.com', roles: [], attributes: {} },
        resource: { kind: 'expense', id: 'exp-1', attributes: {} },
        actions: ['anything'],
      };

      const result = evaluator.evaluate(request);
      expect(result?.effect).toBe('allow');
    });
  });

  describe('deny-override combining', () => {
    it('should return deny if any policy denies', () => {
      const policies: ValidatedPrincipalPolicy[] = [
        {
          apiVersion: 'authz.engine/v1',
          kind: 'PrincipalPolicy',
          metadata: { name: 'allow-policy' },
          spec: {
            principal: '*',
            version: '1.0',
            rules: [
              {
                resource: 'expense',
                actions: [{ action: 'view', effect: 'allow' }],
              },
            ],
          },
        },
        {
          apiVersion: 'authz.engine/v1',
          kind: 'PrincipalPolicy',
          metadata: { name: 'deny-policy' },
          spec: {
            principal: 'john@example.com',
            version: '1.0',
            rules: [
              {
                resource: 'expense',
                actions: [{ action: 'view', effect: 'deny' }],
              },
            ],
          },
        },
      ];
      evaluator.loadPolicies(policies);

      const request: CheckRequest = {
        principal: { id: 'john@example.com', roles: [], attributes: {} },
        resource: { kind: 'expense', id: 'exp-1', attributes: {} },
        actions: ['view'],
      };

      const result = evaluator.evaluate(request);
      expect(result?.effect).toBe('deny');
    });
  });

  describe('multiple resource rules', () => {
    it('should support multiple resource rules per policy', () => {
      const policy: ValidatedPrincipalPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'PrincipalPolicy',
        metadata: { name: 'multi-resource-policy' },
        spec: {
          principal: 'manager@example.com',
          version: '1.0',
          rules: [
            {
              resource: 'expense',
              actions: [
                { action: 'view', effect: 'allow' },
                { action: 'approve', effect: 'allow' },
              ],
            },
            {
              resource: 'report',
              actions: [
                { action: 'view', effect: 'allow' },
                { action: 'export', effect: 'allow' },
              ],
            },
          ],
        },
      };
      evaluator.loadPolicies([policy]);

      // Test expense resource
      const expenseRequest: CheckRequest = {
        principal: { id: 'manager@example.com', roles: [], attributes: {} },
        resource: { kind: 'expense', id: 'exp-1', attributes: {} },
        actions: ['approve'],
      };
      expect(evaluator.evaluate(expenseRequest)?.effect).toBe('allow');

      // Test report resource
      const reportRequest: CheckRequest = {
        principal: { id: 'manager@example.com', roles: [], attributes: {} },
        resource: { kind: 'report', id: 'rep-1', attributes: {} },
        actions: ['export'],
      };
      expect(evaluator.evaluate(reportRequest)?.effect).toBe('allow');
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const policies: ValidatedPrincipalPolicy[] = [
        {
          apiVersion: 'authz.engine/v1',
          kind: 'PrincipalPolicy',
          metadata: { name: 'policy-1' },
          spec: { principal: 'user1@example.com', version: '1.0', rules: [] },
        },
        {
          apiVersion: 'authz.engine/v1',
          kind: 'PrincipalPolicy',
          metadata: { name: 'policy-2' },
          spec: { principal: 'user2@example.com', version: '1.0', rules: [] },
        },
        {
          apiVersion: 'authz.engine/v1',
          kind: 'PrincipalPolicy',
          metadata: { name: 'policy-3' },
          spec: { principal: 'user1@example.com', version: '2.0', rules: [] },
        },
      ];
      evaluator.loadPolicies(policies);

      const stats = evaluator.getStats();
      expect(stats.totalPolicies).toBe(3);
      expect(stats.uniquePrincipals).toBe(2);
    });
  });
});
