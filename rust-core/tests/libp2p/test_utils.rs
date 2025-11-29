// Test utilities for LibP2P integration tests
// Provides helper functions for creating test nodes and networks

use std::time::Duration;
use tokio::time::timeout;

/// Result type for tests
pub type TestResult<T> = Result<T, Box<dyn std::error::Error>>;

/// Mock LibP2P swarm (implementation should fail until vigilia-network implements VigiliaSwarm)
pub struct MockVigiliaSwarm {
    pub agent_id: String,
    pub peer_id: String, // Would be libp2p::PeerId
}

impl MockVigiliaSwarm {
    pub async fn new(agent_id: String) -> TestResult<Self> {
        // This should fail - VigiliaSwarm not implemented yet
        Err("VigiliaSwarm not implemented - TDD RED phase".into())
    }

    pub async fn listen(&mut self, _addr: &str) -> TestResult<()> {
        Err("listen not implemented".into())
    }

    pub async fn dial(&mut self, _peer_id: &str, _addr: &str) -> TestResult<()> {
        Err("dial not implemented".into())
    }

    pub async fn subscribe(&mut self, _topic: &str) -> TestResult<()> {
        Err("subscribe not implemented".into())
    }

    pub async fn publish(&mut self, _topic: &str, _data: &[u8]) -> TestResult<String> {
        Err("publish not implemented".into())
    }

    pub fn connected_peers(&self) -> Vec<String> {
        vec![] // Empty until implemented
    }

    pub fn subscribed_topics(&self) -> Vec<String> {
        vec![] // Empty until implemented
    }
}

/// Create a cluster of test nodes
pub async fn create_swarm_cluster(count: usize) -> TestResult<Vec<MockVigiliaSwarm>> {
    let mut nodes = Vec::new();
    for i in 0..count {
        let agent_id = format!("test-agent-{}", i);
        let node = MockVigiliaSwarm::new(agent_id).await?;
        nodes.push(node);
    }
    Ok(nodes)
}

/// Connect nodes in a specific topology
pub async fn connect_topology(
    nodes: &mut [MockVigiliaSwarm],
    topology: super::TestTopology,
) -> TestResult<()> {
    match topology {
        super::TestTopology::FullMesh => connect_full_mesh(nodes).await,
        super::TestTopology::Linear => connect_linear(nodes).await,
        super::TestTopology::Star => connect_star(nodes).await,
        super::TestTopology::Ring => connect_ring(nodes).await,
    }
}

async fn connect_full_mesh(nodes: &mut [MockVigiliaSwarm]) -> TestResult<()> {
    for i in 0..nodes.len() {
        for j in (i + 1)..nodes.len() {
            // This will fail until implemented
            nodes[i]
                .dial(&nodes[j].peer_id, "127.0.0.1:0")
                .await?;
        }
    }
    Ok(())
}

async fn connect_linear(_nodes: &mut [MockVigiliaSwarm]) -> TestResult<()> {
    Err("Linear topology not implemented".into())
}

async fn connect_star(_nodes: &mut [MockVigiliaSwarm]) -> TestResult<()> {
    Err("Star topology not implemented".into())
}

async fn connect_ring(_nodes: &mut [MockVigiliaSwarm]) -> TestResult<()> {
    Err("Ring topology not implemented".into())
}

/// Wait for network to stabilize
pub async fn wait_for_network_stabilization() -> TestResult<()> {
    tokio::time::sleep(Duration::from_millis(
        super::NETWORK_STABILIZATION_MS,
    ))
    .await;
    Ok(())
}

/// Wait for specific number of peers with timeout
pub async fn wait_for_peers(
    node: &MockVigiliaSwarm,
    expected_count: usize,
    timeout_ms: u64,
) -> TestResult<()> {
    let result = timeout(
        Duration::from_millis(timeout_ms),
        async {
            loop {
                if node.connected_peers().len() >= expected_count {
                    return Ok(());
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        },
    )
    .await;

    match result {
        Ok(r) => r,
        Err(_) => Err(format!(
            "Timeout waiting for {} peers, got {}",
            expected_count,
            node.connected_peers().len()
        )
        .into()),
    }
}

/// Mock vertex message for consensus tests
#[derive(Debug, Clone, PartialEq)]
pub struct MockVertexMessage {
    pub vertex_hash: String,
    pub data: Vec<u8>,
    pub signature: Vec<u8>,
}

impl MockVertexMessage {
    pub fn new(data: Vec<u8>) -> Self {
        Self {
            vertex_hash: format!("hash-{:?}", data),
            data,
            signature: vec![0u8; 64], // Mock signature
        }
    }

    pub fn serialize(&self) -> TestResult<Vec<u8>> {
        // Would use bincode::serialize
        Err("Serialization not implemented".into())
    }

    pub fn deserialize(_data: &[u8]) -> TestResult<Self> {
        Err("Deserialization not implemented".into())
    }
}

/// Mock resource listing for exchange tests
#[derive(Debug, Clone)]
pub struct MockResourceListing {
    pub resource_id: String,
    pub resource_type: String,
    pub price: u64,
}

/// Mock agent announcement for MCP tests
#[derive(Debug, Clone)]
pub struct MockAgentAnnouncement {
    pub agent_id: String,
    pub tools: Vec<String>,
    pub capabilities: Vec<String>,
}

/// Performance measurement utilities
pub struct PerformanceMeasurement {
    pub start: std::time::Instant,
}

impl PerformanceMeasurement {
    pub fn start() -> Self {
        Self {
            start: std::time::Instant::now(),
        }
    }

    pub fn elapsed_ms(&self) -> u64 {
        self.start.elapsed().as_millis() as u64
    }

    pub fn assert_less_than_ms(&self, max_ms: u64) -> TestResult<()> {
        let elapsed = self.elapsed_ms();
        if elapsed > max_ms {
            Err(format!("Performance target failed: {}ms > {}ms", elapsed, max_ms).into())
        } else {
            Ok(())
        }
    }
}

/// Calculate percentile from latency measurements
pub fn calculate_percentile(mut latencies: Vec<u64>, percentile: f64) -> u64 {
    if latencies.is_empty() {
        return 0;
    }
    latencies.sort();
    let index = ((latencies.len() as f64) * percentile) as usize;
    latencies[index.min(latencies.len() - 1)]
}
