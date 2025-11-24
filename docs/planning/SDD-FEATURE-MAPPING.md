# SDD-Feature Mapping Document

**Last Updated**: 2025-11-24
**Purpose**: Cross-reference 43 SDDs with 271 Cerbos Feature Matrix items
**Methodology**: Domain-Batched Hybrid (SDD Audit → TDD Implementation)

---

## Executive Summary

| Metric | Count |
|--------|-------|
| Total SDDs | 43 |
| Total Features in Matrix | 271 |
| Features with SDD Coverage | 248 |
| Features Missing SDDs | 23 |
| SDD Coverage Rate | 91.5% |

**Key Finding**: SDDs are 91.5% complete. The primary gap is **implementation**, not documentation.

---

## 1. SDD Inventory (43 Documents)

### 1.1 Package SDDs (5)

| SDD | Package | Size | Implementation Status |
|-----|---------|------|----------------------|
| [CORE-PACKAGE-SDD.md](../sdd/CORE-PACKAGE-SDD.md) | @authz-engine/core | ~800 lines | ✅ Production Ready |
| [AGENTS-PACKAGE-SDD.md](../sdd/AGENTS-PACKAGE-SDD.md) | @authz-engine/agents | ~900 lines | ✅ Production Ready |
| [SERVER-PACKAGE-SDD.md](../sdd/SERVER-PACKAGE-SDD.md) | @authz-engine/server | ~700 lines | ✅ Production Ready |
| [SDK-PACKAGE-SDD.md](../sdd/SDK-PACKAGE-SDD.md) | @authz-engine/sdk | ~600 lines | ✅ Production Ready |
| [NESTJS-PACKAGE-SDD.md](../sdd/NESTJS-PACKAGE-SDD.md) | @authz-engine/nestjs | ~650 lines | ✅ Production Ready |

### 1.2 Core Architecture SDDs (6)

| SDD | Domain | Implementation Status |
|-----|--------|----------------------|
| [CORE-ARCHITECTURE-SDD.md](../sdd/CORE-ARCHITECTURE-SDD.md) | System architecture | ✅ Implemented |
| [CEL-EVALUATOR-SDD.md](../sdd/CEL-EVALUATOR-SDD.md) | CEL expression engine | 🔶 Partial (missing functions) |
| [TYPES-REFERENCE-SDD.md](../sdd/TYPES-REFERENCE-SDD.md) | TypeScript types | ✅ Implemented |
| [SDD-FRAMEWORK.md](../sdd/SDD-FRAMEWORK.md) | Documentation standards | ✅ Complete |
| [SDD-INDEX.md](../sdd/SDD-INDEX.md) | SDD registry | ✅ Complete |
| [SDD-ENTERPRISE-AUTHZ-ENGINE.md](../sdd/SDD-ENTERPRISE-AUTHZ-ENGINE.md) | Master enterprise SDD | ✅ Reference |

### 1.3 Cerbos Feature Parity SDDs (4)

| SDD | Features Covered | Implementation Status |
|-----|------------------|----------------------|
| [CERBOS-FEATURE-PARITY-SDD.md](../sdd/CERBOS-FEATURE-PARITY-SDD.md) | Feature mapping overview | ✅ Reference |
| [PLAN-RESOURCES-API-SDD.md](../sdd/PLAN-RESOURCES-API-SDD.md) | Query planning API | ❌ Not Implemented |
| [POLICY-TESTING-SDD.md](../sdd/POLICY-TESTING-SDD.md) | Test framework | ❌ Not Implemented |
| [OBSERVABILITY-SDD.md](../sdd/OBSERVABILITY-SDD.md) | Metrics, tracing, audit | 🔶 Partial |

### 1.4 Policy Type SDDs (4)

| SDD | Policy Type | Implementation Status |
|-----|-------------|----------------------|
| [SCOPED-POLICIES-SDD.md](../sdd/SCOPED-POLICIES-SDD.md) | Hierarchical scopes | ❌ Not Implemented |
| [PRINCIPAL-POLICIES-SDD.md](../sdd/PRINCIPAL-POLICIES-SDD.md) | User-specific policies | ❌ Not Implemented |
| [DERIVED-ROLES-SDD.md](../sdd/DERIVED-ROLES-SDD.md) | Dynamic roles (ReBAC) | ✅ Implemented |
| [EXPORTED-VARIABLES-SDD.md](../sdd/EXPORTED-VARIABLES-SDD.md) | Shared variables | ❌ Not Implemented |

### 1.5 Infrastructure SDDs (8)

| SDD | Feature | Implementation Status |
|-----|---------|----------------------|
| [JWT-AUXDATA-SDD.md](../sdd/JWT-AUXDATA-SDD.md) | JWT validation, JWKS | ❌ Not Implemented |
| [SCHEMA-VALIDATION-SDD.md](../sdd/SCHEMA-VALIDATION-SDD.md) | JSON Schema validation | ❌ Not Implemented |
| [STORAGE-DRIVERS-SDD.md](../sdd/STORAGE-DRIVERS-SDD.md) | File/Git/DB/Blob storage | 🔶 Partial (Disk only) |
| [MULTI-TENANCY-SDD.md](../sdd/MULTI-TENANCY-SDD.md) | Tenant isolation | 🔶 Partial |
| [GRPC-CLIENT-SDD.md](../sdd/GRPC-CLIENT-SDD.md) | gRPC client | ✅ Implemented |
| [AUDIT-LOGGING-SDD.md](../sdd/AUDIT-LOGGING-SDD.md) | Audit trails | 🔶 Partial |
| [RATE-LIMITING-SDD.md](../sdd/RATE-LIMITING-SDD.md) | Rate limiting | ✅ Implemented |
| [CACHING-STRATEGY-SDD.md](../sdd/CACHING-STRATEGY-SDD.md) | Caching | 🔶 Partial |

### 1.6 Advanced Feature SDDs (8)

| SDD | Feature | Implementation Status |
|-----|---------|----------------------|
| [WASM-EDGE-SDD.md](../sdd/WASM-EDGE-SDD.md) | WebAssembly, edge deploy | ❌ Not Implemented |
| [COMPLIANCE-SECURITY-SDD.md](../sdd/COMPLIANCE-SECURITY-SDD.md) | HIPAA, PCI, SOC 2, GDPR | ❌ Not Implemented |
| [NATIVE-AGENTIC-FRAMEWORK-SDD.md](../sdd/NATIVE-AGENTIC-FRAMEWORK-SDD.md) | AI agent authorization | ✅ Implemented |
| [GO-CORE-SDD.md](../sdd/GO-CORE-SDD.md) | Go language core | ❌ Not Implemented |
| [OIDC-OAUTH-INTEGRATION-SDD.md](../sdd/OIDC-OAUTH-INTEGRATION-SDD.md) | OAuth/OIDC integration | ❌ Not Implemented |
| [MULTI-LANGUAGE-SDK-SDD.md](../sdd/MULTI-LANGUAGE-SDK-SDD.md) | Python, Go SDKs | ❌ Not Implemented |
| [LOAD-TESTING-SUITE-SDD.md](../sdd/LOAD-TESTING-SUITE-SDD.md) | Performance testing | ❌ Not Implemented |
| [POLICY-MANAGEMENT-UI-SDD.md](../sdd/POLICY-MANAGEMENT-UI-SDD.md) | Admin UI | ❌ Not Implemented |

### 1.7 Operations SDDs (8)

| SDD | Feature | Implementation Status |
|-----|---------|----------------------|
| [POLICY-VERSIONING-SDD.md](../sdd/POLICY-VERSIONING-SDD.md) | Version control | ✅ Implemented |
| [RBAC-ADMIN-API-SDD.md](../sdd/RBAC-ADMIN-API-SDD.md) | Admin API | ❌ Not Implemented |
| [DEPLOYMENT-OPERATIONS-SDD.md](../sdd/DEPLOYMENT-OPERATIONS-SDD.md) | Deployment patterns | 🔶 Partial |
| [DISASTER-RECOVERY-SDD.md](../sdd/DISASTER-RECOVERY-SDD.md) | DR planning | ❌ Not Implemented |
| [SECRETS-MANAGEMENT-SDD.md](../sdd/SECRETS-MANAGEMENT-SDD.md) | Secret handling | ❌ Not Implemented |
| [MIGRATION-UPGRADE-SDD.md](../sdd/MIGRATION-UPGRADE-SDD.md) | Migration guides | ❌ Not Implemented |
| [PERFORMANCE-TUNING-SDD.md](../sdd/PERFORMANCE-TUNING-SDD.md) | Performance optimization | ❌ Not Implemented |
| [API-GATEWAY-INTEGRATION-SDD.md](../sdd/API-GATEWAY-INTEGRATION-SDD.md) | Gateway integration | ❌ Not Implemented |

---

## 2. Feature-to-SDD Mapping by Priority

### 2.1 P0 Features (62 total, 56 implemented, 6 gaps)

| Feature | Matrix Section | SDD | Status |
|---------|---------------|-----|--------|
| Basic resource policy | 1. Policy Types | CORE-PACKAGE-SDD | ✅ |
| Policy versioning | 1. Policy Types | POLICY-VERSIONING-SDD | ✅ |
| Multiple rules per policy | 1. Policy Types | CORE-PACKAGE-SDD | ✅ |
| Rule naming | 1. Policy Types | CORE-PACKAGE-SDD | ✅ |
| Effect ALLOW/DENY | 1. Policy Types | CORE-PACKAGE-SDD | ✅ |
| Role matching | 1. Policy Types | CORE-PACKAGE-SDD | ✅ |
| Derived role matching | 1. Policy Types | DERIVED-ROLES-SDD | ✅ |
| Conditions (CEL) | 1. Policy Types | CEL-EVALUATOR-SDD | ✅ |
| Basic derived roles | 1. Policy Types | DERIVED-ROLES-SDD | ✅ |
| Parent role matching | 1. Policy Types | DERIVED-ROLES-SDD | ✅ |
| Conditional activation | 1. Policy Types | DERIVED-ROLES-SDD | ✅ |
| Multiple definitions per set | 1. Policy Types | DERIVED-ROLES-SDD | ✅ |
| `request.principal` / `P` | 2. CEL | CEL-EVALUATOR-SDD | ✅ |
| `request.resource` / `R` | 2. CEL | CEL-EVALUATOR-SDD | ✅ |
| Comparison operators | 2. CEL | CEL-EVALUATOR-SDD | ✅ |
| Logical operators | 2. CEL | CEL-EVALUATOR-SDD | ✅ |
| Arithmetic operators | 2. CEL | CEL-EVALUATOR-SDD | ✅ |
| Ternary operator | 2. CEL | CEL-EVALUATOR-SDD | ✅ |
| Membership (`in`) | 2. CEL | CEL-EVALUATOR-SDD | ✅ |
| `startsWith` | 2. CEL | CEL-EVALUATOR-SDD | ✅ |
| `endsWith` | 2. CEL | CEL-EVALUATOR-SDD | ✅ |
| `contains` | 2. CEL | CEL-EVALUATOR-SDD | ✅ |
| `matches` (regex) | 2. CEL | CEL-EVALUATOR-SDD | ✅ |
| `size` | 2. CEL | CEL-EVALUATOR-SDD | ✅ |
| `timestamp(string)` | 2. CEL | CEL-EVALUATOR-SDD | ✅ |
| `duration(string)` | 2. CEL | CEL-EVALUATOR-SDD | ✅ |
| `now` | 2. CEL | CEL-EVALUATOR-SDD | ✅ |
| `inIPAddrRange` | 2. CEL | CEL-EVALUATOR-SDD | ✅ |
| Single condition expr | 2. CEL | CEL-EVALUATOR-SDD | ✅ |
| POST /api/check/resources | 3. API | SERVER-PACKAGE-SDD | ✅ |
| Single resource check | 3. API | SERVER-PACKAGE-SDD | ✅ |
| Request ID echoing | 3. API | SERVER-PACKAGE-SDD | ✅ |
| Effect response format | 3. API | SERVER-PACKAGE-SDD | ✅ |
| Policy name in response | 3. API | SERVER-PACKAGE-SDD | ✅ |
| Liveness probe | 3. API | SERVER-PACKAGE-SDD | ✅ |
| Readiness probe | 3. API | SERVER-PACKAGE-SDD | ✅ |
| Disk driver | 4. Storage | STORAGE-DRIVERS-SDD | ✅ |
| HTTP listen address | 4. Storage | SERVER-PACKAGE-SDD | ✅ |
| gRPC listen address | 4. Storage | SERVER-PACKAGE-SDD | ✅ |
| CORS settings | 4. Storage | SERVER-PACKAGE-SDD | ✅ |
| Log levels | 7. Observability | AUDIT-LOGGING-SDD | ✅ |
| CheckResources (SDK) | 5. SDK | SDK-PACKAGE-SDD | ✅ |
| Health check (SDK) | 5. SDK | SDK-PACKAGE-SDD | ✅ |
| Retry logic | 5. SDK | SDK-PACKAGE-SDD | ✅ |
| Timeout handling | 5. SDK | SDK-PACKAGE-SDD | ✅ |
| Module (forRoot) | 5. SDK | NESTJS-PACKAGE-SDD | ✅ |
| Module (forRootAsync) | 5. SDK | NESTJS-PACKAGE-SDD | ✅ |
| Guard | 5. SDK | NESTJS-PACKAGE-SDD | ✅ |
| @Authorize decorator | 5. SDK | NESTJS-PACKAGE-SDD | ✅ |
| Principal extraction | 5. SDK | NESTJS-PACKAGE-SDD | ✅ |
| Resource extraction | 5. SDK | NESTJS-PACKAGE-SDD | ✅ |
| Action extraction | 5. SDK | NESTJS-PACKAGE-SDD | ✅ |
| RBAC | 9. Advanced | CORE-PACKAGE-SDD | ✅ |
| ABAC | 9. Advanced | CEL-EVALUATOR-SDD | ✅ |
| PBAC | 9. Advanced | CORE-PACKAGE-SDD | ✅ |
| Zero Trust support | 9. Advanced | COMPLIANCE-SECURITY-SDD | ✅ |

#### P0 Gaps (6 features - need implementation, SDDs exist)

| Gap Feature | Matrix Section | SDD | Priority |
|-------------|---------------|-----|----------|
| Action wildcards (`:` delimiter) | 1. Policy Types | CEL-EVALUATOR-SDD | P0 |
| TLS configuration | 4. Storage | SERVER-PACKAGE-SDD | P0 (via P1) |
| Graceful shutdown | 8. Deployment | DEPLOYMENT-OPERATIONS-SDD | P0 (via P1) |
| Docker container (complete) | 8. Deployment | DEPLOYMENT-OPERATIONS-SDD | P0 |
| YAML config file (complete) | 8. Deployment | SERVER-PACKAGE-SDD | P0 |
| Syntax validation (complete) | 6. Testing | POLICY-TESTING-SDD | P0 |

---

### 2.2 P1 Features (86 total, 14 implemented, 72 gaps)

| Feature Category | Count | SDD Coverage | Status |
|-----------------|-------|--------------|--------|
| Scoped Policies | 5 | SCOPED-POLICIES-SDD | ❌ Not Implemented |
| Principal Policies | 4 | PRINCIPAL-POLICIES-SDD | ❌ Not Implemented |
| Exported Variables | 3 | EXPORTED-VARIABLES-SDD | ❌ Not Implemented |
| CEL Functions (advanced) | 15 | CEL-EVALUATOR-SDD | ❌ Not Implemented |
| Plan API | 3 | PLAN-RESOURCES-API-SDD | ❌ Not Implemented |
| JWT/AuxData | 4 | JWT-AUXDATA-SDD | ❌ Not Implemented |
| Policy Testing | 8 | POLICY-TESTING-SDD | ❌ Not Implemented |
| Multi-Tenancy | 4 | MULTI-TENANCY-SDD | 🔶 Partial |
| Batch API | 3 | SERVER-PACKAGE-SDD | 🔶 Partial |
| Storage Drivers | 4 | STORAGE-DRIVERS-SDD | 🔶 Partial |
| Condition Operators | 4 | CEL-EVALUATOR-SDD | ❌ Not Implemented |
| AI/Agent Auth | 4 | NATIVE-AGENTIC-FRAMEWORK-SDD | 🔶 Partial |

#### P1 Features with SDDs Ready for Implementation

| Feature | SDD | Lines | Ready for TDD |
|---------|-----|-------|---------------|
| Scope field | SCOPED-POLICIES-SDD | ~37KB | ✅ Yes |
| Scope hierarchy evaluation | SCOPED-POLICIES-SDD | ~37KB | ✅ Yes |
| Override parent mode | SCOPED-POLICIES-SDD | ~37KB | ✅ Yes |
| Require parental consent mode | SCOPED-POLICIES-SDD | ~37KB | ✅ Yes |
| Basic principal policy | PRINCIPAL-POLICIES-SDD | ~35KB | ✅ Yes |
| Wildcard resources | PRINCIPAL-POLICIES-SDD | ~35KB | ✅ Yes |
| Action-level rules | PRINCIPAL-POLICIES-SDD | ~35KB | ✅ Yes |
| Variable definitions | EXPORTED-VARIABLES-SDD | ~30KB | ✅ Yes |
| Import mechanism | EXPORTED-VARIABLES-SDD | ~30KB | ✅ Yes |
| POST /api/plan/resources | PLAN-RESOURCES-API-SDD | ~16KB | ✅ Yes |
| Filter kind response | PLAN-RESOURCES-API-SDD | ~16KB | ✅ Yes |
| JWT verification | JWT-AUXDATA-SDD | ~27KB | ✅ Yes |
| JWKS local | JWT-AUXDATA-SDD | ~27KB | ✅ Yes |
| JWKS remote | JWT-AUXDATA-SDD | ~27KB | ✅ Yes |
| `_test.yaml` test files | POLICY-TESTING-SDD | ~17KB | ✅ Yes |
| `cerbos run` command equiv | POLICY-TESTING-SDD | ~17KB | ✅ Yes |
| Test fixtures | POLICY-TESTING-SDD | ~17KB | ✅ Yes |

---

### 2.3 P2 Features (90 total, 4 implemented, 86 gaps)

| Feature Category | Count | SDD Coverage |
|-----------------|-------|--------------|
| Role Policies | 4 | NEEDS SDD |
| Exported Constants | 3 | EXPORTED-VARIABLES-SDD (extend) |
| Policy Outputs | 6 | NEEDS SDD |
| Schema Validation | 6 | SCHEMA-VALIDATION-SDD |
| CEL Hierarchy Functions | 5 | CEL-EVALUATOR-SDD (extend) |
| CEL Math Functions | 6 | CEL-EVALUATOR-SDD (extend) |
| Admin API | 6 | RBAC-ADMIN-API-SDD |
| Observability | 22 | OBSERVABILITY-SDD |
| Deployment | 8 | DEPLOYMENT-OPERATIONS-SDD |
| WASM/Edge | 3 | WASM-EDGE-SDD |
| Compliance | 4 | COMPLIANCE-SECURITY-SDD |
| Developer Tools | 4 | POLICY-MANAGEMENT-UI-SDD |

---

### 2.4 P3 Features (33 total, 0 implemented, 33 gaps)

| Feature Category | Count | SDD Coverage |
|-----------------|-------|--------------|
| Multi-Language SDKs | 6 | MULTI-LANGUAGE-SDK-SDD |
| Distributed Tracing | 4 | OBSERVABILITY-SDD |
| Advanced Storage | 4 | STORAGE-DRIVERS-SDD |
| gRPC Advanced | 2 | GRPC-CLIENT-SDD |
| Other | 17 | Various SDDs |

---

## 3. Features Missing SDDs (23)

These features need SDD documentation before implementation:

| Feature | Priority | Suggested SDD |
|---------|----------|---------------|
| Role Policies (4 features) | P2 | Create: ROLE-POLICIES-SDD.md |
| Policy Outputs (6 features) | P2 | Create: POLICY-OUTPUTS-SDD.md |
| Condition Operators (all.of, any.of, none.of) | P1 | Extend: CEL-EVALUATOR-SDD.md |
| Global variables/constants | P2 | Extend: EXPORTED-VARIABLES-SDD.md |
| Wildcard parent roles | P1 | Extend: DERIVED-ROLES-SDD.md |
| Request limits configuration | P1 | Extend: SERVER-PACKAGE-SDD.md |
| cerbosCallId | P1 | Extend: SERVER-PACKAGE-SDD.md |
| ReBAC (Relationship-Based) | P2 | Create: REBAC-SDD.md |
| AuthZEN compliance | P2 | Extend: COMPLIANCE-SECURITY-SDD.md |

---

## 4. Implementation Readiness Matrix

### 4.1 SDDs Ready for Immediate TDD Implementation

| SDD | Features Ready | Estimated Effort | Dependencies |
|-----|---------------|------------------|--------------|
| SCOPED-POLICIES-SDD | 5 | 2 weeks | CEL-EVALUATOR |
| PRINCIPAL-POLICIES-SDD | 4 | 1.5 weeks | CORE-PACKAGE |
| EXPORTED-VARIABLES-SDD | 3 | 1 week | CORE-PACKAGE |
| PLAN-RESOURCES-API-SDD | 3 | 2 weeks | CEL-EVALUATOR |
| JWT-AUXDATA-SDD | 4 | 1.5 weeks | None |
| POLICY-TESTING-SDD | 8 | 2 weeks | CLI Package |
| CEL-EVALUATOR-SDD (extend) | 15 | 2 weeks | None |

### 4.2 SDDs Requiring Updates Before Implementation

| SDD | Updates Needed | Effort |
|-----|---------------|--------|
| CEL-EVALUATOR-SDD | Add condition operators, list comprehensions | 1 day |
| DERIVED-ROLES-SDD | Add wildcard parent roles | 0.5 day |
| SERVER-PACKAGE-SDD | Add request limits, cerbosCallId | 0.5 day |
| OBSERVABILITY-SDD | Align with OpenTelemetry standards | 1 day |

### 4.3 New SDDs Required

| SDD to Create | Features | Estimated Lines | Priority |
|---------------|----------|-----------------|----------|
| ROLE-POLICIES-SDD.md | 4 | ~400 | P2 |
| POLICY-OUTPUTS-SDD.md | 6 | ~500 | P2 |
| REBAC-SDD.md | 4 | ~600 | P2 |

---

## 5. Recommended Phase 1 Actions

### Week 1: SDD Audit Completion

1. **Day 1-2**: Verify all P0 features have complete SDD coverage
2. **Day 3**: Update CEL-EVALUATOR-SDD with missing functions
3. **Day 4**: Update SERVER-PACKAGE-SDD with gaps
4. **Day 5**: Create SDD update PR

### Week 2: P0 Gap Implementation (TDD)

1. Action wildcards (`:` delimiter)
2. TLS configuration
3. Graceful shutdown
4. Complete Docker configuration
5. Complete YAML config
6. Complete syntax validation

### Week 3-4: P1 Domain 1 - Scoped Policies (TDD)

1. Write tests from SCOPED-POLICIES-SDD
2. Implement scope field
3. Implement hierarchy evaluation
4. Implement permission modes

---

## 6. Cross-Reference Index

### By SDD Document

| SDD | Feature Matrix Sections |
|-----|------------------------|
| CORE-PACKAGE-SDD | 1 (Policy Types), 3 (API), 9 (Models) |
| CEL-EVALUATOR-SDD | 2 (CEL Functions) |
| SERVER-PACKAGE-SDD | 3 (API), 4 (Config), 8 (Deployment) |
| SDK-PACKAGE-SDD | 5 (SDK Features) |
| NESTJS-PACKAGE-SDD | 5 (SDK Features) |
| AGENTS-PACKAGE-SDD | 9 (AI/Agent Auth) |
| SCOPED-POLICIES-SDD | 1 (Policy Types - Scoped) |
| PRINCIPAL-POLICIES-SDD | 1 (Policy Types - Principal) |
| DERIVED-ROLES-SDD | 1 (Policy Types - Derived Roles) |
| EXPORTED-VARIABLES-SDD | 1 (Policy Types - Variables) |
| JWT-AUXDATA-SDD | 4 (Storage - JWT) |
| SCHEMA-VALIDATION-SDD | 1 (Policy Types - Schema) |
| STORAGE-DRIVERS-SDD | 4 (Storage Drivers) |
| MULTI-TENANCY-SDD | 9 (Multi-Tenancy) |
| PLAN-RESOURCES-API-SDD | 3 (API - Plan) |
| POLICY-TESTING-SDD | 6 (Policy Testing) |
| OBSERVABILITY-SDD | 7 (Observability) |
| WASM-EDGE-SDD | 9 (WASM) |
| COMPLIANCE-SECURITY-SDD | 9 (Security/Compliance) |

---

## 7. Status Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | SDD Complete, Implementation Complete |
| 🔶 | SDD Complete, Implementation Partial |
| ❌ | SDD Complete, Implementation Not Started |
| ⚠️ | SDD Needs Updates |
| 🆕 | SDD Needs Creation |

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-11-24 | Initial SDD-Feature mapping document |

---

*This document is the authoritative cross-reference between SDDs and the Feature Matrix.*
