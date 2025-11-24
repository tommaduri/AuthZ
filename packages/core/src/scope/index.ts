/**
 * Scope Module - Hierarchical Scope Resolution
 *
 * Exports scope resolution utilities for multi-tenant authorization.
 */

export { ScopeResolver } from './scope-resolver.js';
export type {
  ScopeResolverConfig,
  ScopeValidationResult,
  ScopeMatchResult,
  ScopeCacheEntry,
  ScopeResolverStats,
} from './types.js';
