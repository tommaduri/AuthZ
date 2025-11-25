# Phase 3 Migration Guide

## Overview

Phase 3 introduces **Principal Policies** - a new way to define authorization rules attached directly to users, groups, or services. This guide helps you migrate from resource-only policies to take advantage of principal policies.

### What's New in Phase 3

- ✨ **Principal Policies**: Attach policies to users/services
- 🎯 **User-level overrides**: Grant special access to specific users
- 🚫 **Security blocks**: Deny all access for compromised accounts
- 👑 **Role-based policies**: Define admin capabilities once
- 🏢 **Multi-tenant isolation**: Enforce boundaries at principal level
- ⚡ **Performance**: Optimized policy evaluation pipeline

### Version Compatibility

| Version | Resource Policies | Principal Policies | Status |
|---------|------------------|-------------------|---------|
| < 3.0   | ✅ Supported      | ❌ Not Available   | Legacy  |
| 3.0+    | ✅ Supported      | ✅ Supported       | Current |

**Key Point**: Phase 3 is **100% backward compatible**. All existing resource policies continue to work without modification.

## Backward Compatibility

### Existing Policies Still Work

All your existing resource policies continue to work exactly as before:

```yaml
# This still works in Phase 3
apiVersion: authz.engine/v1
name: document-read-policy
resources:
  - kind: "document"
    scope: "project/alpha/docs/**"
    principals:
      - id: "user:alice"
      - attributes:
          role: ["viewer"]
rules:
  - name: read-access
    actions: ["read"]
    effect: allow
```

### No Breaking Changes

- ✅ All existing APIs unchanged
- ✅ Policy YAML format backward compatible
- ✅ Policy evaluation behavior unchanged for resource policies
- ✅ No performance regression for existing workloads

### What's Added

Phase 3 adds new capabilities without removing anything:

```go
// Old way (still works)
policy := authz.Policy{
    Name: "doc-policy",
    Resources: []authz.ResourceSelector{...},
    // No principalPolicy field
}

// New way (Phase 3)
policy := authz.Policy{
    Name: "user-policy",
    PrincipalPolicy: true,  // NEW FIELD
    Principal: &authz.PrincipalSelector{...},  // NEW FIELD
    Resources: []authz.ResourceSelector{...},
}
```

## When to Migrate

### Decision Matrix

Use this matrix to decide if you should migrate to principal policies:

| Scenario | Keep Resource Policy | Add Principal Policy | Why |
|----------|---------------------|---------------------|-----|
| Document-level permissions | ✅ | ❌ | Resource policies are ideal |
| Team shared folders | ✅ | ❌ | Group-based resource access |
| VIP user override | ❌ | ✅ | User-specific exception |
| Compromised account | ❌ | ✅ | Immediate global block |
| Admin role definition | ❌ | ✅ | Define capabilities once |
| Service-to-service auth | ❌ | ✅ | Service-level controls |
| Multi-tenant boundaries | ❌ | ✅ | Enforce at principal level |
| Scoped admin (e.g., domain admin) | ❌ | ✅ | Principal + scope combination |

### When NOT to Migrate

**Keep resource policies when**:
- Controlling access to specific resources (documents, files, etc.)
- Defining team or group permissions on resources
- Managing resource inheritance (folder permissions)
- Access is resource-centric (not user-centric)

**Example - Keep as resource policy**:
```yaml
# Good: Resource-centric access control
apiVersion: authz.engine/v1
name: project-alpha-docs
resources:
  - kind: "document"
    scope: "project/alpha/docs/**"
    principals:
      - attributes:
          team: ["alpha-team"]
rules:
  - name: team-access
    actions: ["read", "write"]
    effect: allow
```

### When TO Migrate

**Add principal policies when**:
- Defining user-specific overrides or exceptions
- Blocking access for security reasons
- Defining role capabilities system-wide
- Managing service account permissions
- Enforcing multi-tenant isolation
- Implementing break-glass access

**Example - Migrate to principal policy**:
```yaml
# Good: User-centric access control
apiVersion: authz.engine/v1
name: alice-admin-policy
principalPolicy: true
principal:
  id: "user:alice"
resources:
  - kind: "*"
    scope: "**"
rules:
  - name: admin-access
    actions: ["*"]
    effect: allow
```

## Migration Steps

### Step 1: Audit Current Policies

List all your current policies and categorize them:

```bash
# List all policies
ls -la policies/

# Analyze policy patterns
grep -r "principals:" policies/ | wc -l  # Resource policies
```

**Create a migration inventory**:

| Policy Name | Type | Principals Count | Candidate for Migration? |
|------------|------|------------------|-------------------------|
| admin-access | Resource | 1 (alice) | ✅ Yes - Single user |
| team-alpha-docs | Resource | 5 (team) | ❌ No - Group access |
| vip-override | Resource | 1 (bob) | ✅ Yes - VIP user |

### Step 2: Create Principal Policies

For policies that should be migrated, create corresponding principal policies:

**Before (Resource Policy)**:
```yaml
apiVersion: authz.engine/v1
name: alice-admin-access
resources:
  - kind: "*"
    scope: "**"
    principals:
      - id: "user:alice"
rules:
  - name: admin-access
    actions: ["*"]
    effect: allow
```

**After (Principal Policy)**:
```yaml
apiVersion: authz.engine/v1
name: alice-admin-policy
principalPolicy: true  # NEW
principal:  # NEW
  id: "user:alice"
resources:
  - kind: "*"
    scope: "**"
rules:
  - name: admin-access
    actions: ["*"]
    effect: allow
```

**Key Changes**:
1. Add `principalPolicy: true`
2. Move principal selector from `resources[].principals` to top-level `principal`
3. Remove `principals` from resource selectors

### Step 3: Deploy Side-by-Side

Deploy both policies together (Phase 3 supports both):

```go
// Load existing resource policies
resourcePolicies := loadPolicies("policies/resource/")

// Load new principal policies
principalPolicies := loadPolicies("policies/principal/")

// Add all policies to engine
engine := authz.NewEngine()
for _, p := range resourcePolicies {
    engine.AddPolicy(p)
}
for _, p := range principalPolicies {
    engine.AddPolicy(p)
}
```

**Benefit**: Principal policies take precedence, providing gradual migration path.

### Step 4: Test Both Policies

Verify that principal policies work as expected:

```go
func TestMigration(t *testing.T) {
    engine := authz.NewEngine()

    // Add old resource policy
    engine.AddPolicy(resourcePolicy)

    // Add new principal policy
    engine.AddPolicy(principalPolicy)

    // Test: Principal policy should take precedence
    decision := engine.IsAllowed(authz.Request{
        Principal: authz.Principal{ID: "user:alice"},
        Action: "read",
        Resource: authz.Resource{Kind: "document", Scope: "test/doc.txt"},
    })

    assert.Equal(t, authz.Allow, decision.Decision)
    assert.Contains(t, decision.ReasonTrace, "alice-admin-policy")
}
```

### Step 5: Remove Old Policies

Once verified, remove the old resource policy:

```bash
# Backup old policy
mv policies/resource/alice-admin.yaml policies/archive/

# Keep only principal policy
# policies/principal/alice-admin.yaml
```

### Step 6: Update Documentation

Update your policy documentation to reflect the new structure:

```markdown
# Before
- `alice-admin-access.yaml`: Resource policy granting Alice admin access

# After
- `alice-admin-policy.yaml`: Principal policy granting Alice admin access (Phase 3)
```

## Example Migrations

### Migration 1: Admin User

**Before (Resource Policy)**:
```yaml
apiVersion: authz.engine/v1
name: admin-users-resource
resources:
  - kind: "*"
    scope: "**"
    principals:
      - id: "user:alice"
      - id: "user:bob"
      - attributes:
          role: ["admin"]
rules:
  - name: admin-access
    actions: ["*"]
    effect: allow
```

**After (Principal Policies)**:
```yaml
# Option 1: Role-based principal policy
apiVersion: authz.engine/v1
name: admin-role-policy
principalPolicy: true
principal:
  attributes:
    role: ["admin"]
resources:
  - kind: "*"
    scope: "**"
rules:
  - name: admin-access
    actions: ["*"]
    effect: allow

---
# Option 2: Per-user principal policies (if different rules needed)
apiVersion: authz.engine/v1
name: alice-admin-policy
principalPolicy: true
principal:
  id: "user:alice"
resources:
  - kind: "*"
    scope: "**"
rules:
  - name: admin-access
    actions: ["*"]
    effect: allow
```

**Benefits**:
- ✅ Centralized admin definition
- ✅ Easier to audit who has admin access
- ✅ Faster evaluation (principal-first)

---

### Migration 2: Security Block

**Before (Resource Policy for Each Resource)**:
```yaml
# Had to create deny policy for EVERY resource
apiVersion: authz.engine/v1
name: block-bob-documents
resources:
  - kind: "document"
    scope: "**"
    principals:
      - id: "user:bob"
rules:
  - name: block-access
    actions: ["*"]
    effect: deny
---
apiVersion: authz.engine/v1
name: block-bob-projects
resources:
  - kind: "project"
    scope: "**"
    principals:
      - id: "user:bob"
rules:
  - name: block-access
    actions: ["*"]
    effect: deny
# ... had to repeat for every resource type!
```

**After (Single Principal Policy)**:
```yaml
apiVersion: authz.engine/v1
name: block-bob
principalPolicy: true
principal:
  id: "user:bob"
resources:
  - kind: "*"
    scope: "**"
rules:
  - name: security-block
    actions: ["*"]
    effect: deny
    comment: "Account compromised 2025-11-24"
```

**Benefits**:
- ✅ Single policy blocks everything
- ✅ Immediate effect (highest priority)
- ✅ Easy to audit and remove

---

### Migration 3: Multi-Tenant Isolation

**Before (Resource Policy - Hard to Enforce)**:
```yaml
# Had to add tenant check to every resource policy
apiVersion: authz.engine/v1
name: tenant-a-documents
resources:
  - kind: "document"
    scope: "tenant/a/**"
    attributes:
      tenant: ["a"]
    principals:
      - attributes:
          tenant: ["a"]
rules:
  - name: tenant-access
    actions: ["*"]
    effect: allow
# ... repeat for tenant B, C, D...
```

**After (Principal Policy - Enforced Once)**:
```yaml
apiVersion: authz.engine/v1
name: tenant-isolation
principalPolicy: true
principal:
  attributes:
    tenant: ["${principal.tenant}"]
resources:
  - kind: "*"
    scope: "**"
rules:
  - name: deny-cross-tenant
    actions: ["*"]
    effect: deny
    condition:
      not:
        stringEquals:
          - "${resource.tenant}"
          - "${principal.tenant}"
```

**Benefits**:
- ✅ Enforced at principal level (can't be bypassed)
- ✅ Single policy for all tenants
- ✅ Automatic for new resource types

---

### Migration 4: Service Account

**Before (Resource Policy for Each Service)**:
```yaml
apiVersion: authz.engine/v1
name: billing-service-users
resources:
  - kind: "user"
    scope: "**"
    principals:
      - id: "service:billing"
rules:
  - name: read-users
    actions: ["read"]
    effect: allow
---
apiVersion: authz.engine/v1
name: billing-service-payments
resources:
  - kind: "payment"
    scope: "**"
    principals:
      - id: "service:billing"
rules:
  - name: read-payments
    actions: ["read"]
    effect: allow
```

**After (Single Principal Policy)**:
```yaml
apiVersion: authz.engine/v1
name: billing-service-policy
principalPolicy: true
principal:
  id: "service:billing"
resources:
  - kind: "user"
    scope: "**"
  - kind: "payment"
    scope: "**"
rules:
  - name: billing-read
    actions: ["read"]
    effect: allow
```

**Benefits**:
- ✅ Service capabilities defined once
- ✅ Easier to audit service permissions
- ✅ Centralized service access control

## Testing Strategy

### Unit Tests

Test principal policies in isolation:

```go
func TestPrincipalPolicy(t *testing.T) {
    engine := authz.NewEngine()

    // Add only principal policy
    engine.AddPolicy(authz.Policy{
        Name: "alice-admin",
        PrincipalPolicy: true,
        Principal: &authz.PrincipalSelector{
            ID: "user:alice",
        },
        Resources: []authz.ResourceSelector{
            {Kind: "*", Scope: "**"},
        },
        Rules: []authz.Rule{
            {Name: "admin", Actions: []string{"*"}, Effect: authz.Allow},
        },
    })

    // Test: Alice should have access
    decision := engine.IsAllowed(authz.Request{
        Principal: authz.Principal{ID: "user:alice"},
        Action: "read",
        Resource: authz.Resource{Kind: "document", Scope: "test.txt"},
    })

    assert.Equal(t, authz.Allow, decision.Decision)
}
```

### Integration Tests

Test principal + resource policies together:

```go
func TestPrincipalAndResourcePolicies(t *testing.T) {
    engine := authz.NewEngine()

    // Add resource policy (deny by default)
    engine.AddPolicy(resourcePolicy)

    // Add principal policy (grant access to alice)
    engine.AddPolicy(principalPolicy)

    // Test: Alice should override resource policy
    decision := engine.IsAllowed(authz.Request{
        Principal: authz.Principal{ID: "user:alice"},
        Action: "write",
        Resource: authz.Resource{Kind: "document", Scope: "protected.txt"},
    })

    assert.Equal(t, authz.Allow, decision.Decision)

    // Test: Bob should still be denied
    decision = engine.IsAllowed(authz.Request{
        Principal: authz.Principal{ID: "user:bob"},
        Action: "write",
        Resource: authz.Resource{Kind: "document", Scope: "protected.txt"},
    })

    assert.Equal(t, authz.Deny, decision.Decision)
}
```

### Load Tests

Verify performance with both policy types:

```go
func BenchmarkMixedPolicies(b *testing.B) {
    engine := authz.NewEngine()

    // Add 100 resource policies
    for i := 0; i < 100; i++ {
        engine.AddPolicy(resourcePolicy)
    }

    // Add 10 principal policies
    for i := 0; i < 10; i++ {
        engine.AddPolicy(principalPolicy)
    }

    request := authz.Request{
        Principal: authz.Principal{ID: "user:alice"},
        Action: "read",
        Resource: authz.Resource{Kind: "document", Scope: "test.txt"},
    }

    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        engine.IsAllowed(request)
    }
}
```

### Regression Tests

Ensure existing behavior unchanged:

```go
func TestBackwardCompatibility(t *testing.T) {
    engine := authz.NewEngine()

    // Add old-style resource policy (no principalPolicy field)
    engine.AddPolicy(legacyResourcePolicy)

    // Test: Should work exactly as before
    decision := engine.IsAllowed(legacyRequest)

    assert.Equal(t, expectedDecision, decision.Decision)
}
```

## Rollback Plan

### If Issues Occur

**Step 1: Identify Problem Policy**
```bash
# Check policy evaluation logs
grep "ERROR" authz.log | grep "principal-policy"
```

**Step 2: Disable Principal Policy**
```go
// Remove problematic principal policy
engine.RemovePolicy("alice-admin-policy")

// Or disable principal policy evaluation (emergency)
engine.SetPrincipalPolicyEnabled(false)
```

**Step 3: Restore Resource Policy**
```bash
# Restore from backup
cp policies/archive/alice-admin.yaml policies/resource/
```

**Step 4: Restart Service**
```bash
# Reload policies
systemctl restart authz-service
```

### Rollback Checklist

- [ ] Identify which principal policies are causing issues
- [ ] Backup current state
- [ ] Remove principal policies from engine
- [ ] Restore resource policies from backup
- [ ] Restart service
- [ ] Verify authorization working with resource policies
- [ ] Document issue for later analysis

### Emergency Disable

If you need to completely disable principal policies:

```go
// Add feature flag in your engine initialization
type EngineConfig struct {
    EnablePrincipalPolicies bool  // Set to false to disable
}

func NewEngine(config EngineConfig) *Engine {
    engine := &Engine{
        principalPoliciesEnabled: config.EnablePrincipalPolicies,
    }
    return engine
}

// In your authorization check
func (e *Engine) IsAllowed(req Request) Decision {
    if e.principalPoliciesEnabled {
        // Check principal policies
    }
    // Check resource policies (always enabled)
}
```

## FAQ

### Q: Do I have to migrate all policies at once?

**A**: No! Phase 3 supports both policy types simultaneously. Migrate incrementally as needed.

---

### Q: Will migration affect performance?

**A**: Principal policies are typically **faster** than resource policies because they're evaluated first and can short-circuit. Migrations often improve performance.

---

### Q: Can I have both a principal and resource policy for the same user?

**A**: Yes! They work together:
1. Principal deny policies checked first (highest priority)
2. Resource deny policies
3. Principal allow policies
4. Resource allow policies (lowest priority)

---

### Q: What happens if I forget to set `principalPolicy: true`?

**A**: The policy will be treated as a resource policy. The `principal` field will be ignored and it won't be evaluated at the principal level.

---

### Q: How do I convert a policy that has multiple principals?

**A**: Create separate principal policies for each, or use attribute-based matching:

```yaml
# Before: Resource policy with multiple principals
resources:
  - principals:
      - id: "user:alice"
      - id: "user:bob"

# After: Option 1 - Separate policies
---
principalPolicy: true
principal:
  id: "user:alice"
---
principalPolicy: true
principal:
  id: "user:bob"

# After: Option 2 - Attribute matching
principalPolicy: true
principal:
  attributes:
    specialAccess: ["true"]  # Both Alice and Bob have this attribute
```

---

### Q: Can principal policies have conditions?

**A**: Yes! Principal policies support all the same conditions as resource policies.

---

### Q: How do I test that migration didn't break anything?

**A**:
1. Run existing authorization tests (they should still pass)
2. Add new tests for principal policies
3. Test both policies together
4. Run load tests to verify performance

---

### Q: What if my principal policy conflicts with a resource policy?

**A**:
- Deny always wins
- Principal policies evaluated first
- If principal policy denies, resource policy can't override
- If principal policy allows, resource policy can still deny

---

### Q: Can I use principal policies for conditional access (time, IP, etc.)?

**A**: Yes! Principal policies support all condition types:

```yaml
principalPolicy: true
principal:
  id: "user:alice"
rules:
  - name: business-hours-only
    actions: ["*"]
    effect: deny
    condition:
      not:
        timeBetween:
          - "${time.hour}"
          - [9, 17]
```

## Next Steps

1. ✅ Review your current policies
2. ✅ Identify migration candidates
3. ✅ Create principal policies for user-centric controls
4. ✅ Test in staging environment
5. ✅ Deploy incrementally
6. ✅ Monitor and adjust

## Additional Resources

- [Phase 3 README](./PHASE3_README.md) - Complete feature guide
- [Policy Examples](../examples/principal_policies.yaml) - Sample policies
- [API Reference](./API.md) - Full API documentation
- [Performance Guide](./PERFORMANCE.md) - Optimization tips

---

**Need Help?**

- 📧 Email: support@yourproject.io
- 💬 Slack: #authz-engine
- 🐛 Issues: [GitHub Issues](https://github.com/yourusername/authz-engine/issues)

**Happy Migrating! 🚀**
