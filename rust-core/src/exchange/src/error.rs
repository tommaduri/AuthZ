//! Error types for the exchange module

use thiserror::Error;

pub type Result<T> = std::result::Result<T, ExchangeError>;

#[derive(Debug, Error)]
pub enum ExchangeError {
    #[error("Marketplace error: {0}")]
    Marketplace(String),

    #[error("Reputation error: {0}")]
    Reputation(String),

    #[error("Contract error: {0}")]
    Contract(String),

    #[error("Discovery error: {0}")]
    Discovery(String),

    #[error("Payment error: {0}")]
    Payment(String),

    #[error("SLA error: {0}")]
    Sla(String),

    #[error("Insufficient reputation: {0}")]
    InsufficientReputation(String),

    #[error("Resource unavailable: {0}")]
    ResourceUnavailable(String),

    #[error("Generic exchange error: {0}")]
    Generic(String),
}
