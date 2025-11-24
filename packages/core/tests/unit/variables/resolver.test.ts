/**
 * @fileoverview Unit tests for VariableResolver
 * Tests import resolution, local overrides, and precedence rules
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VariableResolver } from '../../../src/variables/resolver';
import { ExportRegistry } from '../../../src/variables/registry';
import { ExpressionCache } from '../../../src/variables/cache';
import type { ExportVariables, ExportConstants, PolicyVariables } from '../../../src/variables/types';
import { UnknownExportError } from '../../../src/variables/errors';

describe('VariableResolver', () => {
  let registry: ExportRegistry;
  let cache: ExpressionCache;
  let resolver: VariableResolver;

  beforeEach(() => {
    registry = new ExportRegistry();
    cache = new ExpressionCache();
    resolver = new VariableResolver(registry, cache);
  });

  describe('resolve - empty configuration', () => {
    it('should resolve empty PolicyVariables', () => {
      const policyVars: PolicyVariables = {};

      const context = resolver.resolve(policyVars);

      expect(context.variables.size).toBe(0);
      expect(context.constants.size).toBe(0);
      expect(context.resolutionInfo.imports).toEqual([]);
      expect(context.resolutionInfo.localVariables).toEqual([]);
      expect(context.resolutionInfo.overrides).toEqual([]);
      expect(context.resolutionInfo.totalCount).toBe(0);
    });

    it('should handle undefined import', () => {
      const policyVars: PolicyVariables = { import: undefined };

      const context = resolver.resolve(policyVars);

      expect(context.resolutionInfo.imports).toEqual([]);
    });

    it('should handle empty import array', () => {
      const policyVars: PolicyVariables = { import: [] };

      const context = resolver.resolve(policyVars);

      expect(context.resolutionInfo.imports).toEqual([]);
    });
  });

  describe('resolve - import single export', () => {
    it('should import ExportVariables', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'common-vars' },
        spec: {
          name: 'common-vars',
          definitions: {
            isAdmin: 'principal.role === "admin"',
            isOwner: 'resource.ownerId === principal.id',
          },
        },
      };

      registry.registerVariables(exportVars);

      const policyVars: PolicyVariables = {
        import: ['common-vars'],
      };

      const context = resolver.resolve(policyVars);

      expect(context.variables.has('isAdmin')).toBe(true);
      expect(context.variables.has('isOwner')).toBe(true);
      expect(context.variables.get('isAdmin')).toBe('principal.role === "admin"');
      expect(context.resolutionInfo.imports).toEqual(['common-vars']);
      expect(context.resolutionInfo.totalCount).toBe(2);
    });

    it('should import ExportConstants', () => {
      const exportConsts: ExportConstants = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants',
        metadata: { name: 'common-consts' },
        spec: {
          name: 'common-consts',
          definitions: {
            maxAttempts: 3,
            timeout: 5000,
          },
        },
      };

      registry.registerConstants(exportConsts);

      const policyVars: PolicyVariables = {
        import: ['common-consts'],
      };

      const context = resolver.resolve(policyVars);

      expect(context.constants.has('maxAttempts')).toBe(true);
      expect(context.constants.has('timeout')).toBe(true);
      expect(context.constants.get('maxAttempts')).toBe(3);
      expect(context.constants.get('timeout')).toBe(5000);
      expect(context.resolutionInfo.imports).toEqual(['common-consts']);
      expect(context.resolutionInfo.totalCount).toBe(2);
    });

    it('should throw UnknownExportError for non-existent export', () => {
      const policyVars: PolicyVariables = {
        import: ['unknown-export'],
      };

      expect(() => resolver.resolve(policyVars)).toThrow(UnknownExportError);
    });
  });

  describe('resolve - import multiple exports', () => {
    it('should import multiple ExportVariables', () => {
      const exportVars1: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars1' },
        spec: {
          name: 'vars1',
          definitions: {
            check1: 'true',
          },
        },
      };

      const exportVars2: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars2' },
        spec: {
          name: 'vars2',
          definitions: {
            check2: 'false',
          },
        },
      };

      registry.registerVariables(exportVars1);
      registry.registerVariables(exportVars2);

      const policyVars: PolicyVariables = {
        import: ['vars1', 'vars2'],
      };

      const context = resolver.resolve(policyVars);

      expect(context.variables.has('check1')).toBe(true);
      expect(context.variables.has('check2')).toBe(true);
      expect(context.resolutionInfo.imports).toEqual(['vars1', 'vars2']);
    });

    it('should import both variables and constants', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars' },
        spec: {
          name: 'vars',
          definitions: { isAdmin: 'true' },
        },
      };

      const exportConsts: ExportConstants = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants',
        metadata: { name: 'consts' },
        spec: {
          name: 'consts',
          definitions: { maxAttempts: 3 },
        },
      };

      registry.registerVariables(exportVars);
      registry.registerConstants(exportConsts);

      const policyVars: PolicyVariables = {
        import: ['vars', 'consts'],
      };

      const context = resolver.resolve(policyVars);

      expect(context.variables.has('isAdmin')).toBe(true);
      expect(context.constants.has('maxAttempts')).toBe(true);
      expect(context.resolutionInfo.totalCount).toBe(2);
    });

    it('should fail if any import is unknown', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars' },
        spec: { name: 'vars', definitions: {} },
      };

      registry.registerVariables(exportVars);

      const policyVars: PolicyVariables = {
        import: ['vars', 'unknown'],
      };

      expect(() => resolver.resolve(policyVars)).toThrow(UnknownExportError);
    });
  });

  describe('resolve - local variables only', () => {
    it('should resolve local variables', () => {
      const policyVars: PolicyVariables = {
        local: {
          customCheck: 'resource.status === "active"',
        },
      };

      const context = resolver.resolve(policyVars);

      expect(context.variables.has('customCheck')).toBe(true);
      expect(context.variables.get('customCheck')).toBe('resource.status === "active"');
      expect(context.resolutionInfo.localVariables).toEqual(['customCheck']);
      expect(context.resolutionInfo.imports).toEqual([]);
    });

    it('should resolve multiple local variables', () => {
      const policyVars: PolicyVariables = {
        local: {
          check1: 'true',
          check2: 'false',
          check3: 'principal.id === resource.ownerId',
        },
      };

      const context = resolver.resolve(policyVars);

      expect(context.variables.size).toBe(3);
      expect(context.resolutionInfo.localVariables).toHaveLength(3);
    });
  });

  describe('resolve - local overrides imported', () => {
    it('should override imported variable with local variable', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars' },
        spec: {
          name: 'vars',
          definitions: {
            isAdmin: 'principal.role === "admin"',
          },
        },
      };

      registry.registerVariables(exportVars);

      const policyVars: PolicyVariables = {
        import: ['vars'],
        local: {
          isAdmin: 'principal.role === "super-admin"',
        },
      };

      const context = resolver.resolve(policyVars);

      expect(context.variables.get('isAdmin')).toBe('principal.role === "super-admin"');
      expect(context.resolutionInfo.overrides).toEqual(['isAdmin']);
      expect(context.resolutionInfo.localVariables).toEqual(['isAdmin']);
      expect(context.resolutionInfo.imports).toEqual(['vars']);
    });

    it('should override imported constant with local variable', () => {
      const exportConsts: ExportConstants = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants',
        metadata: { name: 'consts' },
        spec: {
          name: 'consts',
          definitions: {
            maxAttempts: 3,
          },
        },
      };

      registry.registerConstants(exportConsts);

      const policyVars: PolicyVariables = {
        import: ['consts'],
        local: {
          maxAttempts: 'context.tier === "premium" ? 10 : 3',
        },
      };

      const context = resolver.resolve(policyVars);

      expect(context.variables.has('maxAttempts')).toBe(true);
      expect(context.constants.has('maxAttempts')).toBe(false);
      expect(context.resolutionInfo.overrides).toEqual(['maxAttempts']);
    });

    it('should track multiple overrides', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars' },
        spec: {
          name: 'vars',
          definitions: {
            check1: 'true',
            check2: 'false',
          },
        },
      };

      registry.registerVariables(exportVars);

      const policyVars: PolicyVariables = {
        import: ['vars'],
        local: {
          check1: 'false',
          check2: 'true',
        },
      };

      const context = resolver.resolve(policyVars);

      expect(context.resolutionInfo.overrides).toHaveLength(2);
      expect(context.resolutionInfo.overrides).toContain('check1');
      expect(context.resolutionInfo.overrides).toContain('check2');
    });

    it('should not mark non-overriding local variables as overrides', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars' },
        spec: {
          name: 'vars',
          definitions: {
            check1: 'true',
          },
        },
      };

      registry.registerVariables(exportVars);

      const policyVars: PolicyVariables = {
        import: ['vars'],
        local: {
          check2: 'false',
        },
      };

      const context = resolver.resolve(policyVars);

      expect(context.resolutionInfo.overrides).toEqual([]);
      expect(context.resolutionInfo.localVariables).toEqual(['check2']);
    });
  });

  describe('resolve - precedence order', () => {
    it('should prioritize local over imported (local > imported)', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars' },
        spec: {
          name: 'vars',
          definitions: {
            value: '"imported"',
          },
        },
      };

      registry.registerVariables(exportVars);

      const policyVars: PolicyVariables = {
        import: ['vars'],
        local: {
          value: '"local"',
        },
      };

      const context = resolver.resolve(policyVars);

      expect(context.variables.get('value')).toBe('"local"');
    });

    it('should handle import order (later imports override earlier)', () => {
      const exportVars1: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars1' },
        spec: {
          name: 'vars1',
          definitions: {
            shared: '"first"',
          },
        },
      };

      const exportVars2: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars2' },
        spec: {
          name: 'vars2',
          definitions: {
            shared: '"second"',
          },
        },
      };

      registry.registerVariables(exportVars1);
      registry.registerVariables(exportVars2);

      const policyVars: PolicyVariables = {
        import: ['vars1', 'vars2'],
      };

      const context = resolver.resolve(policyVars);

      expect(context.variables.get('shared')).toBe('"second"');
    });
  });

  describe('resolve - resolution info', () => {
    it('should track all imports', () => {
      const exportVars1: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars1' },
        spec: { name: 'vars1', definitions: {} },
      };

      const exportVars2: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars2' },
        spec: { name: 'vars2', definitions: {} },
      };

      registry.registerVariables(exportVars1);
      registry.registerVariables(exportVars2);

      const policyVars: PolicyVariables = {
        import: ['vars1', 'vars2'],
      };

      const context = resolver.resolve(policyVars);

      expect(context.resolutionInfo.imports).toEqual(['vars1', 'vars2']);
    });

    it('should track all local variables', () => {
      const policyVars: PolicyVariables = {
        local: {
          var1: 'true',
          var2: 'false',
          var3: 'null',
        },
      };

      const context = resolver.resolve(policyVars);

      expect(context.resolutionInfo.localVariables).toHaveLength(3);
      expect(context.resolutionInfo.localVariables).toContain('var1');
      expect(context.resolutionInfo.localVariables).toContain('var2');
      expect(context.resolutionInfo.localVariables).toContain('var3');
    });

    it('should calculate totalCount correctly', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars' },
        spec: {
          name: 'vars',
          definitions: {
            var1: 'true',
            var2: 'false',
          },
        },
      };

      const exportConsts: ExportConstants = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants',
        metadata: { name: 'consts' },
        spec: {
          name: 'consts',
          definitions: {
            const1: 1,
          },
        },
      };

      registry.registerVariables(exportVars);
      registry.registerConstants(exportConsts);

      const policyVars: PolicyVariables = {
        import: ['vars', 'consts'],
        local: {
          localVar: 'true',
        },
      };

      const context = resolver.resolve(policyVars);

      expect(context.resolutionInfo.totalCount).toBe(4); // 2 vars + 1 const + 1 local
    });

    it('should calculate totalCount with overrides', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars' },
        spec: {
          name: 'vars',
          definitions: {
            var1: 'true',
            var2: 'false',
          },
        },
      };

      registry.registerVariables(exportVars);

      const policyVars: PolicyVariables = {
        import: ['vars'],
        local: {
          var1: 'false', // override
          var3: 'true',  // new
        },
      };

      const context = resolver.resolve(policyVars);

      expect(context.resolutionInfo.totalCount).toBe(3); // var1 (overridden), var2, var3
    });
  });

  describe('validateImports', () => {
    it('should validate known imports', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars' },
        spec: { name: 'vars', definitions: {} },
      };

      registry.registerVariables(exportVars);

      const result = resolver.validateImports(['vars']);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should detect unknown imports', () => {
      const result = resolver.validateImports(['unknown']);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/unknown/i);
    });

    it('should validate multiple imports', () => {
      const exportVars1: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars1' },
        spec: { name: 'vars1', definitions: {} },
      };

      registry.registerVariables(exportVars1);

      const result = resolver.validateImports(['vars1', 'unknown1', 'unknown2']);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });

    it('should handle empty import list', () => {
      const result = resolver.validateImports([]);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('cache integration', () => {
    it('should use cache for expression compilation', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars' },
        spec: {
          name: 'vars',
          definitions: {
            check: 'principal.role === "admin"',
          },
        },
      };

      registry.registerVariables(exportVars);

      const policyVars: PolicyVariables = {
        import: ['vars'],
      };

      resolver.resolve(policyVars);
      resolver.resolve(policyVars);

      const stats = cache.getCacheStats();
      expect(stats.hits).toBeGreaterThan(0);
    });
  });
});
