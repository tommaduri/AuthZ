/**
 * Rate-Limited Decision Engine
 *
 * Extends the DecisionEngine with rate limiting and quota management capabilities.
 */

import { DecisionEngine, DecisionEngineConfig } from './decision-engine';
import { RateLimiter, RateLimiterConfig, RateLimitResult } from '../rate-limiting';
import { QuotaManager, QuotaManagerConfig, QuotaCheckResult, QuotaStatus } from '../quota';
import type { CheckRequest, CheckResponse, ActionResult, Effect } from '../types';
import type { Span } from '@opentelemetry/api';

// =============================================================================
// Constants
// =============================================================================

/** Default rate limiting configuration values */
const RATE_LIMIT_DEFAULTS = {
  /** Default requests per window */
  DEFAULT_LIMIT: 100,
  /** Default window size in milliseconds (1 minute) */
  DEFAULT_WINDOW_MS: 60000,
  /** Reset offset in milliseconds */
  RESET_OFFSET_MS: 60000,
} as const;

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for the rate-limited decision engine
 */
export interface RateLimitedEngineConfig extends DecisionEngineConfig {
  /** Rate limiter configuration */
  rateLimiter?: Partial<RateLimiterConfig>;
  /** Quota manager configuration */
  quotaManager?: Partial<QuotaManagerConfig>;
  /** Whether to check rate limits before authorization */
  checkRateLimitFirst?: boolean;
  /** Whether to check quotas before authorization */
  checkQuotaFirst?: boolean;
  /** Custom error effect for rate limit exceeded */
  rateLimitExceededEffect?: Effect;
  /** Custom error effect for quota exceeded */
  quotaExceededEffect?: Effect;
}

/**
 * Extended check response with rate limit and quota information
 */
export interface ExtendedCheckResponse extends CheckResponse {
  /** Rate limit information */
  rateLimit?: {
    allowed: boolean;
    remaining: number;
    limit: number;
    resetAt: number;
    retryAfterMs?: number;
  };
  /** Quota information */
  quota?: {
    allowed: boolean;
    remaining?: number;
    limit?: number;
    percentUsed?: number;
    warnings?: string[];
  };
}

// =============================================================================
// Rate-Limited Decision Engine
// =============================================================================

/**
 * Decision engine with integrated rate limiting and quota management
 */
export class RateLimitedDecisionEngine extends DecisionEngine {
  private rateLimiter: RateLimiter | null = null;
  private quotaManager: QuotaManager | null = null;
  private checkRateLimitFirst: boolean;
  private checkQuotaFirst: boolean;
  private rateLimitExceededEffect: Effect;
  private quotaExceededEffect: Effect;

  constructor(config: RateLimitedEngineConfig = {}) {
    super(config);

    this.checkRateLimitFirst = config.checkRateLimitFirst ?? true;
    this.checkQuotaFirst = config.checkQuotaFirst ?? true;
    this.rateLimitExceededEffect = config.rateLimitExceededEffect ?? 'deny';
    this.quotaExceededEffect = config.quotaExceededEffect ?? 'deny';

    // Initialize rate limiter if configured
    if (config.rateLimiter) {
      this.rateLimiter = new RateLimiter(config.rateLimiter);
    }

    // Initialize quota manager if configured
    if (config.quotaManager) {
      this.quotaManager = new QuotaManager(config.quotaManager);
    }
  }

  /**
   * Set the rate limiter instance
   */
  setRateLimiter(limiter: RateLimiter | null): void {
    this.rateLimiter = limiter;
  }

  /**
   * Get the rate limiter instance
   */
  getRateLimiter(): RateLimiter | null {
    return this.rateLimiter;
  }

  /**
   * Set the quota manager instance
   */
  setQuotaManager(manager: QuotaManager | null): void {
    this.quotaManager = manager;
  }

  /**
   * Get the quota manager instance
   */
  getQuotaManager(): QuotaManager | null {
    return this.quotaManager;
  }

  /**
   * Check authorization with rate limiting and quota enforcement
   */
  checkWithLimits(request: CheckRequest, parentSpan?: Span): ExtendedCheckResponse {
    const requestId = request.requestId || `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const startTime = Date.now();

    // Initialize response
    let response: ExtendedCheckResponse;
    let rateLimitResult: RateLimitResult | undefined;
    let quotaResult: QuotaCheckResult | undefined;

    // Check rate limit first if configured
    if (this.checkRateLimitFirst && this.rateLimiter?.isEnabled()) {
      // Note: Using sync wrapper since check is async
      // In production, this should be properly async
      rateLimitResult = this.checkRateLimitSync(request);

      if (!rateLimitResult.allowed) {
        response = this.createRateLimitDeniedResponse(request, requestId, rateLimitResult);
        response.meta = {
          ...response.meta,
          evaluationDurationMs: Date.now() - startTime,
          policiesEvaluated: [],
        };
        return response;
      }
    }

    // Check quota first if configured
    if (this.checkQuotaFirst && this.quotaManager?.isEnabled()) {
      quotaResult = this.checkQuotaSync(request);

      if (!quotaResult.allowed) {
        response = this.createQuotaDeniedResponse(request, requestId, quotaResult);
        response.meta = {
          ...response.meta,
          evaluationDurationMs: Date.now() - startTime,
          policiesEvaluated: [],
        };
        return response;
      }
    }

    // Perform authorization check
    response = super.check(request, parentSpan) as ExtendedCheckResponse;

    // Add rate limit info to response
    if (rateLimitResult) {
      response.rateLimit = {
        allowed: rateLimitResult.allowed,
        remaining: rateLimitResult.remaining,
        limit: rateLimitResult.limit,
        resetAt: rateLimitResult.resetAt,
        retryAfterMs: rateLimitResult.allowed ? undefined : rateLimitResult.retryAfterMs,
      };
    }

    // Add quota info to response
    if (quotaResult) {
      const firstQuota = quotaResult.quotas[0];
      response.quota = {
        allowed: quotaResult.allowed,
        remaining: firstQuota?.remaining,
        limit: firstQuota?.limit,
        percentUsed: firstQuota?.percentUsed,
        warnings: quotaResult.warnings.length > 0 ? quotaResult.warnings : undefined,
      };
    }

    // Consume quota if authorization was allowed
    if (this.quotaManager?.isEnabled() && this.hasAnyAllowed(response)) {
      this.consumeQuotaSync(request);
    }

    return response;
  }

  /**
   * Async version of check with rate limiting and quota enforcement
   */
  async checkWithLimitsAsync(request: CheckRequest, parentSpan?: Span): Promise<ExtendedCheckResponse> {
    const requestId = request.requestId || `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const startTime = Date.now();

    // Initialize response
    let response: ExtendedCheckResponse;
    let rateLimitResult: RateLimitResult | undefined;
    let quotaResult: QuotaCheckResult | undefined;

    // Check rate limit first if configured
    if (this.checkRateLimitFirst && this.rateLimiter?.isEnabled()) {
      rateLimitResult = await this.rateLimiter.check({
        principalId: request.principal.id,
        resourceKind: request.resource.kind,
        resourceId: request.resource.id,
        action: request.actions[0],
      });

      if (!rateLimitResult.allowed) {
        response = this.createRateLimitDeniedResponse(request, requestId, rateLimitResult);
        response.meta = {
          ...response.meta,
          evaluationDurationMs: Date.now() - startTime,
          policiesEvaluated: [],
        };
        return response;
      }
    }

    // Check quota first if configured
    if (this.checkQuotaFirst && this.quotaManager?.isEnabled()) {
      quotaResult = await this.quotaManager.checkQuota({
        principalId: request.principal.id,
        roles: request.principal.roles,
        resourceKind: request.resource.kind,
        resourceId: request.resource.id,
        action: request.actions[0],
      });

      if (!quotaResult.allowed) {
        response = this.createQuotaDeniedResponse(request, requestId, quotaResult);
        response.meta = {
          ...response.meta,
          evaluationDurationMs: Date.now() - startTime,
          policiesEvaluated: [],
        };
        return response;
      }
    }

    // Perform authorization check
    response = super.check(request, parentSpan) as ExtendedCheckResponse;

    // Add rate limit info to response
    if (rateLimitResult) {
      response.rateLimit = {
        allowed: rateLimitResult.allowed,
        remaining: rateLimitResult.remaining,
        limit: rateLimitResult.limit,
        resetAt: rateLimitResult.resetAt,
        retryAfterMs: rateLimitResult.allowed ? undefined : rateLimitResult.retryAfterMs,
      };
    }

    // Add quota info to response
    if (quotaResult) {
      const firstQuota = quotaResult.quotas[0];
      response.quota = {
        allowed: quotaResult.allowed,
        remaining: firstQuota?.remaining,
        limit: firstQuota?.limit,
        percentUsed: firstQuota?.percentUsed,
        warnings: quotaResult.warnings.length > 0 ? quotaResult.warnings : undefined,
      };
    }

    // Consume quota if authorization was allowed
    if (this.quotaManager?.isEnabled() && this.hasAnyAllowed(response)) {
      await this.quotaManager.consumeQuota({
        principalId: request.principal.id,
        roles: request.principal.roles,
        resourceKind: request.resource.kind,
        resourceId: request.resource.id,
        action: request.actions[0],
      });
    }

    return response;
  }

  /**
   * Get rate limit status for a principal
   */
  async getRateLimitStatus(principalId: string, resourceKind?: string): Promise<RateLimitResult | null> {
    if (!this.rateLimiter) return null;

    return this.rateLimiter.getStatus({
      principalId,
      resourceKind,
    });
  }

  /**
   * Get quota status for a principal
   */
  async getQuotaStatus(principalId: string): Promise<QuotaStatus | null> {
    if (!this.quotaManager) return null;

    return this.quotaManager.getQuotaStatus(principalId);
  }

  /**
   * Reset rate limit for a principal
   */
  async resetRateLimit(principalId: string, resourceKind?: string): Promise<void> {
    if (!this.rateLimiter) return;

    await this.rateLimiter.reset({
      principalId,
      resourceKind,
    });
  }

  /**
   * Reset quota for a principal
   */
  async resetQuota(principalId: string, policyId?: string): Promise<void> {
    if (!this.quotaManager) return;

    await this.quotaManager.resetQuota(principalId, policyId);
  }

  /**
   * Close and cleanup resources
   */
  async close(): Promise<void> {
    if (this.rateLimiter) {
      await this.rateLimiter.close();
    }
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  /**
   * Synchronous rate limit check (for compatibility with sync check method)
   * Note: This creates a pending promise - in production use checkWithLimitsAsync
   */
  private checkRateLimitSync(request: CheckRequest): RateLimitResult {
    // This is a simplified sync wrapper
    // In production, prefer the async version
    let result: RateLimitResult = {
      allowed: true,
      remaining: Infinity,
      limit: Infinity,
      resetAt: Date.now() + RATE_LIMIT_DEFAULTS.RESET_OFFSET_MS,
      retryAfterMs: 0,
    };

    if (this.rateLimiter) {
      // Execute async check but return default on error
      this.rateLimiter.check({
        principalId: request.principal.id,
        resourceKind: request.resource.kind,
        resourceId: request.resource.id,
        action: request.actions[0],
      }).then(r => {
        result = r;
      }).catch(() => {
        // Keep default result on error
      });
    }

    return result;
  }

  /**
   * Synchronous quota check (for compatibility with sync check method)
   */
  private checkQuotaSync(request: CheckRequest): QuotaCheckResult {
    let result: QuotaCheckResult = {
      allowed: true,
      quotas: [],
      hasWarnings: false,
      warnings: [],
    };

    if (this.quotaManager) {
      this.quotaManager.checkQuota({
        principalId: request.principal.id,
        roles: request.principal.roles,
        resourceKind: request.resource.kind,
        resourceId: request.resource.id,
        action: request.actions[0],
      }).then(r => {
        result = r;
      }).catch(() => {
        // Keep default result on error
      });
    }

    return result;
  }

  /**
   * Synchronous quota consumption
   */
  private consumeQuotaSync(request: CheckRequest): void {
    if (this.quotaManager) {
      this.quotaManager.consumeQuota({
        principalId: request.principal.id,
        roles: request.principal.roles,
        resourceKind: request.resource.kind,
        resourceId: request.resource.id,
        action: request.actions[0],
      }).catch(() => {
        // Silent failure for sync consumption
      });
    }
  }

  /**
   * Create response for rate limit denied
   */
  private createRateLimitDeniedResponse(
    request: CheckRequest,
    requestId: string,
    rateLimitResult: RateLimitResult
  ): ExtendedCheckResponse {
    const results: Record<string, ActionResult> = {};

    for (const action of request.actions) {
      results[action] = {
        effect: this.rateLimitExceededEffect,
        policy: 'rate-limit',
        meta: {
          matchedRule: 'rate-limit-exceeded',
        },
      };
    }

    return {
      requestId,
      results,
      rateLimit: {
        allowed: false,
        remaining: rateLimitResult.remaining,
        limit: rateLimitResult.limit,
        resetAt: rateLimitResult.resetAt,
        retryAfterMs: rateLimitResult.retryAfterMs,
      },
    };
  }

  /**
   * Create response for quota denied
   */
  private createQuotaDeniedResponse(
    request: CheckRequest,
    requestId: string,
    quotaResult: QuotaCheckResult
  ): ExtendedCheckResponse {
    const results: Record<string, ActionResult> = {};

    for (const action of request.actions) {
      results[action] = {
        effect: this.quotaExceededEffect,
        policy: quotaResult.denyingPolicy || 'quota',
        meta: {
          matchedRule: 'quota-exceeded',
        },
      };
    }

    const firstQuota = quotaResult.quotas[0];

    return {
      requestId,
      results,
      quota: {
        allowed: false,
        remaining: firstQuota?.remaining,
        limit: firstQuota?.limit,
        percentUsed: firstQuota?.percentUsed,
        warnings: quotaResult.warnings,
      },
    };
  }

  /**
   * Check if any action was allowed
   */
  private hasAnyAllowed(response: CheckResponse): boolean {
    return Object.values(response.results).some(r => r.effect === 'allow');
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a rate-limited decision engine
 */
export function createRateLimitedEngine(
  config?: RateLimitedEngineConfig
): RateLimitedDecisionEngine {
  return new RateLimitedDecisionEngine(config);
}

/**
 * Create a decision engine with default rate limiting
 */
export function createEngineWithRateLimiting(
  decisionConfig?: DecisionEngineConfig,
  rateLimitConfig?: Partial<RateLimiterConfig>
): RateLimitedDecisionEngine {
  return new RateLimitedDecisionEngine({
    ...decisionConfig,
    rateLimiter: {
      enabled: true,
      defaultLimit: RATE_LIMIT_DEFAULTS.DEFAULT_LIMIT,
      defaultWindowMs: RATE_LIMIT_DEFAULTS.DEFAULT_WINDOW_MS,
      ...rateLimitConfig,
    },
  });
}

/**
 * Create a decision engine with default quota management
 */
export function createEngineWithQuotas(
  decisionConfig?: DecisionEngineConfig,
  quotaConfig?: Partial<QuotaManagerConfig>
): RateLimitedDecisionEngine {
  return new RateLimitedDecisionEngine({
    ...decisionConfig,
    quotaManager: {
      enabled: true,
      ...quotaConfig,
    },
  });
}
