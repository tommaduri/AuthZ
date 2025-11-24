# SDK API Reference

Complete reference documentation for the AuthZ Engine TypeScript SDK.

## Table of Contents

1. [Client Creation](#client-creation)
2. [AuthzClient Class](#authzclient-class)
3. [Types and Interfaces](#types-and-interfaces)
4. [Error Handling](#error-handling)

## Client Creation

### createClient()

Factory function to create a new AuthzClient instance.

```typescript
function createClient(config: AuthzClientConfig): AuthzClient
```

#### Parameters

- `config` (`AuthzClientConfig`): Configuration object for the client

#### Returns

- `AuthzClient`: Configured client instance

#### Example

```typescript
import { createClient } from '@authz-engine/sdk';

const client = createClient({
  serverUrl: 'http://localhost:3000',
  timeout: 5000,
});
```

---

## AuthzClient Class

### Constructor

```typescript
new AuthzClient(config: AuthzClientConfig)
```

Creates a new AuthzClient instance. Usually you'll use `createClient()` instead.

---

### check()

Check if a principal is allowed to perform multiple actions on a resource.

```typescript
async check(
  principal: Principal,
  resource: Resource,
  actions: string[],
  options?: CheckOptions
): Promise<CheckResult>
```

#### Parameters

- `principal` (`Principal`): The entity requesting access
- `resource` (`Resource`): The resource being accessed
- `actions` (`string[]`): Array of actions to check (e.g., `['read', 'write']`)
- `options` (`CheckOptions`, optional): Additional options for this request

#### Returns

- `CheckResult`: Authorization decision and detailed results

#### Throws

- `AuthzError`: If the request fails

#### Example

```typescript
const result = await client.check(
  {
    id: 'user123',
    roles: ['admin'],
    attributes: { department: 'engineering' },
  },
  {
    kind: 'document',
    id: 'doc456',
    attributes: { owner: 'user123' },
  },
  ['read', 'write']
);

if (result.allowed) {
  console.log('All actions are allowed');
}

// Check individual action results
if (result.results['write'].effect === 'allow') {
  console.log('Can write');
}
```

---

### isAllowed()

Convenience method to check a single action.

```typescript
async isAllowed(
  principal: Principal,
  resource: Resource,
  action: string,
  options?: CheckOptions
): Promise<boolean>
```

#### Parameters

- `principal` (`Principal`): The entity requesting access
- `resource` (`Resource`): The resource being accessed
- `action` (`string`): Single action to check
- `options` (`CheckOptions`, optional): Additional options

#### Returns

- `boolean`: `true` if action is allowed, `false` otherwise

#### Example

```typescript
const canDelete = await client.isAllowed(
  principal,
  resource,
  'delete'
);

if (canDelete) {
  // Proceed with deletion
}
```

---

### batchCheck()

Check multiple resources and actions in a single request.

```typescript
async batchCheck(
  principal: Principal,
  checks: Array<{ resource: Resource; actions: string[] }>
): Promise<Record<string, CheckResult>>
```

#### Parameters

- `principal` (`Principal`): The entity making all requests
- `checks` (`Array<{ resource: Resource; actions: string[] }>`): Array of checks to perform

#### Returns

- `Record<string, CheckResult>`: Results keyed by resource identifier (format: `kind:id`)

#### Throws

- `AuthzError`: If the request fails

#### Example

```typescript
const results = await client.batchCheck(
  {
    id: 'user123',
    roles: ['member'],
    attributes: {},
  },
  [
    {
      resource: { kind: 'document', id: 'doc1', attributes: {} },
      actions: ['read', 'write'],
    },
    {
      resource: { kind: 'document', id: 'doc2', attributes: {} },
      actions: ['read'],
    },
  ]
);

const doc1Result = results['document:doc1'];
if (doc1Result.allowed) {
  console.log('Can perform all actions on doc1');
}
```

---

### healthCheck()

Check the health status of the AuthZ Engine server.

```typescript
async healthCheck(): Promise<{
  healthy: boolean;
  policiesLoaded: number;
  version: string;
}>
```

#### Returns

- `healthy` (`boolean`): Server is operational
- `policiesLoaded` (`number`): Number of policies loaded
- `version` (`string`): Server version

#### Example

```typescript
const health = await client.healthCheck();

if (health.healthy) {
  console.log(`Server is healthy with ${health.policiesLoaded} policies loaded`);
  console.log(`Version: ${health.version}`);
}
```

---

### getPolicies()

Retrieve information about loaded policies.

```typescript
async getPolicies(): Promise<{
  resourcePolicies: number;
  derivedRolesPolicies: number;
  resources: string[];
}>
```

#### Returns

- `resourcePolicies` (`number`): Count of resource policies
- `derivedRolesPolicies` (`number`): Count of derived roles policies
- `resources` (`string[]`): List of resource types

#### Example

```typescript
const policies = await client.getPolicies();

console.log(`Resource policies: ${policies.resourcePolicies}`);
console.log(`Derived roles: ${policies.derivedRolesPolicies}`);
console.log(`Available resources: ${policies.resources.join(', ')}`);
```

---

## Types and Interfaces

### AuthzClientConfig

Configuration object for creating a client.

```typescript
interface AuthzClientConfig {
  serverUrl: string;
  grpcUrl?: string;
  timeout?: number;
  headers?: Record<string, string>;
  retry?: {
    maxRetries: number;
    backoffMs: number;
  };
}
```

#### Properties

- `serverUrl` (`string`, required): Base URL of the AuthZ Engine REST endpoint
- `grpcUrl` (`string`, optional): URL of gRPC endpoint for high-performance mode
- `timeout` (`number`, optional): Request timeout in milliseconds (default: 5000)
- `headers` (`Record<string, string>`, optional): Custom headers for all requests
- `retry.maxRetries` (`number`, optional): Maximum retry attempts (default: 3)
- `retry.backoffMs` (`number`, optional): Base backoff time in ms (default: 100)

---

### CheckOptions

Options for individual authorization checks.

```typescript
interface CheckOptions {
  auxData?: Record<string, unknown>;
  timeout?: number;
}
```

#### Properties

- `auxData` (`Record<string, unknown>`, optional): Auxiliary data for policy evaluation
- `timeout` (`number`, optional): Override default timeout for this request

#### Example

```typescript
await client.check(principal, resource, ['read'], {
  auxData: {
    ipAddress: request.ip,
    timestamp: new Date().toISOString(),
  },
  timeout: 3000,
});
```

---

### CheckResult

Result of an authorization check.

```typescript
interface CheckResult {
  allowed: boolean;
  results: Record<string, {
    effect: Effect;
    policy: string;
  }>;
  requestId: string;
}
```

#### Properties

- `allowed` (`boolean`): `true` if all actions are allowed
- `results` (`Record<string, {effect, policy}>`): Detailed results for each action
  - `effect` (`'allow' | 'deny'`): Whether the action is allowed
  - `policy` (`string`): Name of the matching policy
- `requestId` (`string`): Unique request ID for tracing

#### Example

```typescript
const result = await client.check(principal, resource, ['read', 'write']);

console.log(`Overall allowed: ${result.allowed}`);
console.log(`Request ID: ${result.requestId}`);

for (const [action, decision] of Object.entries(result.results)) {
  console.log(`Action '${action}': ${decision.effect} (${decision.policy})`);
}
```

---

### Principal

Entity requesting access (user, service, etc.).

```typescript
interface Principal {
  id: string;
  roles: string[];
  attributes: Record<string, unknown>;
}
```

#### Properties

- `id` (`string`): Unique identifier for the principal
- `roles` (`string[]`): Roles assigned to this principal
- `attributes` (`Record<string, unknown>`): Additional attributes for evaluation

#### Example

```typescript
const principal: Principal = {
  id: 'user123',
  roles: ['admin', 'manager'],
  attributes: {
    department: 'engineering',
    location: 'us-west',
    isManager: true,
  },
};
```

---

### Resource

Resource being accessed.

```typescript
interface Resource {
  kind: string;
  id: string;
  attributes: Record<string, unknown>;
}
```

#### Properties

- `kind` (`string`): Type of resource (e.g., 'document', 'folder', 'report')
- `id` (`string`): Unique identifier for this resource instance
- `attributes` (`Record<string, unknown>`): Additional attributes for evaluation

#### Example

```typescript
const resource: Resource = {
  kind: 'document',
  id: 'doc456',
  attributes: {
    owner: 'user123',
    sensitivity: 'confidential',
    department: 'engineering',
  },
};
```

---

### Effect

Authorization decision type.

```typescript
type Effect = 'allow' | 'deny'
```

---

### CheckRequest (Core Type)

Request sent to the server.

```typescript
interface CheckRequest {
  requestId?: string;
  principal: Principal;
  resource: Resource;
  actions: string[];
  auxData?: Record<string, unknown>;
}
```

---

### CheckResponse (Core Type)

Response from the server.

```typescript
interface CheckResponse {
  requestId: string;
  results: Record<string, ActionResult>;
  meta?: {
    evaluationDurationMs: number;
    policiesEvaluated: string[];
  };
}
```

---

## Error Handling

### AuthzError

Custom error class for AuthZ Engine errors.

```typescript
class AuthzError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body?: string
  )
}
```

#### Properties

- `message` (`string`): Error message
- `statusCode` (`number`): HTTP status code
- `body` (`string`, optional): Response body from server

#### Example

```typescript
import { AuthzError } from '@authz-engine/sdk';

try {
  await client.check(principal, resource, ['read']);
} catch (error) {
  if (error instanceof AuthzError) {
    if (error.statusCode === 401) {
      console.error('Authentication failed');
    } else if (error.statusCode === 403) {
      console.error('Authorization failed');
    } else if (error.statusCode >= 500) {
      console.error('Server error:', error.message);
    }
  } else {
    console.error('Network or unexpected error:', error);
  }
}
```

---

## Common Status Codes

When catching `AuthzError`:

- `400`: Bad request (invalid parameters)
- `401`: Unauthorized (authentication required)
- `403`: Forbidden (authorization denied)
- `404`: Not found (resource not found)
- `408`: Request timeout
- `429`: Too many requests (rate limited)
- `500`: Internal server error
- `503`: Service unavailable

---

## Exported Types Summary

The SDK exports the following types for convenience:

```typescript
// From SDK
export {
  AuthzClient,
  AuthzError,
  createClient,
}

export type {
  AuthzClientConfig,
  CheckOptions,
  CheckResult,
}

// Re-exported from core
export type {
  Principal,
  Resource,
  Effect,
  CheckRequest,
  CheckResponse,
}
```

---

## Usage Examples

### TypeScript Type Safety

```typescript
import {
  AuthzClient,
  AuthzClientConfig,
  CheckResult,
  Principal,
  Resource,
} from '@authz-engine/sdk';

const config: AuthzClientConfig = {
  serverUrl: 'http://localhost:3000',
};

const client: AuthzClient = new AuthzClient(config);

const principal: Principal = {
  id: 'user123',
  roles: ['user'],
  attributes: {},
};

const resource: Resource = {
  kind: 'post',
  id: 'post456',
  attributes: {},
};

const result: CheckResult = await client.check(
  principal,
  resource,
  ['read']
);
```

### Destructuring Results

```typescript
const { allowed, results, requestId } = await client.check(
  principal,
  resource,
  ['read', 'write']
);

const { effect, policy } = results['write'];
```
