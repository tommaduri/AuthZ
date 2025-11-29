//! # SIMD Hash Performance Benchmarks
//!
//! Comprehensive benchmarks for SIMD-accelerated BLAKE3 hashing

use criterion::{
    black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput,
};
use cretoai_crypto::simd_hash::{hash_batch, hash_batch_simd, hash_single, SIMDHasher};

/// Benchmark single message hashing with various sizes
fn bench_hash_single(c: &mut Criterion) {
    let mut group = c.benchmark_group("hash_single");

    let sizes = vec![
        ("1KB", 1024),
        ("4KB", 4 * 1024),
        ("16KB", 16 * 1024),
        ("64KB", 64 * 1024),
        ("256KB", 256 * 1024),
        ("1MB", 1024 * 1024),
    ];

    for (name, size) in sizes {
        let data = vec![42u8; size];
        group.throughput(Throughput::Bytes(size as u64));

        group.bench_with_input(BenchmarkId::from_parameter(name), &data, |b, data| {
            b.iter(|| {
                let hash = hash_single(black_box(data));
                black_box(hash);
            });
        });
    }

    group.finish();
}

/// Benchmark batch hashing with parallel processing
fn bench_hash_batch(c: &mut Criterion) {
    let mut group = c.benchmark_group("hash_batch");

    let batch_sizes = vec![
        ("10_msgs_1KB", 10, 1024),
        ("100_msgs_1KB", 100, 1024),
        ("1000_msgs_1KB", 1000, 1024),
        ("100_msgs_64KB", 100, 64 * 1024),
        ("1000_msgs_64KB", 1000, 64 * 1024),
    ];

    for (name, count, msg_size) in batch_sizes {
        let messages: Vec<Vec<u8>> = (0..count).map(|_| vec![42u8; msg_size]).collect();
        let total_bytes = (count * msg_size) as u64;
        group.throughput(Throughput::Bytes(total_bytes));

        group.bench_with_input(
            BenchmarkId::from_parameter(name),
            &messages,
            |b, messages| {
                b.iter(|| {
                    let hashes = hash_batch(black_box(messages));
                    black_box(hashes);
                });
            },
        );
    }

    group.finish();
}

/// Benchmark SIMD-optimized batch hashing
fn bench_hash_batch_simd(c: &mut Criterion) {
    let mut group = c.benchmark_group("hash_batch_simd");

    let batch_sizes = vec![
        ("10_msgs_1KB", 10, 1024),
        ("100_msgs_1KB", 100, 1024),
        ("1000_msgs_1KB", 1000, 1024),
        ("10000_msgs_1KB", 10000, 1024),
    ];

    for (name, count, msg_size) in batch_sizes {
        let messages: Vec<Vec<u8>> = (0..count).map(|_| vec![42u8; msg_size]).collect();
        let total_bytes = (count * msg_size) as u64;
        group.throughput(Throughput::Bytes(total_bytes));

        group.bench_with_input(
            BenchmarkId::from_parameter(name),
            &messages,
            |b, messages| {
                b.iter(|| {
                    let hashes = hash_batch_simd(black_box(messages));
                    black_box(hashes);
                });
            },
        );
    }

    group.finish();
}

/// Compare SIMD vs non-SIMD batch processing
fn bench_simd_comparison(c: &mut Criterion) {
    let mut group = c.benchmark_group("simd_comparison");

    let messages: Vec<Vec<u8>> = (0..1000).map(|_| vec![42u8; 1024]).collect();
    let total_bytes = (1000 * 1024) as u64;
    group.throughput(Throughput::Bytes(total_bytes));

    group.bench_function("parallel_batch", |b| {
        b.iter(|| {
            let hashes = hash_batch(black_box(&messages));
            black_box(hashes);
        });
    });

    group.bench_function("simd_batch", |b| {
        b.iter(|| {
            let hashes = hash_batch_simd(black_box(&messages));
            black_box(hashes);
        });
    });

    group.bench_function("sequential", |b| {
        b.iter(|| {
            let hashes: Vec<_> = messages
                .iter()
                .map(|msg| hash_single(black_box(msg)))
                .collect();
            black_box(hashes);
        });
    });

    group.finish();
}

/// Benchmark hasher methods
fn bench_hasher_methods(c: &mut Criterion) {
    let mut group = c.benchmark_group("hasher_methods");
    let hasher = SIMDHasher::new();

    let data = vec![42u8; 4096];
    group.throughput(Throughput::Bytes(4096));

    group.bench_function("hash_single", |b| {
        b.iter(|| {
            let hash = hasher.hash_single(black_box(&data));
            black_box(hash);
        });
    });

    let messages: Vec<Vec<u8>> = (0..100).map(|_| vec![42u8; 1024]).collect();
    group.throughput(Throughput::Bytes(100 * 1024));

    group.bench_function("hash_batch", |b| {
        b.iter(|| {
            let hashes = hasher.hash_batch(black_box(&messages));
            black_box(hashes);
        });
    });

    group.bench_function("hash_batch_simd", |b| {
        b.iter(|| {
            let hashes = hasher.hash_batch_simd(black_box(&messages));
            black_box(hashes);
        });
    });

    group.finish();
}

/// Benchmark keyed hashing
fn bench_keyed_hash(c: &mut Criterion) {
    let mut group = c.benchmark_group("keyed_hash");
    let hasher = SIMDHasher::new();
    let key = [42u8; 32];

    let sizes = vec![("1KB", 1024), ("64KB", 64 * 1024), ("1MB", 1024 * 1024)];

    for (name, size) in sizes {
        let data = vec![42u8; size];
        group.throughput(Throughput::Bytes(size as u64));

        group.bench_with_input(BenchmarkId::from_parameter(name), &data, |b, data| {
            b.iter(|| {
                let hash = hasher.hash_keyed(black_box(&key), black_box(data));
                black_box(hash);
            });
        });
    }

    group.finish();
}

/// Benchmark large data hashing with parallel tree hashing
fn bench_large_data(c: &mut Criterion) {
    let mut group = c.benchmark_group("large_data");
    let hasher = SIMDHasher::new();

    let sizes = vec![
        ("1MB", 1024 * 1024),
        ("4MB", 4 * 1024 * 1024),
        ("16MB", 16 * 1024 * 1024),
    ];

    for (name, size) in sizes {
        let data = vec![42u8; size];
        group.throughput(Throughput::Bytes(size as u64));

        group.bench_with_input(BenchmarkId::from_parameter(name), &data, |b, data| {
            b.iter(|| {
                let hash = hasher.hash_large(black_box(data));
                black_box(hash);
            });
        });
    }

    group.finish();
}

/// Benchmark batch keyed hashing
fn bench_batch_keyed(c: &mut Criterion) {
    let mut group = c.benchmark_group("batch_keyed");
    let hasher = SIMDHasher::new();
    let key = [42u8; 32];

    let messages: Vec<Vec<u8>> = (0..1000).map(|_| vec![42u8; 1024]).collect();
    group.throughput(Throughput::Bytes(1000 * 1024));

    group.bench_function("batch_keyed_1000", |b| {
        b.iter(|| {
            let hashes = hasher.hash_batch_keyed(black_box(&key), black_box(&messages));
            black_box(hashes);
        });
    });

    group.finish();
}

/// Benchmark different batch sizes for optimal chunking
fn bench_batch_sizes(c: &mut Criterion) {
    let mut group = c.benchmark_group("batch_sizes");

    let batch_counts = vec![1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];

    for count in batch_counts {
        let messages: Vec<Vec<u8>> = (0..count).map(|_| vec![42u8; 1024]).collect();
        let total_bytes = (count * 1024) as u64;
        group.throughput(Throughput::Bytes(total_bytes));

        group.bench_with_input(
            BenchmarkId::from_parameter(count),
            &messages,
            |b, messages| {
                b.iter(|| {
                    let hashes = hash_batch_simd(black_box(messages));
                    black_box(hashes);
                });
            },
        );
    }

    group.finish();
}

criterion_group!(
    benches,
    bench_hash_single,
    bench_hash_batch,
    bench_hash_batch_simd,
    bench_simd_comparison,
    bench_hasher_methods,
    bench_keyed_hash,
    bench_large_data,
    bench_batch_keyed,
    bench_batch_sizes,
);

criterion_main!(benches);
