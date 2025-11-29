//! Error types for the network module

use thiserror::Error;

pub type Result<T> = std::result::Result<T, NetworkError>;

#[derive(Debug, Error)]
pub enum NetworkError {
    #[error("P2P error: {0}")]
    P2p(String),

    #[error("Dark domain error: {0}")]
    DarkDomain(String),

    #[error("Transport error: {0}")]
    Transport(String),

    #[error("Connection error: {0}")]
    Connection(String),

    #[error("Discovery error: {0}")]
    Discovery(String),

    #[error("Gossip error: {0}")]
    Gossip(String),

    #[error("Relay error: {0}")]
    Relay(String),

    #[error("Protocol error: {0}")]
    Protocol(String),

    #[error("Consensus error: {0}")]
    Consensus(String),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("Timeout")]
    Timeout,

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Generic network error: {0}")]
    Generic(String),

    #[error("Invalid signature: {0}")]
    InvalidSignature(String),

    #[error("Unknown peer: {0}")]
    UnknownPeer(String),

    #[error("Crypto error: {0}")]
    Crypto(String),

    #[error("Configuration error: {0}")]
    Configuration(String),

    #[error("Subscription error: {0}")]
    Subscription(String),

    #[error("Publication error: {0}")]
    Publication(String),

    #[error("Query error: {0}")]
    Query(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Not implemented: {0}")]
    NotImplemented(String),

    #[error("Double spend detected: {0}")]
    DoubleSpend(String),

    #[error("Peer not found: {0}")]
    PeerNotFound(String),

    #[error("STUN error: {0}")]
    Stun(String),

    #[error("TURN error: {0}")]
    Turn(String),

    #[error("TLS error: {0}")]
    Tls(String),

    #[error("Connection timeout")]
    ConnectionTimeout,
}

// Additional From conversions for error handling
impl From<std::net::AddrParseError> for NetworkError {
    fn from(err: std::net::AddrParseError) -> Self {
        NetworkError::Connection(format!("Address parse error: {}", err))
    }
}

impl From<quinn::ConnectError> for NetworkError {
    fn from(err: quinn::ConnectError) -> Self {
        NetworkError::Connection(format!("QUIC connect error: {}", err))
    }
}

impl From<Box<bincode::ErrorKind>> for NetworkError {
    fn from(err: Box<bincode::ErrorKind>) -> Self {
        NetworkError::Serialization(format!("Bincode error: {}", err))
    }
}

impl From<quinn::WriteError> for NetworkError {
    fn from(err: quinn::WriteError) -> Self {
        NetworkError::Transport(format!("QUIC write error: {}", err))
    }
}

impl From<quinn::ConnectionError> for NetworkError {
    fn from(err: quinn::ConnectionError) -> Self {
        NetworkError::Connection(format!("QUIC connection error: {}", err))
    }
}

// Note: quinn::ClosedStream doesn't exist in quinn 0.10
// Stream close errors are handled through other quinn error types
