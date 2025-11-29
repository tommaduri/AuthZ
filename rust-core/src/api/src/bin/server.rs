//! CretoAI REST API Server
//!
//! Production-ready HTTP server for quantum-resistant operations

use cretoai_api::{build_router, ApiConfig};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,cretoai_api=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Load configuration
    let config = ApiConfig::default();
    let bind_addr = config.bind_address();

    // Build router
    let app = build_router();

    // Start server
    tracing::info!("🚀 CretoAI REST API Server");
    tracing::info!("🔐 Quantum-Resistant Cryptography");
    tracing::info!("📡 Listening on http://{}", bind_addr);
    tracing::info!("📚 Swagger UI: http://{}/swagger-ui", bind_addr);
    tracing::info!("🏥 Health check: http://{}/health", bind_addr);

    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
