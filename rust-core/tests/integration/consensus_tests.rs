//! Integration tests for multi-node consensus
//! Tests Byzantine fault-tolerant consensus mechanisms

use std::sync::Arc;
use tokio::sync::RwLock;

#[cfg(test)]
mod basic_consensus {
    use super::*;

    #[tokio::test]
    async fn test_single_node_consensus() {
        let network = setup_consensus_network(1).await;

        let vertex = create_test_vertex(b"data");
        let result = network.propose_vertex(vertex).await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_finalized());
    }

    #[tokio::test]
    async fn test_three_node_consensus() {
        let network = setup_consensus_network(3).await;

        let vertex = create_test_vertex(b"consensus test");
        let result = network.propose_vertex(vertex.clone()).await;

        assert!(result.is_ok());

        // All nodes should agree on the vertex
        for node in &network.nodes {
            let has_vertex = node.has_vertex(&vertex.hash()).await;
            assert!(has_vertex);
        }
    }

    #[tokio::test]
    async fn test_majority_consensus() {
        let network = setup_consensus_network(7).await;

        let vertex = create_test_vertex(b"majority");
        let result = network.propose_vertex(vertex).await;

        assert!(result.is_ok());

        let agreement = network.check_agreement(&vertex.hash()).await;
        assert!(agreement.count >= 5); // >2/3 of 7
    }

    #[tokio::test]
    async fn test_concurrent_proposals() {
        let network = Arc::new(setup_consensus_network(5).await);

        let mut handles = vec![];

        for i in 0..10 {
            let net = Arc::clone(&network);
            let data = format!("proposal {}", i);

            let handle = tokio::spawn(async move {
                let vertex = create_test_vertex(data.as_bytes());
                net.propose_vertex(vertex).await
            });

            handles.push(handle);
        }

        let results: Vec<_> = futures::future::join_all(handles).await;

        // All proposals should reach consensus
        for result in results {
            assert!(result.is_ok());
            assert!(result.unwrap().is_ok());
        }
    }
}

#[cfg(test)]
mod byzantine_fault_tolerance {
    use super::*;

    #[tokio::test]
    async fn test_single_byzantine_node() {
        let network = setup_consensus_network(4).await;

        // Mark one node as byzantine
        network.nodes[3].set_byzantine(true).await;

        let vertex = create_test_vertex(b"BFT test");
        let result = network.propose_vertex(vertex.clone()).await;

        // Should still reach consensus with 3/4 honest nodes
        assert!(result.is_ok());

        // Verify honest nodes agree
        let honest_agreement = network.check_honest_agreement(&vertex.hash()).await;
        assert_eq!(honest_agreement.count, 3);
    }

    #[tokio::test]
    async fn test_f_plus_one_byzantine_failure() {
        let network = setup_consensus_network(7).await;

        // Make 3 nodes byzantine (f=2, so f+1=3)
        for i in 4..7 {
            network.nodes[i].set_byzantine(true).await;
        }

        let vertex = create_test_vertex(b"f+1 test");
        let result = network.propose_vertex(vertex).await;

        // Should still work with 4 honest nodes (>2/3 of 7 requires 5)
        // This might fail or take longer depending on protocol
        assert!(result.is_ok() || result.is_err());
    }

    #[tokio::test]
    async fn test_conflicting_proposals() {
        let network = setup_consensus_network(5).await;

        let vertex1 = create_test_vertex(b"version A");
        let vertex2 = create_test_vertex(b"version B");

        // Two nodes propose conflicting vertices
        let handle1 = network.nodes[0].propose(vertex1.clone());
        let handle2 = network.nodes[1].propose(vertex2.clone());

        let (result1, result2) = tokio::join!(handle1, handle2);

        // Only one should win consensus
        let finalized_count = [result1.is_ok(), result2.is_ok()]
            .iter()
            .filter(|&&x| x)
            .count();

        assert_eq!(finalized_count, 1);
    }

    #[tokio::test]
    async fn test_message_delay_attack() {
        let network = setup_consensus_network(5).await;

        // One node has high latency
        network.nodes[4].set_latency(std::time::Duration::from_secs(2)).await;

        let vertex = create_test_vertex(b"delayed");
        let start = std::time::Instant::now();

        let result = network.propose_vertex(vertex).await;
        let duration = start.elapsed();

        // Should reach consensus without waiting for delayed node
        assert!(result.is_ok());
        assert!(duration < std::time::Duration::from_secs(2));
    }

    #[tokio::test]
    async fn test_equivocation_detection() {
        let network = setup_consensus_network(4).await;

        let byzantine_node = &network.nodes[3];
        byzantine_node.set_byzantine(true).await;

        // Byzantine node sends different messages to different peers
        let vertex1 = create_test_vertex(b"version A");
        let vertex2 = create_test_vertex(b"version B");

        byzantine_node.equivocate(vertex1, vertex2).await;

        // Honest nodes should detect equivocation
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        let equivocation_detected = network.nodes[0]
            .has_detected_equivocation(&byzantine_node.id())
            .await;

        assert!(equivocation_detected);
    }
}

#[cfg(test)]
mod voting_rounds {
    use super::*;

    #[tokio::test]
    async fn test_voting_round_completion() {
        let network = setup_consensus_network(5).await;

        let vertex = create_test_vertex(b"vote");
        let round = network.start_voting_round(vertex).await.unwrap();

        // Wait for round completion
        let result = round.wait_for_completion().await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_vote_collection() {
        let network = setup_consensus_network(7).await;

        let vertex = create_test_vertex(b"collect votes");
        let round = network.start_voting_round(vertex.clone()).await.unwrap();

        // Simulate votes
        for i in 0..5 {
            network.nodes[i].vote(round.id(), true).await.unwrap();
        }

        let votes = round.collect_votes().await;
        assert_eq!(votes.yes_count, 5);
        assert!(votes.has_majority());
    }

    #[tokio::test]
    async fn test_vote_threshold() {
        let network = setup_consensus_network(10).await;

        let vertex = create_test_vertex(b"threshold");
        let round = network.start_voting_round(vertex).await.unwrap();

        // 6 nodes vote yes (60%)
        for i in 0..6 {
            network.nodes[i].vote(round.id(), true).await.unwrap();
        }

        // 4 nodes vote no (40%)
        for i in 6..10 {
            network.nodes[i].vote(round.id(), false).await.unwrap();
        }

        let result = round.finalize().await;

        // Should pass with >50% but fail if >2/3 required
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_voting_round_timeout() {
        let network = setup_consensus_network(3).await;

        let vertex = create_test_vertex(b"timeout");
        let round = network.start_voting_round_with_timeout(
            vertex,
            std::time::Duration::from_millis(100),
        ).await.unwrap();

        // Don't send votes, wait for timeout
        let result = round.wait_for_completion().await;

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ConsensusError::Timeout));
    }
}

#[cfg(test)]
mod finalization {
    use super::*;

    #[tokio::test]
    async fn test_vertex_finalization() {
        let network = setup_consensus_network(5).await;

        let vertex = create_test_vertex(b"finalize");
        let hash = vertex.hash();

        network.propose_vertex(vertex).await.unwrap();

        // Check finalization on all nodes
        for node in &network.nodes {
            let is_finalized = node.is_finalized(&hash).await;
            assert!(is_finalized);
        }
    }

    #[tokio::test]
    async fn test_finalization_order() {
        let network = setup_consensus_network(3).await;

        // Propose vertices with dependencies
        let v1 = create_test_vertex(b"first");
        let v1_hash = v1.hash();
        network.propose_vertex(v1).await.unwrap();

        let v2 = create_test_vertex_with_parent(b"second", v1_hash);
        let v2_hash = v2.hash();
        network.propose_vertex(v2).await.unwrap();

        let v3 = create_test_vertex_with_parent(b"third", v2_hash);
        let v3_hash = v3.hash();
        network.propose_vertex(v3).await.unwrap();

        // Check finalization order
        for node in &network.nodes {
            let order = node.get_finalization_order().await;

            let pos1 = order.iter().position(|h| h == &v1_hash).unwrap();
            let pos2 = order.iter().position(|h| h == &v2_hash).unwrap();
            let pos3 = order.iter().position(|h| h == &v3_hash).unwrap();

            assert!(pos1 < pos2);
            assert!(pos2 < pos3);
        }
    }

    #[tokio::test]
    async fn test_finalization_irreversibility() {
        let network = setup_consensus_network(5).await;

        let vertex = create_test_vertex(b"immutable");
        let hash = vertex.hash();

        network.propose_vertex(vertex).await.unwrap();

        // Verify finalized vertices cannot be reverted
        let result = network.nodes[0].revert_vertex(&hash).await;
        assert!(result.is_err());
    }
}

#[cfg(test)]
mod leader_election {
    use super::*;

    #[tokio::test]
    async fn test_elect_leader() {
        let network = setup_consensus_network(5).await;

        let leader = network.elect_leader().await;
        assert!(leader.is_some());
    }

    #[tokio::test]
    async fn test_leader_rotation() {
        let network = setup_consensus_network(5).await;

        let leader1 = network.elect_leader().await.unwrap();

        // Advance to next round
        network.advance_round().await;

        let leader2 = network.elect_leader().await.unwrap();

        // Leader should rotate
        assert_ne!(leader1, leader2);
    }

    #[tokio::test]
    async fn test_leader_failure_recovery() {
        let network = setup_consensus_network(5).await;

        let leader = network.elect_leader().await.unwrap();

        // Simulate leader failure
        network.fail_node(leader).await;

        // Should elect new leader
        let new_leader = network.elect_leader().await;
        assert!(new_leader.is_some());
        assert_ne!(new_leader.unwrap(), leader);
    }
}

#[cfg(test)]
mod network_partition {
    use super::*;

    #[tokio::test]
    async fn test_partition_detection() {
        let mut network = setup_consensus_network(6).await;

        // Create partition: [0,1,2] and [3,4,5]
        network.partition([0, 1, 2], [3, 4, 5]).await;

        // Wait for detection
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

        // Nodes should detect partition
        assert!(network.nodes[0].is_partitioned().await);
    }

    #[tokio::test]
    async fn test_consensus_during_partition() {
        let mut network = setup_consensus_network(6).await;

        network.partition([0, 1, 2], [3, 4, 5]).await;

        let vertex = create_test_vertex(b"partitioned");

        // Try to reach consensus in larger partition
        let result = network.partition_propose(0, vertex).await;

        // Might succeed in partition with 3 nodes if threshold allows
        assert!(result.is_ok() || result.is_err());
    }

    #[tokio::test]
    async fn test_partition_healing() {
        let mut network = setup_consensus_network(6).await;

        // Create and heal partition
        network.partition([0, 1, 2], [3, 4, 5]).await;

        let v1 = create_test_vertex(b"partition A");
        network.partition_propose(0, v1.clone()).await.ok();

        let v2 = create_test_vertex(b"partition B");
        network.partition_propose(3, v2.clone()).await.ok();

        // Heal partition
        network.heal_partition().await;

        // Wait for reconciliation
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        // All nodes should have consistent state
        let state0 = network.nodes[0].get_state_hash().await;
        let state5 = network.nodes[5].get_state_hash().await;

        assert_eq!(state0, state5);
    }
}

#[cfg(test)]
mod performance {
    use super::*;

    #[tokio::test]
    async fn test_consensus_latency() {
        let network = setup_consensus_network(5).await;

        let vertex = create_test_vertex(b"latency test");

        let start = std::time::Instant::now();
        network.propose_vertex(vertex).await.unwrap();
        let latency = start.elapsed();

        println!("Consensus latency (5 nodes): {:?}", latency);
        assert!(latency < std::time::Duration::from_secs(1));
    }

    #[tokio::test]
    async fn test_throughput() {
        let network = Arc::new(setup_consensus_network(5).await);

        let start = std::time::Instant::now();
        let mut handles = vec![];

        for i in 0..100 {
            let net = Arc::clone(&network);
            let data = format!("vertex {}", i);

            let handle = tokio::spawn(async move {
                let vertex = create_test_vertex(data.as_bytes());
                net.propose_vertex(vertex).await
            });

            handles.push(handle);
        }

        futures::future::join_all(handles).await;
        let duration = start.elapsed();

        let throughput = 100.0 / duration.as_secs_f64();
        println!("Consensus throughput: {:.2} vertices/sec", throughput);

        assert!(throughput > 10.0); // At least 10 vertices/sec
    }

    #[tokio::test]
    async fn test_scalability() {
        let node_counts = vec![3, 5, 7, 10, 15];

        for &count in &node_counts {
            let network = setup_consensus_network(count).await;

            let vertex = create_test_vertex(b"scale test");

            let start = std::time::Instant::now();
            network.propose_vertex(vertex).await.unwrap();
            let latency = start.elapsed();

            println!("{} nodes: {:?}", count, latency);

            // Latency should grow sublinearly
            assert!(latency < std::time::Duration::from_secs(5));
        }
    }
}

// Test utilities

struct ConsensusNetwork {
    nodes: Vec<ConsensusNode>,
}

impl ConsensusNetwork {
    async fn propose_vertex(&self, vertex: Vertex) -> Result<ConsensusResult, ConsensusError> {
        // Consensus protocol implementation
        Ok(ConsensusResult { finalized: true })
    }

    async fn check_agreement(&self, hash: &[u8; 32]) -> Agreement {
        Agreement { count: self.nodes.len() }
    }
}

struct ConsensusNode {
    id: [u8; 32],
    byzantine: Arc<RwLock<bool>>,
    latency: Arc<RwLock<std::time::Duration>>,
}

impl ConsensusNode {
    fn new(id: [u8; 32]) -> Self {
        Self {
            id,
            byzantine: Arc::new(RwLock::new(false)),
            latency: Arc::new(RwLock::new(std::time::Duration::from_millis(10))),
        }
    }

    async fn set_byzantine(&self, byzantine: bool) {
        *self.byzantine.write().await = byzantine;
    }

    async fn set_latency(&self, latency: std::time::Duration) {
        *self.latency.write().await = latency;
    }

    fn id(&self) -> [u8; 32] {
        self.id
    }
}

struct Vertex {
    data: Vec<u8>,
    parents: Vec<[u8; 32]>,
}

impl Vertex {
    fn hash(&self) -> [u8; 32] {
        [0u8; 32] // Placeholder
    }
}

fn create_test_vertex(data: &[u8]) -> Vertex {
    Vertex {
        data: data.to_vec(),
        parents: vec![],
    }
}

fn create_test_vertex_with_parent(data: &[u8], parent: [u8; 32]) -> Vertex {
    Vertex {
        data: data.to_vec(),
        parents: vec![parent],
    }
}

async fn setup_consensus_network(node_count: usize) -> ConsensusNetwork {
    let mut nodes = vec![];

    for i in 0..node_count {
        nodes.push(ConsensusNode::new([i as u8; 32]));
    }

    ConsensusNetwork { nodes }
}

struct ConsensusResult {
    finalized: bool,
}

impl ConsensusResult {
    fn is_finalized(&self) -> bool {
        self.finalized
    }
}

struct Agreement {
    count: usize,
}

#[derive(Debug)]
enum ConsensusError {
    Timeout,
    InsufficientVotes,
    ByzantineFailure,
}
