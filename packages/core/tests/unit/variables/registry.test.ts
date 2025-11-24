/**
 * @fileoverview Unit tests for ExportRegistry
 * Tests registration, retrieval, and duplicate detection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExportRegistry } from '../../../src/variables/registry';
import type { ExportVariables, ExportConstants } from '../../../src/variables/types';
import { DuplicateExportError } from '../../../src/variables/errors';

describe('ExportRegistry', () => {
  let registry: ExportRegistry;

  beforeEach(() => {
    registry = new ExportRegistry();
  });

  describe('registerVariables', () => {
    it('should register ExportVariables successfully', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'common-vars' },
        spec: {
          name: 'common-vars',
          definitions: {
            isAdmin: 'principal.role === "admin"',
          },
        },
      };

      registry.registerVariables(exportVars);

      expect(registry.has('common-vars')).toBe(true);
      expect(registry.get('common-vars')).toEqual(exportVars);
    });

    it('should register multiple ExportVariables', () => {
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

      expect(registry.has('vars1')).toBe(true);
      expect(registry.has('vars2')).toBe(true);
    });

    it('should throw DuplicateExportError for duplicate variable names', () => {
      const exportVars1: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'duplicate' },
        spec: { name: 'duplicate', definitions: {} },
      };

      const exportVars2: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'duplicate' },
        spec: { name: 'duplicate', definitions: {} },
      };

      registry.registerVariables(exportVars1);

      expect(() => registry.registerVariables(exportVars2)).toThrow(DuplicateExportError);
    });

    it('should register ExportVariables with empty definitions', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'empty' },
        spec: { name: 'empty', definitions: {} },
      };

      registry.registerVariables(exportVars);

      expect(registry.has('empty')).toBe(true);
    });
  });

  describe('registerConstants', () => {
    it('should register ExportConstants successfully', () => {
      const exportConsts: ExportConstants = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants',
        metadata: { name: 'common-consts' },
        spec: {
          name: 'common-consts',
          definitions: {
            maxAttempts: 3,
          },
        },
      };

      registry.registerConstants(exportConsts);

      expect(registry.has('common-consts')).toBe(true);
      expect(registry.get('common-consts')).toEqual(exportConsts);
    });

    it('should register multiple ExportConstants', () => {
      const exportConsts1: ExportConstants = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants',
        metadata: { name: 'consts1' },
        spec: { name: 'consts1', definitions: {} },
      };

      const exportConsts2: ExportConstants = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants',
        metadata: { name: 'consts2' },
        spec: { name: 'consts2', definitions: {} },
      };

      registry.registerConstants(exportConsts1);
      registry.registerConstants(exportConsts2);

      expect(registry.has('consts1')).toBe(true);
      expect(registry.has('consts2')).toBe(true);
    });

    it('should throw DuplicateExportError for duplicate constant names', () => {
      const exportConsts1: ExportConstants = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants',
        metadata: { name: 'duplicate' },
        spec: { name: 'duplicate', definitions: {} },
      };

      const exportConsts2: ExportConstants = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants',
        metadata: { name: 'duplicate' },
        spec: { name: 'duplicate', definitions: {} },
      };

      registry.registerConstants(exportConsts1);

      expect(() => registry.registerConstants(exportConsts2)).toThrow(DuplicateExportError);
    });
  });

  describe('get', () => {
    it('should retrieve registered ExportVariables', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'test-vars' },
        spec: { name: 'test-vars', definitions: {} },
      };

      registry.registerVariables(exportVars);

      expect(registry.get('test-vars')).toEqual(exportVars);
    });

    it('should retrieve registered ExportConstants', () => {
      const exportConsts: ExportConstants = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants',
        metadata: { name: 'test-consts' },
        spec: { name: 'test-consts', definitions: {} },
      };

      registry.registerConstants(exportConsts);

      expect(registry.get('test-consts')).toEqual(exportConsts);
    });

    it('should return undefined for unknown export name', () => {
      expect(registry.get('unknown')).toBeUndefined();
    });

    it('should distinguish between variables and constants with same prefix', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'test-vars' },
        spec: { name: 'test-vars', definitions: {} },
      };

      const exportConsts: ExportConstants = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants',
        metadata: { name: 'test-consts' },
        spec: { name: 'test-consts', definitions: {} },
      };

      registry.registerVariables(exportVars);
      registry.registerConstants(exportConsts);

      expect(registry.get('test-vars')?.kind).toBe('ExportVariables');
      expect(registry.get('test-consts')?.kind).toBe('ExportConstants');
    });
  });

  describe('has', () => {
    it('should return true for registered exports', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'exists' },
        spec: { name: 'exists', definitions: {} },
      };

      registry.registerVariables(exportVars);

      expect(registry.has('exists')).toBe(true);
    });

    it('should return false for unregistered exports', () => {
      expect(registry.has('not-exists')).toBe(false);
    });

    it('should detect both variables and constants', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars' },
        spec: { name: 'vars', definitions: {} },
      };

      const exportConsts: ExportConstants = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants',
        metadata: { name: 'consts' },
        spec: { name: 'consts', definitions: {} },
      };

      registry.registerVariables(exportVars);
      registry.registerConstants(exportConsts);

      expect(registry.has('vars')).toBe(true);
      expect(registry.has('consts')).toBe(true);
    });
  });

  describe('getNames', () => {
    it('should return empty array for empty registry', () => {
      expect(registry.getNames()).toEqual([]);
    });

    it('should return all registered export names', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars' },
        spec: { name: 'vars', definitions: {} },
      };

      const exportConsts: ExportConstants = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants',
        metadata: { name: 'consts' },
        spec: { name: 'consts', definitions: {} },
      };

      registry.registerVariables(exportVars);
      registry.registerConstants(exportConsts);

      const names = registry.getNames();
      expect(names).toContain('vars');
      expect(names).toContain('consts');
      expect(names).toHaveLength(2);
    });

    it('should return names in consistent order', () => {
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

      const names1 = registry.getNames();
      const names2 = registry.getNames();

      expect(names1).toEqual(names2);
    });
  });

  describe('clear', () => {
    it('should clear all registered exports', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars' },
        spec: { name: 'vars', definitions: {} },
      };

      const exportConsts: ExportConstants = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants',
        metadata: { name: 'consts' },
        spec: { name: 'consts', definitions: {} },
      };

      registry.registerVariables(exportVars);
      registry.registerConstants(exportConsts);

      registry.clear();

      expect(registry.has('vars')).toBe(false);
      expect(registry.has('consts')).toBe(false);
      expect(registry.getNames()).toEqual([]);
    });

    it('should allow re-registration after clear', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars' },
        spec: { name: 'vars', definitions: {} },
      };

      registry.registerVariables(exportVars);
      registry.clear();
      registry.registerVariables(exportVars);

      expect(registry.has('vars')).toBe(true);
    });
  });

  describe('cross-namespace conflicts', () => {
    it('should prevent variables and constants with same name', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'conflict' },
        spec: { name: 'conflict', definitions: {} },
      };

      const exportConsts: ExportConstants = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants',
        metadata: { name: 'conflict' },
        spec: { name: 'conflict', definitions: {} },
      };

      registry.registerVariables(exportVars);

      expect(() => registry.registerConstants(exportConsts)).toThrow(DuplicateExportError);
    });

    it('should prevent constants and variables with same name (reverse order)', () => {
      const exportConsts: ExportConstants = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants',
        metadata: { name: 'conflict' },
        spec: { name: 'conflict', definitions: {} },
      };

      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'conflict' },
        spec: { name: 'conflict', definitions: {} },
      };

      registry.registerConstants(exportConsts);

      expect(() => registry.registerVariables(exportVars)).toThrow(DuplicateExportError);
    });
  });
});
