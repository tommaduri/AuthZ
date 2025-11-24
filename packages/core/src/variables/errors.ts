/**
 * @fileoverview Error classes for variables module
 */

/**
 * Base error class for variables module
 */
export class VariableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VariableError';
  }
}

/**
 * Error thrown when attempting to register duplicate export
 */
export class DuplicateExportError extends VariableError {
  constructor(exportName: string) {
    super(`Export already registered: ${exportName}`);
    this.name = 'DuplicateExportError';
  }
}

/**
 * Error thrown when importing unknown export
 */
export class UnknownExportError extends VariableError {
  constructor(exportName: string) {
    super(`Unknown export: ${exportName}`);
    this.name = 'UnknownExportError';
  }
}

/**
 * Error thrown when validation fails
 */
export class ValidationError extends VariableError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Error thrown when circular dependency is detected
 */
export class CircularDependencyError extends VariableError {
  constructor(cycle: string[]) {
    super(`Circular dependency detected: ${cycle.join(' -> ')}`);
    this.name = 'CircularDependencyError';
  }
}
