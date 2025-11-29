//! Integration tests for ML-DSA batch signature verification
//!
//! Comprehensive test suite covering correctness, edge cases, performance,
//! and thread safety of batch verification functionality.

use cretoai_crypto::batch_verify::{
    BatchConfig, BatchItem, BatchVerifier, BatchVerifierBuilder, verify_batch,
    verify_batch_parallel, verify_batch_with_config,
};
use cretoai_crypto::signatures::MLDSA87;

/// Helper to generate valid test signatures
fn generate_valid_signatures(count: usize) -> Vec<BatchItem> {
    (0..count)
        .map(|i| {
            let keypair = MLDSA87::generate();
            let message = format!("test message {}", i).into_bytes();
            let signature = keypair.sign(&message);

            BatchItem::new(
                message,
                signature.as_bytes().to_vec(),
                keypair.public_key.as_bytes().to_vec(),
            )
        })
        .collect()
}

#[test]
fn test_batch_verifier_empty() {
    let mut verifier = BatchVerifier::new();
    assert!(verifier.is_empty());
    assert_eq!(verifier.len(), 0);

    let results = verifier.verify_batch();
    assert!(results.is_empty());

    let results_parallel = verifier.verify_batch_parallel();
    assert!(results_parallel.is_empty());
}

#[test]
fn test_batch_verifier_single_signature() {
    let items = generate_valid_signatures(1);
    let mut verifier = BatchVerifier::new();
    verifier.add_item(items[0].clone());

    assert_eq!(verifier.len(), 1);

    let results = verifier.verify_batch();
    assert_eq!(results.len(), 1);
    assert!(results[0].valid);
    assert!(results[0].error.is_none());
}

#[test]
fn test_batch_verifier_multiple_signatures() {
    let count = 20;
    let items = generate_valid_signatures(count);
    let mut verifier = BatchVerifier::new();

    for item in items {
        verifier.add_item(item);
    }

    assert_eq!(verifier.len(), count);

    let results = verifier.verify_batch();
    assert_eq!(results.len(), count);
    assert!(results.iter().all(|r| r.valid));
    assert!(results.iter().all(|r| r.error.is_none()));
}

#[test]
fn test_batch_verifier_parallel() {
    let count = 64;
    let items = generate_valid_signatures(count);
    let mut verifier = BatchVerifier::new();

    for item in items {
        verifier.add_item(item);
    }

    let results = verifier.verify_batch_parallel();
    assert_eq!(results.len(), count);
    assert!(results.iter().all(|r| r.valid));
}

#[test]
fn test_batch_verifier_invalid_signature() {
    let items = generate_valid_signatures(10);
    let mut verifier = BatchVerifier::new();

    // Add valid signatures
    for item in &items[..9] {
        verifier.add_item(item.clone());
    }

    // Add invalid signature (corrupted)
    let mut invalid = items[9].clone();
    invalid.signature[0] ^= 0xFF;
    verifier.add_item(invalid);

    let results = verifier.verify_batch();
    assert_eq!(results.len(), 10);

    // First 9 should be valid
    assert!(results[..9].iter().all(|r| r.valid));

    // Last one should be invalid
    assert!(!results[9].valid);
    assert!(results[9].error.is_some());
}

#[test]
fn test_batch_verifier_all_invalid() {
    let mut items = generate_valid_signatures(5);

    // Corrupt all signatures
    for item in &mut items {
        item.signature[0] ^= 0xFF;
    }

    let mut verifier = BatchVerifier::new();
    for item in items {
        verifier.add_item(item);
    }

    let results = verifier.verify_batch();
    assert_eq!(results.len(), 5);
    assert!(results.iter().all(|r| !r.valid));
    assert!(results.iter().all(|r| r.error.is_some()));
}

#[test]
fn test_batch_verifier_wrong_public_key() {
    let items = generate_valid_signatures(2);

    // Use signature from first keypair with public key from second
    let mut invalid = items[0].clone();
    invalid.public_key = items[1].public_key.clone();

    let mut verifier = BatchVerifier::new();
    verifier.add_item(invalid);

    let results = verifier.verify_batch();
    assert_eq!(results.len(), 1);
    assert!(!results[0].valid);
}

#[test]
fn test_batch_verifier_with_identifiers() {
    let items = generate_valid_signatures(5);
    let mut verifier = BatchVerifier::new();

    for (i, item) in items.iter().enumerate() {
        verifier.add_signature_with_id(
            item.message.clone(),
            item.signature.clone(),
            item.public_key.clone(),
            format!("sig-{}", i),
        );
    }

    let results = verifier.verify_batch();
    assert_eq!(results.len(), 5);

    for (i, result) in results.iter().enumerate() {
        assert!(result.valid);
        assert_eq!(result.id.as_ref().unwrap(), &format!("sig-{}", i));
    }
}

#[test]
fn test_batch_verifier_clear() {
    let items = generate_valid_signatures(10);
    let mut verifier = BatchVerifier::new();

    for item in &items {
        verifier.add_item(item.clone());
    }

    assert_eq!(verifier.len(), 10);

    verifier.clear();
    assert!(verifier.is_empty());
    assert_eq!(verifier.len(), 0);

    // Should be reusable after clear
    for item in &items[..5] {
        verifier.add_item(item.clone());
    }

    let results = verifier.verify_batch();
    assert_eq!(results.len(), 5);
}

#[test]
fn test_batch_config_optimal_batch_size() {
    let config = BatchConfig::default();
    let size = config.optimal_batch_size();

    // Should be reasonable (between 4 and 32)
    assert!(size >= 4);
    assert!(size <= 32);

    // Custom batch size
    let config = BatchConfig {
        batch_size: Some(64),
        ..Default::default()
    };
    assert_eq!(config.optimal_batch_size(), 64);
}

#[test]
fn test_batch_verifier_with_config() {
    let items = generate_valid_signatures(32);

    let config = BatchConfig {
        batch_size: Some(16),
        parallel: true,
        early_exit: false,
        worker_threads: Some(4),
    };

    let mut verifier = BatchVerifier::with_config(config);
    for item in items {
        verifier.add_item(item);
    }

    let results = verifier.verify_batch_parallel();
    assert_eq!(results.len(), 32);
    assert!(results.iter().all(|r| r.valid));
}

#[test]
fn test_batch_verifier_builder() {
    let items = generate_valid_signatures(16);

    let mut verifier = BatchVerifierBuilder::new()
        .batch_size(8)
        .parallel(true)
        .early_exit(false)
        .worker_threads(2)
        .build();

    for item in items {
        verifier.add_item(item);
    }

    let results = verifier.verify_batch_parallel();
    assert_eq!(results.len(), 16);
    assert!(results.iter().all(|r| r.valid));
}

#[test]
fn test_convenience_verify_batch() {
    let items = generate_valid_signatures(10);
    let results = verify_batch(items);

    assert_eq!(results.len(), 10);
    assert!(results.iter().all(|r| r.valid));
}

#[test]
fn test_convenience_verify_batch_parallel() {
    let items = generate_valid_signatures(32);
    let results = verify_batch_parallel(items);

    assert_eq!(results.len(), 32);
    assert!(results.iter().all(|r| r.valid));
}

#[test]
fn test_verify_batch_with_config() {
    let items = generate_valid_signatures(20);

    let config = BatchConfig {
        batch_size: Some(10),
        parallel: true,
        early_exit: false,
        worker_threads: None,
    };

    let results = verify_batch_with_config(items, config);
    assert_eq!(results.len(), 20);
    assert!(results.iter().all(|r| r.valid));
}

#[test]
fn test_batch_verifier_stats() {
    let items = generate_valid_signatures(15);
    let mut verifier = BatchVerifier::new();

    for item in &items {
        verifier.add_item(item.clone());
    }

    let stats_before = verifier.stats();
    assert_eq!(stats_before.total_added, 15);
    assert_eq!(stats_before.total_verified, 0);
    assert_eq!(stats_before.current_batch_size, 15);

    let _results = verifier.verify_batch();

    let stats_after = verifier.stats();
    assert_eq!(stats_after.total_added, 15);
    assert_eq!(stats_after.total_verified, 15);
}

#[test]
fn test_large_batch() {
    let count = 1000;
    let items = generate_valid_signatures(count);
    let mut verifier = BatchVerifier::new();

    for item in items {
        verifier.add_item(item);
    }

    let results = verifier.verify_batch_parallel();
    assert_eq!(results.len(), count);
    assert!(results.iter().all(|r| r.valid));
}

#[test]
fn test_result_indices() {
    let items = generate_valid_signatures(10);
    let mut verifier = BatchVerifier::new();

    for item in items {
        verifier.add_item(item);
    }

    let results = verifier.verify_batch();

    for (i, result) in results.iter().enumerate() {
        assert_eq!(result.index, i);
    }
}

#[test]
fn test_parallel_safety() {
    use std::sync::Arc;
    use std::thread;

    let items = generate_valid_signatures(100);
    let items = Arc::new(items);

    let handles: Vec<_> = (0..4)
        .map(|_| {
            let items = Arc::clone(&items);
            thread::spawn(move || {
                let mut verifier = BatchVerifier::new();
                for item in items.iter() {
                    verifier.add_item(item.clone());
                }
                verifier.verify_batch_parallel()
            })
        })
        .collect();

    for handle in handles {
        let results = handle.join().unwrap();
        assert_eq!(results.len(), 100);
        assert!(results.iter().all(|r| r.valid));
    }
}

#[test]
fn test_sequential_vs_parallel_consistency() {
    let items = generate_valid_signatures(50);
    let mut verifier_seq = BatchVerifier::new();
    let mut verifier_par = BatchVerifier::new();

    for item in &items {
        verifier_seq.add_item(item.clone());
        verifier_par.add_item(item.clone());
    }

    let results_seq = verifier_seq.verify_batch();
    let results_par = verifier_par.verify_batch_parallel();

    assert_eq!(results_seq.len(), results_par.len());

    for i in 0..results_seq.len() {
        assert_eq!(results_seq[i].valid, results_par[i].valid);
        assert_eq!(results_seq[i].index, results_par[i].index);
    }
}
