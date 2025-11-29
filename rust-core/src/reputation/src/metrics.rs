//! Prometheus Metrics for Reputation, Stake, and Reward Systems (Phase 7)
//!
//! Comprehensive metrics collection for monitoring and observability:
//! - **Reputation Metrics**: Scores, violations, decay rates, and distribution
//! - **Stake Metrics**: Total staked, deposits, slashing, withdrawals
//! - **Reward Metrics**: Distribution, pending rewards, and types
//!
//! All metrics are exposed in Prometheus format and can be scraped from the
//! node's metrics endpoint (default: http://localhost:9090/metrics)

use prometheus::{
    register_gauge_vec_with_registry,
    register_gauge_with_registry, register_histogram_vec_with_registry, register_int_counter_vec_with_registry,
    register_int_gauge_vec_with_registry, register_int_gauge_with_registry,
    Gauge, GaugeVec, Histogram, HistogramVec, IntCounter, IntCounterVec, IntGauge, IntGaugeVec,
    Registry, Opts, HistogramOpts,
};
use std::sync::Arc;
use lazy_static::lazy_static;
use parking_lot::RwLock;

/// Default histogram buckets for reputation scores (0.0 to 1.0)
const REPUTATION_SCORE_BUCKETS: &[f64] = &[0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

/// Default histogram buckets for stake amounts (in units)
const STAKE_AMOUNT_BUCKETS: &[f64] = &[
    1000.0,      // MIN_STAKE
    5000.0,
    10000.0,
    50000.0,
    100000.0,
    500000.0,
    1000000.0,   // MAX_STAKE
];

/// Default histogram buckets for reward amounts
const REWARD_AMOUNT_BUCKETS: &[f64] = &[
    10.0,
    50.0,
    100.0,
    500.0,
    1000.0,
    5000.0,
    10000.0,
];

/// Default histogram buckets for decay time (in seconds)
const DECAY_TIME_BUCKETS: &[f64] = &[
    3600.0,      // 1 hour
    86400.0,     // 1 day
    604800.0,    // 1 week
    2592000.0,   // 30 days
    7776000.0,   // 90 days
];

lazy_static! {
    /// Global metrics registry shared across all reputation components
    static ref METRICS_REGISTRY: Arc<RwLock<Option<Registry>>> = Arc::new(RwLock::new(None));
}

/// Comprehensive metrics collection for reputation, stake, and reward systems
pub struct ReputationMetrics {
    // === REPUTATION METRICS ===

    /// Current reputation score per node (Gauge)
    pub reputation_score: GaugeVec,

    /// Mean reputation score across all nodes (Gauge)
    pub reputation_mean: Gauge,

    /// Median reputation score across all nodes (Gauge)
    pub reputation_median: Gauge,

    /// Number of nodes above reliability threshold (Gauge)
    pub reputation_nodes_above_threshold: IntGauge,

    /// Number of nodes below reliability threshold (Gauge)
    pub reputation_nodes_below_threshold: IntGauge,

    /// Total violations detected per node and type (Counter)
    pub reputation_violations_total: IntCounterVec,

    /// Total reputation events per node and type (Counter)
    pub reputation_events_total: IntCounterVec,

    /// Histogram of reputation decay times (Histogram)
    pub reputation_decay_seconds: HistogramVec,

    /// Histogram of reputation score distribution (Histogram)
    pub reputation_score_distribution: Histogram,

    /// Total number of tracked nodes (Gauge)
    pub reputation_total_nodes: IntGauge,

    /// Highest reputation score in the network (Gauge)
    pub reputation_highest_score: Gauge,

    /// Lowest reputation score in the network (Gauge)
    pub reputation_lowest_score: Gauge,

    // === STAKE METRICS ===

    /// Total amount staked across all nodes (Gauge)
    pub stake_total: IntGauge,

    /// Stake amount per node (Gauge)
    pub stake_per_node: IntGaugeVec,

    /// Average stake per node (Gauge)
    pub stake_average: IntGauge,

    /// Total number of deposits made (Counter)
    pub stake_deposits_total: IntCounter,

    /// Total amount slashed historically (Counter)
    pub stake_slashed_total: IntCounterVec,

    /// Total number of withdrawals completed (Counter)
    pub stake_withdrawals_total: IntCounter,

    /// Histogram of deposit amounts (Histogram)
    pub stake_deposit_amount_histogram: Histogram,

    /// Histogram of slashing amounts (Histogram)
    pub stake_slashing_amount_histogram: HistogramVec,

    /// Histogram of withdrawal amounts (Histogram)
    pub stake_withdrawal_amount_histogram: Histogram,

    /// Number of active deposits (Gauge)
    pub stake_active_deposits: IntGaugeVec,

    /// Number of pending withdrawals (Gauge)
    pub stake_pending_withdrawals: IntGauge,

    /// Total amount in unbonding state (Gauge)
    pub stake_unbonding_total: IntGauge,

    // === REWARD METRICS ===

    /// Total pending rewards across all nodes (Gauge)
    pub rewards_pending_total: IntGauge,

    /// Total value of distributed rewards (Counter)
    pub rewards_distributed_total_value: IntCounter,

    /// Number of rewards distributed by type (Counter)
    pub rewards_distributed_count: IntCounterVec,

    /// Number of uptime bonuses awarded (Counter)
    pub rewards_uptime_bonuses_total: IntCounter,

    /// Histogram of reward distribution amounts (Histogram)
    pub rewards_distribution_amount: HistogramVec,

    /// Pending rewards per node (Gauge)
    pub rewards_pending_per_node: IntGaugeVec,

    /// Total rewards earned per node (Counter)
    pub rewards_total_per_node: IntCounterVec,

    /// Distribution efficiency ratio (Gauge)
    pub rewards_distribution_efficiency: Gauge,

    /// Number of unique reward recipients (Gauge)
    pub rewards_unique_recipients: IntGauge,

    /// Failed reward distributions (Counter)
    pub rewards_failed_total: IntCounterVec,
}

impl ReputationMetrics {
    /// Create a new metrics collection with custom registry
    ///
    /// # Arguments
    /// * `registry` - Prometheus registry to register metrics with
    ///
    /// # Returns
    /// Result containing the metrics collection or error if registration fails
    pub fn new(registry: &Registry) -> Result<Self, prometheus::Error> {
        // === REPUTATION METRICS ===

        let reputation_score = register_gauge_vec_with_registry!(
            Opts::new("cretoai_reputation_score", "Current reputation score per node (0.0-1.0)"),
            &["node_id"],
            registry
        )?;

        let reputation_mean = register_gauge_with_registry!(
            Opts::new("cretoai_reputation_mean", "Mean reputation score across all nodes"),
            registry
        )?;

        let reputation_median = register_gauge_with_registry!(
            Opts::new("cretoai_reputation_median", "Median reputation score across all nodes"),
            registry
        )?;

        let reputation_nodes_above_threshold = register_int_gauge_with_registry!(
            Opts::new("cretoai_reputation_nodes_above_threshold", "Number of nodes above reliability threshold"),
            registry
        )?;

        let reputation_nodes_below_threshold = register_int_gauge_with_registry!(
            Opts::new("cretoai_reputation_nodes_below_threshold", "Number of nodes below reliability threshold"),
            registry
        )?;

        let reputation_violations_total = register_int_counter_vec_with_registry!(
            Opts::new("cretoai_reputation_violations_total", "Total violations detected per node and type"),
            &["node_id", "violation_type"],
            registry
        )?;

        let reputation_events_total = register_int_counter_vec_with_registry!(
            Opts::new("cretoai_reputation_events_total", "Total reputation events per node and type"),
            &["node_id", "event_type"],
            registry
        )?;

        let reputation_decay_seconds = register_histogram_vec_with_registry!(
            HistogramOpts::new("cretoai_reputation_decay_seconds", "Histogram of reputation decay times in seconds")
                .buckets(DECAY_TIME_BUCKETS.to_vec()),
            &["node_id"],
            registry
        )?;

        let reputation_score_distribution = register_histogram_vec_with_registry!(
            HistogramOpts::new("cretoai_reputation_score_distribution", "Distribution of reputation scores")
                .buckets(REPUTATION_SCORE_BUCKETS.to_vec()),
            &[],
            registry
        )?.with_label_values(&[]); // No labels for overall distribution

        let reputation_total_nodes = register_int_gauge_with_registry!(
            Opts::new("cretoai_reputation_total_nodes", "Total number of tracked nodes"),
            registry
        )?;

        let reputation_highest_score = register_gauge_with_registry!(
            Opts::new("cretoai_reputation_highest_score", "Highest reputation score in the network"),
            registry
        )?;

        let reputation_lowest_score = register_gauge_with_registry!(
            Opts::new("cretoai_reputation_lowest_score", "Lowest reputation score in the network"),
            registry
        )?;

        // === STAKE METRICS ===

        let stake_total = register_int_gauge_with_registry!(
            Opts::new("cretoai_stake_total", "Total amount staked across all nodes"),
            registry
        )?;

        let stake_per_node = register_int_gauge_vec_with_registry!(
            Opts::new("cretoai_stake_per_node", "Stake amount per node"),
            &["node_id"],
            registry
        )?;

        let stake_average = register_int_gauge_with_registry!(
            Opts::new("cretoai_stake_average", "Average stake per node"),
            registry
        )?;

        let stake_deposits_total = register_int_counter_vec_with_registry!(
            Opts::new("cretoai_stake_deposits_total", "Total number of deposits made"),
            &[],
            registry
        )?.with_label_values(&[]);

        let stake_slashed_total = register_int_counter_vec_with_registry!(
            Opts::new("cretoai_stake_slashed_total", "Total amount slashed by violation type"),
            &["violation_type"],
            registry
        )?;

        let stake_withdrawals_total = register_int_counter_vec_with_registry!(
            Opts::new("cretoai_stake_withdrawals_total", "Total number of withdrawals completed"),
            &[],
            registry
        )?.with_label_values(&[]);

        let stake_deposit_amount_histogram = register_histogram_vec_with_registry!(
            HistogramOpts::new("cretoai_stake_deposit_amount_histogram", "Distribution of stake deposit amounts")
                .buckets(STAKE_AMOUNT_BUCKETS.to_vec()),
            &[],
            registry
        )?.with_label_values(&[]);

        let stake_slashing_amount_histogram = register_histogram_vec_with_registry!(
            HistogramOpts::new("cretoai_stake_slashing_amount_histogram", "Distribution of slashing amounts by violation type")
                .buckets(STAKE_AMOUNT_BUCKETS.to_vec()),
            &["violation_type"],
            registry
        )?;

        let stake_withdrawal_amount_histogram = register_histogram_vec_with_registry!(
            HistogramOpts::new("cretoai_stake_withdrawal_amount_histogram", "Distribution of withdrawal amounts")
                .buckets(STAKE_AMOUNT_BUCKETS.to_vec()),
            &[],
            registry
        )?.with_label_values(&[]);

        let stake_active_deposits = register_int_gauge_vec_with_registry!(
            Opts::new("cretoai_stake_active_deposits", "Number of active deposits per node"),
            &["node_id"],
            registry
        )?;

        let stake_pending_withdrawals = register_int_gauge_with_registry!(
            Opts::new("cretoai_stake_pending_withdrawals", "Number of pending withdrawals"),
            registry
        )?;

        let stake_unbonding_total = register_int_gauge_with_registry!(
            Opts::new("cretoai_stake_unbonding_total", "Total amount in unbonding state"),
            registry
        )?;

        // === REWARD METRICS ===

        let rewards_pending_total = register_int_gauge_with_registry!(
            Opts::new("cretoai_rewards_pending_total", "Total pending rewards across all nodes"),
            registry
        )?;

        let rewards_distributed_total_value = register_int_counter_vec_with_registry!(
            Opts::new("cretoai_rewards_distributed_total_value", "Total value of distributed rewards"),
            &[],
            registry
        )?.with_label_values(&[]);

        let rewards_distributed_count = register_int_counter_vec_with_registry!(
            Opts::new("cretoai_rewards_distributed_count", "Number of rewards distributed by type"),
            &["reward_type"],
            registry
        )?;

        let rewards_uptime_bonuses_total = register_int_counter_vec_with_registry!(
            Opts::new("cretoai_rewards_uptime_bonuses_total", "Number of uptime bonuses awarded"),
            &[],
            registry
        )?.with_label_values(&[]);

        let rewards_distribution_amount = register_histogram_vec_with_registry!(
            HistogramOpts::new("cretoai_rewards_distribution_amount", "Distribution of reward amounts by type")
                .buckets(REWARD_AMOUNT_BUCKETS.to_vec()),
            &["reward_type"],
            registry
        )?;

        let rewards_pending_per_node = register_int_gauge_vec_with_registry!(
            Opts::new("cretoai_rewards_pending_per_node", "Pending rewards per node"),
            &["node_id"],
            registry
        )?;

        let rewards_total_per_node = register_int_counter_vec_with_registry!(
            Opts::new("cretoai_rewards_total_per_node", "Total rewards earned per node"),
            &["node_id"],
            registry
        )?;

        let rewards_distribution_efficiency = register_gauge_with_registry!(
            Opts::new("cretoai_rewards_distribution_efficiency", "Distribution efficiency ratio (distributed / total)"),
            registry
        )?;

        let rewards_unique_recipients = register_int_gauge_with_registry!(
            Opts::new("cretoai_rewards_unique_recipients", "Number of unique reward recipients"),
            registry
        )?;

        let rewards_failed_total = register_int_counter_vec_with_registry!(
            Opts::new("cretoai_rewards_failed_total", "Failed reward distributions by reason"),
            &["reason"],
            registry
        )?;

        Ok(Self {
            // Reputation
            reputation_score,
            reputation_mean,
            reputation_median,
            reputation_nodes_above_threshold,
            reputation_nodes_below_threshold,
            reputation_violations_total,
            reputation_events_total,
            reputation_decay_seconds,
            reputation_score_distribution,
            reputation_total_nodes,
            reputation_highest_score,
            reputation_lowest_score,
            // Stake
            stake_total,
            stake_per_node,
            stake_average,
            stake_deposits_total,
            stake_slashed_total,
            stake_withdrawals_total,
            stake_deposit_amount_histogram,
            stake_slashing_amount_histogram,
            stake_withdrawal_amount_histogram,
            stake_active_deposits,
            stake_pending_withdrawals,
            stake_unbonding_total,
            // Rewards
            rewards_pending_total,
            rewards_distributed_total_value,
            rewards_distributed_count,
            rewards_uptime_bonuses_total,
            rewards_distribution_amount,
            rewards_pending_per_node,
            rewards_total_per_node,
            rewards_distribution_efficiency,
            rewards_unique_recipients,
            rewards_failed_total,
        })
    }
}

/// Initialize the global metrics registry
///
/// This should be called once during node startup to create the shared
/// Prometheus registry used by all reputation components.
///
/// # Returns
/// Arc reference to the metrics collection
pub fn register_metrics() -> Result<Arc<ReputationMetrics>, prometheus::Error> {
    let mut registry_lock = METRICS_REGISTRY.write();

    // Create new registry if not already initialized
    let registry = registry_lock.get_or_insert_with(Registry::new);

    // Create metrics collection
    let metrics = ReputationMetrics::new(registry)?;

    Ok(Arc::new(metrics))
}

/// Get the global metrics registry
///
/// # Returns
/// Option containing the registry if initialized, None otherwise
pub fn get_registry() -> Option<Registry> {
    METRICS_REGISTRY.read().clone()
}

/// Update reputation metrics from reputation tracker statistics
///
/// # Arguments
/// * `metrics` - Metrics collection to update
/// * `stats` - Current reputation statistics
/// * `all_scores` - Map of all node scores
pub fn update_reputation_metrics(
    metrics: &ReputationMetrics,
    total_nodes: usize,
    reliable_nodes: usize,
    unreliable_nodes: usize,
    average_score: f64,
    highest_score: f64,
    lowest_score: f64,
) {
    // Update aggregate metrics
    metrics.reputation_total_nodes.set(total_nodes as i64);
    metrics.reputation_nodes_above_threshold.set(reliable_nodes as i64);
    metrics.reputation_nodes_below_threshold.set(unreliable_nodes as i64);
    metrics.reputation_mean.set(average_score);
    metrics.reputation_highest_score.set(highest_score);
    metrics.reputation_lowest_score.set(lowest_score);
}

/// Update per-node reputation score metric
///
/// # Arguments
/// * `metrics` - Metrics collection to update
/// * `node_id` - Node identifier
/// * `score` - Reputation score
pub fn update_node_reputation_score(
    metrics: &ReputationMetrics,
    node_id: &str,
    score: f64,
) {
    metrics.reputation_score
        .with_label_values(&[node_id])
        .set(score);

    // Also update score distribution histogram
    metrics.reputation_score_distribution.observe(score);
}

/// Record a reputation violation event
///
/// # Arguments
/// * `metrics` - Metrics collection to update
/// * `node_id` - Node identifier
/// * `violation_type` - Type of violation
pub fn record_reputation_violation(
    metrics: &ReputationMetrics,
    node_id: &str,
    violation_type: &str,
) {
    metrics.reputation_violations_total
        .with_label_values(&[node_id, violation_type])
        .inc();
}

/// Record a reputation event
///
/// # Arguments
/// * `metrics` - Metrics collection to update
/// * `node_id` - Node identifier
/// * `event_type` - Type of event
pub fn record_reputation_event(
    metrics: &ReputationMetrics,
    node_id: &str,
    event_type: &str,
) {
    metrics.reputation_events_total
        .with_label_values(&[node_id, event_type])
        .inc();
}

/// Record reputation decay time
///
/// # Arguments
/// * `metrics` - Metrics collection to update
/// * `node_id` - Node identifier
/// * `decay_seconds` - Time since last activity in seconds
pub fn record_reputation_decay(
    metrics: &ReputationMetrics,
    node_id: &str,
    decay_seconds: f64,
) {
    metrics.reputation_decay_seconds
        .with_label_values(&[node_id])
        .observe(decay_seconds);
}

/// Update stake metrics from stake manager statistics
///
/// # Arguments
/// * `metrics` - Metrics collection to update
/// * `total_staked` - Total amount staked
/// * `average_stake` - Average stake per node
/// * `pending_withdrawals` - Number of pending withdrawals
/// * `unbonding_total` - Total amount in unbonding
pub fn update_stake_metrics(
    metrics: &ReputationMetrics,
    total_staked: u64,
    average_stake: u64,
    pending_withdrawals: usize,
    unbonding_total: u64,
) {
    metrics.stake_total.set(total_staked as i64);
    metrics.stake_average.set(average_stake as i64);
    metrics.stake_pending_withdrawals.set(pending_withdrawals as i64);
    metrics.stake_unbonding_total.set(unbonding_total as i64);
}

/// Update per-node stake amount
///
/// # Arguments
/// * `metrics` - Metrics collection to update
/// * `node_id` - Node identifier
/// * `stake_amount` - Current stake amount
pub fn update_node_stake(
    metrics: &ReputationMetrics,
    node_id: &str,
    stake_amount: u64,
) {
    metrics.stake_per_node
        .with_label_values(&[node_id])
        .set(stake_amount as i64);
}

/// Record a stake deposit
///
/// # Arguments
/// * `metrics` - Metrics collection to update
/// * `amount` - Deposit amount
pub fn record_stake_deposit(
    metrics: &ReputationMetrics,
    amount: u64,
) {
    metrics.stake_deposits_total.inc();
    metrics.stake_deposit_amount_histogram.observe(amount as f64);
}

/// Record a slashing event
///
/// # Arguments
/// * `metrics` - Metrics collection to update
/// * `violation_type` - Type of violation that caused slashing
/// * `amount` - Amount slashed
pub fn record_stake_slashing(
    metrics: &ReputationMetrics,
    violation_type: &str,
    amount: u64,
) {
    metrics.stake_slashed_total
        .with_label_values(&[violation_type])
        .inc_by(amount);

    metrics.stake_slashing_amount_histogram
        .with_label_values(&[violation_type])
        .observe(amount as f64);
}

/// Record a completed withdrawal
///
/// # Arguments
/// * `metrics` - Metrics collection to update
/// * `amount` - Withdrawal amount
pub fn record_stake_withdrawal(
    metrics: &ReputationMetrics,
    amount: u64,
) {
    metrics.stake_withdrawals_total.inc();
    metrics.stake_withdrawal_amount_histogram.observe(amount as f64);
}

/// Update number of active deposits for a node
///
/// # Arguments
/// * `metrics` - Metrics collection to update
/// * `node_id` - Node identifier
/// * `count` - Number of active deposits
pub fn update_active_deposits(
    metrics: &ReputationMetrics,
    node_id: &str,
    count: usize,
) {
    metrics.stake_active_deposits
        .with_label_values(&[node_id])
        .set(count as i64);
}

/// Update reward metrics from reward distributor statistics
///
/// # Arguments
/// * `metrics` - Metrics collection to update
/// * `pending_total` - Total pending rewards
/// * `unique_recipients` - Number of unique recipients
/// * `distribution_efficiency` - Distribution efficiency ratio
pub fn update_reward_metrics(
    metrics: &ReputationMetrics,
    pending_total: u64,
    unique_recipients: usize,
    distribution_efficiency: f64,
) {
    metrics.rewards_pending_total.set(pending_total as i64);
    metrics.rewards_unique_recipients.set(unique_recipients as i64);
    metrics.rewards_distribution_efficiency.set(distribution_efficiency);
}

/// Record a distributed reward
///
/// # Arguments
/// * `metrics` - Metrics collection to update
/// * `reward_type` - Type of reward
/// * `amount` - Reward amount
pub fn record_reward_distribution(
    metrics: &ReputationMetrics,
    reward_type: &str,
    amount: u64,
) {
    metrics.rewards_distributed_count
        .with_label_values(&[reward_type])
        .inc();

    metrics.rewards_distributed_total_value.inc_by(amount);

    metrics.rewards_distribution_amount
        .with_label_values(&[reward_type])
        .observe(amount as f64);
}

/// Record an uptime bonus
///
/// # Arguments
/// * `metrics` - Metrics collection to update
pub fn record_uptime_bonus(metrics: &ReputationMetrics) {
    metrics.rewards_uptime_bonuses_total.inc();
}

/// Update pending rewards for a node
///
/// # Arguments
/// * `metrics` - Metrics collection to update
/// * `node_id` - Node identifier
/// * `pending_amount` - Total pending reward amount
pub fn update_pending_rewards(
    metrics: &ReputationMetrics,
    node_id: &str,
    pending_amount: u64,
) {
    metrics.rewards_pending_per_node
        .with_label_values(&[node_id])
        .set(pending_amount as i64);
}

/// Record total rewards for a node
///
/// # Arguments
/// * `metrics` - Metrics collection to update
/// * `node_id` - Node identifier
/// * `total_amount` - Total rewards earned
pub fn record_node_total_rewards(
    metrics: &ReputationMetrics,
    node_id: &str,
    amount: u64,
) {
    metrics.rewards_total_per_node
        .with_label_values(&[node_id])
        .inc_by(amount);
}

/// Record a failed reward distribution
///
/// # Arguments
/// * `metrics` - Metrics collection to update
/// * `reason` - Failure reason
pub fn record_reward_failure(
    metrics: &ReputationMetrics,
    reason: &str,
) {
    metrics.rewards_failed_total
        .with_label_values(&[reason])
        .inc();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register_metrics() {
        let result = register_metrics();
        assert!(result.is_ok());

        let metrics = result.unwrap();

        // Test that metrics are initialized
        metrics.reputation_mean.set(0.75);
        assert_eq!(metrics.reputation_mean.get(), 0.75);
    }

    #[test]
    fn test_reputation_metrics_update() {
        let registry = Registry::new();
        let metrics = ReputationMetrics::new(&registry).unwrap();

        update_reputation_metrics(&metrics, 10, 8, 2, 0.75, 0.95, 0.25);

        assert_eq!(metrics.reputation_total_nodes.get(), 10);
        assert_eq!(metrics.reputation_nodes_above_threshold.get(), 8);
        assert_eq!(metrics.reputation_nodes_below_threshold.get(), 2);
        assert_eq!(metrics.reputation_mean.get(), 0.75);
    }

    #[test]
    fn test_node_reputation_score() {
        let registry = Registry::new();
        let metrics = ReputationMetrics::new(&registry).unwrap();

        update_node_reputation_score(&metrics, "node_123", 0.85);

        let value = metrics.reputation_score
            .with_label_values(&["node_123"])
            .get();
        assert_eq!(value, 0.85);
    }

    #[test]
    fn test_violation_recording() {
        let registry = Registry::new();
        let metrics = ReputationMetrics::new(&registry).unwrap();

        record_reputation_violation(&metrics, "node_123", "Equivocation");
        record_reputation_violation(&metrics, "node_123", "Equivocation");

        // Counter should increment
        let value = metrics.reputation_violations_total
            .with_label_values(&["node_123", "Equivocation"])
            .get();
        assert_eq!(value, 2);
    }

    #[test]
    fn test_stake_metrics_update() {
        let registry = Registry::new();
        let metrics = ReputationMetrics::new(&registry).unwrap();

        update_stake_metrics(&metrics, 100000, 10000, 5, 20000);

        assert_eq!(metrics.stake_total.get(), 100000);
        assert_eq!(metrics.stake_average.get(), 10000);
        assert_eq!(metrics.stake_pending_withdrawals.get(), 5);
    }

    #[test]
    fn test_stake_deposit_recording() {
        let registry = Registry::new();
        let metrics = ReputationMetrics::new(&registry).unwrap();

        record_stake_deposit(&metrics, 5000);
        record_stake_deposit(&metrics, 10000);

        assert_eq!(metrics.stake_deposits_total.get(), 2);
    }

    #[test]
    fn test_slashing_recording() {
        let registry = Registry::new();
        let metrics = ReputationMetrics::new(&registry).unwrap();

        record_stake_slashing(&metrics, "Equivocation", 3000);
        record_stake_slashing(&metrics, "Equivocation", 2000);

        let total = metrics.stake_slashed_total
            .with_label_values(&["Equivocation"])
            .get();
        assert_eq!(total, 5000);
    }

    #[test]
    fn test_reward_distribution_recording() {
        let registry = Registry::new();
        let metrics = ReputationMetrics::new(&registry).unwrap();

        record_reward_distribution(&metrics, "BlockProduction", 1000);
        record_reward_distribution(&metrics, "BlockProduction", 1000);

        let count = metrics.rewards_distributed_count
            .with_label_values(&["BlockProduction"])
            .get();
        assert_eq!(count, 2);

        assert_eq!(metrics.rewards_distributed_total_value.get(), 2000);
    }

    #[test]
    fn test_uptime_bonus_recording() {
        let registry = Registry::new();
        let metrics = ReputationMetrics::new(&registry).unwrap();

        record_uptime_bonus(&metrics);
        record_uptime_bonus(&metrics);
        record_uptime_bonus(&metrics);

        assert_eq!(metrics.rewards_uptime_bonuses_total.get(), 3);
    }
}
