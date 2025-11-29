use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use cretoai_crypto::{MLKem768, MLDSA87, BLAKE3Hash};
use std::time::Duration;

fn kem_operations(c: &mut Criterion) {
    let mut group = c.benchmark_group("kem_operations");
    group.measurement_time(Duration::from_secs(10));

    group.bench_function("keygen", |b| {
        b.iter(|| {
            let keypair = MLKem768::generate();
            black_box(keypair);
        });
    });

    let keypair = MLKem768::generate();

    group.bench_function("encapsulate", |b| {
        b.iter(|| {
            let (ciphertext, shared_secret) = MLKem768::encapsulate(&keypair.public_key());
            black_box((ciphertext, shared_secret));
        });
    });

    group.finish();
}

fn signature_operations(c: &mut Criterion) {
    let mut group = c.benchmark_group("signature_operations");
    group.measurement_time(Duration::from_secs(10));

    group.bench_function("keygen", |b| {
        b.iter(|| {
            let keypair = MLDSA87::generate();
            black_box(keypair);
        });
    });

    let keypair = MLDSA87::generate();
    let message = b"test message for signing";

    group.bench_function("sign", |b| {
        b.iter(|| {
            let signature = keypair.sign(message);
            black_box(signature);
        });
    });

    let signature = keypair.sign(message);

    group.bench_function("verify", |b| {
        b.iter(|| {
            let result = keypair.verify(message, &signature);
            black_box(result);
        });
    });

    group.finish();
}

fn hash_operations(c: &mut Criterion) {
    let mut group = c.benchmark_group("hash_operations");

    for size in [1024, 10240, 102400].iter() {
        group.bench_with_input(BenchmarkId::from_parameter(size), size, |b, &size| {
            let data = vec![0u8; size];
            b.iter(|| {
                let hash = BLAKE3Hash::hash(&data);
                black_box(hash);
            });
        });
    }

    group.finish();
}

criterion_group!(benches, kem_operations, signature_operations, hash_operations);
criterion_main!(benches);
