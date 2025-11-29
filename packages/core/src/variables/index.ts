/**
 * @fileoverview Variables module - Exported variables and constants support
 * Provides infrastructure for defining and importing reusable variables across policies
 */

// Types
export type {
  ExportVariables,
  ExportConstants,
  ExportPolicyVariables,
  CompiledVariableContext,
} from './types';

export {
  isExportVariables,
  isExportConstants,
} from './types';

// Core classes
export { ExportRegistry } from './registry';
export { VariableResolver } from './resolver';
export { ExpressionCache } from './cache';

// Validation
export {
  validateExportVariables,
  validateExportConstants,
  validateVariableName,
  validateExportName,
} from './validator';

// Errors
export {
  VariableError,
  DuplicateExportError,
  UnknownExportError,
  ValidationError,
  VariableCircularDependencyError,
} from './errors';
