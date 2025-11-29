/**
 * Policy Validator Module
 *
 * Comprehensive policy syntax and semantic validation for the authz-engine.
 * Implements validation for ResourcePolicy, DerivedRoles, and PrincipalPolicy types.
 *
 * @module @authz-engine/core/validation
 */

import * as yaml from 'yaml';
import { CelEvaluator } from '../cel/evaluator';

// =============================================================================
// Error Codes
// =============================================================================

/**
 * Validation error codes for categorizing different types of validation failures.
 * Each code corresponds to a specific validation check.
 */
export enum ValidationErrorCode {
  /** Required field is missing from the policy */
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  /** Effect value is not 'allow' or 'deny' */
  INVALID_EFFECT = 'INVALID_EFFECT',
  /** CEL expression has invalid syntax */
  INVALID_CEL_SYNTAX = 'INVALID_CEL_SYNTAX',
  /** Role name contains invalid characters */
  INVALID_ROLE_NAME = 'INVALID_ROLE_NAME',
  /** Action name contains invalid characters */
  INVALID_ACTION_NAME = 'INVALID_ACTION_NAME',
  /** API version is not supported */
  INVALID_API_VERSION = 'INVALID_API_VERSION',
  /** Policy kind is not recognized */
  INVALID_KIND = 'INVALID_KIND',
  /** Referenced derived role does not exist */
  UNDEFINED_DERIVED_ROLE = 'UNDEFINED_DERIVED_ROLE',
  /** Circular dependency detected in derived roles */
  CIRCULAR_DEPENDENCY = 'CIRCULAR_DEPENDENCY',
  /** Duplicate definition found */
  DUPLICATE_DEFINITION = 'DUPLICATE_DEFINITION',
  /** Array is empty when it should have items */
  EMPTY_ARRAY = 'EMPTY_ARRAY',
  /** CEL expression is empty */
  EMPTY_EXPRESSION = 'EMPTY_EXPRESSION',
  /** Reserved keyword used as identifier */
  RESERVED_KEYWORD = 'RESERVED_KEYWORD',
  /** Unknown variable referenced in CEL expression */
  UNKNOWN_VARIABLE = 'UNKNOWN_VARIABLE',
  /** Policy name contains invalid characters */
  INVALID_POLICY_NAME = 'INVALID_POLICY_NAME',
  /** Resource name contains invalid characters */
  INVALID_RESOURCE_NAME = 'INVALID_RESOURCE_NAME',
}

// =============================================================================
// Types
// =============================================================================

/**
 * Location information for errors in source files
 */
export interface ErrorLocation {
  /** Line number (1-indexed) */
  line?: number;
  /** Column number (1-indexed) */
  column?: number;
  /** Character offset in the source */
  offset?: number;
}

/**
 * A validation error with detailed information
 */
export interface ValidationError {
  /** Error code for categorization */
  code: ValidationErrorCode;
  /** JSON path to the problematic field (e.g., 'spec.rules[0].effect') */
  path: string;
  /** Human-readable error message */
  message: string;
  /** Suggested fix for the error */
  suggestion?: string;
  /** Location in source file if available */
  location?: ErrorLocation;
  /** Context snippet from the source */
  context?: string;
  /** Name of the policy this error belongs to (for batch validation) */
  policyName?: string;
}

/**
 * A validation warning (non-fatal)
 */
export interface ValidationWarning {
  /** Warning code */
  code: ValidationErrorCode;
  /** JSON path to the field */
  path: string;
  /** Human-readable warning message */
  message: string;
  /** Suggested improvement */
  suggestion?: string;
}

/**
 * Result of policy validation
 */
export interface ValidationResult {
  /** Whether the policy is valid */
  valid: boolean;
  /** List of validation errors (fatal) */
  errors: ValidationError[];
  /** List of validation warnings (non-fatal) */
  warnings: ValidationWarning[];
}

/**
 * Options for policy validation
 */
export interface ValidationOptions {
  /** Enable strict mode with additional checks */
  strict?: boolean;
  /** Validate CEL expressions (default: true) */
  validateCel?: boolean;
  /** Known variables for CEL validation */
  knownVariables?: string[];
  /** Warn on unknown variables in CEL expressions */
  warnOnUnknownVariables?: boolean;
  /** Available derived roles for cross-reference validation */
  availableDerivedRoles?: string[];
}

// =============================================================================
// Constants
// =============================================================================

const VALID_API_VERSIONS = ['authz.engine/v1'];
const VALID_KINDS = ['ResourcePolicy', 'DerivedRoles', 'PrincipalPolicy'];
const VALID_EFFECTS = ['allow', 'deny'];
const RESERVED_KEYWORDS = ['true', 'false', 'null', 'undefined', 'NaN'];
const DEFAULT_KNOWN_VARIABLES = [
  'principal',
  'resource',
  'request',
  'variables',
  'now',
  'nowTimestamp',
];

// Role name pattern: letters, numbers, underscores, must start with letter or underscore
const ROLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
// Action name pattern: letters, numbers, underscores, colons, asterisks
const ACTION_NAME_PATTERN = /^[a-zA-Z0-9_:*]+$/;
// Policy/resource name pattern: letters, numbers, underscores, hyphens
const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

// Maximum recommended lengths
const MAX_NAME_LENGTH = 256;
const MAX_EXPRESSION_LENGTH = 5000;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Find the closest match from a list of options
 */
function findClosestMatch(input: string, options: string[]): string | null {
  let closest: string | null = null;
  let minDistance = Infinity;

  for (const option of options) {
    const distance = levenshteinDistance(input.toLowerCase(), option.toLowerCase());
    if (distance < minDistance && distance <= 3) {
      minDistance = distance;
      closest = option;
    }
  }

  return closest;
}

// =============================================================================
// Policy Validator Class
// =============================================================================

/**
 * Policy Validator for comprehensive syntax and semantic validation.
 */
export class PolicyValidator {
  private celEvaluator: CelEvaluator;

  constructor() {
    this.celEvaluator = new CelEvaluator();
  }

  /**
   * Validate a policy from YAML source string
   */
  validateYaml(yamlSource: string, options?: ValidationOptions): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    try {
      // Parse YAML with location info
      const doc = yaml.parseDocument(yamlSource);

      if (doc.errors && doc.errors.length > 0) {
        for (const err of doc.errors) {
          errors.push({
            code: ValidationErrorCode.INVALID_CEL_SYNTAX,
            path: '',
            message: `YAML parse error: ${err.message}`,
            location: err.pos ? { line: err.pos[0], column: err.pos[1] } : undefined,
          });
        }
        return { valid: false, errors, warnings };
      }

      const policy = doc.toJS() as unknown;
      const result = this.validateWithYamlContext(policy, yamlSource, doc, options);

      return result;
    } catch (error) {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: '',
        message: `Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`,
      });
      return { valid: false, errors, warnings };
    }
  }

  /**
   * Validate a policy from JSON source string
   */
  validateJson(jsonSource: string, options?: ValidationOptions): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    try {
      const policy = JSON.parse(jsonSource) as unknown;
      return this.validate(policy, options);
    } catch (error) {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: '',
        message: `Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
      return { valid: false, errors, warnings };
    }
  }

  /**
   * Validate a parsed policy object
   */
  validate(policy: unknown, options?: ValidationOptions): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Handle non-object inputs
    if (policy === null || policy === undefined) {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: '',
        message: 'Policy must be an object',
      });
      return { valid: false, errors, warnings };
    }

    if (typeof policy !== 'object' || Array.isArray(policy)) {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: '',
        message: 'Policy must be an object',
      });
      return { valid: false, errors, warnings };
    }

    const p = policy as Record<string, unknown>;

    // Validate apiVersion
    this.validateApiVersion(p, errors);

    // Validate kind
    this.validateKind(p, errors);

    // Validate metadata
    this.validateMetadata(p, errors, warnings);

    // Validate spec
    this.validateSpec(p, errors, warnings, options);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate with YAML context for line numbers
   */
  private validateWithYamlContext(
    policy: unknown,
    yamlSource: string,
    _doc: yaml.Document,
    options?: ValidationOptions
  ): ValidationResult {
    const result = this.validate(policy, options);
    const lines = yamlSource.split('\n');

    // Enhance errors with line numbers and context
    for (const error of result.errors) {
      if (!error.location) {
        const location = this.findLocationInYaml(error.path, yamlSource, lines);
        if (location) {
          error.location = location;
          error.context = this.getContextSnippet(lines, location.line!);
        }
      }
    }

    return result;
  }

  /**
   * Find location of a path in YAML source
   */
  private findLocationInYaml(
    path: string,
    _yamlSource: string,
    lines: string[]
  ): ErrorLocation | null {
    // Simple approach: search for the field name in the YAML
    const parts = path.split(/[\[\].]+/).filter(Boolean);
    const lastPart = parts[parts.length - 1];

    if (!lastPart) return null;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(lastPart + ':') || lines[i].includes(lastPart)) {
        return { line: i + 1, column: lines[i].indexOf(lastPart) + 1 };
      }
    }

    return null;
  }

  /**
   * Get context snippet around a line
   */
  private getContextSnippet(lines: string[], lineNum: number): string {
    const start = Math.max(0, lineNum - 2);
    const end = Math.min(lines.length, lineNum + 1);
    return lines.slice(start, end).join('\n');
  }

  // =============================================================================
  // Validation Methods
  // =============================================================================

  private validateApiVersion(policy: Record<string, unknown>, errors: ValidationError[]): void {
    if (!policy.apiVersion) {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: 'apiVersion',
        message: 'apiVersion is required',
        suggestion: `Use '${VALID_API_VERSIONS[0]}'`,
      });
      return;
    }

    if (!VALID_API_VERSIONS.includes(policy.apiVersion as string)) {
      errors.push({
        code: ValidationErrorCode.INVALID_API_VERSION,
        path: 'apiVersion',
        message: `Invalid API version: '${policy.apiVersion}'`,
        suggestion: `Use '${VALID_API_VERSIONS[0]}'`,
      });
    }
  }

  private validateKind(policy: Record<string, unknown>, errors: ValidationError[]): void {
    if (!policy.kind) {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: 'kind',
        message: 'kind is required',
        suggestion: `Use one of: ${VALID_KINDS.join(', ')}`,
      });
      return;
    }

    const kind = policy.kind as string;
    if (!VALID_KINDS.includes(kind)) {
      const closest = findClosestMatch(kind, VALID_KINDS);
      errors.push({
        code: ValidationErrorCode.INVALID_KIND,
        path: 'kind',
        message: `Invalid kind: '${kind}'`,
        suggestion: closest
          ? `Did you mean '${closest}'? Valid kinds: ${VALID_KINDS.join(', ')}`
          : `Use one of: ${VALID_KINDS.join(', ')}`,
      });
    }
  }

  private validateMetadata(
    policy: Record<string, unknown>,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    if (!policy.metadata) {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: 'metadata',
        message: 'metadata is required',
      });
      return;
    }

    const metadata = policy.metadata as Record<string, unknown>;

    if (!metadata.name) {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: 'metadata.name',
        message: 'metadata.name is required',
      });
      return;
    }

    const name = metadata.name as string;

    // Check for empty name
    if (name === '') {
      errors.push({
        code: ValidationErrorCode.INVALID_POLICY_NAME,
        path: 'metadata.name',
        message: 'Policy name cannot be empty',
      });
      return;
    }

    // Validate name format
    if (!NAME_PATTERN.test(name)) {
      errors.push({
        code: ValidationErrorCode.INVALID_POLICY_NAME,
        path: 'metadata.name',
        message: `Invalid policy name: '${name}'. Names must contain only letters, numbers, underscores, and hyphens`,
      });
    }

    // Warn about long names
    if (name.length > MAX_NAME_LENGTH) {
      warnings.push({
        code: ValidationErrorCode.INVALID_POLICY_NAME,
        path: 'metadata.name',
        message: `Policy name exceeds recommended length of ${MAX_NAME_LENGTH} characters`,
        suggestion: 'Consider using a shorter name',
      });
    }
  }

  private validateSpec(
    policy: Record<string, unknown>,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    options?: ValidationOptions
  ): void {
    if (!policy.spec) {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: 'spec',
        message: 'spec is required',
      });
      return;
    }

    const spec = policy.spec as Record<string, unknown>;
    const kind = policy.kind as string;

    switch (kind) {
      case 'ResourcePolicy':
        this.validateResourcePolicySpec(spec, errors, warnings, options);
        break;
      case 'DerivedRoles':
        this.validateDerivedRolesSpec(spec, errors, warnings, options);
        break;
      case 'PrincipalPolicy':
        this.validatePrincipalPolicySpec(spec, errors, warnings, options);
        break;
    }
  }

  private validateResourcePolicySpec(
    spec: Record<string, unknown>,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    options?: ValidationOptions
  ): void {
    // Validate resource
    if (!spec.resource) {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: 'spec.resource',
        message: 'spec.resource is required for ResourcePolicy',
      });
    } else {
      const resource = spec.resource as string;
      if (!NAME_PATTERN.test(resource)) {
        errors.push({
          code: ValidationErrorCode.INVALID_RESOURCE_NAME,
          path: 'spec.resource',
          message: `Invalid resource name: '${resource}'. Names must contain only letters, numbers, underscores, and hyphens`,
        });
      }
    }

    // Validate rules
    if (!spec.rules) {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: 'spec.rules',
        message: 'spec.rules is required for ResourcePolicy',
      });
      return;
    }

    if (!Array.isArray(spec.rules)) {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: 'spec.rules',
        message: 'spec.rules must be an array',
      });
      return;
    }

    if (spec.rules.length === 0) {
      errors.push({
        code: ValidationErrorCode.EMPTY_ARRAY,
        path: 'spec.rules',
        message: 'spec.rules must contain at least one rule',
      });
      return;
    }

    // Validate each rule
    for (let i = 0; i < spec.rules.length; i++) {
      const rule = spec.rules[i] as Record<string, unknown>;
      this.validateRule(rule, `spec.rules[${i}]`, errors, warnings, options);
    }
  }

  private validateRule(
    rule: Record<string, unknown>,
    path: string,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    options?: ValidationOptions
  ): void {
    // Validate actions
    if (!rule.actions) {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: `${path}.actions`,
        message: 'rule.actions is required',
      });
    } else if (!Array.isArray(rule.actions)) {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: `${path}.actions`,
        message: 'rule.actions must be an array',
      });
    } else if (rule.actions.length === 0) {
      errors.push({
        code: ValidationErrorCode.EMPTY_ARRAY,
        path: `${path}.actions`,
        message: 'rule.actions must contain at least one action',
      });
    } else {
      // Validate each action name
      for (let i = 0; i < rule.actions.length; i++) {
        const action = rule.actions[i] as string;
        if (!ACTION_NAME_PATTERN.test(action)) {
          errors.push({
            code: ValidationErrorCode.INVALID_ACTION_NAME,
            path: `${path}.actions[${i}]`,
            message: `Invalid action name: '${action}'. Actions must contain only letters, numbers, underscores, colons, or asterisks`,
          });
        }
      }
    }

    // Validate effect
    if (rule.effect === undefined || rule.effect === null) {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: `${path}.effect`,
        message: 'rule.effect is required',
      });
    } else if (rule.effect === '') {
      errors.push({
        code: ValidationErrorCode.INVALID_EFFECT,
        path: `${path}.effect`,
        message: "Invalid effect: ''. Effect cannot be empty",
        suggestion: "Use 'allow' or 'deny'",
      });
    } else if (!VALID_EFFECTS.includes(rule.effect as string)) {
      const effect = rule.effect as string;
      const suggestion =
        effect.toLowerCase() === 'allow' || effect.toLowerCase() === 'deny'
          ? `Use '${effect.toLowerCase()}' instead of '${effect}'`
          : "Use 'allow' or 'deny'";
      errors.push({
        code: ValidationErrorCode.INVALID_EFFECT,
        path: `${path}.effect`,
        message: `Invalid effect: '${effect}'`,
        suggestion,
      });
    }

    // Validate roles
    if (rule.roles) {
      if (!Array.isArray(rule.roles)) {
        errors.push({
          code: ValidationErrorCode.INVALID_ROLE_NAME,
          path: `${path}.roles`,
          message: 'rule.roles must be an array',
        });
      } else if (rule.roles !== null) {
        for (let i = 0; i < rule.roles.length; i++) {
          const role = rule.roles[i] as string;
          this.validateRoleName(role, `${path}.roles[${i}]`, errors);
        }
      }
    }

    // Validate derived roles references
    if (rule.derivedRoles) {
      if (!Array.isArray(rule.derivedRoles)) {
        errors.push({
          code: ValidationErrorCode.INVALID_ROLE_NAME,
          path: `${path}.derivedRoles`,
          message: 'rule.derivedRoles must be an array',
        });
      } else {
        // Check against available derived roles if provided
        const availableDerivedRoles = options?.availableDerivedRoles;
        if (availableDerivedRoles) {
          for (let i = 0; i < rule.derivedRoles.length; i++) {
            const derivedRole = rule.derivedRoles[i] as string;
            if (!availableDerivedRoles.includes(derivedRole)) {
              errors.push({
                code: ValidationErrorCode.UNDEFINED_DERIVED_ROLE,
                path: `${path}.derivedRoles[${i}]`,
                message: `Undefined derived role: '${derivedRole}'`,
                suggestion: `Available derived roles: ${availableDerivedRoles.join(', ')}`,
              });
            }
          }
        }
      }
    }

    // Warn if no roles or derivedRoles specified
    if (!rule.roles && !rule.derivedRoles) {
      warnings.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: path,
        message: 'Rule has no roles specified - applies to all principals',
        suggestion: "Specify 'roles' or 'derivedRoles' to restrict access",
      });
    }

    // Validate condition
    if (rule.condition !== undefined && rule.condition !== null) {
      this.validateCondition(rule.condition as Record<string, unknown>, path, errors, warnings, options);
    }
  }

  private validateRoleName(role: string, path: string, errors: ValidationError[]): void {
    // Check for empty role name
    if (!role || role === '') {
      errors.push({
        code: ValidationErrorCode.INVALID_ROLE_NAME,
        path,
        message: 'Role name cannot be empty',
      });
      return;
    }

    // Check for reserved keywords
    if (RESERVED_KEYWORDS.includes(role)) {
      errors.push({
        code: ValidationErrorCode.RESERVED_KEYWORD,
        path,
        message: `'${role}' is a reserved keyword and cannot be used as a role name`,
      });
      return;
    }

    // Check for spaces
    if (role.includes(' ')) {
      errors.push({
        code: ValidationErrorCode.INVALID_ROLE_NAME,
        path,
        message: `Invalid role name: '${role}'. Role names cannot contain spaces`,
      });
      return;
    }

    // Check for starting with number
    if (/^\d/.test(role)) {
      errors.push({
        code: ValidationErrorCode.INVALID_ROLE_NAME,
        path,
        message: `Invalid role name: '${role}'. Role names cannot start with a number`,
      });
      return;
    }

    // Check pattern
    if (!ROLE_NAME_PATTERN.test(role)) {
      errors.push({
        code: ValidationErrorCode.INVALID_ROLE_NAME,
        path,
        message: `Invalid role name: '${role}'. Role names must contain only letters, numbers, and underscores`,
      });
    }
  }

  private validateCondition(
    condition: Record<string, unknown>,
    path: string,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    options?: ValidationOptions
  ): void {
    const expression = condition.expression as string | undefined;

    if (!expression && expression !== '') {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: `${path}.condition.expression`,
        message: 'condition.expression is required when condition is specified',
      });
      return;
    }

    // Check for empty expression
    if (expression === '' || (typeof expression === 'string' && expression.trim() === '')) {
      errors.push({
        code: ValidationErrorCode.EMPTY_EXPRESSION,
        path: `${path}.condition.expression`,
        message: 'CEL expression cannot be empty',
      });
      return;
    }

    // Skip CEL validation if disabled
    if (options?.validateCel === false) {
      return;
    }

    // Validate CEL expression syntax
    this.validateCelExpression(expression, `${path}.condition.expression`, errors, warnings, options);
  }

  private validateCelExpression(
    expression: string,
    path: string,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    options?: ValidationOptions
  ): void {
    // Check for JavaScript-style operators
    if (expression.includes('===')) {
      errors.push({
        code: ValidationErrorCode.INVALID_CEL_SYNTAX,
        path,
        message: "Invalid CEL syntax: '===' is not a valid operator",
        suggestion: "Use '==' for equality comparison in CEL",
        location: { column: expression.indexOf('===') + 1 },
      });
      return;
    }

    // Check for unterminated strings
    const singleQuotes = (expression.match(/'/g) || []).length;
    const doubleQuotes = (expression.match(/"/g) || []).length;
    if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0) {
      errors.push({
        code: ValidationErrorCode.INVALID_CEL_SYNTAX,
        path,
        message: 'Invalid CEL syntax: unterminated string literal',
      });
      return;
    }

    // Check for unmatched parentheses
    let parenCount = 0;
    for (const char of expression) {
      if (char === '(') parenCount++;
      if (char === ')') parenCount--;
    }
    if (parenCount !== 0) {
      errors.push({
        code: ValidationErrorCode.INVALID_CEL_SYNTAX,
        path,
        message: 'Invalid CEL syntax: unmatched parentheses',
      });
      return;
    }

    // Check for trailing operators
    const trimmed = expression.trim();
    if (/[&|=<>!+\-*/]$/.test(trimmed) && !trimmed.endsWith('&&') && !trimmed.endsWith('||')) {
      errors.push({
        code: ValidationErrorCode.INVALID_CEL_SYNTAX,
        path,
        message: 'Invalid CEL syntax: expression ends with operator',
        location: { column: trimmed.length },
      });
      return;
    }

    // Validate using CEL evaluator
    const validationResult = this.celEvaluator.validateExpression(expression);
    if (!validationResult.valid) {
      errors.push({
        code: ValidationErrorCode.INVALID_CEL_SYNTAX,
        path,
        message: `Invalid CEL syntax: ${validationResult.errors?.join(', ') || 'unknown error'}`,
        location: { column: 1 },
      });
      return;
    }

    // Warn on unknown variables if enabled
    if (options?.warnOnUnknownVariables) {
      const knownVars = [
        ...DEFAULT_KNOWN_VARIABLES,
        ...(options.knownVariables || []),
      ];

      // Extract variable names from expression (simple approach)
      const varPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\./g;
      let match;
      while ((match = varPattern.exec(expression)) !== null) {
        const varName = match[1];
        if (!knownVars.includes(varName)) {
          warnings.push({
            code: ValidationErrorCode.UNKNOWN_VARIABLE,
            path,
            message: `Unknown variable '${varName}' in CEL expression`,
            suggestion: `Known variables: ${knownVars.join(', ')}`,
          });
        }
      }
    }

    // Warn about very complex expressions
    // Count operators as a proxy for complexity
    const operatorCount = (expression.match(/&&|\|\||==|!=|>=|<=|>|</g) || []).length;
    if (expression.length > MAX_EXPRESSION_LENGTH || operatorCount > 50) {
      warnings.push({
        code: ValidationErrorCode.INVALID_CEL_SYNTAX,
        path,
        message: 'CEL expression is very complex and may impact performance',
        suggestion: 'Consider breaking down the expression into multiple conditions',
      });
    }
  }

  private validateDerivedRolesSpec(
    spec: Record<string, unknown>,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    options?: ValidationOptions
  ): void {
    // Validate definitions
    if (!spec.definitions) {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: 'spec.definitions',
        message: 'spec.definitions is required for DerivedRoles',
      });
      return;
    }

    if (!Array.isArray(spec.definitions)) {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: 'spec.definitions',
        message: 'spec.definitions must be an array',
      });
      return;
    }

    if (spec.definitions.length === 0) {
      errors.push({
        code: ValidationErrorCode.EMPTY_ARRAY,
        path: 'spec.definitions',
        message: 'spec.definitions must contain at least one definition',
      });
      return;
    }

    // Track defined roles for circular dependency detection
    const definedRoles = new Map<string, { parentRoles: string[]; index: number }>();

    // First pass: collect all defined roles
    for (let i = 0; i < spec.definitions.length; i++) {
      const def = spec.definitions[i] as Record<string, unknown>;
      const name = def.name as string;
      if (name) {
        if (definedRoles.has(name)) {
          errors.push({
            code: ValidationErrorCode.DUPLICATE_DEFINITION,
            path: `spec.definitions[${i}].name`,
            message: `Duplicate derived role definition: '${name}'`,
          });
        } else {
          definedRoles.set(name, {
            parentRoles: (def.parentRoles as string[]) || [],
            index: i,
          });
        }
      }
    }

    // Second pass: validate each definition
    for (let i = 0; i < spec.definitions.length; i++) {
      const def = spec.definitions[i] as Record<string, unknown>;
      this.validateDerivedRoleDefinition(def, `spec.definitions[${i}]`, errors, warnings, options, definedRoles);
    }

    // Check for circular dependencies
    this.checkCircularDependencies(definedRoles, errors);
  }

  private validateDerivedRoleDefinition(
    def: Record<string, unknown>,
    path: string,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    _options?: ValidationOptions,
    _definedRoles?: Map<string, { parentRoles: string[]; index: number }>
  ): void {
    // Validate name
    if (!def.name) {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: `${path}.name`,
        message: 'Derived role name is required',
      });
    } else {
      const name = def.name as string;

      // Check for starting with number
      if (/^\d/.test(name)) {
        errors.push({
          code: ValidationErrorCode.INVALID_ROLE_NAME,
          path: `${path}.name`,
          message: `Invalid role name: '${name}'. Role names cannot start with a number`,
        });
      } else if (!ROLE_NAME_PATTERN.test(name)) {
        errors.push({
          code: ValidationErrorCode.INVALID_ROLE_NAME,
          path: `${path}.name`,
          message: `Invalid derived role name: '${name}'`,
        });
      }
    }

    // Validate condition
    if (!def.condition) {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: `${path}.condition`,
        message: 'Derived role condition is required',
      });
    } else {
      this.validateCondition(def.condition as Record<string, unknown>, path, errors, warnings);
    }
  }

  private checkCircularDependencies(
    definedRoles: Map<string, { parentRoles: string[]; index: number }>,
    errors: ValidationError[]
  ): void {
    // Build dependency graph and check for cycles
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (role: string, path: string[]): string[] | null => {
      if (recursionStack.has(role)) {
        return [...path, role];
      }

      if (visited.has(role)) {
        return null;
      }

      const roleInfo = definedRoles.get(role);
      if (!roleInfo) {
        return null;
      }

      visited.add(role);
      recursionStack.add(role);

      for (const parent of roleInfo.parentRoles) {
        const cycle = hasCycle(parent, [...path, role]);
        if (cycle) {
          return cycle;
        }
      }

      recursionStack.delete(role);
      return null;
    };

    for (const [roleName, roleInfo] of definedRoles) {
      visited.clear();
      recursionStack.clear();

      const cycle = hasCycle(roleName, []);
      if (cycle) {
        errors.push({
          code: ValidationErrorCode.CIRCULAR_DEPENDENCY,
          path: `spec.definitions[${roleInfo.index}]`,
          message: `Circular dependency detected: ${cycle.join(' -> ')}`,
        });
        break; // Only report first cycle found
      }
    }
  }

  private validatePrincipalPolicySpec(
    spec: Record<string, unknown>,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    options?: ValidationOptions
  ): void {
    // Validate principal
    if (!spec.principal) {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: 'spec.principal',
        message: 'spec.principal is required for PrincipalPolicy',
      });
    }

    // Validate rules
    if (!spec.rules) {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: 'spec.rules',
        message: 'spec.rules is required for PrincipalPolicy',
      });
      return;
    }

    if (!Array.isArray(spec.rules)) {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: 'spec.rules',
        message: 'spec.rules must be an array',
      });
      return;
    }

    // Validate each principal policy rule
    for (let i = 0; i < spec.rules.length; i++) {
      const rule = spec.rules[i] as Record<string, unknown>;
      this.validatePrincipalRule(rule, `spec.rules[${i}]`, errors, warnings, options);
    }
  }

  private validatePrincipalRule(
    rule: Record<string, unknown>,
    path: string,
    errors: ValidationError[],
    _warnings: ValidationWarning[],
    _options?: ValidationOptions
  ): void {
    // Validate resource
    if (!rule.resource) {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: `${path}.resource`,
        message: 'rule.resource is required for PrincipalPolicy rules',
      });
    }

    // Validate actions
    if (!rule.actions) {
      errors.push({
        code: ValidationErrorCode.MISSING_REQUIRED_FIELD,
        path: `${path}.actions`,
        message: 'rule.actions is required for PrincipalPolicy rules',
      });
    } else if (Array.isArray(rule.actions)) {
      for (let i = 0; i < rule.actions.length; i++) {
        const action = rule.actions[i] as Record<string, unknown>;
        if (action.effect && !VALID_EFFECTS.includes(action.effect as string)) {
          errors.push({
            code: ValidationErrorCode.INVALID_EFFECT,
            path: `${path}.actions[${i}].effect`,
            message: `Invalid effect: '${action.effect}'`,
            suggestion: "Use 'allow' or 'deny'",
          });
        }
      }
    }
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Validate a single policy
 *
 * @param policy - The policy object to validate
 * @param options - Validation options
 * @returns Validation result with errors and warnings
 */
export function validatePolicy(
  policy: unknown,
  options?: ValidationOptions
): ValidationResult {
  const validator = new PolicyValidator();
  return validator.validate(policy, options);
}

/**
 * Validate multiple policies with cross-reference checking
 *
 * @param policies - Array of policy objects to validate
 * @param options - Validation options
 * @returns Combined validation result
 */
export function validatePolicies(
  policies: unknown[],
  options?: ValidationOptions
): ValidationResult {
  const allErrors: ValidationError[] = [];
  const allWarnings: ValidationWarning[] = [];
  const validator = new PolicyValidator();

  // First pass: collect all derived role definitions
  const derivedRoles: string[] = options?.availableDerivedRoles
    ? [...options.availableDerivedRoles]
    : [];

  for (const policy of policies) {
    if (
      policy &&
      typeof policy === 'object' &&
      (policy as Record<string, unknown>).kind === 'DerivedRoles'
    ) {
      const spec = (policy as Record<string, unknown>).spec as Record<string, unknown> | undefined;
      if (spec?.definitions && Array.isArray(spec.definitions)) {
        for (const def of spec.definitions) {
          const defObj = def as Record<string, unknown>;
          if (defObj.name && typeof defObj.name === 'string') {
            derivedRoles.push(defObj.name);
          }
        }
      }
    }
  }

  // Second pass: validate all policies with cross-reference info
  const validationOptions: ValidationOptions = {
    ...options,
    availableDerivedRoles: derivedRoles,
  };

  for (const policy of policies) {
    const result = validator.validate(policy, validationOptions);

    // Add policy name to errors
    const policyName =
      policy &&
      typeof policy === 'object' &&
      (policy as Record<string, unknown>).metadata
        ? ((policy as Record<string, unknown>).metadata as Record<string, unknown>)?.name as string
        : undefined;

    for (const error of result.errors) {
      allErrors.push({
        ...error,
        policyName,
      });
    }

    for (const warning of result.warnings) {
      allWarnings.push(warning);
    }
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}

// =============================================================================
// Default Export
// =============================================================================

export default {
  PolicyValidator,
  validatePolicy,
  validatePolicies,
  ValidationErrorCode,
};
