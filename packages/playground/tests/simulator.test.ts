/**
 * Policy Simulator Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolicySimulator } from '../src/simulator.js';

describe('PolicySimulator', () => {
  let simulator: PolicySimulator;

  beforeEach(() => {
    simulator = new PolicySimulator();
  });

  describe('loadPolicy', () => {
    it('should load a valid resource policy', () => {
      const yaml = `
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: test-policy
spec:
  resource: document
  rules:
    - name: allow-read
      actions: ["read"]
      effect: allow
      roles: ["user"]
`;

      const result = simulator.loadPolicy(yaml);

      expect(result.type).toBe('ResourcePolicy');
      expect(result.name).toBe('test-policy');
      expect(result.resource).toBe('document');
    });

    it('should load a derived roles policy', () => {
      const yaml = `
apiVersion: authz.engine/v1
kind: DerivedRoles
metadata:
  name: ownership-roles
spec:
  definitions:
    - name: owner
      parentRoles: ["user"]
      condition:
        expression: "resource.ownerId == principal.id"
`;

      const result = simulator.loadPolicy(yaml);

      expect(result.type).toBe('DerivedRoles');
      expect(result.name).toBe('ownership-roles');
    });

    it('should load multiple policies from multi-document YAML', () => {
      const yaml = `
apiVersion: authz.engine/v1
kind: DerivedRoles
metadata:
  name: ownership-roles
spec:
  definitions:
    - name: owner
      parentRoles: ["user"]
      condition:
        expression: "resource.ownerId == principal.id"
---
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
spec:
  resource: document
  rules:
    - name: owner-access
      actions: ["*"]
      effect: allow
      derivedRoles: ["owner"]
`;

      const results = simulator.loadPolicies(yaml);

      expect(results).toHaveLength(2);
      expect(results[0].type).toBe('DerivedRoles');
      expect(results[1].type).toBe('ResourcePolicy');
    });

    it('should throw on invalid policy', () => {
      const yaml = `
apiVersion: authz.engine/v1
kind: InvalidKind
metadata:
  name: test
`;

      expect(() => simulator.loadPolicy(yaml)).toThrow();
    });
  });

  describe('simulate', () => {
    beforeEach(() => {
      simulator.loadPolicy(`
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
spec:
  resource: document
  rules:
    - name: admin-full-access
      actions: ["*"]
      effect: allow
      roles: ["admin"]
    - name: user-read
      actions: ["read"]
      effect: allow
      roles: ["user"]
`);
    });

    it('should allow admin full access', () => {
      const response = simulator.simulate({
        principal: { id: 'admin1', roles: ['admin'], attributes: {} },
        resource: { kind: 'document', id: 'doc1', attributes: {} },
        actions: ['read', 'update', 'delete'],
      });

      expect(response.results['read'].effect).toBe('allow');
      expect(response.results['update'].effect).toBe('allow');
      expect(response.results['delete'].effect).toBe('allow');
    });

    it('should allow user to read only', () => {
      const response = simulator.simulate({
        principal: { id: 'user1', roles: ['user'], attributes: {} },
        resource: { kind: 'document', id: 'doc1', attributes: {} },
        actions: ['read', 'update'],
      });

      expect(response.results['read'].effect).toBe('allow');
      expect(response.results['update'].effect).toBe('deny');
    });

    it('should deny access to unknown resource types', () => {
      const response = simulator.simulate({
        principal: { id: 'admin1', roles: ['admin'], attributes: {} },
        resource: { kind: 'unknown', id: 'x', attributes: {} },
        actions: ['read'],
      });

      expect(response.results['read'].effect).toBe('deny');
    });
  });

  describe('explain', () => {
    beforeEach(() => {
      simulator.loadPolicy(`
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
spec:
  resource: document
  rules:
    - name: user-read
      actions: ["read"]
      effect: allow
      roles: ["user"]
`);
    });

    it('should provide detailed explanation', () => {
      simulator.simulate({
        principal: { id: 'user1', roles: ['user'], attributes: {} },
        resource: { kind: 'document', id: 'doc1', attributes: {} },
        actions: ['read'],
      });

      const explanation = simulator.explain();

      expect(explanation.request).toBeDefined();
      expect(explanation.response).toBeDefined();
      expect(explanation.trace).toBeInstanceOf(Array);
      expect(explanation.trace.length).toBeGreaterThan(0);
      expect(explanation.rulesEvaluated).toBeInstanceOf(Array);
    });

    it('should throw if no request has been simulated', () => {
      const freshSimulator = new PolicySimulator();
      expect(() => freshSimulator.explain()).toThrow();
    });
  });

  describe('whatIf', () => {
    beforeEach(() => {
      simulator.loadPolicy(`
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
spec:
  resource: document
  rules:
    - name: admin-full-access
      actions: ["*"]
      effect: allow
      roles: ["admin"]
    - name: user-read
      actions: ["read"]
      effect: allow
      roles: ["user"]
`);

      simulator.simulate({
        principal: { id: 'user1', roles: ['user'], attributes: {} },
        resource: { kind: 'document', id: 'doc1', attributes: {} },
        actions: ['read', 'update'],
      });
    });

    it('should detect decision changes when roles change', () => {
      const result = simulator.whatIf({
        principal: { roles: ['admin'] },
      });

      expect(result.changed).toBe(true);
      expect(result.changes).toContain("Action 'update': deny -> allow");
    });

    it('should report no change when roles stay same', () => {
      const result = simulator.whatIf({
        principal: { roles: ['user'] },
      });

      expect(result.changed).toBe(false);
      expect(result.changes).toHaveLength(0);
    });
  });

  describe('findMatchingRules', () => {
    beforeEach(() => {
      simulator.loadPolicy(`
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
spec:
  resource: document
  rules:
    - name: admin-full-access
      actions: ["*"]
      effect: allow
      roles: ["admin"]
    - name: user-read
      actions: ["read"]
      effect: allow
      roles: ["user"]
    - name: viewer-read
      actions: ["read"]
      effect: allow
      roles: ["viewer"]
`);
    });

    it('should find all matching rules', () => {
      simulator.simulate({
        principal: { id: 'user1', roles: ['user'], attributes: {} },
        resource: { kind: 'document', id: 'doc1', attributes: {} },
        actions: ['read'],
      });

      const rules = simulator.findMatchingRules();

      expect(rules).toHaveLength(3);
      expect(rules.filter((r) => r.matched)).toHaveLength(1);
      expect(rules.find((r) => r.matched)?.ruleName).toBe('user-read');
    });

    it('should explain why rules did not match', () => {
      simulator.simulate({
        principal: { id: 'user1', roles: ['user'], attributes: {} },
        resource: { kind: 'document', id: 'doc1', attributes: {} },
        actions: ['read'],
      });

      const rules = simulator.findMatchingRules();
      const adminRule = rules.find((r) => r.ruleName === 'admin-full-access');

      expect(adminRule?.matched).toBe(false);
      expect(adminRule?.reason).toContain('do not include required roles');
    });
  });

  describe('generateTestCases', () => {
    beforeEach(() => {
      simulator.loadPolicy(`
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
spec:
  resource: document
  rules:
    - name: admin-full-access
      actions: ["*"]
      effect: allow
      roles: ["admin"]
    - name: user-read
      actions: ["read"]
      effect: allow
      roles: ["user"]
`);
    });

    it('should generate test cases', () => {
      const tests = simulator.generateTestCases();

      expect(tests.length).toBeGreaterThan(0);
      expect(tests[0]).toHaveProperty('name');
      expect(tests[0]).toHaveProperty('description');
      expect(tests[0]).toHaveProperty('request');
      expect(tests[0]).toHaveProperty('expectedResults');
      expect(tests[0]).toHaveProperty('tags');
    });

    it('should generate test cases with valid requests', () => {
      const tests = simulator.generateTestCases();

      for (const test of tests) {
        expect(test.request.principal).toBeDefined();
        expect(test.request.resource).toBeDefined();
        expect(test.request.actions).toBeDefined();
        expect(test.request.actions.length).toBeGreaterThan(0);
      }
    });

    it('should include default deny test case', () => {
      const tests = simulator.generateTestCases();
      const defaultDenyTest = tests.find((t) => t.tags.includes('default'));

      expect(defaultDenyTest).toBeDefined();
      expect(defaultDenyTest?.expectedResults['unknown-action']).toBe('deny');
    });
  });

  describe('derived roles', () => {
    beforeEach(() => {
      simulator.loadPolicies(`
apiVersion: authz.engine/v1
kind: DerivedRoles
metadata:
  name: ownership-roles
spec:
  definitions:
    - name: owner
      parentRoles: ["user"]
      condition:
        expression: "resource.ownerId == principal.id"
---
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
spec:
  resource: document
  rules:
    - name: owner-full-access
      actions: ["*"]
      effect: allow
      derivedRoles: ["owner"]
    - name: user-read
      actions: ["read"]
      effect: allow
      roles: ["user"]
`);
    });

    it('should compute derived roles correctly', () => {
      const response = simulator.simulate({
        principal: { id: 'user1', roles: ['user'], attributes: {} },
        resource: { kind: 'document', id: 'doc1', attributes: { ownerId: 'user1' } },
        actions: ['read', 'update', 'delete'],
      });

      expect(response.results['read'].effect).toBe('allow');
      expect(response.results['update'].effect).toBe('allow');
      expect(response.results['delete'].effect).toBe('allow');
    });

    it('should not grant derived role access to non-owners', () => {
      const response = simulator.simulate({
        principal: { id: 'user2', roles: ['user'], attributes: {} },
        resource: { kind: 'document', id: 'doc1', attributes: { ownerId: 'user1' } },
        actions: ['read', 'update'],
      });

      expect(response.results['read'].effect).toBe('allow'); // From user-read rule
      expect(response.results['update'].effect).toBe('deny');
    });

    it('should include derived roles in explanation', () => {
      simulator.simulate({
        principal: { id: 'user1', roles: ['user'], attributes: {} },
        resource: { kind: 'document', id: 'doc1', attributes: { ownerId: 'user1' } },
        actions: ['update'],
      });

      const explanation = simulator.explain();

      expect(explanation.derivedRoles).toContain('owner');
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      simulator.loadPolicies(`
apiVersion: authz.engine/v1
kind: DerivedRoles
metadata:
  name: ownership-roles
spec:
  definitions:
    - name: owner
      parentRoles: ["user"]
      condition:
        expression: "resource.ownerId == principal.id"
---
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
spec:
  resource: document
  rules:
    - name: rule1
      actions: ["read"]
      effect: allow
      roles: ["user"]
    - name: rule2
      actions: ["write"]
      effect: allow
      roles: ["admin"]
`);

      const stats = simulator.getStats();

      expect(stats.resourcePolicies).toBe(1);
      expect(stats.derivedRolesPolicies).toBe(1);
      expect(stats.totalRules).toBe(2);
      expect(stats.resources).toContain('document');
      expect(stats.derivedRoles).toContain('owner');
    });
  });

  describe('clearPolicies', () => {
    it('should clear all policies and state', () => {
      simulator.loadPolicy(`
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: test-policy
spec:
  resource: document
  rules:
    - name: rule1
      actions: ["read"]
      effect: allow
      roles: ["user"]
`);

      simulator.simulate({
        principal: { id: 'user1', roles: ['user'], attributes: {} },
        resource: { kind: 'document', id: 'doc1', attributes: {} },
        actions: ['read'],
      });

      simulator.clearPolicies();

      const stats = simulator.getStats();
      expect(stats.resourcePolicies).toBe(0);
      expect(stats.derivedRolesPolicies).toBe(0);
      expect(stats.totalRules).toBe(0);
      expect(simulator.getLastRequest()).toBeUndefined();
      expect(simulator.getLastResponse()).toBeUndefined();
    });
  });
});
