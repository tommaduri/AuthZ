/**
 * Performance Benchmark for AuthZ Engine
 */
import { DecisionEngine } from '@authz-engine/core';
import type { Policy, DerivedRolesPolicy } from '@authz-engine/core';

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

async function runBenchmark() {
  const engine = new DecisionEngine();
  engine.loadResourcePolicies([testPolicy as any]);
  engine.loadDerivedRolesPolicies([derivedRoles as any]);

  console.log('\n=== AuthZ Engine Performance Benchmark ===\n');

  // Warm up
  for (let i = 0; i < 100; i++) {
    engine.check({
      principal: { id: 'user-1', roles: ['viewer'] },
      resource: { kind: 'document', id: 'doc-1' },
      actions: ['read'],
    });
  }

  // Single authorization check
  const singleIterations = 10000;
  const singleStart = performance.now();
  for (let i = 0; i < singleIterations; i++) {
    engine.check({
      principal: { id: 'user-1', roles: ['viewer'] },
      resource: { kind: 'document', id: 'doc-' + i },
      actions: ['read'],
    });
  }
  const singleDuration = performance.now() - singleStart;
  const singleAvg = singleDuration / singleIterations;

  console.log('Single Check (' + singleIterations + ' iterations):');
  console.log('  Total time: ' + singleDuration.toFixed(2) + 'ms');
  console.log('  Avg per check: ' + (singleAvg * 1000).toFixed(2) + 'μs');
  console.log('  Throughput: ' + Math.round(singleIterations / (singleDuration / 1000)) + ' checks/sec\n');

  // Multi-action check
  const multiIterations = 5000;
  const multiStart = performance.now();
  for (let i = 0; i < multiIterations; i++) {
    engine.check({
      principal: { id: 'editor-1', roles: ['editor'] },
      resource: { kind: 'document', id: 'doc-' + i },
      actions: ['read', 'write', 'delete'],
    });
  }
  const multiDuration = performance.now() - multiStart;
  const multiAvg = multiDuration / multiIterations;

  console.log('Multi-action Check (' + multiIterations + ' iterations, 3 actions each):');
  console.log('  Total time: ' + multiDuration.toFixed(2) + 'ms');
  console.log('  Avg per check: ' + (multiAvg * 1000).toFixed(2) + 'μs');
  console.log('  Throughput: ' + Math.round(multiIterations / (multiDuration / 1000)) + ' checks/sec\n');

  // Derived roles check
  const derivedIterations = 5000;
  const derivedStart = performance.now();
  for (let i = 0; i < derivedIterations; i++) {
    engine.check({
      principal: { id: 'owner-1', roles: ['user'] },
      resource: { kind: 'document', id: 'doc-' + i, attr: { ownerId: 'owner-1' } },
      actions: ['read', 'write', 'delete'],
    });
  }
  const derivedDuration = performance.now() - derivedStart;
  const derivedAvg = derivedDuration / derivedIterations;

  console.log('Derived Roles Check (' + derivedIterations + ' iterations, CEL evaluation):');
  console.log('  Total time: ' + derivedDuration.toFixed(2) + 'ms');
  console.log('  Avg per check: ' + (derivedAvg * 1000).toFixed(2) + 'μs');
  console.log('  Throughput: ' + Math.round(derivedIterations / (derivedDuration / 1000)) + ' checks/sec\n');

  // Memory usage
  const memUsage = process.memoryUsage();
  console.log('Memory Usage:');
  console.log('  Heap Used: ' + (memUsage.heapUsed / 1024 / 1024).toFixed(2) + ' MB');
  console.log('  Heap Total: ' + (memUsage.heapTotal / 1024 / 1024).toFixed(2) + ' MB');
  console.log('  RSS: ' + (memUsage.rss / 1024 / 1024).toFixed(2) + ' MB\n');

  // Summary
  console.log('=== Summary ===');
  console.log('Simple check latency: ~' + (singleAvg * 1000).toFixed(0) + 'μs (' + Math.round(1000/singleAvg) + 'k/sec)');
  console.log('With derived roles: ~' + (derivedAvg * 1000).toFixed(0) + 'μs (' + Math.round(1000/derivedAvg) + 'k/sec)');
}

runBenchmark().catch(console.error);
