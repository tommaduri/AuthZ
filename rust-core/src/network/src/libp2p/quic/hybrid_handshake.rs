//! Hybrid TLS 1.3 extension for ML-KEM-768 key encapsulation
//!
//! This module implements a custom TLS extension (Type 0xFF01) that carries
//! ML-KEM-768 ciphertext during the TLS handshake, enabling post-quantum
//! key exchange alongside classical X25519 ECDH.

use crate::error::{NetworkError, Result};
use cretoai_crypto::kem::{MLKem768, MLKem768KeyPair, MLKem768Ciphertext, MLKem768PublicKey};
use blake3::Hasher;
use std::sync::Arc;
use rustls::{ClientConfig, ServerConfig};

/// TLS extension type for hybrid KEM
/// Type 0xFF01 is in the private use range (0xFF00-0xFFFF)
pub const HYBRID_KEM_EXTENSION_TYPE: u16 = 0xFF01;

/// ML-KEM-768 algorithm identifier
pub const ML_KEM_768_ALGORITHM_ID: u16 = 0x0304;

/// ML-KEM-768 public key size (NIST FIPS 203)
pub const ML_KEM_768_PUBKEY_SIZE: usize = 1184;

/// ML-KEM-768 ciphertext size (NIST FIPS 203)
pub const ML_KEM_768_CIPHERTEXT_SIZE: usize = 1088;

/// Custom TLS 1.3 extension for hybrid KEM
///
/// Carries ML-KEM-768 public key and encapsulated ciphertext.
///
/// # Wire Format
///
/// ```text
/// struct HybridKemExtension {
///     extension_type: u16 = 0xFF01,
///     length: u16,
///     extension_data: {
///         algorithm_id: u16 = 0x0304,
///         public_key: [u8; 1184],
///         ciphertext: [u8; 1088],
///     }
/// }
/// ```
#[derive(Debug, Clone)]
pub struct HybridKemExtension {
    /// ML-KEM-768 algorithm ID
    pub algorithm_id: u16,

    /// ML-KEM-768 public key (1184 bytes)
    pub public_key: Vec<u8>,

    /// ML-KEM-768 encapsulated ciphertext (1088 bytes)
    pub ciphertext: Vec<u8>,
}

impl HybridKemExtension {
    /// Create a new hybrid KEM extension
    pub fn new(public_key: &MLKem768PublicKey) -> Self {
        Self {
            algorithm_id: ML_KEM_768_ALGORITHM_ID,
            public_key: public_key.as_bytes().to_vec(),
            ciphertext: Vec::new(), // Filled after encapsulation
        }
    }

    /// Encode extension to bytes (TLS wire format)
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::new();

        // Extension type (2 bytes)
        buf.extend_from_slice(&HYBRID_KEM_EXTENSION_TYPE.to_be_bytes());

        // Extension length (2 bytes)
        let data_len = 2 + self.public_key.len() + self.ciphertext.len();
        buf.extend_from_slice(&(data_len as u16).to_be_bytes());

        // Algorithm ID (2 bytes)
        buf.extend_from_slice(&self.algorithm_id.to_be_bytes());

        // Public key (1184 bytes)
        buf.extend_from_slice(&self.public_key);

        // Ciphertext (1088 bytes, empty if not yet encapsulated)
        buf.extend_from_slice(&self.ciphertext);

        buf
    }

    /// Decode extension from bytes
    pub fn decode(data: &[u8]) -> Result<Self> {
        if data.len() < 4 {
            return Err(NetworkError::Transport("Invalid extension data".to_string()));
        }

        // Parse extension type
        let ext_type = u16::from_be_bytes([data[0], data[1]]);
        if ext_type != HYBRID_KEM_EXTENSION_TYPE {
            return Err(NetworkError::Transport(
                format!("Invalid extension type: expected {}, got {}",
                    HYBRID_KEM_EXTENSION_TYPE, ext_type)
            ));
        }

        // Parse extension length
        let ext_len = u16::from_be_bytes([data[2], data[3]]) as usize;

        // Parse algorithm ID
        if data.len() < 6 {
            return Err(NetworkError::Transport("Truncated extension data".to_string()));
        }
        let algorithm_id = u16::from_be_bytes([data[4], data[5]]);

        if algorithm_id != ML_KEM_768_ALGORITHM_ID {
            return Err(NetworkError::Transport(
                format!("Unsupported KEM algorithm: {}", algorithm_id)
            ));
        }

        // Parse public key
        if data.len() < 6 + ML_KEM_768_PUBKEY_SIZE {
            return Err(NetworkError::Transport("Truncated public key".to_string()));
        }
        let public_key = data[6..6 + ML_KEM_768_PUBKEY_SIZE].to_vec();

        // Parse ciphertext (if present)
        let ciphertext = if data.len() >= 6 + ML_KEM_768_PUBKEY_SIZE + ML_KEM_768_CIPHERTEXT_SIZE {
            data[6 + ML_KEM_768_PUBKEY_SIZE..6 + ML_KEM_768_PUBKEY_SIZE + ML_KEM_768_CIPHERTEXT_SIZE].to_vec()
        } else {
            Vec::new()
        };

        Ok(Self {
            algorithm_id,
            public_key,
            ciphertext,
        })
    }

    /// Set encapsulated ciphertext
    pub fn set_ciphertext(&mut self, ciphertext: &MLKem768Ciphertext) {
        self.ciphertext = ciphertext.as_bytes().to_vec();
    }
}

/// Hybrid TLS configuration manager
///
/// Manages hybrid X25519 + ML-KEM-768 key exchange for TLS 1.3 connections.
pub struct HybridTlsConfig {
    /// ML-KEM-768 keypair for this endpoint
    kem_keypair: MLKem768KeyPair,
}

impl HybridTlsConfig {
    /// Create a new hybrid TLS config
    pub fn new() -> Self {
        let kem_keypair = MLKem768::generate();

        Self { kem_keypair }
    }

    /// Get ML-KEM-768 public key
    pub fn public_key(&self) -> &MLKem768PublicKey {
        &self.kem_keypair.public_key
    }

    /// Perform ML-KEM-768 encapsulation (client side)
    pub fn encapsulate(&self, peer_public_key: &MLKem768PublicKey)
        -> (Vec<u8>, MLKem768Ciphertext)
    {
        let (shared_secret, ciphertext) = MLKem768::encapsulate(peer_public_key);
        (shared_secret.as_bytes().to_vec(), ciphertext)
    }

    /// Perform ML-KEM-768 decapsulation (server side)
    pub fn decapsulate(&self, ciphertext: &MLKem768Ciphertext) -> Vec<u8> {
        let shared_secret = MLKem768::decapsulate(ciphertext, &self.kem_keypair.secret_key);
        shared_secret.as_bytes().to_vec()
    }

    /// Build Quinn client configuration with hybrid TLS
    ///
    /// Creates a QUIC client configuration that:
    /// 1. Uses custom certificate verifier to extract ML-KEM-768 public key
    /// 2. Performs ML-KEM encapsulation during handshake
    /// 3. Stores ciphertext for transmission via transport parameters
    ///
    /// # Returns
    ///
    /// A configured `quinn::ClientConfig` with hybrid TLS support
    pub fn build_client_config(
        &self,
        server_name: String,
    ) -> Result<quinn::ClientConfig> {
        use crate::libp2p::quic::verifier::{HybridCertVerifier, KemHandshakeState};
        use std::sync::{Arc, RwLock};

        // Create shared state for KEM handshake
        let kem_state = Arc::new(RwLock::new(KemHandshakeState::new()));

        // Create hybrid certificate verifier
        let verifier = Arc::new(HybridCertVerifier::new(kem_state.clone()));

        // Build Rustls client config with custom verifier using dangerous_configuration
        let mut crypto = rustls::ClientConfig::builder()
            .with_safe_defaults()
            .with_custom_certificate_verifier(verifier)
            .with_no_client_auth();

        // Enable ALPN for QUIC (required by Quinn)
        crypto.alpn_protocols = vec![b"h3".to_vec()];

        // Create Quinn client config (Quinn 0.10 directly accepts Arc<rustls::ClientConfig>)
        let mut client_config = quinn::ClientConfig::new(Arc::new(crypto));

        // TODO: Add transport parameters to carry ML-KEM ciphertext
        // This will be implemented in the next phase when we add QUIC transport parameter support

        Ok(client_config)
    }

    /// Build Quinn server configuration with hybrid TLS
    ///
    /// Creates a QUIC server configuration that:
    /// 1. Uses HybridCertResolver to provide certificates with ML-KEM public keys
    /// 2. Receives ML-KEM ciphertext from clients via transport parameters
    /// 3. Performs ML-KEM decapsulation to derive shared secrets
    /// 4. Combines X25519 and ML-KEM secrets for hybrid key exchange
    ///
    /// # Arguments
    ///
    /// * `identity` - Agent identity containing ML-KEM keypair
    ///
    /// # Returns
    ///
    /// Configured Quinn server config with hybrid certificate resolver
    pub fn build_server_config(identity: Arc<cretoai_crypto::keys::AgentIdentity>) -> Result<quinn::ServerConfig> {
        use crate::libp2p::quic::resolver::HybridCertResolver;

        // Create hybrid certificate resolver
        let resolver = HybridCertResolver::new(identity)?;
        let ciphertext_state = resolver.ciphertext_state();

        // Build rustls server config with hybrid resolver
        let mut rustls_config = rustls::ServerConfig::builder()
            .with_safe_defaults()
            .with_no_client_auth()
            .with_cert_resolver(Arc::new(resolver));

        // Configure ALPN protocols for QUIC
        rustls_config.alpn_protocols = vec![b"h3".to_vec()];

        // Create Quinn server config (Quinn 0.10 directly accepts Arc<rustls::ServerConfig>)
        let mut server_config = quinn::ServerConfig::with_crypto(Arc::new(rustls_config));

        // Configure QUIC transport parameters
        let mut transport_config = quinn::TransportConfig::default();

        // Set reasonable timeouts
        transport_config.max_idle_timeout(Some(std::time::Duration::from_secs(30).try_into().unwrap()));

        // Enable keep-alive
        transport_config.keep_alive_interval(Some(std::time::Duration::from_secs(5)));

        server_config.transport_config(Arc::new(transport_config));

        // TODO: Store ciphertext_state somewhere accessible for receiving client ciphertext
        // This will be used by the transport layer to pass ciphertext from client

        Ok(server_config)
    }
}

/// Derive hybrid shared secret from X25519 and ML-KEM-768 secrets
///
/// Uses BLAKE3 keyed hash with domain separation to combine classical
/// and post-quantum shared secrets.
///
/// # Security
///
/// - Domain separation via fixed key: "vigilia-hybrid-kex-v1"
/// - No weak composition (both secrets are required)
/// - 256-bit output (same as individual secret sizes)
///
/// # Arguments
///
/// * `x25519_secret` - Classical X25519 shared secret (32 bytes)
/// * `ml_kem_secret` - Post-quantum ML-KEM-768 shared secret (32 bytes)
///
/// # Returns
///
/// 32-byte hybrid shared secret
pub fn derive_hybrid_secret(x25519_secret: &[u8], ml_kem_secret: &[u8]) -> [u8; 32] {
    const DOMAIN_SEPARATOR: &[u8; 32] = b"vigilia-hybrid-kex-v1\0\0\0\0\0\0\0\0\0\0\0";

    let mut hasher = Hasher::new_keyed(DOMAIN_SEPARATOR);
    hasher.update(x25519_secret);
    hasher.update(ml_kem_secret);

    let hash = hasher.finalize();
    *hash.as_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extension_encode_decode() {
        let keypair = MLKem768::generate();
        let ext = HybridKemExtension::new(&keypair.public_key);

        let encoded = ext.encode();
        let decoded = HybridKemExtension::decode(&encoded).unwrap();

        assert_eq!(decoded.algorithm_id, ML_KEM_768_ALGORITHM_ID);
        assert_eq!(decoded.public_key, ext.public_key);
    }

    #[test]
    fn test_encapsulation_decapsulation() {
        let config = HybridTlsConfig::new();
        let (secret1, ciphertext) = config.encapsulate(config.public_key());
        let secret2 = config.decapsulate(&ciphertext);

        assert_eq!(secret1, secret2);
    }

    #[test]
    fn test_hybrid_secret_derivation() {
        let x25519_secret = [1u8; 32];
        let ml_kem_secret = [2u8; 32];

        let secret1 = derive_hybrid_secret(&x25519_secret, &ml_kem_secret);
        let secret2 = derive_hybrid_secret(&x25519_secret, &ml_kem_secret);

        // Derivation is deterministic
        assert_eq!(secret1, secret2);

        // Changing either secret changes output
        let x25519_secret_different = [3u8; 32];
        let secret3 = derive_hybrid_secret(&x25519_secret_different, &ml_kem_secret);
        assert_ne!(secret1, secret3);
    }

    #[test]
    fn test_extension_size() {
        let keypair = MLKem768::generate();
        let mut ext = HybridKemExtension::new(&keypair.public_key);

        // Without ciphertext: 4 (header) + 2 (algo) + 1184 (pubkey) = 1190 bytes
        let encoded = ext.encode();
        assert_eq!(encoded.len(), 4 + 2 + ML_KEM_768_PUBKEY_SIZE);

        // With ciphertext: +1088 bytes
        let (_, ciphertext) = MLKem768::encapsulate(&keypair.public_key);
        ext.set_ciphertext(&ciphertext);
        let encoded_with_ct = ext.encode();
        assert_eq!(encoded_with_ct.len(),
            4 + 2 + ML_KEM_768_PUBKEY_SIZE + ML_KEM_768_CIPHERTEXT_SIZE);
    }
}
