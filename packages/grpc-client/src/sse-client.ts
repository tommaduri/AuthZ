/**
 * Server-Sent Events (SSE) Fallback Client for AuthZ Engine
 *
 * Provides SSE-based communication for environments where gRPC is not available.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import {
  type CheckRequest,
  type CheckResponse,
  type SSEClientOptions,
  type SSEMessage,
  SSEEventType,
  Effect,
  type ActionResult,
  HealthStatus,
} from './types.js';

/**
 * Default SSE client options
 */
const DEFAULT_SSE_OPTIONS: Partial<SSEClientOptions> = {
  timeout: 30000,
  reconnectInterval: 3000,
  maxReconnectAttempts: 10,
  withCredentials: false,
};

/**
 * Pending request tracking
 */
interface PendingRequest {
  resolve: (response: CheckResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * SSE Client for AuthZ Engine
 *
 * Provides a fallback mechanism for environments without gRPC support.
 */
export class SSEClient extends EventEmitter {
  private readonly options: Required<SSEClientOptions>;
  private eventSource: EventSource | null = null;
  private connected = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private lastEventId: string | null = null;

  constructor(options: SSEClientOptions) {
    super();
    this.options = {
      ...DEFAULT_SSE_OPTIONS,
      ...options,
    } as Required<SSEClientOptions>;
  }

  /**
   * Connect to the SSE endpoint
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        // Build URL with last event ID for resumption
        let url = this.options.endpoint;
        if (this.lastEventId) {
          const separator = url.includes('?') ? '&' : '?';
          url = `${url}${separator}lastEventId=${encodeURIComponent(this.lastEventId)}`;
        }

        // Note: In Node.js, EventSource is not available natively
        // This implementation assumes a polyfill like 'eventsource' is available
        // or running in a browser environment
        if (typeof EventSource === 'undefined') {
          reject(new Error('EventSource not available. Install eventsource polyfill for Node.js.'));
          return;
        }

        this.eventSource = new EventSource(url, {
          withCredentials: this.options.withCredentials,
        });

        this.setupEventHandlers(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Setup SSE event handlers
   */
  private setupEventHandlers(
    onConnect: () => void,
    onConnectError: (error: Error) => void
  ): void {
    if (!this.eventSource) return;

    this.eventSource.onopen = () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this.emit('connected');
      onConnect();
    };

    this.eventSource.onerror = (event) => {
      const error = new Error('SSE connection error');
      if (!this.connected) {
        onConnectError(error);
      } else {
        this.handleDisconnect(error);
      }
    };

    // Handle different event types
    this.eventSource.addEventListener(SSEEventType.CHECK_RESPONSE, (event) => {
      this.handleCheckResponse(event as MessageEvent);
    });

    this.eventSource.addEventListener(SSEEventType.BATCH_RESPONSE, (event) => {
      this.handleBatchResponse(event as MessageEvent);
    });

    this.eventSource.addEventListener(SSEEventType.HEALTH, (event) => {
      this.handleHealthEvent(event as MessageEvent);
    });

    this.eventSource.addEventListener(SSEEventType.ERROR, (event) => {
      this.handleErrorEvent(event as MessageEvent);
    });

    this.eventSource.addEventListener(SSEEventType.HEARTBEAT, (event) => {
      this.handleHeartbeat(event as MessageEvent);
    });

    // Generic message handler
    this.eventSource.onmessage = (event) => {
      this.handleGenericMessage(event);
    };
  }

  /**
   * Handle check response events
   */
  private handleCheckResponse(event: MessageEvent): void {
    try {
      this.updateLastEventId(event);
      const data = JSON.parse(event.data);
      const response = this.parseCheckResponse(data);

      const pending = this.pendingRequests.get(response.requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(response.requestId);
        pending.resolve(response);
      }

      this.emit('response', response);
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Handle batch response events
   */
  private handleBatchResponse(event: MessageEvent): void {
    try {
      this.updateLastEventId(event);
      const data = JSON.parse(event.data);
      const responses: CheckResponse[] = data.responses.map(
        (r: unknown) => this.parseCheckResponse(r)
      );

      for (const response of responses) {
        const pending = this.pendingRequests.get(response.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(response.requestId);
          pending.resolve(response);
        }
      }

      this.emit('batch_response', responses);
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Handle health events
   */
  private handleHealthEvent(event: MessageEvent): void {
    try {
      this.updateLastEventId(event);
      const data = JSON.parse(event.data);
      this.emit('health', {
        status: data.status as HealthStatus,
        timestamp: data.timestamp || Date.now(),
        details: data.details,
      });
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Handle error events
   */
  private handleErrorEvent(event: MessageEvent): void {
    try {
      this.updateLastEventId(event);
      const data = JSON.parse(event.data);
      const error = new Error(data.message || 'Unknown error');

      // Check if this is for a pending request
      if (data.requestId) {
        const pending = this.pendingRequests.get(data.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(data.requestId);
          pending.reject(error);
          return;
        }
      }

      this.emit('error', error);
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Handle heartbeat events
   */
  private handleHeartbeat(event: MessageEvent): void {
    this.updateLastEventId(event);
    this.emit('heartbeat', { timestamp: Date.now() });
  }

  /**
   * Handle generic messages
   */
  private handleGenericMessage(event: MessageEvent): void {
    try {
      this.updateLastEventId(event);
      const message: SSEMessage = {
        type: SSEEventType.CHECK_RESPONSE,
        id: event.lastEventId,
        data: JSON.parse(event.data),
        timestamp: Date.now(),
      };
      this.emit('message', message);
    } catch (error) {
      // Ignore parse errors for non-JSON messages
    }
  }

  /**
   * Update last event ID for resumption
   */
  private updateLastEventId(event: MessageEvent): void {
    if (event.lastEventId) {
      this.lastEventId = event.lastEventId;
    }
  }

  /**
   * Handle disconnection with reconnection logic
   */
  private handleDisconnect(error: Error): void {
    this.connected = false;
    this.emit('disconnected', error);

    if (this.reconnectAttempts < this.options.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.emit('reconnecting', this.reconnectAttempts);

      this.reconnectTimer = setTimeout(() => {
        this.connect().catch((err) => {
          this.emit('error', err);
        });
      }, this.options.reconnectInterval);
    } else {
      this.emit('error', new Error(`Max reconnection attempts exceeded: ${error.message}`));
    }
  }

  /**
   * Parse check response from SSE data
   */
  private parseCheckResponse(data: unknown): CheckResponse {
    const d = data as {
      request_id?: string;
      requestId?: string;
      results?: Record<string, { effect?: string | number; policy?: string; rule?: string; matched?: boolean }>;
      metadata?: {
        evaluation_duration_us?: number;
        evaluationDurationUs?: number;
        policies_evaluated?: number;
        policiesEvaluated?: number;
        cache_hit?: boolean;
        cacheHit?: boolean;
      };
      error?: string;
    };

    const results = new Map<string, ActionResult>();
    if (d.results) {
      for (const [action, result] of Object.entries(d.results)) {
        results.set(action, {
          effect: this.parseEffect(result.effect),
          policy: result.policy,
          rule: result.rule,
          matched: result.matched ?? false,
        });
      }
    }

    return {
      requestId: d.request_id || d.requestId || '',
      results,
      metadata: d.metadata ? {
        evaluationDurationUs: d.metadata.evaluation_duration_us ?? d.metadata.evaluationDurationUs ?? 0,
        policiesEvaluated: d.metadata.policies_evaluated ?? d.metadata.policiesEvaluated ?? 0,
        cacheHit: d.metadata.cache_hit ?? d.metadata.cacheHit ?? false,
      } : undefined,
      error: d.error,
    };
  }

  /**
   * Parse effect value
   */
  private parseEffect(effect: string | number | undefined): Effect {
    if (typeof effect === 'string') {
      switch (effect.toUpperCase()) {
        case 'ALLOW':
        case 'EFFECT_ALLOW':
          return Effect.ALLOW;
        case 'DENY':
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
   * Send a check request via HTTP POST and wait for SSE response
   */
  async check(request: CheckRequest): Promise<CheckResponse> {
    this.ensureConnected();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.requestId);
        reject(new Error(`Request timeout: ${request.requestId}`));
      }, this.options.timeout);

      this.pendingRequests.set(request.requestId, { resolve, reject, timeout });

      // Send the request via HTTP POST
      this.sendRequest(request).catch((error) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(request.requestId);
        reject(error);
      });
    });
  }

  /**
   * Send a batch check request
   */
  async checkBatch(requests: CheckRequest[]): Promise<CheckResponse[]> {
    this.ensureConnected();

    const responses: Promise<CheckResponse>[] = requests.map((request) => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingRequests.delete(request.requestId);
          reject(new Error(`Request timeout: ${request.requestId}`));
        }, this.options.timeout);

        this.pendingRequests.set(request.requestId, { resolve, reject, timeout });
      });
    });

    // Send batch request via HTTP POST
    await this.sendBatchRequest(requests);

    return Promise.all(responses);
  }

  /**
   * Send HTTP request to trigger SSE response
   */
  private async sendRequest(request: CheckRequest): Promise<void> {
    const endpoint = this.options.endpoint.replace('/sse', '/check');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.options.headers,
      },
      body: JSON.stringify({
        request_id: request.requestId,
        principal: {
          id: request.principal.id,
          type: request.principal.type,
          roles: request.principal.roles,
          attributes: request.principal.attributes,
        },
        resource: {
          kind: request.resource.kind,
          id: request.resource.id,
          attributes: request.resource.attributes,
        },
        actions: request.actions,
        context: request.context,
      }),
      credentials: this.options.withCredentials ? 'include' : 'same-origin',
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Send batch HTTP request
   */
  private async sendBatchRequest(requests: CheckRequest[]): Promise<void> {
    const endpoint = this.options.endpoint.replace('/sse', '/check/batch');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.options.headers,
      },
      body: JSON.stringify({
        requests: requests.map((r) => ({
          request_id: r.requestId,
          principal: {
            id: r.principal.id,
            type: r.principal.type,
            roles: r.principal.roles,
            attributes: r.principal.attributes,
          },
          resource: {
            kind: r.resource.kind,
            id: r.resource.id,
            attributes: r.resource.attributes,
          },
          actions: r.actions,
          context: r.context,
        })),
      }),
      credentials: this.options.withCredentials ? 'include' : 'same-origin',
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Ensure client is connected
   */
  private ensureConnected(): void {
    if (!this.connected || !this.eventSource) {
      throw new Error('SSE client not connected. Call connect() first.');
    }
  }

  /**
   * Disconnect from the SSE endpoint
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Cancel all pending requests
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Client disconnected'));
    }
    this.pendingRequests.clear();

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.connected = false;
    this.emit('disconnected');
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get last event ID for resumption
   */
  getLastEventId(): string | null {
    return this.lastEventId;
  }
}

/**
 * Create an SSE client
 */
export function createSSEClient(options: SSEClientOptions): SSEClient {
  return new SSEClient(options);
}

/**
 * Check if SSE is available in the current environment
 */
export function isSSEAvailable(): boolean {
  return typeof EventSource !== 'undefined';
}
