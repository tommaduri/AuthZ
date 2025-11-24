import { describe, it, expect, beforeEach } from 'vitest';
import { DerivedRolesResolver } from '../../../src/derived-roles/resolver';
import { CircularDependencyError } from '../../../src/derived-roles/types';
import { DerivedRolesCache } from '../../../src/derived-roles/cache';
import type { ValidatedDerivedRolesPolicy } from '../../../src/policy/schema';
import type { Principal, Resource } from '../../../src/types';

describe('DerivedRolesResolver', () => {
  let mockCelEvaluator: { evaluateBoolean: ReturnType<typeof vi.fn> };
  let resolver: DerivedRolesResolver;

  beforeEach(() => {
    mockCelEvaluator = {
      evaluateBoolean: vi.fn().mockReturnValue(true),
    };
    resolver = new DerivedRolesResolver({ celEvaluator: mockCelEvaluator });
  });

  const createPrincipal = (id: string, roles: string[]): Principal => ({
    id,
    roles,
    attributes: {},
  });

  const createResource = (kind: string, id: string): Resource => ({
    kind,
    id,
    attributes: {},
  });

  describe('Basic Role Derivation', () => {
    it('should derive role when parent role matches and condition is true', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test-derived' },
        spec: {
          definitions: [
            {
              name: 'owner',
              parentRoles: ['user'],
              condition: { expression: 'R.attr.ownerId == P.id' },
            },
          ],
        },
      };

      resolver.loadPolicies([policy]);
      const principal = createPrincipal('user123', ['user']);
      const resource = createResource('document', 'doc1');

      const roles = resolver.resolve(principal, resource);

      expect(roles).toEqual(['owner']);
      expect(mockCelEvaluator.evaluateBoolean).toHaveBeenCalledWith(
        'R.attr.ownerId == P.id',
        expect.objectContaining({ principal, resource }),
      );
    });

    it('should not derive role when parent role does not match', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test-derived' },
        spec: {
          definitions: [
            {
              name: 'owner',
              parentRoles: ['user'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      resolver.loadPolicies([policy]);
      const principal = createPrincipal('user123', ['guest']);
      const resource = createResource('document', 'doc1');

      const roles = resolver.resolve(principal, resource);

      expect(roles).toEqual([]);
      expect(mockCelEvaluator.evaluateBoolean).not.toHaveBeenCalled();
    });

    it('should not derive role when condition is false', () => {
      mockCelEvaluator.evaluateBoolean.mockReturnValue(false);

      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test-derived' },
        spec: {
          definitions: [
            {
              name: 'owner',
              parentRoles: ['user'],
              condition: { expression: 'R.attr.ownerId == P.id' },
            },
          ],
        },
      };

      resolver.loadPolicies([policy]);
      const principal = createPrincipal('user123', ['user']);
      const resource = createResource('document', 'doc1');

      const roles = resolver.resolve(principal, resource);

      expect(roles).toEqual([]);
    });

    it('should derive multiple roles when conditions match', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test-derived' },
        spec: {
          definitions: [
            {
              name: 'owner',
              parentRoles: ['user'],
              condition: { expression: 'true' },
            },
            {
              name: 'editor',
              parentRoles: ['user'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      resolver.loadPolicies([policy]);
      const principal = createPrincipal('user123', ['user']);
      const resource = createResource('document', 'doc1');

      const roles = resolver.resolve(principal, resource);

      expect(roles).toEqual(['owner', 'editor']);
    });

    it('should handle empty parent roles (match any principal)', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test-derived' },
        spec: {
          definitions: [
            {
              name: 'public',
              parentRoles: [],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      resolver.loadPolicies([policy]);
      const principal = createPrincipal('user123', ['guest']);
      const resource = createResource('document', 'doc1');

      const roles = resolver.resolve(principal, resource);

      expect(roles).toEqual(['public']);
    });
  });

  describe('Wildcard Parent Roles', () => {
    it('should match wildcard "*" when principal has any role', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test-derived' },
        spec: {
          definitions: [
            {
              name: 'authenticated',
              parentRoles: ['*'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      resolver.loadPolicies([policy]);
      const principal = createPrincipal('user123', ['anything']);
      const resource = createResource('document', 'doc1');

      const roles = resolver.resolve(principal, resource);

      expect(roles).toEqual(['authenticated']);
    });

    it('should not match wildcard "*" when principal has no roles', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test-derived' },
        spec: {
          definitions: [
            {
              name: 'authenticated',
              parentRoles: ['*'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      resolver.loadPolicies([policy]);
      const principal = createPrincipal('user123', []);
      const resource = createResource('document', 'doc1');

      const roles = resolver.resolve(principal, resource);

      expect(roles).toEqual([]);
    });

    it('should match prefix wildcard "admin:*" for any admin role', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test-derived' },
        spec: {
          definitions: [
            {
              name: 'super_admin',
              parentRoles: ['admin:*'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      resolver.loadPolicies([policy]);
      const principal = createPrincipal('user123', ['admin:read', 'user']);
      const resource = createResource('document', 'doc1');

      const roles = resolver.resolve(principal, resource);

      expect(roles).toEqual(['super_admin']);
    });

    it('should not match prefix wildcard when principal has no matching prefix', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test-derived' },
        spec: {
          definitions: [
            {
              name: 'super_admin',
              parentRoles: ['admin:*'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      resolver.loadPolicies([policy]);
      const principal = createPrincipal('user123', ['user', 'guest']);
      const resource = createResource('document', 'doc1');

      const roles = resolver.resolve(principal, resource);

      expect(roles).toEqual([]);
    });

    it('should match exact role before checking wildcards', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test-derived' },
        spec: {
          definitions: [
            {
              name: 'manager',
              parentRoles: ['admin', 'manager:*'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      resolver.loadPolicies([policy]);
      const principal = createPrincipal('user123', ['admin']);
      const resource = createResource('document', 'doc1');

      const roles = resolver.resolve(principal, resource);

      expect(roles).toEqual(['manager']);
    });

    it('should handle multiple wildcards in parent roles', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test-derived' },
        spec: {
          definitions: [
            {
              name: 'privileged',
              parentRoles: ['admin:*', 'manager:*'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      resolver.loadPolicies([policy]);
      const principal1 = createPrincipal('user1', ['admin:read']);
      const principal2 = createPrincipal('user2', ['manager:write']);
      const resource = createResource('document', 'doc1');

      expect(resolver.resolve(principal1, resource)).toEqual(['privileged']);
      expect(resolver.resolve(principal2, resource)).toEqual(['privileged']);
    });

    it('should handle mix of exact and wildcard parent roles', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test-derived' },
        spec: {
          definitions: [
            {
              name: 'elevated',
              parentRoles: ['superuser', 'admin:*', '*:write'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      resolver.loadPolicies([policy]);
      const principal1 = createPrincipal('user1', ['superuser']);
      const principal2 = createPrincipal('user2', ['admin:read']);
      const principal3 = createPrincipal('user3', ['manager:write']);
      const resource = createResource('document', 'doc1');

      expect(resolver.resolve(principal1, resource)).toEqual(['elevated']);
      expect(resolver.resolve(principal2, resource)).toEqual(['elevated']);
      expect(resolver.resolve(principal3, resource)).toEqual(['elevated']);
    });

    it('should not match partial prefix without colon', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test-derived' },
        spec: {
          definitions: [
            {
              name: 'admin_role',
              parentRoles: ['admin:*'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      resolver.loadPolicies([policy]);
      const principal = createPrincipal('user123', ['administrator', 'adminuser']);
      const resource = createResource('document', 'doc1');

      const roles = resolver.resolve(principal, resource);

      expect(roles).toEqual([]);
    });
  });

  describe('CEL Condition Evaluation', () => {
    it('should pass principal, resource, and auxData to CEL evaluator', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test-derived' },
        spec: {
          definitions: [
            {
              name: 'owner',
              parentRoles: ['user'],
              condition: { expression: 'R.attr.ownerId == P.id && A.isWeekday' },
            },
          ],
        },
      };

      resolver.loadPolicies([policy]);
      const principal = createPrincipal('user123', ['user']);
      const resource = createResource('document', 'doc1');
      const auxData = { isWeekday: true };

      resolver.resolve(principal, resource, auxData);

      expect(mockCelEvaluator.evaluateBoolean).toHaveBeenCalledWith(
        'R.attr.ownerId == P.id && A.isWeekday',
        expect.objectContaining({ principal, resource, auxData }),
      );
    });

    it('should handle CEL evaluation errors gracefully', () => {
      mockCelEvaluator.evaluateBoolean.mockImplementation(() => {
        throw new Error('CEL evaluation failed');
      });

      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test-derived' },
        spec: {
          definitions: [
            {
              name: 'owner',
              parentRoles: ['user'],
              condition: { expression: 'invalid' },
            },
          ],
        },
      };

      resolver.loadPolicies([policy]);
      const principal = createPrincipal('user123', ['user']);
      const resource = createResource('document', 'doc1');

      const roles = resolver.resolve(principal, resource);

      expect(roles).toEqual([]);
    });

    it('should evaluate multiple conditions independently', () => {
      mockCelEvaluator.evaluateBoolean
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);

      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test-derived' },
        spec: {
          definitions: [
            {
              name: 'role1',
              parentRoles: ['user'],
              condition: { expression: 'condition1' },
            },
            {
              name: 'role2',
              parentRoles: ['user'],
              condition: { expression: 'condition2' },
            },
            {
              name: 'role3',
              parentRoles: ['user'],
              condition: { expression: 'condition3' },
            },
          ],
        },
      };

      resolver.loadPolicies([policy]);
      const principal = createPrincipal('user123', ['user']);
      const resource = createResource('document', 'doc1');

      const roles = resolver.resolve(principal, resource);

      expect(roles).toEqual(['role1', 'role3']);
      expect(mockCelEvaluator.evaluateBoolean).toHaveBeenCalledTimes(3);
    });

    it('should support complex CEL expressions', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test-derived' },
        spec: {
          definitions: [
            {
              name: 'senior_owner',
              parentRoles: ['user'],
              condition: {
                expression:
                  'R.attr.ownerId == P.id && P.attr.tenure > 365 && R.attr.value > 10000',
              },
            },
          ],
        },
      };

      resolver.loadPolicies([policy]);
      const principal = createPrincipal('user123', ['user']);
      const resource = createResource('document', 'doc1');

      resolver.resolve(principal, resource);

      expect(mockCelEvaluator.evaluateBoolean).toHaveBeenCalledWith(
        'R.attr.ownerId == P.id && P.attr.tenure > 365 && R.attr.value > 10000',
        expect.any(Object),
      );
    });

    it('should handle boolean return values correctly', () => {
      mockCelEvaluator.evaluateBoolean.mockReturnValueOnce(true).mockReturnValueOnce(false);

      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test-derived' },
        spec: {
          definitions: [
            {
              name: 'role_true',
              parentRoles: ['user'],
              condition: { expression: 'true_condition' },
            },
            {
              name: 'role_false',
              parentRoles: ['user'],
              condition: { expression: 'false_condition' },
            },
          ],
        },
      };

      resolver.loadPolicies([policy]);
      const principal = createPrincipal('user123', ['user']);
      const resource = createResource('document', 'doc1');

      const roles = resolver.resolve(principal, resource);

      expect(roles).toEqual(['role_true']);
    });

    it('should not evaluate condition if parent role does not match', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test-derived' },
        spec: {
          definitions: [
            {
              name: 'owner',
              parentRoles: ['admin'],
              condition: { expression: 'complex_expression' },
            },
          ],
        },
      };

      resolver.loadPolicies([policy]);
      const principal = createPrincipal('user123', ['user']);
      const resource = createResource('document', 'doc1');

      resolver.resolve(principal, resource);

      expect(mockCelEvaluator.evaluateBoolean).not.toHaveBeenCalled();
    });
  });

  describe('Circular Dependency Detection', () => {
    it('should throw error on simple circular dependency (A -> B -> A)', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'circular-test' },
        spec: {
          definitions: [
            {
              name: 'roleA',
              parentRoles: ['roleB'],
              condition: { expression: 'true' },
            },
            {
              name: 'roleB',
              parentRoles: ['roleA'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      expect(() => resolver.loadPolicies([policy])).toThrow(CircularDependencyError);
    });

    it('should throw error on complex circular dependency (A -> B -> C -> A)', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'circular-test' },
        spec: {
          definitions: [
            {
              name: 'roleA',
              parentRoles: ['roleB'],
              condition: { expression: 'true' },
            },
            {
              name: 'roleB',
              parentRoles: ['roleC'],
              condition: { expression: 'true' },
            },
            {
              name: 'roleC',
              parentRoles: ['roleA'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      expect(() => resolver.loadPolicies([policy])).toThrow(CircularDependencyError);
    });

    it('should allow derived role depending on base role (not circular)', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'valid-test' },
        spec: {
          definitions: [
            {
              name: 'owner',
              parentRoles: ['user'], // 'user' is a base role, not a derived role
              condition: { expression: 'true' },
            },
          ],
        },
      };

      expect(() => resolver.loadPolicies([policy])).not.toThrow();
    });

    it('should allow chain of derived roles without cycles', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'chain-test' },
        spec: {
          definitions: [
            {
              name: 'base_role',
              parentRoles: ['user'],
              condition: { expression: 'true' },
            },
            {
              name: 'intermediate_role',
              parentRoles: ['base_role'],
              condition: { expression: 'true' },
            },
            {
              name: 'advanced_role',
              parentRoles: ['intermediate_role'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      expect(() => resolver.loadPolicies([policy])).not.toThrow();
    });

    it('should detect self-referencing role', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'self-ref-test' },
        spec: {
          definitions: [
            {
              name: 'recursive',
              parentRoles: ['recursive'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      expect(() => resolver.loadPolicies([policy])).toThrow(CircularDependencyError);
    });

    it('should handle multiple independent chains without error', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'multi-chain-test' },
        spec: {
          definitions: [
            {
              name: 'chain1_step1',
              parentRoles: ['user'],
              condition: { expression: 'true' },
            },
            {
              name: 'chain1_step2',
              parentRoles: ['chain1_step1'],
              condition: { expression: 'true' },
            },
            {
              name: 'chain2_step1',
              parentRoles: ['admin'],
              condition: { expression: 'true' },
            },
            {
              name: 'chain2_step2',
              parentRoles: ['chain2_step1'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      expect(() => resolver.loadPolicies([policy])).not.toThrow();
    });
  });

  describe('Multiple Definitions', () => {
    it('should load definitions from multiple policies', () => {
      const policy1: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'policy1' },
        spec: {
          definitions: [
            {
              name: 'role1',
              parentRoles: ['user'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      const policy2: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'policy2' },
        spec: {
          definitions: [
            {
              name: 'role2',
              parentRoles: ['user'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      resolver.loadPolicies([policy1, policy2]);
      expect(resolver.getDefinitionsCount()).toBe(2);

      const principal = createPrincipal('user123', ['user']);
      const resource = createResource('document', 'doc1');
      const roles = resolver.resolve(principal, resource);

      expect(roles).toEqual(['role1', 'role2']);
    });

    it('should handle large number of definitions', () => {
      const definitions = Array.from({ length: 100 }, (_, i) => ({
        name: `role${i}`,
        parentRoles: ['user'],
        condition: { expression: 'true' },
      }));

      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'large-policy' },
        spec: { definitions },
      };

      resolver.loadPolicies([policy]);
      expect(resolver.getDefinitionsCount()).toBe(100);
    });

    it('should clear previously loaded policies', () => {
      const policy1: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'policy1' },
        spec: {
          definitions: [
            {
              name: 'role1',
              parentRoles: ['user'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      resolver.loadPolicies([policy1]);
      expect(resolver.getDefinitionsCount()).toBe(1);

      resolver.clear();
      expect(resolver.getDefinitionsCount()).toBe(0);
    });
  });

  describe('Evaluation Trace', () => {
    it('should provide evaluation trace with timing', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test-derived' },
        spec: {
          definitions: [
            {
              name: 'owner',
              parentRoles: ['user'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      resolver.loadPolicies([policy]);
      const principal = createPrincipal('user123', ['user']);
      const resource = createResource('document', 'doc1');

      const result = resolver.resolveWithTrace(principal, resource);

      expect(result.roles).toEqual(['owner']);
      expect(result.traces).toHaveLength(1);
      expect(result.traces![0]).toMatchObject({
        roleName: 'owner',
        parentRoleMatched: true,
        parentRoles: ['user'],
        conditionEvaluated: true,
        conditionResult: true,
      });
      expect(result.traces![0].durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should trace parent role mismatch', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test-derived' },
        spec: {
          definitions: [
            {
              name: 'owner',
              parentRoles: ['admin'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      resolver.loadPolicies([policy]);
      const principal = createPrincipal('user123', ['user']);
      const resource = createResource('document', 'doc1');

      const result = resolver.resolveWithTrace(principal, resource);

      expect(result.roles).toEqual([]);
      expect(result.traces![0]).toMatchObject({
        roleName: 'owner',
        parentRoleMatched: false,
        conditionEvaluated: false,
        conditionResult: false,
      });
    });

    it('should trace evaluation errors', () => {
      mockCelEvaluator.evaluateBoolean.mockImplementation(() => {
        throw new Error('Evaluation failed');
      });

      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test-derived' },
        spec: {
          definitions: [
            {
              name: 'owner',
              parentRoles: ['user'],
              condition: { expression: 'invalid' },
            },
          ],
        },
      };

      resolver.loadPolicies([policy]);
      const principal = createPrincipal('user123', ['user']);
      const resource = createResource('document', 'doc1');

      const result = resolver.resolveWithTrace(principal, resource);

      expect(result.roles).toEqual([]);
      expect(result.traces![0].error).toBe('Evaluation failed');
    });
  });

  describe('Caching Integration', () => {
    it('should use cache when provided', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test-derived' },
        spec: {
          definitions: [
            {
              name: 'owner',
              parentRoles: ['user'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      resolver.loadPolicies([policy]);
      const cache = new DerivedRolesCache();
      const principal = createPrincipal('user123', ['user']);
      const resource = createResource('document', 'doc1');

      // First call - cache miss
      const roles1 = resolver.resolve(principal, resource, undefined, cache);
      expect(mockCelEvaluator.evaluateBoolean).toHaveBeenCalledTimes(1);

      // Second call - cache hit
      const roles2 = resolver.resolve(principal, resource, undefined, cache);
      expect(mockCelEvaluator.evaluateBoolean).toHaveBeenCalledTimes(1); // Not called again
      expect(roles1).toEqual(roles2);

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });
  });
});
