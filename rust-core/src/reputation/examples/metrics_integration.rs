//! Example: Comprehensive Metrics Integration
//!
//! This example demonstrates how to integrate Prometheus metrics with the
//! reputation, stake, and reward systems.
//!
//! Run with: cargo run --example metrics_integration

use cretoai_reputation::{
    ReputationTracker, StakeManager, RewardDistributor,
    register_metrics, update_reputation_metrics, update_node_reputation_score,
    record_reputation_event, record_reputation_violation,
    update_stake_metrics, update_node_stake, record_stake_deposit,
    record_stake_slashing, record_stake_withdrawal,
    update_reward_metrics, record_reward_distribution, record_uptime_bonus,
    ActivityEvent, ActivityType, ViolationType,
};
use std::time::SystemTime;
use uuid::Uuid;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== CretoAI Reputation Metrics Integration Example ===\n");

    // Step 1: Initialize metrics
    println!("1. Initializing Prometheus metrics...");
    let metrics = register_metrics()?;
    println!("   ✓ Registered 42 metrics across reputation, stake, and reward systems\n");

    // Step 2: Create reputation tracker
    println!("2. Creating reputation tracker...");
    let tracker = ReputationTracker::new();
    println!("   ✓ Reputation tracker initialized\n");

    // Step 3: Create stake manager
    println!("3. Creating stake manager...");
    let mut stake_manager = StakeManager::new();
    println!("   ✓ Stake manager initialized\n");

    // Step 4: Create reward distributor
    println!("4. Creating reward distributor...");
    let mut reward_distributor = RewardDistributor::new();
    println!("   ✓ Reward distributor initialized\n");

    // Step 5: Simulate network activity with metrics tracking
    println!("5. Simulating network activity with metrics...\n");

    // Create test nodes
    let nodes: Vec<Uuid> = (0..5).map(|_| Uuid::new_v4()).collect();
    println!("   Created {} test nodes", nodes.len());

    // Simulate reputation events
    println!("\n   a) Recording reputation events:");
    for (i, node_id) in nodes.iter().enumerate() {
        let node_str = node_id.to_string();

        // Positive events
        for _ in 0..(5 + i) {
            let event = ActivityEvent {
                node_id: *node_id,
                timestamp: SystemTime::now(),
                event_type: ActivityType::VertexFinalized,
                metadata: None,
            };
            tracker.record_activity(event)?;
            record_reputation_event(&metrics, &node_str, "VertexFinalized");
        }

        // Occasional violations
        if i == 2 {
            let event = ActivityEvent {
                node_id: *node_id,
                timestamp: SystemTime::now(),
                event_type: ActivityType::ViolationDetected(ViolationType::TimeoutViolation),
                metadata: None,
            };
            tracker.record_activity(event)?;
            record_reputation_violation(&metrics, &node_str, "TimeoutViolation");
            println!("      Node {} received TimeoutViolation", i);
        }

        // Update metrics
        let score = tracker.get_reputation(node_id);
        update_node_reputation_score(&metrics, &node_str, score);
        println!("      Node {}: score = {:.3}", i, score);
    }

    // Update aggregate reputation metrics
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
    println!("\n   ✓ Updated aggregate reputation metrics");
    println!("      Total nodes: {}", rep_stats.total_nodes);
    println!("      Reliable: {}, Unreliable: {}", rep_stats.reliable_nodes, rep_stats.unreliable_nodes);
    println!("      Avg score: {:.3}, High: {:.3}, Low: {:.3}",
        rep_stats.average_score, rep_stats.highest_score, rep_stats.lowest_score);

    // Simulate stake deposits
    println!("\n   b) Recording stake deposits:");
    for (i, node_id) in nodes.iter().enumerate() {
        let amount = 10000 + (i as u64 * 5000);
        let lock_time = SystemTime::now() + std::time::Duration::from_secs(86400); // 1 day

        stake_manager.deposit_stake(*node_id, amount, lock_time)?;
        record_stake_deposit(&metrics, amount);
        update_node_stake(&metrics, &node_id.to_string(), amount);

        // Update reputation and stake in reward distributor
        let reputation = tracker.get_reputation(node_id);
        reward_distributor.update_reputation(*node_id, reputation);
        reward_distributor.update_stake(*node_id, amount);

        println!("      Node {}: deposited {} units", i, amount);
    }

    // Update aggregate stake metrics
    let stake_stats = stake_manager.get_statistics();
    update_stake_metrics(
        &metrics,
        stake_stats.total_staked,
        stake_stats.average_stake,
        stake_stats.total_withdrawals,
        0, // No unbonding yet
    );
    println!("\n   ✓ Updated aggregate stake metrics");
    println!("      Total staked: {}", stake_stats.total_staked);
    println!("      Average stake: {}", stake_stats.average_stake);

    // Simulate slashing
    println!("\n   c) Simulating slashing event:");
    let slashed_node = nodes[2];
    let slashed_amount = stake_manager.slash_stake(&slashed_node, ViolationType::TimeoutViolation)?;
    record_stake_slashing(&metrics, "TimeoutViolation", slashed_amount);
    update_node_stake(&metrics, &slashed_node.to_string(), stake_manager.get_stake(&slashed_node));
    println!("      Slashed {} units from node 2 for TimeoutViolation", slashed_amount);

    // Simulate reward distribution
    println!("\n   d) Distributing block rewards:");
    let vertex_id = Uuid::new_v4();
    let rewards = reward_distributor.distribute_block_reward(vertex_id, nodes.clone())?;

    for (i, reward) in rewards.iter().enumerate() {
        record_reward_distribution(&metrics, "BlockProduction", reward.amount);
        println!("      Node {}: earned {} units", i, reward.amount);
    }

    // Mark some rewards as distributed
    for reward in rewards.iter().take(3) {
        reward_distributor.mark_reward_distributed(&reward.id)?;
    }

    // Update reward metrics
    let reward_stats = reward_distributor.get_statistics();
    update_reward_metrics(
        &metrics,
        reward_stats.total_pending,
        reward_stats.unique_recipients,
        reward_stats.distribution_efficiency,
    );
    println!("\n   ✓ Updated aggregate reward metrics");
    println!("      Pending: {}, Distributed: {}", reward_stats.total_pending, reward_stats.total_distributed);
    println!("      Efficiency: {:.2}%", reward_stats.distribution_efficiency * 100.0);

    // Simulate uptime bonuses
    println!("\n   e) Distributing uptime bonuses:");
    let mut uptime_scores = std::collections::HashMap::new();
    for (i, node_id) in nodes.iter().enumerate() {
        let uptime = 0.90 + (i as f64 * 0.02); // 0.90 to 0.98
        uptime_scores.insert(*node_id, uptime);
    }

    let uptime_rewards = reward_distributor.distribute_uptime_bonuses(uptime_scores)?;
    for (i, reward) in uptime_rewards.iter().enumerate() {
        record_uptime_bonus(&metrics);
        record_reward_distribution(&metrics, "UptimeBonus", reward.amount);
        println!("      Node {}: earned {} units uptime bonus", i, reward.amount);
    }

    // Step 6: Display final metrics summary
    println!("\n6. Final Metrics Summary:");
    println!("   ==========================================");
    println!("   REPUTATION:");
    println!("     - Total nodes tracked: {}", rep_stats.total_nodes);
    println!("     - Reliable nodes: {}", rep_stats.reliable_nodes);
    println!("     - Average score: {:.3}", rep_stats.average_score);
    println!("     - Total violations: {}", rep_stats.total_violations);
    println!("     - Positive events: {}", rep_stats.total_positive_events);

    println!("\n   STAKE:");
    println!("     - Total staked: {} units", stake_stats.total_staked);
    println!("     - Total deposits: {}", stake_stats.total_deposits);
    println!("     - Total slashed: {} units", stake_stats.total_slashed);
    println!("     - Average stake: {} units", stake_stats.average_stake);

    println!("\n   REWARDS:");
    println!("     - Total distributed: {} units", reward_stats.total_distributed);
    println!("     - Total pending: {} units", reward_stats.total_pending);
    println!("     - Unique recipients: {}", reward_stats.unique_recipients);
    println!("     - Distribution efficiency: {:.2}%", reward_stats.distribution_efficiency * 100.0);

    println!("\n7. Metrics are ready for Prometheus scraping!");
    println!("   Access metrics at: http://localhost:9090/metrics");
    println!("   (Start node with metrics server enabled)");

    println!("\n=== Example Complete ===");
    println!("\nKey Prometheus Queries:");
    println!("  - Average reputation:     cretoai_reputation_mean");
    println!("  - Total stake:            cretoai_stake_total");
    println!("  - Pending rewards:        cretoai_rewards_pending_total");
    println!("  - Slashing by type:       rate(cretoai_stake_slashed_total[5m])");
    println!("  - Violations per node:    cretoai_reputation_violations_total");
    println!("  - Reward distribution:    rate(cretoai_rewards_distributed_count[1h])");

    Ok(())
}
