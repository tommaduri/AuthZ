// LibP2P Integration Test Module
// Test-Driven Development (TDD) - RED PHASE
// All tests should FAIL initially, defining requirements for implementation

pub mod swarm_test;
pub mod gossipsub_test;
pub mod kademlia_test;
pub mod mdns_test;
pub mod quic_test;
pub mod consensus_integration_test;
pub mod exchange_integration_test;
pub mod mcp_integration_test;
pub mod nat_traversal_test;
pub mod performance_test;

// Test utilities and helpers
pub mod test_utils;

/// Test configuration constants
pub const DEFAULT_TEST_TIMEOUT_MS: u64 = 5000;
pub const NETWORK_STABILIZATION_MS: u64 = 1000;
pub const MESSAGE_PROPAGATION_TIMEOUT_MS: u64 = 500;
pub const DHT_QUERY_TIMEOUT_MS: u64 = 2000;

/// Expected performance targets from specification
pub mod performance_targets {
    pub const MAX_MESSAGE_PROPAGATION_P95_MS: u64 = 100;
    pub const MAX_MESSAGE_PROPAGATION_P99_MS: u64 = 200;
    pub const MAX_CONNECTION_HANDSHAKE_MS: u64 = 1000;
    pub const MIN_CONSENSUS_TPS: u64 = 100;
    pub const MAX_MEMORY_PER_NODE_MB: usize = 500;
}

/// Gossipsub mesh configuration from specification
pub mod gossipsub_config {
    pub const MESH_N: usize = 6;
    pub const MESH_N_LOW: usize = 4;
    pub const MESH_N_HIGH: usize = 12;
    pub const MESH_OUTBOUND_MIN: usize = 2;
}

/// Test network topologies
#[derive(Debug, Clone, Copy)]
pub enum TestTopology {
    /// Linear chain (node0 -> node1 -> node2 -> ...)
    Linear,
    /// Full mesh (all nodes connected to all)
    FullMesh,
    /// Star (all nodes connected to central hub)
    Star,
    /// Ring (each node connected to next, last to first)
    Ring,
}
