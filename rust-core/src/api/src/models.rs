//! API request and response models

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

// ============================================================================
// Health Model
// ============================================================================

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct HealthResponse {
    /// Service health status
    pub status: String,

    /// API version
    pub version: String,

    /// Whether quantum-resistant crypto is ready
    pub quantum_ready: bool,
}

// ============================================================================
// Crypto Models
// ============================================================================

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct EncryptRequest {
    /// Plaintext data to encrypt (base64 encoded)
    pub plaintext: String,

    /// Optional public key (base64). If not provided, generates ephemeral keypair
    pub public_key: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct EncryptResponse {
    /// Encrypted ciphertext (base64 encoded)
    pub ciphertext: String,

    /// Ephemeral public key used for encryption (base64)
    pub public_key: String,

    /// Encryption algorithm used
    pub algorithm: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct DecryptRequest {
    /// Ciphertext to decrypt (base64 encoded)
    pub ciphertext: String,

    /// Private key for decryption (base64 encoded)
    pub private_key: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DecryptResponse {
    /// Decrypted plaintext (base64 encoded)
    pub plaintext: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SignRequest {
    /// Message to sign (base64 encoded)
    pub message: String,

    /// Private key for signing (base64 encoded)
    pub private_key: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SignResponse {
    /// Digital signature (base64 encoded)
    pub signature: String,

    /// Signature algorithm used (ML-DSA-65 or ML-DSA-87)
    pub algorithm: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct VerifyRequest {
    /// Message that was signed (base64 encoded)
    pub message: String,

    /// Digital signature to verify (base64 encoded)
    pub signature: String,

    /// Public key for verification (base64 encoded)
    pub public_key: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct VerifyResponse {
    /// Whether signature is valid
    pub valid: bool,

    /// Algorithm used for verification
    pub algorithm: String,
}

// ============================================================================
// Vault Models
// ============================================================================

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct StoreSecretRequest {
    /// Secret key identifier
    pub key: String,

    /// Secret value (encrypted before storage)
    pub value: String,

    /// Optional metadata
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct StoreSecretResponse {
    /// Secret key identifier
    pub key: String,

    /// Success message
    pub message: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct GetSecretResponse {
    /// Secret key identifier
    pub key: String,

    /// Secret value (decrypted)
    pub value: String,

    /// Optional metadata
    pub metadata: Option<serde_json::Value>,
}

// ============================================================================
// DAG/Consensus Models
// ============================================================================

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CreateVertexRequest {
    /// Transaction data (base64 encoded)
    pub data: String,

    /// Optional parent vertex hashes
    pub parents: Option<Vec<String>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CreateVertexResponse {
    /// Vertex hash identifier
    pub vertex_hash: String,

    /// Height in the DAG
    pub height: u64,

    /// Success message
    pub message: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DagStatusResponse {
    /// Total number of vertices
    pub vertex_count: u64,

    /// Current DAG height
    pub height: u64,

    /// Number of finalized vertices
    pub finalized_count: u64,

    /// Consensus status
    pub status: String,
}
