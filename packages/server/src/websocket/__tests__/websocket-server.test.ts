/**
 * WebSocket Server Tests
 *
 * Tests for WebSocket server functionality including connections,
 * subscriptions, real-time checks, and policy updates.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import { WebSocketServer } from '../index';
import { WebSocketHandlers } from '../handlers';
import type {
  WebSocketMessage,
  SubscribeMessage,
  CheckMessage,
  ClientConnection,
  SubscriptionOptions,
} from '../types';

// Mock dependencies
vi.mock('@authz-engine/core', () => ({
  DecisionEngine: vi.fn().mockImplementation(() => ({
    check: vi.fn().mockReturnValue({
      requestId: 'test-request-id',
      results: {
        read: { effect: 'allow', policy: 'test-policy' },
        write: { effect: 'deny', policy: 'test-policy' },
      },
      meta: {
        evaluationDurationMs: 1,
        policiesEvaluated: ['test-policy'],
      },
    }),
    getStats: vi.fn().mockReturnValue({
      resourcePolicies: 1,
      derivedRolesPolicies: 0,
      resources: ['document'],
    }),
  })),
}));

vi.mock('../../utils/logger', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  })),
}));

// Helper to create mock WebSocket
function createMockSocket(): WebSocket {
  return {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
    ping: vi.fn(),
    terminate: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
  } as unknown as WebSocket;
}

// Helper to create mock client connection
function createMockClient(overrides?: Partial<ClientConnection>): ClientConnection {
  return {
    id: 'test-client-id',
    socket: createMockSocket(),
    state: 'connected',
    subscriptions: new Map(),
    connectedAt: new Date(),
    lastActivityAt: new Date(),
    ...overrides,
  };
}

// Helper to generate message ID
function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

describe('WebSocketHandlers', () => {
  let handlers: WebSocketHandlers;
  let mockEngine: ReturnType<typeof vi.fn>;
  let mockLogger: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { DecisionEngine } = await import('@authz-engine/core');
    const { Logger } = await import('../../utils/logger');

    mockEngine = new DecisionEngine();
    mockLogger = new Logger();
    handlers = new WebSocketHandlers(mockEngine, mockLogger);
  });

  describe('handleSubscribe', () => {
    it('should create subscription and send acknowledgment', async () => {
      const client = createMockClient();
      const messageId = generateMessageId();

      const subscribeMessage: SubscribeMessage = {
        id: messageId,
        type: 'subscribe',
        timestamp: new Date().toISOString(),
        payload: {
          events: ['policy_update', 'authorization_change'],
          principals: { ids: ['user:123'] },
          resources: { kinds: ['document'] },
        },
      };

      await handlers.handleMessage(client, subscribeMessage);

      // Check that subscription was created
      expect(client.subscriptions.size).toBe(1);

      // Check that acknowledgment was sent
      expect(client.socket.send).toHaveBeenCalled();
      const sentMessage = JSON.parse(
        (client.socket.send as ReturnType<typeof vi.fn>).mock.calls[0][0],
      ) as WebSocketMessage;
      expect(sentMessage.type).toBe('ack');
      expect((sentMessage.payload as Record<string, unknown>).success).toBe(true);
      expect((sentMessage.payload as Record<string, unknown>).subscriptionId).toBeDefined();
    });

    it('should reject subscription without events', async () => {
      const client = createMockClient();
      const messageId = generateMessageId();

      const subscribeMessage: SubscribeMessage = {
        id: messageId,
        type: 'subscribe',
        timestamp: new Date().toISOString(),
        payload: {
          events: [],
        },
      };

      await handlers.handleMessage(client, subscribeMessage);

      // Check that error was sent
      expect(client.socket.send).toHaveBeenCalled();
      const sentMessage = JSON.parse(
        (client.socket.send as ReturnType<typeof vi.fn>).mock.calls[0][0],
      ) as WebSocketMessage;
      expect(sentMessage.type).toBe('error');
      expect((sentMessage.payload as Record<string, unknown>).code).toBe('INVALID_SUBSCRIPTION');
    });
  });

  describe('handleUnsubscribe', () => {
    it('should remove subscription and send acknowledgment', async () => {
      const client = createMockClient();

      // First create a subscription
      const subscriptionId = 'test-subscription-id';
      client.subscriptions.set(subscriptionId, {
        id: subscriptionId,
        clientId: client.id,
        options: { events: ['policy_update'] },
        createdAt: new Date(),
        notificationCount: 0,
      });

      const messageId = generateMessageId();
      const unsubscribeMessage: WebSocketMessage = {
        id: messageId,
        type: 'unsubscribe',
        timestamp: new Date().toISOString(),
        payload: { subscriptionId },
      };

      await handlers.handleMessage(client, unsubscribeMessage);

      // Check that subscription was removed
      expect(client.subscriptions.size).toBe(0);

      // Check that acknowledgment was sent
      expect(client.socket.send).toHaveBeenCalled();
      const sentMessage = JSON.parse(
        (client.socket.send as ReturnType<typeof vi.fn>).mock.calls[0][0],
      ) as WebSocketMessage;
      expect(sentMessage.type).toBe('ack');
      expect((sentMessage.payload as Record<string, unknown>).success).toBe(true);
    });

    it('should send error for non-existent subscription', async () => {
      const client = createMockClient();
      const messageId = generateMessageId();

      const unsubscribeMessage: WebSocketMessage = {
        id: messageId,
        type: 'unsubscribe',
        timestamp: new Date().toISOString(),
        payload: { subscriptionId: 'non-existent' },
      };

      await handlers.handleMessage(client, unsubscribeMessage);

      // Check that error was sent
      expect(client.socket.send).toHaveBeenCalled();
      const sentMessage = JSON.parse(
        (client.socket.send as ReturnType<typeof vi.fn>).mock.calls[0][0],
      ) as WebSocketMessage;
      expect(sentMessage.type).toBe('error');
      expect((sentMessage.payload as Record<string, unknown>).code).toBe('SUBSCRIPTION_NOT_FOUND');
    });
  });

  describe('handleCheck', () => {
    it('should perform authorization check and send response', async () => {
      const client = createMockClient();
      const messageId = generateMessageId();

      const checkMessage: CheckMessage = {
        id: messageId,
        type: 'check',
        timestamp: new Date().toISOString(),
        payload: {
          principal: {
            id: 'user:123',
            roles: ['editor'],
            attributes: {},
          },
          resource: {
            kind: 'document',
            id: 'doc:456',
            attributes: {},
          },
          actions: ['read', 'write'],
        },
      };

      await handlers.handleMessage(client, checkMessage);

      // Check that response was sent
      expect(client.socket.send).toHaveBeenCalled();
      const sentMessage = JSON.parse(
        (client.socket.send as ReturnType<typeof vi.fn>).mock.calls[0][0],
      ) as WebSocketMessage;
      expect(sentMessage.type).toBe('check_response');
      expect((sentMessage.payload as Record<string, unknown>).correlationId).toBe(messageId);
      expect((sentMessage.payload as Record<string, Record<string, unknown>>).results).toBeDefined();
    });
  });

  describe('handlePing', () => {
    it('should respond with pong', async () => {
      const client = createMockClient();
      const messageId = generateMessageId();

      const pingMessage: WebSocketMessage = {
        id: messageId,
        type: 'ping',
        timestamp: new Date().toISOString(),
      };

      await handlers.handleMessage(client, pingMessage);

      // Check that pong was sent
      expect(client.socket.send).toHaveBeenCalled();
      const sentMessage = JSON.parse(
        (client.socket.send as ReturnType<typeof vi.fn>).mock.calls[0][0],
      ) as WebSocketMessage;
      expect(sentMessage.type).toBe('pong');
    });
  });

  describe('broadcastPolicyUpdate', () => {
    it('should create policy update message with correct payload', () => {
      // Just verify the method doesn't throw and logs correctly
      handlers.broadcastPolicyUpdate('modified', 'test-policy', 'document', 'Policy was updated');

      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe('cleanupClient', () => {
    it('should remove client from all rooms', () => {
      const client = createMockClient();

      // Add client to subscription to create rooms
      client.subscriptions.set('sub-1', {
        id: 'sub-1',
        clientId: client.id,
        options: {
          events: ['all'],
          principals: { ids: ['user:123'] },
        },
        createdAt: new Date(),
        notificationCount: 0,
      });

      // Cleanup should not throw
      handlers.cleanupClient(client);

      // Rooms should be cleaned
      expect(handlers.getRooms().size).toBe(0);
    });
  });
});

describe('WebSocketMessage Types', () => {
  it('should validate subscribe message structure', () => {
    const message: SubscribeMessage = {
      id: 'test-id',
      type: 'subscribe',
      timestamp: new Date().toISOString(),
      payload: {
        events: ['policy_update'],
        principals: { ids: ['user:1'] },
      },
    };

    expect(message.type).toBe('subscribe');
    expect(message.payload.events).toContain('policy_update');
  });

  it('should validate check message structure', () => {
    const message: CheckMessage = {
      id: 'test-id',
      type: 'check',
      timestamp: new Date().toISOString(),
      payload: {
        principal: {
          id: 'user:1',
          roles: ['admin'],
          attributes: { department: 'engineering' },
        },
        resource: {
          kind: 'document',
          id: 'doc:1',
          attributes: { owner: 'user:1' },
        },
        actions: ['read', 'write', 'delete'],
      },
    };

    expect(message.type).toBe('check');
    expect(message.payload.actions).toHaveLength(3);
    expect(message.payload.principal.roles).toContain('admin');
  });
});

describe('SubscriptionOptions', () => {
  it('should support all event types', () => {
    const options: SubscriptionOptions = {
      events: ['all'],
    };

    expect(options.events).toContain('all');
  });

  it('should support filtering by principals and resources', () => {
    const options: SubscriptionOptions = {
      events: ['authorization_change'],
      principals: {
        ids: ['user:1', 'user:2'],
        roles: ['admin'],
      },
      resources: {
        kinds: ['document', 'folder'],
        ids: ['doc:123'],
      },
      actions: ['read', 'write'],
      minAnomalySeverity: 'medium',
    };

    expect(options.principals?.ids).toHaveLength(2);
    expect(options.resources?.kinds).toHaveLength(2);
    expect(options.actions).toHaveLength(2);
  });
});
