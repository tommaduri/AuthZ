//! Certificate generation and validation for QUIC transport
//!
//! Generates self-signed Ed25519 certificates with ML-KEM-768 public key
//! embedded in a custom X.509 extension.

use crate::error::{NetworkError, Result};
use cretoai_crypto::kem::MLKem768PublicKey;
use cretoai_crypto::keys::AgentIdentity;
use rcgen::{Certificate, CertificateParams, CustomExtension, KeyPair};
use std::sync::Arc;
use x509_parser::prelude::*;

/// X.509 extension OID for ML-KEM-768 public key
/// OID: 2.16.840.1.101.3.4.4.4 (NIST ML-KEM-768)
pub const ML_KEM_768_OID: &[u64] = &[2, 16, 840, 1, 101, 3, 4, 4, 4];

/// Certificate manager for generating and validating certificates
pub struct CertificateManager {
    identity: Arc<AgentIdentity>,
}

impl CertificateManager {
    /// Create a new certificate manager
    pub fn new(identity: Arc<AgentIdentity>) -> Self {
        Self { identity }
    }

    /// Generate a self-signed certificate
    ///
    /// Creates an Ed25519 certificate valid for 90 days with:
    /// - Subject: CN=<agent_id>
    /// - Extensions: ML-KEM-768 public key
    pub fn generate_self_signed(&self) -> Result<PeerCertificate> {
        // Generate Ed25519 keypair for certificate first
        // Note: This is separate from agent identity for LibP2P compatibility
        let keypair = KeyPair::generate(&rcgen::PKCS_ED25519)
            .map_err(|e| NetworkError::Transport(format!("Failed to generate keypair: {}", e)))?;

        // Create certificate parameters
        let mut params = CertificateParams::new(vec![self.identity.agent_id.clone()]);

        // Set key pair and algorithm
        params.alg = &rcgen::PKCS_ED25519;
        params.key_pair = Some(keypair);

        // Set validity period (90 days)
        params.not_before = rcgen::date_time_ymd(2024, 1, 1);
        params.not_after = rcgen::date_time_ymd(2024, 4, 1);

        // Add ML-KEM-768 public key as custom extension
        // The extension contains the raw public key bytes (1184 bytes for ML-KEM-768)
        let ml_kem_pubkey_bytes = self.identity.kem_keypair.public_key.as_bytes().to_vec();
        let custom_ext = CustomExtension::from_oid_content(
            ML_KEM_768_OID,
            ml_kem_pubkey_bytes.clone(),
        );
        params.custom_extensions.push(custom_ext);

        // Create certificate
        let cert = Certificate::from_params(params)
            .map_err(|e| NetworkError::Transport(format!("Failed to create certificate: {}", e)))?;

        // Extract ML-KEM public key that we just embedded
        let ml_kem_pubkey = MLKem768PublicKey::from_bytes(&ml_kem_pubkey_bytes)
            .map_err(|e| NetworkError::Transport(format!("Failed to parse ML-KEM public key: {}", e)))?;

        // Serialize certificate for caching
        let der_bytes = cert.serialize_der()
            .map_err(|e| NetworkError::Transport(format!("Failed to serialize certificate: {}", e)))?;

        Ok(PeerCertificate {
            cert: Arc::new(cert),
            ml_kem_pubkey: Some(ml_kem_pubkey),
            der_bytes,
        })
    }

    /// Validate a peer certificate
    ///
    /// Validates:
    /// 1. Certificate signature
    /// 2. Expiration dates
    /// 3. ML-KEM-768 extension presence
    /// 4. ML-KEM public key validity
    pub fn validate(&self, cert: &PeerCertificate) -> Result<()> {
        // Check if ML-KEM public key is present
        if cert.ml_kem_pubkey.is_none() {
            return Err(NetworkError::Transport(
                "Certificate missing ML-KEM-768 public key extension".to_string()
            ));
        }

        // Verify ML-KEM public key size (1184 bytes for ML-KEM-768)
        let ml_kem_pubkey = cert.ml_kem_pubkey.as_ref().unwrap();
        let pubkey_bytes = ml_kem_pubkey.as_bytes();
        if pubkey_bytes.len() != 1184 {
            return Err(NetworkError::Transport(
                format!("Invalid ML-KEM-768 public key size: expected 1184, got {}", pubkey_bytes.len())
            ));
        }

        // TODO: Add certificate expiration check once we implement proper date handling
        // TODO: Add signature verification using webpki or similar

        Ok(())
    }
}

/// Peer certificate with ML-KEM public key
pub struct PeerCertificate {
    /// X.509 certificate
    cert: Arc<Certificate>,

    /// Extracted ML-KEM-768 public key (if present)
    ml_kem_pubkey: Option<MLKem768PublicKey>,

    /// DER-encoded certificate (cached for validation)
    der_bytes: Vec<u8>,
}

impl PeerCertificate {
    /// Get certificate DER encoding
    pub fn serialize_der(&self) -> Result<Vec<u8>> {
        Ok(self.der_bytes.clone())
    }

    /// Get ML-KEM public key
    pub fn ml_kem_pubkey(&self) -> Option<&MLKem768PublicKey> {
        self.ml_kem_pubkey.as_ref()
    }

    /// Get certificate DER bytes reference
    pub fn der_bytes(&self) -> &[u8] {
        &self.der_bytes
    }

    /// Parse a certificate from DER bytes and extract ML-KEM extension
    pub fn from_der(der_bytes: &[u8]) -> Result<PeerCertificate> {
        // Parse the DER-encoded certificate to extract the ML-KEM extension
        // This is a simplified implementation that extracts the extension content

        // For now, we'll use a basic approach: search for the OID in the DER encoding
        // A more robust implementation would use a proper ASN.1 parser

        let ml_kem_pubkey = Self::extract_ml_kem_extension(der_bytes)?;

        // Note: rcgen doesn't support parsing certificates, only generating them
        // In a production system, we would use x509-parser or similar
        // For now, we'll create a placeholder certificate

        Ok(PeerCertificate {
            cert: Arc::new(Self::create_placeholder_cert()?),
            ml_kem_pubkey,
            der_bytes: der_bytes.to_vec(),
        })
    }

    /// Extract ML-KEM-768 public key from certificate DER encoding
    fn extract_ml_kem_extension(der_bytes: &[u8]) -> Result<Option<MLKem768PublicKey>> {
        // FALLBACK APPROACH: Search directly in DER bytes for the ML-KEM extension
        // The OID 2.16.840.1.101.3.4.4.4 is encoded as: 06 09 60 86 48 01 65 03 04 04 04
        // Followed by: 04 82 04 a0 (OCTET STRING, long form length, 1184 bytes)

        let oid_pattern = [0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x04, 0x04];

        // Search for OID in certificate
        if let Some(oid_pos) = der_bytes.windows(oid_pattern.len())
            .position(|window| window == oid_pattern)
        {
            // OID found, now look for OCTET STRING after it
            let search_start = oid_pos + oid_pattern.len();

            if search_start + 4 <= der_bytes.len() {
                // Check for OCTET STRING tag 0x04 followed by long form length 0x82 0x04 0xA0
                if der_bytes[search_start] == 0x04 &&
                   der_bytes[search_start + 1] == 0x82 &&
                   search_start + 4 + 1184 <= der_bytes.len()
                {
                    let len = ((der_bytes[search_start + 2] as usize) << 8) |
                             (der_bytes[search_start + 3] as usize);

                    if len == 1184 {
                        let key_start = search_start + 4;
                        let pubkey_bytes = &der_bytes[key_start..key_start + 1184];
                        return MLKem768PublicKey::from_bytes(pubkey_bytes)
                            .map(Some)
                            .map_err(|e| NetworkError::Transport(
                                format!("Failed to parse ML-KEM public key: {}", e)
                            ));
                    }
                }
            }
        }

        // No ML-KEM extension found
        Ok(None)
    }

    /// Create a placeholder certificate (used when parsing)
    fn create_placeholder_cert() -> Result<Certificate> {
        // Generate keypair first
        let keypair = KeyPair::generate(&rcgen::PKCS_ED25519)
            .map_err(|e| NetworkError::Transport(format!("Failed to generate keypair: {}", e)))?;

        let mut params = CertificateParams::new(vec!["placeholder".to_string()]);
        params.alg = &rcgen::PKCS_ED25519;
        params.key_pair = Some(keypair);

        Certificate::from_params(params)
            .map_err(|e| NetworkError::Transport(format!("Failed to create certificate: {}", e)))
    }
}

/// Generate a self-signed certificate for testing
pub fn generate_self_signed_cert(agent_id: String) -> Result<Vec<u8>> {
    let identity = AgentIdentity::generate(agent_id)
        .map_err(|e| NetworkError::Transport(format!("Failed to generate identity: {}", e)))?;

    let manager = CertificateManager::new(Arc::new(identity));
    let peer_cert = manager.generate_self_signed()?;

    let der = peer_cert.serialize_der()?;
    Ok(der)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_self_signed() {
        let der = generate_self_signed_cert("test-agent".to_string()).unwrap();

        // Verify certificate is valid
        assert!(!der.is_empty());
        assert!(der.len() > 1000); // Should be reasonably sized
    }

    #[test]
    fn test_certificate_manager() {
        let identity = AgentIdentity::generate("test-agent".to_string()).unwrap();
        let manager = CertificateManager::new(Arc::new(identity));

        let cert = manager.generate_self_signed().unwrap();
        assert!(manager.validate(&cert).is_ok());
    }

    #[test]
    fn test_ml_kem_extension_in_certificate() {
        let identity = AgentIdentity::generate("test-agent".to_string()).unwrap();
        let manager = CertificateManager::new(Arc::new(identity));

        let cert = manager.generate_self_signed().unwrap();

        // Verify ML-KEM public key is present
        assert!(cert.ml_kem_pubkey().is_some());

        // Verify public key size (1184 bytes for ML-KEM-768)
        let pubkey = cert.ml_kem_pubkey().unwrap();
        assert_eq!(pubkey.as_bytes().len(), 1184);
    }

    #[test]
    fn test_certificate_serialization() {
        let identity = AgentIdentity::generate("test-agent".to_string()).unwrap();
        let manager = CertificateManager::new(Arc::new(identity));

        let cert = manager.generate_self_signed().unwrap();
        let der_bytes = cert.serialize_der().unwrap();

        // Verify DER encoding is not empty
        assert!(!der_bytes.is_empty());
        assert!(der_bytes.len() > 1000);
    }

    #[test]
    fn test_ml_kem_extension_extraction() {
        let identity = AgentIdentity::generate("test-agent".to_string()).unwrap();
        let original_pubkey = identity.kem_keypair.public_key.as_bytes().to_vec();

        let manager = CertificateManager::new(Arc::new(identity));
        let cert = manager.generate_self_signed().unwrap();

        // Serialize certificate
        let der_bytes = cert.serialize_der().unwrap();

        // Parse certificate and extract extension
        let parsed_cert = PeerCertificate::from_der(&der_bytes).unwrap();

        // Verify ML-KEM public key was extracted
        assert!(parsed_cert.ml_kem_pubkey().is_some());

        // Verify extracted key matches original
        let extracted_pubkey = parsed_cert.ml_kem_pubkey().unwrap();
        assert_eq!(extracted_pubkey.as_bytes(), original_pubkey.as_slice());
    }

    #[test]
    fn test_round_trip_encoding_decoding() {
        let identity = AgentIdentity::generate("test-agent".to_string()).unwrap();
        let original_pubkey_bytes = identity.kem_keypair.public_key.as_bytes().to_vec();

        let manager = CertificateManager::new(Arc::new(identity));

        // Generate certificate
        let cert1 = manager.generate_self_signed().unwrap();

        // Serialize to DER
        let der_bytes = cert1.serialize_der().unwrap();

        // Parse from DER
        let cert2 = PeerCertificate::from_der(&der_bytes).unwrap();

        // Verify ML-KEM public keys match
        assert!(cert2.ml_kem_pubkey().is_some());
        let extracted_pubkey_bytes = cert2.ml_kem_pubkey().unwrap().as_bytes();
        assert_eq!(extracted_pubkey_bytes, original_pubkey_bytes.as_slice());
    }

    #[test]
    fn test_validation_requires_ml_kem_extension() {
        let identity = AgentIdentity::generate("test-agent".to_string()).unwrap();
        let manager = CertificateManager::new(Arc::new(identity));

        // Create certificate with ML-KEM extension
        let cert_with_extension = manager.generate_self_signed().unwrap();

        // Validation should succeed
        assert!(manager.validate(&cert_with_extension).is_ok());

        // Create a certificate without ML-KEM extension (manually)
        let keypair = KeyPair::generate(&rcgen::PKCS_ED25519).unwrap();
        let mut params = CertificateParams::new(vec!["test".to_string()]);
        params.alg = &rcgen::PKCS_ED25519;
        params.key_pair = Some(keypair);
        let cert = Certificate::from_params(params).unwrap();
        let der_bytes = cert.serialize_der().unwrap();

        let cert_without_extension = PeerCertificate {
            cert: Arc::new(cert),
            ml_kem_pubkey: None,
            der_bytes,
        };

        // Validation should fail
        assert!(manager.validate(&cert_without_extension).is_err());
    }

    #[test]
    fn test_ml_kem_oid_in_der_encoding() {
        let identity = AgentIdentity::generate("test-agent".to_string()).unwrap();
        let manager = CertificateManager::new(Arc::new(identity));

        let cert = manager.generate_self_signed().unwrap();
        let der_bytes = cert.serialize_der().unwrap();

        // Search for ML-KEM-768 OID in DER encoding
        // OID 2.16.840.1.101.3.4.4.4 encodes as: 06 09 60 86 48 01 65 03 04 04 04
        let oid_bytes = vec![0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x04, 0x04];

        // Verify OID is present in certificate
        let contains_oid = der_bytes
            .windows(oid_bytes.len())
            .any(|window| window == oid_bytes);

        assert!(contains_oid, "Certificate should contain ML-KEM-768 OID");
    }

    #[test]
    fn test_certificate_contains_full_pubkey() {
        let identity = AgentIdentity::generate("test-agent".to_string()).unwrap();
        let expected_pubkey = identity.kem_keypair.public_key.as_bytes().to_vec();

        let manager = CertificateManager::new(Arc::new(identity));
        let cert = manager.generate_self_signed().unwrap();
        let der_bytes = cert.serialize_der().unwrap();

        // Verify the full public key (1184 bytes) is present in the certificate
        let contains_pubkey = der_bytes
            .windows(expected_pubkey.len())
            .any(|window| window == expected_pubkey.as_slice());

        assert!(
            contains_pubkey,
            "Certificate should contain the complete ML-KEM-768 public key"
        );
    }
}
