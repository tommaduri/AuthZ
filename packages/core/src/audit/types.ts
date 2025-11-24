/**
 * Audit Logging Types for AuthZ Engine
 *
 * Defines the structure for audit entries, sinks, and queries
 * to support comprehensive authorization decision logging.
 */

// =============================================================================
// Log Levels
// =============================================================================

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

// =============================================================================
// Event Types
// =============================================================================

export type AuditEventType =
  | 'authorization_decision'
  | 'policy_change'
  | 'policy_load'
  | 'policy_unload'
  | 'access_request'
  | 'access_granted'
  | 'access_denied'
  | 'system_error'
  | 'configuration_change';

// =============================================================================
// Audit Entry Interface
// =============================================================================

export interface AuditEntry {
  /** ISO 8601 timestamp when the event occurred */
  timestamp: string;
  /** Unique correlation ID for tracing related events */
  correlationId: string;
  /** Type of audit event */
  eventType: AuditEventType;
  /** Log level for this entry */
  level: LogLevel;
  /** Principal (user/service) involved in the event */
  principal?: {
    id: string;
    roles?: string[];
    attributes?: Record<string, unknown>;
  };
  /** Resource being accessed or modified */
  resource?: {
    kind: string;
    id: string;
    attributes?: Record<string, unknown>;
  };
  /** Action being performed */
  action?: string;
  /** Result of the authorization decision or operation */
  result: {
    effect?: 'allow' | 'deny';
    policy?: string;
    rule?: string;
    success?: boolean;
    error?: string;
  };
  /** Additional metadata */
  metadata: {
    /** Request ID from the check request */
    requestId?: string;
    /** Duration of the operation in milliseconds */
    durationMs?: number;
    /** Policies that were evaluated */
    policiesEvaluated?: string[];
    /** Derived roles computed */
    derivedRoles?: string[];
    /** Source IP address */
    sourceIp?: string;
    /** User agent string */
    userAgent?: string;
    /** Custom attributes */
    [key: string]: unknown;
  };
}

// =============================================================================
// Audit Sink Interface
// =============================================================================

export interface AuditSinkConfig {
  /** Minimum log level to write */
  minLevel?: LogLevel;
  /** Filter by event types */
  eventTypes?: AuditEventType[];
  /** Enable/disable the sink */
  enabled?: boolean;
}

export interface AuditSink {
  /** Unique name for this sink */
  readonly name: string;

  /** Initialize the sink */
  initialize(): Promise<void>;

  /** Write a single audit entry */
  write(entry: AuditEntry): Promise<void>;

  /** Write multiple entries in batch */
  writeBatch(entries: AuditEntry[]): Promise<void>;

  /** Flush any buffered entries */
  flush(): Promise<void>;

  /** Close the sink and release resources */
  close(): Promise<void>;

  /** Check if sink is healthy */
  isHealthy(): Promise<boolean>;
}

// =============================================================================
// Audit Query Interface
// =============================================================================

export interface AuditQueryFilter {
  /** Start timestamp (inclusive) */
  startTime?: Date;
  /** End timestamp (exclusive) */
  endTime?: Date;
  /** Filter by correlation IDs */
  correlationIds?: string[];
  /** Filter by event types */
  eventTypes?: AuditEventType[];
  /** Filter by log levels */
  levels?: LogLevel[];
  /** Filter by principal ID */
  principalId?: string;
  /** Filter by principal roles */
  principalRoles?: string[];
  /** Filter by resource kind */
  resourceKind?: string;
  /** Filter by resource ID */
  resourceId?: string;
  /** Filter by action */
  action?: string;
  /** Filter by result effect */
  effect?: 'allow' | 'deny';
  /** Filter by policy name */
  policy?: string;
  /** Full-text search in metadata */
  search?: string;
}

export interface AuditQueryOptions {
  /** Maximum number of results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Sort field */
  sortBy?: 'timestamp' | 'eventType' | 'level';
  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
}

export interface AuditQueryResult {
  /** Matching audit entries */
  entries: AuditEntry[];
  /** Total count of matching entries (for pagination) */
  total: number;
  /** Whether there are more results */
  hasMore: boolean;
}

export interface AuditQuery {
  filter?: AuditQueryFilter;
  options?: AuditQueryOptions;
}

// =============================================================================
// Audit Logger Configuration
// =============================================================================

export interface AuditLoggerConfig {
  /** Enable/disable audit logging */
  enabled?: boolean;
  /** Default log level */
  defaultLevel?: LogLevel;
  /** Enable async batch writing */
  batchEnabled?: boolean;
  /** Batch size before auto-flush */
  batchSize?: number;
  /** Batch flush interval in milliseconds */
  batchIntervalMs?: number;
  /** Include stack traces in error entries */
  includeStackTraces?: boolean;
  /** Redact sensitive fields */
  redactFields?: string[];
  /** Custom correlation ID generator */
  correlationIdGenerator?: () => string;
}

// =============================================================================
// Policy Change Event Types
// =============================================================================

export interface PolicyChangeEvent {
  /** Type of change */
  changeType: 'create' | 'update' | 'delete';
  /** Policy name */
  policyName: string;
  /** Policy version (before change for update/delete) */
  previousVersion?: string;
  /** Policy version (after change for create/update) */
  newVersion?: string;
  /** Actor who made the change */
  actor?: {
    id: string;
    type: 'user' | 'service' | 'system';
  };
  /** Reason for the change */
  reason?: string;
}

// =============================================================================
// Decision Event Types
// =============================================================================

export interface DecisionEvent {
  /** The check request */
  request: {
    requestId: string;
    principal: {
      id: string;
      roles: string[];
    };
    resource: {
      kind: string;
      id: string;
    };
    actions: string[];
  };
  /** The check response */
  response: {
    results: Record<string, {
      effect: 'allow' | 'deny';
      policy: string;
      rule?: string;
    }>;
    durationMs: number;
    policiesEvaluated: string[];
  };
}

// =============================================================================
// Access Event Types
// =============================================================================

export interface AccessEvent {
  /** Type of access */
  accessType: 'api' | 'grpc' | 'internal';
  /** Endpoint or method accessed */
  endpoint?: string;
  /** HTTP method */
  method?: string;
  /** Response status */
  status?: number;
  /** Client information */
  client?: {
    ip?: string;
    userAgent?: string;
    apiKey?: string;
  };
}
