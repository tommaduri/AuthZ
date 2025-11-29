/**
 * In-Memory Event Store Implementation
 * Provides event sourcing for authorization audit trail
 */

import type {
  EventStore,
  DomainEvent,
  EventStoreConfig,
  EventQuery,
  EventHandler,
  UnsubscribeFn,
  Snapshot,
} from './types.js';

/**
 * Generate a unique event ID
 */
function generateEventId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `evt-${timestamp}-${random}`;
}

/**
 * Subscriber entry for event notifications
 */
interface Subscriber<T> {
  handler: EventHandler<T>;
  eventTypes?: string[];
}

/**
 * In-memory event store with subscription support
 */
export class InMemoryEventStore implements EventStore {
  private events: DomainEvent[] = [];
  private eventsByAggregate: Map<string, DomainEvent[]> = new Map();
  private snapshots: Map<string, Snapshot> = new Map();
  private subscribers: Set<Subscriber<unknown>> = new Set();
  private sequence = 0;
  private maxEventsPerAggregate: number;

  constructor(config: EventStoreConfig = {}) {
    this.maxEventsPerAggregate = config.maxEventsPerAggregate ?? 10000;
  }

  /**
   * Append a new event
   */
  async append<T>(
    event: Omit<DomainEvent<T>, 'id' | 'sequence' | 'timestamp'>
  ): Promise<DomainEvent<T>> {
    this.sequence++;

    const fullEvent: DomainEvent<T> = {
      ...event,
      id: generateEventId(),
      sequence: this.sequence,
      timestamp: new Date(),
    };

    // Store in main list
    this.events.push(fullEvent as DomainEvent);

    // Store by aggregate
    const aggregateEvents = this.eventsByAggregate.get(event.aggregateId) ?? [];
    aggregateEvents.push(fullEvent as DomainEvent);
    this.eventsByAggregate.set(event.aggregateId, aggregateEvents);

    // Enforce max events per aggregate
    if (aggregateEvents.length > this.maxEventsPerAggregate) {
      aggregateEvents.shift();
    }

    // Notify subscribers
    await this.notifySubscribers(fullEvent as DomainEvent);

    return fullEvent;
  }

  /**
   * Get all events for an aggregate
   */
  async getEvents(aggregateId: string, fromVersion?: number): Promise<DomainEvent[]> {
    const events = this.eventsByAggregate.get(aggregateId) ?? [];

    if (fromVersion === undefined) {
      return [...events];
    }

    return events.filter((e) => e.version >= fromVersion);
  }

  /**
   * Query events with filters
   */
  async query(query: EventQuery): Promise<DomainEvent[]> {
    let results = [...this.events];

    // Filter by aggregateId
    if (query.aggregateId) {
      results = results.filter((e) => e.aggregateId === query.aggregateId);
    }

    // Filter by aggregateType
    if (query.aggregateType) {
      results = results.filter((e) => e.aggregateType === query.aggregateType);
    }

    // Filter by event types
    if (query.eventTypes && query.eventTypes.length > 0) {
      results = results.filter((e) => query.eventTypes!.includes(e.type));
    }

    // Filter by sequence range
    if (query.fromSequence !== undefined) {
      results = results.filter((e) => e.sequence >= query.fromSequence!);
    }
    if (query.toSequence !== undefined) {
      results = results.filter((e) => e.sequence <= query.toSequence!);
    }

    // Filter by date range
    if (query.fromDate) {
      results = results.filter((e) => e.timestamp >= query.fromDate!);
    }
    if (query.toDate) {
      results = results.filter((e) => e.timestamp <= query.toDate!);
    }

    // Apply offset
    if (query.offset) {
      results = results.slice(query.offset);
    }

    // Apply limit
    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Subscribe to new events
   */
  subscribe<T = unknown>(handler: EventHandler<T>, eventTypes?: string[]): UnsubscribeFn {
    const subscriber: Subscriber<T> = {
      handler,
      eventTypes,
    };

    this.subscribers.add(subscriber as Subscriber<unknown>);

    return () => {
      this.subscribers.delete(subscriber as Subscriber<unknown>);
    };
  }

  /**
   * Get current sequence number
   */
  getSequence(): number {
    return this.sequence;
  }

  /**
   * Get total event count
   */
  count(): number {
    return this.events.length;
  }

  /**
   * Save a snapshot
   */
  async saveSnapshot<T>(snapshot: Omit<Snapshot<T>, 'timestamp'>): Promise<void> {
    const fullSnapshot: Snapshot<T> = {
      ...snapshot,
      timestamp: new Date(),
    };

    this.snapshots.set(snapshot.aggregateId, fullSnapshot as Snapshot);
  }

  /**
   * Get latest snapshot for an aggregate
   */
  async getSnapshot<T>(aggregateId: string): Promise<Snapshot<T> | null> {
    const snapshot = this.snapshots.get(aggregateId);
    return (snapshot as Snapshot<T>) ?? null;
  }

  /**
   * Clear all events (for testing)
   */
  async clear(): Promise<void> {
    this.events = [];
    this.eventsByAggregate.clear();
    this.snapshots.clear();
    this.sequence = 0;
  }

  /**
   * Notify all subscribers of a new event
   */
  private async notifySubscribers(event: DomainEvent): Promise<void> {
    const notifications: Promise<void>[] = [];

    for (const subscriber of this.subscribers) {
      // Check if subscriber wants this event type
      if (subscriber.eventTypes && subscriber.eventTypes.length > 0) {
        if (!subscriber.eventTypes.includes(event.type)) {
          continue;
        }
      }

      // Call handler (may be sync or async)
      const result = subscriber.handler(event);
      if (result instanceof Promise) {
        notifications.push(result);
      }
    }

    // Wait for all async handlers
    await Promise.all(notifications);
  }
}

/**
 * Helper function to replay events and rebuild state
 */
export async function replayEvents<T>(
  store: EventStore,
  aggregateId: string,
  reducer: (state: T, event: DomainEvent) => T,
  initialState: T
): Promise<T> {
  // Try to get snapshot first
  const snapshot = await store.getSnapshot<T>(aggregateId);
  let state = snapshot?.state ?? initialState;
  const fromVersion = snapshot?.version ? snapshot.version + 1 : undefined;

  // Get events after snapshot
  const events = await store.getEvents(aggregateId, fromVersion);

  // Apply events to state
  for (const event of events) {
    state = reducer(state, event);
  }

  return state;
}
