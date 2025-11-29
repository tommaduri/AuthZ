//! Error types for the cryptography module

use thiserror::Error;

/// Result type alias for cryptographic operations
pub type Result<T> = std::result::Result<T, CryptoError>;

/// Errors that can occur during cryptographic operations
#[derive(Debug, Error)]
pub enum CryptoError {
    /// Key generation failed
    #[error("Key generation failed: {0}")]
    KeyGeneration(String),

    /// Signature generation failed
    #[error("Signature generation failed: {0}")]
    SignatureGeneration(String),

    /// Signature verification failed
    #[error("Signature verification failed: {0}")]
    SignatureVerification(String),

    /// Signature verification failed (no details)
    #[error("Signature verification failed")]
    SignatureVerificationFailed,

    /// Encryption failed
    #[error("Encryption failed: {0}")]
    Encryption(String),

    /// Decryption failed
    #[error("Decryption failed: {0}")]
    Decryption(String),

    /// Hash computation failed
    #[error("Hash computation failed: {0}")]
    Hashing(String),

    /// Invalid key format
    #[error("Invalid key format: {0}")]
    InvalidKey(String),

    /// Invalid public key
    #[error("Invalid public key")]
    InvalidPublicKey,

    /// Invalid secret key
    #[error("Invalid secret key")]
    InvalidSecretKey,

    /// Invalid signature format
    #[error("Invalid signature format: {0}")]
    InvalidSignature(String),

    /// Invalid ciphertext
    #[error("Invalid ciphertext")]
    InvalidCiphertext,

    /// Key storage error
    #[error("Key storage error")]
    KeyStorageError,

    /// Key retrieval error
    #[error("Key retrieval error")]
    KeyRetrievalError,

    /// Key not found
    #[error("Key not found")]
    KeyNotFound,

    /// Key deserialization failed
    #[error("Key deserialization failed: {0}")]
    Deserialization(String),

    /// Key serialization failed
    #[error("Key serialization failed: {0}")]
    Serialization(String),

    /// Random number generation failed
    #[error("Random number generation failed: {0}")]
    RandomGeneration(String),

    /// Generic cryptographic error
    #[error("Cryptographic error: {0}")]
    Generic(String),
}
