# Software Design Document
# Enterprise Authorization Engine (Codename: Aegis)

**Version:** 1.0.0
**Date:** November 23, 2025
**Author:** Architecture Team
**Status:** Draft for CTO Review

---

## Executive Summary

This document defines the architecture for an enterprise-grade authorization engine that provides **feature parity with Cerbos** while adding **differentiated capabilities** for the enterprise market. The system will have **zero dependencies on Cerbos libraries** and is designed for strategic partnerships with KPMG, 1Kosmos, Symmetry Systems, and Astrix Security.

**First Production Client:** Avatar Connex (digital avatar platform)

### Strategic Differentiators Over Cerbos

| Capability | Cerbos | Aegis (Our Engine) |
|------------|--------|-------------------|
| Policy Engine | CEL-based static evaluation | CEL + ML-assisted policy suggestions |
| Anomaly Detection | None | Built-in behavioral analysis |
| Compliance Reporting | Basic audit logs | KPMG-ready compliance dashboards |
| Identity Integration | JWT validation only | Deep 1Kosmos BFID integration |
| Data Classification | None | Symmetry Systems integration |
| API Security | Standard auth | Astrix non-human identity governance |
| Explainability | None | LLM-powered decision explanations |
| Pricing | Per-PDP licensing | Usage-based, embedded-friendly |

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [System Overview](#2-system-overview)
3. [Architecture](#3-architecture)
4. [Core Components](#4-core-components)
5. [Policy Engine Design](#5-policy-engine-design)
6. [Storage Layer](#6-storage-layer)
7. [API Design](#7-api-design)
8. [SDK Strategy](#8-sdk-strategy)
9. [Enterprise Features](#9-enterprise-features)
10. [Partner Integrations](#10-partner-integrations)
11. [Avatar Connex Implementation](#11-avatar-connex-implementation)
12. [Security Architecture](#12-security-architecture)
13. [Performance Requirements](#13-performance-requirements)
14. [Implementation Roadmap](#14-implementation-roadmap)
15. [Appendices](#appendices)

---

## 1. Introduction

### 1.1 Purpose

This SDD defines the complete architecture for building an enterprise authorization engine from scratch. The system will:

- Provide policy-as-code authorization (RBAC + ABAC + ReBAC)
- Support real-time access decisions at scale (>10,000 RPS)
- Integrate with enterprise identity and compliance systems
- Enable AI-assisted policy management and anomaly detection
- Deploy as cloud service, on-premise, or embedded

### 1.2 Scope

**In Scope:**
- Core policy decision engine
- Policy administration and management
- REST, gRPC, and GraphQL APIs
- SDKs for 8+ languages
- Storage backends (PostgreSQL, MySQL, SQLite, Redis, S3)
- Audit logging and compliance reporting
- Partner integration frameworks
- Avatar Connex reference implementation

**Out of Scope (Phase 1):**
- Visual policy builder UI (Phase 2)
- Multi-region policy synchronization (Phase 2)
- Marketplace for policy templates (Phase 3)

### 1.3 Definitions

| Term | Definition |
|------|------------|
| **PDP** | Policy Decision Point - evaluates authorization requests |
| **PAP** | Policy Administration Point - manages policies |
| **PIP** | Policy Information Point - provides contextual data |
| **PEP** | Policy Enforcement Point - enforces decisions |
| **CEL** | Common Expression Language - Google's expression language |
| **BFID** | Biometric-First Identity (1Kosmos technology) |

### 1.4 References

- [Cerbos Documentation](https://docs.cerbos.dev) - Feature reference
- [Google CEL Spec](https://github.com/google/cel-spec) - Expression language
- [NIST SP 800-162](https://csrc.nist.gov/publications/detail/sp/800-162/final) - ABAC Guide
- [OpenID AuthZEN](https://openid.net/wg/authzen/) - Authorization API standard

---

## 2. System Overview

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ENTERPRISE APPLICATIONS                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ Avatar   │  │ Finance  │  │   HR     │  │ Customer │  │  Partner │      │
│  │ Connex   │  │ Systems  │  │ Systems  │  │ Portals  │  │   Apps   │      │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘      │
│       │             │             │             │             │             │
│       └─────────────┴──────┬──────┴─────────────┴─────────────┘             │
│                            │                                                 │
│                     ┌──────▼──────┐                                         │
│                     │   SDKs &    │                                         │
│                     │   PEPs      │                                         │
│                     └──────┬──────┘                                         │
└────────────────────────────┼────────────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────────────┐
│                        AEGIS AUTHORIZATION ENGINE                            │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         API GATEWAY                                  │    │
│  │   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐         │    │
│  │   │  REST   │    │  gRPC   │    │ GraphQL │    │ WebSocket│         │    │
│  │   │ :3592   │    │ :3593   │    │ :3594   │    │ :3595   │         │    │
│  │   └────┬────┘    └────┬────┘    └────┬────┘    └────┬────┘         │    │
│  └────────┼──────────────┼──────────────┼──────────────┼───────────────┘    │
│           └──────────────┴──────────────┴──────────────┘                    │
│                                    │                                         │
│  ┌─────────────────────────────────▼─────────────────────────────────────┐  │
│  │                      POLICY DECISION ENGINE                            │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │  │
│  │  │ Policy Cache │  │ CEL Evaluator│  │ Decision     │                 │  │
│  │  │ (LRU + TTL)  │  │ (No Cerbos)  │  │ Aggregator   │                 │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                 │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │  │
│  │  │ Derived Role │  │ Query Planner│  │ Explanation  │                 │  │
│  │  │ Computer     │  │ (PlanResources)│ │ Generator   │                 │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│  ┌─────────────────────────────────▼─────────────────────────────────────┐  │
│  │                      AGENTIC INTELLIGENCE LAYER                        │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐              │  │
│  │  │ GUARDIAN │  │ ANALYST  │  │ ADVISOR  │  │ ENFORCER │              │  │
│  │  │ Anomaly  │  │ Pattern  │  │ LLM      │  │ Action   │              │  │
│  │  │ Detection│  │ Learning │  │ Explain  │  │ Executor │              │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘              │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│  ┌─────────────────────────────────▼─────────────────────────────────────┐  │
│  │                      PARTNER INTEGRATION LAYER                         │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐              │  │
│  │  │  KPMG    │  │ 1Kosmos  │  │ Symmetry │  │  Astrix  │              │  │
│  │  │Compliance│  │  BFID    │  │  Data    │  │  NHI     │              │  │
│  │  │ Reports  │  │ Identity │  │ Classify │  │ Govern   │              │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘              │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│  ┌─────────────────────────────────▼─────────────────────────────────────┐  │
│  │                      STORAGE & AUDIT LAYER                             │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐              │  │
│  │  │ Policy   │  │ Decision │  │  Audit   │  │ Analytics│              │  │
│  │  │ Store    │  │ Cache    │  │  Log     │  │ Store    │              │  │
│  │  │ (Git/DB) │  │ (Redis)  │  │ (Kafka)  │  │ (PG/CH)  │              │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘              │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Deployment Models

| Model | Use Case | Components |
|-------|----------|------------|
| **Cloud SaaS** | Multi-tenant enterprise | Full stack, managed |
| **Dedicated Cloud** | Single tenant, compliance | Isolated VPC deployment |
| **On-Premise** | Regulated industries | Docker/K8s, customer infra |
| **Embedded** | SDK-only, edge | Library mode, no server |
| **Hybrid** | Mixed requirements | Cloud control plane + local PDP |

---

## 3. Architecture

### 3.1 Design Principles

1. **Zero External Authorization Dependencies**
   - No Cerbos, OPA, or Cedar libraries
   - CEL evaluation via `cel-js` (MIT licensed, Google-maintained)
   - All policy logic implemented from scratch

2. **Separation of Concerns**
   - PDP: Stateless decision evaluation
   - PAP: Policy lifecycle management
   - PIP: External data enrichment
   - PEP: Client-side enforcement

3. **Performance First**
   - Sub-5ms p99 latency target
   - 10,000+ RPS per node
   - Intelligent caching at every layer

4. **Enterprise Ready**
   - SOC 2 Type II compliant architecture
   - GDPR/CCPA data handling
   - Multi-tenancy isolation

5. **Extensibility**
   - Plugin architecture for custom functions
   - Webhook integration points
   - Custom storage backends

### 3.2 Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Language** | TypeScript/Node.js | SDK ecosystem, async performance |
| **Expression Engine** | cel-js | CEL standard, no vendor lock-in |
| **API Framework** | Fastify + gRPC | Performance + polyglot support |
| **Database** | PostgreSQL (primary) | ACID, JSON, vectors |
| **Cache** | Redis Cluster | Distributed caching |
| **Queue** | Apache Kafka | Audit streaming, events |
| **Search** | OpenSearch | Audit log analytics |
| **Container** | Docker + K8s | Standard deployment |

### 3.3 Package Structure

```
@aegis/
├── core/                    # Policy engine core
│   ├── cel-evaluator/       # CEL expression evaluation
│   ├── policy-compiler/     # Policy parsing & validation
│   ├── decision-engine/     # Authorization logic
│   └── derived-roles/       # Dynamic role computation
│
├── server/                  # Server implementations
│   ├── rest/                # REST API (Fastify)
│   ├── grpc/                # gRPC service
│   ├── graphql/             # GraphQL API
│   └── websocket/           # Real-time subscriptions
│
├── storage/                 # Storage backends
│   ├── postgres/            # PostgreSQL driver
│   ├── mysql/               # MySQL driver
│   ├── sqlite/              # SQLite (embedded)
│   ├── redis/               # Redis cache
│   ├── git/                 # Git-based policies
│   └── s3/                  # S3/Blob storage
│
├── agents/                  # Agentic intelligence
│   ├── guardian/            # Anomaly detection
│   ├── analyst/             # Pattern learning
│   ├── advisor/             # LLM explanations
│   └── enforcer/            # Action execution
│
├── integrations/            # Partner integrations
│   ├── kpmg-compliance/     # Compliance reporting
│   ├── 1kosmos-bfid/        # Biometric identity
│   ├── symmetry-data/       # Data classification
│   └── astrix-nhi/          # Non-human identity
│
├── sdk-typescript/          # TypeScript SDK
├── sdk-python/              # Python SDK
├── sdk-go/                  # Go SDK
├── sdk-java/                # Java SDK
├── sdk-dotnet/              # .NET SDK
├── sdk-ruby/                # Ruby SDK
├── sdk-php/                 # PHP SDK
├── sdk-rust/                # Rust SDK
│
├── nestjs/                  # NestJS integration
├── express/                 # Express middleware
├── fastify/                 # Fastify plugin
│
└── testing/                 # Test utilities
    ├── policy-tester/       # Policy unit testing
    ├── load-tester/         # Performance testing
    └── fixtures/            # Test data
```

---

## 4. Core Components

### 4.1 Policy Decision Engine

The heart of the system. Evaluates authorization requests against policies.

```typescript
interface DecisionEngine {
  /**
   * Check if principal can perform actions on resource
   * Equivalent to Cerbos CheckResources
   */
  check(request: CheckRequest): Promise<CheckResponse>;

  /**
   * Plan which resources principal can access
   * Equivalent to Cerbos PlanResources
   */
  plan(request: PlanRequest): Promise<PlanResponse>;

  /**
   * Batch check multiple resources
   */
  batchCheck(request: BatchCheckRequest): Promise<BatchCheckResponse>;
}

interface CheckRequest {
  requestId: string;
  principal: Principal;
  resources: ResourceCheck[];
  auxData?: AuxiliaryData;
  includeMeta?: boolean;
}

interface Principal {
  id: string;
  roles: string[];
  attributes: Record<string, Value>;
  scope?: string;  // For multi-tenancy
}

interface ResourceCheck {
  resource: Resource;
  actions: string[];
}

interface Resource {
  kind: string;
  id: string;
  attributes: Record<string, Value>;
  policyVersion?: string;
  scope?: string;
}
```

### 4.2 CEL Evaluator

Custom CEL implementation using `cel-js` library (MIT license, maintained by Google).

```typescript
interface CELEvaluator {
  /**
   * Compile CEL expression to AST
   */
  compile(expression: string): CompiledExpression;

  /**
   * Evaluate compiled expression with context
   */
  evaluate(
    compiled: CompiledExpression,
    context: EvaluationContext
  ): Value;

  /**
   * Register custom functions
   */
  registerFunction(name: string, fn: CustomFunction): void;
}

interface EvaluationContext {
  request: {
    principal: Principal;
    resource: Resource;
    auxData: AuxiliaryData;
  };
  variables: Record<string, Value>;
  runtime: {
    now: () => Date;
    // Custom functions
  };
}
```

**Custom Functions to Implement:**

| Function | Description | Example |
|----------|-------------|---------|
| `hierarchy(role, roleMap)` | Check role hierarchy | `hierarchy(principal.role, "admin")` |
| `hasIntersection(a, b)` | Set intersection check | `hasIntersection(principal.groups, resource.allowedGroups)` |
| `timeSince(timestamp)` | Duration since time | `timeSince(resource.createdAt) < duration("24h")` |
| `geoDistance(loc1, loc2)` | Geographic distance | `geoDistance(principal.location, resource.region) < 100` |
| `riskScore(principal)` | Get risk score | `riskScore(principal) < 0.5` |

### 4.3 Policy Compiler

Parses YAML/JSON policies into executable form.

```typescript
interface PolicyCompiler {
  /**
   * Parse policy from YAML/JSON
   */
  parse(source: string, format: 'yaml' | 'json'): ParsedPolicy;

  /**
   * Validate policy against schema
   */
  validate(policy: ParsedPolicy): ValidationResult;

  /**
   * Compile policy to optimized form
   */
  compile(policy: ParsedPolicy): CompiledPolicy;

  /**
   * Index policies for fast lookup
   */
  index(policies: CompiledPolicy[]): PolicyIndex;
}
```

### 4.4 Derived Roles Computer

Dynamically computes roles based on context.

```typescript
interface DerivedRolesComputer {
  /**
   * Compute derived roles for principal + resource
   */
  compute(
    principal: Principal,
    resource: Resource,
    definitions: DerivedRoleDefinition[]
  ): string[];
}

// Example derived role definition (YAML)
/*
apiVersion: aegis/v1
kind: DerivedRoles
metadata:
  name: avatar-roles
definitions:
  - name: owner
    parentRoles: [user, influencer]
    condition:
      expression: resource.ownerId == principal.id

  - name: subscriber
    parentRoles: [user, fan]
    condition:
      expression: |
        principal.id in resource.subscriberIds ||
        hasActiveSubscription(principal.id, resource.ownerId)

  - name: moderator
    parentRoles: [admin]
    condition:
      expression: |
        principal.attr.moderatorFor.exists(r, r == resource.kind)
*/
```

---

## 5. Policy Engine Design

### 5.1 Policy Types

#### 5.1.1 Resource Policies

Define access rules for resource types.

```yaml
apiVersion: aegis/v1
kind: ResourcePolicy
metadata:
  name: avatar-policy
  version: "1.0.0"
  labels:
    service: avatar-management
    compliance: [SOC2, GDPR]
spec:
  resource: avatar
  version: default

  # Import derived roles
  importDerivedRoles:
    - avatar-roles

  # Schema validation (optional)
  schemas:
    principalSchema:
      ref: aegis:///schemas/principal.json
    resourceSchema:
      ref: aegis:///schemas/avatar.json

  rules:
    - name: owner-full-access
      actions: ["*"]
      effect: EFFECT_ALLOW
      derivedRoles: [owner]

    - name: subscriber-view
      actions: [view, interact, tip]
      effect: EFFECT_ALLOW
      derivedRoles: [subscriber]
      condition:
        match:
          all:
            - expr: resource.status == "active"
            - expr: resource.visibility in ["public", "subscribers"]

    - name: admin-moderate
      actions: [moderate, suspend, delete]
      effect: EFFECT_ALLOW
      roles: [admin, super_admin]

    - name: deny-suspended
      actions: ["*"]
      effect: EFFECT_DENY
      condition:
        match:
          expr: resource.status == "suspended"
      output:
        expr: '"Resource is suspended: " + resource.suspensionReason'
```

#### 5.1.2 Principal Policies

Override rules for specific principals.

```yaml
apiVersion: aegis/v1
kind: PrincipalPolicy
metadata:
  name: vip-user-override
spec:
  principal: user:vip-123
  version: default

  rules:
    - resource: premium-content
      actions: [view, download]
      effect: EFFECT_ALLOW
      condition:
        match:
          expr: principal.attr.vipLevel >= 3
```

#### 5.1.3 Role Policies

Define rules specific to roles.

```yaml
apiVersion: aegis/v1
kind: RolePolicy
metadata:
  name: influencer-role-policy
spec:
  role: influencer
  version: default

  rules:
    - resource: avatar
      actions: [create]
      effect: EFFECT_ALLOW
      condition:
        match:
          expr: size(principal.attr.avatars) < principal.attr.maxAvatars

    - resource: payout
      actions: [request]
      effect: EFFECT_ALLOW
      condition:
        match:
          all:
            - expr: principal.attr.payoutEligible == true
            - expr: principal.attr.balance >= 50.00
```

#### 5.1.4 Exported Variables

Reusable expressions across policies.

```yaml
apiVersion: aegis/v1
kind: ExportVariables
metadata:
  name: common-variables
spec:
  definitions:
    isOwner: resource.ownerId == principal.id
    isActive: resource.status == "active"
    isPublic: resource.visibility == "public"
    hasValidSubscription: |
      principal.attr.subscriptions.exists(s,
        s.influencerId == resource.ownerId &&
        s.status == "active" &&
        s.expiresAt > now
      )
    withinBusinessHours: |
      now.getHours() >= 9 && now.getHours() < 17
```

### 5.2 Rule Evaluation Order

1. **Explicit DENY** - Any matching deny rule blocks access
2. **Explicit ALLOW** - Must have at least one matching allow rule
3. **Default DENY** - No match = denied

```typescript
enum Effect {
  EFFECT_ALLOW = 'EFFECT_ALLOW',
  EFFECT_DENY = 'EFFECT_DENY',
}

function evaluateRules(
  rules: CompiledRule[],
  context: EvaluationContext
): Decision {
  let hasAllow = false;
  let denyReason: string | undefined;

  for (const rule of rules) {
    if (!matchesCondition(rule, context)) continue;

    if (rule.effect === Effect.EFFECT_DENY) {
      return {
        allowed: false,
        matchedRule: rule.name,
        reason: evaluateOutput(rule.output, context) || 'Denied by policy',
      };
    }

    if (rule.effect === Effect.EFFECT_ALLOW) {
      hasAllow = true;
    }
  }

  return {
    allowed: hasAllow,
    matchedRule: hasAllow ? 'matched' : undefined,
    reason: hasAllow ? undefined : 'No matching allow rule',
  };
}
```

### 5.3 Query Planning (PlanResources)

Generate query filters for "which resources can X access?"

```typescript
interface PlanResponse {
  requestId: string;
  resourceKind: string;
  filter: QueryFilter;
}

type QueryFilter =
  | { kind: 'always_allowed' }
  | { kind: 'always_denied' }
  | { kind: 'conditional'; expression: AST };

// Example: Plan for "which avatars can user-123 view?"
// Returns: { kind: 'conditional', expression: AST for:
//   (status == "active" AND visibility == "public") OR
//   (ownerId == "user-123") OR
//   (subscriberIds CONTAINS "user-123")
// }
```

---

## 6. Storage Layer

### 6.1 Storage Interface

```typescript
interface PolicyStore {
  // Policy CRUD
  getPolicy(id: string): Promise<Policy | null>;
  listPolicies(filter: PolicyFilter): Promise<Policy[]>;
  putPolicy(policy: Policy): Promise<void>;
  deletePolicy(id: string): Promise<void>;

  // Versioning
  getPolicyVersion(id: string, version: string): Promise<Policy | null>;
  listPolicyVersions(id: string): Promise<PolicyVersion[]>;

  // Bulk operations
  reload(): Promise<void>;
  subscribe(handler: PolicyChangeHandler): Subscription;
}

interface DecisionStore {
  // Decision recording
  recordDecision(decision: DecisionRecord): Promise<void>;

  // Analytics queries
  queryDecisions(filter: DecisionFilter): Promise<DecisionRecord[]>;
  getDecisionStats(filter: StatsFilter): Promise<DecisionStats>;

  // Vector search (for pattern matching)
  findSimilarDecisions(embedding: number[], k: number): Promise<DecisionRecord[]>;
}

interface AuditStore {
  // Audit logging
  log(entry: AuditEntry): Promise<void>;

  // Audit queries
  query(filter: AuditFilter): Promise<AuditEntry[]>;
  export(filter: AuditFilter, format: ExportFormat): Promise<Stream>;
}
```

### 6.2 Storage Backends

#### 6.2.1 PostgreSQL (Primary)

```sql
-- Policy storage
CREATE TABLE policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  version VARCHAR(50) NOT NULL DEFAULT 'default',
  scope VARCHAR(255),  -- Multi-tenancy
  content JSONB NOT NULL,
  compiled BYTEA,  -- Compiled policy cache
  hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by VARCHAR(255),
  UNIQUE(kind, name, version, scope)
);

-- Decision log (partitioned by time)
CREATE TABLE decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id VARCHAR(255) NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  principal_id VARCHAR(255) NOT NULL,
  resource_kind VARCHAR(100) NOT NULL,
  resource_id VARCHAR(255),
  action VARCHAR(100) NOT NULL,
  allowed BOOLEAN NOT NULL,
  matched_rule VARCHAR(255),
  latency_ms INTEGER,
  metadata JSONB,
  embedding VECTOR(1536)  -- For ML analysis
) PARTITION BY RANGE (timestamp);

-- Audit log
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_type VARCHAR(50) NOT NULL,
  actor_id VARCHAR(255),
  actor_type VARCHAR(50),
  target_type VARCHAR(50),
  target_id VARCHAR(255),
  action VARCHAR(100) NOT NULL,
  outcome VARCHAR(50),
  details JSONB,
  request_context JSONB,
  INDEX idx_audit_actor (actor_id, timestamp),
  INDEX idx_audit_target (target_type, target_id, timestamp)
) PARTITION BY RANGE (timestamp);
```

#### 6.2.2 Git Backend

```typescript
interface GitPolicyStore extends PolicyStore {
  repository: string;
  branch: string;
  pollInterval: number;

  // Git-specific
  syncFromRemote(): Promise<SyncResult>;
  getCommitHistory(policyId: string): Promise<Commit[]>;
  diffVersions(v1: string, v2: string): Promise<PolicyDiff>;
}
```

#### 6.2.3 Redis Cache

```typescript
interface PolicyCache {
  // Policy caching
  getCachedPolicy(key: string): Promise<CompiledPolicy | null>;
  cachePolicy(key: string, policy: CompiledPolicy, ttl: number): Promise<void>;

  // Decision caching
  getCachedDecision(hash: string): Promise<Decision | null>;
  cacheDecision(hash: string, decision: Decision, ttl: number): Promise<void>;

  // Invalidation
  invalidatePolicy(key: string): Promise<void>;
  invalidateAll(): Promise<void>;
}
```

---

## 7. API Design

### 7.1 REST API

Base URL: `https://aegis.example.com/api/v1`

#### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/check` | Check authorization |
| POST | `/batch-check` | Batch authorization check |
| POST | `/plan` | Plan resources query |
| GET | `/health` | Health check |
| GET | `/metrics` | Prometheus metrics |

#### Policy Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/policies` | List policies |
| GET | `/policies/{id}` | Get policy |
| PUT | `/policies/{id}` | Create/update policy |
| DELETE | `/policies/{id}` | Delete policy |
| POST | `/policies/validate` | Validate policy |
| POST | `/policies/test` | Test policy |

#### Agentic Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/agents/health` | Agent health |
| GET | `/agents/anomalies` | List anomalies |
| POST | `/agents/explain` | Explain decision |
| POST | `/agents/ask` | Natural language query |
| GET | `/agents/patterns` | Discovered patterns |

### 7.2 gRPC Service

```protobuf
syntax = "proto3";
package aegis.v1;

service AegisService {
  // Core authorization
  rpc Check(CheckRequest) returns (CheckResponse);
  rpc BatchCheck(BatchCheckRequest) returns (BatchCheckResponse);
  rpc PlanResources(PlanResourcesRequest) returns (PlanResourcesResponse);

  // Streaming
  rpc CheckStream(stream CheckRequest) returns (stream CheckResponse);

  // Policy management
  rpc GetPolicy(GetPolicyRequest) returns (Policy);
  rpc ListPolicies(ListPoliciesRequest) returns (ListPoliciesResponse);
  rpc PutPolicy(PutPolicyRequest) returns (PutPolicyResponse);
  rpc DeletePolicy(DeletePolicyRequest) returns (DeletePolicyResponse);

  // Admin
  rpc Reload(ReloadRequest) returns (ReloadResponse);
  rpc GetHealth(GetHealthRequest) returns (HealthResponse);
}
```

### 7.3 GraphQL API

```graphql
type Query {
  # Authorization
  check(input: CheckInput!): CheckResult!
  plan(input: PlanInput!): PlanResult!

  # Policies
  policies(filter: PolicyFilter): [Policy!]!
  policy(id: ID!): Policy

  # Analytics
  decisionStats(filter: StatsFilter!): DecisionStats!
  anomalies(filter: AnomalyFilter): [Anomaly!]!
  patterns: [Pattern!]!
}

type Mutation {
  # Policies
  createPolicy(input: PolicyInput!): Policy!
  updatePolicy(id: ID!, input: PolicyInput!): Policy!
  deletePolicy(id: ID!): Boolean!

  # Enforcement
  resolveAnomaly(id: ID!, resolution: Resolution!): Anomaly!
  approveAction(id: ID!): EnforcementAction!
  rejectAction(id: ID!, reason: String!): EnforcementAction!
}

type Subscription {
  # Real-time
  policyChanges: PolicyChange!
  anomalyDetected: Anomaly!
  decisionStream(filter: DecisionFilter): Decision!
}
```

---

## 8. SDK Strategy

### 8.1 SDK Architecture

All SDKs share common patterns:

```
┌─────────────────────────────────────────────────────────────┐
│                      SDK Structure                           │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Client    │  │   Cache     │  │   Retry     │         │
│  │   Interface │  │   Layer     │  │   Logic     │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                  │
│         └────────────────┴────────────────┘                  │
│                          │                                   │
│         ┌────────────────┴────────────────┐                  │
│         │                                 │                  │
│    ┌────▼────┐                      ┌────▼────┐             │
│    │  REST   │                      │  gRPC   │             │
│    │ Client  │                      │ Client  │             │
│    └─────────┘                      └─────────┘             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 SDK Interface (TypeScript Reference)

```typescript
interface AegisClient {
  // Core
  check(principal: Principal, resource: Resource, actions: string[]): Promise<CheckResult>;
  isAllowed(principal: Principal, resource: Resource, action: string): Promise<boolean>;
  batchCheck(principal: Principal, checks: ResourceCheck[]): Promise<BatchResult>;
  plan(principal: Principal, resourceKind: string, action: string): Promise<PlanResult>;

  // Helpers
  principal(id: string, roles: string[], attrs?: Record<string, any>): Principal;
  resource(kind: string, id: string, attrs?: Record<string, any>): Resource;

  // Health
  healthCheck(): Promise<HealthStatus>;

  // Configuration
  configure(options: ClientOptions): void;
}

interface ClientOptions {
  serverUrl: string;
  grpcUrl?: string;
  timeout?: number;
  retries?: number;
  cacheEnabled?: boolean;
  cacheTTL?: number;
  headers?: Record<string, string>;
}
```

### 8.3 SDK Implementations

| Language | Package | Priority | Notes |
|----------|---------|----------|-------|
| TypeScript | `@aegis/sdk` | P0 | Reference implementation |
| Python | `aegis-sdk` | P0 | Django/FastAPI integration |
| Go | `github.com/aegis/sdk-go` | P0 | gRPC native |
| Java | `io.aegis:sdk` | P1 | Spring Boot integration |
| .NET | `Aegis.Sdk` | P1 | ASP.NET Core integration |
| Ruby | `aegis-sdk` | P2 | Rails integration |
| PHP | `aegis/sdk` | P2 | Laravel integration |
| Rust | `aegis-sdk` | P2 | Performance critical |

---

## 9. Enterprise Features

### 9.1 Multi-Tenancy

```typescript
interface TenantConfig {
  id: string;
  name: string;

  // Isolation
  policyNamespace: string;
  dataPartition: string;

  // Limits
  maxPolicies: number;
  maxRequestsPerSecond: number;
  maxStorageMB: number;

  // Features
  agenticEnabled: boolean;
  complianceLevel: 'standard' | 'hipaa' | 'pci' | 'sox';
}
```

### 9.2 Compliance Features

| Feature | SOC 2 | HIPAA | PCI-DSS | SOX |
|---------|-------|-------|---------|-----|
| Audit Logging | ✓ | ✓ | ✓ | ✓ |
| Encryption at Rest | ✓ | ✓ | ✓ | ✓ |
| Encryption in Transit | ✓ | ✓ | ✓ | ✓ |
| Access Reviews | ✓ | ✓ | ✓ | ✓ |
| Change Tracking | ✓ | ✓ | ✓ | ✓ |
| Data Retention | - | ✓ | ✓ | ✓ |
| PHI Handling | - | ✓ | - | - |
| PAN Masking | - | - | ✓ | - |

### 9.3 High Availability

```
┌─────────────────────────────────────────────────────────────┐
│                    Load Balancer (HAProxy)                   │
└─────────────────────────┬───────────────────────────────────┘
                          │
         ┌────────────────┼────────────────┐
         │                │                │
    ┌────▼────┐      ┌────▼────┐      ┌────▼────┐
    │  PDP 1  │      │  PDP 2  │      │  PDP 3  │
    │(Active) │      │(Active) │      │(Active) │
    └────┬────┘      └────┬────┘      └────┬────┘
         │                │                │
         └────────────────┼────────────────┘
                          │
              ┌───────────┴───────────┐
              │                       │
         ┌────▼────┐             ┌────▼────┐
         │ Redis   │             │ Redis   │
         │ Primary │◄───────────►│ Replica │
         └─────────┘             └─────────┘
              │
         ┌────▼────┐
         │PostgreSQL│
         │ Cluster │
         └─────────┘
```

---

## 10. Partner Integrations

### 10.1 KPMG Compliance Integration

**Purpose:** Generate audit-ready compliance reports for KPMG engagements.

```typescript
interface KPMGIntegration {
  // Report generation
  generateSOC2Report(period: DateRange): Promise<SOC2Report>;
  generateAccessReview(scope: ReviewScope): Promise<AccessReviewReport>;
  generateSeparationOfDuties(): Promise<SODReport>;

  // Continuous monitoring
  subscribeToControlViolations(handler: ViolationHandler): Subscription;

  // Export
  exportForAudit(format: 'pdf' | 'xlsx' | 'json'): Promise<Buffer>;
}

interface SOC2Report {
  period: DateRange;
  controls: ControlAssessment[];
  exceptions: Exception[];
  recommendations: string[];
  overallRating: 'effective' | 'effective_with_exceptions' | 'ineffective';
}
```

### 10.2 1Kosmos BFID Integration

**Purpose:** Biometric-first identity verification for high-risk actions.

```typescript
interface OneKosmosIntegration {
  // Identity verification
  verifyIdentity(principalId: string, context: VerificationContext): Promise<VerificationResult>;

  // Step-up authentication
  requireStepUp(
    principalId: string,
    factors: BiometricFactor[]
  ): Promise<StepUpResult>;

  // Risk-based authentication
  assessRisk(principalId: string, action: string): Promise<RiskAssessment>;
}

type BiometricFactor = 'face' | 'fingerprint' | 'voice' | 'liveness';

interface VerificationResult {
  verified: boolean;
  confidence: number;
  factors: BiometricFactor[];
  timestamp: Date;
  sessionId: string;
}
```

**Policy Integration:**
```yaml
rules:
  - name: high-value-transfer-requires-biometric
    actions: [transfer]
    effect: EFFECT_ALLOW
    condition:
      match:
        all:
          - expr: resource.amount > 10000
          - expr: oneKosmos.verifyIdentity(principal.id, ["face", "liveness"]).verified
```

### 10.3 Symmetry Systems Data Classification

**Purpose:** Data-aware authorization based on sensitivity classification.

```typescript
interface SymmetryIntegration {
  // Data classification
  getClassification(resourceId: string): Promise<DataClassification>;

  // Access based on classification
  canAccessClassification(
    principalId: string,
    classification: Classification
  ): Promise<boolean>;

  // Bulk classification
  classifyResources(resources: Resource[]): Promise<ClassificationResult[]>;
}

type Classification =
  | 'public'
  | 'internal'
  | 'confidential'
  | 'restricted'
  | 'pii'
  | 'phi'
  | 'pci';
```

**Policy Integration:**
```yaml
rules:
  - name: restrict-pii-access
    actions: [view, export]
    effect: EFFECT_DENY
    condition:
      match:
        all:
          - expr: symmetry.getClassification(resource.id) in ["pii", "phi"]
          - expr: !("data_steward" in principal.roles)
```

### 10.4 Astrix Non-Human Identity

**Purpose:** Govern service accounts, API keys, and machine identities.

```typescript
interface AstrixIntegration {
  // NHI inventory
  listNonHumanIdentities(filter: NHIFilter): Promise<NHI[]>;

  // Permission analysis
  analyzePermissions(nhiId: string): Promise<PermissionAnalysis>;

  // Risk scoring
  getNHIRiskScore(nhiId: string): Promise<RiskScore>;

  // Lifecycle management
  rotateCredentials(nhiId: string): Promise<RotationResult>;
  revokeAccess(nhiId: string, reason: string): Promise<void>;
}

interface NHI {
  id: string;
  type: 'service_account' | 'api_key' | 'oauth_app' | 'bot';
  owner: string;
  permissions: Permission[];
  lastUsed: Date;
  createdAt: Date;
  riskScore: number;
}
```

**Policy Integration:**
```yaml
rules:
  - name: nhi-scope-restriction
    actions: ["*"]
    effect: EFFECT_DENY
    condition:
      match:
        all:
          - expr: principal.type == "service_account"
          - expr: astrix.getNHIRiskScore(principal.id) > 0.7
    output:
      expr: '"High-risk NHI blocked: " + principal.id'
```

---

## 11. Avatar Connex Implementation

### 11.1 Avatar Connex Domain Model

```
┌─────────────────────────────────────────────────────────────┐
│                    AVATAR CONNEX DOMAIN                      │
│                                                              │
│  ┌──────────┐      ┌──────────┐      ┌──────────┐          │
│  │   User   │      │  Avatar  │      │Subscription│         │
│  │  (Fan)   │─────►│(Influencer)────►│   (Tier)  │         │
│  └──────────┘      └──────────┘      └──────────┘          │
│       │                 │                  │                 │
│       │                 │                  │                 │
│       ▼                 ▼                  ▼                 │
│  ┌──────────┐      ┌──────────┐      ┌──────────┐          │
│  │   Chat   │      │  Stream  │      │  Payout  │          │
│  │ Message  │      │ Session  │      │ Request  │          │
│  └──────────┘      └──────────┘      └──────────┘          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 11.2 Resource Types

| Resource | Description | Key Attributes |
|----------|-------------|----------------|
| `avatar` | Digital twin | ownerId, status, visibility |
| `subscription` | Fan-influencer relationship | fanId, influencerId, tier, status |
| `chat` | Chat room/thread | participants, type, ownerId |
| `message` | Chat message | senderId, chatId, type |
| `stream` | Live stream session | avatarId, status, viewers |
| `payout` | Payout request | influencerId, amount, status |
| `content` | Premium content | ownerId, type, accessLevel |
| `tip` | Fan tip | fromId, toId, amount |

### 11.3 Derived Roles

```yaml
apiVersion: aegis/v1
kind: DerivedRoles
metadata:
  name: avatar-connex-roles
spec:
  definitions:
    - name: avatar_owner
      parentRoles: [influencer]
      condition:
        expression: resource.ownerId == principal.id

    - name: subscriber
      parentRoles: [fan, user]
      condition:
        expression: |
          P.subscriptions.exists(s,
            s.influencerId == R.ownerId &&
            s.status == "active" &&
            s.expiresAt > now()
          )

    - name: premium_subscriber
      parentRoles: [subscriber]
      condition:
        expression: |
          P.subscriptions.exists(s,
            s.influencerId == R.ownerId &&
            s.tier in ["premium", "vip"] &&
            s.status == "active"
          )

    - name: chat_participant
      parentRoles: [user]
      condition:
        expression: principal.id in resource.participantIds

    - name: chat_owner
      parentRoles: [influencer]
      condition:
        expression: resource.ownerId == principal.id

    - name: moderator
      parentRoles: [admin]
      condition:
        expression: |
          principal.attr.moderatorScopes.exists(scope,
            scope == resource.kind || scope == "*"
          )
```

### 11.4 Sample Policies

See `/policies/connex/` directory for complete policies.

### 11.5 NestJS Integration Example

```typescript
// avatar.resolver.ts
import { Authorize, AnomalyProtected, AuditAction } from '@aegis/nestjs';

@Resolver(() => Avatar)
export class AvatarResolver {

  @Query(() => Avatar)
  @Authorize({ resource: 'avatar', action: 'view' })
  async avatar(@Args('id') id: string): Promise<Avatar> {
    return this.avatarService.findById(id);
  }

  @Mutation(() => Avatar)
  @Authorize({ resource: 'avatar', action: 'create' })
  @AuditAction({ actionName: 'avatar_created' })
  async createAvatar(@Args('input') input: CreateAvatarInput): Promise<Avatar> {
    return this.avatarService.create(input);
  }

  @Mutation(() => Stream)
  @Authorize({ resource: 'avatar', action: 'start_stream' })
  @AnomalyProtected({ maxAnomalyScore: 0.6 })
  async startStream(@Args('avatarId') avatarId: string): Promise<Stream> {
    return this.streamService.start(avatarId);
  }

  @Mutation(() => Payout)
  @Authorize({ resource: 'payout', action: 'request' })
  @AnomalyProtected({ maxAnomalyScore: 0.5, onAnomaly: 'require_verification' })
  @AuditAction({ actionName: 'payout_requested', includeBody: true })
  async requestPayout(@Args('input') input: PayoutInput): Promise<Payout> {
    return this.payoutService.request(input);
  }
}
```

---

## 12. Security Architecture

### 12.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| Policy injection | Schema validation, CEL sandboxing |
| Unauthorized policy changes | RBAC on PAP, audit logging |
| Decision tampering | Signed decisions, audit trail |
| DoS via complex expressions | Expression complexity limits |
| Data exfiltration via PlanResources | Query result limits |
| Replay attacks | Request nonces, timestamps |
| Man-in-the-middle | mTLS, certificate pinning |

### 12.2 Authentication

```typescript
interface AuthenticationConfig {
  // API authentication
  apiKeys: {
    enabled: boolean;
    headerName: string;
  };

  jwt: {
    enabled: boolean;
    issuer: string;
    audience: string;
    jwksUrl: string;
  };

  mtls: {
    enabled: boolean;
    clientCAs: string[];
    requireClientCert: boolean;
  };

  // Admin authentication
  admin: {
    oidcProvider: string;
    allowedGroups: string[];
  };
}
```

### 12.3 Encryption

| Data State | Method | Key Management |
|------------|--------|----------------|
| At Rest (DB) | AES-256-GCM | AWS KMS / HashiCorp Vault |
| In Transit | TLS 1.3 | Auto-rotated certificates |
| Audit Logs | AES-256-GCM | Separate key hierarchy |
| Backups | AES-256-GCM | Customer-managed keys |

---

## 13. Performance Requirements

### 13.1 Latency Targets

| Operation | p50 | p95 | p99 |
|-----------|-----|-----|-----|
| Simple check | 1ms | 3ms | 5ms |
| Complex check (5+ rules) | 3ms | 8ms | 15ms |
| Batch check (10 resources) | 5ms | 15ms | 30ms |
| Plan resources | 10ms | 30ms | 50ms |
| Policy reload | - | - | 500ms |

### 13.2 Throughput Targets

| Deployment | Single Node | Cluster (3 nodes) |
|------------|-------------|-------------------|
| Simple checks | 10,000 RPS | 25,000 RPS |
| Complex checks | 5,000 RPS | 12,000 RPS |
| Mixed workload | 7,000 RPS | 18,000 RPS |

### 13.3 Resource Requirements

| Component | CPU | Memory | Storage |
|-----------|-----|--------|---------|
| PDP (min) | 1 vCPU | 512MB | - |
| PDP (recommended) | 2 vCPU | 2GB | - |
| PostgreSQL | 2 vCPU | 4GB | 100GB SSD |
| Redis | 1 vCPU | 2GB | - |

---

## 14. Implementation Roadmap

### Phase 1: Foundation (8 sessions)

| Session | Focus | Deliverables |
|---------|-------|--------------|
| 1 | Project setup | Monorepo, CI/CD, tooling |
| 2 | CEL evaluator | Expression parsing, evaluation |
| 3 | Policy compiler | YAML parser, schema validation |
| 4 | Decision engine | Rule matching, derived roles |
| 5 | Storage layer | PostgreSQL, Redis integration |
| 6 | REST API | Fastify server, OpenAPI spec |
| 7 | gRPC API | Protobuf, streaming |
| 8 | TypeScript SDK | Client library, tests |

### Phase 2: Enterprise Features (6 sessions)

| Session | Focus | Deliverables |
|---------|-------|--------------|
| 9 | Multi-tenancy | Tenant isolation, limits |
| 10 | Audit system | Kafka integration, retention |
| 11 | HA deployment | K8s manifests, helm chart |
| 12 | NestJS integration | Module, decorators, guards |
| 13 | Query planning | PlanResources implementation |
| 14 | Policy testing | Test framework, fixtures |

### Phase 3: Agentic Intelligence (4 sessions)

| Session | Focus | Deliverables |
|---------|-------|--------------|
| 15 | Guardian agent | Anomaly detection |
| 16 | Analyst agent | Pattern learning |
| 17 | Advisor agent | LLM explanations |
| 18 | Enforcer agent | Action execution |

### Phase 4: Partner Integrations (4 sessions)

| Session | Focus | Deliverables |
|---------|-------|--------------|
| 19 | KPMG integration | Compliance reports |
| 20 | 1Kosmos integration | BFID verification |
| 21 | Symmetry integration | Data classification |
| 22 | Astrix integration | NHI governance |

### Phase 5: Avatar Connex Production (4 sessions)

| Session | Focus | Deliverables |
|---------|-------|--------------|
| 23 | Policy migration | Connex policies |
| 24 | Integration | NestJS services |
| 25 | Load testing | Performance validation |
| 26 | Go-live | Production deployment |

**Total: 26 coding sessions**
**Estimated Duration: 10-13 weeks** (2-3 sessions per week)

---

## Appendices

### A. Policy Schema (JSON Schema)

See `/schemas/policy.schema.json`

### B. API Reference

See `/docs/api-reference.md`

### C. Deployment Guide

See `/docs/deployment-guide.md`

### D. Migration Guide from Cerbos

See `/docs/cerbos-migration.md`

### E. Glossary

| Term | Definition |
|------|------------|
| Aegis | Codename for this authorization engine |
| ABAC | Attribute-Based Access Control |
| CEL | Common Expression Language |
| NHI | Non-Human Identity |
| PDP | Policy Decision Point |
| ReBAC | Relationship-Based Access Control |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2024-11-23 | Architecture Team | Initial draft |

---

**End of Document**
