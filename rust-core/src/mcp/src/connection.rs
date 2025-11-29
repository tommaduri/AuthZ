//! Connection Pool
//!
//! Manages QUIC connections for MCP communication.

use crate::codec::MessageCodec;
use crate::error::{McpError, Result};
use crate::protocol::McpMessage;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Connection handle
#[derive(Debug, Clone)]
pub struct Connection {
    pub id: String,
    pub peer_id: String,
    pub established_at: i64,
    pub last_activity: i64,
}

/// Connection pool for managing QUIC connections
pub struct ConnectionPool {
    connections: Arc<RwLock<HashMap<String, Connection>>>,
    codec: MessageCodec,
    max_connections: usize,
}

impl ConnectionPool {
    /// Create a new connection pool
    pub fn new(max_connections: usize) -> Self {
        Self {
            connections: Arc::new(RwLock::new(HashMap::new())),
            codec: MessageCodec::default(),
            max_connections,
        }
    }

    /// Add a new connection
    pub async fn add_connection(&self, peer_id: String) -> Result<String> {
        let mut connections = self.connections.write().await;

        if connections.len() >= self.max_connections {
            return Err(McpError::Server(
                "Maximum connections reached".to_string(),
            ));
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp();

        let connection = Connection {
            id: id.clone(),
            peer_id,
            established_at: now,
            last_activity: now,
        };

        connections.insert(id.clone(), connection);

        Ok(id)
    }

    /// Remove a connection
    pub async fn remove_connection(&self, connection_id: &str) -> Result<()> {
        let mut connections = self.connections.write().await;
        connections
            .remove(connection_id)
            .ok_or_else(|| McpError::Server(format!("Connection not found: {}", connection_id)))?;
        Ok(())
    }

    /// Get connection information
    pub async fn get_connection(&self, connection_id: &str) -> Result<Connection> {
        let connections = self.connections.read().await;
        connections
            .get(connection_id)
            .cloned()
            .ok_or_else(|| McpError::Server(format!("Connection not found: {}", connection_id)))
    }

    /// List all connections
    pub async fn list_connections(&self) -> Vec<Connection> {
        let connections = self.connections.read().await;
        connections.values().cloned().collect()
    }

    /// Update connection activity timestamp
    pub async fn update_activity(&self, connection_id: &str) -> Result<()> {
        let mut connections = self.connections.write().await;
        let connection = connections.get_mut(connection_id).ok_or_else(|| {
            McpError::Server(format!("Connection not found: {}", connection_id))
        })?;

        connection.last_activity = chrono::Utc::now().timestamp();

        Ok(())
    }

    /// Get connection count
    pub async fn count(&self) -> usize {
        let connections = self.connections.read().await;
        connections.len()
    }

    /// Find connection by peer ID
    pub async fn find_by_peer(&self, peer_id: &str) -> Option<Connection> {
        let connections = self.connections.read().await;
        connections
            .values()
            .find(|conn| conn.peer_id == peer_id)
            .cloned()
    }

    /// Clean up idle connections
    pub async fn cleanup_idle(&self, idle_timeout_secs: i64) -> usize {
        let mut connections = self.connections.write().await;
        let now = chrono::Utc::now().timestamp();

        let to_remove: Vec<String> = connections
            .iter()
            .filter(|(_, conn)| now - conn.last_activity > idle_timeout_secs)
            .map(|(id, _)| id.clone())
            .collect();

        let count = to_remove.len();

        for id in to_remove {
            connections.remove(&id);
        }

        count
    }

    /// Send a message over a connection (mock implementation)
    pub async fn send_message(
        &self,
        connection_id: &str,
        message: &McpMessage,
    ) -> Result<()> {
        // Verify connection exists
        self.get_connection(connection_id).await?;

        // In production, this would send over the actual QUIC connection
        // For now, we just encode to verify the message is valid
        let _encoded = self.codec.encode(message)?;

        // Update activity
        self.update_activity(connection_id).await?;

        Ok(())
    }

    /// Receive a message from a connection (mock implementation)
    pub async fn receive_message(
        &self,
        connection_id: &str,
        data: &[u8],
    ) -> Result<McpMessage> {
        // Verify connection exists
        self.get_connection(connection_id).await?;

        // Decode message
        let message = self.codec.decode(data)?;

        // Update activity
        self.update_activity(connection_id).await?;

        Ok(message)
    }

    /// Broadcast a message to all connections
    pub async fn broadcast(&self, message: &McpMessage) -> Result<usize> {
        let connections = self.list_connections().await;
        let mut sent_count = 0;

        for connection in connections {
            if self.send_message(&connection.id, message).await.is_ok() {
                sent_count += 1;
            }
        }

        Ok(sent_count)
    }
}

impl Default for ConnectionPool {
    fn default() -> Self {
        Self::new(1000)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::*;

    #[tokio::test]
    async fn test_add_connection() {
        let pool = ConnectionPool::new(10);

        let conn_id = pool.add_connection("peer-1".to_string()).await.unwrap();

        assert_eq!(pool.count().await, 1);

        let connection = pool.get_connection(&conn_id).await.unwrap();
        assert_eq!(connection.peer_id, "peer-1");
    }

    #[tokio::test]
    async fn test_remove_connection() {
        let pool = ConnectionPool::new(10);

        let conn_id = pool.add_connection("peer-1".to_string()).await.unwrap();
        assert_eq!(pool.count().await, 1);

        pool.remove_connection(&conn_id).await.unwrap();
        assert_eq!(pool.count().await, 0);
    }

    #[tokio::test]
    async fn test_max_connections() {
        let pool = ConnectionPool::new(2);

        pool.add_connection("peer-1".to_string()).await.unwrap();
        pool.add_connection("peer-2".to_string()).await.unwrap();

        let result = pool.add_connection("peer-3".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_find_by_peer() {
        let pool = ConnectionPool::new(10);

        pool.add_connection("peer-1".to_string()).await.unwrap();
        pool.add_connection("peer-2".to_string()).await.unwrap();

        let connection = pool.find_by_peer("peer-1").await;
        assert!(connection.is_some());
        assert_eq!(connection.unwrap().peer_id, "peer-1");

        let none = pool.find_by_peer("peer-3").await;
        assert!(none.is_none());
    }

    #[tokio::test]
    async fn test_update_activity() {
        let pool = ConnectionPool::new(10);

        let conn_id = pool.add_connection("peer-1".to_string()).await.unwrap();

        let conn_before = pool.get_connection(&conn_id).await.unwrap();
        let activity_before = conn_before.last_activity;

        // Wait for at least 1 second to ensure timestamp changes
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

        pool.update_activity(&conn_id).await.unwrap();

        let conn_after = pool.get_connection(&conn_id).await.unwrap();
        assert!(conn_after.last_activity >= activity_before);
    }

    #[tokio::test]
    async fn test_cleanup_idle() {
        let pool = ConnectionPool::new(10);

        let conn_id = pool.add_connection("peer-1".to_string()).await.unwrap();

        // Mark as old
        {
            let mut connections = pool.connections.write().await;
            if let Some(conn) = connections.get_mut(&conn_id) {
                conn.last_activity = chrono::Utc::now().timestamp() - 1000;
            }
        }

        let removed = pool.cleanup_idle(500).await;
        assert_eq!(removed, 1);
        assert_eq!(pool.count().await, 0);
    }

    #[tokio::test]
    async fn test_send_receive_message() {
        let pool = ConnectionPool::new(10);

        let conn_id = pool.add_connection("peer-1".to_string()).await.unwrap();

        let message = McpMessage::Ping(PingMessage {
            id: "ping-1".to_string(),
            timestamp: 1234567890,
        });

        pool.send_message(&conn_id, &message).await.unwrap();

        // Encode and send back through receive
        let codec = MessageCodec::default();
        let data = codec.encode(&message).unwrap();

        let received = pool.receive_message(&conn_id, &data).await.unwrap();
        assert_eq!(received, message);
    }

    #[tokio::test]
    async fn test_broadcast() {
        let pool = ConnectionPool::new(10);

        pool.add_connection("peer-1".to_string()).await.unwrap();
        pool.add_connection("peer-2".to_string()).await.unwrap();
        pool.add_connection("peer-3".to_string()).await.unwrap();

        let message = McpMessage::Ping(PingMessage {
            id: "ping-1".to_string(),
            timestamp: 1234567890,
        });

        let sent_count = pool.broadcast(&message).await.unwrap();
        assert_eq!(sent_count, 3);
    }
}
