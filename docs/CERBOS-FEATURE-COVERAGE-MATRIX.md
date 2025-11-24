# Cerbos Feature Coverage Matrix

**Last Updated**: 2025-11-24
**AuthZ Engine Version**: 1.0.0
**Cerbos Reference Version**: Latest (2024)
**Total Features Tracked**: 271

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Fully Implemented |
| 🔶 | Partially Implemented |
| ❌ | Not Implemented |
| 🚫 | Not Applicable / Out of Scope |
| P0 | Critical - Required for MVP |
| P1 | High - Required for production |
| P2 | Medium - Nice to have |
| P3 | Low - Future consideration |

---

## 1. Policy Types

| Feature | Cerbos | AuthZ Engine | Status | Priority | Notes |
|---------|--------|--------------|--------|----------|-------|
| **Resource Policies** | | | | | |
| Basic resource policy | ✅ | ✅ | Complete | P0 | Core functionality |
| Policy versioning | ✅ | ✅ | Complete | P0 | `version` field |
| Multiple rules per policy | ✅ | ✅ | Complete | P0 | |
| Rule naming | ✅ | ✅ | Complete | P0 | For debugging |
| Action matching | ✅ | 🔶 | Partial | P1 | Wildcards needed |
| Action wildcards (`:` delimiter) | ✅ | ❌ | Gap | P1 | `a:*:c` patterns |
| Effect ALLOW/DENY | ✅ | ✅ | Complete | P0 | |
| Role matching | ✅ | ✅ | Complete | P0 | |
| Derived role matching | ✅ | ✅ | Complete | P0 | |
| Conditions | ✅ | ✅ | Complete | P0 | CEL expressions |
| **Derived Roles** | | | | | |
| Basic derived roles | ✅ | ✅ | Complete | P0 | Phase 4 (2025-11-24) |
| Parent role matching | ✅ | ✅ | Complete | P0 | |
| Wildcard parent roles (`*`) | ✅ | ✅ | Complete | P1 | `*`, `prefix:*`, `*:suffix` - Phase 4 |
| Circular dependency detection | ✅ | ✅ | Complete | P0 | Kahn's algorithm - Phase 4 |
| Conditional activation | ✅ | ✅ | Complete | P0 | |
| Multiple definitions per set | ✅ | ✅ | Complete | P0 | |
| **Principal Policies** | | | | | |
| Basic principal policy | ✅ | ✅ | Complete | P1 | Phase 3 (2025-11-24) |
| Wildcard resources | ✅ | ✅ | Complete | P1 | Pattern matching - Phase 3 |
| Action-level rules | ✅ | ✅ | Complete | P1 | Named action rules - Phase 3 |
| Conditional overrides | ✅ | ✅ | Complete | P1 | CEL conditions - Phase 3 |
| Output expressions | ✅ | ✅ | Complete | P1 | whenRuleActivated, whenConditionNotMet - Phase 3 |
| **Role Policies** | | | | | |
| Basic role policy | ✅ | ❌ | Gap | P2 | Custom roles |
| Parent role inheritance | ✅ | ❌ | Gap | P2 | |
| Allowlist model | ✅ | ❌ | Gap | P2 | |
| Conditional actions | ✅ | ❌ | Gap | P2 | |
| **Exported Variables** | | | | | |
| Variable definitions | ✅ | ✅ | Complete | P1 | Phase 5 (2025-11-24) - ExportVariables |
| Import mechanism | ✅ | ✅ | Complete | P1 | Phase 5 - Multi-import with resolution |
| Local variables in policies | ✅ | ✅ | Complete | P1 | Phase 5 - Local overrides with precedence |
| **Exported Constants** | | | | | |
| Constant definitions | ✅ | ✅ | Complete | P2 | Phase 5 (2025-11-24) - ExportConstants |
| Import mechanism | ✅ | ✅ | Complete | P2 | Phase 5 - Unified import resolution |
| Local constants in policies | ✅ | ✅ | Complete | P2 | Phase 5 - Static value support |
| **Scoped Policies** | | | | | |
| Scope field | ✅ | ✅ | Complete | P1 | Phase 2 (2025-11-24) |
| Scope hierarchy evaluation | ✅ | ✅ | Complete | P1 | a.b.c → a.b → a - Phase 2 |
| Scope matching | ✅ | ✅ | Complete | P1 | Hierarchical resolution - Phase 2 |
| Scope in requests | ✅ | ✅ | Complete | P1 | Context-aware evaluation - Phase 2 |
| Override parent mode | ✅ | 🔶 | Partial | P1 | Basic support, needs scopePermissions |
| Require parental consent mode | ✅ | ❌ | Gap | P1 | Future enhancement |
| **Policy Outputs** | | | | | |
| Rule activation output | ✅ | ❌ | Gap | P2 | |
| Condition not met output | ✅ | ❌ | Gap | P2 | |
| Output in response | ✅ | ❌ | Gap | P2 | |
| **Schema Validation** | | | | | |
| JSON Schema support | ✅ | ❌ | Gap | P2 | |
| Principal schema | ✅ | ❌ | Gap | P2 | |
| Resource schema | ✅ | ❌ | Gap | P2 | |
| Enforcement modes | ✅ | ❌ | Gap | P2 | warn/reject |
| Validation errors in response | ✅ | ❌ | Gap | P2 | |
| ignoreWhen for actions | ✅ | ❌ | Gap | P2 | |
| **Policy Outputs (Enhanced)** | | | | | |
| `when.ruleActivated` | ✅ | ❌ | Gap | P2 | CEL expr when rule fires |
| `when.conditionNotMet` | ✅ | ❌ | Gap | P2 | CEL expr when condition fails |
| Output key naming | ✅ | ❌ | Gap | P2 | Custom output keys |
| Output in CheckResources response | ✅ | ❌ | Gap | P2 | |
| Output per resource in batch | ✅ | ❌ | Gap | P2 | |

---

## 2. CEL Expression Features

| Feature | Cerbos | AuthZ Engine | Status | Priority | Notes |
|---------|--------|--------------|--------|----------|-------|
| **Top-Level Identifiers** | | | | | |
| `request.principal` / `P` | ✅ | ✅ | Complete | P0 | P, R, A shortcuts added Phase 4 |
| `request.resource` / `R` | ✅ | ✅ | Complete | P0 | |
| `request.auxData` / `A` | ✅ | ✅ | Complete | P1 | A shortcut added Phase 4 |
| `variables` / `V` | ✅ | ✅ | Complete | P1 | Phase 5 - Import + local with caching |
| `constants` / `C` | ✅ | ✅ | Complete | P2 | Phase 5 - Static values |
| `globals` / `G` | ✅ | ❌ | Gap | P2 | |
| `runtime.effectiveDerivedRoles` | ✅ | 🔶 | Partial | P1 | |
| **Basic Operators** | | | | | |
| Comparison (`==`, `!=`, `<`, etc.) | ✅ | ✅ | Complete | P0 | |
| Logical (`&&`, `\|\|`, `!`) | ✅ | ✅ | Complete | P0 | |
| Arithmetic (`+`, `-`, `*`, `/`, `%`) | ✅ | ✅ | Complete | P0 | |
| Ternary (`? :`) | ✅ | ✅ | Complete | P0 | |
| Membership (`in`) | ✅ | ✅ | Complete | P0 | |
| **String Functions** | | | | | |
| `startsWith` | ✅ | ✅ | Complete | P0 | |
| `endsWith` | ✅ | ✅ | Complete | P0 | |
| `contains` | ✅ | ✅ | Complete | P0 | |
| `matches` (regex) | ✅ | ✅ | Complete | P0 | |
| `size` | ✅ | ✅ | Complete | P0 | |
| `split` | ✅ | ❌ | Gap | P1 | |
| `join` | ✅ | ❌ | Gap | P1 | |
| `replace` | ✅ | ❌ | Gap | P1 | |
| `trim` | ✅ | ❌ | Gap | P2 | |
| `lowerAscii` | ✅ | ❌ | Gap | P2 | |
| `upperAscii` | ✅ | ❌ | Gap | P2 | |
| `base64.encode` | ✅ | ❌ | Gap | P2 | |
| `base64.decode` | ✅ | ❌ | Gap | P2 | |
| **List/Map Functions** | | | | | |
| `size` | ✅ | ✅ | Complete | P0 | |
| `in` | ✅ | ✅ | Complete | P0 | |
| `exists(x, expr)` | ✅ | ❌ | Gap | P1 | List comprehension |
| `all(x, expr)` | ✅ | ❌ | Gap | P1 | |
| `filter(x, expr)` | ✅ | ❌ | Gap | P1 | |
| `map(x, expr)` | ✅ | ❌ | Gap | P1 | |
| `exists_one(x, expr)` | ✅ | ❌ | Gap | P2 | |
| `intersects` | ✅ | ❌ | Gap | P1 | |
| `isSubset` | ✅ | ❌ | Gap | P2 | |
| `flatten` | ✅ | ❌ | Gap | P2 | |
| `sortBy` | ✅ | ❌ | Gap | P3 | |
| `distinct` | ✅ | ❌ | Gap | P2 | |
| **Timestamp/Duration** | | | | | |
| `timestamp(string)` | ✅ | ✅ | Complete | P0 | |
| `duration(string)` | ✅ | ✅ | Complete | P0 | |
| `now` | ✅ | ✅ | Complete | P0 | |
| `timeSince()` | ✅ | ❌ | Gap | P1 | |
| `getFullYear()` | ✅ | ❌ | Gap | P2 | |
| `getMonth()` | ✅ | ❌ | Gap | P2 | |
| `getDayOfMonth()` | ✅ | ❌ | Gap | P2 | |
| `getDayOfWeek()` | ✅ | ❌ | Gap | P2 | |
| `getHours()` | ✅ | ❌ | Gap | P2 | |
| `getMinutes()` | ✅ | ❌ | Gap | P2 | |
| `getSeconds()` | ✅ | ❌ | Gap | P2 | |
| **Hierarchy Functions** | | | | | |
| `hierarchy(string)` | ✅ | ❌ | Gap | P2 | |
| `ancestorOf` | ✅ | ❌ | Gap | P2 | |
| `descendantOf` | ✅ | ❌ | Gap | P2 | |
| `siblingOf` | ✅ | ❌ | Gap | P2 | |
| `overlaps` | ✅ | ❌ | Gap | P2 | |
| **IP Address Functions** | | | | | |
| `inIPAddrRange` | ✅ | ✅ | Complete | P0 | |
| **Math Functions** | | | | | |
| `math.abs` | ✅ | ❌ | Gap | P2 | |
| `math.greatest` | ✅ | ❌ | Gap | P2 | |
| `math.least` | ✅ | ❌ | Gap | P2 | |
| `math.ceil` | ✅ | ❌ | Gap | P3 | |
| `math.floor` | ✅ | ❌ | Gap | P3 | |
| `math.round` | ✅ | ❌ | Gap | P3 | |
| Bitwise operations | ✅ | ❌ | Gap | P3 | |
| **Condition Operators** | | | | | |
| Single `expr` | ✅ | ✅ | Complete | P0 | |
| `all.of` (AND) | ✅ | ❌ | Gap | P1 | |
| `any.of` (OR) | ✅ | ❌ | Gap | P1 | |
| `none.of` (NOT) | ✅ | ❌ | Gap | P1 | |
| Nested operators | ✅ | ❌ | Gap | P1 | |

---

## 3. API Endpoints

| Feature | Cerbos | AuthZ Engine | Status | Priority | Notes |
|---------|--------|--------------|--------|----------|-------|
| **Check API** | | | | | |
| `POST /api/check/resources` | ✅ | ✅ | Complete | P0 | Via `/api/check` |
| Single resource check | ✅ | ✅ | Complete | P0 | |
| Batch resource check | ✅ | 🔶 | Partial | P1 | Needs max limits |
| Request ID echoing | ✅ | ✅ | Complete | P0 | |
| Effect response format | ✅ | ✅ | Complete | P0 | EFFECT_ALLOW/DENY |
| Policy name in response | ✅ | ✅ | Complete | P0 | |
| Include metadata flag | ✅ | 🔶 | Partial | P1 | |
| Derived roles in meta | ✅ | 🔶 | Partial | P1 | |
| Outputs in response | ✅ | ❌ | Gap | P2 | |
| Validation errors | ✅ | ❌ | Gap | P2 | |
| `cerbosCallId` | ✅ | ❌ | Gap | P1 | Audit correlation |
| **Plan API** | | | | | |
| `POST /api/plan/resources` | ✅ | ❌ | Gap | P1 | Query planning |
| Filter kind response | ✅ | ❌ | Gap | P1 | |
| Condition AST | ✅ | ❌ | Gap | P1 | |
| **Server Info** | | | | | |
| `GET /api/server_info` | ✅ | 🔶 | Adapted | P0 | Via `/health` |
| Version info | ✅ | ✅ | Complete | P0 | |
| Build info | ✅ | 🔶 | Partial | P2 | |
| **Health Checks** | | | | | |
| Liveness probe | ✅ | ✅ | Complete | P0 | |
| Readiness probe | ✅ | ✅ | Complete | P0 | |
| **Admin API** | | | | | |
| Add/update policy | ✅ | ❌ | Gap | P2 | |
| List policies | ✅ | 🔶 | Partial | P1 | |
| Get policy | ✅ | ❌ | Gap | P2 | |
| Disable/enable policy | ✅ | ❌ | Gap | P2 | |
| List audit logs | ✅ | ❌ | Gap | P2 | |
| Schema CRUD | ✅ | ❌ | Gap | P2 | |
| Reload store | ✅ | ❌ | Gap | P2 | |
| **gRPC Support** | | | | | |
| gRPC server | ✅ | 🔶 | Partial | P1 | Basic support |
| Server reflection | ✅ | ❌ | Gap | P2 | |
| Streaming | ✅ | ❌ | Gap | P3 | |

---

## 4. Storage & Configuration

| Feature | Cerbos | AuthZ Engine | Status | Priority | Notes |
|---------|--------|--------------|--------|----------|-------|
| **Storage Drivers** | | | | | |
| Disk driver | ✅ | ✅ | Complete | P0 | |
| Watch for changes | ✅ | ❌ | Gap | P1 | Hot reload |
| Git driver | ✅ | ❌ | Gap | P2 | |
| PostgreSQL driver | ✅ | 🔶 | Partial | P1 | |
| MySQL driver | ✅ | ❌ | Gap | P3 | |
| SQLite driver | ✅ | ❌ | Gap | P2 | |
| Blob (S3/GCS) driver | ✅ | ❌ | Gap | P3 | |
| Overlay driver | ✅ | ❌ | Gap | P3 | |
| **Server Config** | | | | | |
| HTTP listen address | ✅ | ✅ | Complete | P0 | |
| gRPC listen address | ✅ | ✅ | Complete | P0 | |
| TLS configuration | ✅ | ❌ | Gap | P1 | |
| CORS settings | ✅ | ✅ | Complete | P0 | |
| Request limits | ✅ | ❌ | Gap | P1 | |
| **Audit Logging** | | | | | |
| Access logs | ✅ | ❌ | Gap | P2 | |
| Decision logs | ✅ | 🔶 | Partial | P1 | Via agents |
| Local backend | ✅ | ❌ | Gap | P2 | |
| File backend | ✅ | ❌ | Gap | P2 | |
| Kafka backend | ✅ | ❌ | Gap | P3 | |
| **JWT/AuxData** | | | | | |
| JWT verification | ✅ | ❌ | Gap | P1 | |
| JWKS local | ✅ | ❌ | Gap | P1 | |
| JWKS remote | ✅ | ❌ | Gap | P1 | |
| Token caching | ✅ | ❌ | Gap | P2 | |
| **Schema Enforcement** | | | | | |
| Schema loading | ✅ | ❌ | Gap | P2 | |
| Warn mode | ✅ | ❌ | Gap | P2 | |
| Reject mode | ✅ | ❌ | Gap | P2 | |
| **Telemetry** | | | | | |
| Metrics export | ✅ | 🔶 | Partial | P2 | |
| Prometheus endpoint | ✅ | ❌ | Gap | P2 | |
| Tracing | ✅ | ❌ | Gap | P3 | |

---

## 5. SDK Features

| Feature | Cerbos | AuthZ Engine | Status | Priority | Notes |
|---------|--------|--------------|--------|----------|-------|
| **TypeScript SDK** | | | | | |
| CheckResources | ✅ | ✅ | Complete | P0 | |
| PlanResources | ✅ | ❌ | Gap | P1 | |
| Batch check | ✅ | 🔶 | Partial | P1 | |
| Health check | ✅ | ✅ | Complete | P0 | |
| Retry logic | ✅ | ✅ | Complete | P0 | |
| Timeout handling | ✅ | ✅ | Complete | P0 | |
| gRPC transport | ✅ | ❌ | Gap | P2 | |
| Connection pooling | ✅ | 🔶 | Partial | P1 | Via fetch |
| **NestJS Integration** | | | | | |
| Module (forRoot) | ✅ | ✅ | Complete | P0 | |
| Module (forRootAsync) | ✅ | ✅ | Complete | P0 | |
| Guard | ✅ | ✅ | Complete | P0 | |
| @Authorize decorator | ✅ | ✅ | Complete | P0 | |
| Principal extraction | ✅ | ✅ | Complete | P0 | |
| Resource extraction | ✅ | ✅ | Complete | P0 | |
| Action extraction | ✅ | ✅ | Complete | P0 | |

---

## 6. Policy Testing & Validation

| Feature | Cerbos | AuthZ Engine | Status | Priority | Notes |
|---------|--------|--------------|--------|----------|-------|
| **Policy Compilation** | | | | | |
| `cerbos compile` command | ✅ | ❌ | Gap | P1 | Validate policies |
| Syntax validation | ✅ | 🔶 | Partial | P0 | Basic YAML check |
| Semantic validation | ✅ | ❌ | Gap | P1 | Reference checks |
| Schema validation | ✅ | ❌ | Gap | P2 | Against JSON Schema |
| Duplicate detection | ✅ | ❌ | Gap | P1 | Conflicting rules |
| **Test Framework** | | | | | |
| `_test.yaml` test files | ✅ | ❌ | Gap | P1 | Test alongside policy |
| `cerbos run` command | ✅ | ❌ | Gap | P1 | Execute tests |
| Test fixtures | ✅ | ❌ | Gap | P1 | principals.yaml |
| Resource fixtures | ✅ | ❌ | Gap | P1 | resources.yaml |
| AuxData fixtures | ✅ | ❌ | Gap | P2 | auxData.yaml |
| Input fixtures | ✅ | ❌ | Gap | P1 | Test input data |
| Expected effect assertion | ✅ | ❌ | Gap | P1 | EFFECT_ALLOW/DENY |
| Expected outputs assertion | ✅ | ❌ | Gap | P2 | Output validation |
| Test name/description | ✅ | ❌ | Gap | P1 | For debugging |
| Test skip flag | ✅ | ❌ | Gap | P2 | skip: true |
| **Test Output** | | | | | |
| TAP format output | ✅ | ❌ | Gap | P2 | Test Anything Protocol |
| JSON output | ✅ | ❌ | Gap | P2 | Machine readable |
| Verbose mode | ✅ | ❌ | Gap | P2 | Detailed failure info |
| JUnit XML output | ✅ | ❌ | Gap | P2 | CI integration |
| **CI/CD Integration** | | | | | |
| Exit code on failure | ✅ | ❌ | Gap | P1 | Non-zero on error |
| GitHub Actions example | ✅ | ❌ | Gap | P2 | |
| GitLab CI example | ✅ | ❌ | Gap | P3 | |

---

## 7. Observability & Operations

| Feature | Cerbos | AuthZ Engine | Status | Priority | Notes |
|---------|--------|--------------|--------|----------|-------|
| **Metrics** | | | | | |
| Prometheus endpoint | ✅ | ❌ | Gap | P2 | /metrics |
| Request count metrics | ✅ | ❌ | Gap | P2 | cerbos_* prefix |
| Latency histograms | ✅ | ❌ | Gap | P2 | Per endpoint |
| Policy evaluation metrics | ✅ | ❌ | Gap | P2 | Decision counts |
| Engine compilation metrics | ✅ | ❌ | Gap | P2 | Policy load times |
| gRPC metrics | ✅ | ❌ | Gap | P3 | Via interceptors |
| Custom metric labels | ✅ | ❌ | Gap | P3 | |
| **Distributed Tracing** | | | | | |
| OpenTelemetry support | ✅ | ❌ | Gap | P2 | OTLP exporter |
| Jaeger integration | ✅ | ❌ | Gap | P3 | |
| Zipkin integration | ✅ | ❌ | Gap | P3 | |
| Trace sampling | ✅ | ❌ | Gap | P3 | AlwaysOn/Probabilistic |
| Trace context propagation | ✅ | ❌ | Gap | P2 | W3C TraceContext |
| Span attributes | ✅ | ❌ | Gap | P2 | Custom attributes |
| **Audit Backends (Detailed)** | | | | | |
| Local backend | ✅ | ❌ | Gap | P2 | In-memory |
| File backend | ✅ | ❌ | Gap | P2 | JSON files |
| Kafka backend | ✅ | ❌ | Gap | P3 | Streaming |
| Hub backend | ✅ | ❌ | Gap | P3 | Cerbos Hub |
| Audit log filtering | ✅ | ❌ | Gap | P2 | Include/exclude |
| Access log retention | ✅ | ❌ | Gap | P2 | |
| Decision log retention | ✅ | ❌ | Gap | P2 | |
| Log rotation | ✅ | ❌ | Gap | P2 | File backend |
| **Logging** | | | | | |
| JSON structured logs | ✅ | 🔶 | Partial | P1 | Via pino |
| Log levels | ✅ | ✅ | Complete | P0 | |
| Request ID correlation | ✅ | ❌ | Gap | P1 | |
| Source location | ✅ | ❌ | Gap | P2 | File:line |

---

## 8. Deployment & CLI

| Feature | Cerbos | AuthZ Engine | Status | Priority | Notes |
|---------|--------|--------------|--------|----------|-------|
| **CLI Commands** | | | | | |
| `cerbos server` | ✅ | 🔶 | Adapted | P0 | npm start |
| `cerbos compile` | ✅ | ❌ | Gap | P1 | Policy validation |
| `cerbos run` | ✅ | ❌ | Gap | P1 | Policy tests |
| `cerbosctl` admin CLI | ✅ | ❌ | Gap | P2 | Admin operations |
| Version command | ✅ | ❌ | Gap | P2 | |
| Config validation | ✅ | ❌ | Gap | P1 | |
| **Deployment Patterns** | | | | | |
| Docker container | ✅ | 🔶 | Partial | P0 | Dockerfile exists |
| Kubernetes deployment | ✅ | ❌ | Gap | P1 | Helm chart |
| Sidecar pattern | ✅ | ❌ | Gap | P2 | K8s pod sidecar |
| DaemonSet pattern | ✅ | ❌ | Gap | P3 | Node-level |
| Serverless (Lambda) | ✅ | ❌ | Gap | P3 | |
| **High Availability** | | | | | |
| Horizontal scaling | ✅ | 🔶 | Partial | P1 | Stateless |
| Load balancer health | ✅ | ✅ | Complete | P0 | /health |
| Graceful shutdown | ✅ | ❌ | Gap | P1 | |
| Zero-downtime reload | ✅ | ❌ | Gap | P2 | |
| **Configuration** | | | | | |
| YAML config file | ✅ | 🔶 | Partial | P0 | |
| Environment variables | ✅ | ✅ | Complete | P0 | |
| Config hot reload | ✅ | ❌ | Gap | P2 | |
| Secret management | ✅ | ❌ | Gap | P2 | |

---

## 9. Advanced Features & Use Cases

| Feature | Cerbos | AuthZ Engine | Status | Priority | Notes |
|---------|--------|--------------|--------|----------|-------|
| **Access Control Models** | | | | | |
| RBAC (Role-Based) | ✅ | ✅ | Complete | P0 | Core functionality |
| ABAC (Attribute-Based) | ✅ | ✅ | Complete | P0 | Via CEL conditions |
| PBAC (Policy-Based) | ✅ | ✅ | Complete | P0 | Core design |
| ReBAC (Relationship-Based) | ✅ | ❌ | Gap | P2 | Graph-based relations |
| **Developer Tools** | | | | | |
| Cerbos Playground | ✅ | ❌ | Gap | P3 | Sandboxed environment |
| REPL (CLI interactive) | ✅ | ❌ | Gap | P2 | Read-eval-print loop |
| IDE plugins | ✅ | ❌ | Gap | P3 | VSCode syntax check |
| Policy linting | ✅ | ❌ | Gap | P2 | Best practices check |
| **WebAssembly (WASM)** | | | | | |
| Embedded PDP | ✅ | ❌ | Gap | P2 | Browser/edge runtime |
| On-device authorization | ✅ | ❌ | Gap | P2 | Mobile/IoT |
| Edge deployment | ✅ | ❌ | Gap | P2 | CDN workers |
| **Multi-Tenancy** | | | | | |
| Tenant isolation | ✅ | 🔶 | Partial | P1 | Via scopes |
| Per-tenant policies | ✅ | ❌ | Gap | P1 | Tenant-specific rules |
| Tenant hierarchy | ✅ | ❌ | Gap | P2 | Organization trees |
| **Security & Compliance** | | | | | |
| Zero Trust support | ✅ | ✅ | Complete | P0 | Deny by default |
| HIPAA compliance features | ✅ | ❌ | Gap | P2 | Healthcare |
| PCI DSS compliance | ✅ | ❌ | Gap | P2 | Payment data |
| GDPR compliance | ✅ | ❌ | Gap | P2 | Data privacy |
| SOC 2 audit trails | ✅ | ❌ | Gap | P2 | |
| Air-gapped deployment | ✅ | ✅ | Complete | P0 | Self-hosted |
| **AI & Agent Authorization** | | | | | |
| AI agent access control | ✅ | ✅ | Complete | P0 | Via agentic module |
| MCP server authorization | ✅ | ❌ | Gap | P1 | Model Context Protocol |
| Non-human identity | ✅ | ✅ | Complete | P0 | Service accounts |
| RAG access filtering | ✅ | ❌ | Gap | P1 | Permissions-aware |
| Decision logging for AI | ✅ | ✅ | Complete | P0 | Audit trail |
| **Query Planning** | | | | | |
| Permissions-aware filtering | ✅ | ❌ | Gap | P1 | PlanResources |
| Query plan API | ✅ | ❌ | Gap | P1 | Filter generation |
| Database query integration | ✅ | ❌ | Gap | P1 | SQL/Mongo filters |
| **Standards Compliance** | | | | | |
| AuthZEN compliance | ✅ | ❌ | Gap | P2 | OpenID AuthZEN |
| OpenFGA compatibility | ✅ | ❌ | Gap | P3 | |
| **GitOps & CI/CD** | | | | | |
| GitOps workflow | ✅ | ❌ | Gap | P2 | Git as source |
| GitHub Actions | ✅ | ❌ | Gap | P2 | Policy CI |
| Policy versioning | ✅ | ✅ | Complete | P0 | |
| Coordinated rollout | ✅ | ❌ | Gap | P2 | Multi-PDP sync |
| **Multi-Language SDKs** | | | | | |
| TypeScript SDK | ✅ | ✅ | Complete | P0 | |
| Go SDK | ✅ | 🚫 | N/A | P3 | Out of scope |
| Java SDK | ✅ | 🚫 | N/A | P3 | Out of scope |
| Python SDK | ✅ | ❌ | Gap | P3 | Future |
| Rust SDK | ✅ | 🚫 | N/A | P3 | Out of scope |
| .NET SDK | ✅ | 🚫 | N/A | P3 | Out of scope |
| Ruby SDK | ✅ | 🚫 | N/A | P3 | Out of scope |
| PHP SDK | ✅ | 🚫 | N/A | P3 | Out of scope |

---

## 10. Summary Statistics

### 10.1 Feature Completion by Category

| Category | Total Features | Implemented | Partial | Not Started | Completion |
|----------|---------------|-------------|---------|-------------|------------|
| Policy Types | 40 | 20 | 3 | 17 | 50% |
| CEL Functions | 55 | 21 | 2 | 32 | 38% |
| API Endpoints | 25 | 10 | 7 | 8 | 40% |
| Storage/Config | 28 | 6 | 4 | 18 | 21% |
| SDK Features | 16 | 10 | 3 | 3 | 63% |
| Policy Testing | 20 | 0 | 1 | 19 | 3% |
| Observability | 22 | 1 | 1 | 20 | 5% |
| Deployment/CLI | 18 | 3 | 4 | 11 | 17% |
| Advanced Features | 47 | 13 | 1 | 26 | 28% |
| **TOTAL** | **271** | **84** | **26** | **154** | **31%** |

**Phase Progress:**
- ✅ Phase 1: Core Foundation (Complete)
- ✅ Phase 2: Scoped Policies (Complete - 2025-11-24)
- ✅ Phase 3: Principal Policies (Complete - 2025-11-24)
- ✅ Phase 4: Derived Roles Enhancement (Complete - 2025-11-24)
- ⏳ Phase 5: Exported Variables (Next)

*Note: 7 SDK languages marked as N/A (out of scope for TypeScript-only project)*

### 10.2 Priority Distribution

| Priority | Features | Implemented | Gap | Coverage |
|----------|----------|-------------|-----|----------|
| P0 (Critical) | 62 | 59 | 3 | 95% |
| P1 (High) | 86 | 22 | 64 | 26% |
| P2 (Medium) | 90 | 3 | 87 | 3% |
| P3 (Low) | 33 | 0 | 33 | 0% |

**Recent Improvements (Phases 2-4):**
- P0 coverage: 90% → **95%** (+5%)
- P1 coverage: 16% → **26%** (+10%)
- Overall: 27% → **31%** (+4%)

### 10.3 Estimated Effort for Full Parity

| Phase | Features | Estimated Effort |
|-------|----------|------------------|
| Phase 1 (P0 gaps) | 6 features | 1-2 weeks |
| Phase 2 (P1 gaps) | 72 features | 7-10 weeks |
| Phase 3 (P2 gaps) | 86 features | 8-12 weeks |
| Phase 4 (P3 gaps) | 33 features | 4-6 weeks |
| **Total** | **197 features** | **20-30 weeks** |

---

## 11. Recommended Implementation Order

### 11.1 Sprint 1 (Week 1-2): P0 Gaps + Critical P1

1. Action wildcard patterns (`:` delimiter)
2. `cerbosCallId` in responses
3. Request limits configuration
4. TLS configuration
5. Graceful shutdown

### 11.2 Sprint 2 (Week 3-4): Scoped Policies

1. Scope field in policies
2. Scope hierarchy evaluation
3. Scope permissions modes
4. Scope in requests

### 11.3 Sprint 3 (Week 5-6): Principal Policies + Variables

1. Principal policy type
2. Exported variables
3. Import mechanism
4. Local variables in all policy types

### 11.4 Sprint 4 (Week 7-8): PlanResources API

1. PlanResources endpoint
2. Filter kind determination
3. CEL to AST conversion
4. SDK integration

### 11.5 Sprint 5 (Week 9-10): CEL Functions

1. List comprehensions (exists, all, filter, map)
2. Timestamp methods
3. String functions (split, join, replace)
4. `timeSince()` function

### 11.6 Sprint 6 (Week 11-12): Policy Testing Framework

1. `cerbos compile` command equivalent
2. `cerbos run` command equivalent
3. Test file format (`_test.yaml`)
4. Test fixtures support
5. CI/CD integration

### 11.7 Sprint 7 (Week 13-14): Observability

1. Prometheus metrics endpoint
2. OpenTelemetry tracing
3. Request ID correlation
4. Structured audit logging

### 11.8 Sprint 8+ (Week 15+): Advanced Features

1. Role policies
2. JSON Schema validation
3. Policy outputs
4. Advanced storage drivers
5. Full audit logging backends
6. Kubernetes deployment patterns

---

## 12. Related Documents

- [CERBOS-FEATURE-PARITY-SDD.md](./sdd/CERBOS-FEATURE-PARITY-SDD.md)
- [PLAN-RESOURCES-API-SDD.md](./sdd/PLAN-RESOURCES-API-SDD.md)
- [ADR-006-CERBOS-API-COMPATIBILITY.md](./adr/ADR-006-CERBOS-API-COMPATIBILITY.md)
- [POLICY-TESTING-SDD.md](./sdd/POLICY-TESTING-SDD.md) *(Planned)*
- [OBSERVABILITY-SDD.md](./sdd/OBSERVABILITY-SDD.md) *(Planned)*

---

## 13. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.3.0 | 2025-11-24 | **Phases 2-4 Complete**: Updated derived roles (wildcards, circular deps), principal policies (pattern matching, outputs), scoped policies (hierarchy). Policy Types: 33%→50%, P0: 90%→95%, P1: 16%→26%, Overall: 27%→31% |
| 1.2.1 | 2025-11-24 | Cross-referenced with SDD-INDEX, updated SDD/ADR counts |
| 1.2.0 | 2025-11-23 | Added Advanced Features section (WASM, multi-tenancy, AI/agents, compliance). Total: 224→271 |
| 1.1.0 | 2025-11-23 | Added Policy Testing, Observability, Deployment/CLI sections. Total: 159→224 |
| 1.0.0 | 2025-11-23 | Initial feature matrix with 159 features |

---

*This matrix is updated as features are implemented. Check git history for changes.*
