# Scale Testing - Test Scenarios Quick Reference

**Parent Document**: [option2-scale-testing.md](./option2-scale-testing.md)
**Created**: November 26, 2025

---

## Test Scenario Matrix

| ID | Name | Nodes | Byzantine | Network | Duration | Workload | Priority |
|----|------|-------|-----------|---------|----------|----------|----------|
| **LT-001** | Baseline Throughput | 1,000 | 0% | Local | 60 min | 100 TPS constant | HIGH |
| **LT-002** | Peak Throughput Discovery | 1,000 | 0% | Local | 30 min | 10-1000 TPS ramp | HIGH |
| **LT-003** | Multi-Scale Comparison | 100-10K | 0% | Local | 15 min/scale | 100 TPS constant | HIGH |
| **ST-001** | CPU Saturation | 1,000 | 0% | Local | Until 95% CPU | Ramp TPS | MEDIUM |
| **ST-002** | Memory Exhaustion | 1,000 | 0% | Local | Until OOM | Accumulate 10M | MEDIUM |
| **ST-003** | Network Saturation | 10,000 | 0% | 100 Mbps limit | 60 min | 1000 TPS burst | MEDIUM |
| **SK-001** | 24-Hour Stability | 1,000 | 10% | LAN | 24 hours | 150 TPS constant | HIGH |
| **SK-002** | 7-Day Endurance | 5,000 | 20% | WAN | 7 days | 50-200 TPS sine | LOW |
| **CT-001** | Random Node Failures | 1,000 | 0% | LAN | 2 hours | 100 TPS + chaos | HIGH |
| **CT-002** | Network Partition | 1,000 | 0% | Partitioned | 1 hour | 100 TPS + split | HIGH |
| **CT-003** | Byzantine Attacks | 1,000 | 10-33% | WAN | 1 hr/config | 100 TPS | CRITICAL |
| **PR-001** | Benchmark Regression | 150 | 0% | Local | 10 min | Benchmark suite | HIGH |

---

## Acceptance Criteria by Scenario

### Load Testing (LT-*)

**LT-001: Baseline Throughput**
```yaml
nodes: 1000
byzantine: 0%
duration: 60 minutes
workload: constant 100 TPS

acceptance:
  - TPS ≥ 100 sustained for full duration
  - p95 latency ≤ 100ms
  - Zero consensus failures
  - Memory stable (no leaks)
```

**LT-002: Peak Throughput Discovery**
```yaml
nodes: 1000
byzantine: 0%
duration: 30 minutes
workload: ramp 10 TPS → 1000 TPS

acceptance:
  - Identify maximum sustainable TPS
  - Document latency degradation curve
  - Identify resource bottlenecks
  - No node crashes at peak
```

**LT-003: Multi-Scale Comparison**
```yaml
nodes: [100, 500, 1000, 5000, 10000]
byzantine: 0%
duration: 15 minutes per scale
workload: constant 100 TPS

acceptance:
  - TPS remains constant across scales
  - Latency grows O(log N) or better
  - Per-node resources bounded
```

### Stress Testing (ST-*)

**ST-001: CPU Saturation**
```yaml
nodes: 1000
byzantine: 0%
duration: until CPU > 95% sustained or 2 hours
workload: ramp TPS until saturation

acceptance:
  - Identify CPU saturation point
  - Graceful degradation (no crashes)
  - System recovers when load reduced
```

**ST-002: Memory Exhaustion**
```yaml
nodes: 1000
byzantine: 0%
duration: until OOM or 4 hours
workload: no pruning, accumulate 10M vertices

acceptance:
  - Identify memory limits
  - OOM killer behavior documented
  - Recovery strategy validated
```

**ST-003: Network Bandwidth Saturation**
```yaml
nodes: 10000
byzantine: 0%
duration: 1 hour
workload: burst 1000 TPS
network: bandwidth-limited 100 Mbps

acceptance:
  - Identify bandwidth bottlenecks
  - Congestion control behavior
  - Queue management under pressure
```

### Soak Testing (SK-*)

**SK-001: 24-Hour Stability**
```yaml
nodes: 1000
byzantine: 10%
duration: 24 hours
workload: constant 150 TPS
network: LAN (1-10ms latency)

acceptance:
  - Zero node crashes
  - No memory leaks (RSS growth < 5%)
  - Consistent performance (TPS variance < 10%)
  - All consensus rounds complete
```

**SK-002: 7-Day Endurance**
```yaml
nodes: 5000
byzantine: 20%
duration: 7 days
workload: variable 50-200 TPS (sine wave)
network: WAN (50-200ms latency)

acceptance:
  - System uptime > 99.9%
  - RocksDB compaction successful
  - No consensus deadlocks
  - Byzantine detection working
```

### Chaos Testing (CT-*)

**CT-001: Random Node Failures**
```yaml
nodes: 1000
byzantine: 0%
duration: 2 hours
workload: 100 TPS
chaos: kill 10 random nodes every 5 minutes

acceptance:
  - Consensus continues with < 33% failures
  - Nodes rejoin successfully
  - No data corruption
  - TPS recovers within 30 seconds
```

**CT-002: Network Partition**
```yaml
nodes: 1000 (500/500 split)
byzantine: 0%
duration: 1 hour
workload: 100 TPS
chaos: partition for 10 minutes, then heal

acceptance:
  - Both partitions detect split
  - No divergent consensus
  - Healing completes within 60 seconds
  - DAG convergence verified
```

**CT-003: Byzantine Attacks** (CRITICAL)
```yaml
nodes: 1000
byzantine: [10%, 20%, 30%, 33%]
duration: 1 hour per configuration
workload: 100 TPS
attack: random voting, always-reject, coordinated

acceptance:
  - Consensus succeeds with ≤ 30% Byzantine
  - Consensus FAILS with ≥ 33% Byzantine (safety validation)
  - Byzantine nodes identified correctly
  - Attack impact quantified
```

### Performance Regression (PR-*)

**PR-001: Benchmark Regression**
```yaml
nodes: 150
byzantine: 0%
duration: 10 minutes
workload: full benchmark suite

benchmarks:
  - Vertex creation (genesis, parents, large payload)
  - Graph operations (add, query, topological sort)
  - Consensus (single vertex, batch-10)
  - Storage (put, get cached/cold, batch)

acceptance:
  - All benchmarks within 10% of baseline
  - No new memory leaks detected
  - Storage performance stable
```

---

## Execution Checklist

### Pre-Test
- [ ] Infrastructure deployed and validated
- [ ] Metrics collection configured (Prometheus + Grafana)
- [ ] Test harness validated on small scale (10-50 nodes)
- [ ] Baseline measurements recorded
- [ ] Chaos injection framework tested
- [ ] Cloud budget alerts configured

### During Test
- [ ] Monitor Grafana dashboards for anomalies
- [ ] Check log aggregation (errors, warnings)
- [ ] Verify metrics collection (no data gaps)
- [ ] Track resource utilization (CPU, memory, network)
- [ ] Document any unexpected behavior
- [ ] Take snapshots at key milestones

### Post-Test
- [ ] Collect all metrics and logs
- [ ] Generate automated analysis report
- [ ] Review anomalies and failures
- [ ] Calculate statistical summaries (p50/p95/p99)
- [ ] Compare against acceptance criteria
- [ ] Document lessons learned
- [ ] Archive raw data for future reference
- [ ] Teardown infrastructure (save costs)

---

## Metrics to Collect

### Throughput Metrics
- `vertices_processed_total` (counter)
- `consensus_rounds_total` (counter)
- `finalized_vertices_total` (counter)
- `tps_current` (gauge, calculated)
- `batch_processing_rate` (histogram)

### Latency Metrics
- `consensus_latency_seconds` (histogram)
- `round_duration_seconds` (histogram)
- `query_latency_seconds` (histogram)
- `vertex_creation_duration_seconds` (histogram)
- `storage_operation_duration_seconds` (histogram)

### Resource Metrics
- `process_resident_memory_bytes` (gauge)
- `process_cpu_usage_percent` (gauge)
- `network_bytes_sent_total` (counter)
- `network_bytes_received_total` (counter)
- `rocksdb_read_ops_total` (counter)
- `rocksdb_write_ops_total` (counter)

### Consensus Metrics
- `active_vertices` (gauge)
- `confidence_score` (histogram)
- `byzantine_detections_total` (counter)
- `consensus_failures_total` (counter)
- `rounds_to_finalize` (histogram)

---

## Quick Commands

### Run Single Test Scenario
```bash
# Local testing (Docker Compose)
cd vigilia
cargo build --release
./scripts/scale-test.sh --scenario LT-001 --nodes 1000

# Cloud testing (Kubernetes)
kubectl apply -f kubernetes/cretoai-1k-scale.yaml
./scripts/cloud-test.sh --scenario LT-001 --cluster cretoai-test
```

### Monitor Test Progress
```bash
# Grafana dashboard
open http://localhost:3000/d/cretoai-scale-test

# Prometheus queries
curl "http://localhost:9090/api/v1/query?query=tps_current"

# Log aggregation
kubectl logs -l app=cretoai-node --tail=100 -f
```

### Collect Results
```bash
# Export Prometheus metrics
./scripts/export-metrics.sh --start 2025-11-26T10:00:00Z --end 2025-11-26T12:00:00Z

# Generate analysis report
./scripts/analyze-results.sh --scenario LT-001 --format markdown

# Archive test data
./scripts/archive-test.sh --test-run-id uuid --output /data/archive/
```

---

## Test Result Format

```json
{
  "test_run_id": "550e8400-e29b-41d4-a716-446655440000",
  "scenario_id": "LT-001",
  "start_time": "2025-11-26T10:00:00Z",
  "end_time": "2025-11-26T11:00:00Z",
  "status": "PASSED",

  "configuration": {
    "node_count": 1000,
    "byzantine_percentage": 0.0,
    "network_profile": "Local",
    "workload": "ConstantRate { tps: 100 }"
  },

  "results": {
    "throughput": {
      "avg_tps": 102.3,
      "peak_tps": 127.5,
      "total_vertices": 367380
    },
    "latency": {
      "p50_ms": 45.2,
      "p95_ms": 89.7,
      "p99_ms": 134.5
    },
    "resource_usage": {
      "avg_cpu_percent": 42.3,
      "avg_memory_mb": 387.5,
      "avg_network_mbps": 8.4
    },
    "consensus": {
      "avg_rounds": 23.4,
      "finalization_confidence": 0.97
    }
  },

  "acceptance_criteria": {
    "tps_sustained": { "required": 100, "actual": 102.3, "passed": true },
    "p95_latency_ms": { "required": 100, "actual": 89.7, "passed": true },
    "consensus_failures": { "required": 0, "actual": 0, "passed": true },
    "memory_stable": { "required": true, "actual": true, "passed": true }
  }
}
```

---

## Troubleshooting

### Common Issues

**Issue**: TPS drops significantly after 30 minutes
- **Cause**: Memory leak or RocksDB compaction
- **Debug**: Check `process_resident_memory_bytes` and `rocksdb_compaction_duration_seconds`
- **Fix**: Enable aggressive pruning, tune RocksDB settings

**Issue**: High p99 latency (> 500ms) but low p50
- **Cause**: Network timeouts or Byzantine node queries
- **Debug**: Check `query_latency_seconds` histogram distribution
- **Fix**: Reduce query timeout, implement retry logic

**Issue**: Node crashes with OOM
- **Cause**: Unbounded cache growth or too many vertices
- **Debug**: Check LRU cache size and vertex count
- **Fix**: Reduce cache size, enable aggressive pruning

**Issue**: Consensus never finalizes
- **Cause**: Too many Byzantine nodes or network partition
- **Debug**: Check `byzantine_detections_total` and network connectivity
- **Fix**: Reduce Byzantine percentage, heal network partition

---

**Document Status**: ✅ Ready for Use
**Last Updated**: November 26, 2025
