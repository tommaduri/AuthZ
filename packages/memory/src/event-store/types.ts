/**
 * Event Store Types for event sourcing and audit trail
 */

export interface DomainEvent<T = unknown> {
  id: string;
  type: string;
  aggregateId: string;
  aggregateType: string;
  data: T;
  metadata: EventMetadata;
  timestamp: Date;
  sequence: number;
  version: number;
}

export interface EventMetadata {
  correlationId?: string;
  causationId?: string;
  userId?: string;
  source?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface EventStoreConfig {
  maxEventsPerAggregate?: number;
  retentionDays?: number;
  snapshotInterval?: number;
}

export interface Snapshot<T = unknown> {
  aggregateId: string;
  aggregateType: string;
  state: T;
  version: number;
  timestamp: Date;
}

export interface EventQuery {
  aggregateId?: string;
  aggregateType?: string;
  eventTypes?: string[];
  fromSequence?: number;
  toSequence?: number;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}

export type EventHandler<T = unknown> = (event: DomainEvent<T>) => void | Promise<void>;

export type UnsubscribeFn = () => void;

export interface EventStore {
  /**
   * Append a new event
   */
  append<T>(event: Omit<DomainEvent<T>, 'id' | 'sequence' | 'timestamp'>): Promise<DomainEvent<T>>;

  /**
   * Get all events for an aggregate
   */
  getEvents(aggregateId: string, fromVersion?: number): Promise<DomainEvent[]>;

  /**
   * Get events by query
   */
  query(query: EventQuery): Promise<DomainEvent[]>;

  /**
   * Subscribe to new events
   */
  subscribe<T = unknown>(handler: EventHandler<T>, eventTypes?: string[]): UnsubscribeFn;

  /**
   * Get the current sequence number
   */
  getSequence(): number;

  /**
   * Get event count
   */
  count(): number;

  /**
   * Save a snapshot
   */
  saveSnapshot<T>(snapshot: Omit<Snapshot<T>, 'timestamp'>): Promise<void>;

  /**
   * Get latest snapshot for an aggregate
   */
  getSnapshot<T>(aggregateId: string): Promise<Snapshot<T> | null>;

  /**
   * Clear all events (for testing)
   */
  clear(): Promise<void>;
}

/**
 * Audit-specific event types for authorization
 */
export interface AuthorizationEvent {
  requestId: string;
  principal: {
    id: string;
    type: string;
    roles: string[];
  };
  resource: {
    id: string;
    kind: string;
  };
  action: string;
  decision: 'allow' | 'deny';
  reason?: string;
  policies: string[];
  latencyMs: number;
}

export interface PolicyChangeEvent {
  policyId: string;
  changeType: 'create' | 'update' | 'delete';
  previousVersion?: number;
  newVersion: number;
  changes?: Record<string, unknown>;
}
