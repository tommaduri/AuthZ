//! Route definitions for the API server
//!
//! This module configures all HTTP routes with OpenAPI documentation.
//! Routes are organized by functionality:
//! - Health and metrics endpoints
//! - Policy management
//! - Authorization checks
//! - Role management
//! - Attribute management

use crate::{handlers, middleware, state::AppState};
use axum::{
    middleware as axum_middleware,
    routing::{get, post},
    Router,
};
use std::sync::Arc;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

/// OpenAPI documentation configuration
#[derive(OpenApi)]
#[openapi(
    info(
        title = "Authorization Engine API",
        version = "1.0.0",
        description = "REST API for the Rust-based authorization engine",
        contact(
            name = "API Support",
            email = "support@example.com"
        ),
        license(
            name = "MIT",
            url = "https://opensource.org/licenses/MIT"
        )
    ),
    paths(
        handlers::health_check,
        handlers::metrics,
        handlers::check_authorization,
        handlers::create_policy,
        handlers::get_policy,
        handlers::update_policy,
        handlers::delete_policy,
        handlers::list_policies,
        handlers::create_role,
        handlers::get_role,
        handlers::update_role,
        handlers::delete_role,
        handlers::list_roles,
        handlers::assign_role,
        handlers::revoke_role,
        handlers::set_attributes,
        handlers::get_attributes,
        handlers::delete_attributes,
    ),
    components(
        schemas(
            crate::models::HealthResponse,
            crate::models::MetricsResponse,
            crate::models::AuthorizationRequest,
            crate::models::AuthorizationResponse,
            crate::models::CreatePolicyRequest,
            crate::models::PolicyResponse,
            crate::models::UpdatePolicyRequest,
            crate::models::ListPoliciesResponse,
            crate::models::CreateRoleRequest,
            crate::models::RoleResponse,
            crate::models::UpdateRoleRequest,
            crate::models::ListRolesResponse,
            crate::models::AssignRoleRequest,
            crate::models::RevokeRoleRequest,
            crate::models::SetAttributesRequest,
            crate::models::AttributesResponse,
            crate::models::ErrorResponse,
        )
    ),
    tags(
        (name = "health", description = "Health and monitoring endpoints"),
        (name = "authorization", description = "Authorization check endpoints"),
        (name = "policies", description = "Policy management endpoints"),
        (name = "roles", description = "Role management endpoints"),
        (name = "attributes", description = "Attribute management endpoints"),
    ),
    servers(
        (url = "http://localhost:8080", description = "Local development server"),
        (url = "https://api.example.com", description = "Production server"),
    ),
    security(
        ("api_key" = [])
    )
)]
pub struct ApiDoc;

/// Create the application router with all routes and middleware
///
/// This function builds the complete Axum router with:
/// - Health and metrics endpoints
/// - API routes under /api/v1
/// - OpenAPI/Swagger documentation
/// - Middleware layers for logging, auth, CORS, etc.
pub fn create_router(state: Arc<AppState>) -> Router {
    // Create API routes
    let api_routes = Router::new()
        // Authorization endpoints
        .route("/authorize", post(handlers::check_authorization))
        // Policy endpoints
        .route("/policies", post(handlers::create_policy))
        .route("/policies", get(handlers::list_policies))
        .route("/policies/:id", get(handlers::get_policy))
        .route("/policies/:id", post(handlers::update_policy))
        .route("/policies/:id", axum::routing::delete(handlers::delete_policy))
        // Role endpoints
        .route("/roles", post(handlers::create_role))
        .route("/roles", get(handlers::list_roles))
        .route("/roles/:id", get(handlers::get_role))
        .route("/roles/:id", post(handlers::update_role))
        .route("/roles/:id", axum::routing::delete(handlers::delete_role))
        .route("/roles/assign", post(handlers::assign_role))
        .route("/roles/revoke", post(handlers::revoke_role))
        // Attribute endpoints
        .route("/attributes/:subject_id", get(handlers::get_attributes))
        .route("/attributes/:subject_id", post(handlers::set_attributes))
        .route("/attributes/:subject_id", axum::routing::delete(handlers::delete_attributes));

    // Create main router
    Router::new()
        // Health and metrics (no auth required)
        .route("/health", get(handlers::health_check))
        .route("/metrics", get(handlers::metrics))
        // API routes (auth required)
        .nest("/api/v1", api_routes)
        // OpenAPI documentation
        .merge(SwaggerUi::new("/api-docs").url("/api-docs/openapi.json", ApiDoc::openapi()))
        // Add state
        .with_state(state)
        // Add middleware layers (executed bottom to top)
        .layer(axum_middleware::from_fn(middleware::error_handling_middleware))
        .layer(axum_middleware::from_fn(middleware::auth_middleware))
        .layer(axum_middleware::from_fn(middleware::logging_middleware))
        .layer(axum_middleware::from_fn(middleware::request_id_middleware))
        .layer(middleware::cors_layer())
        .layer(TraceLayer::new_for_http())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    fn create_test_state() -> Arc<AppState> {
        Arc::new(AppState::default())
    }

    #[tokio::test]
    async fn test_health_endpoint() {
        let app = create_router(create_test_state());

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
    async fn test_metrics_endpoint() {
        let app = create_router(create_test_state());

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/metrics")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_swagger_ui() {
        let app = create_router(create_test_state());

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api-docs/")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_openapi_json() {
        let app = create_router(create_test_state());

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api-docs/openapi.json")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_auth_required_for_api_routes() {
        let app = create_router(create_test_state());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/authorize")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"subject":"user1","action":"read","resource":"doc1"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_auth_with_api_key() {
        let app = create_router(create_test_state());

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/authorize")
                    .header("content-type", "application/json")
                    .header("x-api-key", "test-key-123")
                    .body(Body::from(r#"{"subject":"user1","action":"read","resource":"doc1"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        // Should not be UNAUTHORIZED (might be 400 or other status due to logic)
        assert_ne!(response.status(), StatusCode::UNAUTHORIZED);
    }
}
