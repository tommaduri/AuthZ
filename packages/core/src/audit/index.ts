/**
 * Audit Logging Service for AuthZ Engine
 *
 * Provides comprehensive audit logging for authorization decisions,
 * policy changes, and access events with support for multiple sinks.
 */

import type {
  AuditEntry,
  AuditEventType,
  AuditLoggerConfig,
  AuditQuery,
  AuditQueryResult,
  AuditSink,
  DecisionEvent,
  LogLevel,
  PolicyChangeEvent,
  AccessEvent,
} from './types';

// Re-export types and sinks
export * from './types';
export * from './sinks';

// =============================================================================
// Correlation ID Generation
// =============================================================================

function generateCorrelationId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

// =============================================================================
// Audit Logger Class
// =============================================================================

export class AuditLogger {
  private sinks: AuditSink[] = [];
  private config: Required<AuditLoggerConfig>;
  private batchBuffer: AuditEntry[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private pendingFlush: Promise<void> | null = null;
  private isInitialized = false;

  constructor(config: AuditLoggerConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      defaultLevel: config.defaultLevel ?? 'INFO',
      batchEnabled: config.batchEnabled ?? true,
      batchSize: config.batchSize ?? 50,
      batchIntervalMs: config.batchIntervalMs ?? 1000,
      includeStackTraces: config.includeStackTraces ?? false,
      redactFields: config.redactFields ?? ['password', 'secret', 'token', 'apiKey', 'authorization'],
      correlationIdGenerator: config.correlationIdGenerator ?? generateCorrelationId,
    };
  }

  // ===========================================================================
  // Initialization and Lifecycle
  // ===========================================================================

  /**
   * Add a sink to the logger
   */
  addSink(sink: AuditSink): void {
    this.sinks.push(sink);
  }

  /**
   * Remove a sink by name
   */
  removeSink(name: string): boolean {
    const index = this.sinks.findIndex((s) => s.name === name);
    if (index >= 0) {
      this.sinks.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get all registered sinks
   */
  getSinks(): AuditSink[] {
    return [...this.sinks];
  }

  /**
   * Check if the logger is ready
   */
  isReady(): boolean {
    return this.isInitialized && this.config.enabled;
  }

  /**
   * Initialize the logger and all sinks
   */
  async initialize(): Promise<void> {
    await Promise.all(this.sinks.map((sink) => sink.initialize()));

    if (this.config.batchEnabled && this.config.batchIntervalMs > 0) {
      this.startBatchTimer();
    }

    this.isInitialized = true;
  }

  /**
   * Close the logger and all sinks
   */
  async close(): Promise<void> {
    // Stop batch timer
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }

    // Flush remaining entries
    await this.flush();

    // Close all sinks
    await Promise.all(this.sinks.map((sink) => sink.close()));

    this.isInitialized = false;
  }

  /**
   * Flush all buffered entries
   */
  async flush(): Promise<void> {
    // Avoid concurrent flushes
    if (this.pendingFlush) {
      return this.pendingFlush;
    }

    this.pendingFlush = this.doFlush();
    try {
      await this.pendingFlush;
    } finally {
      this.pendingFlush = null;
    }
  }

  private async doFlush(): Promise<void> {
    if (this.batchBuffer.length === 0) {
      return;
    }

    const entries = this.batchBuffer.splice(0);

    await Promise.all(
      this.sinks.map((sink) =>
        sink.writeBatch(entries).catch((error) => {
          console.error(`Failed to flush to sink ${sink.name}: ${error.message}`);
        })
      )
    );

    await Promise.all(this.sinks.map((sink) => sink.flush()));
  }

  // ===========================================================================
  // Logging Methods
  // ===========================================================================

  /**
   * Log an authorization decision
   */
  logDecision(event: DecisionEvent, correlationId?: string): void {
    if (!this.config.enabled) return;

    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      correlationId: correlationId ?? this.config.correlationIdGenerator(),
      eventType: 'authorization_decision',
      level: 'INFO',
      principal: {
        id: event.request.principal.id,
        roles: event.request.principal.roles,
      },
      resource: {
        kind: event.request.resource.kind,
        id: event.request.resource.id,
      },
      action: event.request.actions.join(','),
      result: this.extractDecisionResult(event),
      metadata: {
        requestId: event.request.requestId,
        durationMs: event.response.durationMs,
        policiesEvaluated: event.response.policiesEvaluated,
        actions: event.request.actions,
        allResults: event.response.results,
      },
    };

    this.writeEntry(entry);
  }

  /**
   * Log a policy change event
   */
  logPolicyChange(event: PolicyChangeEvent, correlationId?: string): void {
    if (!this.config.enabled) return;

    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      correlationId: correlationId ?? this.config.correlationIdGenerator(),
      eventType: 'policy_change',
      level: 'INFO',
      principal: event.actor
        ? {
            id: event.actor.id,
            attributes: { type: event.actor.type },
          }
        : undefined,
      result: {
        success: true,
      },
      metadata: {
        changeType: event.changeType,
        policyName: event.policyName,
        previousVersion: event.previousVersion,
        newVersion: event.newVersion,
        reason: event.reason,
      },
    };

    this.writeEntry(entry);
  }

  /**
   * Log an access event
   */
  logAccess(event: AccessEvent, principal?: { id: string; roles?: string[] }, correlationId?: string): void {
    if (!this.config.enabled) return;

    const eventType: AuditEventType =
      event.status && event.status >= 200 && event.status < 300
        ? 'access_granted'
        : event.status && event.status >= 400
          ? 'access_denied'
          : 'access_request';

    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      correlationId: correlationId ?? this.config.correlationIdGenerator(),
      eventType,
      level: eventType === 'access_denied' ? 'WARN' : 'INFO',
      principal: principal
        ? {
            id: principal.id,
            roles: principal.roles,
          }
        : undefined,
      result: {
        success: event.status ? event.status < 400 : undefined,
      },
      metadata: {
        accessType: event.accessType,
        endpoint: event.endpoint,
        method: event.method,
        status: event.status,
        sourceIp: event.client?.ip,
        userAgent: event.client?.userAgent,
      },
    };

    this.writeEntry(entry);
  }

  /**
   * Log a custom event at a specific level
   */
  log(
    level: LogLevel,
    eventType: AuditEventType,
    message: string,
    metadata?: Record<string, unknown>,
    correlationId?: string
  ): void {
    if (!this.config.enabled) return;

    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      correlationId: correlationId ?? this.config.correlationIdGenerator(),
      eventType,
      level,
      result: {
        success: level !== 'ERROR',
      },
      metadata: {
        message,
        ...this.redactSensitiveFields(metadata ?? {}),
      },
    };

    this.writeEntry(entry);
  }

  /**
   * Log at DEBUG level
   */
  debug(message: string, metadata?: Record<string, unknown>, correlationId?: string): void {
    this.log('DEBUG', 'access_request', message, metadata, correlationId);
  }

  /**
   * Log at INFO level
   */
  info(message: string, metadata?: Record<string, unknown>, correlationId?: string): void {
    this.log('INFO', 'access_request', message, metadata, correlationId);
  }

  /**
   * Log at WARN level
   */
  warn(message: string, metadata?: Record<string, unknown>, correlationId?: string): void {
    this.log('WARN', 'access_request', message, metadata, correlationId);
  }

  /**
   * Log at ERROR level
   */
  error(message: string, error?: Error, metadata?: Record<string, unknown>, correlationId?: string): void {
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      correlationId: correlationId ?? this.config.correlationIdGenerator(),
      eventType: 'system_error',
      level: 'ERROR',
      result: {
        success: false,
        error: error?.message ?? message,
      },
      metadata: {
        message,
        ...(error && this.config.includeStackTraces ? { stack: error.stack } : {}),
        ...this.redactSensitiveFields(metadata ?? {}),
      },
    };

    this.writeEntry(entry);
  }

  // ===========================================================================
  // Query Methods
  // ===========================================================================

  /**
   * Query audit entries (requires a queryable sink)
   * This is a placeholder - actual implementation depends on the sink
   */
  async query(_query: AuditQuery): Promise<AuditQueryResult> {
    // Note: This would typically delegate to a database-backed sink
    // For now, return empty result as file/console/http sinks don't support queries
    console.warn('AuditLogger.query() requires a database sink with query support');
    return {
      entries: [],
      total: 0,
      hasMore: false,
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private writeEntry(entry: AuditEntry): void {
    if (this.config.batchEnabled) {
      this.batchBuffer.push(entry);

      // Auto-flush if batch is full
      if (this.batchBuffer.length >= this.config.batchSize) {
        this.flush().catch((error) => {
          console.error(`Failed to auto-flush audit entries: ${error.message}`);
        });
      }
    } else {
      // Write immediately to all sinks
      for (const sink of this.sinks) {
        sink.write(entry).catch((error) => {
          console.error(`Failed to write to sink ${sink.name}: ${error.message}`);
        });
      }
    }
  }

  private startBatchTimer(): void {
    this.batchTimer = setInterval(() => {
      if (this.batchBuffer.length > 0) {
        this.flush().catch((error) => {
          console.error(`Failed to flush audit entries: ${error.message}`);
        });
      }
    }, this.config.batchIntervalMs);

    // Don't prevent process exit
    if (this.batchTimer.unref) {
      this.batchTimer.unref();
    }
  }

  private extractDecisionResult(event: DecisionEvent): AuditEntry['result'] {
    // Find the first denied action, or use the first action's result
    const actions = Object.keys(event.response.results);
    const deniedAction = actions.find((a) => event.response.results[a].effect === 'deny');
    const primaryAction = deniedAction ?? actions[0];
    const primaryResult = event.response.results[primaryAction];

    return {
      effect: primaryResult?.effect,
      policy: primaryResult?.policy,
      rule: primaryResult?.rule,
    };
  }

  private redactSensitiveFields(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      const shouldRedact = this.config.redactFields.some((field) =>
        lowerKey.includes(field.toLowerCase())
      );

      if (shouldRedact) {
        result[key] = '[REDACTED]';
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.redactSensitiveFields(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }

    return result;
  }
}

// =============================================================================
// Default Instance and Factory
// =============================================================================

/** Default audit logger instance */
export const auditLogger = new AuditLogger();

/**
 * Create a new audit logger with the given configuration
 */
export function createAuditLogger(config?: AuditLoggerConfig): AuditLogger {
  return new AuditLogger(config);
}
