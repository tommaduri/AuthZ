# Getting Started with AuthZ Engine SDK

Welcome to the TypeScript SDK for the AuthZ Engine! This guide will help you get up and running quickly.

## Installation

### Using npm

```bash
npm install @authz-engine/sdk @authz-engine/core
```

### Using yarn

```bash
yarn add @authz-engine/sdk @authz-engine/core
```

### Using pnpm

```bash
pnpm add @authz-engine/sdk @authz-engine/core
```

## Quick Start

### 1. Create a Client

```typescript
import { createClient } from '@authz-engine/sdk';

const client = createClient({
  serverUrl: 'http://localhost:3000',
  timeout: 5000,
});
```

### 2. Make Your First Check

```typescript
import type { Principal, Resource } from '@authz-engine/sdk';

const principal: Principal = {
  id: 'user123',
  roles: ['admin'],
  attributes: { department: 'engineering' },
};

const resource: Resource = {
  kind: 'document',
  id: 'doc456',
  attributes: { owner: 'user123' },
};

const result = await client.check(principal, resource, ['read', 'write']);

if (result.allowed) {
  console.log('Action allowed!');
} else {
  console.log('Action denied');
}
```

### 3. Check Individual Actions

```typescript
const canRead = await client.isAllowed(principal, resource, 'read');

if (canRead) {
  console.log('User can read this document');
}
```

## Configuration

### Client Options

```typescript
interface AuthzClientConfig {
  // Server REST endpoint (required)
  serverUrl: string;

  // Optional gRPC endpoint for high-performance mode
  grpcUrl?: string;

  // Request timeout in milliseconds (default: 5000)
  timeout?: number;

  // Custom headers for all requests
  headers?: Record<string, string>;

  // Retry configuration
  retry?: {
    maxRetries: number;    // default: 3
    backoffMs: number;     // default: 100
  };
}
```

### Example Configuration

```typescript
const client = createClient({
  serverUrl: 'https://api.example.com/authz',
  timeout: 10000,
  headers: {
    'Authorization': 'Bearer token123',
    'X-Custom-Header': 'value',
  },
  retry: {
    maxRetries: 5,
    backoffMs: 200,
  },
});
```

## Basic Patterns

### Pattern 1: Simple Permission Check

```typescript
const canDelete = await client.isAllowed(
  principal,
  resource,
  'delete'
);

if (canDelete) {
  // Perform deletion
  await deleteResource(resource.id);
}
```

### Pattern 2: Multiple Actions Check

```typescript
const result = await client.check(
  principal,
  resource,
  ['create', 'read', 'update', 'delete']
);

if (result.allowed) {
  // All actions are allowed
}

// Check individual action results
const canUpdate = result.results['update']?.effect === 'allow';
const canDelete = result.results['delete']?.effect === 'allow';
```

### Pattern 3: Batch Checks

```typescript
const results = await client.batchCheck(
  principal,
  [
    {
      resource: { kind: 'document', id: 'doc1', attributes: {} },
      actions: ['read', 'write'],
    },
    {
      resource: { kind: 'document', id: 'doc2', attributes: {} },
      actions: ['read'],
    },
    {
      resource: { kind: 'folder', id: 'folder1', attributes: {} },
      actions: ['create'],
    },
  ]
);

// Access results by resource key
const doc1Result = results['document:doc1'];
const folder1Result = results['folder:folder1'];
```

### Pattern 4: Passing Auxiliary Data

```typescript
const result = await client.check(
  principal,
  resource,
  ['read'],
  {
    auxData: {
      ipAddress: '192.168.1.1',
      timestamp: new Date().toISOString(),
      environment: 'production',
    },
  }
);
```

## Error Handling

The SDK provides error handling for common scenarios:

### Catching Errors

```typescript
import { AuthzError } from '@authz-engine/sdk';

try {
  const result = await client.check(principal, resource, ['read']);
} catch (error) {
  if (error instanceof AuthzError) {
    console.error(`AuthZ error (${error.statusCode}):`, error.message);
    console.error('Response body:', error.body);
  } else {
    console.error('Unexpected error:', error);
  }
}
```

### Error Types

- **Network Errors**: Connection failures, timeouts
- **Validation Errors** (400): Invalid request format
- **Unauthorized** (401): Authentication required
- **Server Errors** (500+): Service unavailable

### Retry Behavior

The SDK automatically retries on:
- Network timeouts
- 5xx server errors
- Connection errors

It does NOT retry on:
- 4xx client errors (invalid request)
- 401/403 authentication errors

## Health Checks

```typescript
const health = await client.healthCheck();

console.log(`Server healthy: ${health.healthy}`);
console.log(`Policies loaded: ${health.policiesLoaded}`);
console.log(`Version: ${health.version}`);
```

## Policy Information

```typescript
const policies = await client.getPolicies();

console.log(`Resource policies: ${policies.resourcePolicies}`);
console.log(`Derived roles policies: ${policies.derivedRolesPolicies}`);
console.log(`Available resources: ${policies.resources.join(', ')}`);
```

## Best Practices

### 1. Reuse Client Instances

Create the client once and reuse it:

```typescript
// Good
const client = createClient({ serverUrl: 'http://localhost:3000' });

export async function checkPermission(principal, resource, action) {
  return client.isAllowed(principal, resource, action);
}
```

```typescript
// Avoid
async function checkPermission(principal, resource, action) {
  const client = createClient({ serverUrl: 'http://localhost:3000' }); // Creates new instance each time
  return client.isAllowed(principal, resource, action);
}
```

### 2. Cache Results Appropriately

Authorization decisions can often be cached:

```typescript
const cache = new Map<string, boolean>();

async function canUserRead(userId: string, resourceId: string) {
  const cacheKey = `${userId}:read:${resourceId}`;

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  const principal: Principal = { id: userId, roles: [], attributes: {} };
  const resource: Resource = { kind: 'document', id: resourceId, attributes: {} };

  const allowed = await client.isAllowed(principal, resource, 'read');
  cache.set(cacheKey, allowed);

  return allowed;
}
```

### 3. Include Contextual Attributes

Provide relevant context for better policy evaluation:

```typescript
const result = await client.check(
  {
    id: 'user123',
    roles: ['viewer'],
    attributes: {
      department: 'sales',
      isManager: true,
      location: 'us-west',
    },
  },
  {
    kind: 'report',
    id: 'report456',
    attributes: {
      sensitivity: 'confidential',
      owner: 'manager789',
      department: 'sales',
    },
  },
  ['view', 'export']
);
```

### 4. Handle Timeouts Gracefully

```typescript
const result = await client.check(
  principal,
  resource,
  ['read'],
  { timeout: 3000 } // Override timeout for this request
);
```

### 5. Log Request IDs for Debugging

```typescript
const result = await client.check(principal, resource, ['read']);

console.log(`Authorization check request ID: ${result.requestId}`);
// Use this ID to trace issues in server logs
```

## Examples

For more detailed examples, see:
- Basic usage: `examples/basic-usage.ts`
- Advanced patterns: `examples/advanced-usage.ts`
- NestJS integration: `examples/nestjs-integration.ts`

## Troubleshooting

### Connection Issues

If you get connection errors:

1. Verify the server URL is correct
2. Check that the AuthZ Engine server is running
3. Ensure network connectivity
4. Check firewall rules

### Timeout Errors

If requests are timing out:

1. Increase the `timeout` configuration
2. Check server performance
3. Verify network latency
4. Consider using per-request timeout overrides

### Authorization Denied Unexpectedly

If authorization is being denied unexpectedly:

1. Check the request ID in logs
2. Verify principal roles are correct
3. Review policy definitions
4. Check resource attributes
5. Enable detailed logging on the server

## Next Steps

- Read the [API Reference](API_REFERENCE.md) for detailed method documentation
- Check out examples for common patterns
- Review policy configuration in the AuthZ Engine documentation
- Set up monitoring and logging for production use
