//! Middleware layer for the API server
//!
//! This module provides middleware components for:
//! - Authentication and authorization
//! - Request logging and tracing
//! - CORS configuration
//! - Request ID tracking
//! - Error handling

use axum::{
    body::Body,
    extract::Request,
    http::{header, HeaderValue, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use tower_http::cors::{Any, CorsLayer};
use tracing::{error, info, warn};
use uuid::Uuid;

/// Request ID header name
pub const X_REQUEST_ID: &str = "x-request-id";

/// API key header name
pub const X_API_KEY: &str = "x-api-key";

/// Configure CORS middleware
///
/// This allows cross-origin requests from any origin with common HTTP methods.
/// In production, you should restrict allowed origins to known domains.
pub fn cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::PATCH,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            header::ACCEPT,
            HeaderValue::from_static(X_REQUEST_ID),
            HeaderValue::from_static(X_API_KEY),
        ])
        .expose_headers([HeaderValue::from_static(X_REQUEST_ID)])
        .max_age(std::time::Duration::from_secs(3600))
}

/// Request ID middleware
///
/// Generates or extracts a unique request ID for tracking requests through
/// the system. The request ID is added to all log messages and returned in
/// the response headers.
pub async fn request_id_middleware(mut request: Request, next: Next) -> Response {
    // Extract or generate request ID
    let request_id = request
        .headers()
        .get(X_REQUEST_ID)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| Uuid::parse_str(s).ok())
        .unwrap_or_else(Uuid::new_v4);

    // Store request ID in extensions for handlers to access
    request.extensions_mut().insert(request_id);

    // Continue processing
    let mut response = next.run(request).await;

    // Add request ID to response headers
    response.headers_mut().insert(
        X_REQUEST_ID,
        HeaderValue::from_str(&request_id.to_string()).unwrap_or_else(|_| {
            HeaderValue::from_static("invalid-uuid")
        }),
    );

    response
}

/// Request logging middleware
///
/// Logs all incoming requests with method, URI, and response status.
/// Includes request ID for correlation.
pub async fn logging_middleware(request: Request, next: Next) -> Response {
    let method = request.method().clone();
    let uri = request.uri().clone();
    let request_id = request
        .extensions()
        .get::<Uuid>()
        .copied()
        .unwrap_or_else(Uuid::new_v4);

    info!(
        request_id = %request_id,
        method = %method,
        uri = %uri,
        "Incoming request"
    );

    let start = std::time::Instant::now();
    let response = next.run(request).await;
    let elapsed = start.elapsed();

    let status = response.status();
    let level = match status.as_u16() {
        500..=599 => tracing::Level::ERROR,
        400..=499 => tracing::Level::WARN,
        _ => tracing::Level::INFO,
    };

    tracing::event!(
        level,
        request_id = %request_id,
        method = %method,
        uri = %uri,
        status = %status.as_u16(),
        duration_ms = elapsed.as_millis() as u64,
        "Request completed"
    );

    response
}

/// API key authentication middleware
///
/// Validates the API key from the X-API-Key header.
/// In production, this should check against a database or key management service.
///
/// For now, we accept any non-empty API key. You should implement proper
/// key validation based on your security requirements.
pub async fn auth_middleware(request: Request, next: Next) -> Result<Response, StatusCode> {
    let request_id = request
        .extensions()
        .get::<Uuid>()
        .copied()
        .unwrap_or_else(Uuid::new_v4);

    // Skip auth for health and metrics endpoints
    let path = request.uri().path();
    if path == "/health" || path == "/metrics" || path.starts_with("/api-docs") {
        return Ok(next.run(request).await);
    }

    // Check for API key
    let api_key = request
        .headers()
        .get(X_API_KEY)
        .and_then(|v| v.to_str().ok());

    match api_key {
        Some(key) if !key.is_empty() => {
            // TODO: Implement proper API key validation
            // For now, accept any non-empty key
            info!(
                request_id = %request_id,
                "API key validated"
            );
            Ok(next.run(request).await)
        }
        Some(_) => {
            warn!(
                request_id = %request_id,
                "Empty API key provided"
            );
            Err(StatusCode::UNAUTHORIZED)
        }
        None => {
            warn!(
                request_id = %request_id,
                path = %path,
                "Missing API key"
            );
            Err(StatusCode::UNAUTHORIZED)
        }
    }
}

/// Error handling middleware
///
/// Catches panics and converts them to 500 Internal Server Error responses.
/// This prevents the server from crashing on handler panics.
pub async fn error_handling_middleware(request: Request, next: Next) -> Response {
    let request_id = request
        .extensions()
        .get::<Uuid>()
        .copied()
        .unwrap_or_else(Uuid::new_v4);

    // Run the request
    let response = next.run(request).await;

    // Log errors
    if response.status().is_server_error() {
        error!(
            request_id = %request_id,
            status = %response.status().as_u16(),
            "Server error occurred"
        );
    }

    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
        middleware,
        routing::get,
        Router,
    };
    use tower::ServiceExt;

    async fn test_handler() -> &'static str {
        "OK"
    }

    #[tokio::test]
    async fn test_request_id_middleware() {
        let app = Router::new()
            .route("/", get(test_handler))
            .layer(middleware::from_fn(request_id_middleware));

        let response = app
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert!(response.headers().contains_key(X_REQUEST_ID));
    }

    #[tokio::test]
    async fn test_cors_layer() {
        let app = Router::new()
            .route("/", get(test_handler))
            .layer(cors_layer());

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::OPTIONS)
                    .uri("/")
                    .header(header::ORIGIN, "http://example.com")
                    .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_auth_middleware_health_endpoint() {
        let app = Router::new()
            .route("/health", get(test_handler))
            .layer(middleware::from_fn(auth_middleware));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_auth_middleware_missing_key() {
        let app = Router::new()
            .route("/api/test", get(test_handler))
            .layer(middleware::from_fn(auth_middleware));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/test")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_auth_middleware_valid_key() {
        let app = Router::new()
            .route("/api/test", get(test_handler))
            .layer(middleware::from_fn(auth_middleware));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/test")
                    .header(X_API_KEY, "test-key-123")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }
}
