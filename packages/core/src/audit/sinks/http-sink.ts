/**
 * HTTP Audit Sink
 *
 * POSTs audit entries to an external HTTP endpoint
 * with support for batching, retries, and authentication.
 */

import type { AuditEntry, AuditSink, AuditSinkConfig } from '../types';
import { LOG_LEVEL_PRIORITY } from '../types';

// =============================================================================
// Constants
// =============================================================================

/** Default HTTP sink configuration values */
const HTTP_SINK_DEFAULTS = {
  /** Default request timeout in milliseconds */
  TIMEOUT_MS: 30000,
  /** Default API key header name */
  API_KEY_HEADER: 'X-API-Key',
  /** Default number of retry attempts */
  RETRIES: 3,
  /** Default retry delay in milliseconds */
  RETRY_DELAY_MS: 1000,
  /** Default exponential backoff multiplier */
  RETRY_BACKOFF: 2,
  /** Default max batch size */
  MAX_BATCH_SIZE: 100,
  /** Default batch flush interval in milliseconds */
  BATCH_INTERVAL_MS: 5000,
} as const;

// =============================================================================
// HTTP Sink Configuration
// =============================================================================

export interface HttpSinkConfig extends AuditSinkConfig {
  /** Target URL to POST audit entries */
  url: string;
  /** HTTP method (default: POST) */
  method?: 'POST' | 'PUT';
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Authentication header value */
  authorization?: string;
  /** API key header name */
  apiKeyHeader?: string;
  /** API key value */
  apiKey?: string;
  /** Additional headers */
  headers?: Record<string, string>;
  /** Number of retry attempts */
  retries?: number;
  /** Retry delay in milliseconds */
  retryDelay?: number;
  /** Exponential backoff multiplier */
  retryBackoff?: number;
  /** Enable batch mode */
  batchMode?: boolean;
  /** Maximum batch size */
  maxBatchSize?: number;
  /** Batch flush interval in milliseconds */
  batchIntervalMs?: number;
  /** Enable TLS verification */
  tlsVerify?: boolean;
}

// =============================================================================
// HTTP Sink Implementation
// =============================================================================

export class HttpSink implements AuditSink {
  readonly name = 'http';
  private config: Required<HttpSinkConfig>;
  private isInitialized = false;
  private batchBuffer: AuditEntry[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private pendingRequests: Set<Promise<void>> = new Set();

  constructor(config: HttpSinkConfig) {
    this.config = {
      url: config.url,
      method: config.method ?? 'POST',
      timeout: config.timeout ?? HTTP_SINK_DEFAULTS.TIMEOUT_MS,
      authorization: config.authorization ?? '',
      apiKeyHeader: config.apiKeyHeader ?? HTTP_SINK_DEFAULTS.API_KEY_HEADER,
      apiKey: config.apiKey ?? '',
      headers: config.headers ?? {},
      retries: config.retries ?? HTTP_SINK_DEFAULTS.RETRIES,
      retryDelay: config.retryDelay ?? HTTP_SINK_DEFAULTS.RETRY_DELAY_MS,
      retryBackoff: config.retryBackoff ?? HTTP_SINK_DEFAULTS.RETRY_BACKOFF,
      batchMode: config.batchMode ?? true,
      maxBatchSize: config.maxBatchSize ?? HTTP_SINK_DEFAULTS.MAX_BATCH_SIZE,
      batchIntervalMs: config.batchIntervalMs ?? HTTP_SINK_DEFAULTS.BATCH_INTERVAL_MS,
      tlsVerify: config.tlsVerify ?? true,
      minLevel: config.minLevel ?? 'DEBUG',
      eventTypes: config.eventTypes ?? [],
      enabled: config.enabled ?? true,
    };
  }

  async initialize(): Promise<void> {
    // Validate URL
    try {
      new URL(this.config.url);
    } catch {
      throw new Error(`Invalid URL: ${this.config.url}`);
    }

    // Start batch timer if batch mode enabled
    if (this.config.batchMode && this.config.batchIntervalMs > 0) {
      this.startBatchTimer();
    }

    this.isInitialized = true;
  }

  async write(entry: AuditEntry): Promise<void> {
    if (!this.shouldLog(entry)) {
      return;
    }

    if (this.config.batchMode) {
      this.addToBatch(entry);
    } else {
      await this.sendEntries([entry]);
    }
  }

  async writeBatch(entries: AuditEntry[]): Promise<void> {
    const filteredEntries = entries.filter((entry) => this.shouldLog(entry));

    if (filteredEntries.length === 0) {
      return;
    }

    if (this.config.batchMode) {
      for (const entry of filteredEntries) {
        this.addToBatch(entry);
      }
    } else {
      await this.sendEntries(filteredEntries);
    }
  }

  async flush(): Promise<void> {
    // Stop batch timer
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }

    // Flush remaining batch buffer
    if (this.batchBuffer.length > 0) {
      const entries = this.batchBuffer.splice(0);
      await this.sendEntries(entries);
    }

    // Wait for all pending requests
    await Promise.all(this.pendingRequests);
  }

  async close(): Promise<void> {
    await this.flush();
    this.isInitialized = false;
  }

  async isHealthy(): Promise<boolean> {
    if (!this.isInitialized || !this.config.enabled) {
      return false;
    }

    try {
      // Send a health check request
      const response = await this.makeRequest([], true);
      return response.ok;
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private shouldLog(entry: AuditEntry): boolean {
    if (!this.config.enabled) {
      return false;
    }

    if (LOG_LEVEL_PRIORITY[entry.level] < LOG_LEVEL_PRIORITY[this.config.minLevel]) {
      return false;
    }

    if (this.config.eventTypes.length > 0 && !this.config.eventTypes.includes(entry.eventType)) {
      return false;
    }

    return true;
  }

  private addToBatch(entry: AuditEntry): void {
    this.batchBuffer.push(entry);

    // Flush if batch is full
    if (this.batchBuffer.length >= this.config.maxBatchSize) {
      const entries = this.batchBuffer.splice(0);
      const request = this.sendEntries(entries);
      this.trackRequest(request);
    }
  }

  private startBatchTimer(): void {
    this.batchTimer = setInterval(() => {
      if (this.batchBuffer.length > 0) {
        const entries = this.batchBuffer.splice(0);
        const request = this.sendEntries(entries);
        this.trackRequest(request);
      }
    }, this.config.batchIntervalMs);

    // Don't prevent process exit
    if (this.batchTimer.unref) {
      this.batchTimer.unref();
    }
  }

  private trackRequest(request: Promise<void>): void {
    this.pendingRequests.add(request);
    request.finally(() => {
      this.pendingRequests.delete(request);
    });
  }

  private async sendEntries(entries: AuditEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        const response = await this.makeRequest(entries);

        if (response.ok) {
          return;
        }

        const errorText = await response.text();
        lastError = new Error(`HTTP ${response.status}: ${errorText}`);

        // Don't retry 4xx errors (except 429)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw lastError;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      // Wait before retry (with exponential backoff)
      if (attempt < this.config.retries) {
        const delay = this.config.retryDelay * Math.pow(this.config.retryBackoff, attempt);
        await this.sleep(delay);
      }
    }

    // All retries failed - entries are lost
    // In production, this should use a proper logger or dead-letter queue
  }

  private async makeRequest(entries: AuditEntry[], isHealthCheck = false): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };

    // Add authentication
    if (this.config.authorization) {
      headers['Authorization'] = this.config.authorization;
    }

    if (this.config.apiKey) {
      headers[this.config.apiKeyHeader] = this.config.apiKey;
    }

    // Prepare body
    const body = isHealthCheck
      ? JSON.stringify({ type: 'health_check', timestamp: new Date().toISOString() })
      : JSON.stringify(entries.length === 1 ? entries[0] : { entries });

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const fetchOptions: RequestInit = {
        method: this.config.method,
        headers,
        body,
        signal: controller.signal,
      };

      // Note: TLS verification control would require a custom agent in Node.js
      // For standard fetch, we rely on the environment configuration

      const response = await fetch(this.config.url, fetchOptions);
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createHttpSink(config: HttpSinkConfig): HttpSink {
  return new HttpSink(config);
}
