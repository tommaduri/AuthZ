# ML-KEM Implementation Quick Reference

**Quick guide for implementing ML-KEM in CretoAI using rustls 0.23.35 & Quinn 0.11.9**

---

## 🎯 TL;DR - What We Need

**Goal:** Exchange ML-KEM keys/ciphertexts during QUIC handshake

**Solution:**
1. **QUIC Transport Parameters** → Carry ML-KEM data (PRIMARY)
2. **Certificate Extensions** → Carry server's ML-KEM public key (SECONDARY)
3. **Custom Certificate Verifier** → Extract ML-KEM keys (ENABLER)

**Why not custom TLS extensions?** Rustls deliberately doesn't support them. Use transport parameters instead - it's cleaner and fully supported.

---

## 🚀 Quick Implementation Guide

### Step 1: Add Dependencies

```toml
[dependencies]
rustls = { version = "0.23.35", features = ["dangerous_configuration"] }
quinn = "0.11.9"
rcgen = "0.13"  # For certificate generation
ml-kem = "0.2"  # RustCrypto ML-KEM implementation
tokio = { version = "1", features = ["full"] }
```

### Step 2: Transport Parameters Encoding

```rust
// Define your encoding format
#[derive(Serialize, Deserialize)]
struct MlKemTransportParams {
    version: u8,
    ml_kem_data: Vec<u8>,  // Public key or ciphertext
}

fn encode_ml_kem_params(data: Vec<u8>) -> Vec<u8> {
    let params = MlKemTransportParams {
        version: 1,
        ml_kem_data: data,
    };
    bincode::serialize(&params).unwrap()
}

fn decode_ml_kem_params(params: &[u8]) -> Result<Vec<u8>, Error> {
    let params: MlKemTransportParams = bincode::deserialize(params)?;
    Ok(params.ml_kem_data)
}
```

### Step 3: Client Side - Send Public Key

```rust
use quinn::ClientConnection;
use ml_kem::kem::{Kem, MlKem768};

async fn create_client_connection() -> Result<ClientConnection, Error> {
    // Generate ML-KEM keypair
    let mut rng = rand::thread_rng();
    let (pk, sk) = MlKem768::generate(&mut rng);

    // Encode public key in transport parameters
    let transport_params = encode_ml_kem_params(pk.as_bytes().to_vec());

    // Create QUIC connection with ML-KEM params
    let conn = ClientConnection::new(
        config,
        Version::V1,
        server_name,
        transport_params,
    )?;

    // Store secret key for later decapsulation
    store_secret_key(sk);

    Ok(conn)
}
```

### Step 4: Server Side - Receive & Encapsulate

```rust
use quinn::ServerConnection;

async fn handle_client_connection(conn: &ServerConnection) -> Result<SharedSecret, Error> {
    // Wait for handshake to complete
    wait_for_handshake_completion(conn).await?;

    // Extract client's ML-KEM public key
    let peer_params = conn.quic_transport_parameters()
        .ok_or(Error::NoTransportParams)?;
    let client_pk_bytes = decode_ml_kem_params(peer_params)?;
    let client_pk = EncapsulationKey::from_bytes(&client_pk_bytes)?;

    // Encapsulate to create shared secret and ciphertext
    let mut rng = rand::thread_rng();
    let (ciphertext, shared_secret) = client_pk.encapsulate(&mut rng)?;

    // Send ciphertext in server's transport parameters
    // (Note: This is conceptual - actual implementation depends on when
    // server can set transport params after receiving client's)

    Ok(shared_secret)
}
```

### Step 5: Client Side - Decapsulate

```rust
async fn derive_shared_secret(conn: &ClientConnection) -> Result<SharedSecret, Error> {
    // Wait for handshake completion
    wait_for_handshake_completion(conn).await?;

    // Extract ciphertext from server's transport parameters
    let peer_params = conn.quic_transport_parameters()
        .ok_or(Error::NoTransportParams)?;
    let ciphertext_bytes = decode_ml_kem_params(peer_params)?;
    let ciphertext = Ciphertext::from_bytes(&ciphertext_bytes)?;

    // Decapsulate using stored secret key
    let sk = retrieve_secret_key()?;
    let shared_secret = sk.decapsulate(&ciphertext)?;

    Ok(shared_secret)
}
```

### Step 6: Custom Certificate Verifier (Optional but Recommended)

```rust
use rustls::client::danger::{ServerCertVerifier, ServerCertVerified};

struct CretoAIVerifier {
    ml_kem_keys: Arc<Mutex<HashMap<String, Vec<u8>>>>,
}

impl ServerCertVerifier for CretoAIVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        _ocsp: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, Error> {
        // Extract ML-KEM public key from certificate extension
        if let Some(ml_kem_pk) = extract_ml_kem_extension(end_entity)? {
            self.ml_kem_keys.lock().unwrap()
                .insert(server_name.to_string(), ml_kem_pk);
        }

        // Verify certificate chain (IMPORTANT: don't skip in production!)
        verify_certificate_chain(end_entity, intermediates, server_name, now)?;

        Ok(ServerCertVerified::assertion())
    }

    // Implement other required methods...
    fn verify_tls12_signature(...) -> Result<HandshakeSignatureValid, Error> {
        verify_signature_standard(message, cert, dss)
    }

    fn verify_tls13_signature(...) -> Result<HandshakeSignatureValid, Error> {
        verify_signature_standard(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![
            SignatureScheme::ECDSA_NISTP256_SHA256,
            SignatureScheme::RSA_PSS_SHA256,
            SignatureScheme::ED25519,
        ]
    }
}

// Use the custom verifier
fn create_client_config() -> ClientConfig {
    ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(CretoAIVerifier::new()))
        .with_no_client_auth()
}
```

### Step 7: Generate Server Certificate with ML-KEM Extension

```rust
use rcgen::{CertificateParams, CustomExtension};

fn generate_server_cert_with_ml_kem() -> Result<Certificate, Error> {
    // Your server's long-term ML-KEM public key
    let server_ml_kem_pk = load_server_ml_kem_public_key()?;

    // Define custom OID for CretoAI ML-KEM extension
    // Format: 1.3.6.1.4.1.<YOUR_PEN>.1.1
    // (Get YOUR_PEN from IANA for production)
    let oid = &[1, 3, 6, 1, 4, 1, 99999, 1, 1]; // Example only!

    // Create custom extension
    let extension = CustomExtension::from_oid_content(
        oid,
        server_ml_kem_pk.as_bytes().to_vec()
    );

    // Add to certificate parameters
    let mut params = CertificateParams::default();
    params.custom_extensions.push(extension);

    // Generate certificate
    let key_pair = generate_key_pair()?;
    let cert = params.self_signed(&key_pair)?;

    Ok(cert)
}

fn extract_ml_kem_extension(cert: &CertificateDer) -> Result<Option<Vec<u8>>, Error> {
    // Parse certificate and look for your custom OID
    let parsed = parse_x509_certificate(cert.as_ref())?;
    let oid = &[1, 3, 6, 1, 4, 1, 99999, 1, 1];

    for extension in parsed.extensions() {
        if extension.oid == oid {
            return Ok(Some(extension.value.to_vec()));
        }
    }

    Ok(None)
}
```

---

## 📊 Data Sizes (ML-KEM768)

| Component | Size | Fits in Transport Params? |
|-----------|------|---------------------------|
| Public Key | 1,088 bytes | ✅ Yes (~1 KB) |
| Ciphertext | 1,568 bytes | ✅ Yes (~1.5 KB) |
| Shared Secret | 32 bytes | ✅ Yes (tiny) |
| Total Exchange | ~2.6 KB | ✅ Yes (plenty of room) |

QUIC transport parameters can hold several KB, so ML-KEM data fits comfortably.

---

## 🔒 Security Checklist

- [ ] **Verify certificates properly** - Don't just skip verification!
- [ ] **Validate ML-KEM parameters** - Check sizes, versions, etc.
- [ ] **Use secure RNG** - `rand::thread_rng()` or better
- [ ] **Handle errors gracefully** - Don't leak information
- [ ] **Allocate proper OID** - Get PEN from IANA for production
- [ ] **Test with invalid inputs** - Fuzz testing recommended
- [ ] **Audit crypto implementations** - Use well-reviewed libraries
- [ ] **Protect secret keys** - Zeroize after use

---

## 🐛 Common Pitfalls

### ❌ Mistake: Accessing transport params too early
```rust
// WRONG - params not available yet!
let conn = ServerConnection::new(...)?;
let params = conn.quic_transport_parameters(); // Returns None!
```

✅ **Correct:** Wait for handshake completion
```rust
let conn = ServerConnection::new(...)?;
wait_for_handshake_completion(&conn).await?;
let params = conn.quic_transport_parameters().unwrap();
```

### ❌ Mistake: Skipping certificate verification in production
```rust
// WRONG - insecure!
fn verify_server_cert(...) -> Result<ServerCertVerified, Error> {
    Ok(ServerCertVerified::assertion()) // Always accepts!
}
```

✅ **Correct:** Always verify certificates
```rust
fn verify_server_cert(...) -> Result<ServerCertVerified, Error> {
    // Extract ML-KEM key
    let ml_kem_pk = extract_ml_kem_extension(end_entity)?;
    store_ml_kem_pk(ml_kem_pk);

    // VERIFY THE CERTIFICATE!
    verify_certificate_chain(end_entity, intermediates, server_name, now)?;

    Ok(ServerCertVerified::assertion())
}
```

### ❌ Mistake: Using invalid OID
```rust
// WRONG - random numbers!
let oid = &[1, 2, 3, 4, 5];
```

✅ **Correct:** Use proper OID structure
```rust
// Get PEN from IANA: https://www.iana.org/assignments/enterprise-numbers
let oid = &[1, 3, 6, 1, 4, 1, YOUR_PEN, 1, 1];
```

---

## 🧪 Testing Strategy

### Unit Tests
```rust
#[test]
fn test_ml_kem_params_encoding() {
    let data = vec![1, 2, 3, 4];
    let encoded = encode_ml_kem_params(data.clone());
    let decoded = decode_ml_kem_params(&encoded).unwrap();
    assert_eq!(data, decoded);
}

#[test]
fn test_ml_kem_key_exchange() {
    let (pk, sk) = MlKem768::generate(&mut rng);
    let (ct, ss1) = pk.encapsulate(&mut rng).unwrap();
    let ss2 = sk.decapsulate(&ct).unwrap();
    assert_eq!(ss1, ss2);
}
```

### Integration Tests
```rust
#[tokio::test]
async fn test_full_handshake_with_ml_kem() {
    let server = spawn_test_server().await;
    let client = create_test_client().await;

    let client_conn = client.connect(server.addr()).await.unwrap();
    wait_for_handshake(&client_conn).await.unwrap();

    let shared_secret = derive_shared_secret(&client_conn).await.unwrap();
    assert_eq!(shared_secret.len(), 32);
}
```

### Fuzz Testing
```rust
#[test]
fn fuzz_transport_params_decoder() {
    for _ in 0..10000 {
        let random_data: Vec<u8> = (0..100)
            .map(|_| rand::random())
            .collect();

        // Should not panic
        let _ = decode_ml_kem_params(&random_data);
    }
}
```

---

## 📚 Key Resources

- **Full Research:** `docs/rustls-quinn-custom-extensions-research.md`
- **rustls Docs:** https://docs.rs/rustls/0.23.35/
- **Quinn Docs:** https://docs.rs/quinn/0.11.9/
- **rcgen Docs:** https://docs.rs/rcgen/latest/
- **ML-KEM Crate:** https://docs.rs/ml-kem/latest/

---

## 🚦 Implementation Status Template

Track your progress:

```markdown
## ML-KEM Implementation Checklist

### Phase 1: Transport Parameters ⏳
- [ ] Define encoding format
- [ ] Implement encode_ml_kem_params()
- [ ] Implement decode_ml_kem_params()
- [ ] Client sends public key
- [ ] Server receives and encapsulates
- [ ] Client decapsulates
- [ ] Test end-to-end key exchange
- [ ] Error handling

### Phase 2: Certificate Extensions ⏳
- [ ] Allocate OID (or use test OID)
- [ ] Generate cert with ML-KEM extension
- [ ] Implement custom verifier
- [ ] Extract extension in verifier
- [ ] Test certificate validation
- [ ] Integration with transport params

### Phase 3: Testing & Security ⏳
- [ ] Unit tests for encoding/decoding
- [ ] Integration tests for handshake
- [ ] Fuzz testing
- [ ] Security audit
- [ ] Performance benchmarks
- [ ] Documentation

### Phase 4: Production Hardening ⏳
- [ ] Production OID allocation
- [ ] Logging and monitoring
- [ ] Error handling refinement
- [ ] Key rotation support
- [ ] Operational documentation
```

---

## 💡 Pro Tips

1. **Start Simple:** Test with mock keys before integrating real ML-KEM
2. **Log Everything:** Transport parameters, certificates, errors
3. **Test Both Sides:** Don't assume symmetric behavior
4. **Use Type Safety:** Wrap keys in newtypes to prevent mixing pk/sk/ct/ss
5. **Benchmark:** Measure handshake latency impact
6. **Plan for Failure:** What happens if ML-KEM fails? Fallback?

---

## 🤔 FAQ

**Q: Can I use this in production?**
A: Yes, but ensure proper certificate verification and OID allocation.

**Q: Does this break compatibility?**
A: No - clients/servers without ML-KEM support will ignore the extensions.

**Q: What about TLS-over-TCP?**
A: Transport parameters are QUIC-only. Use post-handshake messages instead.

**Q: Is this standardized?**
A: Not yet. This is experimental. Monitor IETF TLSWG for standards.

**Q: What about performance?**
A: ML-KEM768 adds ~1-2ms to handshake. Negligible for most applications.

---

**Version:** 1.0
**Last Updated:** 2025-11-27
**Next Review:** After Phase 1 implementation
