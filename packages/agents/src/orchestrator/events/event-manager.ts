/**
 * Event Manager - Event-driven architecture for agent coordination
 *
 * Provides:
 * - Agent event emission
 * - Cross-agent subscriptions
 * - Event replay for debugging
 */

import { EventEmitter } from 'eventemitter3';
import type { AgentType, AgentEventType, AgentEvent } from '../../types/agent.types.js';

/**
 * Extended event types for orchestrator
 */
export type OrchestratorEventType =
  | AgentEventType
  | 'pipeline_started'
  | 'pipeline_completed'
  | 'pipeline_failed'
  | 'step_started'
  | 'step_completed'
  | 'step_skipped'
  | 'step_failed'
  | 'circuit_state_changed'
  | 'config_reloaded'
  | 'feature_flag_changed'
  | 'health_check_completed'
  | 'metrics_exported';

/**
 * Orchestrator event payload
 */
export interface OrchestratorEvent {
  id: string;
  timestamp: Date;
  type: OrchestratorEventType;
  source: 'orchestrator' | AgentType;
  correlationId?: string;
  requestId?: string;
  payload: unknown;
  metadata: Record<string, unknown>;
}

/**
 * Event filter for subscriptions
 */
export interface EventFilter {
  types?: OrchestratorEventType[];
  sources?: Array<'orchestrator' | AgentType>;
  correlationId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Event subscription
 */
export interface EventSubscription {
  id: string;
  filter: EventFilter;
  handler: (event: OrchestratorEvent) => void | Promise<void>;
  priority: number;
  unsubscribe: () => void;
}

/**
 * Event replay options
 */
export interface ReplayOptions {
  /** Start time for replay */
  startTime?: Date;
  /** End time for replay */
  endTime?: Date;
  /** Event types to replay */
  types?: OrchestratorEventType[];
  /** Sources to replay */
  sources?: Array<'orchestrator' | AgentType>;
  /** Correlation ID to filter by */
  correlationId?: string;
  /** Request ID to filter by */
  requestId?: string;
  /** Playback speed multiplier (1 = real-time, 2 = 2x speed) */
  speedMultiplier?: number;
  /** Whether to emit events during replay */
  emitEvents?: boolean;
}

/**
 * Event storage entry
 */
interface StoredEvent extends OrchestratorEvent {
  index: number;
}

/**
 * Event manager configuration
 */
export interface EventManagerConfig {
  /** Maximum events to store for replay */
  maxStoredEvents: number;
  /** Whether to store events for replay */
  enableReplay: boolean;
  /** Event TTL in milliseconds */
  eventTtlMs: number;
  /** Enable async event handlers */
  asyncHandlers: boolean;
  /** Maximum concurrent async handlers */
  maxConcurrentHandlers: number;
}

/**
 * Default event manager configuration
 */
export const DEFAULT_EVENT_MANAGER_CONFIG: EventManagerConfig = {
  maxStoredEvents: 10000,
  enableReplay: true,
  eventTtlMs: 3600000, // 1 hour
  asyncHandlers: true,
  maxConcurrentHandlers: 100,
};

/**
 * Event manager for agent coordination
 */
export class EventManager {
  private config: EventManagerConfig;
  private emitter: EventEmitter;
  private subscriptions: Map<string, EventSubscription> = new Map();
  private storedEvents: StoredEvent[] = [];
  private eventIndex: number = 0;
  private activeHandlers: number = 0;
  private cleanupInterval?: ReturnType<typeof setInterval>;

  constructor(config: Partial<EventManagerConfig> = {}) {
    this.config = { ...DEFAULT_EVENT_MANAGER_CONFIG, ...config };
    this.emitter = new EventEmitter();
  }

  /**
   * Start the event manager
   */
  start(): void {
    // Start cleanup interval for old events
    if (this.config.enableReplay && this.config.eventTtlMs > 0) {
      this.cleanupInterval = setInterval(() => {
        this.cleanupOldEvents();
      }, Math.min(this.config.eventTtlMs / 10, 60000));
    }
  }

  /**
   * Stop the event manager
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.emitter.removeAllListeners();
    this.subscriptions.clear();
  }

  /**
   * Emit an event
   */
  async emit(event: Omit<OrchestratorEvent, 'id' | 'timestamp'>): Promise<void> {
    const fullEvent: OrchestratorEvent = {
      ...event,
      id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      timestamp: new Date(),
    };

    // Store event for replay
    if (this.config.enableReplay) {
      this.storeEvent(fullEvent);
    }

    // Get matching subscriptions sorted by priority
    const matchingSubs = this.getMatchingSubscriptions(fullEvent);

    // Execute handlers
    if (this.config.asyncHandlers) {
      await this.executeHandlersAsync(fullEvent, matchingSubs);
    } else {
      this.executeHandlersSync(fullEvent, matchingSubs);
    }

    // Also emit to EventEmitter for legacy compatibility
    this.emitter.emit(fullEvent.type, fullEvent);
    this.emitter.emit('*', fullEvent);
  }

  /**
   * Subscribe to events
   */
  subscribe(
    filter: EventFilter,
    handler: (event: OrchestratorEvent) => void | Promise<void>,
    priority: number = 0
  ): EventSubscription {
    const id = `sub-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const subscription: EventSubscription = {
      id,
      filter,
      handler,
      priority,
      unsubscribe: () => this.unsubscribe(id),
    };

    this.subscriptions.set(id, subscription);
    return subscription;
  }

  /**
   * Subscribe to a specific event type
   */
  on(
    type: OrchestratorEventType,
    handler: (event: OrchestratorEvent) => void | Promise<void>,
    priority: number = 0
  ): EventSubscription {
    return this.subscribe({ types: [type] }, handler, priority);
  }

  /**
   * Subscribe to events from a specific agent
   */
  onAgent(
    agentType: AgentType,
    handler: (event: OrchestratorEvent) => void | Promise<void>,
    priority: number = 0
  ): EventSubscription {
    return this.subscribe({ sources: [agentType] }, handler, priority);
  }

  /**
   * Subscribe to all events
   */
  onAll(
    handler: (event: OrchestratorEvent) => void | Promise<void>,
    priority: number = 0
  ): EventSubscription {
    return this.subscribe({}, handler, priority);
  }

  /**
   * Subscribe once (auto-unsubscribe after first event)
   */
  once(
    filter: EventFilter,
    handler: (event: OrchestratorEvent) => void | Promise<void>
  ): EventSubscription {
    const subscription = this.subscribe(filter, async (event) => {
      subscription.unsubscribe();
      await handler(event);
    });
    return subscription;
  }

  /**
   * Wait for a specific event
   */
  waitFor(
    filter: EventFilter,
    timeoutMs: number = 30000
  ): Promise<OrchestratorEvent> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        subscription.unsubscribe();
        reject(new Error('Event wait timeout'));
      }, timeoutMs);

      const subscription = this.once(filter, (event) => {
        clearTimeout(timeout);
        resolve(event);
      });
    });
  }

  /**
   * Unsubscribe from events
   */
  unsubscribe(subscriptionId: string): boolean {
    return this.subscriptions.delete(subscriptionId);
  }

  /**
   * Replay stored events
   */
  async replay(options: ReplayOptions = {}): Promise<OrchestratorEvent[]> {
    let events = this.getStoredEvents(options);

    if (options.emitEvents) {
      const startTime = events.length > 0 ? events[0].timestamp.getTime() : Date.now();

      for (let i = 0; i < events.length; i++) {
        const event = events[i];

        // Calculate delay based on original timing
        if (i > 0 && options.speedMultiplier !== Infinity) {
          const prevEvent = events[i - 1];
          const delay = (event.timestamp.getTime() - prevEvent.timestamp.getTime()) / (options.speedMultiplier ?? 1);
          if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }

        // Emit the event
        await this.emit({
          ...event,
          metadata: { ...event.metadata, replayed: true, originalTimestamp: event.timestamp },
        });
      }
    }

    return events;
  }

  /**
   * Get stored events without replaying
   */
  getStoredEvents(options: Partial<ReplayOptions> = {}): OrchestratorEvent[] {
    let events = [...this.storedEvents];

    if (options.startTime) {
      events = events.filter(e => e.timestamp >= options.startTime!);
    }
    if (options.endTime) {
      events = events.filter(e => e.timestamp <= options.endTime!);
    }
    if (options.types && options.types.length > 0) {
      events = events.filter(e => options.types!.includes(e.type));
    }
    if (options.sources && options.sources.length > 0) {
      events = events.filter(e => options.sources!.includes(e.source));
    }
    if (options.correlationId) {
      events = events.filter(e => e.correlationId === options.correlationId);
    }
    if (options.requestId) {
      events = events.filter(e => e.requestId === options.requestId);
    }

    return events;
  }

  /**
   * Get event timeline for debugging
   */
  getTimeline(correlationId: string): OrchestratorEvent[] {
    return this.storedEvents
      .filter(e => e.correlationId === correlationId)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * Get event count by type
   */
  getEventCounts(): Record<OrchestratorEventType, number> {
    const counts: Record<string, number> = {};

    for (const event of this.storedEvents) {
      counts[event.type] = (counts[event.type] ?? 0) + 1;
    }

    return counts as Record<OrchestratorEventType, number>;
  }

  /**
   * Clear stored events
   */
  clearStoredEvents(): void {
    this.storedEvents.length = 0;
    this.eventIndex = 0;
  }

  /**
   * Get subscription count
   */
  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Get active handler count
   */
  getActiveHandlerCount(): number {
    return this.activeHandlers;
  }

  /**
   * Create a scoped event emitter for an agent
   */
  createAgentScope(agentType: AgentType): AgentEventScope {
    return new AgentEventScope(this, agentType);
  }

  private storeEvent(event: OrchestratorEvent): void {
    const stored: StoredEvent = { ...event, index: this.eventIndex++ };
    this.storedEvents.push(stored);

    // Trim if too many events
    if (this.storedEvents.length > this.config.maxStoredEvents) {
      this.storedEvents.splice(0, this.storedEvents.length - this.config.maxStoredEvents);
    }
  }

  private cleanupOldEvents(): void {
    const cutoff = Date.now() - this.config.eventTtlMs;
    this.storedEvents = this.storedEvents.filter(e => e.timestamp.getTime() > cutoff);
  }

  private getMatchingSubscriptions(event: OrchestratorEvent): EventSubscription[] {
    return Array.from(this.subscriptions.values())
      .filter(sub => this.matchesFilter(event, sub.filter))
      .sort((a, b) => b.priority - a.priority);
  }

  private matchesFilter(event: OrchestratorEvent, filter: EventFilter): boolean {
    if (filter.types && filter.types.length > 0 && !filter.types.includes(event.type)) {
      return false;
    }
    if (filter.sources && filter.sources.length > 0 && !filter.sources.includes(event.source)) {
      return false;
    }
    if (filter.correlationId && event.correlationId !== filter.correlationId) {
      return false;
    }
    if (filter.requestId && event.requestId !== filter.requestId) {
      return false;
    }
    if (filter.metadata) {
      for (const [key, value] of Object.entries(filter.metadata)) {
        if (event.metadata[key] !== value) {
          return false;
        }
      }
    }
    return true;
  }

  private executeHandlersSync(event: OrchestratorEvent, subscriptions: EventSubscription[]): void {
    for (const sub of subscriptions) {
      try {
        sub.handler(event);
      } catch (error) {
        console.error(`Error in event handler ${sub.id}:`, error);
      }
    }
  }

  private async executeHandlersAsync(
    event: OrchestratorEvent,
    subscriptions: EventSubscription[]
  ): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const sub of subscriptions) {
      // Throttle concurrent handlers
      while (this.activeHandlers >= this.config.maxConcurrentHandlers) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      this.activeHandlers++;
      const promise = Promise.resolve()
        .then(() => sub.handler(event))
        .catch(error => console.error(`Error in event handler ${sub.id}:`, error))
        .finally(() => this.activeHandlers--);

      promises.push(promise);
    }

    await Promise.all(promises);
  }
}

/**
 * Scoped event emitter for individual agents
 */
export class AgentEventScope {
  constructor(
    private manager: EventManager,
    private agentType: AgentType
  ) {}

  /**
   * Emit an event from this agent
   */
  async emit(
    type: AgentEventType,
    payload: unknown,
    correlationId?: string,
    requestId?: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    await this.manager.emit({
      type,
      source: this.agentType,
      correlationId,
      requestId,
      payload,
      metadata,
    });
  }

  /**
   * Subscribe to events for this agent
   */
  subscribe(
    handler: (event: OrchestratorEvent) => void | Promise<void>,
    priority: number = 0
  ): EventSubscription {
    return this.manager.onAgent(this.agentType, handler, priority);
  }

  /**
   * Subscribe to a specific event type from this agent
   */
  on(
    type: AgentEventType,
    handler: (event: OrchestratorEvent) => void | Promise<void>,
    priority: number = 0
  ): EventSubscription {
    return this.manager.subscribe(
      { types: [type], sources: [this.agentType] },
      handler,
      priority
    );
  }
}
