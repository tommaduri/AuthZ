/**
 * Derived roles module
 * Provides enhanced derived role resolution with circular dependency detection,
 * wildcard parent roles, variables support, and per-request caching.
 */

export { DerivedRolesResolver } from './resolver';
export { DerivedRolesCache } from './cache';
export { DerivedRolesValidator } from './validator';
export {
  CircularDependencyError,
  type DerivedRolesResolverConfig,
  type DerivedRoleDefinition,
  type DerivedRoleEvaluationResult,
  type DerivedRoleEvaluationTrace,
  type DerivedRoleEvaluationContext,
} from './types';
