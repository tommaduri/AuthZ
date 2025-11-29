//! Security-focused integration tests for consensus
//!
//! Tests signature verification, Byzantine detection, and network adapter integration.

#[cfg(test)]
mod security_tests {
    use crate::consensus::{ByzantineDetector, NetworkAdapter, ConsensusP2P};
    use crate::consensus_p2p::ConsensusResponse;
    use crate::consensus_p2p::ConsensusP2PNode;
    use std::sync::Arc;
    use cretoai_crypto::signatures::MLDSA87;

    #[test]
    fn test_rejects_invalid_signature() {
        let p2p_node = Arc::new(ConsensusP2PNode::new("test-node".to_string()));
        let p2p = Arc::new(ConsensusP2P::new(p2p_node));
        let adapter = NetworkAdapter::new(p2p);

        // Create a forged response with invalid signature
        let forged_response = ConsensusResponse {
            query_id: "q1".to_string(),
            vertex_id: "v1".to_string(),
            responder: "malicious-peer".to_string(),
            vote: true,
            confidence: 0.99,
            timestamp: 1234567890,
            signature: vec![0u8; 100], // Invalid signature bytes
        };

        // Generate a test keypair
        let keypair = MLDSA87::generate();

        // Verify should fail
        let result = adapter.verify_response_signature(&forged_response, &keypair.public_key);
        assert!(result.is_ok());
        assert!(!result.unwrap()); // Signature verification should fail
    }

    #[test]
    fn test_detects_equivocation() {
        let detector = ByzantineDetector::new();

        let vote1 = vec![1, 0, 0]; // Vote: accept
        let vote2 = vec![0, 1, 0]; // Vote: reject (different!)

        // First vote
        let is_byzantine1 = detector.detect_equivocation("peer1", "vertex1", &vote1);
        assert!(!is_byzantine1); // No equivocation yet

        // Second different vote on same vertex - equivocation!
        let is_byzantine2 = detector.detect_equivocation("peer1", "vertex1", &vote2);
        assert!(is_byzantine2); // Equivocation detected!

        // Peer should not be trusted anymore
        assert!(!detector.is_trusted("peer1"));

        // Check stats
        let stats = detector.get_peer_stats("peer1");
        assert_eq!(stats.equivocations, 1);
        assert!(stats.reputation < 0.5);
    }

    #[test]
    fn test_byzantine_reputation_tracking() {
        let detector = ByzantineDetector::new();

        // Report multiple malicious behaviors
        detector.report_invalid_signature("peer1".to_string());
        detector.report_invalid_signature("peer1".to_string());

        let stats = detector.get_peer_stats("peer1");

        // Should have low reputation
        assert_eq!(stats.invalid_signatures, 2);
        assert!(stats.reputation < 0.5);
        assert!(!stats.is_trusted);

        // Should appear in untrusted list
        let untrusted = detector.get_untrusted_peers();
        assert!(untrusted.contains(&"peer1".to_string()));
    }

    #[test]
    fn test_signature_verification_with_valid_signature() {
        let p2p_node = Arc::new(ConsensusP2PNode::new("test-node".to_string()));
        let p2p = Arc::new(ConsensusP2P::new(p2p_node));
        let adapter = NetworkAdapter::new(p2p);

        // Generate keypair
        let keypair = MLDSA87::generate();

        // Create response data
        let mut response = ConsensusResponse {
            query_id: "q1".to_string(),
            vertex_id: "v1".to_string(),
            responder: "honest-peer".to_string(),
            vote: true,
            confidence: 0.95,
            timestamp: 1234567890,
            signature: vec![],
        };

        // Serialize and sign
        let message = bincode::serialize(&response).unwrap();
        let signature = keypair.sign(&message);
        response.signature = signature.as_bytes().to_vec();

        // Verify should succeed
        let result = adapter.verify_response_signature(&response, &keypair.public_key);
        assert!(result.is_ok());
        assert!(result.unwrap()); // Valid signature
    }

    #[tokio::test]
    async fn test_network_adapter_integration() {
        let p2p_node = Arc::new(ConsensusP2PNode::new("test-node".to_string()));
        let p2p = Arc::new(ConsensusP2P::new(p2p_node.clone()));
        let adapter = NetworkAdapter::new(p2p);

        // Add some test peers
        p2p_node.add_peer("peer1".to_string());
        p2p_node.add_peer("peer2".to_string());

        // Query should complete (even with no responses in test)
        let result = adapter.query_peers("vertex1", 2).await;
        assert!(result.is_ok());

        let responses = result.unwrap();
        // In test environment with no real network, we expect empty responses
        assert_eq!(responses.len(), 0);
    }

    #[test]
    fn test_multiple_peer_equivocation_detection() {
        let detector = ByzantineDetector::new();

        // Honest peer
        detector.detect_equivocation("honest-peer", "v1", &[1, 2, 3]);
        detector.detect_equivocation("honest-peer", "v1", &[1, 2, 3]); // Same vote

        // Malicious peer
        detector.detect_equivocation("malicious-peer", "v1", &[1, 2, 3]);
        detector.detect_equivocation("malicious-peer", "v1", &[4, 5, 6]); // Different vote!

        // Check reputations
        assert!(detector.is_trusted("honest-peer"));
        assert!(!detector.is_trusted("malicious-peer"));

        // Verify stats
        let honest_stats = detector.get_peer_stats("honest-peer");
        assert_eq!(honest_stats.equivocations, 0);

        let malicious_stats = detector.get_peer_stats("malicious-peer");
        assert_eq!(malicious_stats.equivocations, 1);
    }

    #[test]
    fn test_reputation_recovery() {
        let detector = ByzantineDetector::new();

        // Damage reputation
        detector.reduce_reputation("peer1", 0.4);
        assert!(!detector.is_trusted("peer1"));

        // Recovery through good behavior
        detector.increase_reputation("peer1", 0.3);
        assert!(detector.is_trusted("peer1"));
    }

    #[test]
    fn test_byzantine_detector_peer_reset() {
        let detector = ByzantineDetector::new();

        // Create Byzantine history
        detector.report_invalid_signature("peer1".to_string());
        detector.detect_equivocation("peer1", "v1", &[1, 2, 3]);
        detector.detect_equivocation("peer1", "v1", &[4, 5, 6]);

        // Verify peer is untrusted
        assert!(!detector.is_trusted("peer1"));

        // Reset peer (e.g., after manual verification)
        detector.reset_peer("peer1");

        // Should be trusted again
        assert!(detector.is_trusted("peer1"));

        let stats = detector.get_peer_stats("peer1");
        assert_eq!(stats.invalid_signatures, 0);
        assert_eq!(stats.equivocations, 0);
        assert_eq!(stats.reputation, 1.0);
    }

    #[test]
    fn test_network_adapter_stats() {
        let p2p_node = Arc::new(ConsensusP2PNode::new("test-node".to_string()));
        let p2p = Arc::new(ConsensusP2P::new(p2p_node.clone()));
        let adapter = NetworkAdapter::new(p2p);

        let stats = adapter.get_stats();
        assert_eq!(stats.peer_count, 0);
        assert_eq!(stats.pending_queries, 0);
        assert_eq!(stats.cached_vertices, 0);
        assert_eq!(stats.query_timeout_ms, 5000);
    }
}
