//! Reputation System for CretoAI
//!
//! Tracks node behavior and calculates reputation scores (0-1) based on:
//! - **Uptime**: Node availability and reliability
//! - **Correctness**: Agreement with consensus results
//! - **Response Time**: Speed of message responses
//! - **Byzantine Behavior**: Penalties for detected violations
//!
//! ## Reputation Decay
//!
//! Scores decay over time to ensure recent behavior is weighted more heavily.
//! Decay rate: 1% per day for inactive nodes.

pub mod reputation_tracker;
pub mod stake_manager;
pub mod reward_distributor;
pub mod error;
pub mod types;
pub mod metrics;

pub use reputation_tracker::{ReputationTracker, ReputationStatistics};
pub use stake_manager::{StakeManager, StakeError};
pub use reward_distributor::{RewardDistributor, RewardConfig, RewardStatistics};
pub use error::{ReputationError, Result};
pub use types::{
    ActivityEvent, ActivityType, NodeId, ReputationConfig, ReputationScore,
    ViolationType, Amount, StakeConfig, StakeDeposit, DepositStatus,
    Reward, RewardType, RewardStatus, SlashingEvent, WithdrawalRequest,
    WithdrawalStatus,
};
pub use metrics::{
    ReputationMetrics, register_metrics, get_registry,
    update_reputation_metrics, update_node_reputation_score,
    record_reputation_violation, record_reputation_event, record_reputation_decay,
    update_stake_metrics, update_node_stake, record_stake_deposit,
    record_stake_slashing, record_stake_withdrawal, update_active_deposits,
    update_reward_metrics, record_reward_distribution, record_uptime_bonus,
    update_pending_rewards, record_node_total_rewards, record_reward_failure,
};
