//! Benchmark tests for cryptographic operations
//! Uses criterion for comprehensive performance analysis

use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId, Throughput};
use std::time::Duration;

fn bench_key_generation(c: &mut Criterion) {
    let mut group = c.benchmark_group("key_generation");

    group.bench_function("ed25519_keypair", |b| {
        b.iter(|| {
            crypto::generate_keypair()
        });
    });

    group.bench_function("ed25519_from_seed", |b| {
        let seed = [42u8; 32];
        b.iter(|| {
            crypto::keypair_from_seed(black_box(&seed))
        });
    });

    group.bench_function("dilithium_keypair", |b| {
        b.iter(|| {
            crypto::generate_pq_keypair()
        });
    });

    group.finish();
}

fn bench_signing(c: &mut Criterion) {
    let mut group = c.benchmark_group("signing");
    let keypair = crypto::generate_keypair();

    // Benchmark different message sizes
    for size in [64, 256, 1024, 4096, 16384, 65536].iter() {
        let message = vec![0u8; *size];

        group.throughput(Throughput::Bytes(*size as u64));
        group.bench_with_input(BenchmarkId::new("ed25519", size), size, |b, _| {
            b.iter(|| {
                crypto::sign(black_box(&message), &keypair.secret_key)
            });
        });
    }

    // Post-quantum signing
    let pq_keypair = crypto::generate_pq_keypair();
    let message = vec![0u8; 1024];

    group.bench_function("dilithium_sign", |b| {
        b.iter(|| {
            crypto::pq_sign(black_box(&message), &pq_keypair.secret_key)
        });
    });

    group.finish();
}

fn bench_verification(c: &mut Criterion) {
    let mut group = c.benchmark_group("verification");
    let keypair = crypto::generate_keypair();

    for size in [64, 256, 1024, 4096, 16384].iter() {
        let message = vec![0u8; *size];
        let signature = crypto::sign(&message, &keypair.secret_key);

        group.throughput(Throughput::Bytes(*size as u64));
        group.bench_with_input(BenchmarkId::new("ed25519", size), size, |b, _| {
            b.iter(|| {
                crypto::verify(
                    black_box(&message),
                    black_box(&signature),
                    &keypair.public_key
                )
            });
        });
    }

    // Post-quantum verification
    let pq_keypair = crypto::generate_pq_keypair();
    let message = vec![0u8; 1024];
    let signature = crypto::pq_sign(&message, &pq_keypair.secret_key);

    group.bench_function("dilithium_verify", |b| {
        b.iter(|| {
            crypto::pq_verify(
                black_box(&message),
                black_box(&signature),
                &pq_keypair.public_key
            )
        });
    });

    group.finish();
}

fn bench_encryption(c: &mut Criterion) {
    let mut group = c.benchmark_group("encryption");
    group.sample_size(100);

    let keypair = crypto::generate_keypair();

    for size in [64, 256, 1024, 4096, 16384, 65536, 1048576].iter() {
        let plaintext = vec![0u8; *size];

        group.throughput(Throughput::Bytes(*size as u64));
        group.bench_with_input(BenchmarkId::new("encrypt", size), size, |b, _| {
            b.iter(|| {
                crypto::encrypt(black_box(&plaintext), &keypair.public_key)
            });
        });
    }

    group.finish();
}

fn bench_decryption(c: &mut Criterion) {
    let mut group = c.benchmark_group("decryption");
    group.sample_size(100);

    let keypair = crypto::generate_keypair();

    for size in [64, 256, 1024, 4096, 16384, 65536].iter() {
        let plaintext = vec![0u8; *size];
        let ciphertext = crypto::encrypt(&plaintext, &keypair.public_key);

        group.throughput(Throughput::Bytes(*size as u64));
        group.bench_with_input(BenchmarkId::new("decrypt", size), size, |b, _| {
            b.iter(|| {
                crypto::decrypt(black_box(&ciphertext), &keypair.secret_key)
            });
        });
    }

    group.finish();
}

fn bench_hashing(c: &mut Criterion) {
    let mut group = c.benchmark_group("hashing");

    for size in [64, 256, 1024, 4096, 16384, 65536, 1048576].iter() {
        let data = vec![0u8; *size];

        group.throughput(Throughput::Bytes(*size as u64));

        group.bench_with_input(BenchmarkId::new("blake3", size), size, |b, _| {
            b.iter(|| {
                crypto::blake3_hash(black_box(&data))
            });
        });

        group.bench_with_input(BenchmarkId::new("sha256", size), size, |b, _| {
            b.iter(|| {
                crypto::sha256_hash(black_box(&data))
            });
        });
    }

    group.finish();
}

fn bench_key_derivation(c: &mut Criterion) {
    let mut group = c.benchmark_group("key_derivation");

    let alice = crypto::generate_keypair();
    let bob = crypto::generate_keypair();

    group.bench_function("ecdh", |b| {
        b.iter(|| {
            crypto::derive_shared_secret(
                black_box(&alice.secret_key),
                black_box(&bob.public_key)
            )
        });
    });

    let input = b"input key material";
    let salt = b"unique salt";

    group.bench_function("argon2", |b| {
        b.iter(|| {
            crypto::argon2_kdf(black_box(input), black_box(salt), 32)
        });
    });

    group.bench_function("hkdf", |b| {
        b.iter(|| {
            crypto::hkdf(black_box(input), black_box(salt), 32)
        });
    });

    group.finish();
}

fn bench_onion_encryption(c: &mut Criterion) {
    let mut group = c.benchmark_group("onion_encryption");
    group.sample_size(50);

    let message = vec![0u8; 1024];

    for hops in [1, 3, 5, 7].iter() {
        let circuit = network::Circuit::new(*hops);

        group.bench_with_input(
            BenchmarkId::new("onion_encrypt", hops),
            hops,
            |b, _| {
                b.iter(|| {
                    circuit.encrypt_onion(black_box(&message))
                });
            }
        );

        let onion = circuit.encrypt_onion(&message);

        group.bench_with_input(
            BenchmarkId::new("onion_decrypt", hops),
            hops,
            |b, _| {
                b.iter(|| {
                    circuit.decrypt_onion(black_box(&onion))
                });
            }
        );
    }

    group.finish();
}

fn bench_hybrid_encryption(c: &mut Criterion) {
    let mut group = c.benchmark_group("hybrid_encryption");
    group.sample_size(50);

    let classical_keypair = crypto::generate_keypair();
    let pq_keypair = crypto::generate_pq_keypair();

    let plaintext = vec![0u8; 1024];

    group.bench_function("hybrid_encrypt", |b| {
        b.iter(|| {
            crypto::hybrid_encrypt(
                black_box(&plaintext),
                &classical_keypair.public_key,
                &pq_keypair.public_key
            )
        });
    });

    let ciphertext = crypto::hybrid_encrypt(
        &plaintext,
        &classical_keypair.public_key,
        &pq_keypair.public_key
    );

    group.bench_function("hybrid_decrypt", |b| {
        b.iter(|| {
            crypto::hybrid_decrypt(
                black_box(&ciphertext),
                &classical_keypair.secret_key,
                &pq_keypair.secret_key
            )
        });
    });

    group.finish();
}

fn bench_batch_operations(c: &mut Criterion) {
    let mut group = c.benchmark_group("batch_operations");
    group.sample_size(30);

    // Batch signature verification
    let keypairs: Vec<_> = (0..100).map(|_| crypto::generate_keypair()).collect();
    let messages: Vec<_> = (0..100).map(|i| format!("message {}", i).into_bytes()).collect();
    let signatures: Vec<_> = keypairs.iter()
        .zip(&messages)
        .map(|(kp, msg)| crypto::sign(msg, &kp.secret_key))
        .collect();

    group.bench_function("batch_verify_100", |b| {
        b.iter(|| {
            for ((sig, msg), kp) in signatures.iter().zip(&messages).zip(&keypairs) {
                crypto::verify(black_box(msg), black_box(sig), &kp.public_key);
            }
        });
    });

    group.finish();
}

fn bench_memory_usage(c: &mut Criterion) {
    let mut group = c.benchmark_group("memory_usage");

    group.bench_function("keypair_memory", |b| {
        b.iter(|| {
            let keypairs: Vec<_> = (0..1000)
                .map(|_| crypto::generate_keypair())
                .collect();
            black_box(keypairs);
        });
    });

    group.bench_function("signature_memory", |b| {
        let keypair = crypto::generate_keypair();
        b.iter(|| {
            let signatures: Vec<_> = (0..1000)
                .map(|i| {
                    let msg = format!("message {}", i);
                    crypto::sign(msg.as_bytes(), &keypair.secret_key)
                })
                .collect();
            black_box(signatures);
        });
    });

    group.finish();
}

criterion_group! {
    name = crypto_benches;
    config = Criterion::default()
        .measurement_time(Duration::from_secs(10))
        .sample_size(100);
    targets =
        bench_key_generation,
        bench_signing,
        bench_verification,
        bench_encryption,
        bench_decryption,
        bench_hashing,
        bench_key_derivation,
        bench_onion_encryption,
        bench_hybrid_encryption,
        bench_batch_operations,
        bench_memory_usage
}

criterion_main!(crypto_benches);
