/**
 * @fileoverview Unit tests for variable validation utilities
 * Tests export name validation, variable name validation, and limits
 */

import { describe, it, expect } from 'vitest';
import {
  validateExportVariables,
  validateExportConstants,
  validateVariableName,
  validateExportName,
} from '../../../src/variables/validator';
import type { ExportVariables, ExportConstants } from '../../../src/variables/types';
import { ValidationError } from '../../../src/variables/errors';

describe('Validator', () => {
  describe('validateExportName', () => {
    it('should accept valid lowercase export names', () => {
      expect(() => validateExportName('common-vars')).not.toThrow();
      expect(() => validateExportName('role-checks')).not.toThrow();
      expect(() => validateExportName('auth')).not.toThrow();
    });

    it('should accept export names with numbers', () => {
      expect(() => validateExportName('vars123')).not.toThrow();
      expect(() => validateExportName('v1-exports')).not.toThrow();
    });

    it('should accept export names with underscores', () => {
      expect(() => validateExportName('common_vars')).not.toThrow();
      expect(() => validateExportName('role_checks_v1')).not.toThrow();
    });

    it('should accept export names with mixed separators', () => {
      expect(() => validateExportName('common-vars_v1')).not.toThrow();
      expect(() => validateExportName('role_checks-2')).not.toThrow();
    });

    it('should reject export names starting with number', () => {
      expect(() => validateExportName('1-vars')).toThrow(ValidationError);
      expect(() => validateExportName('123')).toThrow(ValidationError);
    });

    it('should reject export names with uppercase letters', () => {
      expect(() => validateExportName('CommonVars')).toThrow(ValidationError);
      expect(() => validateExportName('VARS')).toThrow(ValidationError);
    });

    it('should reject export names with special characters', () => {
      expect(() => validateExportName('vars@123')).toThrow(ValidationError);
      expect(() => validateExportName('vars.v1')).toThrow(ValidationError);
      expect(() => validateExportName('vars!test')).toThrow(ValidationError);
    });

    it('should reject export names with spaces', () => {
      expect(() => validateExportName('common vars')).toThrow(ValidationError);
      expect(() => validateExportName('vars test')).toThrow(ValidationError);
    });

    it('should reject empty export names', () => {
      expect(() => validateExportName('')).toThrow(ValidationError);
    });
  });

  describe('validateVariableName', () => {
    it('should accept valid variable names', () => {
      expect(() => validateVariableName('isAdmin')).not.toThrow();
      expect(() => validateVariableName('checkOwner')).not.toThrow();
      expect(() => validateVariableName('valid')).not.toThrow();
    });

    it('should accept variable names with numbers', () => {
      expect(() => validateVariableName('var123')).not.toThrow();
      expect(() => validateVariableName('check1')).not.toThrow();
    });

    it('should accept variable names with underscores', () => {
      expect(() => validateVariableName('is_admin')).not.toThrow();
      expect(() => validateVariableName('check_owner_id')).not.toThrow();
    });

    it('should accept camelCase variable names', () => {
      expect(() => validateVariableName('isAdmin')).not.toThrow();
      expect(() => validateVariableName('checkOwnerId')).not.toThrow();
    });

    it('should reject variable names starting with number', () => {
      expect(() => validateVariableName('1var')).toThrow(ValidationError);
      expect(() => validateVariableName('123')).toThrow(ValidationError);
    });

    it('should reject variable names with hyphens', () => {
      expect(() => validateVariableName('is-admin')).toThrow(ValidationError);
    });

    it('should reject variable names with special characters', () => {
      expect(() => validateVariableName('var@test')).toThrow(ValidationError);
      expect(() => validateVariableName('var.test')).toThrow(ValidationError);
      expect(() => validateVariableName('var!test')).toThrow(ValidationError);
    });

    it('should reject variable names with spaces', () => {
      expect(() => validateVariableName('is admin')).toThrow(ValidationError);
    });

    it('should reject empty variable names', () => {
      expect(() => validateVariableName('')).toThrow(ValidationError);
    });
  });

  describe('validateExportVariables', () => {
    it('should validate export with valid names', () => {
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

      expect(() => validateExportVariables(exportVars)).not.toThrow();
    });

    it('should reject export with invalid export name', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'CommonVars' },
        spec: {
          name: 'CommonVars',
          definitions: {},
        },
      };

      expect(() => validateExportVariables(exportVars)).toThrow(ValidationError);
    });

    it('should reject export with invalid variable names', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars' },
        spec: {
          name: 'vars',
          definitions: {
            'invalid-name': 'true',
          },
        },
      };

      expect(() => validateExportVariables(exportVars)).toThrow(ValidationError);
    });

    it('should reject export with more than 100 definitions', () => {
      const definitions: Record<string, string> = {};
      for (let i = 0; i < 101; i++) {
        definitions[`var${i}`] = 'true';
      }

      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars' },
        spec: {
          name: 'vars',
          definitions,
        },
      };

      expect(() => validateExportVariables(exportVars)).toThrow(ValidationError);
      expect(() => validateExportVariables(exportVars)).toThrow(/max.*100/i);
    });

    it('should accept export with exactly 100 definitions', () => {
      const definitions: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        definitions[`var${i}`] = 'true';
      }

      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars' },
        spec: {
          name: 'vars',
          definitions,
        },
      };

      expect(() => validateExportVariables(exportVars)).not.toThrow();
    });

    it('should accept export with empty definitions', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars' },
        spec: {
          name: 'vars',
          definitions: {},
        },
      };

      expect(() => validateExportVariables(exportVars)).not.toThrow();
    });

    it('should validate all variable names in definitions', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'vars' },
        spec: {
          name: 'vars',
          definitions: {
            valid1: 'true',
            'invalid-name': 'false',
            valid2: 'true',
          },
        },
      };

      expect(() => validateExportVariables(exportVars)).toThrow(ValidationError);
    });

    it('should accept metadata name different from spec name', () => {
      const exportVars: ExportVariables = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportVariables',
        metadata: { name: 'metadata-name' },
        spec: {
          name: 'spec-name',
          definitions: {},
        },
      };

      expect(() => validateExportVariables(exportVars)).not.toThrow();
    });
  });

  describe('validateExportConstants', () => {
    it('should validate export with valid names', () => {
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

      expect(() => validateExportConstants(exportConsts)).not.toThrow();
    });

    it('should reject export with invalid export name', () => {
      const exportConsts: ExportConstants = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants',
        metadata: { name: 'CONSTS' },
        spec: {
          name: 'CONSTS',
          definitions: {},
        },
      };

      expect(() => validateExportConstants(exportConsts)).toThrow(ValidationError);
    });

    it('should reject export with invalid constant names', () => {
      const exportConsts: ExportConstants = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants',
        metadata: { name: 'consts' },
        spec: {
          name: 'consts',
          definitions: {
            'invalid-name': 123,
          },
        },
      };

      expect(() => validateExportConstants(exportConsts)).toThrow(ValidationError);
    });

    it('should reject export with more than 100 definitions', () => {
      const definitions: Record<string, unknown> = {};
      for (let i = 0; i < 101; i++) {
        definitions[`const${i}`] = i;
      }

      const exportConsts: ExportConstants = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants',
        metadata: { name: 'consts' },
        spec: {
          name: 'consts',
          definitions,
        },
      };

      expect(() => validateExportConstants(exportConsts)).toThrow(ValidationError);
    });

    it('should accept export with various value types', () => {
      const exportConsts: ExportConstants = {
        apiVersion: 'authz.engine/v1',
        kind: 'ExportConstants',
        metadata: { name: 'consts' },
        spec: {
          name: 'consts',
          definitions: {
            stringVal: 'test',
            numberVal: 42,
            boolVal: true,
            nullVal: null,
            arrayVal: [1, 2, 3],
            objectVal: { key: 'value' },
          },
        },
      };

      expect(() => validateExportConstants(exportConsts)).not.toThrow();
    });
  });
});
