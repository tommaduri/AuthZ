/**
 * Validator for derived roles policies
 */

import type { ValidatedDerivedRolesPolicy } from '../policy/schema';
import { CircularDependencyError } from './types';

/**
 * Enhanced validation for derived roles policies
 */
export class DerivedRolesValidator {
  /**
   * Validate derived roles policies
   */
  validate(policies: ValidatedDerivedRolesPolicy[]): void {
    this.validateNaming(policies);
    this.validateParentRoles(policies);
    this.detectCircularDependencies(policies);
  }

  /**
   * Validate role naming conventions
   */
  private validateNaming(policies: ValidatedDerivedRolesPolicy[]): void {
    const allNames = new Set<string>();

    for (const policy of policies) {
      for (const definition of policy.spec.definitions) {
        if (allNames.has(definition.name)) {
          throw new Error(`Duplicate derived role name: ${definition.name}`);
        }
        allNames.add(definition.name);

        // Validate name format (alphanumeric, hyphens, underscores)
        if (!/^[a-zA-Z0-9_-]+$/.test(definition.name)) {
          throw new Error(
            `Invalid derived role name: ${definition.name}. Must contain only alphanumeric characters, hyphens, and underscores.`,
          );
        }
      }
    }
  }

  /**
   * Validate parent role patterns
   */
  private validateParentRoles(policies: ValidatedDerivedRolesPolicy[]): void {
    for (const policy of policies) {
      for (const definition of policy.spec.definitions) {
        for (const parentRole of definition.parentRoles) {
          // Validate wildcard patterns: *, prefix:*, *:suffix, or exact names
          if (parentRole.includes('*')) {
            // Only allow * alone, prefix:*, or *:suffix patterns
            const isValidPattern =
              parentRole === '*' ||
              /^[a-zA-Z0-9_-]+:\*$/.test(parentRole) ||
              /^\*:[a-zA-Z0-9_-]+$/.test(parentRole);

            if (!isValidPattern) {
              throw new Error(
                `Invalid parent role pattern: ${parentRole}. Wildcards are only allowed as "*", "prefix:*", or "*:suffix".`,
              );
            }
          }
        }
      }
    }
  }

  /**
   * Detect circular dependencies in derived role definitions
   * Uses Kahn's algorithm for topological sort
   */
  private detectCircularDependencies(policies: ValidatedDerivedRolesPolicy[]): void {
    // Build adjacency list
    const graph = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();
    const allRoles = new Set<string>();

    // Initialize graph
    for (const policy of policies) {
      for (const definition of policy.spec.definitions) {
        allRoles.add(definition.name);
        if (!graph.has(definition.name)) {
          graph.set(definition.name, new Set());
          inDegree.set(definition.name, 0);
        }
      }
    }

    // Build edges (derived role -> parent derived roles)
    for (const policy of policies) {
      for (const definition of policy.spec.definitions) {
        for (const parentRole of definition.parentRoles) {
          // Only consider edges to other derived roles (not base roles)
          if (allRoles.has(parentRole)) {
            graph.get(definition.name)!.add(parentRole);
            inDegree.set(parentRole, (inDegree.get(parentRole) || 0) + 1);
          }
        }
      }
    }

    // Kahn's algorithm
    const queue: string[] = [];
    const sorted: string[] = [];

    // Find all nodes with no incoming edges
    for (const [role, degree] of inDegree.entries()) {
      if (degree === 0) {
        queue.push(role);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(current);

      for (const neighbor of graph.get(current) || []) {
        const newDegree = inDegree.get(neighbor)! - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    // If sorted length != total roles, there's a cycle
    if (sorted.length !== allRoles.size) {
      const cycleNodes = Array.from(allRoles).filter(role => !sorted.includes(role));
      throw new CircularDependencyError(cycleNodes);
    }
  }
}
