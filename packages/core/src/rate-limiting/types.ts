/**
 * Rate Limiting Types for AuthZ Engine
 *
 * Defines configuration and result types for rate limiting functionality.
 */

// =============================================================================
// Rate Limit Algorithm Types
// =============================================================================

/**
 * Available rate limiting algorithms
 */
export type RateLimitAlgorithm = 'token-bucket' | 'sliding-window' | 'fixed-window';

/**
 * Scope of rate limiting - determines what the limit applies to
 */
export type RateLimitScope = 'global' | 'principal' | 'resource' | 'principal-resource';

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for a single rate limit rule
 */
export interface RateLimitRule {
  /** Unique identifier for this rule */
  id: string;
  /** Human-readable name */
  name?: string;
  /** Algorithm to use for rate limiting */
  algorithm: RateLimitAlgorithm;
  /** Scope of the rate limit */
  scope: RateLimitScope;
  /** Maximum number of requests allowed in the window */
  limit: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Optional: specific principal IDs this rule applies to */
  principals?: string[];
  /** Optional: specific resource kinds this rule applies to */
  resources?: string[];
  /** Optional: specific actions this rule applies to */
  actions?: string[];
  /** Token bucket specific: refill rate (tokens per second) */
  refillRate?: number;
  /** Token bucket specific: bucket capacity (max tokens) */
  bucketCapacity?: number;
  /** Whether to skip this rule (useful for overrides) */
  skip?: boolean;
  /** Priority for rule matching (higher = checked first) */
  priority?: number;
}

/**
 * Overall rate limiter configuration
 */
export interface RateLimiterConfig {
  /** Enable/disable rate limiting globally */
  enabled: boolean;
  /** Default algorithm when not specified in rules */
  defaultAlgorithm: RateLimitAlgorithm;
  /** Default limit when no rule matches */
  defaultLimit: number;
  /** Default window in milliseconds */
  defaultWindowMs: number;
  /** Rate limit rules */
  rules: RateLimitRule[];
  /** Storage backend configuration */
  storage?: {
    type: 'memory' | 'redis';
    redis?: {
      host: string;
      port: number;
      password?: string;
      keyPrefix?: string;
      db?: number;
    };
  };
  /** Whether to include rate limit headers in response */
  includeHeaders?: boolean;
  /** Custom key generator function name */
  keyGenerator?: string;
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Result of a rate limit check
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Number of remaining requests in the current window */
  remaining: number;
  /** Total limit for the current window */
  limit: number;
  /** Timestamp (ms) when the rate limit resets */
  resetAt: number;
  /** Time in ms until the rate limit resets */
  retryAfterMs: number;
  /** The rule that was applied */
  rule?: string;
  /** Current token count (for token bucket) */
  tokens?: number;
  /** Bucket capacity (for token bucket) */
  bucketCapacity?: number;
}

/**
 * Rate limit information for response headers
 */
export interface RateLimitHeaders {
  'X-RateLimit-Limit': string;
  'X-RateLimit-Remaining': string;
  'X-RateLimit-Reset': string;
  'Retry-After'?: string;
}

// =============================================================================
// Request Context Types
// =============================================================================

/**
 * Context for rate limit checking
 */
export interface RateLimitContext {
  /** Principal ID making the request */
  principalId?: string;
  /** Resource kind being accessed */
  resourceKind?: string;
  /** Resource ID being accessed */
  resourceId?: string;
  /** Action being performed */
  action?: string;
  /** Custom key override */
  customKey?: string;
  /** Request timestamp (defaults to now) */
  timestamp?: number;
  /** Number of tokens to consume (default: 1) */
  cost?: number;
}

// =============================================================================
// Storage Types
// =============================================================================

/**
 * Internal state for token bucket algorithm
 */
export interface TokenBucketState {
  tokens: number;
  lastRefill: number;
}

/**
 * Internal state for sliding window algorithm
 */
export interface SlidingWindowState {
  timestamps: number[];
}

/**
 * Internal state for fixed window algorithm
 */
export interface FixedWindowState {
  count: number;
  windowStart: number;
}

/**
 * Union type for all algorithm states
 */
export type RateLimitState = TokenBucketState | SlidingWindowState | FixedWindowState;

// =============================================================================
// Event Types
// =============================================================================

/**
 * Event emitted when rate limit is exceeded
 */
export interface RateLimitExceededEvent {
  timestamp: number;
  key: string;
  rule: string;
  principalId?: string;
  resourceKind?: string;
  action?: string;
  limit: number;
  windowMs: number;
  remaining: number;
  resetAt: number;
}

/**
 * Event emitted for rate limit metrics
 */
export interface RateLimitMetricsEvent {
  timestamp: number;
  totalRequests: number;
  allowedRequests: number;
  deniedRequests: number;
  ruleId: string;
}
