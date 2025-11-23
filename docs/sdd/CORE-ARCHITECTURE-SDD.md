# Aegis Authorization Engine - Core Architecture SDD

**Module**: `@authz-engine/core`
**Version**: 0.1.0
**Last Updated**: 2024-11-23
**Author**: Aegis Authorization Engine Team

---

## 1. Executive Summary

### 1.1 Purpose
Aegis is a Cerbos-compatible enterprise authorization engine built in TypeScript with **ZERO Cerbos library dependencies**. It provides policy-based access control with CEL expression evaluation, designed for high-performance authorization decisions.

### 1.2 Key Design Goals
- **Cerbos Compatibility**: Support Cerbos policy format and API structure
- **Zero Dependencies**: No runtime dependency on Cerbos libraries
- **Type Safety**: Full TypeScript strict mode compliance
- **Performance**: Sub-5ms p99 latency for authorization checks
- **Security**: Fail-closed design, audit trails, sandboxed expressions

---

## 2. System Architecture

### 2.1 High-Level Architecture
```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Aegis Authorization Engine                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │   REST API   │  │   gRPC API   │  │   NestJS     │  │  TypeScript │ │
│  │   Gateway    │  │   Server     │  │   Module     │  │     SDK     │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘ │
│         │                 │                 │                 │         │
│         └─────────────────┼─────────────────┼─────────────────┘         │
│                           │                 │                           │
│                    ┌──────▼─────────────────▼──────┐                   │
│                    │        Decision Engine        │                   │
│                    │   (Policy Evaluation Core)    │                   │
│                    └──────────────┬────────────────┘                   │
│                                   │                                     │
│         ┌─────────────────────────┼─────────────────────────┐          │
│         │                         │                         │          │
│  ┌──────▼───────┐  ┌──────────────▼──────────────┐  ┌──────▼───────┐  │
│  │    Policy    │  │       CEL Evaluator         │  │    Audit     │  │
│  │   Compiler   │  │   (Expression Engine)       │  │    Logger    │  │
│  └──────┬───────┘  └─────────────────────────────┘  └──────────────┘  │
│         │                                                              │
│  ┌──────▼───────┐  ┌─────────────────────────────┐                    │
│  │    Schema    │  │       Storage Layer         │                    │
│  │  Validator   │  │   (PostgreSQL + Redis)      │                    │
│  └──────────────┘  └─────────────────────────────┘                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Package Structure
```
authz-engine/
├── packages/
│   ├── core/                 # Policy engine core
│   │   ├── src/
│   │   │   ├── cel/          # CEL expression evaluation
│   │   │   ├── engine/       # Decision engine
│   │   │   ├── policy/       # Policy parsing & validation
│   │   │   └── types/        # TypeScript types
│   │   └── tests/
│   │
│   ├── server/               # gRPC + REST server
│   │   ├── src/
│   │   │   ├── grpc/         # gRPC service impl
│   │   │   ├── rest/         # REST gateway
│   │   │   └── middleware/   # Auth, logging, metrics
│   │   └── tests/
│   │
│   ├── sdk-typescript/       # TypeScript SDK
│   │   ├── src/
│   │   │   ├── client/       # HTTP/gRPC client
│   │   │   └── types/        # Request/Response types
│   │   └── tests/
│   │
│   ├── nestjs/               # NestJS integration
│   │   ├── src/
│   │   │   ├── decorators/   # @Authorize() decorator
│   │   │   ├── guards/       # AuthzGuard
│   │   │   └── module/       # AuthzModule
│   │   └── tests/
│   │
│   └── agents/               # Agentic features (future)
│
├── docs/
│   ├── sdd/                  # System Design Documents
│   ├── architecture/         # Architecture diagrams
│   └── api/                  # API documentation
│
└── policies/                 # Example policies
```

---

## 3. Core Components

### 3.1 Component Overview

| Component | Module | Purpose | Status |
|-----------|--------|---------|--------|
| CEL Evaluator | `core/cel` | Expression evaluation | ✅ Complete |
| Policy Parser | `core/policy` | YAML/JSON policy parsing | 🔄 In Progress |
| Schema Validator | `core/policy` | Cerbos schema validation | 🔄 In Progress |
| Decision Engine | `core/engine` | Authorization decisions | 📋 Planned |
| Audit Logger | `core/audit` | Decision audit trail | 📋 Planned |
| REST API | `server/rest` | HTTP API gateway | 📋 Planned |
| gRPC API | `server/grpc` | gRPC service | 📋 Planned |
| TypeScript SDK | `sdk-typescript` | Client library | 📋 Planned |
| NestJS Module | `nestjs` | NestJS integration | 📋 Planned |

### 3.2 Component Dependencies
```
                    ┌─────────────┐
                    │   NestJS    │
                    │   Module    │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  TypeScript │
                    │     SDK     │
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
   ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐
   │  REST API   │  │  gRPC API   │  │   Direct    │
   │             │  │             │  │   Import    │
   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
          │                │                │
          └────────────────┼────────────────┘
                           │
                    ┌──────▼──────┐
                    │    Core     │
                    │   Engine    │
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
   ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐
   │    CEL      │  │   Policy    │  │   Audit     │
   │  Evaluator  │  │  Compiler   │  │   Logger    │
   └─────────────┘  └─────────────┘  └─────────────┘
```

---

## 4. Type System

### 4.1 Core Types

#### Principal (User/Service)
```typescript
interface Principal {
  /** Unique identifier */
  id: string;
  /** Assigned roles */
  roles: string[];
  /** Custom attributes */
  attributes: Record<string, unknown>;
}
```

#### Resource
```typescript
interface Resource {
  /** Resource type (e.g., 'avatar', 'subscription') */
  kind: string;
  /** Unique identifier */
  id: string;
  /** Custom attributes */
  attributes: Record<string, unknown>;
}
```

#### Check Request
```typescript
interface CheckRequest {
  /** Request ID for tracing */
  requestId: string;
  /** Principal making the request */
  principal: Principal;
  /** Resource being accessed */
  resource: Resource;
  /** Actions to check (e.g., ['read', 'write']) */
  actions: string[];
  /** Auxiliary data (JWT claims, etc.) */
  auxData?: Record<string, unknown>;
}
```

#### Check Response
```typescript
interface CheckResponse {
  /** Request ID for correlation */
  requestId: string;
  /** Resource identifier */
  resourceId: string;
  /** Results per action */
  actions: Record<string, ActionResult>;
  /** Effective derived roles */
  effectiveDerivedRoles: string[];
  /** Metadata about the evaluation */
  meta: {
    evaluationDurationMs: number;
    policiesEvaluated: string[];
  };
}
```

#### Action Result
```typescript
interface ActionResult {
  /** ALLOW or DENY */
  effect: Effect;
  /** Policy that made the decision */
  policy: string;
  /** Specific rule within policy */
  rule?: string;
}

type Effect = 'EFFECT_ALLOW' | 'EFFECT_DENY';
```

### 4.2 Policy Types

#### Resource Policy
```typescript
interface ResourcePolicy {
  apiVersion: 'api.cerbos.dev/v1';
  kind: 'ResourcePolicy';
  metadata: {
    name: string;
    version?: string;
  };
  spec: {
    resource: string;
    version: string;
    importDerivedRoles?: string[];
    rules: PolicyRule[];
  };
}
```

#### Derived Roles Policy
```typescript
interface DerivedRolesPolicy {
  apiVersion: 'api.cerbos.dev/v1';
  kind: 'DerivedRoles';
  metadata: {
    name: string;
  };
  spec: {
    name: string;
    definitions: DerivedRoleDefinition[];
  };
}
```

#### Principal Policy
```typescript
interface PrincipalPolicy {
  apiVersion: 'api.cerbos.dev/v1';
  kind: 'PrincipalPolicy';
  metadata: {
    name: string;
  };
  spec: {
    principal: string;
    version: string;
    rules: PrincipalRule[];
  };
}
```

---

## 5. Decision Flow

### 5.1 Authorization Check Flow
```
┌─────────────┐
│   Client    │
│  Request    │
└──────┬──────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│                  Decision Engine                      │
├──────────────────────────────────────────────────────┤
│                                                       │
│  1. Validate Request                                  │
│     └─▶ Schema validation                            │
│                                                       │
│  2. Compute Derived Roles                            │
│     └─▶ Evaluate DerivedRoles policies              │
│     └─▶ CEL condition evaluation                     │
│                                                       │
│  3. Find Applicable Policies                         │
│     └─▶ Match resource kind                          │
│     └─▶ Filter by roles (base + derived)            │
│                                                       │
│  4. Evaluate Policies (Deny Overrides)              │
│     └─▶ For each action:                             │
│         ├─▶ Check explicit DENY rules first         │
│         ├─▶ Check ALLOW rules                        │
│         └─▶ Default: DENY (fail-closed)             │
│                                                       │
│  5. Build Response                                   │
│     └─▶ Effect per action                            │
│     └─▶ Matched policy/rule                          │
│     └─▶ Audit metadata                               │
│                                                       │
└──────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────┐
│   Response   │
│  (per action)│
└──────────────┘
```

### 5.2 Deny-Overrides Algorithm
```typescript
function evaluateAction(action: string, rules: Rule[]): Effect {
  // Phase 1: Check for explicit DENY
  for (const rule of rules) {
    if (rule.actions.includes(action) || rule.actions.includes('*')) {
      if (rule.effect === 'DENY') {
        if (!rule.condition || evaluateCondition(rule.condition)) {
          return 'EFFECT_DENY';  // Explicit deny wins
        }
      }
    }
  }

  // Phase 2: Check for ALLOW
  for (const rule of rules) {
    if (rule.actions.includes(action) || rule.actions.includes('*')) {
      if (rule.effect === 'ALLOW') {
        if (!rule.condition || evaluateCondition(rule.condition)) {
          return 'EFFECT_ALLOW';
        }
      }
    }
  }

  // Phase 3: Default deny (fail-closed)
  return 'EFFECT_DENY';
}
```

---

## 6. Policy Format

### 6.1 Resource Policy Example
```yaml
apiVersion: api.cerbos.dev/v1
kind: ResourcePolicy
metadata:
  name: avatar-policy
spec:
  resource: avatar
  version: "1.0"
  importDerivedRoles:
    - common-roles
  rules:
    # Anyone can view public avatars
    - actions: ["view"]
      effect: ALLOW
      roles: ["*"]
      condition:
        match:
          expr: resource.visibility == "public"

    # Owners can do anything
    - actions: ["*"]
      effect: ALLOW
      derivedRoles: ["owner"]

    # Admins can moderate
    - actions: ["delete", "suspend"]
      effect: ALLOW
      roles: ["admin"]
```

### 6.2 Derived Roles Example
```yaml
apiVersion: api.cerbos.dev/v1
kind: DerivedRoles
metadata:
  name: common-roles
spec:
  name: common-roles
  definitions:
    - name: owner
      parentRoles: ["user"]
      condition:
        match:
          expr: resource.ownerId == principal.id

    - name: team_member
      parentRoles: ["user"]
      condition:
        match:
          expr: principal.teamId in resource.teamIds
```

---

## 7. API Contracts

### 7.1 REST API (Planned)

#### Check Endpoint
```
POST /v1/check
Content-Type: application/json

Request:
{
  "requestId": "req-123",
  "principal": {
    "id": "user-456",
    "roles": ["user"],
    "attributes": {
      "department": "engineering"
    }
  },
  "resource": {
    "kind": "avatar",
    "id": "avatar-789",
    "attributes": {
      "ownerId": "user-456",
      "visibility": "public"
    }
  },
  "actions": ["view", "edit", "delete"]
}

Response:
{
  "requestId": "req-123",
  "resourceId": "avatar-789",
  "actions": {
    "view": { "effect": "EFFECT_ALLOW", "policy": "avatar-policy" },
    "edit": { "effect": "EFFECT_ALLOW", "policy": "avatar-policy", "rule": "owner" },
    "delete": { "effect": "EFFECT_DENY", "policy": "default-deny" }
  },
  "effectiveDerivedRoles": ["owner"],
  "meta": {
    "evaluationDurationMs": 2.5,
    "policiesEvaluated": ["avatar-policy", "common-roles"]
  }
}
```

### 7.2 gRPC API (Planned)
```protobuf
service CerbosService {
  rpc Check(CheckRequest) returns (CheckResponse);
  rpc CheckResources(CheckResourcesRequest) returns (CheckResourcesResponse);
  rpc PlanResources(PlanResourcesRequest) returns (PlanResourcesResponse);
}
```

---

## 8. Configuration

### 8.1 Server Configuration
```typescript
interface ServerConfig {
  // Server settings
  port: number;
  grpcPort: number;
  host: string;

  // Policy settings
  policyPath: string;
  watchPolicies: boolean;

  // Storage settings
  storage: {
    type: 'file' | 'postgres' | 'redis';
    connectionString?: string;
  };

  // Caching
  cache: {
    enabled: boolean;
    ttlSeconds: number;
    maxSize: number;
  };

  // Audit
  audit: {
    enabled: boolean;
    backend: 'console' | 'file' | 'kafka';
    kafkaConfig?: KafkaConfig;
  };
}
```

### 8.2 Environment Variables
```bash
# Server
AEGIS_PORT=3592
AEGIS_GRPC_PORT=3593
AEGIS_HOST=0.0.0.0

# Policies
AEGIS_POLICY_PATH=/policies
AEGIS_WATCH_POLICIES=true

# Storage
AEGIS_STORAGE_TYPE=postgres
AEGIS_DATABASE_URL=postgresql://user:pass@localhost:5432/aegis

# Cache
AEGIS_CACHE_ENABLED=true
AEGIS_CACHE_TTL=3600
AEGIS_CACHE_MAX_SIZE=10000

# Audit
AEGIS_AUDIT_ENABLED=true
AEGIS_AUDIT_BACKEND=kafka
AEGIS_KAFKA_BROKERS=localhost:9092
```

---

## 9. Performance Targets

### 9.1 Latency Requirements
| Metric | Target | Notes |
|--------|--------|-------|
| p50 latency | < 1ms | Single check |
| p99 latency | < 5ms | Single check |
| p99.9 latency | < 10ms | Single check |

### 9.2 Throughput Requirements
| Metric | Target | Notes |
|--------|--------|-------|
| Checks/second | > 10,000 | Single instance |
| Concurrent requests | > 1,000 | Sustained |

### 9.3 Resource Requirements
| Resource | Target | Notes |
|----------|--------|-------|
| Memory | < 100MB | Base footprint |
| CPU | < 0.5 cores | Idle |
| Startup | < 2s | Cold start |

---

## 10. Security Model

### 10.1 Security Principles
1. **Fail-Closed**: Deny access on any error
2. **Least Privilege**: Default deny, explicit allow
3. **Defense in Depth**: Multiple validation layers
4. **Audit Everything**: Full decision trail

### 10.2 Security Controls
| Control | Implementation |
|---------|----------------|
| Expression sandboxing | CEL (no I/O, no side effects) |
| Input validation | Zod + JSON Schema |
| Rate limiting | Token bucket per client |
| Authentication | mTLS, JWT, API keys |
| Audit logging | Structured JSON, Kafka |

### 10.3 Threat Mitigations
| Threat | Mitigation |
|--------|------------|
| Policy injection | CEL sandboxing, schema validation |
| DoS via expressions | Expression caching, complexity limits |
| Privilege escalation | Deny-overrides algorithm |
| Information disclosure | Minimal error messages |

---

## 11. Deployment Architecture

### 11.1 Standalone Deployment
```
┌─────────────────────────────────────┐
│           Load Balancer             │
└─────────────────┬───────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
┌───▼───┐    ┌───▼───┐    ┌───▼───┐
│ Aegis │    │ Aegis │    │ Aegis │
│  Pod  │    │  Pod  │    │  Pod  │
└───┬───┘    └───┬───┘    └───┬───┘
    │             │             │
    └─────────────┼─────────────┘
                  │
         ┌───────▼───────┐
         │   PostgreSQL  │
         │  (Policies)   │
         └───────────────┘
```

### 11.2 Sidecar Deployment
```
┌──────────────────────────────────────┐
│              Application Pod          │
│ ┌─────────────────┐ ┌──────────────┐ │
│ │   Application   │ │    Aegis     │ │
│ │    Container    │◄┤   Sidecar    │ │
│ │                 │ │              │ │
│ └────────┬────────┘ └──────────────┘ │
│          │                            │
│          │ localhost:3592             │
└──────────┴────────────────────────────┘
```

---

## 12. Monitoring & Observability

### 12.1 Metrics (Prometheus)
```
# Request metrics
aegis_check_requests_total{status="success|error"}
aegis_check_duration_seconds{quantile="0.5|0.99|0.999"}

# Policy metrics
aegis_policies_loaded_total
aegis_policy_evaluation_duration_seconds

# Cache metrics
aegis_cache_hits_total
aegis_cache_misses_total
aegis_cache_size

# CEL metrics
aegis_cel_evaluations_total
aegis_cel_cache_hit_rate
```

### 12.2 Health Endpoints
```
GET /health/live    → 200 OK (process alive)
GET /health/ready   → 200 OK (ready to serve)
GET /health/startup → 200 OK (fully initialized)
```

### 12.3 Tracing (OpenTelemetry)
- Request tracing with correlation IDs
- Policy evaluation spans
- CEL expression evaluation spans

---

## 13. Development Setup

### 13.1 Prerequisites
- Node.js >= 20.0.0
- pnpm >= 8.0.0
- Docker (for PostgreSQL/Redis)

### 13.2 Quick Start
```bash
# Clone and install
git clone https://github.com/org/authz-engine.git
cd authz-engine
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Start development server
pnpm dev
```

### 13.3 Monorepo Commands
```bash
pnpm build          # Build all packages
pnpm test           # Run all tests
pnpm lint           # Lint all packages
pnpm typecheck      # Type check all packages
pnpm clean          # Clean build artifacts
```

---

## 14. Implementation Roadmap

### Phase 1: Core Engine (Sessions 1-4)
- [x] Session 1: Monorepo infrastructure
- [x] Session 2: CEL evaluator with cel-js
- [ ] Session 3: Policy compiler with schema validation
- [ ] Session 4: Decision engine with deny-overrides

### Phase 2: Storage & APIs (Sessions 5-7)
- [ ] Session 5: PostgreSQL + Redis storage
- [ ] Session 6: REST API with OpenAPI
- [ ] Session 7: gRPC API with streaming

### Phase 3: SDK & Integration (Session 8)
- [ ] Session 8: TypeScript SDK with full types

### Phase 4: Production Readiness
- [ ] Performance optimization
- [ ] Security hardening
- [ ] Documentation completion
- [ ] Avatar Connex integration

---

## 15. References

- [Cerbos Documentation](https://docs.cerbos.dev/)
- [CEL Specification](https://github.com/google/cel-spec)
- [cel-js Library](https://github.com/nicktomlin/cel-js)
- [OpenPolicy Agent](https://www.openpolicyagent.org/)
- [Zanzibar Paper](https://research.google/pubs/pub48190/)
