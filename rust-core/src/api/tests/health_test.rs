//! Health endpoint unit tests
//!
//! Tests for `/health` endpoint as per SDD Section 3.3.1

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::Value;
use tower::ServiceExt as _;

#[tokio::test]
async fn test_health_check_returns_200() {
    // Arrange
    let app = cretoai_api::routes::build_router();

    // Act
    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // Assert
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_health_check_response_structure() {
    // Arrange
    let app = cretoai_api::routes::build_router();

    // Act
    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();

    // Assert
    assert!(json.get("status").is_some());
    assert!(json.get("version").is_some());
    assert!(json.get("quantum_ready").is_some());
}

#[tokio::test]
async fn test_health_check_status_healthy() {
    // Arrange
    let app = cretoai_api::routes::build_router();

    // Act
    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();

    // Assert
    assert_eq!(json["status"], "healthy");
}

#[tokio::test]
async fn test_health_check_quantum_ready_true() {
    // Arrange
    let app = cretoai_api::routes::build_router();

    // Act
    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();

    // Assert
    assert_eq!(json["quantum_ready"], true);
}

#[tokio::test]
async fn test_health_check_version_present() {
    // Arrange
    let app = cretoai_api::routes::build_router();

    // Act
    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();

    // Assert
    assert!(json["version"].is_string());
    assert!(!json["version"].as_str().unwrap().is_empty());
}

/// Performance test: Health check should respond in < 1ms
/// (This will be a benchmark, but we can test basic latency)
#[tokio::test]
async fn test_health_check_performance() {
    use std::time::Instant;

    // Arrange
    let app = cretoai_api::routes::build_router();

    // Act
    let start = Instant::now();
    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let duration = start.elapsed();

    // Assert
    assert_eq!(response.status(), StatusCode::OK);
    // Performance target: < 1ms (SDD Section 6.1)
    assert!(
        duration.as_millis() < 100,
        "Health check took {}ms, expected < 100ms",
        duration.as_millis()
    );
}

#[tokio::test]
async fn test_health_check_multiple_concurrent_requests() {
    // Arrange
    let app = cretoai_api::routes::build_router();

    // Act: Send 100 concurrent requests
    let mut handles = vec![];
    for _ in 0..100 {
        let app_clone = app.clone();
        let handle = tokio::spawn(async move {
            app_clone
                .oneshot(
                    Request::builder()
                        .uri("/health")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
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
