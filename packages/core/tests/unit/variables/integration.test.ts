/**
 * @fileoverview Integration tests for variables module
 * Tests full workflow with DecisionEngine integration
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExportRegistry } from '../../../src/variables/registry';
import { VariableResolver } from '../../../src/variables/resolver';
import { ExpressionCache } from '../../../src/variables/cache';
import type { ExportVariables, ExportConstants, PolicyVariables } from '../../../src/variables/types';

describe('Variables Integration', () => {
  let registry: ExportRegistry;
  let cache: ExpressionCache;
  let resolver: VariableResolver;

  beforeEach(() => {
    registry = new ExportRegistry();
    cache = new ExpressionCache();
    resolver = new VariableResolver(registry, cache);
  });

  describe('end-to-end variable resolution', () => {
    it('should support complete workflow: register -> resolve -> use', () => {
      // Step 1: Register exports
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'auth-checks' },
        spec: {
          name: 'auth-checks',
          definitions: {
            isAdmin: 'principal.role === "admin"',
            isOwner: 'resource.ownerId === principal.id',
          },
        },
      };

      const exportConsts: ExportConstants = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants',
        metadata: { name: 'limits' },
        spec: {
          name: 'limits',
          definitions: {
            maxAttempts: 3,
            timeout: 5000,
          },
        },
      };

      registry.registerVariables(exportVars);
      registry.registerConstants(exportConsts);

      // Step 2: Resolve for policy
      const policyVars: PolicyVariables = {
        import: ['auth-checks', 'limits'],
        local: {
          isActive: 'resource.status === "active"',
        },
      };

      const context = resolver.resolve(policyVars);

      // Step 3: Verify resolution
      expect(context.variables.has('isAdmin')).toBe(true);
      expect(context.variables.has('isOwner')).toBe(true);
      expect(context.variables.has('isActive')).toBe(true);
      expect(context.constants.has('maxAttempts')).toBe(true);
      expect(context.constants.has('timeout')).toBe(true);
      expect(context.resolutionInfo.totalCount).toBe(5);
    });

    it('should support multiple policies sharing exports', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'common' },
        spec: {
          name: 'common',
          definitions: {
            isAdmin: 'principal.role === "admin"',
          },
        },
      };

      registry.registerVariables(exportVars);

      // Policy 1
      const policy1Vars: PolicyVariables = {
        import: ['common'],
        local: { check1: 'true' },
      };

      const context1 = resolver.resolve(policy1Vars);

      // Policy 2
      const policy2Vars: PolicyVariables = {
        import: ['common'],
        local: { check2: 'false' },
      };

      const context2 = resolver.resolve(policy2Vars);

      // Both should have isAdmin
      expect(context1.variables.has('isAdmin')).toBe(true);
      expect(context2.variables.has('isAdmin')).toBe(true);

      // Each should have their own local
      expect(context1.variables.has('check1')).toBe(true);
      expect(context1.variables.has('check2')).toBe(false);
      expect(context2.variables.has('check2')).toBe(true);
      expect(context2.variables.has('check1')).toBe(false);
    });

    it('should demonstrate cache effectiveness across multiple resolutions', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars' },
        spec: {
          name: 'vars',
          definitions: {
            check1: 'principal.role === "admin"',
            check2: 'resource.status === "active"',
          },
        },
      };

      registry.registerVariables(exportVars);

      const policyVars: PolicyVariables = {
        import: ['vars'],
      };

      // Resolve 100 times (simulating policy evaluations)
      for (let i = 0; i < 100; i++) {
        resolver.resolve(policyVars);
      }

      const stats = cache.getCacheStats();
      expect(stats.hitRate).toBeGreaterThanOrEqual(0.99);
    });
  });

  describe('realistic policy scenarios', () => {
    it('should handle resource policy with role checks', () => {
      const roleChecks: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'role-checks' },
        spec: {
          name: 'role-checks',
          definitions: {
            isAdmin: 'principal.role === "admin"',
            isEditor: 'principal.role === "editor"',
            isViewer: 'principal.role === "viewer"',
          },
        },
      };

      registry.registerVariables(roleChecks);

      const policyVars: PolicyVariables = {
        import: ['role-checks'],
        local: {
          canEdit: 'isAdmin || isEditor',
          canView: 'isAdmin || isEditor || isViewer',
        },
      };

      const context = resolver.resolve(policyVars);

      expect(context.variables.has('isAdmin')).toBe(true);
      expect(context.variables.has('canEdit')).toBe(true);
      expect(context.variables.has('canView')).toBe(true);
    });

    it('should handle principal policy with constants', () => {
      const limits: ExportConstants = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants',
        metadata: { name: 'rate-limits' },
        spec: {
          name: 'rate-limits',
          definitions: {
            maxRequestsPerMinute: 60,
            maxRequestsPerHour: 1000,
          },
        },
      };

      registry.registerConstants(limits);

      const policyVars: PolicyVariables = {
        import: ['rate-limits'],
        local: {
          withinLimits: 'resource.requestCount < maxRequestsPerMinute',
        },
      };

      const context = resolver.resolve(policyVars);

      expect(context.constants.get('maxRequestsPerMinute')).toBe(60);
      expect(context.variables.has('withinLimits')).toBe(true);
    });

    it('should handle derived policy with custom overrides', () => {
      const baseChecks: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'base-checks' },
        spec: {
          name: 'base-checks',
          definitions: {
            isOwner: 'resource.ownerId === principal.id',
            isPublic: 'resource.visibility === "public"',
          },
        },
      };

      registry.registerVariables(baseChecks);

      // Derived policy overrides isOwner check
      const policyVars: PolicyVariables = {
        import: ['base-checks'],
        local: {
          isOwner: 'resource.ownerId === principal.id || resource.createdBy === principal.id',
          canAccess: 'isOwner || isPublic',
        },
      };

      const context = resolver.resolve(policyVars);

      expect(context.resolutionInfo.overrides).toContain('isOwner');
      expect(context.variables.get('isOwner')).toContain('createdBy');
    });
  });

  describe('complex multi-export scenarios', () => {
    it('should handle multiple imports with overlapping names', () => {
      const export1: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'export1' },
        spec: {
          name: 'export1',
          definitions: {
            shared: '"from-export1"',
            unique1: 'true',
          },
        },
      };

      const export2: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'export2' },
        spec: {
          name: 'export2',
          definitions: {
            shared: '"from-export2"',
            unique2: 'false',
          },
        },
      };

      registry.registerVariables(export1);
      registry.registerVariables(export2);

      const policyVars: PolicyVariables = {
        import: ['export1', 'export2'],
      };

      const context = resolver.resolve(policyVars);

      // Later import wins
      expect(context.variables.get('shared')).toBe('"from-export2"');
      expect(context.variables.has('unique1')).toBe(true);
      expect(context.variables.has('unique2')).toBe(true);
    });

    it('should handle hierarchical imports (base + specialized)', () => {
      const baseVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'base' },
        spec: {
          name: 'base',
          definitions: {
            isAuthenticated: 'principal.id !== null',
            hasRole: 'principal.role !== null',
          },
        },
      };

      const specializedVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'specialized' },
        spec: {
          name: 'specialized',
          definitions: {
            isAdmin: 'hasRole && principal.role === "admin"',
            isPremium: 'principal.tier === "premium"',
          },
        },
      };

      registry.registerVariables(baseVars);
      registry.registerVariables(specializedVars);

      const policyVars: PolicyVariables = {
        import: ['base', 'specialized'],
      };

      const context = resolver.resolve(policyVars);

      expect(context.variables.has('isAuthenticated')).toBe(true);
      expect(context.variables.has('hasRole')).toBe(true);
      expect(context.variables.has('isAdmin')).toBe(true);
      expect(context.variables.has('isPremium')).toBe(true);
      expect(context.resolutionInfo.totalCount).toBe(4);
    });

    it('should handle mixed variables and constants with overrides', () => {
      const vars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars' },
        spec: {
          name: 'vars',
          definitions: {
            threshold: '100',
          },
        },
      };

      const consts: ExportConstants = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants',
        metadata: { name: 'consts' },
        spec: {
          name: 'consts',
          definitions: {
            maxValue: 1000,
          },
        },
      };

      registry.registerVariables(vars);
      registry.registerConstants(consts);

      const policyVars: PolicyVariables = {
        import: ['vars', 'consts'],
        local: {
          threshold: '200', // override variable
          maxValue: 'context.tier === "premium" ? 5000 : 1000', // override constant
        },
      };

      const context = resolver.resolve(policyVars);

      expect(context.variables.get('threshold')).toBe('200');
      expect(context.variables.get('maxValue')).toContain('premium');
      expect(context.constants.size).toBe(0); // maxValue moved to variables
      expect(context.resolutionInfo.overrides).toHaveLength(2);
    });
  });

  describe('performance benchmarks', () => {
    it('should resolve variables in < 1ms for typical policy', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars' },
        spec: {
          name: 'vars',
          definitions: {
            check1: 'true',
            check2: 'false',
            check3: 'null',
          },
        },
      };

      registry.registerVariables(exportVars);

      const policyVars: PolicyVariables = {
        import: ['vars'],
        local: { customCheck: 'true' },
      };

      const startTime = performance.now();
      resolver.resolve(policyVars);
      const endTime = performance.now();

      const duration = endTime - startTime;
      expect(duration).toBeLessThan(1);
    });

    it('should maintain < 1ms resolution with cache warming', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars' },
        spec: {
          name: 'vars',
          definitions: {
            check1: 'principal.role === "admin"',
            check2: 'resource.status === "active"',
          },
        },
      };

      registry.registerVariables(exportVars);

      const policyVars: PolicyVariables = {
        import: ['vars'],
      };

      // Warm cache
      resolver.resolve(policyVars);

      // Measure subsequent resolutions
      const durations: number[] = [];
      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        resolver.resolve(policyVars);
        const end = performance.now();
        durations.push(end - start);
      }

      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
      expect(avgDuration).toBeLessThan(1);
    });
  });

  describe('error handling and edge cases', () => {
    it('should provide clear error for unknown import', () => {
      const policyVars: PolicyVariables = {
        import: ['unknown-export'],
      };

      expect(() => resolver.resolve(policyVars)).toThrow(/unknown/i);
    });

    it('should handle empty export definitions', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'empty' },
        spec: {
          name: 'empty',
          definitions: {},
        },
      };

      registry.registerVariables(exportVars);

      const policyVars: PolicyVariables = {
        import: ['empty'],
      };

      const context = resolver.resolve(policyVars);

      expect(context.resolutionInfo.totalCount).toBe(0);
    });

    it('should handle policy with only imports (no locals)', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars' },
        spec: {
          name: 'vars',
          definitions: { check: 'true' },
        },
      };

      registry.registerVariables(exportVars);

      const policyVars: PolicyVariables = {
        import: ['vars'],
      };

      const context = resolver.resolve(policyVars);

      expect(context.resolutionInfo.localVariables).toEqual([]);
      expect(context.resolutionInfo.overrides).toEqual([]);
    });

    it('should handle policy with only locals (no imports)', () => {
      const policyVars: PolicyVariables = {
        local: { check: 'true' },
      };

      const context = resolver.resolve(policyVars);

      expect(context.resolutionInfo.imports).toEqual([]);
      expect(context.resolutionInfo.localVariables).toEqual(['check']);
    });
  });
});
