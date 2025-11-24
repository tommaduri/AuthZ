# OpenTelemetry Distributed Tracing

This document describes the OpenTelemetry integration for the Authorization Engine, providing comprehensive distributed tracing across authorization decisions and agent processing.

## Overview

The AuthZ Engine includes first-class OpenTelemetry support for:

- **Decision Engine Tracing**: Trace each authorization check from request to decision
- **Agent Pipeline Tracing**: Track individual agent processing (GUARDIAN, ANALYST, ADVISOR, ENFORCER)
- **Policy Evaluation**: Instrument CEL expression evaluation and policy matching
- **Context Propagation**: W3C Trace Context headers for distributed tracing across services
- **Flexible Exporters**: Support for OTLP (HTTP/gRPC), Jaeger, and Console exporters

## Initialization

### Quick Start

```typescript
import { initializeTelemetry } from '@authz-engine/core';

// Initialize for development (console output)
initializeTelemetry();
```

### Environment-Based Configuration

```typescript
import { TelemetryConfig } from '@authz-engine/core';

// Development (console logging)
TelemetryConfig.development();

// Staging (OTLP HTTP)
TelemetryConfig.staging('http://otel-collector:4318/v1/traces');

// Production (OTLP gRPC)
TelemetryConfig.production('http://otel-collector:4317');

// Jaeger
TelemetryConfig.jaeger('http://localhost:14268/api/traces');
```

### Environment Variables

Configure telemetry via environment variables:

```bash
# Exporter type: console, otlp-http, otlp-grpc, jaeger
OTEL_EXPORTER_TYPE=otlp-http

# Enable/disable telemetry
OTEL_ENABLED=true

# OTLP endpoint
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces

# Jaeger endpoint
JAEGER_ENDPOINT=http://localhost:14268/api/traces

# Service information
OTEL_SERVICE_NAME=authz-engine
OTEL_SERVICE_VERSION=0.1.0

# Batch configuration
OTEL_BATCH_SIZE=512
OTEL_BATCH_TIMEOUT=5000
OTEL_MAX_QUEUE_SIZE=2048

# Sampling rate (0.0 to 1.0)
OTEL_SAMPLE_RATE=1.0

# Debug mode
OTEL_DEBUG=false
```

## Instrumentation

### Decision Engine Spans

Each authorization check creates a span hierarchy:

```
authz.check (root span)
├── authz.derived_roles
├── authz.policy_match (per policy)
│   └── authz.cel_evaluate (per condition)
└── authz.policy_match (per policy)
    └── authz.cel_evaluate (per condition)
```

**Attributes:**
- `authz.request_id`: Request ID
- `authz.principal_id`: Principal ID
- `authz.principal_roles`: Comma-separated roles
- `authz.resource_kind`: Resource kind
- `authz.resource_id`: Resource ID
- `authz.actions`: Comma-separated actions
- `authz.allowed_actions`: Actions that were allowed
- `authz.denied_actions`: Actions that were denied
- `authz.policy_name`: Policy being evaluated
- `authz.evaluation_type`: Type of CEL evaluation
- `authz.evaluation_duration_ms`: Evaluation duration in milliseconds

### Agent Orchestrator Spans

The orchestrator creates spans for each agent stage:

```
orchestrator.processRequest (root span)
├── step.guardian
├── step.analyst
├── step.advisor
└── step.enforcer
```

**Attributes:**
- `orchestration.request_id`: Request ID
- `orchestration.principal_id`: Principal ID
- `orchestration.resource_kind`: Resource kind
- `orchestration.correlation_id`: Correlation ID for request tracking

### REST Server Spans

HTTP endpoints are traced with span hierarchy:

```
http.check
├── authz.check (decision engine)
└── orchestrator.processRequest (if agentic)
```

**Attributes:**
- `http.method`: HTTP method
- `http.url`: Request URL
- `http.client_ip`: Client IP address
- `trace.id`: Trace ID

## API Usage

### Creating Spans

```typescript
import { createSpan, withSpan } from '@authz-engine/core';

// Create a simple span
const span = createSpan('my.operation', {
  'custom.attribute': 'value',
});
// ... do work ...
span.end();

// With automatic error handling
const result = await withSpan(
  'my.operation',
  async (span) => {
    span.addEvent('processing_started');
    const result = await someAsyncWork();
    span.addEvent('processing_completed');
    return result;
  },
  { 'custom.attribute': 'value' },
);
```

### Decision Spans

```typescript
import { createAuthzCheckSpan, recordDecisionOutcome } from '@authz-engine/core';

const request: CheckRequest = { /* ... */ };
const span = createAuthzCheckSpan(request);

try {
  const response = engine.check(request, span);
  recordDecisionOutcome(span, response);
} finally {
  span.end();
}
```

### Policy Spans

```typescript
import { createPolicyMatchSpan, recordPolicyMatch } from '@authz-engine/core';

const span = createPolicyMatchSpan('policy-name');
// ... check if policy matches ...
recordPolicyMatch(span, 'policy-name', 'rule-name', matched);
span.end();
```

### CEL Evaluation Spans

```typescript
import { createCelEvaluateSpan, recordCelEvaluationMetrics } from '@authz-engine/core';

const expression = 'request.auth.claims.role == "admin"';
const span = createCelEvaluateSpan(expression, 'rule_condition');

const startTime = Date.now();
const result = evaluator.evaluateBoolean(expression, context);
recordCelEvaluationMetrics(span, Date.now() - startTime, result, true);
span.end();
```

## Context Propagation

### Extracting from HTTP Headers

```typescript
import { extractTraceContext } from '@authz-engine/core';

const request: FastifyRequest = { /* ... */ };
const headers = request.headers as Record<string, string | string[]>;
const traceContext = extractTraceContext(headers);

// traceContext contains:
// - traceId: from W3C traceparent or x-trace-id header
// - parentSpanId: from W3C traceparent or x-span-id header
```

### Injecting into HTTP Headers

```typescript
import { injectTraceContext } from '@authz-engine/core';

const span = createSpan('my.operation');
const headers: Record<string, string> = {};

injectTraceContext(span, traceId, headers);

// Send headers with response
response.setHeader('traceparent', headers.traceparent);
response.setHeader('x-trace-id', headers['x-trace-id']);
```

## Span Attributes Reference

### Authorization Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `authz.request_id` | string | Authorization request ID |
| `authz.principal_id` | string | Principal (user/service) ID |
| `authz.principal_roles` | string | Comma-separated roles |
| `authz.resource_kind` | string | Resource type |
| `authz.resource_id` | string | Resource ID |
| `authz.actions` | string | Comma-separated actions |
| `authz.num_actions` | int | Number of actions |
| `authz.num_policies` | int | Number of policies evaluated |
| `authz.allowed_actions` | string | Comma-separated allowed actions |
| `authz.denied_actions` | string | Comma-separated denied actions |
| `authz.num_allowed` | int | Number of allowed actions |
| `authz.num_denied` | int | Number of denied actions |
| `authz.policy_name` | string | Policy being evaluated |
| `authz.matched_policy` | string | Policy that matched |
| `authz.matched_rule` | string | Rule that matched |
| `authz.evaluation_duration_ms` | int | Time to evaluate |
| `authz.expression_type` | string | Type of CEL expression |

### Orchestration Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `orchestration.request_id` | string | Request ID |
| `orchestration.principal_id` | string | Principal ID |
| `orchestration.resource_kind` | string | Resource kind |
| `orchestration.correlation_id` | string | Correlation ID for tracking |
| `orchestration.error_type` | string | Error type if failed |
| `orchestration.processing_time_ms` | int | Total processing time |
| `orchestration.success` | bool | Whether processing succeeded |

### HTTP Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `http.method` | string | HTTP method (GET, POST, etc.) |
| `http.url` | string | Request URL path |
| `http.client_ip` | string | Client IP address |
| `trace.id` | string | Trace ID |

## Exporters

### Console Exporter (Development)

Logs spans to console in JSON format. Useful for development and debugging.

```typescript
import { TelemetryConfig } from '@authz-engine/core';

TelemetryConfig.development();
```

### OTLP HTTP Exporter

Sends spans to an OTLP collector via HTTP. Compatible with Jaeger, DataDog, New Relic, etc.

```typescript
import { TelemetryConfig } from '@authz-engine/core';

TelemetryConfig.staging('http://otel-collector:4318/v1/traces');
```

Environment variables:
- `OTEL_EXPORTER_OTLP_ENDPOINT`: Collector HTTP endpoint

### OTLP gRPC Exporter

High-performance gRPC-based OTLP exporter.

```typescript
import { TelemetryConfig } from '@authz-engine/core';

TelemetryConfig.production('http://otel-collector:4317');
```

Environment variables:
- `OTEL_EXPORTER_OTLP_ENDPOINT`: Collector gRPC endpoint

### Jaeger Exporter

Direct integration with Jaeger for tracing.

```typescript
import { TelemetryConfig } from '@authz-engine/core';

TelemetryConfig.jaeger('http://localhost:14268/api/traces');
```

Environment variables:
- `JAEGER_ENDPOINT`: Jaeger HTTP collector endpoint

## Integration Examples

### With Express

```typescript
import express from 'express';
import { extractTraceContext, injectTraceContext, createSpan } from '@authz-engine/core';

const app = express();

app.post('/check', (req, res) => {
  // Extract trace context from request
  const headers: Record<string, string | string[]> = req.headers;
  const traceContext = extractTraceContext(headers);

  // Create span
  const span = createSpan('http.check', {
    'trace.id': traceContext.traceId,
  });

  try {
    // Process request...
    const response = engine.check(request, span);

    // Inject trace context into response
    const responseHeaders: Record<string, string> = {};
    injectTraceContext(span, traceContext.traceId || 'unknown', responseHeaders);
    Object.entries(responseHeaders).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    res.json(response);
  } finally {
    span.end();
  }
});
```

### With gRPC

```typescript
import { Server } from '@grpc/grpc-js';
import { extractTraceContext, createSpan } from '@authz-engine/core';

const server = new Server();

server.addService(CheckService, {
  check: (call, callback) => {
    // Extract trace context from gRPC metadata
    const metadata = call.metadata.getMap();
    const headers: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(metadata)) {
      headers[key] = value as string;
    }

    const traceContext = extractTraceContext(headers);
    const span = createSpan('grpc.check', { 'trace.id': traceContext.traceId });

    try {
      const response = engine.check(request, span);
      callback(null, response);
    } catch (err) {
      callback(err);
    } finally {
      span.end();
    }
  },
});
```

## Observability Stack Setup

### Docker Compose (OTLP + Jaeger)

```yaml
version: '3.8'
services:
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"  # Jaeger UI
      - "14268:14268"  # HTTP collector

  otel-collector:
    image: otel/opentelemetry-collector:latest
    ports:
      - "4318:4318"    # OTLP HTTP
      - "4317:4317"    # OTLP gRPC
    volumes:
      - ./otel-config.yaml:/etc/otel-collector-config.yaml
    command: --config=/etc/otel-collector-config.yaml
    environment:
      - GOGC=80

  authz-engine:
    build: .
    ports:
      - "3592:3592"
    environment:
      - OTEL_EXPORTER_TYPE=otlp-http
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318/v1/traces
      - OTEL_SERVICE_NAME=authz-engine
      - OTEL_DEBUG=true
    depends_on:
      - otel-collector
```

### OTLP Collector Configuration

```yaml
# otel-config.yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
      grpc:
        endpoint: 0.0.0.0:4317

processors:
  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  jaeger:
    endpoint: http://jaeger:14250
    tls:
      insecure: true

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [jaeger]
```

## Performance Considerations

- **Sampling**: Set `OTEL_SAMPLE_RATE` to 0.1 or lower in high-traffic environments
- **Batch Size**: Increase `OTEL_BATCH_SIZE` for better throughput
- **Buffer Size**: Tune `OTEL_MAX_QUEUE_SIZE` based on memory constraints
- **Collector**: Use OTLP gRPC for better performance over HTTP

## Troubleshooting

### Spans not appearing

1. Check `OTEL_ENABLED` is not set to `false`
2. Verify exporter is configured correctly
3. Check collector is accessible
4. Enable debug mode: `OTEL_DEBUG=true`

### High memory usage

1. Lower `OTEL_MAX_QUEUE_SIZE`
2. Reduce `OTEL_SAMPLE_RATE`
3. Lower `OTEL_BATCH_SIZE`
4. Increase batch timeout: `OTEL_BATCH_TIMEOUT`

### Slow performance

1. Use OTLP gRPC instead of HTTP
2. Increase batch size: `OTEL_BATCH_SIZE`
3. Reduce sampling rate: `OTEL_SAMPLE_RATE`
4. Check collector CPU/memory

## References

- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [Jaeger Documentation](https://www.jaegertracing.io/docs/)
- [OTLP Protocol](https://opentelemetry.io/docs/reference/specification/protocol/)
