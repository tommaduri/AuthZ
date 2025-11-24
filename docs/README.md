# AuthZ Engine Documentation Index

**Last Updated**: 2025-11-24
**Total Documents**: 50+
**SDD Coverage**: 31 documents covering 271 Cerbos features

---

## Quick Links

| I Want To... | Document |
|--------------|----------|
| Understand the vision | [AGENTIC_AUTHZ_VISION.md](./AGENTIC_AUTHZ_VISION.md) |
| See all features | [CERBOS-FEATURE-COVERAGE-MATRIX.md](./CERBOS-FEATURE-COVERAGE-MATRIX.md) |
| Integrate with NestJS | [NESTJS-PACKAGE-SDD](./sdd/NESTJS-PACKAGE-SDD.md) |
| Use the SDK | [SDK-PACKAGE-SDD](./sdd/SDK-PACKAGE-SDD.md) |
| Understand the agents | [AGENTS-PACKAGE-SDD](./sdd/AGENTS-PACKAGE-SDD.md) |
| See API reference | [api-reference.md](./api/api-reference.md) |

---

## 1. Vision & Strategy

| Document | Description | Status |
|----------|-------------|--------|
| [AGENTIC_AUTHZ_VISION.md](./AGENTIC_AUTHZ_VISION.md) | Project vision and roadmap | ✅ Updated |
| [SDD-ENTERPRISE-AUTHZ-ENGINE.md](./sdd/SDD-ENTERPRISE-AUTHZ-ENGINE.md) | Master enterprise SDD | ✅ Complete |
| [PHASE1-IMPLEMENTATION-PLAN.md](./planning/PHASE1-IMPLEMENTATION-PLAN.md) | Phase 1 implementation details | ✅ Complete |

---

## 2. Software Design Documents (31)

### 2.1 Package SDDs

| Document | Package | Lines | Status |
|----------|---------|-------|--------|
| [CORE-PACKAGE-SDD.md](./sdd/CORE-PACKAGE-SDD.md) | @authz-engine/core | ~800 | ✅ |
| [AGENTS-PACKAGE-SDD.md](./sdd/AGENTS-PACKAGE-SDD.md) | @authz-engine/agents | ~900 | ✅ |
| [SERVER-PACKAGE-SDD.md](./sdd/SERVER-PACKAGE-SDD.md) | @authz-engine/server | ~700 | ✅ |
| [SDK-PACKAGE-SDD.md](./sdd/SDK-PACKAGE-SDD.md) | @authz-engine/sdk | ~600 | ✅ |
| [NESTJS-PACKAGE-SDD.md](./sdd/NESTJS-PACKAGE-SDD.md) | @authz-engine/nestjs | ~650 | ✅ |

### 2.2 Core Architecture SDDs

| Document | Coverage | Status |
|----------|----------|--------|
| [CORE-ARCHITECTURE-SDD.md](./sdd/CORE-ARCHITECTURE-SDD.md) | System architecture | ✅ |
| [CEL-EVALUATOR-SDD.md](./sdd/CEL-EVALUATOR-SDD.md) | CEL expression engine | ✅ |
| [TYPES-REFERENCE-SDD.md](./sdd/TYPES-REFERENCE-SDD.md) | TypeScript types | ✅ |
| [SDD-FRAMEWORK.md](./sdd/SDD-FRAMEWORK.md) | Documentation standards | ✅ |

### 2.3 Cerbos Feature Parity SDDs

| Document | Features Covered | Status |
|----------|------------------|--------|
| [CERBOS-FEATURE-PARITY-SDD.md](./sdd/CERBOS-FEATURE-PARITY-SDD.md) | Feature mapping | ✅ |
| [PLAN-RESOURCES-API-SDD.md](./sdd/PLAN-RESOURCES-API-SDD.md) | Query planning API | ✅ |
| [POLICY-TESTING-SDD.md](./sdd/POLICY-TESTING-SDD.md) | Test framework | ✅ |
| [OBSERVABILITY-SDD.md](./sdd/OBSERVABILITY-SDD.md) | Metrics, tracing, audit | ✅ |

### 2.4 Policy Type SDDs

| Document | Policy Type | Status |
|----------|-------------|--------|
| [SCOPED-POLICIES-SDD.md](./sdd/SCOPED-POLICIES-SDD.md) | Hierarchical scopes | ✅ |
| [PRINCIPAL-POLICIES-SDD.md](./sdd/PRINCIPAL-POLICIES-SDD.md) | User-specific policies | ✅ |
| [DERIVED-ROLES-SDD.md](./sdd/DERIVED-ROLES-SDD.md) | Dynamic roles (ReBAC) | ✅ |
| [EXPORTED-VARIABLES-SDD.md](./sdd/EXPORTED-VARIABLES-SDD.md) | Shared variables | ✅ |

### 2.5 Infrastructure SDDs

| Document | Feature | Status |
|----------|---------|--------|
| [JWT-AUXDATA-SDD.md](./sdd/JWT-AUXDATA-SDD.md) | JWT validation, JWKS | ✅ |
| [SCHEMA-VALIDATION-SDD.md](./sdd/SCHEMA-VALIDATION-SDD.md) | JSON Schema validation | ✅ |
| [STORAGE-DRIVERS-SDD.md](./sdd/STORAGE-DRIVERS-SDD.md) | File/Git/DB/Blob storage | ✅ |
| [MULTI-TENANCY-SDD.md](./sdd/MULTI-TENANCY-SDD.md) | Tenant isolation | ✅ |

### 2.6 Advanced Feature SDDs

| Document | Feature | Status |
|----------|---------|--------|
| [WASM-EDGE-SDD.md](./sdd/WASM-EDGE-SDD.md) | WebAssembly, edge deploy | ✅ |
| [COMPLIANCE-SECURITY-SDD.md](./sdd/COMPLIANCE-SECURITY-SDD.md) | HIPAA, PCI, SOC 2, GDPR | ✅ |

---

## 3. Architecture Decision Records (9)

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-001](./adr/ADR-001-CEL-EXPRESSION-LANGUAGE.md) | CEL as Expression Language | Accepted |
| [ADR-002](./adr/ADR-002-MONOREPO-STRUCTURE.md) | Monorepo with pnpm | Accepted |
| [ADR-003](./adr/ADR-003-ACTION-RESULT-EFFECT.md) | ActionResult.effect design | Accepted |
| [ADR-004](./adr/ADR-004-MEMORY-FIRST-DEVELOPMENT.md) | Memory-first development | Accepted |
| [ADR-005](./adr/ADR-005-AGENTIC-AUTHORIZATION.md) | Agentic architecture | Accepted |
| [ADR-006](./adr/ADR-006-CERBOS-API-COMPATIBILITY.md) | Cerbos API compatibility | Accepted |

See [ADR Index](./adr/INDEX.md) for full details.

---

## 4. Integration Guides

| Document | Description |
|----------|-------------|
| [integration-guide.md](./guides/integration-guide.md) | General integration guide |
| [agentic-integration-guide.md](./guides/agentic-integration-guide.md) | Agentic features integration |
| [TELEMETRY.md](./guides/TELEMETRY.md) | OpenTelemetry distributed tracing |
| [api-reference.md](./api/api-reference.md) | REST API reference |

---

## 5. Implementation Reports

| Document | Description |
|----------|-------------|
| [CLI-IMPLEMENTATION-REPORT.md](./reports/CLI-IMPLEMENTATION-REPORT.md) | CLI package implementation details |

---

## 6. Research & Analysis

| Document | Description |
|----------|-------------|
| [research/agentic-api-patterns.md](./research/agentic-api-patterns.md) | API pattern research |
| [ADR-009-CEL-LIBRARY-CHOICE.md](./adr/ADR-009-CEL-LIBRARY-CHOICE.md) | CEL library evaluation |

---

## 7. Feature Coverage

| Category | Features | SDD Coverage |
|----------|----------|--------------|
| Policy Types | 40 | 100% |
| CEL Functions | 55 | 100% |
| API Endpoints | 25 | 100% |
| Storage/Config | 28 | 100% |
| SDK Features | 16 | 100% |
| Policy Testing | 20 | 100% |
| Observability | 22 | 100% |
| Deployment/CLI | 18 | 100% |
| Advanced Features | 47 | 100% |
| **TOTAL** | **271** | **100%** |

See [CERBOS-FEATURE-COVERAGE-MATRIX.md](./CERBOS-FEATURE-COVERAGE-MATRIX.md) for details.

---

## Document Statistics

| Metric | Count |
|--------|-------|
| Total Documents | 50+ |
| SDDs | 31 |
| ADRs | 9 |
| Guides | 4 |
| Reports | 1 |
| Other | 7 |
| Total Lines | ~43,000+ |

---

*Last updated: 2025-11-24*
