# Software Design Document: Observability

**Version**: 1.0.0
**Package**: `@authz-engine/server`
**Status**: Specification (Not Yet Implemented)
**Last Updated**: 2025-11-23

---

## 1. Overview

### 1.1 Purpose

The Observability module provides comprehensive monitoring, tracing, and logging capabilities for the AuthZ Engine. This includes:
- Prometheus-compatible metrics
- OpenTelemetry distributed tracing
- Structured audit logging
- Health and readiness probes

### 1.2 Cerbos Compatibility

This implements equivalents to Cerbos's observability features including metrics, tracing, and audit logging backends.

---

## 2. Architecture

### 2.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Observability Stack                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Metrics    │  │   Tracing    │  │    Audit     │          │
│  │  (Prometheus)│  │ (OpenTelemetry)│ │   Logging    │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                   │
│         ▼                 ▼                 ▼                   │
│  ┌──────────────────────────────────────────────────────┐      │
│  │                  Exporters                            │      │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐ │      │
│  │  │Prometheus│  │  OTLP   │  │  File   │  │  Kafka  │ │      │
│  │  │ Scrape  │  │ Export  │  │Backend  │  │ Stream  │ │      │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘ │      │
│  └──────────────────────────────────────────────────────┘      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Metrics

### 3.1 Prometheus Configuration

```yaml
# config.yaml
server:
  httpAddr: ":3592"
  metricsAddr: ":9090"  # Separate metrics port

metrics:
  enabled: true
  prometheus:
    enabled: true
    path: "/metrics"
  labels:
    service: "authz-engine"
    environment: "production"
```

### 3.2 Available Metrics

| Metric Name | Type | Labels | Description |
|-------------|------|--------|-------------|
| `authz_check_total` | Counter | `effect`, `resource_kind` | Total authorization checks |
| `authz_check_duration_seconds` | Histogram | `resource_kind` | Check latency distribution |
| `authz_check_errors_total` | Counter | `error_type` | Authorization errors |
| `authz_policy_load_total` | Counter | `status` | Policy load operations |
| `authz_policy_load_duration_seconds` | Histogram | - | Policy load latency |
| `authz_policy_count` | Gauge | `type` | Currently loaded policies |
| `authz_derived_roles_evaluated_total` | Counter | - | Derived role evaluations |
| `authz_cel_evaluations_total` | Counter | - | CEL expression evaluations |
| `authz_cel_evaluation_duration_seconds` | Histogram | - | CEL evaluation latency |
| `authz_agent_tasks_total` | Counter | `agent`, `status` | Agent task executions |
| `authz_agent_task_duration_seconds` | Histogram | `agent` | Agent task latency |

### 3.3 TypeScript Implementation

```typescript
import { Registry, Counter, Histogram, Gauge } from 'prom-client';

interface MetricsConfig {
  enabled: boolean;
  prefix?: string;
  labels?: Record<string, string>;
  buckets?: number[];
}

class AuthzMetrics {
  private registry: Registry;

  public checkTotal: Counter;
  public checkDuration: Histogram;
  public checkErrors: Counter;
  public policyCount: Gauge;
  public celEvaluations: Counter;
  public celDuration: Histogram;
  public agentTasks: Counter;
  public agentDuration: Histogram;

  constructor(config: MetricsConfig) {
    this.registry = new Registry();

    if (config.labels) {
      this.registry.setDefaultLabels(config.labels);
    }

    this.checkTotal = new Counter({
      name: `${config.prefix}_check_total`,
      help: 'Total authorization checks',
      labelNames: ['effect', 'resource_kind'],
      registers: [this.registry],
    });

    this.checkDuration = new Histogram({
      name: `${config.prefix}_check_duration_seconds`,
      help: 'Authorization check latency',
      labelNames: ['resource_kind'],
      buckets: config.buckets || [0.001, 0.005, 0.01, 0.025, 0.05, 0.1],
      registers: [this.registry],
    });

    this.checkErrors = new Counter({
      name: `${config.prefix}_check_errors_total`,
      help: 'Authorization errors',
      labelNames: ['error_type'],
      registers: [this.registry],
    });

    this.policyCount = new Gauge({
      name: `${config.prefix}_policy_count`,
      help: 'Currently loaded policies',
      labelNames: ['type'],
      registers: [this.registry],
    });

    this.celEvaluations = new Counter({
      name: `${config.prefix}_cel_evaluations_total`,
      help: 'CEL expression evaluations',
      registers: [this.registry],
    });

    this.celDuration = new Histogram({
      name: `${config.prefix}_cel_evaluation_duration_seconds`,
      help: 'CEL evaluation latency',
      buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01],
      registers: [this.registry],
    });

    this.agentTasks = new Counter({
      name: `${config.prefix}_agent_tasks_total`,
      help: 'Agent task executions',
      labelNames: ['agent', 'status'],
      registers: [this.registry],
    });

    this.agentDuration = new Histogram({
      name: `${config.prefix}_agent_task_duration_seconds`,
      help: 'Agent task latency',
      labelNames: ['agent'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
      registers: [this.registry],
    });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}
```

### 3.4 Metrics Endpoint

```typescript
// GET /metrics
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', metrics.getContentType());
  res.send(await metrics.getMetrics());
});
```

---

## 4. Distributed Tracing

### 4.1 OpenTelemetry Configuration

```yaml
# config.yaml
tracing:
  enabled: true
  serviceName: "authz-engine"
  exporter:
    type: "otlp"  # otlp, jaeger, zipkin
    endpoint: "http://otel-collector:4317"
  sampling:
    type: "probabilistic"  # always_on, always_off, probabilistic, ratio
    probability: 0.1  # 10% sampling
  propagation:
    - "w3c"  # W3C TraceContext
    - "b3"   # Zipkin B3
```

### 4.2 Span Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `authz.principal.id` | string | Principal identifier |
| `authz.principal.roles` | string[] | Principal roles |
| `authz.resource.kind` | string | Resource type |
| `authz.resource.id` | string | Resource identifier |
| `authz.action` | string | Requested action |
| `authz.effect` | string | Decision result |
| `authz.policy.name` | string | Matched policy |
| `authz.derived_roles` | string[] | Computed derived roles |
| `authz.cel.expression` | string | Evaluated CEL expression |

### 4.3 TypeScript Implementation

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler
} from '@opentelemetry/sdk-trace-base';

interface TracingConfig {
  enabled: boolean;
  serviceName: string;
  exporter: {
    type: 'otlp' | 'jaeger' | 'zipkin';
    endpoint: string;
  };
  sampling: {
    type: 'always_on' | 'always_off' | 'probabilistic';
    probability?: number;
  };
}

class TracingManager {
  private sdk: NodeSDK;

  constructor(config: TracingConfig) {
    if (!config.enabled) return;

    const exporter = this.createExporter(config.exporter);
    const sampler = this.createSampler(config.sampling);

    this.sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: config.serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
      }),
      traceExporter: exporter,
      sampler,
    });

    this.sdk.start();
  }

  private createExporter(config: TracingConfig['exporter']) {
    switch (config.type) {
      case 'otlp':
        return new OTLPTraceExporter({ url: config.endpoint });
      // Add jaeger, zipkin exporters
      default:
        return new OTLPTraceExporter({ url: config.endpoint });
    }
  }

  private createSampler(config: TracingConfig['sampling']) {
    switch (config.type) {
      case 'always_on':
        return new ParentBasedSampler({ root: { shouldSample: () => ({ decision: 1 }) } });
      case 'probabilistic':
        return new TraceIdRatioBasedSampler(config.probability || 0.1);
      default:
        return new TraceIdRatioBasedSampler(1.0);
    }
  }

  async shutdown(): Promise<void> {
    await this.sdk?.shutdown();
  }
}
```

### 4.4 Instrumented Check Flow

```typescript
import { trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('authz-engine');

async function checkResources(request: CheckRequest): Promise<CheckResponse> {
  return tracer.startActiveSpan('authz.check', {
    kind: SpanKind.SERVER,
    attributes: {
      'authz.principal.id': request.principal.id,
      'authz.resource.kind': request.resource.kind,
      'authz.action': request.action,
    },
  }, async (span) => {
    try {
      // Derived roles evaluation
      const derivedRoles = await tracer.startActiveSpan('authz.derived_roles', async (roleSpan) => {
        const roles = await evaluateDerivedRoles(request.principal);
        roleSpan.setAttribute('authz.derived_roles', roles);
        roleSpan.end();
        return roles;
      });

      // Policy matching
      const policy = await tracer.startActiveSpan('authz.policy_match', async (policySpan) => {
        const matched = findMatchingPolicy(request.resource.kind);
        policySpan.setAttribute('authz.policy.name', matched?.name || 'none');
        policySpan.end();
        return matched;
      });

      // Decision
      const effect = await evaluatePolicy(policy, request, derivedRoles);

      span.setAttribute('authz.effect', effect);
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();

      return { effect };
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      span.end();
      throw error;
    }
  });
}
```

---

## 5. Audit Logging

### 5.1 Configuration

```yaml
# config.yaml
audit:
  enabled: true
  accessLogs:
    enabled: true
    excludeMetadata: false
  decisionLogs:
    enabled: true
    includeInputs: true
    includeOutputs: true
  backend:
    type: "file"  # local, file, kafka
    file:
      path: "/var/log/authz-engine/audit.log"
      maxSizeMB: 100
      maxFiles: 10
      compress: true
    kafka:
      brokers: ["kafka:9092"]
      topic: "authz-audit"
      clientId: "authz-engine"
```

### 5.2 Audit Log Schema

```typescript
interface AccessLogEntry {
  timestamp: string;
  callId: string;
  peer: {
    address: string;
    userAgent?: string;
  };
  request: {
    method: string;
    path: string;
    requestId?: string;
  };
  response: {
    statusCode: number;
    duration: number;
  };
  metadata?: Record<string, unknown>;
}

interface DecisionLogEntry {
  timestamp: string;
  callId: string;
  requestId?: string;
  inputs: {
    principal: {
      id: string;
      roles: string[];
      attr?: Record<string, unknown>;
    };
    resource: {
      kind: string;
      id: string;
      attr?: Record<string, unknown>;
    };
    action: string;
  };
  outputs: {
    effect: 'EFFECT_ALLOW' | 'EFFECT_DENY';
    policy: string;
    matchedScope?: string;
    derivedRoles?: string[];
    effectiveDerivedRoles?: string[];
  };
  metadata?: {
    evaluationDuration: number;
    policiesEvaluated: number;
    conditionsEvaluated: number;
  };
}
```

### 5.3 Audit Backends

```typescript
interface AuditBackend {
  writeAccessLog(entry: AccessLogEntry): Promise<void>;
  writeDecisionLog(entry: DecisionLogEntry): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

class LocalAuditBackend implements AuditBackend {
  private buffer: (AccessLogEntry | DecisionLogEntry)[] = [];
  private maxSize: number;

  constructor(config: { maxEntries: number }) {
    this.maxSize = config.maxEntries;
  }

  async writeAccessLog(entry: AccessLogEntry): Promise<void> {
    this.buffer.push(entry);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  async writeDecisionLog(entry: DecisionLogEntry): Promise<void> {
    this.buffer.push(entry);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  getEntries(): (AccessLogEntry | DecisionLogEntry)[] {
    return [...this.buffer];
  }

  async flush(): Promise<void> {}
  async close(): Promise<void> {}
}

class FileAuditBackend implements AuditBackend {
  private stream: fs.WriteStream;
  private rotator: LogRotator;

  constructor(config: FileBackendConfig) {
    this.rotator = new LogRotator(config);
    this.stream = this.rotator.createStream();
  }

  async writeAccessLog(entry: AccessLogEntry): Promise<void> {
    const line = JSON.stringify({ type: 'access', ...entry }) + '\n';
    await this.write(line);
  }

  async writeDecisionLog(entry: DecisionLogEntry): Promise<void> {
    const line = JSON.stringify({ type: 'decision', ...entry }) + '\n';
    await this.write(line);
  }

  private async write(data: string): Promise<void> {
    if (this.rotator.needsRotation()) {
      await this.rotator.rotate();
      this.stream = this.rotator.createStream();
    }
    this.stream.write(data);
  }

  async flush(): Promise<void> {
    return new Promise((resolve) => this.stream.once('drain', resolve));
  }

  async close(): Promise<void> {
    this.stream.end();
  }
}

class KafkaAuditBackend implements AuditBackend {
  private producer: KafkaProducer;
  private topic: string;

  constructor(config: KafkaBackendConfig) {
    this.producer = new Kafka({ brokers: config.brokers }).producer();
    this.topic = config.topic;
  }

  async writeAccessLog(entry: AccessLogEntry): Promise<void> {
    await this.producer.send({
      topic: this.topic,
      messages: [{
        key: entry.callId,
        value: JSON.stringify({ type: 'access', ...entry }),
        headers: { type: 'access' },
      }],
    });
  }

  async writeDecisionLog(entry: DecisionLogEntry): Promise<void> {
    await this.producer.send({
      topic: this.topic,
      messages: [{
        key: entry.callId,
        value: JSON.stringify({ type: 'decision', ...entry }),
        headers: { type: 'decision' },
      }],
    });
  }

  async flush(): Promise<void> {}

  async close(): Promise<void> {
    await this.producer.disconnect();
  }
}
```

---

## 6. Health Checks

### 6.1 Endpoints

| Endpoint | Purpose | Response |
|----------|---------|----------|
| `GET /health/live` | Liveness probe | `{ "status": "ok" }` |
| `GET /health/ready` | Readiness probe | `{ "status": "ready", "checks": {...} }` |
| `GET /health` | Combined health | Full health status |

### 6.2 Implementation

```typescript
interface HealthCheck {
  name: string;
  check(): Promise<HealthCheckResult>;
}

interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  message?: string;
  details?: Record<string, unknown>;
}

class HealthManager {
  private checks: Map<string, HealthCheck> = new Map();

  register(check: HealthCheck): void {
    this.checks.set(check.name, check);
  }

  async checkLiveness(): Promise<{ status: 'ok' }> {
    return { status: 'ok' };
  }

  async checkReadiness(): Promise<ReadinessResult> {
    const results: Record<string, HealthCheckResult> = {};
    let overallStatus: 'ready' | 'not_ready' = 'ready';

    for (const [name, check] of this.checks) {
      try {
        results[name] = await check.check();
        if (results[name].status === 'unhealthy') {
          overallStatus = 'not_ready';
        }
      } catch (error) {
        results[name] = { status: 'unhealthy', message: error.message };
        overallStatus = 'not_ready';
      }
    }

    return { status: overallStatus, checks: results };
  }
}

// Built-in checks
class PolicyStoreHealthCheck implements HealthCheck {
  name = 'policy_store';

  async check(): Promise<HealthCheckResult> {
    const policyCount = await policyStore.getPolicyCount();
    return {
      status: policyCount > 0 ? 'healthy' : 'degraded',
      details: { policyCount },
    };
  }
}

class DatabaseHealthCheck implements HealthCheck {
  name = 'database';

  async check(): Promise<HealthCheckResult> {
    const start = Date.now();
    await db.query('SELECT 1');
    const latency = Date.now() - start;
    return {
      status: latency < 100 ? 'healthy' : 'degraded',
      details: { latencyMs: latency },
    };
  }
}
```

---

## 7. Structured Logging

### 7.1 Configuration

```yaml
# config.yaml
logging:
  level: "info"  # trace, debug, info, warn, error
  format: "json"  # json, text
  output: "stdout"  # stdout, stderr, file
  file:
    path: "/var/log/authz-engine/app.log"
    maxSizeMB: 50
  requestId:
    enabled: true
    header: "X-Request-ID"
```

### 7.2 Log Format

```typescript
interface LogEntry {
  timestamp: string;
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  message: string;
  requestId?: string;
  traceId?: string;
  spanId?: string;
  service: string;
  context?: Record<string, unknown>;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
}
```

### 7.3 Logger Implementation

```typescript
import pino from 'pino';
import { context, trace } from '@opentelemetry/api';

class Logger {
  private pino: pino.Logger;

  constructor(config: LoggingConfig) {
    this.pino = pino({
      level: config.level,
      formatters: {
        level: (label) => ({ level: label }),
      },
      mixin: () => {
        const span = trace.getSpan(context.active());
        const spanContext = span?.spanContext();
        return spanContext ? {
          traceId: spanContext.traceId,
          spanId: spanContext.spanId,
        } : {};
      },
    });
  }

  child(context: Record<string, unknown>): Logger {
    const childLogger = Object.create(this);
    childLogger.pino = this.pino.child(context);
    return childLogger;
  }

  info(msg: string, context?: Record<string, unknown>): void {
    this.pino.info(context, msg);
  }

  warn(msg: string, context?: Record<string, unknown>): void {
    this.pino.warn(context, msg);
  }

  error(msg: string, error?: Error, context?: Record<string, unknown>): void {
    this.pino.error({ ...context, err: error }, msg);
  }

  debug(msg: string, context?: Record<string, unknown>): void {
    this.pino.debug(context, msg);
  }
}

// Request-scoped logger
function createRequestLogger(req: Request): Logger {
  return logger.child({
    requestId: req.headers['x-request-id'] || ulid(),
    method: req.method,
    path: req.path,
  });
}
```

---

## 8. Performance Targets

| Metric | Target |
|--------|--------|
| Metrics scrape latency | < 50ms |
| Tracing overhead | < 5% |
| Audit log write latency | < 1ms (async) |
| Health check latency | < 100ms |

---

## 9. Related Documents

- [CERBOS-FEATURE-COVERAGE-MATRIX.md](../CERBOS-FEATURE-COVERAGE-MATRIX.md)
- [SERVER-PACKAGE-SDD.md](./SERVER-PACKAGE-SDD.md)
- [POLICY-TESTING-SDD.md](./POLICY-TESTING-SDD.md)

---

## 10. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-11-23 | Initial specification |
