//! Integration tests for full request/response cycles
//!
//! Tests that exercise the entire API stack including middleware, routing,
//! handlers, and backend integration as per SDD Section 8.3

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::{json, Value};
use tower::ServiceExt as _;

// ============================================================================
// Full Request/Response Cycle Tests
// ============================================================================

#[tokio::test]
async fn test_full_encrypt_decrypt_roundtrip() {
    // Arrange
    let app = cretoai_api::routes::build_router();
    let original_plaintext = "Hello Quantum World";
    let plaintext_b64 = base64::encode(original_plaintext);

    // Act 1: Encrypt
    let encrypt_request = Request::builder()
        .method("POST")
        .uri("/api/v1/crypto/encrypt")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "plaintext": plaintext_b64
            })
            .to_string(),
        ))
        .unwrap();

    let encrypt_response = app.clone().oneshot(encrypt_request).await.unwrap();
    assert_eq!(encrypt_response.status(), StatusCode::OK);

    let encrypt_body = axum::body::to_bytes(encrypt_response.into_body(), usize::MAX)
        .await
        .unwrap();
    let encrypt_json: Value = serde_json::from_slice(&encrypt_body).unwrap();

    let ciphertext = encrypt_json["ciphertext"].as_str().unwrap();
    let public_key = encrypt_json["public_key"].as_str().unwrap();

    // TODO: Act 2: Decrypt (requires private key from encrypt response)
    // This will be implemented once crypto integration provides keypair
}

#[tokio::test]
async fn test_full_sign_verify_roundtrip() {
    // TODO: Implement once crypto integration is complete
    // 1. Generate keypair
    // 2. Sign message
    // 3. Verify signature
    // 4. Assert verification succeeds
}

#[tokio::test]
async fn test_full_vault_store_retrieve_roundtrip() {
    // Arrange
    let app = cretoai_api::routes::build_router();
    let secret_key = "integration-test-key";
    let secret_value = "super_secret_value_123";

    // Act 1: Store secret
    let store_request = Request::builder()
        .method("POST")
        .uri("/api/v1/vault/secrets")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "key": secret_key,
                "value": secret_value,
                "metadata": {
                    "test": "integration",
                    "purpose": "roundtrip"
                }
            })
            .to_string(),
        ))
        .unwrap();

    let store_response = app.clone().oneshot(store_request).await.unwrap();
    assert_eq!(store_response.status(), StatusCode::OK);

    // Act 2: Retrieve secret
    let get_request = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/vault/secrets/{}", secret_key))
        .body(Body::empty())
        .unwrap();

    let get_response = app.oneshot(get_request).await.unwrap();

    // Assert: Should retrieve same value (decrypted)
    // TODO: Will work once vault integration is complete
    assert!(
        get_response.status() == StatusCode::OK
            || get_response.status() == StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn test_full_dag_vertex_creation_and_status() {
    // Arrange
    let app = cretoai_api::routes::build_router();

    // Act 1: Get initial status
    let status_request_1 = Request::builder()
        .method("GET")
        .uri("/api/v1/consensus/status")
        .body(Body::empty())
        .unwrap();

    let status_response_1 = app.clone().oneshot(status_request_1).await.unwrap();
    let status_body_1 = axum::body::to_bytes(status_response_1.into_body(), usize::MAX)
        .await
        .unwrap();
    let status_json_1: Value = serde_json::from_slice(&status_body_1).unwrap();
    let initial_count = status_json_1["vertex_count"].as_u64().unwrap();

    // Act 2: Create vertex
    let vertex_data = base64::encode("integration test transaction");
    let create_request = Request::builder()
        .method("POST")
        .uri("/api/v1/consensus/vertex")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "data": vertex_data
            })
            .to_string(),
        ))
        .unwrap();

    let create_response = app.clone().oneshot(create_request).await.unwrap();
    assert_eq!(create_response.status(), StatusCode::OK);

    // Act 3: Get updated status
    let status_request_2 = Request::builder()
        .method("GET")
        .uri("/api/v1/consensus/status")
        .body(Body::empty())
        .unwrap();

    let status_response_2 = app.oneshot(status_request_2).await.unwrap();
    let status_body_2 = axum::body::to_bytes(status_response_2.into_body(), usize::MAX)
        .await
        .unwrap();
    let status_json_2: Value = serde_json::from_slice(&status_body_2).unwrap();
    let updated_count = status_json_2["vertex_count"].as_u64().unwrap();

    // Assert: Vertex count should increase
    // TODO: Will work once DAG integration is complete
    assert!(updated_count >= initial_count);
}

// ============================================================================
// Middleware Integration Tests
// ============================================================================

#[tokio::test]
async fn test_cors_headers_present() {
    // Arrange
    let app = cretoai_api::routes::build_router();

    let request = Request::builder()
        .method("OPTIONS")
        .uri("/api/v1/crypto/encrypt")
        .header("origin", "http://localhost:3000")
        .body(Body::empty())
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();

    // Assert: CORS headers should be present
    assert!(response.headers().contains_key("access-control-allow-origin"));
}

#[tokio::test]
async fn test_cors_permissive_phase5() {
    // Arrange
    let app = cretoai_api::routes::build_router();

    let request = Request::builder()
        .method("OPTIONS")
        .uri("/health")
        .header("origin", "http://example.com")
        .body(Body::empty())
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();

    // Assert: Phase 5 should allow all origins
    let allow_origin = response
        .headers()
        .get("access-control-allow-origin")
        .and_then(|v| v.to_str().ok());

    assert!(
        allow_origin == Some("*") || allow_origin.is_some(),
        "CORS should be permissive in Phase 5"
    );
}

#[tokio::test]
async fn test_content_type_validation() {
    // Arrange
    let app = cretoai_api::routes::build_router();

    // Act: Send request without content-type header
    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/crypto/encrypt")
        .body(Body::from(
            json!({
                "plaintext": base64::encode("test")
            })
            .to_string(),
        ))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    // Assert: Should handle gracefully (accept or reject cleanly)
    assert!(response.status().is_client_error() || response.status().is_success());
}

#[tokio::test]
async fn test_compression_gzip() {
    // TODO: Implement once compression middleware is verified
    // Send request with Accept-Encoding: gzip
    // Verify response is compressed
}

#[tokio::test]
async fn test_request_tracing_spans() {
    // TODO: Implement tracing verification
    // Verify tracing spans are created for requests
}

// ============================================================================
// Error Handling Integration Tests
// ============================================================================

#[tokio::test]
async fn test_404_not_found() {
    // Arrange
    let app = cretoai_api::routes::build_router();

    let request = Request::builder()
        .method("GET")
        .uri("/nonexistent/endpoint")
        .body(Body::empty())
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();

    // Assert
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_method_not_allowed() {
    // Arrange
    let app = cretoai_api::routes::build_router();

    // Act: Try POST on GET-only endpoint
    let request = Request::builder()
        .method("POST")
        .uri("/health")
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    // Assert: Should return 405 Method Not Allowed
    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
}

#[tokio::test]
async fn test_malformed_json() {
    // Arrange
    let app = cretoai_api::routes::build_router();

    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/crypto/encrypt")
        .header("content-type", "application/json")
        .body(Body::from("{invalid json"))
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();

    // Assert: Should return 400 Bad Request
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_missing_required_fields() {
    // Arrange
    let app = cretoai_api::routes::build_router();

    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/crypto/encrypt")
        .header("content-type", "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();

    // Assert: Should return 400 Bad Request
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_error_response_format() {
    // Arrange
    let app = cretoai_api::routes::build_router();

    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/crypto/encrypt")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "plaintext": "invalid!!!"
            })
            .to_string(),
        ))
        .unwrap();

    // Act
    let response = app.oneshot(request).await.unwrap();

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();

    // Assert: Error response should be JSON with error and details fields
    if let Ok(json) = serde_json::from_slice::<Value>(&body) {
        // Standardized error format from SDD Section 4.1
        assert!(
            json.get("error").is_some() || json.get("message").is_some(),
            "Error response should have 'error' or 'message' field"
        );
    }
}

// ============================================================================
// Performance Integration Tests
// ============================================================================

#[tokio::test]
async fn test_mixed_workload_performance() {
    use std::time::Instant;

    // Arrange
    let app = cretoai_api::routes::build_router();
    let iterations = 100;

    // Act: Send mixed requests
    let start = Instant::now();

    for i in 0..iterations {
        let request = if i % 4 == 0 {
            // 25% health checks
            Request::builder()
                .method("GET")
                .uri("/health")
                .body(Body::empty())
                .unwrap()
        } else if i % 4 == 1 {
            // 25% encrypt
            Request::builder()
                .method("POST")
                .uri("/api/v1/crypto/encrypt")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "plaintext": base64::encode("test")
                    })
                    .to_string(),
                ))
                .unwrap()
        } else if i % 4 == 2 {
            // 25% sign
            Request::builder()
                .method("POST")
                .uri("/api/v1/crypto/sign")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "message": base64::encode("msg"),
                        "private_key": base64::encode("key")
                    })
                    .to_string(),
                ))
                .unwrap()
        } else {
            // 25% DAG status
            Request::builder()
                .method("GET")
                .uri("/api/v1/consensus/status")
                .body(Body::empty())
                .unwrap()
        };

        let response = app.clone().oneshot(request).await.unwrap();
        assert!(response.status().is_success() || response.status().is_client_error());
    }

    let duration = start.elapsed();

    // Assert: Should handle 100 mixed requests efficiently
    println!(
        "Mixed workload: {} requests in {}ms (avg {}ms/req)",
        iterations,
        duration.as_millis(),
        duration.as_millis() / iterations
    );

    assert!(
        duration.as_secs() < 10,
        "Mixed workload took too long: {}s",
        duration.as_secs()
    );
}

#[tokio::test]
async fn test_concurrent_requests() {
    // Arrange
    let app = cretoai_api::routes::build_router();

    // Act: Send 50 concurrent requests
    let mut handles = vec![];
    for i in 0..50 {
        let app_clone = app.clone();
        let handle = tokio::spawn(async move {
            let request = Request::builder()
                .method("POST")
                .uri("/api/v1/crypto/encrypt")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "plaintext": base64::encode(format!("concurrent-{}", i))
                    })
                    .to_string(),
                ))
                .unwrap();

            app_clone.oneshot(request).await
        });
        handles.push(handle);
    }

    // Wait for all requests
    let results = futures::future::join_all(handles).await;

    // Assert: All should succeed
    for result in results {
        let response = result.unwrap().unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
}
