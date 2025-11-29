//! Byzantine Fault Tolerant Consensus Engine for CretoAI
//!
//! This module implements PBFT (Practical Byzantine Fault Tolerance) consensus
//! to enable CretoAI to withstand up to 33% malicious nodes (f Byzantine nodes
//! in a network of 3f+1 nodes).
//!
//! ## Architecture
//!
//! The consensus engine follows a 4-phase PBFT protocol:
//! 1. **Pre-Prepare**: Leader proposes a vertex
//! 2. **Prepare**: Nodes validate and broadcast prepare messages
//! 3. **Commit**: After 2f+1 prepares, nodes broadcast commit
//! 4. **Execute**: After 2f+1 commits, vertex is finalized
//!
//! ## Byzantine Detection
//!
//! The system detects and handles Byzantine behavior including:
//! - Equivocation (conflicting messages)
//! - Invalid signatures
//! - Timeout violations
//! - Reputation-based node banning

pub mod bft;
pub mod byzantine_detection;
pub mod error;
pub mod message;
pub mod metrics;
pub mod state;
pub mod view_change;
// Phase 7: Production Hardening
pub mod weighted_voting;
pub mod adaptive_quorum;
pub mod multi_signature;
pub mod fork_detector;
// Phase 7 Week 7-8: Circuit Breaker Pattern
pub mod circuit_breaker;
pub mod fallback;
pub mod adaptive_timeout;
// Reputation Integration (temporarily disabled due to circular dependency)
// pub mod bft_reputation_integration;

pub use bft::{BftEngine, BftConfig, ParallelConfig, ValidationResult, BenchmarkResult};
pub use byzantine_detection::{ByzantineDetector, Violation};
pub use error::{ConsensusError, Result};
pub use message::{ConsensusMessage, PrePrepare, Prepare, Commit, ViewChange};
pub use metrics::ConsensusMetrics;
pub use state::{ConsensusState, MessageLog};
pub use view_change::{ViewChangeManager, ViewChangeProof};
// Phase 7 exports
pub use weighted_voting::{WeightedVotingSystem, WeightConfig, VoteWeight, VotingStats};
pub use adaptive_quorum::{AdaptiveQuorumManager, AdaptiveQuorumConfig, ThreatLevel, AdaptiveQuorumStats};
pub use multi_signature::{MultiSignatureManager, MultiSigConfig, AggregatedSignature, PartialSignature, CollectionStatus};
pub use fork_detector::{ForkDetector, ForkDetectorConfig, ForkInfo, ForkStatus, ChainBranch, ForkStats};
// Phase 7 Week 7-8: Circuit Breaker exports
pub use circuit_breaker::{CircuitBreaker, CircuitConfig, CircuitState, CircuitStats};
pub use fallback::{FallbackStrategy, FallbackConfig, FallbackResponse, PendingRequest, RequestPriority};
pub use adaptive_timeout::{AdaptiveTimeout, AdaptiveTimeoutConfig, LatencyStats};
// Reputation Integration exports (temporarily disabled due to circular dependency)
// pub use bft_reputation_integration::ReputationBftEngine;

/// Node identifier in the consensus network
pub type NodeId = uuid::Uuid;

/// Consensus view number (monotonically increasing)
pub type ViewNumber = u64;

/// Consensus sequence number (monotonically increasing)
pub type SequenceNumber = u64;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quorum_calculation() {
        // For 4 nodes, f=1, quorum = 2f+1 = 3
        assert_eq!(calculate_quorum(4), 3);

        // For 7 nodes, f=2, quorum = 2f+1 = 5
        assert_eq!(calculate_quorum(7), 5);

        // For 10 nodes, f=3, quorum = 2f+1 = 7
        assert_eq!(calculate_quorum(10), 7);
    }

    fn calculate_quorum(n: usize) -> usize {
        let f = (n - 1) / 3;
        2 * f + 1
    }
}
