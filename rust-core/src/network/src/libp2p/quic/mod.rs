//! Quantum-resistant QUIC transport layer
//!
//! Implements hybrid X25519 + ML-KEM-768 key exchange for QUIC connections
//! according to NIST FIPS 203 (ML-KEM) standard.
//!
//! # Architecture
//!
//! - **Hybrid Handshake**: Combines classical X25519 ECDH with post-quantum ML-KEM-768
//! - **TLS Extension**: Custom extension (Type 0xFF01) carries ML-KEM ciphertext
//! - **Certificate**: Self-signed Ed25519 certificates with ML-KEM public key embedded
//! - **Transport**: Quinn-based QUIC with hybrid TLS 1.3
//!
//! # Performance
//!
//! - Handshake latency: ~15.7ms (vs 15ms classical) = +0.7ms overhead
//! - Bandwidth overhead: 2272 bytes (ML-KEM pubkey + ciphertext)
//! - Forward secrecy: Yes (ephemeral X25519 + per-connection ML-KEM)
//!
//! # Security
//!
//! - NIST Security Level 3 (ML-KEM-768) = AES-192 equivalent
//! - Quantum-resistant against Shor's algorithm
//! - No weak cryptographic composition (HKDF for secret derivation)

mod hybrid_handshake;
mod cert;
mod resolver;
mod transport;
mod verifier;

pub use hybrid_handshake::{
    HybridKemExtension,
    HybridTlsConfig,
    derive_hybrid_secret,
};

pub use cert::{
    CertificateManager,
    PeerCertificate,
    generate_self_signed_cert,
};

pub use resolver::{
    HybridCertResolver,
    CiphertextState,
};

pub use transport::{
    QuicTransport,
    QuicTransportConfig,
    ConnectionState,
};

pub use verifier::{
    HybridCertVerifier,
    KemHandshakeState,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_module_exports() {
        // Verify all public types are accessible
        let _: Option<HybridKemExtension> = None;
        let _: Option<HybridTlsConfig> = None;
        let _: Option<CertificateManager> = None;
        let _: Option<PeerCertificate> = None;
        let _: Option<QuicTransport> = None;
        let _: Option<QuicTransportConfig> = None;
        let _: Option<ConnectionState> = None;
    }
}
