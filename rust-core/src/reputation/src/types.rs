//! Common types for reputation and stake management

use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime};
use uuid::Uuid;

/// Node identifier (matches consensus NodeId)
pub type NodeId = Uuid;

/// Stake amount in smallest unit (e.g., satoshis, wei)
pub type Amount = u64;

/// Reputation score (0.0 - 1.0, where 1.0 is perfect reputation)
pub type ReputationScore = f64;

/// Node behavior violation types for slashing
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum ViolationType {
    /// Node signed conflicting vertices (double-voting)
    Equivocation,

    /// Node produced invalid signature
    InvalidSignature,

    /// Node failed to respond within timeout
    TimeoutViolation,

    /// Node sent malformed messages
    ProtocolViolation,

    /// Node exhibited Byzantine behavior
    ByzantineBehavior,
}

impl ViolationType {
    /// Get the slashing percentage for this violation type
    pub fn slash_percentage(&self) -> f64 {
        match self {
            ViolationType::Equivocation => 0.30,        // 30% slash (severe)
            ViolationType::ByzantineBehavior => 0.25,   // 25% slash (severe)
            ViolationType::InvalidSignature => 0.15,    // 15% slash (moderate)
            ViolationType::ProtocolViolation => 0.10,   // 10% slash (moderate)
            ViolationType::TimeoutViolation => 0.05,    // 5% slash (minor)
        }
    }

    /// Get human-readable description
    pub fn description(&self) -> &'static str {
        match self {
            ViolationType::Equivocation => "Node signed conflicting vertices (double-voting)",
            ViolationType::ByzantineBehavior => "Node exhibited Byzantine behavior",
            ViolationType::InvalidSignature => "Node produced invalid cryptographic signature",
            ViolationType::ProtocolViolation => "Node sent malformed protocol messages",
            ViolationType::TimeoutViolation => "Node failed to respond within consensus timeout",
        }
    }
}

/// Node activity event for reputation tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityEvent {
    /// Node that performed the activity
    pub node_id: NodeId,

    /// Timestamp of the event
    pub timestamp: SystemTime,

    /// Event type
    pub event_type: ActivityType,

    /// Optional additional context
    pub metadata: Option<serde_json::Value>,
}

/// Types of node activities tracked for reputation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ActivityType {
    /// Node successfully finalized a vertex
    VertexFinalized,

    /// Node participated in consensus round
    ConsensusParticipation,

    /// Node helped propagate a vertex
    VertexPropagation,

    /// Node detected Byzantine behavior in another node
    ByzantineDetection,

    /// Node violated protocol (negative reputation impact)
    ViolationDetected(ViolationType),
}

/// Stake deposit record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StakeDeposit {
    /// Unique deposit ID
    pub id: Uuid,

    /// Node that made the deposit
    pub node_id: NodeId,

    /// Amount deposited
    pub amount: Amount,

    /// When deposit was made
    pub deposited_at: SystemTime,

    /// Minimum lock period (can't withdraw before this)
    pub lock_until: SystemTime,

    /// Current status
    pub status: DepositStatus,
}

/// Status of a stake deposit
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum DepositStatus {
    /// Active and earning rewards
    Active,

    /// Withdrawal requested, pending unbonding
    Unbonding { available_at: SystemTime },

    /// Fully withdrawn
    Withdrawn,

    /// Slashed due to violation
    Slashed { amount: Amount, reason: ViolationType },
}

/// Reward record for distribution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reward {
    /// Unique reward ID
    pub id: Uuid,

    /// Node receiving the reward
    pub node_id: NodeId,

    /// Amount of reward
    pub amount: Amount,

    /// Reward type/reason
    pub reward_type: RewardType,

    /// When reward was earned
    pub earned_at: SystemTime,

    /// Distribution status
    pub status: RewardStatus,
}

/// Types of rewards
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RewardType {
    /// Block production reward
    BlockProduction { vertex_id: Uuid },

    /// Finality contribution
    FinalityContribution { round: u64 },

    /// Transaction fee share
    TransactionFees { num_transactions: u64 },

    /// Uptime bonus
    UptimeBonus { uptime_percentage: f64 },
}

/// Reward distribution status
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum RewardStatus {
    /// Pending distribution
    Pending,

    /// Successfully distributed
    Distributed,

    /// Failed to distribute (will retry)
    Failed,
}

/// Slashing event record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlashingEvent {
    /// Unique slashing ID
    pub id: Uuid,

    /// Node that was slashed
    pub node_id: NodeId,

    /// Amount slashed
    pub amount: Amount,

    /// Violation that triggered slashing
    pub violation: ViolationType,

    /// When slashing occurred
    pub slashed_at: SystemTime,

    /// Evidence or proof of violation
    pub evidence: serde_json::Value,
}

/// Withdrawal request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WithdrawalRequest {
    /// Unique withdrawal ID
    pub id: Uuid,

    /// Node requesting withdrawal
    pub node_id: NodeId,

    /// Amount to withdraw
    pub amount: Amount,

    /// When request was made
    pub requested_at: SystemTime,

    /// When withdrawal will be available (after unbonding period)
    pub available_at: SystemTime,

    /// Current status
    pub status: WithdrawalStatus,
}

/// Withdrawal request status
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum WithdrawalStatus {
    /// Pending unbonding
    Pending,

    /// Ready to be processed
    Ready,

    /// Successfully processed
    Completed,

    /// Cancelled by user
    Cancelled,
}

/// Configuration for reputation decay
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReputationConfig {
    /// Base reputation score for new nodes (default: 0.5)
    pub initial_reputation: f64,

    /// Maximum reputation score (default: 1.0)
    pub max_reputation: f64,

    /// Minimum reputation before node is considered unreliable (default: 0.2)
    pub min_threshold: f64,

    /// Decay rate per day of inactivity (default: 0.05 = 5% per day)
    pub decay_rate: f64,

    /// Half-life for exponential decay (default: 30 days)
    pub decay_half_life: Duration,
}

impl Default for ReputationConfig {
    fn default() -> Self {
        Self {
            initial_reputation: 0.5,
            max_reputation: 1.0,
            min_threshold: 0.2,
            decay_rate: 0.05,
            decay_half_life: Duration::from_secs(30 * 24 * 3600), // 30 days
        }
    }
}

/// Configuration for stake management
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StakeConfig {
    /// Minimum stake required to participate (default: 1000)
    pub min_stake: Amount,

    /// Maximum stake per node (default: 1_000_000)
    pub max_stake: Amount,

    /// Unbonding period before withdrawal (default: 7 days)
    pub unbonding_period: Duration,

    /// Minimum lock period for deposits (default: 24 hours)
    pub min_lock_period: Duration,
}

impl Default for StakeConfig {
    fn default() -> Self {
        Self {
            min_stake: 1000,
            max_stake: 1_000_000,
            unbonding_period: Duration::from_secs(7 * 24 * 3600), // 7 days
            min_lock_period: Duration::from_secs(24 * 3600),       // 24 hours
        }
    }
}
