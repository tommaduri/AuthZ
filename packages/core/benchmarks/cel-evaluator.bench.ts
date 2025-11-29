/**
 * CEL Evaluator Performance Benchmarks
 *
 * Comprehensive benchmarks for the CEL expression evaluator measuring:
 * - Expression parsing speed
 * - Condition evaluation throughput
 * - Memory usage per evaluation
 * - Cache hit/miss performance
 *
 * Target metrics:
 * - Parse simple expression: <0.5ms
 * - Evaluate cached expression: <0.1ms
 * - Cache hit rate: >95% in steady state
 */

import { describe, bench, beforeAll, afterAll } from 'vitest';
import { CelEvaluator, type EvaluationContext } from '../src/cel/evaluator.js';
import type { Principal, Resource } from '../src/types/index.js';

// =============================================================================
// Test Data Setup
// =============================================================================

const simplePrincipal: Principal = {
  id: 'user-123',
  roles: ['user', 'editor'],
  attributes: {
    email: 'user@example.com',
    department: 'engineering',
    level: 5,
    isActive: true,
  },
};

const complexPrincipal: Principal = {
  id: 'admin-456',
  roles: ['admin', 'super-admin', 'user', 'moderator', 'auditor'],
  attributes: {
    email: 'admin@example.com',
    department: 'operations',
    level: 10,
    isActive: true,
    permissions: ['read', 'write', 'delete', 'admin'],
    regions: ['us-east', 'us-west', 'eu-west'],
    metadata: {
      lastLogin: '2024-01-15T10:00:00Z',
      createdAt: '2020-01-01T00:00:00Z',
      mfaEnabled: true,
    },
  },
};

const simpleResource: Resource = {
  kind: 'document',
  id: 'doc-001',
  attributes: {
    ownerId: 'user-123',
    visibility: 'private',
  },
};

const complexResource: Resource = {
  kind: 'project',
  id: 'proj-001',
  attributes: {
    ownerId: 'admin-456',
    visibility: 'restricted',
    department: 'engineering',
    teamMemberIds: ['user-123', 'user-456', 'user-789', 'admin-456'],
    tags: ['confidential', 'q1-2024', 'priority-high'],
    budget: 100000,
    createdAt: '2024-01-01T00:00:00Z',
    metadata: {
      status: 'active',
      phase: 'development',
      milestones: [
        { name: 'planning', completed: true },
        { name: 'design', completed: true },
        { name: 'implementation', completed: false },
      ],
    },
  },
};

// CEL Expressions of varying complexity
const expressions = {
  // Simple expressions
  trueLiteral: 'true',
  falseLiteral: 'false',
  simpleEquality: 'principal.id == "user-123"',
  roleCheck: '"user" in principal.roles',

  // Medium complexity
  ownerCheck: 'resource.ownerId == principal.id',
  multipleConditions: 'principal.level >= 5 && principal.isActive == true',
  roleAndAttribute: '"admin" in principal.roles || principal.level >= 10',

  // Complex expressions
  complexOwnership: 'resource.ownerId == principal.id || principal.id in resource.teamMemberIds',
  departmentMatch: 'principal.department == resource.department && principal.isActive == true',
  nestedAccess: 'principal.level >= 5 && resource.budget <= 100000',
  multiRoleCheck: '"admin" in principal.roles || "super-admin" in principal.roles || "moderator" in principal.roles',

  // Very complex expressions
  fullAuthCheck: `
    (resource.ownerId == principal.id) ||
    ("admin" in principal.roles) ||
    (principal.id in resource.teamMemberIds && principal.isActive == true)
  `,
  conditionalVisibility: `
    (resource.visibility == "public") ||
    (resource.visibility == "private" && resource.ownerId == principal.id) ||
    (resource.visibility == "restricted" && "admin" in principal.roles)
  `,
};

// =============================================================================
// Benchmark Suites
// =============================================================================

describe('CEL Evaluator Benchmarks', () => {
  let evaluator: CelEvaluator;
  let evaluatorNoCaching: CelEvaluator;
  let context: EvaluationContext;
  let complexContext: EvaluationContext;

  beforeAll(() => {
    evaluator = new CelEvaluator({ maxCacheSize: 1000, cacheTtlMs: 3600000 });
    evaluatorNoCaching = new CelEvaluator({ maxCacheSize: 0 });

    context = {
      principal: simplePrincipal,
      resource: simpleResource,
    };

    complexContext = {
      principal: complexPrincipal,
      resource: complexResource,
    };
  });

  afterAll(() => {
    const stats = evaluator.getCacheStats();
    console.log('\n--- Cache Statistics ---');
    console.log(`Cache size: ${stats.size}`);
    console.log(`Cache hits: ${stats.hits}`);
    console.log(`Cache misses: ${stats.misses}`);
    console.log(`Hit rate: ${stats.hitRate.toFixed(2)}%`);
  });

  // ---------------------------------------------------------------------------
  // Expression Parsing Benchmarks
  // ---------------------------------------------------------------------------

  describe('Expression Parsing Speed', () => {
    bench('parse true literal', () => {
      evaluatorNoCaching.evaluate(expressions.trueLiteral, context);
    });

    bench('parse simple equality', () => {
      evaluatorNoCaching.evaluate(expressions.simpleEquality, context);
    });

    bench('parse role check', () => {
      evaluatorNoCaching.evaluate(expressions.roleCheck, context);
    });

    bench('parse owner check', () => {
      evaluatorNoCaching.evaluate(expressions.ownerCheck, context);
    });

    bench('parse complex ownership', () => {
      evaluatorNoCaching.evaluate(expressions.complexOwnership, complexContext);
    });

    bench('parse full auth check', () => {
      evaluatorNoCaching.evaluate(expressions.fullAuthCheck, complexContext);
    });

    bench('validate expression (no evaluation)', () => {
      evaluatorNoCaching.validateExpression(expressions.complexOwnership);
    });
  });

  // ---------------------------------------------------------------------------
  // Cached Evaluation Benchmarks (Primary Performance Target)
  // ---------------------------------------------------------------------------

  describe('Cached Evaluation Throughput', () => {
    // Pre-compile expressions for cache benchmarks
    beforeAll(() => {
      Object.values(expressions).forEach(expr => {
        evaluator.compileExpression(expr);
      });
    });

    bench('evaluate true literal (cached)', () => {
      evaluator.evaluateBoolean(expressions.trueLiteral, context);
    });

    bench('evaluate simple equality (cached)', () => {
      evaluator.evaluateBoolean(expressions.simpleEquality, context);
    });

    bench('evaluate role check (cached)', () => {
      evaluator.evaluateBoolean(expressions.roleCheck, context);
    });

    bench('evaluate owner check (cached)', () => {
      evaluator.evaluateBoolean(expressions.ownerCheck, context);
    });

    bench('evaluate multiple conditions (cached)', () => {
      evaluator.evaluateBoolean(expressions.multipleConditions, context);
    });

    bench('evaluate complex ownership (cached)', () => {
      evaluator.evaluateBoolean(expressions.complexOwnership, complexContext);
    });

    bench('evaluate department match (cached)', () => {
      evaluator.evaluateBoolean(expressions.departmentMatch, complexContext);
    });

    bench('evaluate multi-role check (cached)', () => {
      evaluator.evaluateBoolean(expressions.multiRoleCheck, complexContext);
    });

    bench('evaluate full auth check (cached)', () => {
      evaluator.evaluateBoolean(expressions.fullAuthCheck, complexContext);
    });

    bench('evaluate conditional visibility (cached)', () => {
      evaluator.evaluateBoolean(expressions.conditionalVisibility, complexContext);
    });
  });

  // ---------------------------------------------------------------------------
  // Cache Performance Benchmarks
  // ---------------------------------------------------------------------------

  describe('Cache Hit/Miss Performance', () => {
    bench('cold cache - first evaluation', () => {
      const uniqueEvaluator = new CelEvaluator();
      uniqueEvaluator.evaluateBoolean(expressions.ownerCheck, context);
    });

    bench('warm cache - repeated evaluation', () => {
      evaluator.evaluateBoolean(expressions.ownerCheck, context);
    });

    bench('mixed workload (80% hits)', () => {
      const rand = Math.random();
      if (rand < 0.8) {
        evaluator.evaluateBoolean(expressions.ownerCheck, context);
      } else {
        evaluator.evaluateBoolean(`principal.id == "user-${Math.random()}"`, context);
      }
    });

    bench('cache eviction scenario', () => {
      const smallCacheEvaluator = new CelEvaluator({ maxCacheSize: 10 });
      for (let i = 0; i < 15; i++) {
        smallCacheEvaluator.evaluateBoolean(`principal.level >= ${i}`, context);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Throughput Benchmarks
  // ---------------------------------------------------------------------------

  describe('Evaluation Throughput', () => {
    bench('100 sequential evaluations (same expression)', () => {
      for (let i = 0; i < 100; i++) {
        evaluator.evaluateBoolean(expressions.ownerCheck, context);
      }
    });

    bench('100 sequential evaluations (varied expressions)', () => {
      const exprList = Object.values(expressions);
      for (let i = 0; i < 100; i++) {
        evaluator.evaluateBoolean(exprList[i % exprList.length], context);
      }
    });

    bench('batch evaluation (10 different expressions)', () => {
      const exprList = Object.values(expressions).slice(0, 10);
      exprList.forEach(expr => {
        evaluator.evaluateBoolean(expr, context);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Memory Usage Benchmarks
  // ---------------------------------------------------------------------------

  describe('Memory Usage', () => {
    bench('single evaluation memory', () => {
      const freshEvaluator = new CelEvaluator();
      freshEvaluator.evaluateBoolean(expressions.fullAuthCheck, complexContext);
    });

    bench('build context overhead', () => {
      const ctx: EvaluationContext = {
        principal: { ...complexPrincipal },
        resource: { ...complexResource },
        now: new Date(),
      };
      evaluator.evaluateBoolean(expressions.trueLiteral, ctx);
    });

    bench('large attribute handling', () => {
      const largeResource: Resource = {
        kind: 'collection',
        id: 'col-001',
        attributes: {
          items: Array.from({ length: 100 }, (_, i) => ({ id: i, value: `item-${i}` })),
          metadata: Array.from({ length: 50 }, (_, i) => ({ key: `key-${i}`, val: `val-${i}` })),
        },
      };
      const largeCtx: EvaluationContext = {
        principal: simplePrincipal,
        resource: largeResource,
      };
      evaluator.evaluateBoolean(expressions.trueLiteral, largeCtx);
    });
  });

  // ---------------------------------------------------------------------------
  // Error Handling Performance
  // ---------------------------------------------------------------------------

  describe('Error Handling Performance', () => {
    bench('invalid expression handling', () => {
      evaluator.evaluate('this is not valid CEL !!!', context);
    });

    bench('validation of invalid expression', () => {
      evaluator.validateExpression('invalid ( syntax');
    });

    bench('missing attribute handling (fail-closed)', () => {
      evaluator.evaluateBoolean('principal.nonexistent == "value"', context);
    });
  });

  // ---------------------------------------------------------------------------
  // Custom Functions Performance
  // ---------------------------------------------------------------------------

  describe('Custom Functions Performance', () => {
    bench('startsWith function', () => {
      evaluator.evaluateBoolean('startsWith(principal.email, "user")', context);
    });

    bench('contains function', () => {
      evaluator.evaluateBoolean('contains(principal.email, "@")', context);
    });

    bench('size function on array', () => {
      evaluator.evaluateBoolean('size(principal.roles) > 0', context);
    });

    bench('type function', () => {
      evaluator.evaluateBoolean('type(principal.level) == "number"', context);
    });
  });
});

// =============================================================================
// Baseline Expectations
// =============================================================================

/**
 * BASELINE PERFORMANCE EXPECTATIONS
 *
 * These are target metrics based on authorization engine requirements:
 *
 * Expression Parsing (cold cache):
 * - Simple expressions: <0.5ms
 * - Medium complexity: <1ms
 * - Complex expressions: <2ms
 *
 * Cached Evaluation (warm cache):
 * - Simple expressions: <0.05ms (50 microseconds)
 * - Medium complexity: <0.1ms
 * - Complex expressions: <0.2ms
 *
 * Throughput Targets:
 * - Single expression: >20,000 evaluations/sec (cached)
 * - Varied expressions: >10,000 evaluations/sec
 *
 * Cache Performance:
 * - Hit rate in steady state: >95%
 * - Cache miss penalty: <2x cached evaluation time
 *
 * Memory Usage:
 * - Per-evaluation overhead: <1KB
 * - Cache overhead per expression: <5KB
 */
