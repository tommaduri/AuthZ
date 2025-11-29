//! Network-related types

use serde::{Deserialize, Serialize};
use std::fmt;

/// Unique identifier for a network peer
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PeerId(pub String);

impl PeerId {
    /// Create a new peer ID
    pub fn new<S: Into<String>>(id: S) -> Self {
        PeerId(id.into())
    }

    /// Get the peer ID as a string
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for PeerId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl From<String> for PeerId {
    fn from(s: String) -> Self {
        PeerId(s)
    }
}

impl From<&str> for PeerId {
    fn from(s: &str) -> Self {
        PeerId(s.to_string())
    }
}

/// Connection information for a peer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionInfo {
    /// Remote peer ID
    pub peer_id: PeerId,
    /// Remote address
    pub address: String,
    /// Connection timestamp
    pub connected_at: chrono::DateTime<chrono::Utc>,
    /// Connection quality (0.0-1.0)
    pub quality: f64,
}

impl ConnectionInfo {
    /// Create a new connection info
    pub fn new(peer_id: PeerId, address: String) -> Self {
        ConnectionInfo {
            peer_id,
            address,
            connected_at: chrono::Utc::now(),
            quality: 1.0,
        }
    }
}

/// Network message envelope
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkMessage {
    /// Sender peer ID
    pub from: PeerId,
    /// Recipient peer ID (None for broadcast)
    pub to: Option<PeerId>,
    /// Message payload
    pub payload: Vec<u8>,
    /// Message timestamp
    pub timestamp: chrono::DateTime<chrono::Utc>,
    /// Optional message ID
    pub message_id: Option<String>,
}

impl NetworkMessage {
    /// Create a new network message
    pub fn new(from: PeerId, to: Option<PeerId>, payload: Vec<u8>) -> Self {
        NetworkMessage {
            from,
            to,
            payload,
            timestamp: chrono::Utc::now(),
            message_id: Some(uuid::Uuid::new_v4().to_string()),
        }
    }

    /// Create a broadcast message
    pub fn broadcast(from: PeerId, payload: Vec<u8>) -> Self {
        Self::new(from, None, payload)
    }

    /// Create a unicast message
    pub fn unicast(from: PeerId, to: PeerId, payload: Vec<u8>) -> Self {
        Self::new(from, Some(to), payload)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_peer_id() {
        let peer_id = PeerId::new("test-peer");
        assert_eq!(peer_id.as_str(), "test-peer");
        assert_eq!(peer_id.to_string(), "test-peer");
    }

    #[test]
    fn test_connection_info() {
        let peer_id = PeerId::new("peer-1");
        let conn = ConnectionInfo::new(peer_id.clone(), "127.0.0.1:8000".to_string());
        assert_eq!(conn.peer_id, peer_id);
        assert_eq!(conn.address, "127.0.0.1:8000");
        assert_eq!(conn.quality, 1.0);
    }

    #[test]
    fn test_network_message() {
        let from = PeerId::new("sender");
        let to = PeerId::new("receiver");
        let payload = vec![1, 2, 3, 4];

        let msg = NetworkMessage::unicast(from.clone(), to.clone(), payload.clone());
        assert_eq!(msg.from, from);
        assert_eq!(msg.to, Some(to));
        assert_eq!(msg.payload, payload);
        assert!(msg.message_id.is_some());
    }

    #[test]
    fn test_broadcast_message() {
        let from = PeerId::new("broadcaster");
        let payload = vec![5, 6, 7, 8];

        let msg = NetworkMessage::broadcast(from.clone(), payload.clone());
        assert_eq!(msg.from, from);
        assert_eq!(msg.to, None);
        assert_eq!(msg.payload, payload);
    }
}
