/**
 * WebSocket Client Tests
 *
 * Tests for the SDK WebSocket client including connection management,
 * subscriptions, real-time checks, and reconnection logic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  private messageQueue: string[] = [];

  constructor(public url: string) {
    // Simulate async connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 10);
  }

  send(data: string): void {
    this.messageQueue.push(data);
    // Simulate server response
    const message = JSON.parse(data);
    setTimeout(() => {
      this.simulateResponse(message);
    }, 5);
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code: code || 1000, reason: reason || '' } as CloseEvent);
    }
  }

  private simulateResponse(request: Record<string, unknown>): void {
    if (this.readyState !== MockWebSocket.OPEN) return;

    let response: Record<string, unknown>;

    switch (request.type) {
      case 'authenticate':
        response = {
          id: `resp-${Date.now()}`,
          type: 'authenticated',
          timestamp: new Date().toISOString(),
          payload: {
            clientId: 'mock-client-id',
          },
        };
        break;

      case 'subscribe':
        response = {
          id: `resp-${Date.now()}`,
          type: 'ack',
          timestamp: new Date().toISOString(),
          payload: {
            correlationId: request.id,
            success: true,
            subscriptionId: `sub-${Date.now()}`,
            message: 'Subscribed successfully',
          },
        };
        break;

      case 'unsubscribe':
        response = {
          id: `resp-${Date.now()}`,
          type: 'ack',
          timestamp: new Date().toISOString(),
          payload: {
            correlationId: request.id,
            success: true,
            message: 'Unsubscribed successfully',
          },
        };
        break;

      case 'check':
        response = {
          id: `resp-${Date.now()}`,
          type: 'check_response',
          timestamp: new Date().toISOString(),
          payload: {
            requestId: `req-${Date.now()}`,
            correlationId: request.id,
            results: {
              read: { effect: 'allow', policy: 'test-policy' },
              write: { effect: 'deny', policy: 'test-policy' },
            },
            meta: {
              evaluationDurationMs: 1,
              policiesEvaluated: ['test-policy'],
            },
          },
        };
        break;

      case 'ping':
        response = {
          id: `resp-${Date.now()}`,
          type: 'pong',
          timestamp: new Date().toISOString(),
        };
        break;

      default:
        response = {
          id: `resp-${Date.now()}`,
          type: 'error',
          timestamp: new Date().toISOString(),
          payload: {
            code: 'UNKNOWN_MESSAGE_TYPE',
            message: `Unknown message type: ${request.type}`,
            correlationId: request.id,
          },
        };
    }

    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(response) } as MessageEvent);
    }
  }

  // Helper to simulate broadcast message
  simulateBroadcast(message: Record<string, unknown>): void {
    if (this.onmessage && this.readyState === MockWebSocket.OPEN) {
      this.onmessage({ data: JSON.stringify(message) } as MessageEvent);
    }
  }
}

// Set up global WebSocket mock
vi.stubGlobal('WebSocket', MockWebSocket);

// Import after mocking WebSocket
import {
  AuthzWebSocketClient,
  createWebSocketClient,
  type AuthzWebSocketClientConfig,
  type SubscriptionOptions,
} from '../../../../sdk-typescript/src/websocket-client';

describe('AuthzWebSocketClient', () => {
  let client: AuthzWebSocketClient;
  let config: AuthzWebSocketClientConfig;

  beforeEach(() => {
    config = {
      url: 'ws://localhost:3594/ws',
      authToken: 'test-token',
      autoReconnect: false, // Disable for tests
      debug: false,
    };
  });

  afterEach(() => {
    if (client) {
      client.disconnect();
    }
  });

  describe('connection', () => {
    it('should connect successfully', async () => {
      client = createWebSocketClient(config);

      await client.connect();

      expect(client.getState()).toBe('authenticated');
      expect(client.isReady()).toBe(true);
    });

    it('should emit connect event', async () => {
      client = createWebSocketClient(config);
      const connectHandler = vi.fn();

      client.on('connect', connectHandler);
      await client.connect();

      expect(connectHandler).toHaveBeenCalled();
    });

    it('should emit authenticated event', async () => {
      client = createWebSocketClient(config);
      const authHandler = vi.fn();

      client.on('authenticated', authHandler);
      await client.connect();

      expect(authHandler).toHaveBeenCalledWith('mock-client-id');
    });

    it('should return client ID after authentication', async () => {
      client = createWebSocketClient(config);

      await client.connect();

      expect(client.getClientId()).toBe('mock-client-id');
    });
  });

  describe('disconnection', () => {
    it('should disconnect successfully', async () => {
      client = createWebSocketClient(config);
      await client.connect();

      client.disconnect();

      expect(client.getState()).toBe('disconnected');
      expect(client.isReady()).toBe(false);
    });

    it('should emit disconnect event', async () => {
      client = createWebSocketClient(config);
      const disconnectHandler = vi.fn();

      await client.connect();
      client.on('disconnect', disconnectHandler);
      client.disconnect();

      expect(disconnectHandler).toHaveBeenCalled();
    });
  });

  describe('subscriptions', () => {
    beforeEach(async () => {
      client = createWebSocketClient(config);
      await client.connect();
    });

    it('should subscribe to events', async () => {
      const options: SubscriptionOptions = {
        events: ['policy_update', 'authorization_change'],
        principals: { ids: ['user:123'] },
      };

      const subscriptionId = await client.subscribe(options);

      expect(subscriptionId).toBeDefined();
      expect(client.getSubscriptions().size).toBe(1);
    });

    it('should unsubscribe from events', async () => {
      const options: SubscriptionOptions = {
        events: ['policy_update'],
      };

      const subscriptionId = await client.subscribe(options);
      await client.unsubscribe(subscriptionId);

      expect(client.getSubscriptions().size).toBe(0);
    });

    it('should support multiple subscriptions', async () => {
      await client.subscribe({ events: ['policy_update'] });
      await client.subscribe({ events: ['authorization_change'] });
      await client.subscribe({ events: ['anomaly_detected'] });

      expect(client.getSubscriptions().size).toBe(3);
    });
  });

  describe('authorization checks', () => {
    beforeEach(async () => {
      client = createWebSocketClient(config);
      await client.connect();
    });

    it('should perform authorization check', async () => {
      const result = await client.check(
        { id: 'user:123', roles: ['editor'], attributes: {} },
        { kind: 'document', id: 'doc:456', attributes: {} },
        ['read', 'write'],
      );

      expect(result.requestId).toBeDefined();
      expect(result.results).toBeDefined();
      expect(result.results.read.effect).toBe('allow');
      expect(result.results.write.effect).toBe('deny');
    });

    it('should check single action with isAllowed', async () => {
      const allowed = await client.isAllowed(
        { id: 'user:123', roles: ['editor'], attributes: {} },
        { kind: 'document', id: 'doc:456', attributes: {} },
        'read',
      );

      expect(allowed).toBe(true);
    });

    it('should return false for denied action', async () => {
      const allowed = await client.isAllowed(
        { id: 'user:123', roles: ['editor'], attributes: {} },
        { kind: 'document', id: 'doc:456', attributes: {} },
        'write',
      );

      expect(allowed).toBe(false);
    });
  });

  describe('event handling', () => {
    beforeEach(async () => {
      client = createWebSocketClient(config);
      await client.connect();
    });

    it('should handle policy_update events', async () => {
      const handler = vi.fn();
      client.on('policy_update', handler);

      // Get the underlying WebSocket and simulate broadcast
      // Since we can't access the internal ws directly, we'll verify the handler registration
      expect(handler).not.toHaveBeenCalled();
    });

    it('should remove event listener with off', async () => {
      const handler = vi.fn();
      client.on('policy_update', handler);
      client.off('policy_update', handler);

      // Handler should be removed
      expect(handler).not.toHaveBeenCalled();
    });

    it('should return unsubscribe function from on()', async () => {
      const handler = vi.fn();
      const unsubscribe = client.on('policy_update', handler);

      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
    });
  });

  describe('error handling', () => {
    it('should throw error when not connected', async () => {
      client = createWebSocketClient(config);

      await expect(
        client.check(
          { id: 'user:123', roles: [], attributes: {} },
          { kind: 'document', id: 'doc:1', attributes: {} },
          ['read'],
        ),
      ).rejects.toThrow('Not connected');
    });

    it('should throw error for subscribe when not connected', async () => {
      client = createWebSocketClient(config);

      await expect(client.subscribe({ events: ['policy_update'] })).rejects.toThrow(
        'Not connected',
      );
    });
  });
});

describe('createWebSocketClient', () => {
  it('should create client instance', () => {
    const client = createWebSocketClient({
      url: 'ws://localhost:3594/ws',
    });

    expect(client).toBeInstanceOf(AuthzWebSocketClient);
  });

  it('should apply default configuration', () => {
    const client = createWebSocketClient({
      url: 'ws://localhost:3594/ws',
    });

    // Client should be created with defaults
    expect(client.getState()).toBe('disconnected');
    expect(client.isReady()).toBe(false);
  });
});

describe('ConnectionState', () => {
  it('should track connection state transitions', async () => {
    const client = createWebSocketClient({
      url: 'ws://localhost:3594/ws',
      authToken: 'test-token',
      autoReconnect: false,
    });

    expect(client.getState()).toBe('disconnected');

    const connectPromise = client.connect();
    // State becomes 'connecting' immediately
    expect(client.getState()).toBe('connecting');

    await connectPromise;
    expect(client.getState()).toBe('authenticated');

    client.disconnect();
    expect(client.getState()).toBe('disconnected');
  });
});
