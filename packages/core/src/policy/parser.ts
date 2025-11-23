import { parse as parseYaml } from 'yaml';
import {
  PolicySchema,
  ResourcePolicySchema,
  DerivedRolesPolicySchema,
  PrincipalPolicySchema,
  ValidatedPolicy,
  ValidatedResourcePolicy,
  ValidatedDerivedRolesPolicy,
  ValidatedPrincipalPolicy,
} from './schema';
import type { Policy } from '../types';

/**
 * Policy parsing errors
 */
export class PolicyParseError extends Error {
  constructor(
    message: string,
    public readonly errors: Array<{ path: string; message: string }>,
    public readonly source?: string,
  ) {
    super(message);
    this.name = 'PolicyParseError';
  }
}

/**
 * Policy Parser
 *
 * Parses and validates policy files from YAML or JSON format.
 */
export class PolicyParser {
  /**
   * Parse a policy from YAML string
   */
  parseYaml(yamlContent: string): ValidatedPolicy {
    try {
      const parsed = parseYaml(yamlContent);
      return this.validate(parsed, yamlContent);
    } catch (error) {
      if (error instanceof PolicyParseError) {
        throw error;
      }
      throw new PolicyParseError(
        `Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`,
        [{ path: '', message: 'Invalid YAML syntax' }],
        yamlContent,
      );
    }
  }

  /**
   * Parse a policy from JSON string
   */
  parseJson(jsonContent: string): ValidatedPolicy {
    try {
      const parsed = JSON.parse(jsonContent);
      return this.validate(parsed, jsonContent);
    } catch (error) {
      if (error instanceof PolicyParseError) {
        throw error;
      }
      throw new PolicyParseError(
        `Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`,
        [{ path: '', message: 'Invalid JSON syntax' }],
        jsonContent,
      );
    }
  }

  /**
   * Parse a policy from an object (already parsed)
   */
  parse(data: unknown): ValidatedPolicy {
    return this.validate(data);
  }

  /**
   * Validate policy data against schema
   */
  private validate(data: unknown, source?: string): ValidatedPolicy {
    const result = PolicySchema.safeParse(data);

    if (!result.success) {
      const errors = result.error.errors.map((err) => ({
        path: err.path.join('.'),
        message: err.message,
      }));

      throw new PolicyParseError(
        `Invalid policy: ${errors.map(e => `${e.path}: ${e.message}`).join(', ')}`,
        errors,
        source,
      );
    }

    return result.data;
  }

  /**
   * Parse specifically as a ResourcePolicy
   */
  parseResourcePolicy(data: unknown): ValidatedResourcePolicy {
    const result = ResourcePolicySchema.safeParse(data);

    if (!result.success) {
      const errors = result.error.errors.map((err) => ({
        path: err.path.join('.'),
        message: err.message,
      }));

      throw new PolicyParseError(
        `Invalid resource policy: ${errors.map(e => `${e.path}: ${e.message}`).join(', ')}`,
        errors,
      );
    }

    return result.data;
  }

  /**
   * Parse specifically as a DerivedRolesPolicy
   */
  parseDerivedRolesPolicy(data: unknown): ValidatedDerivedRolesPolicy {
    const result = DerivedRolesPolicySchema.safeParse(data);

    if (!result.success) {
      const errors = result.error.errors.map((err) => ({
        path: err.path.join('.'),
        message: err.message,
      }));

      throw new PolicyParseError(
        `Invalid derived roles policy: ${errors.map(e => `${e.path}: ${e.message}`).join(', ')}`,
        errors,
      );
    }

    return result.data;
  }

  /**
   * Parse specifically as a PrincipalPolicy
   */
  parsePrincipalPolicy(data: unknown): ValidatedPrincipalPolicy {
    const result = PrincipalPolicySchema.safeParse(data);

    if (!result.success) {
      const errors = result.error.errors.map((err) => ({
        path: err.path.join('.'),
        message: err.message,
      }));

      throw new PolicyParseError(
        `Invalid principal policy: ${errors.map(e => `${e.path}: ${e.message}`).join(', ')}`,
        errors,
      );
    }

    return result.data;
  }

  /**
   * Check if data looks like a valid policy (without full validation)
   */
  isPolicy(data: unknown): data is Policy {
    if (typeof data !== 'object' || data === null) {
      return false;
    }

    const obj = data as Record<string, unknown>;
    return (
      obj.apiVersion === 'authz.engine/v1' &&
      typeof obj.kind === 'string' &&
      ['ResourcePolicy', 'DerivedRoles', 'PrincipalPolicy'].includes(obj.kind)
    );
  }

  /**
   * Get the kind of policy from data
   */
  getPolicyKind(data: unknown): 'ResourcePolicy' | 'DerivedRoles' | 'PrincipalPolicy' | null {
    if (!this.isPolicy(data)) {
      return null;
    }
    return (data as Policy).kind;
  }
}

// Default parser instance
export const policyParser = new PolicyParser();
