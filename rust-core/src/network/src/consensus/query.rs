//! Consensus query handler
//!
//! Processes queries, aggregates responses, and handles timeouts
//! for the Avalanche consensus protocol.

use super::protocol::{QueryResponse, VertexId};
use crate::error::{NetworkError, Result};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tracing::{debug, info, warn};
use uuid::Uuid;

/// Query configuration
#[derive(Debug, Clone)]
pub struct QueryConfig {
    /// Sample size for each query
    pub sample_size: usize,

    /// Query timeout
    pub query_timeout: Duration,

    /// Maximum concurrent queries
    pub max_concurrent_queries: usize,
}

impl Default for QueryConfig {
    fn default() -> Self {
        Self {
            sample_size: 30,
            query_timeout: Duration::from_secs(5),
            max_concurrent_queries: 100,
        }
    }
}

/// Active query state
#[derive(Debug)]
struct ActiveQuery {
    /// Query ID
    query_id: String,

    /// Vertex being queried
    vertex_id: VertexId,

    /// Query round
    round: u64,

    /// Response aggregation
    response: QueryResponse,

    /// Query start time
    started_at: Instant,

    /// Response channel
    response_tx: Option<mpsc::UnboundedSender<QueryResponse>>,
}

/// Query handler
pub struct QueryHandler {
    /// Configuration
    config: QueryConfig,

    /// Active queries
    active_queries: Arc<RwLock<HashMap<String, ActiveQuery>>>,

    /// Network node IDs for sampling
    network_nodes: Arc<RwLock<Vec<String>>>,
}

impl QueryHandler {
    /// Create a new query handler
    pub fn new(config: QueryConfig) -> Self {
        Self {
            config,
            active_queries: Arc::new(RwLock::new(HashMap::new())),
            network_nodes: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Register a network node
    pub fn register_node(&self, node_id: String) {
        let mut nodes = self.network_nodes.write().unwrap();
        if !nodes.contains(&node_id) {
            nodes.push(node_id);
        }
    }

    /// Get network size
    pub fn network_size(&self) -> usize {
        let nodes = self.network_nodes.read().unwrap();
        nodes.len()
    }

    /// Start a new query
    pub async fn query_vertex(
        &self,
        vertex_id: VertexId,
        round: u64,
    ) -> Result<mpsc::UnboundedReceiver<QueryResponse>> {
        let query_id = Uuid::new_v4().to_string();

        // Create response channel
        let (tx, rx) = mpsc::unbounded_channel();

        // Create active query
        let active_query = ActiveQuery {
            query_id: query_id.clone(),
            vertex_id: vertex_id.clone(),
            round,
            response: QueryResponse::new(query_id.clone()),
            started_at: Instant::now(),
            response_tx: Some(tx),
        };

        // Store active query
        {
            let mut queries = self.active_queries.write().unwrap();

            // Check concurrent query limit
            if queries.len() >= self.config.max_concurrent_queries {
                return Err(NetworkError::Query(
                    "Too many concurrent queries".to_string()
                ));
            }

            queries.insert(query_id.clone(), active_query);
        }

        // Sample nodes to query
        let sampled_nodes = self.sample_nodes()?;

        debug!(
            "Started query {} for vertex {} (round {}) to {} nodes",
            query_id,
            vertex_id,
            round,
            sampled_nodes.len()
        );

        // TODO: Send query messages to sampled nodes via QUIC
        // For now, simulate query being sent

        Ok(rx)
    }

    /// Handle a vote response
    pub fn handle_vote(
        &self,
        query_id: &str,
        accept: bool,
    ) -> Result<()> {
        let mut queries = self.active_queries.write().unwrap();

        if let Some(query) = queries.get_mut(query_id) {
            if accept {
                query.response.add_accept();
            } else {
                query.response.add_reject();
            }

            debug!(
                "Query {}: {}/{} responses",
                query_id,
                query.response.total,
                self.config.sample_size
            );

            // Check if query is complete
            if query.response.total >= self.config.sample_size {
                self.complete_query(query_id, queries)?;
            }
        } else {
            warn!("Received vote for unknown query: {}", query_id);
        }

        Ok(())
    }

    /// Complete a query and send response
    fn complete_query(
        &self,
        query_id: &str,
        mut queries: std::sync::RwLockWriteGuard<HashMap<String, ActiveQuery>>,
    ) -> Result<()> {
        if let Some(mut query) = queries.remove(query_id) {
            let response = query.response.clone();

            if let Some(tx) = query.response_tx.take() {
                let _ = tx.send(response);
            }

            info!(
                "Completed query {} for vertex {} (accepts: {}, rejects: {})",
                query_id,
                query.vertex_id,
                query.response.accepts,
                query.response.rejects
            );
        }

        Ok(())
    }

    /// Clean up timed out queries
    pub fn cleanup_timeouts(&self) -> usize {
        let mut queries = self.active_queries.write().unwrap();
        let mut timed_out = Vec::new();

        for (query_id, query) in queries.iter() {
            if query.started_at.elapsed() > self.config.query_timeout {
                timed_out.push(query_id.clone());
            }
        }

        let count = timed_out.len();

        for query_id in timed_out {
            warn!("Query {} timed out", query_id);
            queries.remove(&query_id);
        }

        count
    }

    /// Sample random nodes for query
    fn sample_nodes(&self) -> Result<Vec<String>> {
        let nodes = self.network_nodes.read().unwrap();

        if nodes.is_empty() {
            return Err(NetworkError::Query("No network nodes available".to_string()));
        }

        let sample_size = std::cmp::min(self.config.sample_size, nodes.len());

        // Use a deterministic sampling approach instead of random
        // In production, this would use actual randomness
        let sampled: Vec<_> = nodes
            .iter()
            .take(sample_size)
            .cloned()
            .collect();

        Ok(sampled)
    }

    /// Get number of active queries
    pub fn active_query_count(&self) -> usize {
        let queries = self.active_queries.read().unwrap();
        queries.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_query_handler_creation() {
        let config = QueryConfig::default();
        let handler = QueryHandler::new(config);

        assert_eq!(handler.network_size(), 0);
        assert_eq!(handler.active_query_count(), 0);
    }

    #[test]
    fn test_node_registration() {
        let config = QueryConfig::default();
        let handler = QueryHandler::new(config);

        handler.register_node("node-1".to_string());
        handler.register_node("node-2".to_string());
        handler.register_node("node-1".to_string()); // Duplicate

        assert_eq!(handler.network_size(), 2);
    }

    #[tokio::test]
    async fn test_vote_handling() {
        let config = QueryConfig::default();
        let handler = QueryHandler::new(config);

        // Register nodes
        for i in 0..50 {
            handler.register_node(format!("node-{}", i));
        }

        // Start query
        let mut rx = handler.query_vertex("vertex-1".to_string(), 1).await.unwrap();

        // Get query ID from active queries
        let query_id = {
            let queries = handler.active_queries.read().unwrap();
            queries.keys().next().unwrap().clone()
        };

        // Simulate votes
        for _ in 0..30 {
            handler.handle_vote(&query_id, true).ok();
        }

        // Should receive response
        let response = rx.recv().await.unwrap();
        assert_eq!(response.accepts, 30);
    }

    #[test]
    fn test_timeout_cleanup() {
        let config = QueryConfig {
            sample_size: 30,
            query_timeout: Duration::from_millis(10),
            max_concurrent_queries: 100,
        };
        let handler = QueryHandler::new(config);

        // Create a query manually
        let query = ActiveQuery {
            query_id: "test-query".to_string(),
            vertex_id: "vertex-1".to_string(),
            round: 1,
            response: QueryResponse::new("test-query".to_string()),
            started_at: Instant::now() - Duration::from_secs(1), // Already timed out
            response_tx: None,
        };

        {
            let mut queries = handler.active_queries.write().unwrap();
            queries.insert("test-query".to_string(), query);
        }

        // Cleanup should remove the timed out query
        let removed = handler.cleanup_timeouts();
        assert_eq!(removed, 1);
        assert_eq!(handler.active_query_count(), 0);
    }
}
