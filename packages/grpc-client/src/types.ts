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
