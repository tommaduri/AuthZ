use pqcrypto_kyber::kyber768;
use pqcrypto_traits::kem::{PublicKey as PQPublicKey, SecretKey as PQSecretKey, SharedSecret as PQSharedSecret, Ciphertext as PQCiphertext};
use crate::error::{CryptoError, Result};

/// ML-KEM-768 (Kyber768) public key
pub struct MLKem768PublicKey(kyber768::PublicKey);

impl std::fmt::Debug for MLKem768PublicKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MLKem768PublicKey")
            .field("size", &self.0.as_bytes().len())
            .finish()
    }
}

/// ML-KEM-768 (Kyber768) secret key
#[derive(Clone)]
pub struct MLKem768SecretKey(kyber768::SecretKey);

impl std::fmt::Debug for MLKem768SecretKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MLKem768SecretKey")
            .field("size", &self.0.as_bytes().len())
            .finish()
    }
}

/// ML-KEM-768 (Kyber768) keypair
#[derive(Debug)]
pub struct MLKem768KeyPair {
    pub public_key: MLKem768PublicKey,
    pub secret_key: MLKem768SecretKey,
}

/// ML-KEM-768 ciphertext
#[derive(Clone)]
pub struct MLKem768Ciphertext(kyber768::Ciphertext);

impl std::fmt::Debug for MLKem768Ciphertext {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MLKem768Ciphertext")
            .field("size", &self.0.as_bytes().len())
            .finish()
    }
}

/// ML-KEM-768 shared secret
pub struct MLKem768SharedSecret(kyber768::SharedSecret);

/// ML-KEM-768 implementation
pub struct MLKem768;

impl MLKem768 {
    /// Generate a new ML-KEM-768 keypair
    pub fn generate() -> MLKem768KeyPair {
        let (pk, sk) = kyber768::keypair();
        MLKem768KeyPair {
            public_key: MLKem768PublicKey(pk),
            secret_key: MLKem768SecretKey(sk),
        }
    }

    /// Encapsulate to create shared secret and ciphertext
    pub fn encapsulate(public_key: &MLKem768PublicKey) -> (MLKem768SharedSecret, MLKem768Ciphertext) {
        let (ss, ct) = kyber768::encapsulate(&public_key.0);
        (MLKem768SharedSecret(ss), MLKem768Ciphertext(ct))
    }

    /// Decapsulate ciphertext to recover shared secret
    pub fn decapsulate(
        ciphertext: &MLKem768Ciphertext,
        secret_key: &MLKem768SecretKey,
    ) -> MLKem768SharedSecret {
        let ss = kyber768::decapsulate(&ciphertext.0, &secret_key.0);
        MLKem768SharedSecret(ss)
    }
}

impl MLKem768PublicKey {
    /// Get public key bytes
    pub fn as_bytes(&self) -> &[u8] {
        self.0.as_bytes()
    }

    /// Create from bytes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        kyber768::PublicKey::from_bytes(bytes)
            .map(MLKem768PublicKey)
            .map_err(|_| CryptoError::InvalidPublicKey)
    }
}

impl MLKem768SecretKey {
    /// Get secret key bytes
    pub fn as_bytes(&self) -> &[u8] {
        self.0.as_bytes()
    }

    /// Create from bytes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        kyber768::SecretKey::from_bytes(bytes)
            .map(MLKem768SecretKey)
            .map_err(|_| CryptoError::InvalidSecretKey)
    }
}

impl MLKem768SharedSecret {
    /// Get shared secret bytes
    pub fn as_bytes(&self) -> &[u8] {
        self.0.as_bytes()
    }
}

impl MLKem768Ciphertext {
    /// Get ciphertext bytes
    pub fn as_bytes(&self) -> &[u8] {
        self.0.as_bytes()
    }

    /// Create from bytes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        kyber768::Ciphertext::from_bytes(bytes)
            .map(MLKem768Ciphertext)
            .map_err(|_| CryptoError::InvalidCiphertext)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kem_encapsulation_decapsulation() {
        let keypair = MLKem768::generate();
        let (ss1, ct) = MLKem768::encapsulate(&keypair.public_key);
        let ss2 = MLKem768::decapsulate(&ct, &keypair.secret_key);

        assert_eq!(ss1.as_bytes(), ss2.as_bytes());
    }
}
