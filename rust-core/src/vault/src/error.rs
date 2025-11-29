//! Error types for the vault module

use thiserror::Error;

pub type Result<T> = std::result::Result<T, VaultError>;

#[derive(Debug, Error)]
pub enum VaultError {
    #[error("Storage error: {0}")]
    Storage(String),

    #[error("Key error: {0}")]
    Key(String),

    #[error("Access denied: {0}")]
    AccessDenied(String),

    #[error("Audit error: {0}")]
    Audit(String),

    #[error("Backup error: {0}")]
    Backup(String),

    #[error("Encryption error: {0}")]
    Encryption(String),

    #[error("Decryption error: {0}")]
    Decryption(String),

    #[error("Invalid credentials: {0}")]
    InvalidCredentials(String),

    #[error("Generic vault error: {0}")]
    Generic(String),
}
