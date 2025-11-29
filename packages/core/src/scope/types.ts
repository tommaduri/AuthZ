/**
 * Scope Types for AuthZ Engine
 *
 * Types for scope resolution, validation, and hierarchical scope matching.
 */

// =============================================================================
// Scope Validation Result
// =============================================================================

export interface ScopeValidationResult {
  /** Whether the scope is valid */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
  /** Normalized scope string (lowercase, trimmed) */
  normalizedScope?: string;
}

// =============================================================================
// Scope Configuration
// =============================================================================

export interface ScopeResolverConfig {
  /** Maximum depth of scope hierarchy (default: 10) */
  maxDepth?: number;
  /** Separator character (default: '.') */
  separator?: string;
  /** Enable caching for scope chains (default: true) */
  enableCaching?: boolean;
  /** Maximum cache size (default: 1000) */
  maxCacheSize?: number;
  /** Cache TTL in milliseconds (default: 300000 - 5 minutes) */
  cacheTTL?: number;
}

// =============================================================================
// Scope Match Result
// =============================================================================

export interface ScopeMatchResult {
  /** Whether the pattern matches the scope */
  matches: boolean;
  /** Type of match (exact, single-wildcard, multi-wildcard) */
  matchType?: 'exact' | 'single-wildcard' | 'multi-wildcard' | 'suffix-wildcard';
  /** Captured wildcard segments */
  capturedSegments?: string[];
}

// =============================================================================
// Cache Entry
// =============================================================================

export interface ScopeCacheEntry<T> {
  /** Cached value */
  value: T;
  /** Timestamp when cached */
  timestamp: number;
  /** Number of times accessed */
  hits: number;
}

// =============================================================================
// Scope Statistics
// =============================================================================

export interface ScopeResolverStats {
  /** Total scope chain computations */
  chainComputations: number;
  /** Cache hit count */
  cacheHits: number;
  /** Cache miss count */
  cacheMisses: number;
  /** Current cache size */
  cacheSize: number;
  /** Total match operations */
  matchOperations: number;
  /** Total validations */
  validations: number;
}
