/**
 * AuthZ Engine gRPC Client
 *
 * Enhanced TypeScript client for connecting to the AuthZ Engine Go core via gRPC.
 *
 * Features:
 * - Bidirectional streaming with backpressure support
 * - SSE fallback for non-gRPC environments
 * - Connection pooling with load balancing
 * - OpenTelemetry integration for distributed tracing
 * - Health monitoring with automatic failover
 *
 * @example
 * ```typescript
 * import { createClient, Effect, ProtocolType } from '@authz-engine/grpc-client';
 *
 * // Basic usage
 * const client = createClient({
 *   address: 'localhost:50051',
 *   timeout: 5000,
 * });
 *
 * await client.connect();
 *
 * const response = await client.check({
 *   requestId: 'req-1',
 *   principal: {
 *     id: 'user-123',
 *     roles: ['admin'],
 *   },
 *   resource: {
 *     kind: 'document',
 *     id: 'doc-456',
 *   },
 *   actions: ['read', 'write'],
 * });
 *
 * if (response.results.get('read')?.effect === Effect.ALLOW) {
 *   console.log('Read access granted!');
 * }
 *
 * client.disconnect();
 * ```
 *
 * @example
 * ```typescript
 * // Advanced usage with all features
 * import { createPooledClient, HealthStatus } from '@authz-engine/grpc-client';
 *
 * const client = createPooledClient(
 *   ['localhost:50051', 'localhost:50052'],
 *   {
 *     otel: {
 *       tracingEnabled: true,
 *       metricsEnabled: true,
 *       serviceName: 'my-service',
 *     },
 *     healthCheck: {
 *       enabled: true,
 *       interval: 10000,
 *     },
 *   }
 * );
 *
 * await client.connect();
 *
 * // Subscribe to health changes
 * const unsubscribe = client.subscribeToHealthStream({
 *   onStatusChange: (status, previous) => {
 *     console.log(`Health changed from ${previous} to ${status}`);
 *   },
 *   onHealthCheck: (result) => {
 *     console.log(`Health check: ${result.status} (${result.latencyMs}ms)`);
 *   },
 *   onError: (error) => {
 *     console.error('Health check error:', error);
 *   },
 * });
 *
 * // Create bidirectional stream with backpressure
 * const stream = client.createBidirectionalStream({
 *   onResponse: (response) => console.log('Response:', response),
 *   onError: (error) => console.error('Error:', error),
 *   onEnd: () => console.log('Stream ended'),
 *   onBackpressure: (paused) => console.log('Backpressure:', paused),
 * });
 *
 * // Export Prometheus metrics
 * const metricsText = client.exportPrometheusMetrics();
 * ```
 */

// Main client exports
export { AuthzClient, createClient, createAutoClient, createPooledClient } from './client.js';

// Streaming exports
export {
  BidirectionalStreamManager,
  createBidirectionalStream,
} from './streaming.js';

// SSE client exports
export { SSEClient, createSSEClient, isSSEAvailable } from './sse-client.js';

// Connection pool exports
export { ConnectionPool, createConnectionPool } from './connection-pool.js';

// Observability exports
export {
  ObservabilityManager,
  MetricsCollector,
  createObservabilityManager,
  SpanStatus,
  type Span,
  type Tracer,
} from './observability.js';

// Health monitoring exports
export {
  HealthMonitor,
  createHealthMonitor,
  createGrpcHealthCheck,
} from './health-monitor.js';

// Type exports
export {
  // Enums
  Effect,
  ConnectionState,
  HealthStatus,
  ProtocolType,
  LoadBalancingStrategy,
  SSEEventType,

  // Core types
  type Principal,
  type Resource,
  type CheckRequest,
  type CheckResponse,
  type CheckBatchRequest,
  type CheckBatchResponse,
  type ActionResult,
  type ResponseMetadata,
  type ClientOptions,
  type ClientStats,
  type StreamCallback,
  type StreamErrorCallback,
  type StreamEndCallback,

  // Extended types
  type ExtendedClientOptions,
  type BidirectionalStreamHandle,
  type StreamLifecycleCallbacks,
  type BackpressureConfig,
  type StreamStats,

  // SSE types
  type SSEClientOptions,
  type SSEMessage,

  // Connection pool types
  type ConnectionPoolOptions,
  type ConnectionPoolStats,
  type PooledConnection,
  type ReconnectConfig,

  // Observability types
  type OTelConfig,
  type TraceContext,
  type AuthzSpanAttributes,
  type MetricsConfig,
  type PrometheusMetrics,

  // Health types
  type HealthCheckConfig,
  type HealthCheckResult,
  type HealthStreamCallbacks,
  type ConnectionHealth,
  type FailoverConfig,

  // Default configurations
  DEFAULT_OPTIONS,
  DEFAULT_POOL_OPTIONS,
  DEFAULT_BACKPRESSURE_CONFIG,
  DEFAULT_HEALTH_CHECK_CONFIG,
  DEFAULT_RECONNECT_CONFIG,
  DEFAULT_OTEL_CONFIG,
} from './types.js';

// Import types for helper functions
import { Effect as EffectEnum, type CheckResponse as CheckResponseType } from './types.js';

/**
 * Helper function to check if an action is allowed
 */
export function isAllowed(
  response: CheckResponseType,
  action: string
): boolean {
  const result = response.results.get(action);
  return result?.effect === EffectEnum.ALLOW;
}

/**
 * Helper function to check if an action is denied
 */
export function isDenied(
  response: CheckResponseType,
  action: string
): boolean {
  const result = response.results.get(action);
  return result?.effect === EffectEnum.DENY;
}

/**
 * Helper function to get all allowed actions from a response
 */
export function getAllowedActions(
  response: CheckResponseType
): string[] {
  const allowed: string[] = [];
  for (const [action, result] of response.results) {
    if (result.effect === EffectEnum.ALLOW) {
      allowed.push(action);
    }
  }
  return allowed;
}

/**
 * Helper function to get all denied actions from a response
 */
export function getDeniedActions(
  response: CheckResponseType
): string[] {
  const denied: string[] = [];
  for (const [action, result] of response.results) {
    if (result.effect === EffectEnum.DENY) {
      denied.push(action);
    }
  }
  return denied;
}

/**
 * Helper function to check if all actions are allowed
 */
export function areAllAllowed(
  response: CheckResponseType,
  actions: string[]
): boolean {
  for (const action of actions) {
    if (!isAllowed(response, action)) {
      return false;
    }
  }
  return true;
}

/**
 * Helper function to check if any action is allowed
 */
export function isAnyAllowed(
  response: CheckResponseType,
  actions: string[]
): boolean {
  for (const action of actions) {
    if (isAllowed(response, action)) {
      return true;
    }
  }
  return false;
}
