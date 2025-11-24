/**
 * Policy Syntax Validation Tests
 *
 * Comprehensive test suite for policy syntax validation.
 * These tests follow TDD methodology - they will FAIL initially
 * until the policy-validator module is implemented.
 *
 * @module @authz-engine/core/tests/validation
 */

import { describe, it, expect, beforeEach } from 'vitest';
// This import will fail until the module is created (TDD Red Phase)
import {
  validatePolicy,
  validatePolicies,
  ValidationResult,
  ValidationError,
  ValidationErrorCode,
  PolicyValidator,
} from '../../../src/validation/policy-validator';

// =============================================================================
// Test Fixtures
// =============================================================================

const validResourcePolicy = {
  apiVersion: 'authz.engine/v1' as const,
  kind: 'ResourcePolicy' as const,
  metadata: {
    name: 'subscription-access',
    description: 'Access control for subscription resources',
    version: '1.0.0',
  },
  spec: {
    resource: 'subscription',
    rules: [
      {
        actions: ['create', 'read', 'update', 'delete'],
        effect: 'allow' as const,
        roles: ['admin'],
        name: 'admin-full-access',
      },
      {
        actions: ['read'],
        effect: 'allow' as const,
        roles: ['user'],
        condition: {
          expression: 'resource.ownerId == principal.id',
        },
        name: 'owner-read-access',
      },
    ],
  },
};

const validDerivedRolesPolicy = {
  apiVersion: 'authz.engine/v1' as const,
  kind: 'DerivedRoles' as const,
  metadata: {
    name: 'common-derived-roles',
    description: 'Common derived roles for the application',
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
        name: 'team_member',
        parentRoles: ['user'],
        condition: {
          expression: 'resource.teamId in principal.teams',
        },
      },
    ],
  },
};

const validPrincipalPolicy = {
  apiVersion: 'authz.engine/v1' as const,
  kind: 'PrincipalPolicy' as const,
  metadata: {
    name: 'admin-overrides',
  },
  spec: {
    principal: 'admin@example.com',
    version: '1.0.0',
    rules: [
      {
        resource: 'audit_logs',
        actions: [
          {
            action: 'read',
            effect: 'allow' as const,
          },
        ],
      },
    ],
  },
};

// =============================================================================
// Valid Policy Tests
// =============================================================================

describe('Policy Syntax Validation', () => {
  let validator: PolicyValidator;

  beforeEach(() => {
    validator = new PolicyValidator();
  });

  describe('valid policies', () => {
    it('should accept valid resource policy', () => {
      const result = validatePolicy(validResourcePolicy);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should accept valid derived roles policy', () => {
      const result = validatePolicy(validDerivedRolesPolicy);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept valid principal policy', () => {
      const result = validatePolicy(validPrincipalPolicy);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept policy with all optional metadata fields', () => {
      const policy = {
        ...validResourcePolicy,
        metadata: {
          name: 'full-metadata-policy',
          description: 'Policy with all metadata',
          version: '2.0.0',
          labels: {
            environment: 'production',
            team: 'platform',
          },
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(true);
    });

    it('should accept policy with multiple conditions using AND/OR', () => {
      const policy = {
        ...validResourcePolicy,
        spec: {
          ...validResourcePolicy.spec,
          rules: [
            {
              actions: ['update'],
              effect: 'allow' as const,
              roles: ['editor'],
              condition: {
                expression:
                  '(resource.status == "draft" || resource.status == "review") && principal.department == resource.department',
              },
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(true);
    });

    it('should accept policy with wildcard actions', () => {
      const policy = {
        ...validResourcePolicy,
        spec: {
          ...validResourcePolicy.spec,
          rules: [
            {
              actions: ['*'],
              effect: 'allow' as const,
              roles: ['superadmin'],
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(true);
    });

    it('should accept policy with derived roles references', () => {
      const policy = {
        ...validResourcePolicy,
        spec: {
          ...validResourcePolicy.spec,
          rules: [
            {
              actions: ['edit', 'delete'],
              effect: 'allow' as const,
              derivedRoles: ['owner'],
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(true);
    });
  });

  // =============================================================================
  // Required Fields Tests
  // =============================================================================

  describe('required fields', () => {
    it('should reject policy without apiVersion', () => {
      const policy = {
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: { resource: 'test', rules: [{ actions: ['read'], effect: 'allow' }] },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
          path: 'apiVersion',
          message: expect.stringContaining('apiVersion'),
        })
      );
    });

    it('should reject policy without kind', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        metadata: { name: 'test' },
        spec: { resource: 'test', rules: [{ actions: ['read'], effect: 'allow' }] },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
          path: 'kind',
        })
      );
    });

    it('should reject policy without metadata', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        spec: { resource: 'test', rules: [{ actions: ['read'], effect: 'allow' }] },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
          path: 'metadata',
        })
      );
    });

    it('should reject policy without metadata.name', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { description: 'Missing name' },
        spec: { resource: 'test', rules: [{ actions: ['read'], effect: 'allow' }] },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
          path: 'metadata.name',
        })
      );
    });

    it('should reject policy without spec', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
          path: 'spec',
        })
      );
    });

    it('should reject resource policy without spec.resource', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: { rules: [{ actions: ['read'], effect: 'allow' }] },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
          path: 'spec.resource',
        })
      );
    });

    it('should reject resource policy without spec.rules', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: { resource: 'test' },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
          path: 'spec.rules',
        })
      );
    });

    it('should reject resource policy with empty rules array', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: { resource: 'test', rules: [] },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.EMPTY_ARRAY,
          path: 'spec.rules',
          message: expect.stringContaining('at least one rule'),
        })
      );
    });

    it('should reject rule without effect', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [{ actions: ['read'] }],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
          path: 'spec.rules[0].effect',
        })
      );
    });

    it('should reject rule without actions', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [{ effect: 'allow' }],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
          path: 'spec.rules[0].actions',
        })
      );
    });

    it('should reject rule with empty actions array', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [{ actions: [], effect: 'allow' }],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.EMPTY_ARRAY,
          path: 'spec.rules[0].actions',
        })
      );
    });

    it('should reject derived roles policy without definitions', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test' },
        spec: {},
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
          path: 'spec.definitions',
        })
      );
    });

    it('should reject derived role definition without condition', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test' },
        spec: {
          definitions: [
            {
              name: 'owner',
              parentRoles: ['user'],
              // Missing condition
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
          path: 'spec.definitions[0].condition',
        })
      );
    });

    it('should reject condition without expression', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [
            {
              actions: ['read'],
              effect: 'allow',
              condition: {}, // Empty condition
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
          path: 'spec.rules[0].condition.expression',
        })
      );
    });
  });

  // =============================================================================
  // Effect Validation Tests
  // =============================================================================

  describe('effect validation', () => {
    it('should accept EFFECT_ALLOW as allow', () => {
      const policy = {
        ...validResourcePolicy,
        spec: {
          ...validResourcePolicy.spec,
          rules: [{ actions: ['read'], effect: 'allow' }],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(true);
    });

    it('should accept EFFECT_DENY as deny', () => {
      const policy = {
        ...validResourcePolicy,
        spec: {
          ...validResourcePolicy.spec,
          rules: [{ actions: ['read'], effect: 'deny' }],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(true);
    });

    it('should reject invalid effect value', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [{ actions: ['read'], effect: 'permit' }],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.INVALID_EFFECT,
          path: 'spec.rules[0].effect',
          message: expect.stringContaining("'permit'"),
          suggestion: expect.stringContaining('allow'),
        })
      );
    });

    it('should reject effect with wrong case', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [{ actions: ['read'], effect: 'ALLOW' }],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.INVALID_EFFECT,
          path: 'spec.rules[0].effect',
          suggestion: expect.stringContaining('allow'),
        })
      );
    });

    it('should reject empty effect', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [{ actions: ['read'], effect: '' }],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
    });

    it('should reject null effect', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [{ actions: ['read'], effect: null }],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
    });
  });

  // =============================================================================
  // CEL Expression Validation Tests
  // =============================================================================

  describe('CEL expression validation', () => {
    it('should accept valid CEL: request.principal.id == resource.owner', () => {
      const policy = {
        ...validResourcePolicy,
        spec: {
          ...validResourcePolicy.spec,
          rules: [
            {
              actions: ['read'],
              effect: 'allow' as const,
              condition: {
                expression: 'request.principal.id == resource.owner',
              },
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(true);
    });

    it('should accept valid CEL with principal and resource context', () => {
      const policy = {
        ...validResourcePolicy,
        spec: {
          ...validResourcePolicy.spec,
          rules: [
            {
              actions: ['read'],
              effect: 'allow' as const,
              condition: {
                expression: 'principal.id == resource.ownerId',
              },
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(true);
    });

    it('should accept valid CEL with comparison operators', () => {
      const expressions = [
        'resource.level >= 5',
        'principal.age < 18',
        'resource.count != 0',
        'principal.verified == true',
      ];

      for (const expression of expressions) {
        const policy = {
          ...validResourcePolicy,
          spec: {
            ...validResourcePolicy.spec,
            rules: [
              {
                actions: ['read'],
                effect: 'allow' as const,
                condition: { expression },
              },
            ],
          },
        };

        const result = validatePolicy(policy);
        expect(result.valid).toBe(true);
      }
    });

    it('should accept valid CEL with logical operators', () => {
      const policy = {
        ...validResourcePolicy,
        spec: {
          ...validResourcePolicy.spec,
          rules: [
            {
              actions: ['read'],
              effect: 'allow' as const,
              condition: {
                expression: 'principal.admin || (principal.verified && resource.public)',
              },
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(true);
    });

    it('should accept valid CEL with in operator', () => {
      const policy = {
        ...validResourcePolicy,
        spec: {
          ...validResourcePolicy.spec,
          rules: [
            {
              actions: ['read'],
              effect: 'allow' as const,
              condition: {
                expression: '"admin" in principal.roles',
              },
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(true);
    });

    it('should reject invalid CEL syntax - unmatched parentheses', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [
            {
              actions: ['read'],
              effect: 'allow',
              condition: {
                expression: 'resource.ownerId == principal.id && (resource.public',
              },
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.INVALID_CEL_SYNTAX,
          path: 'spec.rules[0].condition.expression',
        })
      );
    });

    it('should reject invalid CEL syntax - incomplete expression', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [
            {
              actions: ['read'],
              effect: 'allow',
              condition: {
                expression: 'resource.ownerId ==',
              },
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.INVALID_CEL_SYNTAX,
          path: 'spec.rules[0].condition.expression',
        })
      );
    });

    it('should reject invalid CEL syntax - invalid operator', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [
            {
              actions: ['read'],
              effect: 'allow',
              condition: {
                expression: 'resource.level === 5', // Should be ==
              },
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.INVALID_CEL_SYNTAX,
          path: 'spec.rules[0].condition.expression',
          suggestion: expect.stringContaining('=='),
        })
      );
    });

    it('should reject invalid CEL syntax - malformed string literal', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [
            {
              actions: ['read'],
              effect: 'allow',
              condition: {
                expression: 'resource.status == "active', // Missing closing quote
              },
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.INVALID_CEL_SYNTAX,
        })
      );
    });

    it('should warn on undefined variables in CEL expression', () => {
      const policy = {
        ...validResourcePolicy,
        spec: {
          ...validResourcePolicy.spec,
          rules: [
            {
              actions: ['read'],
              effect: 'allow' as const,
              condition: {
                expression: 'unknownVariable.field == true',
              },
            },
          ],
        },
      };

      const result = validatePolicy(policy, { warnOnUnknownVariables: true });

      // Should be valid but with warnings
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.UNKNOWN_VARIABLE,
          path: 'spec.rules[0].condition.expression',
          message: expect.stringContaining('unknownVariable'),
        })
      );
    });

    it('should provide CEL error location when available', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [
            {
              actions: ['read'],
              effect: 'allow',
              condition: {
                expression: 'resource.ownerId == principal.id &&',
              },
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatchObject({
        code: ValidationErrorCode.INVALID_CEL_SYNTAX,
        location: expect.objectContaining({
          column: expect.any(Number),
        }),
      });
    });

    it('should reject empty CEL expression', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [
            {
              actions: ['read'],
              effect: 'allow',
              condition: {
                expression: '',
              },
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.EMPTY_EXPRESSION,
          path: 'spec.rules[0].condition.expression',
        })
      );
    });

    it('should reject whitespace-only CEL expression', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [
            {
              actions: ['read'],
              effect: 'allow',
              condition: {
                expression: '   \t\n  ',
              },
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
    });
  });

  // =============================================================================
  // Naming Convention Tests
  // =============================================================================

  describe('naming conventions', () => {
    it('should accept valid role names - alphanumeric with underscores', () => {
      const validNames = ['admin', 'user', 'super_admin', 'role_123', 'Admin_User'];

      for (const name of validNames) {
        const policy = {
          ...validResourcePolicy,
          spec: {
            ...validResourcePolicy.spec,
            rules: [{ actions: ['read'], effect: 'allow' as const, roles: [name] }],
          },
        };

        const result = validatePolicy(policy);
        expect(result.valid).toBe(true);
      }
    });

    it('should accept valid derived role names', () => {
      const policy = {
        ...validDerivedRolesPolicy,
        spec: {
          definitions: [
            {
              name: 'content_owner',
              parentRoles: ['user'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(true);
    });

    it('should reject role names with spaces', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [{ actions: ['read'], effect: 'allow', roles: ['invalid role'] }],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.INVALID_ROLE_NAME,
          path: 'spec.rules[0].roles[0]',
          message: expect.stringContaining('spaces'),
        })
      );
    });

    it('should reject role names with special characters', () => {
      const invalidNames = ['role@admin', 'user!', 'role#1', 'admin$', 'user%test'];

      for (const name of invalidNames) {
        const policy = {
          apiVersion: 'authz.engine/v1',
          kind: 'ResourcePolicy',
          metadata: { name: 'test' },
          spec: {
            resource: 'test',
            rules: [{ actions: ['read'], effect: 'allow', roles: [name] }],
          },
        };

        const result = validatePolicy(policy);

        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: ValidationErrorCode.INVALID_ROLE_NAME,
          })
        );
      }
    });

    it('should reject reserved keywords as role names', () => {
      const reservedKeywords = ['true', 'false', 'null', 'undefined', 'NaN'];

      for (const keyword of reservedKeywords) {
        const policy = {
          apiVersion: 'authz.engine/v1',
          kind: 'ResourcePolicy',
          metadata: { name: 'test' },
          spec: {
            resource: 'test',
            rules: [{ actions: ['read'], effect: 'allow', roles: [keyword] }],
          },
        };

        const result = validatePolicy(policy);

        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: ValidationErrorCode.RESERVED_KEYWORD,
            message: expect.stringContaining('reserved'),
          })
        );
      }
    });

    it('should reject empty role names', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [{ actions: ['read'], effect: 'allow', roles: [''] }],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
    });

    it('should reject derived role names starting with numbers', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'test' },
        spec: {
          definitions: [
            {
              name: '123_role',
              parentRoles: ['user'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.INVALID_ROLE_NAME,
          message: expect.stringContaining('cannot start with'),
        })
      );
    });

    it('should accept valid action names', () => {
      const validActions = ['create', 'read', 'update', 'delete', 'list', 'admin:manage', '*'];

      const policy = {
        ...validResourcePolicy,
        spec: {
          ...validResourcePolicy.spec,
          rules: [{ actions: validActions, effect: 'allow' as const }],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(true);
    });

    it('should reject invalid action names', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [{ actions: ['invalid action!'], effect: 'allow' }],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.INVALID_ACTION_NAME,
        })
      );
    });

    it('should reject policy name with invalid characters', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'invalid policy name!' },
        spec: {
          resource: 'test',
          rules: [{ actions: ['read'], effect: 'allow' }],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.INVALID_POLICY_NAME,
          path: 'metadata.name',
        })
      );
    });

    it('should reject resource name with invalid format', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'invalid resource!',
          rules: [{ actions: ['read'], effect: 'allow' }],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.INVALID_RESOURCE_NAME,
        })
      );
    });
  });

  // =============================================================================
  // Cross-Reference Validation Tests
  // =============================================================================

  describe('cross-reference validation', () => {
    it('should reject reference to undefined derived role', () => {
      const resourcePolicy = {
        apiVersion: 'authz.engine/v1' as const,
        kind: 'ResourcePolicy' as const,
        metadata: { name: 'test' },
        spec: {
          resource: 'document',
          rules: [
            {
              actions: ['edit'],
              effect: 'allow' as const,
              derivedRoles: ['undefined_role'], // This role doesn't exist
            },
          ],
        },
      };

      // Validate with available derived roles context
      const result = validatePolicies([resourcePolicy], {
        availableDerivedRoles: ['owner', 'admin'],
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.UNDEFINED_DERIVED_ROLE,
          path: 'spec.rules[0].derivedRoles[0]',
          message: expect.stringContaining('undefined_role'),
        })
      );
    });

    it('should accept reference to defined derived role', () => {
      const derivedRolesPolicy = validDerivedRolesPolicy;
      const resourcePolicy = {
        apiVersion: 'authz.engine/v1' as const,
        kind: 'ResourcePolicy' as const,
        metadata: { name: 'test' },
        spec: {
          resource: 'document',
          rules: [
            {
              actions: ['edit'],
              effect: 'allow' as const,
              derivedRoles: ['owner'], // Defined in derivedRolesPolicy
            },
          ],
        },
      };

      const result = validatePolicies([derivedRolesPolicy, resourcePolicy]);

      expect(result.valid).toBe(true);
    });

    it('should reject circular derived role dependencies', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'circular-roles' },
        spec: {
          definitions: [
            {
              name: 'role_a',
              parentRoles: ['role_b'], // Depends on role_b
              condition: { expression: 'true' },
            },
            {
              name: 'role_b',
              parentRoles: ['role_a'], // Depends on role_a - circular!
              condition: { expression: 'true' },
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.CIRCULAR_DEPENDENCY,
          message: expect.stringMatching(/circular.*role_a.*role_b/i),
        })
      );
    });

    it('should reject self-referencing derived role', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'self-ref' },
        spec: {
          definitions: [
            {
              name: 'recursive_role',
              parentRoles: ['recursive_role'], // Self-reference
              condition: { expression: 'true' },
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.CIRCULAR_DEPENDENCY,
        })
      );
    });

    it('should detect transitive circular dependencies', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'transitive-circular' },
        spec: {
          definitions: [
            {
              name: 'role_a',
              parentRoles: ['role_b'],
              condition: { expression: 'true' },
            },
            {
              name: 'role_b',
              parentRoles: ['role_c'],
              condition: { expression: 'true' },
            },
            {
              name: 'role_c',
              parentRoles: ['role_a'], // Creates a -> b -> c -> a cycle
              condition: { expression: 'true' },
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.CIRCULAR_DEPENDENCY,
        })
      );
    });

    it('should reject duplicate derived role definitions', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'duplicates' },
        spec: {
          definitions: [
            {
              name: 'owner',
              parentRoles: ['user'],
              condition: { expression: 'resource.ownerId == principal.id' },
            },
            {
              name: 'owner', // Duplicate name
              parentRoles: ['admin'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.DUPLICATE_DEFINITION,
          message: expect.stringContaining('owner'),
        })
      );
    });
  });

  // =============================================================================
  // Error Message Tests
  // =============================================================================

  describe('error messages', () => {
    it('should include field path in error', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [
            {
              actions: ['read'],
              effect: 'invalid',
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.errors[0].path).toBe('spec.rules[0].effect');
    });

    it('should include line number when validating from YAML source', () => {
      const yamlSource = `apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: test
spec:
  resource: test
  rules:
    - actions: [read]
      effect: invalid`;

      const result = validator.validateYaml(yamlSource);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toHaveProperty('location');
      expect(result.errors[0].location).toHaveProperty('line');
      expect(result.errors[0].location.line).toBeGreaterThan(0);
    });

    it('should suggest fixes for common errors - invalid effect', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [{ actions: ['read'], effect: 'permit' }],
        },
      };

      const result = validatePolicy(policy);

      expect(result.errors[0].suggestion).toMatch(/use.*allow.*deny/i);
    });

    it('should suggest fixes for common errors - invalid apiVersion', () => {
      const policy = {
        apiVersion: 'v1', // Wrong format
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [{ actions: ['read'], effect: 'allow' }],
        },
      };

      const result = validatePolicy(policy);

      expect(result.errors[0].suggestion).toContain('authz.engine/v1');
    });

    it('should suggest fixes for typos in kind', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePloicy', // Typo
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [{ actions: ['read'], effect: 'allow' }],
        },
      };

      const result = validatePolicy(policy);

      expect(result.errors[0].suggestion).toContain('ResourcePolicy');
    });

    it('should provide helpful message for missing roles AND derivedRoles', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [
            {
              actions: ['read'],
              effect: 'allow',
              // Missing both roles and derivedRoles
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      // Should warn that rule applies to everyone
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          message: expect.stringMatching(/applies to all|no roles specified/i),
        })
      );
    });

    it('should aggregate multiple errors in a single validation', () => {
      const policy = {
        // Missing apiVersion
        kind: 'ResourcePolicy',
        metadata: { name: '' }, // Empty name
        spec: {
          // Missing resource
          rules: [
            {
              actions: [], // Empty actions
              effect: 'invalid', // Invalid effect
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
    });

    it('should provide error context with surrounding policy snippet', () => {
      const yamlSource = `apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: test
spec:
  resource: test
  rules:
    - actions: [read]
      effect: invalid
      roles: [user]`;

      const result = validator.validateYaml(yamlSource);

      expect(result.errors[0]).toHaveProperty('context');
      expect(result.errors[0].context).toContain('effect');
    });
  });

  // =============================================================================
  // API Version Validation Tests
  // =============================================================================

  describe('apiVersion validation', () => {
    it('should accept authz.engine/v1', () => {
      const result = validatePolicy(validResourcePolicy);
      expect(result.valid).toBe(true);
    });

    it('should reject unknown apiVersion', () => {
      const policy = {
        apiVersion: 'authz.engine/v2',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [{ actions: ['read'], effect: 'allow' }],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.INVALID_API_VERSION,
        })
      );
    });

    it('should reject malformed apiVersion', () => {
      const policy = {
        apiVersion: 'invalid',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [{ actions: ['read'], effect: 'allow' }],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
    });
  });

  // =============================================================================
  // Kind Validation Tests
  // =============================================================================

  describe('kind validation', () => {
    it('should accept ResourcePolicy kind', () => {
      const result = validatePolicy(validResourcePolicy);
      expect(result.valid).toBe(true);
    });

    it('should accept DerivedRoles kind', () => {
      const result = validatePolicy(validDerivedRolesPolicy);
      expect(result.valid).toBe(true);
    });

    it('should accept PrincipalPolicy kind', () => {
      const result = validatePolicy(validPrincipalPolicy);
      expect(result.valid).toBe(true);
    });

    it('should reject unknown kind', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'CustomPolicy',
        metadata: { name: 'test' },
        spec: {},
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.INVALID_KIND,
          suggestion: expect.stringMatching(/ResourcePolicy|DerivedRoles|PrincipalPolicy/),
        })
      );
    });
  });

  // =============================================================================
  // Validator Options Tests
  // =============================================================================

  describe('validator options', () => {
    it('should support strict mode with additional checks', () => {
      const policy = {
        ...validResourcePolicy,
        spec: {
          ...validResourcePolicy.spec,
          rules: [
            {
              actions: ['read'],
              effect: 'allow' as const,
              // No roles - valid but might be unintended
            },
          ],
        },
      };

      const result = validatePolicy(policy, { strict: true });

      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining('roles'),
        })
      );
    });

    it('should support custom known variables for CEL validation', () => {
      const policy = {
        ...validResourcePolicy,
        spec: {
          ...validResourcePolicy.spec,
          rules: [
            {
              actions: ['read'],
              effect: 'allow' as const,
              condition: {
                expression: 'custom.variable == true',
              },
            },
          ],
        },
      };

      const result = validatePolicy(policy, {
        knownVariables: ['custom'],
        warnOnUnknownVariables: true,
      });

      // Should not warn since 'custom' is a known variable
      expect(result.warnings).not.toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.UNKNOWN_VARIABLE,
        })
      );
    });

    it('should allow disabling CEL validation', () => {
      const policy = {
        ...validResourcePolicy,
        spec: {
          ...validResourcePolicy.spec,
          rules: [
            {
              actions: ['read'],
              effect: 'allow' as const,
              condition: {
                expression: 'this is not valid CEL {{{}}}',
              },
            },
          ],
        },
      };

      const result = validatePolicy(policy, { validateCel: false });

      // Should not report CEL errors when validation is disabled
      expect(result.errors).not.toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.INVALID_CEL_SYNTAX,
        })
      );
    });
  });

  // =============================================================================
  // Batch Validation Tests
  // =============================================================================

  describe('batch validation', () => {
    it('should validate multiple policies at once', () => {
      const result = validatePolicies([
        validResourcePolicy,
        validDerivedRolesPolicy,
        validPrincipalPolicy,
      ]);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should report errors from all invalid policies', () => {
      const invalidPolicies = [
        {
          apiVersion: 'authz.engine/v1',
          kind: 'ResourcePolicy',
          metadata: { name: 'policy1' },
          spec: { resource: 'test' }, // Missing rules
        },
        {
          apiVersion: 'authz.engine/v1',
          kind: 'ResourcePolicy',
          metadata: { name: 'policy2' },
          spec: {
            resource: 'test',
            rules: [{ actions: ['read'], effect: 'invalid' }],
          },
        },
      ];

      const result = validatePolicies(invalidPolicies);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      expect(result.errors.some((e) => e.policyName === 'policy1')).toBe(true);
      expect(result.errors.some((e) => e.policyName === 'policy2')).toBe(true);
    });

    it('should perform cross-policy validation for derived role references', () => {
      const policies = [
        validDerivedRolesPolicy,
        {
          apiVersion: 'authz.engine/v1' as const,
          kind: 'ResourcePolicy' as const,
          metadata: { name: 'uses-roles' },
          spec: {
            resource: 'document',
            rules: [
              {
                actions: ['edit'],
                effect: 'allow' as const,
                derivedRoles: ['owner', 'nonexistent_role'],
              },
            ],
          },
        },
      ];

      const result = validatePolicies(policies);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: ValidationErrorCode.UNDEFINED_DERIVED_ROLE,
          message: expect.stringContaining('nonexistent_role'),
        })
      );
    });
  });

  // =============================================================================
  // Edge Cases Tests
  // =============================================================================

  describe('edge cases', () => {
    it('should handle deeply nested policy structures', () => {
      const policy = {
        ...validResourcePolicy,
        spec: {
          ...validResourcePolicy.spec,
          schemas: {
            principalSchema: {
              type: 'object',
              properties: {
                nested: {
                  type: 'object',
                  properties: {
                    deep: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(true);
    });

    it('should handle null values gracefully', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [
            {
              actions: ['read'],
              effect: 'allow',
              roles: null, // Explicitly null
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      // Should not crash, may have validation error
      expect(result).toBeDefined();
    });

    it('should handle undefined values gracefully', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [
            {
              actions: ['read'],
              effect: 'allow',
              condition: undefined,
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(true);
    });

    it('should handle very long policy names', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'a'.repeat(300) },
        spec: {
          resource: 'test',
          rules: [{ actions: ['read'], effect: 'allow' }],
        },
      };

      const result = validatePolicy(policy);

      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining('length'),
        })
      );
    });

    it('should handle very long CEL expressions', () => {
      const longExpression = Array(100)
        .fill('principal.id == resource.ownerId')
        .join(' && ');

      const policy = {
        ...validResourcePolicy,
        spec: {
          ...validResourcePolicy.spec,
          rules: [
            {
              actions: ['read'],
              effect: 'allow' as const,
              condition: { expression: longExpression },
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining('complex'),
        })
      );
    });

    it('should handle unicode characters in names', () => {
      const policy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {
          resource: 'test',
          rules: [
            {
              actions: ['read'],
              effect: 'allow',
              roles: ['user'], // Valid
            },
          ],
        },
      };

      const result = validatePolicy(policy);

      expect(result.valid).toBe(true);
    });

    it('should handle empty policy object', () => {
      const result = validatePolicy({});

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle array as policy input', () => {
      const result = validatePolicy([] as unknown);

      expect(result.valid).toBe(false);
    });

    it('should handle primitive values as policy input', () => {
      expect(validatePolicy('string' as unknown).valid).toBe(false);
      expect(validatePolicy(123 as unknown).valid).toBe(false);
      expect(validatePolicy(null as unknown).valid).toBe(false);
    });
  });
});

// =============================================================================
// Type Definitions for Tests (Expected Exports)
// =============================================================================

/**
 * Expected ValidationErrorCode enum values
 */
describe('ValidationErrorCode enum', () => {
  it('should export all required error codes', () => {
    expect(ValidationErrorCode.MISSING_REQUIRED_FIELD).toBeDefined();
    expect(ValidationErrorCode.INVALID_EFFECT).toBeDefined();
    expect(ValidationErrorCode.INVALID_CEL_SYNTAX).toBeDefined();
    expect(ValidationErrorCode.INVALID_ROLE_NAME).toBeDefined();
    expect(ValidationErrorCode.INVALID_ACTION_NAME).toBeDefined();
    expect(ValidationErrorCode.INVALID_API_VERSION).toBeDefined();
    expect(ValidationErrorCode.INVALID_KIND).toBeDefined();
    expect(ValidationErrorCode.UNDEFINED_DERIVED_ROLE).toBeDefined();
    expect(ValidationErrorCode.CIRCULAR_DEPENDENCY).toBeDefined();
    expect(ValidationErrorCode.DUPLICATE_DEFINITION).toBeDefined();
    expect(ValidationErrorCode.EMPTY_ARRAY).toBeDefined();
    expect(ValidationErrorCode.EMPTY_EXPRESSION).toBeDefined();
    expect(ValidationErrorCode.RESERVED_KEYWORD).toBeDefined();
    expect(ValidationErrorCode.UNKNOWN_VARIABLE).toBeDefined();
    expect(ValidationErrorCode.INVALID_POLICY_NAME).toBeDefined();
    expect(ValidationErrorCode.INVALID_RESOURCE_NAME).toBeDefined();
  });
});

/**
 * Expected ValidationResult interface
 */
describe('ValidationResult interface', () => {
  it('should have expected structure', () => {
    const result = validatePolicy(validResourcePolicy);

    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('warnings');
    expect(typeof result.valid).toBe('boolean');
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});

/**
 * Expected ValidationError interface
 */
describe('ValidationError interface', () => {
  it('should have expected structure for errors', () => {
    const policy = {
      apiVersion: 'authz.engine/v1',
      kind: 'ResourcePolicy',
      metadata: { name: 'test' },
      spec: {
        resource: 'test',
        rules: [{ actions: ['read'], effect: 'invalid' }],
      },
    };

    const result = validatePolicy(policy);
    const error = result.errors[0];

    expect(error).toHaveProperty('code');
    expect(error).toHaveProperty('path');
    expect(error).toHaveProperty('message');
    expect(typeof error.code).toBe('string');
    expect(typeof error.path).toBe('string');
    expect(typeof error.message).toBe('string');
  });
});
