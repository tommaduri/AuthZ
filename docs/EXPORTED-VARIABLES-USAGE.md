# Exported Variables Usage Guide

## Overview

The Exported Variables feature allows you to define reusable variables and constants that can be imported across multiple policies, reducing duplication and improving maintainability.

## Quick Start

### 1. Define ExportVariables

```typescript
import { ExportVariables } from '@authz-engine/core';

const roleChecks: ExportVariables = {
  apiVersion: 'authz.engine/v1',
  kind: 'ExportVariables',
  metadata: { name: 'role-checks' },
  spec: {
    name: 'role-checks',
    definitions: {
      isAdmin: 'principal.role === "admin"',
      isManager: 'principal.role === "manager"',
      isOwner: 'resource.ownerId === principal.id',
    },
  },
};
```

### 2. Define ExportConstants

```typescript
import { ExportConstants } from '@authz-engine/core';

const limits: ExportConstants = {
  apiVersion: 'authz.engine/v1',
  kind: 'ExportConstants',
  metadata: { name: 'limits' },
  spec: {
    name: 'limits',
    definitions: {
      maxFileSize: 10485760, // 10MB
      maxAttempts: 3,
      allowedRoles: ['admin', 'manager', 'user'],
    },
  },
};
```

### 3. Register Exports

```typescript
import { ExportRegistry } from '@authz-engine/core';

const registry = new ExportRegistry();
registry.registerVariables(roleChecks);
registry.registerConstants(limits);
```

### 4. Use in Policies

```typescript
import { PolicyVariables, VariableResolver } from '@authz-engine/core';

const policyVars: PolicyVariables = {
  import: ['role-checks', 'limits'],
  local: {
    canEdit: 'isAdmin || (isManager && isOwner)',
    withinLimit: 'resource.size < maxFileSize',
  },
};

const resolver = new VariableResolver(registry, cache);
const context = resolver.resolve(policyVars);

// Use context.variables and context.constants in policy evaluation
```

## Advanced Features

### Local Variable Overrides

Local variables always override imported ones:

```typescript
const policyVars: PolicyVariables = {
  import: ['role-checks'],
  local: {
    // Override imported isAdmin check for this policy
    isAdmin: 'principal.role === "super-admin"',
  },
};
```

### Multiple Imports

Import from multiple exports:

```typescript
const policyVars: PolicyVariables = {
  import: ['role-checks', 'ownership-checks', 'limits'],
  local: {
    customCheck: 'isAdmin && isOwner && withinLimit',
  },
};
```

### Import Validation

Validate imports before resolution:

```typescript
const validation = resolver.validateImports(['role-checks', 'limits']);
if (!validation.valid) {
  console.error('Invalid imports:', validation.errors);
}
```

## Complete Example

```typescript
import {
  ExportRegistry,
  ExportVariables,
  ExportConstants,
  VariableResolver,
  ExpressionCache,
  PolicyVariables,
} from '@authz-engine/core';

// Step 1: Create exports
const authVars: ExportVariables = {
  apiVersion: 'authz.engine/v1',
  kind: 'ExportVariables',
  metadata: { name: 'auth-checks' },
  spec: {
    name: 'auth-checks',
    definitions: {
      isAuthenticated: 'principal.id !== null',
      isAdmin: 'principal.role === "admin"',
      isOwner: 'resource.ownerId === principal.id',
    },
  },
};

const securityConsts: ExportConstants = {
  apiVersion: 'authz.engine/v1',
  kind: 'ExportConstants',
  metadata: { name: 'security' },
  spec: {
    name: 'security',
    definitions: {
      maxLoginAttempts: 3,
      sessionTimeout: 3600,
      requireMFA: true,
    },
  },
};

// Step 2: Setup infrastructure
const registry = new ExportRegistry();
const cache = new ExpressionCache();
const resolver = new VariableResolver(registry, cache);

// Step 3: Register exports
registry.registerVariables(authVars);
registry.registerConstants(securityConsts);

// Step 4: Use in policy
const resourcePolicyVars: PolicyVariables = {
  import: ['auth-checks', 'security'],
  local: {
    canRead: 'isAuthenticated',
    canWrite: 'isAdmin || isOwner',
    canDelete: 'isAdmin',
    loginAllowed: 'context.attempts < maxLoginAttempts',
  },
};

// Step 5: Resolve variables
const context = resolver.resolve(resourcePolicyVars);

console.log('Variables:', Array.from(context.variables.keys()));
console.log('Constants:', Array.from(context.constants.entries()));
console.log('Resolution info:', context.resolutionInfo);

// Output:
// Variables: ['isAuthenticated', 'isAdmin', 'isOwner', 'canRead', 'canWrite', 'canDelete', 'loginAllowed']
// Constants: [['maxLoginAttempts', 3], ['sessionTimeout', 3600], ['requireMFA', true]]
// Resolution info: {
//   imports: ['auth-checks', 'security'],
//   localVariables: ['canRead', 'canWrite', 'canDelete', 'loginAllowed'],
//   overrides: [],
//   totalCount: 10
// }
```

## Validation

### Export Name Rules

Export names must:
- Start with lowercase letter
- Contain only lowercase letters, numbers, hyphens, underscores
- Example: `role-checks`, `auth_v1`, `common-vars`

### Variable Name Rules

Variable names must:
- Start with letter (uppercase or lowercase)
- Contain only letters, numbers, underscores
- Example: `isAdmin`, `checkOwner`, `user_id`

### Validation Example

```typescript
import { validateExportVariables } from '@authz-engine/core';

try {
  validateExportVariables(roleChecks);
  console.log('Validation passed');
} catch (error) {
  console.error('Validation failed:', error.message);
}
```

## Performance Considerations

### Caching

The module automatically caches compiled expressions:

```typescript
const cache = new ExpressionCache();

// First resolution: compiles and caches
resolver.resolve(policyVars); // ~0.082ms

// Subsequent resolutions: uses cache
resolver.resolve(policyVars); // ~0.003ms (27x faster)

// Check cache performance
const stats = cache.getCacheStats();
console.log('Cache hit rate:', stats.hitRate); // > 99%
```

### Best Practices

1. **Register exports once at startup**
   ```typescript
   // At application start
   registry.registerVariables(commonVars);
   registry.registerConstants(limits);
   ```

2. **Reuse resolver instances**
   ```typescript
   // Create once, use many times
   const resolver = new VariableResolver(registry, cache);
   ```

3. **Group related variables**
   ```typescript
   // Good: Grouped by domain
   const authVars = { /* auth-related */ };
   const ownershipVars = { /* ownership-related */ };

   // Avoid: Everything in one export
   ```

4. **Limit definitions per export**
   ```typescript
   // Each export should have < 100 definitions
   // Split large exports into logical groups
   ```

## Error Handling

### Unknown Import

```typescript
try {
  const context = resolver.resolve({
    import: ['unknown-export'],
  });
} catch (error) {
  // UnknownExportError: Unknown export: unknown-export
}
```

### Duplicate Registration

```typescript
try {
  registry.registerVariables(roleChecks);
  registry.registerVariables(roleChecks); // Error!
} catch (error) {
  // DuplicateExportError: Export already registered: role-checks
}
```

### Invalid Names

```typescript
try {
  validateExportName('InvalidName'); // Uppercase not allowed
} catch (error) {
  // ValidationError: Invalid export name
}
```

## Integration with Policies

### Resource Policy Example

```yaml
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
spec:
  resource: document
  version: "1.0"

  variables:
    import:
      - role-checks
      - ownership-checks
    local:
      canEdit: isAdmin || (isManager && isOwner)
      canDelete: isAdmin || isOwner

  rules:
    - actions: ['read']
      effect: EFFECT_ALLOW
      condition: isAuthenticated

    - actions: ['update']
      effect: EFFECT_ALLOW
      condition: canEdit

    - actions: ['delete']
      effect: EFFECT_ALLOW
      condition: canDelete
```

## Performance Benchmarks

Based on test results:

| Metric | Target | Achieved |
|--------|--------|----------|
| Resolution time | < 1ms | 0.082ms (12x faster) |
| Cached resolution | - | 0.003ms |
| Cache hit rate | > 99% | 99.90% |
| Throughput | - | 1,648,431/sec |
| Max definitions | 100 | ✅ Supported |

## Migration Guide

### Before (Duplicated Variables)

```typescript
// Policy 1
const policy1 = {
  rules: [
    {
      condition: 'principal.role === "admin"', // Duplicated
    },
  ],
};

// Policy 2
const policy2 = {
  rules: [
    {
      condition: 'principal.role === "admin"', // Duplicated
    },
  ],
};
```

### After (Exported Variables)

```typescript
// Define once
const commonVars: ExportVariables = {
  apiVersion: 'authz.engine/v1',
  kind: 'ExportVariables',
  metadata: { name: 'common' },
  spec: {
    name: 'common',
    definitions: {
      isAdmin: 'principal.role === "admin"',
    },
  },
};

// Use in both policies
const policy1Vars: PolicyVariables = {
  import: ['common'],
};

const policy2Vars: PolicyVariables = {
  import: ['common'],
};
```

## Troubleshooting

### Issue: Cache hit rate too low

**Solution**: Ensure you're reusing the same resolver instance and cache across policy evaluations.

### Issue: Validation errors

**Solution**: Check export and variable names follow the naming conventions (lowercase for exports, alphanumeric+underscore for variables).

### Issue: Unknown export errors

**Solution**: Register all exports before attempting to resolve policy variables.

## API Reference

See the TypeScript interfaces for detailed API documentation:

- `ExportVariables` - Variable definitions with CEL expressions
- `ExportConstants` - Constant definitions with static values
- `PolicyVariables` - Policy variable configuration
- `CompiledVariableContext` - Resolved variable context
- `ExportRegistry` - Export registration and retrieval
- `VariableResolver` - Variable resolution with import/override
- `ExpressionCache` - Expression compilation caching

## Support

For additional examples, see:
- `/tests/unit/variables/integration.test.ts` - End-to-end examples
- `/tests/unit/variables/performance.test.ts` - Performance patterns
- `/docs/PHASE-5-IMPLEMENTATION-SUMMARY.md` - Implementation details
