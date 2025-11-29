//! Integration tests for BFT consensus with reputation system
//!
//! Tests the complete integration of reputation tracking in consensus operations.

use cretoai_consensus::{BftConfig, NodeId};
use cretoai_reputation::{ActivityType, ViolationType};
use uuid::Uuid;

/// Helper to create test configuration
fn create_test_config() -> BftConfig {
    BftConfig {
        node_id: Uuid::new_v4(),
        total_nodes: 4,
        quorum_threshold: 0.67,
        finality_timeout_ms: 500,
        max_pending_vertices: 1000,
        byzantine_detection_enabled: true,
        signature_scheme: "ml-dsa-87".to_string(),
        parallel_config: Default::default(),
    }
}

#[tokio::test]
async fn test_reputation_increases_on_vertex_finalization() {
    // This test would use the integrated BFT engine
    // For now, we're testing the reputation system directly

    use cretoai_reputation::{ActivityEvent, ReputationTracker};
    use std::time::SystemTime;

    let tracker = ReputationTracker::new();
    let node_id = Uuid::new_v4();

    // Initial reputation
    let initial_rep = tracker.get_reputation(&node_id);
    assert_eq!(initial_rep, 0.5);

    // Simulate vertex finalization
    tracker
        .record_activity(ActivityEvent {
            node_id,
            timestamp: SystemTime::now(),
            event_type: ActivityType::VertexFinalized,
            metadata: None,
        })
        .unwrap();

    // Reputation should increase by 1%
    let new_rep = tracker.get_reputation(&node_id);
    assert!((new_rep - 0.51).abs() < 0.001);
}

#[tokio::test]
async fn test_reputation_decreases_on_equivocation() {
    use cretoai_reputation::{ActivityEvent, ReputationTracker};
    use std::time::SystemTime;

    let tracker = ReputationTracker::new();
    let node_id = Uuid::new_v4();

    // Initial reputation
    assert_eq!(tracker.get_reputation(&node_id), 0.5);

    // Simulate equivocation
    tracker
        .record_activity(ActivityEvent {
            node_id,
            timestamp: SystemTime::now(),
            event_type: ActivityType::ViolationDetected(ViolationType::Equivocation),
            metadata: None,
        })
        .unwrap();

    // Reputation should decrease by 20%
    let new_rep = tracker.get_reputation(&node_id);
    assert!((new_rep - 0.30).abs() < 0.001);
}

#[tokio::test]
async fn test_reputation_consensus_participation() {
    use cretoai_reputation::{ActivityEvent, ReputationTracker};
    use std::time::SystemTime;

    let tracker = ReputationTracker::new();
    let node_id = Uuid::new_v4();

    // Simulate multiple consensus rounds
    for _ in 0..10 {
        tracker
            .record_activity(ActivityEvent {
                node_id,
                timestamp: SystemTime::now(),
                event_type: ActivityType::ConsensusParticipation,
                metadata: None,
            })
            .unwrap();
    }

    // Reputation should increase (0.5% per participation * 10 = 5%)
    let rep = tracker.get_reputation(&node_id);
    assert!((rep - 0.55).abs() < 0.001);
}

#[tokio::test]
async fn test_unreliable_nodes_excluded() {
    use cretoai_reputation::{ActivityEvent, ReputationTracker};
    use std::time::SystemTime;

    let tracker = ReputationTracker::new();
    let node_id = Uuid::new_v4();

    // Cause reputation to drop below threshold (0.2)
    for _ in 0..3 {
        tracker
            .record_activity(ActivityEvent {
                node_id,
                timestamp: SystemTime::now(),
                event_type: ActivityType::ViolationDetected(ViolationType::Equivocation),
                metadata: None,
            })
            .unwrap();
    }

    // Node should be unreliable
    assert!(!tracker.is_reliable(&node_id));
    assert!(tracker.get_reputation(&node_id) < 0.2);
}

#[tokio::test]
async fn test_reputation_statistics() {
    use cretoai_reputation::{ActivityEvent, ActivityType, ReputationTracker};
    use std::time::SystemTime;

    let tracker = ReputationTracker::new();

    // Create multiple nodes with different behaviors
    let good_nodes: Vec<Uuid> = (0..3).map(|_| Uuid::new_v4()).collect();
    let bad_nodes: Vec<Uuid> = (0..2).map(|_| Uuid::new_v4()).collect();

    // Good nodes finalize vertices
    for node_id in &good_nodes {
        for _ in 0..10 {
            tracker
                .record_activity(ActivityEvent {
                    node_id: *node_id,
                    timestamp: SystemTime::now(),
                    event_type: ActivityType::VertexFinalized,
                    metadata: None,
                })
                .unwrap();
        }
    }

    // Bad nodes commit violations
    for node_id in &bad_nodes {
        for _ in 0..5 {
            tracker
                .record_activity(ActivityEvent {
                    node_id: *node_id,
                    timestamp: SystemTime::now(),
                    event_type: ActivityType::ViolationDetected(ViolationType::ByzantineBehavior),
                    metadata: None,
                })
                .unwrap();
        }
    }

    let stats = tracker.get_statistics();
    assert_eq!(stats.total_nodes, 5);
    assert_eq!(stats.reliable_nodes, 3);
    assert_eq!(stats.unreliable_nodes, 2);
    assert!(stats.total_violations >= 10);
}

#[tokio::test]
async fn test_invalid_signature_penalty() {
    use cretoai_reputation::{ActivityEvent, ReputationTracker};
    use std::time::SystemTime;

    let tracker = ReputationTracker::new();
    let node_id = Uuid::new_v4();

    // Simulate invalid signature
    tracker
        .record_activity(ActivityEvent {
            node_id,
            timestamp: SystemTime::now(),
            event_type: ActivityType::ViolationDetected(ViolationType::InvalidSignature),
            metadata: None,
        })
        .unwrap();

    // Reputation should decrease by 10%
    let rep = tracker.get_reputation(&node_id);
    assert!((rep - 0.40).abs() < 0.001);
}

#[tokio::test]
async fn test_reputation_recovery() {
    use cretoai_reputation::{ActivityEvent, ActivityType, ReputationTracker};
    use std::time::SystemTime;

    let tracker = ReputationTracker::new();
    let node_id = Uuid::new_v4();

    // Start with violations
    tracker
        .record_activity(ActivityEvent {
            node_id,
            timestamp: SystemTime::now(),
            event_type: ActivityType::ViolationDetected(ViolationType::TimeoutViolation),
            metadata: None,
        })
        .unwrap();

    let low_rep = tracker.get_reputation(&node_id);
    assert!(low_rep < 0.5);

    // Recovery through good behavior
    for _ in 0..50 {
        tracker
            .record_activity(ActivityEvent {
                node_id,
                timestamp: SystemTime::now(),
                event_type: ActivityType::VertexFinalized,
                metadata: None,
            })
            .unwrap();
    }

    let recovered_rep = tracker.get_reputation(&node_id);
    assert!(recovered_rep > low_rep);
    assert!(recovered_rep >= 0.9); // Should reach high reputation
}

#[test]
fn test_reputation_config_integration() {
    use cretoai_reputation::{ReputationConfig, ReputationTracker};
    use std::time::Duration;

    let config = ReputationConfig {
        initial_reputation: 0.6,
        max_reputation: 1.0,
        min_threshold: 0.3,
        decay_rate: 0.05,
        decay_half_life: Duration::from_secs(30 * 24 * 3600),
    };

    let tracker = ReputationTracker::with_config(config.clone());
    let node_id = Uuid::new_v4();

    // New node should have custom initial reputation
    assert_eq!(tracker.get_reputation(&node_id), 0.6);
    assert_eq!(tracker.get_config().initial_reputation, 0.6);
}
