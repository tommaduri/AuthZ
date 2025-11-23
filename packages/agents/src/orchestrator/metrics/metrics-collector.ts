/**
 * Metrics Collector - Per-agent latency tracking and OpenTelemetry integration
 *
 * Provides:
 * - Per-agent latency tracking
 * - Decision audit trail
 * - OpenTelemetry spans for distributed tracing
 */

import type { AgentType } from '../../types/agent.types.js';

/**
 * Histogram bucket configuration
 */
export interface HistogramConfig {
  buckets: number[];
}

/**
 * Latency statistics
 */
export interface LatencyStats {
  count: number;
  sum: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  histogram: Map<number, number>;
}

/**
 * Agent metrics snapshot
 */
export interface AgentMetricsSnapshot {
  agentType: AgentType;
  timestamp: Date;
  latency: LatencyStats;
  requests: {
    total: number;
    successful: number;
    failed: number;
    timeout: number;
  };
  circuitBreaker?: {
    state: string;
    failures: number;
    rejections: number;
  };
}

/**
 * Audit trail entry
 */
export interface AuditTrailEntry {
  id: string;
  timestamp: Date;
  requestId: string;
  correlationId?: string;
  agentType: AgentType;
  operation: string;
  durationMs: number;
  success: boolean;
  input?: unknown;
  output?: unknown;
  error?: string;
  metadata: Record<string, unknown>;
  spanId?: string;
  traceId?: string;
  parentSpanId?: string;
}

/**
 * OpenTelemetry span data
 */
export interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: 'internal' | 'server' | 'client' | 'producer' | 'consumer';
  startTime: number;
  endTime?: number;
  status: 'ok' | 'error' | 'unset';
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
  links: SpanLink[];
}

/**
 * Span event
 */
export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, string | number | boolean>;
}

/**
 * Span link
 */
export interface SpanLink {
  traceId: string;
  spanId: string;
  attributes?: Record<string, string | number | boolean>;
}

/**
 * Metrics configuration
 */
export interface MetricsConfig {
  /** Enable metrics collection */
  enabled: boolean;
  /** Histogram buckets for latency (ms) */
  latencyBuckets: number[];
  /** Maximum audit trail entries to keep in memory */
  maxAuditTrailSize: number;
  /** Whether to include input/output in audit trail */
  includePayloadsInAudit: boolean;
  /** Sampling rate for detailed traces (0-1) */
  traceSamplingRate: number;
  /** Export interval for metrics (ms) */
  exportIntervalMs: number;
  /** OpenTelemetry endpoint (optional) */
  otlpEndpoint?: string;
}

/**
 * Default metrics configuration
 */
export const DEFAULT_METRICS_CONFIG: MetricsConfig = {
  enabled: true,
  latencyBuckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  maxAuditTrailSize: 10000,
  includePayloadsInAudit: false,
  traceSamplingRate: 0.1,
  exportIntervalMs: 60000,
};

/**
 * Metrics collector for tracking agent performance
 */
export class MetricsCollector {
  private config: MetricsConfig;
  private latencies: Map<AgentType, number[]> = new Map();
  private requestCounts: Map<AgentType, { total: number; success: number; failed: number; timeout: number }> = new Map();
  private auditTrail: AuditTrailEntry[] = [];
  private spans: Map<string, SpanData> = new Map();
  private activeSpans: Map<string, SpanData> = new Map();
  private exportListeners: ((metrics: Record<AgentType, AgentMetricsSnapshot>) => void)[] = [];
  private exportInterval?: ReturnType<typeof setInterval>;
  private startTime: Date = new Date();

  constructor(config: Partial<MetricsConfig> = {}) {
    this.config = { ...DEFAULT_METRICS_CONFIG, ...config };

    // Initialize agent types
    const agentTypes: AgentType[] = ['guardian', 'analyst', 'advisor', 'enforcer'];
    for (const agentType of agentTypes) {
      this.latencies.set(agentType, []);
      this.requestCounts.set(agentType, { total: 0, success: 0, failed: 0, timeout: 0 });
    }
  }

  /**
   * Start the metrics collector
   */
  start(): void {
    if (this.config.enabled && this.config.exportIntervalMs > 0) {
      this.exportInterval = setInterval(() => {
        this.exportMetrics();
      }, this.config.exportIntervalMs);
    }
  }

  /**
   * Stop the metrics collector
   */
  stop(): void {
    if (this.exportInterval) {
      clearInterval(this.exportInterval);
      this.exportInterval = undefined;
    }
  }

  /**
   * Record a request latency
   */
  recordLatency(agentType: AgentType, durationMs: number, success: boolean, timeout: boolean = false): void {
    if (!this.config.enabled) return;

    const latencies = this.latencies.get(agentType) ?? [];
    latencies.push(durationMs);

    // Keep only last 10000 latencies for memory efficiency
    if (latencies.length > 10000) {
      latencies.splice(0, latencies.length - 10000);
    }
    this.latencies.set(agentType, latencies);

    const counts = this.requestCounts.get(agentType)!;
    counts.total++;
    if (timeout) {
      counts.timeout++;
      counts.failed++;
    } else if (success) {
      counts.success++;
    } else {
      counts.failed++;
    }
  }

  /**
   * Add an audit trail entry
   */
  addAuditEntry(entry: Omit<AuditTrailEntry, 'id' | 'timestamp'>): AuditTrailEntry {
    const fullEntry: AuditTrailEntry = {
      ...entry,
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      timestamp: new Date(),
      input: this.config.includePayloadsInAudit ? entry.input : undefined,
      output: this.config.includePayloadsInAudit ? entry.output : undefined,
    };

    this.auditTrail.push(fullEntry);

    // Trim audit trail if too large
    if (this.auditTrail.length > this.config.maxAuditTrailSize) {
      this.auditTrail.splice(0, this.auditTrail.length - this.config.maxAuditTrailSize);
    }

    return fullEntry;
  }

  /**
   * Get audit trail with optional filters
   */
  getAuditTrail(filters?: {
    agentType?: AgentType;
    requestId?: string;
    correlationId?: string;
    operation?: string;
    success?: boolean;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  }): AuditTrailEntry[] {
    let entries = [...this.auditTrail];

    if (filters) {
      if (filters.agentType) {
        entries = entries.filter(e => e.agentType === filters.agentType);
      }
      if (filters.requestId) {
        entries = entries.filter(e => e.requestId === filters.requestId);
      }
      if (filters.correlationId) {
        entries = entries.filter(e => e.correlationId === filters.correlationId);
      }
      if (filters.operation) {
        entries = entries.filter(e => e.operation === filters.operation);
      }
      if (filters.success !== undefined) {
        entries = entries.filter(e => e.success === filters.success);
      }
      if (filters.startTime) {
        entries = entries.filter(e => e.timestamp >= filters.startTime!);
      }
      if (filters.endTime) {
        entries = entries.filter(e => e.timestamp <= filters.endTime!);
      }
      if (filters.limit) {
        entries = entries.slice(-filters.limit);
      }
    }

    return entries;
  }

  /**
   * Start a new span for distributed tracing
   */
  startSpan(
    name: string,
    agentType: AgentType,
    parentSpanId?: string,
    attributes?: Record<string, string | number | boolean>
  ): SpanData {
    const shouldSample = Math.random() < this.config.traceSamplingRate;

    const span: SpanData = {
      traceId: parentSpanId ? this.getTraceIdFromSpan(parentSpanId) : this.generateId(),
      spanId: this.generateId(),
      parentSpanId,
      name,
      kind: 'internal',
      startTime: Date.now(),
      status: 'unset',
      attributes: {
        'agent.type': agentType,
        'agent.sampled': shouldSample,
        ...attributes,
      },
      events: [],
      links: [],
    };

    if (shouldSample || !parentSpanId) {
      this.activeSpans.set(span.spanId, span);
    }

    return span;
  }

  /**
   * End a span
   */
  endSpan(spanId: string, status: 'ok' | 'error' = 'ok', error?: Error): void {
    const span = this.activeSpans.get(spanId);
    if (span) {
      span.endTime = Date.now();
      span.status = status;

      if (error) {
        span.attributes['error.message'] = error.message;
        span.attributes['error.type'] = error.name;
        span.events.push({
          name: 'exception',
          timestamp: Date.now(),
          attributes: {
            'exception.message': error.message,
            'exception.type': error.name,
          },
        });
      }

      this.spans.set(spanId, span);
      this.activeSpans.delete(spanId);

      // Keep only last 1000 completed spans
      if (this.spans.size > 1000) {
        const keys = Array.from(this.spans.keys());
        keys.slice(0, keys.length - 1000).forEach(k => this.spans.delete(k));
      }
    }
  }

  /**
   * Add an event to a span
   */
  addSpanEvent(spanId: string, name: string, attributes?: Record<string, string | number | boolean>): void {
    const span = this.activeSpans.get(spanId);
    if (span) {
      span.events.push({
        name,
        timestamp: Date.now(),
        attributes,
      });
    }
  }

  /**
   * Get latency statistics for an agent
   */
  getLatencyStats(agentType: AgentType): LatencyStats {
    const latencies = this.latencies.get(agentType) ?? [];

    if (latencies.length === 0) {
      return {
        count: 0,
        sum: 0,
        min: 0,
        max: 0,
        mean: 0,
        p50: 0,
        p90: 0,
        p95: 0,
        p99: 0,
        histogram: new Map(),
      };
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);

    // Build histogram
    const histogram = new Map<number, number>();
    for (const bucket of this.config.latencyBuckets) {
      histogram.set(bucket, sorted.filter(v => v <= bucket).length);
    }

    return {
      count: sorted.length,
      sum,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: sum / sorted.length,
      p50: this.percentile(sorted, 0.5),
      p90: this.percentile(sorted, 0.9),
      p95: this.percentile(sorted, 0.95),
      p99: this.percentile(sorted, 0.99),
      histogram,
    };
  }

  /**
   * Get metrics snapshot for an agent
   */
  getAgentMetrics(agentType: AgentType): AgentMetricsSnapshot {
    const counts = this.requestCounts.get(agentType)!;

    return {
      agentType,
      timestamp: new Date(),
      latency: this.getLatencyStats(agentType),
      requests: { ...counts },
    };
  }

  /**
   * Get metrics for all agents
   */
  getAllMetrics(): Record<AgentType, AgentMetricsSnapshot> {
    const agentTypes: AgentType[] = ['guardian', 'analyst', 'advisor', 'enforcer'];
    const metrics: Record<string, AgentMetricsSnapshot> = {};

    for (const agentType of agentTypes) {
      metrics[agentType] = this.getAgentMetrics(agentType);
    }

    return metrics as Record<AgentType, AgentMetricsSnapshot>;
  }

  /**
   * Get overall system metrics
   */
  getSystemMetrics(): {
    uptime: number;
    totalRequests: number;
    successRate: number;
    avgLatencyMs: number;
    activeSpans: number;
    auditTrailSize: number;
  } {
    let totalRequests = 0;
    let totalSuccess = 0;
    let totalLatency = 0;
    let latencyCount = 0;

    for (const counts of this.requestCounts.values()) {
      totalRequests += counts.total;
      totalSuccess += counts.success;
    }

    for (const latencies of this.latencies.values()) {
      totalLatency += latencies.reduce((a, b) => a + b, 0);
      latencyCount += latencies.length;
    }

    return {
      uptime: Date.now() - this.startTime.getTime(),
      totalRequests,
      successRate: totalRequests > 0 ? totalSuccess / totalRequests : 1,
      avgLatencyMs: latencyCount > 0 ? totalLatency / latencyCount : 0,
      activeSpans: this.activeSpans.size,
      auditTrailSize: this.auditTrail.length,
    };
  }

  /**
   * Subscribe to metric exports
   */
  onExport(listener: (metrics: Record<AgentType, AgentMetricsSnapshot>) => void): () => void {
    this.exportListeners.push(listener);
    return () => {
      const index = this.exportListeners.indexOf(listener);
      if (index > -1) {
        this.exportListeners.splice(index, 1);
      }
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    for (const latencies of this.latencies.values()) {
      latencies.length = 0;
    }

    for (const counts of this.requestCounts.values()) {
      counts.total = 0;
      counts.success = 0;
      counts.failed = 0;
      counts.timeout = 0;
    }

    this.auditTrail.length = 0;
    this.spans.clear();
    this.activeSpans.clear();
    this.startTime = new Date();
  }

  /**
   * Export metrics to OpenTelemetry (if configured)
   */
  async exportToOTLP(): Promise<void> {
    if (!this.config.otlpEndpoint) return;

    const metrics = this.getAllMetrics();
    const systemMetrics = this.getSystemMetrics();

    try {
      await fetch(`${this.config.otlpEndpoint}/v1/metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceMetrics: [{
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'authz-engine-agents' } },
              ],
            },
            scopeMetrics: [{
              scope: { name: 'agent-orchestrator' },
              metrics: Object.entries(metrics).flatMap(([agentType, snapshot]) => [
                {
                  name: `agent.${agentType}.latency.p99`,
                  gauge: { dataPoints: [{ asDouble: snapshot.latency.p99, timeUnixNano: Date.now() * 1000000 }] },
                },
                {
                  name: `agent.${agentType}.requests.total`,
                  sum: { dataPoints: [{ asInt: snapshot.requests.total, timeUnixNano: Date.now() * 1000000 }] },
                },
              ]),
            }],
          }],
        }),
      });
    } catch (error) {
      console.error('Failed to export metrics to OTLP:', error);
    }
  }

  private exportMetrics(): void {
    const metrics = this.getAllMetrics();
    this.exportListeners.forEach(listener => listener(metrics));

    if (this.config.otlpEndpoint) {
      this.exportToOTLP().catch(console.error);
    }
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  private generateId(): string {
    return Array.from({ length: 16 }, () =>
      Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
    ).join('');
  }

  private getTraceIdFromSpan(spanId: string): string {
    const span = this.activeSpans.get(spanId) ?? this.spans.get(spanId);
    return span?.traceId ?? this.generateId();
  }
}
