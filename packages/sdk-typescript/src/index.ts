export { AuthzClient, AuthzError, createClient } from './client';
export type { AuthzClientConfig, CheckOptions, CheckResult } from './client';

// WebSocket client exports
export { AuthzWebSocketClient, createWebSocketClient } from './websocket-client';
export type {
  AuthzWebSocketClientConfig,
  SubscriptionOptions,
  WebSocketCheckResult,
  PolicyUpdateEvent,
  AuthorizationChangeEvent,
  AnomalyDetectedEvent,
  EnforcementActionEvent,
  ConnectionState,
  WebSocketClientEvents,
} from './websocket-client';

// Re-export core types for convenience
export type {
  Principal,
  Resource,
  Effect,
  CheckRequest,
  CheckResponse,
} from '@authz-engine/core';
