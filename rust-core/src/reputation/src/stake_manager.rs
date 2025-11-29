//! Stake Management System (Phase 7)
//!
//! Production-ready stake management for the CretoAI consensus system.
//!
//! Features:
//! - Stake deposits with configurable lock periods
//! - Withdrawal queue with 7-day unbonding period
//! - Slashing based on violation type (5%-30%)
//! - Minimum/maximum stake validation
//! - Comprehensive statistics and history tracking

use std::collections::{HashMap, VecDeque};
use std::time::{Duration, SystemTime};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::types::{
    Amount, NodeId, ViolationType, StakeDeposit, SlashingEvent,
    WithdrawalRequest, WithdrawalStatus, DepositStatus, StakeConfig
};

/// Minimum stake required for validator participation
pub const MIN_STAKE: Amount = 1000;

/// Maximum stake per node
pub const MAX_STAKE: Amount = 1_000_000;

/// Default unbonding period (7 days)
pub const DEFAULT_UNBONDING_PERIOD: Duration = Duration::from_secs(7 * 24 * 3600);

/// Default minimum lock period (24 hours)
pub const DEFAULT_MIN_LOCK_PERIOD: Duration = Duration::from_secs(24 * 3600);

/// Production stake manager for tracking validator stakes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StakeManager {
    /// Configuration parameters
    config: StakeConfig,

    /// All stake deposits by node
    deposits: HashMap<NodeId, Vec<StakeDeposit>>,

    /// Active stake amount per node (sum of Active deposits)
    active_stakes: HashMap<NodeId, Amount>,

    /// Withdrawal queue (sorted by available_at)
    withdrawal_queue: VecDeque<WithdrawalRequest>,

    /// Slashing event history
    slashing_history: Vec<SlashingEvent>,

    /// Total stake across all nodes
    total_staked: Amount,

    /// Total amount slashed (for statistics)
    total_slashed: Amount,

    /// Total amount withdrawn (for statistics)
    total_withdrawn: Amount,
}

impl StakeManager {
    /// Create a new stake manager with default configuration
    pub fn new() -> Self {
        Self::with_config(StakeConfig::default())
    }

    /// Create a new stake manager with custom configuration
    pub fn with_config(config: StakeConfig) -> Self {
        Self {
            config,
            deposits: HashMap::new(),
            active_stakes: HashMap::new(),
            withdrawal_queue: VecDeque::new(),
            slashing_history: Vec::new(),
            total_staked: 0,
            total_slashed: 0,
            total_withdrawn: 0,
        }
    }

    /// Deposit stake for a node with a lock period
    ///
    /// # Arguments
    /// * `node_id` - The node making the deposit
    /// * `amount` - Amount to deposit
    /// * `lock_until` - Minimum time before withdrawal is allowed
    ///
    /// # Returns
    /// The unique deposit ID on success
    ///
    /// # Errors
    /// Returns error if:
    /// - Amount is below minimum stake
    /// - Amount would exceed maximum stake for this node
    /// - Lock period is less than minimum required
    pub fn deposit_stake(
        &mut self,
        node_id: NodeId,
        amount: Amount,
        lock_until: SystemTime,
    ) -> Result<Uuid, StakeError> {
        // Validate amount
        if amount < self.config.min_stake {
            return Err(StakeError::BelowMinimumStake {
                required: self.config.min_stake,
                provided: amount,
            });
        }

        // Check if deposit would exceed maximum stake
        let current_stake = self.get_stake(&node_id);
        if current_stake + amount > self.config.max_stake {
            return Err(StakeError::ExceedsMaximumStake {
                max: self.config.max_stake,
                current: current_stake,
                additional: amount,
            });
        }

        // Validate lock period
        let now = SystemTime::now();
        let lock_duration = lock_until.duration_since(now)
            .map_err(|_| StakeError::InvalidLockPeriod {
                reason: "Lock time is in the past".to_string(),
            })?;

        if lock_duration < self.config.min_lock_period {
            return Err(StakeError::InvalidLockPeriod {
                reason: format!(
                    "Lock period must be at least {} hours",
                    self.config.min_lock_period.as_secs() / 3600
                ),
            });
        }

        // Create deposit
        let deposit = StakeDeposit {
            id: Uuid::new_v4(),
            node_id,
            amount,
            deposited_at: now,
            lock_until,
            status: DepositStatus::Active,
        };

        let deposit_id = deposit.id;

        // Update state
        self.deposits.entry(node_id).or_insert_with(Vec::new).push(deposit);
        *self.active_stakes.entry(node_id).or_insert(0) += amount;
        self.total_staked += amount;

        Ok(deposit_id)
    }

    /// Get the total active stake for a node
    pub fn get_stake(&self, node_id: &NodeId) -> Amount {
        self.active_stakes.get(node_id).copied().unwrap_or(0)
    }

    /// Get the total stake across all nodes
    pub fn get_total_stake(&self) -> Amount {
        self.total_staked
    }

    /// Slash stake for a node based on violation type
    ///
    /// Slashes a percentage of the node's active stake based on violation severity:
    /// - Equivocation: 30%
    /// - Byzantine behavior: 25%
    /// - Invalid signature: 15%
    /// - Protocol violation: 10%
    /// - Timeout violation: 5%
    ///
    /// # Returns
    /// The amount slashed on success
    pub fn slash_stake(
        &mut self,
        node_id: &NodeId,
        violation: ViolationType,
    ) -> Result<Amount, StakeError> {
        let current_stake = self.get_stake(node_id);
        if current_stake == 0 {
            return Err(StakeError::NoActiveStake);
        }

        // Calculate slash amount based on violation type
        let slash_percentage = violation.slash_percentage();
        let slash_amount = (current_stake as f64 * slash_percentage) as Amount;

        if slash_amount == 0 {
            return Err(StakeError::SlashAmountTooSmall);
        }

        // Apply slashing to active deposits (FIFO)
        let mut remaining_to_slash = slash_amount;
        let deposits = self.deposits.get_mut(node_id)
            .ok_or(StakeError::NodeNotFound)?;

        for deposit in deposits.iter_mut() {
            if remaining_to_slash == 0 {
                break;
            }

            if let DepositStatus::Active = deposit.status {
                let slash_from_deposit = remaining_to_slash.min(deposit.amount);
                deposit.amount -= slash_from_deposit;
                remaining_to_slash -= slash_from_deposit;

                if deposit.amount == 0 {
                    deposit.status = DepositStatus::Slashed {
                        amount: slash_from_deposit,
                        reason: violation,
                    };
                }
            }
        }

        // Update state
        *self.active_stakes.get_mut(node_id).unwrap() -= slash_amount;
        self.total_staked -= slash_amount;
        self.total_slashed += slash_amount;

        // Record slashing event
        let event = SlashingEvent {
            id: Uuid::new_v4(),
            node_id: *node_id,
            amount: slash_amount,
            violation,
            slashed_at: SystemTime::now(),
            evidence: serde_json::json!({
                "violation_type": format!("{:?}", violation),
                "percentage": slash_percentage * 100.0,
            }),
        };
        self.slashing_history.push(event);

        Ok(slash_amount)
    }

    /// Request withdrawal of stake
    ///
    /// Initiates the unbonding period. The stake will be available for
    /// withdrawal after the configured unbonding period (default: 7 days).
    ///
    /// # Returns
    /// The unique withdrawal request ID
    pub fn request_withdrawal(
        &mut self,
        node_id: &NodeId,
        amount: Amount,
    ) -> Result<Uuid, StakeError> {
        let current_stake = self.get_stake(node_id);
        if amount > current_stake {
            return Err(StakeError::InsufficientStake {
                available: current_stake,
                requested: amount,
            });
        }

        let now = SystemTime::now();

        // Check lock periods
        let deposits = self.deposits.get(node_id)
            .ok_or(StakeError::NodeNotFound)?;

        let mut unlocked_amount = 0;
        for deposit in deposits.iter() {
            if let DepositStatus::Active = deposit.status {
                if deposit.lock_until <= now {
                    unlocked_amount += deposit.amount;
                }
            }
        }

        if amount > unlocked_amount {
            return Err(StakeError::StakeStillLocked {
                requested: amount,
                unlocked: unlocked_amount,
            });
        }

        // Create withdrawal request
        let available_at = now + self.config.unbonding_period;
        let withdrawal = WithdrawalRequest {
            id: Uuid::new_v4(),
            node_id: *node_id,
            amount,
            requested_at: now,
            available_at,
            status: WithdrawalStatus::Pending,
        };

        let withdrawal_id = withdrawal.id;

        // Update deposit statuses to Unbonding
        self.mark_deposits_unbonding(node_id, amount, available_at)?;

        // Add to queue (maintain sorted order by available_at)
        let insert_pos = self.withdrawal_queue
            .iter()
            .position(|w| w.available_at > available_at)
            .unwrap_or(self.withdrawal_queue.len());
        self.withdrawal_queue.insert(insert_pos, withdrawal);

        // Update active stake
        *self.active_stakes.get_mut(node_id).unwrap() -= amount;

        Ok(withdrawal_id)
    }

    /// Process all withdrawals that have completed unbonding
    ///
    /// Returns a list of completed withdrawals that should be processed
    /// by the payment system.
    pub fn process_withdrawals(&mut self) -> Vec<WithdrawalRequest> {
        let now = SystemTime::now();
        let mut completed = Vec::new();

        while let Some(withdrawal) = self.withdrawal_queue.front() {
            if withdrawal.available_at > now {
                break; // Queue is sorted, so we can stop
            }

            let mut withdrawal = self.withdrawal_queue.pop_front().unwrap();

            if withdrawal.status == WithdrawalStatus::Pending {
                withdrawal.status = WithdrawalStatus::Ready;

                // Mark deposits as withdrawn
                if let Some(deposits) = self.deposits.get_mut(&withdrawal.node_id) {
                    let mut remaining = withdrawal.amount;
                    for deposit in deposits.iter_mut() {
                        if remaining == 0 {
                            break;
                        }

                        if matches!(deposit.status, DepositStatus::Unbonding { .. }) {
                            let withdraw_from_deposit = remaining.min(deposit.amount);
                            deposit.amount -= withdraw_from_deposit;
                            remaining -= withdraw_from_deposit;

                            if deposit.amount == 0 {
                                deposit.status = DepositStatus::Withdrawn;
                            }
                        }
                    }
                }

                // Update statistics
                self.total_staked -= withdrawal.amount;
                self.total_withdrawn += withdrawal.amount;

                withdrawal.status = WithdrawalStatus::Completed;
                completed.push(withdrawal);
            }
        }

        completed
    }

    /// Get deposit history for a node
    pub fn get_deposit_history(&self, node_id: &NodeId) -> Vec<StakeDeposit> {
        self.deposits.get(node_id).cloned().unwrap_or_default()
    }

    /// Get slashing history for a node
    pub fn get_slashing_history(&self, node_id: &NodeId) -> Vec<SlashingEvent> {
        self.slashing_history
            .iter()
            .filter(|e| &e.node_id == node_id)
            .cloned()
            .collect()
    }

    /// Get pending withdrawals for a node
    pub fn get_pending_withdrawals(&self, node_id: &NodeId) -> Vec<WithdrawalRequest> {
        self.withdrawal_queue
            .iter()
            .filter(|w| &w.node_id == node_id)
            .cloned()
            .collect()
    }

    /// Cancel a pending withdrawal request
    ///
    /// Can only cancel withdrawals that are still in Pending status.
    /// Once a withdrawal is Ready or Completed, it cannot be cancelled.
    pub fn cancel_withdrawal(&mut self, withdrawal_id: &Uuid) -> Result<(), StakeError> {
        let position = self.withdrawal_queue
            .iter()
            .position(|w| &w.id == withdrawal_id)
            .ok_or(StakeError::WithdrawalNotFound)?;

        let withdrawal = &self.withdrawal_queue[position];

        if withdrawal.status != WithdrawalStatus::Pending {
            return Err(StakeError::CannotCancelWithdrawal {
                status: withdrawal.status,
            });
        }

        let withdrawal = self.withdrawal_queue.remove(position).unwrap();

        // Revert deposit statuses back to Active
        if let Some(deposits) = self.deposits.get_mut(&withdrawal.node_id) {
            let mut remaining = withdrawal.amount;
            for deposit in deposits.iter_mut() {
                if remaining == 0 {
                    break;
                }

                if matches!(deposit.status, DepositStatus::Unbonding { .. }) {
                    let amount_to_reactivate = remaining.min(deposit.amount);
                    deposit.status = DepositStatus::Active;
                    remaining -= amount_to_reactivate;
                }
            }
        }

        // Restore active stake
        *self.active_stakes.entry(withdrawal.node_id).or_insert(0) += withdrawal.amount;

        Ok(())
    }

    /// Get comprehensive statistics about the stake manager
    pub fn get_statistics(&self) -> StakeStatistics {
        let total_nodes = self.active_stakes.len();
        let total_deposits = self.deposits.values().map(|v| v.len()).sum();
        let total_withdrawals = self.withdrawal_queue.len();
        let total_slashing_events = self.slashing_history.len();

        let average_stake = if total_nodes > 0 {
            self.total_staked / total_nodes as Amount
        } else {
            0
        };

        StakeStatistics {
            total_staked: self.total_staked,
            total_slashed: self.total_slashed,
            total_withdrawn: self.total_withdrawn,
            total_nodes,
            total_deposits,
            total_withdrawals,
            total_slashing_events,
            average_stake,
        }
    }

    /// Helper: Mark deposits as unbonding for withdrawal
    fn mark_deposits_unbonding(
        &mut self,
        node_id: &NodeId,
        amount: Amount,
        available_at: SystemTime,
    ) -> Result<(), StakeError> {
        let deposits = self.deposits.get_mut(node_id)
            .ok_or(StakeError::NodeNotFound)?;

        let mut remaining = amount;
        let now = SystemTime::now();

        for deposit in deposits.iter_mut() {
            if remaining == 0 {
                break;
            }

            if let DepositStatus::Active = deposit.status {
                if deposit.lock_until <= now {
                    let unbond_amount = remaining.min(deposit.amount);
                    deposit.status = DepositStatus::Unbonding { available_at };
                    remaining -= unbond_amount;
                }
            }
        }

        Ok(())
    }
}

impl Default for StakeManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Statistics about stake management
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StakeStatistics {
    /// Total amount currently staked
    pub total_staked: Amount,

    /// Total amount slashed historically
    pub total_slashed: Amount,

    /// Total amount withdrawn historically
    pub total_withdrawn: Amount,

    /// Number of nodes with active stakes
    pub total_nodes: usize,

    /// Total number of deposits
    pub total_deposits: usize,

    /// Number of pending withdrawals
    pub total_withdrawals: usize,

    /// Number of slashing events
    pub total_slashing_events: usize,

    /// Average stake per node
    pub average_stake: Amount,
}

/// Stake management errors
#[derive(Debug, thiserror::Error)]
pub enum StakeError {
    #[error("Amount {provided} is below minimum stake of {required}")]
    BelowMinimumStake { required: Amount, provided: Amount },

    #[error("Amount would exceed maximum stake of {max} (current: {current}, additional: {additional})")]
    ExceedsMaximumStake { max: Amount, current: Amount, additional: Amount },

    #[error("Invalid lock period: {reason}")]
    InvalidLockPeriod { reason: String },

    #[error("Node not found")]
    NodeNotFound,

    #[error("No active stake to slash")]
    NoActiveStake,

    #[error("Slash amount too small")]
    SlashAmountTooSmall,

    #[error("Insufficient stake: available {available}, requested {requested}")]
    InsufficientStake { available: Amount, requested: Amount },

    #[error("Stake still locked: requested {requested}, unlocked {unlocked}")]
    StakeStillLocked { requested: Amount, unlocked: Amount },

    #[error("Withdrawal not found")]
    WithdrawalNotFound,

    #[error("Cannot cancel withdrawal with status: {status:?}")]
    CannotCancelWithdrawal { status: WithdrawalStatus },
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn create_test_node() -> NodeId {
        Uuid::new_v4()
    }

    fn create_lock_time(hours: u64) -> SystemTime {
        SystemTime::now() + Duration::from_secs(hours * 3600)
    }

    #[test]
    fn test_deposit_validation_min_stake() {
        let mut manager = StakeManager::new();
        let node_id = create_test_node();

        // Below minimum
        let result = manager.deposit_stake(node_id, 500, create_lock_time(24));
        assert!(matches!(result, Err(StakeError::BelowMinimumStake { .. })));

        // At minimum
        let result = manager.deposit_stake(node_id, 1000, create_lock_time(24));
        assert!(result.is_ok());

        assert_eq!(manager.get_stake(&node_id), 1000);
    }

    #[test]
    fn test_deposit_validation_max_stake() {
        let mut manager = StakeManager::new();
        let node_id = create_test_node();

        // First deposit at max
        let result = manager.deposit_stake(node_id, 1_000_000, create_lock_time(24));
        assert!(result.is_ok());

        // Second deposit would exceed max
        let result = manager.deposit_stake(node_id, 1000, create_lock_time(24));
        assert!(matches!(result, Err(StakeError::ExceedsMaximumStake { .. })));

        assert_eq!(manager.get_stake(&node_id), 1_000_000);
    }

    #[test]
    fn test_deposit_lock_period_enforcement() {
        let mut manager = StakeManager::new();
        let node_id = create_test_node();

        // Lock period too short
        let result = manager.deposit_stake(node_id, 1000, create_lock_time(1));
        assert!(matches!(result, Err(StakeError::InvalidLockPeriod { .. })));

        // Lock period in the past
        let past = SystemTime::now() - Duration::from_secs(3600);
        let result = manager.deposit_stake(node_id, 1000, past);
        assert!(matches!(result, Err(StakeError::InvalidLockPeriod { .. })));

        // Valid lock period
        let result = manager.deposit_stake(node_id, 1000, create_lock_time(24));
        assert!(result.is_ok());
    }

    #[test]
    fn test_slashing_by_violation_type() {
        let mut manager = StakeManager::new();
        let node_id = create_test_node();

        manager.deposit_stake(node_id, 10_000, create_lock_time(24)).unwrap();

        // Test equivocation (30% slash)
        let slashed = manager.slash_stake(&node_id, ViolationType::Equivocation).unwrap();
        assert_eq!(slashed, 3000);
        assert_eq!(manager.get_stake(&node_id), 7000);

        // Test Byzantine behavior (25% of remaining)
        let slashed = manager.slash_stake(&node_id, ViolationType::ByzantineBehavior).unwrap();
        assert_eq!(slashed, 1750);
        assert_eq!(manager.get_stake(&node_id), 5250);

        // Test invalid signature (15% of remaining)
        let slashed = manager.slash_stake(&node_id, ViolationType::InvalidSignature).unwrap();
        assert_eq!(slashed, 787);
        assert_eq!(manager.get_stake(&node_id), 4463);

        // Test protocol violation (10% of remaining)
        let slashed = manager.slash_stake(&node_id, ViolationType::ProtocolViolation).unwrap();
        assert_eq!(slashed, 446);
        assert_eq!(manager.get_stake(&node_id), 4017);

        // Test timeout violation (5% of remaining)
        let slashed = manager.slash_stake(&node_id, ViolationType::TimeoutViolation).unwrap();
        assert_eq!(slashed, 200);
        assert_eq!(manager.get_stake(&node_id), 3817);
    }

    #[test]
    fn test_slashing_history() {
        let mut manager = StakeManager::new();
        let node_id = create_test_node();

        manager.deposit_stake(node_id, 10_000, create_lock_time(24)).unwrap();
        manager.slash_stake(&node_id, ViolationType::Equivocation).unwrap();
        manager.slash_stake(&node_id, ViolationType::TimeoutViolation).unwrap();

        let history = manager.get_slashing_history(&node_id);
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].violation, ViolationType::Equivocation);
        assert_eq!(history[0].amount, 3000);
        assert_eq!(history[1].violation, ViolationType::TimeoutViolation);
    }

    #[test]
    fn test_withdrawal_lifecycle() {
        let mut manager = StakeManager::with_config(StakeConfig {
            min_stake: 1000,
            max_stake: 1_000_000,
            unbonding_period: Duration::from_secs(1), // 1 second for testing
            min_lock_period: Duration::from_secs(1),
        });
        let node_id = create_test_node();

        // Deposit stake
        let lock_time = SystemTime::now() + Duration::from_secs(2);
        manager.deposit_stake(node_id, 5000, lock_time).unwrap();
        assert_eq!(manager.get_stake(&node_id), 5000);

        // Wait for lock period
        std::thread::sleep(Duration::from_secs(3));

        // Request withdrawal
        let withdrawal_id = manager.request_withdrawal(&node_id, 3000).unwrap();
        assert_eq!(manager.get_stake(&node_id), 2000); // Active stake reduced

        // Check pending withdrawals
        let pending = manager.get_pending_withdrawals(&node_id);
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].amount, 3000);
        assert_eq!(pending[0].status, WithdrawalStatus::Pending);

        // Process before unbonding completes (should not process)
        let completed = manager.process_withdrawals();
        assert_eq!(completed.len(), 0);

        // Wait for unbonding period
        std::thread::sleep(Duration::from_secs(2));

        // Process withdrawals
        let completed = manager.process_withdrawals();
        assert_eq!(completed.len(), 1);
        assert_eq!(completed[0].amount, 3000);
        assert_eq!(completed[0].status, WithdrawalStatus::Completed);

        // Check statistics
        let stats = manager.get_statistics();
        assert_eq!(stats.total_withdrawn, 3000);
    }

    #[test]
    fn test_withdrawal_validation() {
        let mut manager = StakeManager::new();
        let node_id = create_test_node();

        manager.deposit_stake(node_id, 5000, create_lock_time(24)).unwrap();

        // Try to withdraw more than available
        let result = manager.request_withdrawal(&node_id, 6000);
        assert!(matches!(result, Err(StakeError::InsufficientStake { .. })));

        // Try to withdraw locked stake
        let result = manager.request_withdrawal(&node_id, 1000);
        assert!(matches!(result, Err(StakeError::StakeStillLocked { .. })));
    }

    #[test]
    fn test_withdrawal_cancellation() {
        let mut manager = StakeManager::with_config(StakeConfig {
            min_stake: 1000,
            max_stake: 1_000_000,
            unbonding_period: Duration::from_secs(10), // 10 seconds
            min_lock_period: Duration::from_secs(1),
        });
        let node_id = create_test_node();

        let lock_time = SystemTime::now() + Duration::from_secs(2);
        manager.deposit_stake(node_id, 5000, lock_time).unwrap();

        std::thread::sleep(Duration::from_secs(3));

        let withdrawal_id = manager.request_withdrawal(&node_id, 3000).unwrap();
        assert_eq!(manager.get_stake(&node_id), 2000);

        // Cancel withdrawal
        manager.cancel_withdrawal(&withdrawal_id).unwrap();
        assert_eq!(manager.get_stake(&node_id), 5000); // Stake restored

        // Verify no pending withdrawals
        let pending = manager.get_pending_withdrawals(&node_id);
        assert_eq!(pending.len(), 0);
    }

    #[test]
    fn test_cannot_cancel_completed_withdrawal() {
        let mut manager = StakeManager::with_config(StakeConfig {
            min_stake: 1000,
            max_stake: 1_000_000,
            unbonding_period: Duration::from_secs(1),
            min_lock_period: Duration::from_secs(1),
        });
        let node_id = create_test_node();

        let lock_time = SystemTime::now() + Duration::from_secs(2);
        manager.deposit_stake(node_id, 5000, lock_time).unwrap();

        std::thread::sleep(Duration::from_secs(3));

        let withdrawal_id = manager.request_withdrawal(&node_id, 3000).unwrap();

        // Wait and process
        std::thread::sleep(Duration::from_secs(2));
        let processed = manager.process_withdrawals();
        assert_eq!(processed.len(), 1); // Should have processed the withdrawal

        // Try to cancel completed withdrawal (should succeed since withdrawal was processed)
        let result = manager.cancel_withdrawal(&withdrawal_id);
        assert!(result.is_err()); // Should error - withdrawal already completed
    }

    #[test]
    fn test_deposit_history() {
        let mut manager = StakeManager::new();
        let node_id = create_test_node();

        manager.deposit_stake(node_id, 1000, create_lock_time(24)).unwrap();
        manager.deposit_stake(node_id, 2000, create_lock_time(48)).unwrap();
        manager.deposit_stake(node_id, 3000, create_lock_time(72)).unwrap();

        let history = manager.get_deposit_history(&node_id);
        assert_eq!(history.len(), 3);
        assert_eq!(history[0].amount, 1000);
        assert_eq!(history[1].amount, 2000);
        assert_eq!(history[2].amount, 3000);
        assert!(matches!(history[0].status, DepositStatus::Active));
    }

    #[test]
    fn test_statistics_calculation() {
        let mut manager = StakeManager::new();
        let node1 = create_test_node();
        let node2 = create_test_node();
        let node3 = create_test_node();

        // Deposits
        manager.deposit_stake(node1, 10_000, create_lock_time(24)).unwrap();
        manager.deposit_stake(node2, 20_000, create_lock_time(24)).unwrap();
        manager.deposit_stake(node3, 30_000, create_lock_time(24)).unwrap();

        // Slashing
        manager.slash_stake(&node1, ViolationType::Equivocation).unwrap();

        let stats = manager.get_statistics();
        assert_eq!(stats.total_nodes, 3);
        assert_eq!(stats.total_deposits, 3);
        assert_eq!(stats.total_staked, 57_000); // 60_000 - 3000 slashed
        assert_eq!(stats.total_slashed, 3000);
        assert_eq!(stats.average_stake, 19_000);
    }

    #[test]
    fn test_multiple_deposits_same_node() {
        let mut manager = StakeManager::new();
        let node_id = create_test_node();

        manager.deposit_stake(node_id, 1000, create_lock_time(24)).unwrap();
        manager.deposit_stake(node_id, 2000, create_lock_time(48)).unwrap();
        manager.deposit_stake(node_id, 3000, create_lock_time(72)).unwrap();

        assert_eq!(manager.get_stake(&node_id), 6000);
        assert_eq!(manager.get_total_stake(), 6000);

        let history = manager.get_deposit_history(&node_id);
        assert_eq!(history.len(), 3);
    }

    #[test]
    fn test_total_stake_tracking() {
        let mut manager = StakeManager::new();
        let node1 = create_test_node();
        let node2 = create_test_node();

        assert_eq!(manager.get_total_stake(), 0);

        manager.deposit_stake(node1, 5000, create_lock_time(24)).unwrap();
        assert_eq!(manager.get_total_stake(), 5000);

        manager.deposit_stake(node2, 3000, create_lock_time(24)).unwrap();
        assert_eq!(manager.get_total_stake(), 8000);

        manager.slash_stake(&node1, ViolationType::TimeoutViolation).unwrap();
        assert_eq!(manager.get_total_stake(), 7750); // 8000 - 250 (5% of 5000)
    }

    #[test]
    fn test_slashing_multiple_deposits() {
        let mut manager = StakeManager::new();
        let node_id = create_test_node();

        // Create multiple deposits
        manager.deposit_stake(node_id, 1000, create_lock_time(24)).unwrap();
        manager.deposit_stake(node_id, 2000, create_lock_time(48)).unwrap();
        manager.deposit_stake(node_id, 3000, create_lock_time(72)).unwrap();

        // Slash 30% of total (1800)
        let slashed = manager.slash_stake(&node_id, ViolationType::Equivocation).unwrap();
        assert_eq!(slashed, 1800);
        assert_eq!(manager.get_stake(&node_id), 4200);

        // Check deposits were slashed FIFO
        let history = manager.get_deposit_history(&node_id);
        assert_eq!(history[0].amount, 0); // First deposit fully slashed
        assert_eq!(history[1].amount, 1200); // Second deposit partially slashed
        assert_eq!(history[2].amount, 3000); // Third deposit untouched
    }

    #[test]
    fn test_no_active_stake_error() {
        let mut manager = StakeManager::new();
        let node_id = create_test_node();

        let result = manager.slash_stake(&node_id, ViolationType::TimeoutViolation);
        assert!(matches!(result, Err(StakeError::NoActiveStake)));
    }

    #[test]
    fn test_withdrawal_queue_ordering() {
        let mut manager = StakeManager::with_config(StakeConfig {
            min_stake: 1000,
            max_stake: 1_000_000,
            unbonding_period: Duration::from_secs(10),
            min_lock_period: Duration::from_secs(1),
        });

        let node1 = create_test_node();
        let node2 = create_test_node();
        let node3 = create_test_node();

        let lock_time = SystemTime::now() + Duration::from_secs(2);
        manager.deposit_stake(node1, 5000, lock_time).unwrap();
        manager.deposit_stake(node2, 5000, lock_time).unwrap();
        manager.deposit_stake(node3, 5000, lock_time).unwrap();

        std::thread::sleep(Duration::from_secs(3));

        // Request withdrawals at different times
        manager.request_withdrawal(&node1, 1000).unwrap();
        std::thread::sleep(Duration::from_millis(100));
        manager.request_withdrawal(&node2, 1000).unwrap();
        std::thread::sleep(Duration::from_millis(100));
        manager.request_withdrawal(&node3, 1000).unwrap();

        // Queue should be ordered by available_at
        let queue = &manager.withdrawal_queue;
        assert_eq!(queue.len(), 3);
        assert!(queue[0].available_at <= queue[1].available_at);
        assert!(queue[1].available_at <= queue[2].available_at);
    }
}
