/**
 * Rate Limiter for AuthZ Engine
 *
 * Provides multiple rate limiting algorithms for controlling request throughput.
 */

import type {
  RateLimiterConfig,
  RateLimitRule,
  RateLimitResult,
  RateLimitContext,
  RateLimitHeaders,
  RateLimitExceededEvent,
  TokenBucketState,
  SlidingWindowState,
  FixedWindowState,
} from './types';
import type { RateLimitStorage } from './storage';
import { createStorage } from './storage';

// Re-export types
export * from './types';
export * from './storage';

// =============================================================================
// Rate Limiter Implementation
// =============================================================================

/**
 * Event handler type for rate limit events
 */
export type RateLimitEventHandler = (event: RateLimitExceededEvent) => void;

/**
 * Rate Limiter class supporting multiple algorithms
 */
export class RateLimiter {
  private config: RateLimiterConfig;
  private storage: RateLimitStorage;
  private onExceeded?: RateLimitEventHandler;
  private sortedRules: RateLimitRule[];

  constructor(
    config: Partial<RateLimiterConfig> = {},
    storage?: RateLimitStorage
  ) {
    this.config = {
      enabled: true,
      defaultAlgorithm: 'sliding-window',
      defaultLimit: 100,
      defaultWindowMs: 60000, // 1 minute
      rules: [],
      includeHeaders: true,
      ...config,
    };

    this.storage = storage || createStorage(this.config.storage);

    // Sort rules by priority (descending)
    this.sortedRules = [...this.config.rules].sort(
      (a, b) => (b.priority || 0) - (a.priority || 0)
    );
  }

  /**
   * Set event handler for rate limit exceeded events
   */
  onRateLimitExceeded(handler: RateLimitEventHandler): void {
    this.onExceeded = handler;
  }

  /**
   * Check if a request is allowed under rate limits
   */
  async check(context: RateLimitContext): Promise<RateLimitResult> {
    if (!this.config.enabled) {
      return this.createAllowedResult(Infinity, Infinity);
    }

    const rule = this.findMatchingRule(context);
    const key = this.generateKey(context, rule);
    const algorithm = rule?.algorithm || this.config.defaultAlgorithm;
    const limit = rule?.limit || this.config.defaultLimit;
    const windowMs = rule?.windowMs || this.config.defaultWindowMs;
    const cost = context.cost || 1;

    let result: RateLimitResult;

    switch (algorithm) {
      case 'token-bucket':
        result = await this.checkTokenBucket(key, rule, cost);
        break;
      case 'sliding-window':
        result = await this.checkSlidingWindow(key, limit, windowMs, cost);
        break;
      case 'fixed-window':
        result = await this.checkFixedWindow(key, limit, windowMs, cost);
        break;
      default:
        result = await this.checkSlidingWindow(key, limit, windowMs, cost);
    }

    result.rule = rule?.id;

    // Emit exceeded event
    if (!result.allowed && this.onExceeded) {
      this.onExceeded({
        timestamp: Date.now(),
        key,
        rule: rule?.id || 'default',
        principalId: context.principalId,
        resourceKind: context.resourceKind,
        action: context.action,
        limit,
        windowMs,
        remaining: result.remaining,
        resetAt: result.resetAt,
      });
    }

    return result;
  }

  /**
   * Check and consume rate limit in one operation
   * Returns the result and automatically consumes if allowed
   */
  async checkAndConsume(context: RateLimitContext): Promise<RateLimitResult> {
    return this.check(context);
  }

  /**
   * Get rate limit headers for HTTP response
   */
  getHeaders(result: RateLimitResult): RateLimitHeaders {
    const headers: RateLimitHeaders = {
      'X-RateLimit-Limit': String(result.limit),
      'X-RateLimit-Remaining': String(Math.max(0, result.remaining)),
      'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
    };

    if (!result.allowed) {
      headers['Retry-After'] = String(Math.ceil(result.retryAfterMs / 1000));
    }

    return headers;
  }

  /**
   * Reset rate limit for a specific key
   */
  async reset(context: RateLimitContext): Promise<void> {
    const rule = this.findMatchingRule(context);
    const key = this.generateKey(context, rule);
    // Clear all algorithm variants of this key
    await this.storage.delete(`ratelimit:tb:${key}`);
    await this.storage.delete(`ratelimit:sw:${key}`);
    await this.storage.delete(`ratelimit:fw:${key}:*`);
    // Also clear by pattern for fixed window which has timestamp suffix
    await this.storage.clear(`ratelimit:fw:${key}:*`);
  }

  /**
   * Get current rate limit status without consuming
   */
  async getStatus(context: RateLimitContext): Promise<RateLimitResult> {
    // Create a context with 0 cost to check without consuming
    return this.check({ ...context, cost: 0 });
  }

  /**
   * Add a new rate limit rule dynamically
   */
  addRule(rule: RateLimitRule): void {
    this.config.rules.push(rule);
    this.sortedRules = [...this.config.rules].sort(
      (a, b) => (b.priority || 0) - (a.priority || 0)
    );
  }

  /**
   * Remove a rate limit rule by ID
   */
  removeRule(ruleId: string): boolean {
    const index = this.config.rules.findIndex(r => r.id === ruleId);
    if (index !== -1) {
      this.config.rules.splice(index, 1);
      this.sortedRules = [...this.config.rules].sort(
        (a, b) => (b.priority || 0) - (a.priority || 0)
      );
      return true;
    }
    return false;
  }

  /**
   * Enable or disable rate limiting
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Check if rate limiting is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get storage statistics
   */
  getStorageStats() {
    return this.storage.getStats();
  }

  /**
   * Clear all rate limit state
   */
  async clearAll(): Promise<void> {
    await this.storage.clear('ratelimit:*');
  }

  /**
   * Close the rate limiter and cleanup resources
   */
  async close(): Promise<void> {
    await this.storage.close();
  }

  // =============================================================================
  // Private Methods - Algorithm Implementations
  // =============================================================================

  /**
   * Token Bucket Algorithm
   *
   * - Tokens are added at a fixed rate
   * - Each request consumes tokens
   * - Allows bursts up to bucket capacity
   */
  private async checkTokenBucket(
    key: string,
    rule: RateLimitRule | undefined,
    cost: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const capacity = rule?.bucketCapacity || rule?.limit || this.config.defaultLimit;
    const refillRate = rule?.refillRate || capacity / (this.config.defaultWindowMs / 1000);
    const prefixedKey = `ratelimit:tb:${key}`;

    // Get current state
    let state = await this.storage.get<TokenBucketState>(prefixedKey);

    if (!state) {
      state = {
        tokens: capacity,
        lastRefill: now,
      };
    }

    // Calculate token refill
    const elapsedMs = now - state.lastRefill;
    const refill = (elapsedMs / 1000) * refillRate;
    const currentTokens = Math.min(capacity, state.tokens + refill);

    if (currentTokens >= cost) {
      // Consume tokens
      const newTokens = currentTokens - cost;
      await this.storage.set<TokenBucketState>(
        prefixedKey,
        { tokens: newTokens, lastRefill: now },
        Math.ceil((capacity / refillRate) * 1000) * 2
      );

      return {
        allowed: true,
        remaining: Math.floor(newTokens),
        limit: capacity,
        resetAt: now + Math.ceil((capacity - newTokens) / refillRate * 1000),
        retryAfterMs: 0,
        tokens: newTokens,
        bucketCapacity: capacity,
      };
    }

    // Not enough tokens
    const waitTimeMs = Math.ceil((cost - currentTokens) / refillRate * 1000);

    // Update state even on denial to keep refill accurate
    await this.storage.set<TokenBucketState>(
      prefixedKey,
      { tokens: currentTokens, lastRefill: now },
      Math.ceil((capacity / refillRate) * 1000) * 2
    );

    return {
      allowed: false,
      remaining: 0,
      limit: capacity,
      resetAt: now + waitTimeMs,
      retryAfterMs: waitTimeMs,
      tokens: currentTokens,
      bucketCapacity: capacity,
    };
  }

  /**
   * Sliding Window Algorithm
   *
   * - Tracks individual request timestamps
   * - Provides smooth rate limiting
   * - More memory intensive but more accurate
   */
  private async checkSlidingWindow(
    key: string,
    limit: number,
    windowMs: number,
    cost: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - windowMs;
    const prefixedKey = `ratelimit:sw:${key}`;

    // Get current state
    let state = await this.storage.get<SlidingWindowState>(prefixedKey);

    if (!state) {
      state = { timestamps: [] };
    }

    // Remove expired timestamps
    const validTimestamps = state.timestamps.filter(ts => ts > windowStart);

    // Check if under limit
    if (validTimestamps.length + cost <= limit) {
      // Add new timestamps
      const newTimestamps = [...validTimestamps];
      for (let i = 0; i < cost; i++) {
        newTimestamps.push(now);
      }

      await this.storage.set<SlidingWindowState>(
        prefixedKey,
        { timestamps: newTimestamps },
        windowMs * 2
      );

      // Find oldest timestamp to calculate reset time
      const oldestTs = newTimestamps.length > 0 ? Math.min(...newTimestamps) : now;
      const resetAt = oldestTs + windowMs;

      return {
        allowed: true,
        remaining: limit - newTimestamps.length,
        limit,
        resetAt,
        retryAfterMs: 0,
      };
    }

    // Rate limited - save cleaned up state
    await this.storage.set<SlidingWindowState>(
      prefixedKey,
      { timestamps: validTimestamps },
      windowMs * 2
    );

    // Calculate when oldest request expires
    const oldestTs = validTimestamps.length > 0 ? Math.min(...validTimestamps) : now;
    const resetAt = oldestTs + windowMs;

    return {
      allowed: false,
      remaining: 0,
      limit,
      resetAt,
      retryAfterMs: resetAt - now,
    };
  }

  /**
   * Fixed Window Algorithm
   *
   * - Simple counter per time window
   * - Less accurate at window boundaries
   * - Very memory efficient
   */
  private async checkFixedWindow(
    key: string,
    limit: number,
    windowMs: number,
    cost: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const windowEnd = windowStart + windowMs;
    const prefixedKey = `ratelimit:fw:${key}:${windowStart}`;

    // Get current state
    let state = await this.storage.get<FixedWindowState>(prefixedKey);

    if (!state || state.windowStart !== windowStart) {
      state = { count: 0, windowStart };
    }

    // Check if under limit
    if (state.count + cost <= limit) {
      const newCount = state.count + cost;

      await this.storage.set<FixedWindowState>(
        prefixedKey,
        { count: newCount, windowStart },
        windowMs * 2
      );

      return {
        allowed: true,
        remaining: limit - newCount,
        limit,
        resetAt: windowEnd,
        retryAfterMs: 0,
      };
    }

    return {
      allowed: false,
      remaining: 0,
      limit,
      resetAt: windowEnd,
      retryAfterMs: windowEnd - now,
    };
  }

  // =============================================================================
  // Private Methods - Utilities
  // =============================================================================

  /**
   * Find the matching rule for a context
   */
  private findMatchingRule(context: RateLimitContext): RateLimitRule | undefined {
    for (const rule of this.sortedRules) {
      if (rule.skip) continue;

      // Check principal match
      if (rule.principals && rule.principals.length > 0) {
        if (!context.principalId || !rule.principals.includes(context.principalId)) {
          continue;
        }
      }

      // Check resource match
      if (rule.resources && rule.resources.length > 0) {
        if (!context.resourceKind || !rule.resources.includes(context.resourceKind)) {
          continue;
        }
      }

      // Check action match
      if (rule.actions && rule.actions.length > 0) {
        if (!context.action || !rule.actions.includes(context.action)) {
          continue;
        }
      }

      return rule;
    }

    return undefined;
  }

  /**
   * Generate a cache key for rate limiting
   */
  private generateKey(context: RateLimitContext, rule?: RateLimitRule): string {
    if (context.customKey) {
      return context.customKey;
    }

    const scope = rule?.scope || 'global';
    const parts: string[] = [];

    switch (scope) {
      case 'principal':
        parts.push(`p:${context.principalId || 'anonymous'}`);
        break;
      case 'resource':
        parts.push(`r:${context.resourceKind || 'unknown'}`);
        if (context.resourceId) {
          parts.push(context.resourceId);
        }
        break;
      case 'principal-resource':
        parts.push(`p:${context.principalId || 'anonymous'}`);
        parts.push(`r:${context.resourceKind || 'unknown'}`);
        if (context.resourceId) {
          parts.push(context.resourceId);
        }
        break;
      case 'global':
      default:
        parts.push('global');
    }

    if (rule?.id) {
      parts.unshift(`rule:${rule.id}`);
    }

    return parts.join(':');
  }

  /**
   * Create an allowed result
   */
  private createAllowedResult(limit: number, remaining: number): RateLimitResult {
    return {
      allowed: true,
      remaining,
      limit,
      resetAt: Date.now() + this.config.defaultWindowMs,
      retryAfterMs: 0,
    };
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a rate limiter with default configuration
 */
export function createRateLimiter(
  config?: Partial<RateLimiterConfig>,
  storage?: RateLimitStorage
): RateLimiter {
  return new RateLimiter(config, storage);
}

/**
 * Create a rate limiter with common presets
 */
export function createRateLimiterWithPreset(
  preset: 'strict' | 'moderate' | 'lenient'
): RateLimiter {
  const presets: Record<string, Partial<RateLimiterConfig>> = {
    strict: {
      defaultLimit: 10,
      defaultWindowMs: 60000, // 10 req/min
      defaultAlgorithm: 'sliding-window',
    },
    moderate: {
      defaultLimit: 100,
      defaultWindowMs: 60000, // 100 req/min
      defaultAlgorithm: 'sliding-window',
    },
    lenient: {
      defaultLimit: 1000,
      defaultWindowMs: 60000, // 1000 req/min
      defaultAlgorithm: 'token-bucket',
    },
  };

  return new RateLimiter(presets[preset] || presets.moderate);
}
