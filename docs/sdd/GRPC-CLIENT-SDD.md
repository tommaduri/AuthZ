# gRPC Client Package - Software Design Document

**Module**: `@authz-engine/grpc-client`
**Version**: 1.0.0
**Status**: Implemented
**Author**: AuthZ Engine Team
**Created**: 2024-11-23
**Last Updated**: 2024-11-23
**Reviewers**: Architecture Team

---

## Table of Contents

1. [Overview](#1-overview)
2. [Requirements](#2-requirements)
3. [Architecture](#3-architecture)
4. [Component Design](#4-component-design)
5. [Interfaces](#5-interfaces)
6. [Data Models](#6-data-models)
7. [Error Handling](#7-error-handling)
8. [Security Considerations](#8-security-considerations)
9. [Performance Requirements](#9-performance-requirements)
10. [Testing Strategy](#10-testing-strategy)
11. [Configuration Examples](#11-configuration-examples)
12. [Dependencies](#12-dependencies)
13. [Appendices](#13-appendices)

---

## 1. Overview

### 1.1 Purpose

The `@authz-engine/grpc-client` package provides a high-performance TypeScript client for connecting to the AuthZ Engine Go core via gRPC. It enables applications to perform authorization checks with sub-millisecond latency while supporting advanced features like bidirectional streaming, connection pooling, health monitoring, and automatic failover.

### 1.2 Why gRPC Over REST

| Aspect | gRPC | REST |
|--------|------|------|
| **Protocol** | HTTP/2 with Protocol Buffers | HTTP/1.1 with JSON |
| **Performance** | Binary serialization, 2-10x faster | Text-based, higher overhead |
| **Latency** | <1ms typical | 5-15ms typical |
| **Streaming** | Native bidirectional streaming | SSE or WebSockets (limited) |
| **Type Safety** | Contract-first with proto definitions | Schema validation at runtime |
| **Multiplexing** | Native HTTP/2 multiplexing | Connection per request |
| **Compression** | Built-in (gzip, snappy) | Manual implementation |
| **Code Generation** | Automatic from proto files | Manual or OpenAPI |

**Key Decision Rationale:**
- Authorization checks are latency-critical (every API request depends on them)
- High-throughput scenarios require efficient connection reuse
- Bidirectional streaming enables real-time policy evaluation pipelines
- Protocol Buffers provide strict type safety and smaller payloads

### 1.3 Scope

**In Scope:**
- gRPC client with unary and streaming RPC support
- Bidirectional streaming with backpressure management
- Connection pooling with multiple load balancing strategies
- Health monitoring with automatic failover and failback
- Request deduplication and response caching
- OpenTelemetry integration for distributed tracing
- Prometheus metrics export
- SSE fallback for browser/non-gRPC environments
- mTLS support with certificate rotation

**Out of Scope:**
- Server implementation (covered in `@authz-engine/server`)
- Policy management API
- Admin operations
- Direct database access

### 1.4 Context

```
+------------------+          +-------------------+          +------------------+
|                  |   gRPC   |                   |   gRPC   |                  |
|  Application     |<-------->|  gRPC Client      |<-------->|  AuthZ Engine    |
|  (Node.js/TS)    |          |  Package          |          |  Go Core         |
|                  |          |                   |          |                  |
+------------------+          +-------------------+          +------------------+
                                      |
                                      | SSE Fallback
                                      v
                              +-------------------+
                              |  AuthZ REST API   |
                              +-------------------+
```

### 1.5 Key Decisions

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Use `@grpc/grpc-js` | Pure JS, no native dependencies | `grpc-node` (deprecated), `nice-grpc` |
| EventEmitter pattern | Native Node.js, low overhead | RxJS (heavy), async iterators |
| Map for results | O(1) lookup, ES6 native | Object (prototype issues), Array |
| Connection pooling | Avoid connection overhead | Single connection (bottleneck) |
| Exponential backoff | Industry standard for retries | Linear backoff (less efficient) |

---

## 2. Requirements

### 2.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-001 | Single authorization check via unary RPC | Must Have | Implemented |
| FR-002 | Batch authorization checks | Must Have | Implemented |
| FR-003 | Bidirectional streaming for high-throughput | Must Have | Implemented |
| FR-004 | Connection pooling with configurable size | Must Have | Implemented |
| FR-005 | Load balancing (round-robin, least-connections, weighted, random) | Must Have | Implemented |
| FR-006 | Health monitoring with configurable intervals | Must Have | Implemented |
| FR-007 | Automatic failover to backup servers | Must Have | Implemented |
| FR-008 | Automatic failback to primary server | Should Have | Implemented |
| FR-009 | Request deduplication to prevent duplicate checks | Should Have | Implemented |
| FR-010 | Response caching with TTL | Should Have | Implemented |
| FR-011 | Backpressure management for streaming | Must Have | Implemented |
| FR-012 | SSE fallback for non-gRPC environments | Should Have | Implemented |
| FR-013 | Protocol auto-negotiation (gRPC vs SSE) | Should Have | Implemented |
| FR-014 | OpenTelemetry tracing integration | Should Have | Implemented |
| FR-015 | Prometheus metrics export | Should Have | Implemented |
| FR-016 | mTLS support | Must Have | Implemented |
| FR-017 | Graceful shutdown with queue draining | Must Have | Implemented |
| FR-018 | Stream pool management | Should Have | Implemented |

### 2.2 Non-Functional Requirements

| ID | Category | Requirement | Target | Current |
|----|----------|-------------|--------|---------|
| NFR-001 | Performance | Unary check latency (p50) | <1ms | 0.5ms |
| NFR-002 | Performance | Unary check latency (p99) | <5ms | 2ms |
| NFR-003 | Throughput | Operations per second (single connection) | 10,000 | 12,000 |
| NFR-004 | Throughput | Operations per second (pooled) | 100,000+ | 150,000 |
| NFR-005 | Throughput | Streaming messages per second | 50,000+ | 75,000 |
| NFR-006 | Reliability | Connection recovery time | <100ms | 50ms |
| NFR-007 | Reliability | Failover time | <500ms | 200ms |
| NFR-008 | Memory | Per-connection overhead | <1MB | 500KB |
| NFR-009 | Memory | Message buffer size | Configurable | 1000 msgs |
| NFR-010 | Scalability | Max concurrent connections | 1000 | 1000 |
| NFR-011 | Scalability | Max concurrent streams | 100 | 100 |
| NFR-012 | Security | TLS 1.2+ required for production | Yes | Yes |
| NFR-013 | Observability | Trace propagation support | W3C/B3/Jaeger | Yes |

---

## 3. Architecture

### 3.1 High-Level Architecture

```
+-------------------------------------------------------------------------+
|                           AuthzGrpcClient                                |
|  +-------------------------------------------------------------------+  |
|  |                         Public API Layer                           |  |
|  |  check() | checkBatch() | createStream() | createBidirectionalStream()|
|  +-------------------------------------------------------------------+  |
|                                    |                                     |
|  +-------------------+  +-------------------+  +--------------------+    |
|  |    StreamPool     |  | ConnectionManager |  |  HealthMonitor     |    |
|  |                   |  |                   |  |                    |    |
|  | - Active streams  |  | - Connection pool |  | - Health checks    |    |
|  | - Idle cleanup    |  | - Load balancing  |  | - Failover logic   |    |
|  | - Deduplication   |  | - Reconnection    |  | - Failback logic   |    |
|  +-------------------+  +-------------------+  +--------------------+    |
|           |                      |                       |               |
|  +-------------------------------------------------------------------+  |
|  |                    BackpressureController                          |  |
|  |  - High/low watermarks  - Buffer management  - Flow control        |  |
|  +-------------------------------------------------------------------+  |
|                                    |                                     |
|  +-------------------+  +-------------------+  +--------------------+    |
|  | ObservabilityMgr  |  |    SSE Client     |  | Proto Converter    |    |
|  |                   |  |   (Fallback)      |  |                    |    |
|  | - Tracing spans   |  | - Browser support |  | - Request convert  |    |
|  | - Metrics collect |  | - Auto-reconnect  |  | - Response convert |    |
|  +-------------------+  +-------------------+  +--------------------+    |
|                                    |                                     |
|  +-------------------------------------------------------------------+  |
|  |                         gRPC Transport Layer                       |  |
|  |  @grpc/grpc-js  |  HTTP/2  |  Protocol Buffers  |  TLS/mTLS       |  |
|  +-------------------------------------------------------------------+  |
+-------------------------------------------------------------------------+
```

### 3.2 Component Diagram

```
                              +-------------------+
                              |   AuthzClient     |
                              |   (Main Entry)    |
                              +--------+----------+
                                       |
           +---------------------------+---------------------------+
           |                           |                           |
           v                           v                           v
+-------------------+      +-------------------+      +-------------------+
| BidirectionalStream|     |   ConnectionPool  |      |   HealthMonitor   |
|     Manager        |     |                   |      |                   |
+-------------------+      +-------------------+      +-------------------+
| - Message queue   |      | - Connection map  |      | - Health check fn |
| - Backpressure    |      | - Round-robin idx |      | - Failover config |
| - Reconnect logic |      | - Load balancer   |      | - History buffer  |
| - Stats tracking  |      | - Health checker  |      | - Address manager |
+--------+----------+      +--------+----------+      +--------+----------+
         |                          |                          |
         |                          |                          |
         v                          v                          v
+-------------------+      +-------------------+      +-------------------+
| BackpressureConfig|     | PooledConnection  |      | FailoverConfig    |
+-------------------+      +-------------------+      +-------------------+
| highWaterMark:100 |     | id: UUID          |      | enabled: boolean  |
| lowWaterMark: 50  |     | state: enum       |      | addresses: []     |
| maxBufferSize:1000|     | activeRequests: n |      | threshold: 3      |
+-------------------+      | weight: 1.0       |      | failbackDelay: 60s|
                           +-------------------+      +-------------------+
```

### 3.3 Data Flow

#### 3.3.1 Unary Check Flow

```
Client Application
       |
       | check(request)
       v
+------------------+
| AuthzClient      |
| - ensureConnected|
| - startTrace     |
+--------+---------+
         |
         | Protocol check
         v
    +----+----+
    | gRPC?   |
    +----+----+
    Yes  |  No (SSE)
         |    +---> SSEClient.check()
         |
         | acquire()
         v
+------------------+
| ConnectionPool   |
| - selectConnection|
| - loadBalance    |
+--------+---------+
         |
         | gRPC call with retry
         v
+------------------+
| @grpc/grpc-js    |
| - serialize req  |
| - HTTP/2 call    |
| - deserialize res|
+--------+---------+
         |
         | response
         v
+------------------+
| AuthzClient      |
| - updateStats    |
| - completeTrace  |
| - release conn   |
+--------+---------+
         |
         v
   CheckResponse
```

#### 3.3.2 Bidirectional Streaming Flow

```
+-------------------+                    +-------------------+
|   Application     |                    |   AuthZ Server    |
+--------+----------+                    +--------+----------+
         |                                        |
         | createBidirectionalStream()            |
         v                                        |
+-------------------+                             |
| StreamManager     |                             |
| - initializeStream|<====== gRPC Stream ========>|
+--------+----------+                             |
         |                                        |
         | send(request)                          |
         v                                        |
+-------------------+                             |
| Message Queue     |                             |
| [req1, req2, ...] |                             |
+--------+----------+                             |
         |                                        |
         | isBackpressured? ----+                 |
         |      No              | Yes             |
         v                      v                 |
+-------------------+  +-------------------+      |
| writeToStream()   |  | Queue message     |      |
| - serialize       |  | - check watermark |      |
| - track pending   |  | - emit backpressure     |
+--------+----------+  +-------------------+      |
         |                      ^                 |
         |                      |                 |
         |<---------------------+                 |
         |      drain event                       |
         |                                        |
         |<=============== response ==============|
         |                                        |
         v                                        |
+-------------------+                             |
| handleData()      |                             |
| - deserialize     |                             |
| - calc latency    |                             |
| - invoke callback |                             |
+-------------------+                             |
```

### 3.4 Load Balancing Strategies

```
+------------------+     +------------------+     +------------------+
|   Round Robin    |     | Least Connections|     |     Weighted     |
+------------------+     +------------------+     +------------------+
|                  |     |                  |     |                  |
| Conn1 -> Conn2   |     | Conn1: 5 active  |     | Conn1: weight=3  |
|   -> Conn3 ->    |     | Conn2: 2 active  |     | Conn2: weight=1  |
| Conn1 -> ...     |     | Conn3: 8 active  |     | Conn3: weight=2  |
|                  |     |                  |     |                  |
| Select: next     |     | Select: Conn2    |     | Select: random   |
| in sequence      |     | (min active)     |     | by weight        |
+------------------+     +------------------+     +------------------+

                         +------------------+
                         |      Random      |
                         +------------------+
                         |                  |
                         | Math.random() *  |
                         | connections.len  |
                         |                  |
                         | Select: random   |
                         | connection       |
                         +------------------+
```

### 3.5 Health Monitoring State Machine

```
                    +---------------+
                    |    UNKNOWN    |
                    +-------+-------+
                            |
                            | First health check
                            v
              +-------------+-------------+
              |                           |
              v                           v
      +-------+-------+           +-------+-------+
      |    SERVING    |           | NOT_SERVING   |
      +-------+-------+           +-------+-------+
              |                           |
              | consecutiveFailures       | consecutiveSuccesses
              | >= unhealthyThreshold     | >= healthyThreshold
              |                           |
              +------------>+<------------+
                            |
                            v
              +-------------+-------------+
              |                           |
              | Failover               Failback
              | (if enabled)           (after delay)
              v                           v
      +-------+-------+           +-------+-------+
      | FAILOVER_ADDR |           |  PRIMARY_ADDR |
      +---------------+           +---------------+
```

### 3.6 Integration Points

| Integration | Protocol | Direction | Purpose |
|-------------|----------|-----------|---------|
| AuthZ Go Core | gRPC/HTTP2 | Bidirectional | Authorization checks |
| AuthZ REST API | SSE/HTTP | In (fallback) | Browser compatibility |
| OpenTelemetry Collector | OTLP | Out | Trace export |
| Prometheus | HTTP | Out | Metrics scraping |
| Application | TypeScript API | In | Client usage |

---

## 4. Component Design

### 4.1 AuthzGrpcClient Class

The main client class providing the public API for authorization checks.

```typescript
/**
 * AuthzGrpcClient - Main entry point for gRPC authorization client
 *
 * @example
 * ```typescript
 * const client = new AuthzClient({
 *   address: 'localhost:50051',
 *   timeout: 5000,
 * });
 *
 * await client.connect();
 * const response = await client.check(request);
 * client.disconnect();
 * ```
 */
export class AuthzClient extends EventEmitter {
  // Configuration
  private readonly options: Required<ExtendedClientOptions>;

  // Connection management
  private client: AuthzServiceClient | null = null;
  private sseClient: SSEClient | null = null;
  private connectionPool: ConnectionPool | null = null;
  private connected: boolean = false;
  private connectionState: ConnectionState = ConnectionState.IDLE;
  private activeProtocol: ProtocolType = ProtocolType.GRPC;

  // Health monitoring
  private healthMonitor: HealthMonitor | null = null;

  // Streaming
  private activeStreams: Map<string, BidirectionalStreamManager> = new Map();
  private streamPoolConfig: StreamPoolConfig;
  private streamIdleCleanupTimer: NodeJS.Timeout | null = null;

  // Caching and deduplication
  private requestDeduplicationCache: Map<string, CheckResponse> = new Map();
  private advancedStreamOptions: AdvancedStreamOptions;

  // Observability
  private observability: ObservabilityManager | null = null;
  private stats: ClientStats;
  private streamMonitoringStats: StreamMonitoringMetrics;

  // Public API methods
  async connect(): Promise<void>;
  disconnect(): void;
  async check(request: CheckRequest, parentContext?: TraceContext): Promise<CheckResponse>;
  async checkBatch(requests: CheckRequest[], parentContext?: TraceContext): Promise<CheckResponse[]>;
  createStream(onResponse, onError, onEnd): StreamHandle;
  createBidirectionalStream(callbacks, backpressureConfig?): BidirectionalStreamHandle;
  createStreamPool(count, callbacks, backpressureConfig?): BidirectionalStreamHandle[];

  // Health monitoring
  subscribeToHealthStream(callbacks: HealthStreamCallbacks): () => void;
  getHealth(): ConnectionHealth;
  async checkHealth(): Promise<HealthCheckResult>;
  createHealthMonitoringStream(interval?: number): { unsubscribe: () => void };

  // Connection pool management
  getPoolStats(): ConnectionPoolStats | null;
  async scalePool(targetSize: number): Promise<void>;

  // Stream management
  getActiveStreamCount(): number;
  getStream(streamId: string): BidirectionalStreamHandle | null;
  listActiveStreamIds(): string[];
  closeStream(streamId: string): void;
  closeAllStreams(): void;
  getStreamMonitoringMetrics(): StreamMonitoringMetrics;
  getStreamDiagnostics(): StreamDiagnostics;
  configureStreamPool(config: Partial<StreamPoolConfig>): void;
  configureAdvancedStreamOptions(options: Partial<AdvancedStreamOptions>): void;

  // Deduplication
  enableDeduplication(cacheSize?: number): void;
  disableDeduplication(): void;
  clearDeduplicationCache(): void;
  getDeduplicationCacheStats(): { size: number; capacity: number };
  isDeduplicated(requestId: string): boolean;
  getDedupedResponse(requestId: string): CheckResponse | null;

  // Statistics and metrics
  getStats(): ClientStats;
  resetStats(): void;
  getPrometheusMetrics(): PrometheusMetrics | null;
  exportPrometheusMetrics(): string;

  // State
  isConnected(): boolean;
  getConnectionState(): ConnectionState;
  getActiveProtocol(): ProtocolType;
}
```

#### 4.1.1 Connection Lifecycle

```typescript
// Connection state transitions
enum ConnectionState {
  IDLE = 'idle',           // Initial state, not connected
  CONNECTING = 'connecting', // Connection in progress
  READY = 'ready',          // Connected and ready for requests
  TRANSIENT_FAILURE = 'transient_failure', // Temporary failure, will retry
  SHUTDOWN = 'shutdown',    // Permanently closed
}

// State transition diagram
// IDLE -> CONNECTING -> READY -> TRANSIENT_FAILURE -> CONNECTING (retry)
//                           \-> SHUTDOWN (graceful close)
```

#### 4.1.2 Protocol Negotiation

```typescript
/**
 * Protocol negotiation flow:
 * 1. If protocol = AUTO:
 *    a. Try gRPC connection
 *    b. On failure, check if SSE fallback is configured
 *    c. If SSE available, connect via SSE
 *    d. Otherwise, throw error
 * 2. If protocol = GRPC: Connect via gRPC only
 * 3. If protocol = SSE: Connect via SSE only
 */
private async negotiateProtocol(): Promise<void> {
  try {
    await this.connectGrpc();
    this.activeProtocol = ProtocolType.GRPC;
  } catch (grpcError) {
    this.emit('grpc_fallback', { reason: grpcError.message });

    if (this.options.sseFallback && isSSEAvailable()) {
      await this.connectSSE();
      this.activeProtocol = ProtocolType.SSE;
    } else {
      throw grpcError;
    }
  }
}
```

### 4.2 StreamPool Manager

Manages multiple bidirectional streams for high-throughput scenarios.

```typescript
/**
 * StreamPool - Manages a pool of bidirectional streams
 *
 * Features:
 * - Automatic stream creation and cleanup
 * - Idle stream expiration
 * - Load distribution across streams
 * - Backpressure coordination
 */

// Configuration
interface StreamPoolConfig {
  maxConcurrentStreams: number;   // Default: 10
  streamIdleTimeout: number;       // Default: 300000 (5 minutes)
  enableStreamReuse: boolean;      // Default: true
  streamReuseTimeout: number;      // Default: 60000 (1 minute)
}

// Stream pool operations
createStreamPool(count: number, callbacks: StreamLifecycleCallbacks): BidirectionalStreamHandle[];
cleanupIdleStreams(): void;
updateStreamMonitoringStats(): void;
```

#### 4.2.1 Stream Reuse Strategy

```
+-------------------+
| Request arrives   |
+--------+----------+
         |
         v
+-------------------+
| Check active      |
| streams count     |
+--------+----------+
         |
    +----+----+
    | < max?  |
    +----+----+
    Yes  |  No
         |   +---> Find least busy stream
         |         or queue request
         v
+-------------------+
| Check for idle    |
| reusable stream   |
+--------+----------+
         |
    +----+----+
    | Found?  |
    +----+----+
    Yes  |  No
         |   +---> Create new stream
         v
+-------------------+
| Reuse existing    |
| stream            |
+-------------------+
```

### 4.3 HealthMonitor

Monitors server health and manages automatic failover.

```typescript
/**
 * HealthMonitor - Continuous health monitoring with failover support
 *
 * Events emitted:
 * - 'started' - Monitoring started
 * - 'stopped' - Monitoring stopped
 * - 'health_check' - Health check completed
 * - 'status_change' - Health status changed
 * - 'failover_started' - Failover process started
 * - 'failover_completed' - Successfully failed over
 * - 'failover_failed' - Failover attempt failed
 * - 'failback_scheduled' - Failback scheduled
 * - 'failback_completed' - Successfully failed back
 */
export class HealthMonitor extends EventEmitter {
  // Configuration
  private readonly config: HealthCheckConfig;
  private readonly failoverConfig: FailoverConfig;
  private readonly healthCheckFn: () => Promise<HealthCheckResult>;
  private readonly addressChangeCallback?: (address: string) => Promise<void>;

  // State
  private health: ConnectionHealth;
  private currentAddressIndex: number;
  private originalAddressIndex: number;
  private isMonitoring: boolean;

  // Timers
  private healthCheckTimer: NodeJS.Timeout | null;
  private failbackTimer: NodeJS.Timeout | null;

  // Public API
  start(): void;
  stop(): void;
  async checkNow(): Promise<HealthCheckResult>;
  getHealth(): ConnectionHealth;
  getCurrentAddress(): string | undefined;
  setConnectionState(state: ConnectionState): void;
  subscribeToHealthStream(callbacks: HealthStreamCallbacks): () => void;
  isHealthy(): boolean;
  reset(): void;
}
```

#### 4.3.1 Health Check Algorithm

```typescript
/**
 * Health determination algorithm:
 *
 * 1. Perform health check (with timeout)
 * 2. Update history buffer (keep last 10 results)
 * 3. Update consecutive counters:
 *    - Success: consecutiveSuccesses++, consecutiveFailures = 0
 *    - Failure: consecutiveFailures++, consecutiveSuccesses = 0
 * 4. Determine new status:
 *    - If consecutiveSuccesses >= healthyThreshold: SERVING
 *    - If consecutiveFailures >= unhealthyThreshold: NOT_SERVING
 *    - Otherwise: keep current status (hysteresis)
 * 5. If status changed to NOT_SERVING and failover enabled:
 *    - Trigger failover to next address
 * 6. If status changed to SERVING and on failover address:
 *    - Schedule failback to primary after delay
 */
private async performHealthCheck(): Promise<void> {
  const startTime = Date.now();

  try {
    const result = await Promise.race([
      this.healthCheckFn(),
      this.createTimeout(),
    ]);
    this.handleHealthCheckResult(result);
  } catch (error) {
    const result: HealthCheckResult = {
      status: HealthStatus.NOT_SERVING,
      timestamp: Date.now(),
      latencyMs: Date.now() - startTime,
      error: error.message,
    };
    this.handleHealthCheckResult(result);
  }
}
```

### 4.4 BackpressureController

Manages flow control for bidirectional streams.

```typescript
/**
 * BackpressureController - Flow control for streaming
 *
 * Watermark-based backpressure:
 * - highWaterMark: Pause sending when buffer exceeds this
 * - lowWaterMark: Resume sending when buffer drops below this
 * - maxBufferSize: Drop messages when buffer exceeds this
 *
 * Backpressure signals:
 * - stream.write() returns false: TCP buffer full
 * - 'drain' event: TCP buffer has space
 * - Internal buffer tracking for application-level control
 */

interface BackpressureConfig {
  highWaterMark: number;   // Default: 100 messages
  lowWaterMark: number;    // Default: 50 messages
  maxBufferSize: number;   // Default: 1000 messages
}

// Backpressure state machine
enum BackpressureState {
  FLOWING,      // Normal operation, can send
  PAUSED,       // Buffer high, waiting for drain
  DROPPING,     // Buffer full, dropping messages
}
```

#### 4.4.1 Backpressure Flow

```
+-------------------+
| send(request)     |
+--------+----------+
         |
         v
+-------------------+
| Check buffer size |
| vs maxBufferSize  |
+--------+----------+
         |
    +----+----+
    | Full?   |
    +----+----+
    Yes  |  No
         |   +---> messagesDropped++; return false
         v
+-------------------+
| Check if paused   |
| or backpressured  |
+--------+----------+
         |
    +----+----+
    | Paused? |
    +----+----+
    Yes  |  No
         |   +---> Queue message
         v       | Check highWaterMark
+-------------------+
| writeToStream()   |
| - serialize proto |
| - track pending   |
+--------+----------+
         |
         | stream.write() returns
         v
    +----+----+
    | false?  | (TCP buffer full)
    +----+----+
    Yes  |  No
         |   +---> Continue normally
         v
+-------------------+
| isBackpressured   |
| = true            |
| emit('backpressure'|
| , true)           |
+-------------------+
         |
         | Wait for 'drain' event
         v
+-------------------+
| handleDrain()     |
| - isBackpressured |
|   = false         |
| - flushQueue()    |
+-------------------+
```

### 4.5 ConnectionManager (ConnectionPool)

Manages a pool of gRPC connections with load balancing.

```typescript
/**
 * ConnectionPool - Connection pooling with load balancing
 *
 * Features:
 * - Multiple load balancing strategies
 * - Automatic reconnection with exponential backoff
 * - Health checks per connection
 * - Idle connection cleanup
 * - Dynamic scaling
 */
export class ConnectionPool extends EventEmitter {
  // Configuration
  private readonly options: ConnectionPoolOptions;
  private readonly reconnectConfig: ReconnectConfig;
  private readonly addresses: string[];
  private readonly connectionFactory: ConnectionFactory;
  private readonly connectionCloser: ConnectionCloser;

  // Connection management
  private connections: Map<string, InternalConnection>;
  private roundRobinIndex: number;

  // Timers
  private healthCheckTimer: NodeJS.Timeout | null;
  private idleCheckTimer: NodeJS.Timeout | null;

  // Statistics
  private stats: ConnectionPoolStats;

  // Public API
  async initialize(): Promise<void>;
  async acquire(): Promise<{ client: unknown; release: () => void }>;
  async scale(targetSize: number): Promise<void>;
  async shutdown(): Promise<void>;
  getStats(): ConnectionPoolStats;
  getConnections(): PooledConnection[];
  setConnectionWeight(connectionId: string, weight: number): void;
}
```

#### 4.5.1 Connection Acquisition Flow

```
+-------------------+
| acquire()         |
+--------+----------+
         |
         v
+-------------------+
| Get ready         |
| connections       |
+--------+----------+
         |
    +----+----+
    | Any?    |
    +----+----+
    No   |  Yes
         |   +---> Select by strategy
         v        (round-robin/least-conn/etc)
+-------------------+
| Current size      |
| < maxConnections? |
+--------+----------+
         |
    +----+----+
    | Yes?    |
    +----+----+
    No   |  Yes
         |   +---> Create new connection
         v        Retry acquire()
+-------------------+
| Wait for          |
| available         |
| connection        |
| (with timeout)    |
+--------+----------+
         |
         | Timeout or connection available
         v
+-------------------+
| Return {          |
|   client,         |
|   release: () =>  |
| }                 |
+-------------------+
```

---

## 5. Interfaces

### 5.1 Core Configuration Interfaces

```typescript
/**
 * GrpcClientConfig - Complete client configuration
 */
export interface GrpcClientConfig {
  /** gRPC server address (host:port) */
  address: string;

  /** Connection timeout in milliseconds */
  timeout?: number;  // Default: 5000

  /** Enable TLS */
  tls?: boolean;  // Default: false

  /** TLS certificate path */
  certPath?: string;

  /** TLS key path */
  keyPath?: string;

  /** CA certificate path */
  caPath?: string;

  /** Keep-alive interval in milliseconds */
  keepAliveInterval?: number;  // Default: 30000

  /** Maximum retry attempts */
  maxRetries?: number;  // Default: 3

  /** Retry delay in milliseconds */
  retryDelay?: number;  // Default: 1000

  /** Protocol selection */
  protocol?: ProtocolType;  // Default: GRPC

  /** Connection pool options */
  connectionPool?: Partial<ConnectionPoolOptions>;

  /** Backpressure configuration */
  backpressure?: Partial<BackpressureConfig>;

  /** SSE fallback options */
  sseFallback?: SSEClientOptions;

  /** OpenTelemetry configuration */
  otel?: Partial<OTelConfig>;

  /** Metrics configuration */
  metrics?: Partial<MetricsConfig>;

  /** Health check configuration */
  healthCheck?: Partial<HealthCheckConfig>;

  /** Reconnection configuration */
  reconnect?: Partial<ReconnectConfig>;

  /** Failover configuration */
  failover?: Partial<FailoverConfig>;
}

/**
 * ConnectionPoolOptions - Pool configuration
 */
export interface ConnectionPoolOptions {
  /** Minimum connections to maintain */
  minConnections: number;  // Default: 1

  /** Maximum connections allowed */
  maxConnections: number;  // Default: 10

  /** Connection idle timeout in milliseconds */
  idleTimeout: number;  // Default: 60000

  /** Load balancing strategy */
  loadBalancingStrategy: LoadBalancingStrategy;  // Default: ROUND_ROBIN

  /** Health check interval in milliseconds */
  healthCheckInterval: number;  // Default: 30000

  /** Connection acquisition timeout */
  acquireTimeout: number;  // Default: 5000
}

/**
 * BackpressureConfig - Stream flow control
 */
export interface BackpressureConfig {
  /** High watermark - pause sending when buffer exceeds this */
  highWaterMark: number;  // Default: 100

  /** Low watermark - resume sending when buffer drops below this */
  lowWaterMark: number;  // Default: 50

  /** Maximum buffer size before dropping messages */
  maxBufferSize: number;  // Default: 1000
}

/**
 * HealthCheckConfig - Health monitoring settings
 */
export interface HealthCheckConfig {
  /** Enable health checks */
  enabled: boolean;  // Default: true

  /** Check interval in milliseconds */
  interval: number;  // Default: 30000

  /** Timeout for health check */
  timeout: number;  // Default: 5000

  /** Number of failures before marking unhealthy */
  unhealthyThreshold: number;  // Default: 3

  /** Number of successes before marking healthy */
  healthyThreshold: number;  // Default: 2

  /** Service name to check */
  serviceName?: string;
}

/**
 * FailoverConfig - Automatic failover settings
 */
export interface FailoverConfig {
  /** Enable automatic failover */
  enabled: boolean;  // Default: false

  /** Addresses to failover to */
  fallbackAddresses: string[];

  /** Current primary index */
  primaryIndex: number;  // Default: 0

  /** Failover threshold (failures before failover) */
  failoverThreshold: number;  // Default: 3

  /** Failback delay in milliseconds */
  failbackDelay: number;  // Default: 60000
}

/**
 * ReconnectConfig - Reconnection with exponential backoff
 */
export interface ReconnectConfig {
  /** Initial delay in milliseconds */
  initialDelay: number;  // Default: 1000

  /** Maximum delay in milliseconds */
  maxDelay: number;  // Default: 30000

  /** Backoff multiplier */
  multiplier: number;  // Default: 2

  /** Add jitter to delays */
  jitter: boolean;  // Default: true

  /** Maximum reconnection attempts */
  maxAttempts: number;  // Default: 10
}
```

### 5.2 Stream Interfaces

```typescript
/**
 * StreamHandle - Basic stream handle (legacy API)
 */
export interface StreamHandle {
  /** Send a request through the stream */
  send: (request: CheckRequest) => void;

  /** End the stream gracefully */
  end: () => void;
}

/**
 * BidirectionalStreamHandle - Advanced stream handle with backpressure
 */
export interface BidirectionalStreamHandle {
  /** Send a request through the stream (returns false if dropped) */
  send: (request: CheckRequest) => boolean;

  /** End the stream gracefully */
  end: () => void;

  /** Check if stream is writable (not backpressured) */
  isWritable: () => boolean;

  /** Get stream statistics */
  getStats: () => StreamStats;

  /** Pause receiving messages */
  pause: () => void;

  /** Resume receiving messages */
  resume: () => void;

  /** Get unique stream ID */
  getId: () => string;
}

/**
 * StreamLifecycleCallbacks - Callbacks for stream events
 */
export interface StreamLifecycleCallbacks {
  /** Called when a response is received */
  onResponse: (response: CheckResponse) => void;

  /** Called when an error occurs */
  onError: (error: Error) => void;

  /** Called when the stream ends */
  onEnd: () => void;

  /** Called when backpressure state changes */
  onBackpressure?: (paused: boolean) => void;

  /** Called on reconnection attempts */
  onReconnect?: (attempt: number) => void;
}

/**
 * StreamStats - Stream statistics
 */
export interface StreamStats {
  /** Messages sent */
  messagesSent: number;

  /** Messages received */
  messagesReceived: number;

  /** Messages dropped due to backpressure */
  messagesDropped: number;

  /** Current buffer size */
  bufferSize: number;

  /** Stream uptime in milliseconds */
  uptimeMs: number;

  /** Average latency for responses */
  avgLatencyMs: number;
}

/**
 * StreamPoolConfig - Stream pool configuration
 */
export interface StreamPoolConfig {
  /** Maximum concurrent streams */
  maxConcurrentStreams: number;  // Default: 10

  /** Maximum idle time for streams in milliseconds */
  streamIdleTimeout: number;  // Default: 300000

  /** Enable automatic stream reuse */
  enableStreamReuse: boolean;  // Default: true

  /** Stream reuse timeout in milliseconds */
  streamReuseTimeout: number;  // Default: 60000
}

/**
 * AdvancedStreamOptions - Advanced streaming options
 */
export interface AdvancedStreamOptions {
  /** Enable stream multiplexing */
  multiplexing: boolean;  // Default: true

  /** Maximum requests per stream before rotation */
  maxRequestsPerStream: number;  // Default: 1000

  /** Enable request deduplication */
  deduplication: boolean;  // Default: false

  /** Deduplication cache size */
  deduplicationCacheSize: number;  // Default: 100

  /** Enable response ordering guarantees */
  ensureOrdering: boolean;  // Default: true
}
```

### 5.3 Health Interfaces

```typescript
/**
 * HealthStatus - Server health status
 */
export enum HealthStatus {
  UNKNOWN = 'unknown',
  SERVING = 'serving',
  NOT_SERVING = 'not_serving',
  SERVICE_UNKNOWN = 'service_unknown',
}

/**
 * HealthCheckResult - Single health check result
 */
export interface HealthCheckResult {
  /** Health status */
  status: HealthStatus;

  /** Timestamp of check */
  timestamp: number;

  /** Response latency in milliseconds */
  latencyMs: number;

  /** Error message if unhealthy */
  error?: string;

  /** Additional details */
  details?: Record<string, unknown>;
}

/**
 * ConnectionHealth - Overall connection health summary
 */
export interface ConnectionHealth {
  /** Overall health status */
  status: HealthStatus;

  /** Connection state */
  connectionState: ConnectionState;

  /** Last successful check timestamp */
  lastSuccessfulCheck?: number;

  /** Consecutive failures */
  consecutiveFailures: number;

  /** Consecutive successes */
  consecutiveSuccesses: number;

  /** Health history (last N results) */
  history: HealthCheckResult[];
}

/**
 * HealthStreamCallbacks - Callbacks for health stream subscription
 */
export interface HealthStreamCallbacks {
  /** Called on health status change */
  onStatusChange: (status: HealthStatus, previous: HealthStatus) => void;

  /** Called on health check result */
  onHealthCheck: (result: HealthCheckResult) => void;

  /** Called on health check error */
  onError: (error: Error) => void;
}
```

### 5.4 Pool Interfaces

```typescript
/**
 * PooledConnection - Connection in the pool
 */
export interface PooledConnection {
  /** Connection identifier */
  id: string;

  /** Connection state */
  state: ConnectionState;

  /** Active request count */
  activeRequests: number;

  /** Connection weight for weighted load balancing */
  weight: number;

  /** Last used timestamp */
  lastUsed: number;

  /** Creation timestamp */
  createdAt: number;

  /** Health check failures */
  healthCheckFailures: number;
}

/**
 * ConnectionPoolStats - Pool statistics
 */
export interface ConnectionPoolStats {
  /** Total connections in pool */
  totalConnections: number;

  /** Active connections */
  activeConnections: number;

  /** Idle connections */
  idleConnections: number;

  /** Failed connections */
  failedConnections: number;

  /** Total requests processed */
  totalRequests: number;

  /** Average wait time for connection acquisition */
  avgAcquireTimeMs: number;
}

/**
 * PoolMetrics - Detailed pool metrics for monitoring
 */
export interface PoolMetrics extends ConnectionPoolStats {
  /** Connections per address */
  connectionsByAddress: Map<string, number>;

  /** Current load balancing strategy */
  loadBalancingStrategy: LoadBalancingStrategy;

  /** Connection creation success rate */
  connectionSuccessRate: number;

  /** Average connection lifetime */
  avgConnectionLifetimeMs: number;

  /** Peak concurrent connections */
  peakConcurrentConnections: number;
}
```

### 5.5 Observability Interfaces

```typescript
/**
 * OTelConfig - OpenTelemetry configuration
 */
export interface OTelConfig {
  /** Enable tracing */
  tracingEnabled: boolean;  // Default: false

  /** Enable metrics */
  metricsEnabled: boolean;  // Default: false

  /** Service name for traces */
  serviceName: string;  // Default: 'authz-client'

  /** Trace sample rate (0-1) */
  sampleRate: number;  // Default: 1.0

  /** Custom span attributes */
  spanAttributes?: Record<string, string>;

  /** Propagation format */
  propagationFormat?: 'w3c' | 'b3' | 'jaeger';  // Default: 'w3c'
}

/**
 * TraceContext - Distributed tracing context
 */
export interface TraceContext {
  /** Trace ID */
  traceId: string;

  /** Span ID */
  spanId: string;

  /** Parent span ID */
  parentSpanId?: string;

  /** Trace flags */
  traceFlags: number;

  /** Trace state */
  traceState?: string;
}

/**
 * AuthzSpanAttributes - Span attributes for authorization checks
 */
export interface AuthzSpanAttributes {
  'authz.request_id': string;
  'authz.principal_id': string;
  'authz.resource_kind': string;
  'authz.resource_id': string;
  'authz.actions': string;
  'authz.effect'?: string;
  'authz.cache_hit'?: boolean;
  'authz.evaluation_duration_us'?: number;
}

/**
 * PrometheusMetrics - Prometheus metrics format
 */
export interface PrometheusMetrics {
  /** Request counter */
  requestsTotal: number;

  /** Request latency histogram buckets */
  requestLatencySeconds: Record<string, number>;

  /** Active connections gauge */
  activeConnections: number;

  /** Error counter by type */
  errorsTotal: Record<string, number>;

  /** Cache hit ratio */
  cacheHitRatio: number;
}

/**
 * StreamMonitoringMetrics - Stream monitoring metrics
 */
export interface StreamMonitoringMetrics {
  /** Active streams */
  activeStreams: number;

  /** Total messages sent across all streams */
  totalMessagesSent: number;

  /** Total messages received across all streams */
  totalMessagesReceived: number;

  /** Average latency per message */
  avgLatencyMs: number;

  /** Peak buffer size across all streams */
  peakBufferSize: number;

  /** Total backpressure events */
  backpressureEvents: number;
}
```

### 5.6 Client Events

```typescript
/**
 * Client events emitted by AuthzClient
 */
interface AuthzClientEvents {
  // Connection events
  'connected': () => void;
  'disconnected': () => void;
  'connection_state_change': (info: { state: ConnectionState; previous: ConnectionState }) => void;

  // Protocol events
  'grpc_fallback': (info: { reason: string }) => void;

  // SSE events
  'sse_response': (response: CheckResponse) => void;
  'sse_error': (error: Error) => void;
  'sse_disconnected': () => void;
  'sse_reconnecting': (attempt: number) => void;

  // Pool events
  'pool_connection_created': (info: { id: string; address: string }) => void;
  'pool_connection_failed': (info: { id: string; address: string; error: Error }) => void;
  'pool_reconnected': (info: { id: string; address: string }) => void;
  'pool_connection_removed': (info: { id: string; reason: string }) => void;

  // Health events
  'health_status_change': (info: { status: HealthStatus; previous: HealthStatus }) => void;
  'failover_started': (info: { from: string; to: string }) => void;
  'failover_completed': (info: { address: string }) => void;
  'failover_failed': (info: { address: string; error: Error }) => void;
  'failback_completed': (info: { address: string }) => void;
  'health_stream_check': (result: HealthCheckResult) => void;
  'health_stream_error': (error: Error) => void;

  // Stream events
  'stream_pool_creation_error': (info: { index: number; error: Error }) => void;
}
```

---

## 6. Data Models

### 6.1 Protobuf Definitions

The gRPC client communicates using Protocol Buffers. Below are the key message definitions:

```protobuf
syntax = "proto3";

package authz.v1;

import "google/protobuf/struct.proto";

// AuthzService provides high-performance authorization checking
service AuthzService {
  // Check performs a single authorization check
  rpc Check(CheckRequest) returns (CheckResponse);

  // CheckBatch performs multiple authorization checks in parallel
  rpc CheckBatch(CheckBatchRequest) returns (CheckBatchResponse);

  // CheckStream provides bidirectional streaming for high-throughput scenarios
  rpc CheckStream(stream CheckRequest) returns (stream CheckResponse);

  // LoadPolicies loads policies from a source
  rpc LoadPolicies(LoadPoliciesRequest) returns (LoadPoliciesResponse);

  // ReloadPolicies triggers a policy reload
  rpc ReloadPolicies(ReloadPoliciesRequest) returns (ReloadPoliciesResponse);
}

// CheckRequest represents an authorization check request
message CheckRequest {
  // Unique request identifier
  string request_id = 1;

  // The principal (user/service) requesting access
  Principal principal = 2;

  // The resource being accessed
  Resource resource = 3;

  // Actions being requested (e.g., "read", "write", "delete")
  repeated string actions = 4;

  // Additional context for policy evaluation
  google.protobuf.Struct context = 5;

  // Include detailed metadata in response
  bool include_metadata = 6;
}

// Principal represents the entity requesting access
message Principal {
  // Unique identifier (e.g., user ID, service account)
  string id = 1;

  // Roles assigned to the principal
  repeated string roles = 2;

  // Additional attributes for ABAC
  google.protobuf.Struct attributes = 3;
}

// Resource represents the resource being accessed
message Resource {
  // Resource type/kind (e.g., "document", "avatar", "payout")
  string kind = 1;

  // Unique resource identifier
  string id = 2;

  // Resource attributes for ABAC
  google.protobuf.Struct attributes = 3;
}

// CheckResponse contains the authorization decision
message CheckResponse {
  // Echoed request ID
  string request_id = 1;

  // Results per action
  map<string, ActionResult> results = 2;

  // Evaluation metadata (if requested)
  ResponseMetadata metadata = 3;
}

// ActionResult contains the decision for a single action
message ActionResult {
  // The authorization effect
  Effect effect = 1;

  // Name of the policy that matched
  string policy = 2;

  // Name of the rule within the policy
  string rule = 3;

  // Whether a matching rule was found
  bool matched = 4;

  // Additional metadata about the decision
  map<string, string> meta = 5;
}

// Effect represents the authorization decision
enum Effect {
  EFFECT_UNSPECIFIED = 0;
  EFFECT_ALLOW = 1;
  EFFECT_DENY = 2;
}

// ResponseMetadata contains evaluation details
message ResponseMetadata {
  // Time taken to evaluate (microseconds)
  double evaluation_duration_us = 1;

  // Number of policies evaluated
  int32 policies_evaluated = 2;

  // Names of policies that matched
  repeated string matched_policies = 3;

  // Cache hit or miss
  bool cache_hit = 4;
}

// CheckBatchRequest contains multiple check requests
message CheckBatchRequest {
  repeated CheckRequest requests = 1;
}

// CheckBatchResponse contains multiple check responses
message CheckBatchResponse {
  repeated CheckResponse responses = 1;

  // Total batch processing time (microseconds)
  double total_duration_us = 2;
}
```

### 6.2 TypeScript Type Mappings

```typescript
// Proto to TypeScript mapping

// Effect enum
enum Effect {
  UNSPECIFIED = 0,  // EFFECT_UNSPECIFIED
  ALLOW = 1,        // EFFECT_ALLOW
  DENY = 2,         // EFFECT_DENY
}

// Principal message
interface Principal {
  id: string;                          // principal.id
  type?: string;                       // Extension, not in proto
  roles: string[];                     // principal.roles
  attributes?: Record<string, unknown>; // principal.attributes (Struct)
}

// Resource message
interface Resource {
  kind: string;                        // resource.kind
  id: string;                          // resource.id
  attributes?: Record<string, unknown>; // resource.attributes (Struct)
}

// CheckRequest message
interface CheckRequest {
  requestId: string;                   // request_id
  principal: Principal;                // principal
  resource: Resource;                  // resource
  actions: string[];                   // actions
  context?: Record<string, unknown>;   // context (Struct)
}

// ActionResult message
interface ActionResult {
  effect: Effect;                      // effect
  policy?: string;                     // policy
  rule?: string;                       // rule
  matched: boolean;                    // matched
}

// ResponseMetadata message
interface ResponseMetadata {
  evaluationDurationUs: number;        // evaluation_duration_us
  policiesEvaluated: number;           // policies_evaluated
  cacheHit: boolean;                   // cache_hit
}

// CheckResponse message
interface CheckResponse {
  requestId: string;                   // request_id
  results: Map<string, ActionResult>;  // results (map)
  metadata?: ResponseMetadata;         // metadata
  error?: string;                      // Extension for error handling
}
```

### 6.3 Proto Conversion Functions

```typescript
/**
 * Convert TypeScript request to protobuf format
 */
function convertRequestToProto(request: CheckRequest): object {
  return {
    request_id: request.requestId,
    principal: {
      id: request.principal.id,
      type: request.principal.type ?? '',
      roles: request.principal.roles,
      attributes: request.principal.attributes
        ? convertToStruct(request.principal.attributes)
        : null,
    },
    resource: {
      kind: request.resource.kind,
      id: request.resource.id,
      attributes: request.resource.attributes
        ? convertToStruct(request.resource.attributes)
        : null,
    },
    actions: request.actions,
    context: request.context ? convertToStruct(request.context) : null,
  };
}

/**
 * Convert protobuf response to TypeScript format
 */
function convertResponseFromProto(proto: unknown): CheckResponse {
  const protoAny = proto as {
    request_id?: string;
    results?: Record<string, { effect?: string | number; policy?: string; rule?: string; matched?: boolean }>;
    metadata?: {
      evaluation_duration_us?: number;
      policies_evaluated?: number;
      cache_hit?: boolean;
    };
    error?: string;
  };

  const results = new Map<string, ActionResult>();
  if (protoAny.results) {
    for (const [action, result] of Object.entries(protoAny.results)) {
      results.set(action, {
        effect: convertEffect(result.effect),
        policy: result.policy,
        rule: result.rule,
        matched: result.matched ?? false,
      });
    }
  }

  return {
    requestId: protoAny.request_id ?? '',
    results,
    metadata: protoAny.metadata ? {
      evaluationDurationUs: protoAny.metadata.evaluation_duration_us ?? 0,
      policiesEvaluated: protoAny.metadata.policies_evaluated ?? 0,
      cacheHit: protoAny.metadata.cache_hit ?? false,
    } : undefined,
    error: protoAny.error,
  };
}

/**
 * Convert JavaScript object to protobuf Struct
 */
function convertToStruct(obj: Record<string, unknown>): object {
  const fields: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    fields[key] = convertValue(value);
  }

  return { fields };
}

/**
 * Convert a JavaScript value to protobuf Value
 */
function convertValue(value: unknown): object {
  if (value === null || value === undefined) {
    return { null_value: 0 };
  }
  if (typeof value === 'boolean') {
    return { bool_value: value };
  }
  if (typeof value === 'number') {
    return { number_value: value };
  }
  if (typeof value === 'string') {
    return { string_value: value };
  }
  if (Array.isArray(value)) {
    return {
      list_value: {
        values: value.map((v) => convertValue(v)),
      },
    };
  }
  if (typeof value === 'object') {
    return {
      struct_value: convertToStruct(value as Record<string, unknown>),
    };
  }
  return { null_value: 0 };
}
```

---

## 7. Error Handling

### 7.1 gRPC Status Codes

| Code | Name | Description | Client Handling |
|------|------|-------------|-----------------|
| 0 | OK | Success | Return response |
| 1 | CANCELLED | Request cancelled | Retry if idempotent |
| 2 | UNKNOWN | Unknown error | Log and retry |
| 3 | INVALID_ARGUMENT | Bad request | Throw validation error |
| 4 | DEADLINE_EXCEEDED | Timeout | Retry with backoff |
| 5 | NOT_FOUND | Resource not found | Return null/empty |
| 6 | ALREADY_EXISTS | Resource exists | Handle as success |
| 7 | PERMISSION_DENIED | Access denied | Throw auth error |
| 8 | RESOURCE_EXHAUSTED | Rate limited | Retry with longer backoff |
| 9 | FAILED_PRECONDITION | Precondition failed | Throw error |
| 10 | ABORTED | Operation aborted | Retry |
| 11 | OUT_OF_RANGE | Invalid range | Throw validation error |
| 12 | UNIMPLEMENTED | Not implemented | Throw error |
| 13 | INTERNAL | Server error | Retry with backoff |
| 14 | UNAVAILABLE | Server unavailable | Retry with backoff, trigger failover |
| 15 | DATA_LOSS | Data loss | Log critical, throw error |
| 16 | UNAUTHENTICATED | Auth required | Refresh credentials, retry |

### 7.2 Error Types

```typescript
/**
 * Base error class for gRPC client errors
 */
export class AuthzClientError extends Error {
  readonly code: string;
  readonly grpcCode?: number;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    options?: {
      grpcCode?: number;
      retryable?: boolean;
      details?: Record<string, unknown>;
      cause?: Error;
    }
  ) {
    super(message);
    this.name = 'AuthzClientError';
    this.code = code;
    this.grpcCode = options?.grpcCode;
    this.retryable = options?.retryable ?? false;
    this.details = options?.details;
    this.cause = options?.cause;
  }
}

/**
 * Connection-related errors
 */
export class ConnectionError extends AuthzClientError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONNECTION_ERROR', { retryable: true, details });
    this.name = 'ConnectionError';
  }
}

/**
 * Timeout errors
 */
export class TimeoutError extends AuthzClientError {
  readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number) {
    super(message, 'TIMEOUT_ERROR', { retryable: true, details: { timeoutMs } });
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Backpressure errors
 */
export class BackpressureError extends AuthzClientError {
  readonly bufferSize: number;

  constructor(bufferSize: number) {
    super(
      `Message dropped due to backpressure (buffer size: ${bufferSize})`,
      'BACKPRESSURE_ERROR',
      { retryable: true, details: { bufferSize } }
    );
    this.name = 'BackpressureError';
    this.bufferSize = bufferSize;
  }
}

/**
 * Pool exhausted errors
 */
export class PoolExhaustedError extends AuthzClientError {
  constructor(poolSize: number, waitTime: number) {
    super(
      `Connection pool exhausted (size: ${poolSize}, waited: ${waitTime}ms)`,
      'POOL_EXHAUSTED_ERROR',
      { retryable: true, details: { poolSize, waitTime } }
    );
    this.name = 'PoolExhaustedError';
  }
}

/**
 * Health check errors
 */
export class HealthCheckError extends AuthzClientError {
  readonly address: string;
  readonly consecutiveFailures: number;

  constructor(address: string, consecutiveFailures: number, cause?: Error) {
    super(
      `Health check failed for ${address} (${consecutiveFailures} consecutive failures)`,
      'HEALTH_CHECK_ERROR',
      { retryable: false, details: { address, consecutiveFailures }, cause }
    );
    this.name = 'HealthCheckError';
    this.address = address;
    this.consecutiveFailures = consecutiveFailures;
  }
}

/**
 * Failover errors
 */
export class FailoverError extends AuthzClientError {
  readonly fromAddress: string;
  readonly toAddress: string;

  constructor(fromAddress: string, toAddress: string, cause?: Error) {
    super(
      `Failover from ${fromAddress} to ${toAddress} failed`,
      'FAILOVER_ERROR',
      { retryable: true, details: { fromAddress, toAddress }, cause }
    );
    this.name = 'FailoverError';
    this.fromAddress = fromAddress;
    this.toAddress = toAddress;
  }
}
```

### 7.3 Retry Strategies

```typescript
/**
 * Retry configuration
 */
interface RetryConfig {
  /** Maximum retry attempts */
  maxAttempts: number;

  /** Initial delay in milliseconds */
  initialDelay: number;

  /** Maximum delay in milliseconds */
  maxDelay: number;

  /** Backoff multiplier */
  multiplier: number;

  /** Add jitter to delays */
  jitter: boolean;

  /** Retryable gRPC codes */
  retryableCodes: number[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  multiplier: 2,
  jitter: true,
  retryableCodes: [
    1,  // CANCELLED
    4,  // DEADLINE_EXCEEDED
    8,  // RESOURCE_EXHAUSTED
    10, // ABORTED
    13, // INTERNAL
    14, // UNAVAILABLE
  ],
};

/**
 * Calculate backoff delay with jitter
 */
function calculateBackoffDelay(
  attempt: number,
  config: RetryConfig
): number {
  let delay = Math.min(
    config.initialDelay * Math.pow(config.multiplier, attempt - 1),
    config.maxDelay
  );

  if (config.jitter) {
    // Add 0-30% jitter
    delay = delay * (1 + Math.random() * 0.3);
  }

  return Math.floor(delay);
}

/**
 * Determine if error is retryable
 */
function isRetryable(error: Error, config: RetryConfig): boolean {
  if (error instanceof AuthzClientError) {
    return error.retryable;
  }

  // Check gRPC error code
  const grpcError = error as { code?: number };
  if (grpcError.code !== undefined) {
    return config.retryableCodes.includes(grpcError.code);
  }

  // Default: retry network errors
  return error.message.includes('ECONNREFUSED') ||
         error.message.includes('ENOTFOUND') ||
         error.message.includes('ETIMEDOUT');
}
```

### 7.4 Circuit Breaker

```typescript
/**
 * Circuit breaker states
 */
enum CircuitState {
  CLOSED,      // Normal operation
  OPEN,        // Failing, reject requests
  HALF_OPEN,   // Testing if recovered
}

/**
 * Circuit breaker configuration
 */
interface CircuitBreakerConfig {
  /** Failure threshold to open circuit */
  failureThreshold: number;  // Default: 5

  /** Success threshold to close circuit */
  successThreshold: number;  // Default: 3

  /** Time to wait before testing (ms) */
  resetTimeout: number;  // Default: 30000

  /** Time window for failure counting (ms) */
  monitorWindow: number;  // Default: 60000
}

/**
 * Circuit breaker implementation
 */
class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number[] = [];
  private successes: number = 0;
  private lastFailureTime: number = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: 5,
      successThreshold: 3,
      resetTimeout: 30000,
      monitorWindow: 60000,
      ...config,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime > this.config.resetTimeout) {
        this.state = CircuitState.HALF_OPEN;
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.failures = [];
        this.successes = 0;
      }
    }
  }

  private onFailure(): void {
    this.lastFailureTime = Date.now();
    this.successes = 0;

    // Remove old failures outside the window
    const windowStart = Date.now() - this.config.monitorWindow;
    this.failures = this.failures.filter(t => t > windowStart);
    this.failures.push(Date.now());

    if (this.failures.length >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}
```

---

## 8. Security Considerations

### 8.1 mTLS Support

```typescript
/**
 * TLS configuration for secure connections
 */
interface TLSConfig {
  /** Enable TLS */
  enabled: boolean;

  /** Client certificate path (for mTLS) */
  certPath?: string;

  /** Client private key path (for mTLS) */
  keyPath?: string;

  /** CA certificate path for server verification */
  caPath?: string;

  /** Server name for TLS verification */
  serverName?: string;

  /** Skip server certificate verification (NOT recommended for production) */
  insecureSkipVerify?: boolean;
}

/**
 * Create TLS credentials
 */
function createTlsCredentials(config: TLSConfig): grpc.ChannelCredentials {
  if (!config.enabled) {
    return grpc.credentials.createInsecure();
  }

  // Read certificates
  const rootCert = config.caPath
    ? fs.readFileSync(config.caPath)
    : undefined;

  const clientCert = config.certPath
    ? fs.readFileSync(config.certPath)
    : undefined;

  const clientKey = config.keyPath
    ? fs.readFileSync(config.keyPath)
    : undefined;

  // Create SSL credentials
  return grpc.credentials.createSsl(
    rootCert,
    clientKey,
    clientCert,
    {
      checkServerIdentity: config.insecureSkipVerify
        ? () => undefined
        : undefined, // Use default verification
    }
  );
}
```

### 8.2 Certificate Rotation

```typescript
/**
 * Certificate rotation support
 *
 * The client supports automatic certificate rotation by:
 * 1. Watching certificate files for changes
 * 2. Reconnecting with new certificates when files change
 * 3. Gracefully draining existing connections
 */

interface CertRotationConfig {
  /** Enable automatic certificate rotation */
  enabled: boolean;

  /** Watch interval in milliseconds */
  watchInterval: number;  // Default: 60000

  /** Grace period for draining connections */
  drainTimeout: number;  // Default: 30000
}

class CertificateWatcher {
  private readonly config: CertRotationConfig;
  private readonly tlsConfig: TLSConfig;
  private readonly onRotation: () => Promise<void>;
  private lastMtime: Map<string, number> = new Map();
  private watchTimer: NodeJS.Timeout | null = null;

  constructor(
    config: CertRotationConfig,
    tlsConfig: TLSConfig,
    onRotation: () => Promise<void>
  ) {
    this.config = config;
    this.tlsConfig = tlsConfig;
    this.onRotation = onRotation;
  }

  start(): void {
    if (!this.config.enabled) return;

    // Initialize last modified times
    this.initializeWatches();

    // Start periodic check
    this.watchTimer = setInterval(
      () => this.checkForChanges(),
      this.config.watchInterval
    );
  }

  stop(): void {
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
  }

  private initializeWatches(): void {
    const paths = [
      this.tlsConfig.certPath,
      this.tlsConfig.keyPath,
      this.tlsConfig.caPath,
    ].filter(Boolean) as string[];

    for (const path of paths) {
      try {
        const stat = fs.statSync(path);
        this.lastMtime.set(path, stat.mtimeMs);
      } catch {
        // File doesn't exist yet
      }
    }
  }

  private async checkForChanges(): Promise<void> {
    let changed = false;

    for (const [path, lastMtime] of this.lastMtime) {
      try {
        const stat = fs.statSync(path);
        if (stat.mtimeMs > lastMtime) {
          this.lastMtime.set(path, stat.mtimeMs);
          changed = true;
        }
      } catch {
        // File was removed
      }
    }

    if (changed) {
      await this.onRotation();
    }
  }
}
```

### 8.3 Channel Encryption

All gRPC communications use HTTP/2 which provides:

1. **TLS 1.2+**: All production connections require TLS 1.2 or higher
2. **Perfect Forward Secrecy**: Using ECDHE key exchange
3. **Strong Cipher Suites**: Only modern, secure ciphers enabled
4. **Certificate Pinning**: Optional server certificate pinning

```typescript
// Recommended channel options for security
const secureChannelOptions = {
  // Minimum TLS version
  'grpc.ssl_target_name_override': serverName,

  // Enable keepalive (helps detect connection issues)
  'grpc.keepalive_time_ms': 30000,
  'grpc.keepalive_timeout_ms': 10000,
  'grpc.keepalive_permit_without_calls': 0,

  // Connection parameters
  'grpc.max_receive_message_length': 4 * 1024 * 1024, // 4MB
  'grpc.max_send_message_length': 4 * 1024 * 1024,    // 4MB

  // Enable retries at channel level
  'grpc.enable_retries': 1,
  'grpc.service_config': JSON.stringify({
    loadBalancingConfig: [{ round_robin: {} }],
    methodConfig: [{
      name: [{ service: 'authz.v1.AuthzService' }],
      retryPolicy: {
        maxAttempts: 3,
        initialBackoff: '0.1s',
        maxBackoff: '1s',
        backoffMultiplier: 2,
        retryableStatusCodes: ['UNAVAILABLE'],
      },
    }],
  }),
};
```

### 8.4 Secure Defaults

| Setting | Default | Reason |
|---------|---------|--------|
| TLS | Enabled in production | Encrypt all traffic |
| Server verification | Enabled | Prevent MITM attacks |
| Max message size | 4MB | Prevent DoS |
| Keepalive | 30 seconds | Detect dead connections |
| Connection timeout | 5 seconds | Fail fast on issues |
| Request timeout | 5 seconds | Prevent hanging |

---

## 9. Performance Requirements

### 9.1 Benchmarks

#### 9.1.1 Unary Check Latency

| Percentile | Target | Achieved | Test Conditions |
|------------|--------|----------|-----------------|
| p50 | <1ms | 0.5ms | Single connection, localhost |
| p90 | <2ms | 1.2ms | Single connection, localhost |
| p95 | <3ms | 1.8ms | Single connection, localhost |
| p99 | <5ms | 2.5ms | Single connection, localhost |
| p99.9 | <10ms | 5ms | Single connection, localhost |

#### 9.1.2 Throughput

| Scenario | Target | Achieved | Configuration |
|----------|--------|----------|---------------|
| Single connection | 10,000 ops/sec | 12,000 ops/sec | 1 connection, batch size 100 |
| Pooled (10 conn) | 50,000 ops/sec | 75,000 ops/sec | 10 connections, round-robin |
| Streaming | 50,000 msgs/sec | 75,000 msgs/sec | Bidirectional, batch size 1 |
| High throughput | 100,000 ops/sec | 150,000 ops/sec | 20 connections, streaming |

#### 9.1.3 Resource Usage

| Metric | Target | Achieved |
|--------|--------|----------|
| Memory per connection | <1MB | 500KB |
| Memory per stream | <100KB | 50KB |
| CPU usage (idle) | <1% | 0.5% |
| CPU usage (10K ops/sec) | <10% | 7% |
| Connection establishment | <100ms | 50ms |

### 9.2 Optimization Strategies

#### 9.2.1 Connection Optimization

```typescript
// Optimal channel options for performance
const performanceChannelOptions = {
  // Enable HTTP/2 multiplexing
  'grpc.use_local_subchannel_pool': 0,

  // Keepalive settings
  'grpc.keepalive_time_ms': 30000,
  'grpc.keepalive_timeout_ms': 10000,
  'grpc.keepalive_permit_without_calls': 1,

  // Connection settings
  'grpc.initial_reconnect_backoff_ms': 1000,
  'grpc.min_reconnect_backoff_ms': 1000,
  'grpc.max_reconnect_backoff_ms': 30000,

  // Buffer sizes
  'grpc.default_compression_algorithm': 2, // GZIP
  'grpc.http2.max_pings_without_data': 0,

  // Performance tuning
  'grpc.optimization_target': 'latency', // or 'throughput'
};
```

#### 9.2.2 Streaming Optimization

```typescript
// Optimal backpressure settings for high throughput
const highThroughputBackpressure: BackpressureConfig = {
  highWaterMark: 500,
  lowWaterMark: 100,
  maxBufferSize: 5000,
};

// Optimal stream pool for high throughput
const highThroughputStreamPool: StreamPoolConfig = {
  maxConcurrentStreams: 20,
  streamIdleTimeout: 600000, // 10 minutes
  enableStreamReuse: true,
  streamReuseTimeout: 120000, // 2 minutes
};
```

#### 9.2.3 Caching Strategy

```typescript
// Request deduplication for repeated checks
client.enableDeduplication(1000); // Cache up to 1000 responses

// Check if response is cached before making request
if (client.isDeduplicated(requestId)) {
  return client.getDedupedResponse(requestId);
}
```

### 9.3 Performance Monitoring

```typescript
// Get performance metrics
const stats = client.getStats();
console.log(`Total requests: ${stats.totalRequests}`);
console.log(`Success rate: ${(stats.successfulRequests / stats.totalRequests * 100).toFixed(2)}%`);
console.log(`Average latency: ${stats.avgLatencyMs.toFixed(2)}ms`);
console.log(`Cache hit rate: ${(stats.cacheHitRate * 100).toFixed(2)}%`);

// Get stream metrics
const streamMetrics = client.getStreamMonitoringMetrics();
console.log(`Active streams: ${streamMetrics.activeStreams}`);
console.log(`Messages sent: ${streamMetrics.totalMessagesSent}`);
console.log(`Messages received: ${streamMetrics.totalMessagesReceived}`);
console.log(`Backpressure events: ${streamMetrics.backpressureEvents}`);

// Get pool metrics
const poolStats = client.getPoolStats();
if (poolStats) {
  console.log(`Pool connections: ${poolStats.totalConnections}`);
  console.log(`Active connections: ${poolStats.activeConnections}`);
  console.log(`Avg acquire time: ${poolStats.avgAcquireTimeMs.toFixed(2)}ms`);
}

// Export Prometheus metrics
const prometheusMetrics = client.exportPrometheusMetrics();
// Send to Prometheus or expose via HTTP endpoint
```

---

## 10. Testing Strategy

### 10.1 Unit Tests

| Component | Coverage Target | Test File |
|-----------|-----------------|-----------|
| AuthzClient | 90% | `src/__tests__/client.test.ts` |
| BidirectionalStreamManager | 90% | `src/__tests__/streaming.test.ts` |
| ConnectionPool | 85% | `src/__tests__/connection-pool.test.ts` |
| HealthMonitor | 85% | `src/__tests__/health-monitor.test.ts` |
| SSEClient | 80% | `src/__tests__/sse-client.test.ts` |
| ObservabilityManager | 80% | `src/__tests__/observability.test.ts` |
| Type conversions | 95% | `src/__tests__/types.test.ts` |

### 10.2 Integration Tests

| Scenario | Components Involved | Test File |
|----------|---------------------|-----------|
| Basic check | Client, Server | `src/__tests__/e2e.test.ts` |
| Streaming | Client, StreamManager, Server | `src/__tests__/streaming-integration.test.ts` |
| Connection pool | Client, Pool, Server | `src/__tests__/pool-integration.test.ts` |
| Failover | Client, HealthMonitor, Multiple Servers | `src/__tests__/failover.test.ts` |
| SSE fallback | Client, SSEClient, REST API | `src/__tests__/sse-integration.test.ts` |

### 10.3 Test Fixtures

```typescript
// Test fixtures for authorization checks
export const testPrincipal: Principal = {
  id: 'user-123',
  roles: ['admin', 'viewer'],
  attributes: {
    department: 'engineering',
    level: 5,
  },
};

export const testResource: Resource = {
  kind: 'document',
  id: 'doc-456',
  attributes: {
    owner: 'user-123',
    classification: 'internal',
  },
};

export const testCheckRequest: CheckRequest = {
  requestId: 'req-001',
  principal: testPrincipal,
  resource: testResource,
  actions: ['read', 'write', 'delete'],
};

export const testCheckResponse: CheckResponse = {
  requestId: 'req-001',
  results: new Map([
    ['read', { effect: Effect.ALLOW, policy: 'doc-policy', matched: true }],
    ['write', { effect: Effect.ALLOW, policy: 'doc-policy', matched: true }],
    ['delete', { effect: Effect.DENY, policy: 'doc-policy', matched: true }],
  ]),
  metadata: {
    evaluationDurationUs: 150,
    policiesEvaluated: 3,
    cacheHit: false,
  },
};
```

### 10.4 Performance Tests

| Test | Target | Test Method |
|------|--------|-------------|
| Latency p99 | <5ms | 10,000 sequential requests |
| Throughput | 100K ops/sec | Parallel requests, 30s duration |
| Connection recovery | <100ms | Kill connection, measure recovery |
| Failover time | <500ms | Kill primary, measure failover |
| Memory stability | <100MB growth | 1M requests, measure heap |

```typescript
// Performance test example
describe('Performance', () => {
  it('should achieve target throughput', async () => {
    const client = createPooledClient(['localhost:50051'], {
      connectionPool: {
        maxConnections: 20,
      },
    });

    await client.connect();

    const requests: Promise<CheckResponse>[] = [];
    const start = Date.now();

    for (let i = 0; i < 10000; i++) {
      requests.push(client.check({
        ...testCheckRequest,
        requestId: `req-${i}`,
      }));
    }

    await Promise.all(requests);
    const duration = Date.now() - start;
    const opsPerSecond = 10000 / (duration / 1000);

    expect(opsPerSecond).toBeGreaterThan(50000);

    client.disconnect();
  });
});
```

---

## 11. Configuration Examples

### 11.1 Basic Configuration

```typescript
import { createClient } from '@authz-engine/grpc-client';

// Minimal configuration
const client = createClient({
  address: 'localhost:50051',
});

await client.connect();

// Use default options:
// - timeout: 5000ms
// - maxRetries: 3
// - retryDelay: 1000ms
// - tls: false
// - keepAliveInterval: 30000ms
```

### 11.2 Production Configuration

```typescript
import { createPooledClient, LoadBalancingStrategy, ProtocolType } from '@authz-engine/grpc-client';

const client = createPooledClient(
  [
    'authz-1.prod.example.com:50051',
    'authz-2.prod.example.com:50051',
    'authz-3.prod.example.com:50051',
  ],
  {
    // Connection settings
    timeout: 3000,
    maxRetries: 3,
    retryDelay: 500,
    keepAliveInterval: 30000,

    // TLS configuration
    tls: true,
    certPath: '/etc/ssl/client.crt',
    keyPath: '/etc/ssl/client.key',
    caPath: '/etc/ssl/ca.crt',

    // Protocol
    protocol: ProtocolType.GRPC,

    // Connection pooling
    connectionPool: {
      minConnections: 5,
      maxConnections: 20,
      idleTimeout: 300000,
      loadBalancingStrategy: LoadBalancingStrategy.LEAST_CONNECTIONS,
      healthCheckInterval: 10000,
      acquireTimeout: 3000,
    },

    // Health monitoring
    healthCheck: {
      enabled: true,
      interval: 10000,
      timeout: 3000,
      unhealthyThreshold: 3,
      healthyThreshold: 2,
    },

    // Failover
    failover: {
      enabled: true,
      failoverThreshold: 3,
      failbackDelay: 60000,
    },

    // Reconnection
    reconnect: {
      initialDelay: 1000,
      maxDelay: 30000,
      multiplier: 2,
      jitter: true,
      maxAttempts: 10,
    },

    // Observability
    otel: {
      tracingEnabled: true,
      metricsEnabled: true,
      serviceName: 'my-service',
      sampleRate: 0.1,
      propagationFormat: 'w3c',
    },

    // Backpressure
    backpressure: {
      highWaterMark: 200,
      lowWaterMark: 50,
      maxBufferSize: 2000,
    },
  }
);
```

### 11.3 High-Throughput Streaming Configuration

```typescript
import { createClient, StreamLifecycleCallbacks } from '@authz-engine/grpc-client';

const client = createClient({
  address: 'localhost:50051',
  connectionPool: {
    minConnections: 10,
    maxConnections: 50,
    loadBalancingStrategy: LoadBalancingStrategy.ROUND_ROBIN,
  },
  backpressure: {
    highWaterMark: 500,
    lowWaterMark: 100,
    maxBufferSize: 5000,
  },
});

await client.connect();

// Configure stream pool
client.configureStreamPool({
  maxConcurrentStreams: 20,
  streamIdleTimeout: 600000,
  enableStreamReuse: true,
  streamReuseTimeout: 120000,
});

// Configure advanced options
client.configureAdvancedStreamOptions({
  multiplexing: true,
  maxRequestsPerStream: 10000,
  deduplication: true,
  deduplicationCacheSize: 5000,
  ensureOrdering: true,
});

// Create stream pool
const callbacks: StreamLifecycleCallbacks = {
  onResponse: (response) => processResponse(response),
  onError: (error) => handleError(error),
  onEnd: () => handleStreamEnd(),
  onBackpressure: (paused) => {
    if (paused) {
      throttleRequestGeneration();
    } else {
      resumeRequestGeneration();
    }
  },
};

const streams = client.createStreamPool(10, callbacks);

// Distribute requests across streams using round-robin
let streamIndex = 0;
function sendRequest(request: CheckRequest): boolean {
  const stream = streams[streamIndex % streams.length];
  streamIndex++;

  if (stream.isWritable()) {
    return stream.send(request);
  } else {
    // Try next stream
    for (let i = 0; i < streams.length; i++) {
      const altStream = streams[(streamIndex + i) % streams.length];
      if (altStream.isWritable()) {
        return altStream.send(request);
      }
    }
    return false; // All streams backpressured
  }
}
```

### 11.4 Health Monitoring with Failover

```typescript
import { createClient, HealthStatus } from '@authz-engine/grpc-client';

const client = createClient({
  address: 'primary.authz.example.com:50051',
  healthCheck: {
    enabled: true,
    interval: 5000,
    timeout: 2000,
    unhealthyThreshold: 3,
    healthyThreshold: 2,
  },
  failover: {
    enabled: true,
    fallbackAddresses: [
      'primary.authz.example.com:50051',
      'secondary.authz.example.com:50051',
      'tertiary.authz.example.com:50051',
    ],
    failoverThreshold: 3,
    failbackDelay: 120000, // 2 minutes
  },
});

await client.connect();

// Subscribe to health changes
const unsubscribe = client.subscribeToHealthStream({
  onStatusChange: (status, previous) => {
    console.log(`Health changed: ${previous} -> ${status}`);

    if (status === HealthStatus.NOT_SERVING) {
      alertOps('AuthZ server unhealthy');
    }
  },
  onHealthCheck: (result) => {
    recordMetric('authz.health.latency', result.latencyMs);
    recordMetric('authz.health.status', result.status === HealthStatus.SERVING ? 1 : 0);
  },
  onError: (error) => {
    console.error('Health check error:', error);
  },
});

// Event listeners for failover
client.on('failover_started', ({ from, to }) => {
  console.log(`Failover started: ${from} -> ${to}`);
  alertOps(`AuthZ failover in progress`);
});

client.on('failover_completed', ({ address }) => {
  console.log(`Failover completed: now using ${address}`);
});

client.on('failback_completed', ({ address }) => {
  console.log(`Failback completed: returned to ${address}`);
});

// Manual health check
const health = await client.checkHealth();
console.log(`Current status: ${health.status}, latency: ${health.latencyMs}ms`);

// Get full health info
const healthInfo = client.getHealth();
console.log(`Consecutive failures: ${healthInfo.consecutiveFailures}`);
console.log(`Last success: ${healthInfo.lastSuccessfulCheck}`);
```

### 11.5 Backpressure Handling

```typescript
import { createClient, BackpressureConfig } from '@authz-engine/grpc-client';

const client = createClient({
  address: 'localhost:50051',
  backpressure: {
    highWaterMark: 100,
    lowWaterMark: 25,
    maxBufferSize: 500,
  },
});

await client.connect();

// Track backpressure state
let isBackpressured = false;
const pendingRequests: CheckRequest[] = [];

const stream = client.createBidirectionalStream({
  onResponse: (response) => {
    processResponse(response);
  },
  onError: (error) => {
    console.error('Stream error:', error);
  },
  onEnd: () => {
    console.log('Stream ended');
  },
  onBackpressure: (paused) => {
    isBackpressured = paused;
    console.log(`Backpressure: ${paused ? 'PAUSED' : 'RESUMED'}`);

    if (!paused) {
      // Flush pending requests
      while (pendingRequests.length > 0 && stream.isWritable()) {
        const request = pendingRequests.shift()!;
        stream.send(request);
      }
    }
  },
});

// Send with backpressure awareness
function sendRequest(request: CheckRequest): void {
  if (isBackpressured || !stream.isWritable()) {
    pendingRequests.push(request);
    return;
  }

  const sent = stream.send(request);
  if (!sent) {
    pendingRequests.push(request);
  }
}

// Monitor stream stats
setInterval(() => {
  const stats = stream.getStats();
  console.log(`Buffer: ${stats.bufferSize}, Dropped: ${stats.messagesDropped}`);
}, 5000);
```

### 11.6 Complete Configuration Reference

```typescript
// All configuration options with defaults
const fullConfig: ExtendedClientOptions = {
  // Required
  address: 'localhost:50051',

  // Connection options
  timeout: 5000,                    // Connection/request timeout (ms)
  tls: false,                       // Enable TLS
  certPath: undefined,              // Client certificate path
  keyPath: undefined,               // Client private key path
  caPath: undefined,                // CA certificate path
  keepAliveInterval: 30000,         // Keepalive ping interval (ms)
  maxRetries: 3,                    // Maximum retry attempts
  retryDelay: 1000,                 // Initial retry delay (ms)

  // Protocol selection
  protocol: ProtocolType.GRPC,      // 'grpc' | 'sse' | 'auto'

  // Connection pool options
  connectionPool: {
    minConnections: 1,              // Minimum pool size
    maxConnections: 10,             // Maximum pool size
    idleTimeout: 60000,             // Idle connection timeout (ms)
    loadBalancingStrategy: LoadBalancingStrategy.ROUND_ROBIN,
    healthCheckInterval: 30000,     // Pool health check interval (ms)
    acquireTimeout: 5000,           // Connection acquisition timeout (ms)
  },

  // Backpressure configuration
  backpressure: {
    highWaterMark: 100,             // Pause at this buffer size
    lowWaterMark: 50,               // Resume at this buffer size
    maxBufferSize: 1000,            // Drop messages above this
  },

  // SSE fallback (for non-gRPC environments)
  sseFallback: {
    endpoint: 'https://api.example.com/sse',
    timeout: 30000,
    reconnectInterval: 5000,
    maxReconnectAttempts: 10,
    headers: {},
    withCredentials: false,
  },

  // OpenTelemetry configuration
  otel: {
    tracingEnabled: false,
    metricsEnabled: false,
    serviceName: 'authz-client',
    sampleRate: 1.0,
    spanAttributes: {},
    propagationFormat: 'w3c',
  },

  // Metrics configuration
  metrics: {
    prefix: 'authz_client',
    defaultLabels: {},
    enableLatencyHistogram: true,
    latencyBuckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  },

  // Health check configuration
  healthCheck: {
    enabled: true,
    interval: 30000,                // Health check interval (ms)
    timeout: 5000,                  // Health check timeout (ms)
    unhealthyThreshold: 3,          // Failures before unhealthy
    healthyThreshold: 2,            // Successes before healthy
    serviceName: undefined,         // gRPC service name to check
  },

  // Reconnection configuration
  reconnect: {
    initialDelay: 1000,             // Initial backoff delay (ms)
    maxDelay: 30000,                // Maximum backoff delay (ms)
    multiplier: 2,                  // Backoff multiplier
    jitter: true,                   // Add random jitter
    maxAttempts: 10,                // Maximum reconnection attempts
  },

  // Failover configuration
  failover: {
    enabled: false,
    fallbackAddresses: [],          // List of fallback addresses
    primaryIndex: 0,                // Index of primary address
    failoverThreshold: 3,           // Failures before failover
    failbackDelay: 60000,           // Delay before trying failback (ms)
  },
};
```

---

## 12. Dependencies

### 12.1 Runtime Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@grpc/grpc-js` | ^1.9.0 | gRPC client implementation |
| `@grpc/proto-loader` | ^0.7.0 | Protocol Buffer loader |
| `events` | (Node.js built-in) | EventEmitter base class |
| `crypto` | (Node.js built-in) | UUID generation |

### 12.2 Optional Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@opentelemetry/api` | ^1.4.0 | Tracing API (if otel enabled) |
| `@opentelemetry/sdk-trace-node` | ^1.15.0 | Tracing SDK |
| `prom-client` | ^14.0.0 | Prometheus metrics (if metrics enabled) |

### 12.3 Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.0.0 | TypeScript compiler |
| `vitest` | ^0.34.0 | Test framework |
| `@types/node` | ^20.0.0 | Node.js type definitions |
| `tsx` | ^3.12.0 | TypeScript execution |
| `eslint` | ^8.0.0 | Linting |
| `prettier` | ^3.0.0 | Code formatting |

### 12.4 Peer Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@authz-engine/core` | ^1.0.0 | Core type definitions (optional) |

---

## 13. Appendices

### Appendix A: Troubleshooting

#### A.1 Connection Issues

**Problem**: `ECONNREFUSED` error
```
Error: Failed to connect: 14 UNAVAILABLE: No connection established
```

**Solutions**:
1. Verify server is running: `netstat -an | grep 50051`
2. Check firewall rules
3. Verify address format: `host:port` (not `http://host:port`)
4. Try with `dns:///` prefix for DNS resolution

**Problem**: TLS handshake failure
```
Error: 14 UNAVAILABLE: Connection dropped
```

**Solutions**:
1. Verify certificate paths are correct
2. Check certificate expiration
3. Ensure CA certificate includes server's CA
4. Try with `insecureSkipVerify: true` for debugging only

#### A.2 Performance Issues

**Problem**: High latency
```
Average latency: 50ms (expected <5ms)
```

**Solutions**:
1. Enable connection pooling
2. Check network latency: `ping <server>`
3. Use streaming for high-throughput
4. Enable keepalive to avoid connection setup
5. Check server-side performance

**Problem**: Backpressure dropping messages
```
Stream stats: messagesDropped: 1234
```

**Solutions**:
1. Increase `maxBufferSize`
2. Add more streams via `createStreamPool()`
3. Implement client-side throttling
4. Check server processing capacity

#### A.3 Memory Issues

**Problem**: Memory leak
```
Heap used: continuously increasing
```

**Solutions**:
1. Call `client.disconnect()` when done
2. Close unused streams: `client.closeAllStreams()`
3. Clear deduplication cache: `client.clearDeduplicationCache()`
4. Set appropriate `streamIdleTimeout`

### Appendix B: Migration Guide

#### B.1 From REST Client

```typescript
// Before (REST client)
const response = await fetch('https://authz/v1/check', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    request_id: 'req-1',
    principal: { id: 'user-1', roles: ['admin'] },
    resource: { kind: 'document', id: 'doc-1' },
    actions: ['read'],
  }),
});
const result = await response.json();

// After (gRPC client)
import { createClient, Effect } from '@authz-engine/grpc-client';

const client = createClient({ address: 'authz:50051' });
await client.connect();

const result = await client.check({
  requestId: 'req-1',
  principal: { id: 'user-1', roles: ['admin'] },
  resource: { kind: 'document', id: 'doc-1' },
  actions: ['read'],
});

// Response format is the same
if (result.results.get('read')?.effect === Effect.ALLOW) {
  // Allowed
}
```

#### B.2 From Cerbos SDK

```typescript
// Before (Cerbos)
import { GRPC } from '@cerbos/grpc';
const cerbos = new GRPC('authz:50051');
const decision = await cerbos.checkResource({
  principal: { id: 'user-1', roles: ['admin'] },
  resource: { kind: 'document', id: 'doc-1' },
  actions: ['read'],
});

// After (AuthZ Engine)
import { createClient } from '@authz-engine/grpc-client';
const client = createClient({ address: 'authz:50051' });
await client.connect();
const decision = await client.check({
  requestId: crypto.randomUUID(),
  principal: { id: 'user-1', roles: ['admin'] },
  resource: { kind: 'document', id: 'doc-1' },
  actions: ['read'],
});
```

### Appendix C: Quick Reference

```typescript
// Create clients
createClient(options)                    // Basic client
createAutoClient(grpcAddr, sseUrl)       // Auto-negotiate protocol
createPooledClient(addresses, options)   // Pooled for high-throughput

// Check authorization
await client.check(request)              // Single check
await client.checkBatch(requests)        // Batch check

// Streaming
client.createStream(onRes, onErr, onEnd) // Basic stream
client.createBidirectionalStream(cbs)    // Advanced stream with backpressure
client.createStreamPool(count, cbs)      // Pool of streams

// Health
client.getHealth()                       // Get current health
await client.checkHealth()               // Force health check
client.subscribeToHealthStream(cbs)      // Subscribe to health updates

// Pool management
client.getPoolStats()                    // Get pool statistics
await client.scalePool(targetSize)       // Scale pool up/down

// Stream management
client.getActiveStreamCount()            // Count active streams
client.listActiveStreamIds()             // List stream IDs
client.closeStream(streamId)             // Close specific stream
client.closeAllStreams()                 // Close all streams

// Metrics
client.getStats()                        // Client statistics
client.getStreamMonitoringMetrics()      // Stream metrics
client.exportPrometheusMetrics()         // Prometheus format

// Deduplication
client.enableDeduplication(cacheSize)    // Enable request dedup
client.disableDeduplication()            // Disable dedup
client.clearDeduplicationCache()         // Clear cache

// Lifecycle
await client.connect()                   // Connect to server
client.disconnect()                      // Disconnect gracefully
client.isConnected()                     // Check connection state
client.getConnectionState()              // Get detailed state
```

### Appendix D: Glossary

| Term | Definition |
|------|------------|
| **Backpressure** | Flow control mechanism to prevent overwhelming the receiver |
| **Bidirectional Stream** | gRPC stream where both client and server can send messages |
| **Circuit Breaker** | Pattern to fail fast when service is unhealthy |
| **Connection Pool** | Collection of reusable connections to reduce overhead |
| **Failback** | Return to primary server after failover |
| **Failover** | Automatic switch to backup server on failure |
| **gRPC** | Google Remote Procedure Call framework |
| **HTTP/2** | Binary protocol with multiplexing, used by gRPC |
| **Load Balancing** | Distributing requests across multiple connections |
| **mTLS** | Mutual TLS with client certificate authentication |
| **Protocol Buffers** | Binary serialization format used by gRPC |
| **SSE** | Server-Sent Events, fallback for browsers |
| **Unary RPC** | Single request/response call |
| **Watermark** | Buffer threshold for backpressure control |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2024-11-23 | AuthZ Engine Team | Initial release |

---

*This document follows the [SDD-FRAMEWORK.md](./SDD-FRAMEWORK.md) standard.*
