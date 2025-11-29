/**
 * @fileoverview Validation utilities for variables module
 * Provides validation for export names, variable names, and definitions
 */

import type { ExportVariables, ExportConstants } from './types';
import { ValidationError } from './errors';

/**
 * Validate export name format
 * Export names must:
 * - Start with lowercase letter
 * - Contain only lowercase letters, numbers, hyphens, underscores
 * - Not be empty
 *
 * @param name - Export name to validate
 * @throws {ValidationError} if name is invalid
 */
export function validateExportName(name: string): void {
  if (!name) {
    throw new ValidationError('Export name cannot be empty');
  }

  const exportNameRegex = /^[a-z][a-z0-9_-]*$/;
  if (!exportNameRegex.test(name)) {
    throw new ValidationError(
      `Invalid export name: ${name}. Must start with lowercase letter and contain only lowercase letters, numbers, hyphens, and underscores.`
    );
  }
}

/**
 * Validate variable name format
 * Variable names must:
 * - Start with letter (uppercase or lowercase)
 * - Contain only letters, numbers, underscores
 * - Not be empty
 *
 * @param name - Variable name to validate
 * @throws {ValidationError} if name is invalid
 */
export function validateVariableName(name: string): void {
  if (!name) {
    throw new ValidationError('Variable name cannot be empty');
  }

  const variableNameRegex = /^[a-zA-Z][a-zA-Z0-9_]*$/;
  if (!variableNameRegex.test(name)) {
    throw new ValidationError(
      `Invalid variable name: ${name}. Must start with letter and contain only letters, numbers, and underscores.`
    );
  }
}

/**
 * Validate ExportVariables
 * Validates export name, variable names, and definition count
 *
 * @param exportVars - ExportVariables to validate
 * @throws {ValidationError} if validation fails
 */
export function validateExportVariables(exportVars: ExportVariables): void {
  // Validate export name (use spec.name as primary identifier)
  validateExportName(exportVars.spec.name);

  // Validate variable names
  for (const name of Object.keys(exportVars.spec.definitions)) {
    validateVariableName(name);
  }

  // Validate max 100 definitions
  const definitionCount = Object.keys(exportVars.spec.definitions).length;
  if (definitionCount > 100) {
    throw new ValidationError(
      `Export ${exportVars.spec.name} has ${definitionCount} definitions. Max 100 definitions allowed per export.`
    );
  }
}

/**
 * Validate ExportConstants
 * Validates export name, constant names, and definition count
 *
 * @param exportConsts - ExportConstants to validate
 * @throws {ValidationError} if validation fails
 */
export function validateExportConstants(exportConsts: ExportConstants): void {
  // Validate export name
  validateExportName(exportConsts.spec.name);

  // Validate constant names (same rules as variable names)
  for (const name of Object.keys(exportConsts.spec.definitions)) {
    validateVariableName(name);
  }

  // Validate max 100 definitions
  const definitionCount = Object.keys(exportConsts.spec.definitions).length;
  if (definitionCount > 100) {
    throw new ValidationError(
      `Export ${exportConsts.spec.name} has ${definitionCount} definitions. Max 100 definitions allowed per export.`
    );
  }
}
