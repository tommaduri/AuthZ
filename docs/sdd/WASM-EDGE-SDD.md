# Software Design Document: WASM and Edge Deployment

**Module**: `@authz-engine/wasm`
**Version**: 1.0.0
**Status**: Draft
**Author**: AuthZ Engine Team
**Created**: 2024-11-23
**Last Updated**: 2024-11-23
**Reviewers**: Architecture Team

---

## 1. Overview

### 1.1 Purpose

The `@authz-engine/wasm` package enables running the authorization engine at the edge (CDN, browser, serverless) with near-native performance. WebAssembly compilation provides a portable, secure, and fast runtime for authorization decisions without server round-trips.

### 1.2 Scope

**In Scope:**
- WASM module compilation from TypeScript/AssemblyScript
- JavaScript/TypeScript bindings for all target runtimes
- Edge runtime compatibility (Cloudflare Workers, Deno Deploy, Vercel Edge)
- Browser integration with Service Worker support
- Offline-capable authorization with policy caching
- Pre-compiled policy evaluation

**Out of Scope:**
- Dynamic CEL compilation at runtime
- Full CEL function library (subset only)
- Policy management/storage (handled by host)
- Network-based policy sync (handled by host application)

### 1.3 Context

Edge deployment addresses critical latency and availability requirements:

```
Traditional Flow:
  Browser/Edge → Network → AuthZ Server → Decision → Network → Response
  Latency: 50-200ms depending on geography

Edge/WASM Flow:
  Browser/Edge → WASM Engine → Decision → Response
  Latency: < 1ms (no network)
```

### 1.4 Key Decisions

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| AssemblyScript as primary source | TypeScript-like syntax, smaller output | Rust (larger, better performance), Go (no WASM GC) |
| Pre-compiled policies only | WASM size constraints, security | Runtime CEL compilation (too large) |
| Subset of CEL functions | WASM binary size < 500KB | Full CEL (>2MB compiled) |
| No async in hot path | Predictable performance | Async everywhere (unpredictable) |

---

## 2. Requirements

### 2.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-001 | Compile TypeScript policy engine to WASM | Must Have | Pending |
| FR-002 | Initialize engine with pre-compiled policies | Must Have | Pending |
| FR-003 | Synchronous authorization checks after init | Must Have | Pending |
| FR-004 | Batch authorization checks | Must Have | Pending |
| FR-005 | Support Cloudflare Workers runtime | Must Have | Pending |
| FR-006 | Support Deno Deploy runtime | Should Have | Pending |
| FR-007 | Support Vercel Edge Functions | Should Have | Pending |
| FR-008 | Browser integration with standard APIs | Must Have | Pending |
| FR-009 | Service Worker integration for offline | Should Have | Pending |
| FR-010 | Policy integrity verification | Must Have | Pending |

### 2.2 Non-Functional Requirements

| ID | Category | Requirement | Target |
|----|----------|-------------|--------|
| NFR-001 | Size | WASM module gzipped | < 500KB |
| NFR-002 | Performance | Cold start time | < 50ms |
| NFR-003 | Performance | Single check latency | < 1ms |
| NFR-004 | Performance | Batch check (100 requests) | < 10ms |
| NFR-005 | Memory | Per-instance memory usage | < 10MB |
| NFR-006 | Security | Policy integrity verification | SHA-256 |
| NFR-007 | Compatibility | ES2020+ browser support | 95%+ coverage |

---

## 3. Architecture

### 3.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        @authz-engine/wasm                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐   │
│  │  WASM Module     │   │  JS Bindings     │   │  Policy Loader   │   │
│  │                  │   │                  │   │                  │   │
│  │  - PolicyEngine  │◄──┤  - WasmEngine    │   │  - PolicyCache   │   │
│  │  - CELSubset     │   │  - TypedArrays   │   │  - Verification  │   │
│  │  - RoleResolver  │   │  - ErrorBridge   │   │  - Compression   │   │
│  └──────────────────┘   └──────────────────┘   └──────────────────┘   │
│           │                      │                      │             │
│           └──────────────────────┴──────────────────────┘             │
│                                  │                                     │
│                                  ▼                                     │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                     Runtime Adapters                             │  │
│  ├─────────────┬─────────────┬─────────────┬─────────────────────┤  │
│  │ Cloudflare  │    Deno     │   Vercel    │      Browser        │  │
│  │  Workers    │   Deploy    │    Edge     │   + ServiceWorker   │  │
│  └─────────────┴─────────────┴─────────────┴─────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Build Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Build Pipeline                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  TypeScript Source                                                      │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────┐                                                        │
│  │ AssemblyScript │  (TypeScript subset → WASM)                        │
│  │  Compiler     │                                                      │
│  └─────────────┘                                                        │
│       │                                                                 │
│       ├─────────────────────┬─────────────────────┐                    │
│       ▼                     ▼                     ▼                    │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐              │
│  │ Optimize    │     │ Optimize    │     │ Debug       │              │
│  │ for Size    │     │ for Speed   │     │ Build       │              │
│  │ (wasm-opt)  │     │ (wasm-opt)  │     │ (+sourcemap)│              │
│  └─────────────┘     └─────────────┘     └─────────────┘              │
│       │                     │                     │                    │
│       ▼                     ▼                     ▼                    │
│  authz.wasm          authz-perf.wasm       authz-debug.wasm           │
│  (~150KB gzip)       (~200KB gzip)         (~400KB gzip)              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Data Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│                         Initialization Flow                             │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  1. Load WASM Module                                                   │
│     │                                                                  │
│     ▼                                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ await WebAssembly.instantiate(wasmBytes, imports)                │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│     │                                                                  │
│     ▼                                                                  │
│  2. Verify Policy Integrity                                            │
│     │                                                                  │
│     ▼                                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ SHA-256(policyBytes) === expectedHash                            │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│     │                                                                  │
│     ▼                                                                  │
│  3. Load Pre-compiled Policies into WASM Memory                        │
│     │                                                                  │
│     ▼                                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ engine.init(policiesUint8Array)                                  │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
├────────────────────────────────────────────────────────────────────────┤
│                         Check Flow (Synchronous)                        │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  CheckRequest                                                          │
│     │                                                                  │
│     ▼                                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ 1. Serialize to WASM-compatible format (TypedArrays)             │ │
│  │ 2. Call engine.check() - synchronous                             │ │
│  │ 3. Deserialize response from WASM memory                         │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│     │                                                                  │
│     ▼                                                                  │
│  CheckResponse (< 1ms total)                                           │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.4 Integration Points

| Integration | Protocol | Direction | Notes |
|-------------|----------|-----------|-------|
| Host Application | JS Bindings | In | Check requests |
| Policy Source | Uint8Array | In | Pre-compiled policies |
| Cache Storage | Web APIs | Both | Offline support |
| Service Worker | postMessage | Both | Background sync |

---

## 4. Component Design

### 4.1 WASM Engine Interface

```typescript
/**
 * Core WASM engine interface exposed to JavaScript
 */
interface WasmEngine {
  /**
   * Initialize engine with pre-compiled policies
   * @param policies - Serialized policy data
   * @throws WasmInitError if policies invalid
   */
  init(policies: Uint8Array): Promise<void>;

  /**
   * Check authorization (synchronous after init)
   * @param request - Authorization check request
   * @returns Authorization decision
   */
  check(request: CheckRequest): CheckResponse;

  /**
   * Batch check multiple requests
   * @param requests - Array of check requests
   * @returns Array of check responses (same order)
   */
  checkBatch(requests: CheckRequest[]): CheckResponse[];

  /**
   * Get engine version and capabilities
   */
  info(): WasmEngineInfo;

  /**
   * Free all allocated memory
   */
  dispose(): void;
}

/**
 * Engine metadata and capabilities
 */
interface WasmEngineInfo {
  /** Semantic version of WASM module */
  version: string;
  /** Supported CEL functions */
  features: string[];
  /** Current memory usage in bytes */
  memoryUsage: number;
  /** Number of loaded policies */
  policyCount: number;
  /** Build target identifier */
  buildTarget: 'web' | 'node' | 'cloudflare' | 'deno';
  /** Debug mode enabled */
  debug: boolean;
}
```

### 4.2 Build Configuration

```typescript
/**
 * Configuration for WASM build pipeline
 */
interface WasmBuildConfig {
  /** Target runtime environment */
  target: 'web' | 'node' | 'cloudflare' | 'deno';

  /** Optimization settings */
  optimizations: {
    /** Optimize for smaller binary size */
    size: boolean;
    /** Optimize for execution speed */
    speed: boolean;
    /** Include debug information and source maps */
    debug: boolean;
  };

  /** CEL functions to include (affects binary size) */
  features: WasmFeature[];

  /** Memory configuration */
  memory: {
    /** Initial memory pages (64KB each) */
    initial: number;
    /** Maximum memory pages */
    maximum: number;
  };
}

type WasmFeature =
  | 'cel-core'          // Basic operators and comparisons
  | 'cel-string'        // String functions (contains, startsWith, etc.)
  | 'cel-list'          // List operations
  | 'cel-timestamp'     // Date/time functions
  | 'cel-math'          // Math functions
  | 'cel-regex';        // Regular expressions (adds ~50KB)
```

### 4.3 Policy Serialization

```typescript
/**
 * Pre-compiled policy format for WASM consumption
 */
interface CompiledPolicyBundle {
  /** Format version for compatibility */
  version: 1;

  /** SHA-256 hash for integrity verification */
  hash: string;

  /** Compilation timestamp */
  compiledAt: number;

  /** Resource policies indexed by resource kind */
  resourcePolicies: CompiledResourcePolicy[];

  /** Derived roles definitions */
  derivedRoles: CompiledDerivedRole[];

  /** Interned strings for memory efficiency */
  stringTable: string[];
}

/**
 * Pre-compiled resource policy
 */
interface CompiledResourcePolicy {
  /** Index into string table */
  resourceKindIdx: number;
  /** Pre-compiled rules */
  rules: CompiledRule[];
}

/**
 * Pre-compiled rule with optimized conditions
 */
interface CompiledRule {
  /** Action indices into string table */
  actionIdxs: number[];
  /** Effect: 0 = deny, 1 = allow */
  effect: 0 | 1;
  /** Role indices into string table */
  roleIdxs: number[];
  /** Pre-compiled condition bytecode */
  conditionBytecode: Uint8Array | null;
}
```

### 4.4 Error Types

```typescript
/**
 * Base error for WASM operations
 */
class WasmError extends Error {
  constructor(
    message: string,
    public code: WasmErrorCode,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'WasmError';
  }
}

enum WasmErrorCode {
  /** WASM module failed to load */
  MODULE_LOAD_FAILED = 'WASM_MODULE_LOAD_FAILED',
  /** Policy integrity check failed */
  INTEGRITY_CHECK_FAILED = 'WASM_INTEGRITY_FAILED',
  /** Policy format incompatible */
  POLICY_VERSION_MISMATCH = 'WASM_POLICY_VERSION',
  /** Out of memory */
  OUT_OF_MEMORY = 'WASM_OOM',
  /** Engine not initialized */
  NOT_INITIALIZED = 'WASM_NOT_INIT',
  /** Invalid request format */
  INVALID_REQUEST = 'WASM_INVALID_REQUEST',
  /** Runtime evaluation error */
  EVALUATION_ERROR = 'WASM_EVAL_ERROR'
}
```

---

## 5. Edge Runtime Integration

### 5.1 Cloudflare Workers

```typescript
// wrangler.toml
// [build]
// command = "npm run build:wasm:cloudflare"
//
// [wasm_modules]
// AUTHZ_ENGINE = "dist/authz.wasm"

import { AuthzWasm, type CheckRequest } from '@authz-engine/wasm';

interface Env {
  POLICIES: KVNamespace;
  POLICY_HASH: string;
}

let engineInstance: AuthzWasm | null = null;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Lazy initialization with caching
    if (!engineInstance) {
      const policyData = await env.POLICIES.get('compiled', 'arrayBuffer');
      if (!policyData) {
        return new Response('Policies not loaded', { status: 503 });
      }

      engineInstance = new AuthzWasm();
      await engineInstance.init(new Uint8Array(policyData), {
        expectedHash: env.POLICY_HASH
      });
    }

    // Parse authorization request
    const body = await request.json() as CheckRequest;

    // Synchronous check - no await needed
    const result = engineInstance.check({
      principal: body.principal,
      resource: body.resource,
      actions: body.actions
    });

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
```

### 5.2 Deno Deploy

```typescript
// main.ts
import { AuthzWasm } from 'npm:@authz-engine/wasm';

const engine = new AuthzWasm();

// Initialize from Deno KV or fetch
const policies = await Deno.readFile('./policies.compiled');
await engine.init(policies);

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const body = await request.json();
  const result = engine.check(body);

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' }
  });
});
```

### 5.3 Vercel Edge Functions

```typescript
// api/authz.ts
import type { NextRequest } from 'next/server';
import { AuthzWasm } from '@authz-engine/wasm';

export const config = {
  runtime: 'edge',
};

// Module-level singleton
let engine: AuthzWasm | null = null;

export default async function handler(req: NextRequest) {
  if (!engine) {
    const response = await fetch(process.env.POLICY_URL!);
    const policies = new Uint8Array(await response.arrayBuffer());

    engine = new AuthzWasm();
    await engine.init(policies);
  }

  const body = await req.json();
  const result = engine.check(body);

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' }
  });
}
```

---

## 6. Browser Integration

### 6.1 Standard Browser Usage

```typescript
// Import with tree-shaking support
import { createAuthzEngine } from '@authz-engine/wasm/browser';

async function initializeAuthz(): Promise<AuthzEngine> {
  // Fetch WASM module (can be cached by browser)
  const engine = await createAuthzEngine({
    wasmUrl: '/authz-engine.wasm',
    policiesUrl: '/policies.compiled',

    // Optional: verify policy integrity
    expectedPolicyHash: 'sha256-abc123...'
  });

  return engine;
}

// Usage in application
const authz = await initializeAuthz();

// Check permissions synchronously
function canUserEdit(userId: string, documentId: string): boolean {
  const result = authz.check({
    principal: { id: userId, roles: getCurrentUserRoles() },
    resource: { kind: 'document', id: documentId, attributes: {} },
    actions: ['edit']
  });

  return result.results['edit']?.effect === 'allow';
}
```

### 6.2 React Hook

```typescript
// hooks/useAuthz.ts
import { createContext, useContext, useEffect, useState } from 'react';
import { createAuthzEngine, type AuthzEngine, type CheckRequest } from '@authz-engine/wasm/browser';

interface AuthzContextValue {
  engine: AuthzEngine | null;
  isReady: boolean;
  check: (request: Omit<CheckRequest, 'principal'>) => boolean;
}

const AuthzContext = createContext<AuthzContextValue | null>(null);

export function AuthzProvider({
  children,
  wasmUrl,
  policiesUrl
}: {
  children: React.ReactNode;
  wasmUrl: string;
  policiesUrl: string;
}) {
  const [engine, setEngine] = useState<AuthzEngine | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    createAuthzEngine({ wasmUrl, policiesUrl })
      .then(setEngine)
      .then(() => setIsReady(true))
      .catch(console.error);
  }, [wasmUrl, policiesUrl]);

  const check = (request: Omit<CheckRequest, 'principal'>): boolean => {
    if (!engine) return false;

    const result = engine.check({
      ...request,
      principal: getCurrentPrincipal() // From auth context
    });

    return result.results[request.actions[0]]?.effect === 'allow';
  };

  return (
    <AuthzContext.Provider value={{ engine, isReady, check }}>
      {children}
    </AuthzContext.Provider>
  );
}

export function useAuthz() {
  const context = useContext(AuthzContext);
  if (!context) throw new Error('useAuthz must be used within AuthzProvider');
  return context;
}

// Usage
function EditButton({ documentId }: { documentId: string }) {
  const { check, isReady } = useAuthz();

  if (!isReady) return null;

  const canEdit = check({
    resource: { kind: 'document', id: documentId, attributes: {} },
    actions: ['edit']
  });

  return canEdit ? <button>Edit</button> : null;
}
```

---

## 7. Offline Support

### 7.1 Service Worker Integration

```typescript
// service-worker.ts
import { AuthzWasm } from '@authz-engine/wasm';

const CACHE_NAME = 'authz-cache-v1';
const engine = new AuthzWasm();
let isInitialized = false;

// Cache policies on install
self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll([
        '/authz-engine.wasm',
        '/policies.compiled'
      ]);
    })
  );
});

// Initialize engine on activate
self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const policiesResponse = await cache.match('/policies.compiled');

      if (policiesResponse) {
        const policies = new Uint8Array(await policiesResponse.arrayBuffer());
        await engine.init(policies);
        isInitialized = true;
      }
    })()
  );
});

// Handle authorization requests from main thread
self.addEventListener('message', async (event: ExtendableMessageEvent) => {
  if (event.data.type !== 'authz-check') return;

  if (!isInitialized) {
    event.ports[0].postMessage({ error: 'Engine not initialized' });
    return;
  }

  try {
    const result = engine.check(event.data.request);
    event.ports[0].postMessage({ result });
  } catch (error) {
    event.ports[0].postMessage({ error: String(error) });
  }
});
```

### 7.2 Policy Sync Strategy

```typescript
/**
 * Policy caching and synchronization
 */
interface PolicyCacheConfig {
  /** IndexedDB database name */
  dbName: string;
  /** Check for updates interval (ms) */
  syncInterval: number;
  /** Policy endpoint URL */
  policyUrl: string;
  /** Expected policy hash (updated on sync) */
  currentHash: string;
}

class PolicyCache {
  private db: IDBDatabase | null = null;
  private config: PolicyCacheConfig;

  constructor(config: PolicyCacheConfig) {
    this.config = config;
  }

  async init(): Promise<void> {
    this.db = await this.openDatabase();
    this.startSyncInterval();
  }

  async getLatestPolicies(): Promise<Uint8Array> {
    // Try cache first
    const cached = await this.getCached();
    if (cached) return cached;

    // Fall back to network
    return this.fetchAndCache();
  }

  private async getCached(): Promise<Uint8Array | null> {
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('policies', 'readonly');
      const store = tx.objectStore('policies');
      const request = store.get('current');

      request.onsuccess = () => resolve(request.result?.data || null);
      request.onerror = () => reject(request.error);
    });
  }

  private async fetchAndCache(): Promise<Uint8Array> {
    const response = await fetch(this.config.policyUrl);
    const data = new Uint8Array(await response.arrayBuffer());

    // Verify integrity
    const hash = await this.computeHash(data);
    if (hash !== response.headers.get('X-Policy-Hash')) {
      throw new Error('Policy integrity check failed');
    }

    await this.saveToCache(data, hash);
    return data;
  }

  private async computeHash(data: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private startSyncInterval(): void {
    setInterval(async () => {
      try {
        const response = await fetch(this.config.policyUrl, { method: 'HEAD' });
        const remoteHash = response.headers.get('X-Policy-Hash');

        if (remoteHash && remoteHash !== this.config.currentHash) {
          await this.fetchAndCache();
          // Notify engine to reload
          self.postMessage({ type: 'policies-updated' });
        }
      } catch {
        // Network unavailable, continue with cached
      }
    }, this.config.syncInterval);
  }
}
```

---

## 8. Performance Targets

### 8.1 Size Budgets

| Build Type | Uncompressed | Gzipped | Brotli |
|------------|--------------|---------|--------|
| Size-optimized | 400KB | 150KB | 120KB |
| Speed-optimized | 550KB | 200KB | 160KB |
| Debug | 1.2MB | 400KB | 350KB |

### 8.2 Runtime Performance

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Cold start (WASM load + init) | < 50ms | `performance.now()` |
| Policy loading (1000 rules) | < 20ms | Internal timing |
| Single check latency | < 1ms | Median over 10K checks |
| Batch check (100 requests) | < 10ms | Median over 1K batches |
| Memory baseline | < 5MB | `engine.info().memoryUsage` |
| Memory per 1000 policies | ~2MB | Incremental measurement |

### 8.3 Optimization Techniques

| Technique | Impact | Tradeoff |
|-----------|--------|----------|
| String interning | -30% memory | Slight init overhead |
| Condition bytecode | -40% eval time | Compile-time only |
| Rule indexing | -60% lookup time | +10% memory |
| WASM SIMD | -25% eval time | Older browser compat |
| Memory pooling | -50% allocation time | Fixed pool size |

---

## 9. CEL Function Subset

### 9.1 Supported Functions

The WASM module includes a subset of CEL functions to meet size constraints:

| Category | Functions | Notes |
|----------|-----------|-------|
| Comparison | `==`, `!=`, `<`, `>`, `<=`, `>=` | All types |
| Logical | `&&`, `\|\|`, `!` | Boolean operations |
| Arithmetic | `+`, `-`, `*`, `/`, `%` | Numeric only |
| String | `startsWith`, `endsWith`, `contains`, `matches` | UTF-8 |
| Collection | `in`, `size`, `has` | Lists and maps |
| Type | `type`, `string`, `int`, `bool` | Conversions |
| Timestamp | `timestamp`, `getHours`, `getDayOfWeek` | ISO 8601 |

### 9.2 Unsupported Functions

| Function | Reason | Workaround |
|----------|--------|------------|
| `duration` parsing | Complex parser (+50KB) | Pre-compute to ms |
| `matches` (full regex) | Regex engine (+100KB) | Simple patterns only |
| `inIPRange` | IP parsing (+30KB) | Pre-compute ranges |
| Custom functions | Dynamic binding | Pre-compile |

---

## 10. Security Considerations

### 10.1 WASM Sandbox

| Property | Guarantee |
|----------|-----------|
| Memory isolation | Linear memory only accessible by module |
| No system calls | Cannot access filesystem, network |
| No host bindings | Only explicit imports available |
| Deterministic execution | Same inputs = same outputs |
| No JIT escape | Validated bytecode execution |

### 10.2 Policy Integrity

```typescript
interface PolicyIntegrityOptions {
  /** SHA-256 hash of policy bundle */
  expectedHash: string;

  /** Optional: verify signature */
  publicKey?: CryptoKey;
  signature?: Uint8Array;

  /** Reject policies older than this timestamp */
  minCompileTime?: number;
}

async function verifyPolicyIntegrity(
  policies: Uint8Array,
  options: PolicyIntegrityOptions
): Promise<boolean> {
  // Hash verification
  const hash = await crypto.subtle.digest('SHA-256', policies);
  const hashHex = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  if (hashHex !== options.expectedHash) {
    throw new WasmError(
      'Policy hash mismatch',
      WasmErrorCode.INTEGRITY_CHECK_FAILED,
      { expected: options.expectedHash, actual: hashHex }
    );
  }

  // Optional signature verification
  if (options.publicKey && options.signature) {
    const valid = await crypto.subtle.verify(
      'Ed25519',
      options.publicKey,
      options.signature,
      policies
    );

    if (!valid) {
      throw new WasmError(
        'Policy signature invalid',
        WasmErrorCode.INTEGRITY_CHECK_FAILED
      );
    }
  }

  return true;
}
```

### 10.3 Threat Model

| Threat | Mitigation |
|--------|------------|
| Tampered policies | SHA-256 hash verification |
| Policy replay | Timestamp validation |
| Memory corruption | WASM linear memory isolation |
| DoS via large policies | Size limits, memory caps |
| Timing attacks | Constant-time comparisons |

---

## 11. Testing Strategy

### 11.1 Unit Tests

| Component | Coverage Target | Test File |
|-----------|-----------------|-----------|
| WASM bindings | 95% | `wasm/bindings.test.ts` |
| Policy compiler | 95% | `compiler/compiler.test.ts` |
| CEL subset | 90% | `cel/subset.test.ts` |
| Serialization | 95% | `serialization.test.ts` |

### 11.2 Integration Tests

| Scenario | Components | Test File |
|----------|------------|-----------|
| Cloudflare Workers | WASM + CF runtime | `integration/cloudflare.test.ts` |
| Deno Deploy | WASM + Deno | `integration/deno.test.ts` |
| Browser | WASM + DOM | `integration/browser.test.ts` |
| Offline | WASM + SW + IDB | `integration/offline.test.ts` |

### 11.3 Performance Tests

| Test | Target | Current |
|------|--------|---------|
| Cold start | < 50ms | TBD |
| 1000 sequential checks | < 1000ms | TBD |
| 1000 batch checks | < 100ms | TBD |
| Memory growth (10K checks) | < 1MB | TBD |

### 11.4 Compatibility Matrix

| Runtime | Version | Status |
|---------|---------|--------|
| Chrome | 90+ | Supported |
| Firefox | 89+ | Supported |
| Safari | 15+ | Supported |
| Edge | 90+ | Supported |
| Node.js | 16+ | Supported |
| Deno | 1.20+ | Supported |
| Cloudflare Workers | All | Supported |
| Vercel Edge | All | Supported |

---

## 12. Dependencies

### 12.1 Build Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `assemblyscript` | ^0.27.0 | TypeScript to WASM compiler |
| `binaryen` | ^118.0.0 | WASM optimizer (wasm-opt) |
| `@aspect-build/bazel-lib` | ^2.0.0 | Build orchestration |

### 12.2 Runtime Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| None | - | Zero runtime dependencies |

### 12.3 Optional Peer Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `@cloudflare/workers-types` | ^4.0.0 | Cloudflare type definitions |
| `@vercel/edge` | ^1.0.0 | Vercel Edge utilities |

---

## 13. Deployment

### 13.1 Package Exports

```json
{
  "name": "@authz-engine/wasm",
  "version": "1.0.0",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    },
    "./browser": {
      "types": "./dist/browser.d.ts",
      "import": "./dist/browser.mjs"
    },
    "./cloudflare": {
      "types": "./dist/cloudflare.d.ts",
      "import": "./dist/cloudflare.mjs"
    },
    "./deno": {
      "types": "./dist/deno.d.ts",
      "import": "./dist/deno.mjs"
    },
    "./wasm": "./dist/authz.wasm",
    "./wasm-debug": "./dist/authz-debug.wasm"
  },
  "files": [
    "dist"
  ]
}
```

### 13.2 CDN Deployment

```html
<!-- Direct WASM loading from CDN -->
<script type="module">
  import { createAuthzEngine } from 'https://cdn.example.com/@authz-engine/wasm@1.0.0/browser.mjs';

  const engine = await createAuthzEngine({
    wasmUrl: 'https://cdn.example.com/@authz-engine/wasm@1.0.0/authz.wasm',
    policiesUrl: '/api/policies'
  });
</script>
```

---

## 14. Limitations

### 14.1 Known Limitations

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| No dynamic CEL | Cannot add functions at runtime | Pre-compile all needed |
| Limited regex | Only simple patterns | Use string functions |
| No IP parsing | Cannot use `inIPRange` | Pre-compute IP checks |
| 10MB memory cap | Large policy sets may fail | Split policy bundles |
| No async conditions | Conditions must be pure | Pre-fetch async data |

### 14.2 Platform-Specific Limitations

| Platform | Limitation |
|----------|------------|
| Cloudflare Workers | 1MB script size (WASM separate) |
| Vercel Edge | 1MB total size |
| Deno Deploy | 20MB memory limit |
| Safari | No SharedArrayBuffer (no threading) |

---

## 15. Related Documents

- [CORE-PACKAGE-SDD.md](./CORE-PACKAGE-SDD.md) - Core engine design
- [CEL-EVALUATOR-SDD.md](./CEL-EVALUATOR-SDD.md) - Full CEL implementation
- [SDK-PACKAGE-SDD.md](./SDK-PACKAGE-SDD.md) - TypeScript SDK
- [ADR-001: CEL Expression Language](../adr/ADR-001-CEL-EXPRESSION-LANGUAGE.md)

---

## 16. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-11-23 | Initial design document |

---

## Appendix A: Policy Compilation Example

```typescript
// compile-policies.ts
import { PolicyCompiler } from '@authz-engine/wasm/compiler';

const compiler = new PolicyCompiler({
  features: ['cel-core', 'cel-string', 'cel-timestamp'],
  optimizations: { size: true }
});

// Load YAML policies
const policies = await loadYamlPolicies('./policies/**/*.yaml');

// Compile to WASM-compatible format
const bundle = await compiler.compile(policies);

// Output compiled bundle
await Deno.writeFile(
  'policies.compiled',
  bundle.serialize()
);

console.log(`Compiled ${bundle.policyCount} policies`);
console.log(`Bundle size: ${bundle.size} bytes`);
console.log(`Hash: ${bundle.hash}`);
```

---

## Appendix B: Debugging Guide

### B.1 Source Maps

```typescript
// Enable debug build for development
const engine = await createAuthzEngine({
  wasmUrl: '/authz-debug.wasm',  // Debug build with source maps
  policiesUrl: '/policies.compiled',
  debug: true
});

// Stack traces will reference original TypeScript
engine.check(invalidRequest);
// Error at src/engine.ts:42:15
//   at checkPermission (src/engine.ts:42:15)
//   at Object.check (src/bindings.ts:28:10)
```

### B.2 Performance Profiling

```typescript
// Enable performance tracing
const engine = await createAuthzEngine({
  wasmUrl: '/authz.wasm',
  policiesUrl: '/policies.compiled',
  trace: true
});

const result = engine.check(request);

// Access trace data
console.log(result.meta?.trace);
// {
//   policyLookupMs: 0.02,
//   roleResolutionMs: 0.05,
//   conditionEvalMs: 0.12,
//   totalMs: 0.19
// }
```
