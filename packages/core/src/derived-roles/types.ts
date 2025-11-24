/**
 * Types for derived roles module
 */

import type { Principal, Resource } from '../types';
import type { ValidatedDerivedRolesPolicy } from '../policy/schema';

/**
 * Configuration for DerivedRolesResolver
 */
export interface DerivedRolesResolverConfig {
  celEvaluator: {
    evaluateBoolean(expression: string, context: unknown): boolean;
  };
  enableTrace?: boolean;
}

/**
 * Evaluation trace for a single derived role
 */
export interface DerivedRoleEvaluationTrace {
  roleName: string;
  parentRoleMatched: boolean;
  parentRoles: string[];
  conditionEvaluated: boolean;
  conditionResult: boolean;
  variables?: Record<string, unknown>;
  durationMs: number;
  error?: string;
}

/**
 * Result of derived role evaluation
 */
export interface DerivedRoleEvaluationResult {
  roles: string[];
  traces?: DerivedRoleEvaluationTrace[];
}

/**
 * Circular dependency error
 */
export class CircularDependencyError extends Error {
  constructor(
    public readonly cycle: string[],
    message?: string,
  ) {
    super(message || `Circular dependency detected: ${cycle.join(' -> ')}`);
    this.name = 'CircularDependencyError';
  }
}

/**
 * Internal representation of a derived role definition
 */
export interface DerivedRoleDefinition {
  name: string;
  parentRoles: string[];
  condition: {
    expression: string;
  };
  variables?: Record<string, string>;
  policyName: string;
}

/**
 * Dependency graph node
 */
export interface DependencyNode {
  name: string;
  dependencies: Set<string>;
  dependents: Set<string>;
}

/**
 * Evaluation context for derived roles
 */
export interface DerivedRoleEvaluationContext {
  principal: Principal;
  resource: Resource;
  auxData?: Record<string, unknown>;
  variables?: Record<string, unknown>;
}
