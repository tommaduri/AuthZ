/**
 * Decision Engine Performance Benchmarks
 *
 * Comprehensive benchmarks for the core authorization decision engine measuring:
 * - Single check latency (target: <1ms)
 * - Batch check throughput
 * - Cache hit/miss performance
 * - Policy evaluation efficiency
 *
 * Target metrics:
 * - Single check latency: <1ms P99
 * - Batch check: 1000 checks in <100ms
 * - Throughput: >5000 decisions/sec
 */

import { describe, bench, beforeAll, afterAll, beforeEach } from 'vitest';
import { DecisionEngine } from '../src/engine/decision-engine.js';
import type {
  CheckRequest,
  Principal,
  Resource,
  ResourcePolicy,
  DerivedRolesPolicy,
} from '../src/types/index.js';
import type { ValidatedResourcePolicy, ValidatedDerivedRolesPolicy } from '../src/policy/schema.js';

// =============================================================================
// Test Policy Setup
// =============================================================================

const createResourcePolicy = (
  name: string,
  resource: string,
  rulesCount: number = 5,
): ValidatedResourcePolicy => ({
  apiVersion: 'authz.engine/v1',
  kind: 'ResourcePolicy',
  metadata: {
    name,
    description: `Test policy for ${resource}`,
  },
  spec: {
    resource,
    rules: Array.from({ length: rulesCount }, (_, i) => ({
      name: `rule-${i + 1}`,
      actions: i === 0 ? ['*'] : [`action-${i}`],
      effect: i % 3 === 0 ? 'deny' as const : 'allow' as const,
      roles: [`role-${i % 5}`],
      condition: i % 2 === 0 ? { expression: 'principal.isActive == true' } : undefined,
    })),
  },
});

const createDerivedRolesPolicy = (
  name: string,
  definitionsCount: number = 3,
): ValidatedDerivedRolesPolicy => ({
  apiVersion: 'authz.engine/v1',
  kind: 'DerivedRoles',
  metadata: {
    name,
    description: 'Test derived roles',
  },
  spec: {
    definitions: Array.from({ length: definitionsCount }, (_, i) => ({
      name: `derived-role-${i + 1}`,
      parentRoles: ['user'],
      condition: {
        expression: `principal.level >= ${(i + 1) * 2}`,
      },
    })),
  },
});

// Standard test policies
const documentPolicy: ValidatedResourcePolicy = {
  apiVersion: 'authz.engine/v1',
  kind: 'ResourcePolicy',
  metadata: {
    name: 'document-policy',
    description: 'Document access control',
  },
  spec: {
    resource: 'document',
    rules: [
      {
        name: 'allow-owner-all',
        actions: ['*'],
        effect: 'allow',
        condition: { expression: 'resource.ownerId == principal.id' },
      },
      {
        name: 'allow-view-public',
        actions: ['view'],
        effect: 'allow',
        condition: { expression: 'resource.visibility == "public"' },
      },
      {
        name: 'allow-admin-all',
        actions: ['*'],
        effect: 'allow',
        roles: ['admin'],
      },
      {
        name: 'allow-editor-edit',
        actions: ['view', 'edit'],
        effect: 'allow',
        roles: ['editor'],
      },
      {
        name: 'deny-delete-non-admin',
        actions: ['delete'],
        effect: 'deny',
        roles: ['user', 'editor'],
      },
    ],
  },
};

const ownerDerivedRoles: ValidatedDerivedRolesPolicy = {
  apiVersion: 'authz.engine/v1',
  kind: 'DerivedRoles',
  metadata: {
    name: 'owner-roles',
    description: 'Compute owner-based roles',
  },
  spec: {
    definitions: [
      {
        name: 'owner',
        parentRoles: ['user'],
        condition: { expression: 'resource.ownerId == principal.id' },
      },
      {
        name: 'team-member',
        parentRoles: ['user'],
        condition: { expression: 'principal.department == resource.department' },
      },
      {
        name: 'senior',
        parentRoles: ['user'],
        condition: { expression: 'principal.level >= 8' },
      },
    ],
  },
};

// =============================================================================
// Test Data Generators
// =============================================================================

const createPrincipal = (id: string, roles: string[] = ['user']): Principal => ({
  id,
  roles,
  attributes: {
    email: `${id}@example.com`,
    department: 'engineering',
    level: 5,
    isActive: true,
  },
});

const createResource = (kind: string, id: string, ownerId: string = 'owner-1'): Resource => ({
  kind,
  id,
  attributes: {
    ownerId,
    visibility: 'private',
    department: 'engineering',
  },
});

const createCheckRequest = (
  principal: Principal,
  resource: Resource,
  actions: string[],
): CheckRequest => ({
  requestId: `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
  principal,
  resource,
  actions,
});

// =============================================================================
// Benchmark Suites
// =============================================================================

describe('Decision Engine Benchmarks', () => {
  let engine: DecisionEngine;
  let heavyEngine: DecisionEngine;

  const standardPrincipal = createPrincipal('user-123', ['user', 'editor']);
  const adminPrincipal = createPrincipal('admin-001', ['admin', 'user']);
  const ownerPrincipal = createPrincipal('owner-1', ['user']);

  const standardResource = createResource('document', 'doc-001', 'owner-1');
  const publicResource: Resource = {
    kind: 'document',
    id: 'doc-public',
    attributes: { ownerId: 'other', visibility: 'public', department: 'marketing' },
  };

  beforeAll(() => {
    // Standard engine with typical policy load
    engine = new DecisionEngine();
    engine.loadResourcePolicies([documentPolicy]);
    engine.loadDerivedRolesPolicies([ownerDerivedRoles]);

    // Heavy engine with many policies for stress testing
    heavyEngine = new DecisionEngine();
    const manyPolicies = Array.from({ length: 50 }, (_, i) =>
      createResourcePolicy(`policy-${i}`, `resource-type-${i}`, 10)
    );
    heavyEngine.loadResourcePolicies(manyPolicies);
    heavyEngine.loadDerivedRolesPolicies([
      createDerivedRolesPolicy('derived-1', 5),
      createDerivedRolesPolicy('derived-2', 5),
      createDerivedRolesPolicy('derived-3', 5),
    ]);
  });

  // ---------------------------------------------------------------------------
  // Single Check Latency (Target: <1ms)
  // ---------------------------------------------------------------------------

  describe('Single Check Latency', () => {
    bench('simple allow check (role-based)', () => {
      const request = createCheckRequest(standardPrincipal, standardResource, ['view']);
      engine.check(request);
    });

    bench('simple deny check', () => {
      const request = createCheckRequest(standardPrincipal, standardResource, ['delete']);
      engine.check(request);
    });

    bench('owner-based allow (CEL condition)', () => {
      const request = createCheckRequest(ownerPrincipal, standardResource, ['edit']);
      engine.check(request);
    });

    bench('admin bypass (role match)', () => {
      const request = createCheckRequest(adminPrincipal, standardResource, ['delete']);
      engine.check(request);
    });

    bench('public resource access', () => {
      const request = createCheckRequest(standardPrincipal, publicResource, ['view']);
      engine.check(request);
    });

    bench('multiple actions check', () => {
      const request = createCheckRequest(
        standardPrincipal,
        standardResource,
        ['view', 'edit', 'delete'],
      );
      engine.check(request);
    });

    bench('with derived roles computation', () => {
      const request = createCheckRequest(ownerPrincipal, standardResource, ['view']);
      engine.check(request);
    });

    bench('no matching policy (default deny)', () => {
      const unknownResource = createResource('unknown-type', 'unknown-001');
      const request = createCheckRequest(standardPrincipal, unknownResource, ['view']);
      engine.check(request);
    });
  });

  // ---------------------------------------------------------------------------
  // Batch Check Throughput
  // ---------------------------------------------------------------------------

  describe('Batch Check Throughput', () => {
    bench('10 sequential checks', () => {
      for (let i = 0; i < 10; i++) {
        const request = createCheckRequest(
          createPrincipal(`user-${i}`),
          createResource('document', `doc-${i}`),
          ['view'],
        );
        engine.check(request);
      }
    });

    bench('100 sequential checks', () => {
      for (let i = 0; i < 100; i++) {
        const request = createCheckRequest(
          createPrincipal(`user-${i % 10}`),
          createResource('document', `doc-${i}`),
          ['view'],
        );
        engine.check(request);
      }
    });

    bench('1000 sequential checks', () => {
      for (let i = 0; i < 1000; i++) {
        const request = createCheckRequest(
          createPrincipal(`user-${i % 10}`),
          createResource('document', `doc-${i % 100}`),
          ['view'],
        );
        engine.check(request);
      }
    });

    bench('mixed operations batch (view/edit/delete)', () => {
      const actions = ['view', 'edit', 'delete'];
      for (let i = 0; i < 100; i++) {
        const request = createCheckRequest(
          standardPrincipal,
          createResource('document', `doc-${i}`),
          [actions[i % 3]],
        );
        engine.check(request);
      }
    });

    bench('varied principals batch', () => {
      const principals = [standardPrincipal, adminPrincipal, ownerPrincipal];
      for (let i = 0; i < 100; i++) {
        const request = createCheckRequest(
          principals[i % 3],
          standardResource,
          ['view'],
        );
        engine.check(request);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Cache Performance (CEL Expression Caching)
  // ---------------------------------------------------------------------------

  describe('Cache Performance', () => {
    bench('repeated identical requests (cache warm)', () => {
      const request = createCheckRequest(ownerPrincipal, standardResource, ['edit']);
      for (let i = 0; i < 100; i++) {
        engine.check(request);
      }
    });

    bench('same policy different resources', () => {
      for (let i = 0; i < 100; i++) {
        const request = createCheckRequest(
          standardPrincipal,
          createResource('document', `doc-${i}`),
          ['view'],
        );
        engine.check(request);
      }
    });

    bench('same policy different principals', () => {
      for (let i = 0; i < 100; i++) {
        const request = createCheckRequest(
          createPrincipal(`user-${i}`, ['user']),
          standardResource,
          ['view'],
        );
        engine.check(request);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Policy Evaluation Efficiency
  // ---------------------------------------------------------------------------

  describe('Policy Evaluation Efficiency', () => {
    bench('few rules evaluation (5 rules)', () => {
      const request = createCheckRequest(standardPrincipal, standardResource, ['view']);
      engine.check(request);
    });

    bench('many policies evaluation (50 resource types)', () => {
      const resource = createResource('resource-type-25', 'item-001');
      const request = createCheckRequest(standardPrincipal, resource, ['view']);
      heavyEngine.check(request);
    });

    bench('deep derived roles computation', () => {
      const principal = createPrincipal('senior-user', ['user']);
      (principal.attributes as Record<string, unknown>).level = 10;
      const request = createCheckRequest(principal, standardResource, ['view']);
      engine.check(request);
    });

    bench('deny-overrides evaluation (first match deny)', () => {
      const request = createCheckRequest(standardPrincipal, standardResource, ['delete']);
      engine.check(request);
    });

    bench('multiple rule matches (allow after checking all)', () => {
      const request = createCheckRequest(adminPrincipal, standardResource, ['view', 'edit']);
      engine.check(request);
    });
  });

  // ---------------------------------------------------------------------------
  // Heavy Load Scenarios
  // ---------------------------------------------------------------------------

  describe('Heavy Load Scenarios', () => {
    bench('heavy engine - single check', () => {
      const resource = createResource('resource-type-10', 'item-001');
      const request = createCheckRequest(standardPrincipal, resource, ['action-1']);
      heavyEngine.check(request);
    });

    bench('heavy engine - 100 checks varied resources', () => {
      for (let i = 0; i < 100; i++) {
        const resource = createResource(`resource-type-${i % 50}`, `item-${i}`);
        const request = createCheckRequest(standardPrincipal, resource, ['action-1']);
        heavyEngine.check(request);
      }
    });

    bench('complex request - 10 actions', () => {
      const actions = Array.from({ length: 10 }, (_, i) => `action-${i}`);
      const request = createCheckRequest(standardPrincipal, standardResource, actions);
      engine.check(request);
    });

    bench('wildcard action matching', () => {
      const request = createCheckRequest(adminPrincipal, standardResource, ['any-action']);
      engine.check(request);
    });
  });

  // ---------------------------------------------------------------------------
  // Memory Efficiency
  // ---------------------------------------------------------------------------

  describe('Memory Efficiency', () => {
    bench('fresh engine initialization', () => {
      const freshEngine = new DecisionEngine();
      freshEngine.loadResourcePolicies([documentPolicy]);
    });

    bench('policy loading (50 policies)', () => {
      const freshEngine = new DecisionEngine();
      const policies = Array.from({ length: 50 }, (_, i) =>
        createResourcePolicy(`policy-${i}`, `resource-${i}`, 5)
      );
      freshEngine.loadResourcePolicies(policies);
    });

    bench('check with auxData', () => {
      const request: CheckRequest = {
        ...createCheckRequest(standardPrincipal, standardResource, ['view']),
        auxData: {
          requestTime: Date.now(),
          sourceIP: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          sessionId: 'sess-123456',
          additionalContext: {
            featureFlags: ['flag1', 'flag2', 'flag3'],
            rateLimit: { current: 50, max: 100 },
          },
        },
      };
      engine.check(request);
    });
  });

  // ---------------------------------------------------------------------------
  // Engine Statistics
  // ---------------------------------------------------------------------------

  describe('Engine Operations', () => {
    bench('get engine stats', () => {
      engine.getStats();
    });

    bench('clear and reload policies', () => {
      const tempEngine = new DecisionEngine();
      tempEngine.loadResourcePolicies([documentPolicy]);
      tempEngine.clearPolicies();
      tempEngine.loadResourcePolicies([documentPolicy]);
    });
  });
});

// =============================================================================
// Baseline Expectations
// =============================================================================

/**
 * BASELINE PERFORMANCE EXPECTATIONS
 *
 * Single Check Latency (Target: <1ms P99):
 * - Simple role check: <0.3ms
 * - CEL condition evaluation: <0.5ms
 * - Multiple actions: <0.8ms
 * - With derived roles: <1ms
 *
 * Batch Throughput:
 * - 10 checks: <5ms
 * - 100 checks: <50ms
 * - 1000 checks: <500ms
 *
 * Decisions per Second:
 * - Simple checks: >10,000/sec
 * - Complex checks: >5,000/sec
 * - With derived roles: >3,000/sec
 *
 * Cache Efficiency:
 * - Same expression repeated: <0.1ms after first
 * - Expression cache hit rate: >90%
 *
 * Policy Load:
 * - 50 policies, 10 rules each: <100ms startup
 * - Memory per policy: <10KB
 */
