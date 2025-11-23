# Software Design Document: Cerbos Feature Parity

**Version**: 1.0.0
**Status**: Specification
**Last Updated**: 2024-11-23

---

## 1. Overview

### 1.1 Purpose

This document specifies all Cerbos features that must be implemented in AuthZ Engine to achieve full compatibility. It serves as the definitive reference for feature parity requirements.

### 1.2 Scope

This SDD covers:
- Complete policy type specifications
- All CEL expression capabilities
- API endpoint compatibility
- Storage and configuration options
- Feature coverage matrix with implementation status

### 1.3 Reference

- Cerbos Documentation: https://docs.cerbos.dev/cerbos/latest
- Cerbos GitHub: https://github.com/cerbos/cerbos

---

## 2. Policy Types Specification

### 2.1 Policy Type Overview

| Policy Type | Cerbos | AuthZ Engine | Priority |
|-------------|--------|--------------|----------|
| Resource Policy | Yes | Implemented | P0 |
| Derived Roles | Yes | Implemented | P0 |
| Principal Policy | Yes | Partial | P1 |
| Role Policy | Yes | Not Started | P2 |
| Exported Variables | Yes | Partial | P1 |
| Exported Constants | Yes | Not Started | P2 |

### 2.2 Resource Policy (`ResourcePolicy`)

#### 2.2.1 Schema Definition

```yaml
apiVersion: api.cerbos.dev/v1
resourcePolicy:
  version: "default"
  resource: "resource_kind"
  scope: "optional.scope.path"
  scopePermissions: SCOPE_PERMISSIONS_OVERRIDE_PARENT | SCOPE_PERMISSIONS_REQUIRE_PARENTAL_CONSENT
  importDerivedRoles:
    - derived_roles_name
  variables:
    import:
      - exported_variables_name
    local:
      is_owner: "request.resource.attr.owner == request.principal.id"
  constants:
    import:
      - exported_constants_name
    local:
      max_items: 100
  schemas:
    principalSchema:
      ref: cerbos:///principal.json
    resourceSchema:
      ref: cerbos:///resource.json
      ignoreWhen:
        actions: ["create"]
  rules:
    - name: "rule_name"
      actions: ["read", "write", "*"]
      effect: EFFECT_ALLOW | EFFECT_DENY
      roles: ["role1", "role2"]
      derivedRoles: ["derived_role1"]
      condition:
        match:
          all:
            of:
              - expr: "V.is_owner"
              - expr: "request.resource.attr.status == 'active'"
      output:
        when:
          ruleActivated: "output_expression"
          conditionNotMet: "failure_output"
```

#### 2.2.2 Required Features

| Feature | Description | Status |
|---------|-------------|--------|
| `version` | Policy version (default fallback) | Implemented |
| `resource` | Resource kind identifier | Implemented |
| `scope` | Hierarchical scope path | Not Started |
| `scopePermissions` | Inheritance behavior | Not Started |
| `importDerivedRoles` | Import derived roles | Implemented |
| `variables.import` | Import exported variables | Not Started |
| `variables.local` | Local variable definitions | Partial |
| `constants.import` | Import exported constants | Not Started |
| `constants.local` | Local constant definitions | Not Started |
| `schemas` | JSON Schema validation | Not Started |
| `rules[].name` | Rule identifier | Implemented |
| `rules[].actions` | Action patterns with wildcards | Partial |
| `rules[].effect` | ALLOW/DENY | Implemented |
| `rules[].roles` | Static role matching | Implemented |
| `rules[].derivedRoles` | Derived role matching | Implemented |
| `rules[].condition` | CEL condition | Implemented |
| `rules[].output` | Output expressions | Not Started |

#### 2.2.3 Action Wildcard Patterns

Cerbos supports wildcard matching in actions:

```yaml
# Examples:
actions: ["*"]              # Match all actions
actions: ["read:*"]         # Match read:anything
actions: ["*:documents"]    # Match anything:documents
actions: ["a:*:c"]          # Match a:anything:c
```

**Implementation Requirement**: Support `:` delimiter-based wildcards.

### 2.3 Derived Roles (`DerivedRoles`)

#### 2.3.1 Schema Definition

```yaml
apiVersion: api.cerbos.dev/v1
derivedRoles:
  name: "derived_roles_set_name"
  constants:
    import:
      - exported_constants
    local:
      threshold: 0.5
  variables:
    import:
      - exported_variables
    local:
      is_manager: "P.attr.title.startsWith('Manager')"
  definitions:
    - name: "owner"
      parentRoles: ["user"]
      condition:
        match:
          expr: "R.attr.owner == P.id"
    - name: "admin_of_region"
      parentRoles: ["admin", "*"]  # Wildcard matches any role
      condition:
        match:
          all:
            of:
              - expr: "P.attr.region == R.attr.region"
              - expr: "P.attr.clearance >= 5"
```

#### 2.3.2 Required Features

| Feature | Description | Status |
|---------|-------------|--------|
| `name` | Derived roles set identifier | Implemented |
| `definitions[].name` | Individual role name | Implemented |
| `definitions[].parentRoles` | Required static roles | Implemented |
| `definitions[].parentRoles: ["*"]` | Wildcard parent role | Not Started |
| `definitions[].condition` | Activation condition | Implemented |
| `variables` | Variable definitions | Partial |
| `constants` | Constant definitions | Not Started |

### 2.4 Principal Policy (`PrincipalPolicy`)

#### 2.4.1 Schema Definition

```yaml
apiVersion: api.cerbos.dev/v1
principalPolicy:
  principal: "user_id_pattern"
  version: "default"
  scope: "optional.scope"
  scopePermissions: SCOPE_PERMISSIONS_OVERRIDE_PARENT
  variables:
    import: []
    local: {}
  constants:
    import: []
    local: {}
  rules:
    - resource: "document"
      actions:
        - action: "delete"
          effect: EFFECT_DENY
          condition:
            match:
              expr: "R.attr.status == 'protected'"
          output:
            when:
              ruleActivated: "'User cannot delete protected docs'"
    - resource: "*"  # Wildcard resource
      actions:
        - action: "*"
          effect: EFFECT_ALLOW
```

#### 2.4.2 Required Features

| Feature | Description | Status |
|---------|-------------|--------|
| `principal` | Target principal identifier | Not Started |
| `version` | Policy version | Not Started |
| `scope` | Scope path | Not Started |
| `rules[].resource` | Target resource (wildcards) | Not Started |
| `rules[].actions[].action` | Action name | Not Started |
| `rules[].actions[].effect` | ALLOW/DENY | Not Started |
| `rules[].actions[].condition` | Condition expression | Not Started |
| `rules[].actions[].output` | Output expression | Not Started |

### 2.5 Role Policy (`RolePolicy`)

#### 2.5.1 Schema Definition

```yaml
apiVersion: api.cerbos.dev/v1
rolePolicy:
  role: "custom_role_name"
  scope: "optional.scope"
  parentRoles:
    - "parent_role"
  rules:
    - resource: "document"
      allowActions:
        - "view"
        - "view:*"
        - "edit"
      condition:
        match:
          expr: "R.attr.department == P.attr.department"
    - resource: "*"
      allowActions: ["view"]
```

#### 2.5.2 Required Features

| Feature | Description | Status |
|---------|-------------|--------|
| `role` | Custom role name | Not Started |
| `scope` | Scope path | Not Started |
| `parentRoles` | Inherited roles | Not Started |
| `rules[].resource` | Target resource | Not Started |
| `rules[].allowActions` | Allowed actions list | Not Started |
| `rules[].condition` | Action condition | Not Started |

**Key Behavior**: Role policies use an allowlist model - any action not explicitly listed is DENIED.

### 2.6 Exported Variables (`ExportVariables`)

#### 2.6.1 Schema Definition

```yaml
apiVersion: api.cerbos.dev/v1
exportVariables:
  name: "common_variables"
  definitions:
    is_owner: "request.resource.attr.owner == request.principal.id"
    is_admin: "request.principal.roles.exists(r, r == 'admin')"
    resource_age_days: "timestamp(R.attr.createdAt).timeSince() / duration('24h')"
```

#### 2.6.2 Required Features

| Feature | Description | Status |
|---------|-------------|--------|
| `name` | Export set identifier | Not Started |
| `definitions` | Variable name → expression map | Not Started |
| Import mechanism | `variables.import` in policies | Not Started |

### 2.7 Exported Constants (`ExportConstants`)

#### 2.7.1 Schema Definition

```yaml
apiVersion: api.cerbos.dev/v1
exportConstants:
  name: "common_constants"
  definitions:
    max_file_size: 10485760
    allowed_regions: ["us-east", "us-west", "eu-central"]
    rate_limits:
      free: 100
      pro: 1000
      enterprise: 10000
```

#### 2.7.2 Required Features

| Feature | Description | Status |
|---------|-------------|--------|
| `name` | Export set identifier | Not Started |
| `definitions` | Constant name → value map | Not Started |
| Import mechanism | `constants.import` in policies | Not Started |

---

## 3. CEL Expression Capabilities

### 3.1 Top-Level Identifiers

| Identifier | Alias | Description | Status |
|------------|-------|-------------|--------|
| `request.principal` | `P` | Principal object | Implemented |
| `request.resource` | `R` | Resource object | Implemented |
| `request.auxData` | - | Auxiliary data (JWT, etc.) | Partial |
| `variables` | `V` | Policy variables | Partial |
| `constants` | `C` | Policy constants | Not Started |
| `globals` | `G` | Engine-level globals | Not Started |
| `runtime.effectiveDerivedRoles` | - | Computed derived roles | Partial |

### 3.2 Principal Object Structure

```typescript
interface Principal {
  id: string;                              // Implemented
  roles: string[];                         // Implemented
  attr: Record<string, unknown>;           // Implemented as `attributes`
  policyVersion?: string;                  // Not Started
  scope?: string;                          // Not Started
}
```

### 3.3 Resource Object Structure

```typescript
interface Resource {
  kind: string;                            // Implemented
  id: string;                              // Implemented
  attr: Record<string, unknown>;           // Implemented as `attributes`
  policyVersion?: string;                  // Not Started
  scope?: string;                          // Not Started
}
```

### 3.4 CEL Functions by Category

#### 3.4.1 String Functions

| Function | Signature | Status |
|----------|-----------|--------|
| `startsWith` | `string.startsWith(prefix: string) → bool` | Implemented |
| `endsWith` | `string.endsWith(suffix: string) → bool` | Implemented |
| `contains` | `string.contains(substr: string) → bool` | Implemented |
| `matches` | `string.matches(regex: string) → bool` | Implemented |
| `size` | `size(string) → int` | Implemented |
| `split` | `string.split(delimiter: string) → list` | Not Started |
| `join` | `list.join(delimiter: string) → string` | Not Started |
| `replace` | `string.replace(old, new) → string` | Not Started |
| `trim` | `string.trim() → string` | Not Started |
| `lowerAscii` | `string.lowerAscii() → string` | Not Started |
| `upperAscii` | `string.upperAscii() → string` | Not Started |
| `base64.encode` | `base64.encode(bytes) → string` | Not Started |
| `base64.decode` | `base64.decode(string) → bytes` | Not Started |

#### 3.4.2 List/Map Functions

| Function | Signature | Status |
|----------|-----------|--------|
| `size` | `size(list|map) → int` | Implemented |
| `in` | `value in list|map → bool` | Implemented |
| `exists` | `list.exists(x, expr) → bool` | Not Started |
| `all` | `list.all(x, expr) → bool` | Not Started |
| `filter` | `list.filter(x, expr) → list` | Not Started |
| `map` | `list.map(x, expr) → list` | Not Started |
| `exists_one` | `list.exists_one(x, expr) → bool` | Not Started |
| `intersects` | `list.intersects(other) → bool` | Not Started |
| `isSubset` | `list.isSubset(other) → bool` | Not Started |
| `flatten` | `list.flatten() → list` | Not Started |
| `sortBy` | `list.sortBy(x, expr) → list` | Not Started |
| `distinct` | `list.distinct() → list` | Not Started |

#### 3.4.3 Timestamp/Duration Functions

| Function | Signature | Status |
|----------|-----------|--------|
| `timestamp` | `timestamp(string|int) → Timestamp` | Implemented |
| `duration` | `duration(string) → Duration` | Implemented |
| `now` | `now → Timestamp` | Implemented |
| `timeSince` | `timestamp.timeSince() → Duration` | Not Started |
| `getFullYear` | `timestamp.getFullYear() → int` | Not Started |
| `getMonth` | `timestamp.getMonth() → int` | Not Started |
| `getDayOfMonth` | `timestamp.getDayOfMonth() → int` | Not Started |
| `getDayOfWeek` | `timestamp.getDayOfWeek() → int` | Not Started |
| `getDayOfYear` | `timestamp.getDayOfYear() → int` | Not Started |
| `getHours` | `timestamp.getHours() → int` | Not Started |
| `getMinutes` | `timestamp.getMinutes() → int` | Not Started |
| `getSeconds` | `timestamp.getSeconds() → int` | Not Started |
| `getMilliseconds` | `timestamp.getMilliseconds() → int` | Not Started |

#### 3.4.4 Hierarchy Functions

| Function | Signature | Status |
|----------|-----------|--------|
| `hierarchy` | `hierarchy(string) → Hierarchy` | Not Started |
| `ancestorOf` | `hierarchy.ancestorOf(other) → bool` | Not Started |
| `descendantOf` | `hierarchy.descendantOf(other) → bool` | Not Started |
| `siblingOf` | `hierarchy.siblingOf(other) → bool` | Not Started |
| `overlaps` | `hierarchy.overlaps(other) → bool` | Not Started |

#### 3.4.5 IP Address Functions

| Function | Signature | Status |
|----------|-----------|--------|
| `inIPAddrRange` | `inIPAddrRange(ip, cidr) → bool` | Implemented |

#### 3.4.6 Math Functions

| Function | Signature | Status |
|----------|-----------|--------|
| `math.abs` | `math.abs(num) → num` | Not Started |
| `math.greatest` | `math.greatest(a, b, ...) → num` | Not Started |
| `math.least` | `math.least(a, b, ...) → num` | Not Started |
| `math.ceil` | `math.ceil(double) → int` | Not Started |
| `math.floor` | `math.floor(double) → int` | Not Started |
| `math.round` | `math.round(double) → int` | Not Started |
| `math.bitAnd` | `math.bitAnd(a, b) → int` | Not Started |
| `math.bitOr` | `math.bitOr(a, b) → int` | Not Started |
| `math.bitXor` | `math.bitXor(a, b) → int` | Not Started |
| `math.bitNot` | `math.bitNot(a) → int` | Not Started |
| `math.bitShiftLeft` | `math.bitShiftLeft(a, n) → int` | Not Started |
| `math.bitShiftRight` | `math.bitShiftRight(a, n) → int` | Not Started |

### 3.5 Condition Match Operators

```yaml
# Single expression
condition:
  match:
    expr: "single_expression"

# AND - all must be true
condition:
  match:
    all:
      of:
        - expr: "expr1"
        - expr: "expr2"

# OR - at least one must be true
condition:
  match:
    any:
      of:
        - expr: "expr1"
        - expr: "expr2"

# NOT - none must be true
condition:
  match:
    none:
      of:
        - expr: "expr1"

# Nested operators
condition:
  match:
    all:
      of:
        - any:
            of:
              - expr: "a"
              - expr: "b"
        - none:
            of:
              - expr: "c"
```

| Operator | Description | Status |
|----------|-------------|--------|
| `expr` | Single expression | Implemented |
| `all.of` | Logical AND | Not Started |
| `any.of` | Logical OR | Not Started |
| `none.of` | Logical NOT | Not Started |
| Nesting | Nested operators | Not Started |

---

## 4. API Specification

### 4.1 Endpoints

| Endpoint | Method | Cerbos | AuthZ Engine | Status |
|----------|--------|--------|--------------|--------|
| `/api/check/resources` | POST | Yes | `/api/check` | Partial |
| `/api/plan/resources` | POST | Yes | Not Implemented | Not Started |
| `/api/server_info` | GET | Yes | `/health` | Adapted |
| `/health` | GET | Yes | Yes | Implemented |
| Admin API | Various | Yes | Partial | Partial |

### 4.2 CheckResources Request

```typescript
interface CheckResourcesRequest {
  requestId?: string;
  principal: {
    id: string;
    roles: string[];
    attr?: Record<string, unknown>;
    policyVersion?: string;
    scope?: string;
  };
  resources: Array<{
    resource: {
      kind: string;
      id: string;
      attr?: Record<string, unknown>;
      policyVersion?: string;
      scope?: string;
    };
    actions: string[];
  }>;
  auxData?: {
    jwt?: {
      token: string;
      keySetId?: string;
    };
  };
  includeMeta?: boolean;
}
```

### 4.3 CheckResources Response

```typescript
interface CheckResourcesResponse {
  requestId: string;
  results: Array<{
    resource: {
      kind: string;
      id: string;
      policyVersion?: string;
      scope?: string;
    };
    actions: Record<string, {
      effect: 'EFFECT_ALLOW' | 'EFFECT_DENY';
      policy: string;
    }>;
    validationErrors?: Array<{
      path: string;
      message: string;
      source: 'SOURCE_PRINCIPAL' | 'SOURCE_RESOURCE';
    }>;
    meta?: {
      actions: Record<string, {
        matchedPolicy: string;
        matchedScope?: string;
      }>;
      effectiveDerivedRoles?: string[];
    };
    outputs?: Array<{
      src: string;
      val: unknown;
    }>;
  }>;
  cerbosCallId: string;
}
```

### 4.4 PlanResources Request

```typescript
interface PlanResourcesRequest {
  requestId?: string;
  action: string;
  principal: {
    id: string;
    roles: string[];
    attr?: Record<string, unknown>;
    policyVersion?: string;
    scope?: string;
  };
  resource: {
    kind: string;
    attr?: Record<string, unknown>;
    policyVersion?: string;
    scope?: string;
  };
  auxData?: {
    jwt?: {
      token: string;
      keySetId?: string;
    };
  };
  includeMeta?: boolean;
}
```

### 4.5 PlanResources Response

```typescript
interface PlanResourcesResponse {
  requestId: string;
  action: string;
  resourceKind: string;
  policyVersion: string;
  filter: {
    kind: 'KIND_ALWAYS_ALLOWED' | 'KIND_ALWAYS_DENIED' | 'KIND_CONDITIONAL';
    condition?: {
      // AST representation of the condition
      expression: ConditionAST;
    };
  };
  meta?: {
    filterDebug?: string;
    matchedScope?: string;
  };
  validationErrors?: ValidationError[];
  cerbosCallId: string;
}

// Condition AST operators
type ConditionOperator =
  | 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge'
  | 'and' | 'or' | 'not'
  | 'add' | 'sub' | 'mult' | 'div' | 'mod'
  | 'in' | 'index' | 'list' | 'lambda';
```

### 4.6 gRPC Services

```protobuf
syntax = "proto3";
package cerbos.svc.v1;

service CerbosService {
  rpc CheckResources(CheckResourcesRequest) returns (CheckResourcesResponse);
  rpc PlanResources(PlanResourcesRequest) returns (PlanResourcesResponse);
  rpc ServerInfo(ServerInfoRequest) returns (ServerInfoResponse);
}

service CerbosAdminService {
  rpc AddOrUpdatePolicy(AddOrUpdatePolicyRequest) returns (AddOrUpdatePolicyResponse);
  rpc ListPolicies(ListPoliciesRequest) returns (ListPoliciesResponse);
  rpc GetPolicy(GetPolicyRequest) returns (GetPolicyResponse);
  rpc DisablePolicy(DisablePolicyRequest) returns (DisablePolicyResponse);
  rpc EnablePolicy(EnablePolicyRequest) returns (EnablePolicyResponse);
  rpc ListAuditLogEntries(ListAuditLogEntriesRequest) returns (stream AuditLogEntry);
  rpc AddOrUpdateSchema(AddOrUpdateSchemaRequest) returns (AddOrUpdateSchemaResponse);
  rpc ListSchemas(ListSchemasRequest) returns (ListSchemasResponse);
  rpc GetSchema(GetSchemaRequest) returns (GetSchemaResponse);
  rpc DeleteSchema(DeleteSchemaRequest) returns (DeleteSchemaResponse);
  rpc ReloadStore(ReloadStoreRequest) returns (ReloadStoreResponse);
}
```

---

## 5. Storage Backends

### 5.1 Storage Driver Support

| Driver | Cerbos | AuthZ Engine | Priority |
|--------|--------|--------------|----------|
| Disk | Yes | Implemented | P0 |
| Git | Yes | Not Started | P2 |
| Blob (S3/GCS) | Yes | Not Started | P3 |
| PostgreSQL | Yes | Partial | P1 |
| MySQL | Yes | Not Started | P3 |
| SQLite | Yes | Not Started | P2 |
| Cerbos Hub | Yes | N/A | N/A |
| Overlay | Yes | Not Started | P3 |

### 5.2 Disk Driver Configuration

```yaml
storage:
  driver: disk
  disk:
    directory: /path/to/policies
    watchForChanges: true  # Hot reload
```

| Feature | Status |
|---------|--------|
| Directory loading | Implemented |
| Watch for changes | Not Started |
| Recursive loading | Implemented |
| Schema loading | Not Started |

### 5.3 Database Driver Configuration

```yaml
storage:
  driver: postgres
  postgres:
    url: "postgres://user:pass@host:5432/db?sslmode=require"
    connPool:
      maxLifeTime: 1h
      maxIdleTime: 10m
      maxOpen: 10
      maxIdle: 5
```

| Feature | Status |
|---------|--------|
| Connection pooling | Not Started |
| Policy CRUD | Not Started |
| Schema storage | Not Started |
| Migrations | Not Started |

---

## 6. Configuration Options

### 6.1 Server Configuration

```yaml
server:
  httpListenAddr: ":3592"
  grpcListenAddr: ":3593"
  tls:
    cert: /path/to/cert.pem
    key: /path/to/key.pem
  cors:
    allowedOrigins: ["*"]
    allowedHeaders: ["*"]
    maxAge: 600
  requestLimits:
    maxActionsPerResource: 50
    maxResourcesPerRequest: 50
```

| Feature | Status |
|---------|--------|
| HTTP server | Implemented |
| gRPC server | Partial |
| TLS | Not Started |
| CORS | Implemented |
| Request limits | Not Started |

### 6.2 Audit Logging

```yaml
audit:
  enabled: true
  accessLogsEnabled: true
  decisionLogsEnabled: true
  backend: local | file | kafka | hub
  local:
    storagePath: /path/to/audit
    retentionPeriod: 168h
  file:
    path: /path/to/audit.log
  kafka:
    brokers: ["broker1:9092"]
    topic: cerbos-audit
    produceSync: true
```

| Feature | Status |
|---------|--------|
| Access logs | Not Started |
| Decision logs | Partial (via agents) |
| Local backend | Not Started |
| File backend | Not Started |
| Kafka backend | Not Started |

### 6.3 Schema Enforcement

```yaml
schema:
  enforcement: none | warn | reject
  cacheSize: 1024
```

| Feature | Status |
|---------|--------|
| Schema loading | Not Started |
| Warn mode | Not Started |
| Reject mode | Not Started |
| Schema caching | Not Started |

### 6.4 JWT/AuxData

```yaml
auxData:
  jwt:
    acceptableTimeSkew: 5s
    cacheSize: 1000
    keySets:
      local:
        id: local
        local:
          data: |
            { "keys": [...] }
      remote:
        id: remote
        remote:
          url: https://example.com/.well-known/jwks.json
          refreshInterval: 1h
```

| Feature | Status |
|---------|--------|
| JWT verification | Not Started |
| JWKS local | Not Started |
| JWKS remote | Not Started |
| Token caching | Not Started |

---

## 7. Feature Coverage Matrix

### 7.1 Policy Features

| Feature | Cerbos | AuthZ Engine | Gap | Priority |
|---------|--------|--------------|-----|----------|
| Resource policies | Yes | Yes | None | - |
| Derived roles | Yes | Yes | None | - |
| Principal policies | Yes | No | Full | P1 |
| Role policies | Yes | No | Full | P2 |
| Exported variables | Yes | Partial | Import mechanism | P1 |
| Exported constants | Yes | No | Full | P2 |
| Scoped policies | Yes | No | Full | P1 |
| Scope permissions | Yes | No | Full | P1 |
| JSON Schema validation | Yes | No | Full | P2 |
| Policy outputs | Yes | No | Full | P2 |
| Action wildcards | Yes | Partial | Pattern matching | P1 |

### 7.2 CEL Functions

| Category | Cerbos Count | AuthZ Engine | Gap |
|----------|--------------|--------------|-----|
| String | 15+ | 5 | 10+ |
| List/Map | 12+ | 3 | 9+ |
| Timestamp | 12+ | 3 | 9+ |
| Hierarchy | 5 | 0 | 5 |
| IP Address | 1 | 1 | 0 |
| Math | 12+ | 0 | 12+ |

### 7.3 API Features

| Feature | Cerbos | AuthZ Engine | Gap |
|---------|--------|--------------|-----|
| CheckResources | Yes | Yes | Minor differences |
| PlanResources | Yes | No | Full |
| Batch requests | Yes | Partial | Max limits |
| Server info | Yes | Yes | Adapted |
| Admin API | Yes | Partial | CRUD operations |
| gRPC reflection | Yes | No | Full |

### 7.4 Infrastructure

| Feature | Cerbos | AuthZ Engine | Gap |
|---------|--------|--------------|-----|
| Disk storage | Yes | Yes | Watch mode |
| Git storage | Yes | No | Full |
| Database storage | Yes | Partial | Full CRUD |
| Audit logging | Yes | Partial | Backends |
| Telemetry | Yes | No | Full |
| JWT validation | Yes | No | Full |
| Schema enforcement | Yes | No | Full |

---

## 8. Implementation Priorities

### 8.1 Phase 1 - Core Compatibility (P0)

Already implemented:
- Resource policies
- Derived roles
- Basic CEL evaluation
- REST API (check endpoint)

### 8.2 Phase 2 - Feature Parity (P1)

Priority features for next sprint:

1. **Scoped Policies**
   - Scope field in policies
   - Scope hierarchy evaluation
   - Scope permissions modes

2. **Principal Policies**
   - User-specific overrides
   - Wildcard resource matching

3. **PlanResources API**
   - Query plan generation
   - Condition AST output

4. **CEL Functions**
   - List comprehensions (exists, all, filter, map)
   - Timestamp methods
   - String functions

5. **Exported Variables/Constants**
   - Export policy types
   - Import mechanism

### 8.3 Phase 3 - Advanced Features (P2)

1. Role policies
2. JSON Schema validation
3. Policy outputs
4. Advanced storage drivers
5. Full audit logging

### 8.4 Phase 4 - Enterprise Features (P3)

1. Git storage driver
2. Blob storage (S3/GCS)
3. Full Admin API
4. mTLS support
5. Telemetry

---

## 9. Testing Requirements

### 9.1 Compatibility Tests

For each Cerbos feature, create tests that:
1. Parse identical policy YAML
2. Process identical requests
3. Produce identical responses

### 9.2 Test Categories

| Category | Description |
|----------|-------------|
| Policy parsing | All 6 policy types |
| CEL evaluation | All function categories |
| API compatibility | Request/response formats |
| Edge cases | Wildcards, nesting, errors |

---

## 10. Related Documents

- [CORE-PACKAGE-SDD.md](./CORE-PACKAGE-SDD.md)
- [SERVER-PACKAGE-SDD.md](./SERVER-PACKAGE-SDD.md)
- [ADR-006-CERBOS-API-COMPATIBILITY.md](../adr/ADR-006-CERBOS-API-COMPATIBILITY.md)

---

## 11. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-11-23 | Initial comprehensive feature parity specification |
