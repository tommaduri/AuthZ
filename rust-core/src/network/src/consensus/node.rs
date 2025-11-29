//! Consensus node coordinator
//!
//! Main orchestrator integrating all consensus components with QUIC transport
//! and DAG storage.

use super::{
    confidence::{ConfidenceParams, ConfidenceTracker},
    finality::FinalityDetector,
    propagator::{PropagatorConfig, VertexPropagator},
    protocol::{ConsensusMessage, VertexId, VertexProposal},
    query::{QueryConfig, QueryHandler},
};
use crate::error::{NetworkError, Result};
// TODO Phase 7: Use QUIC implementation when experimental-quic feature is complete
// For now, this module serves as documentation of intended architecture
// use crate::quic_transport::QuicTransport;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};
use cretoai_crypto::keys::AgentIdentity;

/// Consensus node configuration
#[derive(Debug, Clone)]
pub struct ConsensusConfig {
    /// Confidence tracking parameters
    pub confidence_params: ConfidenceParams,

    /// Vertex propagation configuration
    pub propagator_config: PropagatorConfig,

    /// Query handler configuration
    pub query_config: QueryConfig,

    /// QUIC transport configuration
    pub transport_config: QuicTransportConfig,

    /// Sample size for each consensus query
    pub sample_size: usize,

    /// Minimum network size for consensus
    pub min_network_size: usize,
}

impl Default for ConsensusConfig {
    fn default() -> Self {
        Self {
            confidence_params: ConfidenceParams::default(),
            propagator_config: PropagatorConfig::default(),
            query_config: QueryConfig::default(),
            transport_config: QuicTransportConfig::default(),
            sample_size: 30,
            min_network_size: 100,
        }
    }
}

/// Main consensus node
pub struct ConsensusNode {
    /// Agent identity
    identity: Arc<AgentIdentity>,

    /// Configuration
    config: ConsensusConfig,

    /// QUIC transport
    transport: Arc<QuicTransport>,

    /// Confidence tracker
    confidence: Arc<ConfidenceTracker>,

    /// Finality detector
    finality: Arc<FinalityDetector>,

    /// Vertex propagator
    propagator: Arc<VertexPropagator>,

    /// Query handler
    query_handler: Arc<QueryHandler>,

    /// Running state
    running: Arc<RwLock<bool>>,
}

impl ConsensusNode {
    /// Create a new consensus node
    pub async fn new(
        identity: Arc<AgentIdentity>,
        config: ConsensusConfig,
    ) -> Result<Self> {
        // Create QUIC transport
        let transport = Arc::new(QuicTransport::new(
            identity.clone(),
            config.transport_config.clone(),
        )?);

        // Create consensus components
        let confidence = Arc::new(ConfidenceTracker::new(config.confidence_params.clone()));
        let finality = Arc::new(FinalityDetector::new());
        let propagator = Arc::new(VertexPropagator::new(
            transport.clone(),
            config.propagator_config.clone(),
        ));
        let query_handler = Arc::new(QueryHandler::new(config.query_config.clone()));

        Ok(Self {
            identity,
            config,
            transport,
            confidence,
            finality,
            propagator,
            query_handler,
            running: Arc::new(RwLock::new(false)),
        })
    }

    /// Start the consensus node
    pub async fn start(&self) -> Result<()> {
        let mut running = self.running.write().await;
        if *running {
            return Err(NetworkError::Generic("Node already running".to_string()));
        }

        info!("Starting consensus node for agent {}", self.identity.id());

        // Start QUIC listener
        // TODO: Implement actual QUIC listening when transport API is ready

        *running = true;

        info!("Consensus node started successfully");

        Ok(())
    }

    /// Stop the consensus node
    pub async fn stop(&self) -> Result<()> {
        let mut running = self.running.write().await;
        if !*running {
            return Ok(());
        }

        info!("Stopping consensus node");

        *running = false;

        info!("Consensus node stopped");

        Ok(())
    }

    /// Propose a new vertex
    pub async fn propose_vertex(
        &self,
        parents: Vec<VertexId>,
        payload: Vec<u8>,
    ) -> Result<VertexId> {
        let vertex_id = uuid::Uuid::new_v4().to_string();

        let mut proposal = VertexProposal::new(
            vertex_id.clone(),
            parents.clone(),
            payload,
            self.identity.id().to_string(),
        );

        // Sign the proposal
        // TODO: Use actual signing key from AgentIdentity
        // For now, skip signing
        info!("Proposing vertex {}", vertex_id);

        // Register with finality detector
        self.finality.register_vertex(vertex_id.clone(), parents)?;

        // Initialize confidence tracking
        self.confidence.init_vertex(vertex_id.clone());

        // Broadcast to network
        self.propagator.broadcast(proposal).await?;

        // Run consensus
        self.run_consensus_for_vertex(&vertex_id).await?;

        Ok(vertex_id)
    }

    /// Run consensus for a specific vertex
    async fn run_consensus_for_vertex(&self, vertex_id: &VertexId) -> Result<()> {
        let mut round = 0u64;

        loop {
            // Check if already finalized
            if self.confidence.is_finalized(vertex_id) {
                info!("Vertex {} finalized after {} rounds", vertex_id, round);
                break;
            }

            // Check network size
            if self.query_handler.network_size() < self.config.min_network_size {
                return Err(NetworkError::Consensus(
                    format!(
                        "Network too small: {} < {}",
                        self.query_handler.network_size(),
                        self.config.min_network_size
                    )
                ));
            }

            // Start query
            let mut rx = self.query_handler.query_vertex(vertex_id.clone(), round).await?;

            // Wait for response
            if let Some(response) = rx.recv().await {
                // Update confidence
                self.confidence.update_confidence(
                    vertex_id,
                    response.accepts,
                    response.total,
                );

                // Check if finalized
                if self.confidence.is_finalized(vertex_id) {
                    self.finality.finalize_vertex(vertex_id)?;
                    info!("Finalized vertex {} after {} rounds", vertex_id, round);
                    break;
                }
            }

            round += 1;

            // Check timeout
            if round >= self.config.confidence_params.max_rounds {
                return Err(NetworkError::Consensus(
                    format!("Consensus timeout after {} rounds", round)
                ));
            }

            // Small delay between rounds
            tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
        }

        Ok(())
    }

    /// Handle incoming consensus message
    pub async fn handle_message(
        &self,
        peer_id: String,
        message: ConsensusMessage,
    ) -> Result<()> {
        match message {
            ConsensusMessage::ProposeVertex(proposal) => {
                self.handle_vertex_proposal(peer_id, proposal).await
            }
            ConsensusMessage::QueryVertex { vertex_id, round, query_id } => {
                self.handle_query(peer_id, vertex_id, round, query_id).await
            }
            ConsensusMessage::VoteAccept { vertex_id, signature, round, query_id } => {
                self.handle_vote_accept(peer_id, vertex_id, signature, round, query_id).await
            }
            ConsensusMessage::VoteReject { vertex_id, reason, round, query_id } => {
                self.handle_vote_reject(peer_id, vertex_id, reason, round, query_id).await
            }
        }
    }

    /// Handle vertex proposal
    async fn handle_vertex_proposal(
        &self,
        peer_id: String,
        proposal: VertexProposal,
    ) -> Result<()> {
        debug!("Received vertex proposal {} from {}", proposal.vertex_id, peer_id);

        // Register with finality detector
        self.finality.register_vertex(
            proposal.vertex_id.clone(),
            proposal.parents.clone(),
        )?;

        // Initialize confidence tracking
        self.confidence.init_vertex(proposal.vertex_id.clone());

        // Re-broadcast to other peers
        self.propagator.broadcast(proposal).await?;

        Ok(())
    }

    /// Handle query
    async fn handle_query(
        &self,
        peer_id: String,
        vertex_id: VertexId,
        round: u64,
        query_id: String,
    ) -> Result<()> {
        debug!("Received query {} for vertex {} from {}", query_id, vertex_id, peer_id);

        // Check our preference for the vertex
        let accept = self.confidence.get_state(&vertex_id)
            .map(|state| state.last_chit)
            .unwrap_or(false);

        // Send response
        // TODO: Implement actual response sending via QUIC

        Ok(())
    }

    /// Handle vote accept
    async fn handle_vote_accept(
        &self,
        peer_id: String,
        vertex_id: VertexId,
        _signature: Vec<u8>,
        _round: u64,
        query_id: String,
    ) -> Result<()> {
        debug!("Received accept vote from {} for vertex {}", peer_id, vertex_id);

        self.query_handler.handle_vote(&query_id, true)?;

        Ok(())
    }

    /// Handle vote reject
    async fn handle_vote_reject(
        &self,
        peer_id: String,
        vertex_id: VertexId,
        reason: String,
        _round: u64,
        query_id: String,
    ) -> Result<()> {
        warn!("Received reject vote from {} for vertex {}: {}", peer_id, vertex_id, reason);

        self.query_handler.handle_vote(&query_id, false)?;

        Ok(())
    }

    /// Register a peer node
    pub fn register_peer(&self, peer_id: String) {
        self.query_handler.register_node(peer_id);
    }

    /// Get finalized vertices
    pub fn get_finalized_vertices(&self) -> Vec<VertexId> {
        self.finality.get_finalized()
    }

    /// Check if vertex is finalized
    pub fn is_finalized(&self, vertex_id: &VertexId) -> bool {
        self.finality.is_finalized(vertex_id)
    }

    /// Get confidence for a vertex
    pub fn get_confidence(&self, vertex_id: &VertexId) -> Option<f64> {
        self.confidence.get_state(vertex_id)
            .map(|state| state.confidence)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_consensus_node_creation() {
        let identity = Arc::new(AgentIdentity::generate("test-agent-1".to_string()).unwrap());
        let config = ConsensusConfig::default();

        let node = ConsensusNode::new(identity, config).await.unwrap();

        assert_eq!(node.get_finalized_vertices().len(), 0);
    }

    #[tokio::test]
    async fn test_node_start_stop() {
        let identity = Arc::new(AgentIdentity::generate("test-agent-2".to_string()).unwrap());
        let config = ConsensusConfig::default();

        let node = ConsensusNode::new(identity, config).await.unwrap();

        assert!(node.start().await.is_ok());
        assert!(node.stop().await.is_ok());
    }

    #[tokio::test]
    async fn test_peer_registration() {
        let identity = Arc::new(AgentIdentity::generate("test-agent-3".to_string()).unwrap());
        let config = ConsensusConfig::default();

        let node = ConsensusNode::new(identity, config).await.unwrap();

        node.register_peer("peer-1".to_string());
        node.register_peer("peer-2".to_string());

        assert_eq!(node.query_handler.network_size(), 2);
    }
}
