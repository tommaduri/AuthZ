//! Benchmark suite for ML-DSA batch signature verification
//!
//! Measures performance improvements from batch verification across different
//! batch sizes and compares sequential vs parallel execution.

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use cretoai_crypto::batch_verify::{BatchConfig, BatchItem, BatchVerifier};
use cretoai_crypto::signatures::MLDSA87;
use std::time::Duration;

/// Generate test signatures for benchmarking
fn generate_test_signatures(count: usize) -> Vec<BatchItem> {
    (0..count)
        .map(|i| {
            let keypair = MLDSA87::generate();
            let message = format!("benchmark message {}", i).into_bytes();
            let signature = keypair.sign(&message);

            BatchItem::new(
                message,
                signature.as_bytes().to_vec(),
                keypair.public_key.as_bytes().to_vec(),
            )
        })
        .collect()
}

/// Benchmark single signature verification (baseline)
fn bench_single_verification(c: &mut Criterion) {
    let items = generate_test_signatures(1);
    let item = &items[0];

    c.bench_function("single_verification", |b| {
        b.iter(|| {
            let mut verifier = BatchVerifier::new();
            verifier.add_item(black_box(item.clone()));
            let results = verifier.verify_batch();
            black_box(results);
        });
    });
}

/// Benchmark sequential batch verification
fn bench_sequential_batch(c: &mut Criterion) {
    let mut group = c.benchmark_group("sequential_batch");

    for size in [8, 16, 32, 64, 128].iter() {
        let items = generate_test_signatures(*size);

        group.throughput(Throughput::Elements(*size as u64));
        group.bench_with_input(BenchmarkId::from_parameter(size), size, |b, _| {
            b.iter(|| {
                let mut verifier = BatchVerifier::new();
                for item in &items {
                    verifier.add_item(item.clone());
                }
                let results = verifier.verify_batch();
                black_box(results);
            });
        });
    }

    group.finish();
}

/// Benchmark parallel batch verification
fn bench_parallel_batch(c: &mut Criterion) {
    let mut group = c.benchmark_group("parallel_batch");

    for size in [8, 16, 32, 64, 128].iter() {
        let items = generate_test_signatures(*size);

        group.throughput(Throughput::Elements(*size as u64));
        group.bench_with_input(BenchmarkId::from_parameter(size), size, |b, _| {
            b.iter(|| {
                let mut verifier = BatchVerifier::new();
                for item in &items {
                    verifier.add_item(item.clone());
                }
                let results = verifier.verify_batch_parallel();
                black_box(results);
            });
        });
    }

    group.finish();
}

/// Compare sequential vs parallel for different batch sizes
fn bench_sequential_vs_parallel(c: &mut Criterion) {
    let mut group = c.benchmark_group("seq_vs_parallel");
    group.measurement_time(Duration::from_secs(10));

    for size in [32, 64, 128].iter() {
        let items = generate_test_signatures(*size);

        // Sequential
        group.throughput(Throughput::Elements(*size as u64));
        group.bench_with_input(
            BenchmarkId::new("sequential", size),
            size,
            |b, _| {
                b.iter(|| {
                    let mut verifier = BatchVerifier::new();
                    for item in &items {
                        verifier.add_item(item.clone());
                    }
                    let results = verifier.verify_batch();
                    black_box(results);
                });
            },
        );

        // Parallel
        group.throughput(Throughput::Elements(*size as u64));
        group.bench_with_input(
            BenchmarkId::new("parallel", size),
            size,
            |b, _| {
                b.iter(|| {
                    let mut verifier = BatchVerifier::new();
                    for item in &items {
                        verifier.add_item(item.clone());
                    }
                    let results = verifier.verify_batch_parallel();
                    black_box(results);
                });
            },
        );
    }

    group.finish();
}

/// Benchmark different batch sizes with auto-tuning
fn bench_batch_size_tuning(c: &mut Criterion) {
    let mut group = c.benchmark_group("batch_size_tuning");
    group.measurement_time(Duration::from_secs(10));

    let total_sigs = 128;
    let items = generate_test_signatures(total_sigs);

    for batch_size in [8, 16, 32, 64].iter() {
        let config = BatchConfig {
            batch_size: Some(*batch_size),
            parallel: true,
            early_exit: false,
            worker_threads: None,
        };

        group.throughput(Throughput::Elements(total_sigs as u64));
        group.bench_with_input(
            BenchmarkId::from_parameter(batch_size),
            batch_size,
            |b, _| {
                b.iter(|| {
                    let mut verifier = BatchVerifier::with_config(config.clone());
                    for item in &items {
                        verifier.add_item(item.clone());
                    }
                    let results = verifier.verify_batch_parallel();
                    black_box(results);
                });
            },
        );
    }

    group.finish();
}

/// Benchmark early exit on failure
fn bench_early_exit(c: &mut Criterion) {
    let mut group = c.benchmark_group("early_exit");

    let size = 128;
    let mut items = generate_test_signatures(size);

    // Corrupt signature at position 10
    items[10].signature[0] ^= 0xFF;

    // Without early exit
    group.bench_function("no_early_exit", |b| {
        b.iter(|| {
            let config = BatchConfig {
                batch_size: Some(32),
                parallel: true,
                early_exit: false,
                worker_threads: None,
            };

            let mut verifier = BatchVerifier::with_config(config);
            for item in &items {
                verifier.add_item(item.clone());
            }
            let results = verifier.verify_batch_parallel();
            black_box(results);
        });
    });

    // With early exit
    group.bench_function("with_early_exit", |b| {
        b.iter(|| {
            let config = BatchConfig {
                batch_size: Some(32),
                parallel: true,
                early_exit: true,
                worker_threads: None,
            };

            let mut verifier = BatchVerifier::with_config(config);
            for item in &items {
                verifier.add_item(item.clone());
            }
            let results = verifier.verify_batch_parallel();
            black_box(results);
        });
    });

    group.finish();
}

/// Benchmark verification throughput (signatures per second)
fn bench_throughput(c: &mut Criterion) {
    let mut group = c.benchmark_group("throughput");
    group.measurement_time(Duration::from_secs(15));

    // Large batch to measure peak throughput
    let size = 256;
    let items = generate_test_signatures(size);

    group.throughput(Throughput::Elements(size as u64));
    group.bench_function("peak_throughput", |b| {
        b.iter(|| {
            let mut verifier = BatchVerifier::new();
            for item in &items {
                verifier.add_item(item.clone());
            }
            let results = verifier.verify_batch_parallel();
            black_box(results);
        });
    });

    group.finish();
}

/// Benchmark memory efficiency with reuse
fn bench_memory_reuse(c: &mut Criterion) {
    let mut group = c.benchmark_group("memory_reuse");

    let batch_count = 10;
    let batch_size = 32;

    // Without reuse (create new verifier each time)
    group.bench_function("no_reuse", |b| {
        b.iter(|| {
            for _ in 0..batch_count {
                let items = generate_test_signatures(batch_size);
                let mut verifier = BatchVerifier::new();
                for item in items {
                    verifier.add_item(item);
                }
                let results = verifier.verify_batch_parallel();
                black_box(results);
            }
        });
    });

    // With reuse (clear and reuse verifier)
    group.bench_function("with_reuse", |b| {
        b.iter(|| {
            let mut verifier = BatchVerifier::new();
            for _ in 0..batch_count {
                let items = generate_test_signatures(batch_size);
                for item in items {
                    verifier.add_item(item);
                }
                let results = verifier.verify_batch_parallel();
                black_box(results);
                verifier.clear();
            }
        });
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_single_verification,
    bench_sequential_batch,
    bench_parallel_batch,
    bench_sequential_vs_parallel,
    bench_batch_size_tuning,
    bench_early_exit,
    bench_throughput,
    bench_memory_reuse,
);

criterion_main!(benches);
