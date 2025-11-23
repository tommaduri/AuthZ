/**
 * gRPC Client for AuthZ Engine
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { EventEmitter } from 'events';
import {
  type CheckRequest,
  type CheckResponse,
  type CheckBatchRequest,
  type CheckBatchResponse,
  type ClientOptions,
  type ClientStats,
  type StreamCallback,
  type StreamErrorCallback,
  type StreamEndCallback,
  DEFAULT_OPTIONS,
  Effect,
  type ActionResult,
} from './types.js';

/**
 * Proto definition path (relative to package root)
 */
const PROTO_PATH = '../../../go-core/api/proto/authz/v1/authz.proto';

/**
 * gRPC service definition type
 */
interface AuthzServiceClient {
  Check: grpc.requestCallback<unknown, unknown>;
  CheckBatch: grpc.requestCallback<unknown, unknown>;
  CheckStream: () => grpc.ClientDuplexStream<unknown, unknown>;
}

/**
 * AuthZ Engine gRPC Client
 */
export class AuthzClient extends EventEmitter {
  private readonly options: Required<ClientOptions>;
  private client: AuthzServiceClient | null = null;
  private connected = false;
  private stats: ClientStats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    avgLatencyMs: 0,
    cacheHitRate: 0,
  };
  private totalLatency = 0;
  private cacheHits = 0;

  constructor(options: ClientOptions) {
    super();
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    } as Required<ClientOptions>;
  }

  /**
   * Connect to the gRPC server
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

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

    this.client = new proto.authz.v1.AuthzService(
      this.options.address,
      credentials,
      channelOptions
    );

    // Wait for connection to be ready
    await this.waitForReady();
    this.connected = true;
    this.emit('connected');
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
        // If no channel method, just resolve
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
   * Disconnect from the gRPC server
   */
  disconnect(): void {
    if (this.client) {
      const client = this.client as unknown as { close?: () => void };
      client.close?.();
      this.client = null;
      this.connected = false;
      this.emit('disconnected');
    }
  }

  /**
   * Check authorization for a single request
   */
  async check(request: CheckRequest): Promise<CheckResponse> {
    this.ensureConnected();

    const start = Date.now();
    this.stats.totalRequests++;

    try {
      const response = await this.callWithRetry<CheckResponse>(
        'Check',
        this.convertRequestToProto(request)
      );

      const latency = Date.now() - start;
      this.updateStats(latency, response.metadata?.cacheHit ?? false, true);

      return this.convertResponseFromProto(response);
    } catch (error) {
      this.stats.failedRequests++;
      throw error;
    }
  }

  /**
   * Check authorization for multiple requests in batch
   */
  async checkBatch(requests: CheckRequest[]): Promise<CheckResponse[]> {
    this.ensureConnected();

    const start = Date.now();
    this.stats.totalRequests += requests.length;

    try {
      const batchRequest: CheckBatchRequest = {
        requests: requests.map(r => this.convertRequestToProto(r) as CheckRequest),
      };

      const response = await this.callWithRetry<CheckBatchResponse>(
        'CheckBatch',
        batchRequest
      );

      const latency = Date.now() - start;
      const avgLatency = latency / requests.length;

      // Update stats for each response
      for (const resp of response.responses) {
        this.updateStats(avgLatency, resp.metadata?.cacheHit ?? false, true);
      }

      return response.responses.map(r => this.convertResponseFromProto(r));
    } catch (error) {
      this.stats.failedRequests += requests.length;
      throw error;
    }
  }

  /**
   * Create a bidirectional stream for continuous authorization checks
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
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Ensure client is connected
   */
  private ensureConnected(): void {
    if (!this.connected || !this.client) {
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
    return new Promise(resolve => setTimeout(resolve, ms));
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
  private convertRequestToProto(request: CheckRequest): object {
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
  private convertResponseFromProto(proto: CheckResponse): CheckResponse {
    const protoAny = proto as unknown as {
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
        results.set(action, {
          effect: this.convertEffect(result.effect),
          policy: result.policy,
          rule: result.rule,
          matched: result.matched ?? false,
        });
      }
    }

    return {
      requestId: protoAny.request_id ?? '',
      results,
      metadata: protoAny.metadata
        ? {
            evaluationDurationUs: protoAny.metadata.evaluation_duration_us ?? 0,
            policiesEvaluated: protoAny.metadata.policies_evaluated ?? 0,
            cacheHit: protoAny.metadata.cache_hit ?? false,
          }
        : undefined,
      error: protoAny.error,
    };
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
          values: value.map(v => this.convertValue(v)),
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
}

/**
 * Create a new AuthZ client
 */
export function createClient(options: ClientOptions): AuthzClient {
  return new AuthzClient(options);
}
