# Software Design Document: @authz-engine/server

**Version**: 1.0.0
**Package**: `packages/server`
**Status**: Partially Documented (58% coverage)
**Last Updated**: 2024-11-24

> **⚠️ Documentation Accuracy Notice**
>
> This SDD has discrepancies with the actual implementation:
>
> | Issue | SDD Says | Actual Implementation |
> |-------|----------|----------------------|
> | **Endpoint Paths** | `/api/*` | `/v1/agents/*` and `/api/v1/agentic/*` |
> | **WebSocket Server** | Not documented | ✅ Implemented for real-time streaming |
> | **Production Middleware** | Not documented | ✅ CORS, rate limiting, auth implemented |
> | **gRPC Server** | "Planned" | ✅ Implemented in `grpc/server.ts` |
>
> See the actual source code for accurate endpoint paths and middleware configuration.

---

## 1. Overview

### 1.1 Purpose

The `@authz-engine/server` package provides HTTP REST and gRPC server implementations for the AuthZ authorization engine. It exposes the core decision engine and agents via network APIs.

### 1.2 Scope

This package includes:
- REST API server (Fastify)
- gRPC server (planned)
- Policy loader from filesystem
- Health checks and metrics
- Integration with agentic features

### 1.3 Package Structure

```
packages/server/
├── src/
│   ├── index.ts              # Package exports
│   ├── rest/
│   │   └── server.ts         # Fastify REST server
│   ├── grpc/
│   │   └── server.ts         # gRPC server (planned)
│   ├── policy/
│   │   └── loader.ts         # Policy file loader
│   └── utils/
│       └── logger.ts         # Logging utilities
├── tests/
└── package.json
```

---

## 2. Architecture

### 2.1 Component Diagram

```
┌────────────────────────────────────────────────────────────────┐
│                     @authz-engine/server                        │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   ┌─────────────┐          ┌─────────────────┐                │
│   │ REST Server │          │   gRPC Server   │                │
│   │  (Fastify)  │          │  (@grpc/grpc-js)│                │
│   └──────┬──────┘          └────────┬────────┘                │
│          │                          │                          │
│          └────────────┬─────────────┘                          │
│                       │                                        │
│                       ▼                                        │
│            ┌─────────────────────┐                             │
│            │   Policy Loader     │                             │
│            │                     │                             │
│            │ - Load from files   │                             │
│            │ - Watch for changes │                             │
│            │ - Validate schemas  │                             │
│            └──────────┬──────────┘                             │
│                       │                                        │
│          ┌────────────┼────────────┐                           │
│          ▼            ▼            ▼                           │
│    ┌──────────┐ ┌──────────┐ ┌──────────────┐                 │
│    │  @authz  │ │  @authz  │ │    Logger    │                 │
│    │  /core   │ │  /agents │ │   (Pino)     │                 │
│    └──────────┘ └──────────┘ └──────────────┘                 │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 2.2 Request Flow

```
Client Request
      │
      ▼
┌─────────────────┐
│   REST/gRPC     │
│   Endpoint      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Validation    │
│   (Zod/Proto)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  DecisionEngine │
│     .check()    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ AgentOrchestrator│ (Optional)
│ .processRequest()│
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
  port: number;                    // Default: 3592
  host: string;                    // Default: '0.0.0.0'
  policyDir: string;              // Path to policy files
  enableAgents?: boolean;         // Enable agentic features
  agentsConfig?: OrchestratorConfig;
  corsOrigins?: string[];
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}
```

#### 3.1.2 Endpoints

| Method | Path | Description | Request Body |
|--------|------|-------------|--------------|
| `POST` | `/api/check` | Single resource check | `CheckRequest` |
| `POST` | `/api/check/resources` | Batch check | `BatchCheckRequest` |
| `POST` | `/api/explain` | Explain decision | `ExplainDecisionRequestBody` |
| `GET` | `/api/anomalies` | List anomalies | Query params |
| `GET` | `/api/anomalies/:id` | Get anomaly | - |
| `POST` | `/api/anomalies/:id/resolve` | Resolve anomaly | `{ resolution, notes? }` |
| `GET` | `/api/patterns` | List patterns | - |
| `POST` | `/api/patterns/:id/validate` | Validate pattern | `{ isApproved, validatedBy }` |
| `GET` | `/api/enforcement/pending` | Pending actions | - |
| `POST` | `/api/enforcement/:id/approve` | Approve action | `{ approvedBy }` |
| `POST` | `/api/enforcement/:id/reject` | Reject action | `{ rejectedBy, reason? }` |
| `POST` | `/api/policy/question` | Ask policy question | `{ question }` |
| `POST` | `/api/policy/debug` | Debug policy | `{ issue, policyYaml }` |
| `GET` | `/health` | Health check | - |
| `GET` | `/health/live` | Liveness probe | - |
| `GET` | `/health/ready` | Readiness probe | - |

#### 3.1.3 Request/Response Types

```typescript
// POST /api/check
interface CheckRequestBody {
  requestId?: string;
  principal: Principal;
  resource: Resource;
  actions: string[];
  auxData?: Record<string, unknown>;
  includeExplanation?: boolean;
}

// Response
interface CheckResponseBody {
  requestId: string;
  results: Record<string, {
    effect: 'EFFECT_ALLOW' | 'EFFECT_DENY';
    policy: string;
    meta?: object;
  }>;
  meta?: object;
  // If includeExplanation: true
  explanation?: DecisionExplanation;
  anomalyScore?: number;
  anomaly?: Anomaly;
}

// POST /api/explain
interface ExplainDecisionRequestBody {
  decision: {
    request: CheckRequest;
    response: CheckResponse;
    policyContext?: {
      matchedRules: string[];
      derivedRoles: string[];
    };
  };
}
```

#### 3.1.4 Class: `RestServer`

```typescript
class RestServer {
  constructor(config: RestServerConfig);

  async start(): Promise<void>;
  async stop(): Promise<void>;

  // Internal
  private app: FastifyInstance;
  private decisionEngine: DecisionEngine;
  private orchestrator?: AgentOrchestrator;
  private policyLoader: PolicyLoader;
}
```

### 3.2 gRPC Server (`grpc/server.ts`)

#### 3.2.1 Protobuf Definition (Cerbos-compatible)

```protobuf
syntax = "proto3";
package cerbos.svc.v1;

service CerbosService {
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
  rpc ExplainDecision(ExplainRequest) returns (ExplainResponse);
  rpc GetAnomalies(AnomalyRequest) returns (AnomalyResponse);
  rpc GetPatterns(PatternRequest) returns (PatternResponse);
}
```

#### 3.2.2 Server Configuration

```typescript
interface GrpcServerConfig {
  port: number;                    // Default: 3593
  host: string;
  policyDir: string;
  enableTls?: boolean;
  tlsKey?: string;
  tlsCert?: string;
  enableAgents?: boolean;
}
```

### 3.3 Policy Loader (`policy/loader.ts`)

#### 3.3.1 Purpose

Loads and watches policy files from the filesystem.

#### 3.3.2 Configuration

```typescript
interface PolicyLoaderConfig {
  policyDir: string;
  watch?: boolean;              // Watch for changes
  watchDebounceMs?: number;     // Default: 1000
  filePatterns?: string[];      // Default: ['*.yaml', '*.yml', '*.json']
}
```

#### 3.3.3 Key Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `load` | `() => Promise<PolicyLoadResult>` | Load all policies |
| `watch` | `(callback: (policies) => void) => () => void` | Watch for changes |
| `reload` | `() => Promise<PolicyLoadResult>` | Force reload |
| `stop` | `() => void` | Stop watching |

#### 3.3.4 Load Result

```typescript
interface PolicyLoadResult {
  resourcePolicies: ValidatedResourcePolicy[];
  derivedRolesPolicies: ValidatedDerivedRolesPolicy[];
  principalPolicies: ValidatedPrincipalPolicy[];
  errors: PolicyLoadError[];
}

interface PolicyLoadError {
  file: string;
  error: string;
  line?: number;
}
```

### 3.4 Logger (`utils/logger.ts`)

#### 3.4.1 Purpose

Structured logging with Pino.

#### 3.4.2 Configuration

```typescript
interface LoggerConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  pretty?: boolean;          // Pretty print in development
  destination?: string;      // File path or 'stdout'
}
```

#### 3.4.3 Usage

```typescript
const logger = createLogger({ level: 'info' });

logger.info({ requestId }, 'Processing check request');
logger.error({ err, requestId }, 'Check failed');
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
| `POLICY_DIR` | Policy files directory | `./policies` |
| `LOG_LEVEL` | Logging level | `info` |
| `ENABLE_AGENTS` | Enable agentic features | `false` |
| `PG_HOST` | PostgreSQL host | - |
| `PG_PORT` | PostgreSQL port | 5432 |
| `PG_USER` | PostgreSQL user | - |
| `PG_PASSWORD` | PostgreSQL password | - |
| `REDIS_HOST` | Redis host | - |
| `REDIS_PORT` | Redis port | 6379 |
| `OPENAI_API_KEY` | OpenAI key for ADVISOR | - |

---

## 5. API Compatibility

### 5.1 Cerbos API Compatibility

The server maintains wire-level compatibility with Cerbos for core endpoints:

| Cerbos Endpoint | AuthZ Engine Endpoint | Status |
|-----------------|----------------------|--------|
| `POST /api/check` | `POST /api/check` | Compatible |
| `POST /api/check/resources` | `POST /api/check/resources` | Compatible |
| `POST /api/plan/resources` | `POST /api/plan/resources` | Planned |
| `GET /api/server_info` | `GET /health` | Adapted |

### 5.2 Wire Format Mapping

```typescript
// Internal Effect → Wire Effect
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
| 404 | Not Found | `{ error: 'Not found' }` |
| 500 | Internal Error | `{ error: 'Internal error', requestId }` |
| 503 | Service Unavailable | `{ error: 'Service unavailable' }` |

### 6.2 gRPC Error Codes

| Code | Meaning |
|------|---------|
| INVALID_ARGUMENT | Bad request format |
| NOT_FOUND | Policy/resource not found |
| INTERNAL | Server error |
| UNAVAILABLE | Service starting/stopping |

---

## 7. Security Considerations

1. **Input Validation**: All requests validated via Zod/Protobuf
2. **CORS**: Configurable allowed origins
3. **Rate Limiting**: Via ENFORCER agent
4. **mTLS**: Optional for gRPC
5. **No Secrets in Logs**: Sensitive data redacted
6. **Health Endpoints**: Unauthenticated (for k8s probes)

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

### 8.2 Optimization Strategies

1. **Policy Caching**: Policies loaded once, cached in memory
2. **Connection Pooling**: PostgreSQL pool
3. **Async Processing**: Agent processing after response
4. **Compression**: gzip for REST responses
5. **HTTP/2**: For gRPC streaming

---

## 9. Health Checks

### 9.1 Endpoints

```
GET /health        - Full health with details
GET /health/live   - Liveness (is server running?)
GET /health/ready  - Readiness (can handle requests?)
```

### 9.2 Health Response

```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 3600,
  "policies": {
    "loaded": 15,
    "errors": 0
  },
  "agents": {
    "status": "healthy",
    "guardian": "ready",
    "analyst": "ready",
    "advisor": "ready",
    "enforcer": "ready"
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

### 10.2 Integration Tests

- Full REST endpoint tests
- Policy loading and evaluation
- Agent integration
- Health checks

### 10.3 Load Tests

- k6 scripts for throughput testing
- Latency percentile validation

---

## 11. Dependencies

### 11.1 Runtime Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `@authz-engine/core` | workspace:* | Core engine |
| `@authz-engine/agents` | workspace:* | Agentic features |
| `fastify` | ^4.24.0 | REST server |
| `@fastify/cors` | ^8.4.0 | CORS support |
| `@grpc/grpc-js` | ^1.9.0 | gRPC server |
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
EXPOSE 3592 3593
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
            - containerPort: 3593
          livenessProbe:
            httpGet:
              path: /health/live
              port: 3592
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 3592
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
| 1.0.0 | 2024-11-23 | Initial release with REST server |
