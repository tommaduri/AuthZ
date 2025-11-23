/**
 * Types for the gRPC client
 */

/**
 * Authorization effect
 */
export enum Effect {
  UNSPECIFIED = 0,
  ALLOW = 1,
  DENY = 2,
}

/**
 * Connection state for monitoring
 */
export enum ConnectionState {
  IDLE = 'idle',
  CONNECTING = 'connecting',
  READY = 'ready',
  TRANSIENT_FAILURE = 'transient_failure',
  SHUTDOWN = 'shutdown',
}

/**
 * Health status for health checks
 */
export enum HealthStatus {
  UNKNOWN = 'unknown',
  SERVING = 'serving',
  NOT_SERVING = 'not_serving',
  SERVICE_UNKNOWN = 'service_unknown',
}

/**
 * Protocol type for client communication
 */
export enum ProtocolType {
  GRPC = 'grpc',
  SSE = 'sse',
  AUTO = 'auto',
}

/**
 * Principal making the authorization request
 */
export interface Principal {
  /** Unique identifier for the principal */
  id: string;
  /** Type of principal (user, service, etc.) */
  type?: string;
  /** Roles assigned to the principal */
  roles: string[];
  /** Additional attributes */
  attributes?: Record<string, unknown>;
}

/**
 * Resource being accessed
 */
export interface Resource {
  /** Resource kind/type */
  kind: string;
  /** Unique identifier for the resource */
  id: string;
  /** Additional attributes */
  attributes?: Record<string, unknown>;
}

/**
 * Authorization check request
 */
export interface CheckRequest {
  /** Unique request identifier */
  requestId: string;
  /** Principal making the request */
  principal: Principal;
  /** Resource being accessed */
  resource: Resource;
  /** Actions to check */
  actions: string[];
  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * Result for a single action
 */
export interface ActionResult {
  /** Authorization effect */
  effect: Effect;
  /** Policy that matched (if any) */
  policy?: string;
  /** Rule that matched (if any) */
  rule?: string;
  /** Whether a rule matched */
  matched: boolean;
}

/**
 * Response metadata
 */
export interface ResponseMetadata {
  /** Evaluation duration in microseconds */
  evaluationDurationUs: number;
  /** Number of policies evaluated */
  policiesEvaluated: number;
  /** Whether result was from cache */
  cacheHit: boolean;
}

/**
 * Authorization check response
 */
export interface CheckResponse {
  /** Request identifier */
  requestId: string;
  /** Results per action */
  results: Map<string, ActionResult>;
  /** Response metadata */
  metadata?: ResponseMetadata;
  /** Error message if any */
  error?: string;
}

/**
 * Batch check request
 */
export interface CheckBatchRequest {
  /** Individual check requests */
  requests: CheckRequest[];
}

/**
 * Batch check response
 */
export interface CheckBatchResponse {
  /** Individual check responses */
  responses: CheckResponse[];
}

/**
 * Client configuration options
 */
export interface ClientOptions {
  /** gRPC server address */
  address: string;
  /** Connection timeout in milliseconds */
  timeout?: number;
  /** Enable TLS */
  tls?: boolean;
  /** TLS certificate path */
  certPath?: string;
  /** TLS key path */
  keyPath?: string;
  /** CA certificate path */
  caPath?: string;
  /** Keep-alive interval in milliseconds */
  keepAliveInterval?: number;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Retry delay in milliseconds */
  retryDelay?: number;
}

/**
 * Default client options
 */
export const DEFAULT_OPTIONS: Partial<ClientOptions> = {
  timeout: 5000,
  tls: false,
  keepAliveInterval: 30000,
  maxRetries: 3,
  retryDelay: 1000,
};

/**
 * Client statistics
 */
export interface ClientStats {
  /** Total requests made */
  totalRequests: number;
  /** Successful requests */
  successfulRequests: number;
  /** Failed requests */
  failedRequests: number;
  /** Average latency in milliseconds */
  avgLatencyMs: number;
  /** Cache hit rate (from server) */
  cacheHitRate: number;
}

/**
 * Stream callback for bidirectional streaming
 */
export type StreamCallback = (response: CheckResponse) => void;

/**
 * Stream error callback
 */
export type StreamErrorCallback = (error: Error) => void;

/**
 * Stream end callback
 */
export type StreamEndCallback = () => void;

// ============================================================================
// Bidirectional Streaming Types
// ============================================================================

/**
 * Backpressure configuration for streams
 */
export interface BackpressureConfig {
  /** High watermark - pause sending when buffer exceeds this */
  highWaterMark: number;
  /** Low watermark - resume sending when buffer drops below this */
  lowWaterMark: number;
  /** Maximum buffer size before dropping messages */
  maxBufferSize: number;
}

/**
 * Stream statistics
 */
export interface StreamStats {
  /** Messages sent */
  messagesSent: number;
  /** Messages received */
  messagesReceived: number;
  /** Messages dropped due to backpressure */
  messagesDropped: number;
  /** Current buffer size */
  bufferSize: number;
  /** Stream uptime in milliseconds */
  uptimeMs: number;
  /** Average latency for responses */
  avgLatencyMs: number;
}

/**
 * Bidirectional stream handle
 */
export interface BidirectionalStreamHandle {
  /** Send a request through the stream */
  send: (request: CheckRequest) => boolean;
  /** End the stream gracefully */
  end: () => void;
  /** Check if stream is writable (not backpressured) */
  isWritable: () => boolean;
  /** Get stream statistics */
  getStats: () => StreamStats;
  /** Pause receiving messages */
  pause: () => void;
  /** Resume receiving messages */
  resume: () => void;
  /** Get stream ID */
  getId: () => string;
}

/**
 * Stream lifecycle events
 */
export interface StreamLifecycleCallbacks {
  onResponse: StreamCallback;
  onError: StreamErrorCallback;
  onEnd: StreamEndCallback;
  onBackpressure?: (paused: boolean) => void;
  onReconnect?: (attempt: number) => void;
}

// ============================================================================
// SSE Fallback Types
// ============================================================================

/**
 * SSE client configuration
 */
export interface SSEClientOptions {
  /** SSE endpoint URL */
  endpoint: string;
  /** Connection timeout in milliseconds */
  timeout?: number;
  /** Reconnect interval in milliseconds */
  reconnectInterval?: number;
  /** Maximum reconnection attempts */
  maxReconnectAttempts?: number;
  /** Custom headers for SSE requests */
  headers?: Record<string, string>;
  /** Whether to include credentials */
  withCredentials?: boolean;
}

/**
 * SSE event types
 */
export enum SSEEventType {
  CHECK_RESPONSE = 'check_response',
  BATCH_RESPONSE = 'batch_response',
  HEALTH = 'health',
  ERROR = 'error',
  HEARTBEAT = 'heartbeat',
}

/**
 * SSE message structure
 */
export interface SSEMessage {
  /** Event type */
  type: SSEEventType;
  /** Event ID for deduplication */
  id?: string;
  /** Message payload */
  data: unknown;
  /** Timestamp */
  timestamp: number;
}

// ============================================================================
// Connection Pool Types
// ============================================================================

/**
 * Connection pool configuration
 */
export interface ConnectionPoolOptions {
  /** Minimum connections to maintain */
  minConnections: number;
  /** Maximum connections allowed */
  maxConnections: number;
  /** Connection idle timeout in milliseconds */
  idleTimeout: number;
  /** Load balancing strategy */
  loadBalancingStrategy: LoadBalancingStrategy;
  /** Health check interval in milliseconds */
  healthCheckInterval: number;
  /** Connection acquisition timeout */
  acquireTimeout: number;
}

/**
 * Load balancing strategies
 */
export enum LoadBalancingStrategy {
  ROUND_ROBIN = 'round_robin',
  LEAST_CONNECTIONS = 'least_connections',
  RANDOM = 'random',
  WEIGHTED = 'weighted',
}

/**
 * Pool connection wrapper
 */
export interface PooledConnection {
  /** Connection identifier */
  id: string;
  /** Connection state */
  state: ConnectionState;
  /** Active request count */
  activeRequests: number;
  /** Connection weight for weighted load balancing */
  weight: number;
  /** Last used timestamp */
  lastUsed: number;
  /** Creation timestamp */
  createdAt: number;
  /** Health check failures */
  healthCheckFailures: number;
}

/**
 * Connection pool statistics
 */
export interface ConnectionPoolStats {
  /** Total connections in pool */
  totalConnections: number;
  /** Active connections */
  activeConnections: number;
  /** Idle connections */
  idleConnections: number;
  /** Failed connections */
  failedConnections: number;
  /** Total requests processed */
  totalRequests: number;
  /** Average wait time for connection acquisition */
  avgAcquireTimeMs: number;
}

/**
 * Reconnection configuration with exponential backoff
 */
export interface ReconnectConfig {
  /** Initial delay in milliseconds */
  initialDelay: number;
  /** Maximum delay in milliseconds */
  maxDelay: number;
  /** Backoff multiplier */
  multiplier: number;
  /** Add jitter to delays */
  jitter: boolean;
  /** Maximum reconnection attempts */
  maxAttempts: number;
}

// ============================================================================
// Observability Types
// ============================================================================

/**
 * OpenTelemetry configuration
 */
export interface OTelConfig {
  /** Enable tracing */
  tracingEnabled: boolean;
  /** Enable metrics */
  metricsEnabled: boolean;
  /** Service name for traces */
  serviceName: string;
  /** Trace sample rate (0-1) */
  sampleRate: number;
  /** Custom span attributes */
  spanAttributes?: Record<string, string>;
  /** Propagation format */
  propagationFormat?: 'w3c' | 'b3' | 'jaeger';
}

/**
 * Trace context for distributed tracing
 */
export interface TraceContext {
  /** Trace ID */
  traceId: string;
  /** Span ID */
  spanId: string;
  /** Parent span ID */
  parentSpanId?: string;
  /** Trace flags */
  traceFlags: number;
  /** Trace state */
  traceState?: string;
}

/**
 * Span attributes for authorization checks
 */
export interface AuthzSpanAttributes {
  /** Request ID */
  'authz.request_id': string;
  /** Principal ID */
  'authz.principal_id': string;
  /** Resource kind */
  'authz.resource_kind': string;
  /** Resource ID */
  'authz.resource_id': string;
  /** Actions being checked */
  'authz.actions': string;
  /** Effect (allow/deny) */
  'authz.effect'?: string;
  /** Cache hit */
  'authz.cache_hit'?: boolean;
  /** Evaluation duration */
  'authz.evaluation_duration_us'?: number;
}

/**
 * Metrics configuration
 */
export interface MetricsConfig {
  /** Metrics prefix */
  prefix: string;
  /** Default labels */
  defaultLabels?: Record<string, string>;
  /** Enable latency histogram */
  enableLatencyHistogram: boolean;
  /** Histogram buckets in milliseconds */
  latencyBuckets?: number[];
}

/**
 * Prometheus metrics format
 */
export interface PrometheusMetrics {
  /** Request counter */
  requestsTotal: number;
  /** Request latency histogram */
  requestLatencySeconds: Record<string, number>;
  /** Active connections gauge */
  activeConnections: number;
  /** Error counter by type */
  errorsTotal: Record<string, number>;
  /** Cache hit ratio */
  cacheHitRatio: number;
}

// ============================================================================
// Health Monitoring Types
// ============================================================================

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
  /** Enable health checks */
  enabled: boolean;
  /** Check interval in milliseconds */
  interval: number;
  /** Timeout for health check */
  timeout: number;
  /** Number of failures before marking unhealthy */
  unhealthyThreshold: number;
  /** Number of successes before marking healthy */
  healthyThreshold: number;
  /** Service name to check */
  serviceName?: string;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  /** Health status */
  status: HealthStatus;
  /** Timestamp of check */
  timestamp: number;
  /** Response latency in milliseconds */
  latencyMs: number;
  /** Error message if unhealthy */
  error?: string;
  /** Additional details */
  details?: Record<string, unknown>;
}

/**
 * Health stream callbacks
 */
export interface HealthStreamCallbacks {
  /** Called on health status change */
  onStatusChange: (status: HealthStatus, previous: HealthStatus) => void;
  /** Called on health check result */
  onHealthCheck: (result: HealthCheckResult) => void;
  /** Called on health check error */
  onError: (error: Error) => void;
}

/**
 * Connection health summary
 */
export interface ConnectionHealth {
  /** Overall health status */
  status: HealthStatus;
  /** Connection state */
  connectionState: ConnectionState;
  /** Last successful check timestamp */
  lastSuccessfulCheck?: number;
  /** Consecutive failures */
  consecutiveFailures: number;
  /** Consecutive successes */
  consecutiveSuccesses: number;
  /** Health history (last N results) */
  history: HealthCheckResult[];
}

/**
 * Failover configuration
 */
export interface FailoverConfig {
  /** Enable automatic failover */
  enabled: boolean;
  /** Addresses to failover to */
  fallbackAddresses: string[];
  /** Current primary index */
  primaryIndex: number;
  /** Failover threshold (failures before failover) */
  failoverThreshold: number;
  /** Failback delay in milliseconds */
  failbackDelay: number;
}

// ============================================================================
// Extended Client Options
// ============================================================================

/**
 * Extended client options with all features
 */
export interface ExtendedClientOptions extends ClientOptions {
  /** Protocol selection */
  protocol?: ProtocolType;
  /** Connection pool options */
  connectionPool?: Partial<ConnectionPoolOptions>;
  /** Backpressure configuration */
  backpressure?: Partial<BackpressureConfig>;
  /** SSE fallback options */
  sseFallback?: SSEClientOptions;
  /** OpenTelemetry configuration */
  otel?: Partial<OTelConfig>;
  /** Metrics configuration */
  metrics?: Partial<MetricsConfig>;
  /** Health check configuration */
  healthCheck?: Partial<HealthCheckConfig>;
  /** Reconnection configuration */
  reconnect?: Partial<ReconnectConfig>;
  /** Failover configuration */
  failover?: Partial<FailoverConfig>;
}

/**
 * Default connection pool options
 */
export const DEFAULT_POOL_OPTIONS: ConnectionPoolOptions = {
  minConnections: 1,
  maxConnections: 10,
  idleTimeout: 60000,
  loadBalancingStrategy: LoadBalancingStrategy.ROUND_ROBIN,
  healthCheckInterval: 30000,
  acquireTimeout: 5000,
};

/**
 * Default backpressure configuration
 */
export const DEFAULT_BACKPRESSURE_CONFIG: BackpressureConfig = {
  highWaterMark: 100,
  lowWaterMark: 50,
  maxBufferSize: 1000,
};

/**
 * Default health check configuration
 */
export const DEFAULT_HEALTH_CHECK_CONFIG: HealthCheckConfig = {
  enabled: true,
  interval: 30000,
  timeout: 5000,
  unhealthyThreshold: 3,
  healthyThreshold: 2,
};

/**
 * Default reconnect configuration
 */
export const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  initialDelay: 1000,
  maxDelay: 30000,
  multiplier: 2,
  jitter: true,
  maxAttempts: 10,
};

/**
 * Default OpenTelemetry configuration
 */
export const DEFAULT_OTEL_CONFIG: OTelConfig = {
  tracingEnabled: false,
  metricsEnabled: false,
  serviceName: 'authz-client',
  sampleRate: 1.0,
  propagationFormat: 'w3c',
};

// ============================================================================
// Stream Management Types
// ============================================================================

/**
 * Stream monitoring metrics
 */
export interface StreamMonitoringMetrics {
  /** Active streams */
  activeStreams: number;
  /** Total messages sent across all streams */
  totalMessagesSent: number;
  /** Total messages received across all streams */
  totalMessagesReceived: number;
  /** Average latency per message */
  avgLatencyMs: number;
  /** Peak buffer size across all streams */
  peakBufferSize: number;
  /** Total backpressure events */
  backpressureEvents: number;
}

/**
 * Stream pool configuration
 */
export interface StreamPoolConfig {
  /** Maximum concurrent streams */
  maxConcurrentStreams: number;
  /** Maximum idle time for streams in milliseconds */
  streamIdleTimeout: number;
  /** Enable automatic stream reuse */
  enableStreamReuse: boolean;
  /** Stream reuse timeout in milliseconds */
  streamReuseTimeout: number;
}

/**
 * Default stream pool configuration
 */
export const DEFAULT_STREAM_POOL_CONFIG: StreamPoolConfig = {
  maxConcurrentStreams: 10,
  streamIdleTimeout: 300000, // 5 minutes
  enableStreamReuse: true,
  streamReuseTimeout: 60000, // 1 minute
};

/**
 * Advanced stream options for bidirectional streaming
 */
export interface AdvancedStreamOptions {
  /** Enable stream multiplexing */
  multiplexing: boolean;
  /** Maximum requests per stream before rotation */
  maxRequestsPerStream: number;
  /** Enable request deduplication */
  deduplication: boolean;
  /** Deduplication cache size */
  deduplicationCacheSize: number;
  /** Enable response ordering guarantees */
  ensureOrdering: boolean;
}

/**
 * Default advanced stream options
 */
export const DEFAULT_STREAM_OPTIONS: AdvancedStreamOptions = {
  multiplexing: true,
  maxRequestsPerStream: 1000,
  deduplication: false,
  deduplicationCacheSize: 100,
  ensureOrdering: true,
};
