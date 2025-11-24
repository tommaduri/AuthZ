/**
 * ScopeResolver - Hierarchical Scope Resolution for AuthZ Engine
 *
 * Implements scope chain building, pattern matching with wildcards,
 * scope validation, and effective scope computation for multi-tenant
 * authorization scenarios.
 */

import type {
  ScopeResolverConfig,
  ScopeValidationResult,
  ScopeCacheEntry,
  ScopeResolverStats,
} from './types.js';
import type { ResourcePolicy, ScopeResolutionResult } from '../types/index.js';
import type { ValidatedResourcePolicy } from '../policy/schema.js';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CONFIG: Required<ScopeResolverConfig> = {
  maxDepth: 10,
  separator: '.',
  enableCaching: true,
  maxCacheSize: 1000,
  cacheTTL: 300000, // 5 minutes
};

// Valid scope segment pattern: alphanumeric, hyphen, underscore
const VALID_SEGMENT_REGEX = /^[a-zA-Z0-9_-]+$/;

// =============================================================================
// ScopeResolver Class
// =============================================================================

export class ScopeResolver {
  private readonly config: Required<ScopeResolverConfig>;
  private readonly chainCache: Map<string, ScopeCacheEntry<string[]>>;
  private stats: ScopeResolverStats;

  constructor(config: ScopeResolverConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.chainCache = new Map();
    this.stats = {
      chainComputations: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheSize: 0,
      matchOperations: 0,
      validations: 0,
    };
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Build scope inheritance chain from most to least specific.
   *
   * @param scope - The scope string (e.g., "acme.corp.engineering.team1")
   * @returns Array of scopes from most to least specific
   *
   * @example
   * buildScopeChain("acme.corp.engineering.team1")
   * // Returns: ["acme.corp.engineering.team1", "acme.corp.engineering", "acme.corp", "acme"]
   */
  buildScopeChain(scope: string): string[] {
    this.stats.chainComputations++;

    // Handle null, undefined, or empty scope
    if (!scope || typeof scope !== 'string') {
      return [];
    }

    const normalizedScope = this.normalizeScope(scope);
    if (!normalizedScope) {
      return [];
    }

    // Check cache
    if (this.config.enableCaching) {
      const cached = this.getFromCache(normalizedScope);
      if (cached) {
        this.stats.cacheHits++;
        return [...cached]; // Return copy to prevent mutation
      }
      this.stats.cacheMisses++;
    }

    // Build the chain
    const chain = this.computeScopeChain(normalizedScope);

    // Cache the result
    if (this.config.enableCaching) {
      this.addToCache(normalizedScope, chain);
    }

    return chain;
  }

  /**
   * Match a pattern against a scope string.
   *
   * Supports:
   * - Exact match: "acme.corp" matches "acme.corp"
   * - Single wildcard (*): "acme.*" matches "acme.corp" but NOT "acme.corp.eng"
   * - Multi wildcard (**): "acme.**" matches "acme.corp.eng.team1"
   * - Suffix wildcard: "**.engineering" matches "acme.corp.engineering"
   *
   * @param pattern - The pattern to match against
   * @param scope - The scope to check
   * @returns Whether the pattern matches the scope
   */
  matchScope(pattern: string, scope: string): boolean {
    this.stats.matchOperations++;

    // Handle empty cases
    if (!pattern && !scope) {
      return true;
    }
    if (!pattern || !scope) {
      return false;
    }

    const normalizedPattern = this.normalizeScope(pattern);
    const normalizedScope = this.normalizeScope(scope);

    // Handle case where normalization results in empty
    if (!normalizedPattern && !normalizedScope) {
      return true;
    }
    if (!normalizedPattern || !normalizedScope) {
      return false;
    }

    return this.matchPatternToScope(normalizedPattern, normalizedScope);
  }

  /**
   * Validate a scope string for format correctness.
   *
   * Checks:
   * - Max depth (default 10 levels)
   * - Valid characters (alphanumeric, hyphen, underscore)
   * - No empty segments
   *
   * @param scope - The scope string to validate
   * @returns Validation result with normalized scope or error
   */
  validateScope(scope: string): ScopeValidationResult {
    this.stats.validations++;

    // Handle empty or whitespace-only
    if (!scope || typeof scope !== 'string' || !scope.trim()) {
      return {
        valid: false,
        error: 'Scope cannot be empty',
      };
    }

    const trimmed = scope.trim();
    const { separator, maxDepth } = this.config;

    // Check for empty segments (leading, trailing, or consecutive separators)
    if (
      trimmed.startsWith(separator) ||
      trimmed.endsWith(separator) ||
      trimmed.includes(separator + separator)
    ) {
      return {
        valid: false,
        error: 'Scope contains empty segment',
      };
    }

    const segments = trimmed.split(separator);

    // Check depth
    if (segments.length > maxDepth) {
      return {
        valid: false,
        error: `Scope exceeds maximum depth of ${maxDepth}`,
      };
    }

    // Validate each segment
    for (const segment of segments) {
      if (!segment) {
        return {
          valid: false,
          error: 'Scope contains empty segment',
        };
      }

      if (!VALID_SEGMENT_REGEX.test(segment)) {
        return {
          valid: false,
          error: `Scope contains invalid character in segment: "${segment}"`,
        };
      }
    }

    return {
      valid: true,
      normalizedScope: trimmed.toLowerCase(),
    };
  }

  /**
   * Compute the effective scope from principal and resource scopes.
   *
   * If both are provided, returns the intersection (most restrictive).
   * If only one is provided, returns that one.
   *
   * @param principalScope - The principal's scope
   * @param resourceScope - The resource's scope
   * @returns The effective scope for authorization
   */
  computeEffectiveScope(
    principalScope?: string,
    resourceScope?: string
  ): string {
    const normalizedPrincipal = principalScope
      ? this.normalizeScope(principalScope)
      : '';
    const normalizedResource = resourceScope
      ? this.normalizeScope(resourceScope)
      : '';

    // If only one provided, return it
    if (!normalizedPrincipal && !normalizedResource) {
      return '';
    }
    if (!normalizedPrincipal) {
      return normalizedResource;
    }
    if (!normalizedResource) {
      return normalizedPrincipal;
    }

    // Both provided - compute intersection
    return this.computeScopeIntersection(normalizedPrincipal, normalizedResource);
  }

  /**
   * Clear the scope chain cache.
   */
  clearCache(): void {
    this.chainCache.clear();
    this.stats.cacheSize = 0;
  }

  /**
   * Get resolver statistics.
   */
  getStats(): ScopeResolverStats {
    return {
      ...this.stats,
      cacheSize: this.chainCache.size,
    };
  }

  /**
   * Build inheritance chain from a scope, handling undefined.
   * This is an alias for buildScopeChain that accepts undefined.
   *
   * @param scope - The scope string or undefined (for global)
   * @returns Array of scopes from most to least specific, empty for undefined/global
   */
  buildInheritanceChain(scope: string | undefined): string[] {
    if (!scope || scope === '(global)') {
      return [];
    }
    return this.buildScopeChain(scope);
  }

  /**
   * Find the matching policy for a given scope using inheritance chain.
   * Walks up the scope chain until a policy is found.
   *
   * @param scopedPolicies - Map of "scope:resourceKind" -> policies
   * @param resourceKind - The resource kind to look up
   * @param effectiveScope - The effective scope to start from
   * @returns Resolution result with matched scope and policy
   */
  findMatchingPolicy(
    scopedPolicies: Map<string, ValidatedResourcePolicy[]>,
    resourceKind: string,
    effectiveScope: string,
  ): ScopeResolutionResult {
    // Build inheritance chain (most specific to least specific)
    const chain = this.buildInheritanceChain(
      effectiveScope === '(global)' ? undefined : effectiveScope,
    );

    // Add global scope to the end of the chain
    const fullChain = [...chain, '(global)'];

    // Walk the chain looking for a matching policy
    for (const scope of fullChain) {
      const key = `${scope}:${resourceKind}`;
      const policies = scopedPolicies.get(key);

      if (policies && policies.length > 0) {
        return {
          matchedScope: scope,
          effectivePolicy: policies[0] as unknown as ResourcePolicy,
          inheritanceChain: fullChain,
        };
      }
    }

    // No matching policy found
    return {
      matchedScope: '(global)',
      effectivePolicy: null,
      inheritanceChain: fullChain,
    };
  }

  /**
   * Extract unique scopes from the scoped policies map.
   *
   * @param scopedPolicies - Map of "scope:resourceKind" -> policies
   * @returns Array of unique scope strings
   */
  extractScopes(scopedPolicies: Map<string, ValidatedResourcePolicy[]>): string[] {
    const scopes = new Set<string>();

    for (const key of scopedPolicies.keys()) {
      // Key format is "scope:resourceKind"
      const colonIndex = key.lastIndexOf(':');
      if (colonIndex > 0) {
        const scope = key.substring(0, colonIndex);
        scopes.add(scope);
      }
    }

    return Array.from(scopes).sort();
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Normalize a scope string (trim, lowercase, remove empty segments).
   */
  private normalizeScope(scope: string): string {
    if (!scope || typeof scope !== 'string') {
      return '';
    }

    const { separator } = this.config;

    return scope
      .trim()
      .toLowerCase()
      .split(separator)
      .filter((s) => s.length > 0)
      .join(separator);
  }

  /**
   * Compute the scope chain for a normalized scope.
   */
  private computeScopeChain(normalizedScope: string): string[] {
    const { separator } = this.config;
    const segments = normalizedScope.split(separator);
    const chain: string[] = [];

    for (let i = segments.length; i > 0; i--) {
      chain.push(segments.slice(0, i).join(separator));
    }

    return chain;
  }

  /**
   * Match a normalized pattern against a normalized scope.
   */
  private matchPatternToScope(pattern: string, scope: string): boolean {
    const { separator } = this.config;
    const patternSegments = pattern.split(separator);
    const scopeSegments = scope.split(separator);

    return this.matchSegments(patternSegments, scopeSegments, 0, 0);
  }

  /**
   * Recursive segment matching with wildcard support.
   */
  private matchSegments(
    patternSegments: string[],
    scopeSegments: string[],
    patternIdx: number,
    scopeIdx: number
  ): boolean {
    // Both exhausted - match
    if (patternIdx >= patternSegments.length && scopeIdx >= scopeSegments.length) {
      return true;
    }

    // Pattern exhausted but scope remaining - no match
    if (patternIdx >= patternSegments.length) {
      return false;
    }

    const currentPattern = patternSegments[patternIdx];

    // Multi-wildcard (**)
    if (currentPattern === '**') {
      // ** at end matches everything remaining
      if (patternIdx === patternSegments.length - 1) {
        return true;
      }

      // Try matching ** with 0, 1, 2, ... scope segments
      for (let skip = 0; skip <= scopeSegments.length - scopeIdx; skip++) {
        if (
          this.matchSegments(
            patternSegments,
            scopeSegments,
            patternIdx + 1,
            scopeIdx + skip
          )
        ) {
          return true;
        }
      }
      return false;
    }

    // Scope exhausted but pattern remaining (and not **)
    if (scopeIdx >= scopeSegments.length) {
      return false;
    }

    // Single wildcard (*)
    if (currentPattern === '*') {
      return this.matchSegments(
        patternSegments,
        scopeSegments,
        patternIdx + 1,
        scopeIdx + 1
      );
    }

    // Exact match
    if (currentPattern === scopeSegments[scopeIdx]) {
      return this.matchSegments(
        patternSegments,
        scopeSegments,
        patternIdx + 1,
        scopeIdx + 1
      );
    }

    return false;
  }

  /**
   * Compute the intersection of two scopes.
   * Returns the most specific scope if one contains the other,
   * or the common ancestor if they diverge.
   */
  private computeScopeIntersection(scope1: string, scope2: string): string {
    const { separator } = this.config;
    const segments1 = scope1.split(separator);
    const segments2 = scope2.split(separator);

    // Find common prefix
    const commonSegments: string[] = [];
    const minLength = Math.min(segments1.length, segments2.length);

    for (let i = 0; i < minLength; i++) {
      if (segments1[i] === segments2[i]) {
        commonSegments.push(segments1[i]);
      } else {
        break;
      }
    }

    // If one is a prefix of the other, return the more specific one
    if (commonSegments.length === segments1.length) {
      return scope2; // scope2 is more specific or equal
    }
    if (commonSegments.length === segments2.length) {
      return scope1; // scope1 is more specific
    }

    // Return common ancestor
    return commonSegments.join(separator);
  }

  /**
   * Get a value from cache if it exists and is not expired.
   */
  private getFromCache(key: string): string[] | null {
    const entry = this.chainCache.get(key);
    if (!entry) {
      return null;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > this.config.cacheTTL) {
      this.chainCache.delete(key);
      return null;
    }

    entry.hits++;
    return entry.value;
  }

  /**
   * Add a value to the cache, evicting if necessary.
   */
  private addToCache(key: string, value: string[]): void {
    // Evict if at capacity
    if (this.chainCache.size >= this.config.maxCacheSize) {
      this.evictOldestEntry();
    }

    this.chainCache.set(key, {
      value: [...value], // Store copy
      timestamp: Date.now(),
      hits: 0,
    });
  }

  /**
   * Evict the oldest (or least recently used) cache entry.
   */
  private evictOldestEntry(): void {
    let oldestKey: string | null = null;
    let oldestTimestamp = Infinity;

    const entries = Array.from(this.chainCache.entries());
    for (const [key, entry] of entries) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.chainCache.delete(oldestKey);
    }
  }
}
