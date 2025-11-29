/**
 * Configuration Error Classes
 *
 * Custom error types for configuration loading and validation.
 */

export class ConfigLoadError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'ConfigLoadError';
    Object.setPrototypeOf(this, ConfigLoadError.prototype);
  }
}

export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly value: unknown,
    public readonly expectedType?: string
  ) {
    super(message);
    this.name = 'ConfigValidationError';
    Object.setPrototypeOf(this, ConfigValidationError.prototype);
  }
}
