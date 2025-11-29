# Phase 3: Principal Policies - Architectural Design Document

**Version**: 1.0.0
**Date**: 2025-11-24
**Author**: Claude Code (Sonnet 4.5)
**Status**: 🚧 **DESIGN PHASE**

## Executive Summary

Phase 3 introduces **Principal Policies** - authorization policies that are bound to specific principals (users/services) rather than resources. This enables per-user permission overrides, role-based scope inheritance, and fine-grained multi-tenant access control.

### Key Features

1. **Principal-Level Policies**: Policies defined `FOR` specific principals
2. **Role-Based Scope Inheritance**: Principals inherit policies through role membership
3. **Policy Priority System**: Principal policies override resource policies
4. **Efficient Principal Index**: O(1) lookups by principal ID
5. **Backward Compatible**: Zero breaking changes to Phase 2 resource policies

## Current State (Phase 2)

### Resource-Centric Model

Currently, all policies are **resource-centric**:

```yaml
apiVersion: authz/v1
name: document-policy
resourceKind: document
scope: acme.corp.engineering
rules:
  - name: allow-engineers-read
    actions: [read]
    roles: [engineer]
    effect: allow
```

**Limitations**:
- Policies apply to ALL principals with matching roles
- Cannot grant exceptions to specific users
- No way to override resource policies for VIPs
- Role changes require policy redeployment

### Phase 2 Architecture

```
┌─────────────┐
│   Request   │
│ Principal   │──────┐
│ Resource    │      │
│ Actions     │      │
└─────────────┘      │
                     ▼
              ┌──────────────┐
              │    Engine    │
              │ FindPolicies │
              │  (Resource)  │
              └──────────────┘
                     │
                     ▼
        ┌────────────────────────┐
        │   Scope Resolution     │
        │ resource.scope → chain │
        └────────────────────────┘
                     │
                     ▼
        ┌────────────────────────┐
        │   ScopeIndex Lookup    │
        │ scope[kind] → policies │
        └────────────────────────┘
```

## Phase 3: Principal Policies

### Dual-Model Architecture

Phase 3 introduces **two parallel policy models**:

1. **Resource Policies** (existing): Apply to resources by kind/scope
2. **Principal Policies** (new): Apply to specific principals or roles

### Principal Policy Structure

```yaml
apiVersion: authz/v1
name: alice-admin-override
principalPolicy: true              # NEW: Marks as principal policy
principal:
  id: user:alice                   # NEW: Specific principal ID
  scope: acme.corp                 # NEW: Principal's scope context
  roles: [admin]                   # NEW: Required roles (optional)
resources:
  - kind: document                 # Resources this applies to
    scope: acme.corp               # Resource scope pattern (optional)
rules:
  - name: alice-full-access
    actions: [*]
    effect: allow
```

### Role-Based Principal Policies

```yaml
apiVersion: authz/v1
name: global-admins-override
principalPolicy: true
principal:
  roles: [global-admin]            # Applies to ALL global-admins
resources:
  - kind: *                        # ALL resource kinds
    scope: **                      # ALL scopes (wildcard)
rules:
  - name: admin-full-access
    actions: [*]
    effect: allow
```

### Policy Evaluation Order

**Priority**: Principal policies are evaluated BEFORE resource policies:

```
┌──────────────────────────┐
│    1. Principal Policies │ ← Highest priority
│       (user-specific)    │
└──────────────────────────┘
            ↓ (if no match)
┌──────────────────────────┐
│   2. Role-Based Principal│
│       Policies           │
└──────────────────────────┘
            ↓ (if no match)
┌──────────────────────────┐
│   3. Resource Policies   │ ← Existing Phase 2
│    (scope inheritance)   │
└──────────────────────────┘
            ↓ (if no match)
┌──────────────────────────┐
│   4. Global Policies     │ ← Fallback
└──────────────────────────┘
```

### Deny Overrides Rule

**IMPORTANT**: If ANY policy (principal or resource) evaluates to `DENY`, the final effect is `DENY`, regardless of priority.

```
Principal Policy: ALLOW
Resource Policy: DENY
──────────────────────
Final Result: DENY ❌
```

## Data Structures

### Extended Types

#### `types.Policy` (Extended)

```go
type Policy struct {
    APIVersion   string  `json:"apiVersion" yaml:"apiVersion"`
    Name         string  `json:"name" yaml:"name"`
    ResourceKind string  `json:"resourceKind" yaml:"resourceKind"`
    Rules        []*Rule `json:"rules" yaml:"rules"`
    Scope        string  `json:"scope,omitempty" yaml:"scope,omitempty"`

    // NEW Phase 3 fields
    PrincipalPolicy bool                 `json:"principalPolicy,omitempty" yaml:"principalPolicy,omitempty"`
    Principal       *PrincipalSelector   `json:"principal,omitempty" yaml:"principal,omitempty"`
    Resources       []*ResourceSelector  `json:"resources,omitempty" yaml:"resources,omitempty"`
}
```

#### `types.PrincipalSelector` (NEW)

```go
// PrincipalSelector defines which principals this policy applies to
type PrincipalSelector struct {
    ID    string   `json:"id,omitempty" yaml:"id,omitempty"`        // Specific principal ID (e.g., "user:alice")
    Roles []string `json:"roles,omitempty" yaml:"roles,omitempty"`  // Match ANY of these roles
    Scope string   `json:"scope,omitempty" yaml:"scope,omitempty"`  // Principal's scope context
}
```

#### `types.ResourceSelector` (NEW)

```go
// ResourceSelector defines which resources this principal policy applies to
type ResourceSelector struct {
    Kind  string `json:"kind" yaml:"kind"`                    // Resource kind (supports wildcard *)
    Scope string `json:"scope,omitempty" yaml:"scope,omitempty"` // Scope pattern (supports ** wildcard)
}
```

### Policy Store Extensions

#### `PrincipalIndex` (NEW)

```go
// PrincipalIndex provides O(1) principal policy lookup
type PrincipalIndex struct {
    // principalID -> resourceKind -> policies
    byPrincipal map[string]map[string][]*types.Policy

    // role -> resourceKind -> policies
    byRole      map[string]map[string][]*types.Policy

    mu sync.RWMutex
}

func (i *PrincipalIndex) Add(policy *types.Policy)
func (i *PrincipalIndex) Remove(policy *types.Policy)
func (i *PrincipalIndex) FindByPrincipal(principalID, resourceKind string) []*types.Policy
func (i *PrincipalIndex) FindByRoles(roles []string, resourceKind string) []*types.Policy
```

#### Extended `MemoryStore`

```go
type MemoryStore struct {
    policies       map[string]*types.Policy
    index          *Index          // Resource policies (existing)
    scopeIndex     *ScopeIndex     // Scoped resource policies (Phase 2)
    principalIndex *PrincipalIndex // Principal policies (Phase 3 NEW)
    mu             sync.RWMutex
}
```

## Engine Changes

### `findPoliciesWithPrincipal` (NEW)

```go
// findPoliciesWithPrincipal finds policies using principal-first resolution
func (e *Engine) findPoliciesWithPrincipal(req *types.CheckRequest) ([]*types.Policy, *types.PolicyResolution) {
    var allPolicies []*types.Policy
    resolution := &types.PolicyResolution{
        PrincipalPoliciesMatched: false,
        ResourcePoliciesMatched:  false,
        EvaluationOrder:          []string{},
    }

    // 1. Principal-specific policies (highest priority)
    principalPolicies := e.store.FindPoliciesByPrincipal(req.Principal.ID, req.Resource.Kind)
    if len(principalPolicies) > 0 {
        allPolicies = append(allPolicies, principalPolicies...)
        resolution.PrincipalPoliciesMatched = true
        resolution.EvaluationOrder = append(resolution.EvaluationOrder, "principal-specific")
    }

    // 2. Role-based principal policies
    rolePolicies := e.store.FindPoliciesByRoles(req.Principal.Roles, req.Resource.Kind)
    if len(rolePolicies) > 0 {
        allPolicies = append(allPolicies, rolePolicies...)
        resolution.PrincipalPoliciesMatched = true
        resolution.EvaluationOrder = append(resolution.EvaluationOrder, "role-based-principal")
    }

    // 3. Resource policies (Phase 2 scope resolution)
    resourcePolicies, scopeResult := e.findPoliciesWithScope(
        e.computeEffectiveScope(req),
        req.Resource.Kind,
        req.Actions,
    )
    if len(resourcePolicies) > 0 {
        allPolicies = append(allPolicies, resourcePolicies...)
        resolution.ResourcePoliciesMatched = true
        resolution.EvaluationOrder = append(resolution.EvaluationOrder, "resource-scoped")
    }
    resolution.ScopeResolution = scopeResult

    return allPolicies, resolution
}
```

### Cache Key Extension

```go
// CacheKey must now include principal ID for principal policies
func (r *CheckRequest) CacheKey() string {
    key := fmt.Sprintf("%s:%s:%s:%s:%s:%s:%s",
        r.Principal.ID,     // Already included (Phase 2.1)
        r.Principal.Scope,  // Already included (Phase 2.1)
        strings.Join(r.Principal.Roles, ","), // NEW: Roles affect role-based principal policies
        r.Resource.Kind,
        r.Resource.ID,
        r.Resource.Scope,   // Already included (Phase 2.1)
        strings.Join(r.Actions, ","),
    )
    hash := sha256.Sum256([]byte(key))
    return hex.EncodeToString(hash[:16])
}
```

## Protobuf Schema Extensions

### `authz.proto` Changes

```protobuf
// Policy represents an authorization policy
message Policy {
  string api_version = 1;
  string name = 2;
  string resource_kind = 3;
  repeated Rule rules = 4;
  string scope = 5;

  // NEW Phase 3 fields
  bool principal_policy = 6;
  PrincipalSelector principal = 7;
  repeated ResourceSelector resources = 8;
}

// PrincipalSelector defines which principals this policy applies to (NEW)
message PrincipalSelector {
  string id = 1;              // Specific principal ID
  repeated string roles = 2;  // Match ANY of these roles
  string scope = 3;           // Principal's scope context
}

// ResourceSelector defines resource matching (NEW)
message ResourceSelector {
  string kind = 1;   // Resource kind (supports *)
  string scope = 2;  // Scope pattern (supports **)
}

// ResponseMetadata (Extended)
message ResponseMetadata {
  double evaluation_duration_us = 1;
  int32 policies_evaluated = 2;
  repeated string matched_policies = 3;
  bool cache_hit = 4;
  ScopeResolution scope_resolution = 5;

  // NEW Phase 3 field
  PolicyResolution policy_resolution = 6;
}

// PolicyResolution contains policy resolution details (NEW)
message PolicyResolution {
  bool principal_policies_matched = 1;
  bool resource_policies_matched = 2;
  repeated string evaluation_order = 3;     // e.g., ["principal-specific", "resource-scoped"]
  ScopeResolution scope_resolution = 4;     // Nested scope info
}
```

## Use Cases

### Use Case 1: VIP User Override

**Scenario**: Alice (CEO) needs full access to all documents in `acme.corp`, overriding normal resource policies.

**Principal Policy**:
```yaml
name: alice-ceo-override
principalPolicy: true
principal:
  id: user:alice
  scope: acme.corp
resources:
  - kind: document
    scope: acme.corp.**
rules:
  - name: alice-full-access
    actions: [*]
    effect: allow
```

**Result**: Alice can read/write/delete ALL documents in `acme.corp` and child scopes, even if resource policies deny.

### Use Case 2: Global Admin Role

**Scenario**: All users with `global-admin` role should have full access to everything.

**Role-Based Principal Policy**:
```yaml
name: global-admin-policy
principalPolicy: true
principal:
  roles: [global-admin]
resources:
  - kind: *
    scope: **
rules:
  - name: admin-full-access
    actions: [*]
    effect: allow
```

**Result**: Any principal with `global-admin` role gets full access to all resources.

### Use Case 3: Temporary Elevated Access

**Scenario**: Bob needs temporary delete access to `document` resources during migration.

**Principal Policy**:
```yaml
name: bob-migration-access
principalPolicy: true
principal:
  id: user:bob
  scope: acme.corp.migration
resources:
  - kind: document
    scope: acme.corp
rules:
  - name: bob-delete-access
    actions: [delete]
    effect: allow
    condition: 'timestamp(request.migration_window_start) <= now() && now() <= timestamp(request.migration_window_end)'
```

**Result**: Bob can delete documents only during migration window, with CEL time validation.

### Use Case 4: Department-Specific Overrides

**Scenario**: All `engineering-lead` role members can approve PRs in their department scope.

**Role-Based Principal Policy**:
```yaml
name: eng-lead-approve
principalPolicy: true
principal:
  roles: [engineering-lead]
  scope: acme.corp.engineering.**
resources:
  - kind: pull-request
    scope: acme.corp.engineering.**
rules:
  - name: lead-approve
    actions: [approve]
    effect: allow
```

**Result**: Engineering leads can approve PRs in their department and sub-departments.

## Implementation Plan

### Phase 3.1: Core Data Structures (4-6 hours)

**Files to Create**:
- `go-core/pkg/types/principal_policy.go` (PrincipalSelector, ResourceSelector)
- `go-core/internal/policy/principal_index.go` (PrincipalIndex implementation)

**Files to Modify**:
- `go-core/pkg/types/types.go` (extend Policy struct)
- `go-core/internal/policy/memory.go` (add principalIndex field)

**Tests**:
- `go-core/tests/policy/principal_index_test.go` (25 tests)

### Phase 3.2: Engine Integration (6-8 hours)

**Files to Modify**:
- `go-core/internal/engine/engine.go` (add findPoliciesWithPrincipal)
- `go-core/pkg/types/types.go` (extend CacheKey with roles)

**Tests**:
- `go-core/tests/engine/principal_eval_test.go` (30 tests)

### Phase 3.3: Protobuf Extensions (2-3 hours)

**Files to Modify**:
- `go-core/api/proto/authz/v1/authz.proto` (add PrincipalSelector, ResourceSelector, PolicyResolution)

**Commands**:
```bash
protoc --go_out=. --go-grpc_out=. api/proto/authz/v1/authz.proto
go mod tidy
```

**Tests**:
- `go-core/tests/proto/marshal_test.go` (10 tests)

### Phase 3.4: Integration Testing (4-5 hours)

**Files to Create**:
- `go-core/tests/integration/principal_integration_test.go` (30 tests)

**Test Categories**:
- Principal-specific policies
- Role-based principal policies
- Principal + resource policy interaction
- Deny overrides
- Cache correctness with roles
- Concurrent access

### Phase 3.5: Performance Benchmarks (2-3 hours)

**Files to Create**:
- `go-core/tests/benchmark/principal_benchmark_test.go`

**Benchmarks**:
- `BenchmarkPrincipalIndexLookup`
- `BenchmarkPrincipalPolicyEvaluation`
- `BenchmarkMixedPolicyEvaluation`
- `BenchmarkCacheWithRoles`

**Target Performance**:
- Principal index lookup: < 50 ns/op
- Principal policy evaluation: < 100 ns/op
- Overall throughput: > 80K checks/sec (80% of Phase 2)

### Phase 3.6: Documentation (2-3 hours)

**Files to Create**:
- `go-core/docs/PHASE3_PRINCIPAL_POLICIES_GUIDE.md` (user guide)
- `go-core/docs/PHASE3_COMPLETE_VALIDATION.md` (validation report)

**Files to Update**:
- `go-core/docs/PHASE2_COMPLETE_VALIDATION.md` (add Phase 3 link)

## Validation Criteria

### Functional Requirements

- ✅ Principal-specific policies evaluated first
- ✅ Role-based principal policies work
- ✅ Resource policies evaluated after principal policies
- ✅ Deny overrides (principal or resource)
- ✅ Wildcard resource selectors (`*`, `**`)
- ✅ Cache includes roles in key
- ✅ Backward compatible with Phase 2

### Performance Requirements

- ✅ Principal index O(1) lookups
- ✅ < 50 ns/op principal lookup
- ✅ < 100 ns/op principal evaluation
- ✅ > 80K checks/sec throughput
- ✅ Zero-allocation caching
- ✅ Thread-safe concurrent access

### Test Coverage Requirements

- ✅ 80+ tests total
- ✅ 100% pass rate
- ✅ 25 tests: principal_index_test.go
- ✅ 30 tests: principal_eval_test.go
- ✅ 30 tests: principal_integration_test.go
- ✅ 10 tests: proto marshal_test.go
- ✅ 5 benchmarks

## Security Considerations

### Deny Overrides Enforcement

**CRITICAL**: Deny rules ALWAYS take precedence, preventing privilege escalation:

```go
// evaluateParallel must enforce deny-overrides
for _, result := range allResults {
    if result.Effect == types.EffectDeny {
        return types.EffectDeny  // Short-circuit on ANY deny
    }
}
```

### Principal Policy Validation

Principal policies MUST be validated at load time:

```go
func ValidatePrincipalPolicy(policy *types.Policy) error {
    if policy.Principal == nil {
        return fmt.Errorf("principal selector required for principal policy")
    }
    if policy.Principal.ID == "" && len(policy.Principal.Roles) == 0 {
        return fmt.Errorf("either principal.id or principal.roles required")
    }
    if len(policy.Resources) == 0 {
        return fmt.Errorf("at least one resource selector required")
    }
    return nil
}
```

### Cache Poisoning Prevention

Cache key MUST include roles to prevent:
1. User with role A getting cached result for user with role B
2. User changing roles getting stale cached decisions

## Migration Path

### Backward Compatibility

**Phase 2 policies work unchanged**:
```yaml
# This Phase 2 policy continues to work exactly as before
apiVersion: authz/v1
name: document-policy
resourceKind: document
scope: acme.corp
rules:
  - name: allow-read
    actions: [read]
    effect: allow
```

### Gradual Adoption

1. **Deploy Phase 3**: No breaking changes, existing policies work
2. **Add principal policies**: Gradually add principal overrides
3. **Monitor**: Track principal policy usage in metrics
4. **Optimize**: Tune cache and index sizes based on usage

## Risks and Mitigations

### Risk 1: Performance Degradation

**Concern**: Evaluating more policies per request slows down engine.

**Mitigation**:
- Short-circuit on first matching principal policy
- Principal index O(1) lookups
- Cache includes roles to avoid re-evaluation
- Benchmark requirement: > 80K checks/sec

### Risk 2: Policy Conflict Complexity

**Concern**: Principal + resource policies create confusing outcomes.

**Mitigation**:
- Clear evaluation order documented
- PolicyResolution metadata shows which policies evaluated
- Deny-overrides simplifies conflict resolution
- Comprehensive test cases for all scenarios

### Risk 3: Cache Key Size Growth

**Concern**: Adding roles to cache key increases memory usage.

**Mitigation**:
- Roles joined as single string (not array)
- Hash to 16-byte key (unchanged size)
- LRU eviction handles memory limits
- Monitor cache hit rate in production

## Success Metrics

### Technical Metrics

- **Test Coverage**: 80+ tests, 100% pass rate
- **Performance**: > 80K checks/sec, < 100 ns/op principal eval
- **Memory**: < 10% increase over Phase 2 baseline
- **Cache Hit Rate**: > 90% with role-based caching

### Adoption Metrics

- **Backward Compatibility**: 0 breaking changes to Phase 2 APIs
- **Documentation**: Complete user guide with 10+ examples
- **Validation**: Comprehensive validation report with benchmarks

## Timeline

**Total Estimated Time**: 20-28 hours (2.5-3.5 days)

| Phase | Task | Time | Status |
|-------|------|------|--------|
| 3.1 | Core Data Structures | 4-6h | 🚧 Next |
| 3.2 | Engine Integration | 6-8h | ⏳ Pending |
| 3.3 | Protobuf Extensions | 2-3h | ⏳ Pending |
| 3.4 | Integration Testing | 4-5h | ⏳ Pending |
| 3.5 | Performance Benchmarks | 2-3h | ⏳ Pending |
| 3.6 | Documentation | 2-3h | ⏳ Pending |

## Next Steps

1. **Review and Approve Design** (you are here 📍)
2. **Begin Phase 3.1**: Implement PrincipalSelector, ResourceSelector, PrincipalIndex
3. **Test Phase 3.1**: 25 tests for principal_index_test.go
4. **Proceed to Phase 3.2**: Engine integration

---

**Design Completed**: 2025-11-24
**Ready for Implementation**: ✅ YES
**Breaking Changes**: ❌ NONE
**Backward Compatible**: ✅ 100%
