//! API error handling

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

pub type ApiResult<T> = Result<T, ApiError>;

#[derive(Debug)]
pub enum ApiError {
    InvalidInput(String),
    CryptoError(String),
    VaultError(String),
    ConsensusError(String),
    InternalError(String),
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
    details: Option<String>,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, error_message, details) = match self {
            ApiError::InvalidInput(msg) => (
                StatusCode::BAD_REQUEST,
                "Invalid input".to_string(),
                Some(msg),
            ),
            ApiError::CryptoError(msg) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Cryptographic operation failed".to_string(),
                Some(msg),
            ),
            ApiError::VaultError(msg) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Vault operation failed".to_string(),
                Some(msg),
            ),
            ApiError::ConsensusError(msg) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Consensus operation failed".to_string(),
                Some(msg),
            ),
            ApiError::InternalError(msg) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Internal server error".to_string(),
                Some(msg),
            ),
        };

        let body = Json(ErrorResponse {
            error: error_message,
            details,
        });

        (status, body).into_response()
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(err: anyhow::Error) -> Self {
        ApiError::InternalError(err.to_string())
    }
}
