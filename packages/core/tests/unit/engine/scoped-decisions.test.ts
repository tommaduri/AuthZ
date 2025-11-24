import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DecisionEngine } from '../../../src/engine/decision-engine';
import type { ValidatedResourcePolicy } from '../../../src/policy/schema';
import type { ScopedCheckRequest, ScopeContext } from '../../../src/types';

/**
 * London School TDD Tests for DecisionEngine with Scopes
 *
 * These tests focus on behavior verification and collaboration between objects.
 * We test HOW objects interact, not just WHAT they contain.
 */
describe('DecisionEngine with Scopes', () => {
  let engine: DecisionEngine;

  // Test fixtures - policies with different scopes
  const globalPolicy: ValidatedResourcePolicy = {
    apiVersion: 'authz.engine/v1',
    kind: 'ResourcePolicy',
    metadata: {
      name: 'global-document-policy',
      // No scope = global policy
    },
    spec: {
      resource: 'document',
      rules: [
        {
          actions: ['read'],
          effect: 'allow',
          roles: ['viewer'],
        },
        {
          actions: ['write'],
          effect: 'allow',
          roles: ['editor'],
        },
      ],
    },
  };

  const acmeScopedPolicy: ValidatedResourcePolicy = {
    apiVersion: 'authz.engine/v1',
    kind: 'ResourcePolicy',
    metadata: {
      name: 'acme-document-policy',
      scope: 'acme',
    },
    spec: {
      resource: 'document',
      rules: [
        {
          actions: ['read'],
          effect: 'allow',
          roles: ['viewer'],
        },
        {
          actions: ['write', 'delete'],
          effect: 'allow',
          roles: ['acme-editor'],
        },
      ],
    },
  };

  const acmeCorpScopedPolicy: ValidatedResourcePolicy = {
    apiVersion: 'authz.engine/v1',
    kind: 'ResourcePolicy',
    metadata: {
      name: 'acme-corp-document-policy',
      scope: 'acme.corp',
    },
    spec: {
      resource: 'document',
      rules: [
        {
          actions: ['read', 'write', 'delete'],
          effect: 'allow',
          roles: ['corp-admin'],
        },
      ],
    },
  };

  const acmeEngineeringScopedPolicy: ValidatedResourcePolicy = {
    apiVersion: 'authz.engine/v1',
    kind: 'ResourcePolicy',
    metadata: {
      name: 'acme-engineering-policy',
      scope: 'acme.corp.engineering',
    },
    spec: {
      resource: 'document',
      rules: [
        {
          actions: ['read', 'write', 'delete', 'deploy'],
          effect: 'allow',
          roles: ['engineer'],
        },
      ],
    },
  };

  beforeEach(() => {
    engine = new DecisionEngine();
  });

  describe('loadScopedResourcePolicies', () => {
    it('should store policies with scopes using "scope:resourceKind" key format', () => {
      engine.loadScopedResourcePolicies([acmeScopedPolicy]);

      const policies = engine.getPoliciesForScope('acme', 'document');
      expect(policies).toHaveLength(1);
      expect(policies[0].metadata.name).toBe('acme-document-policy');
    });

    it('should store policies without scope as global', () => {
      engine.loadScopedResourcePolicies([globalPolicy]);

      const policies = engine.getPoliciesForScope('(global)', 'document');
      expect(policies).toHaveLength(1);
      expect(policies[0].metadata.name).toBe('global-document-policy');
    });

    it('should handle multiple policies for same scope and resource', () => {
      const anotherAcmePolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: {
          name: 'acme-document-policy-2',
          scope: 'acme',
        },
        spec: {
          resource: 'document',
          rules: [
            {
              actions: ['archive'],
              effect: 'allow',
              roles: ['archivist'],
            },
          ],
        },
      };

      engine.loadScopedResourcePolicies([acmeScopedPolicy, anotherAcmePolicy]);

      const policies = engine.getPoliciesForScope('acme', 'document');
      expect(policies).toHaveLength(2);
    });

    it('should separate policies by scope correctly', () => {
      engine.loadScopedResourcePolicies([
        globalPolicy,
        acmeScopedPolicy,
        acmeCorpScopedPolicy,
      ]);

      const globalPolicies = engine.getPoliciesForScope('(global)', 'document');
      const acmePolicies = engine.getPoliciesForScope('acme', 'document');
      const acmeCorpPolicies = engine.getPoliciesForScope('acme.corp', 'document');

      expect(globalPolicies).toHaveLength(1);
      expect(acmePolicies).toHaveLength(1);
      expect(acmeCorpPolicies).toHaveLength(1);

      expect(globalPolicies[0].metadata.name).toBe('global-document-policy');
      expect(acmePolicies[0].metadata.name).toBe('acme-document-policy');
      expect(acmeCorpPolicies[0].metadata.name).toBe('acme-corp-document-policy');
    });

    it('should handle policies for different resource kinds in same scope', () => {
      const acmeUserPolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: {
          name: 'acme-user-policy',
          scope: 'acme',
        },
        spec: {
          resource: 'user',
          rules: [
            {
              actions: ['view'],
              effect: 'allow',
              roles: ['hr'],
            },
          ],
        },
      };

      engine.loadScopedResourcePolicies([acmeScopedPolicy, acmeUserPolicy]);

      const docPolicies = engine.getPoliciesForScope('acme', 'document');
      const userPolicies = engine.getPoliciesForScope('acme', 'user');

      expect(docPolicies).toHaveLength(1);
      expect(userPolicies).toHaveLength(1);
    });
  });

  describe('checkWithScope', () => {
    beforeEach(() => {
      engine.loadScopedResourcePolicies([
        globalPolicy,
        acmeScopedPolicy,
        acmeCorpScopedPolicy,
        acmeEngineeringScopedPolicy,
      ]);
    });

    it('should use scoped policy when scope matches exactly', () => {
      const request: ScopedCheckRequest = {
        principal: {
          id: 'user-1',
          roles: ['acme-editor'],
          attributes: {},
        },
        resource: {
          kind: 'document',
          id: 'doc-1',
          attributes: {},
        },
        actions: ['delete'],
        scope: {
          resource: 'acme',
        },
      };

      const result = engine.checkWithScope(request);

      expect(result.results['delete'].effect).toBe('allow');
      expect(result.scopeResolution?.effectiveScope).toBe('acme');
      expect(result.scopeResolution?.scopedPolicyMatched).toBe(true);
    });

    it('should fall back to global policy when no scoped policy matches', () => {
      const request: ScopedCheckRequest = {
        principal: {
          id: 'user-1',
          roles: ['viewer'],
          attributes: {},
        },
        resource: {
          kind: 'document',
          id: 'doc-1',
          attributes: {},
        },
        actions: ['read'],
        scope: {
          resource: 'unknown.scope',
        },
      };

      const result = engine.checkWithScope(request);

      expect(result.results['read'].effect).toBe('allow');
      expect(result.scopeResolution?.effectiveScope).toBe('unknown.scope');
      expect(result.scopeResolution?.scopedPolicyMatched).toBe(false);
    });

    it('should include scopeResolution in response', () => {
      const request: ScopedCheckRequest = {
        principal: {
          id: 'user-1',
          roles: ['corp-admin'],
          attributes: {},
        },
        resource: {
          kind: 'document',
          id: 'doc-1',
          attributes: {},
        },
        actions: ['write'],
        scope: {
          resource: 'acme.corp',
        },
      };

      const result = engine.checkWithScope(request);

      expect(result.scopeResolution).toBeDefined();
      expect(result.scopeResolution?.effectiveScope).toBe('acme.corp');
      expect(result.scopeResolution?.inheritanceChain).toContain('acme.corp');
    });

    it('should use resource scope over principal scope when both provided', () => {
      const request: ScopedCheckRequest = {
        principal: {
          id: 'user-1',
          roles: ['engineer'],
          attributes: {},
        },
        resource: {
          kind: 'document',
          id: 'doc-1',
          attributes: {},
        },
        actions: ['deploy'],
        scope: {
          principal: 'acme',
          resource: 'acme.corp.engineering',
        },
      };

      const result = engine.checkWithScope(request);

      expect(result.results['deploy'].effect).toBe('allow');
      expect(result.scopeResolution?.effectiveScope).toBe('acme.corp.engineering');
    });

    it('should use principal scope when resource scope is not provided', () => {
      const request: ScopedCheckRequest = {
        principal: {
          id: 'user-1',
          roles: ['acme-editor'],
          attributes: {},
        },
        resource: {
          kind: 'document',
          id: 'doc-1',
          attributes: {},
        },
        actions: ['write'],
        scope: {
          principal: 'acme',
        },
      };

      const result = engine.checkWithScope(request);

      expect(result.results['write'].effect).toBe('allow');
      expect(result.scopeResolution?.effectiveScope).toBe('acme');
    });

    it('should default to global when no scope context provided', () => {
      const request: ScopedCheckRequest = {
        principal: {
          id: 'user-1',
          roles: ['viewer'],
          attributes: {},
        },
        resource: {
          kind: 'document',
          id: 'doc-1',
          attributes: {},
        },
        actions: ['read'],
        // No scope provided
      };

      const result = engine.checkWithScope(request);

      expect(result.results['read'].effect).toBe('allow');
      expect(result.scopeResolution?.effectiveScope).toBe('(global)');
    });

    it('should deny action when no matching policy found in scope or global', () => {
      const request: ScopedCheckRequest = {
        principal: {
          id: 'user-1',
          roles: ['viewer'],
          attributes: {},
        },
        resource: {
          kind: 'unknown-resource',
          id: 'res-1',
          attributes: {},
        },
        actions: ['read'],
        scope: {
          resource: 'acme',
        },
      };

      const result = engine.checkWithScope(request);

      expect(result.results['read'].effect).toBe('deny');
    });
  });

  describe('getPoliciesForScope', () => {
    beforeEach(() => {
      engine.loadScopedResourcePolicies([
        globalPolicy,
        acmeScopedPolicy,
        acmeCorpScopedPolicy,
      ]);
    });

    it('should return policies for exact scope match', () => {
      const policies = engine.getPoliciesForScope('acme', 'document');

      expect(policies).toHaveLength(1);
      expect(policies[0].metadata.name).toBe('acme-document-policy');
    });

    it('should return empty array for non-existent scope', () => {
      const policies = engine.getPoliciesForScope('nonexistent', 'document');

      expect(policies).toHaveLength(0);
    });

    it('should return all policies for scope when resourceKind not specified', () => {
      const acmeUserPolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: {
          name: 'acme-user-policy',
          scope: 'acme',
        },
        spec: {
          resource: 'user',
          rules: [
            {
              actions: ['view'],
              effect: 'allow',
              roles: ['hr'],
            },
          ],
        },
      };

      engine.loadScopedResourcePolicies([acmeUserPolicy]);

      const allAcmePolicies = engine.getPoliciesForScope('acme');

      expect(allAcmePolicies.length).toBeGreaterThanOrEqual(2); // document + user
    });

    it('should return global policies when scope is "(global)"', () => {
      const policies = engine.getPoliciesForScope('(global)', 'document');

      expect(policies).toHaveLength(1);
      expect(policies[0].metadata.name).toBe('global-document-policy');
    });
  });

  describe('getRegisteredScopes', () => {
    it('should return all unique scopes', () => {
      engine.loadScopedResourcePolicies([
        globalPolicy,
        acmeScopedPolicy,
        acmeCorpScopedPolicy,
        acmeEngineeringScopedPolicy,
      ]);

      const scopes = engine.getRegisteredScopes();

      expect(scopes).toContain('(global)');
      expect(scopes).toContain('acme');
      expect(scopes).toContain('acme.corp');
      expect(scopes).toContain('acme.corp.engineering');
    });

    it('should return empty array when no policies loaded', () => {
      const scopes = engine.getRegisteredScopes();

      expect(scopes).toEqual([]);
    });

    it('should return sorted scopes', () => {
      engine.loadScopedResourcePolicies([
        acmeEngineeringScopedPolicy,
        globalPolicy,
        acmeScopedPolicy,
      ]);

      const scopes = engine.getRegisteredScopes();

      // Verify sorted order
      const sortedScopes = [...scopes].sort();
      expect(scopes).toEqual(sortedScopes);
    });
  });

  describe('scope inheritance', () => {
    beforeEach(() => {
      engine.loadScopedResourcePolicies([
        globalPolicy,
        acmeScopedPolicy,
        // Note: No acme.corp policy, only acme and global
      ]);
    });

    it('should inherit from parent scope when exact scope has no policy', () => {
      const request: ScopedCheckRequest = {
        principal: {
          id: 'user-1',
          roles: ['acme-editor'],
          attributes: {},
        },
        resource: {
          kind: 'document',
          id: 'doc-1',
          attributes: {},
        },
        actions: ['write'],
        scope: {
          resource: 'acme.corp', // No direct policy for acme.corp
        },
      };

      const result = engine.checkWithScope(request);

      // Should inherit from 'acme' scope
      expect(result.results['write'].effect).toBe('allow');
      expect(result.scopeResolution?.inheritanceChain).toContain('acme.corp');
      expect(result.scopeResolution?.inheritanceChain).toContain('acme');
    });

    it('should include full inheritance chain in response', () => {
      const request: ScopedCheckRequest = {
        principal: {
          id: 'user-1',
          roles: ['viewer'],
          attributes: {},
        },
        resource: {
          kind: 'document',
          id: 'doc-1',
          attributes: {},
        },
        actions: ['read'],
        scope: {
          resource: 'acme.corp.engineering.team1',
        },
      };

      const result = engine.checkWithScope(request);

      expect(result.scopeResolution?.inheritanceChain).toContain('acme.corp.engineering.team1');
      expect(result.scopeResolution?.inheritanceChain).toContain('acme.corp.engineering');
      expect(result.scopeResolution?.inheritanceChain).toContain('acme.corp');
      expect(result.scopeResolution?.inheritanceChain).toContain('acme');
      expect(result.scopeResolution?.inheritanceChain).toContain('(global)');
    });

    it('should use most specific scope policy available', () => {
      // Load all scoped policies
      engine.loadScopedResourcePolicies([
        acmeCorpScopedPolicy,
        acmeEngineeringScopedPolicy,
      ]);

      const request: ScopedCheckRequest = {
        principal: {
          id: 'user-1',
          roles: ['engineer'],
          attributes: {},
        },
        resource: {
          kind: 'document',
          id: 'doc-1',
          attributes: {},
        },
        actions: ['deploy'],
        scope: {
          resource: 'acme.corp.engineering',
        },
      };

      const result = engine.checkWithScope(request);

      // Should use acme.corp.engineering policy (most specific)
      expect(result.results['deploy'].effect).toBe('allow');
    });

    it('should fall back to global when no parent scope matches', () => {
      const request: ScopedCheckRequest = {
        principal: {
          id: 'user-1',
          roles: ['viewer'],
          attributes: {},
        },
        resource: {
          kind: 'document',
          id: 'doc-1',
          attributes: {},
        },
        actions: ['read'],
        scope: {
          resource: 'other.company.team',
        },
      };

      const result = engine.checkWithScope(request);

      // Should fall back to global policy
      expect(result.results['read'].effect).toBe('allow');
      expect(result.scopeResolution?.scopedPolicyMatched).toBe(false);
    });
  });

  describe('interaction with existing check method', () => {
    it('should maintain backward compatibility with regular check()', () => {
      engine.loadResourcePolicies([globalPolicy]);

      const result = engine.check({
        principal: {
          id: 'user-1',
          roles: ['viewer'],
          attributes: {},
        },
        resource: {
          kind: 'document',
          id: 'doc-1',
          attributes: {},
        },
        actions: ['read'],
      });

      expect(result.results['read'].effect).toBe('allow');
      // Regular check should not have scopeResolution
      expect((result as any).scopeResolution).toBeUndefined();
    });

    it('should keep scoped policies separate from regular policies', () => {
      engine.loadResourcePolicies([globalPolicy]);
      engine.loadScopedResourcePolicies([acmeScopedPolicy]);

      const stats = engine.getStats();

      // Global policy loaded via loadResourcePolicies
      expect(stats.resourcePolicies).toBe(1);

      // Scoped policy should be in separate storage
      const scopedPolicies = engine.getPoliciesForScope('acme', 'document');
      expect(scopedPolicies).toHaveLength(1);
    });
  });

  describe('clearPolicies behavior', () => {
    it('should clear both regular and scoped policies', () => {
      engine.loadResourcePolicies([globalPolicy]);
      engine.loadScopedResourcePolicies([acmeScopedPolicy]);

      engine.clearPolicies();

      const stats = engine.getStats();
      const scopes = engine.getRegisteredScopes();

      expect(stats.resourcePolicies).toBe(0);
      expect(scopes).toHaveLength(0);
    });
  });

  describe('mock collaboration verification', () => {
    it('should use ScopeResolver to compute effective scope', () => {
      // This test verifies the collaboration between DecisionEngine and ScopeResolver
      engine.loadScopedResourcePolicies([acmeScopedPolicy]);

      // When both scopes share a common prefix, ScopeResolver finds the intersection
      const request: ScopedCheckRequest = {
        principal: {
          id: 'user-1',
          roles: ['acme-editor'],
          attributes: {},
        },
        resource: {
          kind: 'document',
          id: 'doc-1',
          attributes: {},
        },
        actions: ['write'],
        scope: {
          principal: 'acme.corp.engineering',
          resource: 'acme.corp.sales',
        },
      };

      const result = engine.checkWithScope(request);

      // ScopeResolver finds the common ancestor (acme.corp) when scopes diverge
      expect(result.scopeResolution?.effectiveScope).toBe('acme.corp');
    });

    it('should coordinate between scope resolution and policy evaluation', () => {
      engine.loadScopedResourcePolicies([
        globalPolicy,
        acmeScopedPolicy,
      ]);

      // Verify that the engine coordinates scope resolution with policy evaluation
      const request: ScopedCheckRequest = {
        principal: {
          id: 'user-1',
          roles: ['acme-editor'],
          attributes: {},
        },
        resource: {
          kind: 'document',
          id: 'doc-1',
          attributes: {},
        },
        actions: ['delete'],
        scope: {
          resource: 'acme',
        },
      };

      const result = engine.checkWithScope(request);

      // acme-editor can delete in acme scope but not in global
      expect(result.results['delete'].effect).toBe('allow');

      // Now check same user in global scope
      const globalRequest: ScopedCheckRequest = {
        ...request,
        scope: undefined,
      };

      const globalResult = engine.checkWithScope(globalRequest);

      // Global policy doesn't allow acme-editor to delete
      expect(globalResult.results['delete'].effect).toBe('deny');
    });
  });
});
