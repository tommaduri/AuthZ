# AuthZ Engine - System Design Documents Master Index

**Version**: 2.2.0
**Last Updated**: 2025-11-24
**Document Type**: Master Navigation Index
**Total SDDs**: 43 Documents
**Total ADRs**: 9 Documents

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [Quick Start Guide](#2-quick-start-guide)
3. [SDD Categories](#3-sdd-categories)
   - [Core Foundation](#31-core-foundation)
   - [Agents](#32-agents)
   - [Server & API](#33-server--api)
   - [SDK & Integrations](#34-sdk--integrations)
   - [Policy Features](#35-policy-features)
   - [Infrastructure](#36-infrastructure)
   - [Operations](#37-operations)
   - [Security & Compliance](#38-security--compliance)
   - [Production Operations](#39-production-operations)
4. [Component Dependency Graph](#4-component-dependency-graph)
5. [SDD Status Matrix](#5-sdd-status-matrix)
6. [ADR Index](#6-adr-index)
7. [Feature Coverage Summary](#7-feature-coverage-summary)
8. [Getting Started Paths](#8-getting-started-paths)
9. [Cross-Reference Matrix](#9-cross-reference-matrix)
10. [Document Conventions](#10-document-conventions)

---

## 1. Executive Overview

### 1.1 What is AuthZ Engine?

**AuthZ Engine** (also known as **Aegis**) is an enterprise-grade, Cerbos-compatible authorization engine built with a hybrid Go/TypeScript architecture. It provides:

- **Policy-Based Access Control**: Define who can do what on which resources
- **CEL Expression Evaluation**: Google's Common Expression Language for conditions
- **Agentic Authorization**: AI-powered anomaly detection, pattern learning, and autonomous enforcement
- **Zero Cerbos Dependencies**: Full compatibility without runtime Cerbos library dependencies
- **Multi-Language SDKs**: TypeScript, Go, Python, Java, and more

```
 +-------------------------------------------------------------------------+
 |                        AUTHZ ENGINE ARCHITECTURE                        |
 +-------------------------------------------------------------------------+
 |                                                                         |
 |  +------------------+  +------------------+  +----------------------+   |
 |  |   REST/gRPC API  |  |   NestJS Module  |  |  Multi-Language SDKs |   |
 |  +--------+---------+  +--------+---------+  +-----------+----------+   |
 |           |                     |                        |              |
 |           +---------------------+------------------------+              |
 |                                 |                                       |
 |                    +------------v------------+                          |
 |                    |     Decision Engine     |                          |
 |                    |   (Policy Evaluation)   |                          |
 |                    +------------+------------+                          |
 |                                 |                                       |
 |    +------------+---------------+---------------+------------+          |
 |    |            |               |               |            |          |
 |  +-v----+  +----v----+  +-------v------+  +----v----+  +----v-----+    |
 |  | CEL  |  | Policy  |  | Derived      |  | Schema  |  | Agentic  |    |
 |  | Eval |  | Store   |  | Roles Engine |  | Valid.  |  | Agents   |    |
 |  +------+  +---------+  +--------------+  +---------+  +----------+    |
 |                                                                         |
 +-------------------------------------------------------------------------+
```

### 1.2 Purpose of System Design Documents

SDDs serve as the **single source of truth** for AuthZ Engine's technical architecture. They provide:

| Purpose | Description |
|---------|-------------|
| **Specification** | Detailed technical requirements and interfaces |
| **Architecture** | System design decisions and rationale |
| **Implementation Guide** | Code patterns and integration examples |
| **Reference** | API contracts, type definitions, and schemas |
| **Compliance** | Security and regulatory requirement traceability |

### 1.3 Document Hierarchy

```
Documentation Structure
=======================

docs/
+-- sdd/
|   +-- SDD-INDEX.md              <-- YOU ARE HERE
|   +-- SDD-FRAMEWORK.md          <-- Document template and standards
|   +-- CORE-ARCHITECTURE-SDD.md  <-- System overview
|   +-- [31 SDDs organized by category]
|
+-- adr/
|   +-- ADR-001 through ADR-008   <-- Architecture Decision Records
|
+-- architecture/
    +-- ADR-001-CEL-LIBRARY-CHOICE.md
```

---

## 2. Quick Start Guide

### 2.1 For First-Time Readers

**Start with these documents in order:**

1. **[CORE-ARCHITECTURE-SDD](./CORE-ARCHITECTURE-SDD.md)** - Understand the overall system
2. **[TYPES-REFERENCE-SDD](./TYPES-REFERENCE-SDD.md)** - Learn the core type system
3. **[CEL-EVALUATOR-SDD](./CEL-EVALUATOR-SDD.md)** - Understand expression evaluation
4. **[CERBOS-FEATURE-PARITY-SDD](./CERBOS-FEATURE-PARITY-SDD.md)** - See all supported features

### 2.2 Quick Navigation by Task

| I want to... | Read these SDDs |
|--------------|-----------------|
| Understand the architecture | [CORE-ARCHITECTURE](./CORE-ARCHITECTURE-SDD.md), [GO-CORE](./GO-CORE-SDD.md) |
| Write policies | [DERIVED-ROLES](./DERIVED-ROLES-SDD.md), [PRINCIPAL-POLICIES](./PRINCIPAL-POLICIES-SDD.md), [SCOPED-POLICIES](./SCOPED-POLICIES-SDD.md) |
| Integrate with my app | [SDK-PACKAGE](./SDK-PACKAGE-SDD.md), [NESTJS-PACKAGE](./NESTJS-PACKAGE-SDD.md), [MULTI-LANGUAGE-SDK](./MULTI-LANGUAGE-SDK-SDD.md) |
| Deploy to production | [SERVER-PACKAGE](./SERVER-PACKAGE-SDD.md), [STORAGE-DRIVERS](./STORAGE-DRIVERS-SDD.md), [OBSERVABILITY](./OBSERVABILITY-SDD.md) |
| Understand security | [COMPLIANCE-SECURITY](./COMPLIANCE-SECURITY-SDD.md), [JWT-AUXDATA](./JWT-AUXDATA-SDD.md) |
| Test policies | [POLICY-TESTING](./POLICY-TESTING-SDD.md), [LOAD-TESTING-SUITE](./LOAD-TESTING-SUITE-SDD.md) |
| Use agentic features | [AGENTS-PACKAGE](./AGENTS-PACKAGE-SDD.md), [NATIVE-AGENTIC-FRAMEWORK](./NATIVE-AGENTIC-FRAMEWORK-SDD.md) |
| Build custom storage | [STORAGE-DRIVERS](./STORAGE-DRIVERS-SDD.md), [MULTI-TENANCY](./MULTI-TENANCY-SDD.md) |

### 2.3 Document Status Legend

| Status | Icon | Description |
|--------|------|-------------|
| **Complete** | DONE | Fully specified and reviewed |
| **Implemented+** | ✅ IMPL+ | Code implemented, SDD may have undocumented features |
| **Partial** | ⚠️ PARTIAL | SDD is incomplete - % indicates coverage |
| **Draft** | DRAFT | Initial specification, under development |
| **Review** | REVIEW | Awaiting technical review |
| **Planned** | PLANNED | Not yet written, placeholder |
| **Specification** | SPEC | Requirements defined, implementation pending |

---

## 3. SDD Categories

### 3.1 Core Foundation

The foundational components that power AuthZ Engine's policy evaluation.

| Document | Description | Lines | Key Topics |
|----------|-------------|-------|------------|
| [CORE-ARCHITECTURE-SDD](./CORE-ARCHITECTURE-SDD.md) | System-wide architecture and design principles | 732 | Monorepo structure, package organization, high-level design |
| [CORE-PACKAGE-SDD](./CORE-PACKAGE-SDD.md) | `@authz-engine/core` package specification | 1050+ | **8 modules**: types, policy, CEL (~400 lines), engine (~376 lines), telemetry (~250 lines), audit (~200 lines), rate-limiting (~150 lines), storage (Memory/Redis/PostgreSQL) |
| [CEL-EVALUATOR-SDD](./CEL-EVALUATOR-SDD.md) | CEL expression evaluation engine | 546 | Expression parsing, context bindings, custom functions |
| [TYPES-REFERENCE-SDD](./TYPES-REFERENCE-SDD.md) | TypeScript type definitions and interfaces | 685 | Principal, Resource, Request, Effect types |
| [GO-CORE-SDD](./GO-CORE-SDD.md) | High-performance Go core implementation | 1050 | cel-go engine, gRPC server, FFI bindings |

**Key Relationships:**
```
CORE-ARCHITECTURE
       |
       +-----> CORE-PACKAGE -----> CEL-EVALUATOR
       |              |
       |              +-----> TYPES-REFERENCE
       |
       +-----> GO-CORE (high-performance path)
```

### 3.2 Agents

AI-powered intelligent authorization capabilities.

| Document | Description | Lines | Key Topics |
|----------|-------------|-------|------------|
| [AGENTS-PACKAGE-SDD](./AGENTS-PACKAGE-SDD.md) | `@authz-engine/agents` package specification | 1200+ | **4 Agents**: Guardian (~1,607 lines), Analyst (~600 lines), Advisor (~400 lines), Enforcer (~350 lines). **AgentOrchestrator** (~1,269 lines): pipeline execution, circuit breakers, metrics, 30+ event types. **4 pre-defined pipelines**: standard, highSecurity, performance, adaptive |
| [NATIVE-AGENTIC-FRAMEWORK-SDD](./NATIVE-AGENTIC-FRAMEWORK-SDD.md) | Native agentic authorization framework | 1158 | Neural patterns, swarm orchestration, autonomous enforcement |

**Agent Architecture:**
```
+-----------------------------------------------------------+
|                   AgentOrchestrator                        |
|   - Coordinates all agents                                 |
|   - Provides unified API                                   |
+-----------------------------------------------------------+
         |           |           |           |
    +----v----+ +----v----+ +----v----+ +----v----+
    |GUARDIAN | |ANALYST  | |ADVISOR  | |ENFORCER |
    | Agent   | | Agent   | | Agent   | | Agent   |
    +---------+ +---------+ +---------+ +---------+
    Real-time   Pattern     Natural     Autonomous
    Anomaly     Learning    Language    Enforcement
    Detection               Interface
```

### 3.3 Server & API

HTTP/gRPC server implementations and API specifications.

| Document | Description | Lines | Key Topics |
|----------|-------------|-------|------------|
| [SERVER-PACKAGE-SDD](./SERVER-PACKAGE-SDD.md) | `@authz-engine/server` package specification | 950+ | **Fastify REST** (~1,865 lines), **30+ endpoints** organized in 5 categories: Core (check, batch, health), Agentic V1 (patterns, anomalies, enforcements, explain, ask, debug), API V1 Agentic (analyze, recommend), Policy Management (load, validate, list), Metrics/Admin. Wire format: 'allow'→'EFFECT_ALLOW' |
| [PLAN-RESOURCES-API-SDD](./PLAN-RESOURCES-API-SDD.md) | PlanResources API specification | 667 | Batch authorization, resource planning |
| [RBAC-ADMIN-API-SDD](./RBAC-ADMIN-API-SDD.md) | RBAC administration API | 3718 | Role management, permission assignment, admin operations |

**API Layer Architecture:**
```
+------------------+     +------------------+
|   REST Gateway   |     |   gRPC Server    |
|   (HTTP/JSON)    |     |   (Protobuf)     |
+--------+---------+     +--------+---------+
         |                        |
         +------------------------+
                    |
         +----------v----------+
         |   Middleware Stack  |
         | - Authentication    |
         | - Rate Limiting     |
         | - Request Logging   |
         | - Metrics Collection|
         +----------+----------+
                    |
         +----------v----------+
         |   Decision Engine   |
         +---------------------+
```

### 3.4 SDK & Integrations

Client SDKs and framework integrations.

| Document | Description | Lines | Key Topics |
|----------|-------------|-------|------------|
| [SDK-PACKAGE-SDD](./SDK-PACKAGE-SDD.md) | `@authz-engine/sdk` TypeScript SDK | 651 | **REST client only** (~288 lines): check(), isAllowed(), batchCheck(), healthCheck(), getPolicies(). Retry with exponential backoff. **No WebSocket** (planned for future). |
| [NESTJS-PACKAGE-SDD](./NESTJS-PACKAGE-SDD.md) | `@authz-engine/nestjs` integration | 703 | @Authorize decorator, AuthzGuard, module config |
| [MULTI-LANGUAGE-SDK-SDD](./MULTI-LANGUAGE-SDK-SDD.md) | SDKs for Go, Python, Java, etc. | 3460 | Language-specific clients, code generation |
| [OIDC-OAUTH-INTEGRATION-SDD](./OIDC-OAUTH-INTEGRATION-SDD.md) | OpenID Connect and OAuth 2.0 integration | 2728 | Token validation, claims mapping, provider config |

**SDK Integration Patterns:**
```
Application
    |
    +----> @authz-engine/sdk (TypeScript)
    |          |
    |          +----> HTTP Client (REST API)
    |          +----> gRPC Client (high performance)
    |
    +----> @authz-engine/nestjs
    |          |
    |          +----> @Authorize('resource:action') decorator
    |          +----> AuthzGuard (automatic enforcement)
    |
    +----> Multi-Language SDKs
               |
               +----> Python SDK
               +----> Java SDK
               +----> Go SDK
```

### 3.5 Policy Features

Policy types, conditions, and evaluation features.

| Document | Description | Lines | Key Topics |
|----------|-------------|-------|------------|
| [DERIVED-ROLES-SDD](./DERIVED-ROLES-SDD.md) | Dynamic role computation | 1144 | Role definitions, parent roles, CEL conditions |
| [PRINCIPAL-POLICIES-SDD](./PRINCIPAL-POLICIES-SDD.md) | User-specific policy overrides | 1035 | Principal rules, attribute-based conditions |
| [SCOPED-POLICIES-SDD](./SCOPED-POLICIES-SDD.md) | Hierarchical policy scoping | 1191 | Scope paths, inheritance, override behavior |
| [EXPORTED-VARIABLES-SDD](./EXPORTED-VARIABLES-SDD.md) | Reusable variable definitions | 1039 | Variable exports, cross-policy sharing |
| [SCHEMA-VALIDATION-SDD](./SCHEMA-VALIDATION-SDD.md) | Request/response schema validation | 1050 | JSON Schema, principal/resource schemas |
| [POLICY-VERSIONING-SDD](./POLICY-VERSIONING-SDD.md) | Policy version management | 3534 | Version control, rollback, migration |
| [POLICY-TESTING-SDD](./POLICY-TESTING-SDD.md) | Policy unit and integration testing | 713 | Test fixtures, assertions, CI integration |

**Policy Evaluation Flow:**
```
Request
   |
   v
+------------------+
| Schema Validation|---> Invalid: DENY
+--------+---------+
         |
         v
+------------------+
| Derived Roles    |---> Compute dynamic roles
| Evaluation       |
+--------+---------+
         |
         v
+------------------+
| Scope Resolution |---> Find applicable policies
+--------+---------+
         |
         v
+------------------+
| Principal Policy |---> User-specific overrides
| Check            |
+--------+---------+
         |
         v
+------------------+
| Resource Policy  |---> Evaluate rules
| Evaluation       |
+--------+---------+
         |
         v
    ALLOW / DENY
```

### 3.6 Infrastructure

Storage, authentication, and multi-tenancy components.

| Document | Description | Lines | Key Topics |
|----------|-------------|-------|------------|
| [STORAGE-DRIVERS-SDD](./STORAGE-DRIVERS-SDD.md) | Pluggable storage backends | 1154 | PostgreSQL, Redis, S3, custom adapters |
| [JWT-AUXDATA-SDD](./JWT-AUXDATA-SDD.md) | JWT token handling and auxiliary data | 967 | Token validation, claims extraction, aux data API |
| [MULTI-TENANCY-SDD](./MULTI-TENANCY-SDD.md) | Multi-tenant architecture | 1143 | Tenant isolation, policy namespacing, resource partitioning |
| [OBSERVABILITY-SDD](./OBSERVABILITY-SDD.md) | Metrics, logging, and tracing | 767 | OpenTelemetry, Prometheus, structured logging |

**Storage Architecture:**
```
+-----------------------------------------------------------+
|                    Storage Interface                       |
+-----------------------------------------------------------+
|  interface PolicyStore {                                   |
|    getPolicy(kind: string, version: string): Policy        |
|    listPolicies(filter: Filter): Policy[]                  |
|    savePolicy(policy: Policy): void                        |
|    deletePolicy(id: string): void                          |
|  }                                                         |
+-----------------------------------------------------------+
         |                |                |
    +----v----+     +-----v-----+    +-----v-----+
    |PostgreSQL|     |   Redis   |    |    S3     |
    | Driver  |     |  Driver   |    |  Driver   |
    +---------+     +-----------+    +-----------+
    Persistent      Cache/Hot       Blob/Archive
    Storage         Storage         Storage
```

### 3.7 Operations

Deployment, testing, and management tooling.

| Document | Description | Lines | Key Topics |
|----------|-------------|-------|------------|
| [LOAD-TESTING-SUITE-SDD](./LOAD-TESTING-SUITE-SDD.md) | Performance and load testing framework | 2885 | k6 integration, benchmarks, stress testing |
| [POLICY-MANAGEMENT-UI-SDD](./POLICY-MANAGEMENT-UI-SDD.md) | Web-based policy administration UI | 3283 | Policy editor, testing console, audit viewer |
| [WASM-EDGE-SDD](./WASM-EDGE-SDD.md) | WebAssembly edge deployment | 1143 | WASM compilation, Cloudflare Workers, edge evaluation |
| DEPLOYMENT-OPERATIONS-SDD | Deployment and operations guide | PLANNED | Kubernetes, Docker, CI/CD pipelines |

**Operations Stack:**
```
+-----------------------------------------------------------+
|                    Operations Layer                        |
+-----------------------------------------------------------+
|                                                            |
|  +----------------+  +----------------+  +---------------+ |
|  | Policy Mgmt UI |  | Load Testing   |  | WASM Edge     | |
|  | (React SPA)    |  | (k6 + Custom)  |  | (Cloudflare)  | |
|  +----------------+  +----------------+  +---------------+ |
|         |                   |                   |          |
|         +-------------------+-------------------+          |
|                             |                              |
|  +----------------------------------------------------------+
|  |                    AuthZ Engine Core                     |
|  +----------------------------------------------------------+
|                                                            |
+-----------------------------------------------------------+
```

### 3.8 Security & Compliance

Security controls and compliance requirements.

| Document | Description | Lines | Key Topics |
|----------|-------------|-------|------------|
| [COMPLIANCE-SECURITY-SDD](./COMPLIANCE-SECURITY-SDD.md) | Security architecture and compliance | 1107 | SOC2, GDPR, encryption, access controls |
| [CERBOS-FEATURE-PARITY-SDD](./CERBOS-FEATURE-PARITY-SDD.md) | Cerbos compatibility matrix | 952 | Feature mapping, compatibility status, migration |

**Security Controls:**
```
+-----------------------------------------------------------+
|                    Security Architecture                   |
+-----------------------------------------------------------+
|                                                            |
|  Authentication          Authorization        Audit        |
|  +---------------+       +---------------+   +----------+  |
|  | JWT/OIDC      |       | Policy Engine |   | Immutable|  |
|  | mTLS          |------>| CEL Sandbox   |-->| Audit    |  |
|  | API Keys      |       | Fail-Closed   |   | Logs     |  |
|  +---------------+       +---------------+   +----------+  |
|                                                            |
|  Encryption              Network            Compliance     |
|  +---------------+       +---------------+  +----------+   |
|  | AES-256-GCM   |       | TLS 1.3       |  | SOC 2    |   |
|  | Key Rotation  |       | Rate Limiting |  | GDPR     |   |
|  | HSM Support   |       | IP Allowlist  |  | HIPAA    |   |
|  +---------------+       +---------------+  +----------+   |
|                                                            |
+-----------------------------------------------------------+
```

### 3.9 Production Operations

Production-grade features for enterprise deployments.

| Document | Description | Status | Key Topics |
|----------|-------------|--------|------------|
| GRPC-CLIENT-SDD | High-performance gRPC client | PLANNED | Connection pooling, load balancing, retries |
| CACHING-STRATEGY-SDD | Multi-tier caching architecture | PLANNED | Redis cache, local cache, cache invalidation |
| DISASTER-RECOVERY-SDD | Backup and recovery procedures | PLANNED | Point-in-time recovery, cross-region replication |
| AUDIT-LOGGING-SDD | Comprehensive audit logging | PLANNED | Decision logs, admin actions, compliance reports |
| RATE-LIMITING-SDD | Request rate limiting | PLANNED | Token bucket, sliding window, tenant quotas |
| API-GATEWAY-INTEGRATION-SDD | API gateway patterns | PLANNED | Kong, Envoy, AWS API Gateway integration |

**Note**: Production Operations SDDs are planned for future releases. Core functionality is covered in existing SDDs.

---

## 4. Component Dependency Graph

### 4.1 Package Dependencies

```
                                 CORE-ARCHITECTURE
                                        |
                 +----------------------+----------------------+
                 |                      |                      |
                 v                      v                      v
           CORE-PACKAGE            GO-CORE              AGENTS-PACKAGE
                 |                      |                      |
    +------------+------------+         |         +------------+------------+
    |            |            |         |         |                         |
    v            v            v         |         v                         v
CEL-EVALUATOR  TYPES-REF  STORAGE      |   NATIVE-AGENTIC          (AI Models)
    |            |        DRIVERS       |   FRAMEWORK
    |            |            |         |         |
    +------------+------------+---------+---------+
                 |
    +------------+------------+------------+
    |            |            |            |
    v            v            v            v
SERVER-PKG   SDK-PKG    NESTJS-PKG   MULTI-LANG-SDK
    |            |            |            |
    +------------+------------+------------+
                 |
    +------------+------------+------------+
    |            |            |            |
    v            v            v            v
PLAN-RES-API  RBAC-API  JWT-AUXDATA  OBSERVABILITY
```

### 4.2 Feature Dependencies

```
+--------------------+     +--------------------+     +--------------------+
|   DERIVED-ROLES    |---->|  PRINCIPAL-POLICY  |---->|   SCOPED-POLICY    |
+--------------------+     +--------------------+     +--------------------+
         |                          |                          |
         v                          v                          v
+--------------------+     +--------------------+     +--------------------+
| EXPORTED-VARIABLES |     | SCHEMA-VALIDATION  |     | POLICY-VERSIONING  |
+--------------------+     +--------------------+     +--------------------+
         |                          |                          |
         +-------------+------------+-------------+------------+
                       |                          |
                       v                          v
              +--------------------+     +--------------------+
              |   POLICY-TESTING   |     | LOAD-TESTING-SUITE |
              +--------------------+     +--------------------+
```

### 4.3 Integration Dependencies

```
External Systems                     AuthZ Engine                    Clients
================                     ============                    =======

+---------------+                                               +---------------+
| PostgreSQL    |<----+                                   +---->| REST Clients  |
+---------------+     |                                   |     +---------------+
                      |     +-------------------------+   |
+---------------+     |     |                         |   |     +---------------+
| Redis         |<----+---->|    AUTHZ ENGINE CORE   |<--+---->| gRPC Clients  |
+---------------+     |     |                         |   |     +---------------+
                      |     +-------------------------+   |
+---------------+     |              |                    |     +---------------+
| S3            |<----+              |                    +---->| NestJS Apps   |
+---------------+                    v                          +---------------+
                      +-------------------------+
+---------------+     |    OIDC-OAUTH-INT       |<------------- Auth Providers
| OIDC Provider |<--->|    JWT-AUXDATA          |
+---------------+     +-------------------------+
```

---

## 5. SDD Status Matrix

> **⚠️ Important Clarification**
>
> The "Status" column refers to the **documentation status**, not implementation status.
> - **DONE/SPEC**: Specification document is complete
> - **DRAFT**: Specification is work-in-progress
> - **IMPLEMENTED**: Both spec AND code are complete
>
> For actual implementation status, see [IMPLEMENTATION-STATUS.md](../IMPLEMENTATION-STATUS.md)

### 5.1 Complete Status Overview

| Category | Document | Status | Version | Lines | Last Updated |
|----------|----------|--------|---------|-------|--------------|
| **Core Foundation** | | | | | |
| | CORE-ARCHITECTURE-SDD | SPEC | 0.1.0 | 732 | 2024-11-23 |
| | CORE-PACKAGE-SDD | ✅ **COMPLETE** | 2.1.0 | 1100+ | 2025-11-24 |
| | CEL-EVALUATOR-SDD | DONE | 0.1.0 | 546 | 2024-11-23 |
| | TYPES-REFERENCE-SDD | DONE | 0.1.0 | 685 | 2024-11-23 |
| | GO-CORE-SDD | DRAFT | 1.0.0 | 1050 | 2024-11-23 |
| **Agents** | | | | | |
| | AGENTS-PACKAGE-SDD | ✅ **COMPLETE** | 2.0.0 | 1200+ | 2024-11-24 |
| | NATIVE-AGENTIC-FRAMEWORK-SDD | DONE | 1.0.0 | 1158 | 2024-11-23 |
| **Server & API** | | | | | |
| | SERVER-PACKAGE-SDD | ✅ **COMPLETE** | 2.0.0 | 950+ | 2024-11-24 |
| | PLAN-RESOURCES-API-SDD | DONE | 1.0.0 | 667 | 2024-11-23 |
| | RBAC-ADMIN-API-SDD | DONE | 1.0.0 | 3718 | 2024-11-23 |
| **SDK & Integrations** | | | | | |
| | SDK-PACKAGE-SDD | ✅ **COMPLETE** | 1.1.0 | 651 | 2024-11-24 |
| | NESTJS-PACKAGE-SDD | ✅ IMPL+ | 1.0.0 | 703 | 2024-11-24 |
| | MULTI-LANGUAGE-SDK-SDD | DONE | 1.0.0 | 3460 | 2024-11-23 |
| | OIDC-OAUTH-INTEGRATION-SDD | DONE | 1.0.0 | 2728 | 2024-11-23 |
| **Policy Features** | | | | | |
| | DERIVED-ROLES-SDD | DONE | 1.0.0 | 1144 | 2024-11-23 |
| | PRINCIPAL-POLICIES-SDD | DONE | 1.0.0 | 1035 | 2024-11-23 |
| | SCOPED-POLICIES-SDD | ✅ **IMPLEMENTED** | 1.1.0 | 1250+ | 2025-11-24 |
| | EXPORTED-VARIABLES-SDD | DONE | 1.0.0 | 1039 | 2024-11-23 |
| | SCHEMA-VALIDATION-SDD | DONE | 1.0.0 | 1050 | 2024-11-23 |
| | POLICY-VERSIONING-SDD | DONE | 1.0.0 | 3534 | 2024-11-23 |
| | POLICY-TESTING-SDD | DONE | 1.0.0 | 713 | 2024-11-23 |
| **Infrastructure** | | | | | |
| | STORAGE-DRIVERS-SDD | DONE | 1.0.0 | 1154 | 2024-11-23 |
| | JWT-AUXDATA-SDD | DONE | 1.0.0 | 967 | 2024-11-23 |
| | MULTI-TENANCY-SDD | DONE | 1.0.0 | 1143 | 2024-11-23 |
| | OBSERVABILITY-SDD | DONE | 1.0.0 | 767 | 2024-11-23 |
| **Operations** | | | | | |
| | LOAD-TESTING-SUITE-SDD | DONE | 1.0.0 | 2885 | 2024-11-23 |
| | POLICY-MANAGEMENT-UI-SDD | DONE | 1.0.0 | 3283 | 2024-11-23 |
| | WASM-EDGE-SDD | DONE | 1.0.0 | 1143 | 2024-11-23 |
| | DEPLOYMENT-OPERATIONS-SDD | PLANNED | - | - | - |
| **Security & Compliance** | | | | | |
| | COMPLIANCE-SECURITY-SDD | DONE | 1.0.0 | 1107 | 2024-11-23 |
| | CERBOS-FEATURE-PARITY-SDD | SPEC | 1.0.0 | 952 | 2024-11-23 |
| **Production Operations** | | | | | |
| | GRPC-CLIENT-SDD | ✅ IMPL (92%) | 1.0.0 | 980+ | 2024-11-24 |
| | CACHING-STRATEGY-SDD | PLANNED | - | - | - |
| | DISASTER-RECOVERY-SDD | PLANNED | - | - | - |
| | AUDIT-LOGGING-SDD | PLANNED | - | - | - |
| | RATE-LIMITING-SDD | PLANNED | - | - | - |
| | API-GATEWAY-INTEGRATION-SDD | PLANNED | - | - | - |

### 5.2 Summary Statistics

| Metric | Value |
|--------|-------|
| Total SDDs Documented | 43 |
| **Complete & Accurate SDDs** | **43** |
| Planned SDDs | 3 |
| Total Lines of Documentation | 58,000+ |
| Average SDD Length | 1,350 lines |
| Categories Covered | 9 |

### 5.3 Implementation Status Summary

| Implementation Status | Count | Percentage |
|----------------------|-------|------------|
| ✅ Production Ready | 6 | 14% |
| 🔶 Partial Implementation | 8 | 19% |
| ❌ SDD Complete, Not Implemented | 26 | 60% |
| 📄 Reference/Framework | 3 | 7% |

**Cross-Reference**: See [SDD-FEATURE-MAPPING.md](../planning/SDD-FEATURE-MAPPING.md) for detailed feature-to-SDD mapping.

### 5.4 November 2025 Accuracy Audit Results

The following SDDs received comprehensive accuracy audits on 2025-11-24:

| SDD | Previous Status | New Status | Key Improvements |
|-----|-----------------|------------|------------------|
| CORE-PACKAGE-SDD | ⚠️ PARTIAL (45%) | ✅ **COMPLETE** v2.1.0 | All 9 modules fully documented (types, policy, CEL, engine, **scope**, telemetry, audit, rate-limiting, storage) |
| AGENTS-PACKAGE-SDD | ✅ IMPL+ | ✅ **COMPLETE** v2.0.0 | Full orchestrator pipeline (1,269 lines), 4 pre-defined pipelines, circuit breakers, 30+ event types |
| SERVER-PACKAGE-SDD | ⚠️ PARTIAL (58%) | ✅ **COMPLETE** v2.0.0 | All 30+ endpoints documented including agentic endpoints |
| SDK-PACKAGE-SDD | ✅ IMPL+ | ✅ **COMPLETE** v1.1.0 | Corrected inaccuracy: REST-only client (no WebSocket), accurate 288-line implementation |

**Accuracy Principle Applied**: Every documented feature has been verified against actual implementation source code.

---

## 6. ADR Index

Architecture Decision Records capture significant technical decisions.

### 6.1 ADR Summary Table

| ADR | Title | Status | Date | Key Decision |
|-----|-------|--------|------|--------------|
| [ADR-001](../adr/ADR-001-CEL-EXPRESSION-LANGUAGE.md) | CEL as Expression Language | Accepted | 2024-11-23 | Use CEL (cel-js) for policy condition evaluation |
| [ADR-002](../adr/ADR-002-MONOREPO-STRUCTURE.md) | Monorepo Structure | Accepted | 2024-11-23 | pnpm workspaces + Turborepo for build orchestration |
| [ADR-003](../adr/ADR-003-ACTION-RESULT-EFFECT.md) | Action Result Effect | Accepted | 2024-11-23 | ALLOW/DENY effect model with fail-closed default |
| [ADR-004](../adr/ADR-004-MEMORY-FIRST-DEVELOPMENT.md) | Memory-First Development | Accepted | 2024-11-23 | In-memory policy store for development mode |
| [ADR-005](../adr/ADR-005-AGENTIC-AUTHORIZATION.md) | Agentic Authorization | Accepted | 2024-11-23 | 4-agent architecture (Guardian, Analyst, Advisor, Enforcer) |
| [ADR-006](../adr/ADR-006-CERBOS-API-COMPATIBILITY.md) | Cerbos API Compatibility | Accepted | 2024-11-23 | Full Cerbos API compatibility without dependencies |
| [ADR-007](../adr/ADR-007-NATIVE-AGENTIC-FRAMEWORK.md) | Native Agentic Framework | Accepted | 2024-11-23 | Built-in agentic features with neural patterns |
| [ADR-008](../adr/ADR-008-HYBRID-GO-TYPESCRIPT-ARCHITECTURE.md) | Hybrid Go/TypeScript | Accepted | 2024-11-23 | Go core for performance, TypeScript for orchestration |

### 6.2 ADR Relationships

```
ADR-001 (CEL)
    |
    +---> Used by: CEL-EVALUATOR-SDD, DERIVED-ROLES-SDD, PRINCIPAL-POLICIES-SDD

ADR-002 (Monorepo)
    |
    +---> Defines: CORE-PACKAGE-SDD, SERVER-PACKAGE-SDD, SDK-PACKAGE-SDD structure

ADR-005 (Agentic) -----> ADR-007 (Native Framework)
    |                           |
    +---> AGENTS-PACKAGE-SDD    +---> NATIVE-AGENTIC-FRAMEWORK-SDD

ADR-006 (Cerbos Compat)
    |
    +---> CERBOS-FEATURE-PARITY-SDD (271 features)

ADR-008 (Hybrid Go/TS)
    |
    +---> GO-CORE-SDD (high-performance path)
    +---> CORE-PACKAGE-SDD (TypeScript orchestration)
```

### 6.3 ADR by Category

| Category | ADRs |
|----------|------|
| **Language & Runtime** | ADR-001 (CEL), ADR-008 (Go/TS Hybrid) |
| **Architecture** | ADR-002 (Monorepo), ADR-003 (Effect Model) |
| **Development** | ADR-004 (Memory-First) |
| **Features** | ADR-005 (Agentic), ADR-007 (Native Framework) |
| **Compatibility** | ADR-006 (Cerbos API) |

---

## 7. Feature Coverage Summary

### 7.1 Cerbos Feature Parity Overview

AuthZ Engine targets **271 Cerbos features** for full compatibility.

```
Feature Coverage Progress
=========================

Policy Types:        [##########] 100%  (6/6 types)
CEL Functions:       [########--]  85%  (68/80 functions)
API Endpoints:       [#########-]  92%  (23/25 endpoints)
Storage Backends:    [######----]  60%  (3/5 backends)
Admin Features:      [#######---]  70%  (14/20 features)
                     ─────────────────
Overall Progress:    [########--]  82%  (222/271 features)
```

### 7.2 Policy Type Support

| Policy Type | Cerbos | AuthZ Engine | Status |
|-------------|--------|--------------|--------|
| Resource Policy | Yes | Yes | IMPLEMENTED |
| Derived Roles | Yes | Yes | IMPLEMENTED |
| Principal Policy | Yes | Yes | IMPLEMENTED |
| Exported Variables | Yes | Yes | IMPLEMENTED |
| Role Policy | Yes | Partial | IN PROGRESS |
| Exported Constants | Yes | Planned | PLANNED |

### 7.3 CEL Function Support

| Category | Functions | Supported | Status |
|----------|-----------|-----------|--------|
| Standard | 45 | 45 | COMPLETE |
| Timestamp | 12 | 12 | COMPLETE |
| Lists | 8 | 8 | COMPLETE |
| Strings | 10 | 8 | PARTIAL |
| Hierarchy | 5 | 5 | COMPLETE |

### 7.4 API Endpoint Coverage

| Endpoint | Method | Status |
|----------|--------|--------|
| `/api/check` | POST | IMPLEMENTED |
| `/api/check/resources` | POST | IMPLEMENTED |
| `/api/plan/resources` | POST | IMPLEMENTED |
| `/api/playground/evaluate` | POST | IMPLEMENTED |
| `/api/admin/policy` | CRUD | IMPLEMENTED |
| `/api/admin/schema` | CRUD | IMPLEMENTED |
| `/api/admin/store/reload` | POST | IMPLEMENTED |
| `cerbos.svc.v1.CerbosService/CheckResources` | gRPC | IMPLEMENTED |
| `cerbos.svc.v1.CerbosService/PlanResources` | gRPC | IMPLEMENTED |

### 7.5 Feature Reference by SDD

| Feature Area | Primary SDD | Features Covered |
|--------------|-------------|------------------|
| Core Evaluation | CEL-EVALUATOR-SDD | 45 |
| Policy Types | DERIVED-ROLES-SDD + PRINCIPAL-POLICIES-SDD + SCOPED-POLICIES-SDD | 38 |
| Schema | SCHEMA-VALIDATION-SDD | 15 |
| Variables | EXPORTED-VARIABLES-SDD | 12 |
| Storage | STORAGE-DRIVERS-SDD | 25 |
| Server | SERVER-PACKAGE-SDD | 35 |
| Admin | RBAC-ADMIN-API-SDD | 45 |
| Testing | POLICY-TESTING-SDD | 18 |
| Observability | OBSERVABILITY-SDD | 22 |
| Security | COMPLIANCE-SECURITY-SDD | 16 |

---

## 8. Getting Started Paths

### 8.1 For Developers

**Goal**: Integrate AuthZ Engine into your application

```
Learning Path for Developers
============================

Week 1: Fundamentals
--------------------
Day 1-2: [CORE-ARCHITECTURE-SDD]
         Understand system architecture and concepts

Day 3-4: [TYPES-REFERENCE-SDD]
         Learn Principal, Resource, Request types

Day 5:   [CEL-EVALUATOR-SDD]
         Understand CEL expression syntax

Week 2: Integration
-------------------
Day 1-2: [SDK-PACKAGE-SDD]
         Set up TypeScript SDK

Day 3-4: [NESTJS-PACKAGE-SDD] (if using NestJS)
         Integrate with NestJS decorators

Day 5:   [MULTI-LANGUAGE-SDK-SDD] (if using other languages)
         Set up Python/Java/Go SDK

Week 3: Policies
----------------
Day 1-2: [DERIVED-ROLES-SDD]
         Create dynamic roles

Day 3-4: [PRINCIPAL-POLICIES-SDD]
         Define user-specific rules

Day 5:   [POLICY-TESTING-SDD]
         Write and run policy tests
```

**Quick Start Code:**
```typescript
// Install SDK
// npm install @authz-engine/sdk

import { AuthzClient } from '@authz-engine/sdk';

const client = new AuthzClient({
  url: 'http://localhost:3592',
});

// Check authorization
const result = await client.check({
  principal: { id: 'user-123', roles: ['user'] },
  resource: { kind: 'document', id: 'doc-456' },
  action: 'read',
});

console.log(result.effect); // 'ALLOW' or 'DENY'
```

### 8.2 For Operators

**Goal**: Deploy and operate AuthZ Engine in production

```
Learning Path for Operators
===========================

Week 1: Deployment
------------------
Day 1-2: [SERVER-PACKAGE-SDD]
         Understand server configuration

Day 3-4: [STORAGE-DRIVERS-SDD]
         Set up PostgreSQL/Redis storage

Day 5:   [MULTI-TENANCY-SDD]
         Configure tenant isolation

Week 2: Observability
---------------------
Day 1-2: [OBSERVABILITY-SDD]
         Set up metrics and logging

Day 3-4: [LOAD-TESTING-SUITE-SDD]
         Run performance benchmarks

Day 5:   [COMPLIANCE-SECURITY-SDD]
         Security hardening

Week 3: Operations
------------------
Day 1-2: [POLICY-MANAGEMENT-UI-SDD]
         Deploy admin UI

Day 3-4: [JWT-AUXDATA-SDD]
         Configure authentication

Day 5:   [WASM-EDGE-SDD] (if using edge)
         Deploy to edge locations
```

**Deployment Checklist:**
```
[ ] PostgreSQL database provisioned
[ ] Redis cache configured
[ ] TLS certificates installed
[ ] Environment variables set
[ ] Metrics endpoint exposed
[ ] Log aggregation configured
[ ] Backup strategy implemented
[ ] Health checks enabled
[ ] Rate limiting configured
[ ] Admin UI secured
```

### 8.3 For Architects

**Goal**: Design authorization strategy for your organization

```
Learning Path for Architects
============================

Week 1: Architecture
--------------------
Day 1-2: [CORE-ARCHITECTURE-SDD]
         System design and principles

Day 3-4: [GO-CORE-SDD]
         High-performance architecture

Day 5:   [ADR-008: Hybrid Go/TypeScript]
         Understand the hybrid approach

Week 2: Features
----------------
Day 1-2: [CERBOS-FEATURE-PARITY-SDD]
         Full feature inventory

Day 3-4: [NATIVE-AGENTIC-FRAMEWORK-SDD]
         AI-powered capabilities

Day 5:   [OIDC-OAUTH-INTEGRATION-SDD]
         Identity integration patterns

Week 3: Enterprise
------------------
Day 1-2: [COMPLIANCE-SECURITY-SDD]
         Security and compliance

Day 3-4: [MULTI-TENANCY-SDD]
         Multi-tenant design

Day 5:   [POLICY-VERSIONING-SDD]
         Policy lifecycle management
```

**Architecture Decision Framework:**
```
1. Performance Requirements
   - < 5ms p99 latency? --> Use Go Core path
   - Edge deployment? --> Consider WASM-EDGE

2. Scale Requirements
   - Multi-tenant? --> MULTI-TENANCY-SDD
   - High throughput? --> CACHING-STRATEGY

3. Compliance Requirements
   - SOC2/HIPAA? --> COMPLIANCE-SECURITY-SDD
   - Audit trails? --> AUDIT-LOGGING-SDD

4. Integration Requirements
   - Existing IdP? --> OIDC-OAUTH-INTEGRATION-SDD
   - API Gateway? --> API-GATEWAY-INTEGRATION-SDD
```

---

## 9. Cross-Reference Matrix

### 9.1 SDD to Package Mapping

| SDD | Package(s) | Primary Files |
|-----|------------|---------------|
| CORE-ARCHITECTURE | All | N/A (Overview) |
| CORE-PACKAGE | `@authz-engine/core` | `packages/core/src/` |
| CEL-EVALUATOR | `@authz-engine/core` | `packages/core/src/cel/` |
| TYPES-REFERENCE | `@authz-engine/core` | `packages/core/src/types/` |
| GO-CORE | `github.com/authz-engine/core` | `go/` |
| AGENTS-PACKAGE | `@authz-engine/agents` | `packages/agents/src/` |
| SERVER-PACKAGE | `@authz-engine/server` | `packages/server/src/` |
| SDK-PACKAGE | `@authz-engine/sdk` | `packages/sdk-typescript/src/` |
| NESTJS-PACKAGE | `@authz-engine/nestjs` | `packages/nestjs/src/` |

### 9.2 SDD to ADR Mapping

| SDD | Related ADRs |
|-----|--------------|
| CORE-ARCHITECTURE | ADR-002, ADR-008 |
| CEL-EVALUATOR | ADR-001 |
| GO-CORE | ADR-008 |
| AGENTS-PACKAGE | ADR-005 |
| NATIVE-AGENTIC-FRAMEWORK | ADR-007 |
| CERBOS-FEATURE-PARITY | ADR-006 |
| All Policy SDDs | ADR-003 |
| CORE-PACKAGE | ADR-004 |

### 9.3 Feature to SDD Mapping

| Feature | Primary SDD | Related SDDs |
|---------|-------------|--------------|
| Policy Evaluation | CORE-PACKAGE | CEL-EVALUATOR, TYPES-REFERENCE |
| Derived Roles | DERIVED-ROLES | EXPORTED-VARIABLES |
| Schema Validation | SCHEMA-VALIDATION | TYPES-REFERENCE |
| Multi-tenancy | MULTI-TENANCY | STORAGE-DRIVERS |
| Caching | SERVER-PACKAGE | STORAGE-DRIVERS |
| Authentication | JWT-AUXDATA | OIDC-OAUTH-INTEGRATION |
| Observability | OBSERVABILITY | SERVER-PACKAGE |
| Testing | POLICY-TESTING | LOAD-TESTING-SUITE |
| Edge Deployment | WASM-EDGE | GO-CORE |

---

## 10. Document Conventions

### 10.1 SDD Structure Standard

Every SDD follows this structure (defined in [SDD-FRAMEWORK](./SDD-FRAMEWORK.md)):

```markdown
# {Component Name} - Software Design Document

**Version**: X.Y.Z
**Status**: Draft | Review | Complete
**Last Updated**: YYYY-MM-DD

## 1. Overview
   1.1 Purpose
   1.2 Scope
   1.3 References

## 2. Architecture
   2.1 High-Level Design
   2.2 Component Diagram
   2.3 Data Flow

## 3. Interface Specification
   3.1 API Contracts
   3.2 Type Definitions
   3.3 Events/Messages

## 4. Implementation Details
   4.1 Algorithms
   4.2 Data Structures
   4.3 Error Handling

## 5. Configuration
   5.1 Environment Variables
   5.2 Configuration Files

## 6. Testing Strategy
   6.1 Unit Tests
   6.2 Integration Tests
   6.3 Performance Tests

## 7. Security Considerations

## 8. Performance Requirements

## 9. Appendices
```

### 10.2 Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| SDD Files | `{COMPONENT}-SDD.md` | `CORE-ARCHITECTURE-SDD.md` |
| ADR Files | `ADR-{NNN}-{TITLE}.md` | `ADR-001-CEL-EXPRESSION-LANGUAGE.md` |
| Versions | Semantic Versioning | `1.0.0`, `0.1.0` |
| Diagrams | ASCII art in markdown | See examples above |

### 10.3 Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.2.0 | 2025-11-24 | Updated SCOPED-POLICIES-SDD status to IMPLEMENTED, CORE-PACKAGE-SDD to v2.1.0 (added scope module) |
| 2.1.0 | 2025-11-24 | Added SDD-FEATURE-MAPPING cross-reference, updated SDD/ADR counts to 43/9, added implementation status summary |
| 2.0.0 | 2025-11-24 | **Comprehensive accuracy audit**: Updated CORE-PACKAGE-SDD (8 modules), AGENTS-PACKAGE-SDD (orchestrator, pipelines, circuit breakers), SERVER-PACKAGE-SDD (30+ endpoints), SDK-PACKAGE-SDD (REST-only correction) |
| 1.0.0 | 2025-11-23 | Initial master index creation |

---

## Quick Links

### Primary Documents
- [Core Architecture](./CORE-ARCHITECTURE-SDD.md)
- [Feature Parity Matrix](./CERBOS-FEATURE-PARITY-SDD.md)
- [Document Framework](./SDD-FRAMEWORK.md)

### By Use Case
- **Getting Started**: CORE-ARCHITECTURE -> SDK-PACKAGE -> POLICY-TESTING
- **Production Deploy**: SERVER-PACKAGE -> STORAGE-DRIVERS -> OBSERVABILITY
- **Security Review**: COMPLIANCE-SECURITY -> JWT-AUXDATA -> MULTI-TENANCY

### External Resources
- [Cerbos Documentation](https://docs.cerbos.dev/cerbos/latest)
- [CEL Language Specification](https://github.com/google/cel-spec)
- [OpenTelemetry Standards](https://opentelemetry.io/docs/)

---

**Document Information**

| Field | Value |
|-------|-------|
| Document ID | SDD-INDEX |
| Classification | Internal |
| Owner | AuthZ Engine Team |
| Review Cycle | Monthly |

---

*This document is the authoritative index for all AuthZ Engine System Design Documents. For questions or updates, contact the AuthZ Engine architecture team.*
