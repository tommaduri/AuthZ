/**
 * Enhanced gRPC Client for AuthZ Engine
 *
 * Features:
 * - Bidirectional streaming with backpressure
 * - SSE fallback for non-gRPC environments
 * - Connection pooling with load balancing
 * - OpenTelemetry integration
 * - Health monitoring and automatic failover
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { EventEmitter } from 'events';
import {
  type CheckRequest,
  type CheckResponse,
  type CheckBatchRequest,
  type CheckBatchResponse,
  type ClientStats,
  type StreamCallback,
  type StreamErrorCallback,
  type StreamEndCallback,
  type ExtendedClientOptions,
  type BidirectionalStreamHandle,
  type StreamLifecycleCallbacks,
  type BackpressureConfig,
  type TraceContext,
  type HealthCheckResult,
  type HealthStreamCallbacks,
  type ConnectionHealth,
  type ConnectionPoolStats,
  type PrometheusMetrics,
  type StreamMonitoringMetrics,
  type StreamPoolConfig,
  type AdvancedStreamOptions,
  DEFAULT_OPTIONS,
  DEFAULT_BACKPRESSURE_CONFIG,
  DEFAULT_RECONNECT_CONFIG,
  DEFAULT_HEALTH_CHECK_CONFIG,
  DEFAULT_OTEL_CONFIG,
  DEFAULT_POOL_OPTIONS,
  DEFAULT_STREAM_POOL_CONFIG,
  DEFAULT_STREAM_OPTIONS,
  Effect,
  ProtocolType,
  ConnectionState,
  HealthStatus,
  type ActionResult,
} from './types.js';
import {
  BidirectionalStreamManager,
  createBidirectionalStream,
} from './streaming.js';
import { SSEClient, createSSEClient, isSSEAvailable } from './sse-client.js';
import { ConnectionPool, createConnectionPool } from './connection-pool.js';
import {
  ObservabilityManager,
  createObservabilityManager,
} from './observability.js';
import {
  HealthMonitor,
  createHealthMonitor,
  createGrpcHealthCheck,
} from './health-monitor.js';

/**
 * Proto definition path (relative to package root)
 */
const PROTO_PATH = '../../../go-core/api/proto/authz/v1/authz.proto';

/**
 * gRPC service definition type
 */
interface AuthzServiceClient {
  Check: (request: unknown, callback: (error: grpc.ServiceError | null, response: unknown) => void) => grpc.ClientUnaryCall;
  CheckBatch: (request: unknown, callback: (error: grpc.ServiceError | null, response: unknown) => void) => grpc.ClientUnaryCall;
  CheckStream: () => grpc.ClientDuplexStream<unknown, unknown>;
}

/**
 * Enhanced AuthZ Engine gRPC Client
 */
export class AuthzClient extends EventEmitter {
  private readonly options: Required<ExtendedClientOptions>;
  private client: AuthzServiceClient | null = null;
  private sseClient: SSEClient | null = null;
  private connectionPool: ConnectionPool | null = null;
  private observability: ObservabilityManager | null = null;
  private healthMonitor: HealthMonitor | null = null;
  private activeStreams: Map<string, BidirectionalStreamManager> = new Map();

  private connected = false;
  private connectionState: ConnectionState = ConnectionState.IDLE;
  private activeProtocol: ProtocolType = ProtocolType.GRPC;
  private streamPoolConfig: StreamPoolConfig = DEFAULT_STREAM_POOL_CONFIG;
  private advancedStreamOptions: AdvancedStreamOptions = DEFAULT_STREAM_OPTIONS;
  private streamIdleCleanupTimer: NodeJS.Timeout | null = null;
  private requestDeduplicationCache = new Map<string, CheckResponse>();

  private stats: ClientStats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    avgLatencyMs: 0,
    cacheHitRate: 0,
  };
  private totalLatency = 0;
  private cacheHits = 0;
  private streamMonitoringStats: StreamMonitoringMetrics = {
    activeStreams: 0,
    totalMessagesSent: 0,
    totalMessagesReceived: 0,
    avgLatencyMs: 0,
    peakBufferSize: 0,
    backpressureEvents: 0,
  };

  constructor(options: ExtendedClientOptions) {
    super();
    this.options = {
      ...DEFAULT_OPTIONS,
      protocol: ProtocolType.GRPC,
      connectionPool: DEFAULT_POOL_OPTIONS,
      backpressure: DEFAULT_BACKPRESSURE_CONFIG,
      otel: DEFAULT_OTEL_CONFIG,
      healthCheck: DEFAULT_HEALTH_CHECK_CONFIG,
      reconnect: DEFAULT_RECONNECT_CONFIG,
      ...options,
    } as Required<ExtendedClientOptions>;

    // Initialize observability if configured
    if (this.options.otel?.tracingEnabled || this.options.otel?.metricsEnabled) {
      this.observability = createObservabilityManager(
        this.options.otel,
        this.options.metrics
      );
    }
  }

  /**
   * Connect to the gRPC server with automatic protocol negotiation
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    this.setConnectionState(ConnectionState.CONNECTING);

    try {
      // Determine protocol
      if (this.options.protocol === ProtocolType.AUTO) {
        await this.negotiateProtocol();
      } else if (this.options.protocol === ProtocolType.SSE) {
        await this.connectSSE();
      } else {
        await this.connectGrpc();
      }

      // Initialize health monitoring
      if (this.options.healthCheck?.enabled) {
        this.initializeHealthMonitoring();
      }

      this.connected = true;
      this.setConnectionState(ConnectionState.READY);
      this.emit('connected');
    } catch (error) {
      this.setConnectionState(ConnectionState.TRANSIENT_FAILURE);
      throw error;
    }
  }

  /**
   * Negotiate protocol (try gRPC first, fall back to SSE)
   */
  private async negotiateProtocol(): Promise<void> {
    try {
      await this.connectGrpc();
      this.activeProtocol = ProtocolType.GRPC;
    } catch (grpcError) {
      this.emit('grpc_fallback', { reason: (grpcError as Error).message });

      if (this.options.sseFallback && isSSEAvailable()) {
        await this.connectSSE();
        this.activeProtocol = ProtocolType.SSE;
      } else {
        throw grpcError;
      }
    }
  }

  /**
   * Connect via gRPC
   */
  private async connectGrpc(): Promise<void> {
    const packageDefinition = await protoLoader.load(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const proto = grpc.loadPackageDefinition(packageDefinition) as unknown as {
      authz: {
        v1: {
          AuthzService: new (
            address: string,
            credentials: grpc.ChannelCredentials,
            options?: object
          ) => AuthzServiceClient;
        };
      };
    };

    const credentials = this.options.tls
      ? this.createTlsCredentials()
      : grpc.credentials.createInsecure();

    const channelOptions = {
      'grpc.keepalive_time_ms': this.options.keepAliveInterval,
      'grpc.keepalive_timeout_ms': this.options.timeout,
      'grpc.keepalive_permit_without_calls': 1,
    };

    // Initialize connection pool if configured
    if (this.options.connectionPool && this.options.connectionPool.maxConnections! > 1) {
      this.connectionPool = createConnectionPool(
        [this.options.address],
        async (address: string) => {
          return new proto.authz.v1.AuthzService(address, credentials, channelOptions);
        },
        (client: unknown) => {
          const c = client as { close?: () => void };
          c.close?.();
        },
        this.options.connectionPool as Record<string, unknown>,
        this.options.reconnect as Record<string, unknown>
      );

      await this.connectionPool.initialize();
      this.setupPoolEvents();
    } else {
      this.client = new proto.authz.v1.AuthzService(
        this.options.address,
        credentials,
        channelOptions
      );

      await this.waitForReady();
    }
  }

  /**
   * Connect via SSE
   */
  private async connectSSE(): Promise<void> {
    if (!this.options.sseFallback) {
      throw new Error('SSE fallback not configured');
    }

    this.sseClient = createSSEClient(this.options.sseFallback);
    this.setupSSEEvents();
    await this.sseClient.connect();
  }

  /**
   * Setup SSE client events
   */
  private setupSSEEvents(): void {
    if (!this.sseClient) return;

    this.sseClient.on('response', (response: CheckResponse) => {
      this.emit('sse_response', response);
    });

    this.sseClient.on('error', (error: Error) => {
      this.emit('sse_error', error);
    });

    this.sseClient.on('disconnected', () => {
      this.emit('sse_disconnected');
    });

    this.sseClient.on('reconnecting', (attempt: number) => {
      this.emit('sse_reconnecting', attempt);
    });
  }

  /**
   * Setup connection pool events
   */
  private setupPoolEvents(): void {
    if (!this.connectionPool) return;

    this.connectionPool.on('connection_created', (info) => {
      this.emit('pool_connection_created', info);
      this.observability?.setConnectionCount(this.connectionPool!.getStats().totalConnections);
    });

    this.connectionPool.on('connection_failed', (info) => {
      this.emit('pool_connection_failed', info);
    });

    this.connectionPool.on('reconnected', (info) => {
      this.emit('pool_reconnected', info);
    });

    this.connectionPool.on('connection_removed', (info) => {
      this.emit('pool_connection_removed', info);
      this.observability?.setConnectionCount(this.connectionPool!.getStats().totalConnections);
    });
  }

  /**
   * Initialize health monitoring
   */
  private initializeHealthMonitoring(): void {
    const healthCheckFn = createGrpcHealthCheck(
      () => this.client,
      this.options.healthCheck?.serviceName
    );

    const failoverAddresses = this.options.failover?.fallbackAddresses || [this.options.address];

    this.healthMonitor = createHealthMonitor(
      healthCheckFn,
      this.options.healthCheck,
      {
        ...this.options.failover,
        fallbackAddresses: failoverAddresses,
      },
      async (newAddress: string) => {
        await this.reconnectToAddress(newAddress);
      }
    );

    this.setupHealthMonitorEvents();
    this.healthMonitor.start();
  }

  /**
   * Setup health monitor events
   */
  private setupHealthMonitorEvents(): void {
    if (!this.healthMonitor) return;

    this.healthMonitor.on('status_change', (status: HealthStatus, previous: HealthStatus) => {
      this.emit('health_status_change', { status, previous });
    });

    this.healthMonitor.on('failover_started', (info) => {
      this.emit('failover_started', info);
    });

    this.healthMonitor.on('failover_completed', (info) => {
      this.emit('failover_completed', info);
    });

    this.healthMonitor.on('failover_failed', (info) => {
      this.emit('failover_failed', info);
    });

    this.healthMonitor.on('failback_completed', (info) => {
      this.emit('failback_completed', info);
    });
  }

  /**
   * Reconnect to a different address (for failover)
   */
  private async reconnectToAddress(address: string): Promise<void> {
    this.disconnect();
    this.options.address = address;
    await this.connect();
  }

  /**
   * Create TLS credentials
   */
  private createTlsCredentials(): grpc.ChannelCredentials {
    // For now, return insecure - in production would read cert files
    return grpc.credentials.createInsecure();
  }

  /**
   * Wait for the client to be ready
   */
  private waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('Client not initialized'));
        return;
      }

      const deadline = Date.now() + this.options.timeout;

      const channel = (this.client as unknown as { getChannel: () => grpc.Channel }).getChannel?.();
      if (!channel) {
        resolve();
        return;
      }

      channel.watchConnectivityState(
        channel.getConnectivityState(true),
        deadline,
        (error?: Error) => {
          if (error) {
            reject(new Error(`Failed to connect: ${error.message}`));
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Set and emit connection state changes
   */
  private setConnectionState(state: ConnectionState): void {
    const previous = this.connectionState;
    this.connectionState = state;

    if (state !== previous) {
      this.emit('connection_state_change', { state, previous });
      this.healthMonitor?.setConnectionState(state);
    }
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    // Stop health monitoring
    this.healthMonitor?.stop();

    // Close all active streams
    for (const [id, stream] of this.activeStreams) {
      stream.end();
      this.activeStreams.delete(id);
    }

    // Close SSE client
    if (this.sseClient) {
      this.sseClient.disconnect();
      this.sseClient = null;
    }

    // Shutdown connection pool
    if (this.connectionPool) {
      this.connectionPool.shutdown();
      this.connectionPool = null;
    }

    // Close direct client
    if (this.client) {
      const client = this.client as unknown as { close?: () => void };
      client.close?.();
      this.client = null;
    }

    this.connected = false;
    this.setConnectionState(ConnectionState.SHUTDOWN);
    this.emit('disconnected');
  }

  /**
   * Check authorization for a single request
   */
  async check(request: CheckRequest, parentContext?: TraceContext): Promise<CheckResponse> {
    this.ensureConnected();

    const start = Date.now();
    this.stats.totalRequests++;

    // Start tracing span
    const trace = this.observability?.traceCheck(request, parentContext);

    try {
      let response: CheckResponse;

      if (this.activeProtocol === ProtocolType.SSE && this.sseClient) {
        response = await this.sseClient.check(request);
      } else {
        response = await this.executeGrpcCheck(request, trace?.headers);
      }

      const latency = Date.now() - start;
      this.updateStats(latency, response.metadata?.cacheHit ?? false, true);

      // Complete trace
      trace?.complete(response);

      return response;
    } catch (error) {
      this.stats.failedRequests++;
      trace?.complete(
        { requestId: request.requestId, results: new Map() },
        error as Error
      );
      throw error;
    }
  }

  /**
   * Execute gRPC check with optional connection pooling
   */
  private async executeGrpcCheck(
    request: CheckRequest,
    _headers?: Record<string, string>
  ): Promise<CheckResponse> {
    if (this.connectionPool) {
      const { client, release } = await this.connectionPool.acquire();
      try {
        return await this.callWithRetryOnClient(
          client as AuthzServiceClient,
          'Check',
          this.convertRequestToProto(request)
        );
      } finally {
        release();
      }
    }

    const response = await this.callWithRetry<CheckResponse>(
      'Check',
      this.convertRequestToProto(request)
    );

    return this.convertResponseFromProto(response);
  }

  /**
   * Call with retry on a specific client
   */
  private async callWithRetryOnClient<T>(
    client: AuthzServiceClient,
    method: string,
    request: unknown
  ): Promise<T> {
    let lastError: Error | undefined;
    let attempt = 0;

    while (attempt < this.options.maxRetries) {
      try {
        return await this.callOnClient<T>(client, method, request);
      } catch (error) {
        lastError = error as Error;
        attempt++;

        if (attempt < this.options.maxRetries) {
          await this.delay(this.options.retryDelay * attempt);
        }
      }
    }

    throw lastError ?? new Error(`Failed after ${this.options.maxRetries} retries`);
  }

  /**
   * Make a call on a specific client
   */
  private callOnClient<T>(
    client: AuthzServiceClient,
    method: string,
    request: unknown
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const handler = client[method as keyof AuthzServiceClient] as (
        request: unknown,
        callback: (error: grpc.ServiceError | null, response: T) => void
      ) => void;

      if (typeof handler !== 'function') {
        reject(new Error(`Method ${method} not found`));
        return;
      }

      handler.call(client, request, (error: grpc.ServiceError | null, response: T) => {
        if (error) {
          reject(new Error(`gRPC error: ${error.message}`));
        } else {
          resolve(response);
        }
      });
    });
  }

  /**
   * Check authorization for multiple requests in batch
   */
  async checkBatch(
    requests: CheckRequest[],
    _parentContext?: TraceContext
  ): Promise<CheckResponse[]> {
    this.ensureConnected();

    const start = Date.now();
    this.stats.totalRequests += requests.length;

    try {
      let responses: CheckResponse[];

      if (this.activeProtocol === ProtocolType.SSE && this.sseClient) {
        responses = await this.sseClient.checkBatch(requests);
      } else {
        const batchRequest: CheckBatchRequest = {
          requests: requests.map((r) => this.convertRequestToProto(r) as CheckRequest),
        };

        const response = await this.callWithRetry<CheckBatchResponse>('CheckBatch', batchRequest);
        responses = response.responses.map((r) => this.convertResponseFromProto(r));
      }

      const latency = Date.now() - start;
      const avgLatency = latency / requests.length;

      for (const resp of responses) {
        this.updateStats(avgLatency, resp.metadata?.cacheHit ?? false, true);
      }

      return responses;
    } catch (error) {
      this.stats.failedRequests += requests.length;
      throw error;
    }
  }

  /**
   * Create a basic bidirectional stream (legacy API)
   */
  createStream(
    onResponse: StreamCallback,
    onError: StreamErrorCallback,
    onEnd: StreamEndCallback
  ): {
    send: (request: CheckRequest) => void;
    end: () => void;
  } {
    this.ensureConnected();

    if (!this.client) {
      throw new Error('Client not connected');
    }

    const stream = this.client.CheckStream();

    stream.on('data', (data: unknown) => {
      try {
        const response = this.convertResponseFromProto(data as CheckResponse);
        onResponse(response);
      } catch (error) {
        onError(error as Error);
      }
    });

    stream.on('error', (error: Error) => {
      onError(error);
    });

    stream.on('end', () => {
      onEnd();
    });

    return {
      send: (request: CheckRequest) => {
        this.stats.totalRequests++;
        stream.write(this.convertRequestToProto(request));
      },
      end: () => {
        stream.end();
      },
    };
  }

  /**
   * Create an advanced bidirectional stream with backpressure support
   */
  createBidirectionalStream(
    callbacks: StreamLifecycleCallbacks,
    backpressureConfig?: Partial<BackpressureConfig>
  ): BidirectionalStreamHandle {
    this.ensureConnected();

    if (!this.client) {
      throw new Error('Client not connected');
    }

    const createStreamFn = () => this.client!.CheckStream();

    const handle = createBidirectionalStream(
      createStreamFn,
      callbacks,
      this.convertRequestToProto.bind(this),
      this.convertResponseFromProto.bind(this),
      backpressureConfig || this.options.backpressure,
      this.options.reconnect
    );

    return handle;
  }

  /**
   * Subscribe to health check stream
   */
  subscribeToHealthStream(callbacks: HealthStreamCallbacks): () => void {
    if (!this.healthMonitor) {
      throw new Error('Health monitoring not enabled');
    }

    return this.healthMonitor.subscribeToHealthStream(callbacks);
  }

  /**
   * Get current health status
   */
  getHealth(): ConnectionHealth {
    if (!this.healthMonitor) {
      return {
        status: this.connected ? HealthStatus.SERVING : HealthStatus.UNKNOWN,
        connectionState: this.connectionState,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        history: [],
      };
    }

    return this.healthMonitor.getHealth();
  }

  /**
   * Force a health check
   */
  async checkHealth(): Promise<HealthCheckResult> {
    if (!this.healthMonitor) {
      return {
        status: this.connected ? HealthStatus.SERVING : HealthStatus.NOT_SERVING,
        timestamp: Date.now(),
        latencyMs: 0,
      };
    }

    return this.healthMonitor.checkNow();
  }

  /**
   * Get connection pool statistics
   */
  getPoolStats(): ConnectionPoolStats | null {
    return this.connectionPool?.getStats() ?? null;
  }

  /**
   * Scale connection pool
   */
  async scalePool(targetSize: number): Promise<void> {
    if (!this.connectionPool) {
      throw new Error('Connection pooling not enabled');
    }

    await this.connectionPool.scale(targetSize);
  }

  /**
   * Get Prometheus metrics
   */
  getPrometheusMetrics(): PrometheusMetrics | null {
    return this.observability?.getMetrics().getPrometheusMetrics() ?? null;
  }

  /**
   * Export Prometheus metrics as text
   */
  exportPrometheusMetrics(): string {
    return this.observability?.exportPrometheusMetrics() ?? '';
  }

  /**
   * Get client statistics
   */
  getStats(): ClientStats {
    return { ...this.stats };
  }

  /**
   * Reset client statistics
   */
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgLatencyMs: 0,
      cacheHitRate: 0,
    };
    this.totalLatency = 0;
    this.cacheHits = 0;
    this.observability?.getMetrics().reset();
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Get active protocol
   */
  getActiveProtocol(): ProtocolType {
    return this.activeProtocol;
  }

  /**
   * Ensure client is connected
   */
  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('Client not connected. Call connect() first.');
    }
  }

  /**
   * Call a gRPC method with retry logic
   */
  private async callWithRetry<T>(method: string, request: unknown): Promise<T> {
    let lastError: Error | undefined;
    let attempt = 0;

    while (attempt < this.options.maxRetries) {
      try {
        return await this.call<T>(method, request);
      } catch (error) {
        lastError = error as Error;
        attempt++;

        if (attempt < this.options.maxRetries) {
          await this.delay(this.options.retryDelay * attempt);
        }
      }
    }

    throw lastError ?? new Error(`Failed after ${this.options.maxRetries} retries`);
  }

  /**
   * Make a gRPC call
   */
  private call<T>(method: string, request: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('Client not initialized'));
        return;
      }

      const handler = this.client[method as keyof AuthzServiceClient] as (
        request: unknown,
        callback: (error: grpc.ServiceError | null, response: T) => void
      ) => void;

      if (typeof handler !== 'function') {
        reject(new Error(`Method ${method} not found`));
        return;
      }

      handler.call(this.client, request, (error: grpc.ServiceError | null, response: T) => {
        if (error) {
          reject(new Error(`gRPC error: ${error.message}`));
        } else {
          resolve(response);
        }
      });
    });
  }

  /**
   * Delay for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Update statistics
   */
  private updateStats(latencyMs: number, cacheHit: boolean, success: boolean): void {
    if (success) {
      this.stats.successfulRequests++;
    }

    this.totalLatency += latencyMs;
    if (cacheHit) {
      this.cacheHits++;
    }

    const totalSuccessful = this.stats.successfulRequests;
    this.stats.avgLatencyMs = totalSuccessful > 0 ? this.totalLatency / totalSuccessful : 0;
    this.stats.cacheHitRate = totalSuccessful > 0 ? this.cacheHits / totalSuccessful : 0;
  }

  /**
   * Convert request to protobuf format
   */
  convertRequestToProto(request: CheckRequest): object {
    return {
      request_id: request.requestId,
      principal: {
        id: request.principal.id,
        type: request.principal.type ?? '',
        roles: request.principal.roles,
        attributes: request.principal.attributes
          ? this.convertToStruct(request.principal.attributes)
          : null,
      },
      resource: {
        kind: request.resource.kind,
        id: request.resource.id,
        attributes: request.resource.attributes
          ? this.convertToStruct(request.resource.attributes)
          : null,
      },
      actions: request.actions,
      context: request.context ? this.convertToStruct(request.context) : null,
    };
  }

  /**
   * Convert response from protobuf format
   */
  convertResponseFromProto(proto: CheckResponse | unknown): CheckResponse {
    const protoAny = proto as {
      request_id?: string;
      results?: Record<string, { effect?: string | number; policy?: string; rule?: string; matched?: boolean }>;
      metadata?: {
        evaluation_duration_us?: number;
        policies_evaluated?: number;
        cache_hit?: boolean;
      };
      error?: string;
    };

    const results = new Map<string, ActionResult>();
    if (protoAny.results) {
      for (const [action, result] of Object.entries(protoAny.results)) {
        const actionResult: ActionResult = {
          effect: this.convertEffect(result.effect),
          matched: result.matched ?? false,
        };
        if (result.policy !== undefined) {
          actionResult.policy = result.policy;
        }
        if (result.rule !== undefined) {
          actionResult.rule = result.rule;
        }
        results.set(action, actionResult);
      }
    }

    const response: CheckResponse = {
      requestId: protoAny.request_id ?? '',
      results,
    };
    if (protoAny.metadata) {
      response.metadata = {
        evaluationDurationUs: protoAny.metadata.evaluation_duration_us ?? 0,
        policiesEvaluated: protoAny.metadata.policies_evaluated ?? 0,
        cacheHit: protoAny.metadata.cache_hit ?? false,
      };
    }
    if (protoAny.error !== undefined) {
      response.error = protoAny.error;
    }
    return response;
  }

  /**
   * Convert effect from proto
   */
  private convertEffect(effect: string | number | undefined): Effect {
    if (typeof effect === 'string') {
      switch (effect) {
        case 'EFFECT_ALLOW':
          return Effect.ALLOW;
        case 'EFFECT_DENY':
          return Effect.DENY;
        default:
          return Effect.UNSPECIFIED;
      }
    }
    if (typeof effect === 'number') {
      return effect as Effect;
    }
    return Effect.UNSPECIFIED;
  }

  /**
   * Convert JavaScript object to protobuf Struct
   */
  private convertToStruct(obj: Record<string, unknown>): object {
    const fields: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      fields[key] = this.convertValue(value);
    }

    return { fields };
  }

  /**
   * Convert a JavaScript value to protobuf Value
   */
  private convertValue(value: unknown): object {
    if (value === null || value === undefined) {
      return { null_value: 0 };
    }
    if (typeof value === 'boolean') {
      return { bool_value: value };
    }
    if (typeof value === 'number') {
      return { number_value: value };
    }
    if (typeof value === 'string') {
      return { string_value: value };
    }
    if (Array.isArray(value)) {
      return {
        list_value: {
          values: value.map((v) => this.convertValue(v)),
        },
      };
    }
    if (typeof value === 'object') {
      return {
        struct_value: this.convertToStruct(value as Record<string, unknown>),
      };
    }
    return { null_value: 0 };
  }

  /**
   * Configure stream pool behavior
   */
  configureStreamPool(config: Partial<StreamPoolConfig>): void {
    this.streamPoolConfig = { ...this.streamPoolConfig, ...config };

    if (config.streamIdleTimeout && this.streamIdleCleanupTimer) {
      clearInterval(this.streamIdleCleanupTimer);
      this.startStreamIdleCleanup();
    }
  }

  /**
   * Configure advanced stream options
   */
  configureAdvancedStreamOptions(options: Partial<AdvancedStreamOptions>): void {
    this.advancedStreamOptions = { ...this.advancedStreamOptions, ...options };
  }

  /**
   * Start periodic stream idle cleanup
   */
  private startStreamIdleCleanup(): void {
    this.streamIdleCleanupTimer = setInterval(() => {
      this.cleanupIdleStreams();
    }, this.streamPoolConfig.streamIdleTimeout / 2);
  }

  /**
   * Clean up idle streams
   */
  private cleanupIdleStreams(): void {
    const toRemove: string[] = [];

    for (const [id, stream] of this.activeStreams) {
      const stats = stream.getStats?.() || { uptimeMs: 0 };
      if (stats.uptimeMs > this.streamPoolConfig.streamIdleTimeout) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      const stream = this.activeStreams.get(id);
      if (stream) {
        stream.end?.();
        this.activeStreams.delete(id);
        this.updateStreamMonitoringStats();
      }
    }
  }

  /**
   * Update stream monitoring statistics
   */
  private updateStreamMonitoringStats(): void {
    let totalMessagesSent = 0;
    let totalMessagesReceived = 0;
    let totalLatency = 0;
    let messageCount = 0;
    let peakBufferSize = 0;

    for (const stream of this.activeStreams.values()) {
      const stats = stream.getStats?.() || {
        messagesSent: 0,
        messagesReceived: 0,
        bufferSize: 0,
        avgLatencyMs: 0
      };
      totalMessagesSent += stats.messagesSent || 0;
      totalMessagesReceived += stats.messagesReceived || 0;
      peakBufferSize = Math.max(peakBufferSize, stats.bufferSize || 0);

      const msgCount = (stats.messagesReceived || 0) + (stats.messagesSent || 0);
      if (msgCount > 0) {
        totalLatency += (stats.avgLatencyMs || 0) * msgCount;
        messageCount += msgCount;
      }
    }

    this.streamMonitoringStats = {
      activeStreams: this.activeStreams.size,
      totalMessagesSent,
      totalMessagesReceived,
      avgLatencyMs: messageCount > 0 ? totalLatency / messageCount : 0,
      peakBufferSize,
      backpressureEvents: this.streamMonitoringStats.backpressureEvents,
    };
  }

  /**
   * Get stream monitoring metrics
   */
  getStreamMonitoringMetrics(): StreamMonitoringMetrics {
    this.updateStreamMonitoringStats();
    return { ...this.streamMonitoringStats };
  }

  /**
   * Get active stream count
   */
  getActiveStreamCount(): number {
    return this.activeStreams.size;
  }

  /**
   * Get stream by ID
   */
  getStream(streamId: string): BidirectionalStreamHandle | null {
    const stream = this.activeStreams.get(streamId) as unknown as BidirectionalStreamManager;
    return stream?.getHandle?.() || null;
  }

  /**
   * List all active stream IDs
   */
  listActiveStreamIds(): string[] {
    return Array.from(this.activeStreams.keys());
  }

  /**
   * Close a specific stream
   */
  closeStream(streamId: string): void {
    const stream = this.activeStreams.get(streamId);
    if (stream) {
      stream.end?.();
      this.activeStreams.delete(streamId);
      this.updateStreamMonitoringStats();
    }
  }

  /**
   * Close all streams
   */
  closeAllStreams(): void {
    for (const [id, stream] of this.activeStreams) {
      stream.end?.();
      this.activeStreams.delete(id);
    }
    this.updateStreamMonitoringStats();
  }

  /**
   * Get deduplication cache stats
   */
  getDeduplicationCacheStats(): { size: number; capacity: number } {
    return {
      size: this.requestDeduplicationCache.size,
      capacity: this.advancedStreamOptions.deduplicationCacheSize,
    };
  }

  /**
   * Clear deduplication cache
   */
  clearDeduplicationCache(): void {
    this.requestDeduplicationCache.clear();
  }

  /**
   * Check if request is deduplicated (cached)
   */
  isDeduplicated(requestId: string): boolean {
    return this.requestDeduplicationCache.has(requestId);
  }

  /**
   * Get deduplicated response if available
   */
  getDedupedResponse(requestId: string): CheckResponse | null {
    return this.requestDeduplicationCache.get(requestId) || null;
  }

  /**
   * Create multiple streams in parallel for high-throughput scenarios
   */
  createStreamPool(
    count: number,
    callbacks: StreamLifecycleCallbacks,
    backpressureConfig?: Partial<BackpressureConfig>
  ): BidirectionalStreamHandle[] {
    const handles: BidirectionalStreamHandle[] = [];

    for (let i = 0; i < Math.min(count, this.streamPoolConfig.maxConcurrentStreams); i++) {
      try {
        const handle = this.createBidirectionalStream(callbacks, backpressureConfig);
        handles.push(handle);
      } catch (error) {
        this.emit('stream_pool_creation_error', { index: i, error });
      }
    }

    this.updateStreamMonitoringStats();
    return handles;
  }

  /**
   * Enable stream deduplication for requests
   */
  enableDeduplication(cacheSize?: number): void {
    this.advancedStreamOptions.deduplication = true;
    if (cacheSize) {
      this.advancedStreamOptions.deduplicationCacheSize = cacheSize;
    }
  }

  /**
   * Disable stream deduplication
   */
  disableDeduplication(): void {
    this.advancedStreamOptions.deduplication = false;
    this.requestDeduplicationCache.clear();
  }

  /**
   * Create a health monitoring stream for continuous checks
   */
  createHealthMonitoringStream(
    interval: number = 5000
  ): {
    unsubscribe: () => void;
  } {
    let timer: NodeJS.Timeout | null = null;

    const subscribe = () => {
      timer = setInterval(async () => {
        try {
          const health = await this.checkHealth();
          this.emit('health_stream_check', health);
        } catch (error) {
          this.emit('health_stream_error', error);
        }
      }, interval);
    };

    subscribe();

    return {
      unsubscribe: () => {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      },
    };
  }

  /**
   * Get comprehensive stream diagnostics
   */
  getStreamDiagnostics(): {
    metrics: StreamMonitoringMetrics;
    poolConfig: StreamPoolConfig;
    advancedOptions: AdvancedStreamOptions;
    deduplicationStats: { size: number; capacity: number };
    activeStreamIds: string[];
  } {
    return {
      metrics: this.getStreamMonitoringMetrics(),
      poolConfig: { ...this.streamPoolConfig },
      advancedOptions: { ...this.advancedStreamOptions },
      deduplicationStats: this.getDeduplicationCacheStats(),
      activeStreamIds: this.listActiveStreamIds(),
    };
  }
}

/**
 * Create a new AuthZ client
 */
export function createClient(options: ExtendedClientOptions): AuthzClient {
  return new AuthzClient(options);
}

/**
 * Create a client with automatic protocol negotiation
 */
export function createAutoClient(
  grpcAddress: string,
  sseEndpoint: string,
  options?: Partial<ExtendedClientOptions>
): AuthzClient {
  return new AuthzClient({
    address: grpcAddress,
    protocol: ProtocolType.AUTO,
    sseFallback: {
      endpoint: sseEndpoint,
    },
    ...options,
  });
}

/**
 * Create a pooled client for high-throughput scenarios
 */
export function createPooledClient(
  addresses: string[],
  options?: Partial<ExtendedClientOptions>
): AuthzClient {
  return new AuthzClient({
    address: addresses[0] ?? '',
    connectionPool: {
      ...DEFAULT_POOL_OPTIONS,
      maxConnections: addresses.length * 2,
    },
    failover: {
      enabled: true,
      fallbackAddresses: addresses,
      primaryIndex: 0,
      failoverThreshold: 3,
      failbackDelay: 60000,
    },
    ...options,
  });
}
