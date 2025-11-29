/**
 * Principal Matcher
 *
 * Handles matching principal identifiers against patterns including
 * exact matches, wildcards, prefixes, suffixes, and group patterns.
 */

import type { IPrincipalMatcher, PrincipalMatchResult } from './types';

/**
 * Principal pattern matcher implementation.
 *
 * Supports the following pattern types:
 * - `*` - Universal wildcard (matches any principal)
 * - `prefix-*` - Prefix pattern (matches principals starting with prefix)
 * - `*-suffix` - Suffix pattern (matches principals ending with suffix)
 * - `prefix-*-suffix` - Contains pattern (matches prefix and suffix with wildcard middle)
 * - `group:name` - Group pattern (exact match with group: prefix)
 * - `exact-match` - Exact string comparison
 *
 * @example
 * ```typescript
 * const matcher = new PrincipalMatcher();
 *
 * matcher.matchPattern('service-*', 'service-backup'); // true
 * matcher.matchPattern('*@example.com', 'john@example.com'); // true
 * matcher.matchPattern('admin', 'admin'); // true
 * matcher.matchPattern('admin', 'user'); // false
 * ```
 */
export class PrincipalMatcher implements IPrincipalMatcher {
  /** Cache for compiled regex patterns */
  private patternCache: Map<string, RegExp> = new Map();

  /** Maximum cache size to prevent memory bloat */
  private readonly maxCacheSize: number;

  constructor(options?: { maxCacheSize?: number }) {
    this.maxCacheSize = options?.maxCacheSize ?? 1000;
  }

  /**
   * Match an exact principal ID.
   *
   * @param pattern - The exact pattern to match
   * @param principalId - The principal ID to check
   * @returns true if pattern exactly equals principalId
   */
  matchExact(pattern: string, principalId: string): boolean {
    return pattern === principalId;
  }

  /**
   * Match a principal ID against a pattern with wildcard support.
   *
   * @param pattern - The pattern (may contain wildcards)
   * @param principalId - The principal ID to check
   * @returns true if the principal matches the pattern
   */
  matchPattern(pattern: string, principalId: string): boolean {
    // Universal wildcard matches everything
    if (pattern === '*') {
      return true;
    }

    // Handle consecutive wildcards by treating as single wildcard
    const normalizedPattern = pattern.replace(/\*+/g, '*');

    // No wildcards - exact match
    if (!normalizedPattern.includes('*')) {
      return this.matchExact(normalizedPattern, principalId);
    }

    // Use compiled regex for pattern matching
    const regex = this.compilePattern(normalizedPattern);
    return regex.test(principalId);
  }

  /**
   * Compile a pattern string to a RegExp for efficient reuse.
   *
   * @param pattern - The pattern to compile
   * @returns Compiled RegExp
   */
  compilePattern(pattern: string): RegExp {
    // Check cache first
    const cached = this.patternCache.get(pattern);
    if (cached) {
      return cached;
    }

    // Normalize consecutive wildcards
    const normalizedPattern = pattern.replace(/\*+/g, '*');

    // Build regex pattern
    const regexPattern = this.buildRegexPattern(normalizedPattern);
    const regex = new RegExp(`^${regexPattern}$`);

    // Cache the compiled regex (with eviction if needed)
    this.cachePattern(pattern, regex);

    return regex;
  }

  /**
   * Match a principal ID against multiple patterns.
   * Returns true if any pattern matches (short-circuits on first match).
   *
   * @param patterns - Array of patterns to match against
   * @param principalId - The principal ID to check
   * @returns true if any pattern matches
   */
  matchAny(patterns: string[], principalId: string): boolean {
    for (const pattern of patterns) {
      if (this.matchPattern(pattern, principalId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Match a principal and return detailed result information.
   *
   * @param pattern - The pattern to match against
   * @param principalId - The principal ID to check
   * @returns Detailed match result
   */
  matchWithDetails(pattern: string, principalId: string): PrincipalMatchResult {
    const matched = this.matchPattern(pattern, principalId);
    const matchType = this.determineMatchType(pattern);

    return {
      matched,
      pattern,
      matchType,
    };
  }

  /**
   * Build a regex pattern string from a wildcard pattern.
   *
   * @param pattern - The wildcard pattern
   * @returns Regex pattern string (without anchors)
   */
  private buildRegexPattern(pattern: string): string {
    // Escape all regex special characters except *
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

    // Replace * with regex equivalent (.*) for any characters
    return escaped.replace(/\*/g, '.*');
  }

  /**
   * Cache a compiled pattern with eviction support.
   *
   * @param pattern - The original pattern string
   * @param regex - The compiled RegExp
   */
  private cachePattern(pattern: string, regex: RegExp): void {
    // Evict oldest entries if at capacity
    if (this.patternCache.size >= this.maxCacheSize) {
      // Remove first (oldest) entry
      const firstKey = this.patternCache.keys().next().value;
      if (firstKey !== undefined) {
        this.patternCache.delete(firstKey);
      }
    }

    this.patternCache.set(pattern, regex);
  }

  /**
   * Determine the type of match for a pattern.
   *
   * @param pattern - The pattern to analyze
   * @returns The match type
   */
  private determineMatchType(pattern: string): PrincipalMatchResult['matchType'] {
    // Universal wildcard
    if (pattern === '*') {
      return 'wildcard';
    }

    // Group pattern
    if (pattern.startsWith('group:')) {
      return 'group';
    }

    // No wildcards - exact match
    if (!pattern.includes('*')) {
      return 'exact';
    }

    // Check for prefix pattern (ends with *)
    if (pattern.endsWith('*') && !pattern.slice(0, -1).includes('*')) {
      return 'prefix';
    }

    // Check for suffix pattern (starts with *)
    if (pattern.startsWith('*') && !pattern.slice(1).includes('*')) {
      return 'suffix';
    }

    // Mixed wildcard pattern
    return 'wildcard';
  }

  /**
   * Clear the pattern cache.
   */
  clearCache(): void {
    this.patternCache.clear();
  }

  /**
   * Get cache statistics.
   *
   * @returns Cache size
   */
  getCacheSize(): number {
    return this.patternCache.size;
  }
}
