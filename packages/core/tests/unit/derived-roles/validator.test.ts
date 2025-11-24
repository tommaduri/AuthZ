import { describe, it, expect } from 'vitest';
import { DerivedRolesValidator } from '../../../src/derived-roles/validator';
import { CircularDependencyError } from '../../../src/derived-roles/types';
import type { ValidatedDerivedRolesPolicy } from '../../../src/policy/schema';

describe('DerivedRolesValidator', () => {
  let validator: DerivedRolesValidator;

  beforeEach(() => {
    validator = new DerivedRolesValidator();
  });

  describe('Schema Validation', () => {
    it('should accept valid derived roles policy', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'valid-policy' },
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

      expect(() => validator.validate([policy])).not.toThrow();
    });

    it('should reject duplicate role names', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'duplicate-policy' },
        spec: {
          definitions: [
            {
              name: 'owner',
              parentRoles: ['user'],
              condition: { expression: 'true' },
            },
            {
              name: 'owner', // Duplicate
              parentRoles: ['admin'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      expect(() => validator.validate([policy])).toThrow('Duplicate derived role name: owner');
    });

    it('should reject invalid role names with special characters', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'invalid-name-policy' },
        spec: {
          definitions: [
            {
              name: 'owner@role', // Invalid character
              parentRoles: ['user'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      expect(() => validator.validate([policy])).toThrow('Invalid derived role name');
    });

    it('should accept role names with hyphens and underscores', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'valid-names' },
        spec: {
          definitions: [
            {
              name: 'owner-role',
              parentRoles: ['user'],
              condition: { expression: 'true' },
            },
            {
              name: 'admin_role',
              parentRoles: ['user'],
              condition: { expression: 'true' },
            },
            {
              name: 'super-admin_v2',
              parentRoles: ['user'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      expect(() => validator.validate([policy])).not.toThrow();
    });
  });

  describe('Parent Role Validation', () => {
    it('should accept wildcard "*" parent role', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'wildcard-policy' },
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

      expect(() => validator.validate([policy])).not.toThrow();
    });

    it('should accept prefix wildcard "prefix:*" parent role', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'prefix-wildcard-policy' },
        spec: {
          definitions: [
            {
              name: 'admin',
              parentRoles: ['admin:*'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      expect(() => validator.validate([policy])).not.toThrow();
    });

    it('should reject invalid wildcard patterns', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'invalid-wildcard' },
        spec: {
          definitions: [
            {
              name: 'admin',
              parentRoles: ['admin*'], // Invalid - should be admin:*
              condition: { expression: 'true' },
            },
          ],
        },
      };

      expect(() => validator.validate([policy])).toThrow('Invalid parent role pattern');
    });

    it('should reject wildcards in the middle of role names', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'invalid-wildcard' },
        spec: {
          definitions: [
            {
              name: 'admin',
              parentRoles: ['admin:*:role'], // Invalid - wildcard must be at end
              condition: { expression: 'true' },
            },
          ],
        },
      };

      expect(() => validator.validate([policy])).toThrow('Invalid parent role pattern');
    });
  });

  describe('Circular Dependency Detection', () => {
    it('should detect simple circular dependency (A -> B -> A)', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'circular' },
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

      expect(() => validator.validate([policy])).toThrow(CircularDependencyError);
    });

    it('should detect complex circular dependency (A -> B -> C -> A)', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'circular' },
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

      expect(() => validator.validate([policy])).toThrow(CircularDependencyError);
    });

    it('should detect self-referencing role', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'self-ref' },
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

      expect(() => validator.validate([policy])).toThrow(CircularDependencyError);
    });

    it('should allow roles depending on base roles (not derived)', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'valid' },
        spec: {
          definitions: [
            {
              name: 'owner',
              parentRoles: ['user'], // 'user' is a base role
              condition: { expression: 'true' },
            },
            {
              name: 'admin',
              parentRoles: ['superuser'], // 'superuser' is a base role
              condition: { expression: 'true' },
            },
          ],
        },
      };

      expect(() => validator.validate([policy])).not.toThrow();
    });

    it('should allow valid dependency chain without cycles', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'chain' },
        spec: {
          definitions: [
            {
              name: 'level1',
              parentRoles: ['user'],
              condition: { expression: 'true' },
            },
            {
              name: 'level2',
              parentRoles: ['level1'],
              condition: { expression: 'true' },
            },
            {
              name: 'level3',
              parentRoles: ['level2'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      expect(() => validator.validate([policy])).not.toThrow();
    });

    it('should handle diamond dependency (A -> B, A -> C, B -> D, C -> D)', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'diamond' },
        spec: {
          definitions: [
            {
              name: 'roleD',
              parentRoles: ['user'],
              condition: { expression: 'true' },
            },
            {
              name: 'roleB',
              parentRoles: ['roleD'],
              condition: { expression: 'true' },
            },
            {
              name: 'roleC',
              parentRoles: ['roleD'],
              condition: { expression: 'true' },
            },
            {
              name: 'roleA',
              parentRoles: ['roleB', 'roleC'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      expect(() => validator.validate([policy])).not.toThrow();
    });

    it('should handle multiple independent chains', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'multi-chain' },
        spec: {
          definitions: [
            // Chain 1
            {
              name: 'chain1_a',
              parentRoles: ['user'],
              condition: { expression: 'true' },
            },
            {
              name: 'chain1_b',
              parentRoles: ['chain1_a'],
              condition: { expression: 'true' },
            },
            // Chain 2
            {
              name: 'chain2_a',
              parentRoles: ['admin'],
              condition: { expression: 'true' },
            },
            {
              name: 'chain2_b',
              parentRoles: ['chain2_a'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      expect(() => validator.validate([policy])).not.toThrow();
    });

    it('should detect cycle in one chain while others are valid', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'partial-cycle' },
        spec: {
          definitions: [
            // Valid chain
            {
              name: 'valid_a',
              parentRoles: ['user'],
              condition: { expression: 'true' },
            },
            {
              name: 'valid_b',
              parentRoles: ['valid_a'],
              condition: { expression: 'true' },
            },
            // Circular chain
            {
              name: 'circular_a',
              parentRoles: ['circular_b'],
              condition: { expression: 'true' },
            },
            {
              name: 'circular_b',
              parentRoles: ['circular_a'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      expect(() => validator.validate([policy])).toThrow(CircularDependencyError);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty policies array', () => {
      expect(() => validator.validate([])).not.toThrow();
    });

    it('should handle policy with empty definitions', () => {
      const policy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'empty' },
        spec: {
          definitions: [],
        },
      };

      expect(() => validator.validate([policy])).not.toThrow();
    });

    it('should handle multiple policies with no conflicts', () => {
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
              parentRoles: ['admin'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      expect(() => validator.validate([policy1, policy2])).not.toThrow();
    });
  });
});
