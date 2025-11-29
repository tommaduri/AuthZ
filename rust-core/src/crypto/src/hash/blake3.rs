use blake3::Hasher;
use crate::error::Result;

/// BLAKE3 hash output (32 bytes)
pub struct BLAKE3Hash([u8; 32]);

impl BLAKE3Hash {
    /// Hash data using BLAKE3
    pub fn hash(data: &[u8]) -> Result<Self> {
        let mut hasher = Hasher::new();
        hasher.update(data);
        let hash = hasher.finalize();
        let mut output = [0u8; 32];
        output.copy_from_slice(hash.as_bytes());
        Ok(BLAKE3Hash(output))
    }

    /// Hash data with keyed mode
    pub fn keyed_hash(key: &[u8; 32], data: &[u8]) -> Result<Self> {
        let mut hasher = Hasher::new_keyed(key);
        hasher.update(data);
        let hash = hasher.finalize();
        let mut output = [0u8; 32];
        output.copy_from_slice(hash.as_bytes());
        Ok(BLAKE3Hash(output))
    }

    /// Get hash bytes
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_blake3_hash() {
        let data = b"test data";
        let hash = BLAKE3Hash::hash(data).unwrap();
        assert_eq!(hash.as_bytes().len(), 32);
    }

    #[test]
    fn test_blake3_keyed_hash() {
        let key = [0u8; 32];
        let data = b"test data";
        let hash = BLAKE3Hash::keyed_hash(&key, data).unwrap();
        assert_eq!(hash.as_bytes().len(), 32);
    }
}
