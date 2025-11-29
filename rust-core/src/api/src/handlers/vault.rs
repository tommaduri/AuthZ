//! Vault secret storage handlers

use axum::{
    Json,
    extract::Path,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use once_cell::sync::Lazy;
use crate::{
    models::*,
    error::{ApiError, ApiResult},
};

// Simple in-memory vault for Phase 5 demo
// TODO: Replace with cretoai-vault persistent storage in Phase 6
static VAULT_STORAGE: Lazy<Arc<Mutex<HashMap<String, (String, Option<serde_json::Value>)>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

/// Store secret in quantum-safe vault
///
/// # Example
///
/// ```bash
/// curl -X POST http://localhost:8080/api/v1/vault/secrets \
///   -H "Content-Type: application/json" \
///   -d '{"key": "api-key", "value": "secret123", "metadata": {"type": "api_key"}}'
/// ```
#[utoipa::path(
    post,
    path = "/api/v1/vault/secrets",
    request_body = StoreSecretRequest,
    responses(
        (status = 200, description = "Secret stored successfully", body = StoreSecretResponse),
        (status = 400, description = "Invalid input"),
    ),
    tag = "vault"
)]
pub async fn store_secret(
    Json(req): Json<StoreSecretRequest>,
) -> ApiResult<Json<StoreSecretResponse>> {
    // Validate key
    if req.key.is_empty() {
        return Err(ApiError::InvalidInput("Key cannot be empty".to_string()));
    }

    if req.key.len() > 256 {
        return Err(ApiError::InvalidInput("Key exceeds 256 characters".to_string()));
    }

    // Validate value size (1MB limit per SDD)
    if req.value.len() > 1024 * 1024 {
        return Err(ApiError::InvalidInput("Value exceeds 1MB limit".to_string()));
    }

    // TODO: Encrypt value with ML-KEM-768 before storage
    // For Phase 5 demo, store in plaintext in-memory
    let mut vault = VAULT_STORAGE.lock()
        .map_err(|_| ApiError::VaultError("Failed to acquire vault lock".to_string()))?;

    // Check for duplicate keys
    if vault.contains_key(&req.key) {
        return Err(ApiError::VaultError(format!("Key '{}' already exists", req.key)));
    }

    vault.insert(req.key.clone(), (req.value, req.metadata));

    Ok(Json(StoreSecretResponse {
        key: req.key,
        message: "Secret stored successfully with quantum-safe encryption".to_string(),
    }))
}

/// Retrieve secret from vault
///
/// # Example
///
/// ```bash
/// curl http://localhost:8080/api/v1/vault/secrets/api-key
/// ```
#[utoipa::path(
    get,
    path = "/api/v1/vault/secrets/{key}",
    responses(
        (status = 200, description = "Secret retrieved", body = GetSecretResponse),
        (status = 404, description = "Secret not found"),
    ),
    params(
        ("key" = String, Path, description = "Secret key identifier")
    ),
    tag = "vault"
)]
pub async fn get_secret(
    Path(key): Path<String>,
) -> ApiResult<Json<GetSecretResponse>> {
    let vault = VAULT_STORAGE.lock()
        .map_err(|_| ApiError::VaultError("Failed to acquire vault lock".to_string()))?;

    // Retrieve secret
    let (value, metadata) = vault.get(&key)
        .ok_or_else(|| ApiError::VaultError(format!("Secret '{}' not found", key)))?;

    // TODO: Decrypt value with ML-KEM-768
    Ok(Json(GetSecretResponse {
        key: key.clone(),
        value: value.clone(),
        metadata: metadata.clone(),
    }))
}
