# Performance Tuning - Software Design Document

| Field | Value |
|-------|-------|
| **Document ID** | SDD-PERFORMANCE-001 |
| **Version** | 1.0.0 |
| **Status** | Draft |
| **Created** | 2025-01-15 |
| **Last Updated** | 2025-01-15 |
| **Author** | AuthZ Engine Team |
| **Reviewers** | Performance Team, SRE Team |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Performance Targets](#2-performance-targets)
3. [Profiling and Benchmarking](#3-profiling-and-benchmarking)
4. [CEL Expression Optimization](#4-cel-expression-optimization)
5. [Memory Optimization](#5-memory-optimization)
6. [Connection Pooling](#6-connection-pooling)
7. [Async and Concurrency](#7-async-and-concurrency)
8. [Query Optimization](#8-query-optimization)
9. [Network Optimization](#9-network-optimization)
10. [Resource Sizing](#10-resource-sizing)
11. [Performance Monitoring](#11-performance-monitoring)
12. [Tuning Playbooks](#12-tuning-playbooks)

---

## 1. Executive Summary

### 1.1 Purpose

This document defines performance tuning strategies, optimization techniques, and operational playbooks for achieving and maintaining optimal performance of the AuthZ Engine across all deployment scenarios.

### 1.2 Scope

- Performance targets and SLOs
- Profiling and benchmarking methodologies
- CEL expression optimization
- Memory and CPU optimization
- Connection and resource management
- Query and network optimization
- Monitoring and alerting

### 1.3 Performance Philosophy

```
┌─────────────────────────────────────────────────────────────────┐
│                    PERFORMANCE PRINCIPLES                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. MEASURE FIRST       - Profile before optimizing             │
│  2. HOT PATH FOCUS      - Optimize critical paths only          │
│  3. CACHE INTELLIGENTLY - Right data, right duration            │
│  4. MINIMIZE ALLOCATIONS- Reduce GC pressure                    │
│  5. ASYNC BY DEFAULT    - Non-blocking operations               │
│  6. BATCH OPERATIONS    - Amortize overhead                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Performance Targets

### 2.1 Service Level Objectives (SLOs)

| Metric | Target | Critical | Measurement |
|--------|--------|----------|-------------|
| **P50 Latency** | < 5ms | < 10ms | Single policy check |
| **P95 Latency** | < 15ms | < 30ms | Single policy check |
| **P99 Latency** | < 50ms | < 100ms | Single policy check |
| **Throughput** | > 50,000 RPS | > 25,000 RPS | Per node |
| **Cache Hit Rate** | > 90% | > 80% | L1 + L2 combined |
| **Error Rate** | < 0.1% | < 1% | Non-4xx errors |
| **CPU Utilization** | < 70% | < 85% | Sustained average |
| **Memory Utilization** | < 75% | < 90% | Heap + off-heap |

### 2.2 Performance Budget

```
┌─────────────────────────────────────────────────────────────────┐
│                    REQUEST PROCESSING BUDGET                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Total Budget: 50ms (P99)                                       │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Component              │ Budget  │ % of Total           │   │
│  ├────────────────────────┼─────────┼──────────────────────┤   │
│  │ Network (in)           │   5ms   │      10%             │   │
│  │ Request Parsing        │   2ms   │       4%             │   │
│  │ Cache Lookup (L1)      │   1ms   │       2%             │   │
│  │ Cache Lookup (L2)      │   5ms   │      10%             │   │
│  │ Policy Retrieval       │   5ms   │      10%             │   │
│  │ CEL Evaluation         │  15ms   │      30%             │   │
│  │ Agent Processing       │  10ms   │      20%             │   │
│  │ Response Serialization │   2ms   │       4%             │   │
│  │ Network (out)          │   5ms   │      10%             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Profiling and Benchmarking

### 3.1 Profiling Tools

```typescript
// packages/core/src/profiling/profiler.ts

export class PerformanceProfiler {
  private spans: Map<string, SpanData[]> = new Map();
  private enabled: boolean;

  constructor(options: ProfilerOptions) {
    this.enabled = options.enabled;
  }

  startSpan(name: string): Span {
    if (!this.enabled) {
      return new NoOpSpan();
    }

    const span: SpanData = {
      name,
      startTime: process.hrtime.bigint(),
      endTime: null,
      attributes: {},
      children: [],
    };

    return new ActiveSpan(span, this);
  }

  recordSpan(span: SpanData): void {
    const spans = this.spans.get(span.name) ?? [];
    spans.push(span);

    // Keep only last 1000 spans per name
    if (spans.length > 1000) {
      spans.shift();
    }

    this.spans.set(span.name, spans);
  }

  getStatistics(name: string): SpanStatistics {
    const spans = this.spans.get(name) ?? [];

    if (spans.length === 0) {
      return { count: 0 };
    }

    const durations = spans.map(s =>
      Number(s.endTime! - s.startTime) / 1_000_000 // Convert to ms
    );

    durations.sort((a, b) => a - b);

    return {
      count: spans.length,
      min: durations[0],
      max: durations[durations.length - 1],
      avg: durations.reduce((a, b) => a + b, 0) / durations.length,
      p50: durations[Math.floor(durations.length * 0.5)],
      p95: durations[Math.floor(durations.length * 0.95)],
      p99: durations[Math.floor(durations.length * 0.99)],
    };
  }

  generateReport(): ProfileReport {
    const report: ProfileReport = {
      timestamp: new Date(),
      spans: {},
    };

    for (const [name] of this.spans) {
      report.spans[name] = this.getStatistics(name);
    }

    return report;
  }
}

class ActiveSpan implements Span {
  constructor(
    private data: SpanData,
    private profiler: PerformanceProfiler,
  ) {}

  setAttribute(key: string, value: any): void {
    this.data.attributes[key] = value;
  }

  end(): void {
    this.data.endTime = process.hrtime.bigint();
    this.profiler.recordSpan(this.data);
  }
}
```

### 3.2 Benchmark Suite

```typescript
// packages/core/src/benchmarks/benchmark-suite.ts

export class BenchmarkSuite {
  private benchmarks: Map<string, Benchmark> = new Map();

  register(name: string, benchmark: Benchmark): void {
    this.benchmarks.set(name, benchmark);
  }

  async run(options: BenchmarkOptions): Promise<BenchmarkResults> {
    const results: BenchmarkResults = {
      timestamp: new Date(),
      environment: this.getEnvironment(),
      benchmarks: {},
    };

    for (const [name, benchmark] of this.benchmarks) {
      console.log(`Running benchmark: ${name}`);

      // Warmup
      for (let i = 0; i < options.warmupIterations; i++) {
        await benchmark.run();
      }

      // Actual benchmark
      const times: number[] = [];
      const startMemory = process.memoryUsage();

      for (let i = 0; i < options.iterations; i++) {
        const start = process.hrtime.bigint();
        await benchmark.run();
        const end = process.hrtime.bigint();
        times.push(Number(end - start) / 1_000_000);
      }

      const endMemory = process.memoryUsage();

      times.sort((a, b) => a - b);

      results.benchmarks[name] = {
        iterations: options.iterations,
        min: times[0],
        max: times[times.length - 1],
        avg: times.reduce((a, b) => a + b, 0) / times.length,
        p50: times[Math.floor(times.length * 0.5)],
        p95: times[Math.floor(times.length * 0.95)],
        p99: times[Math.floor(times.length * 0.99)],
        opsPerSecond: 1000 / (times.reduce((a, b) => a + b, 0) / times.length),
        memoryDelta: {
          heapUsed: endMemory.heapUsed - startMemory.heapUsed,
          heapTotal: endMemory.heapTotal - startMemory.heapTotal,
        },
      };
    }

    return results;
  }
}

// Example benchmarks
export const policyCheckBenchmark: Benchmark = {
  name: 'policy-check-simple',
  async run() {
    const engine = getDecisionEngine();
    await engine.check({
      principal: 'user:test',
      action: 'read',
      resource: 'document:test',
    });
  },
};

export const celEvaluationBenchmark: Benchmark = {
  name: 'cel-evaluation-complex',
  async run() {
    const evaluator = getCELEvaluator();
    await evaluator.evaluate(
      'principal.role == "admin" && resource.owner == principal.id',
      {
        principal: { id: 'user:123', role: 'admin' },
        resource: { id: 'doc:456', owner: 'user:123' },
      }
    );
  },
};
```

### 3.3 Load Testing

```typescript
// packages/core/src/benchmarks/load-test.ts

export class LoadTestRunner {
  constructor(
    private client: AuthZClient,
    private metrics: MetricsCollector,
  ) {}

  async runLoadTest(config: LoadTestConfig): Promise<LoadTestResult> {
    const startTime = Date.now();
    const results: RequestResult[] = [];
    const errors: Error[] = [];

    // Create virtual users
    const users = Array.from({ length: config.concurrentUsers }, (_, i) => ({
      id: `user-${i}`,
      requestsPerSecond: config.requestsPerSecond / config.concurrentUsers,
    }));

    // Run for duration
    const endTime = startTime + config.durationSeconds * 1000;

    await Promise.all(
      users.map(user => this.runUser(user, endTime, results, errors))
    );

    return this.analyzeResults(results, errors, config);
  }

  private async runUser(
    user: VirtualUser,
    endTime: number,
    results: RequestResult[],
    errors: Error[],
  ): Promise<void> {
    const interval = 1000 / user.requestsPerSecond;

    while (Date.now() < endTime) {
      const requestStart = Date.now();

      try {
        await this.client.check({
          principal: user.id,
          action: 'read',
          resource: `resource:${Math.random()}`,
        });

        results.push({
          duration: Date.now() - requestStart,
          success: true,
        });
      } catch (error) {
        errors.push(error);
        results.push({
          duration: Date.now() - requestStart,
          success: false,
        });
      }

      // Throttle to target RPS
      const elapsed = Date.now() - requestStart;
      if (elapsed < interval) {
        await sleep(interval - elapsed);
      }
    }
  }

  private analyzeResults(
    results: RequestResult[],
    errors: Error[],
    config: LoadTestConfig,
  ): LoadTestResult {
    const durations = results
      .filter(r => r.success)
      .map(r => r.duration)
      .sort((a, b) => a - b);

    return {
      config,
      totalRequests: results.length,
      successfulRequests: durations.length,
      failedRequests: errors.length,
      actualRps: results.length / config.durationSeconds,
      latency: {
        min: durations[0] ?? 0,
        max: durations[durations.length - 1] ?? 0,
        avg: durations.reduce((a, b) => a + b, 0) / durations.length || 0,
        p50: durations[Math.floor(durations.length * 0.5)] ?? 0,
        p95: durations[Math.floor(durations.length * 0.95)] ?? 0,
        p99: durations[Math.floor(durations.length * 0.99)] ?? 0,
      },
      errorRate: errors.length / results.length,
    };
  }
}
```

---

## 4. CEL Expression Optimization

### 4.1 CEL Compilation Cache

```typescript
// packages/core/src/cel/optimized-evaluator.ts

export class OptimizedCELEvaluator {
  private compiledCache: LRUCache<string, CompiledExpression>;
  private precompiledExpressions: Map<string, CompiledExpression>;

  constructor(options: CELOptimizerOptions) {
    this.compiledCache = new LRUCache({
      max: options.cacheSize ?? 10000,
      ttl: options.cacheTtlMs ?? 3600000,
    });
    this.precompiledExpressions = new Map();
  }

  async precompile(expressions: string[]): Promise<void> {
    for (const expr of expressions) {
      const compiled = await this.compile(expr);
      this.precompiledExpressions.set(expr, compiled);
    }
  }

  async evaluate(
    expression: string,
    context: CELContext,
  ): Promise<CELResult> {
    // Check precompiled first
    let compiled = this.precompiledExpressions.get(expression);

    // Then check cache
    if (!compiled) {
      compiled = this.compiledCache.get(expression);
    }

    // Compile if needed
    if (!compiled) {
      compiled = await this.compile(expression);
      this.compiledCache.set(expression, compiled);
    }

    // Evaluate with optimized context
    return compiled.evaluate(this.optimizeContext(context));
  }

  private optimizeContext(context: CELContext): OptimizedContext {
    // Lazy property access
    return new Proxy(context, {
      get(target, prop) {
        // Cache property access results
        const key = String(prop);
        if (!(key in target)) {
          return undefined;
        }
        return target[key as keyof CELContext];
      },
    });
  }

  private async compile(expression: string): Promise<CompiledExpression> {
    // Parse and optimize AST
    const ast = parse(expression);
    const optimizedAst = this.optimizeAst(ast);

    return new CompiledExpression(optimizedAst);
  }

  private optimizeAst(ast: AST): AST {
    // Constant folding
    ast = this.foldConstants(ast);

    // Common subexpression elimination
    ast = this.eliminateCommonSubexpressions(ast);

    // Short-circuit optimization
    ast = this.optimizeShortCircuit(ast);

    return ast;
  }

  private foldConstants(ast: AST): AST {
    // Evaluate constant expressions at compile time
    // e.g., "1 + 2" -> "3"
    return ast.transform((node) => {
      if (node.type === 'binary' &&
          node.left.type === 'literal' &&
          node.right.type === 'literal') {
        return this.evaluateConstant(node);
      }
      return node;
    });
  }

  private optimizeShortCircuit(ast: AST): AST {
    // Reorder AND conditions with cheap checks first
    // e.g., "expensive() && cheap" -> "cheap && expensive()"
    return ast.transform((node) => {
      if (node.type === 'binary' && node.operator === '&&') {
        const leftCost = this.estimateCost(node.left);
        const rightCost = this.estimateCost(node.right);

        if (rightCost < leftCost) {
          return { ...node, left: node.right, right: node.left };
        }
      }
      return node;
    });
  }
}
```

### 4.2 Expression Complexity Analysis

```typescript
// packages/core/src/cel/complexity-analyzer.ts

export class CELComplexityAnalyzer {
  analyze(expression: string): ComplexityReport {
    const ast = parse(expression);

    return {
      expression,
      metrics: {
        depth: this.calculateDepth(ast),
        nodeCount: this.countNodes(ast),
        variableCount: this.countVariables(ast),
        functionCalls: this.countFunctionCalls(ast),
        estimatedCost: this.estimateCost(ast),
      },
      recommendations: this.generateRecommendations(ast),
    };
  }

  private estimateCost(ast: AST): number {
    let cost = 0;

    ast.traverse((node) => {
      switch (node.type) {
        case 'literal':
          cost += 1;
          break;
        case 'identifier':
          cost += 2;
          break;
        case 'member':
          cost += 3;
          break;
        case 'call':
          cost += this.getFunctionCost(node.name);
          break;
        case 'binary':
          cost += 2;
          break;
      }
    });

    return cost;
  }

  private getFunctionCost(name: string): number {
    const costs: Record<string, number> = {
      'size': 5,
      'matches': 20,
      'contains': 10,
      'startsWith': 8,
      'endsWith': 8,
      'duration': 15,
      'timestamp': 15,
    };
    return costs[name] ?? 10;
  }

  private generateRecommendations(ast: AST): string[] {
    const recommendations: string[] = [];

    // Check for expensive patterns
    if (this.hasNestedLoops(ast)) {
      recommendations.push(
        'Consider restructuring to avoid nested iterations'
      );
    }

    if (this.hasRepeatedSubexpressions(ast)) {
      recommendations.push(
        'Extract repeated subexpressions into variables'
      );
    }

    if (this.hasExpensiveFirstCondition(ast)) {
      recommendations.push(
        'Reorder conditions to check cheaper conditions first'
      );
    }

    return recommendations;
  }
}
```

---

## 5. Memory Optimization

### 5.1 Object Pooling

```typescript
// packages/core/src/memory/object-pool.ts

export class ObjectPool<T> {
  private available: T[] = [];
  private inUse: Set<T> = new Set();
  private factory: () => T;
  private reset: (obj: T) => void;

  constructor(options: PoolOptions<T>) {
    this.factory = options.factory;
    this.reset = options.reset ?? (() => {});

    // Pre-allocate objects
    for (let i = 0; i < options.initialSize; i++) {
      this.available.push(this.factory());
    }
  }

  acquire(): T {
    let obj: T;

    if (this.available.length > 0) {
      obj = this.available.pop()!;
    } else {
      obj = this.factory();
    }

    this.inUse.add(obj);
    return obj;
  }

  release(obj: T): void {
    if (!this.inUse.has(obj)) {
      return;
    }

    this.inUse.delete(obj);
    this.reset(obj);
    this.available.push(obj);
  }

  get stats(): PoolStats {
    return {
      available: this.available.length,
      inUse: this.inUse.size,
      total: this.available.length + this.inUse.size,
    };
  }
}

// Example: Request context pool
export const requestContextPool = new ObjectPool<RequestContext>({
  factory: () => ({
    principal: null,
    resource: null,
    action: null,
    environment: {},
    startTime: 0,
  }),
  reset: (ctx) => {
    ctx.principal = null;
    ctx.resource = null;
    ctx.action = null;
    ctx.environment = {};
    ctx.startTime = 0;
  },
  initialSize: 100,
});
```

### 5.2 Buffer Reuse

```typescript
// packages/core/src/memory/buffer-manager.ts

export class BufferManager {
  private pools: Map<number, Buffer[]> = new Map();
  private readonly sizes = [64, 256, 1024, 4096, 16384];

  acquireBuffer(minSize: number): Buffer {
    const size = this.selectSize(minSize);
    const pool = this.pools.get(size);

    if (pool && pool.length > 0) {
      return pool.pop()!;
    }

    return Buffer.allocUnsafe(size);
  }

  releaseBuffer(buffer: Buffer): void {
    const size = buffer.length;
    if (!this.sizes.includes(size)) {
      return; // Don't pool non-standard sizes
    }

    let pool = this.pools.get(size);
    if (!pool) {
      pool = [];
      this.pools.set(size, pool);
    }

    // Limit pool size
    if (pool.length < 100) {
      // Clear sensitive data
      buffer.fill(0);
      pool.push(buffer);
    }
  }

  private selectSize(minSize: number): number {
    for (const size of this.sizes) {
      if (size >= minSize) {
        return size;
      }
    }
    return minSize; // Use exact size for large buffers
  }
}
```

### 5.3 Memory Monitoring

```typescript
// packages/core/src/memory/memory-monitor.ts

export class MemoryMonitor {
  private samples: MemorySample[] = [];
  private alertThreshold: number;

  constructor(options: MemoryMonitorOptions) {
    this.alertThreshold = options.alertThreshold ?? 0.85;
    this.startMonitoring(options.intervalMs ?? 5000);
  }

  private startMonitoring(intervalMs: number): void {
    setInterval(() => {
      const usage = process.memoryUsage();
      const sample: MemorySample = {
        timestamp: Date.now(),
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
        external: usage.external,
        arrayBuffers: usage.arrayBuffers,
        rss: usage.rss,
      };

      this.samples.push(sample);

      // Keep only last hour of samples
      const oneHourAgo = Date.now() - 3600000;
      this.samples = this.samples.filter(s => s.timestamp > oneHourAgo);

      // Check for memory pressure
      this.checkMemoryPressure(sample);
    }, intervalMs);
  }

  private checkMemoryPressure(sample: MemorySample): void {
    const heapUtilization = sample.heapUsed / sample.heapTotal;

    if (heapUtilization > this.alertThreshold) {
      this.triggerGC();
      this.emitAlert({
        type: 'memory_pressure',
        utilization: heapUtilization,
        heapUsed: sample.heapUsed,
        heapTotal: sample.heapTotal,
      });
    }
  }

  private triggerGC(): void {
    if (global.gc) {
      global.gc();
    }
  }

  getMemoryTrend(): MemoryTrend {
    if (this.samples.length < 2) {
      return { trend: 'stable', ratePerHour: 0 };
    }

    const recentSamples = this.samples.slice(-12); // Last minute at 5s intervals
    const oldestSample = recentSamples[0];
    const newestSample = recentSamples[recentSamples.length - 1];

    const deltaMs = newestSample.timestamp - oldestSample.timestamp;
    const deltaHeap = newestSample.heapUsed - oldestSample.heapUsed;

    const ratePerHour = (deltaHeap / deltaMs) * 3600000;

    return {
      trend: ratePerHour > 10_000_000 ? 'increasing' :
             ratePerHour < -10_000_000 ? 'decreasing' : 'stable',
      ratePerHour,
    };
  }
}
```

---

## 6. Connection Pooling

### 6.1 Database Connection Pool

```typescript
// packages/core/src/connections/database-pool.ts

export class DatabaseConnectionPool {
  private pool: Pool;
  private metrics: PoolMetrics;

  constructor(config: PoolConfig) {
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,

      // Pool settings
      min: config.minConnections ?? 5,
      max: config.maxConnections ?? 20,
      idleTimeoutMillis: config.idleTimeoutMs ?? 30000,
      connectionTimeoutMillis: config.connectionTimeoutMs ?? 5000,

      // Statement caching
      statement_timeout: config.statementTimeoutMs ?? 10000,
    });

    this.setupMetrics();
  }

  private setupMetrics(): void {
    this.metrics = {
      totalConnections: 0,
      idleConnections: 0,
      waitingClients: 0,
      acquisitions: 0,
      releases: 0,
      errors: 0,
    };

    this.pool.on('acquire', () => {
      this.metrics.acquisitions++;
      this.updateCounts();
    });

    this.pool.on('release', () => {
      this.metrics.releases++;
      this.updateCounts();
    });

    this.pool.on('error', () => {
      this.metrics.errors++;
    });
  }

  private updateCounts(): void {
    this.metrics.totalConnections = this.pool.totalCount;
    this.metrics.idleConnections = this.pool.idleCount;
    this.metrics.waitingClients = this.pool.waitingCount;
  }

  async query<T>(sql: string, params?: any[]): Promise<T[]> {
    const start = Date.now();

    try {
      const result = await this.pool.query(sql, params);
      this.recordQueryMetrics(sql, Date.now() - start, true);
      return result.rows;
    } catch (error) {
      this.recordQueryMetrics(sql, Date.now() - start, false);
      throw error;
    }
  }

  async withConnection<T>(
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  getMetrics(): PoolMetrics {
    this.updateCounts();
    return { ...this.metrics };
  }
}
```

### 6.2 Redis Connection Pool

```typescript
// packages/core/src/connections/redis-pool.ts

export class RedisConnectionPool {
  private cluster: Cluster | Redis;
  private commandQueue: CommandQueue;

  constructor(config: RedisPoolConfig) {
    if (config.cluster) {
      this.cluster = new Cluster(config.nodes, {
        redisOptions: {
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          connectTimeout: 5000,
        },
        scaleReads: 'slave',
        clusterRetryStrategy: (times) => Math.min(times * 100, 3000),
      });
    } else {
      this.cluster = new Redis({
        host: config.host,
        port: config.port,
        password: config.password,
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true,
      });
    }

    // Command batching for efficiency
    this.commandQueue = new CommandQueue(this.cluster, {
      batchSize: 100,
      flushIntervalMs: 10,
    });
  }

  async get(key: string): Promise<string | null> {
    return this.cluster.get(key);
  }

  async set(
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<void> {
    if (ttlSeconds) {
      await this.cluster.setex(key, ttlSeconds, value);
    } else {
      await this.cluster.set(key, value);
    }
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];

    // Use pipeline for efficiency
    const pipeline = this.cluster.pipeline();
    keys.forEach(key => pipeline.get(key));
    const results = await pipeline.exec();

    return results?.map(([err, val]) => (err ? null : val as string)) ?? [];
  }

  async mset(
    entries: Array<[string, string]>,
    ttlSeconds?: number,
  ): Promise<void> {
    if (entries.length === 0) return;

    const pipeline = this.cluster.pipeline();

    for (const [key, value] of entries) {
      if (ttlSeconds) {
        pipeline.setex(key, ttlSeconds, value);
      } else {
        pipeline.set(key, value);
      }
    }

    await pipeline.exec();
  }
}

// Command batching for high-throughput scenarios
class CommandQueue {
  private queue: Array<{
    command: string;
    args: any[];
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }> = [];

  private flushTimer: NodeJS.Timer | null = null;

  constructor(
    private redis: Redis | Cluster,
    private options: { batchSize: number; flushIntervalMs: number },
  ) {}

  async execute(command: string, ...args: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      this.queue.push({ command, args, resolve, reject });

      if (this.queue.length >= this.options.batchSize) {
        this.flush();
      } else if (!this.flushTimer) {
        this.flushTimer = setTimeout(
          () => this.flush(),
          this.options.flushIntervalMs,
        );
      }
    });
  }

  private async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const batch = this.queue.splice(0);
    if (batch.length === 0) return;

    const pipeline = this.redis.pipeline();

    for (const item of batch) {
      (pipeline as any)[item.command](...item.args);
    }

    const results = await pipeline.exec();

    results?.forEach(([err, result], i) => {
      if (err) {
        batch[i].reject(err);
      } else {
        batch[i].resolve(result);
      }
    });
  }
}
```

---

## 7. Async and Concurrency

### 7.1 Async Optimization Patterns

```typescript
// packages/core/src/async/optimization.ts

export class AsyncOptimizer {
  // Parallel execution with concurrency limit
  async parallelLimit<T, R>(
    items: T[],
    fn: (item: T) => Promise<R>,
    concurrency: number,
  ): Promise<R[]> {
    const results: R[] = [];
    const executing: Promise<void>[] = [];

    for (const item of items) {
      const p = fn(item).then(result => {
        results.push(result);
      });

      executing.push(p);

      if (executing.length >= concurrency) {
        await Promise.race(executing);
        executing.splice(
          executing.findIndex(e => e === p),
          1,
        );
      }
    }

    await Promise.all(executing);
    return results;
  }

  // Batch async operations
  async batch<T, R>(
    items: T[],
    fn: (batch: T[]) => Promise<R[]>,
    batchSize: number,
  ): Promise<R[]> {
    const results: R[] = [];

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await fn(batch);
      results.push(...batchResults);
    }

    return results;
  }

  // Debounced async function
  debounce<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    waitMs: number,
  ): T {
    let timeout: NodeJS.Timeout | null = null;
    let pendingPromise: Promise<any> | null = null;

    return ((...args: any[]) => {
      if (timeout) {
        clearTimeout(timeout);
      }

      if (!pendingPromise) {
        pendingPromise = new Promise((resolve, reject) => {
          timeout = setTimeout(async () => {
            try {
              resolve(await fn(...args));
            } catch (error) {
              reject(error);
            } finally {
              pendingPromise = null;
            }
          }, waitMs);
        });
      }

      return pendingPromise;
    }) as T;
  }
}
```

### 7.2 Worker Threads

```typescript
// packages/core/src/workers/cel-worker-pool.ts

import { Worker, parentPort, workerData } from 'worker_threads';

export class CELWorkerPool {
  private workers: Worker[] = [];
  private taskQueue: TaskQueueItem[] = [];
  private availableWorkers: Worker[] = [];

  constructor(poolSize: number) {
    for (let i = 0; i < poolSize; i++) {
      const worker = new Worker('./cel-worker.js');
      this.setupWorker(worker);
      this.workers.push(worker);
      this.availableWorkers.push(worker);
    }
  }

  private setupWorker(worker: Worker): void {
    worker.on('message', (result: WorkerResult) => {
      this.availableWorkers.push(worker);
      this.processNextTask();
    });

    worker.on('error', (error) => {
      console.error('Worker error:', error);
      this.replaceWorker(worker);
    });
  }

  async evaluate(
    expression: string,
    context: CELContext,
  ): Promise<CELResult> {
    return new Promise((resolve, reject) => {
      this.taskQueue.push({
        expression,
        context,
        resolve,
        reject,
      });
      this.processNextTask();
    });
  }

  private processNextTask(): void {
    if (this.taskQueue.length === 0 || this.availableWorkers.length === 0) {
      return;
    }

    const worker = this.availableWorkers.pop()!;
    const task = this.taskQueue.shift()!;

    worker.postMessage({
      type: 'evaluate',
      expression: task.expression,
      context: task.context,
    });

    worker.once('message', (result: WorkerResult) => {
      if (result.error) {
        task.reject(new Error(result.error));
      } else {
        task.resolve(result.value);
      }
    });
  }

  async shutdown(): Promise<void> {
    await Promise.all(
      this.workers.map(w => w.terminate())
    );
  }
}

// cel-worker.js
if (!isMainThread) {
  const evaluator = new CELEvaluator();

  parentPort?.on('message', async (message) => {
    try {
      const result = await evaluator.evaluate(
        message.expression,
        message.context,
      );
      parentPort?.postMessage({ value: result });
    } catch (error) {
      parentPort?.postMessage({ error: error.message });
    }
  });
}
```

---

## 8. Query Optimization

### 8.1 Query Analyzer

```typescript
// packages/core/src/query/query-analyzer.ts

export class QueryAnalyzer {
  async analyze(sql: string): Promise<QueryAnalysis> {
    const plan = await this.getExecutionPlan(sql);

    return {
      sql,
      estimatedCost: this.extractCost(plan),
      estimatedRows: this.extractRows(plan),
      scanType: this.extractScanType(plan),
      indexUsage: this.extractIndexUsage(plan),
      recommendations: this.generateRecommendations(plan),
    };
  }

  private async getExecutionPlan(sql: string): Promise<any> {
    const result = await db.query(`EXPLAIN (FORMAT JSON, ANALYZE) ${sql}`);
    return result.rows[0]['QUERY PLAN'];
  }

  private generateRecommendations(plan: any): string[] {
    const recommendations: string[] = [];

    // Check for sequential scans on large tables
    if (this.hasSequentialScan(plan) && this.getRowEstimate(plan) > 10000) {
      recommendations.push('Consider adding an index to avoid sequential scan');
    }

    // Check for missing indexes in WHERE clauses
    const missingIndexes = this.findMissingIndexes(plan);
    if (missingIndexes.length > 0) {
      recommendations.push(
        `Consider adding indexes on: ${missingIndexes.join(', ')}`
      );
    }

    // Check for expensive sorts
    if (this.hasExpensiveSort(plan)) {
      recommendations.push('Consider adding an index to support ORDER BY');
    }

    return recommendations;
  }
}
```

### 8.2 Query Builder with Optimization

```typescript
// packages/core/src/query/optimized-query-builder.ts

export class OptimizedQueryBuilder {
  private selectColumns: string[] = [];
  private whereConditions: WhereCondition[] = [];
  private orderByColumns: string[] = [];
  private limitValue?: number;
  private offsetValue?: number;

  select(...columns: string[]): this {
    // Only select needed columns
    this.selectColumns = columns;
    return this;
  }

  where(column: string, op: string, value: any): this {
    this.whereConditions.push({ column, op, value });
    return this;
  }

  orderBy(column: string, direction: 'ASC' | 'DESC' = 'ASC'): this {
    this.orderByColumns.push(`${column} ${direction}`);
    return this;
  }

  limit(n: number): this {
    this.limitValue = n;
    return this;
  }

  offset(n: number): this {
    this.offsetValue = n;
    return this;
  }

  build(): { sql: string; params: any[] } {
    const params: any[] = [];
    let paramIndex = 1;

    // Optimize WHERE clause order (most selective first)
    const orderedConditions = this.optimizeConditionOrder();

    const whereClauses = orderedConditions.map(cond => {
      params.push(cond.value);
      return `${cond.column} ${cond.op} $${paramIndex++}`;
    });

    const sql = [
      `SELECT ${this.selectColumns.join(', ') || '*'}`,
      `FROM ${this.tableName}`,
      whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '',
      this.orderByColumns.length
        ? `ORDER BY ${this.orderByColumns.join(', ')}`
        : '',
      this.limitValue ? `LIMIT ${this.limitValue}` : '',
      this.offsetValue ? `OFFSET ${this.offsetValue}` : '',
    ]
      .filter(Boolean)
      .join(' ');

    return { sql, params };
  }

  private optimizeConditionOrder(): WhereCondition[] {
    // Order by selectivity (equality > range > LIKE)
    const priority: Record<string, number> = {
      '=': 1,
      'IN': 2,
      '<': 3,
      '>': 3,
      '<=': 3,
      '>=': 3,
      'LIKE': 4,
      'ILIKE': 5,
    };

    return [...this.whereConditions].sort(
      (a, b) => (priority[a.op] ?? 10) - (priority[b.op] ?? 10)
    );
  }
}
```

---

## 9. Network Optimization

### 9.1 Response Compression

```typescript
// packages/server/src/middleware/compression.ts

export function compressionMiddleware(
  options: CompressionOptions = {},
): RequestHandler {
  const threshold = options.threshold ?? 1024; // 1KB
  const level = options.level ?? 6;

  return (req, res, next) => {
    const acceptEncoding = req.headers['accept-encoding'] || '';

    // Check if client supports compression
    if (!acceptEncoding.includes('gzip') &&
        !acceptEncoding.includes('br')) {
      return next();
    }

    // Capture original write
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    let body: Buffer[] = [];

    res.write = (chunk: any) => {
      body.push(Buffer.from(chunk));
      return true;
    };

    res.end = (chunk?: any) => {
      if (chunk) {
        body.push(Buffer.from(chunk));
      }

      const fullBody = Buffer.concat(body);

      // Only compress if above threshold
      if (fullBody.length < threshold) {
        res.setHeader('Content-Length', fullBody.length);
        originalWrite(fullBody);
        return originalEnd();
      }

      // Choose compression based on client preference
      if (acceptEncoding.includes('br')) {
        res.setHeader('Content-Encoding', 'br');
        const compressed = zlib.brotliCompressSync(fullBody, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: level,
          },
        });
        res.setHeader('Content-Length', compressed.length);
        originalWrite(compressed);
      } else {
        res.setHeader('Content-Encoding', 'gzip');
        const compressed = zlib.gzipSync(fullBody, { level });
        res.setHeader('Content-Length', compressed.length);
        originalWrite(compressed);
      }

      return originalEnd();
    };

    next();
  };
}
```

### 9.2 Connection Keep-Alive

```typescript
// packages/server/src/server/http-config.ts

export function configureHttpServer(server: http.Server): void {
  // Keep-alive settings
  server.keepAliveTimeout = 65000; // Slightly higher than typical LB timeout
  server.headersTimeout = 66000;

  // Max connections
  server.maxConnections = 10000;

  // Request timeout
  server.timeout = 30000;
}

export function configureHttpClient(): AxiosInstance {
  const httpsAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: 100,
    maxFreeSockets: 10,
    timeout: 10000,
  });

  return axios.create({
    httpsAgent,
    timeout: 10000,
    maxRedirects: 3,
  });
}
```

---

## 10. Resource Sizing

### 10.1 Resource Calculator

```typescript
// packages/core/src/sizing/resource-calculator.ts

export class ResourceCalculator {
  calculateRequirements(workload: WorkloadProfile): ResourceRequirements {
    const cpu = this.calculateCPU(workload);
    const memory = this.calculateMemory(workload);
    const replicas = this.calculateReplicas(workload);

    return {
      cpu,
      memory,
      replicas,
      recommendations: this.generateRecommendations(workload, {
        cpu,
        memory,
        replicas,
      }),
    };
  }

  private calculateCPU(workload: WorkloadProfile): CPURequirement {
    // Base CPU per 1000 RPS
    const cpuPer1000Rps = 0.25; // 250m per 1000 RPS

    // CEL complexity factor
    const celFactor = 1 + (workload.averageCelComplexity - 10) * 0.05;

    // Agent overhead
    const agentOverhead = workload.agentsEnabled ? 0.5 : 0;

    const request = Math.ceil(
      (workload.peakRps / 1000) * cpuPer1000Rps * celFactor + agentOverhead
    );

    return {
      request: `${request * 1000}m`,
      limit: `${request * 1500}m`, // 1.5x request
    };
  }

  private calculateMemory(workload: WorkloadProfile): MemoryRequirement {
    // Base memory
    const baseMemory = 256; // MB

    // Cache memory (estimate 1KB per cached policy)
    const cacheMemory = (workload.uniquePolicies * 1) / 1024; // MB

    // Connection pool memory
    const connectionMemory =
      workload.dbConnections * 2 + workload.redisConnections * 0.5; // MB

    // Agent memory
    const agentMemory = workload.agentsEnabled ? 512 : 0; // MB

    const totalMemory = Math.ceil(
      baseMemory + cacheMemory + connectionMemory + agentMemory
    );

    return {
      request: `${totalMemory}Mi`,
      limit: `${Math.ceil(totalMemory * 1.5)}Mi`,
    };
  }

  private calculateReplicas(workload: WorkloadProfile): ReplicaRequirement {
    // Target 70% CPU utilization
    const targetUtilization = 0.7;

    // Calculate replicas needed
    const cpuPerReplica = 2; // 2 CPU cores per replica
    const rpsPerReplica = 10000; // Theoretical max per replica

    const forCpu = Math.ceil(
      workload.peakRps / (rpsPerReplica * targetUtilization)
    );

    // Minimum for HA
    const forHA = workload.requireHA ? 3 : 1;

    return {
      minimum: Math.max(forHA, 2),
      recommended: Math.max(forCpu, forHA),
      maximum: Math.max(forCpu * 2, 10),
    };
  }
}
```

### 10.2 Kubernetes Resource Configuration

```yaml
# kubernetes/resources/sizing-profiles.yaml

# Profile: Small (< 5,000 RPS)
small:
  replicas: 3
  resources:
    requests:
      cpu: "500m"
      memory: "512Mi"
    limits:
      cpu: "1000m"
      memory: "1Gi"
  hpa:
    minReplicas: 3
    maxReplicas: 10
    targetCPUUtilization: 70

# Profile: Medium (5,000 - 25,000 RPS)
medium:
  replicas: 5
  resources:
    requests:
      cpu: "1000m"
      memory: "1Gi"
    limits:
      cpu: "2000m"
      memory: "2Gi"
  hpa:
    minReplicas: 5
    maxReplicas: 20
    targetCPUUtilization: 70

# Profile: Large (25,000 - 100,000 RPS)
large:
  replicas: 10
  resources:
    requests:
      cpu: "2000m"
      memory: "2Gi"
    limits:
      cpu: "4000m"
      memory: "4Gi"
  hpa:
    minReplicas: 10
    maxReplicas: 50
    targetCPUUtilization: 70

# Profile: XLarge (> 100,000 RPS)
xlarge:
  replicas: 20
  resources:
    requests:
      cpu: "4000m"
      memory: "4Gi"
    limits:
      cpu: "8000m"
      memory: "8Gi"
  hpa:
    minReplicas: 20
    maxReplicas: 100
    targetCPUUtilization: 60
```

---

## 11. Performance Monitoring

### 11.1 Metrics Collection

```typescript
// packages/core/src/monitoring/performance-metrics.ts

export class PerformanceMetrics {
  private registry: Registry;

  // Latency histogram
  readonly requestLatency = new Histogram({
    name: 'authz_request_latency_seconds',
    help: 'Request latency in seconds',
    labelNames: ['method', 'status'],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  });

  // Throughput counter
  readonly requestsTotal = new Counter({
    name: 'authz_requests_total',
    help: 'Total number of requests',
    labelNames: ['method', 'status'],
  });

  // Cache metrics
  readonly cacheHits = new Counter({
    name: 'authz_cache_hits_total',
    help: 'Cache hits',
    labelNames: ['cache_level'],
  });

  readonly cacheMisses = new Counter({
    name: 'authz_cache_misses_total',
    help: 'Cache misses',
    labelNames: ['cache_level'],
  });

  // CEL evaluation metrics
  readonly celEvaluationTime = new Histogram({
    name: 'authz_cel_evaluation_seconds',
    help: 'CEL expression evaluation time',
    labelNames: ['complexity'],
    buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1],
  });

  // Connection pool metrics
  readonly poolConnections = new Gauge({
    name: 'authz_pool_connections',
    help: 'Connection pool statistics',
    labelNames: ['pool', 'state'],
  });

  // Memory metrics
  readonly memoryUsage = new Gauge({
    name: 'authz_memory_bytes',
    help: 'Memory usage in bytes',
    labelNames: ['type'],
  });

  recordRequest(method: string, status: number, durationMs: number): void {
    this.requestLatency.observe(
      { method, status: String(status) },
      durationMs / 1000,
    );
    this.requestsTotal.inc({ method, status: String(status) });
  }

  recordCacheAccess(level: string, hit: boolean): void {
    if (hit) {
      this.cacheHits.inc({ cache_level: level });
    } else {
      this.cacheMisses.inc({ cache_level: level });
    }
  }

  updateMemoryMetrics(): void {
    const usage = process.memoryUsage();
    this.memoryUsage.set({ type: 'heap_used' }, usage.heapUsed);
    this.memoryUsage.set({ type: 'heap_total' }, usage.heapTotal);
    this.memoryUsage.set({ type: 'external' }, usage.external);
    this.memoryUsage.set({ type: 'rss' }, usage.rss);
  }
}
```

### 11.2 Performance Dashboard

```yaml
# grafana/dashboards/performance.json
{
  "title": "AuthZ Engine Performance",
  "panels": [
    {
      "title": "Request Latency",
      "type": "graph",
      "targets": [
        {
          "expr": "histogram_quantile(0.50, rate(authz_request_latency_seconds_bucket[5m]))",
          "legendFormat": "P50"
        },
        {
          "expr": "histogram_quantile(0.95, rate(authz_request_latency_seconds_bucket[5m]))",
          "legendFormat": "P95"
        },
        {
          "expr": "histogram_quantile(0.99, rate(authz_request_latency_seconds_bucket[5m]))",
          "legendFormat": "P99"
        }
      ]
    },
    {
      "title": "Throughput",
      "type": "graph",
      "targets": [
        {
          "expr": "sum(rate(authz_requests_total[1m]))",
          "legendFormat": "Requests/sec"
        }
      ]
    },
    {
      "title": "Cache Hit Rate",
      "type": "gauge",
      "targets": [
        {
          "expr": "sum(rate(authz_cache_hits_total[5m])) / (sum(rate(authz_cache_hits_total[5m])) + sum(rate(authz_cache_misses_total[5m])))"
        }
      ]
    },
    {
      "title": "CEL Evaluation Time",
      "type": "heatmap",
      "targets": [
        {
          "expr": "rate(authz_cel_evaluation_seconds_bucket[5m])"
        }
      ]
    }
  ]
}
```

---

## 12. Tuning Playbooks

### 12.1 High Latency Playbook

```markdown
## Playbook: High Latency Investigation

### Symptoms
- P99 latency > 100ms
- Increased request timeouts
- Slow response times reported by users

### Investigation Steps

1. **Check Cache Performance**
   ```bash
   curl -s localhost:9090/metrics | grep authz_cache
   ```
   - If hit rate < 80%, review cache configuration
   - Check cache eviction rates

2. **Analyze CEL Complexity**
   ```bash
   curl -s localhost:8080/debug/cel/stats
   ```
   - Identify expressions with > 50ms evaluation time
   - Review for optimization opportunities

3. **Check Database Performance**
   ```bash
   # Check slow queries
   SELECT query, calls, mean_time FROM pg_stat_statements
   ORDER BY mean_time DESC LIMIT 10;
   ```

4. **Review Connection Pools**
   ```bash
   curl -s localhost:8080/debug/pools
   ```
   - Check for pool exhaustion
   - Review wait queue depth

### Remediation

| Finding | Action |
|---------|--------|
| Low cache hit rate | Increase cache size, review TTL |
| Complex CEL expressions | Optimize or precompile expressions |
| Slow database queries | Add indexes, optimize queries |
| Pool exhaustion | Increase pool size, add replicas |
```

### 12.2 Memory Pressure Playbook

```markdown
## Playbook: Memory Pressure Investigation

### Symptoms
- OOM kills in Kubernetes
- Increasing memory usage over time
- GC pause spikes

### Investigation Steps

1. **Check Memory Usage**
   ```bash
   curl -s localhost:8080/debug/memory
   ```
   - Review heap vs external memory
   - Check for memory leaks

2. **Analyze GC Statistics**
   ```bash
   node --trace-gc app.js 2>&1 | grep -E "Mark-sweep|Scavenge"
   ```

3. **Review Object Allocation**
   ```bash
   # Take heap snapshot
   curl -X POST localhost:8080/debug/heap-snapshot
   ```

4. **Check Cache Sizes**
   ```bash
   curl -s localhost:8080/debug/caches
   ```

### Remediation

| Finding | Action |
|---------|--------|
| Memory leak | Profile and fix allocation |
| Large cache | Reduce cache size, add eviction |
| GC pressure | Enable object pooling |
| External memory | Review Buffer usage |
```

---

## Appendices

### A. Performance Checklist

- [ ] Profiling enabled in staging
- [ ] Benchmarks run before release
- [ ] Cache hit rate > 90%
- [ ] P99 latency < 50ms
- [ ] Error rate < 0.1%
- [ ] Resource limits configured
- [ ] HPA enabled
- [ ] Monitoring dashboards verified

### B. Related Documents

| Document | Description |
|----------|-------------|
| [CACHING-STRATEGY-SDD](./CACHING-STRATEGY-SDD.md) | Cache configuration |
| [DEPLOYMENT-OPERATIONS-SDD](./DEPLOYMENT-OPERATIONS-SDD.md) | Resource configuration |
| [RATE-LIMITING-SDD](./RATE-LIMITING-SDD.md) | Rate limiting tuning |

---

**Document Control:**
- **Review Cycle:** Monthly
- **Classification:** Internal
- **Distribution:** Engineering, SRE, Performance Teams
