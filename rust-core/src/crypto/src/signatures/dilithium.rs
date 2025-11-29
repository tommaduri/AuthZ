use pqcrypto_dilithium::dilithium5;
use pqcrypto_traits::sign::{PublicKey as PQPublicKey, SecretKey as PQSecretKey, DetachedSignature};
use crate::error::{CryptoError, Result};

/// ML-DSA (Dilithium5/87) public key
#[derive(Clone)]
pub struct MLDSA87PublicKey(dilithium5::PublicKey);

impl std::fmt::Debug for MLDSA87PublicKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MLDSA87PublicKey")
            .field("bytes", &self.as_bytes())
            .finish()
    }
}

/// ML-DSA (Dilithium5/87) secret key
#[derive(Clone)]
pub struct MLDSA87SecretKey(dilithium5::SecretKey);

impl std::fmt::Debug for MLDSA87SecretKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MLDSA87SecretKey")
            .field("bytes_len", &self.as_bytes().len())
            .finish()
    }
}

/// ML-DSA (Dilithium5/87) keypair
pub struct MLDSA87KeyPair {
    pub public_key: MLDSA87PublicKey,
    pub secret_key: MLDSA87SecretKey,
}

impl std::fmt::Debug for MLDSA87KeyPair {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MLDSA87KeyPair")
            .field("public_key", &self.public_key)
            .field("secret_key", &self.secret_key)
            .finish()
    }
}

/// ML-DSA (Dilithium5/87) signature
pub struct MLDSA87Signature(dilithium5::DetachedSignature);

impl std::fmt::Debug for MLDSA87Signature {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MLDSA87Signature")
            .field("bytes_len", &self.as_bytes().len())
            .finish()
    }
}

/// ML-DSA implementation
pub struct MLDSA87;

impl MLDSA87 {
    /// Generate a new ML-DSA-87 keypair
    pub fn generate() -> MLDSA87KeyPair {
        let (pk, sk) = dilithium5::keypair();
        MLDSA87KeyPair {
            public_key: MLDSA87PublicKey(pk),
            secret_key: MLDSA87SecretKey(sk),
        }
    }

    /// Sign a message
    pub fn sign(message: &[u8], secret_key: &MLDSA87SecretKey) -> MLDSA87Signature {
        let sig = dilithium5::detached_sign(message, &secret_key.0);
        MLDSA87Signature(sig)
    }

    /// Verify a signature
    pub fn verify(
        message: &[u8],
        signature: &MLDSA87Signature,
        public_key: &MLDSA87PublicKey,
    ) -> Result<()> {
        dilithium5::verify_detached_signature(&signature.0, message, &public_key.0)
            .map_err(|_| CryptoError::SignatureVerificationFailed)
    }
}

impl MLDSA87KeyPair {
    /// Sign a message using this keypair
    pub fn sign(&self, message: &[u8]) -> MLDSA87Signature {
        MLDSA87::sign(message, &self.secret_key)
    }

    /// Verify a signature using this keypair's public key
    pub fn verify(&self, message: &[u8], signature: &MLDSA87Signature) -> Result<()> {
        MLDSA87::verify(message, signature, &self.public_key)
    }
}

impl MLDSA87PublicKey {
    /// Get public key bytes
    pub fn as_bytes(&self) -> &[u8] {
        self.0.as_bytes()
    }

    /// Create from bytes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        dilithium5::PublicKey::from_bytes(bytes)
            .map(MLDSA87PublicKey)
            .map_err(|_| CryptoError::InvalidPublicKey)
    }
}

impl MLDSA87SecretKey {
    /// Get secret key bytes
    pub fn as_bytes(&self) -> &[u8] {
        self.0.as_bytes()
    }

    /// Create from bytes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        dilithium5::SecretKey::from_bytes(bytes)
            .map(MLDSA87SecretKey)
            .map_err(|_| CryptoError::InvalidSecretKey)
    }
}

impl MLDSA87Signature {
    /// Get signature bytes
    pub fn as_bytes(&self) -> &[u8] {
        self.0.as_bytes()
    }

    /// Create from bytes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        dilithium5::DetachedSignature::from_bytes(bytes)
            .map(MLDSA87Signature)
            .map_err(|_| CryptoError::InvalidSignature("Invalid signature bytes".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sign_verify() {
        let keypair = MLDSA87::generate();
        let message = b"test message";

        let signature = keypair.sign(message);
        let result = keypair.verify(message, &signature);

        assert!(result.is_ok());
    }

    #[test]
    fn test_invalid_signature() {
        let keypair1 = MLDSA87::generate();
        let keypair2 = MLDSA87::generate();
        let message = b"test message";

        let signature = keypair1.sign(message);
        let result = MLDSA87::verify(message, &signature, &keypair2.public_key);

        assert!(result.is_err());
    }
}
