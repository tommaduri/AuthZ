/**
 * Console Audit Sink
 *
 * Pretty-prints audit entries to the console with color coding
 * and structured formatting for development and debugging.
 */

import type { AuditEntry, AuditSink, AuditSinkConfig, LogLevel } from '../types';
import { LOG_LEVEL_PRIORITY } from '../types';

// =============================================================================
// ANSI Color Codes
// =============================================================================

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
} as const;

const LEVEL_COLORS: Record<LogLevel, string> = {
  DEBUG: COLORS.gray,
  INFO: COLORS.blue,
  WARN: COLORS.yellow,
  ERROR: COLORS.red,
};

const EFFECT_COLORS = {
  allow: COLORS.green,
  deny: COLORS.red,
} as const;

// =============================================================================
// Console Sink Configuration
// =============================================================================

export interface ConsoleSinkConfig extends AuditSinkConfig {
  /** Enable colored output */
  colorize?: boolean;
  /** Pretty print JSON */
  prettyPrint?: boolean;
  /** Include timestamp in output */
  showTimestamp?: boolean;
  /** Include correlation ID in output */
  showCorrelationId?: boolean;
  /** Use stderr for WARN and ERROR levels */
  useStderr?: boolean;
}

// =============================================================================
// Console Sink Implementation
// =============================================================================

export class ConsoleSink implements AuditSink {
  readonly name = 'console';
  private config: Required<ConsoleSinkConfig>;
  private isInitialized = false;

  constructor(config: ConsoleSinkConfig = {}) {
    this.config = {
      minLevel: config.minLevel ?? 'DEBUG',
      eventTypes: config.eventTypes ?? [],
      enabled: config.enabled ?? true,
      colorize: config.colorize ?? this.detectColorSupport(),
      prettyPrint: config.prettyPrint ?? true,
      showTimestamp: config.showTimestamp ?? true,
      showCorrelationId: config.showCorrelationId ?? true,
      useStderr: config.useStderr ?? true,
    };
  }

  async initialize(): Promise<void> {
    this.isInitialized = true;
  }

  async write(entry: AuditEntry): Promise<void> {
    if (!this.shouldLog(entry)) {
      return;
    }

    const output = this.formatEntry(entry);
    const stream = this.getOutputStream(entry.level);
    stream.write(output + '\n');
  }

  async writeBatch(entries: AuditEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.write(entry);
    }
  }

  async flush(): Promise<void> {
    // Console writes are synchronous, nothing to flush
  }

  async close(): Promise<void> {
    this.isInitialized = false;
  }

  async isHealthy(): Promise<boolean> {
    return this.isInitialized && this.config.enabled;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private shouldLog(entry: AuditEntry): boolean {
    if (!this.config.enabled) {
      return false;
    }

    // Check log level
    if (LOG_LEVEL_PRIORITY[entry.level] < LOG_LEVEL_PRIORITY[this.config.minLevel]) {
      return false;
    }

    // Check event type filter
    if (this.config.eventTypes.length > 0 && !this.config.eventTypes.includes(entry.eventType)) {
      return false;
    }

    return true;
  }

  private formatEntry(entry: AuditEntry): string {
    if (this.config.prettyPrint) {
      return this.formatPretty(entry);
    }
    return this.formatJson(entry);
  }

  private formatPretty(entry: AuditEntry): string {
    const parts: string[] = [];

    // Timestamp
    if (this.config.showTimestamp) {
      const timestamp = this.colorize(
        new Date(entry.timestamp).toISOString(),
        COLORS.dim,
      );
      parts.push(`[${timestamp}]`);
    }

    // Level
    const levelStr = entry.level.padEnd(5);
    parts.push(this.colorize(levelStr, LEVEL_COLORS[entry.level]));

    // Correlation ID
    if (this.config.showCorrelationId) {
      const shortId = entry.correlationId.slice(0, 8);
      parts.push(this.colorize(`(${shortId})`, COLORS.gray));
    }

    // Event Type
    parts.push(this.colorize(entry.eventType, COLORS.cyan));

    // Principal
    if (entry.principal) {
      parts.push(this.colorize(`user=${entry.principal.id}`, COLORS.magenta));
    }

    // Resource and Action
    if (entry.resource) {
      const resourceStr = `${entry.resource.kind}:${entry.resource.id}`;
      parts.push(this.colorize(resourceStr, COLORS.white));
    }
    if (entry.action) {
      parts.push(this.colorize(`action=${entry.action}`, COLORS.white));
    }

    // Result
    if (entry.result.effect) {
      const effectColor = EFFECT_COLORS[entry.result.effect];
      const effectStr = entry.result.effect.toUpperCase();
      parts.push(this.colorize(`[${effectStr}]`, effectColor + COLORS.bright));

      if (entry.result.policy) {
        parts.push(this.colorize(`policy=${entry.result.policy}`, COLORS.dim));
      }
    } else if (entry.result.success !== undefined) {
      const statusStr = entry.result.success ? 'SUCCESS' : 'FAILURE';
      const statusColor = entry.result.success ? COLORS.green : COLORS.red;
      parts.push(this.colorize(`[${statusStr}]`, statusColor));
    }

    // Error
    if (entry.result.error) {
      parts.push(this.colorize(`error="${entry.result.error}"`, COLORS.red));
    }

    // Duration
    if (entry.metadata.durationMs !== undefined) {
      parts.push(this.colorize(`(${entry.metadata.durationMs}ms)`, COLORS.dim));
    }

    return parts.join(' ');
  }

  private formatJson(entry: AuditEntry): string {
    return JSON.stringify(entry);
  }

  private colorize(text: string, color: string): string {
    if (!this.config.colorize) {
      return text;
    }
    return `${color}${text}${COLORS.reset}`;
  }

  private getOutputStream(level: LogLevel): NodeJS.WriteStream {
    if (this.config.useStderr && (level === 'WARN' || level === 'ERROR')) {
      return process.stderr;
    }
    return process.stdout;
  }

  private detectColorSupport(): boolean {
    // Check for NO_COLOR environment variable
    if (process.env.NO_COLOR !== undefined) {
      return false;
    }

    // Check for FORCE_COLOR environment variable
    if (process.env.FORCE_COLOR !== undefined) {
      return true;
    }

    // Check if stdout is a TTY
    if (typeof process.stdout.isTTY === 'boolean') {
      return process.stdout.isTTY;
    }

    return false;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createConsoleSink(config?: ConsoleSinkConfig): ConsoleSink {
  return new ConsoleSink(config);
}
