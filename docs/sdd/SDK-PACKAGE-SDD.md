# Software Design Document: @authz-engine/sdk

**Version**: 1.0.0
**Package**: `packages/sdk-typescript`
**Status**: ✅ Fully Implemented
**Last Updated**: 2024-11-24

> **📌 Undocumented Feature**
>
> The implementation includes a **WebSocket client** for real-time streaming that is not documented in this SDD. This feature enables:
> - Real-time decision streaming
> - Live policy update notifications
> - Bidirectional communication with the server
>
> Consider adding a WebSocket client section to this SDD.

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

### 1.3 Package Structure

```
packages/sdk-typescript/
├── src/
│   ├── index.ts              # Package exports
│   └── client.ts             # AuthzClient implementation
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
┌────────────────┐
│    fetch()     │
│  POST /api/check
└───────┬────────┘
        │
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

### 3.1 Configuration (`AuthzClientConfig`)

```typescript
interface AuthzClientConfig {
  /** Server URL (REST endpoint) - required */
  serverUrl: string;

  /** Optional gRPC URL for high-performance mode */
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

### 3.2 AuthzClient Class

#### 3.2.1 Constructor

```typescript
class AuthzClient {
  constructor(config: AuthzClientConfig) {
    this.config = {
      serverUrl: config.serverUrl.replace(/\/$/, ''),
      grpcUrl: config.grpcUrl || '',
      timeout: config.timeout || 5000,
      headers: config.headers || {},
      retry: config.retry || { maxRetries: 3, backoffMs: 100 },
    };
  }
}
```

#### 3.2.2 Public Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `check` | `(principal, resource, actions, options?) => Promise<CheckResult>` | Check multiple actions |
| `isAllowed` | `(principal, resource, action, options?) => Promise<boolean>` | Check single action |
| `batchCheck` | `(principal, checks[]) => Promise<Record<string, CheckResult>>` | Batch resource checks |
| `healthCheck` | `() => Promise<HealthCheckResult>` | Check server health |
| `getPolicies` | `() => Promise<PolicyStats>` | Get loaded policy info |

#### 3.2.3 check() Method

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

#### 3.2.4 isAllowed() Method

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

### 3.3 Request Options

```typescript
interface CheckOptions {
  /** Additional auxiliary data for CEL conditions */
  auxData?: Record<string, unknown>;
  /** Request timeout override */
  timeout?: number;
}
```

### 3.4 Response Types

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

interface HealthCheckResult {
  healthy: boolean;
  policiesLoaded: number;
  version: string;
}
```

### 3.5 Error Handling

#### 3.5.1 AuthzError Class

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

#### 3.5.2 Error Categories

| Status Code | Retry? | Description |
|-------------|--------|-------------|
| 4xx | No | Client error, don't retry |
| 5xx | Yes | Server error, retry with backoff |
| Network error | Yes | Retry with backoff |
| Timeout | Yes | Retry with backoff |

### 3.6 Retry Logic

```typescript
private async sendRequest<T>(
  path: string,
  body: unknown,
  timeout?: number,
  method: 'GET' | 'POST' = 'POST',
): Promise<T> {
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
        throw new AuthzError(...);
      }

      return response.json();
    } catch (error) {
      lastError = error;

      // Don't retry client errors (4xx)
      if (error instanceof AuthzError && error.statusCode < 500) {
        throw error;
      }

      // Exponential backoff
      if (attempt < this.config.retry.maxRetries) {
        await this.sleep(this.config.retry.backoffMs * Math.pow(2, attempt));
      }
    }
  }

  throw lastError;
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
| Retry delay | 100-800ms | Exponential backoff |
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

## 11. Related Documents

- [ADR-006: Cerbos API Compatibility](../adr/ADR-006-CERBOS-API-COMPATIBILITY.md)
- [SERVER-PACKAGE-SDD.md](./SERVER-PACKAGE-SDD.md)
- [CORE-PACKAGE-SDD.md](./CORE-PACKAGE-SDD.md)

---

## 12. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-11-23 | Initial release with REST client |
