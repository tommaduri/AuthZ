use sha3::{Digest, Sha3_256, Sha3_512};
use crate::error::Result;

/// SHA3-256 hash output
pub struct Sha3Hash256([u8; 32]);

/// SHA3-512 hash output
pub struct Sha3Hash512([u8; 64]);

impl Sha3Hash256 {
    /// Hash data using SHA3-256
    pub fn hash(data: &[u8]) -> Result<Self> {
        let mut hasher = Sha3_256::new();
        hasher.update(data);
        let result = hasher.finalize();
        let mut hash = [0u8; 32];
        hash.copy_from_slice(&result);
        Ok(Sha3Hash256(hash))
    }

    /// Get hash bytes
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl Sha3Hash512 {
    /// Hash data using SHA3-512
    pub fn hash(data: &[u8]) -> Result<Self> {
        let mut hasher = Sha3_512::new();
        hasher.update(data);
        let result = hasher.finalize();
        let mut hash = [0u8; 64];
        hash.copy_from_slice(&result);
        Ok(Sha3Hash512(hash))
    }

    /// Get hash bytes
    pub fn as_bytes(&self) -> &[u8; 64] {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha3_256() {
        let data = b"test data";
        let hash = Sha3Hash256::hash(data).unwrap();
        assert_eq!(hash.as_bytes().len(), 32);
    }

    #[test]
    fn test_sha3_512() {
        let data = b"test data";
        let hash = Sha3Hash512::hash(data).unwrap();
        assert_eq!(hash.as_bytes().len(), 64);
    }
}
