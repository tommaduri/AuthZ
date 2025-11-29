# Software Design Document: Load Testing Suite

**Version**: 1.0.0
**Package**: `@authz-engine/load-testing`
**Status**: Specification (Not Yet Implemented)
**Last Updated**: 2025-11-23

---

## 1. Overview

### 1.1 Purpose

The Load Testing Suite provides comprehensive performance testing capabilities for the AuthZ Engine. It enables:
- Baseline performance benchmarking for authorization checks
- Stress testing to identify breaking points
- Soak testing for long-running stability validation
- Automated performance regression detection in CI/CD
- Real-time performance metrics visualization

### 1.2 Scope

**In Scope:**
- k6 load testing scripts for all API endpoints
- Artillery configuration for complex scenarios
- Custom test harness for fine-grained control
- Performance metrics collection and aggregation
- Grafana dashboard templates
- CI/CD integration with GitHub Actions
- HTML report generation
- Performance badge generation

**Out of Scope:**
- Production traffic replay (future enhancement)
- Chaos engineering integration (separate module)
- Multi-region distributed testing (requires cloud infrastructure)

### 1.3 Context

The Load Testing Suite integrates with the AuthZ Engine server package and provides tooling to validate that performance targets are met before deployment. It ensures the authorization engine can handle production-scale workloads with predictable latency.

### 1.4 Key Decisions

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| k6 as primary tool | Native JavaScript, excellent metrics, Grafana integration | Gatling (JVM overhead), Locust (Python ecosystem) |
| Artillery for scenarios | YAML-based declarative tests, good for complex flows | JMeter (heavyweight), wrk (limited scenarios) |
| Custom harness | Fine-grained control for specific AuthZ patterns | Pure k6 (less flexibility for custom metrics) |
| Prometheus metrics | Native k6 support, existing observability stack | StatsD (additional infrastructure), InfluxDB (licensing) |

---

## 2. Requirements

### 2.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-001 | Execute load tests against REST API endpoints | Must Have | Pending |
| FR-002 | Execute load tests against gRPC endpoints | Must Have | Pending |
| FR-003 | Support batch authorization check scenarios | Must Have | Pending |
| FR-004 | Support streaming authorization scenarios | Should Have | Pending |
| FR-005 | Generate HTML performance reports | Must Have | Pending |
| FR-006 | Export metrics to Prometheus/Grafana | Must Have | Pending |
| FR-007 | Integrate with GitHub Actions CI/CD | Must Have | Pending |
| FR-008 | Generate performance badges | Should Have | Pending |
| FR-009 | Support custom test scenarios via configuration | Should Have | Pending |
| FR-010 | Automated baseline comparison | Should Have | Pending |

### 2.2 Non-Functional Requirements (Performance Targets)

| ID | Category | Requirement | Target |
|----|----------|-------------|--------|
| NFR-001 | Latency | P50 response time | < 1ms |
| NFR-002 | Latency | P90 response time | < 5ms |
| NFR-003 | Latency | P99 response time | < 10ms |
| NFR-004 | Latency | P99.9 response time | < 50ms |
| NFR-005 | Throughput | Authorization checks per second | >= 50,000 |
| NFR-006 | Throughput | Batch checks per second (100 resources) | >= 5,000 |
| NFR-007 | Error Rate | Error rate under normal load | 0% |
| NFR-008 | Error Rate | Error rate under 2x expected load | < 0.1% |
| NFR-009 | Stability | No memory leaks over 24-hour soak test | < 5% memory growth |
| NFR-010 | Recovery | Recovery time after overload | < 5 seconds |

### 2.3 SLA Compliance Targets

| SLA Tier | Max Latency (P99) | Min Throughput | Max Error Rate |
|----------|-------------------|----------------|----------------|
| Critical | 5ms | 100,000 checks/sec | 0% |
| Standard | 10ms | 50,000 checks/sec | 0.01% |
| Best Effort | 50ms | 10,000 checks/sec | 0.1% |

---

## 3. Architecture

### 3.1 Component Diagram

```
+------------------------------------------------------------------+
|                    Load Testing Suite                              |
+------------------------------------------------------------------+
|                                                                    |
|  +----------------+  +----------------+  +------------------+      |
|  |    k6 Core     |  |   Artillery    |  |  Custom Harness  |      |
|  |   (Primary)    |  |  (Scenarios)   |  |   (Specialized)  |      |
|  +-------+--------+  +-------+--------+  +--------+---------+      |
|          |                   |                    |                |
|          +---------+---------+---------+----------+                |
|                    |                                               |
|          +---------v---------+                                     |
|          |  Test Orchestrator |                                    |
|          +--------+----------+                                     |
|                   |                                                |
|     +-------------+-------------+                                  |
|     |             |             |                                  |
|  +--v---+    +----v----+   +----v----+                            |
|  | REST |    |  gRPC   |   |Streaming|                            |
|  |Target|    | Target  |   | Target  |                            |
|  +------+    +---------+   +---------+                            |
|                                                                    |
+------------------------------------------------------------------+
           |                    |                    |
           v                    v                    v
    +------------+      +-------------+      +------------+
    | Prometheus |      |  Grafana    |      |   HTML     |
    |  Metrics   |      | Dashboards  |      |  Reports   |
    +------------+      +-------------+      +------------+
```

### 3.2 Test Infrastructure

```
+------------------------------------------------------------------+
|                    CI/CD Pipeline                                  |
+------------------------------------------------------------------+
|                                                                    |
|  +-----------------+     +-----------------+                       |
|  | GitHub Actions  |---->| Test Runner     |                       |
|  | Workflow        |     | Container       |                       |
|  +-----------------+     +--------+--------+                       |
|                                   |                                |
|         +-------------------------+-------------------------+      |
|         |                         |                         |      |
|  +------v-------+         +-------v------+         +--------v---+  |
|  |  k6 Tests    |         | Artillery    |         | Harness    |  |
|  |  (baseline)  |         | (scenarios)  |         | (custom)   |  |
|  +--------------+         +--------------+         +------------+  |
|         |                         |                         |      |
|         +-------------------------+-------------------------+      |
|                                   |                                |
|                          +--------v--------+                       |
|                          | Results Aggregator                     |
|                          +--------+--------+                       |
|                                   |                                |
|         +-------------------------+-------------------------+      |
|         |                         |                         |      |
|  +------v-------+         +-------v------+         +--------v---+  |
|  |  Prometheus  |         |    HTML      |         |   Badge    |  |
|  |  Push        |         |   Report     |         | Generator  |  |
|  +--------------+         +--------------+         +------------+  |
|                                                                    |
+------------------------------------------------------------------+
```

### 3.3 Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| k6 Core | Execute load tests, collect metrics, generate reports |
| Artillery | Run scenario-based tests with complex user journeys |
| Custom Harness | Specialized tests for CEL evaluation, derived roles |
| Test Orchestrator | Coordinate test execution, manage parallel runs |
| Results Aggregator | Combine metrics from all tools, generate unified reports |
| Badge Generator | Create SVG badges for repository status |

### 3.4 Integration Points

| Integration | Protocol | Direction | Purpose |
|-------------|----------|-----------|---------|
| AuthZ REST API | HTTP/1.1 | Out | Test target |
| AuthZ gRPC API | HTTP/2 | Out | Test target |
| Prometheus | HTTP | Out | Metrics export |
| Grafana | HTTP | In | Dashboard queries |
| GitHub Actions | YAML | In/Out | CI/CD orchestration |

---

## 4. Test Scenarios

### 4.1 Single Check Requests

**Scenario:** High-frequency individual authorization checks

```yaml
# scenarios/single-check.yaml
name: "Single Authorization Check"
description: "Baseline performance for single check requests"

stages:
  - duration: "30s"
    target: 100        # Warm-up
  - duration: "2m"
    target: 5000       # Ramp to target
  - duration: "5m"
    target: 5000       # Sustained load
  - duration: "30s"
    target: 10000      # Spike test
  - duration: "1m"
    target: 5000       # Return to normal
  - duration: "30s"
    target: 0          # Cool-down

thresholds:
  http_req_duration:
    - "p(50) < 1"      # 1ms
    - "p(90) < 5"      # 5ms
    - "p(99) < 10"     # 10ms
  http_req_failed:
    - "rate < 0.001"   # 0.1%
  checks:
    - "rate > 0.999"   # 99.9% success
```

### 4.2 Batch Operations

**Scenario:** Bulk authorization checks for multiple resources

```yaml
# scenarios/batch-check.yaml
name: "Batch Authorization Check"
description: "Performance for batch resource checks"

config:
  batch_sizes: [10, 50, 100, 500]
  resource_types: ["document", "subscription", "api_endpoint"]

stages:
  - duration: "1m"
    target: 100
  - duration: "3m"
    target: 1000
  - duration: "2m"
    target: 500
  - duration: "30s"
    target: 0

thresholds:
  http_req_duration:
    - "p(50) < 10"     # 10ms
    - "p(90) < 25"     # 25ms
    - "p(99) < 50"     # 50ms
  http_req_failed:
    - "rate < 0.001"
```

### 4.3 Streaming Authorization

**Scenario:** Long-lived streaming connections for real-time authorization

```yaml
# scenarios/streaming.yaml
name: "Streaming Authorization"
description: "Performance for streaming gRPC connections"

config:
  connection_duration: "5m"
  messages_per_second: 100
  concurrent_streams: 50

stages:
  - duration: "1m"
    target: 10
  - duration: "5m"
    target: 50
  - duration: "2m"
    target: 100
  - duration: "1m"
    target: 0

thresholds:
  grpc_req_duration:
    - "p(99) < 10"
  grpc_streams:
    - "count > 45"     # 90% streams maintained
```

### 4.4 Mixed Workload

**Scenario:** Realistic production traffic mix

```yaml
# scenarios/mixed-workload.yaml
name: "Mixed Workload"
description: "Simulates realistic production traffic patterns"

traffic_mix:
  single_check: 70%      # Most common
  batch_check: 20%       # Moderate
  plan_resources: 8%     # Less common
  streaming: 2%          # Rare

stages:
  - duration: "2m"
    target: 1000
  - duration: "10m"
    target: 5000
  - duration: "2m"
    target: 8000         # Peak
  - duration: "5m"
    target: 5000
  - duration: "1m"
    target: 0
```

### 4.5 Derived Roles Complexity

**Scenario:** Authorization with complex derived role evaluation

```yaml
# scenarios/derived-roles.yaml
name: "Derived Roles Performance"
description: "Impact of derived role complexity on latency"

config:
  derived_role_depth: [1, 3, 5, 10]
  conditions_per_role: [1, 5, 10]

thresholds:
  http_req_duration:
    - "p(99) < 20"     # Allow more time for complex evaluation
  cel_evaluation_duration:
    - "p(99) < 5"
```

---

## 5. Tools Configuration

### 5.1 k6 Configuration

```javascript
// k6/options.js
export const options = {
  scenarios: {
    baseline: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },
        { duration: '2m', target: 1000 },
        { duration: '5m', target: 1000 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
    spike: {
      executor: 'ramping-arrival-rate',
      startRate: 1000,
      timeUnit: '1s',
      preAllocatedVUs: 500,
      maxVUs: 2000,
      stages: [
        { duration: '1m', target: 1000 },
        { duration: '30s', target: 10000 },
        { duration: '1m', target: 1000 },
      ],
    },
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 500 },
        { duration: '5m', target: 500 },
        { duration: '2m', target: 1000 },
        { duration: '5m', target: 1000 },
        { duration: '2m', target: 2000 },
        { duration: '5m', target: 2000 },
        { duration: '2m', target: 0 },
      ],
    },
    soak: {
      executor: 'constant-vus',
      vus: 500,
      duration: '24h',
    },
  },
  thresholds: {
    http_req_duration: [
      'p(50) < 1',
      'p(90) < 5',
      'p(99) < 10',
      'p(99.9) < 50',
    ],
    http_req_failed: ['rate < 0.001'],
    checks: ['rate > 0.999'],
    'authz_checks_per_second': ['value > 50000'],
  },
  ext: {
    loadimpact: {
      projectID: process.env.K6_CLOUD_PROJECT_ID,
      name: 'AuthZ Engine Load Test',
    },
  },
};
```

### 5.2 k6 Test Script

```javascript
// k6/scripts/check-endpoint.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend, Gauge } from 'k6/metrics';
import { randomItem } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

// Custom metrics
const authzChecks = new Counter('authz_checks_total');
const authzAllowed = new Counter('authz_allowed_total');
const authzDenied = new Counter('authz_denied_total');
const authzErrors = new Counter('authz_errors_total');
const authzLatency = new Trend('authz_latency_ms', true);
const authzThroughput = new Gauge('authz_checks_per_second');

// Test data
const principals = [
  { id: 'user-001', roles: ['user'], attr: { department: 'engineering' } },
  { id: 'user-002', roles: ['admin'], attr: { department: 'operations' } },
  { id: 'user-003', roles: ['viewer'], attr: { department: 'sales' } },
];

const resources = [
  { kind: 'document', id: 'doc-001', attr: { owner: 'user-001', status: 'draft' } },
  { kind: 'document', id: 'doc-002', attr: { owner: 'user-002', status: 'published' } },
  { kind: 'subscription', id: 'sub-001', attr: { tier: 'premium' } },
];

const actions = ['read', 'write', 'delete', 'share'];

const BASE_URL = __ENV.AUTHZ_URL || 'http://localhost:3592';

export default function () {
  const principal = randomItem(principals);
  const resource = randomItem(resources);
  const action = randomItem(actions);

  const payload = JSON.stringify({
    principal,
    resource,
    action,
    requestId: `req-${__VU}-${__ITER}`,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': `k6-${__VU}-${__ITER}`,
    },
    tags: {
      resource_kind: resource.kind,
      action: action,
    },
  };

  const startTime = Date.now();
  const response = http.post(`${BASE_URL}/v1/check`, payload, params);
  const latency = Date.now() - startTime;

  // Record metrics
  authzChecks.add(1);
  authzLatency.add(latency);

  const success = check(response, {
    'status is 200': (r) => r.status === 200,
    'response has effect': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.effect !== undefined;
      } catch {
        return false;
      }
    },
    'latency < 10ms': () => latency < 10,
  });

  if (response.status === 200) {
    try {
      const body = JSON.parse(response.body);
      if (body.effect === 'EFFECT_ALLOW') {
        authzAllowed.add(1);
      } else {
        authzDenied.add(1);
      }
    } catch (e) {
      authzErrors.add(1);
    }
  } else {
    authzErrors.add(1);
  }

  // Calculate throughput
  if (__ITER > 0 && __ITER % 1000 === 0) {
    const elapsed = (Date.now() - __ENV.START_TIME) / 1000;
    authzThroughput.add(__ITER / elapsed);
  }

  sleep(0.01); // 10ms think time
}

export function setup() {
  // Verify server is ready
  const healthResponse = http.get(`${BASE_URL}/health/ready`);
  check(healthResponse, {
    'server is ready': (r) => r.status === 200,
  });

  return { startTime: Date.now() };
}

export function teardown(data) {
  const elapsed = (Date.now() - data.startTime) / 1000;
  console.log(`Test completed in ${elapsed.toFixed(2)} seconds`);
}

export function handleSummary(data) {
  return {
    'reports/summary.html': htmlReport(data),
    'reports/summary.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}
```

### 5.3 k6 Batch Check Script

```javascript
// k6/scripts/batch-check.js
import http from 'k6/http';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const batchLatency = new Trend('batch_latency_ms', true);
const batchSize = new Counter('batch_size_total');

const BASE_URL = __ENV.AUTHZ_URL || 'http://localhost:3592';

export const options = {
  scenarios: {
    batch_small: {
      executor: 'constant-vus',
      vus: 50,
      duration: '2m',
      env: { BATCH_SIZE: '10' },
      tags: { batch_size: '10' },
    },
    batch_medium: {
      executor: 'constant-vus',
      vus: 50,
      duration: '2m',
      startTime: '2m30s',
      env: { BATCH_SIZE: '50' },
      tags: { batch_size: '50' },
    },
    batch_large: {
      executor: 'constant-vus',
      vus: 50,
      duration: '2m',
      startTime: '5m',
      env: { BATCH_SIZE: '100' },
      tags: { batch_size: '100' },
    },
  },
  thresholds: {
    'batch_latency_ms{batch_size:10}': ['p(99) < 20'],
    'batch_latency_ms{batch_size:50}': ['p(99) < 50'],
    'batch_latency_ms{batch_size:100}': ['p(99) < 100'],
  },
};

export default function () {
  const batchSizeValue = parseInt(__ENV.BATCH_SIZE || '10');

  const resources = Array.from({ length: batchSizeValue }, (_, i) => ({
    resource: {
      kind: 'document',
      id: `doc-${i}`,
      attr: { index: i },
    },
    actions: ['read', 'write'],
  }));

  const payload = JSON.stringify({
    principal: {
      id: 'batch-user',
      roles: ['user'],
      attr: {},
    },
    resources,
    requestId: `batch-${__VU}-${__ITER}`,
  });

  const params = {
    headers: { 'Content-Type': 'application/json' },
    tags: { batch_size: batchSizeValue.toString() },
  };

  const startTime = Date.now();
  const response = http.post(`${BASE_URL}/v1/check/resources`, payload, params);
  const latency = Date.now() - startTime;

  batchLatency.add(latency, { batch_size: batchSizeValue.toString() });
  batchSize.add(batchSizeValue);

  check(response, {
    'batch status is 200': (r) => r.status === 200,
    'all resources processed': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.results && body.results.length === batchSizeValue;
      } catch {
        return false;
      }
    },
  });
}
```

### 5.4 Artillery Configuration

```yaml
# artillery/config.yaml
config:
  target: "http://localhost:3592"
  phases:
    - duration: 60
      arrivalRate: 10
      name: "Warm up"
    - duration: 120
      arrivalRate: 50
      rampTo: 200
      name: "Ramp up load"
    - duration: 300
      arrivalRate: 200
      name: "Sustained load"
    - duration: 60
      arrivalRate: 200
      rampTo: 500
      name: "Spike"
    - duration: 120
      arrivalRate: 200
      name: "Cool down"

  plugins:
    expect: {}
    metrics-by-endpoint: {}

  defaults:
    headers:
      Content-Type: "application/json"
      X-Request-ID: "artillery-{{ $uuid }}"

  variables:
    principals:
      - id: "user-001"
        roles: ["user"]
      - id: "admin-001"
        roles: ["admin"]
      - id: "viewer-001"
        roles: ["viewer"]

    resources:
      - kind: "document"
        id: "doc-001"
      - kind: "subscription"
        id: "sub-001"
      - kind: "api_endpoint"
        id: "api-001"

    actions:
      - "read"
      - "write"
      - "delete"
      - "share"

  ensure:
    p50: 1
    p95: 5
    p99: 10
    maxErrorRate: 0.1

scenarios:
  - name: "Single Check Flow"
    weight: 70
    flow:
      - post:
          url: "/v1/check"
          json:
            principal: "{{ $randomItem(principals) }}"
            resource: "{{ $randomItem(resources) }}"
            action: "{{ $randomItem(actions) }}"
            requestId: "{{ $uuid }}"
          expect:
            - statusCode: 200
            - hasProperty: "effect"
          capture:
            - json: "$.effect"
              as: "decision"

  - name: "Batch Check Flow"
    weight: 20
    flow:
      - post:
          url: "/v1/check/resources"
          json:
            principal:
              id: "batch-user"
              roles: ["user"]
            resources:
              - resource:
                  kind: "document"
                  id: "doc-batch-1"
                actions: ["read", "write"]
              - resource:
                  kind: "document"
                  id: "doc-batch-2"
                actions: ["read", "write"]
              - resource:
                  kind: "subscription"
                  id: "sub-batch-1"
                actions: ["view"]
          expect:
            - statusCode: 200
            - hasProperty: "results"

  - name: "Health Check"
    weight: 5
    flow:
      - get:
          url: "/health/ready"
          expect:
            - statusCode: 200

  - name: "Explain Decision"
    weight: 5
    flow:
      - post:
          url: "/v1/explain"
          json:
            principal:
              id: "explain-user"
              roles: ["user"]
            resource:
              kind: "document"
              id: "doc-explain"
            action: "delete"
          expect:
            - statusCode: 200
            - hasProperty: "explanation"
```

### 5.5 Artillery Scenario Configuration

```yaml
# artillery/scenarios/complex-flow.yaml
config:
  target: "http://localhost:3592"
  phases:
    - duration: 300
      arrivalRate: 100

  payload:
    path: "./data/test-principals.csv"
    fields:
      - "principalId"
      - "roles"
      - "department"
    loadAll: true

scenarios:
  - name: "Complete User Journey"
    flow:
      # Step 1: Check if user can view dashboard
      - post:
          url: "/v1/check"
          json:
            principal:
              id: "{{ principalId }}"
              roles: "{{ roles }}"
              attr:
                department: "{{ department }}"
            resource:
              kind: "dashboard"
              id: "main-dashboard"
            action: "view"
          capture:
            - json: "$.effect"
              as: "dashboardAccess"

      # Step 2: If allowed, check document access
      - think: 0.5
      - post:
          url: "/v1/check/resources"
          json:
            principal:
              id: "{{ principalId }}"
              roles: "{{ roles }}"
            resources:
              - resource:
                  kind: "document"
                  id: "doc-1"
                actions: ["read", "edit", "delete"]
              - resource:
                  kind: "document"
                  id: "doc-2"
                actions: ["read", "edit", "delete"]
          ifTrue: "dashboardAccess === 'EFFECT_ALLOW'"

      # Step 3: Admin-specific flow
      - think: 0.2
      - post:
          url: "/v1/check"
          json:
            principal:
              id: "{{ principalId }}"
              roles: "{{ roles }}"
            resource:
              kind: "admin_panel"
              id: "settings"
            action: "access"
          ifTrue: "roles.includes('admin')"
```

### 5.6 Custom Test Harness

```typescript
// harness/src/index.ts
import { AuthzClient } from '@authz-engine/sdk-typescript';
import { performance } from 'perf_hooks';
import { createHistogram, Counter, Histogram } from 'prom-client';

interface HarnessConfig {
  targetUrl: string;
  concurrency: number;
  duration: number; // seconds
  warmupDuration: number;
  rampUpDuration: number;
  scenarios: ScenarioConfig[];
}

interface ScenarioConfig {
  name: string;
  weight: number;
  generator: RequestGenerator;
}

interface RequestGenerator {
  generate(): CheckRequest;
}

interface TestResults {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  latencyPercentiles: {
    p50: number;
    p90: number;
    p99: number;
    p999: number;
  };
  throughput: number;
  errorRate: number;
  duration: number;
}

class LoadTestHarness {
  private client: AuthzClient;
  private config: HarnessConfig;
  private latencies: number[] = [];
  private errors: Error[] = [];
  private startTime: number = 0;
  private requestCount = 0;
  private successCount = 0;
  private running = false;

  constructor(config: HarnessConfig) {
    this.config = config;
    this.client = new AuthzClient({
      serverUrl: config.targetUrl,
      timeout: 5000,
      retry: { maxRetries: 0 }, // No retries for load testing
    });
  }

  async run(): Promise<TestResults> {
    console.log('Starting load test harness...');

    // Warmup phase
    console.log(`Warmup: ${this.config.warmupDuration}s`);
    await this.runPhase(this.config.warmupDuration, this.config.concurrency / 4);
    this.reset();

    // Ramp-up phase
    console.log(`Ramp-up: ${this.config.rampUpDuration}s`);
    await this.runRampUp();

    // Main test phase
    console.log(`Main test: ${this.config.duration}s`);
    this.startTime = performance.now();
    this.running = true;
    await this.runPhase(this.config.duration, this.config.concurrency);
    this.running = false;

    return this.calculateResults();
  }

  private async runPhase(duration: number, concurrency: number): Promise<void> {
    const endTime = Date.now() + duration * 1000;
    const workers: Promise<void>[] = [];

    for (let i = 0; i < concurrency; i++) {
      workers.push(this.worker(endTime));
    }

    await Promise.all(workers);
  }

  private async runRampUp(): Promise<void> {
    const steps = 10;
    const stepDuration = this.config.rampUpDuration / steps;
    const stepConcurrency = this.config.concurrency / steps;

    for (let i = 1; i <= steps; i++) {
      await this.runPhase(stepDuration, stepConcurrency * i);
    }
  }

  private async worker(endTime: number): Promise<void> {
    while (Date.now() < endTime) {
      const scenario = this.selectScenario();
      const request = scenario.generator.generate();

      const start = performance.now();
      try {
        await this.client.check(request);
        const latency = performance.now() - start;
        this.latencies.push(latency);
        this.successCount++;
      } catch (error) {
        this.errors.push(error as Error);
      }
      this.requestCount++;
    }
  }

  private selectScenario(): ScenarioConfig {
    const totalWeight = this.config.scenarios.reduce((sum, s) => sum + s.weight, 0);
    let random = Math.random() * totalWeight;

    for (const scenario of this.config.scenarios) {
      random -= scenario.weight;
      if (random <= 0) {
        return scenario;
      }
    }

    return this.config.scenarios[0];
  }

  private reset(): void {
    this.latencies = [];
    this.errors = [];
    this.requestCount = 0;
    this.successCount = 0;
  }

  private calculateResults(): TestResults {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const duration = (performance.now() - this.startTime) / 1000;

    return {
      totalRequests: this.requestCount,
      successfulRequests: this.successCount,
      failedRequests: this.requestCount - this.successCount,
      latencyPercentiles: {
        p50: this.percentile(sorted, 50),
        p90: this.percentile(sorted, 90),
        p99: this.percentile(sorted, 99),
        p999: this.percentile(sorted, 99.9),
      },
      throughput: this.requestCount / duration,
      errorRate: (this.requestCount - this.successCount) / this.requestCount,
      duration,
    };
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
}

// Request Generators
class SingleCheckGenerator implements RequestGenerator {
  private principals = [
    { id: 'user-1', roles: ['user'], attr: { dept: 'eng' } },
    { id: 'admin-1', roles: ['admin'], attr: { dept: 'ops' } },
  ];

  private resources = [
    { kind: 'document', id: 'doc-1', attr: { owner: 'user-1' } },
    { kind: 'subscription', id: 'sub-1', attr: { tier: 'pro' } },
  ];

  private actions = ['read', 'write', 'delete', 'share'];

  generate(): CheckRequest {
    return {
      principal: this.principals[Math.floor(Math.random() * this.principals.length)],
      resource: this.resources[Math.floor(Math.random() * this.resources.length)],
      action: this.actions[Math.floor(Math.random() * this.actions.length)],
    };
  }
}

class DerivedRolesGenerator implements RequestGenerator {
  generate(): CheckRequest {
    return {
      principal: {
        id: `user-${Math.floor(Math.random() * 1000)}`,
        roles: ['user'],
        attr: {
          department: 'engineering',
          level: Math.floor(Math.random() * 5) + 1,
          team: `team-${Math.floor(Math.random() * 10)}`,
        },
      },
      resource: {
        kind: 'project',
        id: `project-${Math.floor(Math.random() * 100)}`,
        attr: {
          department: 'engineering',
          sensitivity: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
        },
      },
      action: 'access',
    };
  }
}

export { LoadTestHarness, HarnessConfig, SingleCheckGenerator, DerivedRolesGenerator };
```

---

## 6. Metrics Collection

### 6.1 Core Metrics

| Metric Name | Type | Labels | Description |
|-------------|------|--------|-------------|
| `authz_load_test_requests_total` | Counter | `scenario`, `status` | Total requests executed |
| `authz_load_test_latency_seconds` | Histogram | `scenario`, `percentile` | Request latency distribution |
| `authz_load_test_errors_total` | Counter | `scenario`, `error_type` | Total errors by type |
| `authz_load_test_throughput` | Gauge | `scenario` | Requests per second |
| `authz_load_test_active_vus` | Gauge | - | Active virtual users |
| `authz_load_test_data_sent_bytes` | Counter | - | Total bytes sent |
| `authz_load_test_data_received_bytes` | Counter | - | Total bytes received |

### 6.2 Latency Percentile Buckets

```javascript
// Histogram buckets optimized for sub-millisecond precision
const latencyBuckets = [
  0.0001,  // 0.1ms
  0.0005,  // 0.5ms
  0.001,   // 1ms   (P50 target)
  0.002,   // 2ms
  0.005,   // 5ms   (P90 target)
  0.010,   // 10ms  (P99 target)
  0.025,   // 25ms
  0.050,   // 50ms  (P99.9 target)
  0.100,   // 100ms
  0.250,   // 250ms
  0.500,   // 500ms
  1.000,   // 1s
];
```

### 6.3 Prometheus Export Configuration

```yaml
# prometheus/scrape-config.yaml
scrape_configs:
  - job_name: 'k6-load-test'
    static_configs:
      - targets: ['localhost:5656']
    metrics_path: '/metrics'
    scrape_interval: 5s

  - job_name: 'authz-engine'
    static_configs:
      - targets: ['localhost:9090']
    metrics_path: '/metrics'
    scrape_interval: 10s
```

### 6.4 Metrics Aggregation Script

```typescript
// metrics/aggregator.ts
interface AggregatedMetrics {
  timestamp: Date;
  duration: number;
  requests: {
    total: number;
    successful: number;
    failed: number;
    rate: number;
  };
  latency: {
    min: number;
    max: number;
    mean: number;
    median: number;
    p90: number;
    p95: number;
    p99: number;
    p999: number;
    stdDev: number;
  };
  throughput: {
    current: number;
    peak: number;
    average: number;
  };
  errors: {
    total: number;
    rate: number;
    byType: Record<string, number>;
  };
  thresholds: {
    passed: boolean;
    failures: ThresholdFailure[];
  };
}

interface ThresholdFailure {
  metric: string;
  threshold: string;
  actual: number;
  expected: number;
}

class MetricsAggregator {
  private k6Results: K6Results;
  private artilleryResults: ArtilleryResults;
  private harnessResults: HarnessResults;

  aggregate(): AggregatedMetrics {
    return {
      timestamp: new Date(),
      duration: this.calculateTotalDuration(),
      requests: this.aggregateRequests(),
      latency: this.aggregateLatency(),
      throughput: this.aggregateThroughput(),
      errors: this.aggregateErrors(),
      thresholds: this.checkThresholds(),
    };
  }

  private aggregateLatency(): AggregatedMetrics['latency'] {
    const allLatencies = [
      ...this.k6Results.latencies,
      ...this.artilleryResults.latencies,
      ...this.harnessResults.latencies,
    ].sort((a, b) => a - b);

    return {
      min: allLatencies[0] || 0,
      max: allLatencies[allLatencies.length - 1] || 0,
      mean: this.mean(allLatencies),
      median: this.percentile(allLatencies, 50),
      p90: this.percentile(allLatencies, 90),
      p95: this.percentile(allLatencies, 95),
      p99: this.percentile(allLatencies, 99),
      p999: this.percentile(allLatencies, 99.9),
      stdDev: this.standardDeviation(allLatencies),
    };
  }

  private checkThresholds(): AggregatedMetrics['thresholds'] {
    const failures: ThresholdFailure[] = [];
    const latency = this.aggregateLatency();
    const errors = this.aggregateErrors();

    // P50 < 1ms
    if (latency.median > 1) {
      failures.push({
        metric: 'latency.p50',
        threshold: '< 1ms',
        actual: latency.median,
        expected: 1,
      });
    }

    // P99 < 10ms
    if (latency.p99 > 10) {
      failures.push({
        metric: 'latency.p99',
        threshold: '< 10ms',
        actual: latency.p99,
        expected: 10,
      });
    }

    // Error rate < 0.1%
    if (errors.rate > 0.001) {
      failures.push({
        metric: 'errors.rate',
        threshold: '< 0.1%',
        actual: errors.rate * 100,
        expected: 0.1,
      });
    }

    return {
      passed: failures.length === 0,
      failures,
    };
  }

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private standardDeviation(values: number[]): number {
    const avg = this.mean(values);
    const squareDiffs = values.map((v) => Math.pow(v - avg, 2));
    return Math.sqrt(this.mean(squareDiffs));
  }
}
```

---

## 7. Baseline Benchmarks

### 7.1 Performance Targets

| Operation | Metric | Target | Acceptable | Critical |
|-----------|--------|--------|------------|----------|
| Single Check | P50 | < 0.5ms | < 1ms | > 5ms |
| Single Check | P99 | < 5ms | < 10ms | > 50ms |
| Single Check | Throughput | > 50,000/s | > 25,000/s | < 10,000/s |
| Batch Check (100) | P50 | < 10ms | < 25ms | > 100ms |
| Batch Check (100) | P99 | < 50ms | < 100ms | > 500ms |
| Batch Check (100) | Throughput | > 5,000/s | > 2,500/s | < 1,000/s |
| Derived Roles | P50 | < 1ms | < 2ms | > 10ms |
| Derived Roles | P99 | < 10ms | < 25ms | > 100ms |
| CEL Evaluation | P50 | < 0.1ms | < 0.5ms | > 2ms |
| CEL Evaluation | P99 | < 1ms | < 5ms | > 20ms |

### 7.2 Baseline Test Configuration

```yaml
# baseline/config.yaml
name: "Baseline Performance Test"
version: "1.0.0"

environment:
  cpu: 4 cores
  memory: 8GB
  network: localhost (no network latency)
  policies: 100 resource policies, 20 derived roles

tests:
  - name: "single_check_baseline"
    duration: 5m
    concurrency: 100
    target_rps: 10000
    thresholds:
      p50: 0.5ms
      p99: 5ms
      errors: 0%

  - name: "batch_check_baseline"
    duration: 5m
    concurrency: 50
    batch_size: 100
    target_rps: 1000
    thresholds:
      p50: 10ms
      p99: 50ms
      errors: 0%

  - name: "throughput_max"
    duration: 2m
    concurrency: 500
    target: max
    measure: requests_per_second
    expected: "> 50000"

reporting:
  format: ["json", "html", "prometheus"]
  output_dir: "./reports/baseline"
  compare_to: "./reports/baseline/previous.json"
```

### 7.3 Baseline Comparison Script

```typescript
// baseline/compare.ts
interface BaselineComparison {
  current: BaselineResults;
  previous: BaselineResults;
  regressions: Regression[];
  improvements: Improvement[];
  verdict: 'pass' | 'fail' | 'warning';
}

interface Regression {
  metric: string;
  previousValue: number;
  currentValue: number;
  percentChange: number;
  severity: 'minor' | 'major' | 'critical';
}

const REGRESSION_THRESHOLDS = {
  latency_p50: { minor: 10, major: 25, critical: 50 }, // percentage increase
  latency_p99: { minor: 15, major: 30, critical: 50 },
  throughput: { minor: -5, major: -15, critical: -25 }, // percentage decrease
  error_rate: { minor: 0.01, major: 0.1, critical: 1 }, // absolute increase
};

function compareBaselines(current: BaselineResults, previous: BaselineResults): BaselineComparison {
  const regressions: Regression[] = [];
  const improvements: Improvement[] = [];

  // Compare P50 latency
  const p50Change = ((current.latency.p50 - previous.latency.p50) / previous.latency.p50) * 100;
  if (p50Change > REGRESSION_THRESHOLDS.latency_p50.minor) {
    regressions.push({
      metric: 'latency_p50',
      previousValue: previous.latency.p50,
      currentValue: current.latency.p50,
      percentChange: p50Change,
      severity: getSeverity(p50Change, REGRESSION_THRESHOLDS.latency_p50),
    });
  } else if (p50Change < -10) {
    improvements.push({
      metric: 'latency_p50',
      previousValue: previous.latency.p50,
      currentValue: current.latency.p50,
      percentChange: p50Change,
    });
  }

  // Compare throughput
  const throughputChange = ((current.throughput - previous.throughput) / previous.throughput) * 100;
  if (throughputChange < REGRESSION_THRESHOLDS.throughput.minor) {
    regressions.push({
      metric: 'throughput',
      previousValue: previous.throughput,
      currentValue: current.throughput,
      percentChange: throughputChange,
      severity: getSeverity(-throughputChange, {
        minor: 5,
        major: 15,
        critical: 25,
      }),
    });
  }

  // Determine verdict
  const hasCritical = regressions.some((r) => r.severity === 'critical');
  const hasMajor = regressions.some((r) => r.severity === 'major');

  return {
    current,
    previous,
    regressions,
    improvements,
    verdict: hasCritical ? 'fail' : hasMajor ? 'warning' : 'pass',
  };
}
```

---

## 8. Stress Testing

### 8.1 Breaking Point Analysis

```javascript
// k6/scripts/stress-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const errorRate = new Rate('error_rate');
const breakingPointReached = new Counter('breaking_point_reached');

export const options = {
  stages: [
    // Initial baseline
    { duration: '2m', target: 1000 },
    // Gradual increase
    { duration: '5m', target: 5000 },
    { duration: '5m', target: 10000 },
    { duration: '5m', target: 20000 },
    { duration: '5m', target: 30000 },
    { duration: '5m', target: 40000 },
    { duration: '5m', target: 50000 },
    // Beyond expected capacity
    { duration: '5m', target: 75000 },
    { duration: '5m', target: 100000 },
    // Recovery
    { duration: '5m', target: 50000 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    // Track but don't fail - we want to find the breaking point
    'error_rate': ['rate < 1'], // Will be exceeded
    'http_req_duration': ['p(99) < 1000'], // Will be exceeded
  },
};

let breakingPointVUs = null;
let breakingPointTimestamp = null;

export default function () {
  const response = http.post(
    `${__ENV.AUTHZ_URL}/v1/check`,
    JSON.stringify({
      principal: { id: 'stress-user', roles: ['user'], attr: {} },
      resource: { kind: 'document', id: 'doc-stress', attr: {} },
      action: 'read',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  const success = check(response, {
    'status is 200': (r) => r.status === 200,
    'latency < 100ms': (r) => r.timings.duration < 100,
  });

  errorRate.add(!success);

  // Detect breaking point
  if (!success && !breakingPointVUs) {
    breakingPointVUs = __VU;
    breakingPointTimestamp = new Date().toISOString();
    breakingPointReached.add(1);
    console.log(`Breaking point detected at ${__VU} VUs`);
  }
}

export function handleSummary(data) {
  const summary = {
    breakingPoint: {
      vus: breakingPointVUs,
      timestamp: breakingPointTimestamp,
      detected: breakingPointVUs !== null,
    },
    maxVUs: data.metrics.vus_max?.values?.max || 0,
    peakThroughput: data.metrics.http_reqs?.values?.rate || 0,
    errorRateAtBreaking: data.metrics.error_rate?.values?.rate || 0,
    latencyAtBreaking: {
      p50: data.metrics.http_req_duration?.values?.['p(50)'],
      p99: data.metrics.http_req_duration?.values?.['p(99)'],
    },
  };

  return {
    'reports/stress-test-summary.json': JSON.stringify(summary, null, 2),
    stdout: `
Breaking Point Analysis
=======================
Breaking Point VUs: ${summary.breakingPoint.vus || 'Not reached'}
Max VUs Tested: ${summary.maxVUs}
Peak Throughput: ${summary.peakThroughput.toFixed(2)} req/s
Error Rate at Breaking: ${(summary.errorRateAtBreaking * 100).toFixed(2)}%
P99 Latency at Breaking: ${summary.latencyAtBreaking.p99?.toFixed(2) || 'N/A'}ms
`,
  };
}
```

### 8.2 Recovery Testing

```javascript
// k6/scripts/recovery-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const recoveryTime = new Trend('recovery_time_seconds');
const overloadDetected = new Counter('overload_detected');
const recoveryDetected = new Counter('recovery_detected');

export const options = {
  stages: [
    // Baseline
    { duration: '1m', target: 1000 },
    // Overload
    { duration: '2m', target: 100000 },
    // Recovery period
    { duration: '5m', target: 1000 },
    // Verify stable
    { duration: '2m', target: 1000 },
  ],
  thresholds: {
    'recovery_time_seconds': ['p(99) < 10'], // Recovery within 10 seconds
  },
};

let overloadStarted = null;
let isOverloaded = false;
let recoveryStarted = null;

export default function () {
  const startTime = Date.now();
  const response = http.post(
    `${__ENV.AUTHZ_URL}/v1/check`,
    JSON.stringify({
      principal: { id: 'recovery-user', roles: ['user'], attr: {} },
      resource: { kind: 'document', id: 'doc-recovery', attr: {} },
      action: 'read',
    }),
    { headers: { 'Content-Type': 'application/json' }, timeout: '5s' }
  );

  const success = response.status === 200 && response.timings.duration < 100;

  // Detect overload
  if (!success && !isOverloaded) {
    isOverloaded = true;
    overloadStarted = Date.now();
    overloadDetected.add(1);
    console.log('System entered overload state');
  }

  // Detect recovery
  if (success && isOverloaded && !recoveryStarted) {
    // Need consistent success before declaring recovery
    if (__ITER % 100 === 0) {
      recoveryStarted = Date.now();
      const recoveryTimeMs = recoveryStarted - overloadStarted;
      recoveryTime.add(recoveryTimeMs / 1000);
      recoveryDetected.add(1);
      console.log(`System recovered in ${(recoveryTimeMs / 1000).toFixed(2)}s`);
      isOverloaded = false;
    }
  }
}

export function handleSummary(data) {
  return {
    'reports/recovery-test-summary.json': JSON.stringify({
      overloadEvents: data.metrics.overload_detected?.values?.count || 0,
      recoveryEvents: data.metrics.recovery_detected?.values?.count || 0,
      avgRecoveryTime: data.metrics.recovery_time_seconds?.values?.avg || 0,
      maxRecoveryTime: data.metrics.recovery_time_seconds?.values?.max || 0,
      p99RecoveryTime: data.metrics.recovery_time_seconds?.values?.['p(99)'] || 0,
    }, null, 2),
  };
}
```

### 8.3 Graceful Degradation Testing

```javascript
// k6/scripts/degradation-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const degradedResponses = new Counter('degraded_responses');
const fullResponses = new Counter('full_responses');
const responseCompleteness = new Trend('response_completeness');

export const options = {
  stages: [
    { duration: '1m', target: 1000 },
    { duration: '3m', target: 25000 },
    { duration: '5m', target: 50000 },
    { duration: '5m', target: 75000 },
    { duration: '3m', target: 1000 },
  ],
};

export default function () {
  const response = http.post(
    `${__ENV.AUTHZ_URL}/v1/check`,
    JSON.stringify({
      principal: { id: 'degradation-user', roles: ['user'], attr: {} },
      resource: { kind: 'document', id: 'doc-degrade', attr: {} },
      action: 'read',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (response.status === 200) {
    try {
      const body = JSON.parse(response.body);

      // Check for degraded response indicators
      if (body.degraded || body.cached || !body.metadata) {
        degradedResponses.add(1);
        responseCompleteness.add(0.5);
      } else {
        fullResponses.add(1);
        responseCompleteness.add(1.0);
      }

      // Verify decision is still valid even if degraded
      check(response, {
        'has valid effect': () =>
          body.effect === 'EFFECT_ALLOW' || body.effect === 'EFFECT_DENY',
        'response within SLA': () => response.timings.duration < 50,
      });
    } catch {
      responseCompleteness.add(0);
    }
  } else if (response.status === 429) {
    // Rate limited - acceptable degradation
    degradedResponses.add(1);
    responseCompleteness.add(0.3);
  } else {
    responseCompleteness.add(0);
  }
}
```

---

## 9. Soak Testing

### 9.1 Long-Running Stability Test

```javascript
// k6/scripts/soak-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Gauge, Trend } from 'k6/metrics';

const memoryUsage = new Gauge('server_memory_usage_mb');
const cpuUsage = new Gauge('server_cpu_percent');
const connectionCount = new Gauge('active_connections');
const gcPauses = new Counter('gc_pause_events');

export const options = {
  stages: [
    { duration: '10m', target: 1000 },  // Ramp up
    { duration: '23h30m', target: 1000 }, // Sustained load
    { duration: '20m', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(99) < 20'],  // Slightly relaxed for long run
    http_req_failed: ['rate < 0.001'],
    'server_memory_usage_mb': ['value < 2048'], // 2GB max
  },
};

// Poll server metrics every minute
let lastMetricsPoll = 0;
const METRICS_INTERVAL = 60000; // 1 minute

export default function () {
  const response = http.post(
    `${__ENV.AUTHZ_URL}/v1/check`,
    JSON.stringify({
      principal: {
        id: `soak-user-${__VU}`,
        roles: ['user'],
        attr: { iteration: __ITER }
      },
      resource: {
        kind: 'document',
        id: `doc-soak-${__ITER % 1000}`,
        attr: {}
      },
      action: ['read', 'write', 'delete'][__ITER % 3],
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(response, {
    'status is 200': (r) => r.status === 200,
    'latency ok': (r) => r.timings.duration < 20,
  });

  // Poll server metrics periodically
  const now = Date.now();
  if (now - lastMetricsPoll > METRICS_INTERVAL) {
    pollServerMetrics();
    lastMetricsPoll = now;
  }

  sleep(0.1); // 100ms between requests per VU
}

function pollServerMetrics() {
  try {
    const metricsResponse = http.get(`${__ENV.AUTHZ_URL}/metrics`);
    if (metricsResponse.status === 200) {
      const metrics = parsePrometheusMetrics(metricsResponse.body);

      if (metrics.process_resident_memory_bytes) {
        memoryUsage.add(metrics.process_resident_memory_bytes / (1024 * 1024));
      }
      if (metrics.process_cpu_seconds_total) {
        cpuUsage.add(metrics.process_cpu_seconds_total);
      }
      if (metrics.nodejs_active_handles_total) {
        connectionCount.add(metrics.nodejs_active_handles_total);
      }
      if (metrics.nodejs_gc_duration_seconds_count) {
        gcPauses.add(metrics.nodejs_gc_duration_seconds_count);
      }
    }
  } catch (e) {
    console.log(`Failed to poll metrics: ${e.message}`);
  }
}

function parsePrometheusMetrics(body) {
  const metrics = {};
  const lines = body.split('\n');

  for (const line of lines) {
    if (line.startsWith('#') || !line.trim()) continue;
    const match = line.match(/^(\w+)(?:\{[^}]*\})?\s+([\d.e+-]+)/);
    if (match) {
      metrics[match[1]] = parseFloat(match[2]);
    }
  }

  return metrics;
}

export function handleSummary(data) {
  const hourlyStats = calculateHourlyStats(data);

  return {
    'reports/soak-test-summary.json': JSON.stringify({
      duration: '24h',
      totalRequests: data.metrics.http_reqs?.values?.count || 0,
      avgThroughput: data.metrics.http_reqs?.values?.rate || 0,
      errorRate: data.metrics.http_req_failed?.values?.rate || 0,
      latency: {
        p50: data.metrics.http_req_duration?.values?.['p(50)'],
        p99: data.metrics.http_req_duration?.values?.['p(99)'],
      },
      memoryTrend: {
        start: hourlyStats.memory[0],
        end: hourlyStats.memory[hourlyStats.memory.length - 1],
        max: Math.max(...hourlyStats.memory),
        growthPercent: calculateGrowthPercent(hourlyStats.memory),
      },
      hourlyStats,
    }, null, 2),
  };
}

function calculateHourlyStats(data) {
  // Implementation to track hourly metric snapshots
  return {
    memory: [],
    latency: [],
    throughput: [],
    errors: [],
  };
}

function calculateGrowthPercent(values) {
  if (values.length < 2) return 0;
  return ((values[values.length - 1] - values[0]) / values[0]) * 100;
}
```

### 9.2 Memory Leak Detection

```typescript
// soak/memory-analysis.ts
interface MemorySample {
  timestamp: Date;
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
}

interface LeakAnalysis {
  hasLeak: boolean;
  confidence: number;
  growthRatePerHour: number;
  projectedMemoryAt24h: number;
  recommendation: string;
}

function analyzeMemoryLeak(samples: MemorySample[]): LeakAnalysis {
  if (samples.length < 10) {
    return {
      hasLeak: false,
      confidence: 0,
      growthRatePerHour: 0,
      projectedMemoryAt24h: 0,
      recommendation: 'Insufficient data for analysis',
    };
  }

  // Linear regression on heap usage
  const xValues = samples.map((s, i) => i);
  const yValues = samples.map((s) => s.heapUsed);
  const regression = linearRegression(xValues, yValues);

  // Calculate growth rate (samples are typically 1 minute apart)
  const growthPerSample = regression.slope;
  const growthPerHour = growthPerSample * 60;
  const projectedGrowth = growthPerHour * 24;

  const initialMemory = samples[0].heapUsed;
  const projectedMemoryAt24h = initialMemory + projectedGrowth;

  // Determine if this constitutes a leak
  const growthPercent = (projectedGrowth / initialMemory) * 100;
  const hasLeak = growthPercent > 5; // More than 5% growth over 24h

  return {
    hasLeak,
    confidence: regression.rSquared,
    growthRatePerHour: growthPerHour / (1024 * 1024), // Convert to MB
    projectedMemoryAt24h: projectedMemoryAt24h / (1024 * 1024),
    recommendation: hasLeak
      ? `Memory leak detected: ~${(growthPerHour / (1024 * 1024)).toFixed(2)}MB/hour growth. Investigate heap snapshots.`
      : 'Memory usage is stable within acceptable bounds.',
  };
}

function linearRegression(x: number[], y: number[]) {
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
  const sumY2 = y.reduce((acc, yi) => acc + yi * yi, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // R-squared
  const yMean = sumY / n;
  const ssTotal = y.reduce((acc, yi) => acc + Math.pow(yi - yMean, 2), 0);
  const ssResidual = y.reduce((acc, yi, i) => {
    const predicted = slope * x[i] + intercept;
    return acc + Math.pow(yi - predicted, 2);
  }, 0);
  const rSquared = 1 - ssResidual / ssTotal;

  return { slope, intercept, rSquared };
}
```

---

## 10. Reporting

### 10.1 HTML Report Template

```html
<!-- reports/template.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AuthZ Engine Load Test Report</title>
  <style>
    :root {
      --primary: #2563eb;
      --success: #16a34a;
      --warning: #d97706;
      --danger: #dc2626;
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --text: #1e293b;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 20px;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
    }

    .header {
      text-align: center;
      margin-bottom: 40px;
    }

    .header h1 {
      font-size: 2.5rem;
      margin-bottom: 10px;
    }

    .status-badge {
      display: inline-block;
      padding: 8px 24px;
      border-radius: 9999px;
      font-weight: 600;
      font-size: 1.1rem;
    }

    .status-pass { background: var(--success); color: white; }
    .status-fail { background: var(--danger); color: white; }
    .status-warning { background: var(--warning); color: white; }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }

    .metric-card {
      background: var(--card-bg);
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    .metric-card h3 {
      font-size: 0.875rem;
      color: #64748b;
      margin: 0 0 8px 0;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .metric-value {
      font-size: 2rem;
      font-weight: 700;
      margin-bottom: 8px;
    }

    .metric-target {
      font-size: 0.875rem;
      color: #64748b;
    }

    .chart-container {
      background: var(--card-bg);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    .threshold-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
    }

    .threshold-table th,
    .threshold-table td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #e2e8f0;
    }

    .threshold-table th {
      background: #f1f5f9;
      font-weight: 600;
    }

    .pass { color: var(--success); }
    .fail { color: var(--danger); }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
  <div class="container">
    <header class="header">
      <h1>AuthZ Engine Load Test Report</h1>
      <p>Generated: {{timestamp}}</p>
      <p>Duration: {{duration}}</p>
      <span class="status-badge status-{{status}}">{{statusText}}</span>
    </header>

    <section class="metrics-grid">
      <div class="metric-card">
        <h3>Total Requests</h3>
        <div class="metric-value">{{totalRequests}}</div>
        <div class="metric-target">{{requestsPerSecond}} req/s</div>
      </div>

      <div class="metric-card">
        <h3>P50 Latency</h3>
        <div class="metric-value {{p50Status}}">{{p50}}ms</div>
        <div class="metric-target">Target: < 1ms</div>
      </div>

      <div class="metric-card">
        <h3>P99 Latency</h3>
        <div class="metric-value {{p99Status}}">{{p99}}ms</div>
        <div class="metric-target">Target: < 10ms</div>
      </div>

      <div class="metric-card">
        <h3>Error Rate</h3>
        <div class="metric-value {{errorStatus}}">{{errorRate}}%</div>
        <div class="metric-target">Target: < 0.1%</div>
      </div>

      <div class="metric-card">
        <h3>Throughput</h3>
        <div class="metric-value {{throughputStatus}}">{{throughput}}/s</div>
        <div class="metric-target">Target: > 50,000/s</div>
      </div>

      <div class="metric-card">
        <h3>P99.9 Latency</h3>
        <div class="metric-value">{{p999}}ms</div>
        <div class="metric-target">Target: < 50ms</div>
      </div>
    </section>

    <section class="chart-container">
      <h2>Latency Distribution</h2>
      <canvas id="latencyChart"></canvas>
    </section>

    <section class="chart-container">
      <h2>Throughput Over Time</h2>
      <canvas id="throughputChart"></canvas>
    </section>

    <section class="chart-container">
      <h2>Threshold Results</h2>
      <table class="threshold-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Threshold</th>
            <th>Actual</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {{#each thresholds}}
          <tr>
            <td>{{metric}}</td>
            <td>{{threshold}}</td>
            <td>{{actual}}</td>
            <td class="{{status}}">{{statusIcon}}</td>
          </tr>
          {{/each}}
        </tbody>
      </table>
    </section>
  </div>

  <script>
    // Latency histogram
    new Chart(document.getElementById('latencyChart'), {
      type: 'bar',
      data: {
        labels: {{latencyBuckets}},
        datasets: [{
          label: 'Request Count',
          data: {{latencyCounts}},
          backgroundColor: '#3b82f6',
        }]
      },
      options: {
        responsive: true,
        scales: {
          y: { beginAtZero: true }
        }
      }
    });

    // Throughput over time
    new Chart(document.getElementById('throughputChart'), {
      type: 'line',
      data: {
        labels: {{timeLabels}},
        datasets: [{
          label: 'Requests/sec',
          data: {{throughputData}},
          borderColor: '#10b981',
          fill: false,
        }]
      },
      options: {
        responsive: true,
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  </script>
</body>
</html>
```

### 10.2 Grafana Dashboard Configuration

```json
{
  "dashboard": {
    "title": "AuthZ Engine Load Testing",
    "uid": "authz-load-test",
    "tags": ["authz", "performance", "load-testing"],
    "timezone": "browser",
    "refresh": "5s",
    "panels": [
      {
        "title": "Request Rate",
        "type": "stat",
        "gridPos": { "x": 0, "y": 0, "w": 6, "h": 4 },
        "targets": [
          {
            "expr": "rate(authz_load_test_requests_total[1m])",
            "legendFormat": "req/s"
          }
        ],
        "options": {
          "colorMode": "value",
          "graphMode": "area"
        }
      },
      {
        "title": "P50 Latency",
        "type": "stat",
        "gridPos": { "x": 6, "y": 0, "w": 6, "h": 4 },
        "targets": [
          {
            "expr": "histogram_quantile(0.50, rate(authz_load_test_latency_seconds_bucket[1m]))",
            "legendFormat": "P50"
          }
        ],
        "options": {
          "colorMode": "value",
          "unit": "ms"
        },
        "thresholds": {
          "mode": "absolute",
          "steps": [
            { "color": "green", "value": null },
            { "color": "yellow", "value": 1 },
            { "color": "red", "value": 5 }
          ]
        }
      },
      {
        "title": "P99 Latency",
        "type": "stat",
        "gridPos": { "x": 12, "y": 0, "w": 6, "h": 4 },
        "targets": [
          {
            "expr": "histogram_quantile(0.99, rate(authz_load_test_latency_seconds_bucket[1m]))",
            "legendFormat": "P99"
          }
        ],
        "thresholds": {
          "mode": "absolute",
          "steps": [
            { "color": "green", "value": null },
            { "color": "yellow", "value": 10 },
            { "color": "red", "value": 50 }
          ]
        }
      },
      {
        "title": "Error Rate",
        "type": "stat",
        "gridPos": { "x": 18, "y": 0, "w": 6, "h": 4 },
        "targets": [
          {
            "expr": "rate(authz_load_test_errors_total[1m]) / rate(authz_load_test_requests_total[1m]) * 100",
            "legendFormat": "Error %"
          }
        ],
        "thresholds": {
          "mode": "absolute",
          "steps": [
            { "color": "green", "value": null },
            { "color": "yellow", "value": 0.1 },
            { "color": "red", "value": 1 }
          ]
        }
      },
      {
        "title": "Latency Distribution",
        "type": "heatmap",
        "gridPos": { "x": 0, "y": 4, "w": 12, "h": 8 },
        "targets": [
          {
            "expr": "rate(authz_load_test_latency_seconds_bucket[1m])",
            "legendFormat": "{{le}}"
          }
        ],
        "options": {
          "yAxis": {
            "unit": "ms"
          }
        }
      },
      {
        "title": "Throughput Over Time",
        "type": "timeseries",
        "gridPos": { "x": 12, "y": 4, "w": 12, "h": 8 },
        "targets": [
          {
            "expr": "rate(authz_load_test_requests_total[30s])",
            "legendFormat": "Throughput"
          }
        ],
        "fieldConfig": {
          "defaults": {
            "unit": "reqps",
            "custom": {
              "lineWidth": 2,
              "fillOpacity": 20
            }
          }
        }
      },
      {
        "title": "Active Virtual Users",
        "type": "timeseries",
        "gridPos": { "x": 0, "y": 12, "w": 8, "h": 6 },
        "targets": [
          {
            "expr": "authz_load_test_active_vus",
            "legendFormat": "VUs"
          }
        ]
      },
      {
        "title": "Response Status Codes",
        "type": "piechart",
        "gridPos": { "x": 8, "y": 12, "w": 8, "h": 6 },
        "targets": [
          {
            "expr": "sum by (status) (authz_load_test_requests_total)",
            "legendFormat": "{{status}}"
          }
        ]
      },
      {
        "title": "Server Memory Usage",
        "type": "timeseries",
        "gridPos": { "x": 16, "y": 12, "w": 8, "h": 6 },
        "targets": [
          {
            "expr": "process_resident_memory_bytes / 1024 / 1024",
            "legendFormat": "Memory (MB)"
          }
        ]
      }
    ]
  }
}
```

### 10.3 CI Badge Generator

```typescript
// reports/badge-generator.ts
interface BadgeConfig {
  label: string;
  value: string;
  color: string;
}

function generateBadgeSVG(config: BadgeConfig): string {
  const labelWidth = config.label.length * 7 + 10;
  const valueWidth = config.value.length * 7 + 10;
  const totalWidth = labelWidth + valueWidth;

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20">
  <linearGradient id="b" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="a">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#a)">
    <path fill="#555" d="M0 0h${labelWidth}v20H0z"/>
    <path fill="${config.color}" d="M${labelWidth} 0h${valueWidth}v20H${labelWidth}z"/>
    <path fill="url(#b)" d="M0 0h${totalWidth}v20H0z"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${config.label}</text>
    <text x="${labelWidth / 2}" y="14">${config.label}</text>
    <text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${config.value}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${config.value}</text>
  </g>
</svg>`.trim();
}

function generatePerformanceBadges(results: TestResults): Record<string, string> {
  return {
    'latency-p99': generateBadgeSVG({
      label: 'P99 Latency',
      value: `${results.latency.p99.toFixed(1)}ms`,
      color: results.latency.p99 < 10 ? '#4c1' : results.latency.p99 < 50 ? '#dfb317' : '#e05d44',
    }),
    'throughput': generateBadgeSVG({
      label: 'Throughput',
      value: `${(results.throughput / 1000).toFixed(1)}k/s`,
      color: results.throughput > 50000 ? '#4c1' : results.throughput > 25000 ? '#dfb317' : '#e05d44',
    }),
    'error-rate': generateBadgeSVG({
      label: 'Errors',
      value: `${(results.errorRate * 100).toFixed(2)}%`,
      color: results.errorRate < 0.001 ? '#4c1' : results.errorRate < 0.01 ? '#dfb317' : '#e05d44',
    }),
    'status': generateBadgeSVG({
      label: 'Load Test',
      value: results.thresholds.passed ? 'passing' : 'failing',
      color: results.thresholds.passed ? '#4c1' : '#e05d44',
    }),
  };
}

export { generateBadgeSVG, generatePerformanceBadges };
```

---

## 11. CI/CD Integration

### 11.1 GitHub Actions Workflow

```yaml
# .github/workflows/load-tests.yaml
name: Load Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    # Run nightly at 2 AM UTC
    - cron: '0 2 * * *'
  workflow_dispatch:
    inputs:
      test_type:
        description: 'Type of load test to run'
        required: true
        default: 'baseline'
        type: choice
        options:
          - baseline
          - stress
          - soak
          - all
      duration:
        description: 'Test duration (for soak tests)'
        required: false
        default: '1h'

env:
  NODE_VERSION: '20'
  K6_VERSION: '0.47.0'
  AUTHZ_URL: 'http://localhost:3592'

jobs:
  setup:
    name: Setup Test Environment
    runs-on: ubuntu-latest
    outputs:
      server-ready: ${{ steps.health-check.outputs.ready }}
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build AuthZ Engine
        run: pnpm build

      - name: Start AuthZ Server
        run: |
          pnpm start:server &
          echo "SERVER_PID=$!" >> $GITHUB_ENV

      - name: Wait for server
        id: health-check
        run: |
          for i in {1..30}; do
            if curl -s http://localhost:3592/health/ready | grep -q '"status":"ready"'; then
              echo "ready=true" >> $GITHUB_OUTPUT
              exit 0
            fi
            sleep 2
          done
          echo "ready=false" >> $GITHUB_OUTPUT
          exit 1

  baseline-tests:
    name: Baseline Performance Tests
    needs: setup
    if: needs.setup.outputs.server-ready == 'true' && (github.event.inputs.test_type == 'baseline' || github.event.inputs.test_type == 'all' || github.event_name != 'workflow_dispatch')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup k6
        uses: grafana/setup-k6-action@v1
        with:
          k6-version: ${{ env.K6_VERSION }}

      - name: Run baseline tests
        run: |
          k6 run \
            --out json=reports/baseline-results.json \
            --out cloud \
            load-testing/k6/scripts/check-endpoint.js
        env:
          K6_CLOUD_TOKEN: ${{ secrets.K6_CLOUD_TOKEN }}
          K6_CLOUD_PROJECT_ID: ${{ secrets.K6_CLOUD_PROJECT_ID }}

      - name: Run batch tests
        run: |
          k6 run \
            --out json=reports/batch-results.json \
            load-testing/k6/scripts/batch-check.js

      - name: Generate HTML report
        run: node load-testing/reports/generate-html.js

      - name: Upload reports
        uses: actions/upload-artifact@v4
        with:
          name: baseline-reports
          path: reports/
          retention-days: 30

      - name: Check thresholds
        id: check-thresholds
        run: |
          node -e "
            const results = require('./reports/baseline-results.json');
            const passed = results.metrics.checks.values.rate > 0.999;
            console.log('Thresholds passed:', passed);
            process.exit(passed ? 0 : 1);
          "

      - name: Update badges
        if: github.ref == 'refs/heads/main'
        run: |
          node load-testing/reports/update-badges.js
          git config user.name github-actions
          git config user.email github-actions@github.com
          git add badges/
          git commit -m "Update performance badges" || exit 0
          git push

  stress-tests:
    name: Stress Tests
    needs: setup
    if: needs.setup.outputs.server-ready == 'true' && (github.event.inputs.test_type == 'stress' || github.event.inputs.test_type == 'all')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup k6
        uses: grafana/setup-k6-action@v1

      - name: Run stress tests
        run: |
          k6 run \
            --out json=reports/stress-results.json \
            load-testing/k6/scripts/stress-test.js

      - name: Run recovery tests
        run: |
          k6 run \
            --out json=reports/recovery-results.json \
            load-testing/k6/scripts/recovery-test.js

      - name: Analyze breaking point
        run: node load-testing/analysis/breaking-point.js

      - name: Upload reports
        uses: actions/upload-artifact@v4
        with:
          name: stress-reports
          path: reports/
          retention-days: 30

  soak-tests:
    name: Soak Tests
    needs: setup
    if: needs.setup.outputs.server-ready == 'true' && (github.event.inputs.test_type == 'soak' || (github.event_name == 'schedule'))
    runs-on: ubuntu-latest
    timeout-minutes: 1500  # 25 hours
    steps:
      - uses: actions/checkout@v4

      - name: Setup k6
        uses: grafana/setup-k6-action@v1

      - name: Run soak tests
        run: |
          k6 run \
            --out json=reports/soak-results.json \
            load-testing/k6/scripts/soak-test.js
        timeout-minutes: 1440  # 24 hours

      - name: Analyze memory trends
        run: node load-testing/analysis/memory-leak.js

      - name: Upload reports
        uses: actions/upload-artifact@v4
        with:
          name: soak-reports
          path: reports/
          retention-days: 90

  artillery-tests:
    name: Artillery Scenario Tests
    needs: setup
    if: needs.setup.outputs.server-ready == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}

      - name: Install Artillery
        run: npm install -g artillery@latest

      - name: Run scenario tests
        run: |
          artillery run \
            --output reports/artillery-results.json \
            load-testing/artillery/config.yaml

      - name: Generate Artillery report
        run: artillery report reports/artillery-results.json --output reports/artillery-report.html

      - name: Upload reports
        uses: actions/upload-artifact@v4
        with:
          name: artillery-reports
          path: reports/
          retention-days: 30

  compare-baseline:
    name: Compare with Baseline
    needs: [baseline-tests]
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Download current results
        uses: actions/download-artifact@v4
        with:
          name: baseline-reports
          path: current-reports/

      - name: Download previous baseline
        uses: actions/download-artifact@v4
        with:
          name: baseline-reports
          path: previous-reports/
          github-token: ${{ secrets.GITHUB_TOKEN }}
          repository: ${{ github.repository }}
          run-id: ${{ github.event.before }}
        continue-on-error: true

      - name: Compare results
        id: compare
        run: |
          node load-testing/analysis/compare-baselines.js \
            --current current-reports/baseline-results.json \
            --previous previous-reports/baseline-results.json \
            --output comparison.json

      - name: Post comparison comment
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const comparison = JSON.parse(fs.readFileSync('comparison.json'));

            let body = '## Load Test Comparison\n\n';

            if (comparison.verdict === 'pass') {
              body += ':white_check_mark: **All performance thresholds passed**\n\n';
            } else if (comparison.verdict === 'warning') {
              body += ':warning: **Performance regression detected**\n\n';
            } else {
              body += ':x: **Critical performance regression**\n\n';
            }

            body += '| Metric | Previous | Current | Change |\n';
            body += '|--------|----------|---------|--------|\n';
            body += `| P50 Latency | ${comparison.previous.p50}ms | ${comparison.current.p50}ms | ${comparison.p50Change}% |\n`;
            body += `| P99 Latency | ${comparison.previous.p99}ms | ${comparison.current.p99}ms | ${comparison.p99Change}% |\n`;
            body += `| Throughput | ${comparison.previous.throughput}/s | ${comparison.current.throughput}/s | ${comparison.throughputChange}% |\n`;

            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: body
            });

  notify:
    name: Notify Results
    needs: [baseline-tests, stress-tests, soak-tests, artillery-tests]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - name: Send Slack notification
        uses: slackapi/slack-github-action@v1
        with:
          payload: |
            {
              "text": "Load Test Results",
              "blocks": [
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "*AuthZ Engine Load Tests*\n${{ needs.baseline-tests.result == 'success' && ':white_check_mark:' || ':x:' }} Baseline: ${{ needs.baseline-tests.result }}\n${{ needs.stress-tests.result == 'success' && ':white_check_mark:' || needs.stress-tests.result == 'skipped' && ':fast_forward:' || ':x:' }} Stress: ${{ needs.stress-tests.result }}\n${{ needs.soak-tests.result == 'success' && ':white_check_mark:' || needs.soak-tests.result == 'skipped' && ':fast_forward:' || ':x:' }} Soak: ${{ needs.soak-tests.result }}"
                  }
                }
              ]
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
        if: env.SLACK_WEBHOOK_URL != ''
```

### 11.2 Performance Gate Script

```typescript
// scripts/performance-gate.ts
import { readFileSync } from 'fs';

interface GateConfig {
  thresholds: {
    latency_p50_ms: number;
    latency_p99_ms: number;
    throughput_min: number;
    error_rate_max: number;
  };
  regression: {
    latency_increase_percent: number;
    throughput_decrease_percent: number;
  };
}

const DEFAULT_CONFIG: GateConfig = {
  thresholds: {
    latency_p50_ms: 1,
    latency_p99_ms: 10,
    throughput_min: 50000,
    error_rate_max: 0.001,
  },
  regression: {
    latency_increase_percent: 10,
    throughput_decrease_percent: 5,
  },
};

interface GateResult {
  passed: boolean;
  failures: string[];
  warnings: string[];
}

function checkPerformanceGate(
  resultsPath: string,
  baselinePath?: string,
  config: GateConfig = DEFAULT_CONFIG
): GateResult {
  const results = JSON.parse(readFileSync(resultsPath, 'utf-8'));
  const failures: string[] = [];
  const warnings: string[] = [];

  // Check absolute thresholds
  if (results.latency.p50 > config.thresholds.latency_p50_ms) {
    failures.push(
      `P50 latency ${results.latency.p50}ms exceeds threshold ${config.thresholds.latency_p50_ms}ms`
    );
  }

  if (results.latency.p99 > config.thresholds.latency_p99_ms) {
    failures.push(
      `P99 latency ${results.latency.p99}ms exceeds threshold ${config.thresholds.latency_p99_ms}ms`
    );
  }

  if (results.throughput < config.thresholds.throughput_min) {
    failures.push(
      `Throughput ${results.throughput}/s below minimum ${config.thresholds.throughput_min}/s`
    );
  }

  if (results.errorRate > config.thresholds.error_rate_max) {
    failures.push(
      `Error rate ${(results.errorRate * 100).toFixed(2)}% exceeds maximum ${config.thresholds.error_rate_max * 100}%`
    );
  }

  // Check regression against baseline
  if (baselinePath) {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8'));

    const p50Increase =
      ((results.latency.p50 - baseline.latency.p50) / baseline.latency.p50) * 100;
    if (p50Increase > config.regression.latency_increase_percent) {
      warnings.push(
        `P50 latency increased by ${p50Increase.toFixed(1)}% from baseline`
      );
    }

    const throughputDecrease =
      ((baseline.throughput - results.throughput) / baseline.throughput) * 100;
    if (throughputDecrease > config.regression.throughput_decrease_percent) {
      warnings.push(
        `Throughput decreased by ${throughputDecrease.toFixed(1)}% from baseline`
      );
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    warnings,
  };
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const resultsPath = args[0];
  const baselinePath = args[1];

  if (!resultsPath) {
    console.error('Usage: performance-gate.ts <results.json> [baseline.json]');
    process.exit(1);
  }

  const result = checkPerformanceGate(resultsPath, baselinePath);

  console.log('\n=== Performance Gate Results ===\n');

  if (result.failures.length > 0) {
    console.log('FAILURES:');
    result.failures.forEach((f) => console.log(`  - ${f}`));
  }

  if (result.warnings.length > 0) {
    console.log('\nWARNINGS:');
    result.warnings.forEach((w) => console.log(`  - ${w}`));
  }

  if (result.passed) {
    console.log('\n:white_check_mark: Performance gate PASSED\n');
    process.exit(0);
  } else {
    console.log('\n:x: Performance gate FAILED\n');
    process.exit(1);
  }
}

export { checkPerformanceGate, GateConfig, GateResult };
```

---

## 12. Related Documents

- [OBSERVABILITY-SDD.md](./OBSERVABILITY-SDD.md) - Metrics and monitoring integration
- [SERVER-PACKAGE-SDD.md](./SERVER-PACKAGE-SDD.md) - Server performance characteristics
- [CERBOS-FEATURE-COVERAGE-MATRIX.md](../CERBOS-FEATURE-COVERAGE-MATRIX.md) - Feature requirements
- [CORE-PACKAGE-SDD.md](./CORE-PACKAGE-SDD.md) - Core engine performance
- [POLICY-TESTING-SDD.md](./POLICY-TESTING-SDD.md) - Functional testing framework

---

## 13. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-11-23 | Initial specification |

---

## Appendix A: Quick Start Guide

### Running Load Tests Locally

```bash
# Install k6
brew install k6

# Install Artillery
npm install -g artillery

# Start AuthZ Engine
pnpm start:server

# Run baseline k6 tests
k6 run load-testing/k6/scripts/check-endpoint.js

# Run Artillery scenarios
artillery run load-testing/artillery/config.yaml

# Run custom harness
npx ts-node load-testing/harness/src/index.ts
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AUTHZ_URL` | AuthZ Engine URL | `http://localhost:3592` |
| `K6_CLOUD_TOKEN` | k6 Cloud token | - |
| `K6_CLOUD_PROJECT_ID` | k6 Cloud project | - |
| `TEST_DURATION` | Test duration | `5m` |
| `MAX_VUS` | Maximum virtual users | `1000` |

---

## Appendix B: Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Connection refused | Server not running | Ensure AuthZ server is started |
| High error rate | Rate limiting | Check server rate limit configuration |
| Memory growth | Potential leak | Analyze heap snapshots |
| Inconsistent latency | GC pauses | Enable GC logging, tune heap size |
| Test timeout | Network issues | Check firewall, increase timeout |

### Debug Mode

```bash
# Run k6 with debug output
k6 run --verbose --http-debug load-testing/k6/scripts/check-endpoint.js

# Run Artillery with debug
DEBUG=artillery* artillery run load-testing/artillery/config.yaml
```
