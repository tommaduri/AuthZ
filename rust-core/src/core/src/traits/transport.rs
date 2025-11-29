//! Transport layer trait

use crate::error::Result;
use crate::types::PeerId;
use async_trait::async_trait;

/// Connection handle for a transport
#[async_trait]
pub trait Connection: Send + Sync {
    /// Send data over the connection
    async fn send(&mut self, data: &[u8]) -> Result<()>;

    /// Receive data from the connection
    async fn receive(&mut self) -> Result<Vec<u8>>;

    /// Close the connection
    async fn close(&mut self) -> Result<()>;

    /// Get the remote peer ID
    fn peer_id(&self) -> &PeerId;
}

/// Transport abstraction for network communication
#[async_trait]
pub trait Transport: Send + Sync {
    /// Send a message to a peer
    async fn send(&self, peer: &PeerId, message: &[u8]) -> Result<()>;

    /// Receive a message from any peer
    async fn receive(&self) -> Result<(PeerId, Vec<u8>)>;

    /// Broadcast a message to all peers
    async fn broadcast(&self, message: &[u8]) -> Result<()>;

    /// Connect to a peer
    async fn connect(&self, peer: &PeerId, address: &str) -> Result<Box<dyn Connection>>;

    /// Disconnect from a peer
    async fn disconnect(&self, peer: &PeerId) -> Result<()>;

    /// Get list of connected peers
    async fn peers(&self) -> Result<Vec<PeerId>>;

    /// Check if connected to a peer
    async fn is_connected(&self, peer: &PeerId) -> bool;

    /// Get local peer ID
    fn local_peer_id(&self) -> &PeerId;
}

/// Stream-based transport for continuous data flow
#[async_trait]
pub trait StreamTransport: Transport {
    /// Open a stream to a peer
    async fn open_stream(&self, peer: &PeerId) -> Result<Box<dyn Connection>>;

    /// Accept incoming streams
    async fn accept_stream(&self) -> Result<Box<dyn Connection>>;
}

#[cfg(test)]
mod tests {
    use super::*;

    // Mock implementation for testing
    struct MockConnection {
        peer_id: PeerId,
    }

    #[async_trait]
    impl Connection for MockConnection {
        async fn send(&mut self, _data: &[u8]) -> Result<()> {
            Ok(())
        }

        async fn receive(&mut self) -> Result<Vec<u8>> {
            Ok(vec![])
        }

        async fn close(&mut self) -> Result<()> {
            Ok(())
        }

        fn peer_id(&self) -> &PeerId {
            &self.peer_id
        }
    }

    #[tokio::test]
    async fn test_mock_connection() {
        let mut conn = MockConnection {
            peer_id: PeerId::new("test-peer"),
        };
        assert_eq!(conn.peer_id().as_str(), "test-peer");
        assert!(conn.send(&[1, 2, 3]).await.is_ok());
    }
}
