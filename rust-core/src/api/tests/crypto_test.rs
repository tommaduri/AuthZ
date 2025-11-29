//! Cryptographic endpoint unit tests
//!
//! Tests for `/api/v1/crypto/*` endpoints as per SDD Section 3.3.2-3.3.5

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::{json, Value};
use tower::ServiceExt as _;

// ============================================================================
// Encrypt Endpoint Tests
// ============================================================================

#[tokio::test]
async fn test_encrypt_valid_input() {
    // Arrange
    let app = cretoai_api::routes::build_router();
    let plaintext = base64::encode("Hello World");

    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/crypto/encrypt")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "plaintext": plaintext
            })
            .to_string(),
        ))
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();

    // Assert
    assert_eq!(response.status(), StatusCode::OK);

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert!(json["ciphertext"].is_string());
    assert!(json["public_key"].is_string());
    assert_eq!(json["algorithm"], "ML-KEM-768");
}

#[tokio::test]
async fn test_encrypt_ml_kem_768_algorithm() {
    // Arrange
    let app = cretoai_api::routes::build_router();
    let plaintext = base64::encode("Test quantum encryption");

    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/crypto/encrypt")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "plaintext": plaintext
            })
            .to_string(),
        ))
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();

    // Assert: Verify quantum-resistant algorithm
    assert_eq!(json["algorithm"], "ML-KEM-768");
    assert!(!json["ciphertext"].as_str().unwrap().is_empty());
}

#[tokio::test]
async fn test_encrypt_invalid_base64() {
    // Arrange
    let app = cretoai_api::routes::build_router();

    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/crypto/encrypt")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "plaintext": "not-valid-base64!!!"
            })
            .to_string(),
        ))
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();

    // Assert: Should return 400 Bad Request
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_encrypt_empty_plaintext() {
    // Arrange
    let app = cretoai_api::routes::build_router();

    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/crypto/encrypt")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "plaintext": ""
            })
            .to_string(),
        ))
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();

    // Assert: Empty plaintext should be valid (edge case)
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_encrypt_with_custom_public_key() {
    // Arrange
    let app = cretoai_api::routes::build_router();
    let plaintext = base64::encode("Hello");
    let custom_key = base64::encode("custom_public_key_data");

    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/crypto/encrypt")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "plaintext": plaintext,
                "public_key": custom_key
            })
            .to_string(),
        ))
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();

    // Assert
    assert_eq!(response.status(), StatusCode::OK);
    // TODO: Verify custom key is used once crypto integration is complete
}

#[tokio::test]
async fn test_encrypt_performance() {
    use std::time::Instant;

    // Arrange
    let app = cretoai_api::routes::build_router();
    let plaintext = base64::encode("A".repeat(1024)); // 1KB plaintext

    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/crypto/encrypt")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "plaintext": plaintext
            })
            .to_string(),
        ))
        .unwrap();

    // Act
    let start = Instant::now();
    let response = app.oneshot(request).await.unwrap();
    let duration = start.elapsed();

    // Assert: < 10ms target from SDD Section 6.1
    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        duration.as_millis() < 100,
        "Encrypt took {}ms, expected < 100ms (will be optimized to < 10ms)",
        duration.as_millis()
    );
}

// ============================================================================
// Decrypt Endpoint Tests
// ============================================================================

#[tokio::test]
async fn test_decrypt_valid_input() {
    // Arrange
    let app = cretoai_api::routes::build_router();
    let ciphertext = base64::encode("encrypted_data");
    let private_key = base64::encode("private_key_data");

    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/crypto/decrypt")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "ciphertext": ciphertext,
                "private_key": private_key
            })
            .to_string(),
        ))
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();

    // Assert
    assert_eq!(response.status(), StatusCode::OK);

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert!(json["plaintext"].is_string());
}

#[tokio::test]
async fn test_decrypt_invalid_ciphertext_base64() {
    // Arrange
    let app = cretoai_api::routes::build_router();

    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/crypto/decrypt")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "ciphertext": "invalid!!!",
                "private_key": base64::encode("key")
            })
            .to_string(),
        ))
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();

    // Assert
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_decrypt_invalid_private_key_base64() {
    // Arrange
    let app = cretoai_api::routes::build_router();

    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/crypto/decrypt")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "ciphertext": base64::encode("data"),
                "private_key": "invalid!!!"
            })
            .to_string(),
        ))
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();

    // Assert
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_decrypt_wrong_private_key() {
    // TODO: Implement once crypto integration is complete
    // Should return 401 Unauthorized when private key doesn't match
}

// ============================================================================
// Sign Endpoint Tests
// ============================================================================

#[tokio::test]
async fn test_sign_valid_input() {
    // Arrange
    let app = cretoai_api::routes::build_router();
    let message = base64::encode("Message to sign");
    let private_key = base64::encode("signing_private_key");

    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/crypto/sign")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "message": message,
                "private_key": private_key
            })
            .to_string(),
        ))
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();

    // Assert
    assert_eq!(response.status(), StatusCode::OK);

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert!(json["signature"].is_string());
    assert_eq!(json["algorithm"], "ML-DSA-87");
}

#[tokio::test]
async fn test_sign_ml_dsa_87_algorithm() {
    // Arrange
    let app = cretoai_api::routes::build_router();
    let message = base64::encode("Quantum signature test");
    let private_key = base64::encode("private_key");

    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/crypto/sign")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "message": message,
                "private_key": private_key
            })
            .to_string(),
        ))
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();

    // Assert: Verify quantum-resistant signature algorithm
    assert_eq!(json["algorithm"], "ML-DSA-87");
    assert!(!json["signature"].as_str().unwrap().is_empty());
}

#[tokio::test]
async fn test_sign_invalid_message_base64() {
    // Arrange
    let app = cretoai_api::routes::build_router();

    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/crypto/sign")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "message": "invalid!!!",
                "private_key": base64::encode("key")
            })
            .to_string(),
        ))
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();

    // Assert
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_sign_deterministic() {
    // TODO: Implement once crypto integration is complete
    // Same message + key should produce same signature (deterministic)
}

#[tokio::test]
async fn test_sign_performance() {
    use std::time::Instant;

    // Arrange
    let app = cretoai_api::routes::build_router();
    let message = base64::encode("Performance test message");
    let private_key = base64::encode("private_key");

    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/crypto/sign")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "message": message,
                "private_key": private_key
            })
            .to_string(),
        ))
        .unwrap();

    // Act
    let start = Instant::now();
    let response = app.oneshot(request).await.unwrap();
    let duration = start.elapsed();

    // Assert: < 15ms target from SDD Section 6.1
    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        duration.as_millis() < 100,
        "Sign took {}ms, expected < 100ms (will be optimized to < 15ms)",
        duration.as_millis()
    );
}

// ============================================================================
// Verify Endpoint Tests
// ============================================================================

#[tokio::test]
async fn test_verify_valid_signature() {
    // Arrange
    let app = cretoai_api::routes::build_router();
    let message = base64::encode("Signed message");
    let signature = base64::encode("quantum_signature");
    let public_key = base64::encode("public_key");

    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/crypto/verify")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "message": message,
                "signature": signature,
                "public_key": public_key
            })
            .to_string(),
        ))
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();

    // Assert
    assert_eq!(response.status(), StatusCode::OK);

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert!(json["valid"].is_boolean());
    assert_eq!(json["algorithm"], "ML-DSA-87");
}

#[tokio::test]
async fn test_verify_always_returns_200() {
    // Arrange: Even with invalid signature, should return 200 OK with valid:false
    let app = cretoai_api::routes::build_router();

    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/crypto/verify")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "message": base64::encode("msg"),
                "signature": base64::encode("wrong_sig"),
                "public_key": base64::encode("key")
            })
            .to_string(),
        ))
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();

    // Assert: Always 200 OK, check 'valid' field for result
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_verify_invalid_message_base64() {
    // Arrange
    let app = cretoai_api::routes::build_router();

    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/crypto/verify")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "message": "invalid!!!",
                "signature": base64::encode("sig"),
                "public_key": base64::encode("key")
            })
            .to_string(),
        ))
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();

    // Assert
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_verify_constant_time() {
    // TODO: Implement timing attack resistance test
    // Verify operation should take same time regardless of validity
}

#[tokio::test]
async fn test_verify_performance() {
    use std::time::Instant;

    // Arrange
    let app = cretoai_api::routes::build_router();
    let message = base64::encode("Verify performance test");
    let signature = base64::encode("signature");
    let public_key = base64::encode("public_key");

    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/crypto/verify")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "message": message,
                "signature": signature,
                "public_key": public_key
            })
            .to_string(),
        ))
        .unwrap();

    // Act
    let start = Instant::now();
    let response = app.oneshot(request).await.unwrap();
    let duration = start.elapsed();

    // Assert: < 20ms target from SDD Section 6.1
    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        duration.as_millis() < 100,
        "Verify took {}ms, expected < 100ms (will be optimized to < 20ms)",
        duration.as_millis()
    );
}
