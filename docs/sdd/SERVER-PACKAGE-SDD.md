# Software Design Document: @authz-engine/server

**Version**: 2.0.0
**Package**: `packages/server`
**Status**: ✅ Fully Documented
**Last Updated**: 2024-11-24

---

## 1. Overview

### 1.1 Purpose

The `@authz-engine/server` package provides HTTP REST and gRPC server implementations for the AuthZ authorization engine. It exposes the core decision engine and agent orchestrator via comprehensive network APIs.

### 1.2 Scope

This package includes:
- **REST API Server**: Fastify-based HTTP server (~1,865 lines)
- **gRPC Server**: Protocol buffer services for high-performance
- **WebSocket Server**: Real-time streaming and notifications
- **Policy Loader**: File and directory loading with hot reload
- **Comprehensive Middleware**: CORS, rate limiting, authentication
- **Health & Metrics**: Kubernetes-ready probes and Prometheus metrics

### 1.3 Package Structure

```
packages/server/
├── src/
│   ├── index.ts                 # Package exports
│   ├── rest/
│   │   └── server.ts           # Fastify REST server (~1,865 lines)
│   ├── grpc/
│   │   └── server.ts           # gRPC server implementation
│   ├── websocket/
│   │   └── server.ts           # WebSocket real-time server
│   ├── policy/
│   │   └── loader.ts           # Policy file loader with watch
│   └── utils/
│       └── logger.ts           # Pino-based logging
├── proto/
│   └── authz.proto             # Protocol buffer definitions
├── tests/
└── package.json
```

---

## 2. Architecture

### 2.1 Component Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         @authz-engine/server                                │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        TRANSPORT LAYER                               │   │
│  │                                                                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │   │
│  │  │    REST     │  │    gRPC     │  │  WebSocket  │                  │   │
│  │  │  (Fastify)  │  │ (@grpc/js)  │  │   (ws)      │                  │   │
│  │  │             │  │             │  │             │                  │   │
│  │  │ Port: 3592  │  │ Port: 3593  │  │ Port: 3594  │                  │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                  │   │
│  │         │                │                │                          │   │
│  └─────────┼────────────────┼────────────────┼──────────────────────────┘   │
│            │                │                │                              │
│  ┌─────────┼────────────────┼────────────────┼──────────────────────────┐   │
│  │         │         MIDDLEWARE STACK        │                          │   │
│  │         │                │                │                          │   │
│  │  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐                  │   │
│  │  │ Validation  │  │    Auth     │  │ Rate Limit  │                  │   │
│  │  │   (Zod)     │  │  (JWT/mTLS) │  │ (Enforcer)  │                  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                  │   │
│  │                                                                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │   │
│  │  │    CORS     │  │   Logging   │  │   Metrics   │                  │   │
│  │  │  (origins)  │  │   (Pino)    │  │ (Prometheus)│                  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                      │                                      │
│  ┌───────────────────────────────────┼──────────────────────────────────┐   │
│  │                         SERVICE LAYER                                │   │
│  │                                   │                                  │   │
│  │  ┌────────────────────────────────▼────────────────────────────┐    │   │
│  │  │                      Route Handlers                          │    │   │
│  │  │                                                              │    │   │
│  │  │  Core Routes          Agentic Routes         Admin Routes    │    │   │
│  │  │  ───────────          ──────────────         ────────────    │    │   │
│  │  │  /api/check           /v1/check/agentic      /api/policies   │    │   │
│  │  │  /api/check/batch     /v1/agents/*           /api/playground │    │   │
│  │  │  /health              /api/v1/agentic/*                      │    │   │
│  │  │  /ready                                                      │    │   │
│  │  └──────────────────────────────────────────────────────────────┘    │   │
│  │                                   │                                  │   │
│  └───────────────────────────────────┼──────────────────────────────────┘   │
│                                      │                                      │
│  ┌───────────────────────────────────▼──────────────────────────────────┐   │
│  │                       ENGINE LAYER                                   │   │
│  │                                                                       │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐      │   │
│  │  │ DecisionEngine  │  │ AgentOrchestrator│  │  PolicyLoader   │      │   │
│  │  │ (@authz/core)   │  │ (@authz/agents)  │  │  (hot reload)   │      │   │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘      │   │
│  │                                                                       │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Request Flow

```
Client Request
      │
      ▼
┌─────────────────┐
│   Transport     │  (REST / gRPC / WebSocket)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Middleware    │  Validation → Auth → Rate Limit → CORS
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Route Handler  │  Match endpoint → Extract params
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ DecisionEngine  │  Policy evaluation
│     .check()    │
└────────┬────────┘
         │
         ▼ (if agents enabled)
┌─────────────────┐
│AgentOrchestrator│  Anomaly → Pattern → Explain → Enforce
│.processRequest()│
└────────┬────────┘
         │
         ▼
   Response
```

---

## 3. Component Design

### 3.1 REST Server (`rest/server.ts`)

#### 3.1.1 Server Configuration

```typescript
interface RestServerConfig {
  port: number;                      // Default: 3592
  host: string;                      // Default: '0.0.0.0'
  policyDir: string;                // Path to policy files
  enableAgents?: boolean;           // Enable agentic features
  agentsConfig?: OrchestratorConfig;
  corsOrigins?: string[];
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  enableMetrics?: boolean;          // Prometheus metrics
  trustProxy?: boolean;             // For X-Forwarded-* headers
}
```

#### 3.1.2 Complete Endpoint Reference

##### Core Authorization Endpoints

| Method | Path | Description | Request Body |
|--------|------|-------------|--------------|
| `POST` | `/api/check` | Single resource check | `CheckRequest` |
| `POST` | `/api/check/batch` | Batch resource check | `BatchCheckRequest` |
| `GET` | `/health` | Full health check | - |
| `GET` | `/ready` | Readiness probe | - |
| `POST` | `/api/playground/evaluate` | CEL expression evaluation | `{ expression, context }` |
| `GET` | `/api/policies` | List loaded policies | - |

##### Agentic V1 Endpoints (`/v1/agents/*`)

| Method | Path | Description | Request Body |
|--------|------|-------------|--------------|
| `POST` | `/v1/check/agentic` | Full agent pipeline check | `CheckRequest + options` |
| `GET` | `/v1/agents/health` | Agent orchestrator health | - |
| `GET` | `/v1/agents/patterns` | List learned patterns | Query: `type`, `status` |
| `POST` | `/v1/agents/patterns/:id/validate` | Validate/approve pattern | `{ isApproved, validatedBy }` |
| `GET` | `/v1/agents/anomalies` | List detected anomalies | Query: `status`, `severity`, `principalId` |
| `GET` | `/v1/agents/anomalies/:id` | Get anomaly details | - |
| `POST` | `/v1/agents/anomalies/:id/resolve` | Resolve anomaly | `{ status, notes? }` |
| `GET` | `/v1/agents/enforcements` | List pending enforcements | - |
| `POST` | `/v1/agents/enforcements/:id/approve` | Approve enforcement | `{ approvedBy }` |
| `POST` | `/v1/agents/enforcements/:id/reject` | Reject enforcement | `{ rejectedBy, reason? }` |
| `POST` | `/v1/agents/explain` | Explain a decision | `{ request, response }` |
| `POST` | `/v1/agents/ask` | Ask policy question | `{ question }` |
| `POST` | `/v1/agents/debug` | Debug policy issue | `{ issue, policyYaml }` |
| `POST` | `/v1/agents/enforce` | Trigger enforcement | `{ type, principalId, reason }` |

##### API V1 Agentic Endpoints (`/api/v1/agentic/*`)

| Method | Path | Description | Request Body |
|--------|------|-------------|--------------|
| `POST` | `/api/v1/agentic/check` | Agentic authorization check | `CheckRequest + options` |
| `POST` | `/api/v1/agentic/analyze` | Analyze request patterns | `CheckRequest` |
| `POST` | `/api/v1/agentic/recommend` | Get policy recommendations | `{ principalId?, resourceKind? }` |
| `GET` | `/api/v1/agentic/health` | Agentic system health | - |
| `POST` | `/api/v1/agentic/batch` | Batch agentic check | `BatchCheckRequest` |

##### Metrics & Monitoring

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/metrics` | Prometheus metrics |
| `GET` | `/v1/agents/metrics` | Agent-specific metrics |

#### 3.1.3 Request/Response Types

```typescript
// POST /api/check
interface CheckRequestBody {
  requestId?: string;
  principal: Principal;
  resource: Resource;
  actions: string[];
  auxData?: Record<string, unknown>;
}

// Standard response
interface CheckResponseBody {
  requestId: string;
  results: Record<string, {
    effect: 'EFFECT_ALLOW' | 'EFFECT_DENY';
    policy: string;
    meta?: object;
  }>;
  meta?: {
    evaluationDurationMs: number;
    policiesEvaluated: string[];
  };
}

// POST /v1/check/agentic
interface AgenticCheckRequestBody extends CheckRequestBody {
  options?: {
    includeExplanation?: boolean;
    includeAnomalyScore?: boolean;
    pipelineId?: string;           // Use specific pipeline
  };
}

// Agentic response
interface AgenticCheckResponseBody extends CheckResponseBody {
  anomalyScore?: number;
  anomaly?: Anomaly;
  explanation?: DecisionExplanation;
  enforcement?: {
    allowed: boolean;
    reason?: string;
    action?: EnforcerAction;
  };
  agentsInvolved: string[];
  processingTimeMs: number;
}
```

#### 3.1.4 Class: `RestServer`

```typescript
class RestServer {
  constructor(config: RestServerConfig);

  // Lifecycle
  async start(): Promise<void>;
  async stop(): Promise<void>;

  // Accessors
  get app(): FastifyInstance;
  get decisionEngine(): DecisionEngine;
  get orchestrator(): AgentOrchestrator | undefined;
  get policyLoader(): PolicyLoader;

  // Internal properties
  private app: FastifyInstance;
  private decisionEngine: DecisionEngine;
  private orchestrator?: AgentOrchestrator;
  private policyLoader: PolicyLoader;
  private config: Required<RestServerConfig>;
}
```

### 3.2 gRPC Server (`grpc/server.ts`)

#### 3.2.1 Protobuf Definition (Cerbos-compatible)

```protobuf
syntax = "proto3";
package cerbos.svc.v1;

service CerbosService {
  // Core authorization
  rpc CheckResourceSet(CheckResourceSetRequest)
    returns (CheckResourceSetResponse);
  rpc CheckResourceBatch(CheckResourceBatchRequest)
    returns (CheckResourceBatchResponse);
  rpc PlanResources(PlanResourcesRequest)
    returns (PlanResourcesResponse);
  rpc ServerInfo(ServerInfoRequest)
    returns (ServerInfoResponse);
}

// Agentic extensions
service AgenticService {
  rpc CheckWithAgents(AgenticCheckRequest)
    returns (AgenticCheckResponse);
  rpc ExplainDecision(ExplainRequest)
    returns (ExplainResponse);
  rpc GetAnomalies(AnomalyRequest)
    returns (AnomalyResponse);
  rpc GetPatterns(PatternRequest)
    returns (PatternResponse);
  rpc StreamDecisions(StreamRequest)
    returns (stream DecisionEvent);
}
```

#### 3.2.2 Server Configuration

```typescript
interface GrpcServerConfig {
  port: number;                      // Default: 3593
  host: string;
  policyDir: string;
  enableTls?: boolean;
  tlsKey?: string;
  tlsCert?: string;
  tlsCa?: string;                    // For mTLS
  enableAgents?: boolean;
  agentsConfig?: OrchestratorConfig;
}
```

### 3.3 WebSocket Server (`websocket/server.ts`)

#### 3.3.1 Purpose

Real-time streaming for:
- Live decision notifications
- Policy update events
- Anomaly alerts
- Agent status updates

#### 3.3.2 Configuration

```typescript
interface WebSocketServerConfig {
  port: number;                      // Default: 3594
  path: string;                      // Default: '/ws'
  heartbeatInterval?: number;        // Default: 30000ms
  maxConnections?: number;           // Default: 1000
}
```

#### 3.3.3 Message Types

```typescript
type WebSocketMessageType =
  | 'decision'           // Authorization decision made
  | 'anomaly'            // Anomaly detected
  | 'pattern'            // Pattern discovered
  | 'policy_update'      // Policy changed
  | 'agent_status'       // Agent state change
  | 'enforcement'        // Enforcement action
  | 'heartbeat';         // Keep-alive

interface WebSocketMessage {
  type: WebSocketMessageType;
  timestamp: Date;
  data: unknown;
  requestId?: string;
}
```

### 3.4 Policy Loader (`policy/loader.ts`)

#### 3.4.1 Purpose

Loads and watches policy files from the filesystem.

#### 3.4.2 Configuration

```typescript
interface PolicyLoaderConfig {
  policyDir: string;
  watch?: boolean;                   // Watch for changes
  watchDebounceMs?: number;          // Default: 1000
  filePatterns?: string[];           // Default: ['*.yaml', '*.yml', '*.json']
  recursive?: boolean;               // Default: true
}
```

#### 3.4.3 Key Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `load` | `() => Promise<PolicyLoadResult>` | Load all policies |
| `watch` | `(callback: (policies) => void) => () => void` | Watch for changes |
| `reload` | `() => Promise<PolicyLoadResult>` | Force reload |
| `stop` | `() => void` | Stop watching |
| `getStats` | `() => PolicyStats` | Get loaded policy stats |

#### 3.4.4 Load Result

```typescript
interface PolicyLoadResult {
  resourcePolicies: ValidatedResourcePolicy[];
  derivedRolesPolicies: ValidatedDerivedRolesPolicy[];
  principalPolicies: ValidatedPrincipalPolicy[];
  errors: PolicyLoadError[];
  loadedAt: Date;
  duration: number;
}

interface PolicyLoadError {
  file: string;
  error: string;
  line?: number;
  column?: number;
}
```

### 3.5 Logger (`utils/logger.ts`)

#### 3.5.1 Purpose

Structured logging with Pino.

#### 3.5.2 Configuration

```typescript
interface LoggerConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  pretty?: boolean;                  // Pretty print in development
  destination?: string;              // File path or 'stdout'
  redact?: string[];                 // Fields to redact
}
```

#### 3.5.3 Usage

```typescript
const logger = createLogger({ level: 'info' });

logger.info({ requestId }, 'Processing check request');
logger.error({ err, requestId }, 'Check failed');
logger.debug({ principal, resource }, 'Request details');
```

---

## 4. Interfaces

### 4.1 Public API

```typescript
// From index.ts
export {
  // REST Server
  RestServer,
  RestServerConfig,
  createRestServer,

  // gRPC Server
  GrpcServer,
  GrpcServerConfig,
  createGrpcServer,

  // WebSocket Server
  WebSocketServer,
  WebSocketServerConfig,
  createWebSocketServer,

  // Policy Loader
  PolicyLoader,
  PolicyLoaderConfig,
  PolicyLoadResult,

  // Logger
  createLogger,
  Logger,
};
```

### 4.2 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | REST server port | 3592 |
| `GRPC_PORT` | gRPC server port | 3593 |
| `WS_PORT` | WebSocket port | 3594 |
| `HOST` | Bind address | 0.0.0.0 |
| `POLICY_DIR` | Policy files directory | `./policies` |
| `LOG_LEVEL` | Logging level | `info` |
| `ENABLE_AGENTS` | Enable agentic features | `false` |
| `ENABLE_METRICS` | Enable Prometheus metrics | `true` |
| `CORS_ORIGINS` | Allowed CORS origins | `*` |
| `PG_HOST` | PostgreSQL host | - |
| `PG_PORT` | PostgreSQL port | 5432 |
| `PG_USER` | PostgreSQL user | - |
| `PG_PASSWORD` | PostgreSQL password | - |
| `PG_DATABASE` | PostgreSQL database | authz |
| `REDIS_HOST` | Redis host | - |
| `REDIS_PORT` | Redis port | 6379 |
| `OPENAI_API_KEY` | OpenAI key for ADVISOR | - |

---

## 5. API Compatibility

### 5.1 Cerbos API Compatibility

The server maintains wire-level compatibility with Cerbos for core endpoints:

| Cerbos Endpoint | AuthZ Engine Endpoint | Status |
|-----------------|----------------------|--------|
| `POST /api/check` | `POST /api/check` | ✅ Compatible |
| `POST /api/check/resources` | `POST /api/check/batch` | ✅ Compatible |
| `POST /api/plan/resources` | `POST /api/plan/resources` | ✅ Implemented |
| `GET /api/server_info` | `GET /health` | ✅ Adapted |
| gRPC `CheckResources` | gRPC `CheckResourceSet` | ✅ Compatible |
| gRPC `PlanResources` | gRPC `PlanResources` | ✅ Compatible |

### 5.2 Wire Format Mapping

```typescript
// Internal Effect → Wire Effect (Cerbos format)
'allow' → 'EFFECT_ALLOW'
'deny'  → 'EFFECT_DENY'

// Wire Effect → Internal Effect
'EFFECT_ALLOW' → 'allow'
'EFFECT_DENY'  → 'deny'
```

---

## 6. Error Handling

### 6.1 HTTP Error Responses

| Status | Meaning | Response Body |
|--------|---------|---------------|
| 400 | Bad Request | `{ error: string, details?: object }` |
| 401 | Unauthorized | `{ error: 'Unauthorized' }` |
| 403 | Forbidden | `{ error: 'Forbidden', reason: string }` |
| 404 | Not Found | `{ error: 'Not found' }` |
| 429 | Too Many Requests | `{ error: 'Rate limited', retryAfter: number }` |
| 500 | Internal Error | `{ error: 'Internal error', requestId }` |
| 503 | Service Unavailable | `{ error: 'Service unavailable' }` |

### 6.2 gRPC Error Codes

| Code | Meaning |
|------|---------|
| INVALID_ARGUMENT | Bad request format |
| NOT_FOUND | Policy/resource not found |
| PERMISSION_DENIED | Authorization failed |
| RESOURCE_EXHAUSTED | Rate limited |
| INTERNAL | Server error |
| UNAVAILABLE | Service starting/stopping |

---

## 7. Security Considerations

1. **Input Validation**: All requests validated via Zod/Protobuf
2. **CORS**: Configurable allowed origins
3. **Rate Limiting**: Via ENFORCER agent + configurable limits
4. **mTLS**: Optional for gRPC
5. **No Secrets in Logs**: Sensitive data redacted
6. **Health Endpoints**: Unauthenticated (for k8s probes)
7. **Request IDs**: All requests traced for audit

---

## 8. Performance

### 8.1 Targets

| Metric | Target | Notes |
|--------|--------|-------|
| REST latency (p99) | < 10ms | Without agents |
| REST latency (p99) | < 50ms | With agents |
| gRPC latency (p99) | < 5ms | Without agents |
| Throughput | > 5,000 req/s | Single instance |
| Startup time | < 2s | Cold start |
| WebSocket connections | > 1,000 | Per instance |

### 8.2 Optimization Strategies

1. **Policy Caching**: Policies loaded once, cached in memory
2. **Connection Pooling**: PostgreSQL pool
3. **Async Processing**: Agent processing after response (configurable)
4. **Compression**: gzip for REST responses
5. **HTTP/2**: For gRPC streaming
6. **Keep-Alive**: Connection reuse

---

## 9. Health Checks

### 9.1 Endpoints

```
GET /health        - Full health with details
GET /ready         - Readiness (can handle requests?)
GET /metrics       - Prometheus metrics
```

### 9.2 Health Response

```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 3600,
  "timestamp": "2024-11-24T10:00:00Z",
  "policies": {
    "loaded": 15,
    "resourcePolicies": 10,
    "derivedRolesPolicies": 3,
    "principalPolicies": 2,
    "errors": 0,
    "lastReload": "2024-11-24T09:00:00Z"
  },
  "agents": {
    "enabled": true,
    "status": "healthy",
    "guardian": { "state": "ready", "anomaliesDetected": 5 },
    "analyst": { "state": "ready", "patternsDiscovered": 12 },
    "advisor": { "state": "ready", "questionsAnswered": 45 },
    "enforcer": { "state": "ready", "actionsExecuted": 3 }
  },
  "circuitBreakers": {
    "guardian": "closed",
    "analyst": "closed",
    "advisor": "closed",
    "enforcer": "closed"
  }
}
```

---

## 10. Testing Strategy

### 10.1 Unit Tests

- Request validation
- Response formatting
- Policy loader
- Error handling
- Logger configuration

### 10.2 Integration Tests

- Full REST endpoint tests
- gRPC service tests
- Policy loading and evaluation
- Agent integration
- Health checks
- WebSocket connections

### 10.3 Load Tests

- k6 scripts for throughput testing
- Latency percentile validation
- Concurrent connection tests

---

## 11. Dependencies

### 11.1 Runtime Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `@authz-engine/core` | workspace:* | Core engine |
| `@authz-engine/agents` | workspace:* | Agentic features |
| `fastify` | ^4.24.0 | REST server |
| `@fastify/cors` | ^8.4.0 | CORS support |
| `@fastify/rate-limit` | ^8.0.0 | Rate limiting |
| `@grpc/grpc-js` | ^1.9.0 | gRPC server |
| `@grpc/proto-loader` | ^0.7.0 | Protobuf loading |
| `ws` | ^8.14.0 | WebSocket server |
| `pino` | ^8.16.0 | Logging |
| `yaml` | ^2.3.0 | YAML parsing |
| `chokidar` | ^3.5.0 | File watching |

### 11.2 Development Dependencies

| Dependency | Purpose |
|------------|---------|
| `typescript` | Type checking |
| `vitest` | Testing |
| `supertest` | HTTP testing |
| `k6` | Load testing |

---

## 12. Deployment

### 12.1 Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY packages/server/dist ./
COPY policies ./policies
ENV NODE_ENV=production
ENV PORT=3592
ENV GRPC_PORT=3593
EXPOSE 3592 3593 3594
CMD ["node", "index.js"]
```

### 12.2 Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: authz-engine
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: authz-engine
          image: authz-engine:latest
          ports:
            - containerPort: 3592
              name: http
            - containerPort: 3593
              name: grpc
            - containerPort: 3594
              name: websocket
          env:
            - name: ENABLE_AGENTS
              value: "true"
          livenessProbe:
            httpGet:
              path: /health
              port: 3592
            initialDelaySeconds: 10
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /ready
              port: 3592
            initialDelaySeconds: 5
            periodSeconds: 5
          resources:
            limits:
              memory: "512Mi"
              cpu: "500m"
            requests:
              memory: "256Mi"
              cpu: "250m"
```

---

## 13. Related Documents

- [ADR-006: Cerbos API Compatibility](../adr/ADR-006-CERBOS-API-COMPATIBILITY.md)
- [CORE-PACKAGE-SDD.md](./CORE-PACKAGE-SDD.md)
- [AGENTS-PACKAGE-SDD.md](./AGENTS-PACKAGE-SDD.md)

---

## 14. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 2.0.0 | 2024-11-24 | Full documentation of all 30+ endpoints, WebSocket, middleware |
| 1.0.0 | 2024-11-23 | Initial release with REST server |
