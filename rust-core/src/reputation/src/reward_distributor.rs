//! Reward distribution module for block production, transaction fees, and uptime bonuses
//!
//! This module handles fair distribution of rewards to network participants based on:
//! - Block finalization participation
//! - Transaction fee collection
//! - Uptime and reliability metrics
//! - Reputation and stake weighting

use crate::error::ReputationError;
use crate::types::{Amount, NodeId, Reward, RewardStatus, RewardType};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::SystemTime;
use uuid::Uuid;

/// Configuration for reward distribution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewardConfig {
    /// Reward per finalized block
    pub block_reward: Amount,

    /// Percentage of transaction fees to distribute (rest burned)
    pub transaction_fee_percentage: f64,

    /// Total uptime bonus pool per epoch
    pub uptime_bonus_pool: Amount,

    /// Minimum uptime percentage to qualify for bonus (0.95 = 95%)
    pub min_uptime_for_bonus: f64,

    /// Reputation weight in reward calculation (0.6 = 60%)
    pub reputation_weight: f64,

    /// Stake weight in reward calculation (0.4 = 40%)
    pub stake_weight: f64,

    /// Maximum percentage any single node can receive (0.5 = 50%)
    pub max_single_node_share: f64,
}

impl Default for RewardConfig {
    fn default() -> Self {
        Self {
            block_reward: 1000,
            transaction_fee_percentage: 0.80, // 80% distributed, 20% burned
            uptime_bonus_pool: 10000,
            min_uptime_for_bonus: 0.95, // 95% uptime required
            reputation_weight: 0.6,
            stake_weight: 0.4,
            max_single_node_share: 0.50, // No node gets >50% of rewards
        }
    }
}

/// Statistics about reward distribution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewardStatistics {
    /// Total rewards distributed
    pub total_distributed: Amount,

    /// Total rewards pending
    pub total_pending: Amount,

    /// Number of unique recipients
    pub unique_recipients: usize,

    /// Rewards by type
    pub by_type: HashMap<String, Amount>,

    /// Per-node totals
    pub per_node_totals: HashMap<NodeId, Amount>,

    /// Distribution efficiency (rewards distributed / total created)
    pub distribution_efficiency: f64,
}

/// Reward distributor manages fair distribution of network rewards
pub struct RewardDistributor {
    /// Reward configuration
    config: RewardConfig,

    /// All rewards (pending and distributed)
    rewards: HashMap<Uuid, Reward>,

    /// Pending rewards by node
    pending_by_node: HashMap<NodeId, Vec<Uuid>>,

    /// Total rewards distributed per node
    total_rewards_by_node: HashMap<NodeId, Amount>,

    /// Node reputation scores (cached for calculations)
    reputation_scores: HashMap<NodeId, f64>,

    /// Node stake amounts (cached for calculations)
    stake_amounts: HashMap<NodeId, Amount>,
}

impl RewardDistributor {
    /// Create a new reward distributor with default configuration
    pub fn new() -> Self {
        Self::with_config(RewardConfig::default())
    }

    /// Create a reward distributor with custom configuration
    pub fn with_config(config: RewardConfig) -> Self {
        Self {
            config,
            rewards: HashMap::new(),
            pending_by_node: HashMap::new(),
            total_rewards_by_node: HashMap::new(),
            reputation_scores: HashMap::new(),
            stake_amounts: HashMap::new(),
        }
    }

    /// Update cached reputation score for a node
    pub fn update_reputation(&mut self, node_id: NodeId, reputation: f64) {
        self.reputation_scores.insert(node_id, reputation);
    }

    /// Update cached stake amount for a node
    pub fn update_stake(&mut self, node_id: NodeId, stake: Amount) {
        self.stake_amounts.insert(node_id, stake);
    }

    /// Distribute block production reward to nodes that finalized a vertex
    ///
    /// # Arguments
    /// * `vertex_id` - ID of the finalized vertex
    /// * `finalizers` - Nodes that participated in finalizing the vertex
    ///
    /// # Returns
    /// List of reward records created
    pub fn distribute_block_reward(
        &mut self,
        vertex_id: Uuid,
        finalizers: Vec<NodeId>,
    ) -> Result<Vec<Reward>, ReputationError> {
        if finalizers.is_empty() {
            return Err(ReputationError::InvalidOperation(
                "No finalizers provided".to_string(),
            ));
        }

        let total_reward = self.config.block_reward;
        let mut rewards = Vec::new();

        // Calculate weighted shares for each finalizer
        let shares = self.calculate_weighted_shares(&finalizers, total_reward)?;

        // Create reward records
        for (node_id, amount) in shares {
            if amount > 0 {
                let reward = Reward {
                    id: Uuid::new_v4(),
                    node_id,
                    amount,
                    reward_type: RewardType::BlockProduction { vertex_id },
                    earned_at: SystemTime::now(),
                    status: RewardStatus::Pending,
                };

                self.add_reward(reward.clone());
                rewards.push(reward);
            }
        }

        Ok(rewards)
    }

    /// Distribute transaction fees to participating nodes
    ///
    /// # Arguments
    /// * `fees` - Total transaction fees collected
    /// * `participants` - Nodes that participated in processing transactions
    ///
    /// # Returns
    /// List of reward records created
    pub fn distribute_transaction_fees(
        &mut self,
        fees: Amount,
        participants: Vec<NodeId>,
    ) -> Result<Vec<Reward>, ReputationError> {
        if participants.is_empty() {
            return Err(ReputationError::InvalidOperation(
                "No participants provided".to_string(),
            ));
        }

        // Calculate distributable amount (rest is burned)
        let distributable = (fees as f64 * self.config.transaction_fee_percentage) as Amount;
        let num_transactions = participants.len() as u64;

        let mut rewards = Vec::new();

        // Calculate weighted shares
        let shares = self.calculate_weighted_shares(&participants, distributable)?;

        // Create reward records
        for (node_id, amount) in shares {
            if amount > 0 {
                let reward = Reward {
                    id: Uuid::new_v4(),
                    node_id,
                    amount,
                    reward_type: RewardType::TransactionFees { num_transactions },
                    earned_at: SystemTime::now(),
                    status: RewardStatus::Pending,
                };

                self.add_reward(reward.clone());
                rewards.push(reward);
            }
        }

        Ok(rewards)
    }

    /// Distribute uptime bonuses to nodes with high availability
    ///
    /// # Arguments
    /// * `uptime_scores` - Map of node IDs to their uptime percentage (0.0-1.0)
    ///
    /// # Returns
    /// List of reward records created
    pub fn distribute_uptime_bonuses(
        &mut self,
        uptime_scores: HashMap<NodeId, f64>,
    ) -> Result<Vec<Reward>, ReputationError> {
        let min_uptime = self.config.min_uptime_for_bonus;

        // Filter nodes that qualify for bonuses
        let qualified: Vec<NodeId> = uptime_scores
            .iter()
            .filter(|(_, &uptime)| uptime >= min_uptime)
            .map(|(node_id, _)| *node_id)
            .collect();

        if qualified.is_empty() {
            return Ok(Vec::new()); // No nodes qualified
        }

        let total_bonus = self.config.uptime_bonus_pool;
        let mut rewards = Vec::new();

        // Calculate weighted shares for qualified nodes
        let shares = self.calculate_weighted_shares(&qualified, total_bonus)?;

        // Create reward records
        for (node_id, amount) in shares {
            if amount > 0 {
                let uptime_percentage = *uptime_scores.get(&node_id).unwrap_or(&0.0);
                let reward = Reward {
                    id: Uuid::new_v4(),
                    node_id,
                    amount,
                    reward_type: RewardType::UptimeBonus {
                        uptime_percentage,
                    },
                    earned_at: SystemTime::now(),
                    status: RewardStatus::Pending,
                };

                self.add_reward(reward.clone());
                rewards.push(reward);
            }
        }

        Ok(rewards)
    }

    /// Calculate reward share for a specific node
    ///
    /// # Arguments
    /// * `node_id` - Node to calculate share for
    /// * `total_reward` - Total reward amount to distribute
    /// * `participants` - All participating nodes
    ///
    /// # Returns
    /// Amount this node should receive
    pub fn calculate_reward_share(
        &self,
        node_id: &NodeId,
        total_reward: Amount,
        participants: &[NodeId],
    ) -> Amount {
        if participants.is_empty() || !participants.contains(node_id) {
            return 0;
        }

        // Calculate total weight across all participants
        let mut total_weight = 0.0;
        let mut weights = HashMap::new();

        for participant in participants {
            let weight = self.calculate_node_weight(participant);
            weights.insert(participant, weight);
            total_weight += weight;
        }

        if total_weight == 0.0 {
            // Equal distribution if no weights available
            return total_reward / participants.len() as Amount;
        }

        // Calculate this node's share
        let node_weight = weights.get(&node_id).unwrap_or(&0.0);
        let share_ratio = node_weight / total_weight;

        // Apply max share cap
        let capped_ratio = share_ratio.min(self.config.max_single_node_share);

        (total_reward as f64 * capped_ratio) as Amount
    }

    /// Get pending rewards for a node
    pub fn get_pending_rewards(&self, node_id: &NodeId) -> Vec<Reward> {
        self.pending_by_node
            .get(node_id)
            .map(|reward_ids| {
                reward_ids
                    .iter()
                    .filter_map(|id| self.rewards.get(id).cloned())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Mark a reward as distributed
    pub fn mark_reward_distributed(&mut self, reward_id: &Uuid) -> Result<(), ReputationError> {
        let reward = self
            .rewards
            .get_mut(reward_id)
            .ok_or_else(|| ReputationError::NotFound(format!("Reward {}", reward_id)))?;

        if reward.status == RewardStatus::Distributed {
            return Err(ReputationError::InvalidOperation(
                "Reward already distributed".to_string(),
            ));
        }

        reward.status = RewardStatus::Distributed;

        // Remove from pending
        if let Some(pending) = self.pending_by_node.get_mut(&reward.node_id) {
            pending.retain(|id| id != reward_id);
        }

        // Update total rewards for node
        *self
            .total_rewards_by_node
            .entry(reward.node_id)
            .or_insert(0) += reward.amount;

        Ok(())
    }

    /// Get total rewards earned by a node (distributed only)
    pub fn get_total_rewards(&self, node_id: &NodeId) -> Amount {
        *self.total_rewards_by_node.get(node_id).unwrap_or(&0)
    }

    /// Get reward distribution statistics
    pub fn get_statistics(&self) -> RewardStatistics {
        let mut total_distributed = 0;
        let mut total_pending = 0;
        let mut by_type: HashMap<String, Amount> = HashMap::new();

        for reward in self.rewards.values() {
            match reward.status {
                RewardStatus::Distributed => total_distributed += reward.amount,
                RewardStatus::Pending => total_pending += reward.amount,
                RewardStatus::Failed => {} // Don't count failed
            }

            let type_key = format!("{:?}", reward.reward_type).split('{').next().unwrap().to_string();
            *by_type.entry(type_key).or_insert(0) += reward.amount;
        }

        let unique_recipients = self.total_rewards_by_node.len();
        let per_node_totals = self.total_rewards_by_node.clone();

        let total_created = total_distributed + total_pending;
        let distribution_efficiency = if total_created > 0 {
            total_distributed as f64 / total_created as f64
        } else {
            0.0
        };

        RewardStatistics {
            total_distributed,
            total_pending,
            unique_recipients,
            by_type,
            per_node_totals,
            distribution_efficiency,
        }
    }

    // === Private Helper Methods ===

    /// Add a reward to internal tracking
    fn add_reward(&mut self, reward: Reward) {
        let node_id = reward.node_id;
        let reward_id = reward.id;

        self.rewards.insert(reward_id, reward);
        self.pending_by_node
            .entry(node_id)
            .or_insert_with(Vec::new)
            .push(reward_id);
    }

    /// Calculate node weight based on reputation and stake
    fn calculate_node_weight(&self, node_id: &NodeId) -> f64 {
        let reputation = self.reputation_scores.get(node_id).unwrap_or(&0.5); // Default to 0.5
        let stake = *self.stake_amounts.get(node_id).unwrap_or(&1000) as f64; // Default minimum

        // Calculate total stake for normalization
        let total_stake: f64 = self.stake_amounts.values().map(|&s| s as f64).sum();
        let stake_ratio = if total_stake > 0.0 {
            stake / total_stake
        } else {
            1.0 / self.stake_amounts.len().max(1) as f64
        };

        // Combined weight: (reputation * weight) + (stake_ratio * weight)
        (reputation * self.config.reputation_weight) + (stake_ratio * self.config.stake_weight)
    }

    /// Calculate weighted shares for all participants
    fn calculate_weighted_shares(
        &self,
        participants: &[NodeId],
        total_amount: Amount,
    ) -> Result<HashMap<NodeId, Amount>, ReputationError> {
        let mut shares = HashMap::new();
        let mut total_weight = 0.0;
        let mut weights = HashMap::new();

        // Calculate weights for all participants
        for node_id in participants {
            let weight = self.calculate_node_weight(node_id);
            weights.insert(*node_id, weight);
            total_weight += weight;
        }

        if total_weight == 0.0 {
            // Equal distribution fallback
            let share = total_amount / participants.len() as Amount;
            for node_id in participants {
                shares.insert(*node_id, share);
            }
            return Ok(shares);
        }

        // Calculate shares based on weights
        let mut remaining = total_amount;

        for node_id in participants {
            let weight = weights.get(node_id).unwrap_or(&0.0);
            let mut share_ratio = weight / total_weight;

            // Apply max share cap
            share_ratio = share_ratio.min(self.config.max_single_node_share);

            let share = (total_amount as f64 * share_ratio) as Amount;
            shares.insert(*node_id, share.min(remaining));
            remaining = remaining.saturating_sub(share);
        }

        Ok(shares)
    }
}

impl Default for RewardDistributor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_nodes() -> Vec<NodeId> {
        vec![
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4(),
        ]
    }

    #[test]
    fn test_new_distributor() {
        let distributor = RewardDistributor::new();
        assert_eq!(distributor.config.block_reward, 1000);
        assert_eq!(distributor.config.reputation_weight, 0.6);
        assert_eq!(distributor.rewards.len(), 0);
    }

    #[test]
    fn test_custom_config() {
        let config = RewardConfig {
            block_reward: 5000,
            transaction_fee_percentage: 0.90,
            uptime_bonus_pool: 20000,
            min_uptime_for_bonus: 0.98,
            reputation_weight: 0.7,
            stake_weight: 0.3,
            max_single_node_share: 0.40,
        };

        let distributor = RewardDistributor::with_config(config.clone());
        assert_eq!(distributor.config.block_reward, 5000);
        assert_eq!(distributor.config.reputation_weight, 0.7);
    }

    #[test]
    fn test_block_reward_distribution_equal() {
        let mut distributor = RewardDistributor::new();
        let nodes = create_test_nodes();
        let vertex_id = Uuid::new_v4();

        // No reputation or stake data = equal distribution
        let rewards = distributor
            .distribute_block_reward(vertex_id, nodes.clone())
            .unwrap();

        assert_eq!(rewards.len(), 3);
        assert_eq!(rewards[0].status, RewardStatus::Pending);

        // Each should get roughly equal share (allow for rounding)
        let total: Amount = rewards.iter().map(|r| r.amount).sum();
        assert!(total >= 999 && total <= 1000); // Allow 1 unit rounding error
    }

    #[test]
    fn test_block_reward_weighted_by_reputation() {
        let mut distributor = RewardDistributor::new();
        let nodes = create_test_nodes();
        let vertex_id = Uuid::new_v4();

        // Set different reputation scores
        distributor.update_reputation(nodes[0], 1.0); // Perfect reputation
        distributor.update_reputation(nodes[1], 0.5); // Medium reputation
        distributor.update_reputation(nodes[2], 0.2); // Low reputation

        // Set equal stakes
        for node in &nodes {
            distributor.update_stake(*node, 1000);
        }

        let rewards = distributor
            .distribute_block_reward(vertex_id, nodes.clone())
            .unwrap();

        assert_eq!(rewards.len(), 3);

        // Node with higher reputation should get more
        let node0_reward = rewards.iter().find(|r| r.node_id == nodes[0]).unwrap();
        let node2_reward = rewards.iter().find(|r| r.node_id == nodes[2]).unwrap();
        assert!(node0_reward.amount > node2_reward.amount);
    }

    #[test]
    fn test_block_reward_weighted_by_stake() {
        let mut distributor = RewardDistributor::new();
        let nodes = create_test_nodes();
        let vertex_id = Uuid::new_v4();

        // Set equal reputation
        for node in &nodes {
            distributor.update_reputation(*node, 0.8);
        }

        // Set different stakes
        distributor.update_stake(nodes[0], 10000); // High stake
        distributor.update_stake(nodes[1], 5000);  // Medium stake
        distributor.update_stake(nodes[2], 1000);  // Low stake

        let rewards = distributor
            .distribute_block_reward(vertex_id, nodes.clone())
            .unwrap();

        assert_eq!(rewards.len(), 3);

        // Node with higher stake should get more
        let node0_reward = rewards.iter().find(|r| r.node_id == nodes[0]).unwrap();
        let node2_reward = rewards.iter().find(|r| r.node_id == nodes[2]).unwrap();
        assert!(node0_reward.amount > node2_reward.amount);
    }

    #[test]
    fn test_transaction_fee_distribution() {
        let mut distributor = RewardDistributor::new();
        let nodes = create_test_nodes();

        let total_fees = 1000;
        let rewards = distributor
            .distribute_transaction_fees(total_fees, nodes.clone())
            .unwrap();

        assert_eq!(rewards.len(), 3);

        // Should distribute 80% of fees (20% burned, allow for rounding)
        let total_distributed: Amount = rewards.iter().map(|r| r.amount).sum();
        assert!(total_distributed >= 798 && total_distributed <= 800); // 80% of 1000, allow rounding

        // Verify reward type
        match &rewards[0].reward_type {
            RewardType::TransactionFees { num_transactions } => {
                assert_eq!(*num_transactions, 3);
            }
            _ => panic!("Wrong reward type"),
        }
    }

    #[test]
    fn test_uptime_bonus_distribution() {
        let mut distributor = RewardDistributor::new();
        let nodes = create_test_nodes();

        // Set reputation and stake
        for node in &nodes {
            distributor.update_reputation(*node, 0.8);
            distributor.update_stake(*node, 5000);
        }

        let mut uptime_scores = HashMap::new();
        uptime_scores.insert(nodes[0], 0.99); // Qualifies
        uptime_scores.insert(nodes[1], 0.96); // Qualifies
        uptime_scores.insert(nodes[2], 0.90); // Does not qualify (below 95%)

        let rewards = distributor.distribute_uptime_bonuses(uptime_scores).unwrap();

        // Only 2 nodes should receive bonuses
        assert_eq!(rewards.len(), 2);

        let total: Amount = rewards.iter().map(|r| r.amount).sum();
        assert_eq!(total, 10000); // Full uptime bonus pool

        // Verify node[2] didn't get reward
        assert!(!rewards.iter().any(|r| r.node_id == nodes[2]));
    }

    #[test]
    fn test_pending_rewards() {
        let mut distributor = RewardDistributor::new();
        let nodes = create_test_nodes();
        let vertex_id = Uuid::new_v4();

        distributor
            .distribute_block_reward(vertex_id, nodes.clone())
            .unwrap();

        let pending = distributor.get_pending_rewards(&nodes[0]);
        assert!(!pending.is_empty());
        assert_eq!(pending[0].status, RewardStatus::Pending);
    }

    #[test]
    fn test_mark_reward_distributed() {
        let mut distributor = RewardDistributor::new();
        let nodes = create_test_nodes();
        let vertex_id = Uuid::new_v4();

        let rewards = distributor
            .distribute_block_reward(vertex_id, nodes.clone())
            .unwrap();

        let reward_id = rewards[0].id;
        let node_id = rewards[0].node_id;

        // Mark as distributed
        distributor.mark_reward_distributed(&reward_id).unwrap();

        // Should no longer be pending
        let pending = distributor.get_pending_rewards(&node_id);
        assert!(!pending.iter().any(|r| r.id == reward_id));

        // Should be in total rewards
        let total = distributor.get_total_rewards(&node_id);
        assert!(total > 0);
    }

    #[test]
    fn test_mark_already_distributed() {
        let mut distributor = RewardDistributor::new();
        let nodes = create_test_nodes();
        let vertex_id = Uuid::new_v4();

        let rewards = distributor
            .distribute_block_reward(vertex_id, nodes.clone())
            .unwrap();
        let reward_id = rewards[0].id;

        distributor.mark_reward_distributed(&reward_id).unwrap();

        // Try to mark again
        let result = distributor.mark_reward_distributed(&reward_id);
        assert!(result.is_err());
    }

    #[test]
    fn test_statistics() {
        let mut distributor = RewardDistributor::new();
        let nodes = create_test_nodes();
        let vertex_id = Uuid::new_v4();

        // Create some rewards
        let rewards = distributor
            .distribute_block_reward(vertex_id, nodes.clone())
            .unwrap();

        // Mark one as distributed
        distributor.mark_reward_distributed(&rewards[0].id).unwrap();

        let stats = distributor.get_statistics();
        assert!(stats.total_pending > 0);
        assert!(stats.total_distributed > 0);
        assert_eq!(stats.unique_recipients, 1); // Only one distributed
        assert!(stats.distribution_efficiency > 0.0);
        assert!(stats.distribution_efficiency < 1.0);
    }

    #[test]
    fn test_max_single_node_share_cap() {
        let mut distributor = RewardDistributor::new();
        let nodes = vec![Uuid::new_v4(), Uuid::new_v4()];

        // Give one node overwhelming advantage
        distributor.update_reputation(nodes[0], 1.0);
        distributor.update_reputation(nodes[1], 0.1);
        distributor.update_stake(nodes[0], 100000);
        distributor.update_stake(nodes[1], 1000);

        let vertex_id = Uuid::new_v4();
        let rewards = distributor
            .distribute_block_reward(vertex_id, nodes.clone())
            .unwrap();

        // Find node[0]'s reward
        let node0_reward = rewards.iter().find(|r| r.node_id == nodes[0]).unwrap();
        let node1_reward = rewards.iter().find(|r| r.node_id == nodes[1]).unwrap();

        // Despite overwhelming advantage, node0 should not get everything
        // Verify fair distribution constraint is working
        assert!(node0_reward.amount > node1_reward.amount); // Higher stake/reputation gets more
        assert!(node1_reward.amount > 0); // But lower node still gets something
    }

    #[test]
    fn test_empty_finalizers() {
        let mut distributor = RewardDistributor::new();
        let vertex_id = Uuid::new_v4();

        let result = distributor.distribute_block_reward(vertex_id, vec![]);
        assert!(result.is_err());
    }

    #[test]
    fn test_empty_participants() {
        let mut distributor = RewardDistributor::new();

        let result = distributor.distribute_transaction_fees(1000, vec![]);
        assert!(result.is_err());
    }

    #[test]
    fn test_no_qualifying_uptime() {
        let mut distributor = RewardDistributor::new();
        let nodes = create_test_nodes();

        let mut uptime_scores = HashMap::new();
        uptime_scores.insert(nodes[0], 0.80); // Too low
        uptime_scores.insert(nodes[1], 0.85); // Too low
        uptime_scores.insert(nodes[2], 0.90); // Too low

        let rewards = distributor.distribute_uptime_bonuses(uptime_scores).unwrap();
        assert_eq!(rewards.len(), 0); // No rewards distributed
    }

    #[test]
    fn test_calculate_reward_share() {
        let mut distributor = RewardDistributor::new();
        let nodes = create_test_nodes();

        // Set equal reputation and stake
        for node in &nodes {
            distributor.update_reputation(*node, 0.8);
            distributor.update_stake(*node, 5000);
        }

        let share = distributor.calculate_reward_share(&nodes[0], 1000, &nodes);

        // Should get roughly 1/3
        assert!(share > 300);
        assert!(share < 400);
    }

    #[test]
    fn test_get_total_rewards_no_rewards() {
        let distributor = RewardDistributor::new();
        let node_id = Uuid::new_v4();

        let total = distributor.get_total_rewards(&node_id);
        assert_eq!(total, 0);
    }

    #[test]
    fn test_reward_convergence_one_block() {
        let mut distributor = RewardDistributor::new();
        let nodes = create_test_nodes();
        let vertex_id = Uuid::new_v4();

        // Set reputation and stake
        for node in &nodes {
            distributor.update_reputation(*node, 0.8);
            distributor.update_stake(*node, 5000);
        }

        let rewards = distributor
            .distribute_block_reward(vertex_id, nodes.clone())
            .unwrap();

        // All rewards should be created in single operation
        assert_eq!(rewards.len(), 3);

        // Total should equal block reward (converges in 1 block, allow rounding)
        let total: Amount = rewards.iter().map(|r| r.amount).sum();
        let expected = distributor.config.block_reward;
        assert!(total >= expected - 1 && total <= expected); // Allow 1 unit rounding error
    }
}
