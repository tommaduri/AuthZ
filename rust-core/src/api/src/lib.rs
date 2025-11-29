//! CretoAI REST API
//!
//! Production-ready HTTP API wrapper for CretoAI quantum-resistant cryptography platform.
//!
//! ## Features
//!
//! - **Cryptographic Operations**: Encrypt, decrypt, sign, verify with ML-KEM/ML-DSA
//! - **Consensus**: Create and query DAG vertices
//! - **Vault**: Secure secret storage and retrieval
//! - **OpenAPI Documentation**: Auto-generated Swagger UI
//! - **CORS Support**: Cross-origin resource sharing enabled
//! - **Production Ready**: Logging, error handling, metrics

pub mod routes;
pub mod handlers;
pub mod models;
pub mod error;
pub mod config;

pub use error::{ApiError, ApiResult};
pub use config::ApiConfig;
pub use handlers::health::HealthResponse;

use axum::{
    Router,
    routing::{get, post},
};
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

/// OpenAPI documentation
#[derive(OpenApi)]
#[openapi(
    paths(
        handlers::crypto::encrypt,
        handlers::crypto::decrypt,
        handlers::crypto::sign,
        handlers::crypto::verify,
        handlers::vault::store_secret,
        handlers::vault::get_secret,
        handlers::dag::create_vertex,
        handlers::dag::get_status,
    ),
    components(
        schemas(
            models::EncryptRequest,
            models::EncryptResponse,
            models::DecryptRequest,
            models::DecryptResponse,
            models::SignRequest,
            models::SignResponse,
            models::VerifyRequest,
            models::VerifyResponse,
            models::StoreSecretRequest,
            models::StoreSecretResponse,
            models::GetSecretResponse,
            models::CreateVertexRequest,
            models::CreateVertexResponse,
            models::DagStatusResponse,
        )
    ),
    tags(
        (name = "crypto", description = "Quantum-resistant cryptographic operations"),
        (name = "vault", description = "Secure secret storage"),
        (name = "dag", description = "Distributed consensus"),
    )
)]
struct ApiDoc;

/// Build the API router with all routes and middleware
pub fn build_router() -> Router {
    // OpenAPI spec
    let openapi = ApiDoc::openapi();

    Router::new()
        // Health check
        .route("/health", get(handlers::health::health_check))

        // Crypto operations
        .route("/api/v1/crypto/encrypt", post(handlers::crypto::encrypt))
        .route("/api/v1/crypto/decrypt", post(handlers::crypto::decrypt))
        .route("/api/v1/crypto/sign", post(handlers::crypto::sign))
        .route("/api/v1/crypto/verify", post(handlers::crypto::verify))

        // Vault operations
        .route("/api/v1/vault/secrets", post(handlers::vault::store_secret))
        .route("/api/v1/vault/secrets/:key", get(handlers::vault::get_secret))

        // DAG/Consensus operations
        .route("/api/v1/consensus/vertex", post(handlers::dag::create_vertex))
        .route("/api/v1/consensus/status", get(handlers::dag::get_status))

        // Swagger UI
        .merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", openapi))

        // Middleware
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_router_builds() {
        let _router = build_router();
    }
}
