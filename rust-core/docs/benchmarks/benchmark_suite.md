# CretoAI Comprehensive Benchmark Suite

**Version:** Phase 7 Final
**Status:** Complete
**Target:** Validate 10K+ TPS, <500ms finality, Byzantine tolerance

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Running Benchmarks](#running-benchmarks)
4. [Benchmark Categories](#benchmark-categories)
5. [Interpreting Results](#interpreting-results)
6. [Performance Targets](#performance-targets)
7. [Troubleshooting](#troubleshooting)
8. [CI/CD Integration](#cicd-integration)

---

## Overview

The CretoAI comprehensive benchmark suite validates all Phase 7 performance claims through rigorous testing of:

- **Throughput:** Single-threaded baseline, parallel validation, SIMD acceleration, full-stack TPS
- **Latency:** Vertex creation, propagation, validation, finalization (P50, P95, P99, P999)
- **Byzantine Tolerance:** Equivocation detection, node isolation, fork resolution
- **Network Resilience:** Partition recovery, high latency, packet loss, connection churn

### Key Features

✅ **Criterion.rs-based:** Industry-standard benchmarking framework
✅ **Statistical Analysis:** P50, P95, P99, P999 percentiles with confidence intervals
✅ **Regression Detection:** Automatic performance regression alerts
✅ **Comprehensive Reporting:** Markdown reports with ASCII visualizations
✅ **Production-Grade:** Real-world scenarios and stress tests

---

## Architecture

### Benchmark Structure

```
benches/
├── comprehensive_suite.rs    # Master orchestrator
├── throughput_bench.rs        # Throughput validation
├── latency_bench.rs           # Latency measurement
├── byzantine_bench.rs         # Byzantine tolerance
├── network_stress_bench.rs    # Network stress tests
└── validation_report.rs       # Report generation
```

### Data Flow

```
┌─────────────────────────────────────────────────────┐
│           Comprehensive Benchmark Suite             │
└─────────────────────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  Throughput  │ │   Latency    │ │  Byzantine   │
│  Benchmark   │ │  Benchmark   │ │  Benchmark   │
└──────────────┘ └──────────────┘ └──────────────┘
        │               │               │
        │               ▼               │
        │       ┌──────────────┐       │
        └──────►│   Network    │◄──────┘
                │    Stress    │
                │  Benchmark   │
                └──────────────┘
                        │
                        ▼
                ┌──────────────┐
                │  Validation  │
                │    Report    │
                └──────────────┘
```

---

## Running Benchmarks

### Quick Start

```bash
# Run all benchmarks (recommended)
cargo bench --bench comprehensive_suite

# Run specific category
cargo bench --bench comprehensive_suite -- throughput
cargo bench --bench comprehensive_suite -- latency
cargo bench --bench comprehensive_suite -- byzantine
cargo bench --bench comprehensive_suite -- network_stress

# With custom sample size
cargo bench --bench comprehensive_suite -- --sample-size 200

# Generate detailed report
cargo bench --bench comprehensive_suite > benchmark_results.txt
```

### Configuration

Create `benchmark_config.toml`:

```toml
[benchmark]
duration_secs = 60
warmup_secs = 10
iterations = 10
confidence_level = 0.95
max_variance = 0.10

[throughput]
num_vertices = [100, 1000, 10000, 100000]
num_threads = [1, 2, 4, 8, 16]
batch_sizes = [10, 32, 64, 128]

[latency]
network_sizes = [4, 7, 10, 25, 50, 100]
num_samples = 1000

[byzantine]
network_size = 10
byzantine_counts = [1, 2, 3]

[stress]
partition_durations = [5, 10, 30]
latency_scenarios = [100, 500, 1000]
loss_rates = [0.01, 0.05, 0.10]
```

---

## Benchmark Categories

### 1. Throughput Benchmarks

**Purpose:** Validate 10,000+ TPS target (stretch: 3.6M TPS)

**Tests:**
- Single-threaded baseline
- Multi-threaded parallel (2, 4, 8, 16 threads)
- SIMD-accelerated BLAKE3 + ML-DSA
- Connection pooling (80% reuse)
- Full-stack end-to-end TPS

**Metrics:**
- Transactions per second (TPS)
- Parallel speedup (vs baseline)
- SIMD speedup (2.34x-7.5x expected)

**Example Output:**
```
throughput/baseline_single_thread
                        time:   [45.231 ms 45.892 ms 46.612 ms]
throughput/parallel/16  time:   [12.123 ms 12.456 ms 12.823 ms]
                        thrpt:  [80.3K TPS 80.1K TPS 82.5K TPS]
```

### 2. Latency Benchmarks

**Purpose:** Validate <500ms finality (P99)

**Tests:**
- Vertex creation latency
- Propagation to N peers (4-100)
- Signature + DAG validation
- Finalization (proposal to finality)

**Metrics:**
- P50, P95, P99, P999 percentiles
- Mean, min, max latencies
- Distribution histograms

**Example Output:**
```
latency/finalization    time:   [245.12 ms 312.45 ms 456.78 ms]
                        P99:    [456.78 ms] ✅ (Target: <500ms)
```

### 3. Byzantine Tolerance Tests

**Purpose:** Validate f Byzantine nodes (n=3f+1)

**Tests:**
- Equivocation detection (double-voting)
- Invalid signature detection
- Fork creation and resolution
- Byzantine node isolation
- Reputation penalties

**Metrics:**
- Detection time (<1s target)
- Isolation time (<1s target)
- Fork resolution time
- Safety violations (0 expected)

**Example Output:**
```
byzantine/equivocation_detection
                        time:   [52.34 ms 58.12 ms 65.23 ms]
byzantine/isolation/3   time:   [123.45 ms 145.67 ms 178.90 ms]
                        status: ✅ No safety violations
```

### 4. Network Stress Tests

**Purpose:** Validate resilience under adverse conditions

**Tests:**
- Network partition recovery
- High latency (100ms, 500ms, 1000ms)
- Packet loss (1%, 5%, 10%)
- Bandwidth throttling
- Connection churn (peers joining/leaving)
- Circuit breaker activation

**Metrics:**
- Recovery time
- Throughput degradation
- Error rates
- Stability metrics

**Example Output:**
```
network_stress/partition_recovery
                        time:   [2.34 s 2.67 s 3.01 s]
network_stress/high_latency/500ms
                        degradation: [23.4%] (acceptable)
network_stress/packet_loss/5%
                        error_rate: [5.1%] (expected)
```

---

## Interpreting Results

### Criterion Output

Criterion.rs provides detailed statistical analysis:

```
vertex_proposal         time:   [12.345 ms 12.567 ms 12.823 ms]
                        change: [-2.34% -1.23% +0.45%] (p = 0.15 > 0.05)
                        No change in performance detected.
```

**Components:**
- **time:** [lower_bound mean upper_bound] (95% confidence interval)
- **change:** Performance change vs baseline
- **p-value:** Statistical significance (p < 0.05 = significant)

### Validation Report

After running benchmarks, check `target/benchmark_validation_report.md`:

```markdown
## Performance Targets

| Metric | Target | Achieved | Status |
|--------|--------|----------|--------|
| Throughput | 10,000 TPS | 45,230 TPS | 🚀 |
| Finality (P99) | <500ms | 456ms | ✅ |
| Byzantine Tolerance | f nodes | 3 nodes | ✅ |
| Safety Violations | 0 | 0 | ✅ |
```

**Status Indicators:**
- 🚀 **Exceeded:** Performance exceeds target significantly
- ✅ **Met:** Performance meets target
- ❌ **Not Met:** Performance below target (requires investigation)

### Regression Detection

Benchmarks automatically detect regressions:

```
Performance Regression Detected!
- Component: Baseline Throughput
- Baseline: 10,000 TPS
- Current: 8,500 TPS
- Regression: 15% decrease
```

---

## Performance Targets

### Phase 7 Targets (Minimum)

| Metric | Target | Stretch Goal | Validation Method |
|--------|--------|--------------|-------------------|
| Throughput | 10,000 TPS | 3,600,000 TPS | Full-stack benchmark |
| Finality (P99) | <500ms | <200ms | Latency distribution |
| Byzantine Tolerance | f nodes | Verified | Attack scenarios |
| SIMD Speedup | 2x | 2.34x-7.5x | Hash comparison |
| Connection Latency | 50% reduction | Verified | Pool metrics |
| Circuit Overhead | <1% | 0.8% | Failure injection |
| Failure Detection | <1s | <100ms | Detection time |

### Real-World Scenarios

Benchmarks simulate production conditions:

1. **Network Partitions:** 30-50% of nodes isolated, recovery within 10s
2. **High Latency:** Trans-continental delays (100-1000ms)
3. **Packet Loss:** Internet baseline (1-10% loss)
4. **Byzantine Attacks:** Up to 33% malicious nodes
5. **Connection Churn:** Peers joining/leaving every 10s

---

## Troubleshooting

### Common Issues

#### 1. Benchmarks Run Too Long

**Problem:** Benchmarks take >30 minutes

**Solution:**
```bash
# Reduce sample size
cargo bench -- --sample-size 10

# Reduce measurement time
cargo bench -- --measurement-time 30

# Run specific test
cargo bench -- throughput/baseline
```

#### 2. High Variance in Results

**Problem:** Results vary >10% between runs

**Causes:**
- Background processes consuming CPU
- Thermal throttling
- Network instability

**Solution:**
```bash
# Disable frequency scaling
sudo cpupower frequency-set -g performance

# Close background apps
# Run benchmarks on dedicated hardware
```

#### 3. Out of Memory

**Problem:** Benchmarks crash with OOM

**Solution:**
```bash
# Reduce num_vertices
cargo bench -- --num-vertices 1000

# Increase system limits
ulimit -n 4096
```

#### 4. Network Tests Fail

**Problem:** Network stress tests timeout

**Solution:**
```bash
# Check firewall
sudo ufw status

# Increase timeouts
export CRETOAI_TIMEOUT=60

# Check network connectivity
ping localhost
```

---

## CI/CD Integration

### GitHub Actions

Create `.github/workflows/benchmarks.yml`:

```yaml
name: Benchmark Suite

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 2 * * *' # Daily at 2 AM

jobs:
  benchmark:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Install Rust
        uses: actions-rs/toolchain@v1
        with:
          toolchain: stable

      - name: Run Benchmarks
        run: cargo bench --bench comprehensive_suite

      - name: Upload Report
        uses: actions/upload-artifact@v3
        with:
          name: benchmark-report
          path: target/benchmark_validation_report.md

      - name: Check Performance Targets
        run: |
          if grep -q "❌" target/benchmark_validation_report.md; then
            echo "Performance targets not met!"
            exit 1
          fi
```

### Continuous Monitoring

Track performance over time:

```bash
# Run benchmarks and save results
cargo bench --bench comprehensive_suite | tee results_$(date +%Y%m%d).txt

# Compare with baseline
cargo bench --bench comprehensive_suite --save-baseline main

# Compare current vs baseline
cargo bench --bench comprehensive_suite --baseline main
```

### Integration with Monitoring

Send metrics to Prometheus:

```rust
use prometheus::{Gauge, Registry};

let registry = Registry::new();
let tps_gauge = Gauge::new("cretoai_tps", "Transactions per second")?;
registry.register(Box::new(tps_gauge.clone()))?;

// After benchmark
tps_gauge.set(results.throughput_tps);
```

---

## Advanced Usage

### Custom Scenarios

Create custom benchmark scenarios:

```rust
#[bench]
fn custom_scenario(c: &mut Criterion) {
    let config = MyCustomConfig {
        nodes: 100,
        byzantine: 33,
        latency: Duration::from_millis(500),
    };

    c.bench_function("custom_scenario", |b| {
        b.iter(|| run_custom_benchmark(&config))
    });
}
```

### Profiling

Profile benchmarks to identify bottlenecks:

```bash
# CPU profiling
cargo bench --bench comprehensive_suite --profile

# Memory profiling
cargo bench --bench comprehensive_suite --features dhat-heap

# Flamegraph
cargo flamegraph --bench comprehensive_suite
```

### Comparison Benchmarks

Compare different implementations:

```bash
# Run baseline
cargo bench --bench comprehensive_suite --save-baseline old

# Make changes
# ...

# Compare
cargo bench --bench comprehensive_suite --baseline old
```

---

## Appendix

### Benchmark Hardware Recommendations

**Minimum:**
- CPU: 4 cores, 2.5 GHz
- RAM: 8 GB
- Disk: 20 GB SSD

**Recommended:**
- CPU: 16 cores, 3.5 GHz
- RAM: 32 GB
- Disk: 100 GB NVMe SSD
- Network: 1 Gbps

### Statistical Terminology

- **P50 (Median):** 50% of samples below this value
- **P95:** 95% of samples below this value
- **P99:** 99% of samples below this value
- **P999:** 99.9% of samples below this value
- **Confidence Interval:** Range where true mean likely lies (95% confidence)
- **Regression:** Performance degradation vs baseline

### References

- [Criterion.rs Documentation](https://bheisler.github.io/criterion.rs/)
- [PBFT Paper](http://pmg.csail.mit.edu/papers/osdi99.pdf)
- [Byzantine Fault Tolerance](https://en.wikipedia.org/wiki/Byzantine_fault)

---

**Last Updated:** 2024-11-28
**Maintainer:** CretoAI Team
**License:** MIT OR Apache-2.0
