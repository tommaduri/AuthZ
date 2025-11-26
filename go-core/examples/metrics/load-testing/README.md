# Load Testing Suite for Authorization Engine

Comprehensive load testing scripts for Phase 4.5 metrics validation, designed to validate authorization check latency, throughput, and reliability under realistic production loads.

## Overview

This load testing suite includes three complementary approaches:

1. **Apache Bench (load-test.sh)** - Quick HTTP load testing with multiple scenarios
2. **k6 (k6-load-test.js)** - Advanced load testing with custom metrics and realistic patterns
3. **Go Benchmarks (benchmark.go)** - Micro-benchmarks for low-level performance testing

## Prerequisites

### Install Required Tools

#### macOS
```bash
# Apache Bench
brew install httpd

# k6
brew install k6

# jq (for CSV generation)
brew install jq

# Go (already installed for the project)
go version  # Should be 1.21+
```

#### Ubuntu/Debian
```bash
# Apache Bench
sudo apt-get update
sudo apt-get install apache2-utils

# k6
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# jq
sudo apt-get install jq

# Go
go version  # Should be 1.21+
```

## Test Suite Components

### 1. Apache Bench Load Testing (load-test.sh)

Fast, simple HTTP load testing with multiple concurrency and request patterns.

#### Features
- Tests multiple concurrency levels (10, 50, 100 concurrent requests)
- Tests multiple request counts (1000, 5000, 10000 requests)
- Tests different authorization policies (viewer, editor, admin)
- Generates CSV reports with latency percentiles
- Validates SLO targets (p99 < 10µs target, adjusted for network overhead)
- Automatic health checking

#### Usage

**Basic run:**
```bash
cd /Users/tommaduri/Documents/GitHub/authz-engine/go-core/examples/metrics/load-testing
chmod +x load-test.sh
./load-test.sh
```

**Custom endpoint:**
```bash
ENDPOINT=http://localhost:9090/v1/check ./load-test.sh
```

**Custom output directory:**
```bash
OUTPUT_DIR=./custom-results ./load-test.sh
```

#### Output Files
- `{timestamp}_{policy}_c{concurrency}_n{requests}.txt` - Detailed test results
- `{timestamp}_{policy}_c{concurrency}_n{requests}.tsv` - Request timing data
- `{timestamp}_summary.csv` - Aggregated CSV report

#### Example Output
```
[INFO] Starting Load Testing Suite
[INFO] Endpoint: http://localhost:8080/v1/check
[INFO] Output Directory: ./results

[INFO] Running test: viewer_c50_n10000 (Concurrency: 50, Requests: 10000, Policy: viewer)
[INFO] Test completed: viewer_c50_n10000

Requests per second:    25000.45 [#/sec]
Time per request:       2.000 [ms] (mean)
95%                     3.500 [ms]
99%                     4.200 [ms]

[INFO] SLO MET: viewer (c=50, n=10000) - p99=4.200ms
[INFO] All tests met SLO targets!
```

### 2. k6 Load Testing (k6-load-test.js)

Advanced load testing with realistic traffic patterns, custom metrics, and detailed analysis.

#### Features
- **Realistic load patterns:**
  - Ramp-up: 0 → 100 VUs over 2 minutes
  - Sustained: 100 VUs for 5 minutes
  - Ramp-down: 100 → 0 VUs over 1 minute
- **Custom metrics:**
  - Authorization check duration
  - Success/failure rates
  - Cache hit rates
  - Policy evaluation counters
- **SLO validation:**
  - p95 < 5ms
  - p99 < 10ms
  - p99.9 < 50ms
  - Success rate > 99.9%
  - Cache hit rate > 80%
- **Multiple test scenarios:**
  - Single authorization checks
  - Cached requests
  - Batch requests
  - Policy-specific authorization

#### Usage

**Basic run:**
```bash
cd /Users/tommaduri/Documents/GitHub/authz-engine/go-core/examples/metrics/load-testing
k6 run k6-load-test.js
```

**Custom duration and VUs:**
```bash
k6 run --vus 50 --duration 2m k6-load-test.js
```

**Custom endpoint:**
```bash
k6 run -e BASE_URL=http://localhost:9090 k6-load-test.js
```

**Generate detailed reports:**
```bash
k6 run --out json=results.json k6-load-test.js
k6 run --out influxdb=http://localhost:8086/k6 k6-load-test.js
```

#### Output Files
- `summary.json` - Detailed JSON metrics
- `summary.html` - HTML report with visualizations
- Console output with real-time metrics

#### Example Output
```
=== Load Test Summary ===

Duration: 480.00s
VUs: 100
Iterations: 240000

--- HTTP Metrics ---
Requests: 240000
Request rate: 500.00/s
Failed requests: 0.05%
Request duration (p95): 3.45ms
Request duration (p99): 4.78ms

--- Authorization Metrics ---
Success rate: 99.95%
Failure rate: 0.05%
Cache hit rate: 85.32%
Policy evaluations: 240000

✓ All thresholds met
```

### 3. Go Benchmarks (benchmark.go)

Micro-benchmarks for low-level performance analysis and optimization.

#### Features
- **Core benchmarks:**
  - Single authorization checks
  - Cached vs. non-cached checks
  - Concurrent authorization checks
  - Policy-specific checks
- **Performance analysis:**
  - Cache hit rate impact (0%, 25%, 50%, 75%, 90%, 99%)
  - Batch processing (1, 10, 50, 100, 500 requests)
  - Memory allocation patterns
  - Latency distribution
- **Detailed metrics:**
  - Operations per second
  - Nanoseconds per operation
  - Bytes allocated per operation
  - Allocations per operation

#### Usage

**Run all benchmarks:**
```bash
cd /Users/tommaduri/Documents/GitHub/authz-engine/go-core/examples/metrics/load-testing
go test -bench=. -benchmem
```

**Run specific benchmark:**
```bash
go test -bench=BenchmarkAuthorizationCheckCached -benchmem
```

**Extended benchmark (10 seconds per test):**
```bash
go test -bench=. -benchmem -benchtime=10s
```

**Generate CPU and memory profiles:**
```bash
go test -bench=. -benchmem -cpuprofile=cpu.prof -memprofile=mem.prof
go tool pprof cpu.prof
go tool pprof mem.prof
```

**Compare benchmarks:**
```bash
# Run baseline
go test -bench=. -benchmem > baseline.txt

# Make changes...

# Run comparison
go test -bench=. -benchmem > new.txt

# Compare results
benchcmp baseline.txt new.txt
```

#### Example Output
```
goos: darwin
goarch: arm64
pkg: example/load-testing

BenchmarkAuthorizationCheck-8                     500000      2456 ns/op     384 B/op      8 allocs/op
BenchmarkAuthorizationCheckCached-8              5000000       245 ns/op      32 B/op      1 allocs/op
BenchmarkAuthorizationCheckNoCacheExplicit-8      500000      2512 ns/op     384 B/op      8 allocs/op
BenchmarkAuthorizationCheckConcurrent-8          1000000      1234 ns/op     256 B/op      6 allocs/op
BenchmarkAuthorizationCheckByPolicy/viewer-8      600000      2123 ns/op     368 B/op      7 allocs/op
BenchmarkAuthorizationCheckByPolicy/editor-8      580000      2234 ns/op     384 B/op      8 allocs/op
BenchmarkAuthorizationCheckByPolicy/admin-8       590000      2198 ns/op     368 B/op      7 allocs/op
BenchmarkAuthorizationCheckCacheHitRates/HitRate_0-8    500000  2456 ns/op  384 B/op  8 allocs/op
BenchmarkAuthorizationCheckCacheHitRates/HitRate_99-8  4800000   256 ns/op   36 B/op  1 allocs/op

PASS
ok      example/load-testing    45.678s
```

## Running the Complete Test Suite

### 1. Start the Authorization Server

```bash
# Terminal 1: Start the server
cd /Users/tommaduri/Documents/GitHub/authz-engine/go-core
go run cmd/server/main.go
```

### 2. Run Apache Bench Tests

```bash
# Terminal 2: Run quick load tests
cd /Users/tommaduri/Documents/GitHub/authz-engine/go-core/examples/metrics/load-testing
./load-test.sh
```

### 3. Run k6 Load Tests

```bash
# Terminal 2: Run comprehensive load tests
k6 run k6-load-test.js
```

### 4. Run Go Benchmarks

```bash
# Terminal 2: Run micro-benchmarks
go test -bench=. -benchmem -benchtime=10s
```

## Interpreting Results

### SLO Targets (Phase 4.5)

| Metric | Target | Measured By |
|--------|--------|-------------|
| Authorization check latency (p99) | < 10µs | Go benchmarks |
| Authorization check latency (p99) | < 10ms | k6, Apache Bench (with network) |
| Success rate | > 99.9% | k6, Apache Bench |
| Cache hit rate | > 80% | k6 |
| Throughput | > 10,000 req/s | k6, Apache Bench |

### Understanding Latency Differences

- **Go benchmarks (ns)**: Direct function calls, no network overhead
- **k6/Apache Bench (ms)**: Includes network latency, HTTP overhead, serialization
- **Target p99 < 10µs**: Core engine performance (Go benchmarks)
- **Target p99 < 10ms**: End-to-end API performance (k6/Apache Bench)

### Analyzing Apache Bench Results

```csv
Policy,Concurrency,Requests,Total_Completed,Failed,RPS,Mean_Time_ms,P50_ms,P95_ms,P99_ms,P100_ms
viewer,50,10000,10000,0,25000.45,2.000,1.800,3.500,4.200,12.500
```

**Key metrics:**
- **RPS (Requests Per Second)**: Should exceed 10,000 for single instance
- **P99_ms**: Should be < 10ms (SLO target with network overhead)
- **Failed**: Should be 0 or < 0.1% of total requests

### Analyzing k6 Results

```
http_req_duration....: avg=2.45ms min=0.5ms med=2.1ms max=45ms p(95)=3.45ms p(99)=4.78ms
auth_check_success...: 99.95% (239880 / 240000)
cache_hit_rate.......: 85.32% (204768 / 240000)
```

**Key metrics:**
- **p(99) duration**: Should be < 10ms (SLO target)
- **auth_check_success**: Should be > 99.9% (SLO target)
- **cache_hit_rate**: Should be > 80% (SLO target)

### Analyzing Go Benchmark Results

```
BenchmarkAuthorizationCheckCached-8    5000000    245 ns/op    32 B/op    1 allocs/op
```

**Key metrics:**
- **ns/op**: Nanoseconds per operation (should be < 10,000ns = 10µs for p99)
- **B/op**: Bytes allocated per operation (lower is better)
- **allocs/op**: Number of allocations (lower is better)

## Tuning Recommendations

### If p99 Latency is High

1. **Check cache configuration:**
   ```bash
   # Verify cache hit rate in k6 results
   # Target: > 80% cache hit rate
   ```

2. **Optimize policy evaluation:**
   ```bash
   # Run profiling
   go test -bench=BenchmarkAuthorizationCheck -cpuprofile=cpu.prof
   go tool pprof cpu.prof
   ```

3. **Increase concurrency limits:**
   ```go
   // In server configuration
   MaxConcurrentRequests: 1000
   ```

### If Throughput is Low

1. **Scale horizontally:**
   - Deploy multiple instances behind load balancer
   - Use Redis for distributed caching

2. **Optimize database queries:**
   - Add indexes for common queries
   - Use connection pooling

3. **Enable HTTP/2:**
   - Better multiplexing
   - Reduced connection overhead

### If Cache Hit Rate is Low

1. **Increase cache size:**
   ```go
   CacheSize: 10000  // Increase from default
   ```

2. **Adjust cache TTL:**
   ```go
   CacheTTL: 5 * time.Minute  // Increase from default
   ```

3. **Implement cache warming:**
   - Pre-populate cache with common queries
   - Use LRU eviction policy

### If Memory Usage is High

1. **Reduce cache size:**
   ```go
   CacheSize: 1000  // Reduce if memory constrained
   ```

2. **Optimize data structures:**
   ```bash
   # Check allocations
   go test -bench=. -benchmem -memprofile=mem.prof
   go tool pprof -alloc_space mem.prof
   ```

3. **Enable garbage collection tuning:**
   ```bash
   GOGC=50 go run cmd/server/main.go  # More aggressive GC
   ```

## Continuous Performance Testing

### Integration with CI/CD

```yaml
# .github/workflows/performance.yml
name: Performance Tests

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  performance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Set up Go
        uses: actions/setup-go@v2
        with:
          go-version: 1.21

      - name: Install k6
        run: |
          sudo apt-get update
          sudo apt-get install k6

      - name: Run Go Benchmarks
        run: |
          cd go-core/examples/metrics/load-testing
          go test -bench=. -benchmem > benchmark-results.txt

      - name: Start Server
        run: |
          cd go-core
          go run cmd/server/main.go &
          sleep 5

      - name: Run k6 Tests
        run: |
          cd go-core/examples/metrics/load-testing
          k6 run --out json=k6-results.json k6-load-test.js

      - name: Validate SLOs
        run: |
          # Add SLO validation script here
          # Fail build if SLOs not met
```

## Troubleshooting

### Apache Bench "Connection refused"

```bash
# Check if server is running
curl http://localhost:8080/health

# Check firewall
sudo lsof -i :8080
```

### k6 "context deadline exceeded"

```bash
# Increase timeouts in k6-load-test.js
export let options = {
  ...
  timeout: '60s',  // Increase from default
};
```

### Go Benchmark "too many open files"

```bash
# Increase file descriptor limits
ulimit -n 10000
```

## Additional Resources

- [Apache Bench Documentation](https://httpd.apache.org/docs/current/programs/ab.html)
- [k6 Documentation](https://k6.io/docs/)
- [Go Benchmarking Guide](https://golang.org/pkg/testing/#hdr-Benchmarks)
- [Phase 4.5 Metrics Specification](../../docs/phase-4-5-metrics.md)

## Support

For issues or questions about load testing:
1. Check server logs for errors
2. Verify SLO targets in Phase 4.5 specification
3. Review performance tuning guide
4. Open an issue with benchmark results attached
