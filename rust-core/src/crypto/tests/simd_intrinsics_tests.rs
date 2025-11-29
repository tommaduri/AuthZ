//! Integration tests for SIMD intrinsics implementations
//!
//! Tests correctness, cross-platform compatibility, and edge cases

use cretoai_crypto::{detect_simd_features, SIMDOps, SIMDPlatform};

#[test]
fn test_platform_detection() {
    let platform = detect_simd_features();

    // Verify platform is one of the expected types
    match platform {
        SIMDPlatform::AVX512 => {
            assert!(cfg!(target_arch = "x86_64"));
            println!("Detected AVX-512");
        }
        SIMDPlatform::AVX2 => {
            assert!(cfg!(target_arch = "x86_64"));
            println!("Detected AVX2");
        }
        SIMDPlatform::NEON => {
            assert!(cfg!(target_arch = "aarch64"));
            println!("Detected NEON");
        }
        SIMDPlatform::Portable => {
            println!("Using portable implementation");
        }
    }
}

#[test]
fn test_vector_width() {
    let platform = detect_simd_features();
    let width = platform.vector_width();

    match platform {
        SIMDPlatform::AVX512 => assert_eq!(width, 64),
        SIMDPlatform::AVX2 => assert_eq!(width, 32),
        SIMDPlatform::NEON => assert_eq!(width, 16),
        SIMDPlatform::Portable => assert_eq!(width, 8),
    }
}

#[test]
fn test_xor_parallel_basic() {
    let ops = SIMDOps::new();
    let a = vec![0xFF; 128];
    let b = vec![0x0F; 128];
    let result = ops.xor_parallel(&a, &b);

    assert_eq!(result.len(), 128);
    for &byte in &result {
        assert_eq!(byte, 0xF0);
    }
}

#[test]
fn test_xor_parallel_identity() {
    let ops = SIMDOps::new();
    let a = vec![0x42; 256];
    let b = vec![0x00; 256];
    let result = ops.xor_parallel(&a, &b);

    assert_eq!(result, a);
}

#[test]
fn test_xor_parallel_self_cancel() {
    let ops = SIMDOps::new();
    let a = vec![0x5A; 512];
    let result = ops.xor_parallel(&a, &a);

    assert!(result.iter().all(|&x| x == 0));
}

#[test]
fn test_xor_parallel_various_sizes() {
    let ops = SIMDOps::new();
    let sizes = [1, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 256, 1024];

    for &size in &sizes {
        let a = vec![0xAA; size];
        let b = vec![0x55; size];
        let result = ops.xor_parallel(&a, &b);

        assert_eq!(result.len(), size);
        assert!(result.iter().all(|&x| x == 0xFF));
    }
}

#[test]
fn test_add_parallel_basic() {
    let ops = SIMDOps::new();
    let a = vec![1u64; 32];
    let b = vec![2u64; 32];
    let result = ops.add_parallel(&a, &b);

    assert_eq!(result.len(), 32);
    assert!(result.iter().all(|&x| x == 3));
}

#[test]
fn test_add_parallel_overflow() {
    let ops = SIMDOps::new();
    let a = vec![u64::MAX; 16];
    let b = vec![1u64; 16];
    let result = ops.add_parallel(&a, &b);

    assert_eq!(result.len(), 16);
    assert!(result.iter().all(|&x| x == 0));
}

#[test]
fn test_add_parallel_large_numbers() {
    let ops = SIMDOps::new();
    let a = vec![0x123456789ABCDEF0u64; 64];
    let b = vec![0xFEDCBA9876543210u64; 64];
    let result = ops.add_parallel(&a, &b);

    assert_eq!(result.len(), 64);
    for &val in &result {
        assert_eq!(val, 0x123456789ABCDEF0u64.wrapping_add(0xFEDCBA9876543210u64));
    }
}

#[test]
fn test_add_parallel_various_sizes() {
    let ops = SIMDOps::new();
    let sizes = [1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 31, 32, 64];

    for &size in &sizes {
        let a = vec![10u64; size];
        let b = vec![20u64; size];
        let result = ops.add_parallel(&a, &b);

        assert_eq!(result.len(), size);
        assert!(result.iter().all(|&x| x == 30));
    }
}

#[test]
fn test_permute_bytes_reverse() {
    let ops = SIMDOps::new();
    let data = vec![0, 1, 2, 3, 4, 5, 6, 7];
    let indices = vec![7, 6, 5, 4, 3, 2, 1, 0];
    let result = ops.permute_bytes(&data, &indices);

    assert_eq!(result, vec![7, 6, 5, 4, 3, 2, 1, 0]);
}

#[test]
fn test_permute_bytes_identity() {
    let ops = SIMDOps::new();
    let data: Vec<u8> = (0..64).collect();
    let indices: Vec<u8> = (0..64).collect();
    let result = ops.permute_bytes(&data, &indices);

    assert_eq!(result, data);
}

#[test]
fn test_permute_bytes_duplicate() {
    let ops = SIMDOps::new();
    let data = vec![10, 20, 30, 40];
    let indices = vec![0, 0, 0, 0];
    let result = ops.permute_bytes(&data, &indices);

    assert_eq!(result, vec![10, 10, 10, 10]);
}

#[test]
fn test_permute_bytes_various_sizes() {
    let ops = SIMDOps::new();
    let sizes = [4, 8, 16, 32, 64, 128];

    for &size in &sizes {
        let data: Vec<u8> = (0..size as u8).collect();
        let indices: Vec<u8> = (0..size).rev().map(|i| (i % size) as u8).collect();
        let result = ops.permute_bytes(&data, &indices);

        assert_eq!(result.len(), size);
    }
}

#[test]
fn test_hash_parallel_single_message() {
    let ops = SIMDOps::new();
    let message = b"Hello, world!";
    let messages = vec![message.as_slice()];
    let result = ops.hash_parallel(&messages);

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].len(), 32);
}

#[test]
fn test_hash_parallel_multiple_messages() {
    let ops = SIMDOps::new();
    let messages = vec![
        b"message1".as_slice(),
        b"message2".as_slice(),
        b"message3".as_slice(),
        b"message4".as_slice(),
    ];
    let result = ops.hash_parallel(&messages);

    assert_eq!(result.len(), 4);
    // All hashes should be different
    for i in 0..result.len() {
        for j in i + 1..result.len() {
            assert_ne!(result[i], result[j]);
        }
    }
}

#[test]
fn test_hash_parallel_deterministic() {
    let ops = SIMDOps::new();
    let message = b"deterministic test";
    let messages = vec![message.as_slice()];

    let result1 = ops.hash_parallel(&messages);
    let result2 = ops.hash_parallel(&messages);

    assert_eq!(result1, result2);
}

#[test]
fn test_cross_platform_xor_consistency() {
    // Test that all platform implementations produce the same result
    let test_data_a = vec![0xAB; 256];
    let test_data_b = vec![0xCD; 256];

    let ops_detected = SIMDOps::new();
    let result_detected = ops_detected.xor_parallel(&test_data_a, &test_data_b);

    let ops_portable = SIMDOps::with_platform(SIMDPlatform::Portable);
    let result_portable = ops_portable.xor_parallel(&test_data_a, &test_data_b);

    assert_eq!(result_detected, result_portable, "Detected platform result doesn't match portable");
}

#[test]
fn test_cross_platform_add_consistency() {
    let test_data_a = vec![0x123456789ABCDEF0u64; 32];
    let test_data_b = vec![0xFEDCBA9876543210u64; 32];

    let ops_detected = SIMDOps::new();
    let result_detected = ops_detected.add_parallel(&test_data_a, &test_data_b);

    let ops_portable = SIMDOps::with_platform(SIMDPlatform::Portable);
    let result_portable = ops_portable.add_parallel(&test_data_a, &test_data_b);

    assert_eq!(result_detected, result_portable, "Detected platform result doesn't match portable");
}

#[test]
fn test_cross_platform_permute_consistency() {
    let test_data: Vec<u8> = (0..128).map(|i| (i % 256) as u8).collect();
    let test_indices: Vec<u8> = (0..128).rev().map(|i| (i % 128) as u8).collect();

    let ops_detected = SIMDOps::new();
    let result_detected = ops_detected.permute_bytes(&test_data, &test_indices);

    let ops_portable = SIMDOps::with_platform(SIMDPlatform::Portable);
    let result_portable = ops_portable.permute_bytes(&test_data, &test_indices);

    assert_eq!(result_detected, result_portable, "Detected platform result doesn't match portable");
}

#[test]
#[should_panic(expected = "Input slices must have equal length")]
fn test_xor_parallel_length_mismatch() {
    let ops = SIMDOps::new();
    let a = vec![0; 10];
    let b = vec![0; 20];
    let _ = ops.xor_parallel(&a, &b);
}

#[test]
#[should_panic(expected = "Input slices must have equal length")]
fn test_add_parallel_length_mismatch() {
    let ops = SIMDOps::new();
    let a = vec![0u64; 10];
    let b = vec![0u64; 15];
    let _ = ops.add_parallel(&a, &b);
}

#[test]
fn test_empty_inputs() {
    let ops = SIMDOps::new();

    // Empty XOR
    let result = ops.xor_parallel(&[], &[]);
    assert_eq!(result.len(), 0);

    // Empty addition
    let result = ops.add_parallel(&[], &[]);
    assert_eq!(result.len(), 0);

    // Empty permutation
    let result = ops.permute_bytes(&[], &[]);
    assert_eq!(result.len(), 0);
}

#[test]
fn test_simd_ops_default() {
    let ops1 = SIMDOps::new();
    let ops2 = SIMDOps::default();

    assert_eq!(ops1.platform(), ops2.platform());
}

#[test]
fn test_platform_is_simd() {
    assert!(SIMDPlatform::AVX512.is_simd());
    assert!(SIMDPlatform::AVX2.is_simd());
    assert!(SIMDPlatform::NEON.is_simd());
    assert!(!SIMDPlatform::Portable.is_simd());
}
