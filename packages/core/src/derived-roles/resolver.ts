/**
 * Resolver for derived roles
 */

import type { Principal, Resource } from '../types';
import type { ValidatedDerivedRolesPolicy } from '../policy/schema';
import type {
  DerivedRolesResolverConfig,
  DerivedRoleDefinition,
  DerivedRoleEvaluationResult,
  DerivedRoleEvaluationTrace,
  DerivedRoleEvaluationContext,
} from './types';
import { DerivedRolesValidator } from './validator';
import { DerivedRolesCache } from './cache';

/**
 * Resolves derived roles for principals
 */
export class DerivedRolesResolver {
  private definitions: DerivedRoleDefinition[] = [];
  private validator: DerivedRolesValidator;
  private config: DerivedRolesResolverConfig;

  constructor(config: DerivedRolesResolverConfig) {
    this.config = config;
    this.validator = new DerivedRolesValidator();
  }

  /**
   * Load and validate derived roles policies
   */
  loadPolicies(policies: ValidatedDerivedRolesPolicy[]): void {
    // Validate policies (includes circular dependency detection)
    this.validator.validate(policies);

    // Convert to internal format
    this.definitions = [];
    for (const policy of policies) {
      for (const definition of policy.spec.definitions) {
        this.definitions.push({
          name: definition.name,
          parentRoles: definition.parentRoles,
          condition: definition.condition,
          policyName: policy.metadata.name,
        });
      }
    }
  }

  /**
   * Resolve derived roles for a principal
   */
  resolve(
    principal: Principal,
    resource: Resource,
    auxData?: Record<string, unknown>,
    cache?: DerivedRolesCache,
  ): string[] {
    // Use cache if provided
    if (cache) {
      const key = DerivedRolesCache.generateKey(
        principal.id,
        principal.roles,
        resource.kind,
        resource.id,
      );
      return cache.getOrCompute(key, () => this.computeRoles(principal, resource, auxData));
    }

    return this.computeRoles(principal, resource, auxData);
  }

  /**
   * Resolve with evaluation trace
   */
  resolveWithTrace(
    principal: Principal,
    resource: Resource,
    auxData?: Record<string, unknown>,
  ): DerivedRoleEvaluationResult {
    const traces: DerivedRoleEvaluationTrace[] = [];
    const roles: string[] = [];

    for (const definition of this.definitions) {
      const startTime = performance.now();
      const trace: DerivedRoleEvaluationTrace = {
        roleName: definition.name,
        parentRoleMatched: false,
        parentRoles: definition.parentRoles,
        conditionEvaluated: false,
        conditionResult: false,
        durationMs: 0,
      };

      try {
        // Check parent roles
        trace.parentRoleMatched = this.matchesParentRole(principal.roles, definition.parentRoles);

        if (!trace.parentRoleMatched) {
          trace.durationMs = performance.now() - startTime;
          traces.push(trace);
          continue;
        }

        // Evaluate condition
        const context: DerivedRoleEvaluationContext = {
          principal,
          resource,
          auxData,
        };

        trace.conditionEvaluated = true;
        trace.conditionResult = this.config.celEvaluator.evaluateBoolean(
          definition.condition.expression,
          context,
        );

        if (trace.conditionResult) {
          roles.push(definition.name);
        }
      } catch (error) {
        trace.error = error instanceof Error ? error.message : String(error);
      } finally {
        trace.durationMs = performance.now() - startTime;
        traces.push(trace);
      }
    }

    return { roles, traces };
  }

  /**
   * Compute derived roles without caching
   */
  private computeRoles(
    principal: Principal,
    resource: Resource,
    auxData?: Record<string, unknown>,
  ): string[] {
    const derivedRoles: string[] = [];

    for (const definition of this.definitions) {
      // Check parent roles
      if (!this.matchesParentRole(principal.roles, definition.parentRoles)) {
        continue;
      }

      // Evaluate condition
      const context: DerivedRoleEvaluationContext = {
        principal,
        resource,
        auxData,
      };

      try {
        const matches = this.config.celEvaluator.evaluateBoolean(
          definition.condition.expression,
          context,
        );

        if (matches) {
          derivedRoles.push(definition.name);
        }
      } catch (error) {
        // Silently skip on evaluation error (matches current behavior)
        continue;
      }
    }

    return derivedRoles;
  }

  /**
   * Check if principal has required parent roles
   * Supports wildcards: *, prefix:*, *:suffix
   */
  private matchesParentRole(principalRoles: string[], parentRoles: string[]): boolean {
    // Empty parent roles means any principal can have this derived role
    if (parentRoles.length === 0) {
      return true;
    }

    for (const parentRole of parentRoles) {
      // Wildcard: match any role
      if (parentRole === '*') {
        return principalRoles.length > 0;
      }

      // Prefix wildcard: match any role with prefix
      if (parentRole.endsWith(':*')) {
        const prefix = parentRole.slice(0, -2);
        if (principalRoles.some(role => role.startsWith(prefix + ':'))) {
          return true;
        }
      }

      // Suffix wildcard: match any role with suffix
      if (parentRole.startsWith('*:')) {
        const suffix = parentRole.slice(2);
        if (principalRoles.some(role => role.endsWith(':' + suffix))) {
          return true;
        }
      }

      // Exact match
      if (principalRoles.includes(parentRole)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get loaded definitions count
   */
  getDefinitionsCount(): number {
    return this.definitions.length;
  }

  /**
   * Clear loaded policies
   */
  clear(): void {
    this.definitions = [];
  }
}
