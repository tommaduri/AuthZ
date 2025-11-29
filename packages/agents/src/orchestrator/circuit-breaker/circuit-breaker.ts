/**
 * Circuit Breaker - Per-agent fault tolerance
 *
 * Implements the circuit breaker pattern:
 * - CLOSED: Normal operation, requests flow through
 * - OPEN: Failing, requests are rejected immediately
 * - HALF_OPEN: Testing recovery, limited requests allowed
 */

import type { AgentType } from '../../types/agent.types.js';

/**
 * Circuit breaker states
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number;
  /** Time window for counting failures (ms) */
  failureWindowMs: number;
  /** Time to wait before trying half-open (ms) */
  resetTimeoutMs: number;
  /** Number of successful requests needed to close from half-open */
  successThreshold: number;
  /** Maximum concurrent requests in half-open state */
  halfOpenMaxRequests: number;
  /** Timeout for individual requests (ms) */
  requestTimeoutMs: number;
  /** Whether to enable the circuit breaker */
  enabled: boolean;
}

/**
 * Circuit breaker metrics
 */
export interface CircuitBreakerMetrics {
  state: CircuitState;
  failures: number;
  successes: number;
  consecutiveSuccesses: number;
  totalRequests: number;
  rejectedRequests: number;
  lastFailureTime?: Date;
  lastSuccessTime?: Date;
  stateChangedAt: Date;
  halfOpenRequests: number;
}

/**
 * Event emitted when circuit state changes
 */
export interface CircuitStateChange {
  agentType: AgentType;
  previousState: CircuitState;
  newState: CircuitState;
  timestamp: Date;
  reason: string;
  metrics: CircuitBreakerMetrics;
}

/**
 * Fallback strategy types
 */
export type FallbackStrategyType =
  | 'default-value'
  | 'cached-value'
  | 'alternative-agent'
  | 'graceful-degradation'
  | 'retry-queue'
  | 'custom';

/**
 * Fallback strategy configuration
 */
export interface FallbackStrategy {
  type: FallbackStrategyType;
  /** Default value to return on failure */
  defaultValue?: unknown;
  /** Cache TTL for cached fallback (ms) */
  cacheTtlMs?: number;
  /** Alternative agent to use */
  alternativeAgent?: AgentType;
  /** Custom fallback function */
  customHandler?: (error: Error, context: unknown) => Promise<unknown>;
  /** Whether to log fallback usage */
  logFallback?: boolean;
}

/**
 * Circuit breaker for a single agent
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures: number[] = [];
  private successes: number = 0;
  private consecutiveSuccesses: number = 0;
  private totalRequests: number = 0;
  private rejectedRequests: number = 0;
  private lastFailureTime?: Date;
  private lastSuccessTime?: Date;
  private stateChangedAt: Date = new Date();
  private halfOpenRequests: number = 0;
  private lastCachedValue?: { value: unknown; timestamp: number };
  private stateChangeListeners: ((change: CircuitStateChange) => void)[] = [];

  constructor(
    private readonly agentType: AgentType,
    private readonly config: CircuitBreakerConfig,
    private readonly fallbackStrategy?: FallbackStrategy
  ) {}

  /**
   * Check if a request can proceed
   */
  canExecute(): boolean {
    if (!this.config.enabled) return true;

    switch (this.state) {
      case 'closed':
        return true;
      case 'open':
        // Check if reset timeout has passed
        if (this.shouldAttemptReset()) {
          this.transitionTo('half-open', 'Reset timeout elapsed');
          return true;
        }
        return false;
      case 'half-open':
        return this.halfOpenRequests < this.config.halfOpenMaxRequests;
    }
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(
    fn: () => Promise<T>,
    context?: unknown
  ): Promise<T> {
    this.totalRequests++;

    if (!this.canExecute()) {
      this.rejectedRequests++;
      return this.handleFallback<T>(new Error('Circuit breaker is open'), context);
    }

    if (this.state === 'half-open') {
      this.halfOpenRequests++;
    }

    try {
      const result = await this.executeWithTimeout(fn);
      this.recordSuccess();

      // Cache successful value for fallback
      if (this.fallbackStrategy?.type === 'cached-value') {
        this.lastCachedValue = { value: result, timestamp: Date.now() };
      }

      return result;
    } catch (error) {
      this.recordFailure();
      return this.handleFallback<T>(error as Error, context);
    }
  }

  /**
   * Record a successful request
   */
  recordSuccess(): void {
    this.successes++;
    this.consecutiveSuccesses++;
    this.lastSuccessTime = new Date();

    if (this.state === 'half-open') {
      this.halfOpenRequests--;
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        this.transitionTo('closed', 'Success threshold reached');
      }
    }
  }

  /**
   * Record a failed request
   */
  recordFailure(): void {
    const now = Date.now();
    this.lastFailureTime = new Date(now);
    this.consecutiveSuccesses = 0;

    // Remove old failures outside the window
    this.failures = this.failures.filter(
      time => now - time < this.config.failureWindowMs
    );
    this.failures.push(now);

    if (this.state === 'half-open') {
      this.halfOpenRequests--;
      this.transitionTo('open', 'Failure in half-open state');
    } else if (this.state === 'closed' && this.failures.length >= this.config.failureThreshold) {
      this.transitionTo('open', 'Failure threshold exceeded');
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.state,
      failures: this.failures.length,
      successes: this.successes,
      consecutiveSuccesses: this.consecutiveSuccesses,
      totalRequests: this.totalRequests,
      rejectedRequests: this.rejectedRequests,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      stateChangedAt: this.stateChangedAt,
      halfOpenRequests: this.halfOpenRequests,
    };
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Force circuit to open (manual trip)
   */
  forceOpen(reason: string = 'Manual trip'): void {
    if (this.state !== 'open') {
      this.transitionTo('open', reason);
    }
  }

  /**
   * Force circuit to close (manual reset)
   */
  forceClose(reason: string = 'Manual reset'): void {
    this.failures = [];
    this.consecutiveSuccesses = 0;
    this.halfOpenRequests = 0;
    if (this.state !== 'closed') {
      this.transitionTo('closed', reason);
    }
  }

  /**
   * Subscribe to state changes
   */
  onStateChange(listener: (change: CircuitStateChange) => void): () => void {
    this.stateChangeListeners.push(listener);
    return () => {
      const index = this.stateChangeListeners.indexOf(listener);
      if (index > -1) {
        this.stateChangeListeners.splice(index, 1);
      }
    };
  }

  /**
   * Check if circuit breaker is healthy (closed state)
   */
  isHealthy(): boolean {
    return this.state === 'closed';
  }

  private transitionTo(newState: CircuitState, reason: string): void {
    const previousState = this.state;
    this.state = newState;
    this.stateChangedAt = new Date();

    if (newState === 'half-open') {
      this.halfOpenRequests = 0;
      this.consecutiveSuccesses = 0;
    }

    const change: CircuitStateChange = {
      agentType: this.agentType,
      previousState,
      newState,
      timestamp: this.stateChangedAt,
      reason,
      metrics: this.getMetrics(),
    };

    this.stateChangeListeners.forEach(listener => listener(change));
  }

  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) return true;
    return Date.now() - this.lastFailureTime.getTime() >= this.config.resetTimeoutMs;
  }

  private async executeWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Request timeout after ${this.config.requestTimeoutMs}ms`));
      }, this.config.requestTimeoutMs);

      fn()
        .then(result => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  private async handleFallback<T>(error: Error, context?: unknown): Promise<T> {
    if (!this.fallbackStrategy) {
      throw error;
    }

    if (this.fallbackStrategy.logFallback) {
      console.warn(`[CircuitBreaker:${this.agentType}] Using fallback: ${this.fallbackStrategy.type}`, {
        error: error.message,
        state: this.state,
      });
    }

    switch (this.fallbackStrategy.type) {
      case 'default-value':
        return this.fallbackStrategy.defaultValue as T;

      case 'cached-value':
        if (this.lastCachedValue) {
          const age = Date.now() - this.lastCachedValue.timestamp;
          if (age < (this.fallbackStrategy.cacheTtlMs ?? 60000)) {
            return this.lastCachedValue.value as T;
          }
        }
        throw error;

      case 'graceful-degradation':
        return this.fallbackStrategy.defaultValue as T;

      case 'custom':
        if (this.fallbackStrategy.customHandler) {
          return this.fallbackStrategy.customHandler(error, context) as Promise<T>;
        }
        throw error;

      default:
        throw error;
    }
  }
}

/**
 * Default circuit breaker configurations by agent type
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIGS: Record<AgentType, CircuitBreakerConfig> = {
  guardian: {
    failureThreshold: 5,
    failureWindowMs: 60000,
    resetTimeoutMs: 30000,
    successThreshold: 3,
    halfOpenMaxRequests: 2,
    requestTimeoutMs: 5000,
    enabled: true,
  },
  analyst: {
    failureThreshold: 10,
    failureWindowMs: 120000,
    resetTimeoutMs: 60000,
    successThreshold: 5,
    halfOpenMaxRequests: 3,
    requestTimeoutMs: 10000,
    enabled: true,
  },
  advisor: {
    failureThreshold: 3,
    failureWindowMs: 30000,
    resetTimeoutMs: 15000,
    successThreshold: 2,
    halfOpenMaxRequests: 1,
    requestTimeoutMs: 30000, // LLM calls can be slow
    enabled: true,
  },
  enforcer: {
    failureThreshold: 3,
    failureWindowMs: 10000,
    resetTimeoutMs: 5000,
    successThreshold: 2,
    halfOpenMaxRequests: 1,
    requestTimeoutMs: 1000, // Enforcer should be fast
    enabled: true,
  },
};

/**
 * Default fallback strategies by agent type
 */
export const DEFAULT_FALLBACK_STRATEGIES: Record<AgentType, FallbackStrategy> = {
  guardian: {
    type: 'default-value',
    defaultValue: { anomalyScore: 0, riskFactors: [], anomaly: undefined },
    logFallback: true,
  },
  analyst: {
    type: 'graceful-degradation',
    defaultValue: undefined, // Skip recording
    logFallback: true,
  },
  advisor: {
    type: 'default-value',
    defaultValue: {
      summary: 'Explanation unavailable due to service degradation',
      factors: [],
    },
    logFallback: true,
  },
  enforcer: {
    type: 'default-value',
    defaultValue: { allowed: true, reason: 'Circuit breaker fallback - allowing by default' },
    logFallback: true,
  },
};

/**
 * Circuit breaker manager for all agents
 */
export class CircuitBreakerManager {
  private breakers: Map<AgentType, CircuitBreaker> = new Map();
  private globalStateChangeListeners: ((change: CircuitStateChange) => void)[] = [];

  constructor(
    configs: Partial<Record<AgentType, CircuitBreakerConfig>> = {},
    fallbacks: Partial<Record<AgentType, FallbackStrategy>> = {}
  ) {
    const agentTypes: AgentType[] = ['guardian', 'analyst', 'advisor', 'enforcer'];

    for (const agentType of agentTypes) {
      const config = configs[agentType] ?? DEFAULT_CIRCUIT_BREAKER_CONFIGS[agentType];
      const fallback = fallbacks[agentType] ?? DEFAULT_FALLBACK_STRATEGIES[agentType];

      const breaker = new CircuitBreaker(agentType, config, fallback);

      // Forward state changes to global listeners
      breaker.onStateChange(change => {
        this.globalStateChangeListeners.forEach(listener => listener(change));
      });

      this.breakers.set(agentType, breaker);
    }
  }

  /**
   * Get circuit breaker for an agent
   */
  get(agentType: AgentType): CircuitBreaker {
    const breaker = this.breakers.get(agentType);
    if (!breaker) {
      throw new Error(`No circuit breaker found for agent type: ${agentType}`);
    }
    return breaker;
  }

  /**
   * Execute with circuit breaker for a specific agent
   */
  async execute<T>(agentType: AgentType, fn: () => Promise<T>, context?: unknown): Promise<T> {
    return this.get(agentType).execute(fn, context);
  }

  /**
   * Get health status of all circuit breakers
   */
  getHealthStatus(): Record<AgentType, { healthy: boolean; state: CircuitState; metrics: CircuitBreakerMetrics }> {
    const status: Record<string, { healthy: boolean; state: CircuitState; metrics: CircuitBreakerMetrics }> = {};

    for (const [agentType, breaker] of this.breakers) {
      status[agentType] = {
        healthy: breaker.isHealthy(),
        state: breaker.getState(),
        metrics: breaker.getMetrics(),
      };
    }

    return status as Record<AgentType, { healthy: boolean; state: CircuitState; metrics: CircuitBreakerMetrics }>;
  }

  /**
   * Subscribe to state changes across all agents
   */
  onStateChange(listener: (change: CircuitStateChange) => void): () => void {
    this.globalStateChangeListeners.push(listener);
    return () => {
      const index = this.globalStateChangeListeners.indexOf(listener);
      if (index > -1) {
        this.globalStateChangeListeners.splice(index, 1);
      }
    };
  }

  /**
   * Force all circuits to close
   */
  resetAll(reason: string = 'Manual global reset'): void {
    for (const breaker of this.breakers.values()) {
      breaker.forceClose(reason);
    }
  }
}
