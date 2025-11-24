/**
 * CEL Expression Evaluator
 *
 * Production-grade Common Expression Language (CEL) evaluator using cel-js.
 * Provides type-safe expression parsing, caching, and evaluation with
 * Cerbos-compatible context structure.
 *
 * @module @authz-engine/core/cel
 */

import {
  parse,
  evaluate,
  type ParseResult,
  type Success,
  CelParseError,
  CelEvaluationError,
} from 'cel-js';
import type { Principal, Resource } from '../types';

/**
 * Custom type error for CEL expression type mismatches.
 * Used instead of cel-js CelTypeError which has a different constructor signature.
 */
class CelExpressionTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CelExpressionTypeError';
  }
}

/**
 * Context available during CEL expression evaluation.
 * Follows Cerbos-compatible structure for policy portability.
 */
export interface EvaluationContext {
  /** The principal (user/service) making the request */
  readonly principal: Principal;
  /** The resource being accessed */
  readonly resource: Resource;
  /** Additional auxiliary data for complex conditions */
  readonly auxData?: Readonly<Record<string, unknown>>;
  /** Current timestamp for time-based conditions */
  readonly now?: Date;
}

/**
 * Result of CEL expression evaluation
 */
export interface EvaluationResult {
  /** Whether evaluation completed successfully */
  readonly success: boolean;
  /** Result value (typically boolean for policy conditions) */
  readonly value?: unknown;
  /** Error message if evaluation failed */
  readonly error?: string;
  /** Error type for categorization */
  readonly errorType?: 'parse' | 'evaluation' | 'type' | 'unknown';
}

/**
 * Validation result for CEL expressions
 */
export interface ValidationResult {
  /** Whether the expression is syntactically valid */
  readonly valid: boolean;
  /** Parse errors if invalid */
  readonly errors?: readonly string[];
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  /** Number of cached expressions */
  readonly size: number;
  /** Cache hit count */
  readonly hits: number;
  /** Cache miss count */
  readonly misses: number;
  /** Hit rate percentage */
  readonly hitRate: number;
}

/**
 * Custom CEL functions available during evaluation
 */
type CelFunctions = Record<string, (...args: unknown[]) => unknown>;

/**
 * Parsed CST type from cel-js Success result
 */
type ParsedCst = Success['cst'];

/**
 * Cached parsed expression
 */
interface CachedExpression {
  readonly cst: ParsedCst;
  readonly createdAt: number;
}

/**
 * Production CEL Expression Evaluator
 *
 * Uses cel-js for proper CEL parsing and evaluation.
 * Provides expression caching, Cerbos-compatible context, and custom functions.
 *
 * @example
 * ```typescript
 * const evaluator = new CelEvaluator();
 *
 * const context: EvaluationContext = {
 *   principal: { id: 'user1', roles: ['admin'], attributes: {} },
 *   resource: { kind: 'document', id: 'doc1', attributes: { ownerId: 'user1' } }
 * };
 *
 * // Evaluate ownership check
 * const result = evaluator.evaluateBoolean(
 *   'resource.ownerId == principal.id',
 *   context
 * );
 * ```
 */
export class CelEvaluator {
  private readonly expressionCache: Map<string, CachedExpression>;
  private readonly maxCacheSize: number;
  private readonly cacheTtlMs: number;
  private cacheHits: number = 0;
  private cacheMisses: number = 0;

  /**
   * Custom functions available in CEL expressions
   */
  private readonly customFunctions: CelFunctions;

  /** Default cache size for CEL expressions */
  private static readonly DEFAULT_CACHE_SIZE = 1000;
  /** Default cache TTL: 1 hour in milliseconds */
  private static readonly DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
  /** Cache eviction percentage when full */
  private static readonly CACHE_EVICTION_PERCENTAGE = 0.1;

  constructor(options?: {
    /** Maximum number of cached expressions (default: 1000) */
    maxCacheSize?: number;
    /** Cache TTL in milliseconds (default: 1 hour) */
    cacheTtlMs?: number;
  }) {
    this.expressionCache = new Map();
    this.maxCacheSize = options?.maxCacheSize ?? CelEvaluator.DEFAULT_CACHE_SIZE;
    this.cacheTtlMs = options?.cacheTtlMs ?? CelEvaluator.DEFAULT_CACHE_TTL_MS;

    // Define custom CEL functions
    this.customFunctions = this.buildCustomFunctions();
  }

  /**
   * Evaluate a CEL expression with the given context
   *
   * @param expression - CEL expression string
   * @param context - Evaluation context with principal/resource data
   * @returns Evaluation result with success status and value/error
   */
  evaluate(expression: string, context: EvaluationContext): EvaluationResult {
    try {
      // Get or parse the expression
      const cst = this.getOrParseExpression(expression);

      // Build the evaluation context
      const evalContext = this.buildEvalContext(context);

      // Evaluate using cel-js
      const value = evaluate(cst, evalContext, this.customFunctions);

      return {
        success: true,
        value,
      };
    } catch (error) {
      return this.handleEvaluationError(error);
    }
  }

  /**
   * Evaluate a CEL expression and expect a boolean result.
   * Returns false on error (fail-closed for security).
   *
   * @param expression - CEL expression string
   * @param context - Evaluation context
   * @returns Boolean result (false on error)
   */
  evaluateBoolean(expression: string, context: EvaluationContext): boolean {
    const result = this.evaluate(expression, context);

    if (!result.success) {
      // Fail-closed: deny on error for security
      return false;
    }

    // Strict boolean check - must be exactly true
    return result.value === true;
  }

  /**
   * Validate that an expression is syntactically correct CEL
   *
   * @param expression - CEL expression to validate
   * @returns Validation result with any parse errors
   */
  validateExpression(expression: string): ValidationResult {
    const parseResult = parse(expression);

    if (parseResult.isSuccess) {
      return { valid: true };
    }

    return {
      valid: false,
      errors: parseResult.errors,
    };
  }

  /**
   * Pre-compile and cache an expression for faster repeated evaluation
   *
   * @param expression - CEL expression to compile
   * @throws CelParseError if expression is invalid
   */
  compileExpression(expression: string): void {
    this.getOrParseExpression(expression);
  }

  /**
   * Get or parse an expression, using cache when available
   */
  private getOrParseExpression(expression: string): ParsedCst {
    const cached = this.expressionCache.get(expression);
    const now = Date.now();

    if (cached && now - cached.createdAt < this.cacheTtlMs) {
      this.cacheHits++;
      return cached.cst;
    }

    this.cacheMisses++;

    // Parse the expression
    const parseResult: ParseResult = parse(expression);

    if (!parseResult.isSuccess) {
      throw new CelParseError(
        `Failed to parse CEL expression: ${parseResult.errors.join(', ')}`
      );
    }

    const successResult = parseResult as Success;

    // Cache the parsed expression
    this.cacheExpression(expression, successResult.cst, now);

    return successResult.cst;
  }

  /**
   * Cache a parsed expression, evicting old entries if needed
   */
  private cacheExpression(expression: string, cst: ParsedCst, now: number): void {
    // Evict oldest entries if at capacity
    if (this.expressionCache.size >= this.maxCacheSize) {
      this.evictOldestEntries(Math.floor(this.maxCacheSize * CelEvaluator.CACHE_EVICTION_PERCENTAGE));
    }

    this.expressionCache.set(expression, { cst, createdAt: now });
  }

  /**
   * Evict the oldest N entries from the cache
   */
  private evictOldestEntries(count: number): void {
    const entries = Array.from(this.expressionCache.entries())
      .sort((a, b) => a[1].createdAt - b[1].createdAt);

    for (let i = 0; i < count && i < entries.length; i++) {
      this.expressionCache.delete(entries[i][0]);
    }
  }

  /**
   * Build the evaluation context for cel-js.
   * Creates a Cerbos-compatible structure.
   */
  private buildEvalContext(context: EvaluationContext): Record<string, unknown> {
    const now = context.now ?? new Date();

    const principalData = {
      id: context.principal.id,
      roles: context.principal.roles,
      attr: context.principal.attributes,
    };

    const resourceData = {
      kind: context.resource.kind,
      id: context.resource.id,
      attr: context.resource.attributes,
    };

    return {
      // Cerbos-style request object
      request: {
        principal: principalData,
        resource: resourceData,
        auxData: context.auxData ?? {},
      },

      // Direct access for convenience (Cerbos shorthand)
      principal: {
        id: context.principal.id,
        roles: context.principal.roles,
        ...context.principal.attributes,
      },
      resource: {
        kind: context.resource.kind,
        id: context.resource.id,
        ...context.resource.attributes,
      },

      // Shorthand variables (P, R, A)
      P: principalData,
      R: resourceData,
      A: context.auxData ?? {},

      // Variables section (for auxData)
      variables: context.auxData ?? {},

      // Time values
      now: now,
      nowTimestamp: now.getTime(),
    };
  }

  /**
   * Build custom CEL functions
   */
  private buildCustomFunctions(): CelFunctions {
    return {
      // Time functions
      timestamp: (value: unknown): Date => {
        if (typeof value === 'string') {
          return new Date(value);
        }
        if (typeof value === 'number') {
          return new Date(value);
        }
        throw new CelExpressionTypeError('timestamp() requires string or number');
      },

      duration: (value: unknown): number => {
        if (typeof value !== 'string') {
          throw new CelExpressionTypeError('duration() requires string');
        }
        return this.parseDuration(value);
      },

      // Collection functions
      size: (value: unknown): number => {
        if (Array.isArray(value)) {
          return value.length;
        }
        if (typeof value === 'string') {
          return value.length;
        }
        if (value && typeof value === 'object') {
          return Object.keys(value).length;
        }
        return 0;
      },

      // Type checking functions
      type: (value: unknown): string => {
        if (value === null) return 'null';
        if (Array.isArray(value)) return 'list';
        return typeof value;
      },

      // String functions
      startsWith: (str: unknown, prefix: unknown): boolean => {
        if (typeof str !== 'string' || typeof prefix !== 'string') {
          return false;
        }
        return str.startsWith(prefix);
      },

      endsWith: (str: unknown, suffix: unknown): boolean => {
        if (typeof str !== 'string' || typeof suffix !== 'string') {
          return false;
        }
        return str.endsWith(suffix);
      },

      contains: (str: unknown, substr: unknown): boolean => {
        if (typeof str !== 'string' || typeof substr !== 'string') {
          return false;
        }
        return str.includes(substr);
      },

      matches: (str: unknown, pattern: unknown): boolean => {
        if (typeof str !== 'string' || typeof pattern !== 'string') {
          return false;
        }
        try {
          return new RegExp(pattern).test(str);
        } catch {
          return false;
        }
      },

      // List functions
      exists: (list: unknown, predicate: unknown): boolean => {
        if (!Array.isArray(list) || typeof predicate !== 'function') {
          return false;
        }
        return list.some(predicate as (item: unknown) => boolean);
      },

      all: (list: unknown, predicate: unknown): boolean => {
        if (!Array.isArray(list) || typeof predicate !== 'function') {
          return false;
        }
        return list.every(predicate as (item: unknown) => boolean);
      },

      // IP address functions (useful for network policies)
      inIPRange: (ip: unknown, cidr: unknown): boolean => {
        if (typeof ip !== 'string' || typeof cidr !== 'string') {
          return false;
        }
        return this.ipInCidr(ip, cidr);
      },
    };
  }

  /**
   * Parse a duration string to milliseconds
   * Supports: s (seconds), m (minutes), h (hours), d (days)
   */
  private parseDuration(str: string): number {
    const match = str.match(/^(\d+)(s|m|h|d)$/);
    if (!match) {
      throw new CelExpressionTypeError(`Invalid duration format: ${str}`);
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return value * multipliers[unit];
  }

  /**
   * Check if an IP address is within a CIDR range
   */
  private ipInCidr(ip: string, cidr: string): boolean {
    const [range, bitsStr] = cidr.split('/');
    if (!range || !bitsStr) return false;

    const bits = parseInt(bitsStr, 10);
    if (isNaN(bits) || bits < 0 || bits > 32) return false;

    const ipNum = this.ipToNumber(ip);
    const rangeNum = this.ipToNumber(range);

    if (ipNum === null || rangeNum === null) return false;

    const mask = ~((1 << (32 - bits)) - 1);
    return (ipNum & mask) === (rangeNum & mask);
  }

  /**
   * Convert IP address string to number
   */
  private ipToNumber(ip: string): number | null {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;

    let result = 0;
    for (const part of parts) {
      const num = parseInt(part, 10);
      if (isNaN(num) || num < 0 || num > 255) return null;
      result = (result << 8) | num;
    }
    return result >>> 0; // Convert to unsigned
  }

  /**
   * Handle evaluation errors with proper categorization
   */
  private handleEvaluationError(error: unknown): EvaluationResult {
    if (error instanceof CelParseError) {
      return {
        success: false,
        error: error.message,
        errorType: 'parse',
      };
    }

    if (error instanceof CelEvaluationError) {
      return {
        success: false,
        error: error.message,
        errorType: 'evaluation',
      };
    }

    if (error instanceof CelExpressionTypeError) {
      return {
        success: false,
        error: error.message,
        errorType: 'type',
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      errorType: 'unknown',
    };
  }

  /**
   * Clear the expression cache
   */
  clearCache(): void {
    this.expressionCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    const total = this.cacheHits + this.cacheMisses;
    return {
      size: this.expressionCache.size,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? (this.cacheHits / total) * 100 : 0,
    };
  }
}

/**
 * Default evaluator instance for convenience.
 * For production use, create a configured instance.
 */
export const celEvaluator = new CelEvaluator();
