/**
 * Health Monitoring for AuthZ Engine gRPC Client
 *
 * Provides health check streaming, connection state monitoring, and automatic failover.
 */

import * as grpc from '@grpc/grpc-js';
import { EventEmitter } from 'events';
import {
  type HealthCheckConfig,
  type HealthCheckResult,
  type HealthStreamCallbacks,
  type ConnectionHealth,
  type FailoverConfig,
  HealthStatus,
  ConnectionState,
  DEFAULT_HEALTH_CHECK_CONFIG,
} from './types.js';

/**
 * Default failover configuration
 */
const DEFAULT_FAILOVER_CONFIG: FailoverConfig = {
  enabled: false,
  fallbackAddresses: [],
  primaryIndex: 0,
  failoverThreshold: 3,
  failbackDelay: 60000,
};

/**
 * Health check function type
 */
type HealthCheckFn = () => Promise<HealthCheckResult>;

/**
 * Address change callback
 */
type AddressChangeCallback = (newAddress: string) => Promise<void>;

/**
 * Health Monitor for gRPC connections
 */
export class HealthMonitor extends EventEmitter {
  private readonly config: HealthCheckConfig;
  private readonly failoverConfig: FailoverConfig;
  private readonly healthCheckFn: HealthCheckFn;
  private readonly addressChangeCallback: AddressChangeCallback | undefined;

  private healthCheckTimer: NodeJS.Timeout | null = null;
  private failbackTimer: NodeJS.Timeout | null = null;
  private isMonitoring = false;

  private health: ConnectionHealth = {
    status: HealthStatus.UNKNOWN,
    connectionState: ConnectionState.IDLE,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    history: [],
  };

  private currentAddressIndex: number;
  private originalAddressIndex: number;

  constructor(
    healthCheckFn: HealthCheckFn,
    config?: Partial<HealthCheckConfig>,
    failoverConfig?: Partial<FailoverConfig>,
    addressChangeCallback?: AddressChangeCallback
  ) {
    super();
    this.healthCheckFn = healthCheckFn;
    this.config = { ...DEFAULT_HEALTH_CHECK_CONFIG, ...config };
    this.failoverConfig = { ...DEFAULT_FAILOVER_CONFIG, ...failoverConfig };
    this.addressChangeCallback = addressChangeCallback;
    this.currentAddressIndex = this.failoverConfig.primaryIndex;
    this.originalAddressIndex = this.failoverConfig.primaryIndex;
  }

  /**
   * Start health monitoring
   */
  start(): void {
    if (this.isMonitoring || !this.config.enabled) {
      return;
    }

    this.isMonitoring = true;
    this.scheduleHealthCheck();
    this.emit('started');
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;

    if (this.healthCheckTimer) {
      clearTimeout(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    if (this.failbackTimer) {
      clearTimeout(this.failbackTimer);
      this.failbackTimer = null;
    }

    this.emit('stopped');
  }

  /**
   * Schedule the next health check
   */
  private scheduleHealthCheck(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.healthCheckTimer = setTimeout(async () => {
      await this.performHealthCheck();
      this.scheduleHealthCheck();
    }, this.config.interval);
  }

  /**
   * Perform a health check
   */
  private async performHealthCheck(): Promise<void> {
    const startTime = Date.now();

    try {
      const result = await Promise.race([
        this.healthCheckFn(),
        this.createTimeout(),
      ]);

      this.handleHealthCheckResult(result);
    } catch (error) {
      const result: HealthCheckResult = {
        status: HealthStatus.NOT_SERVING,
        timestamp: Date.now(),
        latencyMs: Date.now() - startTime,
        error: (error as Error).message,
      };

      this.handleHealthCheckResult(result);
    }
  }

  /**
   * Create a timeout promise
   */
  private createTimeout(): Promise<HealthCheckResult> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Health check timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);
    });
  }

  /**
   * Handle health check result
   */
  private handleHealthCheckResult(result: HealthCheckResult): void {
    const previousStatus = this.health.status;

    // Update health history
    this.health.history.unshift(result);
    if (this.health.history.length > 10) {
      this.health.history.pop();
    }

    // Update consecutive counters
    if (result.status === HealthStatus.SERVING) {
      this.health.consecutiveSuccesses++;
      this.health.consecutiveFailures = 0;
      this.health.lastSuccessfulCheck = result.timestamp;
    } else {
      this.health.consecutiveFailures++;
      this.health.consecutiveSuccesses = 0;
    }

    // Determine new health status
    this.health.status = this.determineHealthStatus();

    // Emit events
    this.emit('health_check', result);

    if (this.health.status !== previousStatus) {
      this.emit('status_change', this.health.status, previousStatus);

      // Handle failover if needed
      if (
        this.health.status === HealthStatus.NOT_SERVING &&
        this.failoverConfig.enabled
      ) {
        this.handleFailover();
      }

      // Handle failback if we're healthy and on a fallback address
      if (
        this.health.status === HealthStatus.SERVING &&
        this.currentAddressIndex !== this.originalAddressIndex
      ) {
        this.scheduleFailback();
      }
    }
  }

  /**
   * Determine overall health status based on thresholds
   */
  private determineHealthStatus(): HealthStatus {
    if (
      this.health.consecutiveSuccesses >= this.config.healthyThreshold &&
      this.health.status !== HealthStatus.SERVING
    ) {
      return HealthStatus.SERVING;
    }

    if (
      this.health.consecutiveFailures >= this.config.unhealthyThreshold &&
      this.health.status !== HealthStatus.NOT_SERVING
    ) {
      return HealthStatus.NOT_SERVING;
    }

    // Keep current status if thresholds not met
    return this.health.status;
  }

  /**
   * Handle failover to next available address
   */
  private async handleFailover(): Promise<void> {
    if (!this.failoverConfig.enabled || this.failoverConfig.fallbackAddresses.length === 0) {
      return;
    }

    // Find next address
    const nextIndex = (this.currentAddressIndex + 1) % this.failoverConfig.fallbackAddresses.length;

    if (nextIndex === this.currentAddressIndex) {
      this.emit('failover_exhausted');
      return;
    }

    const newAddress = this.failoverConfig.fallbackAddresses[nextIndex] ?? '';

    this.emit('failover_started', {
      from: this.failoverConfig.fallbackAddresses[this.currentAddressIndex] ?? '',
      to: newAddress,
    });

    try {
      if (this.addressChangeCallback) {
        await this.addressChangeCallback(newAddress);
      }

      this.currentAddressIndex = nextIndex;
      this.health.consecutiveFailures = 0;

      this.emit('failover_completed', { address: newAddress });
    } catch (error) {
      this.emit('failover_failed', { address: newAddress, error });
    }
  }

  /**
   * Schedule failback to original address
   */
  private scheduleFailback(): void {
    if (this.failbackTimer) {
      return; // Already scheduled
    }

    this.failbackTimer = setTimeout(async () => {
      this.failbackTimer = null;
      await this.attemptFailback();
    }, this.failoverConfig.failbackDelay);

    this.emit('failback_scheduled', {
      delay: this.failoverConfig.failbackDelay,
    });
  }

  /**
   * Attempt to failback to original address
   */
  private async attemptFailback(): Promise<void> {
    const originalAddress = this.failoverConfig.fallbackAddresses[this.originalAddressIndex] ?? '';

    this.emit('failback_started', { address: originalAddress });

    try {
      if (this.addressChangeCallback) {
        await this.addressChangeCallback(originalAddress);
      }

      this.currentAddressIndex = this.originalAddressIndex;
      this.emit('failback_completed', { address: originalAddress });
    } catch (error) {
      this.emit('failback_failed', { address: originalAddress, error });
      // Reschedule failback
      this.scheduleFailback();
    }
  }

  /**
   * Set connection state
   */
  setConnectionState(state: ConnectionState): void {
    const previousState = this.health.connectionState;
    this.health.connectionState = state;

    if (state !== previousState) {
      this.emit('connection_state_change', state, previousState);
    }
  }

  /**
   * Get current health status
   */
  getHealth(): ConnectionHealth {
    return { ...this.health, history: [...this.health.history] };
  }

  /**
   * Get current address
   */
  getCurrentAddress(): string | undefined {
    return this.failoverConfig.fallbackAddresses[this.currentAddressIndex];
  }

  /**
   * Force a health check
   */
  async checkNow(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      const result = await Promise.race([
        this.healthCheckFn(),
        this.createTimeout(),
      ]);

      this.handleHealthCheckResult(result);
      return result;
    } catch (error) {
      const result: HealthCheckResult = {
        status: HealthStatus.NOT_SERVING,
        timestamp: Date.now(),
        latencyMs: Date.now() - startTime,
        error: (error as Error).message,
      };

      this.handleHealthCheckResult(result);
      return result;
    }
  }

  /**
   * Subscribe to health stream
   */
  subscribeToHealthStream(callbacks: HealthStreamCallbacks): () => void {
    const statusChangeHandler = (status: HealthStatus, previous: HealthStatus) => {
      callbacks.onStatusChange(status, previous);
    };

    const healthCheckHandler = (result: HealthCheckResult) => {
      callbacks.onHealthCheck(result);
    };

    const errorHandler = (error: Error) => {
      callbacks.onError(error);
    };

    this.on('status_change', statusChangeHandler);
    this.on('health_check', healthCheckHandler);
    this.on('error', errorHandler);

    // Return unsubscribe function
    return () => {
      this.off('status_change', statusChangeHandler);
      this.off('health_check', healthCheckHandler);
      this.off('error', errorHandler);
    };
  }

  /**
   * Check if currently healthy
   */
  isHealthy(): boolean {
    return this.health.status === HealthStatus.SERVING;
  }

  /**
   * Reset health state
   */
  reset(): void {
    this.health = {
      status: HealthStatus.UNKNOWN,
      connectionState: ConnectionState.IDLE,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      history: [],
    };
    this.emit('reset');
  }
}

/**
 * Create a health check function from a gRPC client
 */
export function createGrpcHealthCheck(
  getClient: () => unknown,
  serviceName?: string
): HealthCheckFn {
  return async (): Promise<HealthCheckResult> => {
    const startTime = Date.now();

    try {
      const client = getClient() as {
        getChannel?: () => grpc.Channel;
      };

      if (!client) {
        return {
          status: HealthStatus.NOT_SERVING,
          timestamp: Date.now(),
          latencyMs: Date.now() - startTime,
          error: 'Client not available',
        };
      }

      // Check channel connectivity state
      if (typeof client.getChannel === 'function') {
        const channel = client.getChannel();
        const state = channel.getConnectivityState(false);

        const grpcStateToHealth: Record<number, HealthStatus> = {
          [grpc.connectivityState.IDLE]: HealthStatus.UNKNOWN,
          [grpc.connectivityState.CONNECTING]: HealthStatus.UNKNOWN,
          [grpc.connectivityState.READY]: HealthStatus.SERVING,
          [grpc.connectivityState.TRANSIENT_FAILURE]: HealthStatus.NOT_SERVING,
          [grpc.connectivityState.SHUTDOWN]: HealthStatus.NOT_SERVING,
        };

        return {
          status: grpcStateToHealth[state] ?? HealthStatus.UNKNOWN,
          timestamp: Date.now(),
          latencyMs: Date.now() - startTime,
          details: {
            grpcState: grpc.connectivityState[state],
            serviceName,
          },
        };
      }

      // Fallback: assume healthy if we can't check
      return {
        status: HealthStatus.SERVING,
        timestamp: Date.now(),
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        status: HealthStatus.NOT_SERVING,
        timestamp: Date.now(),
        latencyMs: Date.now() - startTime,
        error: (error as Error).message,
      };
    }
  };
}

/**
 * Create a health monitor
 */
export function createHealthMonitor(
  healthCheckFn: HealthCheckFn,
  config?: Partial<HealthCheckConfig>,
  failoverConfig?: Partial<FailoverConfig>,
  addressChangeCallback?: AddressChangeCallback
): HealthMonitor {
  return new HealthMonitor(
    healthCheckFn,
    config,
    failoverConfig,
    addressChangeCallback
  );
}
