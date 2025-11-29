# Vigilia AI Test Suite - Quick Start Guide

## Installation

```bash
cd /Users/tommaduri/vigilia-protocol
cargo build
```

## Running Tests

### Quick Test
```bash
# Run all tests
cargo test

# Run with output
cargo test -- --nocapture

# Run specific test
cargo test test_sign_message
```

### By Category
```bash
# Unit tests only
cargo test --lib

# Integration tests
cargo test --test consensus_tests
cargo test --test message_routing_tests

# All integration tests
cargo test --test '*'
```

### Benchmarks
```bash
# All benchmarks
cargo bench

# Specific benchmark suite
cargo bench --bench crypto_benchmarks
cargo bench --bench network_benchmarks
cargo bench --bench dag_benchmarks

# Save baseline
cargo bench -- --save-baseline main

# Compare to baseline
cargo bench -- --baseline main
```

## Test Files Overview

### Unit Tests (`tests/unit/`)
- `crypto_tests.rs` - Cryptographic operations
- `network_tests.rs` - Network utilities
- `dag_tests.rs` - DAG operations
- `exchange_tests.rs` - Exchange calculations

### Integration Tests (`tests/integration/`)
- `message_routing_tests.rs` - End-to-end routing
- `dark_domain_tests.rs` - Domain registration
- `consensus_tests.rs` - Multi-node consensus
- `exchange_transaction_tests.rs` - Trading flows

### Benchmarks (`tests/benchmarks/`)
- `crypto_benchmarks.rs` - Crypto performance
- `network_benchmarks.rs` - Network performance
- `dag_benchmarks.rs` - Consensus performance

## Common Test Patterns

### Basic Test
```rust
#[test]
fn test_example() {
    let result = function_to_test();
    assert_eq!(result, expected_value);
}
```

### Async Test
```rust
#[tokio::test]
async fn test_async_example() {
    let result = async_function().await;
    assert!(result.is_ok());
}
```

### Property-Based Test
```rust
use proptest::prelude::*;

proptest! {
    #[test]
    fn test_property(input in any::<Vec<u8>>()) {
        let result = process(input);
        prop_assert!(validate(result));
    }
}
```

### Benchmark
```rust
fn bench_example(c: &mut Criterion) {
    c.bench_function("operation", |b| {
        b.iter(|| expensive_operation())
    });
}
```

## Using Test Utilities

### Creating Test Vertices
```rust
use vigilia_protocol::test_vertex;

let vertex = test_vertex!(b"data");
let vertex_with_parents = test_vertex!(b"data", vec![parent_hash]);
```

### Performance Monitoring
```rust
use vigilia_protocol::perf::PerfMonitor;

let mut perf = PerfMonitor::new();
operation1();
perf.checkpoint("operation 1");
operation2();
perf.checkpoint("operation 2");
println!("{}", perf.report());
```

### Mock Network
```rust
use vigilia_protocol::mocks::MockNetwork;

let network = MockNetwork::new()
    .with_latency(50)
    .with_packet_loss(0.01);
```

## Coverage

Generate HTML coverage report:
```bash
cargo tarpaulin --out Html --output-dir coverage/
open coverage/index.html
```

## Debugging Tests

### Show test output
```bash
cargo test -- --nocapture
```

### Run single test with logs
```bash
RUST_LOG=debug cargo test test_name -- --nocapture
```

### Show ignored tests
```bash
cargo test -- --ignored
```

## Performance Analysis

### Generate benchmark report
```bash
cargo bench
# View report at target/criterion/report/index.html
```

### Profile with flamegraph
```bash
cargo install flamegraph
cargo flamegraph --bench crypto_benchmarks
```

## Troubleshooting

### Tests hang
- Check for deadlocks in async code
- Verify timeouts are set
- Use `--nocapture` to see where it stops

### Flaky tests
- Add delays for async operations
- Use mocks for deterministic behavior
- Check for race conditions

### Benchmark variance
- Close other applications
- Run multiple times
- Increase sample size

## CI Integration

Tests run automatically on:
- Git push
- Pull requests
- Scheduled runs

View results in CI dashboard.

## Quick Reference

| Command | Purpose |
|---------|---------|
| `cargo test` | Run all tests |
| `cargo test --lib` | Unit tests only |
| `cargo test --test '*'` | Integration tests |
| `cargo bench` | Run benchmarks |
| `cargo tarpaulin` | Coverage report |
| `cargo test -- --nocapture` | Show output |

## Next Steps

1. ✅ Test suite created
2. ⏭️ Implement core modules
3. ⏭️ Run tests and fix failures
4. ⏭️ Achieve >90% coverage
5. ⏭️ Optimize based on benchmarks

## Documentation

- **Full Guide**: `tests/README.md`
- **Test Summary**: `tests/TEST_SUMMARY.md`
- **Common Utilities**: `tests/common/mod.rs`
- **Mock Infrastructure**: `tests/common/mocks.rs`

## Support

For issues or questions:
1. Check test documentation
2. Review example tests
3. Examine mock implementations
4. Contact test maintainers

---

**Test Suite Status**: ✅ Complete and Ready
**Coverage Target**: >90%
**Performance Benchmarks**: Included
**Mock Infrastructure**: Complete
