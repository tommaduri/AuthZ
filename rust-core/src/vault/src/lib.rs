//! # Vigilia AI Vault Module
//!
//! This module implements secure credential and key storage.
//!
//! ## Features
//!
//! - **Encrypted Storage**: AES-256-GCM encrypted credential storage
//! - **Key Management**: Secure key generation, rotation, and backup
//! - **Access Control**: Fine-grained permission-based access
//! - **Audit Logging**: Complete audit trail for all operations
//! - **Backup/Restore**: Encrypted backup and restore capabilities
//! - **Hardware Integration**: Optional HSM and TPM support
//!
//! ## Module Structure
//!
//! ```text
//! vault/
//! ├── storage/       - Encrypted storage backend
//! ├── keys/          - Key management
//! ├── access/        - Access control and permissions
//! ├── audit/         - Audit logging
//! ├── backup/        - Backup and restore
//! └── hsm/          - Hardware security module integration
//! ```

pub mod access;
pub mod audit;
pub mod backup;
pub mod crypto_integration;
pub mod error;
pub mod keys;
pub mod storage;

#[cfg(all(feature = "hsm", not(test)))]
pub mod hsm;

pub use crypto_integration::{EncryptedData, QuantumResistantEncryption, VaultCryptoConfig};
pub use error::{VaultError, Result};

#[cfg(test)]
mod tests {
    #[test]
    fn test_module_import() {
        // Module import test - verify compilation succeeds
    }
}
