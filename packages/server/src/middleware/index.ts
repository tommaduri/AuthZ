/**
 * Server Middleware Exports
 *
 * Production-grade middleware for authorization servers:
 * - Circuit breaker for downstream protection
 * - Rate limiting per client/IP
 * - Health check system
 * - Retry logic with exponential backoff
 * - Security headers
 * - Request logging
 */

export {
  CircuitBreaker,
  CircuitBreakerError,
  RateLimiter,
  HealthCheckSystem,
  registerProductionMiddleware,
  withRetry,
} from './production';

export type {
  CircuitBreakerConfig,
  CircuitState,
  RateLimitConfig,
  ProductionMiddlewareConfig,
  HealthCheckResult,
  DependencyCheck,
  RetryConfig,
} from './production';
