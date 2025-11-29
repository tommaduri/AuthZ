/**
 * Performance Benchmark Tests for AuthZ Engine
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DecisionEngine } from '../src/engine/decision-engine';

describe('AuthZ Engine Performance Benchmark', () => {
  let engine: DecisionEngine;

  // Test policy
  const testPolicy = {
    apiVersion: 'authz.engine/v1' as const,
    kind: 'ResourcePolicy' as const,
    metadata: { name: 'document-access' },
    spec: {
      resource: 'document',
      version: '1.0.0',
      rules: [
        { actions: ['read'], effect: 'ALLOW' as const, roles: ['viewer', 'editor', 'admin'] },
        { actions: ['write'], effect: 'ALLOW' as const, roles: ['editor', 'admin'] },
        { actions: ['delete'], effect: 'ALLOW' as const, roles: ['admin'] },
      ],
    },
  };

  const derivedRoles = {
    apiVersion: 'authz.engine/v1' as const,
    kind: 'DerivedRoles' as const,
    metadata: { name: 'ownership-roles' },
    spec: {
      definitions: [
        {
          name: 'owner',
          parentRoles: ['user'],
          condition: { match: { expr: 'R.attr.ownerId == P.id' } },
        },
      ],
    },
  };

  beforeAll(() => {
    engine = new DecisionEngine();
    engine.loadResourcePolicies([testPolicy as any]);
    engine.loadDerivedRolesPolicies([derivedRoles as any]);

    // Warm up
    for (let i = 0; i < 100; i++) {
      engine.check({
        principal: { id: 'user-1', roles: ['viewer'] },
        resource: { kind: 'document', id: 'doc-1' },
        actions: ['read'],
      });
    }
  });

  it('single authorization check should be < 100μs average', () => {
    const iterations = 10000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      engine.check({
        principal: { id: 'user-1', roles: ['viewer'] },
        resource: { kind: 'document', id: 'doc-' + i },
        actions: ['read'],
      });
    }

    const duration = performance.now() - start;
    const avgMicroseconds = (duration / iterations) * 1000;
    const throughput = Math.round(iterations / (duration / 1000));

    console.log('\n=== Single Check Performance ===');
    console.log(`  Iterations: ${iterations}`);
    console.log(`  Total time: ${duration.toFixed(2)}ms`);
    console.log(`  Avg per check: ${avgMicroseconds.toFixed(2)}μs`);
    console.log(`  Throughput: ${throughput.toLocaleString()} checks/sec`);

    // Assert performance requirement
    expect(avgMicroseconds).toBeLessThan(100); // < 100μs per check
    expect(throughput).toBeGreaterThan(10000); // > 10k checks/sec
  });

  it('multi-action check (3 actions) should be < 150μs average', () => {
    const iterations = 5000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      engine.check({
        principal: { id: 'editor-1', roles: ['editor'] },
        resource: { kind: 'document', id: 'doc-' + i },
        actions: ['read', 'write', 'delete'],
      });
    }

    const duration = performance.now() - start;
    const avgMicroseconds = (duration / iterations) * 1000;
    const throughput = Math.round(iterations / (duration / 1000));

    console.log('\n=== Multi-Action Check Performance ===');
    console.log(`  Iterations: ${iterations} (3 actions each)`);
    console.log(`  Total time: ${duration.toFixed(2)}ms`);
    console.log(`  Avg per check: ${avgMicroseconds.toFixed(2)}μs`);
    console.log(`  Throughput: ${throughput.toLocaleString()} checks/sec`);

    expect(avgMicroseconds).toBeLessThan(150);
    expect(throughput).toBeGreaterThan(5000);
  });

  it('derived roles with CEL evaluation should be < 200μs average', () => {
    const iterations = 5000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      engine.check({
        principal: { id: 'owner-1', roles: ['user'] },
        resource: { kind: 'document', id: 'doc-' + i, attr: { ownerId: 'owner-1' } },
        actions: ['read', 'write', 'delete'],
      });
    }

    const duration = performance.now() - start;
    const avgMicroseconds = (duration / iterations) * 1000;
    const throughput = Math.round(iterations / (duration / 1000));

    console.log('\n=== Derived Roles + CEL Performance ===');
    console.log(`  Iterations: ${iterations} (with CEL evaluation)`);
    console.log(`  Total time: ${duration.toFixed(2)}ms`);
    console.log(`  Avg per check: ${avgMicroseconds.toFixed(2)}μs`);
    console.log(`  Throughput: ${throughput.toLocaleString()} checks/sec`);

    expect(avgMicroseconds).toBeLessThan(200);
    expect(throughput).toBeGreaterThan(5000);
  });

  it('batch authorization (50 principals) should complete in < 100ms', () => {
    const batchSize = 50;
    const start = performance.now();

    const results = [];
    for (let i = 0; i < batchSize; i++) {
      results.push(engine.check({
        principal: { id: `user-${i}`, roles: ['viewer'] },
        resource: { kind: 'document', id: 'shared-doc' },
        actions: ['read'],
      }));
    }

    const duration = performance.now() - start;
    const avgMicroseconds = (duration / batchSize) * 1000;

    console.log('\n=== Batch Authorization Performance ===');
    console.log(`  Batch size: ${batchSize} principals`);
    console.log(`  Total time: ${duration.toFixed(2)}ms`);
    console.log(`  Avg per principal: ${avgMicroseconds.toFixed(2)}μs`);

    expect(duration).toBeLessThan(100);
    expect(results.length).toBe(batchSize);
  });

  it('high-throughput scenario (100k checks) should maintain performance', () => {
    const iterations = 100000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      engine.check({
        principal: { id: 'user-' + (i % 100), roles: ['viewer'] },
        resource: { kind: 'document', id: 'doc-' + (i % 1000) },
        actions: ['read'],
      });
    }

    const duration = performance.now() - start;
    const avgMicroseconds = (duration / iterations) * 1000;
    const throughput = Math.round(iterations / (duration / 1000));

    console.log('\n=== High-Throughput Scenario ===');
    console.log(`  Iterations: ${iterations.toLocaleString()}`);
    console.log(`  Total time: ${duration.toFixed(2)}ms`);
    console.log(`  Avg per check: ${avgMicroseconds.toFixed(2)}μs`);
    console.log(`  Throughput: ${throughput.toLocaleString()} checks/sec`);

    // Even under load, should maintain < 100μs average
    expect(avgMicroseconds).toBeLessThan(100);
    expect(throughput).toBeGreaterThan(10000);
  });

  it('memory usage should be reasonable', () => {
    const memUsage = process.memoryUsage();

    console.log('\n=== Memory Usage ===');
    console.log(`  Heap Used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Heap Total: ${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  RSS: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`);

    // Heap should be under 100MB for this workload
    expect(memUsage.heapUsed / 1024 / 1024).toBeLessThan(100);
  });
});
