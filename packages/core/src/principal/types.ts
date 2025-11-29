/**
 * Principal Policy Types for AuthZ Engine
 *
 * Types for principal-based authorization policies including
 * pattern matching, evaluation results, and configuration.
 */

import type { Effect } from '../types';
import type { ValidatedPrincipalPolicy } from '../policy/schema';

// =============================================================================
// Principal Matcher Types
// =============================================================================

/**
 * Result of a principal pattern match
 */
export interface PrincipalMatchResult {
  /** Whether the pattern matched */
  matched: boolean;
  /** The pattern that was used */
  pattern: string;
  /** Type of match performed */
  matchType: 'exact' | 'wildcard' | 'prefix' | 'suffix' | 'group';
}

/**
 * Principal matcher interface for matching principals against patterns
 */
export interface IPrincipalMatcher {
  /**
   * Match an exact principal ID
   */
  matchExact(pattern: string, principalId: string): boolean;

  /**
   * Match a principal against a wildcard pattern
   * Supports: *, service-*, *@example.com, group:finance-team
   */
  matchPattern(pattern: string, principalId: string): boolean;

  /**
   * Compile a pattern to a RegExp for reuse
   */
  compilePattern(pattern: string): RegExp;

  /**
   * Match a principal ID against multiple patterns
   * Returns true if any pattern matches
   */
  matchAny(patterns: string[], principalId: string): boolean;
}

// =============================================================================
// Principal Policy Evaluator Types
// =============================================================================

/**
 * Result of evaluating a principal policy
 */
export interface PrincipalPolicyResult {
  /** Effect of the matched rule (allow/deny) */
  effect: Effect;
  /** Name of the policy that matched */
  policy: string;
  /** Name of the rule that matched (if named) */
  rule?: string;
  /** Output expression result (if configured) */
  output?: unknown;
  /** Principal pattern that matched */
  matchedPattern?: string;
  /** Resource that was evaluated */
  resource?: string;
  /** Action that was evaluated */
  action?: string;
}

/**
 * Statistics for principal policy evaluation
 */
export interface PrincipalPolicyStats {
  /** Total number of loaded policies */
  totalPolicies: number;
  /** Number of unique principals covered */
  uniquePrincipals: number;
  /** Number of cache hits */
  cacheHits: number;
  /** Number of cache misses */
  cacheMisses: number;
  /** Cache hit rate percentage */
  cacheHitRate: number;
}

/**
 * Configuration for the principal policy evaluator
 */
export interface PrincipalPolicyEvaluatorConfig {
  /** Cache configuration */
  cacheConfig?: {
    /** Enable caching of pattern compilations */
    enabled: boolean;
    /** Maximum number of cached patterns */
    maxSize: number;
    /** TTL in milliseconds for cached patterns */
    ttlMs: number;
  };
}

/**
 * Output expression configuration for rules
 */
export interface OutputExpression {
  /** Expression to evaluate when rule is activated */
  whenRuleActivated?: string;
  /** Expression to evaluate when condition is not met */
  whenConditionNotMet?: string;
}

/**
 * Enhanced action rule with output support
 */
export interface EnhancedPrincipalActionRule {
  /** Action this rule applies to */
  action: string;
  /** Effect of the rule */
  effect: Effect;
  /** Optional name for the rule */
  name?: string;
  /** Optional condition expression */
  condition?: {
    expression: string;
  };
  /** Optional output expressions */
  output?: OutputExpression;
}

/**
 * Enhanced principal rule with variables support
 */
export interface EnhancedPrincipalRule {
  /** Resource this rule applies to */
  resource: string;
  /** Actions for this resource */
  actions: EnhancedPrincipalActionRule[];
}

/**
 * Variable definition for principal policies
 */
export interface PolicyVariable {
  /** Variable name */
  name: string;
  /** Variable expression */
  expression: string;
}

/**
 * Variables configuration for principal policies
 */
export interface PolicyVariables {
  /** Imported variable sets */
  import?: string[];
  /** Local variable definitions */
  local?: PolicyVariable[];
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export type { ValidatedPrincipalPolicy };
