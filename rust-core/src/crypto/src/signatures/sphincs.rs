use pqcrypto_sphincsplus::sphincssha2256fsimple;
use pqcrypto_traits::sign::{PublicKey as PQPublicKey, SecretKey as PQSecretKey, DetachedSignature};
use crate::error::{CryptoError, Result};

/// SPHINCS+ public key
pub struct SphincsPlusPublicKey(sphincssha2256fsimple::PublicKey);

/// SPHINCS+ secret key
pub struct SphincsPlusSecretKey(sphincssha2256fsimple::SecretKey);

/// SPHINCS+ keypair
pub struct SphincsPlusKeyPair {
    pub public_key: SphincsPlusPublicKey,
    pub secret_key: SphincsPlusSecretKey,
}

/// SPHINCS+ signature
pub struct SphincsPlusSignature(sphincssha2256fsimple::DetachedSignature);

/// SPHINCS+ implementation
pub struct SphincsPus;

impl SphincsPlusKeyPair {
    /// Generate a new SPHINCS+ keypair
    pub fn generate() -> Self {
        let (pk, sk) = sphincssha2256fsimple::keypair();
        SphincsPlusKeyPair {
            public_key: SphincsPlusPublicKey(pk),
            secret_key: SphincsPlusSecretKey(sk),
        }
    }

    /// Sign a message
    pub fn sign(&self, message: &[u8]) -> SphincsPlusSignature {
        let sig = sphincssha2256fsimple::detached_sign(message, &self.secret_key.0);
        SphincsPlusSignature(sig)
    }

    /// Verify a signature
    pub fn verify(&self, message: &[u8], signature: &SphincsPlusSignature) -> Result<()> {
        sphincssha2256fsimple::verify_detached_signature(&signature.0, message, &self.public_key.0)
            .map_err(|_| CryptoError::SignatureVerificationFailed)
    }
}

impl SphincsPlusPublicKey {
    /// Get public key bytes
    pub fn as_bytes(&self) -> &[u8] {
        self.0.as_bytes()
    }

    /// Create from bytes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        sphincssha2256fsimple::PublicKey::from_bytes(bytes)
            .map(SphincsPlusPublicKey)
            .map_err(|_| CryptoError::InvalidPublicKey)
    }
}

impl SphincsPlusSecretKey {
    /// Get secret key bytes
    pub fn as_bytes(&self) -> &[u8] {
        self.0.as_bytes()
    }
}

impl SphincsPlusSignature {
    /// Get signature bytes
    pub fn as_bytes(&self) -> &[u8] {
        self.0.as_bytes()
    }

    /// Create from bytes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        sphincssha2256fsimple::DetachedSignature::from_bytes(bytes)
            .map(SphincsPlusSignature)
            .map_err(|_| CryptoError::InvalidSignature("Invalid signature bytes".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sign_verify() {
        let keypair = SphincsPlusKeyPair::generate();
        let message = b"test message";

        let signature = keypair.sign(message);
        let result = keypair.verify(message, &signature);

        assert!(result.is_ok());
    }
}
