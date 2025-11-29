# SIMD Intrinsics for Cryptographic Operations

## Overview

The `simd_intrinsics` module provides platform-specific SIMD (Single Instruction, Multiple Data) optimizations for cryptographic operations in CretoAI. It supports multiple architectures with automatic fallback to portable implementations.

## Supported Platforms

### Platform Support Matrix

| Platform | Vector Width | Instructions | Status |
|----------|--------------|--------------|--------|
| **x86_64 AVX-512** | 512-bit (64 bytes) | `avx512f`, `avx512vbmi` | ✅ Full Support |
| **x86_64 AVX2** | 256-bit (32 bytes) | `avx2` | ✅ Full Support |
| **ARM NEON** | 128-bit (16 bytes) | `neon` (mandatory on aarch64) | ✅ Full Support |
| **Portable** | N/A (scalar) | Standard Rust | ✅ Fallback |

### Runtime Detection

The module automatically detects available CPU features at runtime:

```rust
use cretoai_crypto::simd_intrinsics::{detect_simd_features, SIMDPlatform};

let platform = detect_simd_features();
match platform {
    SIMDPlatform::AVX512 => println!("Using AVX-512 (512-bit)"),
    SIMDPlatform::AVX2 => println!("Using AVX2 (256-bit)"),
    SIMDPlatform::NEON => println!("Using ARM NEON (128-bit)"),
    SIMDPlatform::Portable => println!("Using portable implementation"),
}
```

## Performance Comparison

### Expected Throughput (GB/s)

Based on typical modern CPUs (approximate values):

| Operation | AVX-512 | AVX2 | NEON | Portable | Speedup (SIMD/Portable) |
|-----------|---------|------|------|----------|-------------------------|
| **XOR** | 45-60 | 25-35 | 15-20 | 8-12 | 3.75-7.5x |
| **Addition** | 40-55 | 22-30 | 12-18 | 6-10 | 4.0-9.2x |
| **Permutation** | 20-30 | 12-18 | 8-12 | 3-6 | 4.0-10x |
| **Parallel Hash** | 35-50 | 20-28 | 10-15 | 5-8 | 4.4-10x |

### Benchmark Results

Run benchmarks with:
```bash
cargo bench --bench simd_intrinsics_bench
```

Example output:
```
xor_parallel/detected/64     time: [125 ns 128 ns 132 ns]
                             thrpt: [484 MB/s 500 MB/s 512 MB/s]
xor_parallel/portable/64     time: [450 ns 465 ns 481 ns]
                             thrpt: [133 MB/s 137 MB/s 142 MB/s]
xor_parallel/avx512/64       time: [85 ns 88 ns 92 ns]
                             thrpt: [695 MB/s 727 MB/s 752 MB/s]
```

## API Usage

### Basic Operations

#### 1. XOR Operation

Parallel XOR is used for key mixing and stream cipher operations:

```rust
use cretoai_crypto::simd_intrinsics::SIMDOps;

let ops = SIMDOps::new(); // Auto-detect platform

let key = vec![0xFF; 128];
let data = vec![0x5A; 128];
let mixed = ops.xor_parallel(&key, &data);

assert_eq!(mixed.len(), 128);
// Result: 0xFF ^ 0x5A = 0xA5 for each byte
```

#### 2. Addition Operation

Parallel addition for key scheduling and counter modes:

```rust
use cretoai_crypto::simd_intrinsics::SIMDOps;

let ops = SIMDOps::new();

let counters = vec![0u64, 1, 2, 3, 4, 5, 6, 7];
let increments = vec![1u64; 8];
let new_counters = ops.add_parallel(&counters, &increments);

assert_eq!(new_counters, vec![1u64, 2, 3, 4, 5, 6, 7, 8]);
```

#### 3. Byte Permutation

Byte-level permutation for block ciphers and s-boxes:

```rust
use cretoai_crypto::simd_intrinsics::SIMDOps;

let ops = SIMDOps::new();

let data = vec![0, 1, 2, 3, 4, 5, 6, 7];
let s_box = vec![7, 6, 5, 4, 3, 2, 1, 0]; // Reverse permutation
let permuted = ops.permute_bytes(&data, &s_box);

assert_eq!(permuted, vec![7, 6, 5, 4, 3, 2, 1, 0]);
```

#### 4. Parallel Hashing

Hash multiple messages in parallel (uses BLAKE3):

```rust
use cretoai_crypto::simd_intrinsics::SIMDOps;

let ops = SIMDOps::new();

let messages = vec![
    b"message 1".as_slice(),
    b"message 2".as_slice(),
    b"message 3".as_slice(),
];

let hashes = ops.hash_parallel(&messages);
assert_eq!(hashes.len(), 3);
assert_eq!(hashes[0].len(), 32); // 32-byte BLAKE3 hash
```

### Advanced Usage

#### Platform-Specific Implementation

Force a specific platform (useful for testing):

```rust
use cretoai_crypto::simd_intrinsics::{SIMDOps, SIMDPlatform};

// Test with portable implementation
let ops_portable = SIMDOps::with_platform(SIMDPlatform::Portable);

// Test with AVX2 (if available)
let ops_avx2 = SIMDOps::with_platform(SIMDPlatform::AVX2);

// Compare results
let a = vec![0xFF; 256];
let b = vec![0x0F; 256];

let result1 = ops_portable.xor_parallel(&a, &b);
let result2 = ops_avx2.xor_parallel(&a, &b);

assert_eq!(result1, result2); // Results should be identical
```

#### Checking Platform Capabilities

```rust
use cretoai_crypto::simd_intrinsics::{detect_simd_features, SIMDPlatform};

let platform = detect_simd_features();

println!("Platform: {:?}", platform);
println!("Vector width: {} bytes", platform.vector_width());
println!("SIMD enabled: {}", platform.is_simd());

match platform {
    SIMDPlatform::AVX512 => {
        println!("AVX-512 optimizations active");
        println!("Best for: Large batches (>512 bytes)");
    }
    SIMDPlatform::AVX2 => {
        println!("AVX2 optimizations active");
        println!("Best for: Medium batches (>256 bytes)");
    }
    SIMDPlatform::NEON => {
        println!("ARM NEON optimizations active");
        println!("Best for: Mobile/embedded (>128 bytes)");
    }
    SIMDPlatform::Portable => {
        println!("Using portable implementation");
        println!("Best for: Small data (<64 bytes)");
    }
}
```

## Safety Guidelines

All SIMD operations use unsafe intrinsics internally but are wrapped in safe APIs. The following invariants are maintained:

### Memory Safety

1. **Alignment**: Unaligned loads/stores (`loadu`/`storeu`) are used for flexibility
2. **Bounds checking**: All slice accesses are validated before SIMD operations
3. **Remainder handling**: Trailing bytes are processed with scalar operations

### Example Safety Documentation

```rust
// SAFETY: We've validated that offset + 64 <= a.len() before this loop.
// AVX-512 intrinsics require valid memory ranges, which we ensure by:
// 1. Calculating chunks = a.len() / 64 (only full 64-byte chunks)
// 2. Using offset = i * 64 where i < chunks
// 3. Handling remainder bytes separately with scalar operations
unsafe {
    let a_vec = _mm512_loadu_si512(a.as_ptr().add(offset) as *const __m512i);
    let b_vec = _mm512_loadu_si512(b.as_ptr().add(offset) as *const __m512i);
    let xor_vec = _mm512_xor_si512(a_vec, b_vec);
    _mm512_storeu_si512(result.as_mut_ptr().add(offset) as *mut __m512i, xor_vec);
}
```

### SIMD Intrinsics References

- **x86_64**: [Intel Intrinsics Guide](https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html)
- **ARM**: [ARM NEON Intrinsics Reference](https://developer.arm.com/architectures/instruction-sets/intrinsics/)
- **Rust**: [std::arch documentation](https://doc.rust-lang.org/std/arch/)

## CPU Feature Detection

### x86_64 Features

Required CPU flags for each platform:

- **AVX-512**: `avx512f` (Foundation), optionally `avx512vbmi` (for byte permutation)
- **AVX2**: `avx2`, `bmi1`, `bmi2` (recommended)

Check on Linux:
```bash
cat /proc/cpuinfo | grep -i avx
```

Check on macOS:
```bash
sysctl -a | grep machdep.cpu.features
```

### ARM Features

- **NEON**: Mandatory on all AArch64 CPUs (ARMv8+)
- No runtime detection needed on aarch64

Check on Linux:
```bash
cat /proc/cpuinfo | grep -i neon
```

## Performance Optimization Tips

### 1. Batch Size Recommendations

For optimal SIMD utilization:

- **AVX-512**: Process ≥512 bytes per call (8× 64-byte vectors)
- **AVX2**: Process ≥256 bytes per call (8× 32-byte vectors)
- **NEON**: Process ≥128 bytes per call (8× 16-byte vectors)

```rust
// Good: Large batch benefits from SIMD
let large_data = vec![0; 4096];
let result = ops.xor_parallel(&large_data, &large_data);

// Suboptimal: Small batch, SIMD overhead may not be worth it
let small_data = vec![0; 16];
let result = ops.xor_parallel(&small_data, &small_data);
```

### 2. Memory Alignment

While the API uses unaligned loads, aligned data can improve performance:

```rust
use std::alloc::{alloc, dealloc, Layout};

// Allocate 64-byte aligned buffer for AVX-512
let layout = Layout::from_size_align(4096, 64).unwrap();
unsafe {
    let ptr = alloc(layout);
    // Use aligned buffer...
    dealloc(ptr, layout);
}
```

### 3. Avoiding False Sharing

When processing data in parallel threads:

```rust
use rayon::prelude::*;

// Split data into cache-line aligned chunks (64 bytes)
let chunks: Vec<_> = data.chunks(64).collect();
chunks.par_iter().for_each(|chunk| {
    // Process each chunk independently
});
```

## Integration Examples

### Example 1: ChaCha20 Key Stream Generation

```rust
use cretoai_crypto::simd_intrinsics::SIMDOps;

fn chacha20_keystream_simd(key: &[u8; 32], counter: u64) -> Vec<u8> {
    let ops = SIMDOps::new();
    let mut keystream = vec![0u8; 1024];

    // Generate counters for parallel blocks
    let counters: Vec<u64> = (0..16).map(|i| counter + i).collect();
    let zeros = vec![0u64; 16];
    let incremented = ops.add_parallel(&counters, &zeros);

    // ... (rest of ChaCha20 logic)

    keystream
}
```

### Example 2: AES S-Box Substitution

```rust
use cretoai_crypto::simd_intrinsics::SIMDOps;

const AES_SBOX: [u8; 256] = [ /* AES S-box values */ ];

fn aes_substitute_bytes_simd(state: &[u8; 16]) -> [u8; 16] {
    let ops = SIMDOps::new();
    let indices: Vec<u8> = state.iter().map(|&b| AES_SBOX[b as usize]).collect();
    let substituted = ops.permute_bytes(state, &indices);

    let mut result = [0u8; 16];
    result.copy_from_slice(&substituted);
    result
}
```

### Example 3: Parallel Hash Verification

```rust
use cretoai_crypto::simd_intrinsics::SIMDOps;

fn verify_batch_signatures(messages: &[&[u8]], signatures: &[[u8; 32]]) -> Vec<bool> {
    let ops = SIMDOps::new();
    let computed_hashes = ops.hash_parallel(messages);

    computed_hashes.iter()
        .zip(signatures.iter())
        .map(|(computed, expected)| computed == expected)
        .collect()
}
```

## Testing

### Running Tests

```bash
# Run all tests
cargo test --package cretoai-crypto --test simd_intrinsics_tests

# Run specific test
cargo test --package cretoai-crypto test_cross_platform_xor_consistency

# Run with verbose output
cargo test --package cretoai-crypto -- --nocapture
```

### Cross-Platform Validation

All implementations are tested for correctness against the portable version:

```rust
#[test]
fn test_cross_platform_xor_consistency() {
    let ops_detected = SIMDOps::new();
    let ops_portable = SIMDOps::with_platform(SIMDPlatform::Portable);

    let a = vec![0xAB; 256];
    let b = vec![0xCD; 256];

    let result_simd = ops_detected.xor_parallel(&a, &b);
    let result_portable = ops_portable.xor_parallel(&a, &b);

    assert_eq!(result_simd, result_portable);
}
```

## Limitations

1. **Permutation Constraints**:
   - AVX-512: Byte indices must be in range [0, 63] per 64-byte chunk
   - AVX2: Operates on two independent 128-bit lanes
   - NEON: Table lookup limited to 16-byte blocks

2. **Platform Availability**:
   - AVX-512 requires Intel Skylake-X+ or AMD Zen 4+
   - AVX2 requires Intel Haswell+ (2013+) or AMD Excavator+ (2015+)
   - NEON is mandatory on all AArch64 but optional on ARMv7

3. **Performance Overhead**:
   - SIMD is most beneficial for data ≥256 bytes
   - Smaller buffers may perform better with scalar operations
   - Alignment and cache effects can vary by workload

## Future Enhancements

- [ ] AVX-512BW (byte/word operations)
- [ ] AVX-512VBMI2 (additional byte manipulation)
- [ ] ARM SVE (Scalable Vector Extension)
- [ ] WebAssembly SIMD (portable SIMD for web)
- [ ] Automatic batch size tuning
- [ ] Zero-copy aligned buffer API

## References

- [Intel Intrinsics Guide](https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html)
- [ARM NEON Programmer's Guide](https://developer.arm.com/documentation/den0018/a/)
- [Rust SIMD Performance Guide](https://rust-lang.github.io/packed_simd/perf-guide/)
- [CretoAI Cryptography Design](./cryptography.md)

## License

This module is part of CretoAI and is licensed under the same terms as the main project.
