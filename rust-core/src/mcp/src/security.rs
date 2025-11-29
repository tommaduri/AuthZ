//! Security Layer
//!
//! Provides ML-DSA (Dilithium) signature verification for MCP messages.
//! Integrates with vigilia-crypto for quantum-resistant cryptography.

use crate::byzantine::{ByzantineDetector, ByzantineFault};
use crate::error::{McpError, Result};
use crate::protocol::McpMessage;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use cretoai_crypto::signatures::{MLDSA87, MLDSA87PublicKey, MLDSA87SecretKey, MLDSA87Signature};
use chrono::Utc;

/// Signed message wrapper
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedMessage {
    pub message: McpMessage,
    pub signature: Vec<u8>,
    pub signer_id: String,
    pub timestamp: i64,
}

/// Security layer for message signing and verification
pub struct SecurityLayer {
    /// Trusted ML-DSA-87 public keys indexed by agent ID
    trusted_keys: Arc<RwLock<HashMap<String, MLDSA87PublicKey>>>,
    /// Whether to require signature verification
    require_signatures: bool,
    /// Replay protection: track used nonces
    used_nonces: Arc<RwLock<HashMap<String, i64>>>,
    /// Replay window in seconds (default: 300s = 5 minutes)
    replay_window: i64,
    /// Byzantine fault detector
    byzantine_detector: Arc<ByzantineDetector>,
}

impl SecurityLayer {
    /// Create a new security layer
    pub fn new(require_signatures: bool) -> Self {
        Self::with_replay_window(require_signatures, 300) // 5 minute default window
    }

    /// Create a new security layer with custom replay window
    pub fn with_replay_window(require_signatures: bool, replay_window_secs: i64) -> Self {
        Self {
            trusted_keys: Arc::new(RwLock::new(HashMap::new())),
            require_signatures,
            used_nonces: Arc::new(RwLock::new(HashMap::new())),
            replay_window: replay_window_secs,
            byzantine_detector: Arc::new(ByzantineDetector::new()),
        }
    }

    /// Get Byzantine detector reference
    pub fn byzantine_detector(&self) -> Arc<ByzantineDetector> {
        self.byzantine_detector.clone()
    }

    /// Add a trusted public key from bytes
    pub async fn add_trusted_key(&self, signer_id: String, public_key_bytes: Vec<u8>) -> Result<()> {
        let public_key = MLDSA87PublicKey::from_bytes(&public_key_bytes)
            .map_err(|e| McpError::Auth(format!("Invalid ML-DSA public key: {}", e)))?;

        let mut keys = self.trusted_keys.write().await;
        keys.insert(signer_id, public_key);
        Ok(())
    }

    /// Add a trusted public key (direct)
    pub async fn add_trusted_key_direct(&self, signer_id: String, public_key: MLDSA87PublicKey) -> Result<()> {
        let mut keys = self.trusted_keys.write().await;
        keys.insert(signer_id, public_key);
        Ok(())
    }

    /// Remove a trusted public key
    pub async fn remove_trusted_key(&self, signer_id: &str) -> Result<()> {
        let mut keys = self.trusted_keys.write().await;
        keys.remove(signer_id);
        Ok(())
    }

    /// Sign a message with ML-DSA-87
    pub async fn sign_message(
        &self,
        message: McpMessage,
        signer_id: String,
        secret_key: &MLDSA87SecretKey,
    ) -> Result<SignedMessage> {
        let timestamp = Utc::now().timestamp();

        // Serialize message for signing
        let message_bytes = serde_json::to_vec(&message)
            .map_err(|e| McpError::Generic(format!("Serialization failed: {}", e)))?;

        // Create signing payload: message || timestamp || signer_id
        let mut signing_data = message_bytes;
        signing_data.extend_from_slice(&timestamp.to_le_bytes());
        signing_data.extend_from_slice(signer_id.as_bytes());

        // Sign with ML-DSA-87
        let signature = MLDSA87::sign(&signing_data, secret_key);

        Ok(SignedMessage {
            message,
            signature: signature.as_bytes().to_vec(),
            signer_id,
            timestamp,
        })
    }

    /// Verify a signed message with ML-DSA-87
    pub async fn verify_message(&self, signed_message: &SignedMessage) -> Result<bool> {
        // 1. Check replay protection (timestamp within window)
        let now = Utc::now().timestamp();
        let age = now - signed_message.timestamp;

        if age > self.replay_window {
            // Record Byzantine fault: expired message
            self.byzantine_detector
                .record_fault(
                    &signed_message.signer_id,
                    ByzantineFault::MalformedMessage {
                        error: format!("Message too old: {} seconds", age),
                    },
                )
                .await
                .ok();

            return Err(McpError::Auth(format!(
                "Message too old: {} seconds (window: {})",
                age, self.replay_window
            )));
        }

        if age < -30 {
            // Allow 30 seconds clock skew
            return Err(McpError::Auth(format!(
                "Message timestamp in future: {} seconds",
                -age
            )));
        }

        // 2. Check for replay (nonce already used)
        let nonce_key = format!("{}:{}", signed_message.signer_id, signed_message.timestamp);
        {
            let mut nonces = self.used_nonces.write().await;

            // Clean up old nonces (beyond replay window)
            nonces.retain(|_, &mut ts| (now - ts) <= self.replay_window);

            if nonces.contains_key(&nonce_key) {
                // Record Byzantine fault: replay attempt
                self.byzantine_detector
                    .record_fault(
                        &signed_message.signer_id,
                        ByzantineFault::ReplayAttempt {
                            nonce: nonce_key.clone(),
                        },
                    )
                    .await
                    .ok();

                return Err(McpError::Auth(format!(
                    "Replay detected: message already processed"
                )));
            }

            // Record this nonce
            nonces.insert(nonce_key, signed_message.timestamp);
        }

        // 3. Verify signer is trusted
        let keys = self.trusted_keys.read().await;
        let public_key = keys.get(&signed_message.signer_id).ok_or_else(|| {
            McpError::Auth(format!("Unknown signer: {}", signed_message.signer_id))
        })?;

        // 4. Reconstruct signing payload
        let message_bytes = serde_json::to_vec(&signed_message.message)
            .map_err(|e| McpError::Generic(format!("Serialization failed: {}", e)))?;

        let mut signing_data = message_bytes;
        signing_data.extend_from_slice(&signed_message.timestamp.to_le_bytes());
        signing_data.extend_from_slice(signed_message.signer_id.as_bytes());

        // 5. Verify ML-DSA-87 signature
        let signature = MLDSA87Signature::from_bytes(&signed_message.signature)
            .map_err(|e| McpError::Auth(format!("Invalid signature format: {}", e)))?;

        match MLDSA87::verify(&signing_data, &signature, public_key) {
            Ok(_) => {
                // Signature valid - record success
                self.byzantine_detector
                    .record_success(&signed_message.signer_id)
                    .await
                    .ok();
                Ok(true)
            }
            Err(_) => {
                // Invalid signature - record Byzantine fault
                let message_hash = blake3::hash(&signing_data).as_bytes().to_vec();

                self.byzantine_detector
                    .record_fault(
                        &signed_message.signer_id,
                        ByzantineFault::InvalidSignature { message_hash },
                    )
                    .await
                    .ok();

                Err(McpError::Auth("Signature verification failed".to_string()))
            }
        }
    }

    /// Extract message from signed wrapper
    pub fn extract_message(signed_message: &SignedMessage) -> McpMessage {
        signed_message.message.clone()
    }

    /// Check if signatures are required
    pub fn requires_signatures(&self) -> bool {
        self.require_signatures
    }

    /// Get list of trusted signers
    pub async fn list_trusted_signers(&self) -> Vec<String> {
        let keys = self.trusted_keys.read().await;
        keys.keys().cloned().collect()
    }

    /// Clean up expired nonces (call periodically)
    pub async fn cleanup_nonces(&self) {
        let now = Utc::now().timestamp();
        let mut nonces = self.used_nonces.write().await;
        nonces.retain(|_, &mut ts| (now - ts) <= self.replay_window);
    }

    /// Get replay window in seconds
    pub fn replay_window(&self) -> i64 {
        self.replay_window
    }
}

impl Default for SecurityLayer {
    fn default() -> Self {
        Self::new(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::*;

    #[tokio::test]
    async fn test_sign_and_verify_with_mldsa() {
        let security = SecurityLayer::new(true);

        // Generate ML-DSA keypair
        let keypair = MLDSA87::generate();

        // Add public key to security layer
        security
            .add_trusted_key_direct("agent-1".to_string(), keypair.public_key.clone())
            .await
            .unwrap();

        let message = McpMessage::Ping(PingMessage {
            id: "test-1".to_string(),
            timestamp: 1234567890,
        });

        let signed = security
            .sign_message(message.clone(), "agent-1".to_string(), &keypair.secret_key)
            .await
            .unwrap();

        let verified = security.verify_message(&signed).await.unwrap();
        assert!(verified);
    }

    #[tokio::test]
    async fn test_unknown_signer_rejected() {
        let security = SecurityLayer::new(true);

        let keypair = MLDSA87::generate();

        let message = McpMessage::Ping(PingMessage {
            id: "test-2".to_string(),
            timestamp: 1234567890,
        });

        let signed = security
            .sign_message(message, "unknown-agent".to_string(), &keypair.secret_key)
            .await
            .unwrap();

        let result = security.verify_message(&signed).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Unknown signer"));
    }

    #[tokio::test]
    async fn test_replay_protection() {
        let security = SecurityLayer::with_replay_window(true, 300);

        let keypair = MLDSA87::generate();

        security
            .add_trusted_key_direct("agent-1".to_string(), keypair.public_key.clone())
            .await
            .unwrap();

        let message = McpMessage::Ping(PingMessage {
            id: "test-3".to_string(),
            timestamp: 1234567890,
        });

        let signed = security
            .sign_message(message, "agent-1".to_string(), &keypair.secret_key)
            .await
            .unwrap();

        // First verification should succeed
        let result1 = security.verify_message(&signed).await;
        assert!(result1.is_ok());

        // Second verification (replay) should fail
        let result2 = security.verify_message(&signed).await;
        assert!(result2.is_err());
        assert!(result2.unwrap_err().to_string().contains("Replay detected"));
    }

    #[tokio::test]
    async fn test_expired_message_rejected() {
        let security = SecurityLayer::with_replay_window(true, 10); // 10 second window

        let keypair = MLDSA87::generate();

        security
            .add_trusted_key_direct("agent-1".to_string(), keypair.public_key.clone())
            .await
            .unwrap();

        let message = McpMessage::Ping(PingMessage {
            id: "test-4".to_string(),
            timestamp: 1234567890,
        });

        // Create signed message with old timestamp
        let old_timestamp = Utc::now().timestamp() - 100; // 100 seconds ago
        let mut signed = security
            .sign_message(message, "agent-1".to_string(), &keypair.secret_key)
            .await
            .unwrap();

        signed.timestamp = old_timestamp;

        let result = security.verify_message(&signed).await;
        assert!(result.is_err());
        // Can't check exact error message since signature won't match modified timestamp
    }

    #[tokio::test]
    async fn test_add_remove_trusted_key() {
        let security = SecurityLayer::new(true);

        let keypair = MLDSA87::generate();
        let public_key_bytes = keypair.public_key.as_bytes().to_vec();

        security
            .add_trusted_key("agent-1".to_string(), public_key_bytes)
            .await
            .unwrap();

        let signers = security.list_trusted_signers().await;
        assert_eq!(signers.len(), 1);

        security.remove_trusted_key("agent-1").await.unwrap();

        let signers = security.list_trusted_signers().await;
        assert_eq!(signers.len(), 0);
    }

    #[tokio::test]
    async fn test_extract_message() {
        let security = SecurityLayer::new(true);

        let keypair = MLDSA87::generate();

        let message = McpMessage::Ping(PingMessage {
            id: "test-5".to_string(),
            timestamp: 1234567890,
        });

        let signed = security
            .sign_message(message.clone(), "agent-1".to_string(), &keypair.secret_key)
            .await
            .unwrap();

        let extracted = SecurityLayer::extract_message(&signed);
        assert_eq!(extracted, message);
    }

    #[test]
    fn test_requires_signatures() {
        let security1 = SecurityLayer::new(true);
        assert!(security1.requires_signatures());

        let security2 = SecurityLayer::new(false);
        assert!(!security2.requires_signatures());
    }

    #[tokio::test]
    async fn test_cleanup_nonces() {
        let security = SecurityLayer::with_replay_window(true, 5); // 5 second window

        let keypair = MLDSA87::generate();

        security
            .add_trusted_key_direct("agent-1".to_string(), keypair.public_key.clone())
            .await
            .unwrap();

        let message = McpMessage::Ping(PingMessage {
            id: "test-6".to_string(),
            timestamp: 1234567890,
        });

        let signed = security
            .sign_message(message, "agent-1".to_string(), &keypair.secret_key)
            .await
            .unwrap();

        // Verify message (adds nonce)
        let _ = security.verify_message(&signed).await;

        // Cleanup nonces
        security.cleanup_nonces().await;

        // Nonce count should be preserved (within window)
        // This test mainly ensures cleanup doesn't crash
    }
}
