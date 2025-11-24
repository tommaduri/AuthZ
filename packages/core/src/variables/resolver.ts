/**
 * @fileoverview VariableResolver for resolving policy variables from imports and locals
 * Handles import resolution, local overrides, and precedence rules
 */

import type { PolicyVariables, CompiledVariableContext } from './types';
import { ExportRegistry } from './registry';
import { ExpressionCache } from './cache';
import { UnknownExportError } from './errors';
import { isExportVariables, isExportConstants } from './types';

/**
 * Resolves policy variables by combining imports and local definitions
 * Supports:
 * - Importing ExportVariables and ExportConstants
 * - Local variable overrides
 * - Expression caching for performance
 * - Precedence: local > imported
 */
export class VariableResolver {
  constructor(
    private registry: ExportRegistry,
    private cache: ExpressionCache
  ) {}

  /**
   * Resolve policy variables
   * Combines imported exports with local definitions
   * Local definitions override imported ones
   *
   * @param policyVariables - Policy variable configuration
   * @returns Compiled variable context
   * @throws {UnknownExportError} if import references unknown export
   */
  resolve(policyVariables: PolicyVariables): CompiledVariableContext {
    const variables = new Map<string, string>();
    const constants = new Map<string, unknown>();
    const imports: string[] = [];
    const localVars: string[] = [];
    const overrides: string[] = [];

    // Step 1: Process imports
    for (const importName of policyVariables.import ?? []) {
      const exportDef = this.registry.get(importName);
      if (!exportDef) {
        throw new UnknownExportError(importName);
      }

      imports.push(importName);

      if (isExportVariables(exportDef)) {
        // Import variables (CEL expressions)
        for (const [name, expr] of Object.entries(exportDef.spec.definitions)) {
          const compiled = this.cache.getOrCompile(expr);
          variables.set(name, compiled);
        }
      } else if (isExportConstants(exportDef)) {
        // Import constants (static values)
        for (const [name, value] of Object.entries(exportDef.spec.definitions)) {
          constants.set(name, value);
        }
      }
    }

    // Step 2: Process local variables (overrides imports)
    for (const [name, expr] of Object.entries(policyVariables.local ?? {})) {
      localVars.push(name);

      // Check if this overrides an import
      if (variables.has(name) || constants.has(name)) {
        overrides.push(name);
        // Remove from constants if it was there
        constants.delete(name);
      }

      // Compile and add to variables
      const compiled = this.cache.getOrCompile(expr);
      variables.set(name, compiled);
    }

    // Calculate total count
    const totalCount = variables.size + constants.size;

    return {
      variables,
      constants,
      resolutionInfo: {
        imports,
        localVariables: localVars,
        overrides,
        totalCount,
      },
    };
  }

  /**
   * Validate that all imports reference registered exports
   *
   * @param imports - Import names to validate
   * @returns Validation result with errors
   */
  validateImports(imports: string[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const importName of imports) {
      if (!this.registry.has(importName)) {
        errors.push(`Unknown export: ${importName}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
