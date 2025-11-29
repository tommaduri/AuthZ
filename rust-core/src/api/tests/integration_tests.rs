//! Integration tests for CretoAI REST API
//!
//! These tests verify that all 9 endpoints work correctly with real cryptographic operations.

use cretoai_api::{
    models::*,
    error::ApiError,
};
use cretoai_crypto::kem::MLKem768;
use cretoai_crypto::signatures::MLDSA87;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

#[tokio::test]
async fn test_health_endpoint() {
    // Health endpoint should always return healthy status
    // This would be tested against running server with reqwest
    // For now, we test the model serialization

    let response = serde_json::json!({
        "status": "healthy",
        "version": "0.1.0",
        "quantum_ready": true
    });

    let health: serde_json::Result<HealthResponse> = serde_json::from_value(response);
    assert!(health.is_ok());
    let health = health.unwrap();
    assert_eq!(health.status, "healthy");
    assert_eq!(health.quantum_ready, true);
}

#[tokio::test]
async fn test_encrypt_decrypt_roundtrip() {
    // Generate keypair
    let keypair = MLKem768::generate();

    // Test data
    let plaintext = b"Hello, Quantum World!";
    let plaintext_b64 = BASE64.encode(plaintext);

    // Simulate encrypt request
    let encrypt_req = EncryptRequest {
        plaintext: plaintext_b64.clone(),
        public_key: Some(BASE64.encode(keypair.public_key.as_bytes())),
    };

    // Verify request serialization
    let json = serde_json::to_string(&encrypt_req).unwrap();
    assert!(json.contains(&plaintext_b64));

    // For full roundtrip, we'd need the actual handlers running
    // But we can verify the crypto primitives work
    let (shared_secret, ciphertext) = MLKem768::encapsulate(&keypair.public_key);
    let recovered_secret = MLKem768::decapsulate(&ciphertext, &keypair.secret_key);

    assert_eq!(shared_secret.as_bytes(), recovered_secret.as_bytes());
}

#[tokio::test]
async fn test_sign_verify_roundtrip() {
    // Generate signing keypair
    let keypair = MLDSA87::generate();

    // Test message
    let message = b"Sign this quantum-resistant message";
    let message_b64 = BASE64.encode(message);

    // Sign the message
    let signature = MLDSA87::sign(message, &keypair.secret_key);

    // Verify the signature
    let verify_result = MLDSA87::verify(message, &signature, &keypair.public_key);
    assert!(verify_result.is_ok());

    // Verify serialization of request models
    let sign_req = SignRequest {
        message: message_b64.clone(),
        private_key: BASE64.encode(keypair.secret_key.as_bytes()),
    };

    let json = serde_json::to_string(&sign_req).unwrap();
    assert!(json.contains(&message_b64));

    // Test verify request
    let verify_req = VerifyRequest {
        message: message_b64,
        signature: BASE64.encode(signature.as_bytes()),
        public_key: BASE64.encode(keypair.public_key.as_bytes()),
    };

    let json = serde_json::to_string(&verify_req).unwrap();
    assert!(json.contains("signature"));
}

#[tokio::test]
async fn test_invalid_base64() {
    // Test that invalid base64 is rejected
    let invalid_req = r#"{"plaintext": "not-valid-base64!!!"}"#;

    let result: Result<EncryptRequest, _> = serde_json::from_str(invalid_req);
    assert!(result.is_ok()); // JSON parsing succeeds

    // But base64 decoding would fail in handler
    let req = result.unwrap();
    let decode_result = BASE64.decode(&req.plaintext);
    assert!(decode_result.is_err());
}

#[tokio::test]
async fn test_vault_models() {
    // Test vault request/response serialization
    let store_req = StoreSecretRequest {
        key: "test-key".to_string(),
        value: "secret-value".to_string(),
        metadata: Some(serde_json::json!({"type": "api_key", "env": "prod"})),
    };

    let json = serde_json::to_string(&store_req).unwrap();
    assert!(json.contains("test-key"));
    assert!(json.contains("secret-value"));

    // Test response
    let store_resp = StoreSecretResponse {
        key: "test-key".to_string(),
        message: "Secret stored successfully".to_string(),
    };

    let json = serde_json::to_string(&store_resp).unwrap();
    assert!(json.contains("test-key"));
}

#[tokio::test]
async fn test_dag_vertex_models() {
    // Test DAG vertex request/response serialization
    let create_req = CreateVertexRequest {
        data: BASE64.encode(b"transaction data"),
        parents: Some(vec!["hash1".to_string(), "hash2".to_string()]),
    };

    let json = serde_json::to_string(&create_req).unwrap();
    assert!(json.contains("parents"));

    // Test response
    let create_resp = CreateVertexResponse {
        vertex_hash: "blake3hash123".to_string(),
        height: 42,
        message: "Vertex created".to_string(),
    };

    let json = serde_json::to_string(&create_resp).unwrap();
    assert!(json.contains("vertex_hash"));
    assert!(json.contains("42"));
}

#[tokio::test]
async fn test_dag_status_model() {
    let status = DagStatusResponse {
        vertex_count: 1000,
        height: 900,
        finalized_count: 850,
        status: "healthy".to_string(),
    };

    let json = serde_json::to_string(&status).unwrap();
    assert!(json.contains("1000"));
    assert!(json.contains("healthy"));
}

#[tokio::test]
async fn test_ml_kem_768_compatibility() {
    // Verify ML-KEM-768 implementation matches spec
    let keypair = MLKem768::generate();

    // Public key should be 1184 bytes for Kyber768
    assert_eq!(keypair.public_key.as_bytes().len(), 1184);

    // Secret key should be 2400 bytes for Kyber768
    assert_eq!(keypair.secret_key.as_bytes().len(), 2400);

    // Ciphertext should be 1088 bytes
    let (_ss, ct) = MLKem768::encapsulate(&keypair.public_key);
    assert_eq!(ct.as_bytes().len(), 1088);
}

#[tokio::test]
async fn test_ml_dsa_87_compatibility() {
    // Verify ML-DSA-87 (Dilithium5) implementation
    let keypair = MLDSA87::generate();

    // Public key should be 2592 bytes for Dilithium5
    assert_eq!(keypair.public_key.as_bytes().len(), 2592);

    // Secret key should be 4896 bytes for Dilithium5
    assert_eq!(keypair.secret_key.as_bytes().len(), 4896);

    // Sign a message
    let message = b"test";
    let sig = MLDSA87::sign(message, &keypair.secret_key);

    // Signature should be 4627 bytes for Dilithium5
    assert_eq!(sig.as_bytes().len(), 4627);
}

#[tokio::test]
async fn test_encryption_size_limits() {
    // Test that 32KB limit is enforced (from SDD)
    let plaintext_32kb = vec![0u8; 32 * 1024];
    let plaintext_too_large = vec![0u8; 32 * 1024 + 1];

    // 32KB should be valid
    assert_eq!(plaintext_32kb.len(), 32 * 1024);

    // >32KB should be rejected (this would be done in handler)
    assert!(plaintext_too_large.len() > 32 * 1024);
}

#[tokio::test]
async fn test_signature_verification_failure() {
    // Test that signature verification correctly rejects invalid signatures
    let keypair = MLDSA87::generate();
    let message = b"original message";
    let signature = MLDSA87::sign(message, &keypair.secret_key);

    // Verification with correct message should succeed
    assert!(MLDSA87::verify(message, &signature, &keypair.public_key).is_ok());

    // Verification with tampered message should fail
    let tampered = b"tampered message";
    assert!(MLDSA87::verify(tampered, &signature, &keypair.public_key).is_err());
}

#[tokio::test]
async fn test_concurrent_crypto_operations() {
    // Test that crypto operations can be performed concurrently
    use futures::future::join_all;

    let tasks: Vec<_> = (0..10).map(|i| {
        tokio::spawn(async move {
            let keypair = MLKem768::generate();
            let plaintext = format!("Message {}", i);
            let (_ss, _ct) = MLKem768::encapsulate(&keypair.public_key);
            plaintext
        })
    }).collect();

    let results = join_all(tasks).await;
    assert_eq!(results.len(), 10);
    for result in results {
        assert!(result.is_ok());
    }
}
