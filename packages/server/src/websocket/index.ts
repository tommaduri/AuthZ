/**
 * WebSocket Server for AuthZ Engine
 *
 * Provides real-time WebSocket communication for authorization updates,
 * policy changes, and anomaly notifications.
 */

import { WebSocketServer as WSServer, WebSocket } from 'ws';
import type { Server as HttpServer, IncomingMessage } from 'http';
import type { DecisionEngine } from '@authz-engine/core';
import type { AgentOrchestrator } from '@authz-engine/agents';
import { Logger } from '../utils/logger';
import { WebSocketHandlers } from './handlers';
import type {
  ClientConnection,
  WebSocketServerConfig,
  WebSocketMessage,
  ConnectionStats,
  AuthValidationResult,
  BroadcastOptions,
} from './types';

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * WebSocket Server for real-time authorization updates
 */
export class WebSocketServer {
  private wss: WSServer | null = null;
  private clients: Map<string, ClientConnection> = new Map();
  private handlers: WebSocketHandlers;
  private logger: Logger;
  private config: Required<WebSocketServerConfig>;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private startTime: Date;
  private stats: {
    messagesSent: number;
    messagesReceived: number;
    errorsCount: number;
  } = {
    messagesSent: 0,
    messagesReceived: 0,
    errorsCount: 0,
  };

  constructor(
    private engine: DecisionEngine,
    logger: Logger,
    private orchestrator?: AgentOrchestrator,
    config: WebSocketServerConfig = {},
  ) {
    this.logger = logger.child({ component: 'websocket' });
    this.startTime = new Date();

    // Set default configuration
    this.config = {
      port: config.port || 3594,
      path: config.path || '/ws',
      requireAuth: config.requireAuth ?? false,
      authValidator: config.authValidator || (async () => ({ valid: true })),
      heartbeatInterval: config.heartbeatInterval || 30000,
      clientTimeout: config.clientTimeout || 60000,
      maxMessageSize: config.maxMessageSize || 1024 * 1024, // 1MB
      maxSubscriptionsPerClient: config.maxSubscriptionsPerClient || 100,
      perMessageDeflate: config.perMessageDeflate ?? true,
    };

    this.handlers = new WebSocketHandlers(
      engine,
      this.logger,
      orchestrator,
      this.config.requireAuth ? this.config.authValidator : undefined,
    );
  }

  /**
   * Start standalone WebSocket server on specified port
   */
  async start(port?: number): Promise<void> {
    const wsPort = port || this.config.port;

    this.wss = new WSServer({
      port: wsPort,
      path: this.config.path,
      maxPayload: this.config.maxMessageSize,
      perMessageDeflate: this.config.perMessageDeflate,
    });

    this.setupServer();
    this.startHeartbeat();

    this.logger.info(`WebSocket server started on port ${wsPort}${this.config.path}`);
  }

  /**
   * Attach WebSocket server to existing HTTP server
   */
  attachToServer(httpServer: HttpServer): void {
    this.wss = new WSServer({
      server: httpServer,
      path: this.config.path,
      maxPayload: this.config.maxMessageSize,
      perMessageDeflate: this.config.perMessageDeflate,
    });

    this.setupServer();
    this.startHeartbeat();

    this.logger.info(`WebSocket server attached at path ${this.config.path}`);
  }

  /**
   * Setup WebSocket server event handlers
   */
  private setupServer(): void {
    if (!this.wss) return;

    this.wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
      this.handleConnection(socket, request);
    });

    this.wss.on('error', (error: Error) => {
      this.logger.error('WebSocket server error', error);
      this.stats.errorsCount++;
    });

    this.wss.on('close', () => {
      this.logger.info('WebSocket server closed');
    });
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const clientId = generateId();
    const remoteAddress = request.socket.remoteAddress;
    const userAgent = request.headers['user-agent'];

    const client: ClientConnection = {
      id: clientId,
      socket,
      state: this.config.requireAuth ? 'connecting' : 'connected',
      subscriptions: new Map(),
      connectedAt: new Date(),
      lastActivityAt: new Date(),
      remoteAddress,
      userAgent,
    };

    this.clients.set(clientId, client);

    this.logger.info(`Client connected: ${clientId}`, { remoteAddress, userAgent });

    // Setup socket event handlers
    socket.on('message', (data: Buffer | string) => {
      this.handleMessage(client, data);
    });

    socket.on('close', (code: number, reason: Buffer) => {
      this.handleDisconnect(client, code, reason.toString());
    });

    socket.on('error', (error: Error) => {
      this.logger.error(`Client error: ${clientId}`, error);
      this.stats.errorsCount++;
    });

    socket.on('pong', () => {
      client.lastPingAt = new Date();
    });

    // If auth is required, set a timeout for authentication
    if (this.config.requireAuth) {
      setTimeout(() => {
        if (client.state === 'connecting') {
          this.logger.warn(`Client ${clientId} did not authenticate in time`);
          socket.close(4001, 'Authentication timeout');
        }
      }, 10000);
    }
  }

  /**
   * Handle incoming message from client
   */
  private handleMessage(client: ClientConnection, data: Buffer | string): void {
    this.stats.messagesReceived++;
    client.lastActivityAt = new Date();

    try {
      const messageStr = typeof data === 'string' ? data : data.toString('utf-8');
      const message = JSON.parse(messageStr) as WebSocketMessage;

      // Validate message structure
      if (!message.type || !message.id) {
        this.handlers.sendError(client, 'INVALID_MESSAGE', 'Message must have type and id');
        return;
      }

      // Check if client needs to authenticate first
      if (this.config.requireAuth && client.state === 'connecting' && message.type !== 'authenticate') {
        this.handlers.sendError(client, 'AUTH_REQUIRED', 'Authentication required');
        return;
      }

      // Route message to handler
      this.handlers.handleMessage(client, message).catch((error) => {
        this.logger.error('Error handling message', error);
        this.handlers.sendError(
          client,
          'HANDLER_ERROR',
          error instanceof Error ? error.message : 'Handler error',
          message.id,
        );
      });
    } catch (error) {
      this.logger.error('Failed to parse message', error);
      this.handlers.sendError(client, 'PARSE_ERROR', 'Invalid JSON message');
    }
  }

  /**
   * Handle client disconnect
   */
  private handleDisconnect(client: ClientConnection, code: number, reason: string): void {
    this.logger.info(`Client disconnected: ${client.id}`, { code, reason });

    // Cleanup subscriptions and rooms
    this.handlers.cleanupClient(client);

    // Remove from clients map
    this.clients.delete(client.id);

    client.state = 'disconnected';
  }

  /**
   * Start heartbeat/ping interval
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();

      for (const client of this.clients.values()) {
        // Check for stale connections
        const lastActivity = client.lastActivityAt.getTime();
        if (now - lastActivity > this.config.clientTimeout) {
          this.logger.warn(`Client ${client.id} timed out`);
          client.socket.terminate();
          continue;
        }

        // Send ping
        if (client.socket.readyState === WebSocket.OPEN) {
          client.socket.ping();
        }
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Stop the WebSocket server
   */
  async stop(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Close all client connections
    for (const client of this.clients.values()) {
      client.socket.close(1001, 'Server shutting down');
    }
    this.clients.clear();

    // Close WebSocket server
    if (this.wss) {
      await new Promise<void>((resolve, reject) => {
        this.wss!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.wss = null;
    }

    this.logger.info('WebSocket server stopped');
  }

  /**
   * Broadcast message to all clients or filtered subset
   */
  broadcast(message: WebSocketMessage, options?: BroadcastOptions): void {
    for (const client of this.clients.values()) {
      // Check state
      if (client.state !== 'authenticated' && client.state !== 'connected') continue;

      // Check exclusions
      if (options?.exclude?.includes(client.id)) continue;

      // Check filter function
      if (options?.filter && !options.filter(client)) continue;

      // Send message
      this.sendToClient(client, message);
    }
  }

  /**
   * Send message to a specific client
   */
  sendToClient(client: ClientConnection, message: WebSocketMessage): boolean {
    if (client.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      client.socket.send(JSON.stringify(message));
      this.stats.messagesSent++;
      return true;
    } catch (error) {
      this.logger.error(`Failed to send message to client ${client.id}`, error);
      this.stats.errorsCount++;
      return false;
    }
  }

  /**
   * Broadcast policy update notification
   */
  notifyPolicyUpdate(
    updateType: 'added' | 'modified' | 'removed',
    policyName: string,
    resourceKind?: string,
    summary?: string,
  ): void {
    this.handlers.broadcastPolicyUpdate(updateType, policyName, resourceKind, summary);

    // Also need to pass clients to handlers for broadcasting
    const message = {
      id: generateId(),
      type: 'policy_update' as const,
      timestamp: new Date().toISOString(),
      payload: {
        updateType,
        policyName,
        resourceKind,
        summary: summary || `Policy ${policyName} was ${updateType}`,
        changedAt: new Date().toISOString(),
      },
    };

    this.broadcast(message, {
      filter: (client) => {
        // Check if client has subscription for policy updates
        for (const subscription of client.subscriptions.values()) {
          const events = subscription.options.events;
          if (events.includes('all') || events.includes('policy_update')) {
            return true;
          }
        }
        return false;
      },
    });
  }

  /**
   * Broadcast authorization change notification
   */
  notifyAuthorizationChange(
    principalId: string | undefined,
    resourceKind: string | undefined,
    resourceId: string | undefined,
    actions: string[] | undefined,
    description: string,
    previousEffect?: 'allow' | 'deny',
    newEffect?: 'allow' | 'deny',
  ): void {
    const message = {
      id: generateId(),
      type: 'authorization_change' as const,
      timestamp: new Date().toISOString(),
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

    this.broadcast(message, {
      filter: (client) => {
        for (const subscription of client.subscriptions.values()) {
          const { events, principals, resources } = subscription.options;

          // Check event subscription
          if (!events.includes('all') && !events.includes('authorization_change')) {
            continue;
          }

          // Check principal filter
          if (principalId && principals?.ids?.length) {
            if (!principals.ids.includes(principalId)) {
              continue;
            }
          }

          // Check resource filter
          if (resourceKind && resources?.kinds?.length) {
            if (!resources.kinds.includes(resourceKind)) {
              continue;
            }
          }

          return true;
        }
        return false;
      },
    });
  }

  /**
   * Get connection statistics
   */
  getStats(): ConnectionStats {
    let authenticatedConnections = 0;
    let totalSubscriptions = 0;

    for (const client of this.clients.values()) {
      if (client.state === 'authenticated') {
        authenticatedConnections++;
      }
      totalSubscriptions += client.subscriptions.size;
    }

    return {
      totalConnections: this.clients.size,
      authenticatedConnections,
      totalSubscriptions,
      messagesSent: this.stats.messagesSent,
      messagesReceived: this.stats.messagesReceived,
      errorsCount: this.stats.errorsCount,
      uptimeSeconds: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
    };
  }

  /**
   * Get all connected clients (for debugging/monitoring)
   */
  getClients(): Map<string, ClientConnection> {
    return this.clients;
  }

  /**
   * Get a specific client by ID
   */
  getClient(clientId: string): ClientConnection | undefined {
    return this.clients.get(clientId);
  }

  /**
   * Disconnect a specific client
   */
  disconnectClient(clientId: string, reason: string = 'Disconnected by server'): boolean {
    const client = this.clients.get(clientId);
    if (!client) return false;

    client.socket.close(1000, reason);
    return true;
  }

  /**
   * Get handlers for external access
   */
  getHandlers(): WebSocketHandlers {
    return this.handlers;
  }
}

// Export types
export * from './types';
export { WebSocketHandlers } from './handlers';
