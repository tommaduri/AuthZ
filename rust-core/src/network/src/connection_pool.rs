//! Connection pooling and management

use crate::{
    error::{NetworkError, Result},
    network_types::*,
};
use parking_lot::RwLock;
use quinn::Connection;
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tracing::{debug, info};

/// Connection pool manager
pub struct ConnectionPool {
    /// Active connections
    connections: Arc<RwLock<HashMap<PeerId, PooledConnection>>>,

    /// Maximum connections
    max_connections: usize,

    /// Connection timeout
    timeout: Duration,
}

struct PooledConnection {
    connection: Connection,
    stats: ConnectionStats,
    last_used: Instant,
}

impl ConnectionPool {
    /// Create a new connection pool
    pub fn new(max_connections: usize, timeout_secs: u64) -> Self {
        Self {
            connections: Arc::new(RwLock::new(HashMap::new())),
            max_connections,
            timeout: Duration::from_secs(timeout_secs),
        }
    }

    /// Add connection to pool
    pub fn add(&self, peer_id: PeerId, connection: Connection) -> Result<()> {
        let mut connections = self.connections.write();

        if connections.len() >= self.max_connections {
            // Remove oldest connection
            self.evict_oldest(&mut connections);
        }

        connections.insert(peer_id, PooledConnection {
            connection,
            stats: ConnectionStats::default(),
            last_used: Instant::now(),
        });

        debug!("Added connection to pool: {}", peer_id);

        Ok(())
    }

    /// Get connection from pool
    pub fn get(&self, peer_id: PeerId) -> Option<Connection> {
        let mut connections = self.connections.write();

        if let Some(pooled) = connections.get_mut(&peer_id) {
            pooled.last_used = Instant::now();
            return Some(pooled.connection.clone());
        }

        None
    }

    /// Remove connection from pool
    pub fn remove(&self, peer_id: PeerId) -> Option<Connection> {
        self.connections.write().remove(&peer_id).map(|p| p.connection)
    }

    /// Get connection statistics
    pub fn get_stats(&self, peer_id: PeerId) -> Option<ConnectionStats> {
        self.connections.read().get(&peer_id).map(|p| p.stats.clone())
    }

    /// Update connection statistics
    pub fn update_stats<F>(&self, peer_id: PeerId, f: F)
    where
        F: FnOnce(&mut ConnectionStats),
    {
        if let Some(pooled) = self.connections.write().get_mut(&peer_id) {
            f(&mut pooled.stats);
        }
    }

    /// Clean up idle connections
    pub fn cleanup(&self) {
        let mut connections = self.connections.write();
        let now = Instant::now();

        connections.retain(|peer_id, pooled| {
            if now.duration_since(pooled.last_used) > self.timeout {
                info!("Removing idle connection: {}", peer_id);
                false
            } else {
                true
            }
        });
    }

    /// Get all peer IDs
    pub fn get_peers(&self) -> Vec<PeerId> {
        self.connections.read().keys().copied().collect()
    }

    /// Get pool size
    pub fn size(&self) -> usize {
        self.connections.read().len()
    }

    /// Start cleanup task
    pub fn start_cleanup_task(&self, interval_secs: u64) {
        let connections = self.connections.clone();
        let timeout = self.timeout;

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(interval_secs));

            loop {
                interval.tick().await;

                let mut conns = connections.write();
                let now = Instant::now();

                conns.retain(|peer_id, pooled| {
                    if now.duration_since(pooled.last_used) > timeout {
                        debug!("Cleaning up idle connection: {}", peer_id);
                        false
                    } else {
                        true
                    }
                });
            }
        });
    }

    fn evict_oldest(&self, connections: &mut HashMap<PeerId, PooledConnection>) {
        if let Some((oldest_peer_id, _)) = connections.iter()
            .min_by_key(|(_, pooled)| pooled.last_used)
        {
            let oldest_peer_id = *oldest_peer_id;
            connections.remove(&oldest_peer_id);
            info!("Evicted oldest connection: {}", oldest_peer_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pool_size_limit() {
        let pool = ConnectionPool::new(2, 60);

        // Would need actual Quinn connections to test fully
        // This is a placeholder for structure verification
        assert_eq!(pool.size(), 0);
    }
}
