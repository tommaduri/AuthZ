/**
 * Production Middleware
 *
 * Comprehensive middleware stack for production deployments:
 * - Circuit breaker for downstream protection
 * - Request rate limiting
 * - Request validation
 * - Compression
 * - Security headers
 * - Request logging
 * - Metrics collection
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';

// ==========================================================================
// Circuit Breaker
// ==========================================================================

export interface CircuitBreakerConfig {
  /** Failure threshold before opening circuit */
  failureThreshold: number;
  /** Time window for failure counting (ms) */
  failureWindow: number;
  /** Time to wait before attempting reset (ms) */
  resetTimeout: number;
  /** Timeout for individual requests (ms) */
  requestTimeout: number;
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures: number[] = [];
  private lastFailureTime = 0;
  private halfOpenAttempts = 0;
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: 5,
      failureWindow: 60000, // 1 minute
      resetTimeout: 30000,  // 30 seconds
      requestTimeout: 10000, // 10 seconds
      ...config,
    };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime >= this.config.resetTimeout) {
        this.state = 'half-open';
        this.halfOpenAttempts = 0;
      } else {
        throw new CircuitBreakerError('Circuit is open');
      }
    }

    // Half-open: limit attempts
    if (this.state === 'half-open' && this.halfOpenAttempts >= 1) {
      throw new CircuitBreakerError('Circuit is half-open, waiting for probe');
    }

    try {
      // Execute with timeout
      const result = await this.withTimeout(fn(), this.config.requestTimeout);

      // Success - reset if half-open
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failures = [];
      }

      return result;
    } catch (error) {
      this.recordFailure();

      if (this.state === 'half-open') {
        this.state = 'open';
        this.lastFailureTime = Date.now();
      }

      throw error;
    }
  }

  private recordFailure(): void {
    const now = Date.now();
    this.failures = this.failures.filter(
      t => now - t < this.config.failureWindow
    );
    this.failures.push(now);

    if (this.failures.length >= this.config.failureThreshold) {
      this.state = 'open';
      this.lastFailureTime = now;
    }
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timeoutId: NodeJS.Timeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Request timeout'));
      }, ms);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutId!);
      return result;
    } catch (error) {
      clearTimeout(timeoutId!);
      throw error;
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getFailureCount(): number {
    const now = Date.now();
    this.failures = this.failures.filter(
      t => now - t < this.config.failureWindow
    );
    return this.failures.length;
  }

  reset(): void {
    this.state = 'closed';
    this.failures = [];
    this.halfOpenAttempts = 0;
  }
}

export class CircuitBreakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

// ==========================================================================
// Rate Limiter
// ==========================================================================

export interface RateLimitConfig {
  /** Maximum requests per window */
  max: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Key generator function */
  keyGenerator?: (request: FastifyRequest) => string;
  /** Skip function */
  skip?: (request: FastifyRequest) => boolean;
  /** Message when rate limited */
  message?: string;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

export class RateLimiter {
  private store: Map<string, RateLimitEntry> = new Map();
  private config: RateLimitConfig;

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = {
      max: 100,
      windowMs: 60000, // 1 minute
      keyGenerator: (request) => request.ip || 'unknown',
      message: 'Too many requests, please try again later',
      ...config,
    };

    // Cleanup expired entries periodically
    setInterval(() => this.cleanup(), this.config.windowMs);
  }

  /**
   * Check if request should be rate limited
   */
  check(request: FastifyRequest): { allowed: boolean; remaining: number; resetTime: number } {
    // Check skip condition
    if (this.config.skip?.(request)) {
      return { allowed: true, remaining: this.config.max, resetTime: 0 };
    }

    const key = this.config.keyGenerator!(request);
    const now = Date.now();
    let entry = this.store.get(key);

    // Create new entry or reset expired
    if (!entry || entry.resetTime <= now) {
      entry = {
        count: 0,
        resetTime: now + this.config.windowMs,
      };
    }

    entry.count++;
    this.store.set(key, entry);

    const remaining = Math.max(0, this.config.max - entry.count);
    const allowed = entry.count <= this.config.max;

    return { allowed, remaining, resetTime: entry.resetTime };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetTime <= now) {
        this.store.delete(key);
      }
    }
  }
}

// ==========================================================================
// Middleware Registration
// ==========================================================================

export interface ProductionMiddlewareConfig {
  /** Enable rate limiting */
  rateLimit?: RateLimitConfig;
  /** Enable circuit breaker */
  circuitBreaker?: CircuitBreakerConfig;
  /** Enable compression */
  compression?: boolean;
  /** Enable security headers */
  securityHeaders?: boolean;
  /** Enable request logging */
  requestLogging?: boolean;
  /** Trusted proxies for X-Forwarded-For */
  trustProxy?: boolean | string[];
}

/**
 * Register production middleware on Fastify instance
 */
export async function registerProductionMiddleware(
  app: FastifyInstance,
  config: ProductionMiddlewareConfig = {}
): Promise<void> {
  // Trust proxy
  if (config.trustProxy) {
    app.addHook('onRequest', async (request) => {
      const forwarded = request.headers['x-forwarded-for'];
      if (forwarded) {
        const ips = (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',');
        // @ts-expect-error - modifying ip
        request.ip = ips[0].trim();
      }
    });
  }

  // Security headers
  if (config.securityHeaders !== false) {
    app.addHook('onSend', async (_request, reply) => {
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('X-Frame-Options', 'DENY');
      reply.header('X-XSS-Protection', '1; mode=block');
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      reply.header('X-Download-Options', 'noopen');
      reply.header('X-Permitted-Cross-Domain-Policies', 'none');
      reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    });
  }

  // Rate limiting
  if (config.rateLimit) {
    const rateLimiter = new RateLimiter(config.rateLimit);

    app.addHook('onRequest', async (request, reply) => {
      const result = rateLimiter.check(request);

      reply.header('X-RateLimit-Limit', config.rateLimit!.max.toString());
      reply.header('X-RateLimit-Remaining', result.remaining.toString());
      reply.header('X-RateLimit-Reset', result.resetTime.toString());

      if (!result.allowed) {
        reply.status(429).send({
          error: config.rateLimit!.message || 'Too many requests',
          code: 'RATE_LIMITED',
          retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000),
        });
      }
    });
  }

  // Request logging
  if (config.requestLogging !== false) {
    app.addHook('onRequest', async (request) => {
      (request as unknown as { startTime: number }).startTime = Date.now();
    });

    app.addHook('onResponse', async (request, reply) => {
      const startTime = (request as unknown as { startTime: number }).startTime;
      const duration = Date.now() - startTime;

      console.log(JSON.stringify({
        level: reply.statusCode >= 400 ? 'error' : 'info',
        message: 'request completed',
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        durationMs: duration,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
        timestamp: new Date().toISOString(),
      }));
    });
  }

  // Compression (optional - gracefully skip if not installed)
  if (config.compression !== false) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const compress = require('@fastify/compress');
      await app.register(compress);
    } catch {
      console.warn('[@authz-engine/server] @fastify/compress not installed, skipping compression');
    }
  }
}

// ==========================================================================
// Health Check System
// ==========================================================================

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Record<string, {
    status: 'pass' | 'fail' | 'warn';
    latencyMs: number;
    message?: string;
    details?: Record<string, unknown>;
  }>;
  uptime: number;
  timestamp: string;
}

export interface DependencyCheck {
  name: string;
  check: () => Promise<{ healthy: boolean; latencyMs: number; details?: Record<string, unknown> }>;
  critical?: boolean;
}

export class HealthCheckSystem {
  private checks: DependencyCheck[] = [];
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Register a health check
   */
  register(check: DependencyCheck): void {
    this.checks.push(check);
  }

  /**
   * Run all health checks
   */
  async runChecks(): Promise<HealthCheckResult> {
    const results: HealthCheckResult['checks'] = {};
    let overallHealthy = true;
    let hasCriticalFailure = false;

    await Promise.all(
      this.checks.map(async (check) => {
        const start = Date.now();
        try {
          const result = await check.check();
          results[check.name] = {
            status: result.healthy ? 'pass' : 'fail',
            latencyMs: result.latencyMs,
            details: result.details,
          };

          if (!result.healthy) {
            overallHealthy = false;
            if (check.critical) {
              hasCriticalFailure = true;
            }
          }
        } catch (error) {
          results[check.name] = {
            status: 'fail',
            latencyMs: Date.now() - start,
            message: error instanceof Error ? error.message : 'Unknown error',
          };
          overallHealthy = false;
          if (check.critical) {
            hasCriticalFailure = true;
          }
        }
      })
    );

    return {
      status: hasCriticalFailure ? 'unhealthy' : overallHealthy ? 'healthy' : 'degraded',
      checks: results,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Register health check routes
   */
  registerRoutes(app: FastifyInstance): void {
    // Liveness probe (is the service running?)
    app.get('/health/live', async () => ({
      status: 'pass',
      timestamp: new Date().toISOString(),
    }));

    // Readiness probe (is the service ready to receive traffic?)
    app.get('/health/ready', async (_request, reply) => {
      const result = await this.runChecks();

      if (result.status === 'unhealthy') {
        reply.status(503);
      }

      return {
        status: result.status === 'unhealthy' ? 'fail' : 'pass',
        checks: Object.fromEntries(
          Object.entries(result.checks).map(([name, check]) => [
            name,
            { status: check.status },
          ])
        ),
      };
    });

    // Full health check
    app.get('/health', async (_request, reply) => {
      const result = await this.runChecks();

      if (result.status === 'unhealthy') {
        reply.status(503);
      } else if (result.status === 'degraded') {
        reply.status(200); // Still OK but degraded
      }

      return result;
    });
  }
}

// ==========================================================================
// Retry Logic
// ==========================================================================

export interface RetryConfig {
  /** Maximum number of retries */
  maxRetries: number;
  /** Initial delay between retries (ms) */
  initialDelay: number;
  /** Maximum delay between retries (ms) */
  maxDelay: number;
  /** Multiplier for exponential backoff */
  backoffMultiplier: number;
  /** Jitter factor (0-1) */
  jitter: number;
  /** Retry on these error types */
  retryOn?: (error: Error) => boolean;
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const options: RetryConfig = {
    maxRetries: 3,
    initialDelay: 100,
    maxDelay: 5000,
    backoffMultiplier: 2,
    jitter: 0.1,
    ...config,
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Check if we should retry
      if (options.retryOn && !options.retryOn(lastError)) {
        throw lastError;
      }

      // Check if we've exhausted retries
      if (attempt >= options.maxRetries) {
        throw lastError;
      }

      // Calculate delay with exponential backoff and jitter
      const baseDelay = Math.min(
        options.initialDelay * Math.pow(options.backoffMultiplier, attempt),
        options.maxDelay
      );
      const jitterRange = baseDelay * options.jitter;
      const delay = baseDelay + (Math.random() * 2 - 1) * jitterRange;

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
