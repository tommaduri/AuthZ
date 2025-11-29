# Vigilia AI Protocol Test Suite

Comprehensive test suite covering unit tests, integration tests, and benchmarks for the Vigilia AI protocol.

## Test Structure

```
tests/
├── unit/                  # Unit tests for individual modules
│   ├── crypto_tests.rs   # Cryptographic operations
│   ├── network_tests.rs  # Network utilities
│   ├── dag_tests.rs      # DAG operations
│   └── exchange_tests.rs # Exchange calculations
├── integration/           # Integration tests
│   ├── message_routing_tests.rs
│   ├── dark_domain_tests.rs
│   ├── consensus_tests.rs
│   └── exchange_transaction_tests.rs
├── benchmarks/            # Performance benchmarks
│   ├── crypto_benchmarks.rs
│   ├── network_benchmarks.rs
│   └── dag_benchmarks.rs
└── common/                # Shared test utilities
    ├── mod.rs
    └── mocks.rs
```

## Running Tests

### Unit Tests
```bash
cargo test --lib
```

### Integration Tests
```bash
cargo test --test '*'
```

### Specific Test Module
```bash
cargo test --test crypto_tests
cargo test --test consensus_tests
```

### With Output
```bash
cargo test -- --nocapture
```

### Benchmarks
```bash
cargo bench
```

### Specific Benchmark
```bash
cargo bench --bench crypto_benchmarks
cargo bench --bench network_benchmarks
cargo bench --bench dag_benchmarks
```

## Test Categories

### Unit Tests (>90% coverage target)

#### Crypto Module
- Key generation (Ed25519, Dilithium)
- Signing and verification
- Encryption and decryption
- Quantum-resistant operations
- Key derivation functions

#### Network Module
- Address parsing (IPv4, IPv6, .dark, .onion)
- Peer management
- Onion circuit construction
- Rate limiting
- Connection pooling

#### DAG Module
- Vertex insertion and validation
- Topological ordering
- Consensus mechanisms
- Conflict resolution
- Finalization

#### Exchange Module
- Fee calculation
- Balance management
- Order matching
- Settlement
- Liquidity pools

### Integration Tests

#### Message Routing
- End-to-end routing through onion circuits
- Multi-hop message delivery
- Circuit resilience and recovery
- Concurrent routing

#### Dark Domain
- Domain registration and resolution
- DNS-like functionality
- Distributed registry
- Cache performance

#### Consensus
- Byzantine fault tolerance
- Multi-node agreement
- Voting rounds
- Network partitions
- Leader election

#### Exchange Transactions
- Complete trade flows
- Order book management
- Atomic settlement
- Fee handling

### Benchmarks

#### Crypto Performance
- Key generation: ~10-100 ops/sec
- Signing: ~50-500 ops/sec
- Verification: ~100-1000 ops/sec
- Encryption: Throughput in MB/s
- Hashing: Throughput in MB/s

#### Network Performance
- Message throughput: >100 msg/sec
- Circuit construction: <500ms for 5 hops
- Routing latency: <100ms per hop
- Concurrent connections: >1000 simultaneous

#### DAG Performance
- Vertex insertion: >1000/sec
- Consensus latency: <1s for 7 nodes
- Finalization: <100ms for chain
- Throughput: >50 vertices/sec

## Property-Based Testing

Uses `proptest` for property-based testing:

```rust
proptest! {
    #[test]
    fn test_encryption_roundtrip(plaintext in any::<Vec<u8>>()) {
        let keypair = crypto::generate_keypair();
        let ciphertext = crypto::encrypt(&plaintext, &keypair.public_key);
        let decrypted = crypto::decrypt(&ciphertext, &keypair.secret_key).unwrap();
        prop_assert_eq!(plaintext, decrypted);
    }
}
```

## Mock Infrastructure

Comprehensive mocks for isolated testing:

- `MockNetwork`: Simulates network with latency and packet loss
- `MockCrypto`: Deterministic crypto for reproducible tests
- `MockDAG`: Lightweight DAG for testing
- `MockConsensus`: Simulates Byzantine agreement
- `MockExchange`: Order matching and settlement

## Test Utilities

### Assertions
```rust
assert_vertex_valid(&vertex)?;
assert_dag_acyclic(&dag)?;
assert_consensus_reached(&network, 0.67)?;
```

### Macros
```rust
let vertex = test_vertex!(b"data");
let vertex = test_vertex!(b"data", parents);

assert_consensus!(network, vertex, timeout)?;

let (result, duration) = time_operation!(expensive_call());
```

### Performance Monitoring
```rust
let mut perf = PerfMonitor::new();
// ... operations ...
perf.checkpoint("operation 1");
// ... more operations ...
perf.checkpoint("operation 2");
println!("{}", perf.report());
```

## Coverage

Generate coverage report:
```bash
cargo tarpaulin --out Html
```

Target: >90% code coverage across all modules

## Continuous Integration

Tests run automatically on:
- Every commit
- Pull requests
- Before releases

CI checks:
- All unit tests pass
- All integration tests pass
- Benchmarks complete
- Coverage meets threshold
- No clippy warnings
- Proper formatting

## Performance Regression

Benchmark results are tracked to detect performance regressions:
```bash
cargo bench -- --save-baseline main
# After changes
cargo bench -- --baseline main
```

## Test Best Practices

1. **Isolation**: Tests should not depend on each other
2. **Determinism**: Tests should be reproducible
3. **Speed**: Unit tests <100ms, integration <5s
4. **Coverage**: Aim for >90% code coverage
5. **Documentation**: Every test should have clear purpose
6. **Assertions**: Use descriptive assertion messages
7. **Cleanup**: Tests should clean up resources
8. **Mocking**: Use mocks for external dependencies

## Contributing

When adding new functionality:
1. Write tests first (TDD)
2. Ensure >90% coverage
3. Add benchmarks for performance-critical code
4. Update this README if adding new test categories
5. Run full test suite before submitting PR

## Troubleshooting

### Tests Hanging
- Check for deadlocks in async code
- Verify timeouts are set correctly
- Use `--nocapture` to see output

### Flaky Tests
- Check for race conditions
- Ensure proper synchronization
- Use deterministic mocks

### Benchmark Variance
- Close background applications
- Run on consistent hardware
- Use `--sample-size` to increase samples

## Contact

For test-related questions, contact the Vigilia AI testing team.
