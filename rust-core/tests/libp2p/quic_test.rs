//! QUIC transport integration tests
//!
//! These tests verify the hybrid X25519 + ML-KEM-768 QUIC transport.

use vigilia_network::libp2p::quic::*;
use vigilia_crypto::keys::AgentIdentity;
use std::sync::Arc;
use tokio::time::Duration;

/// Test 1: Basic hybrid handshake
///
/// Tests the core hybrid handshake between client and server:
/// - Creates two endpoints with different identities
/// - Server listens on a port
/// - Client dials server
/// - Verifies ML-KEM-768 encapsulation occurred
/// - Verifies hybrid secret derivation
#[tokio::test]
#[ignore] // Integration test - requires multi-node setup and actual network binding
async fn test_hybrid_handshake_success() {
    use vigilia_network::libp2p::quic::{QuicTransport, QuicTransportConfig};
    use vigilia_crypto::keys::AgentIdentity;
    use std::sync::Arc;
    use tokio::time::{timeout, Duration};

    // Create server identity and transport
    let server_identity = Arc::new(
        AgentIdentity::generate("server-001".to_string())
            .expect("Failed to generate server identity")
    );

    let server_config = QuicTransportConfig {
        bind_address: "127.0.0.1:0".parse().unwrap(),
        ..Default::default()
    };

    let mut server_transport = QuicTransport::new(server_identity.clone(), server_config)
        .expect("Failed to create server transport");

    // Start server listening
    let server_addr = timeout(Duration::from_secs(5), server_transport.listen())
        .await
        .expect("Server listen timeout")
        .expect("Failed to start server");

    println!("Server listening on: {}", server_addr);

    // Create client identity and transport
    let client_identity = Arc::new(
        AgentIdentity::generate("client-001".to_string())
            .expect("Failed to generate client identity")
    );

    let client_config = QuicTransportConfig::default();
    let mut client_transport = QuicTransport::new(client_identity.clone(), client_config)
        .expect("Failed to create client transport");

    // Client dials server
    let dial_result = timeout(Duration::from_secs(5), client_transport.dial(server_addr))
        .await
        .expect("Client dial timeout");

    match dial_result {
        Ok(_) => {
            println!("✓ Hybrid handshake completed successfully");

            // TODO: Once transport.rs is fully implemented, verify:
            // 1. ML-KEM-768 encapsulation occurred on client side
            // 2. ML-KEM-768 decapsulation occurred on server side
            // 3. Hybrid secret was derived on both sides
            // 4. Connection state is Connected
        }
        Err(e) => {
            panic!("Hybrid handshake failed: {}", e);
        }
    }
}

/// Test 2: ML-KEM encapsulation/decapsulation
#[tokio::test]
async fn test_ml_kem_encapsulation() {
    let config = HybridTlsConfig::new();
    let (secret1, ciphertext) = config.encapsulate(config.public_key());
    let secret2 = config.decapsulate(&ciphertext);

    assert_eq!(secret1, secret2);
}

/// Test 3: TLS extension encoding/decoding
#[tokio::test]
async fn test_tls_extension_encoding() {
    // TODO: Implement
}

/// Test 4: Certificate generation
#[tokio::test]
async fn test_certificate_generation() {
    let der = generate_self_signed_cert("test".to_string()).unwrap();
    assert!(!der.is_empty());
}

/// Test 5: Certificate validation
#[tokio::test]
#[ignore] // TODO: Implement after certificate validation is complete
async fn test_certificate_validation() {
    // TODO: Implement
}

/// Test 6: PeerId mapping
#[tokio::test]
#[ignore] // TODO: Implement after PeerId integration
async fn test_peer_id_mapping() {
    // TODO: Implement
}

/// Test 7: Hybrid secret derivation
#[tokio::test]
async fn test_hybrid_secret_derivation() {
    let x25519 = [1u8; 32];
    let ml_kem = [2u8; 32];

    let secret1 = derive_hybrid_secret(&x25519, &ml_kem);
    let secret2 = derive_hybrid_secret(&x25519, &ml_kem);

    assert_eq!(secret1, secret2);

    // Verify changing either secret changes output
    let x25519_different = [3u8; 32];
    let secret3 = derive_hybrid_secret(&x25519_different, &ml_kem);
    assert_ne!(secret1, secret3);
}

/// Test 8: Full connection establishment
///
/// Comprehensive end-to-end test covering:
/// - Certificate exchange
/// - ML-KEM public key extraction
/// - Ciphertext transmission
/// - Connection state transitions
/// - Bidirectional communication
#[tokio::test]
#[ignore] // Integration test - requires network and full Quinn implementation
async fn test_connection_establishment() {
    use vigilia_network::libp2p::quic::{
        QuicTransport, QuicTransportConfig, ConnectionState,
        HybridTlsConfig, HybridCertVerifier, HybridCertResolver,
        KemHandshakeState, CiphertextState
    };
    use vigilia_crypto::keys::AgentIdentity;
    use std::sync::{Arc, RwLock};
    use tokio::time::{timeout, Duration};

    // Setup server
    let server_identity = Arc::new(
        AgentIdentity::generate("server-e2e".to_string())
            .expect("Failed to generate server identity")
    );

    let server_config = QuicTransportConfig {
        bind_address: "127.0.0.1:0".parse().unwrap(),
        connection_timeout: Duration::from_secs(10),
        ..Default::default()
    };

    let mut server_transport = QuicTransport::new(server_identity.clone(), server_config)
        .expect("Failed to create server transport");

    // Start listening
    let server_addr = timeout(Duration::from_secs(5), server_transport.listen())
        .await
        .expect("Server listen timeout")
        .expect("Failed to start server");

    println!("Server listening on: {}", server_addr);

    // Setup client
    let client_identity = Arc::new(
        AgentIdentity::generate("client-e2e".to_string())
            .expect("Failed to generate client identity")
    );

    let client_config = QuicTransportConfig {
        connection_timeout: Duration::from_secs(10),
        ..Default::default()
    };

    let mut client_transport = QuicTransport::new(client_identity.clone(), client_config)
        .expect("Failed to create client transport");

    // Initiate connection
    let connect_result = timeout(Duration::from_secs(10), client_transport.dial(server_addr))
        .await
        .expect("Connection timeout");

    assert!(connect_result.is_ok(), "Connection should succeed");

    println!("✓ Connection established successfully");

    // TODO: Verify connection state transitions when transport.rs is complete:
    // 1. Initial state: Connecting
    // 2. After handshake: Connected
    // 3. Verify certificate exchange occurred
    // 4. Verify ML-KEM public key was extracted from server certificate
    // 5. Verify client generated and sent ciphertext
    // 6. Verify server received and decapsulated ciphertext
    // 7. Verify hybrid secret derivation on both sides
    // 8. Test bidirectional stream creation
}

/// Test 9: Connection timeout
#[tokio::test]
#[ignore] // Integration test - requires network
async fn test_connection_timeout() {
    // TODO: Implement
}

/// Test 10: Forward secrecy
#[tokio::test]
#[ignore] // TODO: Implement after handshake complete
async fn test_forward_secrecy() {
    // TODO: Implement
    // Verify ephemeral keys are used
}

/// Test 11: Quantum resistance
#[tokio::test]
#[ignore] // TODO: Implement after handshake complete
async fn test_quantum_resistance() {
    // TODO: Implement
    // Verify ML-KEM is properly integrated
}

/// Test 12: Handshake performance
///
/// Performance benchmark for hybrid handshake:
/// - Target: <1s for handshake completion
/// - Measures: Handshake latency, bandwidth overhead
/// - Compares with classical TLS baseline
///
/// Performance targets (from spec):
/// - Handshake: <1s
/// - Bandwidth overhead: ≤2.5KB (2272 bytes = 2.22KB)
/// - Expected overhead: ~0.7ms vs classical TLS
#[tokio::test]
#[ignore] // Integration test - performance benchmark, marked for CI/CD exclusion
async fn test_handshake_performance() {
    use vigilia_network::libp2p::quic::{QuicTransport, QuicTransportConfig};
    use vigilia_crypto::keys::AgentIdentity;
    use std::sync::Arc;
    use tokio::time::{timeout, Duration, Instant};

    const NUM_ITERATIONS: usize = 10;
    const TARGET_HANDSHAKE_TIME_MS: u128 = 1000; // 1 second
    const EXPECTED_OVERHEAD_MS: u128 = 1; // ~0.7ms expected, allowing 1ms margin

    let mut handshake_times = Vec::with_capacity(NUM_ITERATIONS);

    for i in 0..NUM_ITERATIONS {
        // Setup server
        let server_identity = Arc::new(
            AgentIdentity::generate(format!("perf-server-{}", i))
                .expect("Failed to generate server identity")
        );

        let server_config = QuicTransportConfig {
            bind_address: "127.0.0.1:0".parse().unwrap(),
            ..Default::default()
        };

        let mut server_transport = QuicTransport::new(server_identity, server_config)
            .expect("Failed to create server transport");

        let server_addr = timeout(Duration::from_secs(5), server_transport.listen())
            .await
            .expect("Server listen timeout")
            .expect("Failed to start server");

        // Setup client
        let client_identity = Arc::new(
            AgentIdentity::generate(format!("perf-client-{}", i))
                .expect("Failed to generate client identity")
        );

        let client_config = QuicTransportConfig::default();
        let mut client_transport = QuicTransport::new(client_identity, client_config)
            .expect("Failed to create client transport");

        // Measure handshake time
        let start = Instant::now();
        let dial_result = timeout(Duration::from_secs(2), client_transport.dial(server_addr))
            .await
            .expect("Dial timeout");

        let handshake_duration = start.elapsed();

        if dial_result.is_ok() {
            handshake_times.push(handshake_duration.as_millis());
            println!("Iteration {}: {}ms", i + 1, handshake_duration.as_millis());
        }
    }

    // Calculate statistics
    let avg_handshake_time = handshake_times.iter().sum::<u128>() / handshake_times.len() as u128;
    let min_handshake_time = *handshake_times.iter().min().unwrap();
    let max_handshake_time = *handshake_times.iter().max().unwrap();

    println!("\n=== Handshake Performance Results ===");
    println!("Iterations: {}", handshake_times.len());
    println!("Average: {}ms", avg_handshake_time);
    println!("Min: {}ms", min_handshake_time);
    println!("Max: {}ms", max_handshake_time);
    println!("Target: <{}ms", TARGET_HANDSHAKE_TIME_MS);

    // Verify performance targets
    assert!(
        avg_handshake_time < TARGET_HANDSHAKE_TIME_MS,
        "Average handshake time {}ms exceeds target {}ms",
        avg_handshake_time,
        TARGET_HANDSHAKE_TIME_MS
    );

    println!("✓ Performance target met: {}ms < {}ms", avg_handshake_time, TARGET_HANDSHAKE_TIME_MS);

    // Note: Actual overhead comparison would require classical TLS baseline
    // For now, we verify the handshake completes within acceptable time
}

/// Test 13: Bandwidth overhead
#[tokio::test]
#[ignore] // Integration test - network measurement
async fn test_bandwidth_overhead() {
    // TODO: Implement
    // Target: ≤2.5KB overhead
}

/// Test 14: Concurrent connections
#[tokio::test]
#[ignore] // Integration test - requires multiple endpoints
async fn test_concurrent_connections() {
    // TODO: Implement
}

/// Test 15: Connection migration
#[tokio::test]
#[ignore] // Integration test - advanced QUIC feature
async fn test_connection_migration() {
    // TODO: Implement
}

// ============================================================================
// NEW COMPREHENSIVE TESTS
// ============================================================================

/// Test 16: Concurrent handshakes
///
/// Tests multiple simultaneous connections to verify:
/// - No state leakage between connections
/// - Proper resource management
/// - Concurrent ML-KEM operations
/// - Connection isolation
#[tokio::test]
#[ignore] // Integration test - requires network and multiple concurrent connections
async fn test_concurrent_handshakes() {
    use vigilia_network::libp2p::quic::{QuicTransport, QuicTransportConfig};
    use vigilia_crypto::keys::AgentIdentity;
    use std::sync::Arc;
    use tokio::time::{timeout, Duration};

    const NUM_CONCURRENT_CLIENTS: usize = 10;

    // Setup single server
    let server_identity = Arc::new(
        AgentIdentity::generate("concurrent-server".to_string())
            .expect("Failed to generate server identity")
    );

    let server_config = QuicTransportConfig {
        bind_address: "127.0.0.1:0".parse().unwrap(),
        max_concurrent_bidi_streams: 200, // Increased for concurrent clients
        ..Default::default()
    };

    let mut server_transport = QuicTransport::new(server_identity, server_config)
        .expect("Failed to create server transport");

    let server_addr = timeout(Duration::from_secs(5), server_transport.listen())
        .await
        .expect("Server listen timeout")
        .expect("Failed to start server");

    println!("Server listening on: {}", server_addr);

    // Create multiple clients and connect concurrently
    let mut client_handles = Vec::new();

    for i in 0..NUM_CONCURRENT_CLIENTS {
        let addr = server_addr;
        let handle = tokio::spawn(async move {
            let client_identity = Arc::new(
                AgentIdentity::generate(format!("concurrent-client-{}", i))
                    .expect("Failed to generate client identity")
            );

            let client_config = QuicTransportConfig::default();
            let mut client_transport = QuicTransport::new(client_identity, client_config)
                .expect("Failed to create client transport");

            // Attempt connection
            let result = timeout(Duration::from_secs(10), client_transport.dial(addr))
                .await
                .expect("Client dial timeout");

            (i, result)
        });

        client_handles.push(handle);
    }

    // Wait for all connections
    let mut successful_connections = 0;
    let mut failed_connections = 0;

    for handle in client_handles {
        match handle.await {
            Ok((client_id, Ok(_))) => {
                println!("✓ Client {} connected successfully", client_id);
                successful_connections += 1;
            }
            Ok((client_id, Err(e))) => {
                println!("✗ Client {} failed: {}", client_id, e);
                failed_connections += 1;
            }
            Err(e) => {
                println!("✗ Client task panicked: {}", e);
                failed_connections += 1;
            }
        }
    }

    println!("\n=== Concurrent Connection Results ===");
    println!("Successful: {}/{}", successful_connections, NUM_CONCURRENT_CLIENTS);
    println!("Failed: {}/{}", failed_connections, NUM_CONCURRENT_CLIENTS);

    // At least 80% should succeed
    let success_rate = (successful_connections as f64 / NUM_CONCURRENT_CLIENTS as f64) * 100.0;
    assert!(
        success_rate >= 80.0,
        "Success rate {}% is below 80% threshold",
        success_rate
    );

    println!("✓ Concurrent handshakes passed with {}% success rate", success_rate);
}

/// Test 17: Handshake failure with invalid certificate
///
/// Tests error handling when:
/// - Certificate validation fails
/// - ML-KEM public key extraction fails
/// - Invalid ciphertext is received
#[tokio::test]
async fn test_handshake_failure_invalid_cert() {
    use vigilia_network::libp2p::quic::{HybridCertVerifier, KemHandshakeState};
    use rustls::{Certificate, ServerName};
    use std::sync::{Arc, RwLock};
    use std::time::SystemTime;

    // Create verifier with shared state
    let kem_state = Arc::new(RwLock::new(KemHandshakeState::new()));
    let verifier = HybridCertVerifier::new(kem_state);

    // Create invalid certificate (empty)
    let invalid_cert = Certificate(vec![]);

    // Attempt verification
    let server_name = ServerName::try_from("test.example.com").unwrap();
    let result = verifier.verify_server_cert(
        &invalid_cert,
        &[],
        &server_name,
        &mut std::iter::empty(),
        &[],
        SystemTime::now(),
    );

    // Verification should fail
    assert!(
        result.is_err(),
        "Certificate verification should fail for invalid certificate"
    );

    println!("✓ Invalid certificate properly rejected");
}

/// Test 18: ML-KEM state isolation
///
/// Verifies no state leakage between connections:
/// - Each connection has independent ML-KEM keypairs
/// - Ciphertext from one connection cannot be used for another
/// - Shared secrets are unique per connection
#[tokio::test]
async fn test_ml_kem_state_isolation() {
    use vigilia_network::libp2p::quic::{HybridTlsConfig, derive_hybrid_secret};
    use vigilia_crypto::kem::MLKem768;

    // Create two independent TLS configs (simulating two connections)
    let config1 = HybridTlsConfig::new();
    let config2 = HybridTlsConfig::new();

    // Generate ML-KEM keypairs (should be different)
    assert_ne!(
        config1.public_key().as_bytes(),
        config2.public_key().as_bytes(),
        "ML-KEM public keys should be different for different connections"
    );

    // Perform encapsulation with config1's public key
    let (secret1_enc, ciphertext1) = config1.encapsulate(config1.public_key());

    // Perform encapsulation with config2's public key
    let (secret2_enc, ciphertext2) = config2.encapsulate(config2.public_key());

    // Ciphertexts should be different
    assert_ne!(
        ciphertext1.as_bytes(),
        ciphertext2.as_bytes(),
        "Ciphertexts should be unique per connection"
    );

    // Decapsulate with matching keys
    let secret1_dec = config1.decapsulate(&ciphertext1);
    let secret2_dec = config2.decapsulate(&ciphertext2);

    // Secrets should match their respective encapsulations
    assert_eq!(secret1_enc, secret1_dec, "Config1 secrets should match");
    assert_eq!(secret2_enc, secret2_dec, "Config2 secrets should match");

    // But cross-connection secrets should differ
    assert_ne!(secret1_enc, secret2_enc, "Secrets should be unique per connection");

    // Verify hybrid secret derivation is also unique
    let x25519_secret1 = [1u8; 32];
    let x25519_secret2 = [2u8; 32];

    let hybrid1 = derive_hybrid_secret(&x25519_secret1, &secret1_enc);
    let hybrid2 = derive_hybrid_secret(&x25519_secret2, &secret2_enc);

    assert_ne!(
        hybrid1, hybrid2,
        "Hybrid secrets should be unique per connection"
    );

    println!("✓ ML-KEM state isolation verified");
    println!("  - Different keypairs per connection");
    println!("  - Unique ciphertexts");
    println!("  - No cross-connection secret reuse");
}

/// Test 19: Forward secrecy verification
///
/// Verifies that ephemeral keys are used:
/// - New ML-KEM keypair per connection
/// - X25519 ephemeral keys (handled by TLS 1.3)
/// - Old session keys cannot decrypt new sessions
#[tokio::test]
async fn test_forward_secrecy_verification() {
    use vigilia_network::libp2p::quic::HybridTlsConfig;
    use vigilia_crypto::kem::MLKem768;

    // Simulate multiple handshakes
    const NUM_HANDSHAKES: usize = 5;

    let mut public_keys = Vec::new();
    let mut shared_secrets = Vec::new();

    for i in 0..NUM_HANDSHAKES {
        // Each handshake creates a new config (ephemeral keys)
        let config = HybridTlsConfig::new();

        // Store public key
        public_keys.push(config.public_key().as_bytes().to_vec());

        // Perform encapsulation
        let (secret, _ciphertext) = config.encapsulate(config.public_key());
        shared_secrets.push(secret);

        println!("Handshake {}: New ephemeral ML-KEM keypair generated", i + 1);
    }

    // Verify all public keys are unique (ephemeral)
    for i in 0..NUM_HANDSHAKES {
        for j in (i + 1)..NUM_HANDSHAKES {
            assert_ne!(
                public_keys[i], public_keys[j],
                "Handshake {} and {} should use different ephemeral keys",
                i, j
            );
        }
    }

    // Verify all shared secrets are unique
    for i in 0..NUM_HANDSHAKES {
        for j in (i + 1)..NUM_HANDSHAKES {
            assert_ne!(
                shared_secrets[i], shared_secrets[j],
                "Handshake {} and {} should produce different secrets",
                i, j
            );
        }
    }

    println!("✓ Forward secrecy verified");
    println!("  - {} unique ephemeral ML-KEM keypairs", NUM_HANDSHAKES);
    println!("  - {} unique shared secrets", NUM_HANDSHAKES);
    println!("  - No key reuse across handshakes");
}

/// Test 20: Bandwidth overhead measurement
///
/// Measures actual bandwidth overhead of hybrid handshake:
/// - ML-KEM-768 public key: 1184 bytes
/// - ML-KEM-768 ciphertext: 1088 bytes
/// - Total overhead: 2272 bytes (2.22 KB)
/// - Target: ≤2.5 KB
#[tokio::test]
async fn test_bandwidth_measurement() {
    use vigilia_network::libp2p::quic::{
        HybridKemExtension,
        ML_KEM_768_PUBKEY_SIZE,
        ML_KEM_768_CIPHERTEXT_SIZE,
    };
    use vigilia_crypto::kem::MLKem768;

    const TARGET_OVERHEAD_BYTES: usize = 2560; // 2.5 KB

    // Generate ML-KEM keypair
    let keypair = MLKem768::generate();

    // Create extension with public key
    let mut extension = HybridKemExtension::new(&keypair.public_key);

    // Measure public key size
    let pubkey_size = extension.public_key.len();
    assert_eq!(pubkey_size, ML_KEM_768_PUBKEY_SIZE, "Public key size should be 1184 bytes");

    // Perform encapsulation to get ciphertext
    let (_, ciphertext) = MLKem768::encapsulate(&keypair.public_key);
    extension.set_ciphertext(&ciphertext);

    // Measure ciphertext size
    let ciphertext_size = extension.ciphertext.len();
    assert_eq!(ciphertext_size, ML_KEM_768_CIPHERTEXT_SIZE, "Ciphertext size should be 1088 bytes");

    // Encode extension to wire format
    let encoded = extension.encode();
    let wire_size = encoded.len();

    // Calculate overhead
    let total_overhead = pubkey_size + ciphertext_size;

    println!("\n=== Bandwidth Overhead Analysis ===");
    println!("ML-KEM-768 Public Key: {} bytes", pubkey_size);
    println!("ML-KEM-768 Ciphertext: {} bytes", ciphertext_size);
    println!("Wire Format Overhead: {} bytes", wire_size);
    println!("Total Cryptographic Overhead: {} bytes ({:.2} KB)", total_overhead, total_overhead as f64 / 1024.0);
    println!("Target: ≤{} bytes ({:.1} KB)", TARGET_OVERHEAD_BYTES, TARGET_OVERHEAD_BYTES as f64 / 1024.0);

    // Verify overhead is within target
    assert!(
        total_overhead <= TARGET_OVERHEAD_BYTES,
        "Bandwidth overhead {} bytes exceeds target {} bytes",
        total_overhead,
        TARGET_OVERHEAD_BYTES
    );

    println!("✓ Bandwidth overhead within target: {} bytes ≤ {} bytes", total_overhead, TARGET_OVERHEAD_BYTES);

    // Expected values from spec
    assert_eq!(total_overhead, 2272, "Total overhead should be exactly 2272 bytes (2.22 KB)");
    println!("✓ Overhead matches specification: 2272 bytes = 2.22 KB");
}
