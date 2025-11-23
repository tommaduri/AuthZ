/**
 * Connection Pool with Load Balancing for AuthZ Engine gRPC Client
 */

import * as grpc from '@grpc/grpc-js';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import {
  type ConnectionPoolOptions,
  type ConnectionPoolStats,
  type PooledConnection,
  type ReconnectConfig,
  ConnectionState,
  LoadBalancingStrategy,
  DEFAULT_POOL_OPTIONS,
  DEFAULT_RECONNECT_CONFIG,
} from './types.js';

/**
 * Internal connection wrapper with additional metadata
 */
interface InternalConnection extends PooledConnection {
  client: unknown;
  acquireQueue: Array<{
    resolve: (conn: InternalConnection) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>;
}

/**
 * Connection factory function type
 */
type ConnectionFactory = (address: string) => Promise<unknown>;

/**
 * Connection close function type
 */
type ConnectionCloser = (client: unknown) => void;

/**
 * Connection Pool Manager with load balancing and automatic reconnection
 */
export class ConnectionPool extends EventEmitter {
  private readonly options: ConnectionPoolOptions;
  private readonly reconnectConfig: ReconnectConfig;
  private readonly addresses: string[];
  private readonly connectionFactory: ConnectionFactory;
  private readonly connectionCloser: ConnectionCloser;

  private connections: Map<string, InternalConnection> = new Map();
  private roundRobinIndex = 0;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private idleCheckTimer: NodeJS.Timeout | null = null;

  private stats: ConnectionPoolStats = {
    totalConnections: 0,
    activeConnections: 0,
    idleConnections: 0,
    failedConnections: 0,
    totalRequests: 0,
    avgAcquireTimeMs: 0,
  };

  private totalAcquireTime = 0;
  private acquireCount = 0;

  constructor(
    addresses: string[],
    connectionFactory: ConnectionFactory,
    connectionCloser: ConnectionCloser,
    options?: Partial<ConnectionPoolOptions>,
    reconnectConfig?: Partial<ReconnectConfig>
  ) {
    super();
    this.addresses = addresses;
    this.connectionFactory = connectionFactory;
    this.connectionCloser = connectionCloser;
    this.options = { ...DEFAULT_POOL_OPTIONS, ...options };
    this.reconnectConfig = { ...DEFAULT_RECONNECT_CONFIG, ...reconnectConfig };
  }

  /**
   * Initialize the connection pool
   */
  async initialize(): Promise<void> {
    // Create minimum connections
    const promises: Promise<void>[] = [];
    for (let i = 0; i < this.options.minConnections; i++) {
      const address = this.addresses[i % this.addresses.length];
      promises.push(this.createConnection(address));
    }

    await Promise.all(promises);

    // Start health checks
    this.startHealthChecks();

    // Start idle connection cleanup
    this.startIdleCleanup();

    this.emit('initialized');
  }

  /**
   * Create a new connection
   */
  private async createConnection(address: string): Promise<void> {
    const id = randomUUID();
    const connection: InternalConnection = {
      id,
      state: ConnectionState.CONNECTING,
      activeRequests: 0,
      weight: 1,
      lastUsed: Date.now(),
      createdAt: Date.now(),
      healthCheckFailures: 0,
      client: null,
      acquireQueue: [],
    };

    this.connections.set(id, connection);
    this.updateStats();

    try {
      const client = await this.connectionFactory(address);
      connection.client = client;
      connection.state = ConnectionState.READY;
      this.emit('connection_created', { id, address });
    } catch (error) {
      connection.state = ConnectionState.TRANSIENT_FAILURE;
      this.stats.failedConnections++;
      this.emit('connection_failed', { id, address, error });
      this.scheduleReconnect(id, address);
    }

    this.updateStats();
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(
    connectionId: string,
    address: string,
    attempt = 0
  ): void {
    if (attempt >= this.reconnectConfig.maxAttempts) {
      this.connections.delete(connectionId);
      this.updateStats();
      this.emit('connection_abandoned', { id: connectionId, address });
      return;
    }

    const delay = this.calculateBackoffDelay(attempt);

    setTimeout(async () => {
      const connection = this.connections.get(connectionId);
      if (!connection) return;

      connection.state = ConnectionState.CONNECTING;
      this.emit('reconnecting', { id: connectionId, address, attempt: attempt + 1 });

      try {
        const client = await this.connectionFactory(address);
        connection.client = client;
        connection.state = ConnectionState.READY;
        connection.healthCheckFailures = 0;
        this.emit('reconnected', { id: connectionId, address });
      } catch (error) {
        connection.state = ConnectionState.TRANSIENT_FAILURE;
        this.scheduleReconnect(connectionId, address, attempt + 1);
      }

      this.updateStats();
    }, delay);
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(attempt: number): number {
    let delay = Math.min(
      this.reconnectConfig.initialDelay *
        Math.pow(this.reconnectConfig.multiplier, attempt),
      this.reconnectConfig.maxDelay
    );

    if (this.reconnectConfig.jitter) {
      delay = delay * (1 + Math.random() * 0.3);
    }

    return Math.floor(delay);
  }

  /**
   * Acquire a connection from the pool
   */
  async acquire(): Promise<{ client: unknown; release: () => void }> {
    const startTime = Date.now();
    this.stats.totalRequests++;

    const connection = await this.selectConnection();

    if (!connection) {
      throw new Error('No available connections in pool');
    }

    connection.activeRequests++;
    connection.lastUsed = Date.now();

    const acquireTime = Date.now() - startTime;
    this.totalAcquireTime += acquireTime;
    this.acquireCount++;
    this.stats.avgAcquireTimeMs = this.totalAcquireTime / this.acquireCount;

    this.updateStats();

    return {
      client: connection.client,
      release: () => this.release(connection.id),
    };
  }

  /**
   * Select a connection based on load balancing strategy
   */
  private async selectConnection(): Promise<InternalConnection | null> {
    const readyConnections = Array.from(this.connections.values()).filter(
      (c) => c.state === ConnectionState.READY
    );

    if (readyConnections.length === 0) {
      // Try to create a new connection if under max
      if (this.connections.size < this.options.maxConnections) {
        const address = this.addresses[0];
        await this.createConnection(address);
        return this.selectConnection();
      }

      // Wait for a connection to become available
      return this.waitForConnection();
    }

    switch (this.options.loadBalancingStrategy) {
      case LoadBalancingStrategy.ROUND_ROBIN:
        return this.selectRoundRobin(readyConnections);
      case LoadBalancingStrategy.LEAST_CONNECTIONS:
        return this.selectLeastConnections(readyConnections);
      case LoadBalancingStrategy.RANDOM:
        return this.selectRandom(readyConnections);
      case LoadBalancingStrategy.WEIGHTED:
        return this.selectWeighted(readyConnections);
      default:
        return this.selectRoundRobin(readyConnections);
    }
  }

  /**
   * Round-robin selection
   */
  private selectRoundRobin(connections: InternalConnection[]): InternalConnection {
    const connection = connections[this.roundRobinIndex % connections.length];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % connections.length;
    return connection;
  }

  /**
   * Least connections selection
   */
  private selectLeastConnections(connections: InternalConnection[]): InternalConnection {
    return connections.reduce((min, conn) =>
      conn.activeRequests < min.activeRequests ? conn : min
    );
  }

  /**
   * Random selection
   */
  private selectRandom(connections: InternalConnection[]): InternalConnection {
    return connections[Math.floor(Math.random() * connections.length)];
  }

  /**
   * Weighted selection
   */
  private selectWeighted(connections: InternalConnection[]): InternalConnection {
    const totalWeight = connections.reduce((sum, conn) => sum + conn.weight, 0);
    let random = Math.random() * totalWeight;

    for (const connection of connections) {
      random -= connection.weight;
      if (random <= 0) {
        return connection;
      }
    }

    return connections[0];
  }

  /**
   * Wait for a connection to become available
   */
  private waitForConnection(): Promise<InternalConnection | null> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection acquisition timeout'));
      }, this.options.acquireTimeout);

      // Find a connection with an acquire queue
      const connection = Array.from(this.connections.values()).find(
        (c) => c.state === ConnectionState.READY
      );

      if (connection) {
        connection.acquireQueue.push({ resolve, reject, timeout });
      } else {
        clearTimeout(timeout);
        resolve(null);
      }
    });
  }

  /**
   * Release a connection back to the pool
   */
  private release(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    connection.activeRequests--;
    connection.lastUsed = Date.now();

    // Process acquire queue
    if (connection.acquireQueue.length > 0 && connection.state === ConnectionState.READY) {
      const waiter = connection.acquireQueue.shift()!;
      clearTimeout(waiter.timeout);
      connection.activeRequests++;
      waiter.resolve(connection);
    }

    this.updateStats();
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthChecks();
    }, this.options.healthCheckInterval);
  }

  /**
   * Perform health checks on all connections
   */
  private async performHealthChecks(): Promise<void> {
    for (const [id, connection] of this.connections) {
      if (connection.state === ConnectionState.READY) {
        try {
          // Attempt to verify connection is still valid
          // This is a placeholder - actual implementation depends on gRPC client
          const isHealthy = await this.checkConnectionHealth(connection);

          if (!isHealthy) {
            connection.healthCheckFailures++;
            if (connection.healthCheckFailures >= 3) {
              connection.state = ConnectionState.TRANSIENT_FAILURE;
              this.emit('connection_unhealthy', { id, failures: connection.healthCheckFailures });
              this.scheduleReconnect(id, this.addresses[0]);
            }
          } else {
            connection.healthCheckFailures = 0;
          }
        } catch (error) {
          connection.healthCheckFailures++;
          this.emit('health_check_error', { id, error });
        }
      }
    }

    this.updateStats();
  }

  /**
   * Check if a connection is healthy
   */
  private async checkConnectionHealth(connection: InternalConnection): Promise<boolean> {
    // Check if the gRPC client has a getChannel method
    const client = connection.client as { getChannel?: () => grpc.Channel };
    if (client && typeof client.getChannel === 'function') {
      try {
        const channel = client.getChannel();
        const state = channel.getConnectivityState(false);
        return state === grpc.connectivityState.READY;
      } catch {
        return false;
      }
    }
    // Assume healthy if we can't check
    return true;
  }

  /**
   * Start idle connection cleanup
   */
  private startIdleCleanup(): void {
    this.idleCheckTimer = setInterval(() => {
      this.cleanupIdleConnections();
    }, this.options.idleTimeout / 2);
  }

  /**
   * Clean up idle connections
   */
  private cleanupIdleConnections(): void {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [id, connection] of this.connections) {
      if (
        connection.activeRequests === 0 &&
        now - connection.lastUsed > this.options.idleTimeout &&
        this.connections.size > this.options.minConnections
      ) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      const connection = this.connections.get(id);
      if (connection) {
        this.connectionCloser(connection.client);
        this.connections.delete(id);
        this.emit('connection_removed', { id, reason: 'idle' });
      }
    }

    this.updateStats();
  }

  /**
   * Update pool statistics
   */
  private updateStats(): void {
    const connections = Array.from(this.connections.values());

    this.stats.totalConnections = connections.length;
    this.stats.activeConnections = connections.filter(
      (c) => c.activeRequests > 0
    ).length;
    this.stats.idleConnections = connections.filter(
      (c) => c.state === ConnectionState.READY && c.activeRequests === 0
    ).length;
  }

  /**
   * Get pool statistics
   */
  getStats(): ConnectionPoolStats {
    return { ...this.stats };
  }

  /**
   * Get all connections info
   */
  getConnections(): PooledConnection[] {
    return Array.from(this.connections.values()).map((c) => ({
      id: c.id,
      state: c.state,
      activeRequests: c.activeRequests,
      weight: c.weight,
      lastUsed: c.lastUsed,
      createdAt: c.createdAt,
      healthCheckFailures: c.healthCheckFailures,
    }));
  }

  /**
   * Set connection weight for weighted load balancing
   */
  setConnectionWeight(connectionId: string, weight: number): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.weight = Math.max(0, weight);
    }
  }

  /**
   * Shutdown the connection pool
   */
  async shutdown(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
      this.idleCheckTimer = null;
    }

    // Close all connections
    for (const [id, connection] of this.connections) {
      // Reject all waiters
      for (const waiter of connection.acquireQueue) {
        clearTimeout(waiter.timeout);
        waiter.reject(new Error('Pool shutting down'));
      }

      this.connectionCloser(connection.client);
      this.emit('connection_closed', { id });
    }

    this.connections.clear();
    this.updateStats();
    this.emit('shutdown');
  }

  /**
   * Scale the pool to a target size
   */
  async scale(targetSize: number): Promise<void> {
    const currentSize = this.connections.size;
    const clampedTarget = Math.max(
      this.options.minConnections,
      Math.min(targetSize, this.options.maxConnections)
    );

    if (clampedTarget > currentSize) {
      // Scale up
      const promises: Promise<void>[] = [];
      for (let i = 0; i < clampedTarget - currentSize; i++) {
        const address = this.addresses[i % this.addresses.length];
        promises.push(this.createConnection(address));
      }
      await Promise.all(promises);
    } else if (clampedTarget < currentSize) {
      // Scale down - remove idle connections first
      const idleConnections = Array.from(this.connections.values())
        .filter((c) => c.activeRequests === 0)
        .sort((a, b) => a.lastUsed - b.lastUsed);

      let removed = 0;
      for (const connection of idleConnections) {
        if (this.connections.size <= clampedTarget) break;
        this.connectionCloser(connection.client);
        this.connections.delete(connection.id);
        removed++;
      }

      this.emit('scaled', { from: currentSize, to: this.connections.size });
    }

    this.updateStats();
  }
}

/**
 * Create a connection pool
 */
export function createConnectionPool(
  addresses: string[],
  connectionFactory: ConnectionFactory,
  connectionCloser: ConnectionCloser,
  options?: Partial<ConnectionPoolOptions>,
  reconnectConfig?: Partial<ReconnectConfig>
): ConnectionPool {
  return new ConnectionPool(
    addresses,
    connectionFactory,
    connectionCloser,
    options,
    reconnectConfig
  );
}
