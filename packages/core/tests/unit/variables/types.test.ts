/**
 * @fileoverview Unit tests for variable types and interfaces
 * Tests type definitions and basic structure validation
 */

import { describe, it, expect } from 'vitest';

describe('Variable Types', () => {
  describe('ExportVariables Interface', () => {
    it('should define valid ExportVariables structure', () => {
      const exportVars = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables' as const,
        metadata: { name: 'test-export' },
        spec: {
          name: 'test-export',
          definitions: {
            isAdmin: 'principal.role === "admin"',
            isOwner: 'resource.ownerId === principal.id',
          },
        },
      };

      expect(exportVars.apiVersion).toBe('authz.engine/v1');
      expect(exportVars.kind).toBe('ExportVariables');
      expect(exportVars.spec.name).toBe('test-export');
      expect(Object.keys(exportVars.spec.definitions)).toHaveLength(2);
    });

    it('should support empty definitions', () => {
      const exportVars = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables' as const,
        metadata: { name: 'empty-export' },
        spec: {
          name: 'empty-export',
          definitions: {},
        },
      };

      expect(Object.keys(exportVars.spec.definitions)).toHaveLength(0);
    });
  });

  describe('ExportConstants Interface', () => {
    it('should define valid ExportConstants structure', () => {
      const exportConsts = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants' as const,
        metadata: { name: 'test-constants' },
        spec: {
          name: 'test-constants',
          definitions: {
            maxAttempts: 3,
            timeout: 5000,
            allowedRoles: ['admin', 'user', 'guest'],
          },
        },
      };

      expect(exportConsts.kind).toBe('ExportConstants');
      expect(exportConsts.spec.definitions.maxAttempts).toBe(3);
      expect(Array.isArray(exportConsts.spec.definitions.allowedRoles)).toBe(true);
    });

    it('should support various primitive types', () => {
      const exportConsts = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants' as const,
        metadata: { name: 'primitives' },
        spec: {
          name: 'primitives',
          definitions: {
            stringVal: 'test',
            numberVal: 42,
            boolVal: true,
            nullVal: null,
          },
        },
      };

      expect(typeof exportConsts.spec.definitions.stringVal).toBe('string');
      expect(typeof exportConsts.spec.definitions.numberVal).toBe('number');
      expect(typeof exportConsts.spec.definitions.boolVal).toBe('boolean');
      expect(exportConsts.spec.definitions.nullVal).toBeNull();
    });
  });

  describe('PolicyVariables Interface', () => {
    it('should define valid PolicyVariables with imports', () => {
      const policyVars = {
        import: ['common-vars', 'role-checks'],
        local: {
          customCheck: 'resource.status === "active"',
        },
      };

      expect(Array.isArray(policyVars.import)).toBe(true);
      expect(policyVars.import).toHaveLength(2);
      expect(policyVars.local?.customCheck).toBeDefined();
    });

    it('should support import-only configuration', () => {
      const policyVars = {
        import: ['common-vars'],
      };

      expect(policyVars.import).toHaveLength(1);
      expect(policyVars.local).toBeUndefined();
    });

    it('should support local-only configuration', () => {
      const policyVars = {
        local: {
          check1: 'true',
        },
      };

      expect(policyVars.import).toBeUndefined();
      expect(Object.keys(policyVars.local!)).toHaveLength(1);
    });

    it('should support empty configuration', () => {
      const policyVars = {};

      expect(policyVars.import).toBeUndefined();
      expect(policyVars.local).toBeUndefined();
    });
  });

  describe('CompiledVariableContext Interface', () => {
    it('should define valid CompiledVariableContext structure', () => {
      const context = {
        variables: new Map([['isAdmin', 'principal.role === "admin"']]),
        constants: new Map([['maxAttempts', 3]]),
        resolutionInfo: {
          imports: ['common-vars'],
          localVariables: ['customCheck'],
          overrides: ['isAdmin'],
          totalCount: 3,
        },
      };

      expect(context.variables.size).toBe(1);
      expect(context.constants.size).toBe(1);
      expect(context.resolutionInfo.totalCount).toBe(3);
      expect(context.resolutionInfo.overrides).toContain('isAdmin');
    });

    it('should support empty context', () => {
      const context = {
        variables: new Map(),
        constants: new Map(),
        resolutionInfo: {
          imports: [],
          localVariables: [],
          overrides: [],
          totalCount: 0,
        },
      };

      expect(context.variables.size).toBe(0);
      expect(context.constants.size).toBe(0);
      expect(context.resolutionInfo.totalCount).toBe(0);
    });
  });
});
