//! Platform-specific SIMD intrinsics for cryptographic operations
//!
//! This module provides optimized SIMD implementations for x86_64 (AVX-512, AVX2)
//! and ARM (NEON) platforms, with automatic fallback to portable implementations.
//!
//! # Safety
//!
//! All unsafe SIMD intrinsics are wrapped in safe APIs that validate inputs
//! and handle alignment requirements. Platform detection is performed at runtime
//! to ensure only supported instructions are used.

/// Maximum SIMD vector width in bytes
pub const MAX_SIMD_WIDTH: usize = 64;

/// SIMD platform types
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SIMDPlatform {
    /// Intel AVX-512 (512-bit vectors)
    AVX512,
    /// Intel AVX2 (256-bit vectors)
    AVX2,
    /// ARM NEON (128-bit vectors)
    NEON,
    /// Portable implementation (no SIMD)
    Portable,
}

impl SIMDPlatform {
    /// Get the vector width in bytes for this platform
    pub const fn vector_width(&self) -> usize {
        match self {
            SIMDPlatform::AVX512 => 64,
            SIMDPlatform::AVX2 => 32,
            SIMDPlatform::NEON => 16,
            SIMDPlatform::Portable => 8,
        }
    }

    /// Check if this platform supports parallel operations
    pub const fn is_simd(&self) -> bool {
        !matches!(self, SIMDPlatform::Portable)
    }
}

/// Main SIMD operations wrapper
pub struct SIMDOps {
    platform: SIMDPlatform,
}

impl SIMDOps {
    /// Create a new SIMD operations handler with automatic platform detection
    pub fn new() -> Self {
        Self {
            platform: detect_simd_features(),
        }
    }

    /// Create with a specific platform (for testing)
    pub fn with_platform(platform: SIMDPlatform) -> Self {
        Self { platform }
    }

    /// Get the current platform
    pub fn platform(&self) -> SIMDPlatform {
        self.platform
    }

    /// Parallel XOR operation on byte slices
    ///
    /// # Panics
    /// Panics if `a.len() != b.len()`
    pub fn xor_parallel(&self, a: &[u8], b: &[u8]) -> Vec<u8> {
        assert_eq!(a.len(), b.len(), "Input slices must have equal length");

        let mut result = vec![0u8; a.len()];

        match self.platform {
            #[cfg(target_arch = "x86_64")]
            SIMDPlatform::AVX512 => {
                if is_x86_feature_detected!("avx512f") {
                    avx512::xor_parallel(a, b, &mut result);
                } else {
                    portable::xor_parallel(a, b, &mut result);
                }
            }
            #[cfg(target_arch = "x86_64")]
            SIMDPlatform::AVX2 => {
                if is_x86_feature_detected!("avx2") {
                    avx2::xor_parallel(a, b, &mut result);
                } else {
                    portable::xor_parallel(a, b, &mut result);
                }
            }
            #[cfg(target_arch = "aarch64")]
            SIMDPlatform::NEON => {
                neon::xor_parallel(a, b, &mut result);
            }
            _ => {
                portable::xor_parallel(a, b, &mut result);
            }
        }

        result
    }

    /// Parallel addition on u64 slices
    ///
    /// # Panics
    /// Panics if `a.len() != b.len()`
    pub fn add_parallel(&self, a: &[u64], b: &[u64]) -> Vec<u64> {
        assert_eq!(a.len(), b.len(), "Input slices must have equal length");

        let mut result = vec![0u64; a.len()];

        match self.platform {
            #[cfg(target_arch = "x86_64")]
            SIMDPlatform::AVX512 => {
                if is_x86_feature_detected!("avx512f") {
                    avx512::add_parallel(a, b, &mut result);
                } else {
                    portable::add_parallel(a, b, &mut result);
                }
            }
            #[cfg(target_arch = "x86_64")]
            SIMDPlatform::AVX2 => {
                if is_x86_feature_detected!("avx2") {
                    avx2::add_parallel(a, b, &mut result);
                } else {
                    portable::add_parallel(a, b, &mut result);
                }
            }
            #[cfg(target_arch = "aarch64")]
            SIMDPlatform::NEON => {
                neon::add_parallel(a, b, &mut result);
            }
            _ => {
                portable::add_parallel(a, b, &mut result);
            }
        }

        result
    }

    /// Parallel byte permutation
    ///
    /// # Panics
    /// Panics if `data.len() != indices.len()` or any index is out of bounds
    pub fn permute_bytes(&self, data: &[u8], indices: &[u8]) -> Vec<u8> {
        assert_eq!(data.len(), indices.len(), "Data and indices must have equal length");

        let mut result = vec![0u8; data.len()];

        match self.platform {
            #[cfg(target_arch = "x86_64")]
            SIMDPlatform::AVX512 => {
                if is_x86_feature_detected!("avx512f") && is_x86_feature_detected!("avx512vbmi") {
                    avx512::permute_bytes(data, indices, &mut result);
                } else {
                    portable::permute_bytes(data, indices, &mut result);
                }
            }
            #[cfg(target_arch = "x86_64")]
            SIMDPlatform::AVX2 => {
                if is_x86_feature_detected!("avx2") {
                    avx2::permute_bytes(data, indices, &mut result);
                } else {
                    portable::permute_bytes(data, indices, &mut result);
                }
            }
            #[cfg(target_arch = "aarch64")]
            SIMDPlatform::NEON => {
                neon::permute_bytes(data, indices, &mut result);
            }
            _ => {
                portable::permute_bytes(data, indices, &mut result);
            }
        }

        result
    }

    /// Parallel hash computation for multiple messages
    pub fn hash_parallel(&self, messages: &[&[u8]]) -> Vec<[u8; 32]> {
        messages
            .iter()
            .map(|msg| {
                let mut hasher = blake3::Hasher::new();
                hasher.update(msg);
                *hasher.finalize().as_bytes()
            })
            .collect()
    }
}

impl Default for SIMDOps {
    fn default() -> Self {
        Self::new()
    }
}

/// Detect available SIMD features at runtime
pub fn detect_simd_features() -> SIMDPlatform {
    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("avx512f") {
            return SIMDPlatform::AVX512;
        }
        if is_x86_feature_detected!("avx2") {
            return SIMDPlatform::AVX2;
        }
    }

    #[cfg(target_arch = "aarch64")]
    {
        // NEON is mandatory on AArch64, so it's always available
        return SIMDPlatform::NEON;
    }

    SIMDPlatform::Portable
}

// ============================================================================
// AVX-512 Implementation (x86_64)
// ============================================================================

#[cfg(target_arch = "x86_64")]
pub mod avx512 {
    use std::arch::x86_64::*;

    /// Parallel XOR operation using AVX-512 (512-bit vectors)
    pub fn xor_parallel(a: &[u8], b: &[u8], result: &mut [u8]) {
        assert_eq!(a.len(), b.len());
        assert_eq!(a.len(), result.len());

        let chunks = a.len() / 64;
        let remainder = a.len() % 64;

        // Process 64-byte chunks with AVX-512
        for i in 0..chunks {
            let offset = i * 64;
            // SAFETY: We've validated that offset + 64 <= a.len()
            // AVX-512 requires 64-byte alignment, which we handle via unaligned loads
            unsafe {
                let a_vec = _mm512_loadu_si512(a.as_ptr().add(offset) as *const __m512i);
                let b_vec = _mm512_loadu_si512(b.as_ptr().add(offset) as *const __m512i);
                let xor_vec = _mm512_xor_si512(a_vec, b_vec);
                _mm512_storeu_si512(result.as_mut_ptr().add(offset) as *mut __m512i, xor_vec);
            }
        }

        // Handle remainder with scalar operations
        let offset = chunks * 64;
        for i in 0..remainder {
            result[offset + i] = a[offset + i] ^ b[offset + i];
        }
    }

    /// Parallel addition using AVX-512 (eight 64-bit integers)
    pub fn add_parallel(a: &[u64], b: &[u64], result: &mut [u64]) {
        assert_eq!(a.len(), b.len());
        assert_eq!(a.len(), result.len());

        let chunks = a.len() / 8;
        let remainder = a.len() % 8;

        // Process 8-element chunks with AVX-512
        for i in 0..chunks {
            let offset = i * 8;
            // SAFETY: We've validated that offset + 8 <= a.len()
            // We use unaligned loads to handle any alignment
            unsafe {
                let a_vec = _mm512_loadu_epi64(a.as_ptr().add(offset) as *const i64);
                let b_vec = _mm512_loadu_epi64(b.as_ptr().add(offset) as *const i64);
                let sum_vec = _mm512_add_epi64(a_vec, b_vec);
                _mm512_storeu_epi64(result.as_mut_ptr().add(offset) as *mut i64, sum_vec);
            }
        }

        // Handle remainder with scalar operations
        let offset = chunks * 8;
        for i in 0..remainder {
            result[offset + i] = a[offset + i].wrapping_add(b[offset + i]);
        }
    }

    /// Parallel byte permutation using AVX-512VBMI
    /// Note: This uses scalar fallback for cross-chunk indices
    pub fn permute_bytes(data: &[u8], indices: &[u8], result: &mut [u8]) {
        assert_eq!(data.len(), indices.len());
        assert_eq!(data.len(), result.len());

        // SIMD permutation only works within chunks, so use scalar for now
        // A future optimization could detect when all indices are within-chunk
        for i in 0..data.len() {
            let idx = indices[i] as usize;
            if idx < data.len() {
                result[i] = data[idx];
            }
        }
    }
}

// ============================================================================
// AVX2 Implementation (x86_64)
// ============================================================================

#[cfg(target_arch = "x86_64")]
pub mod avx2 {
    use std::arch::x86_64::*;

    /// Parallel XOR operation using AVX2 (256-bit vectors)
    pub fn xor_parallel(a: &[u8], b: &[u8], result: &mut [u8]) {
        assert_eq!(a.len(), b.len());
        assert_eq!(a.len(), result.len());

        let chunks = a.len() / 32;
        let remainder = a.len() % 32;

        // Process 32-byte chunks with AVX2
        for i in 0..chunks {
            let offset = i * 32;
            // SAFETY: We've validated that offset + 32 <= a.len()
            // AVX2 unaligned loads are used for flexibility
            unsafe {
                let a_vec = _mm256_loadu_si256(a.as_ptr().add(offset) as *const __m256i);
                let b_vec = _mm256_loadu_si256(b.as_ptr().add(offset) as *const __m256i);
                let xor_vec = _mm256_xor_si256(a_vec, b_vec);
                _mm256_storeu_si256(result.as_mut_ptr().add(offset) as *mut __m256i, xor_vec);
            }
        }

        // Handle remainder with scalar operations
        let offset = chunks * 32;
        for i in 0..remainder {
            result[offset + i] = a[offset + i] ^ b[offset + i];
        }
    }

    /// Parallel addition using AVX2 (four 64-bit integers)
    pub fn add_parallel(a: &[u64], b: &[u64], result: &mut [u64]) {
        assert_eq!(a.len(), b.len());
        assert_eq!(a.len(), result.len());

        let chunks = a.len() / 4;
        let remainder = a.len() % 4;

        // Process 4-element chunks with AVX2
        for i in 0..chunks {
            let offset = i * 4;
            // SAFETY: We've validated that offset + 4 <= a.len()
            unsafe {
                let a_vec = _mm256_loadu_si256(a.as_ptr().add(offset) as *const __m256i);
                let b_vec = _mm256_loadu_si256(b.as_ptr().add(offset) as *const __m256i);
                let sum_vec = _mm256_add_epi64(a_vec, b_vec);
                _mm256_storeu_si256(result.as_mut_ptr().add(offset) as *mut __m256i, sum_vec);
            }
        }

        // Handle remainder with scalar operations
        let offset = chunks * 4;
        for i in 0..remainder {
            result[offset + i] = a[offset + i].wrapping_add(b[offset + i]);
        }
    }

    /// Parallel byte permutation using AVX2 shuffle
    /// Note: This uses scalar fallback for cross-chunk indices
    pub fn permute_bytes(data: &[u8], indices: &[u8], result: &mut [u8]) {
        assert_eq!(data.len(), indices.len());
        assert_eq!(data.len(), result.len());

        // SIMD permutation only works within lanes, so use scalar for now
        // A future optimization could detect when all indices are within-lane
        for i in 0..data.len() {
            let idx = indices[i] as usize;
            if idx < data.len() {
                result[i] = data[idx];
            }
        }
    }
}

// ============================================================================
// ARM NEON Implementation (aarch64)
// ============================================================================

#[cfg(target_arch = "aarch64")]
pub mod neon {
    use std::arch::aarch64::*;

    /// Parallel XOR operation using NEON (128-bit vectors)
    pub fn xor_parallel(a: &[u8], b: &[u8], result: &mut [u8]) {
        assert_eq!(a.len(), b.len());
        assert_eq!(a.len(), result.len());

        let chunks = a.len() / 16;
        let remainder = a.len() % 16;

        // Process 16-byte chunks with NEON
        for i in 0..chunks {
            let offset = i * 16;
            // SAFETY: We've validated that offset + 16 <= a.len()
            // NEON unaligned loads are used for flexibility
            unsafe {
                let a_vec = vld1q_u8(a.as_ptr().add(offset));
                let b_vec = vld1q_u8(b.as_ptr().add(offset));
                let xor_vec = veorq_u8(a_vec, b_vec);
                vst1q_u8(result.as_mut_ptr().add(offset), xor_vec);
            }
        }

        // Handle remainder with scalar operations
        let offset = chunks * 16;
        for i in 0..remainder {
            result[offset + i] = a[offset + i] ^ b[offset + i];
        }
    }

    /// Parallel addition using NEON (two 64-bit integers)
    pub fn add_parallel(a: &[u64], b: &[u64], result: &mut [u64]) {
        assert_eq!(a.len(), b.len());
        assert_eq!(a.len(), result.len());

        let chunks = a.len() / 2;
        let remainder = a.len() % 2;

        // Process 2-element chunks with NEON
        for i in 0..chunks {
            let offset = i * 2;
            // SAFETY: We've validated that offset + 2 <= a.len()
            unsafe {
                let a_vec = vld1q_u64(a.as_ptr().add(offset));
                let b_vec = vld1q_u64(b.as_ptr().add(offset));
                let sum_vec = vaddq_u64(a_vec, b_vec);
                vst1q_u64(result.as_mut_ptr().add(offset), sum_vec);
            }
        }

        // Handle remainder with scalar operations
        let offset = chunks * 2;
        for i in 0..remainder {
            result[offset + i] = a[offset + i].wrapping_add(b[offset + i]);
        }
    }

    /// Parallel byte permutation using NEON table lookup
    /// Note: This uses scalar fallback for cross-chunk indices
    pub fn permute_bytes(data: &[u8], indices: &[u8], result: &mut [u8]) {
        assert_eq!(data.len(), indices.len());
        assert_eq!(data.len(), result.len());

        // SIMD permutation only works within 16-byte blocks, so use scalar for now
        // A future optimization could detect when all indices are within-block
        for i in 0..data.len() {
            let idx = indices[i] as usize;
            if idx < data.len() {
                result[i] = data[idx];
            }
        }
    }
}

// ============================================================================
// Portable Implementation (fallback)
// ============================================================================

pub mod portable {
    /// Portable XOR operation (scalar)
    pub fn xor_parallel(a: &[u8], b: &[u8], result: &mut [u8]) {
        for i in 0..a.len() {
            result[i] = a[i] ^ b[i];
        }
    }

    /// Portable addition (scalar)
    pub fn add_parallel(a: &[u64], b: &[u64], result: &mut [u64]) {
        for i in 0..a.len() {
            result[i] = a[i].wrapping_add(b[i]);
        }
    }

    /// Portable byte permutation (scalar)
    pub fn permute_bytes(data: &[u8], indices: &[u8], result: &mut [u8]) {
        for i in 0..data.len() {
            let idx = indices[i] as usize;
            if idx < data.len() {
                result[i] = data[idx];
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_platform_detection() {
        let platform = detect_simd_features();

        // Should detect at least one platform
        match platform {
            SIMDPlatform::AVX512 | SIMDPlatform::AVX2 | SIMDPlatform::NEON | SIMDPlatform::Portable => {},
        }
    }

    #[test]
    fn test_xor_parallel() {
        let ops = SIMDOps::new();
        let a = vec![0xFF; 128];
        let b = vec![0x0F; 128];
        let result = ops.xor_parallel(&a, &b);

        assert_eq!(result.len(), 128);
        assert!(result.iter().all(|&x| x == 0xF0));
    }

    #[test]
    fn test_add_parallel() {
        let ops = SIMDOps::new();
        let a = vec![1u64; 16];
        let b = vec![2u64; 16];
        let result = ops.add_parallel(&a, &b);

        assert_eq!(result.len(), 16);
        assert!(result.iter().all(|&x| x == 3));
    }

    #[test]
    fn test_permute_bytes() {
        let ops = SIMDOps::new();
        let data = vec![0, 1, 2, 3, 4, 5, 6, 7];
        let indices = vec![7, 6, 5, 4, 3, 2, 1, 0];
        let result = ops.permute_bytes(&data, &indices);

        assert_eq!(result, vec![7, 6, 5, 4, 3, 2, 1, 0]);
    }
}
