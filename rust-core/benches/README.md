# Phase 5: Benchmark Suite - Rust vs Go Performance Comparison

This directory contains comprehensive benchmarks for comparing Rust and Go authorization engine performance.

## Benchmark Files

### 1. `comparison_benchmarks.rs` - Main Performance Comparison

Provides detailed performance metrics comparable to Go's `testing.B`:

- **Authorization decision latency** (1K, 10K, 100K requests)
- **Cache hit/miss performance**
- **Policy evaluation throughput**
- **Concurrent request handling**
- **Memory usage estimation**
- **Statistical analysis** (mean, stddev, p95, p99)

#### Running Comparison Benchmarks

```bash
# Run all comparison benchmarks
cargo bench --bench comparison_benchmarks

# Run specific benchmark group
cargo bench --bench comparison_benchmarks authorization_latency

# Run with verbose output
cargo bench --bench comparison_benchmarks -- --verbose

# Save baseline for comparison
cargo bench --bench comparison_benchmarks -- --save-baseline rust-baseline
```

#### Output

Results are exported to `/tmp/rust-bench-results.json` for easy comparison with Go benchmarks.

### 2. `load_test.rs` - Stress Testing and Load Testing

Focuses on sustained load, spike load, and system resilience:

- **Sustained load**: 1000 req/s for 60 seconds
- **Spike load**: 0 → 10K req/s → 0 (gradual ramp)
- **Memory leak detection**: Long-running test with monitoring
- **Connection pool saturation**: Concurrent connections exceeding capacity
- **Cache saturation**: Fill cache beyond capacity

#### Running Load Tests

```bash
# Run all load tests
cargo bench --bench load_test

# Run specific load test
cargo bench --bench load_test sustained_load
```

#### Output

Results are exported to `/tmp/rust-load-test-results.json`.

## Performance Targets

### Go Baseline (from internal testing)

- **Authorization latency**: ~1,218 ns/op
- **Memory allocation**: ~2,186 bytes/op
- **Throughput**: ~820K ops/sec

### Rust Targets

- **Authorization latency**: 300-600 ns/op (2-4x faster)
- **Memory allocation**: 500-1,000 bytes/op (50-70% less)
- **Throughput**: 1.6M-3.2M ops/sec (2-4x higher)

## Quick Start

```bash
# Build and run all benchmarks
cargo bench

# Run only comparison benchmarks
cargo bench --package cretoai-authz --bench comparison_benchmarks

# Run only load tests
cargo bench --package cretoai-authz --bench load_test
```

## HTML Reports

Criterion generates HTML reports in `target/criterion/`:

```bash
# View reports
open target/criterion/report/index.html
```
