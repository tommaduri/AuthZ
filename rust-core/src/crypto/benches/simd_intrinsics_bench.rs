//! Benchmarks for SIMD intrinsics implementations
//!
//! Compares performance across AVX-512, AVX2, NEON, and portable implementations

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use cretoai_crypto::simd_intrinsics::{detect_simd_features, SIMDOps, SIMDPlatform};

const SIZES: &[usize] = &[64, 256, 1024, 4096, 16384, 65536];

fn benchmark_xor_parallel(c: &mut Criterion) {
    let mut group = c.benchmark_group("xor_parallel");
    let ops = SIMDOps::new();
    let platform = detect_simd_features();

    println!("Detected SIMD platform: {:?}", platform);

    for &size in SIZES {
        group.throughput(Throughput::Bytes(size as u64));

        let a = vec![0x5A; size];
        let b = vec![0xA5; size];

        group.bench_with_input(BenchmarkId::new("detected", size), &size, |bench, _| {
            bench.iter(|| {
                let result = ops.xor_parallel(black_box(&a), black_box(&b));
                black_box(result)
            });
        });

        // Benchmark portable implementation for comparison
        let ops_portable = SIMDOps::with_platform(SIMDPlatform::Portable);
        group.bench_with_input(BenchmarkId::new("portable", size), &size, |bench, _| {
            bench.iter(|| {
                let result = ops_portable.xor_parallel(black_box(&a), black_box(&b));
                black_box(result)
            });
        });

        #[cfg(target_arch = "x86_64")]
        {
            if matches!(platform, SIMDPlatform::AVX512 | SIMDPlatform::AVX2) {
                let ops_avx2 = SIMDOps::with_platform(SIMDPlatform::AVX2);
                group.bench_with_input(BenchmarkId::new("avx2", size), &size, |bench, _| {
                    bench.iter(|| {
                        let result = ops_avx2.xor_parallel(black_box(&a), black_box(&b));
                        black_box(result)
                    });
                });
            }

            if matches!(platform, SIMDPlatform::AVX512) {
                let ops_avx512 = SIMDOps::with_platform(SIMDPlatform::AVX512);
                group.bench_with_input(BenchmarkId::new("avx512", size), &size, |bench, _| {
                    bench.iter(|| {
                        let result = ops_avx512.xor_parallel(black_box(&a), black_box(&b));
                        black_box(result)
                    });
                });
            }
        }

        #[cfg(target_arch = "aarch64")]
        {
            let ops_neon = SIMDOps::with_platform(SIMDPlatform::NEON);
            group.bench_with_input(BenchmarkId::new("neon", size), &size, |bench, _| {
                bench.iter(|| {
                    let result = ops_neon.xor_parallel(black_box(&a), black_box(&b));
                    black_box(result)
                });
            });
        }
    }

    group.finish();
}

fn benchmark_add_parallel(c: &mut Criterion) {
    let mut group = c.benchmark_group("add_parallel");
    let ops = SIMDOps::new();
    let platform = detect_simd_features();

    for &size in SIZES {
        let u64_size = size / 8;
        group.throughput(Throughput::Bytes((u64_size * 8) as u64));

        let a = vec![0x123456789ABCDEF0u64; u64_size];
        let b = vec![0xFEDCBA9876543210u64; u64_size];

        group.bench_with_input(BenchmarkId::new("detected", u64_size), &u64_size, |bench, _| {
            bench.iter(|| {
                let result = ops.add_parallel(black_box(&a), black_box(&b));
                black_box(result)
            });
        });

        let ops_portable = SIMDOps::with_platform(SIMDPlatform::Portable);
        group.bench_with_input(BenchmarkId::new("portable", u64_size), &u64_size, |bench, _| {
            bench.iter(|| {
                let result = ops_portable.add_parallel(black_box(&a), black_box(&b));
                black_box(result)
            });
        });

        #[cfg(target_arch = "x86_64")]
        {
            if matches!(platform, SIMDPlatform::AVX512 | SIMDPlatform::AVX2) {
                let ops_avx2 = SIMDOps::with_platform(SIMDPlatform::AVX2);
                group.bench_with_input(BenchmarkId::new("avx2", u64_size), &u64_size, |bench, _| {
                    bench.iter(|| {
                        let result = ops_avx2.add_parallel(black_box(&a), black_box(&b));
                        black_box(result)
                    });
                });
            }

            if matches!(platform, SIMDPlatform::AVX512) {
                let ops_avx512 = SIMDOps::with_platform(SIMDPlatform::AVX512);
                group.bench_with_input(BenchmarkId::new("avx512", u64_size), &u64_size, |bench, _| {
                    bench.iter(|| {
                        let result = ops_avx512.add_parallel(black_box(&a), black_box(&b));
                        black_box(result)
                    });
                });
            }
        }

        #[cfg(target_arch = "aarch64")]
        {
            let ops_neon = SIMDOps::with_platform(SIMDPlatform::NEON);
            group.bench_with_input(BenchmarkId::new("neon", u64_size), &u64_size, |bench, _| {
                bench.iter(|| {
                    let result = ops_neon.add_parallel(black_box(&a), black_box(&b));
                    black_box(result)
                });
            });
        }
    }

    group.finish();
}

fn benchmark_permute_bytes(c: &mut Criterion) {
    let mut group = c.benchmark_group("permute_bytes");
    let ops = SIMDOps::new();
    let platform = detect_simd_features();

    for &size in SIZES {
        group.throughput(Throughput::Bytes(size as u64));

        let data: Vec<u8> = (0..size).map(|i| (i % 256) as u8).collect();
        let indices: Vec<u8> = (0..size).rev().map(|i| (i % size) as u8).collect();

        group.bench_with_input(BenchmarkId::new("detected", size), &size, |bench, _| {
            bench.iter(|| {
                let result = ops.permute_bytes(black_box(&data), black_box(&indices));
                black_box(result)
            });
        });

        let ops_portable = SIMDOps::with_platform(SIMDPlatform::Portable);
        group.bench_with_input(BenchmarkId::new("portable", size), &size, |bench, _| {
            bench.iter(|| {
                let result = ops_portable.permute_bytes(black_box(&data), black_box(&indices));
                black_box(result)
            });
        });

        #[cfg(target_arch = "x86_64")]
        {
            if matches!(platform, SIMDPlatform::AVX512 | SIMDPlatform::AVX2) {
                let ops_avx2 = SIMDOps::with_platform(SIMDPlatform::AVX2);
                group.bench_with_input(BenchmarkId::new("avx2", size), &size, |bench, _| {
                    bench.iter(|| {
                        let result = ops_avx2.permute_bytes(black_box(&data), black_box(&indices));
                        black_box(result)
                    });
                });
            }

            if matches!(platform, SIMDPlatform::AVX512) {
                let ops_avx512 = SIMDOps::with_platform(SIMDPlatform::AVX512);
                group.bench_with_input(BenchmarkId::new("avx512", size), &size, |bench, _| {
                    bench.iter(|| {
                        let result = ops_avx512.permute_bytes(black_box(&data), black_box(&indices));
                        black_box(result)
                    });
                });
            }
        }

        #[cfg(target_arch = "aarch64")]
        {
            let ops_neon = SIMDOps::with_platform(SIMDPlatform::NEON);
            group.bench_with_input(BenchmarkId::new("neon", size), &size, |bench, _| {
                bench.iter(|| {
                    let result = ops_neon.permute_bytes(black_box(&data), black_box(&indices));
                    black_box(result)
                });
            });
        }
    }

    group.finish();
}

fn benchmark_hash_parallel(c: &mut Criterion) {
    let mut group = c.benchmark_group("hash_parallel");
    let ops = SIMDOps::new();

    let message_counts = [1, 4, 16, 64, 256];

    for &count in &message_counts {
        let messages: Vec<Vec<u8>> = (0..count)
            .map(|i| vec![i as u8; 1024])
            .collect();
        let message_refs: Vec<&[u8]> = messages.iter().map(|v| v.as_slice()).collect();

        group.throughput(Throughput::Bytes((count * 1024) as u64));

        group.bench_with_input(BenchmarkId::new("hash", count), &count, |bench, _| {
            bench.iter(|| {
                let result = ops.hash_parallel(black_box(&message_refs));
                black_box(result)
            });
        });
    }

    group.finish();
}

fn benchmark_throughput_comparison(c: &mut Criterion) {
    let mut group = c.benchmark_group("throughput_comparison");
    let platform = detect_simd_features();

    println!("\n=== SIMD Platform Detection ===");
    println!("Detected platform: {:?}", platform);
    println!("Vector width: {} bytes", platform.vector_width());
    println!("SIMD enabled: {}", platform.is_simd());

    // Large buffer for throughput testing
    const LARGE_SIZE: usize = 1024 * 1024; // 1 MB
    group.throughput(Throughput::Bytes(LARGE_SIZE as u64));

    let a = vec![0x5A; LARGE_SIZE];
    let b = vec![0xA5; LARGE_SIZE];

    let ops = SIMDOps::new();
    group.bench_function("xor_1mb_detected", |bench| {
        bench.iter(|| {
            let result = ops.xor_parallel(black_box(&a), black_box(&b));
            black_box(result)
        });
    });

    let ops_portable = SIMDOps::with_platform(SIMDPlatform::Portable);
    group.bench_function("xor_1mb_portable", |bench| {
        bench.iter(|| {
            let result = ops_portable.xor_parallel(black_box(&a), black_box(&b));
            black_box(result)
        });
    });

    group.finish();
}

criterion_group!(
    benches,
    benchmark_xor_parallel,
    benchmark_add_parallel,
    benchmark_permute_bytes,
    benchmark_hash_parallel,
    benchmark_throughput_comparison,
);

criterion_main!(benches);
