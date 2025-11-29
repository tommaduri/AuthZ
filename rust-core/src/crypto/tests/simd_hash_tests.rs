//! # SIMD Hash Integration Tests
//!
//! Comprehensive integration tests for SIMD-accelerated BLAKE3 hashing

use cretoai_crypto::simd_hash::{
    derive_key, hash_batch, hash_batch_simd, hash_keyed, hash_large, hash_single, CpuFeatures,
    SIMDHasher, StreamHasher,
};

#[test]
fn test_cpu_feature_detection() {
    let features = CpuFeatures::detect();
    println!("Detected CPU features: {}", features.description());

    // Verify features are coherent
    #[cfg(target_arch = "x86_64")]
    {
        assert!(!features.neon, "x86_64 should not have NEON");
    }

    #[cfg(target_arch = "aarch64")]
    {
        assert!(
            !features.avx512 && !features.avx2,
            "aarch64 should not have AVX"
        );
    }
}

#[test]
fn test_hash_single_correctness() {
    let test_cases = vec![
        (b"" as &[u8], "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262"),
        (b"hello", "ea8f163db38682925e4491c5e58d4bb3506ef8c14eb78a86e908c5624a67200f"),
        (
            b"The quick brown fox jumps over the lazy dog",
            "2f1514181aadccd913abd94cfa592701a5686ab23f8df1dff1b74710febc6d4a",
        ),
    ];

    for (input, expected_hex) in test_cases {
        let hash = hash_single(input);
        let hash_hex = hex::encode(hash.as_bytes());
        assert_eq!(
            hash_hex, expected_hex,
            "Hash mismatch for input: {:?}",
            String::from_utf8_lossy(input)
        );
    }
}

#[test]
fn test_hash_deterministic() {
    let data = b"Test data for determinism";

    let hash1 = hash_single(data);
    let hash2 = hash_single(data);
    let hash3 = hash_single(data);

    assert_eq!(hash1, hash2);
    assert_eq!(hash2, hash3);
}

#[test]
fn test_hash_batch_correctness() {
    let messages = vec![
        b"message 1".to_vec(),
        b"message 2".to_vec(),
        b"message 3".to_vec(),
    ];

    let batch_hashes = hash_batch(&messages);
    assert_eq!(batch_hashes.len(), messages.len());

    // Verify each hash matches individual hashing
    for (i, msg) in messages.iter().enumerate() {
        let individual_hash = hash_single(msg);
        assert_eq!(
            batch_hashes[i], individual_hash,
            "Batch hash mismatch at index {}",
            i
        );
    }
}

#[test]
fn test_hash_batch_simd_correctness() {
    let messages: Vec<Vec<u8>> = (0..100)
        .map(|i| format!("Test message {}", i).into_bytes())
        .collect();

    let simd_hashes = hash_batch_simd(&messages);
    assert_eq!(simd_hashes.len(), messages.len());

    // Verify SIMD hashes match standard hashing
    for (i, msg) in messages.iter().enumerate() {
        let standard_hash = hash_single(msg);
        assert_eq!(
            simd_hashes[i], standard_hash,
            "SIMD hash mismatch at index {}",
            i
        );
    }
}

#[test]
fn test_simd_hasher_methods() {
    let hasher = SIMDHasher::new();
    let data = b"Test data";

    let hash1 = hasher.hash_single(data);
    let hash2 = hash_single(data);
    assert_eq!(hash1, hash2, "SIMDHasher::hash_single mismatch");

    let messages = vec![b"msg1".to_vec(), b"msg2".to_vec()];
    let batch1 = hasher.hash_batch(&messages);
    let batch2 = hash_batch(&messages);
    assert_eq!(batch1, batch2, "SIMDHasher::hash_batch mismatch");
}

#[test]
fn test_keyed_hash_correctness() {
    let key = [42u8; 32];
    let data = b"Secret message";

    let hash1 = hash_keyed(&key, data);
    let hash2 = hash_keyed(&key, data);
    assert_eq!(hash1, hash2, "Keyed hash not deterministic");

    // Different key should produce different hash
    let key2 = [43u8; 32];
    let hash3 = hash_keyed(&key2, data);
    assert_ne!(hash1, hash3, "Different keys produced same hash");

    // Different data should produce different hash
    let hash4 = hash_keyed(&key, b"Different message");
    assert_ne!(hash1, hash4, "Different data produced same hash");
}

#[test]
fn test_derive_key_correctness() {
    let key_material = b"source key material";

    let key1 = derive_key("context1", key_material);
    let key2 = derive_key("context1", key_material);
    assert_eq!(key1, key2, "Key derivation not deterministic");

    let key3 = derive_key("context2", key_material);
    assert_ne!(key1, key3, "Different contexts produced same key");

    let key4 = derive_key("context1", b"different material");
    assert_ne!(key1, key4, "Different material produced same key");
}

#[test]
fn test_streaming_hasher() {
    let mut stream_hasher = StreamHasher::new();
    stream_hasher.update(b"Hello, ");
    stream_hasher.update(b"World!");
    let stream_hash = stream_hasher.finalize();

    let direct_hash = hash_single(b"Hello, World!");
    assert_eq!(stream_hash, direct_hash, "Streaming hash mismatch");
}

#[test]
fn test_streaming_hasher_keyed() {
    let key = [42u8; 32];
    let mut stream_hasher = StreamHasher::new_keyed(&key);
    stream_hasher.update(b"Secret ");
    stream_hasher.update(b"message");
    let stream_hash = stream_hasher.finalize();

    let keyed_hash = hash_keyed(&key, b"Secret message");
    assert_eq!(stream_hash, keyed_hash, "Keyed streaming hash mismatch");
}

#[test]
fn test_streaming_hasher_derive_key() {
    let context = "test_context";
    let mut stream_hasher = StreamHasher::new_derive_key(context);
    stream_hasher.update(b"key material");
    let stream_hash = stream_hasher.finalize_bytes();

    let derived = derive_key(context, b"key material");
    assert_eq!(stream_hash, derived, "KDF streaming hash mismatch");
}

#[test]
fn test_large_data_hashing() {
    let sizes = vec![1024 * 1024, 4 * 1024 * 1024, 16 * 1024 * 1024]; // 1MB, 4MB, 16MB

    for size in sizes {
        let data = vec![42u8; size];

        let hash1 = hash_large(&data);
        let hash2 = hash_single(&data);

        assert_eq!(hash1, hash2, "Large data hash mismatch for size {}", size);
    }
}

#[test]
fn test_empty_data() {
    let empty: &[u8] = b"";
    let hash = hash_single(empty);
    assert_eq!(hash.as_bytes().len(), 32);

    let empty_batch: Vec<Vec<u8>> = vec![];
    let hashes = hash_batch(&empty_batch);
    assert_eq!(hashes.len(), 0);
}

#[test]
fn test_batch_with_varying_sizes() {
    let messages = vec![
        vec![1u8; 100],
        vec![2u8; 1000],
        vec![3u8; 10000],
        vec![4u8; 100000],
    ];

    let batch_hashes = hash_batch_simd(&messages);
    assert_eq!(batch_hashes.len(), messages.len());

    // Verify correctness
    for (i, msg) in messages.iter().enumerate() {
        let individual = hash_single(msg);
        assert_eq!(batch_hashes[i], individual);
    }
}

#[test]
fn test_batch_keyed_hashing() {
    let hasher = SIMDHasher::new();
    let key = [7u8; 32];
    let messages = vec![
        b"msg1".to_vec(),
        b"msg2".to_vec(),
        b"msg3".to_vec(),
    ];

    let batch_hashes = hasher.hash_batch_keyed(&key, &messages);
    assert_eq!(batch_hashes.len(), messages.len());

    // Verify correctness
    for (i, msg) in messages.iter().enumerate() {
        let individual = hash_keyed(&key, msg);
        assert_eq!(batch_hashes[i], individual);
    }
}

#[test]
fn test_throughput_estimation() {
    let hasher = SIMDHasher::new();
    let throughput = hasher.estimate_throughput();

    assert!(throughput > 0.0, "Throughput should be positive");
    assert!(
        throughput < 10000.0,
        "Throughput estimate seems unrealistic"
    );

    println!("Estimated throughput: {:.2} MB/s", throughput);
}

#[test]
fn test_thread_pool_configuration() {
    let hasher1 = SIMDHasher::new();
    let hasher2 = SIMDHasher::new().with_threads(4);

    let messages: Vec<Vec<u8>> = (0..100).map(|i| vec![i as u8; 1024]).collect();

    let hashes1 = hasher1.hash_batch(&messages);
    let hashes2 = hasher2.hash_batch(&messages);

    assert_eq!(hashes1, hashes2, "Thread pool config affects correctness");
}

#[test]
fn test_concurrent_hashing() {
    use std::sync::Arc;
    use std::thread;

    let hasher = Arc::new(SIMDHasher::new());
    let mut handles = vec![];

    for i in 0..10 {
        let hasher_clone = Arc::clone(&hasher);
        let handle = thread::spawn(move || {
            let data = format!("Thread {} data", i).into_bytes();
            hasher_clone.hash_single(&data)
        });
        handles.push(handle);
    }

    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    assert_eq!(results.len(), 10);
}

#[test]
fn test_hash_consistency_across_methods() {
    let data = b"Consistency test data";

    let hash1 = hash_single(data);
    let hash2 = SIMDHasher::new().hash_single(data);

    let messages = vec![data.to_vec()];
    let hash3 = hash_batch(&messages)[0];
    let hash4 = hash_batch_simd(&messages)[0];

    assert_eq!(hash1, hash2);
    assert_eq!(hash2, hash3);
    assert_eq!(hash3, hash4);
}

// Add hex dependency for tests
#[cfg(test)]
mod test_utils {
    pub fn hex_encode() {}
}

// Note: hex crate needed for test_hash_single_correctness
// Add to dev-dependencies if not present
