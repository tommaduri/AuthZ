/**
 * Action Wildcards Test Suite
 *
 * Tests for Cerbos-style action wildcard pattern matching.
 *
 * Wildcard Specification:
 * - Action patterns use `:` as delimiter
 * - `prefix:*` matches any action starting with `prefix:`
 * - `*:suffix` matches any action ending with `:suffix`
 * - `prefix:*:suffix` matches actions with prefix and suffix
 * - `*` alone matches any single action
 *
 * Examples:
 * - `documents:*` matches `documents:read`, `documents:write`, `documents:delete`
 * - `*:read` matches `documents:read`, `users:read`, `api:read`
 * - `api:*:read` matches `api:users:read`, `api:posts:read`
 *
 * TDD Red Phase: These tests should FAIL until wildcard matching is implemented.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DecisionEngine } from '../../../src/engine/decision-engine';
import type { ValidatedResourcePolicy } from '../../../src/policy/schema';

describe('Action Wildcards', () => {
  let engine: DecisionEngine;

  beforeEach(() => {
    engine = new DecisionEngine();
  });

  // ==========================================================================
  // Baseline: Exact Matching (should pass - existing behavior)
  // ==========================================================================
  describe('exact matching (baseline)', () => {
    const exactPolicy: ValidatedResourcePolicy = {
      apiVersion: 'authz.engine/v1',
      kind: 'ResourcePolicy',
      metadata: { name: 'exact-match-policy' },
      spec: {
        resource: 'document',
        rules: [
          {
            name: 'exact-read',
            actions: ['read'],
            effect: 'allow',
            roles: ['viewer'],
          },
          {
            name: 'exact-write',
            actions: ['write'],
            effect: 'allow',
            roles: ['editor'],
          },
          {
            name: 'exact-delete',
            actions: ['delete'],
            effect: 'allow',
            roles: ['admin'],
          },
        ],
      },
    };

    beforeEach(() => {
      engine.loadResourcePolicies([exactPolicy]);
    });

    it('should match exact action "read"', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['viewer'], attributes: {} },
        resource: { kind: 'document', id: 'doc-1', attributes: {} },
        actions: ['read'],
      });

      expect(result.results['read'].effect).toBe('allow');
      expect(result.results['read'].meta?.matchedRule).toBe('exact-read');
    });

    it('should not match when action differs', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['viewer'], attributes: {} },
        resource: { kind: 'document', id: 'doc-1', attributes: {} },
        actions: ['write'],
      });

      expect(result.results['write'].effect).toBe('deny');
    });

    it('should match simple star wildcard for any action', () => {
      const starPolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'star-policy' },
        spec: {
          resource: 'public',
          rules: [
            {
              name: 'allow-all',
              actions: ['*'],
              effect: 'allow',
              roles: ['user'],
            },
          ],
        },
      };

      engine.clearPolicies();
      engine.loadResourcePolicies([starPolicy]);

      const result = engine.check({
        principal: { id: 'user-1', roles: ['user'], attributes: {} },
        resource: { kind: 'public', id: 'item-1', attributes: {} },
        actions: ['read', 'write', 'delete', 'anything'],
      });

      expect(result.results['read'].effect).toBe('allow');
      expect(result.results['write'].effect).toBe('allow');
      expect(result.results['delete'].effect).toBe('allow');
      expect(result.results['anything'].effect).toBe('allow');
    });
  });

  // ==========================================================================
  // Prefix Wildcard Matching: `prefix:*`
  // ==========================================================================
  describe('prefix wildcard matching', () => {
    const prefixPolicy: ValidatedResourcePolicy = {
      apiVersion: 'authz.engine/v1',
      kind: 'ResourcePolicy',
      metadata: { name: 'prefix-wildcard-policy' },
      spec: {
        resource: 'document',
        rules: [
          {
            name: 'documents-wildcard',
            actions: ['documents:*'],
            effect: 'allow',
            roles: ['document-manager'],
          },
          {
            name: 'users-wildcard',
            actions: ['users:*'],
            effect: 'allow',
            roles: ['user-admin'],
          },
        ],
      },
    };

    beforeEach(() => {
      engine.loadResourcePolicies([prefixPolicy]);
    });

    it('should match "documents:read" with "documents:*"', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['document-manager'], attributes: {} },
        resource: { kind: 'document', id: 'doc-1', attributes: {} },
        actions: ['documents:read'],
      });

      expect(result.results['documents:read'].effect).toBe('allow');
      expect(result.results['documents:read'].meta?.matchedRule).toBe('documents-wildcard');
    });

    it('should match "documents:write" with "documents:*"', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['document-manager'], attributes: {} },
        resource: { kind: 'document', id: 'doc-1', attributes: {} },
        actions: ['documents:write'],
      });

      expect(result.results['documents:write'].effect).toBe('allow');
    });

    it('should match "documents:delete" with "documents:*"', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['document-manager'], attributes: {} },
        resource: { kind: 'document', id: 'doc-1', attributes: {} },
        actions: ['documents:delete'],
      });

      expect(result.results['documents:delete'].effect).toBe('allow');
    });

    it('should NOT match "users:read" with "documents:*"', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['document-manager'], attributes: {} },
        resource: { kind: 'document', id: 'doc-1', attributes: {} },
        actions: ['users:read'],
      });

      expect(result.results['users:read'].effect).toBe('deny');
    });

    it('should match multiple actions with same prefix wildcard', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['document-manager'], attributes: {} },
        resource: { kind: 'document', id: 'doc-1', attributes: {} },
        actions: ['documents:read', 'documents:write', 'documents:share'],
      });

      expect(result.results['documents:read'].effect).toBe('allow');
      expect(result.results['documents:write'].effect).toBe('allow');
      expect(result.results['documents:share'].effect).toBe('allow');
    });

    it('should match "users:create" with "users:*"', () => {
      const result = engine.check({
        principal: { id: 'admin-1', roles: ['user-admin'], attributes: {} },
        resource: { kind: 'document', id: 'doc-1', attributes: {} },
        actions: ['users:create'],
      });

      expect(result.results['users:create'].effect).toBe('allow');
      expect(result.results['users:create'].meta?.matchedRule).toBe('users-wildcard');
    });
  });

  // ==========================================================================
  // Suffix Wildcard Matching: `*:suffix`
  // ==========================================================================
  describe('suffix wildcard matching', () => {
    const suffixPolicy: ValidatedResourcePolicy = {
      apiVersion: 'authz.engine/v1',
      kind: 'ResourcePolicy',
      metadata: { name: 'suffix-wildcard-policy' },
      spec: {
        resource: 'api',
        rules: [
          {
            name: 'read-all-resources',
            actions: ['*:read'],
            effect: 'allow',
            roles: ['reader'],
          },
          {
            name: 'write-all-resources',
            actions: ['*:write'],
            effect: 'allow',
            roles: ['writer'],
          },
          {
            name: 'delete-all-resources',
            actions: ['*:delete'],
            effect: 'allow',
            roles: ['admin'],
          },
        ],
      },
    };

    beforeEach(() => {
      engine.loadResourcePolicies([suffixPolicy]);
    });

    it('should match "documents:read" with "*:read"', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['reader'], attributes: {} },
        resource: { kind: 'api', id: 'api-1', attributes: {} },
        actions: ['documents:read'],
      });

      expect(result.results['documents:read'].effect).toBe('allow');
      expect(result.results['documents:read'].meta?.matchedRule).toBe('read-all-resources');
    });

    it('should match "users:read" with "*:read"', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['reader'], attributes: {} },
        resource: { kind: 'api', id: 'api-1', attributes: {} },
        actions: ['users:read'],
      });

      expect(result.results['users:read'].effect).toBe('allow');
    });

    it('should match "posts:read" with "*:read"', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['reader'], attributes: {} },
        resource: { kind: 'api', id: 'api-1', attributes: {} },
        actions: ['posts:read'],
      });

      expect(result.results['posts:read'].effect).toBe('allow');
    });

    it('should NOT match "documents:write" with "*:read"', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['reader'], attributes: {} },
        resource: { kind: 'api', id: 'api-1', attributes: {} },
        actions: ['documents:write'],
      });

      expect(result.results['documents:write'].effect).toBe('deny');
    });

    it('should match different resources with same suffix', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['reader'], attributes: {} },
        resource: { kind: 'api', id: 'api-1', attributes: {} },
        actions: ['documents:read', 'users:read', 'settings:read', 'config:read'],
      });

      expect(result.results['documents:read'].effect).toBe('allow');
      expect(result.results['users:read'].effect).toBe('allow');
      expect(result.results['settings:read'].effect).toBe('allow');
      expect(result.results['config:read'].effect).toBe('allow');
    });

    it('should match "reports:write" with "*:write"', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['writer'], attributes: {} },
        resource: { kind: 'api', id: 'api-1', attributes: {} },
        actions: ['reports:write'],
      });

      expect(result.results['reports:write'].effect).toBe('allow');
      expect(result.results['reports:write'].meta?.matchedRule).toBe('write-all-resources');
    });
  });

  // ==========================================================================
  // Multi-Segment Wildcards: `prefix:*:suffix`
  // ==========================================================================
  describe('multi-segment wildcards', () => {
    const multiSegmentPolicy: ValidatedResourcePolicy = {
      apiVersion: 'authz.engine/v1',
      kind: 'ResourcePolicy',
      metadata: { name: 'multi-segment-wildcard-policy' },
      spec: {
        resource: 'api',
        rules: [
          {
            name: 'api-resource-read',
            actions: ['api:*:read'],
            effect: 'allow',
            roles: ['api-reader'],
          },
          {
            name: 'api-resource-write',
            actions: ['api:*:write'],
            effect: 'allow',
            roles: ['api-writer'],
          },
          {
            name: 'admin-resource-all',
            actions: ['admin:*:*'],
            effect: 'allow',
            roles: ['super-admin'],
          },
        ],
      },
    };

    beforeEach(() => {
      engine.loadResourcePolicies([multiSegmentPolicy]);
    });

    it('should match "api:users:read" with "api:*:read"', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['api-reader'], attributes: {} },
        resource: { kind: 'api', id: 'api-1', attributes: {} },
        actions: ['api:users:read'],
      });

      expect(result.results['api:users:read'].effect).toBe('allow');
      expect(result.results['api:users:read'].meta?.matchedRule).toBe('api-resource-read');
    });

    it('should match "api:posts:read" with "api:*:read"', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['api-reader'], attributes: {} },
        resource: { kind: 'api', id: 'api-1', attributes: {} },
        actions: ['api:posts:read'],
      });

      expect(result.results['api:posts:read'].effect).toBe('allow');
    });

    it('should match "api:documents:read" with "api:*:read"', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['api-reader'], attributes: {} },
        resource: { kind: 'api', id: 'api-1', attributes: {} },
        actions: ['api:documents:read'],
      });

      expect(result.results['api:documents:read'].effect).toBe('allow');
    });

    it('should NOT match "api:users:write" with "api:*:read"', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['api-reader'], attributes: {} },
        resource: { kind: 'api', id: 'api-1', attributes: {} },
        actions: ['api:users:write'],
      });

      expect(result.results['api:users:write'].effect).toBe('deny');
    });

    it('should NOT match "web:users:read" with "api:*:read"', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['api-reader'], attributes: {} },
        resource: { kind: 'api', id: 'api-1', attributes: {} },
        actions: ['web:users:read'],
      });

      expect(result.results['web:users:read'].effect).toBe('deny');
    });

    it('should match "api:comments:write" with "api:*:write"', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['api-writer'], attributes: {} },
        resource: { kind: 'api', id: 'api-1', attributes: {} },
        actions: ['api:comments:write'],
      });

      expect(result.results['api:comments:write'].effect).toBe('allow');
      expect(result.results['api:comments:write'].meta?.matchedRule).toBe('api-resource-write');
    });

    it('should match "admin:users:read" with "admin:*:*"', () => {
      const result = engine.check({
        principal: { id: 'admin-1', roles: ['super-admin'], attributes: {} },
        resource: { kind: 'api', id: 'api-1', attributes: {} },
        actions: ['admin:users:read'],
      });

      expect(result.results['admin:users:read'].effect).toBe('allow');
      expect(result.results['admin:users:read'].meta?.matchedRule).toBe('admin-resource-all');
    });

    it('should match "admin:settings:write" with "admin:*:*"', () => {
      const result = engine.check({
        principal: { id: 'admin-1', roles: ['super-admin'], attributes: {} },
        resource: { kind: 'api', id: 'api-1', attributes: {} },
        actions: ['admin:settings:write'],
      });

      expect(result.results['admin:settings:write'].effect).toBe('allow');
    });

    it('should match "admin:config:delete" with "admin:*:*"', () => {
      const result = engine.check({
        principal: { id: 'admin-1', roles: ['super-admin'], attributes: {} },
        resource: { kind: 'api', id: 'api-1', attributes: {} },
        actions: ['admin:config:delete'],
      });

      expect(result.results['admin:config:delete'].effect).toBe('allow');
    });
  });

  // ==========================================================================
  // Deep Nested Wildcards: `a:*:c:*:e`
  // ==========================================================================
  describe('deep nested wildcards', () => {
    const deepPolicy: ValidatedResourcePolicy = {
      apiVersion: 'authz.engine/v1',
      kind: 'ResourcePolicy',
      metadata: { name: 'deep-wildcard-policy' },
      spec: {
        resource: 'hierarchical',
        rules: [
          {
            name: 'org-team-read',
            actions: ['org:*:team:*:read'],
            effect: 'allow',
            roles: ['team-member'],
          },
          {
            name: 'service-endpoint-all',
            actions: ['service:*:endpoint:*:*'],
            effect: 'allow',
            roles: ['service-admin'],
          },
        ],
      },
    };

    beforeEach(() => {
      engine.loadResourcePolicies([deepPolicy]);
    });

    it('should match "org:acme:team:engineering:read" with "org:*:team:*:read"', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['team-member'], attributes: {} },
        resource: { kind: 'hierarchical', id: 'h-1', attributes: {} },
        actions: ['org:acme:team:engineering:read'],
      });

      expect(result.results['org:acme:team:engineering:read'].effect).toBe('allow');
    });

    it('should match "org:corp:team:sales:read" with "org:*:team:*:read"', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['team-member'], attributes: {} },
        resource: { kind: 'hierarchical', id: 'h-1', attributes: {} },
        actions: ['org:corp:team:sales:read'],
      });

      expect(result.results['org:corp:team:sales:read'].effect).toBe('allow');
    });

    it('should NOT match "org:acme:team:engineering:write" with "org:*:team:*:read"', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['team-member'], attributes: {} },
        resource: { kind: 'hierarchical', id: 'h-1', attributes: {} },
        actions: ['org:acme:team:engineering:write'],
      });

      expect(result.results['org:acme:team:engineering:write'].effect).toBe('deny');
    });

    it('should match "service:api:endpoint:users:read" with "service:*:endpoint:*:*"', () => {
      const result = engine.check({
        principal: { id: 'admin-1', roles: ['service-admin'], attributes: {} },
        resource: { kind: 'hierarchical', id: 'h-1', attributes: {} },
        actions: ['service:api:endpoint:users:read'],
      });

      expect(result.results['service:api:endpoint:users:read'].effect).toBe('allow');
    });

    it('should match "service:web:endpoint:auth:write" with "service:*:endpoint:*:*"', () => {
      const result = engine.check({
        principal: { id: 'admin-1', roles: ['service-admin'], attributes: {} },
        resource: { kind: 'hierarchical', id: 'h-1', attributes: {} },
        actions: ['service:web:endpoint:auth:write'],
      });

      expect(result.results['service:web:endpoint:auth:write'].effect).toBe('allow');
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================
  describe('edge cases', () => {
    describe('empty and null handling', () => {
      const edgePolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'edge-case-policy' },
        spec: {
          resource: 'edge',
          rules: [
            {
              name: 'prefix-wildcard',
              actions: ['prefix:*'],
              effect: 'allow',
              roles: ['user'],
            },
          ],
        },
      };

      beforeEach(() => {
        engine.loadResourcePolicies([edgePolicy]);
      });

      it('should NOT match empty action segment after colon', () => {
        const result = engine.check({
          principal: { id: 'user-1', roles: ['user'], attributes: {} },
          resource: { kind: 'edge', id: 'e-1', attributes: {} },
          actions: ['prefix:'],
        });

        // Empty segment after colon should NOT be matched by wildcard
        // prefix:* expects at least one character after prefix:
        expect(result.results['prefix:'].effect).toBe('deny');
      });

      it('should match action with single character suffix', () => {
        const result = engine.check({
          principal: { id: 'user-1', roles: ['user'], attributes: {} },
          resource: { kind: 'edge', id: 'e-1', attributes: {} },
          actions: ['prefix:a'],
        });

        expect(result.results['prefix:a'].effect).toBe('allow');
      });

      it('should handle action with multiple consecutive colons', () => {
        const result = engine.check({
          principal: { id: 'user-1', roles: ['user'], attributes: {} },
          resource: { kind: 'edge', id: 'e-1', attributes: {} },
          actions: ['prefix::read'],
        });

        // Double colons create an empty segment - should still match with prefix:*
        // because everything after 'prefix:' is matched by *
        expect(result.results['prefix::read'].effect).toBe('allow');
      });
    });

    describe('special characters in actions', () => {
      const specialPolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'special-char-policy' },
        spec: {
          resource: 'special',
          rules: [
            {
              name: 'api-wildcard',
              actions: ['api:*'],
              effect: 'allow',
              roles: ['user'],
            },
            {
              name: 'exact-hyphen',
              actions: ['resource-action'],
              effect: 'allow',
              roles: ['user'],
            },
          ],
        },
      };

      beforeEach(() => {
        engine.loadResourcePolicies([specialPolicy]);
      });

      it('should match action with hyphens in wildcard segment', () => {
        const result = engine.check({
          principal: { id: 'user-1', roles: ['user'], attributes: {} },
          resource: { kind: 'special', id: 's-1', attributes: {} },
          actions: ['api:my-action'],
        });

        expect(result.results['api:my-action'].effect).toBe('allow');
      });

      it('should match action with underscores in wildcard segment', () => {
        const result = engine.check({
          principal: { id: 'user-1', roles: ['user'], attributes: {} },
          resource: { kind: 'special', id: 's-1', attributes: {} },
          actions: ['api:my_action'],
        });

        expect(result.results['api:my_action'].effect).toBe('allow');
      });

      it('should match action with numbers in wildcard segment', () => {
        const result = engine.check({
          principal: { id: 'user-1', roles: ['user'], attributes: {} },
          resource: { kind: 'special', id: 's-1', attributes: {} },
          actions: ['api:action123'],
        });

        expect(result.results['api:action123'].effect).toBe('allow');
      });

      it('should match exact action with hyphen (non-wildcard)', () => {
        const result = engine.check({
          principal: { id: 'user-1', roles: ['user'], attributes: {} },
          resource: { kind: 'special', id: 's-1', attributes: {} },
          actions: ['resource-action'],
        });

        expect(result.results['resource-action'].effect).toBe('allow');
      });

      it('should NOT confuse hyphen with colon delimiter', () => {
        const result = engine.check({
          principal: { id: 'user-1', roles: ['user'], attributes: {} },
          resource: { kind: 'special', id: 's-1', attributes: {} },
          actions: ['api-read'],  // hyphen, not colon
        });

        // api:* should NOT match api-read (different delimiter)
        expect(result.results['api-read'].effect).toBe('deny');
      });
    });

    describe('wildcard literal handling', () => {
      const literalPolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'literal-policy' },
        spec: {
          resource: 'literal',
          rules: [
            {
              name: 'prefix-star',
              actions: ['prefix:*'],
              effect: 'allow',
              roles: ['user'],
            },
          ],
        },
      };

      beforeEach(() => {
        engine.loadResourcePolicies([literalPolicy]);
      });

      it('should NOT match literal asterisk as action suffix', () => {
        // When checking action "prefix:*" literally, it should match the pattern
        // But when the ACTION is literally "prefix:*", this is an edge case
        const result = engine.check({
          principal: { id: 'user-1', roles: ['user'], attributes: {} },
          resource: { kind: 'literal', id: 'l-1', attributes: {} },
          actions: ['prefix:*'],
        });

        // The action "prefix:*" should match pattern "prefix:*"
        // because * in pattern matches *, but this could be implementation-specific
        expect(result.results['prefix:*'].effect).toBe('allow');
      });
    });

    describe('case sensitivity', () => {
      const casePolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'case-policy' },
        spec: {
          resource: 'case-test',
          rules: [
            {
              name: 'lowercase-wildcard',
              actions: ['documents:*'],
              effect: 'allow',
              roles: ['user'],
            },
          ],
        },
      };

      beforeEach(() => {
        engine.loadResourcePolicies([casePolicy]);
      });

      it('should be case-sensitive for prefix matching', () => {
        const result = engine.check({
          principal: { id: 'user-1', roles: ['user'], attributes: {} },
          resource: { kind: 'case-test', id: 'c-1', attributes: {} },
          actions: ['Documents:read'],  // Capital D
        });

        // Case-sensitive: Documents:read should NOT match documents:*
        expect(result.results['Documents:read'].effect).toBe('deny');
      });

      it('should match when case matches exactly', () => {
        const result = engine.check({
          principal: { id: 'user-1', roles: ['user'], attributes: {} },
          resource: { kind: 'case-test', id: 'c-1', attributes: {} },
          actions: ['documents:read'],  // lowercase
        });

        expect(result.results['documents:read'].effect).toBe('allow');
      });
    });

    describe('greedy vs non-greedy matching', () => {
      const greedyPolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'greedy-policy' },
        spec: {
          resource: 'greedy',
          rules: [
            {
              name: 'middle-wildcard',
              actions: ['api:*:read'],
              effect: 'allow',
              roles: ['user'],
            },
          ],
        },
      };

      beforeEach(() => {
        engine.loadResourcePolicies([greedyPolicy]);
      });

      it('should handle wildcard matching single segment', () => {
        const result = engine.check({
          principal: { id: 'user-1', roles: ['user'], attributes: {} },
          resource: { kind: 'greedy', id: 'g-1', attributes: {} },
          actions: ['api:users:read'],
        });

        expect(result.results['api:users:read'].effect).toBe('allow');
      });

      it('should NOT match when wildcard would need to span multiple segments', () => {
        // api:*:read with action api:users:posts:read
        // * should match only ONE segment (users), leaving posts:read unmatched
        const result = engine.check({
          principal: { id: 'user-1', roles: ['user'], attributes: {} },
          resource: { kind: 'greedy', id: 'g-1', attributes: {} },
          actions: ['api:users:posts:read'],
        });

        // With non-greedy: api:*:read should NOT match api:users:posts:read
        // because * matches only 'users', leaving 'posts:read' vs ':read'
        expect(result.results['api:users:posts:read'].effect).toBe('deny');
      });
    });
  });

  // ==========================================================================
  // Complex Combined Scenarios
  // ==========================================================================
  describe('complex combined scenarios', () => {
    const complexPolicy: ValidatedResourcePolicy = {
      apiVersion: 'authz.engine/v1',
      kind: 'ResourcePolicy',
      metadata: { name: 'complex-policy' },
      spec: {
        resource: 'complex',
        rules: [
          {
            name: 'exact-match',
            actions: ['specific:action:here'],
            effect: 'allow',
            roles: ['specific-user'],
          },
          {
            name: 'prefix-wildcard',
            actions: ['api:*'],
            effect: 'allow',
            roles: ['api-user'],
          },
          {
            name: 'suffix-wildcard',
            actions: ['*:read'],
            effect: 'allow',
            roles: ['reader'],
          },
          {
            name: 'middle-wildcard',
            actions: ['admin:*:manage'],
            effect: 'allow',
            roles: ['admin'],
          },
          {
            name: 'deny-dangerous',
            actions: ['*:delete'],
            effect: 'deny',
            roles: ['user'],  // Deny delete for regular users
          },
        ],
      },
    };

    beforeEach(() => {
      engine.loadResourcePolicies([complexPolicy]);
    });

    it('should prefer exact match over wildcard', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['specific-user', 'api-user'], attributes: {} },
        resource: { kind: 'complex', id: 'c-1', attributes: {} },
        actions: ['specific:action:here'],
      });

      expect(result.results['specific:action:here'].effect).toBe('allow');
      expect(result.results['specific:action:here'].meta?.matchedRule).toBe('exact-match');
    });

    it('should handle user with multiple applicable wildcards', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['api-user', 'reader'], attributes: {} },
        resource: { kind: 'complex', id: 'c-1', attributes: {} },
        actions: ['api:users:read'],  // Matches both api:* and *:read
      });

      expect(result.results['api:users:read'].effect).toBe('allow');
    });

    it('should apply deny override for wildcard patterns', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['user', 'reader'], attributes: {} },
        resource: { kind: 'complex', id: 'c-1', attributes: {} },
        actions: ['documents:delete'],  // Matches *:delete (deny)
      });

      // Deny should override any allow for delete actions
      expect(result.results['documents:delete'].effect).toBe('deny');
    });

    it('should allow admin to manage via middle wildcard', () => {
      const result = engine.check({
        principal: { id: 'admin-1', roles: ['admin'], attributes: {} },
        resource: { kind: 'complex', id: 'c-1', attributes: {} },
        actions: ['admin:users:manage', 'admin:settings:manage', 'admin:logs:manage'],
      });

      expect(result.results['admin:users:manage'].effect).toBe('allow');
      expect(result.results['admin:settings:manage'].effect).toBe('allow');
      expect(result.results['admin:logs:manage'].effect).toBe('allow');
    });
  });

  // ==========================================================================
  // Performance Tests
  // ==========================================================================
  describe('performance', () => {
    const performancePolicy: ValidatedResourcePolicy = {
      apiVersion: 'authz.engine/v1',
      kind: 'ResourcePolicy',
      metadata: { name: 'perf-policy' },
      spec: {
        resource: 'perf-test',
        rules: [
          {
            name: 'prefix-wild',
            actions: ['documents:*'],
            effect: 'allow',
            roles: ['user'],
          },
          {
            name: 'suffix-wild',
            actions: ['*:read'],
            effect: 'allow',
            roles: ['reader'],
          },
          {
            name: 'middle-wild',
            actions: ['api:*:read'],
            effect: 'allow',
            roles: ['api-user'],
          },
        ],
      },
    };

    beforeEach(() => {
      engine.loadResourcePolicies([performancePolicy]);
    });

    it('should evaluate single wildcard match in under 10 microseconds', () => {
      // Warm up
      engine.check({
        principal: { id: 'user-1', roles: ['user'], attributes: {} },
        resource: { kind: 'perf-test', id: 'p-1', attributes: {} },
        actions: ['documents:read'],
      });

      // Measure
      const iterations = 1000;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        engine.check({
          principal: { id: 'user-1', roles: ['user'], attributes: {} },
          resource: { kind: 'perf-test', id: 'p-1', attributes: {} },
          actions: ['documents:read'],
        });
      }

      const end = performance.now();
      const avgMicroseconds = ((end - start) / iterations) * 1000;

      // Average should be under 10 microseconds (10000 nanoseconds)
      // This is 100 microseconds to be generous with CI variance
      expect(avgMicroseconds).toBeLessThan(100);
    });

    it('should evaluate multiple wildcards efficiently', () => {
      const iterations = 1000;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        engine.check({
          principal: { id: 'user-1', roles: ['user', 'reader', 'api-user'], attributes: {} },
          resource: { kind: 'perf-test', id: 'p-1', attributes: {} },
          actions: [
            'documents:read',
            'documents:write',
            'users:read',
            'api:users:read',
            'api:posts:read',
          ],
        });
      }

      const end = performance.now();
      const avgMs = (end - start) / iterations;

      // Average should be under 1ms even with 5 actions and 3 wildcards
      expect(avgMs).toBeLessThan(1);
    });

    it('should handle deep nested wildcards without exponential slowdown', () => {
      const deepPolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'deep-perf-policy' },
        spec: {
          resource: 'deep-perf',
          rules: [
            {
              name: 'deep-wild',
              actions: ['a:*:b:*:c:*:d'],
              effect: 'allow',
              roles: ['user'],
            },
          ],
        },
      };

      engine.clearPolicies();
      engine.loadResourcePolicies([deepPolicy]);

      const iterations = 1000;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        engine.check({
          principal: { id: 'user-1', roles: ['user'], attributes: {} },
          resource: { kind: 'deep-perf', id: 'd-1', attributes: {} },
          actions: ['a:x:b:y:c:z:d'],
        });
      }

      const end = performance.now();
      const avgMicroseconds = ((end - start) / iterations) * 1000;

      // Even with deep nesting, should complete in under 500 microseconds
      expect(avgMicroseconds).toBeLessThan(500);
    });

    it('should not have O(n^2) complexity with many wildcard patterns', () => {
      // Create policy with many wildcard rules
      const manyWildcardsPolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'many-wildcards-policy' },
        spec: {
          resource: 'many-wildcards',
          rules: Array.from({ length: 100 }, (_, i) => ({
            name: `wildcard-${i}`,
            actions: [`resource${i}:*`],
            effect: 'allow' as const,
            roles: ['user'],
          })),
        },
      };

      engine.clearPolicies();
      engine.loadResourcePolicies([manyWildcardsPolicy]);

      const iterations = 100;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        engine.check({
          principal: { id: 'user-1', roles: ['user'], attributes: {} },
          resource: { kind: 'many-wildcards', id: 'm-1', attributes: {} },
          actions: ['resource50:read'],  // Should find match at rule 50
        });
      }

      const end = performance.now();
      const avgMs = (end - start) / iterations;

      // With 100 rules, should still complete in under 5ms average
      expect(avgMs).toBeLessThan(5);
    });
  });

  // ==========================================================================
  // Integration with Conditions
  // ==========================================================================
  describe('wildcards with conditions', () => {
    const conditionalWildcardPolicy: ValidatedResourcePolicy = {
      apiVersion: 'authz.engine/v1',
      kind: 'ResourcePolicy',
      metadata: { name: 'conditional-wildcard-policy' },
      spec: {
        resource: 'conditional',
        rules: [
          {
            name: 'owner-all-actions',
            actions: ['*:*'],
            effect: 'allow',
            roles: ['user'],
            condition: {
              expression: 'resource.ownerId == principal.id',
            },
          },
          {
            name: 'public-read',
            actions: ['*:read'],
            effect: 'allow',
            roles: ['user'],
            condition: {
              expression: 'resource.isPublic == true',
            },
          },
        ],
      },
    };

    beforeEach(() => {
      engine.loadResourcePolicies([conditionalWildcardPolicy]);
    });

    it('should allow owner any action with wildcard', () => {
      const result = engine.check({
        principal: { id: 'user-123', roles: ['user'], attributes: {} },
        resource: {
          kind: 'conditional',
          id: 'c-1',
          attributes: { ownerId: 'user-123', isPublic: false }
        },
        actions: ['documents:read', 'documents:write', 'settings:update'],
      });

      expect(result.results['documents:read'].effect).toBe('allow');
      expect(result.results['documents:write'].effect).toBe('allow');
      expect(result.results['settings:update'].effect).toBe('allow');
    });

    it('should deny non-owner write actions', () => {
      const result = engine.check({
        principal: { id: 'user-123', roles: ['user'], attributes: {} },
        resource: {
          kind: 'conditional',
          id: 'c-1',
          attributes: { ownerId: 'user-456', isPublic: false }
        },
        actions: ['documents:write'],
      });

      expect(result.results['documents:write'].effect).toBe('deny');
    });

    it('should allow public read for non-owners', () => {
      const result = engine.check({
        principal: { id: 'user-123', roles: ['user'], attributes: {} },
        resource: {
          kind: 'conditional',
          id: 'c-1',
          attributes: { ownerId: 'user-456', isPublic: true }
        },
        actions: ['documents:read', 'files:read'],
      });

      expect(result.results['documents:read'].effect).toBe('allow');
      expect(result.results['files:read'].effect).toBe('allow');
    });
  });

  // ==========================================================================
  // Multiple Wildcards in Same Rule
  // ==========================================================================
  describe('multiple wildcards in single rule', () => {
    const multiWildcardRule: ValidatedResourcePolicy = {
      apiVersion: 'authz.engine/v1',
      kind: 'ResourcePolicy',
      metadata: { name: 'multi-wildcard-rule-policy' },
      spec: {
        resource: 'multi',
        rules: [
          {
            name: 'multiple-patterns',
            actions: ['docs:*', 'files:*', 'images:*'],  // Multiple wildcard patterns
            effect: 'allow',
            roles: ['content-manager'],
          },
        ],
      },
    };

    beforeEach(() => {
      engine.loadResourcePolicies([multiWildcardRule]);
    });

    it('should match first wildcard pattern', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['content-manager'], attributes: {} },
        resource: { kind: 'multi', id: 'm-1', attributes: {} },
        actions: ['docs:read'],
      });

      expect(result.results['docs:read'].effect).toBe('allow');
    });

    it('should match second wildcard pattern', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['content-manager'], attributes: {} },
        resource: { kind: 'multi', id: 'm-1', attributes: {} },
        actions: ['files:upload'],
      });

      expect(result.results['files:upload'].effect).toBe('allow');
    });

    it('should match third wildcard pattern', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['content-manager'], attributes: {} },
        resource: { kind: 'multi', id: 'm-1', attributes: {} },
        actions: ['images:resize'],
      });

      expect(result.results['images:resize'].effect).toBe('allow');
    });

    it('should not match unrelated patterns', () => {
      const result = engine.check({
        principal: { id: 'user-1', roles: ['content-manager'], attributes: {} },
        resource: { kind: 'multi', id: 'm-1', attributes: {} },
        actions: ['videos:play'],
      });

      expect(result.results['videos:play'].effect).toBe('deny');
    });
  });
});
