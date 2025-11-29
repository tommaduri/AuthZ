//! Cryptography-related types

use serde::{Deserialize, Serialize};
use std::fmt;

/// Public key (generic 32-byte key)
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PublicKey(pub Vec<u8>);

impl PublicKey {
    /// Create a new public key
    pub fn new(bytes: Vec<u8>) -> Self {
        PublicKey(bytes)
    }

    /// Get the public key as bytes
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }

    /// Convert to hex string
    pub fn to_hex(&self) -> String {
        hex::encode(&self.0)
    }
}

impl fmt::Display for PublicKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let hex = self.to_hex();
        if hex.len() > 16 {
            write!(f, "{}...{}", &hex[..8], &hex[hex.len() - 8..])
        } else {
            write!(f, "{}", hex)
        }
    }
}

/// Digital signature
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Signature(pub Vec<u8>);

impl Signature {
    /// Create a new signature
    pub fn new(bytes: Vec<u8>) -> Self {
        Signature(bytes)
    }

    /// Get the signature as bytes
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }

    /// Convert to hex string
    pub fn to_hex(&self) -> String {
        hex::encode(&self.0)
    }
}

impl fmt::Display for Signature {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let hex = self.to_hex();
        if hex.len() > 16 {
            write!(f, "{}...{}", &hex[..8], &hex[hex.len() - 8..])
        } else {
            write!(f, "{}", hex)
        }
    }
}

/// Message with signature
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedMessage<T> {
    /// Message payload
    pub payload: T,
    /// Message signature
    pub signature: Signature,
    /// Signer's public key
    pub public_key: PublicKey,
    /// Timestamp
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

impl<T> SignedMessage<T>
where
    T: Serialize,
{
    /// Create a new signed message (without actual signing)
    /// Actual signing should be done by the crypto module
    pub fn new(payload: T, signature: Signature, public_key: PublicKey) -> Self {
        SignedMessage {
            payload,
            signature,
            public_key,
            timestamp: chrono::Utc::now(),
        }
    }

    /// Serialize the payload for verification
    pub fn serialize_payload(&self) -> Result<Vec<u8>, crate::error::CoreError> {
        bincode::serialize(&self.payload).map_err(|e| {
            crate::error::CoreError::serialization(format!("Failed to serialize payload: {}", e))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_public_key() {
        let key = PublicKey::new(vec![1, 2, 3, 4]);
        assert_eq!(key.as_bytes(), &[1, 2, 3, 4]);
    }

    #[test]
    fn test_signature() {
        let sig = Signature::new(vec![5, 6, 7, 8]);
        assert_eq!(sig.as_bytes(), &[5, 6, 7, 8]);
    }

    #[test]
    fn test_signed_message() {
        let payload = "test message";
        let signature = Signature::new(vec![1; 64]);
        let public_key = PublicKey::new(vec![2; 32]);

        let signed = SignedMessage::new(payload, signature.clone(), public_key.clone());
        assert_eq!(signed.payload, payload);
        assert_eq!(signed.signature, signature);
        assert_eq!(signed.public_key, public_key);
    }
}
