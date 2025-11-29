/**
 * @fileoverview Type definitions for exported variables and constants
 * Defines interfaces for ExportVariables, ExportConstants, and variable resolution
 */

/**
 * ExportVariables definition with CEL expressions
 */
export interface ExportVariables {
  apiVersion: 'authz.engine/v1';
  kind: 'ExportVariables';
  metadata: {
    name: string;
  };
  spec: {
    name: string;
    definitions: Record<string, string>; // name -> CEL expression
  };
}

/**
 * ExportConstants definition with static values
 */
export interface ExportConstants {
  apiVersion: 'authz.engine/v1';
  kind: 'ExportConstants';
  metadata: {
    name: string;
  };
  spec: {
    name: string;
    definitions: Record<string, unknown>; // name -> static value
  };
}

/**
 * Policy variables configuration for exported variables
 * Note: Renamed to avoid conflict with principal/types.ts
 */
export interface ExportPolicyVariables {
  import?: string[];
  local?: Record<string, string>;
}

/**
 * Compiled variable context after resolution
 */
export interface CompiledVariableContext {
  variables: Map<string, string>; // name -> compiled CEL expression
  constants: Map<string, unknown>; // name -> static value
  resolutionInfo: {
    imports: string[];
    localVariables: string[];
    overrides: string[];
    totalCount: number;
  };
}

/**
 * Type guard for ExportVariables
 */
export function isExportVariables(obj: unknown): obj is ExportVariables {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'kind' in obj &&
    obj.kind === 'ExportVariables'
  );
}

/**
 * Type guard for ExportConstants
 */
export function isExportConstants(obj: unknown): obj is ExportConstants {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'kind' in obj &&
    obj.kind === 'ExportConstants'
  );
}
