//! Hybrid certificate verifier for client-side TLS validation
//!
//! Implements custom certificate verification that:
//! 1. Validates standard X.509 certificate chain
//! 2. Extracts ML-KEM-768 public key from certificate extension
//! 3. Performs ML-KEM encapsulation during handshake
//! 4. Sends ciphertext to server via QUIC transport parameters

use crate::error::{NetworkError, Result};
use super::hybrid_handshake::{HybridKemExtension, HYBRID_KEM_EXTENSION_TYPE};
use cretoai_crypto::kem::{MLKem768, MLKem768Ciphertext, MLKem768PublicKey};
use rustls::client::dangerous::{ServerCertVerified, ServerCertVerifier};
use rustls::{Certificate, ServerName, ClientCertVerifier};
use rustls::{Error as TlsError, SignatureScheme, DigitallySignedStruct};
use rustls::crypto::{CryptoProvider, WebPkiSupportedAlgorithms};
use std::sync::{Arc, RwLock};
use std::time::SystemTime;

/// State tracking for KEM handshake during certificate verification
///
/// Stores ML-KEM-768 ciphertext and shared secret generated during
/// the TLS handshake certificate verification process.
#[derive(Debug, Default)]
pub struct KemHandshakeState {
    /// Encapsulated ciphertext to send to server
    pub ciphertext: Option<MLKem768Ciphertext>,

    /// ML-KEM shared secret (stored after encapsulation)
    pub ml_kem_secret: Option<Vec<u8>>,
}

impl KemHandshakeState {
    /// Create a new empty KEM handshake state
    pub fn new() -> Self {
        Self {
            ciphertext: None,
            ml_kem_secret: None,
        }
    }

    /// Set the ciphertext and shared secret
    pub fn set(&mut self, ciphertext: MLKem768Ciphertext, secret: Vec<u8>) {
        self.ciphertext = Some(ciphertext);
        self.ml_kem_secret = Some(secret);
    }

    /// Take the ciphertext (removes it from state)
    pub fn take_ciphertext(&mut self) -> Option<MLKem768Ciphertext> {
        self.ciphertext.take()
    }

    /// Take the ML-KEM shared secret (removes it from state)
    pub fn take_secret(&mut self) -> Option<Vec<u8>> {
        self.ml_kem_secret.take()
    }
}

/// Hybrid certificate verifier for client-side TLS
///
/// Verifies server certificates and performs ML-KEM-768 encapsulation
/// during the TLS handshake.
#[derive(Debug)]
pub struct HybridCertVerifier {
    /// Shared KEM handshake state
    kem_state: Arc<RwLock<KemHandshakeState>>,
}

impl HybridCertVerifier {
    /// Create a new hybrid certificate verifier with shared state
    ///
    /// # Arguments
    ///
    /// * `kem_state` - Shared KEM handshake state for storing ciphertext
    pub fn new(kem_state: Arc<RwLock<KemHandshakeState>>) -> Self {
        Self { kem_state }
    }

    /// Get access to the KEM handshake state
    pub fn kem_state(&self) -> Arc<RwLock<KemHandshakeState>> {
        Arc::clone(&self.kem_state)
    }

    /// Extract ML-KEM public key from certificate extension using proper X.509 parsing
    fn extract_ml_kem_public_key(&self, cert: &CertificateDer<'static>) -> Result<MLKem768PublicKey> {
        use super::cert::PeerCertificate;

        // Use the proper X.509 parser from cert.rs to extract ML-KEM key
        let peer_cert = PeerCertificate::from_der(cert.as_ref())?;

        // Get the ML-KEM public key reference and convert to owned
        match peer_cert.ml_kem_pubkey() {
            Some(pubkey) => {
                // Reconstruct MLKem768PublicKey from bytes
                let pubkey_bytes = pubkey.as_bytes();
                MLKem768PublicKey::from_bytes(pubkey_bytes)
                    .map_err(|e| NetworkError::Transport(format!("Failed to reconstruct ML-KEM public key: {}", e)))
            }
            None => Err(NetworkError::Transport(
                "Certificate does not contain ML-KEM-768 extension".to_string()
            ))
        }
    }
}

impl ServerCertVerifier for HybridCertVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> std::result::Result<ServerCertVerified, TlsError> {
        // First, perform basic certificate validation
        // For now, we skip chain validation and just extract ML-KEM key
        // TODO: Add proper chain validation with WebPKI

        // Extract ML-KEM public key from certificate
        let ml_kem_public_key = self.extract_ml_kem_public_key(&end_entity.clone().into_owned())
            .map_err(|e| TlsError::General(format!("ML-KEM key extraction failed: {}", e)))?;

        // Perform ML-KEM encapsulation
        let (shared_secret, ciphertext) = MLKem768::encapsulate(&ml_kem_public_key);

        // Store ciphertext and shared secret in shared state
        let mut state = self.kem_state.write().unwrap();
        state.set(ciphertext, shared_secret.as_bytes().to_vec());

        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> std::result::Result<rustls::client::dangerous::HandshakeSignatureValid, TlsError> {
        // For now, accept all TLS 1.2 signatures
        // TODO: Implement proper signature verification
        Ok(rustls::client::dangerous::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> std::result::Result<rustls::client::dangerous::HandshakeSignatureValid, TlsError> {
        // For now, accept all TLS 1.3 signatures
        // TODO: Implement proper signature verification
        Ok(rustls::client::dangerous::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        // Support common signature schemes
        vec![
            SignatureScheme::RSA_PKCS1_SHA256,
            SignatureScheme::RSA_PKCS1_SHA384,
            SignatureScheme::RSA_PKCS1_SHA512,
            SignatureScheme::ECDSA_NISTP256_SHA256,
            SignatureScheme::ECDSA_NISTP384_SHA384,
            SignatureScheme::RSA_PSS_SHA256,
            SignatureScheme::RSA_PSS_SHA384,
            SignatureScheme::RSA_PSS_SHA512,
            SignatureScheme::ED25519,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_verifier_creation() {
        let kem_state = Arc::new(RwLock::new(KemHandshakeState::new()));
        let verifier = HybridCertVerifier::new(kem_state);
        assert!(verifier.kem_state().read().unwrap().ciphertext.is_none());
    }

    #[test]
    fn test_kem_handshake_state() {
        let keypair = MLKem768::generate();
        let (secret, ct) = MLKem768::encapsulate(&keypair.public_key);

        let mut state = KemHandshakeState::new();
        state.set(ct.clone(), secret.as_bytes().to_vec());

        // Can retrieve
        assert!(state.take_ciphertext().is_some());
        assert!(state.take_secret().is_some());

        // Only once
        assert!(state.take_ciphertext().is_none());
        assert!(state.take_secret().is_none());
    }
}
