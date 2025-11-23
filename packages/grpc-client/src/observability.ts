/**
 * OpenTelemetry Integration for AuthZ Engine gRPC Client
 *
 * Provides distributed tracing, metrics, and observability features.
 */

import { randomUUID } from 'crypto';
import {
  type OTelConfig,
  type TraceContext,
  type AuthzSpanAttributes,
  type MetricsConfig,
  type PrometheusMetrics,
  type CheckRequest,
  type CheckResponse,
  Effect,
  DEFAULT_OTEL_CONFIG,
} from './types.js';

/**
 * Default metrics configuration
 */
const DEFAULT_METRICS_CONFIG: MetricsConfig = {
  prefix: 'authz_client',
  enableLatencyHistogram: true,
  latencyBuckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
};

/**
 * Span status
 */
export enum SpanStatus {
  UNSET = 'unset',
  OK = 'ok',
  ERROR = 'error',
}

/**
 * Span interface for tracing
 */
export interface Span {
  /** Span context */
  context: TraceContext;
  /** Span name */
  name: string;
  /** Start time */
  startTime: number;
  /** End time */
  endTime?: number;
  /** Span status */
  status: SpanStatus;
  /** Span attributes */
  attributes: Record<string, unknown>;
  /** Span events */
  events: Array<{ name: string; timestamp: number; attributes?: Record<string, unknown> }>;
  /** Child spans */
  children: Span[];
}

/**
 * Tracer interface for creating spans
 */
export interface Tracer {
  /** Start a new span */
  startSpan(name: string, parentContext?: TraceContext): Span;
  /** End a span */
  endSpan(span: Span, status?: SpanStatus): void;
  /** Add event to span */
  addEvent(span: Span, name: string, attributes?: Record<string, unknown>): void;
  /** Set span attributes */
  setAttributes(span: Span, attributes: Record<string, unknown>): void;
  /** Get current trace context */
  getCurrentContext(): TraceContext | null;
  /** Inject trace context into headers */
  injectContext(context: TraceContext, headers: Record<string, string>): void;
  /** Extract trace context from headers */
  extractContext(headers: Record<string, string>): TraceContext | null;
}

/**
 * Internal tracer implementation
 */
class InternalTracer implements Tracer {
  private readonly config: OTelConfig;
  private currentContext: TraceContext | null = null;
  private spans: Map<string, Span> = new Map();

  constructor(config: OTelConfig) {
    this.config = config;
  }

  /**
   * Generate a random trace ID
   */
  private generateTraceId(): string {
    return randomUUID().replace(/-/g, '');
  }

  /**
   * Generate a random span ID
   */
  private generateSpanId(): string {
    return randomUUID().replace(/-/g, '').substring(0, 16);
  }

  /**
   * Start a new span
   */
  startSpan(name: string, parentContext?: TraceContext): Span {
    const context: TraceContext = {
      traceId: parentContext?.traceId || this.generateTraceId(),
      spanId: this.generateSpanId(),
      parentSpanId: parentContext?.spanId,
      traceFlags: 1, // Sampled
    };

    const span: Span = {
      context,
      name,
      startTime: Date.now(),
      status: SpanStatus.UNSET,
      attributes: {
        'service.name': this.config.serviceName,
        ...this.config.spanAttributes,
      },
      events: [],
      children: [],
    };

    this.spans.set(context.spanId, span);
    this.currentContext = context;

    return span;
  }

  /**
   * End a span
   */
  endSpan(span: Span, status: SpanStatus = SpanStatus.OK): void {
    span.endTime = Date.now();
    span.status = status;

    // Export span if sampling allows
    if (Math.random() <= this.config.sampleRate) {
      this.exportSpan(span);
    }
  }

  /**
   * Export span (placeholder for actual OTel export)
   */
  private exportSpan(span: Span): void {
    // In a real implementation, this would send to an OTel collector
    // For now, emit an event for testing/debugging
    if (typeof process !== 'undefined' && process.env.AUTHZ_TRACE_DEBUG) {
      console.log('[TRACE]', JSON.stringify({
        name: span.name,
        traceId: span.context.traceId,
        spanId: span.context.spanId,
        parentSpanId: span.context.parentSpanId,
        duration: (span.endTime || Date.now()) - span.startTime,
        status: span.status,
        attributes: span.attributes,
      }));
    }
  }

  /**
   * Add event to span
   */
  addEvent(span: Span, name: string, attributes?: Record<string, unknown>): void {
    span.events.push({
      name,
      timestamp: Date.now(),
      attributes,
    });
  }

  /**
   * Set span attributes
   */
  setAttributes(span: Span, attributes: Record<string, unknown>): void {
    Object.assign(span.attributes, attributes);
  }

  /**
   * Get current trace context
   */
  getCurrentContext(): TraceContext | null {
    return this.currentContext;
  }

  /**
   * Inject trace context into headers
   */
  injectContext(context: TraceContext, headers: Record<string, string>): void {
    switch (this.config.propagationFormat) {
      case 'w3c':
        headers['traceparent'] = `00-${context.traceId}-${context.spanId}-0${context.traceFlags}`;
        if (context.traceState) {
          headers['tracestate'] = context.traceState;
        }
        break;
      case 'b3':
        headers['X-B3-TraceId'] = context.traceId;
        headers['X-B3-SpanId'] = context.spanId;
        if (context.parentSpanId) {
          headers['X-B3-ParentSpanId'] = context.parentSpanId;
        }
        headers['X-B3-Sampled'] = context.traceFlags === 1 ? '1' : '0';
        break;
      case 'jaeger':
        headers['uber-trace-id'] = `${context.traceId}:${context.spanId}:${context.parentSpanId || '0'}:${context.traceFlags}`;
        break;
    }
  }

  /**
   * Extract trace context from headers
   */
  extractContext(headers: Record<string, string>): TraceContext | null {
    switch (this.config.propagationFormat) {
      case 'w3c': {
        const traceparent = headers['traceparent'];
        if (traceparent) {
          const parts = traceparent.split('-');
          if (parts.length >= 4) {
            return {
              traceId: parts[1],
              spanId: parts[2],
              traceFlags: parseInt(parts[3], 16),
              traceState: headers['tracestate'],
            };
          }
        }
        break;
      }
      case 'b3': {
        const traceId = headers['X-B3-TraceId'];
        const spanId = headers['X-B3-SpanId'];
        if (traceId && spanId) {
          return {
            traceId,
            spanId,
            parentSpanId: headers['X-B3-ParentSpanId'],
            traceFlags: headers['X-B3-Sampled'] === '1' ? 1 : 0,
          };
        }
        break;
      }
      case 'jaeger': {
        const uberTraceId = headers['uber-trace-id'];
        if (uberTraceId) {
          const parts = uberTraceId.split(':');
          if (parts.length >= 4) {
            return {
              traceId: parts[0],
              spanId: parts[1],
              parentSpanId: parts[2] !== '0' ? parts[2] : undefined,
              traceFlags: parseInt(parts[3], 10),
            };
          }
        }
        break;
      }
    }
    return null;
  }
}

/**
 * Metrics collector for Prometheus-style metrics
 */
export class MetricsCollector {
  private readonly config: MetricsConfig;
  private requestsTotal = 0;
  private requestLatencies: number[] = [];
  private activeConnections = 0;
  private errors: Record<string, number> = {};
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(config?: Partial<MetricsConfig>) {
    this.config = { ...DEFAULT_METRICS_CONFIG, ...config };
  }

  /**
   * Record a request
   */
  recordRequest(latencyMs: number, cacheHit: boolean, error?: string): void {
    this.requestsTotal++;
    this.requestLatencies.push(latencyMs / 1000); // Convert to seconds

    if (cacheHit) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
    }

    if (error) {
      this.errors[error] = (this.errors[error] || 0) + 1;
    }

    // Keep only last 10000 latencies to prevent memory issues
    if (this.requestLatencies.length > 10000) {
      this.requestLatencies = this.requestLatencies.slice(-5000);
    }
  }

  /**
   * Set active connections
   */
  setActiveConnections(count: number): void {
    this.activeConnections = count;
  }

  /**
   * Increment active connections
   */
  incrementConnections(): void {
    this.activeConnections++;
  }

  /**
   * Decrement active connections
   */
  decrementConnections(): void {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
  }

  /**
   * Get metrics in Prometheus format
   */
  getPrometheusMetrics(): PrometheusMetrics {
    const latencyHistogram: Record<string, number> = {};

    if (this.config.enableLatencyHistogram && this.config.latencyBuckets) {
      for (const bucket of this.config.latencyBuckets) {
        const count = this.requestLatencies.filter((l) => l <= bucket).length;
        latencyHistogram[`le="${bucket}"`] = count;
      }
      latencyHistogram['le="+Inf"'] = this.requestLatencies.length;
    }

    return {
      requestsTotal: this.requestsTotal,
      requestLatencySeconds: latencyHistogram,
      activeConnections: this.activeConnections,
      errorsTotal: { ...this.errors },
      cacheHitRatio: this.cacheHits / (this.cacheHits + this.cacheMisses) || 0,
    };
  }

  /**
   * Export metrics in Prometheus text format
   */
  exportPrometheusText(): string {
    const metrics = this.getPrometheusMetrics();
    const prefix = this.config.prefix;
    const labels = this.config.defaultLabels
      ? Object.entries(this.config.defaultLabels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(',')
      : '';

    const labelStr = labels ? `{${labels}}` : '';

    let output = '';

    // Request counter
    output += `# HELP ${prefix}_requests_total Total number of authorization requests\n`;
    output += `# TYPE ${prefix}_requests_total counter\n`;
    output += `${prefix}_requests_total${labelStr} ${metrics.requestsTotal}\n\n`;

    // Active connections
    output += `# HELP ${prefix}_active_connections Number of active connections\n`;
    output += `# TYPE ${prefix}_active_connections gauge\n`;
    output += `${prefix}_active_connections${labelStr} ${metrics.activeConnections}\n\n`;

    // Latency histogram
    if (this.config.enableLatencyHistogram) {
      output += `# HELP ${prefix}_request_latency_seconds Request latency histogram\n`;
      output += `# TYPE ${prefix}_request_latency_seconds histogram\n`;
      for (const [bucket, count] of Object.entries(metrics.requestLatencySeconds)) {
        const bucketLabel = labels ? `{${labels},${bucket}}` : `{${bucket}}`;
        output += `${prefix}_request_latency_seconds_bucket${bucketLabel} ${count}\n`;
      }
      const sum = this.requestLatencies.reduce((a, b) => a + b, 0);
      output += `${prefix}_request_latency_seconds_sum${labelStr} ${sum}\n`;
      output += `${prefix}_request_latency_seconds_count${labelStr} ${this.requestLatencies.length}\n\n`;
    }

    // Error counter
    output += `# HELP ${prefix}_errors_total Total number of errors by type\n`;
    output += `# TYPE ${prefix}_errors_total counter\n`;
    for (const [errorType, count] of Object.entries(metrics.errorsTotal)) {
      const errorLabel = labels
        ? `{${labels},error_type="${errorType}"}`
        : `{error_type="${errorType}"}`;
      output += `${prefix}_errors_total${errorLabel} ${count}\n`;
    }
    output += '\n';

    // Cache hit ratio
    output += `# HELP ${prefix}_cache_hit_ratio Cache hit ratio\n`;
    output += `# TYPE ${prefix}_cache_hit_ratio gauge\n`;
    output += `${prefix}_cache_hit_ratio${labelStr} ${metrics.cacheHitRatio}\n`;

    return output;
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.requestsTotal = 0;
    this.requestLatencies = [];
    this.activeConnections = 0;
    this.errors = {};
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }
}

/**
 * Observability manager combining tracing and metrics
 */
export class ObservabilityManager {
  private readonly otelConfig: OTelConfig;
  private readonly tracer: InternalTracer;
  private readonly metrics: MetricsCollector;

  constructor(
    otelConfig?: Partial<OTelConfig>,
    metricsConfig?: Partial<MetricsConfig>
  ) {
    this.otelConfig = { ...DEFAULT_OTEL_CONFIG, ...otelConfig };
    this.tracer = new InternalTracer(this.otelConfig);
    this.metrics = new MetricsCollector(metricsConfig);
  }

  /**
   * Create a traced check operation
   */
  traceCheck(
    request: CheckRequest,
    parentContext?: TraceContext
  ): {
    span: Span;
    headers: Record<string, string>;
    complete: (response: CheckResponse, error?: Error) => void;
  } {
    const span = this.tracer.startSpan('authz.check', parentContext);

    // Set span attributes
    const attributes: AuthzSpanAttributes = {
      'authz.request_id': request.requestId,
      'authz.principal_id': request.principal.id,
      'authz.resource_kind': request.resource.kind,
      'authz.resource_id': request.resource.id,
      'authz.actions': request.actions.join(','),
    };
    this.tracer.setAttributes(span, attributes);

    // Create headers for propagation
    const headers: Record<string, string> = {};
    if (this.otelConfig.tracingEnabled) {
      this.tracer.injectContext(span.context, headers);
    }

    return {
      span,
      headers,
      complete: (response: CheckResponse, error?: Error) => {
        this.completeCheckTrace(span, request, response, error);
      },
    };
  }

  /**
   * Complete a traced check operation
   */
  private completeCheckTrace(
    span: Span,
    request: CheckRequest,
    response: CheckResponse,
    error?: Error
  ): void {
    const endTime = Date.now();
    const latencyMs = endTime - span.startTime;

    // Add response attributes
    if (response.metadata) {
      this.tracer.setAttributes(span, {
        'authz.evaluation_duration_us': response.metadata.evaluationDurationUs,
        'authz.cache_hit': response.metadata.cacheHit,
      });
    }

    // Add effect for first action
    const firstResult = response.results.values().next().value;
    if (firstResult) {
      this.tracer.setAttributes(span, {
        'authz.effect': Effect[firstResult.effect],
      });
    }

    // Add error event if present
    if (error) {
      this.tracer.addEvent(span, 'exception', {
        'exception.type': error.name,
        'exception.message': error.message,
      });
    }

    // End span
    this.tracer.endSpan(span, error ? SpanStatus.ERROR : SpanStatus.OK);

    // Record metrics
    this.metrics.recordRequest(
      latencyMs,
      response.metadata?.cacheHit ?? false,
      error?.name
    );
  }

  /**
   * Get the tracer
   */
  getTracer(): Tracer {
    return this.tracer;
  }

  /**
   * Get the metrics collector
   */
  getMetrics(): MetricsCollector {
    return this.metrics;
  }

  /**
   * Export Prometheus metrics
   */
  exportPrometheusMetrics(): string {
    return this.metrics.exportPrometheusText();
  }

  /**
   * Extract trace context from incoming headers
   */
  extractContext(headers: Record<string, string>): TraceContext | null {
    return this.tracer.extractContext(headers);
  }

  /**
   * Update connection count metric
   */
  setConnectionCount(count: number): void {
    this.metrics.setActiveConnections(count);
  }
}

/**
 * Create an observability manager
 */
export function createObservabilityManager(
  otelConfig?: Partial<OTelConfig>,
  metricsConfig?: Partial<MetricsConfig>
): ObservabilityManager {
  return new ObservabilityManager(otelConfig, metricsConfig);
}
