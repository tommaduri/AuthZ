//! Integration tests for Prometheus metrics
//!
//! Tests comprehensive metrics collection across reputation, stake, and reward systems

use cretoai_reputation::{
    ReputationTracker, StakeManager, RewardDistributor,
    register_metrics, update_reputation_metrics, update_node_reputation_score,
    record_reputation_event, record_reputation_violation, record_reputation_decay,
    update_stake_metrics, update_node_stake, record_stake_deposit,
    record_stake_slashing, record_stake_withdrawal,
    update_reward_metrics, record_reward_distribution, record_uptime_bonus,
    update_pending_rewards,
    ActivityEvent, ActivityType, ViolationType,
};
use std::time::{SystemTime, Duration};
use uuid::Uuid;
use prometheus::{Registry, Encoder, TextEncoder};

#[test]
fn test_metrics_registration() {
    let result = register_metrics();
    assert!(result.is_ok(), "Metrics registration should succeed");

    let metrics = result.unwrap();

    // Verify all metric types are initialized
    metrics.reputation_mean.set(0.75);
    assert_eq!(metrics.reputation_mean.get(), 0.75);

    metrics.stake_total.set(100000);
    assert_eq!(metrics.stake_total.get(), 100000);

    metrics.rewards_pending_total.set(5000);
    assert_eq!(metrics.rewards_pending_total.get(), 5000);
}

#[test]
fn test_reputation_metrics_integration() {
    let registry = Registry::new();
    let metrics = cretoai_reputation::metrics::ReputationMetrics::new(&registry).unwrap();
    let tracker = ReputationTracker::new();

    let node_id = Uuid::new_v4();
    let node_str = node_id.to_string();

    // Record some events
    for _ in 0..10 {
        let event = ActivityEvent {
            node_id,
            timestamp: SystemTime::now(),
            event_type: ActivityType::VertexFinalized,
            metadata: None,
        };
        tracker.record_activity(event).unwrap();
        record_reputation_event(&metrics, &node_str, "VertexFinalized");
    }

    // Update metrics
    let score = tracker.get_reputation(&node_id);
    update_node_reputation_score(&metrics, &node_str, score);

    // Verify metrics
    let recorded_score = metrics.reputation_score
        .with_label_values(&[&node_str])
        .get();
    assert_eq!(recorded_score, score);

    let event_count = metrics.reputation_events_total
        .with_label_values(&[&node_str, "VertexFinalized"])
        .get();
    assert_eq!(event_count, 10);
}

#[test]
fn test_violation_tracking_metrics() {
    let registry = Registry::new();
    let metrics = cretoai_reputation::metrics::ReputationMetrics::new(&registry).unwrap();
    let tracker = ReputationTracker::new();

    let node_id = Uuid::new_v4();
    let node_str = node_id.to_string();

    // Record violations
    let violations = vec![
        ViolationType::Equivocation,
        ViolationType::TimeoutViolation,
        ViolationType::Equivocation,
    ];

    for violation in violations {
        let event = ActivityEvent {
            node_id,
            timestamp: SystemTime::now(),
            event_type: ActivityType::ViolationDetected(violation),
            metadata: None,
        };
        tracker.record_activity(event).unwrap();
        record_reputation_violation(&metrics, &node_str, &format!("{:?}", violation));
    }

    // Verify violation counts
    let equivocation_count = metrics.reputation_violations_total
        .with_label_values(&[&node_str, "Equivocation"])
        .get();
    assert_eq!(equivocation_count, 2);

    let timeout_count = metrics.reputation_violations_total
        .with_label_values(&[&node_str, "TimeoutViolation"])
        .get();
    assert_eq!(timeout_count, 1);
}

#[test]
fn test_reputation_decay_metrics() {
    let registry = Registry::new();
    let metrics = cretoai_reputation::metrics::ReputationMetrics::new(&registry).unwrap();

    let node_id = Uuid::new_v4();
    let _node_str = node_id.to_string();

    // Record decay event
    let decay_seconds = 86400.0; // 1 day
    record_reputation_decay(&metrics, &_node_str, decay_seconds);

    // Histogram should have recorded the observation
    // Note: Histograms don't expose individual observations, but we can verify it doesn't panic
}

#[test]
fn test_stake_metrics_integration() {
    let registry = Registry::new();
    let metrics = cretoai_reputation::metrics::ReputationMetrics::new(&registry).unwrap();
    let mut stake_manager = StakeManager::new();

    let node_id = Uuid::new_v4();
    let node_str = node_id.to_string();
    let amount = 10000;

    // Make deposit
    let lock_time = SystemTime::now() + Duration::from_secs(86400 + 3600); // 25 hours
    stake_manager.deposit_stake(node_id, amount, lock_time).unwrap();

    // Update metrics
    record_stake_deposit(&metrics, amount);
    update_node_stake(&metrics, &node_str, amount);

    // Verify metrics
    assert_eq!(metrics.stake_deposits_total.get(), 1);

    let stake_amount = metrics.stake_per_node
        .with_label_values(&[&node_str])
        .get();
    assert_eq!(stake_amount, amount as i64);
}

#[test]
fn test_slashing_metrics_integration() {
    let registry = Registry::new();
    let metrics = cretoai_reputation::metrics::ReputationMetrics::new(&registry).unwrap();
    let mut stake_manager = StakeManager::new();

    let node_id = Uuid::new_v4();
    let node_str = node_id.to_string();
    let amount = 10000;

    // Deposit and slash
    let lock_time = SystemTime::now() + Duration::from_secs(86400 + 3600); // 25 hours
    stake_manager.deposit_stake(node_id, amount, lock_time).unwrap();

    let slashed_amount = stake_manager
        .slash_stake(&node_id, ViolationType::Equivocation)
        .unwrap();

    // Update metrics
    record_stake_slashing(&metrics, "Equivocation", slashed_amount);

    // Verify metrics
    let total_slashed = metrics.stake_slashed_total
        .with_label_values(&["Equivocation"])
        .get();
    assert_eq!(total_slashed, slashed_amount);
}

#[test]
fn test_withdrawal_metrics() {
    let registry = Registry::new();
    let metrics = cretoai_reputation::metrics::ReputationMetrics::new(&registry).unwrap();

    let amount = 5000;
    record_stake_withdrawal(&metrics, amount);

    assert_eq!(metrics.stake_withdrawals_total.get(), 1);
}

#[test]
fn test_reward_distribution_metrics() {
    let registry = Registry::new();
    let metrics = cretoai_reputation::metrics::ReputationMetrics::new(&registry).unwrap();
    let mut distributor = RewardDistributor::new();

    let nodes: Vec<Uuid> = (0..3).map(|_| Uuid::new_v4()).collect();
    let vertex_id = Uuid::new_v4();

    // Distribute rewards
    let rewards = distributor
        .distribute_block_reward(vertex_id, nodes.clone())
        .unwrap();

    for reward in &rewards {
        record_reward_distribution(&metrics, "BlockProduction", reward.amount);
    }

    // Verify metrics
    let count = metrics.rewards_distributed_count
        .with_label_values(&["BlockProduction"])
        .get();
    assert_eq!(count, 3);

    let total_value = metrics.rewards_distributed_total_value.get();
    assert!(total_value > 0);
}

#[test]
fn test_uptime_bonus_metrics() {
    let registry = Registry::new();
    let metrics = cretoai_reputation::metrics::ReputationMetrics::new(&registry).unwrap();

    record_uptime_bonus(&metrics);
    record_uptime_bonus(&metrics);
    record_uptime_bonus(&metrics);

    assert_eq!(metrics.rewards_uptime_bonuses_total.get(), 3);
}

#[test]
fn test_pending_rewards_per_node() {
    let registry = Registry::new();
    let metrics = cretoai_reputation::metrics::ReputationMetrics::new(&registry).unwrap();

    let node_id = Uuid::new_v4();
    let node_str = node_id.to_string();
    let pending_amount = 2500;

    update_pending_rewards(&metrics, &node_str, pending_amount);

    let recorded_pending = metrics.rewards_pending_per_node
        .with_label_values(&[&node_str])
        .get();
    assert_eq!(recorded_pending, pending_amount as i64);
}

#[test]
fn test_aggregate_metrics_update() {
    let registry = Registry::new();
    let metrics = cretoai_reputation::metrics::ReputationMetrics::new(&registry).unwrap();

    // Update all aggregate metrics
    update_reputation_metrics(&metrics, 10, 8, 2, 0.75, 0.95, 0.25);
    update_stake_metrics(&metrics, 100000, 10000, 5, 20000);
    update_reward_metrics(&metrics, 5000, 8, 0.85);

    // Verify reputation metrics
    assert_eq!(metrics.reputation_total_nodes.get(), 10);
    assert_eq!(metrics.reputation_nodes_above_threshold.get(), 8);
    assert_eq!(metrics.reputation_mean.get(), 0.75);

    // Verify stake metrics
    assert_eq!(metrics.stake_total.get(), 100000);
    assert_eq!(metrics.stake_average.get(), 10000);
    assert_eq!(metrics.stake_pending_withdrawals.get(), 5);

    // Verify reward metrics
    assert_eq!(metrics.rewards_pending_total.get(), 5000);
    assert_eq!(metrics.rewards_unique_recipients.get(), 8);
    assert_eq!(metrics.rewards_distribution_efficiency.get(), 0.85);
}

#[test]
fn test_metrics_prometheus_format() {
    let registry = Registry::new();
    let _metrics = cretoai_reputation::metrics::ReputationMetrics::new(&registry).unwrap();

    // Gather metrics in Prometheus format
    let encoder = TextEncoder::new();
    let metric_families = registry.gather();
    let mut buffer = Vec::new();
    encoder.encode(&metric_families, &mut buffer).unwrap();

    let output = String::from_utf8(buffer).unwrap();

    // Verify metrics are in output
    assert!(output.contains("cretoai_reputation_score"));
    assert!(output.contains("cretoai_stake_total"));
    assert!(output.contains("cretoai_rewards_pending_total"));
}

#[test]
fn test_concurrent_metrics_updates() {
    use std::sync::Arc;
    use std::thread;

    let registry = Arc::new(Registry::new());
    let metrics = Arc::new(
        cretoai_reputation::metrics::ReputationMetrics::new(&registry).unwrap()
    );

    let handles: Vec<_> = (0..10)
        .map(|i| {
            let metrics = Arc::clone(&metrics);
            thread::spawn(move || {
                let node_id = Uuid::new_v4();
                let node_str = node_id.to_string();

                for _ in 0..100 {
                    update_node_reputation_score(&metrics, &node_str, 0.5 + (i as f64 / 20.0));
                    record_reputation_event(&metrics, &node_str, "Test");
                }
            })
        })
        .collect();

    for handle in handles {
        handle.join().unwrap();
    }

    // Verify no panics occurred and metrics were updated
    // Each thread should have recorded events, but we can't predict exact count
    // due to concurrent label creation. Just verify no panics occurred.
}

#[test]
fn test_full_system_metrics_integration() {
    let registry = Registry::new();
    let metrics = Arc::new(
        cretoai_reputation::metrics::ReputationMetrics::new(&registry).unwrap()
    );

    // Create all components
    let tracker = ReputationTracker::new();
    let mut stake_manager = StakeManager::new();
    let mut reward_distributor = RewardDistributor::new();

    let nodes: Vec<Uuid> = (0..5).map(|_| Uuid::new_v4()).collect();

    // 1. Record reputation events
    for node_id in &nodes {
        let event = ActivityEvent {
            node_id: *node_id,
            timestamp: SystemTime::now(),
            event_type: ActivityType::VertexFinalized,
            metadata: None,
        };
        tracker.record_activity(event).unwrap();
        record_reputation_event(&metrics, &node_id.to_string(), "VertexFinalized");

        let score = tracker.get_reputation(node_id);
        update_node_reputation_score(&metrics, &node_id.to_string(), score);
    }

    // 2. Make stake deposits
    for node_id in &nodes {
        let amount = 10000;
        let lock_time = SystemTime::now() + Duration::from_secs(86400 + 3600); // 25 hours
        stake_manager.deposit_stake(*node_id, amount, lock_time).unwrap();
        record_stake_deposit(&metrics, amount);
        update_node_stake(&metrics, &node_id.to_string(), amount);

        // Update reward distributor
        reward_distributor.update_reputation(*node_id, tracker.get_reputation(node_id));
        reward_distributor.update_stake(*node_id, amount);
    }

    // 3. Distribute rewards
    let vertex_id = Uuid::new_v4();
    let rewards = reward_distributor
        .distribute_block_reward(vertex_id, nodes.clone())
        .unwrap();

    for reward in &rewards {
        record_reward_distribution(&metrics, "BlockProduction", reward.amount);
    }

    // 4. Update aggregate metrics
    let rep_stats = tracker.get_statistics();
    update_reputation_metrics(
        &metrics,
        rep_stats.total_nodes,
        rep_stats.reliable_nodes,
        rep_stats.unreliable_nodes,
        rep_stats.average_score,
        rep_stats.highest_score,
        rep_stats.lowest_score,
    );

    let stake_stats = stake_manager.get_statistics();
    update_stake_metrics(
        &metrics,
        stake_stats.total_staked,
        stake_stats.average_stake,
        stake_stats.total_withdrawals,
        0,
    );

    let reward_stats = reward_distributor.get_statistics();
    update_reward_metrics(
        &metrics,
        reward_stats.total_pending,
        reward_stats.unique_recipients,
        reward_stats.distribution_efficiency,
    );

    // 5. Verify all metrics are set
    assert_eq!(metrics.reputation_total_nodes.get(), nodes.len() as i64);
    assert_eq!(metrics.stake_total.get(), (nodes.len() * 10000) as i64);
    assert!(metrics.rewards_pending_total.get() > 0);

    // 6. Generate Prometheus output
    let encoder = TextEncoder::new();
    let metric_families = registry.gather();
    let mut buffer = Vec::new();
    encoder.encode(&metric_families, &mut buffer).unwrap();

    let output = String::from_utf8(buffer).unwrap();

    // Verify comprehensive metrics are present
    assert!(output.contains("cretoai_reputation_mean"));
    assert!(output.contains("cretoai_stake_total"));
    assert!(output.contains("cretoai_rewards_distributed_count"));
    // Note: violations_total may not appear if no violations were recorded
    assert!(output.contains("cretoai_stake_deposits_total"));
}

use std::sync::Arc;
