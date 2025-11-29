/**
 * @fileoverview Performance benchmarks for variables module
 * Validates < 1ms resolution and > 99% cache hit rate requirements
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExportRegistry } from '../../../src/variables/registry';
import { VariableResolver } from '../../../src/variables/resolver';
import { ExpressionCache } from '../../../src/variables/cache';
import type { ExportVariables, ExportConstants, PolicyVariables } from '../../../src/variables/types';

describe('Variables Performance Benchmarks', () => {
  let registry: ExportRegistry;
  let cache: ExpressionCache;
  let resolver: VariableResolver;

  beforeEach(() => {
    registry = new ExportRegistry();
    cache = new ExpressionCache();
    resolver = new VariableResolver(registry, cache);
  });

  describe('NFR-EV-001: Variable resolution time < 1ms', () => {
    it('should resolve typical policy variables in < 1ms', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'common' },
        spec: {
          name: 'common',
          definitions: {
            isAdmin: 'principal.role === "admin"',
            isOwner: 'resource.ownerId === principal.id',
            isActive: 'resource.status === "active"',
          },
        },
      };

      registry.registerVariables(exportVars);

      const policyVars: PolicyVariables = {
        import: ['common'],
        local: {
          canEdit: 'isAdmin || isOwner',
        },
      };

      const startTime = performance.now();
      resolver.resolve(policyVars);
      const endTime = performance.now();

      const duration = endTime - startTime;
      expect(duration).toBeLessThan(1);

      console.log(`Resolution time: ${duration.toFixed(3)}ms`);
    });

    it('should resolve with 10 imports in < 1ms', () => {
      for (let i = 0; i < 10; i++) {
        const exportVars: ExportVariables = {
          apiVersion: 'authz.engine/v1',
          kind: 'ExportVariables',
          metadata: { name: `export${i}` },
          spec: {
            name: `export${i}`,
            definitions: {
              [`check${i}`]: `principal.id === "user${i}"`,
            },
          },
        };
        registry.registerVariables(exportVars);
      }

      const policyVars: PolicyVariables = {
        import: Array.from({ length: 10 }, (_, i) => `export${i}`),
      };

      const startTime = performance.now();
      resolver.resolve(policyVars);
      const endTime = performance.now();

      const duration = endTime - startTime;
      expect(duration).toBeLessThan(1);

      console.log(`Resolution with 10 imports: ${duration.toFixed(3)}ms`);
    });

    it('should resolve with cache warmed in < 0.1ms', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'common' },
        spec: {
          name: 'common',
          definitions: {
            check1: 'true',
            check2: 'false',
          },
        },
      };

      registry.registerVariables(exportVars);

      const policyVars: PolicyVariables = {
        import: ['common'],
      };

      // Warm cache
      resolver.resolve(policyVars);

      // Measure cached resolution
      const startTime = performance.now();
      resolver.resolve(policyVars);
      const endTime = performance.now();

      const duration = endTime - startTime;
      expect(duration).toBeLessThan(0.1);

      console.log(`Cached resolution time: ${duration.toFixed(4)}ms`);
    });
  });

  describe('NFR-EV-002: Cache hit rate > 99%', () => {
    it('should achieve > 99% cache hit rate in typical usage', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'common' },
        spec: {
          name: 'common',
          definitions: {
            isAdmin: 'principal.role === "admin"',
            isOwner: 'resource.ownerId === principal.id',
            isActive: 'resource.status === "active"',
          },
        },
      };

      registry.registerVariables(exportVars);

      const policyVars: PolicyVariables = {
        import: ['common'],
      };

      // Simulate 1000 policy evaluations
      for (let i = 0; i < 1000; i++) {
        resolver.resolve(policyVars);
      }

      const stats = cache.getCacheStats();
      expect(stats.hitRate).toBeGreaterThan(0.99);

      console.log(`Cache hit rate: ${(stats.hitRate * 100).toFixed(2)}%`);
      console.log(`Hits: ${stats.hits}, Misses: ${stats.misses}`);
    });

    it('should achieve 99.5%+ hit rate with multiple policies', () => {
      const commonVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'common' },
        spec: {
          name: 'common',
          definitions: {
            isAdmin: 'principal.role === "admin"',
            isOwner: 'resource.ownerId === principal.id',
          },
        },
      };

      registry.registerVariables(commonVars);

      // Three different policy configurations
      const policy1: PolicyVariables = {
        import: ['common'],
        local: { check1: 'true' },
      };

      const policy2: PolicyVariables = {
        import: ['common'],
        local: { check2: 'false' },
      };

      const policy3: PolicyVariables = {
        import: ['common'],
      };

      // Simulate realistic usage pattern
      for (let i = 0; i < 500; i++) {
        resolver.resolve(policy1);
        resolver.resolve(policy2);
        resolver.resolve(policy3);
      }

      const stats = cache.getCacheStats();
      expect(stats.hitRate).toBeGreaterThanOrEqual(0.995);

      console.log(`Multi-policy cache hit rate: ${(stats.hitRate * 100).toFixed(2)}%`);
    });
  });

  describe('NFR-EV-003: Max 100 exported definitions per file', () => {
    it('should handle max 100 definitions efficiently', () => {
      const definitions: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        definitions[`var${i}`] = `principal.attr${i} === "value${i}"`;
      }

      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'maxdefs' },
        spec: {
          name: 'maxdefs',
          definitions,
        },
      };

      registry.registerVariables(exportVars);

      const policyVars: PolicyVariables = {
        import: ['maxdefs'],
      };

      const startTime = performance.now();
      const context = resolver.resolve(policyVars);
      const endTime = performance.now();

      const duration = endTime - startTime;
      expect(duration).toBeLessThan(5); // Allow 5ms for 100 definitions
      expect(context.resolutionInfo.totalCount).toBe(100);

      console.log(`Resolution of 100 definitions: ${duration.toFixed(3)}ms`);
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle complex enterprise policy in < 1ms', () => {
      // Setup enterprise-scale exports
      const roleChecks: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'role-checks' },
        spec: {
          name: 'role-checks',
          definitions: {
            isAdmin: 'principal.role === "admin"',
            isManager: 'principal.role === "manager"',
            isUser: 'principal.role === "user"',
          },
        },
      };

      const ownershipChecks: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'ownership' },
        spec: {
          name: 'ownership',
          definitions: {
            isOwner: 'resource.ownerId === principal.id',
            isCreator: 'resource.createdBy === principal.id',
          },
        },
      };

      const limits: ExportConstants = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants',
        metadata: { name: 'limits' },
        spec: {
          name: 'limits',
          definitions: {
            maxSize: 1000000,
            maxCount: 100,
          },
        },
      };

      registry.registerVariables(roleChecks);
      registry.registerVariables(ownershipChecks);
      registry.registerConstants(limits);

      const policyVars: PolicyVariables = {
        import: ['role-checks', 'ownership', 'limits'],
        local: {
          canEdit: 'isAdmin || (isManager && isOwner)',
          canDelete: 'isAdmin || isOwner',
          withinLimits: 'resource.size < maxSize && resource.count < maxCount',
        },
      };

      const startTime = performance.now();
      resolver.resolve(policyVars);
      const endTime = performance.now();

      const duration = endTime - startTime;
      expect(duration).toBeLessThan(1);

      console.log(`Complex enterprise policy: ${duration.toFixed(3)}ms`);
    });

    it('should measure throughput: resolutions per second', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'common' },
        spec: {
          name: 'common',
          definitions: {
            check1: 'principal.role === "admin"',
            check2: 'resource.status === "active"',
          },
        },
      };

      registry.registerVariables(exportVars);

      const policyVars: PolicyVariables = {
        import: ['common'],
      };

      // Warm cache
      resolver.resolve(policyVars);

      // Measure throughput
      const iterations = 10000;
      const startTime = performance.now();

      for (let i = 0; i < iterations; i++) {
        resolver.resolve(policyVars);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;
      const throughput = (iterations / duration) * 1000;

      console.log(`\nThroughput: ${throughput.toFixed(0)} resolutions/sec`);
      console.log(`Average time per resolution: ${(duration / iterations).toFixed(4)}ms`);

      expect(duration / iterations).toBeLessThan(1);
    });
  });
});
