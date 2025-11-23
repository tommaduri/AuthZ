/**
 * Base Agent - Abstract base class for all authorization agents
 *
 * Provides common functionality:
 * - Lifecycle management (init, shutdown)
 * - Health monitoring
 * - Metrics collection
 * - Event emission
 */

import { EventEmitter } from 'eventemitter3';
import type {
  Agent,
  AgentType,
  AgentState,
  AgentHealth,
  AgentMetrics,
  AgentEvent,
  AgentEventType,
  AgentConfig,
} from '../types/agent.types.js';

export abstract class BaseAgent extends EventEmitter implements Agent {
  readonly id: string;
  readonly type: AgentType;
  readonly name: string;

  protected _state: AgentState = 'initializing';
  protected _metrics: AgentMetrics;
  protected _config: AgentConfig;
  protected _errors: string[] = [];
  protected _lastActivity: Date = new Date();

  constructor(
    type: AgentType,
    name: string,
    config: AgentConfig,
  ) {
    super();
    this.id = `${type}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.type = type;
    this.name = name;
    this._config = config;
    this._metrics = {
      processedCount: 0,
      errorCount: 0,
      avgProcessingTimeMs: 0,
    };
  }

  get state(): AgentState {
    return this._state;
  }

  set state(newState: AgentState) {
    const oldState = this._state;
    this._state = newState;
    this.emit('stateChange', { oldState, newState });
  }

  /**
   * Initialize the agent - must be implemented by subclasses
   */
  abstract initialize(): Promise<void>;

  /**
   * Shutdown the agent - must be implemented by subclasses
   */
  abstract shutdown(): Promise<void>;

  /**
   * Get health status
   */
  async healthCheck(): Promise<AgentHealth> {
    return {
      agentId: this.id,
      agentType: this.type,
      state: this._state,
      lastActivity: this._lastActivity,
      metrics: { ...this._metrics },
      errors: this._errors.length > 0 ? [...this._errors] : undefined,
    };
  }

  /**
   * Emit an agent event for coordination
   */
  protected emitAgentEvent(
    eventType: AgentEventType,
    payload: unknown,
    correlationId?: string,
  ): void {
    const event: AgentEvent = {
      id: `${this.id}-${Date.now()}`,
      timestamp: new Date(),
      agentType: this.type,
      agentId: this.id,
      eventType,
      payload,
      correlationId,
    };

    this.emit('agentEvent', event);
    this._lastActivity = new Date();
  }

  /**
   * Record processing for metrics
   */
  protected recordProcessing(durationMs: number, success: boolean): void {
    this._metrics.processedCount++;
    this._metrics.lastProcessedAt = new Date();

    if (!success) {
      this._metrics.errorCount++;
    }

    // Rolling average for processing time
    const totalTime = this._metrics.avgProcessingTimeMs * (this._metrics.processedCount - 1);
    this._metrics.avgProcessingTimeMs = (totalTime + durationMs) / this._metrics.processedCount;

    this._lastActivity = new Date();
  }

  /**
   * Record an error
   */
  protected recordError(error: Error | string): void {
    const errorMessage = error instanceof Error ? error.message : error;
    this._errors.push(`[${new Date().toISOString()}] ${errorMessage}`);

    // Keep only last 100 errors
    if (this._errors.length > 100) {
      this._errors = this._errors.slice(-100);
    }

    this._metrics.errorCount++;
  }

  /**
   * Log with agent context
   */
  protected log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      agentId: this.id,
      agentType: this.type,
      level,
      message,
      data,
    };

    // Emit for centralized logging
    this.emit('log', logEntry);

    // Also console log based on config level
    const levels = ['debug', 'info', 'warn', 'error'];
    const configLevel = this._config.logLevel || 'info';
    if (levels.indexOf(level) >= levels.indexOf(configLevel)) {
      console[level](`[${this.type}:${this.id.slice(-6)}] ${message}`, data ?? '');
    }
  }

  /**
   * Update custom metrics
   */
  protected setCustomMetric(key: string, value: number): void {
    if (!this._metrics.customMetrics) {
      this._metrics.customMetrics = {};
    }
    this._metrics.customMetrics[key] = value;
  }

  /**
   * Increment custom metric
   */
  protected incrementCustomMetric(key: string, amount = 1): void {
    if (!this._metrics.customMetrics) {
      this._metrics.customMetrics = {};
    }
    this._metrics.customMetrics[key] = (this._metrics.customMetrics[key] || 0) + amount;
  }
}
