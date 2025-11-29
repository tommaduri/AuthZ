# Software Design Document (SDD) Framework

## AuthZ Engine - Documentation Standards

**Version**: 1.0.0
**Created**: 2024-11-23
**Maintained By**: AuthZ Engine Team

---

## 1. Purpose

This document defines the standard structure and guidelines for all Software Design Documents (SDDs) in the AuthZ Engine project. Every module, package, and significant component MUST have an accompanying SDD before implementation begins.

## 2. SDD Template Structure

Each SDD MUST contain the following sections:

### 2.1 Header Section
```markdown
# [Component Name] - Software Design Document

**Module**: `@authz-engine/[package-name]`
**Version**: X.Y.Z
**Status**: Draft | Review | Approved | Implemented
**Author**: [Name]
**Created**: YYYY-MM-DD
**Last Updated**: YYYY-MM-DD
**Reviewers**: [Names]

---
```

### 2.2 Required Sections

| Section | Description | Required |
|---------|-------------|----------|
| 1. Overview | Purpose, scope, and context | YES |
| 2. Requirements | Functional and non-functional requirements | YES |
| 3. Architecture | High-level design and component relationships | YES |
| 4. Component Design | Detailed design of each component | YES |
| 5. Interfaces | Public APIs, types, and contracts | YES |
| 6. Data Models | Data structures and schemas | YES |
| 7. Error Handling | Error types, codes, and recovery strategies | YES |
| 8. Security Considerations | Security measures and threat model | YES |
| 9. Performance Requirements | Latency, throughput, memory targets | YES |
| 10. Testing Strategy | Unit, integration, e2e test approach | YES |
| 11. Dependencies | External and internal dependencies | YES |
| 12. Deployment | Configuration and deployment notes | OPTIONAL |
| 13. Appendices | Additional diagrams, examples | OPTIONAL |

---

## 3. Section Guidelines

### 3.1 Overview
- **Purpose**: Why this component exists
- **Scope**: What it does and doesn't do
- **Context**: How it fits into the larger system
- **Key Decisions**: Major architectural choices made

```markdown
## 1. Overview

### 1.1 Purpose
[Clear statement of why this component exists]

### 1.2 Scope
**In Scope:**
- [Feature 1]
- [Feature 2]

**Out of Scope:**
- [Non-feature 1]
- [Non-feature 2]

### 1.3 Context
[Description of how this fits into the larger AuthZ Engine system]

### 1.4 Key Decisions
| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| [Decision 1] | [Why] | [Other options] |
```

### 3.2 Requirements

```markdown
## 2. Requirements

### 2.1 Functional Requirements
| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-001 | [Requirement description] | Must Have | Implemented |
| FR-002 | [Requirement description] | Should Have | Pending |

### 2.2 Non-Functional Requirements
| ID | Category | Requirement | Target |
|----|----------|-------------|--------|
| NFR-001 | Performance | Response time | < 5ms p99 |
| NFR-002 | Reliability | Uptime | 99.9% |
| NFR-003 | Security | Input validation | All inputs sanitized |
```

### 3.3 Architecture

```markdown
## 3. Architecture

### 3.1 Component Diagram
[ASCII diagram or link to image]

### 3.2 Component Responsibilities
| Component | Responsibility |
|-----------|----------------|
| [Name] | [What it does] |

### 3.3 Data Flow
[Sequence diagram or description of data flow]

### 3.4 Integration Points
| Integration | Protocol | Direction |
|-------------|----------|-----------|
| [System] | [HTTP/gRPC/etc] | [In/Out/Both] |
```

### 3.4 Interfaces

```markdown
## 5. Interfaces

### 5.1 Public API

#### [Function/Method Name]
```typescript
/**
 * [Description]
 * @param param1 - [Description]
 * @returns [Description]
 * @throws [Error conditions]
 */
function methodName(param1: Type): ReturnType;
```

### 5.2 Type Definitions
```typescript
interface TypeName {
  field1: string;
  field2: number;
}
```

### 5.3 Events (if applicable)
| Event | Payload | Trigger |
|-------|---------|---------|
| [Event name] | [Type] | [When emitted] |
```

### 3.5 Error Handling

```markdown
## 7. Error Handling

### 7.1 Error Types
| Error Code | Name | Description | Recovery |
|------------|------|-------------|----------|
| ERR_001 | [Name] | [Description] | [How to recover] |

### 7.2 Error Hierarchy
```typescript
class AuthzError extends Error {
  code: string;
  context: Record<string, unknown>;
}

class PolicyError extends AuthzError { }
class CELError extends AuthzError { }
```

### 7.3 Error Logging
[What gets logged, at what level]
```

### 3.6 Testing Strategy

```markdown
## 10. Testing Strategy

### 10.1 Unit Tests
| Component | Coverage Target | Test File |
|-----------|-----------------|-----------|
| [Name] | 90% | [path] |

### 10.2 Integration Tests
| Scenario | Components Involved | Test File |
|----------|---------------------|-----------|
| [Scenario] | [Components] | [path] |

### 10.3 Test Data
[Description of test fixtures and mocks]

### 10.4 Performance Tests
| Test | Target | Current |
|------|--------|---------|
| [Name] | [Target] | [Actual] |
```

---

## 4. SDD Workflow

### 4.1 Creation Process
1. **Draft**: Author creates initial SDD using this template
2. **Review**: Technical reviewers provide feedback
3. **Approval**: Lead architect approves the design
4. **Implementation**: Development begins (SDD status → "Implementing")
5. **Validation**: Verify implementation matches SDD
6. **Completion**: SDD status → "Implemented"

### 4.2 Change Management
- All changes to approved SDDs require review
- Breaking changes require new ADR (Architecture Decision Record)
- Version history must be maintained

### 4.3 Naming Convention
```
[PACKAGE]-[COMPONENT]-SDD.md

Examples:
- CORE-CEL-EVALUATOR-SDD.md
- AGENTS-GUARDIAN-SDD.md
- SERVER-REST-API-SDD.md
```

---

## 5. SDD Index

### 5.1 Core Package (`@authz-engine/core`)

**Description**: Core authorization engine providing CEL expression evaluation, decision engine, and policy parsing.

**Source Location**: `packages/core/src/`

| Document | Status | Version | Description |
|----------|--------|---------|-------------|
| [CORE-PACKAGE-SDD.md](./CORE-PACKAGE-SDD.md) | Implemented | 1.0.0 | **Comprehensive package SDD** - Types, CEL evaluator, decision engine |
| [CORE-ARCHITECTURE-SDD.md](./CORE-ARCHITECTURE-SDD.md) | Implemented | 1.0.0 | System architecture overview |
| [CEL-EVALUATOR-SDD.md](./CEL-EVALUATOR-SDD.md) | Implemented | 1.0.0 | CEL expression evaluation |
| [TYPES-REFERENCE-SDD.md](./TYPES-REFERENCE-SDD.md) | Implemented | 1.0.0 | Core type definitions |

#### Implemented Components

| Component | Source File | Description |
|-----------|-------------|-------------|
| CelEvaluator | `src/cel/evaluator.ts` | Evaluates CEL expressions with custom functions |
| DecisionEngine | `src/engine/decision-engine.ts` | Core authorization decision logic with deny-overrides |
| PolicySchema | `src/policy/schema.ts` | Zod schemas for policy validation |
| Types | `src/types/policy.types.ts` | Policy, Principal, Resource, ActionResult types |

#### Key Exports
```typescript
// From @authz-engine/core
export { CelEvaluator, type EvaluationContext } from './cel/evaluator';
export { DecisionEngine, decisionEngine } from './engine/decision-engine';
export { validateResourcePolicy, validateDerivedRolesPolicy } from './policy/schema';
export type { CheckRequest, CheckResponse, Principal, Resource, Effect, ActionResult } from './types';
```

---

### 5.2 Agents Package (`@authz-engine/agents`)

**Description**: Intelligent authorization agents that provide anomaly detection, pattern learning, LLM explanations, and autonomous enforcement.

**Source Location**: `packages/agents/src/`

| Document | Status | Version | Description |
|----------|--------|---------|-------------|
| [AGENTS-PACKAGE-SDD.md](./AGENTS-PACKAGE-SDD.md) | Implemented | 1.0.0 | **Comprehensive package SDD** - All 4 agents, orchestrator, infrastructure |
| AGENTS-ARCHITECTURE-SDD.md | Implemented | 1.0.0 | Agent system architecture |

#### Implemented Agents

| Agent | Source File | Responsibility |
|-------|-------------|----------------|
| **GuardianAgent** | `src/guardian/guardian-agent.ts` | Anomaly detection, velocity tracking, risk scoring |
| **AnalystAgent** | `src/analyst/analyst-agent.ts` | Pattern learning, policy optimization suggestions |
| **AdvisorAgent** | `src/advisor/advisor-agent.ts` | LLM explanations, natural language policy queries |
| **EnforcerAgent** | `src/enforcer/enforcer-agent.ts` | Rate limiting, blocking, enforcement actions |
| **AgentOrchestrator** | `src/orchestrator/agent-orchestrator.ts` | Coordinates all agents, unified API |

#### Core Infrastructure

| Component | Source File | Description |
|-----------|-------------|-------------|
| BaseAgent | `src/core/base-agent.ts` | Abstract base class for all agents |
| DecisionStore | `src/core/decision-store.ts` | Persistent storage for decisions and anomalies |
| EventBus | `src/core/event-bus.ts` | Inter-agent communication |

#### Agent Types Summary

**GUARDIAN Agent** (`guardian-agent.ts:45-656`)
- Detects unusual access patterns and velocity anomalies
- Computes risk scores for authorization decisions
- Triggers alerts based on anomaly threshold (default: 0.7)
- Maintains principal baselines for deviation detection
- Anomaly types: velocity_spike, permission_escalation, pattern_deviation, unusual_access_time

**ANALYST Agent** (`analyst-agent.ts:39-551`)
- Learns access patterns from decision history
- Discovers correlations (temporal, role clusters, denial patterns)
- Suggests policy optimizations based on learned patterns
- Configurable confidence threshold (default: 0.8)
- Pattern types: access_correlation, temporal_pattern, role_cluster, denial_pattern

**ADVISOR Agent** (`advisor-agent.ts:44-532`)
- Generates natural language explanations for decisions
- Supports OpenAI and Anthropic LLM providers
- Computes "path to allow" for denied requests
- Answers policy questions in natural language
- Caches explanations for performance

**ENFORCER Agent** (`enforcer-agent.ts:49-551`)
- Executes protective actions autonomously or with approval
- Rate limits suspicious principals (default: 15 minutes)
- Temporarily blocks high-risk sessions (default: 1 hour)
- Supports rollback of enforcement actions
- Action types: rate_limit, temporary_block, require_mfa, alert_admin, revoke_session

#### Key Exports
```typescript
// From @authz-engine/agents
export { AgentOrchestrator, type ProcessingResult } from './orchestrator/agent-orchestrator';
export { GuardianAgent } from './guardian/guardian-agent';
export { AnalystAgent } from './analyst/analyst-agent';
export { AdvisorAgent } from './advisor/advisor-agent';
export { EnforcerAgent } from './enforcer/enforcer-agent';
export type { AgentConfig, Anomaly, LearnedPattern, EnforcerAction, DecisionExplanation } from './types';
```

---

### 5.3 Server Package (`@authz-engine/server`)

**Description**: HTTP REST and gRPC server exposing the authorization engine with policy hot-reload support.

**Source Location**: `packages/server/src/`

| Document | Status | Version | Description |
|----------|--------|---------|-------------|
| [SERVER-PACKAGE-SDD.md](./SERVER-PACKAGE-SDD.md) | Implemented | 1.0.0 | **Comprehensive package SDD** - REST, gRPC, policy loader, health checks |
| SERVER-ARCHITECTURE-SDD.md | Implemented | 1.0.0 | Server architecture |

#### Implemented Components

| Component | Source File | Description |
|-----------|-------------|-------------|
| REST Server | `src/rest/` | Fastify-based REST API |
| gRPC Server | `src/grpc/server.ts` | @grpc/grpc-js based gRPC service |
| PolicyLoader | `src/policy/loader.ts` | YAML policy loading with watch support |
| Server Entry | `src/index.ts` | Main server startup |

#### API Endpoints

**REST API**
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/check` | POST | Single authorization check |
| `/v1/check/resources` | POST | Batch resource checks |
| `/v1/explain` | POST | Decision explanation (with agents) |
| `/health/live` | GET | Liveness probe |
| `/health/ready` | GET | Readiness probe |
| `/agents/health` | GET | Agent health status |
| `/agents/anomalies` | GET | List detected anomalies |
| `/agents/patterns` | GET | List discovered patterns |

**gRPC Service** (`src/grpc/server.ts`)
```protobuf
service AuthzService {
  rpc Check(CheckRequest) returns (CheckResponse);
  rpc CheckResources(CheckResourcesRequest) returns (CheckResourcesResponse);
}
```

#### Key Exports
```typescript
// From @authz-engine/server
export { createServer, startServer } from './index';
export { PolicyLoader } from './policy/loader';
```

---

### 5.4 SDK Package (`@authz-engine/sdk-typescript`)

**Description**: TypeScript client library for integrating with the AuthZ Engine.

**Source Location**: `packages/sdk-typescript/src/`

| Document | Status | Version | Description |
|----------|--------|---------|-------------|
| [SDK-PACKAGE-SDD.md](./SDK-PACKAGE-SDD.md) | Implemented | 1.0.0 | **Comprehensive package SDD** - Client, retry logic, error handling |
| SDK-CLIENT-SDD.md | Implemented | 1.0.0 | SDK architecture |

#### Implemented Components

| Component | Source File | Description |
|-----------|-------------|-------------|
| AuthzClient | `src/client.ts` | HTTP client with retry and caching |
| Types | `src/types/` | Request/response type definitions |

#### Key Features
- Automatic retry with exponential backoff
- Response caching (configurable TTL)
- Circuit breaker pattern
- Both REST and gRPC transport support

#### Key Exports
```typescript
// From @authz-engine/sdk-typescript
export { AuthzClient, type AuthzClientConfig } from './client';
export type { CheckRequest, CheckResponse } from './types';
```

---

### 5.5 NestJS Package (`@authz-engine/nestjs`)

**Description**: NestJS integration module with decorators, guards, and dependency injection.

**Source Location**: `packages/nestjs/src/`

| Document | Status | Version | Description |
|----------|--------|---------|-------------|
| [NESTJS-PACKAGE-SDD.md](./NESTJS-PACKAGE-SDD.md) | Implemented | 1.0.0 | **Comprehensive package SDD** - Module, guard, all decorators |
| NESTJS-MODULE-SDD.md | Implemented | 1.0.0 | Module architecture |

#### Implemented Components

| Component | Source File | Description |
|-----------|-------------|-------------|
| AuthzModule | `src/authz.module.ts` | NestJS module with forRoot/forRootAsync |
| AuthzGuard | `src/authz.guard.ts` | CanActivate guard for route protection |
| @Authorize() | `src/decorators.ts` | Method decorator for authorization |
| @AuthzResource() | `src/decorators.ts` | Parameter decorator for resource injection |

#### Usage Example
```typescript
// app.module.ts
@Module({
  imports: [
    AuthzModule.forRoot({
      serverUrl: 'http://authz-engine:3592',
    }),
  ],
})
export class AppModule {}

// controller.ts
@Controller('subscriptions')
export class SubscriptionController {
  @Authorize({ resource: 'subscription', action: 'create' })
  @Post()
  async create() { /* ... */ }
}
```

#### Key Exports
```typescript
// From @authz-engine/nestjs
export { AuthzModule, type AuthzModuleOptions } from './authz.module';
export { AuthzGuard } from './authz.guard';
export { Authorize, AuthzResource, AuthzPrincipal } from './decorators';
```

---

## 6. Architecture Decision Records (ADRs)

ADRs document significant architectural decisions. See [../adr/INDEX.md](../adr/INDEX.md) for the full list.

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [ADR-001](../adr/ADR-001-CEL-EXPRESSION-LANGUAGE.md) | CEL as Expression Language | Accepted | 2024-11-23 |
| [ADR-002](../adr/ADR-002-MONOREPO-STRUCTURE.md) | Monorepo Structure with pnpm | Accepted | 2024-11-23 |
| [ADR-003](../adr/ADR-003-ACTION-RESULT-EFFECT.md) | ActionResult uses effect not allowed | Accepted | 2024-11-23 |
| [ADR-004](../adr/ADR-004-MEMORY-FIRST-DEVELOPMENT.md) | Memory-first Development Mode | Accepted | 2024-11-23 |
| [ADR-005](../adr/ADR-005-AGENTIC-AUTHORIZATION.md) | Agentic Authorization Architecture | Accepted | 2024-11-23 |
| [ADR-006](../adr/ADR-006-CERBOS-API-COMPATIBILITY.md) | Cerbos API Compatibility | Accepted | 2024-11-23 |

---

## 7. Documentation Quality Checklist

Before marking an SDD as "Approved", verify:

- [ ] All required sections are complete
- [ ] Code examples are tested and accurate
- [ ] Type definitions match actual implementation
- [ ] Error codes are documented
- [ ] Performance targets are specified
- [ ] Security considerations are addressed
- [ ] Dependencies are listed with versions
- [ ] Testing strategy is defined
- [ ] Diagrams are clear and up-to-date
- [ ] Version history is maintained

---

## 8. Cerbos Feature Parity Documents

These documents ensure full compatibility with Cerbos features. **271 features tracked** across 9 categories.

### 8.1 Core Feature SDDs

| Document | Description | Status |
|----------|-------------|--------|
| [CERBOS-FEATURE-PARITY-SDD.md](./CERBOS-FEATURE-PARITY-SDD.md) | Complete Cerbos feature specification | ✅ Complete |
| [PLAN-RESOURCES-API-SDD.md](./PLAN-RESOURCES-API-SDD.md) | PlanResources API & query planning | ✅ Complete |
| [POLICY-TESTING-SDD.md](./POLICY-TESTING-SDD.md) | Policy testing framework (compile, run, fixtures) | ✅ Complete |
| [OBSERVABILITY-SDD.md](./OBSERVABILITY-SDD.md) | Prometheus metrics, OpenTelemetry tracing, audit logging | ✅ Complete |

### 8.2 Policy Type SDDs

| Document | Description | Status |
|----------|-------------|--------|
| [SCOPED-POLICIES-SDD.md](./SCOPED-POLICIES-SDD.md) | Hierarchical scoped policies for multi-tenant | ✅ Complete |
| [PRINCIPAL-POLICIES-SDD.md](./PRINCIPAL-POLICIES-SDD.md) | User-specific permission policies | ✅ Complete |
| [DERIVED-ROLES-SDD.md](./DERIVED-ROLES-SDD.md) | Dynamic role computation & ReBAC patterns | ✅ Complete |
| [EXPORTED-VARIABLES-SDD.md](./EXPORTED-VARIABLES-SDD.md) | Shared variables & constants across policies | ✅ Complete |

### 8.3 Infrastructure SDDs

| Document | Description | Status |
|----------|-------------|--------|
| [JWT-AUXDATA-SDD.md](./JWT-AUXDATA-SDD.md) | JWT validation, JWKS, auxiliary data handling | ✅ Complete |
| [SCHEMA-VALIDATION-SDD.md](./SCHEMA-VALIDATION-SDD.md) | JSON Schema validation for principals/resources | ✅ Complete |
| [STORAGE-DRIVERS-SDD.md](./STORAGE-DRIVERS-SDD.md) | File, Git, database, blob storage drivers | ✅ Complete |
| [MULTI-TENANCY-SDD.md](./MULTI-TENANCY-SDD.md) | Multi-tenant isolation & configuration | ✅ Complete |

### 8.4 Advanced Feature SDDs

| Document | Description | Status |
|----------|-------------|--------|
| [WASM-EDGE-SDD.md](./WASM-EDGE-SDD.md) | WebAssembly build, edge deployment, offline support | ✅ Complete |
| [COMPLIANCE-SECURITY-SDD.md](./COMPLIANCE-SECURITY-SDD.md) | HIPAA, PCI-DSS, SOC 2, GDPR compliance | ✅ Complete |

### 8.5 Coverage Tracking

| Document | Description | Status |
|----------|-------------|--------|
| [../CERBOS-FEATURE-COVERAGE-MATRIX.md](../CERBOS-FEATURE-COVERAGE-MATRIX.md) | Feature coverage tracking (271 features) | ✅ Complete |

### Feature Coverage Summary

| Category | SDD Coverage | Features | Notes |
|----------|--------------|----------|-------|
| Policy Types | 100% | 40 | All policy types have dedicated SDDs |
| CEL Functions | 100% | 55 | Covered in CEL-EVALUATOR-SDD |
| API Endpoints | 100% | 25 | Covered in SERVER-PACKAGE-SDD + PLAN-RESOURCES-API-SDD |
| Storage/Config | 100% | 28 | Covered in STORAGE-DRIVERS-SDD |
| SDK Features | 100% | 16 | Covered in SDK-PACKAGE-SDD |
| Policy Testing | 100% | 20 | Covered in POLICY-TESTING-SDD |
| Observability | 100% | 22 | Covered in OBSERVABILITY-SDD |
| Deployment/CLI | 100% | 18 | Covered in WASM-EDGE-SDD |
| Advanced Features | 100% | 47 | Covered in COMPLIANCE-SECURITY-SDD + MULTI-TENANCY-SDD |
| **TOTAL SDD COVERAGE** | **100%** | **271** | **All features have SDD documentation** |

**Total SDDs**: 23 documents
**Last updated**: 2025-11-23

---

## 9. Related Documents

- [PHASE1-IMPLEMENTATION-PLAN.md](../PHASE1-IMPLEMENTATION-PLAN.md) - Project roadmap
- [SDD-ENTERPRISE-AUTHZ-ENGINE.md](../SDD-ENTERPRISE-AUTHZ-ENGINE.md) - Master SDD
- [AGENTIC_AUTHZ_VISION.md](../AGENTIC_AUTHZ_VISION.md) - Agentic features vision
- [api-reference.md](../api-reference.md) - API documentation

---

*This framework ensures consistent, comprehensive documentation across all AuthZ Engine components.*
