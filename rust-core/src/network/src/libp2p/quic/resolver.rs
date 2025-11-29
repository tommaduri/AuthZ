//! Hybrid certificate resolver for server-side TLS
//!
//! Implements custom certificate resolution that:
//! 1. Provides server certificate with ML-KEM-768 public key extension
//! 2. Receives ML-KEM ciphertext from client via QUIC transport parameters
//! 3. Performs ML-KEM decapsulation
//! 4. Provides hybrid shared secret for key derivation

use crate::error::{NetworkError, Result};
use super::hybrid_handshake::{HybridKemExtension, HYBRID_KEM_EXTENSION_TYPE};
use cretoai_crypto::kem::{MLKem768, MLKem768Ciphertext};
use cretoai_crypto::keys::AgentIdentity;
use rustls::server::{ClientHello, ResolvesServerCert};
use rustls::sign::CertifiedKey;
use rustls::{Certificate, PrivateKey};
use std::sync::{Arc, RwLock};
use rcgen::{CertificateParams, KeyPair, DnType};
use std::time::{SystemTime, Duration};

/// State tracking for ML-KEM ciphertext received from client
///
/// Stores ciphertext received during handshake and the derived shared secret
/// after decapsulation.
#[derive(Debug, Default)]
pub struct CiphertextState {
    /// Received ciphertext from client
    pub received_ciphertext: Option<MLKem768Ciphertext>,

    /// ML-KEM shared secret (stored after decapsulation)
    pub ml_kem_secret: Option<Vec<u8>>,
}

impl CiphertextState {
    /// Create a new empty ciphertext state
    pub fn new() -> Self {
        Self {
            received_ciphertext: None,
            ml_kem_secret: None,
        }
    }

    /// Set the received ciphertext
    pub fn set_ciphertext(&mut self, ciphertext: MLKem768Ciphertext) {
        self.received_ciphertext = Some(ciphertext);
    }

    /// Set the decapsulated shared secret
    pub fn set_secret(&mut self, secret: Vec<u8>) {
        self.ml_kem_secret = Some(secret);
    }

    /// Take the shared secret (removes it from state)
    pub fn take_secret(&mut self) -> Option<Vec<u8>> {
        self.ml_kem_secret.take()
    }
}

/// Hybrid certificate resolver for server-side TLS
///
/// Resolves server certificates with ML-KEM-768 public key embedded,
/// and performs decapsulation of client's ciphertext.
#[derive(Debug)]
pub struct HybridCertResolver {
    /// Agent identity containing ML-KEM keypair
    identity: Arc<AgentIdentity>,

    /// Server certificate with ML-KEM public key extension
    certified_key: Arc<CertifiedKey>,

    /// Shared ciphertext state
    ciphertext_state: Arc<RwLock<CiphertextState>>,
}

impl HybridCertResolver {
    /// Create a new hybrid certificate resolver from agent identity
    ///
    /// # Arguments
    ///
    /// * `identity` - Agent identity containing ML-KEM keypair
    pub fn new(identity: Arc<AgentIdentity>) -> Result<Self> {
        let certified_key = Self::generate_certificate(&identity)?;

        Ok(Self {
            identity,
            certified_key: Arc::new(certified_key),
            ciphertext_state: Arc::new(RwLock::new(CiphertextState::new())),
        })
    }

    /// Get access to the ciphertext state
    pub fn ciphertext_state(&self) -> Arc<RwLock<CiphertextState>> {
        Arc::clone(&self.ciphertext_state)
    }

    /// Generate self-signed certificate with ML-KEM public key extension
    fn generate_certificate(identity: &AgentIdentity) -> Result<CertifiedKey> {
        // Generate Ed25519 keypair for certificate signing
        let keypair = KeyPair::generate(&rcgen::PKCS_ED25519)
            .map_err(|e| NetworkError::Transport(format!("Failed to generate keypair: {}", e)))?;

        let domain = "vigilia.local";
        let mut params = CertificateParams::new(vec![domain.to_string()]);
        params.distinguished_name.push(DnType::CommonName, domain);

        // Use SystemTime for not_before/not_after
        let now = SystemTime::now();
        let one_year = Duration::from_secs(365 * 24 * 60 * 60);
        params.not_before = rcgen::date_time_ymd(2024, 1, 1);
        params.not_after = rcgen::date_time_ymd(2025, 1, 1);

        // Add ML-KEM-768 public key as custom extension using NIST OID
        // OID: 2.16.840.1.101.3.4.4.4 (NIST ML-KEM-768)
        let ml_kem_pubkey_bytes = identity.kem_keypair.public_key.as_bytes().to_vec();

        params.custom_extensions = vec![
            rcgen::CustomExtension::from_oid_content(
                &[2, 16, 840, 1, 101, 3, 4, 4, 4],
                ml_kem_pubkey_bytes,
            ),
        ];

        let cert = rcgen::Certificate::from_params(params)
            .map_err(|e| NetworkError::Transport(format!("Failed to generate certificate: {}", e)))?;

        let cert_der = cert.serialize_der()
            .map_err(|e| NetworkError::Transport(format!("Failed to serialize certificate: {}", e)))?;

        let private_key_der = cert.serialize_private_key_der();

        // Convert to rustls types
        let cert_chain = vec![CertificateDer::from(cert_der)];
        let private_key = PrivateKeyDer::try_from(private_key_der)
            .map_err(|_| NetworkError::Transport("Invalid private key format".to_string()))?;

        // Create certified key (rustls 0.22+ handles signing key internally)
        Ok(CertifiedKey::new(
            cert_chain,
            rustls::crypto::ring::sign::any_supported_type(&private_key)
                .map_err(|_| NetworkError::Transport("Unsupported private key type".to_string()))?
        ))
    }

    /// Perform ML-KEM decapsulation on received ciphertext
    pub fn decapsulate(&self) -> Result<()> {
        let mut state = self.ciphertext_state.write().unwrap();

        let ciphertext = state.received_ciphertext.as_ref()
            .ok_or_else(|| NetworkError::Transport("No ciphertext received from client".to_string()))?;

        let shared_secret = MLKem768::decapsulate(ciphertext, &self.identity.kem_keypair.secret_key);
        state.set_secret(shared_secret.as_bytes().to_vec());

        Ok(())
    }
}

impl ResolvesServerCert for HybridCertResolver {
    fn resolve(&self, _client_hello: ClientHello) -> Option<Arc<CertifiedKey>> {
        // Return our certificate with ML-KEM public key
        Some(Arc::clone(&self.certified_key))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ciphertext_state() {
        let keypair = MLKem768::generate();
        let (secret, ct) = MLKem768::encapsulate(&keypair.public_key);

        let mut state = CiphertextState::new();
        state.set_ciphertext(ct);
        state.set_secret(secret.as_bytes().to_vec());

        // Can retrieve secret
        assert!(state.take_secret().is_some());

        // Only once
        assert!(state.take_secret().is_none());
    }
}
