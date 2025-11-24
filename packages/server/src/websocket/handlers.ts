/**
 * WebSocket Message Handlers for AuthZ Engine
 *
 * Handles WebSocket messages including subscriptions, real-time checks,
 * and policy update notifications.
 */

import type { DecisionEngine, CheckRequest, CheckResponse } from '@authz-engine/core';
import type { AgentOrchestrator } from '@authz-engine/agents';
import type { Logger } from '../utils/logger';
import type {
  ClientConnection,
  Subscription,
  SubscriptionOptions,
  WebSocketMessage,
  SubscribeMessage,
  UnsubscribeMessage,
  CheckMessage,
  CheckResponseMessage,
  PolicyUpdateMessage,
  AuthorizationChangeMessage,
  AnomalyDetectedMessage,
  EnforcementActionMessage,
  ErrorMessage,
  AckMessage,
  AuthenticateMessage,
  AuthenticatedMessage,
  PongMessage,
  AuthValidationResult,
  Room,
} from './types';

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Create a timestamp string
 */
function timestamp(): string {
  return new Date().toISOString();
}

/**
 * WebSocket message handlers
 */
export class WebSocketHandlers {
  private engine: DecisionEngine;
  private logger: Logger;
  private orchestrator?: AgentOrchestrator;
  private rooms: Map<string, Room> = new Map();
  private authValidator?: (token: string) => Promise<AuthValidationResult>;

  constructor(
    engine: DecisionEngine,
    logger: Logger,
    orchestrator?: AgentOrchestrator,
    authValidator?: (token: string) => Promise<AuthValidationResult>,
  ) {
    this.engine = engine;
    this.logger = logger;
    this.orchestrator = orchestrator;
    this.authValidator = authValidator;
  }

  /**
   * Handle incoming message and route to appropriate handler
   */
  async handleMessage(client: ClientConnection, message: WebSocketMessage): Promise<void> {
    client.lastActivityAt = new Date();

    try {
      switch (message.type) {
        case 'authenticate':
          await this.handleAuthenticate(client, message as AuthenticateMessage);
          break;
        case 'subscribe':
          await this.handleSubscribe(client, message as SubscribeMessage);
          break;
        case 'unsubscribe':
          await this.handleUnsubscribe(client, message as UnsubscribeMessage);
          break;
        case 'check':
          await this.handleCheck(client, message as CheckMessage);
          break;
        case 'ping':
          await this.handlePing(client, message);
          break;
        default:
          this.sendError(client, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type: ${message.type}`, message.id);
      }
    } catch (error) {
      this.logger.error(`Error handling message ${message.type}`, error);
      this.sendError(
        client,
        'HANDLER_ERROR',
        error instanceof Error ? error.message : 'Internal error',
        message.id,
      );
    }
  }

  /**
   * Handle authentication request
   */
  async handleAuthenticate(client: ClientConnection, message: AuthenticateMessage): Promise<void> {
    const { token, clientId } = message.payload;

    if (!this.authValidator) {
      // No auth validator configured, auto-authenticate
      client.state = 'authenticated';
      client.authToken = token;
      client.principalId = clientId || client.id;

      const response: AuthenticatedMessage = {
        id: generateId(),
        type: 'authenticated',
        timestamp: timestamp(),
        payload: {
          clientId: client.id,
        },
      };
      this.sendMessage(client, response);
      return;
    }

    try {
      const result = await this.authValidator(token);

      if (result.valid) {
        client.state = 'authenticated';
        client.authToken = token;
        client.principalId = result.principalId;

        const response: AuthenticatedMessage = {
          id: generateId(),
          type: 'authenticated',
          timestamp: timestamp(),
          payload: {
            clientId: client.id,
            expiresAt: result.expiresAt?.toISOString(),
          },
        };
        this.sendMessage(client, response);
        this.logger.info(`Client ${client.id} authenticated as ${result.principalId}`);
      } else {
        this.sendError(client, 'AUTH_FAILED', result.error || 'Authentication failed', message.id);
        client.socket.close(4001, 'Authentication failed');
      }
    } catch (error) {
      this.logger.error('Authentication error', error);
      this.sendError(client, 'AUTH_ERROR', 'Authentication error', message.id);
      client.socket.close(4001, 'Authentication error');
    }
  }

  /**
   * Handle subscription request
   */
  async handleSubscribe(client: ClientConnection, message: SubscribeMessage): Promise<void> {
    const options = message.payload;

    // Validate subscription options
    if (!options.events || options.events.length === 0) {
      this.sendError(client, 'INVALID_SUBSCRIPTION', 'Events array is required', message.id);
      return;
    }

    // Create subscription
    const subscription: Subscription = {
      id: generateId(),
      clientId: client.id,
      options,
      createdAt: new Date(),
      notificationCount: 0,
    };

    // Add to client's subscriptions
    client.subscriptions.set(subscription.id, subscription);

    // Add client to relevant rooms
    this.addClientToRooms(client, options);

    // Send acknowledgment
    const ack: AckMessage = {
      id: generateId(),
      type: 'ack',
      timestamp: timestamp(),
      payload: {
        correlationId: message.id,
        success: true,
        subscriptionId: subscription.id,
        message: `Subscribed to ${options.events.join(', ')}`,
      },
    };
    this.sendMessage(client, ack);

    this.logger.info(`Client ${client.id} subscribed: ${subscription.id}`, {
      events: options.events,
      principals: options.principals,
      resources: options.resources,
    });
  }

  /**
   * Handle unsubscription request
   */
  async handleUnsubscribe(client: ClientConnection, message: UnsubscribeMessage): Promise<void> {
    const { subscriptionId } = message.payload;

    const subscription = client.subscriptions.get(subscriptionId);
    if (!subscription) {
      this.sendError(client, 'SUBSCRIPTION_NOT_FOUND', `Subscription ${subscriptionId} not found`, message.id);
      return;
    }

    // Remove from client's subscriptions
    client.subscriptions.delete(subscriptionId);

    // Remove client from rooms if no more subscriptions need them
    this.removeClientFromRooms(client, subscription.options);

    // Send acknowledgment
    const ack: AckMessage = {
      id: generateId(),
      type: 'ack',
      timestamp: timestamp(),
      payload: {
        correlationId: message.id,
        success: true,
        message: `Unsubscribed from ${subscriptionId}`,
      },
    };
    this.sendMessage(client, ack);

    this.logger.info(`Client ${client.id} unsubscribed: ${subscriptionId}`);
  }

  /**
   * Handle real-time authorization check
   */
  async handleCheck(client: ClientConnection, message: CheckMessage): Promise<void> {
    const { principal, resource, actions, auxData } = message.payload;

    const checkRequest: CheckRequest = {
      requestId: message.id,
      principal,
      resource,
      actions,
      auxData,
    };

    try {
      const response = this.engine.check(checkRequest);

      // Transform results
      const results: Record<string, { effect: 'allow' | 'deny'; policy: string }> = {};
      for (const [action, result] of Object.entries(response.results)) {
        results[action] = {
          effect: result.effect,
          policy: result.policy,
        };
      }

      const checkResponse: CheckResponseMessage = {
        id: generateId(),
        type: 'check_response',
        timestamp: timestamp(),
        payload: {
          requestId: response.requestId,
          correlationId: message.id,
          results,
          meta: {
            evaluationDurationMs: response.meta?.evaluationDurationMs,
            policiesEvaluated: response.meta?.policiesEvaluated,
          },
        },
      };

      this.sendMessage(client, checkResponse);

      // If orchestrator is available, also process through agent pipeline (async, non-blocking)
      if (this.orchestrator) {
        this.processAgenticCheck(client, checkRequest, response).catch((error) => {
          this.logger.error('Agentic check processing failed', error);
        });
      }
    } catch (error) {
      this.logger.error('Check failed', error);
      this.sendError(
        client,
        'CHECK_ERROR',
        error instanceof Error ? error.message : 'Authorization check failed',
        message.id,
      );
    }
  }

  /**
   * Process agentic check asynchronously
   */
  private async processAgenticCheck(
    client: ClientConnection,
    request: CheckRequest,
    response: CheckResponse,
  ): Promise<void> {
    if (!this.orchestrator) return;

    const agenticResult = await this.orchestrator.processRequest(request, response, {
      includeExplanation: false,
      policyContext: {
        matchedRules: response.meta?.policiesEvaluated || [],
        derivedRoles: [],
      },
    });

    // If anomaly detected, notify subscribed clients
    if (agenticResult.anomaly) {
      const anomalyMessage: AnomalyDetectedMessage = {
        id: generateId(),
        type: 'anomaly_detected',
        timestamp: timestamp(),
        payload: {
          anomalyId: agenticResult.anomaly.id,
          type: agenticResult.anomaly.type,
          severity: agenticResult.anomaly.severity,
          description: agenticResult.anomaly.description,
          score: agenticResult.anomaly.score,
          principalId: agenticResult.anomaly.principalId,
          resourceKind: agenticResult.anomaly.resourceKind,
          action: agenticResult.anomaly.action,
          detectedAt: agenticResult.anomaly.detectedAt.toISOString(),
        },
      };

      // Notify relevant subscribers
      this.broadcastToSubscribers(anomalyMessage, {
        event: 'anomaly_detected',
        principalId: request.principal.id,
        resourceKind: request.resource.kind,
      });
    }

    // If enforcement action was triggered
    if (agenticResult.enforcement?.action) {
      const enforcementMessage: EnforcementActionMessage = {
        id: generateId(),
        type: 'enforcement_action',
        timestamp: timestamp(),
        payload: {
          actionId: agenticResult.enforcement.action.id,
          actionType: agenticResult.enforcement.action.type,
          status: agenticResult.enforcement.action.status,
          principalId: request.principal.id,
          reason: agenticResult.enforcement.reason || 'Automated enforcement',
          triggeredAt: new Date().toISOString(),
        },
      };

      this.broadcastToSubscribers(enforcementMessage, {
        event: 'enforcement_action',
        principalId: request.principal.id,
      });
    }
  }

  /**
   * Handle ping message
   */
  async handlePing(client: ClientConnection, message: WebSocketMessage): Promise<void> {
    client.lastPingAt = new Date();

    const pong: PongMessage = {
      id: generateId(),
      type: 'pong',
      timestamp: timestamp(),
    };
    this.sendMessage(client, pong);
  }

  /**
   * Broadcast policy update to subscribers
   */
  broadcastPolicyUpdate(
    updateType: 'added' | 'modified' | 'removed',
    policyName: string,
    resourceKind?: string,
    summary?: string,
  ): void {
    const message: PolicyUpdateMessage = {
      id: generateId(),
      type: 'policy_update',
      timestamp: timestamp(),
      payload: {
        updateType,
        policyName,
        resourceKind,
        summary: summary || `Policy ${policyName} was ${updateType}`,
        changedAt: new Date().toISOString(),
      },
    };

    this.broadcastToSubscribers(message, {
      event: 'policy_update',
      resourceKind,
    });

    this.logger.info(`Policy update broadcast: ${policyName} ${updateType}`);
  }

  /**
   * Broadcast authorization change to subscribers
   */
  broadcastAuthorizationChange(
    principalId: string | undefined,
    resourceKind: string | undefined,
    resourceId: string | undefined,
    actions: string[] | undefined,
    description: string,
    previousEffect?: 'allow' | 'deny',
    newEffect?: 'allow' | 'deny',
  ): void {
    const message: AuthorizationChangeMessage = {
      id: generateId(),
      type: 'authorization_change',
      timestamp: timestamp(),
      payload: {
        principalId,
        resourceKind,
        resourceId,
        actions,
        description,
        previousEffect,
        newEffect,
      },
    };

    this.broadcastToSubscribers(message, {
      event: 'authorization_change',
      principalId,
      resourceKind,
    });
  }

  /**
   * Broadcast to matching subscribers
   */
  broadcastToSubscribers(
    message: WebSocketMessage,
    criteria: {
      event: string;
      principalId?: string;
      resourceKind?: string;
    },
    clients: Map<string, ClientConnection> = new Map(),
  ): void {
    for (const client of clients.values()) {
      if (client.state !== 'authenticated' && client.state !== 'connected') continue;

      for (const subscription of client.subscriptions.values()) {
        if (this.matchesSubscription(subscription, criteria)) {
          this.sendMessage(client, message);
          subscription.notificationCount++;
          subscription.lastNotifiedAt = new Date();
          break; // Only send once per client
        }
      }
    }
  }

  /**
   * Check if criteria matches subscription
   */
  private matchesSubscription(
    subscription: Subscription,
    criteria: {
      event: string;
      principalId?: string;
      resourceKind?: string;
    },
  ): boolean {
    const { options } = subscription;

    // Check event type
    if (!options.events.includes('all') && !options.events.includes(criteria.event as SubscriptionOptions['events'][0])) {
      return false;
    }

    // Check principal filter
    if (criteria.principalId && options.principals) {
      if (options.principals.ids && options.principals.ids.length > 0) {
        if (!options.principals.ids.includes(criteria.principalId)) {
          return false;
        }
      }
    }

    // Check resource filter
    if (criteria.resourceKind && options.resources) {
      if (options.resources.kinds && options.resources.kinds.length > 0) {
        if (!options.resources.kinds.includes(criteria.resourceKind)) {
          return false;
        }
      }
    }

    // Check anomaly severity threshold
    if (criteria.event === 'anomaly_detected' && options.minAnomalySeverity) {
      // Would need severity in criteria to properly filter
    }

    return true;
  }

  /**
   * Add client to relevant rooms based on subscription options
   */
  private addClientToRooms(client: ClientConnection, options: SubscriptionOptions): void {
    // Global room for all events
    if (options.events.includes('all')) {
      this.joinRoom(client, 'global:all');
    }

    // Event-specific rooms
    for (const event of options.events) {
      if (event !== 'all') {
        this.joinRoom(client, `event:${event}`);
      }
    }

    // Principal rooms
    if (options.principals?.ids) {
      for (const principalId of options.principals.ids) {
        this.joinRoom(client, `principal:${principalId}`);
      }
    }

    // Resource rooms
    if (options.resources?.kinds) {
      for (const kind of options.resources.kinds) {
        this.joinRoom(client, `resource:${kind}`);
      }
    }
  }

  /**
   * Remove client from rooms based on subscription options
   */
  private removeClientFromRooms(client: ClientConnection, options: SubscriptionOptions): void {
    // Check if client still has subscriptions that need these rooms
    const stillNeedsRoom = (roomId: string): boolean => {
      for (const subscription of client.subscriptions.values()) {
        const opts = subscription.options;

        if (roomId.startsWith('global:') && opts.events.includes('all')) return true;
        if (roomId.startsWith('event:')) {
          const event = roomId.split(':')[1];
          if (opts.events.includes(event as SubscriptionOptions['events'][0])) return true;
        }
        if (roomId.startsWith('principal:')) {
          const principalId = roomId.split(':')[1];
          if (opts.principals?.ids?.includes(principalId)) return true;
        }
        if (roomId.startsWith('resource:')) {
          const kind = roomId.split(':')[1];
          if (opts.resources?.kinds?.includes(kind)) return true;
        }
      }
      return false;
    };

    // Leave rooms that are no longer needed
    if (options.events.includes('all') && !stillNeedsRoom('global:all')) {
      this.leaveRoom(client, 'global:all');
    }

    for (const event of options.events) {
      if (event !== 'all') {
        const roomId = `event:${event}`;
        if (!stillNeedsRoom(roomId)) {
          this.leaveRoom(client, roomId);
        }
      }
    }

    if (options.principals?.ids) {
      for (const principalId of options.principals.ids) {
        const roomId = `principal:${principalId}`;
        if (!stillNeedsRoom(roomId)) {
          this.leaveRoom(client, roomId);
        }
      }
    }

    if (options.resources?.kinds) {
      for (const kind of options.resources.kinds) {
        const roomId = `resource:${kind}`;
        if (!stillNeedsRoom(roomId)) {
          this.leaveRoom(client, roomId);
        }
      }
    }
  }

  /**
   * Join a room
   */
  private joinRoom(client: ClientConnection, roomId: string): void {
    let room = this.rooms.get(roomId);
    if (!room) {
      const [type] = roomId.split(':');
      room = {
        id: roomId,
        type: type as Room['type'],
        clients: new Set(),
        createdAt: new Date(),
      };
      this.rooms.set(roomId, room);
    }
    room.clients.add(client.id);
  }

  /**
   * Leave a room
   */
  private leaveRoom(client: ClientConnection, roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.clients.delete(client.id);
      if (room.clients.size === 0) {
        this.rooms.delete(roomId);
      }
    }
  }

  /**
   * Clean up client from all rooms
   */
  cleanupClient(client: ClientConnection): void {
    for (const room of this.rooms.values()) {
      room.clients.delete(client.id);
    }
    // Remove empty rooms
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.clients.size === 0) {
        this.rooms.delete(roomId);
      }
    }
  }

  /**
   * Get rooms for debugging/monitoring
   */
  getRooms(): Map<string, Room> {
    return this.rooms;
  }

  /**
   * Send a message to a client
   */
  sendMessage(client: ClientConnection, message: WebSocketMessage): void {
    if (client.socket.readyState === 1) { // WebSocket.OPEN
      client.socket.send(JSON.stringify(message));
    }
  }

  /**
   * Send an error message to a client
   */
  sendError(
    client: ClientConnection,
    code: string,
    message: string,
    correlationId?: string,
    details?: Record<string, unknown>,
  ): void {
    const errorMessage: ErrorMessage = {
      id: generateId(),
      type: 'error',
      timestamp: timestamp(),
      payload: {
        code,
        message,
        correlationId,
        details,
      },
    };
    this.sendMessage(client, errorMessage);
  }
}
