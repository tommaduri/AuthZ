# Phase 2: Hybrid Handshake Flow Diagram
## ML-KEM-768 + X25519 Key Exchange via Quinn/rustls

---

## Complete Handshake Sequence

```
┌─────────────┐                                                ┌─────────────┐
│   CLIENT    │                                                │   SERVER    │
│  (Quinn)    │                                                │  (Quinn)    │
└──────┬──────┘                                                └──────┬──────┘
       │                                                              │
       │ ═══════════════════ TLS 1.3 HANDSHAKE ═══════════════════  │
       │                                                              │
       │ ClientHello                                                 │
       │  + supported_versions: [TLS 1.3]                            │
       │  + key_share: X25519 client public key                      │
       │  + signature_algorithms: [Ed25519]                          │
       ├─────────────────────────────────────────────────────────────>
       │                                                              │
       │                                                              │ [Generate/Load]
       │                                                              │  Certificate:
       │                                                              │   - Ed25519 sig
       │                                                              │   - Extension:
       │                                                              │     OID: 2.16...
       │                                                              │     ML-KEM pk
       │                                                              │
       │                                            ServerHello      │
       │                            + key_share: X25519 server pk    │
       │                                        {EncryptedExtensions}│
       │                                                {Certificate}│
       │                                      + tbsCertificate:       │
       │                                        - subject: CN=server │
       │                                        - extensions:         │
       │                                          ┌─────────────────┐│
       │                                          │ CustomExtension ││
       │                                          │ OID: 2.16.840.  ││
       │                                          │      1.101.3.4. ││
       │                                          │      4.4.4      ││
       │                                          │ Value: [1184B]  ││
       │                                          │   ML-KEM-768    ││
       │                                          │   public key    ││
       │                                          └─────────────────┘│
       │                                     + signatureAlgorithm:   │
       │                                       Ed25519               │
       │                                     + signatureValue        │
       │                                         {CertificateVerify} │
       │                                                   {Finished}│
       <─────────────────────────────────────────────────────────────┤
       │                                                              │
       │ [HybridCertVerifier.verify_server_cert() CALLED]           │
       │                                                              │
       │ 1. Standard validation (webpki):                            │
       │    ✓ Verify Ed25519 signature                               │
       │    ✓ Check certificate expiration                           │
       │    ✓ Validate certificate chain                             │
       │                                                              │
       │ 2. Extract ML-KEM-768 public key:                           │
       │    ┌────────────────────────────────────┐                   │
       │    │ Parse DER certificate              │                   │
       │    │ Find extension OID 2.16.840...     │                   │
       │    │ Extract 1184-byte public key       │                   │
       │    │ Validate key format                │                   │
       │    └────────────────────────────────────┘                   │
       │                                                              │
       │ 3. Perform ML-KEM-768 encapsulation:                        │
       │    ┌────────────────────────────────────┐                   │
       │    │ MLKem768::encapsulate(server_pk)   │                   │
       │    │ → (shared_secret, ciphertext)      │                   │
       │    │                                    │                   │
       │    │ Store in ciphertext_storage        │                   │
       │    │ Store in shared_secret_storage     │                   │
       │    └────────────────────────────────────┘                   │
       │                                                              │
       │ [Verifier returns: Ok(ServerCertVerified)]                  │
       │                                                              │
       │ {Certificate}                                               │
       │ {Finished}                                                  │
       ├─────────────────────────────────────────────────────────────>
       │                                                              │
       │                                                              │
       │ ════════════════ APPLICATION DATA (QUIC) ════════════════   │
       │                                                              │
       │ [Open bidirectional QUIC stream]                            │
       │                                                              │
       │ Stream 0: ML-KEM Ciphertext (1088 bytes)                    │
       │ ┌──────────────────────────────────────┐                    │
       │ │ 0x00: Algorithm ID (2 bytes) = 0x0304│                    │
       │ │ 0x02: Ciphertext (1088 bytes)        │                    │
       │ │       [encrypted shared secret]      │                    │
       │ └──────────────────────────────────────┘                    │
       ├─────────────────────────────────────────────────────────────>
       │                                                              │
       │                                                              │ [Receive ciphertext]
       │                                                              │
       │                                                              │ [HybridCertResolver
       │                                                              │  .process_ciphertext()]
       │                                                              │
       │                                                              │ 1. Parse ciphertext:
       │                                                              │    ✓ Verify algo ID
       │                                                              │    ✓ Validate size
       │                                                              │
       │                                                              │ 2. Decapsulation:
       │                                                              │    ┌──────────────┐
       │                                                              │    │ MLKem768::   │
       │                                                              │    │ decapsulate( │
       │                                                              │    │   ciphertext,│
       │                                                              │    │   secret_key │
       │                                                              │    │ )            │
       │                                                              │    │ → shared_    │
       │                                                              │    │   secret     │
       │                                                              │    └──────────────┘
       │                                                              │
       │                                                              │ 3. Store:
       │                                                              │    shared_secret_
       │                                                              │    storage
       │                                                              │
       │                                            ACK (Stream 0)   │
       <─────────────────────────────────────────────────────────────┤
       │                                                              │
       │                                                              │
       │ ═══════════ HYBRID SECRET DERIVATION (BOTH SIDES) ═══════   │
       │                                                              │
       │ [Client Side]                              [Server Side]    │
       │                                                              │
       │ x25519_secret =                            x25519_secret =  │
       │   TLS 1.3 key exchange                       TLS 1.3 KX     │
       │   (32 bytes)                                 (32 bytes)     │
       │                                                              │
       │ ml_kem_secret =                            ml_kem_secret =  │
       │   shared_secret_storage                      shared_secret_ │
       │   (32 bytes)                                 storage        │
       │                                              (32 bytes)     │
       │                                                              │
       │ hybrid_secret =                            hybrid_secret =  │
       │   BLAKE3_keyed(                              BLAKE3_keyed(  │
       │     key: "cretoai-hybrid-kex-v1",             ...same       │
       │     data: x25519 || ml_kem || nonce           ...same       │
       │   )                                          )              │
       │   → 32 bytes                                 → 32 bytes     │
       │                                                              │
       │ [Verify: hybrid_secret matches]            [Verify: match] │
       │                                                              │
       │                                                              │
       │ ══════════════════ SECURE CONNECTION ═══════════════════    │
       │                                                              │
       │ [All application data encrypted with hybrid-derived keys]   │
       │                                                              │
       │ Application Data Stream 1                                   │
       ├─────────────────────────────────────────────────────────────>
       │                                            Application Data │
       <─────────────────────────────────────────────────────────────┤
       │                                                              │
       │ [Protected by:]                                             │
       │  1. X25519 ECDH (classical security)                        │
       │  2. ML-KEM-768 KEM (post-quantum security)                  │
       │  3. BLAKE3 domain-separated hybrid derivation               │
       │                                                              │
┌──────┴──────┐                                                ┌──────┴──────┐
│   CLIENT    │                                                │   SERVER    │
└─────────────┘                                                └─────────────┘
```

---

## Component Interaction Details

### 1. Certificate Extension Structure

```
┌─────────────────────────────────────────────────────────────┐
│                     X.509 Certificate                        │
├─────────────────────────────────────────────────────────────┤
│ Version: 3 (X.509v3)                                        │
│ Serial Number: <random>                                     │
│ Signature Algorithm: Ed25519                                │
│ Issuer: CN=<agent_id>                                       │
│ Validity:                                                   │
│   Not Before: 2024-01-01                                    │
│   Not After:  2024-04-01 (90 days)                         │
│ Subject: CN=<agent_id>                                      │
│ Subject Public Key Info:                                    │
│   Algorithm: Ed25519                                        │
│   Public Key: [32 bytes]                                    │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐│
│ │                     Extensions                          ││
│ ├─────────────────────────────────────────────────────────┤│
│ │ Extension 1: Basic Constraints                          ││
│ │   Critical: true                                        ││
│ │   Value: CA:FALSE                                       ││
│ │                                                         ││
│ │ Extension 2: Key Usage                                  ││
│ │   Critical: true                                        ││
│ │   Value: digitalSignature                               ││
│ │                                                         ││
│ │ Extension 3: ML-KEM-768 Public Key (CUSTOM)            ││
│ │   OID: 2.16.840.1.101.3.4.4.4                          ││
│ │   Critical: false                                       ││
│ │   Value: OCTET STRING (1184 bytes)                     ││
│ │   ┌───────────────────────────────────────────────────┐││
│ │   │  0x00-0x4A: ML-KEM-768 seed (1184 bytes)         │││
│ │   │  [Post-quantum public key material]              │││
│ │   └───────────────────────────────────────────────────┘││
│ └─────────────────────────────────────────────────────────┘│
│                                                             │
│ Signature Algorithm: Ed25519                                │
│ Signature Value: [64 bytes]                                 │
└─────────────────────────────────────────────────────────────┘
```

### 2. HybridCertVerifier State Machine

```
┌──────────────────────────────────────────────────────────────┐
│               HybridCertVerifier (Client)                     │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  verify_server_cert(cert, intermediates, ...)        │   │
│  └────────────────────┬─────────────────────────────────┘   │
│                       │                                       │
│                       ▼                                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Step 1: Standard Validation                          │   │
│  │  ┌──────────────────────────────────────────────┐    │   │
│  │  │ inner.verify_server_cert(...)                │    │   │
│  │  │  - Verify Ed25519 signature                  │    │   │
│  │  │  - Check expiration                          │    │   │
│  │  │  - Validate certificate chain                │    │   │
│  │  └──────────────────────────────────────────────┘    │   │
│  └────────────────────┬─────────────────────────────────┘   │
│                       │ Ok                                    │
│                       ▼                                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Step 2: Extract ML-KEM Public Key                   │   │
│  │  ┌──────────────────────────────────────────────┐    │   │
│  │  │ parse_x509_certificate(cert_der)             │    │   │
│  │  │ find extension OID 2.16.840.1.101.3.4.4.4    │    │   │
│  │  │ validate size == 1184 bytes                  │    │   │
│  │  │ MLKem768PublicKey::from_bytes(...)           │    │   │
│  │  └──────────────────────────────────────────────┘    │   │
│  └────────────────────┬─────────────────────────────────┘   │
│                       │ Ok(ml_kem_pubkey)                    │
│                       ▼                                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Step 3: ML-KEM Encapsulation                        │   │
│  │  ┌──────────────────────────────────────────────┐    │   │
│  │  │ MLKem768::encapsulate(&ml_kem_pubkey)        │    │   │
│  │  │   → (shared_secret, ciphertext)              │    │   │
│  │  │                                              │    │   │
│  │  │ Duration: ~0.08ms                            │    │   │
│  │  └──────────────────────────────────────────────┘    │   │
│  └────────────────────┬─────────────────────────────────┘   │
│                       │                                       │
│                       ▼                                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Step 4: Store Results                               │   │
│  │  ┌──────────────────────────────────────────────┐    │   │
│  │  │ *ciphertext_storage.lock() =                 │    │   │
│  │  │   Some(ciphertext)                           │    │   │
│  │  │                                              │    │   │
│  │  │ *shared_secret_storage.lock() =              │    │   │
│  │  │   Some(shared_secret.as_bytes())             │    │   │
│  │  └──────────────────────────────────────────────┘    │   │
│  └────────────────────┬─────────────────────────────────┘   │
│                       │                                       │
│                       ▼                                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Return: Ok(ServerCertVerified::assertion())         │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 3. HybridCertResolver State Machine

```
┌──────────────────────────────────────────────────────────────┐
│               HybridCertResolver (Server)                     │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  resolve(client_hello)                                │   │
│  └────────────────────┬─────────────────────────────────┘   │
│                       │                                       │
│                       ▼                                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Return pre-generated CertifiedKey                    │   │
│  │  (contains certificate with ML-KEM extension)         │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  [Later, after receiving ciphertext via QUIC stream]         │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  process_ciphertext(ciphertext)                       │   │
│  └────────────────────┬─────────────────────────────────┘   │
│                       │                                       │
│                       ▼                                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Step 1: Validate Ciphertext                         │   │
│  │  ┌──────────────────────────────────────────────┐    │   │
│  │  │ Verify algorithm ID == 0x0304                │    │   │
│  │  │ Verify size == 1088 bytes                    │    │   │
│  │  │ MLKem768Ciphertext::from_bytes(...)          │    │   │
│  │  └──────────────────────────────────────────────┘    │   │
│  └────────────────────┬─────────────────────────────────┘   │
│                       │ Ok(ciphertext)                       │
│                       ▼                                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Step 2: ML-KEM Decapsulation                        │   │
│  │  ┌──────────────────────────────────────────────┐    │   │
│  │  │ MLKem768::decapsulate(                       │    │   │
│  │  │   &ciphertext,                               │    │   │
│  │  │   &self.kem_keypair.secret_key               │    │   │
│  │  │ ) → shared_secret                            │    │   │
│  │  │                                              │    │   │
│  │  │ Duration: ~0.10ms                            │    │   │
│  │  └──────────────────────────────────────────────┘    │   │
│  └────────────────────┬─────────────────────────────────┘   │
│                       │                                       │
│                       ▼                                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Step 3: Store Shared Secret                         │   │
│  │  ┌──────────────────────────────────────────────┐    │   │
│  │  │ *shared_secret_storage.lock() =              │    │   │
│  │  │   Some(shared_secret.as_bytes())             │    │   │
│  │  └──────────────────────────────────────────────┘    │   │
│  └────────────────────┬─────────────────────────────────┘   │
│                       │                                       │
│                       ▼                                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Return: Ok(())                                       │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 4. Hybrid Secret Derivation

```
┌─────────────────────────────────────────────────────────────┐
│              derive_hybrid_secret(x25519, ml_kem)            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Input:                                                      │
│    x25519_secret:     [u8; 32]  ← TLS 1.3 ECDH             │
│    ml_kem_secret:     [u8; 32]  ← ML-KEM-768 shared secret │
│    connection_nonce:  [u8; 32]  ← Per-connection randomness│
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │  BLAKE3 Keyed Hash                                 │    │
│  │  ┌──────────────────────────────────────────────┐  │    │
│  │  │ Domain Separator (Key):                      │  │    │
│  │  │   "cretoai-hybrid-kex-v1\0\0\0\0\0\0\0\0\0\0" │  │    │
│  │  │   (32 bytes, padded with nulls)              │  │    │
│  │  └──────────────────────────────────────────────┘  │    │
│  │                                                    │    │
│  │  Input Data (concatenated):                       │    │
│  │  ┌──────────────────────────────────────────────┐  │    │
│  │  │ 1. x25519_secret       (32 bytes)            │  │    │
│  │  │ 2. ml_kem_secret       (32 bytes)            │  │    │
│  │  │ 3. connection_nonce    (32 bytes)            │  │    │
│  │  └──────────────────────────────────────────────┘  │    │
│  │  Total: 96 bytes                                   │    │
│  │                                                    │    │
│  │  ┌──────────────────────────────────────────────┐  │    │
│  │  │ BLAKE3 Hash                                  │  │    │
│  │  │   → 32-byte output                           │  │    │
│  │  └──────────────────────────────────────────────┘  │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  Output:                                                     │
│    hybrid_secret: [u8; 32]                                  │
│                                                              │
│  Properties:                                                 │
│    ✓ Deterministic (same inputs → same output)              │
│    ✓ One-way (cannot reverse to get x25519 or ml_kem)      │
│    ✓ Domain-separated (unique namespace)                    │
│    ✓ Collision-resistant (BLAKE3 guarantees)                │
│    ✓ Quantum-resistant (ML-KEM component)                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Security Properties

### Post-Quantum Security

```
┌─────────────────────────────────────────────────────────────┐
│                  Security Level Analysis                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  X25519 Alone:                                              │
│    Classical Security:   ~128 bits                          │
│    Quantum Security:     ~64 bits (Grover's algorithm)      │
│    Status:               VULNERABLE to quantum computers    │
│                                                              │
│  ML-KEM-768 Alone:                                          │
│    Classical Security:   ~128 bits                          │
│    Quantum Security:     ~128 bits (post-quantum)           │
│    Status:               SECURE against quantum computers   │
│                                                              │
│  Hybrid (X25519 + ML-KEM-768):                              │
│    Classical Security:   min(128, 128) = 128 bits           │
│    Quantum Security:     min(64, 128) = 64 bits             │
│    Status:               SECURE if either primitive secure  │
│                                                              │
│  Security Guarantee:                                         │
│    "Secure unless BOTH X25519 AND ML-KEM-768 are broken"   │
│    (No weak composition: both secrets required)             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Performance Timeline

```
Time (ms)
  0     10    20    30    40    50    60    70    80    90   100
  ├─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┤
  │
  │ [Standard TLS 1.3 Handshake: ~10-50ms]
  │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
  │
  │ + ML-KEM Encapsulation (client): 0.08ms
  │ ▓
  │
  │ + ML-KEM Decapsulation (server): 0.10ms
  │ ▓
  │
  │ + BLAKE3 Derivation: 0.001ms
  │ ▓
  │
  │ + Ciphertext Transmission: ~0.5 RTT (network-dependent)
  │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
  │
  │ TOTAL OVERHEAD: <2% computational + 0.5 RTT network
  │
  └─────────────────────────────────────────────────────────────

Legend:
  ▓ = Computation time (CPU-bound)
  ░ = Network latency (network-bound)
```

---

## Error Handling Flow

```
┌─────────────────────────────────────────────────────────────┐
│                  Error Handling Paths                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Certificate Verification Errors:                           │
│    ❌ Invalid signature                                     │
│       → Err(InvalidCertificate(BadSignature))              │
│       → Connection aborted, alert sent                      │
│                                                              │
│    ❌ Expired certificate                                   │
│       → Err(InvalidCertificate(Expired))                   │
│       → Connection aborted, alert sent                      │
│                                                              │
│    ❌ Missing ML-KEM extension                              │
│       → Err(InvalidCertificate(Other("Missing ML-KEM")))   │
│       → Connection aborted, alert sent                      │
│                                                              │
│    ❌ Invalid ML-KEM public key size                        │
│       → Err(InvalidCertificate(BadEncoding))               │
│       → Connection aborted, alert sent                      │
│                                                              │
│  Ciphertext Processing Errors:                              │
│    ❌ Invalid ciphertext size                               │
│       → Err(Transport("Invalid ciphertext size"))          │
│       → Stream closed, connection continues                 │
│                                                              │
│    ❌ Decapsulation failure                                 │
│       → Err(Transport("Decapsulation failed"))             │
│       → Stream closed, connection aborted                   │
│                                                              │
│    ❌ Shared secret mismatch                                │
│       → Err(Transport("Hybrid secret mismatch"))           │
│       → Connection aborted immediately                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

**Document:** Phase 2 Handshake Flow Diagram
**Companion:** phase2-quinn-rustls-architecture.md
**Status:** Architecture Design Complete
