//! Cryptographic operation handlers

use axum::Json;
use cretoai_crypto::kem::{MLKem768, MLKem768PublicKey, MLKem768SecretKey, MLKem768Ciphertext};
use cretoai_crypto::signatures::{MLDSA87, MLDSA87PublicKey, MLDSA87SecretKey, MLDSA87Signature};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use crate::{
    models::*,
    error::{ApiError, ApiResult},
};

/// Encrypt data with ML-KEM-768 (quantum-resistant)
///
/// # Example
///
/// ```bash
/// curl -X POST http://localhost:8080/api/v1/crypto/encrypt \
///   -H "Content-Type: application/json" \
///   -d '{"plaintext": "SGVsbG8gV29ybGQ="}'
/// ```
#[utoipa::path(
    post,
    path = "/api/v1/crypto/encrypt",
    request_body = EncryptRequest,
    responses(
        (status = 200, description = "Encryption successful", body = EncryptResponse),
        (status = 400, description = "Invalid input"),
    ),
    tag = "crypto"
)]
pub async fn encrypt(
    Json(req): Json<EncryptRequest>,
) -> ApiResult<Json<EncryptResponse>> {
    // Decode base64 plaintext
    let plaintext = BASE64.decode(&req.plaintext)
        .map_err(|e| ApiError::InvalidInput(format!("Invalid base64: {}", e)))?;

    // Size check (32KB max per SDD)
    if plaintext.len() > 32 * 1024 {
        return Err(ApiError::InvalidInput("Plaintext exceeds 32KB limit".to_string()));
    }

    // Use provided public key or generate ephemeral one
    let (public_key, _secret_key) = if let Some(pk_b64) = req.public_key {
        let pk_bytes = BASE64.decode(&pk_b64)
            .map_err(|e| ApiError::InvalidInput(format!("Invalid public key base64: {}", e)))?;

        let public_key = MLKem768PublicKey::from_bytes(&pk_bytes)
            .map_err(|e| ApiError::CryptoError(format!("Invalid public key: {:?}", e)))?;

        (public_key, None)
    } else {
        // Generate ephemeral keypair
        let keypair = MLKem768::generate();
        (keypair.public_key, Some(keypair.secret_key))
    };

    // Encapsulate to create shared secret and ciphertext
    let (shared_secret, kem_ciphertext) = MLKem768::encapsulate(&public_key);

    // Use shared secret to encrypt plaintext with AES-256-GCM
    let encrypted_data = encrypt_with_shared_secret(&plaintext, shared_secret.as_bytes())
        .map_err(|e| ApiError::CryptoError(format!("Encryption failed: {}", e)))?;

    // Combine KEM ciphertext + encrypted data
    let mut combined = Vec::new();
    combined.extend_from_slice(kem_ciphertext.as_bytes());
    combined.extend_from_slice(&encrypted_data);

    Ok(Json(EncryptResponse {
        ciphertext: BASE64.encode(&combined),
        public_key: BASE64.encode(public_key.as_bytes()),
        algorithm: "ML-KEM-768".to_string(),
    }))
}

/// Decrypt data with ML-KEM-768
///
/// # Example
///
/// ```bash
/// curl -X POST http://localhost:8080/api/v1/crypto/decrypt \
///   -H "Content-Type: application/json" \
///   -d '{"ciphertext": "...", "private_key": "..."}'
/// ```
#[utoipa::path(
    post,
    path = "/api/v1/crypto/decrypt",
    request_body = DecryptRequest,
    responses(
        (status = 200, description = "Decryption successful", body = DecryptResponse),
        (status = 400, description = "Invalid input"),
    ),
    tag = "crypto"
)]
pub async fn decrypt(
    Json(req): Json<DecryptRequest>,
) -> ApiResult<Json<DecryptResponse>> {
    // Decode base64 inputs
    let combined = BASE64.decode(&req.ciphertext)
        .map_err(|e| ApiError::InvalidInput(format!("Invalid ciphertext: {}", e)))?;

    let sk_bytes = BASE64.decode(&req.private_key)
        .map_err(|e| ApiError::InvalidInput(format!("Invalid private key: {}", e)))?;

    // Parse secret key
    let secret_key = MLKem768SecretKey::from_bytes(&sk_bytes)
        .map_err(|e| ApiError::CryptoError(format!("Invalid secret key: {:?}", e)))?;

    // Split combined ciphertext (KEM ciphertext size is 1088 bytes for Kyber768)
    const KEM_CT_SIZE: usize = 1088;
    if combined.len() < KEM_CT_SIZE {
        return Err(ApiError::InvalidInput("Ciphertext too short".to_string()));
    }

    let (kem_ct_bytes, encrypted_data) = combined.split_at(KEM_CT_SIZE);

    // Parse KEM ciphertext
    let kem_ciphertext = MLKem768Ciphertext::from_bytes(kem_ct_bytes)
        .map_err(|e| ApiError::CryptoError(format!("Invalid KEM ciphertext: {:?}", e)))?;

    // Decapsulate to recover shared secret
    let shared_secret = MLKem768::decapsulate(&kem_ciphertext, &secret_key);

    // Decrypt data with shared secret
    let plaintext = decrypt_with_shared_secret(encrypted_data, shared_secret.as_bytes())
        .map_err(|e| ApiError::CryptoError(format!("Decryption failed: {}", e)))?;

    Ok(Json(DecryptResponse {
        plaintext: BASE64.encode(&plaintext),
    }))
}

/// Sign message with ML-DSA-87 (quantum-resistant)
///
/// # Example
///
/// ```bash
/// curl -X POST http://localhost:8080/api/v1/crypto/sign \
///   -H "Content-Type: application/json" \
///   -d '{"message": "SGVsbG8=", "private_key": "..."}'
/// ```
#[utoipa::path(
    post,
    path = "/api/v1/crypto/sign",
    request_body = SignRequest,
    responses(
        (status = 200, description = "Signing successful", body = SignResponse),
        (status = 400, description = "Invalid input"),
    ),
    tag = "crypto"
)]
pub async fn sign(
    Json(req): Json<SignRequest>,
) -> ApiResult<Json<SignResponse>> {
    // Decode base64 inputs
    let message = BASE64.decode(&req.message)
        .map_err(|e| ApiError::InvalidInput(format!("Invalid message: {}", e)))?;

    let sk_bytes = BASE64.decode(&req.private_key)
        .map_err(|e| ApiError::InvalidInput(format!("Invalid private key: {}", e)))?;

    // Parse secret key
    let secret_key = MLDSA87SecretKey::from_bytes(&sk_bytes)
        .map_err(|e| ApiError::CryptoError(format!("Invalid secret key: {:?}", e)))?;

    // Sign the message
    let signature = MLDSA87::sign(&message, &secret_key);

    Ok(Json(SignResponse {
        signature: BASE64.encode(signature.as_bytes()),
        algorithm: "ML-DSA-87".to_string(),
    }))
}

/// Verify ML-DSA-87 signature
///
/// # Example
///
/// ```bash
/// curl -X POST http://localhost:8080/api/v1/crypto/verify \
///   -H "Content-Type: application/json" \
///   -d '{"message": "SGVsbG8=", "signature": "...", "public_key": "..."}'
/// ```
#[utoipa::path(
    post,
    path = "/api/v1/crypto/verify",
    request_body = VerifyRequest,
    responses(
        (status = 200, description = "Verification complete", body = VerifyResponse),
        (status = 400, description = "Invalid input"),
    ),
    tag = "crypto"
)]
pub async fn verify(
    Json(req): Json<VerifyRequest>,
) -> ApiResult<Json<VerifyResponse>> {
    // Decode base64 inputs
    let message = BASE64.decode(&req.message)
        .map_err(|e| ApiError::InvalidInput(format!("Invalid message: {}", e)))?;

    let sig_bytes = BASE64.decode(&req.signature)
        .map_err(|e| ApiError::InvalidInput(format!("Invalid signature: {}", e)))?;

    let pk_bytes = BASE64.decode(&req.public_key)
        .map_err(|e| ApiError::InvalidInput(format!("Invalid public key: {}", e)))?;

    // Parse public key and signature
    let public_key = MLDSA87PublicKey::from_bytes(&pk_bytes)
        .map_err(|e| ApiError::CryptoError(format!("Invalid public key: {:?}", e)))?;

    let signature = MLDSA87Signature::from_bytes(&sig_bytes)
        .map_err(|e| ApiError::CryptoError(format!("Invalid signature: {:?}", e)))?;

    // Verify signature (always return 200 OK, check valid field)
    let valid = MLDSA87::verify(&message, &signature, &public_key).is_ok();

    Ok(Json(VerifyResponse {
        valid,
        algorithm: "ML-DSA-87".to_string(),
    }))
}

// Helper functions for AES-256-GCM encryption with shared secret

fn encrypt_with_shared_secret(plaintext: &[u8], shared_secret: &[u8]) -> Result<Vec<u8>, String> {
    use aes_gcm::{
        aead::{Aead, KeyInit},
        Aes256Gcm, Nonce,
    };
    use sha3::{Digest, Sha3_256};

    // Derive AES key from shared secret using SHA3-256
    let mut hasher = Sha3_256::new();
    hasher.update(shared_secret);
    let key_bytes = hasher.finalize();

    // Create cipher
    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;

    // Generate random nonce (96 bits for GCM)
    let mut nonce_bytes = [0u8; 12];
    use rand::RngCore;
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Encrypt
    let ciphertext = cipher.encrypt(nonce, plaintext)
        .map_err(|e| format!("Encryption failed: {}", e))?;

    // Prepend nonce to ciphertext
    let mut result = Vec::with_capacity(nonce_bytes.len() + ciphertext.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);

    Ok(result)
}

fn decrypt_with_shared_secret(combined: &[u8], shared_secret: &[u8]) -> Result<Vec<u8>, String> {
    use aes_gcm::{
        aead::{Aead, KeyInit},
        Aes256Gcm, Nonce,
    };
    use sha3::{Digest, Sha3_256};

    // Check minimum size
    if combined.len() < 12 {
        return Err("Ciphertext too short (missing nonce)".to_string());
    }

    // Extract nonce and ciphertext
    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    // Derive AES key from shared secret
    let mut hasher = Sha3_256::new();
    hasher.update(shared_secret);
    let key_bytes = hasher.finalize();

    // Create cipher
    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;

    // Decrypt
    let plaintext = cipher.decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {}", e))?;

    Ok(plaintext)
}
