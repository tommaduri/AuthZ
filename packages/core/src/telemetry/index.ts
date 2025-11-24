/**
 * OpenTelemetry Distributed Tracing Module
 *
 * Provides centralized tracing initialization and span management
 * for the authorization engine.
 */

import { trace, context, SpanStatusCode, Tracer } from '@opentelemetry/api';
import type { Span, Attributes } from '@opentelemetry/api';

/**
 * Global tracer instance
 */
let globalTracer: Tracer | null = null;

/**
 * Initialize the global tracer
 * Should be called once at application startup
 */
export function initializeTracer(tracer?: Tracer): Tracer {
  if (!tracer) {
    tracer = trace.getTracer('authz-engine', '0.1.0');
  }
  globalTracer = tracer;
  return tracer;
}

/**
 * Get the global tracer instance
 * Lazily initializes if not already done
 */
export function getTracer(): Tracer {
  if (!globalTracer) {
    globalTracer = trace.getTracer('authz-engine', '0.1.0');
  }
  return globalTracer;
}

/**
 * Span creation helper with automatic context management
 */
export interface SpanContext {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  attributes?: Attributes;
}

/**
 * Create a new span with automatic context propagation
 */
export function createSpan(
  name: string,
  attributes?: Attributes,
  parentSpan?: Span,
): Span {
  const tracer = getTracer();
  const span = tracer.startSpan(name, {
    attributes,
    ...(parentSpan && { parent: parentSpan }),
  });
  return span;
}

/**
 * Execute a function within a span context
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Attributes,
  parentSpan?: Span,
): Promise<T> {
  const span = createSpan(name, attributes, parentSpan);

  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Execute a synchronous function within a span context
 */
export function withSpanSync<T>(
  name: string,
  fn: (span: Span) => T,
  attributes?: Attributes,
  parentSpan?: Span,
): T {
  const span = createSpan(name, attributes, parentSpan);

  return context.with(trace.setSpan(context.active(), span), () => {
    try {
      const result = fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Get the current active span
 */
export function getActiveSpan(): Span | undefined {
  return trace.getActiveSpan();
}

/**
 * Set span status as success
 */
export function setSpanSuccess(span: Span): void {
  span.setStatus({ code: SpanStatusCode.OK });
}

/**
 * Set span status as error
 */
export function setSpanError(span: Span, error: Error | string): void {
  const message = typeof error === 'string' ? error : error.message;
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message,
  });
  if (error instanceof Error) {
    span.recordException(error);
  }
}

/**
 * Add attributes to a span
 */
export function addSpanAttributes(span: Span, attributes: Attributes): void {
  span.setAttributes(attributes);
}

/**
 * Add an event to a span
 */
export function addSpanEvent(
  span: Span,
  name: string,
  attributes?: Attributes,
): void {
  span.addEvent(name, attributes);
}

/**
 * Extract trace context from carrier (e.g., HTTP headers)
 * Used for context propagation across services
 */
export function extractTraceContext(carrier: Record<string, string | string[]>): SpanContext {
  // W3C Trace Context headers
  const traceparent = carrier['traceparent'] as string;

  if (traceparent) {
    // Format: version-traceId-parentSpanId-traceFlags
    const parts = traceparent.split('-');
    return {
      traceId: parts[1],
      parentSpanId: parts[2],
    };
  }

  // Fallback to X-Trace-ID headers (for backward compatibility)
  return {
    traceId: carrier['x-trace-id'] as string,
    spanId: carrier['x-span-id'] as string,
  };
}

/**
 * Inject trace context into carrier (e.g., HTTP headers)
 * Used for context propagation across services
 */
export function injectTraceContext(
  span: Span,
  traceId: string,
  carrier: Record<string, string>,
): void {
  // W3C Trace Context
  carrier['traceparent'] = `00-${traceId}-${span.spanContext().spanId}-01`;

  // Fallback headers
  carrier['x-trace-id'] = traceId;
  carrier['x-span-id'] = span.spanContext().spanId;
}

/**
 * Create a span with predefined attributes for decisions
 */
export function createDecisionSpan(
  name: string,
  requestId: string,
  principalId: string,
  resourceKind: string,
  parentSpan?: Span,
): Span {
  return createSpan(
    name,
    {
      'authz.request_id': requestId,
      'authz.principal_id': principalId,
      'authz.resource_kind': resourceKind,
      'span.kind': 'internal',
    },
    parentSpan,
  );
}

/**
 * Create a span with predefined attributes for evaluations
 */
export function createEvaluationSpan(
  name: string,
  expression: string,
  evaluationType: string,
  parentSpan?: Span,
): Span {
  return createSpan(
    name,
    {
      'authz.expression_length': expression.length,
      'authz.evaluation_type': evaluationType,
      'span.kind': 'internal',
    },
    parentSpan,
  );
}

export type { Span };
