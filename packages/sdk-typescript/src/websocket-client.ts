/**
 * AuthZ WebSocket Client
 *
 * TypeScript SDK for real-time WebSocket communication with the AuthZ Engine.
 * Provides auto-reconnection with exponential backoff and event emitter pattern.
 */

import type { Principal, Resource, Effect } from '@authz-engine/core';

// =============================================================================
// Constants
// =============================================================================

/** Default maximum reconnection attempts */
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;

/** Default initial reconnection delay in milliseconds */
const DEFAULT_RECONNECT_DELAY_MS = 1000;

/** Default maximum reconnection delay in milliseconds */
const DEFAULT_MAX_RECONNECT_DELAY_MS = 30000;

/** Default ping interval in milliseconds */
const DEFAULT_PING_INTERVAL_MS = 30000;

/** Default connection timeout in milliseconds */
const DEFAULT_CONNECTION_TIMEOUT_MS = 10000;

/** Authentication timeout in milliseconds */
const AUTH_TIMEOUT_MS = 10000;

/** Subscription operation timeout in milliseconds */
const SUBSCRIPTION_TIMEOUT_MS = 10000;

/** Authorization check timeout in milliseconds */
const CHECK_TIMEOUT_MS = 30000;

/** Exponential backoff base multiplier */
const EXPONENTIAL_BACKOFF_BASE = 2;

/** Normal WebSocket close code */
const NORMAL_CLOSE_CODE = 1000;

/** Logger interface for dependency injection */
interface Logger {
  log: (...args: unknown[]) => void;
}

/** Default console logger */
const defaultLogger: Logger = {
  log: (...args: unknown[]) => console.log(...args),
};

// =============================================================================
// Types
// =============================================================================

/**
 * WebSocket client configuration
 */
export interface AuthzWebSocketClientConfig {
  /** WebSocket server URL (e.g., ws://localhost:3594/ws) */
  url: string;
  /** Authentication token */
  authToken?: string;
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Maximum reconnection attempts */
  maxReconnectAttempts?: number;
  /** Initial reconnection delay in milliseconds */
  reconnectDelay?: number;
  /** Maximum reconnection delay in milliseconds */
  maxReconnectDelay?: number;
  /** Ping interval in milliseconds */
  pingInterval?: number;
  /** Connection timeout in milliseconds */
  connectionTimeout?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Custom logger for debug output (defaults to console) */
  logger?: Logger;
}

/**
 * Subscription options
 */
export interface SubscriptionOptions {
  /** Optional subscription name */
  name?: string;
  /** Event types to subscribe to */
  events: Array<
    | 'policy_update'
    | 'authorization_change'
    | 'anomaly_detected'
    | 'enforcement_action'
    | 'all'
  >;
  /** Principal filter */
  principals?: {
    ids?: string[];
    roles?: string[];
  };
  /** Resource filter */
  resources?: {
    kinds?: string[];
    ids?: string[];
  };
  /** Actions to watch */
  actions?: string[];
  /** Minimum anomaly severity to notify */
  minAnomalySeverity?: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Check result from real-time authorization check
 */
export interface WebSocketCheckResult {
  requestId: string;
  correlationId: string;
  results: Record<string, { effect: Effect; policy: string }>;
  meta?: {
    evaluationDurationMs?: number;
    policiesEvaluated?: string[];
  };
}

/**
 * Policy update event
 */
export interface PolicyUpdateEvent {
  updateType: 'added' | 'modified' | 'removed';
  policyName: string;
  resourceKind?: string;
  summary: string;
  changedAt: string;
}

/**
 * Authorization change event
 */
export interface AuthorizationChangeEvent {
  principalId?: string;
  resourceKind?: string;
  resourceId?: string;
  actions?: string[];
  description: string;
  previousEffect?: Effect;
  newEffect?: Effect;
}

/**
 * Anomaly detected event
 */
export interface AnomalyDetectedEvent {
  anomalyId: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  score: number;
  principalId: string;
  resourceKind?: string;
  action?: string;
  detectedAt: string;
}

/**
 * Enforcement action event
 */
export interface EnforcementActionEvent {
  actionId: string;
  actionType: string;
  status: 'pending' | 'executed' | 'rejected' | 'rolled_back';
  principalId?: string;
  reason: string;
  triggeredAt: string;
}

/**
 * Connection state
 */
export type ConnectionState = 'connecting' | 'connected' | 'authenticated' | 'disconnected' | 'reconnecting';

/**
 * Event handler types
 */
export interface WebSocketClientEvents {
  connect: () => void;
  disconnect: (code: number, reason: string) => void;
  authenticated: (clientId: string) => void;
  error: (error: Error) => void;
  reconnecting: (attempt: number, delay: number) => void;
  reconnected: () => void;
  'policy_update': (event: PolicyUpdateEvent) => void;
  'authorization_change': (event: AuthorizationChangeEvent) => void;
  'anomaly_detected': (event: AnomalyDetectedEvent) => void;
  'enforcement_action': (event: EnforcementActionEvent) => void;
  message: (message: WebSocketMessage) => void;
}

/**
 * WebSocket message type
 */
interface WebSocketMessage {
  id: string;
  type: string;
  timestamp: string;
  payload?: Record<string, unknown>;
}

// =============================================================================
// WebSocket Client
// =============================================================================

/**
 * AuthZ WebSocket Client for real-time authorization updates
 */
export class AuthzWebSocketClient {
  private ws: WebSocket | null = null;
  private config: Required<AuthzWebSocketClientConfig>;
  private state: ConnectionState = 'disconnected';
  private clientId: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRequests: Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();
  private subscriptions: Map<string, SubscriptionOptions> = new Map();
  private listeners: Map<keyof WebSocketClientEvents, Set<(...args: unknown[]) => void>> = new Map();
  private messageCounter = 0;
  private readonly logger: Logger;

  constructor(config: AuthzWebSocketClientConfig) {
    this.logger = config.logger || defaultLogger;
    this.config = {
      url: config.url,
      authToken: config.authToken || '',
      autoReconnect: config.autoReconnect ?? true,
      maxReconnectAttempts: config.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS,
      reconnectDelay: config.reconnectDelay ?? DEFAULT_RECONNECT_DELAY_MS,
      maxReconnectDelay: config.maxReconnectDelay ?? DEFAULT_MAX_RECONNECT_DELAY_MS,
      pingInterval: config.pingInterval ?? DEFAULT_PING_INTERVAL_MS,
      connectionTimeout: config.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT_MS,
      debug: config.debug ?? false,
      logger: this.logger,
    };
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'authenticated') {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this.state = 'connecting';
      this.debug('Connecting to', this.config.url);

      try {
        this.ws = new WebSocket(this.config.url);

        // Connection timeout
        this.connectionTimer = setTimeout(() => {
          if (this.state === 'connecting') {
            this.ws?.close();
            reject(new Error('Connection timeout'));
          }
        }, this.config.connectionTimeout);

        this.ws.onopen = () => {
          this.debug('WebSocket opened');
          this.clearConnectionTimer();
          this.state = 'connected';
          this.reconnectAttempts = 0;
          this.startPing();
          this.emit('connect');

          // Authenticate if token provided
          if (this.config.authToken) {
            this.authenticate()
              .then(() => {
                // Re-subscribe to existing subscriptions
                this.resubscribe();
                resolve();
              })
              .catch(reject);
          } else {
            this.state = 'authenticated';
            this.resubscribe();
            resolve();
          }
        };

        this.ws.onclose = (event) => {
          this.debug('WebSocket closed', event.code, event.reason);
          this.handleDisconnect(event.code, event.reason);
        };

        this.ws.onerror = (event) => {
          this.debug('WebSocket error', event);
          const error = new Error('WebSocket error');
          this.emit('error', error);
          if (this.state === 'connecting') {
            this.clearConnectionTimer();
            reject(error);
          }
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data as string);
        };
      } catch (error) {
        this.clearConnectionTimer();
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    this.debug('Disconnecting');
    this.config.autoReconnect = false; // Prevent auto-reconnect
    this.cleanup();
    this.ws?.close(1000, 'Client disconnect');
    this.ws = null;
    this.state = 'disconnected';
  }

  /**
   * Authenticate with the server
   */
  private async authenticate(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const messageId = this.generateMessageId();

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(messageId);
        reject(new Error('Authentication timeout'));
      }, AUTH_TIMEOUT_MS);

      this.pendingRequests.set(messageId, {
        resolve: (response: unknown) => {
          clearTimeout(timeout);
          const msg = response as WebSocketMessage;
          if (msg.type === 'authenticated') {
            this.state = 'authenticated';
            this.clientId = (msg.payload as Record<string, string>)?.clientId || null;
            this.emit('authenticated', this.clientId || '');
            resolve();
          } else if (msg.type === 'error') {
            reject(new Error((msg.payload as Record<string, string>)?.message || 'Authentication failed'));
          }
        },
        reject,
        timeout,
      });

      this.send({
        id: messageId,
        type: 'authenticate',
        timestamp: new Date().toISOString(),
        payload: {
          token: this.config.authToken,
        },
      });
    });
  }

  /**
   * Subscribe to authorization events
   */
  async subscribe(options: SubscriptionOptions): Promise<string> {
    if (this.state !== 'authenticated' && this.state !== 'connected') {
      throw new Error('Not connected');
    }

    return new Promise<string>((resolve, reject) => {
      const messageId = this.generateMessageId();

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(messageId);
        reject(new Error('Subscription timeout'));
      }, SUBSCRIPTION_TIMEOUT_MS);

      this.pendingRequests.set(messageId, {
        resolve: (response: unknown) => {
          clearTimeout(timeout);
          const msg = response as WebSocketMessage;
          if (msg.type === 'ack' && (msg.payload as Record<string, boolean>)?.success) {
            const subscriptionId = (msg.payload as Record<string, string>)?.subscriptionId || messageId;
            this.subscriptions.set(subscriptionId, options);
            resolve(subscriptionId);
          } else if (msg.type === 'error') {
            reject(new Error((msg.payload as Record<string, string>)?.message || 'Subscription failed'));
          }
        },
        reject,
        timeout,
      });

      this.send({
        id: messageId,
        type: 'subscribe',
        timestamp: new Date().toISOString(),
        payload: options as unknown as Record<string, unknown>,
      });
    });
  }

  /**
   * Unsubscribe from authorization events
   */
  async unsubscribe(subscriptionId: string): Promise<void> {
    if (this.state !== 'authenticated' && this.state !== 'connected') {
      throw new Error('Not connected');
    }

    return new Promise<void>((resolve, reject) => {
      const messageId = this.generateMessageId();

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(messageId);
        reject(new Error('Unsubscribe timeout'));
      }, SUBSCRIPTION_TIMEOUT_MS);

      this.pendingRequests.set(messageId, {
        resolve: (response: unknown) => {
          clearTimeout(timeout);
          const msg = response as WebSocketMessage;
          if (msg.type === 'ack' && (msg.payload as Record<string, boolean>)?.success) {
            this.subscriptions.delete(subscriptionId);
            resolve();
          } else if (msg.type === 'error') {
            reject(new Error((msg.payload as Record<string, string>)?.message || 'Unsubscribe failed'));
          }
        },
        reject,
        timeout,
      });

      this.send({
        id: messageId,
        type: 'unsubscribe',
        timestamp: new Date().toISOString(),
        payload: { subscriptionId },
      });
    });
  }

  /**
   * Perform real-time authorization check
   */
  async check(
    principal: Principal,
    resource: Resource,
    actions: string[],
    auxData?: Record<string, unknown>,
  ): Promise<WebSocketCheckResult> {
    if (this.state !== 'authenticated' && this.state !== 'connected') {
      throw new Error('Not connected');
    }

    return new Promise<WebSocketCheckResult>((resolve, reject) => {
      const messageId = this.generateMessageId();

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(messageId);
        reject(new Error('Check timeout'));
      }, CHECK_TIMEOUT_MS);

      this.pendingRequests.set(messageId, {
        resolve: (response: unknown) => {
          clearTimeout(timeout);
          const msg = response as WebSocketMessage;
          if (msg.type === 'check_response') {
            resolve(msg.payload as unknown as WebSocketCheckResult);
          } else if (msg.type === 'error') {
            reject(new Error((msg.payload as Record<string, string>)?.message || 'Check failed'));
          }
        },
        reject,
        timeout,
      });

      this.send({
        id: messageId,
        type: 'check',
        timestamp: new Date().toISOString(),
        payload: {
          principal,
          resource,
          actions,
          auxData,
        },
      });
    });
  }

  /**
   * Check if a single action is allowed
   */
  async isAllowed(
    principal: Principal,
    resource: Resource,
    action: string,
    auxData?: Record<string, unknown>,
  ): Promise<boolean> {
    const result = await this.check(principal, resource, [action], auxData);
    return result.results[action]?.effect === 'allow';
  }

  /**
   * Add event listener
   */
  on<K extends keyof WebSocketClientEvents>(
    event: K,
    handler: WebSocketClientEvents[K],
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as (...args: unknown[]) => void);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(handler as (...args: unknown[]) => void);
    };
  }

  /**
   * Remove event listener
   */
  off<K extends keyof WebSocketClientEvents>(
    event: K,
    handler: WebSocketClientEvents[K],
  ): void {
    this.listeners.get(event)?.delete(handler as (...args: unknown[]) => void);
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Get client ID (assigned by server after authentication)
   */
  getClientId(): string | null {
    return this.clientId;
  }

  /**
   * Get active subscriptions
   */
  getSubscriptions(): Map<string, SubscriptionOptions> {
    return new Map(this.subscriptions);
  }

  /**
   * Check if connected and ready
   */
  isReady(): boolean {
    return this.state === 'authenticated' || this.state === 'connected';
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  /**
   * Send a message to the server
   */
  private send(message: WebSocketMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.debug('Sending', message.type);
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as WebSocketMessage;
      this.debug('Received', message.type);
      this.emit('message', message);

      // Check for pending request responses
      if (this.handlePendingRequest(message)) {
        return;
      }

      // Handle broadcast messages
      this.handleBroadcastMessage(message);
    } catch (error) {
      this.debug('Failed to parse message:', error);
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Handle pending request responses
   * @returns true if the message was handled as a pending request
   */
  private handlePendingRequest(message: WebSocketMessage): boolean {
    const correlationId = (message.payload as Record<string, string>)?.correlationId;
    const requestId = correlationId || message.id;
    const pendingRequest = this.pendingRequests.get(requestId);

    if (!pendingRequest) {
      return false;
    }

    this.pendingRequests.delete(requestId);
    clearTimeout(pendingRequest.timeout);

    if (message.type === 'error') {
      const errorMessage = (message.payload as Record<string, string>)?.message || 'Request failed';
      pendingRequest.reject(new Error(errorMessage));
    } else {
      pendingRequest.resolve(message);
    }

    return true;
  }

  /**
   * Handle broadcast messages by type
   */
  private handleBroadcastMessage(message: WebSocketMessage): void {
    const eventHandlers: Record<string, () => void> = {
      'policy_update': () => this.emit('policy_update', message.payload as unknown as PolicyUpdateEvent),
      'authorization_change': () => this.emit('authorization_change', message.payload as unknown as AuthorizationChangeEvent),
      'anomaly_detected': () => this.emit('anomaly_detected', message.payload as unknown as AnomalyDetectedEvent),
      'enforcement_action': () => this.emit('enforcement_action', message.payload as unknown as EnforcementActionEvent),
      'pong': () => { /* Heartbeat response, nothing to do */ },
      'authenticated': () => { /* Handled in authenticate() via pending request */ },
    };

    const handler = eventHandlers[message.type];
    if (handler) {
      handler();
    } else {
      this.debug('Unhandled message type:', message.type);
    }
  }

  /**
   * Handle disconnect
   */
  private handleDisconnect(code: number, reason: string): void {
    this.cleanup();
    this.state = 'disconnected';
    this.emit('disconnect', code, reason);

    // Reject all pending requests
    for (const [id, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('Connection closed'));
      this.pendingRequests.delete(id);
    }

    // Auto-reconnect if enabled (not for normal close)
    if (this.config.autoReconnect && code !== NORMAL_CLOSE_CODE) {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.debug('Max reconnection attempts reached');
      this.emit('error', new Error('Max reconnection attempts reached'));
      return;
    }

    const delay = Math.min(
      this.config.reconnectDelay * Math.pow(EXPONENTIAL_BACKOFF_BASE, this.reconnectAttempts),
      this.config.maxReconnectDelay,
    );

    this.state = 'reconnecting';
    this.reconnectAttempts++;

    this.debug(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.emit('reconnecting', this.reconnectAttempts, delay);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
        this.emit('reconnected');
      } catch (error) {
        this.debug('Reconnection failed:', error);
        this.scheduleReconnect();
      }
    }, delay);
  }

  /**
   * Re-subscribe to all existing subscriptions after reconnect
   */
  private async resubscribe(): Promise<void> {
    const subscriptions = new Map(this.subscriptions);
    this.subscriptions.clear();

    for (const [, options] of subscriptions) {
      try {
        await this.subscribe(options);
      } catch (error) {
        this.debug('Failed to resubscribe:', error);
      }
    }
  }

  /**
   * Start ping interval
   */
  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({
          id: this.generateMessageId(),
          type: 'ping',
          timestamp: new Date().toISOString(),
        });
      }
    }, this.config.pingInterval);
  }

  /**
   * Stop ping interval
   */
  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * Clear connection timer
   */
  private clearConnectionTimer(): void {
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    this.stopPing();
    this.clearConnectionTimer();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Emit event to listeners
   */
  private emit<K extends keyof WebSocketClientEvents>(
    event: K,
    ...args: Parameters<WebSocketClientEvents[K]>
  ): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          (handler as (...args: Parameters<WebSocketClientEvents[K]>) => void)(...args);
        } catch (error) {
          this.debug('Event handler error:', error);
        }
      }
    }
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): string {
    return `${Date.now()}-${++this.messageCounter}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Debug logging - uses injected logger instead of direct console.log
   */
  private debug(...args: unknown[]): void {
    if (this.config.debug) {
      this.logger.log('[AuthzWebSocketClient]', ...args);
    }
  }
}

/**
 * Create a WebSocket client instance
 */
export function createWebSocketClient(config: AuthzWebSocketClientConfig): AuthzWebSocketClient {
  return new AuthzWebSocketClient(config);
}
