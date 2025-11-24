/**
 * WebSocket Types for AuthZ Engine
 *
 * Defines types for WebSocket communication including messages,
 * subscriptions, and client connections for real-time authorization updates.
 */

import type { Principal, Resource, Effect, CheckResponse } from '@authz-engine/core';
import type WebSocket from 'ws';

// =============================================================================
// Message Types
// =============================================================================

/**
 * WebSocket message types for client-server communication
 */
export type WebSocketMessageType =
  | 'subscribe'
  | 'unsubscribe'
  | 'check'
  | 'check_response'
  | 'policy_update'
  | 'authorization_change'
  | 'anomaly_detected'
  | 'enforcement_action'
  | 'error'
  | 'ack'
  | 'ping'
  | 'pong'
  | 'authenticate'
  | 'authenticated';

/**
 * Base WebSocket message interface
 */
export interface WebSocketMessageBase {
  /** Unique message ID for correlation */
  id: string;
  /** Message type */
  type: WebSocketMessageType;
  /** Timestamp of message creation */
  timestamp: string;
}

/**
 * Subscribe message - subscribe to authorization changes
 */
export interface SubscribeMessage extends WebSocketMessageBase {
  type: 'subscribe';
  payload: SubscriptionOptions;
}

/**
 * Unsubscribe message - unsubscribe from updates
 */
export interface UnsubscribeMessage extends WebSocketMessageBase {
  type: 'unsubscribe';
  payload: {
    subscriptionId: string;
  };
}

/**
 * Real-time check message
 */
export interface CheckMessage extends WebSocketMessageBase {
  type: 'check';
  payload: {
    principal: Principal;
    resource: Resource;
    actions: string[];
    auxData?: Record<string, unknown>;
  };
}

/**
 * Check response message
 */
export interface CheckResponseMessage extends WebSocketMessageBase {
  type: 'check_response';
  payload: {
    requestId: string;
    correlationId: string;
    results: Record<string, { effect: Effect; policy: string }>;
    meta?: {
      evaluationDurationMs?: number;
      policiesEvaluated?: string[];
    };
  };
}

/**
 * Policy update notification
 */
export interface PolicyUpdateMessage extends WebSocketMessageBase {
  type: 'policy_update';
  payload: {
    /** Type of update */
    updateType: 'added' | 'modified' | 'removed';
    /** Policy name */
    policyName: string;
    /** Resource kind affected */
    resourceKind?: string;
    /** Summary of changes */
    summary: string;
    /** Timestamp of the policy change */
    changedAt: string;
  };
}

/**
 * Authorization change notification
 */
export interface AuthorizationChangeMessage extends WebSocketMessageBase {
  type: 'authorization_change';
  payload: {
    /** Principal affected */
    principalId?: string;
    /** Resource affected */
    resourceKind?: string;
    resourceId?: string;
    /** Actions affected */
    actions?: string[];
    /** Description of the change */
    description: string;
    /** Previous effect (if applicable) */
    previousEffect?: Effect;
    /** New effect */
    newEffect?: Effect;
  };
}

/**
 * Anomaly detection notification
 */
export interface AnomalyDetectedMessage extends WebSocketMessageBase {
  type: 'anomaly_detected';
  payload: {
    anomalyId: string;
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    score: number;
    principalId: string;
    resourceKind?: string;
    action?: string;
    detectedAt: string;
  };
}

/**
 * Enforcement action notification
 */
export interface EnforcementActionMessage extends WebSocketMessageBase {
  type: 'enforcement_action';
  payload: {
    actionId: string;
    actionType: string;
    status: 'pending' | 'executed' | 'rejected' | 'rolled_back';
    principalId?: string;
    reason: string;
    triggeredAt: string;
  };
}

/**
 * Error message
 */
export interface ErrorMessage extends WebSocketMessageBase {
  type: 'error';
  payload: {
    code: string;
    message: string;
    correlationId?: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Acknowledgment message
 */
export interface AckMessage extends WebSocketMessageBase {
  type: 'ack';
  payload: {
    correlationId: string;
    success: boolean;
    subscriptionId?: string;
    message?: string;
  };
}

/**
 * Ping message for heartbeat
 */
export interface PingMessage extends WebSocketMessageBase {
  type: 'ping';
  payload?: Record<string, never>;
}

/**
 * Pong message for heartbeat response
 */
export interface PongMessage extends WebSocketMessageBase {
  type: 'pong';
  payload?: Record<string, never>;
}

/**
 * Authentication request message
 */
export interface AuthenticateMessage extends WebSocketMessageBase {
  type: 'authenticate';
  payload: {
    token: string;
    clientId?: string;
  };
}

/**
 * Authentication success message
 */
export interface AuthenticatedMessage extends WebSocketMessageBase {
  type: 'authenticated';
  payload: {
    clientId: string;
    expiresAt?: string;
  };
}

/**
 * Union type of all WebSocket messages
 */
export type WebSocketMessage =
  | SubscribeMessage
  | UnsubscribeMessage
  | CheckMessage
  | CheckResponseMessage
  | PolicyUpdateMessage
  | AuthorizationChangeMessage
  | AnomalyDetectedMessage
  | EnforcementActionMessage
  | ErrorMessage
  | AckMessage
  | PingMessage
  | PongMessage
  | AuthenticateMessage
  | AuthenticatedMessage;

// =============================================================================
// Subscription Types
// =============================================================================

/**
 * Subscription filter for principals
 */
export interface PrincipalFilter {
  /** Specific principal IDs to watch */
  ids?: string[];
  /** Roles to filter by */
  roles?: string[];
  /** Attribute patterns to match */
  attributePatterns?: Record<string, unknown>;
}

/**
 * Subscription filter for resources
 */
export interface ResourceFilter {
  /** Resource kinds to watch */
  kinds?: string[];
  /** Specific resource IDs to watch */
  ids?: string[];
  /** Attribute patterns to match */
  attributePatterns?: Record<string, unknown>;
}

/**
 * Subscription options for filtering updates
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
  principals?: PrincipalFilter;
  /** Resource filter */
  resources?: ResourceFilter;
  /** Actions to watch */
  actions?: string[];
  /** Whether to include batch notifications */
  includeBatch?: boolean;
  /** Minimum anomaly severity to notify */
  minAnomalySeverity?: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Active subscription record
 */
export interface Subscription {
  /** Unique subscription ID */
  id: string;
  /** Client ID that owns this subscription */
  clientId: string;
  /** Subscription options */
  options: SubscriptionOptions;
  /** Created timestamp */
  createdAt: Date;
  /** Last notification timestamp */
  lastNotifiedAt?: Date;
  /** Number of notifications sent */
  notificationCount: number;
}

// =============================================================================
// Connection Types
// =============================================================================

/**
 * Client connection state
 */
export type ConnectionState = 'connecting' | 'authenticated' | 'connected' | 'disconnected';

/**
 * Client connection information
 */
export interface ClientConnection {
  /** Unique client ID */
  id: string;
  /** WebSocket instance */
  socket: WebSocket;
  /** Connection state */
  state: ConnectionState;
  /** Authentication token (if authenticated) */
  authToken?: string;
  /** Principal ID (if authenticated) */
  principalId?: string;
  /** Active subscriptions for this client */
  subscriptions: Map<string, Subscription>;
  /** Connected timestamp */
  connectedAt: Date;
  /** Last activity timestamp */
  lastActivityAt: Date;
  /** Last ping timestamp */
  lastPingAt?: Date;
  /** Remote IP address */
  remoteAddress?: string;
  /** User agent */
  userAgent?: string;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Room for grouping subscriptions
 */
export interface Room {
  /** Room ID (e.g., "principal:user123" or "resource:subscription") */
  id: string;
  /** Room type */
  type: 'principal' | 'resource' | 'action' | 'policy' | 'global';
  /** Client IDs in this room */
  clients: Set<string>;
  /** Created timestamp */
  createdAt: Date;
}

// =============================================================================
// Server Configuration Types
// =============================================================================

/**
 * WebSocket server configuration
 */
export interface WebSocketServerConfig {
  /** Port to listen on (if standalone) */
  port?: number;
  /** Path for WebSocket endpoint */
  path?: string;
  /** Whether authentication is required */
  requireAuth?: boolean;
  /** Authentication validator function */
  authValidator?: (token: string) => Promise<AuthValidationResult>;
  /** Heartbeat interval in milliseconds */
  heartbeatInterval?: number;
  /** Client timeout in milliseconds */
  clientTimeout?: number;
  /** Maximum message size in bytes */
  maxMessageSize?: number;
  /** Maximum subscriptions per client */
  maxSubscriptionsPerClient?: number;
  /** Enable compression */
  perMessageDeflate?: boolean;
}

/**
 * Authentication validation result
 */
export interface AuthValidationResult {
  valid: boolean;
  principalId?: string;
  expiresAt?: Date;
  error?: string;
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Internal server events
 */
export interface ServerEvents {
  /** Client connected */
  'client:connected': (client: ClientConnection) => void;
  /** Client disconnected */
  'client:disconnected': (clientId: string, reason: string) => void;
  /** Client authenticated */
  'client:authenticated': (client: ClientConnection) => void;
  /** Subscription created */
  'subscription:created': (subscription: Subscription) => void;
  /** Subscription removed */
  'subscription:removed': (subscriptionId: string, clientId: string) => void;
  /** Message received */
  'message:received': (clientId: string, message: WebSocketMessage) => void;
  /** Error occurred */
  'error': (error: Error, clientId?: string) => void;
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Message handler function type
 */
export type MessageHandler<T extends WebSocketMessage = WebSocketMessage> = (
  client: ClientConnection,
  message: T,
) => Promise<void>;

/**
 * Broadcast options
 */
export interface BroadcastOptions {
  /** Room to broadcast to */
  room?: string;
  /** Client IDs to exclude */
  exclude?: string[];
  /** Filter function for clients */
  filter?: (client: ClientConnection) => boolean;
}

/**
 * Connection statistics
 */
export interface ConnectionStats {
  /** Total active connections */
  totalConnections: number;
  /** Authenticated connections */
  authenticatedConnections: number;
  /** Total active subscriptions */
  totalSubscriptions: number;
  /** Messages sent */
  messagesSent: number;
  /** Messages received */
  messagesReceived: number;
  /** Errors count */
  errorsCount: number;
  /** Server uptime in seconds */
  uptimeSeconds: number;
}
