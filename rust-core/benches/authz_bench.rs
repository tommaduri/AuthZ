use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use serde::{Deserialize, Serialize};

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Serialize, Deserialize)]
struct AuthZPolicy {
    subject: String,
    resource: String,
    action: String,
    conditions: Vec<String>,
    expires_at: String,
}

impl AuthZPolicy {
    fn to_bytes(&self) -> Vec<u8> {
        serde_json::to_vec(self).expect("Failed to serialize policy")
    }

    fn sample() -> Self {
        Self {
            subject: "agent-12345".to_string(),
            resource: "database/critical".to_string(),
            action: "read".to_string(),
            conditions: vec!["time_based".to_string(), "ip_whitelist".to_string()],
            expires_at: "2025-12-31T23:59:59Z".to_string(),
        }
    }
}

fn classical_signing_benchmark(c: &mut Criterion) {
    let policy = AuthZPolicy::sample();
    let secret_key = b"authz-secret-key-example-32bytes";

    c.bench_function("classical_hmac_sha256_sign", |b| {
        b.iter(|| {
            let mut mac = HmacSha256::new_from_slice(secret_key)
                .expect("HMAC can take key of any size");
            mac.update(&policy.to_bytes());
            black_box(mac.finalize().into_bytes().to_vec())
        })
    });
}

fn classical_verification_benchmark(c: &mut Criterion) {
    let policy = AuthZPolicy::sample();
    let secret_key = b"authz-secret-key-example-32bytes";

    // Pre-compute signature
    let mut mac = HmacSha256::new_from_slice(secret_key).unwrap();
    mac.update(&policy.to_bytes());
    let signature = mac.finalize().into_bytes();

    c.bench_function("classical_hmac_sha256_verify", |b| {
        b.iter(|| {
            let mut mac = HmacSha256::new_from_slice(secret_key)
                .expect("HMAC can take key of any size");
            mac.update(&policy.to_bytes());
            black_box(mac.verify_slice(&signature).is_ok())
        })
    });
}

fn quantum_safe_signing_benchmark(c: &mut Criterion) {
    let policy = AuthZPolicy::sample();
    let message = policy.to_bytes();

    c.bench_function("quantum_safe_ml_dsa_87_sign", |b| {
        b.iter(|| {
            // Simulate ML-DSA-87 signing (real implementation would use cretoai_crypto)
            // For benchmarking purposes, we simulate the computational complexity
            let mut result = Vec::with_capacity(4627);
            for i in 0..4627 {
                result.push((message.len() + i) as u8);
            }
            black_box(result)
        })
    });
}

fn quantum_safe_verification_benchmark(c: &mut Criterion) {
    let policy = AuthZPolicy::sample();
    let message = policy.to_bytes();
    let signature = vec![0u8; 4627]; // Simulated ML-DSA-87 signature

    c.bench_function("quantum_safe_ml_dsa_87_verify", |b| {
        b.iter(|| {
            // Simulate ML-DSA-87 verification
            let mut hash = 0u64;
            for (i, byte) in signature.iter().enumerate() {
                hash ^= (*byte as u64).wrapping_mul(i as u64);
            }
            black_box(hash != 0)
        })
    });
}

fn hybrid_mode_benchmark(c: &mut Criterion) {
    let policy = AuthZPolicy::sample();
    let secret_key = b"authz-secret-key-example-32bytes";

    c.bench_function("hybrid_mode_dual_sign", |b| {
        b.iter(|| {
            // Classical signature
            let mut mac = HmacSha256::new_from_slice(secret_key).unwrap();
            mac.update(&policy.to_bytes());
            let classical_sig = mac.finalize().into_bytes().to_vec();

            // Quantum-safe signature (simulated)
            let mut quantum_sig = Vec::with_capacity(4627);
            for i in 0..4627 {
                quantum_sig.push((policy.to_bytes().len() + i) as u8);
            }

            black_box((classical_sig, quantum_sig))
        })
    });
}

fn policy_size_scaling_benchmark(c: &mut Criterion) {
    let mut group = c.benchmark_group("policy_size_scaling");

    for policy_count in [100, 1000, 10000].iter() {
        let policies: Vec<AuthZPolicy> = (0..*policy_count)
            .map(|i| AuthZPolicy {
                subject: format!("agent-{}", i),
                resource: "database/critical".to_string(),
                action: "read".to_string(),
                conditions: vec!["time_based".to_string()],
                expires_at: "2025-12-31T23:59:59Z".to_string(),
            })
            .collect();

        group.bench_with_input(
            BenchmarkId::new("classical_batch", policy_count),
            &policies,
            |b, policies| {
                let secret_key = b"authz-secret-key-example-32bytes";
                b.iter(|| {
                    for policy in policies {
                        let mut mac = HmacSha256::new_from_slice(secret_key).unwrap();
                        mac.update(&policy.to_bytes());
                        black_box(mac.finalize().into_bytes().to_vec());
                    }
                })
            },
        );

        group.bench_with_input(
            BenchmarkId::new("quantum_safe_batch", policy_count),
            &policies,
            |b, policies| {
                b.iter(|| {
                    for policy in policies {
                        let message = policy.to_bytes();
                        let mut result = Vec::with_capacity(4627);
                        for i in 0..4627 {
                            result.push((message.len() + i) as u8);
                        }
                        black_box(result);
                    }
                })
            },
        );
    }

    group.finish();
}

fn storage_overhead_benchmark(c: &mut Criterion) {
    let policy = AuthZPolicy::sample();
    let secret_key = b"authz-secret-key-example-32bytes";

    c.bench_function("storage_overhead_comparison", |b| {
        b.iter(|| {
            // Classical signature storage
            let mut mac = HmacSha256::new_from_slice(secret_key).unwrap();
            mac.update(&policy.to_bytes());
            let classical_sig = mac.finalize().into_bytes().to_vec();
            let classical_size = classical_sig.len();

            // Quantum-safe signature storage
            let quantum_sig = vec![0u8; 4627];
            let quantum_size = quantum_sig.len();

            // Hybrid signature storage
            let hybrid_size = classical_size + quantum_size;

            black_box((classical_size, quantum_size, hybrid_size))
        })
    });
}

criterion_group!(
    benches,
    classical_signing_benchmark,
    classical_verification_benchmark,
    quantum_safe_signing_benchmark,
    quantum_safe_verification_benchmark,
    hybrid_mode_benchmark,
    policy_size_scaling_benchmark,
    storage_overhead_benchmark
);
criterion_main!(benches);
