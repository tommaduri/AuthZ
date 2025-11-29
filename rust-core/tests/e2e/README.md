# CretoAI End-to-End Tests

Comprehensive end-to-end test suite for the CretoAI distributed consensus system.

## Overview

This test suite validates Phase 6 implementation of:
- **BFT Consensus**: Byzantine Fault Tolerant consensus with PBFT
- **Network Layer**: QUIC-based P2P transport with NAT traversal
- **Storage Layer**: RocksDB persistent DAG storage
- **Fault Tolerance**: Byzantine node detection and network partition recovery

## Test Scenarios

### 1. Cluster Consensus (`cluster_consensus.rs`)

Tests basic consensus functionality across a multi-node cluster.

**Test Cases:**
- `test_three_node_basic_consensus` - Basic 3-node cluster setup
- `test_quorum_calculation` - Validates 2f+1 quorum for different cluster sizes
- `test_vertex_creation_and_hash` - Vertex hashing and uniqueness
- `test_consensus_message_flow` - PBFT message flow validation
- `test_finality_timeout_configuration` - Timeout configuration validation

**What it validates:**
- Nodes can form a cluster
- Quorum calculation is correct (2f+1 for f Byzantine nodes)
- Vertices are properly hashed and unique
- Consensus configuration works for various cluster sizes

### 2. Byzantine Node Detection (`byzantine_node.rs`)

Tests detection and mitigation of Byzantine (malicious) nodes.

**Test Cases:**
- `test_byzantine_fault_tolerance_threshold` - f = (n-1)/3 Byzantine tolerance
- `test_byzantine_detection_enabled` - Detection is properly configured
- `test_equivocation_scenario` - Conflicting message detection
- `test_majority_honest_nodes_continue` - Consensus with f Byzantine nodes
- `test_too_many_byzantine_nodes_fail` - Failure when Byzantine > f
- `test_reputation_threshold` - Reputation-based node banning
- `test_signature_verification` - Invalid signature detection

**What it validates:**
- System tolerates up to f Byzantine nodes
- Equivocation is detected
- Honest majority can continue
- Too many Byzantine nodes prevent consensus
- Reputation system works
- Signature verification prevents tampering

### 3. Network Partition Recovery (`network_partition.rs`)

Tests behavior during and after network partitions.

**Test Cases:**
- `test_majority_partition_continues` - Majority partition maintains consensus
- `test_even_split_stalls` - Even split causes stall
- `test_partition_recovery` - Nodes sync after partition heals
- `test_partition_detection` - Nodes detect they are partitioned
- `test_large_cluster_partition` - Partition behavior in large clusters
- `test_partition_timeout_behavior` - Timeout-based partition detection

**What it validates:**
- Majority partition can progress
- Minority partition cannot progress
- Nodes sync after partition recovery
- Partition detection via quorum checking
- Timeout-based detection mechanisms

### 4. Crash Recovery (`crash_recovery.rs`)

Tests node crash and recovery from RocksDB persistent storage.

**Test Cases:**
- `test_storage_persistence` - Data persists across database reopens
- `test_crash_recovery_with_state` - Full state recovery after crash
- `test_finalized_state_recovery` - Finalized vertices are recovered
- `test_multiple_crash_recovery_cycles` - Multiple crash/recovery cycles
- `test_recovery_time` - Recovery completes in <5 seconds
- `test_corrupted_data_handling` - Graceful handling of corrupted data

**What it validates:**
- RocksDB persists data across crashes
- DAG state is fully recoverable
- Finalized sequence numbers are preserved
- Multiple crash cycles work correctly
- Recovery is fast (<5 seconds)
- Corrupted data is handled gracefully

### 5. Throughput Benchmark (`throughput_benchmark.rs`)

Performance benchmarks for consensus system.

**Benchmarks:**
- `bench_vertex_creation` - Vertex creation throughput
- `bench_engine_creation` - Engine initialization overhead
- `bench_quorum_calculation` - Quorum calculation performance
- `bench_vertex_hashing` - BLAKE3 hashing performance
- `bench_config_overhead` - Configuration creation overhead
- `bench_uuid_generation` - UUID v4 generation
- `bench_vertex_validation` - Validation throughput
- `bench_parallel_processing` - Parallel vertex processing

**Performance Targets:**
- Vertex creation: >10,000/sec
- Vertex hashing: <100μs per vertex
- Quorum calculation: <1μs
- UUID generation: <100ns

## Running Tests

### Run all E2E tests
```bash
cd tests/e2e
cargo test
```

### Run specific test suite
```bash
cargo test --test cluster_consensus
cargo test --test byzantine_node
cargo test --test network_partition
cargo test --test crash_recovery
```

### Run with output visibility
```bash
cargo test -- --nocapture
```

### Run tests serially (required for some tests)
```bash
cargo test -- --test-threads=1
```

### Run benchmarks
```bash
cargo bench --benches
```

### View benchmark results
```bash
open target/criterion/report/index.html
```

## Test Organization

```
tests/e2e/
├── Cargo.toml                  # Test dependencies
├── README.md                   # This file
├── tests/
│   ├── cluster_consensus.rs    # 3-node consensus tests
│   ├── byzantine_node.rs       # Byzantine detection tests
│   ├── network_partition.rs    # Partition recovery tests
│   └── crash_recovery.rs       # Crash and recovery tests
└── benches/
    └── throughput_benchmark.rs # Performance benchmarks
```

## Dependencies

### Internal
- `cretoai-consensus` - BFT consensus engine
- `cretoai-network` - QUIC networking
- `cretoai-dag` - DAG storage
- `cretoai-crypto` - Quantum-resistant signatures
- `cretoai-core` - Core types

### External
- `tokio` - Async runtime
- `tempfile` - Temporary directories
- `serial_test` - Sequential test execution
- `criterion` - Benchmarking framework
- `rocksdb` - Persistent storage

## Performance Targets

### Consensus
- **Finality time (p99)**: <500ms
- **Throughput**: >1000 TPS (3-node cluster)
- **Message overhead**: <100 KB/sec per node

### Network
- **QUIC latency (p99)**: <50ms
- **Connection setup**: <100ms
- **Bandwidth**: Support 100 Mbps

### Storage
- **Write latency (p99)**: <10ms
- **Read latency (p99)**: <5ms
- **Recovery time**: <5 seconds

### Byzantine Tolerance
- **Detection time**: <1 second
- **False positive rate**: <0.01%
- **Recovery time**: <2 seconds

## Continuous Integration

Tests are run automatically on:
- Every commit to main branch
- All pull requests
- Nightly builds

### CI Configuration
```yaml
# .github/workflows/e2e-tests.yml
- name: Run E2E Tests
  run: |
    cd tests/e2e
    cargo test --all-features
    cargo bench --no-run
```

## Troubleshooting

### Tests hang
- Check if using `serial_test` for tests that modify shared state
- Ensure proper timeout configuration
- Verify RocksDB directories are cleaned up

### Benchmark variance
- Run benchmarks multiple times
- Close other applications
- Use `--sample-size` to increase samples

### RocksDB errors
- Ensure temp directories are properly cleaned
- Check disk space
- Verify file permissions

## Future Enhancements

### Planned Test Scenarios
- [ ] 7-node cluster consensus
- [ ] Multiple concurrent partitions
- [ ] Slow network simulation
- [ ] High latency scenarios
- [ ] Disk I/O bottlenecks
- [ ] Memory pressure tests
- [ ] Long-running stability tests

### Planned Benchmarks
- [ ] End-to-end finality latency
- [ ] Network bandwidth utilization
- [ ] Memory usage profiling
- [ ] CPU utilization under load
- [ ] Garbage collection impact

## Contributing

When adding new tests:
1. Place unit tests in module files
2. Place integration tests in `tests/`
3. Place benchmarks in `benches/`
4. Update this README
5. Ensure tests pass with `cargo test`
6. Ensure benchmarks compile with `cargo bench --no-run`

## License

Licensed under MIT OR Apache-2.0

## References

- [PBFT Paper](http://pmg.csail.mit.edu/papers/osdi99.pdf)
- [QUIC Protocol](https://www.rfc-editor.org/rfc/rfc9000.html)
- [RocksDB Documentation](https://rocksdb.org/)
- [CretoAI Documentation](../../README.md)
