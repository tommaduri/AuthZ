# Phase 2: Quinn-Rustls Integration Architecture
## Custom TLS Extension for ML-KEM-768 Hybrid Handshake

**Version:** 1.0
**Date:** 2025-11-27
**Target Versions:** Quinn 0.11.9, rustls 0.23.35, rcgen 0.11
**Status:** Architecture Design Phase

---

## Executive Summary

This document provides the detailed architecture for integrating custom TLS extensions (Type 0xFF01) carrying ML-KEM-768 ciphertext into Quinn QUIC connections using rustls. **Critical finding:** rustls 0.23 does not provide public APIs for custom TLS extensions, requiring an alternative approach using certificate-based key transport.

### Key Design Decision

**PRIMARY APPROACH:** Use X.509 certificate extensions (via rcgen 0.11) to transport ML-KEM-768 public keys, and implement custom certificate verifiers (via rustls danger API) to perform hybrid key exchange during TLS handshake.

**RATIONALE:**
- rustls does not support custom TLS handshake extensions
- Certificate extensions are fully supported via rcgen CustomExtension API
- Certificate verifiers provide necessary hooks into handshake process
- Maintains compatibility with standard TLS 1.3 handshake flow

---

## 1. Current Implementation Analysis

### 1.1 Existing Code Structure

**File: `/Users/tommaduri/vigilia/src/network/src/libp2p/quic/hybrid_handshake.rs`**
- ✅ TLS extension encoding/decoding (lines 43-142)
- ✅ Hybrid secret derivation using BLAKE3 (lines 226-235)
- ✅ ML-KEM-768 encapsulation/decapsulation (lines 165-177)
- ❌ Quinn client config builder (lines 180-192) - TODO
- ❌ Quinn server config builder (lines 195-204) - TODO

**File: `/Users/tommaduri/vigilia/src/network/src/libp2p/quic/cert.rs`**
- ✅ Certificate manager structure (lines 18-26)
- ✅ Self-signed certificate generation skeleton (lines 33-61)
- ❌ ML-KEM-768 X.509 extension embedding (lines 42-46) - TODO
- ❌ Certificate validation (lines 64-72) - TODO

**File: `/Users/tommaduri/vigilia/src/network/src/libp2p/quic/transport.rs`**
- ✅ Transport configuration (lines 12-47)
- ✅ Transport structure with hybrid TLS (lines 59-88)
- ❌ Quinn endpoint creation (lines 91-99) - TODO
- ❌ Connection establishment (lines 102-110) - TODO

### 1.2 Available Dependencies

From `/Users/tommaduri/vigilia/Cargo.toml`:
- `quinn = "0.10"` ⚠️ **NEEDS UPGRADE to 0.11.9**
- `rustls = "0.21"` ⚠️ **NEEDS UPGRADE to 0.23.35**
- `rcgen = "0.11"` ✅
- `webpki = "0.22"` ✅
- `ring = "0.17"` ✅
- `blake3 = "1.5"` ✅

---

## 2. Architecture Overview

### 2.1 System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                     Quinn QUIC Transport                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐           ┌──────────────┐                    │
│  │   Quinn      │           │   Quinn      │                    │
│  │ ClientConfig │◄──────────┤ ServerConfig │                    │
│  └──────┬───────┘           └──────┬───────┘                    │
│         │                          │                             │
│         │ uses                     │ uses                        │
│         ▼                          ▼                             │
│  ┌──────────────┐           ┌──────────────┐                    │
│  │   rustls     │           │   rustls     │                    │
│  │ ClientConfig │           │ ServerConfig │                    │
│  └──────┬───────┘           └──────┬───────┘                    │
│         │                          │                             │
│         │ with                     │ with                        │
│         ▼                          ▼                             │
│  ┌──────────────────────┐   ┌──────────────────────┐           │
│  │  Custom Cert         │   │  Custom Cert         │           │
│  │  Verifier            │   │  Resolver            │           │
│  │  (ServerCertVerifier)│   │  (ResolvesServerCert)│           │
│  └──────┬───────────────┘   └──────┬───────────────┘           │
│         │                          │                             │
│         │ extracts ML-KEM          │ embeds ML-KEM               │
│         │ from cert                │ in cert                     │
│         ▼                          ▼                             │
│  ┌──────────────────────────────────────────────────┐           │
│  │         X.509 Certificate (rcgen)                 │           │
│  │  ┌────────────────────────────────────────────┐  │           │
│  │  │ Standard Fields: CN, validity, signature   │  │           │
│  │  ├────────────────────────────────────────────┤  │           │
│  │  │ Custom Extension (OID 2.16.840.1.101.3.4.4)│  │           │
│  │  │  - ML-KEM-768 Public Key (1184 bytes)     │  │           │
│  │  └────────────────────────────────────────────┘  │           │
│  └──────────────────────────────────────────────────┘           │
│                                                                   │
│  ┌──────────────────────────────────────────────────┐           │
│  │         Hybrid Key Exchange                       │           │
│  │  ┌────────────────────────────────────────────┐  │           │
│  │  │ 1. X25519 ECDH (via standard TLS 1.3)     │  │           │
│  │  │ 2. ML-KEM-768 Encap/Decap (via verifier)  │  │           │
│  │  │ 3. BLAKE3 hybrid secret derivation        │  │           │
│  │  └────────────────────────────────────────────┘  │           │
│  └──────────────────────────────────────────────────┘           │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

```
CLIENT                                              SERVER
  │                                                   │
  │ ────────── ClientHello ─────────────────────────>│
  │            (Standard TLS 1.3)                     │
  │                                                   │
  │ <───────── ServerHello + Certificate ────────────│
  │            Certificate contains:                  │
  │            - Standard Ed25519 signature           │
  │            - Custom Extension:                    │
  │              OID: 2.16.840.1.101.3.4.4.4          │
  │              Content: ML-KEM-768 PubKey (1184B)   │
  │                                                   │
  │ [Custom Cert Verifier Triggered]                 │
  │  1. Validate certificate signature                │
  │  2. Extract ML-KEM-768 public key                 │
  │  3. Perform ML-KEM encapsulation                  │
  │  4. Store ciphertext in thread-local              │
  │                                                   │
  │ ────────── CertificateVerify ───────────────────>│
  │            (Includes ML-KEM ciphertext            │
  │             in application data)                  │
  │                                                   │
  │                                                   │ [Custom Cert Resolver]
  │                                                   │  1. Load certificate
  │                                                   │  2. Receive ciphertext
  │                                                   │  3. Perform decapsulation
  │                                                   │
  │ <───────── Finished ─────────────────────────────│
  │                                                   │
  │ [Both sides derive hybrid secret]                │
  │  BLAKE3(X25519_secret || ML-KEM-768_secret)      │
  │                                                   │
  │ ═══════════ Encrypted Application Data ══════════│
  │            (Protected by hybrid secret)           │
  │                                                   │
```

---

## 3. Detailed Component Design

### 3.1 Certificate Extensions (rcgen 0.11)

#### 3.1.1 X.509 Extension Format

**OID:** `2.16.840.1.101.3.4.4.4` (NIST ML-KEM-768, custom assignment)

**ASN.1 Structure:**
```asn1
MLKem768Extension ::= SEQUENCE {
    algorithm     OBJECT IDENTIFIER,  -- 2.16.840.1.101.3.4.4.4
    publicKey     OCTET STRING        -- 1184 bytes
}
```

**DER Encoding:**
```
SEQUENCE (tag 0x30)
  ├─ OBJECT IDENTIFIER (tag 0x06)
  │   └─ 2.16.840.1.101.3.4.4.4
  └─ OCTET STRING (tag 0x04)
      └─ [1184 bytes of ML-KEM-768 public key]
```

#### 3.1.2 Implementation with rcgen

**File:** `src/network/src/libp2p/quic/cert.rs`

```rust
use rcgen::{CustomExtension, Certificate, CertificateParams};

/// ML-KEM-768 OID components: 2.16.840.1.101.3.4.4.4
pub const ML_KEM_768_OID_COMPONENTS: &[u64] = &[2, 16, 840, 1, 101, 3, 4, 4, 4];

impl CertificateManager {
    pub fn generate_self_signed(&self) -> Result<PeerCertificate> {
        let mut params = CertificateParams::new(vec![self.identity.agent_id.clone()]);

        // Set validity period (90 days)
        params.not_before = rcgen::date_time_ymd(2024, 1, 1);
        params.not_after = rcgen::date_time_ymd(2024, 4, 1);

        // Create custom extension with ML-KEM-768 public key
        let ml_kem_extension = CustomExtension::from_oid_content(
            ML_KEM_768_OID_COMPONENTS,
            self.identity.kem_keypair.public_key.as_bytes().to_vec()
        );

        params.custom_extensions.push(ml_kem_extension);

        // Generate Ed25519 keypair for certificate signature
        let keypair = KeyPair::generate(&rcgen::PKCS_ED25519)
            .map_err(|e| NetworkError::Transport(format!("Keypair gen failed: {}", e)))?;

        params.key_pair = Some(keypair);

        // Create certificate
        let cert = Certificate::from_params(params)
            .map_err(|e| NetworkError::Transport(format!("Cert creation failed: {}", e)))?;

        Ok(PeerCertificate {
            cert: Arc::new(cert),
            ml_kem_pubkey: Some(self.identity.kem_keypair.public_key.clone()),
        })
    }
}
```

### 3.2 Custom Certificate Verifier (rustls ClientConfig)

#### 3.2.1 ServerCertVerifier Trait

**Trait Definition (rustls 0.23.35):**
```rust
pub trait ServerCertVerifier: Send + Sync {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, Error>;

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error>;

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error>;

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme>;
}
```

#### 3.2.2 Implementation Strategy

**File:** `src/network/src/libp2p/quic/verifier.rs` (NEW FILE)

```rust
use rustls::client::danger::{ServerCertVerifier, HandshakeSignatureValid};
use rustls::{SignatureScheme, Error, CertificateDer, DigitallySignedStruct};
use rustls::pki_types::{ServerName, UnixTime};
use vigilia_crypto::kem::{MLKem768, MLKem768PublicKey, MLKem768Ciphertext};
use std::sync::{Arc, Mutex};

/// Hybrid certificate verifier that extracts ML-KEM-768 public keys
/// and performs encapsulation during certificate verification
pub struct HybridCertVerifier {
    /// Underlying webpki verifier for standard validation
    inner: Arc<dyn ServerCertVerifier>,

    /// Storage for ML-KEM ciphertext (shared with connection handler)
    ciphertext_storage: Arc<Mutex<Option<MLKem768Ciphertext>>>,

    /// Storage for ML-KEM shared secret (shared with key derivation)
    shared_secret_storage: Arc<Mutex<Option<[u8; 32]>>>,
}

impl HybridCertVerifier {
    pub fn new(
        inner: Arc<dyn ServerCertVerifier>,
        ciphertext_storage: Arc<Mutex<Option<MLKem768Ciphertext>>>,
        shared_secret_storage: Arc<Mutex<Option<[u8; 32]>>>,
    ) -> Self {
        Self {
            inner,
            ciphertext_storage,
            shared_secret_storage,
        }
    }

    /// Extract ML-KEM-768 public key from certificate extension
    fn extract_ml_kem_pubkey(&self, cert_der: &[u8]) -> Result<MLKem768PublicKey, Error> {
        // Parse DER-encoded certificate
        let cert = x509_parser::parse_x509_certificate(cert_der)
            .map_err(|_| Error::InvalidCertificate(
                CertificateError::BadEncoding
            ))?
            .1;

        // Find ML-KEM-768 extension
        let extension = cert.extensions()
            .iter()
            .find(|ext| {
                // OID: 2.16.840.1.101.3.4.4.4
                ext.oid.to_string() == "2.16.840.1.101.3.4.4.4"
            })
            .ok_or(Error::InvalidCertificate(
                CertificateError::Other("ML-KEM extension not found".into())
            ))?;

        // Verify extension content size
        if extension.value.len() != 1184 {
            return Err(Error::InvalidCertificate(
                CertificateError::Other("Invalid ML-KEM public key size".into())
            ));
        }

        // Construct ML-KEM public key
        MLKem768PublicKey::from_bytes(extension.value)
            .map_err(|_| Error::InvalidCertificate(
                CertificateError::Other("Invalid ML-KEM public key".into())
            ))
    }
}

impl ServerCertVerifier for HybridCertVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, Error> {
        // 1. Perform standard certificate validation
        self.inner.verify_server_cert(
            end_entity,
            intermediates,
            server_name,
            ocsp_response,
            now,
        )?;

        // 2. Extract ML-KEM-768 public key from certificate
        let ml_kem_pubkey = self.extract_ml_kem_pubkey(end_entity.as_ref())?;

        // 3. Perform ML-KEM-768 encapsulation
        let (shared_secret, ciphertext) = MLKem768::encapsulate(&ml_kem_pubkey);

        // 4. Store ciphertext for transmission
        *self.ciphertext_storage.lock().unwrap() = Some(ciphertext);

        // 5. Store shared secret for hybrid derivation
        *self.shared_secret_storage.lock().unwrap() = Some(*shared_secret.as_bytes());

        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        self.inner.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        self.inner.verify_tls13_signature(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.inner.supported_verify_schemes()
    }
}
```

### 3.3 Custom Certificate Resolver (rustls ServerConfig)

#### 3.3.1 ResolvesServerCert Trait

**Trait Definition (rustls 0.23.35):**
```rust
pub trait ResolvesServerCert: Send + Sync {
    fn resolve(
        &self,
        client_hello: ClientHello<'_>,
    ) -> Option<Arc<CertifiedKey>>;
}
```

#### 3.3.2 Implementation Strategy

**File:** `src/network/src/libp2p/quic/resolver.rs` (NEW FILE)

```rust
use rustls::server::{ResolvesServerCert, ClientHello};
use rustls::sign::CertifiedKey;
use vigilia_crypto::kem::{MLKem768, MLKem768KeyPair, MLKem768Ciphertext};
use std::sync::{Arc, Mutex};

/// Hybrid certificate resolver that provides certificates with ML-KEM-768 keys
/// and performs decapsulation when receiving ciphertext
pub struct HybridCertResolver {
    /// Pre-generated certificate with ML-KEM-768 extension
    certified_key: Arc<CertifiedKey>,

    /// ML-KEM-768 keypair for decapsulation
    kem_keypair: Arc<MLKem768KeyPair>,

    /// Storage for received ciphertext (from client)
    ciphertext_storage: Arc<Mutex<Option<MLKem768Ciphertext>>>,

    /// Storage for ML-KEM shared secret (for hybrid derivation)
    shared_secret_storage: Arc<Mutex<Option<[u8; 32]>>>,
}

impl HybridCertResolver {
    pub fn new(
        certified_key: Arc<CertifiedKey>,
        kem_keypair: Arc<MLKem768KeyPair>,
        ciphertext_storage: Arc<Mutex<Option<MLKem768Ciphertext>>>,
        shared_secret_storage: Arc<Mutex<Option<[u8; 32]>>>,
    ) -> Self {
        Self {
            certified_key,
            kem_keypair,
            ciphertext_storage,
            shared_secret_storage,
        }
    }

    /// Process received ML-KEM ciphertext and perform decapsulation
    pub fn process_ciphertext(&self, ciphertext: &MLKem768Ciphertext) -> Result<(), Error> {
        // 1. Perform ML-KEM-768 decapsulation
        let shared_secret = MLKem768::decapsulate(ciphertext, &self.kem_keypair.secret_key);

        // 2. Store shared secret for hybrid derivation
        *self.shared_secret_storage.lock().unwrap() = Some(*shared_secret.as_bytes());

        Ok(())
    }
}

impl ResolvesServerCert for HybridCertResolver {
    fn resolve(
        &self,
        client_hello: ClientHello<'_>,
    ) -> Option<Arc<CertifiedKey>> {
        // Return pre-generated certificate with ML-KEM extension
        Some(self.certified_key.clone())
    }
}
```

### 3.4 Quinn Configuration Builders

#### 3.4.1 Client Configuration

**File:** `src/network/src/libp2p/quic/hybrid_handshake.rs`

```rust
impl HybridTlsConfig {
    pub fn build_client_config(
        &self,
        server_name: String,
    ) -> Result<quinn::ClientConfig> {
        // Create storage for ML-KEM ciphertext and shared secret
        let ciphertext_storage = Arc::new(Mutex::new(None));
        let shared_secret_storage = Arc::new(Mutex::new(None));

        // Create root certificate store (for production: add CA certs)
        let mut root_store = rustls::RootCertStore::empty();
        // For testing: accept self-signed certificates
        // root_store.add_parsable_certificates(...)

        // Create standard webpki verifier
        let webpki_verifier = Arc::new(
            rustls::client::WebPkiServerVerifier::builder(Arc::new(root_store))
                .build()
                .map_err(|e| NetworkError::Transport(format!("Verifier build failed: {}", e)))?
        );

        // Wrap with hybrid verifier
        let hybrid_verifier = Arc::new(HybridCertVerifier::new(
            webpki_verifier,
            ciphertext_storage.clone(),
            shared_secret_storage.clone(),
        ));

        // Build rustls client config with TLS 1.3 only
        let crypto = rustls::ClientConfig::builder()
            .with_safe_default_cipher_suites()
            .with_safe_default_kx_groups()
            .with_protocol_versions(&[&rustls::version::TLS13])
            .map_err(|e| NetworkError::Transport(format!("Protocol version failed: {}", e)))?
            .with_custom_certificate_verifier(hybrid_verifier)
            .with_no_client_auth();

        // Build Quinn client config
        let mut client_config = quinn::ClientConfig::new(Arc::new(crypto));

        // Configure transport parameters
        let mut transport = quinn::TransportConfig::default();
        transport.max_idle_timeout(Some(Duration::from_secs(30).try_into().unwrap()));
        transport.keep_alive_interval(Some(Duration::from_secs(5)));

        client_config.transport_config(Arc::new(transport));

        Ok(client_config)
    }
}
```

#### 3.4.2 Server Configuration

**File:** `src/network/src/libp2p/quic/hybrid_handshake.rs`

```rust
impl HybridTlsConfig {
    pub fn build_server_config(&self) -> Result<quinn::ServerConfig> {
        // Create storage for ML-KEM ciphertext and shared secret
        let ciphertext_storage = Arc::new(Mutex::new(None));
        let shared_secret_storage = Arc::new(Mutex::new(None));

        // Generate certificate with ML-KEM extension
        let cert_manager = CertificateManager::new(/* identity */);
        let peer_cert = cert_manager.generate_self_signed()?;

        // Create signing key from certificate
        let key_der = peer_cert.serialize_private_key_der()?;
        let signing_key = rustls::sign::any_supported_type(&key_der)
            .map_err(|e| NetworkError::Transport(format!("Invalid key: {}", e)))?;

        // Create CertifiedKey
        let cert_chain = vec![peer_cert.serialize_der()?];
        let certified_key = Arc::new(rustls::sign::CertifiedKey::new(
            cert_chain.into_iter().map(|c| c.into()).collect(),
            signing_key,
        ));

        // Create hybrid certificate resolver
        let hybrid_resolver = Arc::new(HybridCertResolver::new(
            certified_key,
            Arc::new(self.kem_keypair.clone()),
            ciphertext_storage.clone(),
            shared_secret_storage.clone(),
        ));

        // Build rustls server config with TLS 1.3 only
        let crypto = rustls::ServerConfig::builder()
            .with_safe_default_cipher_suites()
            .with_safe_default_kx_groups()
            .with_protocol_versions(&[&rustls::version::TLS13])
            .map_err(|e| NetworkError::Transport(format!("Protocol version failed: {}", e)))?
            .with_no_client_auth()
            .with_cert_resolver(hybrid_resolver);

        // Build Quinn server config
        let mut server_config = quinn::ServerConfig::with_crypto(Arc::new(crypto));

        // Configure transport parameters
        let mut transport = quinn::TransportConfig::default();
        transport.max_idle_timeout(Some(Duration::from_secs(30).try_into().unwrap()));
        transport.keep_alive_interval(Some(Duration::from_secs(5)));

        server_config.transport_config(Arc::new(transport));

        Ok(server_config)
    }
}
```

### 3.5 ML-KEM Ciphertext Transport

**Challenge:** How to transmit ML-KEM ciphertext from client to server?

#### 3.5.1 Option A: QUIC Application Data (RECOMMENDED)

**Approach:** Send ciphertext as first application message after handshake completes.

**Pros:**
- Clean separation from TLS handshake
- No rustls internals required
- Easy to implement and test

**Cons:**
- Adds one round-trip to handshake
- Ciphertext not available during TLS key derivation

**Implementation:**
```rust
// Client side (after connection established)
let ciphertext = ciphertext_storage.lock().unwrap().take()
    .ok_or(NetworkError::Transport("No ciphertext available".into()))?;

let mut stream = connection.open_bi().await?;
stream.0.write_all(ciphertext.as_bytes()).await?;
stream.0.finish().await?;

// Server side (first message after handshake)
let stream = connection.accept_bi().await?;
let ciphertext_bytes = stream.1.read_to_end(1088).await?;
let ciphertext = MLKem768Ciphertext::from_bytes(&ciphertext_bytes)?;

hybrid_resolver.process_ciphertext(&ciphertext)?;
```

#### 3.5.2 Option B: Session Ticket Extension (FUTURE)

**Approach:** Embed ciphertext in TLS 1.3 session ticket (if 0-RTT is needed).

**Pros:**
- Enables 0-RTT with hybrid security
- No extra round-trip

**Cons:**
- Complex implementation
- Requires rustls internals
- 0-RTT security considerations

**Status:** Future work, not recommended for Phase 2.

---

## 4. Implementation Strategy

### 4.1 Phase-by-Phase Rollout

#### Phase 2A: Certificate Infrastructure (Week 1)
1. Upgrade dependencies (quinn 0.11.9, rustls 0.23.35)
2. Implement X.509 extension generation (cert.rs)
3. Test certificate parsing with rcgen

#### Phase 2B: Custom Verifiers (Week 2)
4. Implement HybridCertVerifier (verifier.rs)
5. Implement HybridCertResolver (resolver.rs)
6. Unit tests for extraction/encapsulation

#### Phase 2C: Quinn Integration (Week 3)
7. Implement build_client_config
8. Implement build_server_config
9. Integrate with transport.rs

#### Phase 2D: Ciphertext Transport (Week 4)
10. Implement application-data ciphertext exchange
11. Integrate with hybrid_handshake.rs
12. End-to-end integration tests

### 4.2 Code Organization

```
src/network/src/libp2p/quic/
├── mod.rs                    # Module exports
├── hybrid_handshake.rs       # Existing: extension encoding, secret derivation
│                             # NEW: Quinn config builders
├── cert.rs                   # Existing: certificate manager
│                             # NEW: X.509 extension implementation
├── verifier.rs               # NEW: HybridCertVerifier
├── resolver.rs               # NEW: HybridCertResolver
├── transport.rs              # Existing: transport structure
│                             # NEW: Quinn endpoint creation
└── tests/
    ├── integration.rs        # End-to-end handshake tests
    ├── cert_test.rs          # Certificate generation tests
    └── verifier_test.rs      # Verifier/resolver tests
```

### 4.3 Testing Strategy

#### Unit Tests
- Certificate generation with ML-KEM extension
- Extension parsing and validation
- Encapsulation/decapsulation in verifier
- Config builder correctness

#### Integration Tests
- Full handshake with hybrid key exchange
- Ciphertext transmission and processing
- Hybrid secret derivation
- Connection establishment

#### Security Tests
- Invalid certificate rejection
- Missing ML-KEM extension handling
- Ciphertext tampering detection
- Replay attack prevention

---

## 5. Alternative Approaches (Evaluated and Rejected)

### 5.1 Fork rustls for Custom Extensions

**Description:** Fork rustls to add custom TLS extension API.

**Pros:**
- Clean protocol-level integration
- No workarounds needed

**Cons:**
- Maintenance burden (tracking upstream changes)
- Incompatible with standard rustls ecosystem
- Complex implementation

**Decision:** ❌ REJECTED - Too high maintenance cost

### 5.2 Use ALPN for Key Transport

**Description:** Encode ML-KEM public key in ALPN protocol identifiers.

**Pros:**
- ALPN is supported by rustls

**Cons:**
- ALPN limited to ~256 bytes (ML-KEM needs 1184 bytes)
- Violates ALPN specification
- Fragile and hacky

**Decision:** ❌ REJECTED - Protocol violation

### 5.3 Use SNI for Key Transport

**Description:** Encode ML-KEM public key in SNI hostname.

**Pros:**
- SNI is available early in handshake

**Cons:**
- SNI limited to 255 bytes
- Violates DNS/SNI specifications
- Creates routing issues

**Decision:** ❌ REJECTED - Protocol violation

### 5.4 Pre-shared Keys (PSK)

**Description:** Use TLS 1.3 PSK with hybrid-derived keys.

**Pros:**
- Supported by rustls
- Clean integration

**Cons:**
- Requires out-of-band key establishment
- Not suitable for first connection
- Incompatible with LibP2P discovery

**Decision:** ❌ REJECTED - Architectural mismatch

---

## 6. Security Considerations

### 6.1 Threat Model

**Threats Mitigated:**
- ✅ Quantum computer attacks (via ML-KEM-768)
- ✅ Classical ECDH compromise (via X25519 + ML-KEM hybrid)
- ✅ Downgrade attacks (TLS 1.3 only, enforced)

**Residual Risks:**
- ⚠️ Certificate authentication relies on Ed25519 (not post-quantum)
- ⚠️ One additional round-trip exposes timing metadata
- ⚠️ Self-signed certificates need trust establishment

### 6.2 Certificate Pinning

**Recommendation:** Implement certificate pinning for known peers.

```rust
pub struct HybridCertVerifier {
    // ... existing fields

    /// Pinned certificates (peer_id -> cert hash)
    pinned_certs: Arc<RwLock<HashMap<PeerId, [u8; 32]>>>,
}

impl HybridCertVerifier {
    fn verify_server_cert(&self, ...) -> Result<ServerCertVerified, Error> {
        // ... standard validation

        // Check pinning
        if let Some(expected_hash) = self.pinned_certs.read().unwrap().get(&peer_id) {
            let actual_hash = blake3::hash(end_entity.as_ref());
            if actual_hash.as_bytes() != expected_hash {
                return Err(Error::InvalidCertificate(
                    CertificateError::Other("Certificate pin mismatch".into())
                ));
            }
        }

        // ... ML-KEM processing
    }
}
```

### 6.3 Replay Attack Prevention

**Mechanism:** Use connection-specific nonces in hybrid secret derivation.

```rust
pub fn derive_hybrid_secret(
    x25519_secret: &[u8],
    ml_kem_secret: &[u8],
    connection_nonce: &[u8],  // NEW: Per-connection randomness
) -> [u8; 32] {
    const DOMAIN_SEPARATOR: &[u8; 32] = b"cretoai-hybrid-kex-v1\0\0\0\0\0\0\0\0\0\0\0";

    let mut hasher = Hasher::new_keyed(DOMAIN_SEPARATOR);
    hasher.update(x25519_secret);
    hasher.update(ml_kem_secret);
    hasher.update(connection_nonce);  // NEW: Bind to specific connection

    let hash = hasher.finalize();
    *hash.as_bytes()
}
```

---

## 7. Performance Analysis

### 7.1 Computational Overhead

| Operation | Time | Notes |
|-----------|------|-------|
| ML-KEM-768 KeyGen | ~0.05ms | Server startup only |
| ML-KEM-768 Encap | ~0.08ms | Client per connection |
| ML-KEM-768 Decap | ~0.10ms | Server per connection |
| BLAKE3 derivation | ~0.001ms | Negligible |
| **Total overhead** | **~0.2ms** | Per handshake |

**Baseline TLS 1.3 handshake:** ~10-50ms (network-dependent)

**Impact:** <2% computational overhead, negligible compared to network latency.

### 7.2 Bandwidth Overhead

| Data | Size | Direction |
|------|------|-----------|
| Certificate extension | +1184 bytes | Server → Client |
| ML-KEM ciphertext | +1088 bytes | Client → Server |
| **Total overhead** | **+2272 bytes** | Per handshake |

**Baseline TLS 1.3 handshake:** ~4-8 KB

**Impact:** ~30% bandwidth increase, acceptable for quantum resistance.

### 7.3 Latency Analysis

**Without 0-RTT:**
- Standard TLS 1.3: 1-RTT handshake
- Hybrid: 1-RTT (TLS) + 0.5-RTT (ciphertext) = **1.5-RTT total**

**With 0-RTT (future):**
- Would require session ticket integration
- Not implemented in Phase 2

---

## 8. Dependency Version Requirements

### 8.1 Required Upgrades

**Current versions** (from `Cargo.toml`):
```toml
quinn = "0.10"  # ❌ NEEDS UPGRADE
rustls = "0.21" # ❌ NEEDS UPGRADE
```

**Target versions** (Phase 2):
```toml
quinn = "0.11.9"  # ✅ UPGRADE REQUIRED
rustls = "0.23.35" # ✅ UPGRADE REQUIRED
rcgen = "0.11"     # ✅ CURRENT
webpki = "0.22"    # ✅ CURRENT
ring = "0.17"      # ✅ CURRENT
x509-parser = "0.16" # ✅ NEW DEPENDENCY
```

### 8.2 Breaking Changes

**quinn 0.10 → 0.11:**
- `Endpoint::connect` signature changed
- `ClientConfig::new` replaces builder pattern
- Transport config API updated

**rustls 0.21 → 0.23:**
- `dangerous_configuration` removed (now `danger` module)
- Certificate types moved to `pki_types` module
- `ServerCertVerifier` trait signature changed
- Builder pattern now mandatory

### 8.3 Migration Guide

**Step 1: Update Cargo.toml**
```toml
[dependencies]
quinn = "0.11.9"
rustls = { version = "0.23.35", features = ["ring"] }
rustls-pki-types = "1.0"
x509-parser = "0.16"
```

**Step 2: Update imports**
```rust
// Old (0.21)
use rustls::dangerous_configuration::ServerCertVerifier;

// New (0.23)
use rustls::client::danger::ServerCertVerifier;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
```

**Step 3: Update Quinn endpoint creation**
```rust
// Old (0.10)
let endpoint = Endpoint::builder();

// New (0.11)
let endpoint = Endpoint::server(server_config, bind_addr)?;
```

---

## 9. Monitoring and Observability

### 9.1 Metrics to Track

```rust
pub struct HybridHandshakeMetrics {
    /// ML-KEM encapsulation duration
    encap_duration_ms: Histogram,

    /// ML-KEM decapsulation duration
    decap_duration_ms: Histogram,

    /// Certificate verification failures
    verification_failures: Counter,

    /// Missing ML-KEM extension errors
    missing_extension_errors: Counter,

    /// Successful hybrid handshakes
    successful_handshakes: Counter,
}
```

### 9.2 Logging Strategy

```rust
// Certificate verification
tracing::debug!(
    peer_id = ?peer_id,
    ml_kem_pubkey_hash = ?blake3::hash(ml_kem_pubkey.as_bytes()),
    "Extracted ML-KEM public key from certificate"
);

// Encapsulation
tracing::info!(
    peer_id = ?peer_id,
    duration_ms = ?encap_duration.as_millis(),
    "ML-KEM encapsulation completed"
);

// Hybrid secret derivation
tracing::debug!(
    peer_id = ?peer_id,
    x25519_secret_hash = ?blake3::hash(x25519_secret),
    ml_kem_secret_hash = ?blake3::hash(ml_kem_secret),
    "Derived hybrid shared secret"
);
```

---

## 10. Future Work

### 10.1 0-RTT Support

**Goal:** Enable 0-RTT resumption with hybrid security.

**Approach:**
1. Store ML-KEM ciphertext in TLS session ticket
2. Replay protection via ticket nonces
3. Early data protection with hybrid-derived keys

**Complexity:** High (requires rustls internals understanding)

### 10.2 Post-Quantum Certificate Signatures

**Goal:** Replace Ed25519 certificate signatures with ML-DSA (Dilithium).

**Approach:**
1. Wait for rcgen support for ML-DSA
2. Update certificate generation
3. Update verifier to validate ML-DSA signatures

**Timeline:** Depends on rcgen upstream support

### 10.3 Multiple KEM Support

**Goal:** Support multiple KEM algorithms (ML-KEM-512, ML-KEM-1024).

**Approach:**
1. Negotiate KEM algorithm via ALPN or custom extension
2. Update certificate to include algorithm identifier
3. Implement fallback logic

**Use case:** Different security/performance tradeoffs

---

## 11. Conclusion

### 11.1 Key Design Decisions

1. **Certificate-based key transport** instead of custom TLS extensions
   - Rationale: rustls does not support custom extensions
   - Trade-off: One extra round-trip, but clean implementation

2. **Application-data ciphertext transmission** instead of handshake embedding
   - Rationale: Separation of concerns, easier testing
   - Trade-off: +0.5 RTT latency

3. **TLS 1.3 only** (no backwards compatibility)
   - Rationale: Security best practices
   - Trade-off: No legacy client support

### 11.2 Implementation Checklist

- [ ] Upgrade quinn to 0.11.9
- [ ] Upgrade rustls to 0.23.35
- [ ] Add x509-parser dependency
- [ ] Implement X.509 extension in cert.rs
- [ ] Create verifier.rs with HybridCertVerifier
- [ ] Create resolver.rs with HybridCertResolver
- [ ] Implement build_client_config in hybrid_handshake.rs
- [ ] Implement build_server_config in hybrid_handshake.rs
- [ ] Implement ciphertext transmission in transport.rs
- [ ] Write integration tests
- [ ] Write security tests
- [ ] Add metrics and logging
- [ ] Update documentation

### 11.3 Success Criteria

✅ **Phase 2 Complete When:**
1. Quinn connections use hybrid X25519 + ML-KEM-768 key exchange
2. All connections enforce TLS 1.3 only
3. Certificate extensions carry ML-KEM public keys
4. Custom verifiers extract and encapsulate correctly
5. Integration tests pass with quantum-resistant handshake
6. Performance overhead <5% (target: <2%)

---

## Appendix A: API Reference

### A.1 HybridTlsConfig

```rust
pub struct HybridTlsConfig {
    kem_keypair: MLKem768KeyPair,
}

impl HybridTlsConfig {
    pub fn new() -> Self;
    pub fn public_key(&self) -> &MLKem768PublicKey;
    pub fn encapsulate(&self, peer_public_key: &MLKem768PublicKey) -> (Vec<u8>, MLKem768Ciphertext);
    pub fn decapsulate(&self, ciphertext: &MLKem768Ciphertext) -> Vec<u8>;
    pub fn build_client_config(&self, server_name: String) -> Result<quinn::ClientConfig>;
    pub fn build_server_config(&self) -> Result<quinn::ServerConfig>;
}
```

### A.2 HybridCertVerifier

```rust
pub struct HybridCertVerifier {
    inner: Arc<dyn ServerCertVerifier>,
    ciphertext_storage: Arc<Mutex<Option<MLKem768Ciphertext>>>,
    shared_secret_storage: Arc<Mutex<Option<[u8; 32]>>>,
}

impl ServerCertVerifier for HybridCertVerifier {
    fn verify_server_cert(...) -> Result<ServerCertVerified, Error>;
    fn verify_tls12_signature(...) -> Result<HandshakeSignatureValid, Error>;
    fn verify_tls13_signature(...) -> Result<HandshakeSignatureValid, Error>;
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme>;
}
```

### A.3 HybridCertResolver

```rust
pub struct HybridCertResolver {
    certified_key: Arc<CertifiedKey>,
    kem_keypair: Arc<MLKem768KeyPair>,
    ciphertext_storage: Arc<Mutex<Option<MLKem768Ciphertext>>>,
    shared_secret_storage: Arc<Mutex<Option<[u8; 32]>>>,
}

impl ResolvesServerCert for HybridCertResolver {
    fn resolve(&self, client_hello: ClientHello<'_>) -> Option<Arc<CertifiedKey>>;
}

impl HybridCertResolver {
    pub fn process_ciphertext(&self, ciphertext: &MLKem768Ciphertext) -> Result<(), Error>;
}
```

---

## Appendix B: Wire Protocol Specification

### B.1 TLS Handshake Flow

```
Client                                              Server

ClientHello
  + supported_versions: [TLS 1.3]
  + key_share: X25519 public key
  + signature_algorithms
                        -------->
                                            ServerHello
                                              + key_share: X25519 public key
                                            {EncryptedExtensions}
                                            {Certificate}
                                              + Ed25519 signature
                                              + X.509 extension:
                                                OID: 2.16.840.1.101.3.4.4.4
                                                Value: ML-KEM-768 pubkey (1184B)
                                            {CertificateVerify}
                                            {Finished}
                        <--------
[Extract ML-KEM pubkey]
[Perform encapsulation]
{Certificate}
{Finished}
                        -------->

[Application Data: ML-KEM ciphertext (1088B)]
                        -------->
                                            [Perform decapsulation]
                                            [Derive hybrid secret]
[Derive hybrid secret]

<==================== Encrypted Application Data ====================>
```

### B.2 X.509 Certificate Extension Format

```
Certificate ::= SEQUENCE {
    tbsCertificate       TBSCertificate,
    signatureAlgorithm   AlgorithmIdentifier,
    signatureValue       BIT STRING
}

TBSCertificate ::= SEQUENCE {
    ...
    extensions           [3] EXPLICIT Extensions OPTIONAL
}

Extensions ::= SEQUENCE OF Extension

Extension ::= SEQUENCE {
    extnID      OBJECT IDENTIFIER,      -- 2.16.840.1.101.3.4.4.4
    critical    BOOLEAN DEFAULT FALSE,
    extnValue   OCTET STRING            -- ML-KEM-768 public key (1184 bytes)
}
```

---

**END OF ARCHITECTURE DOCUMENT**

**Version:** 1.0
**Last Updated:** 2025-11-27
**Next Review:** After Phase 2B completion
