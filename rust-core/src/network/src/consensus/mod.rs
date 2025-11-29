//! Avalanche-based DAG consensus module
//!
//! Implements the Avalanche consensus protocol for distributed DAG-based
//! Byzantine fault-tolerant consensus over QUIC transport.
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │                    ConsensusNode                            │
//! ├─────────────────────────────────────────────────────────────┤
//! │                                                             │
//! │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐ │
//! │  │  Confidence  │    │  Propagator  │    │    Query     │ │
//! │  │   Tracker    │    │              │    │   Handler    │ │
//! │  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘ │
//! │         │                   │                    │          │
//! │         └───────────────────┴────────────────────┘          │
//! │                             │                               │
//! │                      ┌──────▼────────┐                      │
//! │                      │   Finality    │                      │
//! │                      │   Detector    │                      │
//! │                      └───────────────┘                      │
//! │                             │                               │
//! └─────────────────────────────┼───────────────────────────────┘
//!                               │
//!                        ┌──────▼──────┐
//!                        │    QUIC     │
//!                        │  Transport  │
//!                        └─────────────┘
//! ```
//!
//! # Components
//!
//! - **Protocol**: Message types and wire format
//! - **Confidence**: Counter-based confidence tracking
//! - **Propagator**: Vertex broadcast with deduplication
//! - **Query**: Query handling and response aggregation
//! - **Finality**: Finalization and conflict resolution
//! - **Node**: Main consensus coordinator
//!
//! # Example
//!
//! ```no_run
//! use cretoai_network::consensus::{ConsensusNode, ConsensusConfig};
//! use cretoai_crypto::keys::AgentIdentity;
//! use std::sync::Arc;
//!
//! # async fn example() -> Result<(), Box<dyn std::error::Error>> {
//! let identity = Arc::new(AgentIdentity::generate()?);
//! let config = ConsensusConfig::default();
//!
//! let node = ConsensusNode::new(identity, config).await?;
//! node.start().await?;
//! # Ok(())
//! # }
//! ```

pub mod adapter;
pub mod byzantine;
pub mod confidence;
pub mod finality;
pub mod node;
pub mod p2p_wrapper;
pub mod propagator;
pub mod protocol;
pub mod query;

pub use adapter::{NetworkAdapter, NetworkAdapterStats};
pub use byzantine::{ByzantineDetector, PeerStats};
pub use confidence::{ConfidenceParams, ConfidenceState, ConfidenceTracker};
pub use finality::{FinalityDetector, FinalityState};
pub use node::{ConsensusConfig, ConsensusNode};
pub use p2p_wrapper::ConsensusP2P;
pub use propagator::{PropagatorConfig, VertexPropagator};
pub use protocol::{ConsensusMessage, QueryResponse, VertexId, VertexProposal};
pub use query::{QueryConfig, QueryHandler};

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_security;

#[cfg(test)]
mod module_tests {
    #[test]
    fn test_module_imports() {
        // Verify all public types are accessible
        use super::*;

        let _: Option<ConfidenceParams> = None;
        let _: Option<ConfidenceState> = None;
        let _: Option<ConfidenceTracker> = None;
        let _: Option<FinalityDetector> = None;
        let _: Option<FinalityState> = None;
        let _: Option<ConsensusConfig> = None;
        let _: Option<ConsensusNode> = None;
        let _: Option<PropagatorConfig> = None;
        let _: Option<VertexPropagator> = None;
        let _: Option<ConsensusMessage> = None;
        let _: Option<QueryResponse> = None;
        let _: Option<VertexProposal> = None;
        let _: Option<QueryConfig> = None;
        let _: Option<QueryHandler> = None;
        let _: Option<NetworkAdapter> = None;
        let _: Option<ByzantineDetector> = None;
    }
}
