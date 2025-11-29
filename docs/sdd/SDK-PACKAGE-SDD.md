# Software Design Document: @authz-engine/sdk

**Version**: 1.1.0
**Package**: `packages/sdk-typescript`
**Status**: ✅ Fully Implemented
**Last Updated**: 2025-11-25

---

## 1. Overview

### 1.1 Purpose

The `@authz-engine/sdk` package provides a TypeScript client SDK for interacting with the AuthZ Engine server. It offers a simple, type-safe API for performing authorization checks from any Node.js or browser application.

### 1.2 Scope

This package includes:
- `AuthzClient` class for REST API communication
- Type-safe request/response interfaces
- Retry logic with exponential backoff
- Health check functionality
- Batch authorization support
- Policy information retrieval

### 1.3 Package Structure

```
packages/sdk-typescript/
├── src/
│   ├── index.ts              # Package exports
│   └── client.ts             # AuthzClient implementation (~288 lines)
├── tests/
└── package.json
```

---

## 2. Architecture

### 2.1 Component Diagram

```
┌──────────────────────────────────────────────────────────┐
│                   @authz-engine/sdk                       │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   ┌────────────────────────────────────────────────┐    │
│   │                 AuthzClient                     │    │
│   │                                                 │    │
│   │  ┌────────────┐  ┌────────────┐  ┌──────────┐ │    │
│   │  │   check()  │  │ batchCheck │  │ health   │ │    │
│   │  │ isAllowed()│  │            │  │  Check() │ │    │
│   │  └────────────┘  └────────────┘  └──────────┘ │    │
│   │                                                 │    │
│   │  ┌─────────────────────────────────────────┐  │    │
│   │  │           sendRequest()                  │  │    │
│   │  │  - Retry with exponential backoff       │  │    │
│   │  │  - Timeout handling                     │  │    │
│   │  │  - Error classification                 │  │    │
│   │  └─────────────────────────────────────────┘  │    │
│   └────────────────────────────────────────────────┘    │
│                           │                              │
│                           ▼                              │
│                    ┌────────────┐                        │
│                    │   fetch()  │                        │
│                    └────────────┘                        │
│                                                          │
└──────────────────────────────────────────────────────────┘
                            │
                            ▼
              ┌───────────────────────┐
              │   AuthZ Engine Server │
              │   (REST API)          │
              └───────────────────────┘
```

### 2.2 Request Flow

```
Application
    │
    ▼
┌────────────────┐
│  AuthzClient   │
│   .check()     │
└───────┬────────┘
        │
        ▼
┌────────────────┐
│  sendRequest() │
│  (with retries)│
└───────┬────────┘
        │
        ▼
┌────────────────┐     Retry on 5xx/network error
│    fetch()     │◄────────────────────────────┐
│  POST /api/check                              │
└───────┬────────┘                              │
        │                                       │
        ▼                                       │
    ┌───────────┐                               │
    │ Response  │                               │
    │  ok?      │─────No (5xx)──────────────────┘
    └───────┬───┘
        Yes │
            ▼
┌────────────────┐
│    Response    │
│  parsing &     │
│  simplification│
└───────┬────────┘
        │
        ▼
  CheckResult
```

---

## 3. Component Design

### 3.1 Constants

```typescript
const DEFAULT_TIMEOUT_MS = 5000;           // 5 seconds
const DEFAULT_MAX_RETRIES = 3;             // 3 retry attempts
const DEFAULT_BACKOFF_MS = 100;            // 100ms initial backoff
const EXPONENTIAL_BACKOFF_BASE = 2;        // Backoff multiplier
const CLIENT_ERROR_MIN = 400;              // Don't retry 4xx
const CLIENT_ERROR_MAX = 500;
```

### 3.2 Configuration (`AuthzClientConfig`)

```typescript
interface AuthzClientConfig {
  /** Server URL (REST endpoint) - required */
  serverUrl: string;

  /** Optional gRPC URL for high-performance mode (not yet implemented) */
  grpcUrl?: string;

  /** Request timeout in milliseconds (default: 5000) */
  timeout?: number;

  /** Custom headers to include in requests */
  headers?: Record<string, string>;

  /** Retry configuration */
  retry?: {
    /** Maximum retry attempts (default: 3) */
    maxRetries: number;
    /** Initial backoff delay in ms (default: 100) */
    backoffMs: number;
  };
}
```

### 3.3 AuthzClient Class

#### 3.3.1 Constructor

```typescript
class AuthzClient {
  private config: Required<AuthzClientConfig>;

  constructor(config: AuthzClientConfig) {
    this.config = {
      serverUrl: config.serverUrl.replace(/\/$/, ''), // Remove trailing slash
      grpcUrl: config.grpcUrl || '',
      timeout: config.timeout || DEFAULT_TIMEOUT_MS,
      headers: config.headers || {},
      retry: config.retry || {
        maxRetries: DEFAULT_MAX_RETRIES,
        backoffMs: DEFAULT_BACKOFF_MS
      },
    };
  }
}
```

#### 3.3.2 Public Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `check` | `(principal, resource, actions, options?) => Promise<CheckResult>` | Check multiple actions |
| `isAllowed` | `(principal, resource, action, options?) => Promise<boolean>` | Check single action |
| `batchCheck` | `(principal, checks[]) => Promise<Record<string, CheckResult>>` | Batch resource checks |
| `healthCheck` | `() => Promise<HealthCheckResult>` | Check server health |
| `getPolicies` | `() => Promise<PolicyStats>` | Get loaded policy info |

#### 3.3.3 check() Method

```typescript
async check(
  principal: Principal,
  resource: Resource,
  actions: string[],
  options?: CheckOptions,
): Promise<CheckResult> {
  const request: CheckRequest = {
    principal,
    resource,
    actions,
    auxData: options?.auxData,
  };

  const response = await this.sendRequest<CheckResponse>('/api/check', request);

  // Simplify result for SDK users
  const allowed = Object.values(response.results).every(
    (result) => result.effect === 'allow',
  );

  return {
    allowed,
    results: response.results,
    requestId: response.requestId,
  };
}
```

#### 3.3.4 isAllowed() Method

```typescript
async isAllowed(
  principal: Principal,
  resource: Resource,
  action: string,
  options?: CheckOptions,
): Promise<boolean> {
  const result = await this.check(principal, resource, [action], options);
  return result.results[action]?.effect === 'allow';
}
```

#### 3.3.5 batchCheck() Method

```typescript
async batchCheck(
  principal: Principal,
  checks: Array<{ resource: Resource; actions: string[] }>,
): Promise<Record<string, CheckResult>> {
  const request = {
    principal,
    resources: checks,
  };

  const response = await this.sendRequest<{
    requestId: string;
    results: Record<string, Record<string, { effect: Effect; policy: string }>>;
  }>('/api/check/batch', request);

  const results: Record<string, CheckResult> = {};

  for (const [key, actionResults] of Object.entries(response.results)) {
    const allowed = Object.values(actionResults).every(
      (result) => result.effect === 'allow',
    );
    results[key] = {
      allowed,
      results: actionResults,
      requestId: response.requestId,
    };
  }

  return results;
}
```

#### 3.3.6 healthCheck() Method

```typescript
async healthCheck(): Promise<{
  healthy: boolean;
  policiesLoaded: number;
  version: string;
}> {
  const response = await this.sendRequest<{
    status: string;
    policies_loaded: number;
    version: string;
  }>('/health', null, undefined, 'GET');

  return {
    healthy: response.status === 'healthy',
    policiesLoaded: response.policies_loaded,
    version: response.version,
  };
}
```

#### 3.3.7 getPolicies() Method

```typescript
async getPolicies(): Promise<{
  resourcePolicies: number;
  derivedRolesPolicies: number;
  resources: string[];
}> {
  return this.sendRequest('/api/policies', null, undefined, 'GET');
}
```

### 3.4 Request Options

```typescript
interface CheckOptions {
  /** Additional auxiliary data for CEL conditions */
  auxData?: Record<string, unknown>;
  /** Request timeout override */
  timeout?: number;
}
```

### 3.5 Response Types

```typescript
interface CheckResult {
  /** Whether all requested actions are allowed */
  allowed: boolean;
  /** Detailed results for each action */
  results: Record<string, {
    effect: Effect;
    policy: string;
  }>;
  /** Request ID for tracing */
  requestId: string;
}
```

### 3.6 Error Handling

#### 3.6.1 AuthzError Class

```typescript
class AuthzError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = 'AuthzError';
  }
}
```

#### 3.6.2 Error Categories

| Status Code | Retry? | Description |
|-------------|--------|-------------|
| 4xx | No | Client error, don't retry |
| 5xx | Yes | Server error, retry with backoff |
| Network error | Yes | Retry with backoff |
| Timeout | Yes | Retry with backoff |

### 3.7 Retry Logic

```typescript
private async sendRequest<T>(
  path: string,
  body: unknown,
  timeout?: number,
  method: 'GET' | 'POST' = 'POST',
): Promise<T> {
  const url = `${this.config.serverUrl}${path}`;
  const requestTimeout = timeout || this.config.timeout;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= this.config.retry.maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), requestTimeout);

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...this.config.headers },
        body: method === 'POST' ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new AuthzError(
          `Request failed: ${response.status} ${response.statusText}`,
          response.status,
          errorBody,
        );
      }

      return response.json() as Promise<T>;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry client errors (4xx)
      if (error instanceof AuthzError &&
          error.statusCode >= CLIENT_ERROR_MIN &&
          error.statusCode < CLIENT_ERROR_MAX) {
        throw error;
      }

      // Exponential backoff
      if (attempt < this.config.retry.maxRetries) {
        await this.sleep(
          this.config.retry.backoffMs * Math.pow(EXPONENTIAL_BACKOFF_BASE, attempt)
        );
      }
    }
  }

  throw lastError || new Error('Request failed after retries');
}

private sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

---

## 4. Interfaces

### 4.1 Public API

```typescript
// From index.ts
export {
  // Client
  AuthzClient,
  AuthzClientConfig,
  createClient,

  // Types
  CheckOptions,
  CheckResult,

  // Errors
  AuthzError,

  // Re-exports from @authz-engine/core
  Principal,
  Resource,
  Effect,
  CheckRequest,
  CheckResponse,
};
```

### 4.2 Usage Example

```typescript
import { AuthzClient } from '@authz-engine/sdk';

const client = new AuthzClient({
  serverUrl: 'http://authz-engine:3592',
  timeout: 3000,
  retry: { maxRetries: 2, backoffMs: 50 },
});

// Check authorization
const result = await client.check(
  { id: 'user-123', roles: ['user'], attributes: { department: 'sales' } },
  { kind: 'document', id: 'doc-456', attributes: { owner: 'user-123' } },
  ['read', 'write'],
);

if (result.allowed) {
  // All actions allowed
}

// Or check single action
const canRead = await client.isAllowed(principal, resource, 'read');

// Batch check
const batchResults = await client.batchCheck(
  { id: 'user-123', roles: ['admin'], attributes: {} },
  [
    { resource: { kind: 'doc', id: '1', attributes: {} }, actions: ['read'] },
    { resource: { kind: 'doc', id: '2', attributes: {} }, actions: ['write'] },
  ]
);

// Health check
const health = await client.healthCheck();
console.log(`Server healthy: ${health.healthy}, Policies: ${health.policiesLoaded}`);
```

---

## 5. Error Handling

### 5.1 Error Response Format

```typescript
try {
  await client.check(principal, resource, ['read']);
} catch (error) {
  if (error instanceof AuthzError) {
    console.error(`Authorization error: ${error.statusCode}`);
    console.error(`Message: ${error.message}`);
    console.error(`Body: ${error.body}`);
  }
}
```

### 5.2 Common Error Scenarios

| Scenario | Error Type | Status Code |
|----------|------------|-------------|
| Server unreachable | Network Error | - |
| Timeout | AbortError | - |
| Bad request | AuthzError | 400 |
| Unauthorized | AuthzError | 401 |
| Server error | AuthzError | 500 |

---

## 6. Security Considerations

1. **Credentials**: Custom headers can include auth tokens
2. **HTTPS**: Always use HTTPS in production
3. **Timeout**: Configurable to prevent hanging
4. **No Credential Storage**: SDK doesn't store credentials
5. **Input Validation**: Server validates all inputs

---

## 7. Performance

### 7.1 Targets

| Metric | Target | Notes |
|--------|--------|-------|
| SDK overhead | < 1ms | Serialization/deserialization |
| Retry delay | 100-400ms | Exponential backoff (100, 200, 400) |
| Connection reuse | Yes | Via fetch connection pooling |

### 7.2 Optimization Tips

1. Reuse client instance (connection pooling)
2. Use `batchCheck()` for multiple resources
3. Set appropriate timeouts
4. Adjust retry config for your use case

---

## 8. Testing Strategy

### 8.1 Unit Tests

- Configuration normalization
- Request building
- Response parsing
- Error handling
- Retry logic

### 8.2 Integration Tests

- Real server communication
- Health checks
- Batch requests
- Error scenarios

### 8.3 Test Coverage Target

| Module | Target |
|--------|--------|
| client | 90% |

---

## 9. Dependencies

### 9.1 Runtime Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `@authz-engine/core` | workspace:* | Type definitions |

### 9.2 Browser Compatibility

- Uses native `fetch()` API
- Works in modern browsers (Chrome, Firefox, Safari, Edge)
- Node.js 18+ (native fetch)

---

## 10. Migration from Cerbos SDK

### 10.1 API Comparison

```typescript
// Cerbos SDK
import { GRPC as CerbosClient } from '@cerbos/grpc';
const client = new CerbosClient('cerbos:3593');
const result = await client.checkResource({
  principal: { id: 'user1', roles: ['user'] },
  resource: { kind: 'doc', id: '1' },
  actions: ['read'],
});

// AuthZ Engine SDK
import { AuthzClient } from '@authz-engine/sdk';
const client = new AuthzClient({ serverUrl: 'http://authz:3592' });
const result = await client.check(
  { id: 'user1', roles: ['user'], attributes: {} },
  { kind: 'doc', id: '1', attributes: {} },
  ['read'],
);
```

### 10.2 Key Differences

| Aspect | Cerbos SDK | AuthZ Engine SDK |
|--------|------------|------------------|
| Protocol | gRPC | REST (gRPC planned) |
| Principal | `attr` | `attributes` |
| Resource | `attr` | `attributes` |
| Result | Complex object | Simplified `CheckResult` |

---

## 11. Future Enhancements

The following features are planned for future releases:

1. **gRPC Client**: High-performance gRPC transport (uses `grpcUrl` config)
2. **WebSocket Client**: Real-time streaming support
3. **Caching**: Optional client-side result caching
4. **Middleware**: Request/response interceptors

---

## 12. Related Documents

- [ADR-006: Cerbos API Compatibility](../adr/ADR-006-CERBOS-API-COMPATIBILITY.md)
- [SERVER-PACKAGE-SDD.md](./SERVER-PACKAGE-SDD.md)
- [CORE-PACKAGE-SDD.md](./CORE-PACKAGE-SDD.md)

---

## 13. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.1.0 | 2025-11-25 | Accurate documentation matching implementation |
| 1.0.0 | 2024-11-23 | Initial release with REST client |
