# Architecture Decision Records Index

**Last Updated**: 2024-11-25
**Total ADRs**: 10

---

## ADR Status Legend

| Status | Meaning |
|--------|---------|
| Accepted | Decision approved and being implemented |
| Implemented | Decision fully implemented |
| Superseded | Replaced by newer decision |
| Deprecated | No longer relevant |

---

## ADR List

| ADR | Title | Status | Related SDDs |
|-----|-------|--------|--------------|
| [ADR-001](./ADR-001-CEL-EXPRESSION-LANGUAGE.md) | CEL as Expression Language | Implemented | [CEL-EVALUATOR-SDD](../sdd/CEL-EVALUATOR-SDD.md) |
| [ADR-002](./ADR-002-MONOREPO-STRUCTURE.md) | Monorepo Structure with pnpm | Implemented | All package SDDs |
| [ADR-003](./ADR-003-ACTION-RESULT-EFFECT.md) | ActionResult uses effect | Implemented | [TYPES-REFERENCE-SDD](../sdd/TYPES-REFERENCE-SDD.md) |
| [ADR-004](./ADR-004-MEMORY-FIRST-DEVELOPMENT.md) | Memory-first Development | Implemented | [CORE-PACKAGE-SDD](../sdd/CORE-PACKAGE-SDD.md) |
| [ADR-005](./ADR-005-AGENTIC-AUTHORIZATION.md) | Agentic Authorization | Implemented | [AGENTS-PACKAGE-SDD](../sdd/AGENTS-PACKAGE-SDD.md) |
| [ADR-006](./ADR-006-CERBOS-API-COMPATIBILITY.md) | Cerbos API Compatibility | Implemented | [CERBOS-FEATURE-PARITY-SDD](../sdd/CERBOS-FEATURE-PARITY-SDD.md) |
| [ADR-007](./ADR-007-NATIVE-AGENTIC-FRAMEWORK.md) | Native Agentic Framework | Implemented | [AGENTS-PACKAGE-SDD](../sdd/AGENTS-PACKAGE-SDD.md) |
| [ADR-008](./ADR-008-HYBRID-GO-TYPESCRIPT-ARCHITECTURE.md) | Hybrid Go/TypeScript Architecture | Accepted | [CORE-ARCHITECTURE-SDD](../sdd/CORE-ARCHITECTURE-SDD.md) |
| [ADR-009](./ADR-009-CEL-LIBRARY-CHOICE.md) | CEL Library Choice (cel-js) | Implemented | [CEL-EVALUATOR-SDD](../sdd/CEL-EVALUATOR-SDD.md) |
| [ADR-010](./ADR-010-VECTOR-STORE-PRODUCTION-STRATEGY.md) | Vector Store Production Strategy | **Accepted** | [MEMORY-PACKAGE-SDD](../sdd/MEMORY-PACKAGE-SDD.md) |

---

## ADR Summaries

### ADR-001: CEL as Expression Language
**Decision**: Use Common Expression Language (CEL) via cel-js for policy conditions.
**Rationale**: Industry standard, Cerbos compatible, good TypeScript support.
**Implementation**: [CEL-EVALUATOR-SDD](../sdd/CEL-EVALUATOR-SDD.md)

### ADR-002: Monorepo Structure
**Decision**: Use pnpm workspaces monorepo with 5 packages.
**Rationale**: Code sharing, atomic commits, simplified dependency management.
**Packages**: core, agents, server, sdk-typescript, nestjs

### ADR-003: ActionResult Effect Field
**Decision**: Use `effect: 'EFFECT_ALLOW' | 'EFFECT_DENY'` instead of `allowed: boolean`.
**Rationale**: Cerbos API compatibility, explicit semantics.
**Implementation**: [TYPES-REFERENCE-SDD](../sdd/TYPES-REFERENCE-SDD.md)

### ADR-004: Memory-first Development
**Decision**: Store policies in memory during development, no external dependencies.
**Rationale**: Fast iteration, simple testing, easy local development.
**Production**: [STORAGE-DRIVERS-SDD](../sdd/STORAGE-DRIVERS-SDD.md) for persistence

### ADR-005: Agentic Authorization
**Decision**: Implement 4 intelligent agents (Guardian, Analyst, Advisor, Enforcer).
**Rationale**: Differentiation from Cerbos, learning capabilities, anomaly detection.
**Implementation**: [AGENTS-PACKAGE-SDD](../sdd/AGENTS-PACKAGE-SDD.md)

### ADR-006: Cerbos API Compatibility
**Decision**: Maintain wire compatibility with Cerbos API for SDK interoperability.
**Rationale**: Easy migration, ecosystem compatibility, proven design.
**Implementation**: [CERBOS-FEATURE-PARITY-SDD](../sdd/CERBOS-FEATURE-PARITY-SDD.md), 271 features tracked

### ADR-007: Native Agentic Framework
**Decision**: Build native agentic capabilities without external AI dependencies.
**Rationale**: No external LLM calls, deterministic behavior, low latency.
**Implementation**: [AGENTS-PACKAGE-SDD](../sdd/AGENTS-PACKAGE-SDD.md)

### ADR-008: Hybrid Go/TypeScript Architecture
**Decision**: High-performance Go core with TypeScript orchestration layer.
**Rationale**: Go for speed (sub-ms decisions), TypeScript for ecosystem integration.
**Implementation**: [CORE-ARCHITECTURE-SDD](../sdd/CORE-ARCHITECTURE-SDD.md)
**Note**: Both implementations maintain feature parity. Go Phase 3 complete (86/89 tests).

### ADR-009: CEL Library Choice
**Decision**: Use cel-js library for CEL expression evaluation (TypeScript), google/cel-go (Go).
**Rationale**: TypeScript: cel-js (MIT, good performance). Go: google/cel-go (official, production-ready).
**Implementation**: [CEL-EVALUATOR-SDD](../sdd/CEL-EVALUATOR-SDD.md)
**Note**: Both implementations use CEL standard library. Go implementation validated in Phase 3 (30 integration tests).

---

## ADR to SDD Mapping

This table shows how each ADR drives specific implementation work documented in SDDs:

| ADR | Primary SDD | Supporting SDDs |
|-----|-------------|-----------------|
| ADR-001 (CEL) | [CEL-EVALUATOR-SDD](../sdd/CEL-EVALUATOR-SDD.md) | [CORE-ARCHITECTURE-SDD](../sdd/CORE-ARCHITECTURE-SDD.md), [DERIVED-ROLES-SDD](../sdd/DERIVED-ROLES-SDD.md) |
| ADR-002 (Monorepo) | All Package SDDs | [CORE-PACKAGE-SDD](../sdd/CORE-PACKAGE-SDD.md), [SERVER-PACKAGE-SDD](../sdd/SERVER-PACKAGE-SDD.md), [SDK-PACKAGE-SDD](../sdd/SDK-PACKAGE-SDD.md), [NESTJS-PACKAGE-SDD](../sdd/NESTJS-PACKAGE-SDD.md), [AGENTS-PACKAGE-SDD](../sdd/AGENTS-PACKAGE-SDD.md) |
| ADR-003 (Effect) | [TYPES-REFERENCE-SDD](../sdd/TYPES-REFERENCE-SDD.md) | [CERBOS-FEATURE-PARITY-SDD](../sdd/CERBOS-FEATURE-PARITY-SDD.md) |
| ADR-004 (Memory-first) | [CORE-PACKAGE-SDD](../sdd/CORE-PACKAGE-SDD.md) | [STORAGE-DRIVERS-SDD](../sdd/STORAGE-DRIVERS-SDD.md), [POLICY-TESTING-SDD](../sdd/POLICY-TESTING-SDD.md) |
| ADR-005 (Agentic) | [AGENTS-PACKAGE-SDD](../sdd/AGENTS-PACKAGE-SDD.md) | [OBSERVABILITY-SDD](../sdd/OBSERVABILITY-SDD.md), [COMPLIANCE-SECURITY-SDD](../sdd/COMPLIANCE-SECURITY-SDD.md) |
| ADR-006 (Cerbos API) | [CERBOS-FEATURE-PARITY-SDD](../sdd/CERBOS-FEATURE-PARITY-SDD.md) | [PLAN-RESOURCES-API-SDD](../sdd/PLAN-RESOURCES-API-SDD.md), [SCHEMA-VALIDATION-SDD](../sdd/SCHEMA-VALIDATION-SDD.md), [JWT-AUXDATA-SDD](../sdd/JWT-AUXDATA-SDD.md) |
| ADR-007 (Native Agentic) | [AGENTS-PACKAGE-SDD](../sdd/AGENTS-PACKAGE-SDD.md) | [OBSERVABILITY-SDD](../sdd/OBSERVABILITY-SDD.md) |
| ADR-008 (Hybrid Architecture) | [CORE-ARCHITECTURE-SDD](../sdd/CORE-ARCHITECTURE-SDD.md) | [SERVER-PACKAGE-SDD](../sdd/SERVER-PACKAGE-SDD.md) |
| ADR-009 (cel-js) | [CEL-EVALUATOR-SDD](../sdd/CEL-EVALUATOR-SDD.md) | [CORE-PACKAGE-SDD](../sdd/CORE-PACKAGE-SDD.md) |

---

## All SDDs Reference

Complete list of Software Design Documents implementing these decisions:

### Core SDDs
| SDD | Description | Related ADRs |
|-----|-------------|--------------|
| [CORE-ARCHITECTURE-SDD](../sdd/CORE-ARCHITECTURE-SDD.md) | Overall system architecture | ADR-001, ADR-002 |
| [CORE-PACKAGE-SDD](../sdd/CORE-PACKAGE-SDD.md) | Core package implementation | ADR-002, ADR-004 |
| [TYPES-REFERENCE-SDD](../sdd/TYPES-REFERENCE-SDD.md) | Type definitions | ADR-003, ADR-006 |
| [CEL-EVALUATOR-SDD](../sdd/CEL-EVALUATOR-SDD.md) | CEL expression engine | ADR-001 |

### Package SDDs
| SDD | Description | Related ADRs |
|-----|-------------|--------------|
| [AGENTS-PACKAGE-SDD](../sdd/AGENTS-PACKAGE-SDD.md) | Agentic authorization agents | ADR-005 |
| [SERVER-PACKAGE-SDD](../sdd/SERVER-PACKAGE-SDD.md) | gRPC/REST server | ADR-002, ADR-006 |
| [SDK-PACKAGE-SDD](../sdd/SDK-PACKAGE-SDD.md) | TypeScript SDK | ADR-002, ADR-006 |
| [NESTJS-PACKAGE-SDD](../sdd/NESTJS-PACKAGE-SDD.md) | NestJS integration | ADR-002 |

### Feature SDDs
| SDD | Description | Related ADRs |
|-----|-------------|--------------|
| [CERBOS-FEATURE-PARITY-SDD](../sdd/CERBOS-FEATURE-PARITY-SDD.md) | 271 Cerbos features | ADR-006 |
| [PLAN-RESOURCES-API-SDD](../sdd/PLAN-RESOURCES-API-SDD.md) | PlanResources API | ADR-006 |
| [DERIVED-ROLES-SDD](../sdd/DERIVED-ROLES-SDD.md) | Dynamic role derivation | ADR-001, ADR-006 |
| [PRINCIPAL-POLICIES-SDD](../sdd/PRINCIPAL-POLICIES-SDD.md) | User-specific policies | ADR-006 |
| [SCOPED-POLICIES-SDD](../sdd/SCOPED-POLICIES-SDD.md) | Tenant-scoped policies | ADR-006 |
| [EXPORTED-VARIABLES-SDD](../sdd/EXPORTED-VARIABLES-SDD.md) | Cross-policy variables | ADR-001 |

### Infrastructure SDDs
| SDD | Description | Related ADRs |
|-----|-------------|--------------|
| [STORAGE-DRIVERS-SDD](../sdd/STORAGE-DRIVERS-SDD.md) | Policy storage backends | ADR-004 |
| [SCHEMA-VALIDATION-SDD](../sdd/SCHEMA-VALIDATION-SDD.md) | Policy schema validation | ADR-006 |
| [JWT-AUXDATA-SDD](../sdd/JWT-AUXDATA-SDD.md) | JWT auxiliary data | ADR-006 |
| [MULTI-TENANCY-SDD](../sdd/MULTI-TENANCY-SDD.md) | Multi-tenant support | ADR-006 |

### Quality SDDs
| SDD | Description | Related ADRs |
|-----|-------------|--------------|
| [POLICY-TESTING-SDD](../sdd/POLICY-TESTING-SDD.md) | Policy test framework | ADR-004 |
| [OBSERVABILITY-SDD](../sdd/OBSERVABILITY-SDD.md) | Metrics and tracing | ADR-005 |
| [COMPLIANCE-SECURITY-SDD](../sdd/COMPLIANCE-SECURITY-SDD.md) | Security compliance | ADR-005 |
| [WASM-EDGE-SDD](../sdd/WASM-EDGE-SDD.md) | WebAssembly edge deployment | ADR-002 |

---

## ADR Categories

### Core Engine
- ADR-001: CEL Expression Language
- ADR-003: ActionResult Effect Type
- ADR-006: Cerbos API Compatibility

### Infrastructure
- ADR-002: Monorepo Structure
- ADR-004: Memory-first Development

### Agentic Features
- ADR-005: Agentic Authorization Architecture
- ADR-007: Native Agentic Framework

### Architecture
- ADR-008: Hybrid Go/TypeScript Architecture
- ADR-009: CEL Library Choice (cel-js)

---

## Decision Impact Levels

| Level | Description | ADRs |
|-------|-------------|------|
| **High** | Fundamental architecture, hard to change | ADR-001, ADR-002, ADR-005, ADR-006, ADR-008 |
| **Medium** | Significant but reversible with effort | ADR-003, ADR-004, ADR-007, ADR-009 |
| **Low** | Easily changed, localized impact | None currently |

---

## Related Documents

- [SDD Framework](../sdd/SDD-FRAMEWORK.md) - Documentation standards
- [Documentation Index](../README.md) - All documentation
- [Feature Coverage Matrix](../CERBOS-FEATURE-COVERAGE-MATRIX.md) - All 271 features
- [Agentic Vision](../AGENTIC_AUTHZ_VISION.md) - Project vision
- [Phase 1 Implementation Plan](../PHASE1-IMPLEMENTATION-PLAN.md) - Implementation roadmap
- [API Reference](../api-reference.md) - API documentation
- [Integration Guide](../integration-guide.md) - Integration patterns

---

## Creating New ADRs

Use the template:
```markdown
# ADR-XXX: [Title]

**Status**: Proposed | Accepted | Implemented | Deprecated
**Date**: YYYY-MM-DD
**Deciders**: [Names]

## Context
[Why is this decision needed?]

## Decision
[What was decided?]

## Consequences
[What are the implications?]

## Related
- [Link to related ADRs/SDDs]
```

### ADR Numbering Convention
- ADR-0XX: Core engine decisions
- ADR-1XX: Infrastructure decisions (future)
- ADR-2XX: Agentic feature decisions (future)
- ADR-3XX: Integration decisions (future)

---

## Proposed ADRs (Pending Review)

| ID | Title | Proposed Date | Proposer |
|----|-------|---------------|----------|
| - | None pending | - | - |

---

## Superseded ADRs

| ID | Title | Superseded By | Date |
|----|-------|---------------|------|
| - | None superseded | - | - |

---

*Index maintained by AuthZ Engine Team*
