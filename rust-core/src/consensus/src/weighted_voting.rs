//! Weighted Voting System for CretoAI Consensus
//!
//! Implements stake-weighted and reputation-weighted voting to prevent
//! Sybil attacks and ensure quality consensus decisions.
//!
//! ## Vote Weight Calculation
//!
//! VoteWeight = (0.4 × StakeWeight) + (0.4 × ReputationWeight) + (0.2 × UptimeWeight)
//!
//! - **StakeWeight**: Normalized stake (0-1)
//! - **ReputationWeight**: Normalized reputation score (0-1)
//! - **UptimeWeight**: Normalized uptime percentage (0-1)

use crate::{NodeId, Result, ConsensusError};
use dashmap::DashMap;
use parking_lot::RwLock;
use prometheus::{register_gauge, register_histogram, Gauge, Histogram};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{debug, info, warn};

/// Minimum stake required to participate in voting (prevents spam)
pub const MIN_STAKE: u64 = 100_000; // 0.001 tokens

/// Maximum vote weight to prevent single-node dominance
pub const MAX_VOTE_WEIGHT: f64 = 0.15; // 15% max per node

/// Minimum uptime percentage for full voting rights
pub const MIN_UPTIME_PERCENT: f64 = 0.75; // 75%

/// Vote weight components configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeightConfig {
    /// Weight factor for stake component (0-1)
    pub stake_factor: f64,

    /// Weight factor for reputation component (0-1)
    pub reputation_factor: f64,

    /// Weight factor for uptime component (0-1)
    pub uptime_factor: f64,

    /// Minimum stake to vote
    pub min_stake: u64,

    /// Maximum single-node vote weight
    pub max_vote_weight: f64,

    /// Minimum uptime for full rights
    pub min_uptime: f64,
}

impl Default for WeightConfig {
    fn default() -> Self {
        Self {
            stake_factor: 0.4,
            reputation_factor: 0.4,
            uptime_factor: 0.2,
            min_stake: MIN_STAKE,
            max_vote_weight: MAX_VOTE_WEIGHT,
            min_uptime: MIN_UPTIME_PERCENT,
        }
    }
}

impl WeightConfig {
    /// Validate configuration (factors must sum to 1.0)
    pub fn validate(&self) -> Result<()> {
        let sum = self.stake_factor + self.reputation_factor + self.uptime_factor;
        if (sum - 1.0).abs() > 0.001 {
            return Err(ConsensusError::Configuration(
                format!("Weight factors must sum to 1.0, got {}", sum)
            ));
        }

        if self.max_vote_weight <= 0.0 || self.max_vote_weight > 1.0 {
            return Err(ConsensusError::Configuration(
                "max_vote_weight must be in (0, 1]".to_string()
            ));
        }

        Ok(())
    }
}

/// Individual node's voting power components
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoteWeight {
    /// Node identifier
    pub node_id: NodeId,

    /// Raw stake amount
    pub stake: u64,

    /// Normalized stake weight (0-1)
    pub stake_weight: f64,

    /// Reputation score (0-1)
    pub reputation_weight: f64,

    /// Uptime percentage (0-1)
    pub uptime_weight: f64,

    /// Final computed vote weight (0-1)
    pub total_weight: f64,

    /// Timestamp of last weight update (not serialized)
    #[serde(skip, default = "Instant::now")]
    pub last_updated: Instant,
}

impl VoteWeight {
    /// Create new vote weight with zero values
    pub fn new(node_id: NodeId) -> Self {
        Self {
            node_id,
            stake: 0,
            stake_weight: 0.0,
            reputation_weight: 0.0,
            uptime_weight: 0.0,
            total_weight: 0.0,
            last_updated: Instant::now(),
        }
    }

    /// Check if node meets minimum requirements to vote
    pub fn can_vote(&self, config: &WeightConfig) -> bool {
        self.stake >= config.min_stake && self.uptime_weight >= config.min_uptime
    }
}

/// Weighted voting manager
pub struct WeightedVotingSystem {
    /// Configuration
    config: WeightConfig,

    /// Node vote weights (NodeId -> VoteWeight)
    weights: Arc<DashMap<NodeId, VoteWeight>>,

    /// Total network stake (for normalization)
    total_stake: Arc<RwLock<u64>>,

    /// Metrics
    metrics: Arc<WeightedVotingMetrics>,
}

/// Prometheus metrics for weighted voting
struct WeightedVotingMetrics {
    /// Total network stake
    total_stake: Gauge,

    /// Number of eligible voters
    eligible_voters: Gauge,

    /// Average vote weight
    avg_vote_weight: Gauge,

    /// Weight calculation time
    weight_calc_duration: Histogram,
}

impl WeightedVotingMetrics {
    fn new() -> Result<Self> {
        Ok(Self {
            total_stake: register_gauge!(
                "weighted_voting_total_stake",
                "Total network stake for voting"
            )?,
            eligible_voters: register_gauge!(
                "weighted_voting_eligible_voters",
                "Number of nodes eligible to vote"
            )?,
            avg_vote_weight: register_gauge!(
                "weighted_voting_avg_weight",
                "Average vote weight across nodes"
            )?,
            weight_calc_duration: register_histogram!(
                "weighted_voting_calc_duration_seconds",
                "Time to calculate vote weights"
            )?,
        })
    }
}

impl WeightedVotingSystem {
    /// Create new weighted voting system
    pub fn new(config: WeightConfig) -> Result<Self> {
        config.validate()?;

        Ok(Self {
            config,
            weights: Arc::new(DashMap::new()),
            total_stake: Arc::new(RwLock::new(0)),
            metrics: Arc::new(WeightedVotingMetrics::new()?),
        })
    }

    /// Register a node with initial stake
    pub fn register_node(&self, node_id: NodeId, stake: u64) -> Result<()> {
        if stake < self.config.min_stake {
            return Err(ConsensusError::InvalidStake(
                format!("Stake {} below minimum {}", stake, self.config.min_stake)
            ));
        }

        let mut weight = VoteWeight::new(node_id);
        weight.stake = stake;

        // Update total stake
        let mut total = self.total_stake.write();
        *total += stake;
        self.metrics.total_stake.set(*total as f64);

        self.weights.insert(node_id, weight);

        info!("Registered node {} with stake {}", node_id, stake);
        Ok(())
    }

    /// Update node's stake amount
    pub fn update_stake(&self, node_id: NodeId, new_stake: u64) -> Result<()> {
        let mut entry = self.weights.get_mut(&node_id)
            .ok_or_else(|| ConsensusError::UnknownNode(node_id))?;

        let old_stake = entry.stake;
        entry.stake = new_stake;

        // Update total stake
        let mut total = self.total_stake.write();
        *total = total.saturating_sub(old_stake).saturating_add(new_stake);
        self.metrics.total_stake.set(*total as f64);

        debug!("Updated stake for node {}: {} -> {}", node_id, old_stake, new_stake);
        Ok(())
    }

    /// Update node's reputation score (0-1)
    pub fn update_reputation(&self, node_id: NodeId, reputation: f64) -> Result<()> {
        if reputation < 0.0 || reputation > 1.0 {
            return Err(ConsensusError::InvalidReputation(reputation));
        }

        let mut entry = self.weights.get_mut(&node_id)
            .ok_or_else(|| ConsensusError::UnknownNode(node_id))?;

        entry.reputation_weight = reputation;
        debug!("Updated reputation for node {}: {}", node_id, reputation);
        Ok(())
    }

    /// Update node's uptime percentage (0-1)
    pub fn update_uptime(&self, node_id: NodeId, uptime: f64) -> Result<()> {
        if uptime < 0.0 || uptime > 1.0 {
            return Err(ConsensusError::InvalidUptime(uptime));
        }

        let mut entry = self.weights.get_mut(&node_id)
            .ok_or_else(|| ConsensusError::UnknownNode(node_id))?;

        entry.uptime_weight = uptime;
        debug!("Updated uptime for node {}: {}", node_id, uptime);
        Ok(())
    }

    /// Calculate and normalize all vote weights
    pub fn calculate_weights(&self) -> Result<()> {
        let start = Instant::now();

        let total_stake = *self.total_stake.read();
        if total_stake == 0 {
            return Err(ConsensusError::NoStake);
        }

        // First pass: calculate stake weights and raw totals
        let mut raw_weights = HashMap::new();
        for mut entry in self.weights.iter_mut() {
            let weight = entry.value_mut();

            // Calculate stake weight (normalized)
            weight.stake_weight = if total_stake > 0 {
                (weight.stake as f64) / (total_stake as f64)
            } else {
                0.0
            };

            // Calculate raw total weight
            let raw_total = (self.config.stake_factor * weight.stake_weight)
                + (self.config.reputation_factor * weight.reputation_weight)
                + (self.config.uptime_factor * weight.uptime_weight);

            raw_weights.insert(weight.node_id, raw_total);
            weight.last_updated = Instant::now();
        }

        // Find normalization factor to ensure no node exceeds max_vote_weight
        let max_raw = raw_weights.values().cloned().fold(0.0f64, f64::max);
        let normalization_factor = if max_raw > self.config.max_vote_weight {
            self.config.max_vote_weight / max_raw
        } else {
            1.0
        };

        // Second pass: apply normalization and anti-manipulation safeguards
        let mut eligible_count = 0;
        let mut total_weight = 0.0;

        for mut entry in self.weights.iter_mut() {
            let weight = entry.value_mut();

            if let Some(&raw_total) = raw_weights.get(&weight.node_id) {
                weight.total_weight = raw_total * normalization_factor;

                // Apply anti-manipulation: zero weight if below minimum uptime
                if weight.uptime_weight < self.config.min_uptime {
                    weight.total_weight = 0.0;
                    warn!("Node {} vote weight zeroed due to low uptime: {}",
                          weight.node_id, weight.uptime_weight);
                }

                if weight.can_vote(&self.config) {
                    eligible_count += 1;
                    total_weight += weight.total_weight;
                }
            }
        }

        // Update metrics
        self.metrics.eligible_voters.set(eligible_count as f64);
        if eligible_count > 0 {
            self.metrics.avg_vote_weight.set(total_weight / eligible_count as f64);
        }
        self.metrics.weight_calc_duration.observe(start.elapsed().as_secs_f64());

        info!("Calculated weights for {} eligible voters (avg: {:.4})",
              eligible_count, total_weight / eligible_count as f64);

        Ok(())
    }

    /// Get vote weight for a specific node
    pub fn get_weight(&self, node_id: &NodeId) -> Option<VoteWeight> {
        self.weights.get(node_id).map(|entry| entry.value().clone())
    }

    /// Get all eligible voters and their weights
    pub fn get_eligible_voters(&self) -> Vec<VoteWeight> {
        self.weights
            .iter()
            .filter(|entry| entry.value().can_vote(&self.config))
            .map(|entry| entry.value().clone())
            .collect()
    }

    /// Calculate weighted vote result (returns vote percentage 0-1)
    pub fn calculate_vote_result(&self, votes: &HashMap<NodeId, bool>) -> Result<f64> {
        let mut total_weight = 0.0;
        let mut yes_weight = 0.0;

        for (node_id, vote) in votes {
            if let Some(weight) = self.get_weight(node_id) {
                if weight.can_vote(&self.config) {
                    total_weight += weight.total_weight;
                    if *vote {
                        yes_weight += weight.total_weight;
                    }
                } else {
                    warn!("Node {} attempted to vote but doesn't meet requirements", node_id);
                }
            }
        }

        if total_weight == 0.0 {
            return Err(ConsensusError::NoEligibleVoters);
        }

        let percentage = yes_weight / total_weight;
        info!("Vote result: {:.2}% approval ({} / {} weighted votes)",
              percentage * 100.0, yes_weight, total_weight);

        Ok(percentage)
    }

    /// Check if weighted vote passes threshold
    pub fn vote_passes(&self, votes: &HashMap<NodeId, bool>, threshold: f64) -> Result<bool> {
        let result = self.calculate_vote_result(votes)?;
        Ok(result >= threshold)
    }

    /// Slash node's stake (for Byzantine behavior)
    pub fn slash_stake(&self, node_id: NodeId, slash_percentage: f64) -> Result<u64> {
        if slash_percentage < 0.0 || slash_percentage > 1.0 {
            return Err(ConsensusError::InvalidSlashPercentage(slash_percentage));
        }

        let mut entry = self.weights.get_mut(&node_id)
            .ok_or_else(|| ConsensusError::UnknownNode(node_id))?;

        let slash_amount = (entry.stake as f64 * slash_percentage) as u64;
        let old_stake = entry.stake;
        entry.stake = entry.stake.saturating_sub(slash_amount);

        // Update total stake
        let mut total = self.total_stake.write();
        *total = total.saturating_sub(slash_amount);
        self.metrics.total_stake.set(*total as f64);

        warn!("Slashed node {} stake by {:.1}%: {} -> {}",
              node_id, slash_percentage * 100.0, old_stake, entry.stake);

        Ok(slash_amount)
    }

    /// Remove node from voting system
    pub fn remove_node(&self, node_id: NodeId) -> Result<()> {
        if let Some((_, weight)) = self.weights.remove(&node_id) {
            // Update total stake
            let mut total = self.total_stake.write();
            *total = total.saturating_sub(weight.stake);
            self.metrics.total_stake.set(*total as f64);

            info!("Removed node {} from voting system", node_id);
            Ok(())
        } else {
            Err(ConsensusError::UnknownNode(node_id))
        }
    }

    /// Get voting system statistics
    pub fn get_stats(&self) -> VotingStats {
        let total_stake = *self.total_stake.read();
        let total_nodes = self.weights.len();
        let eligible = self.get_eligible_voters();
        let eligible_count = eligible.len();

        let avg_weight = if eligible_count > 0 {
            eligible.iter().map(|w| w.total_weight).sum::<f64>() / eligible_count as f64
        } else {
            0.0
        };

        VotingStats {
            total_nodes,
            eligible_voters: eligible_count,
            total_stake,
            avg_vote_weight: avg_weight,
            max_configured_weight: self.config.max_vote_weight,
        }
    }
}

/// Voting system statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VotingStats {
    pub total_nodes: usize,
    pub eligible_voters: usize,
    pub total_stake: u64,
    pub avg_vote_weight: f64,
    pub max_configured_weight: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_weight_config_validation() {
        let mut config = WeightConfig::default();
        assert!(config.validate().is_ok());

        // Invalid: factors don't sum to 1.0
        config.stake_factor = 0.5;
        assert!(config.validate().is_err());

        // Invalid: max weight out of range
        config.stake_factor = 0.4;
        config.max_vote_weight = 1.5;
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_vote_weight_can_vote() {
        let config = WeightConfig::default();
        let mut weight = VoteWeight::new(NodeId::new_v4());

        // Not enough stake
        weight.stake = 50_000;
        weight.uptime_weight = 0.8;
        assert!(!weight.can_vote(&config));

        // Low uptime
        weight.stake = 200_000;
        weight.uptime_weight = 0.5;
        assert!(!weight.can_vote(&config));

        // Valid
        weight.stake = 200_000;
        weight.uptime_weight = 0.9;
        assert!(weight.can_vote(&config));
    }

    #[tokio::test]
    async fn test_weighted_voting_basic() {
        let config = WeightConfig::default();
        let system = WeightedVotingSystem::new(config).unwrap();

        // Register nodes
        let node1 = NodeId::new_v4();
        let node2 = NodeId::new_v4();
        let node3 = NodeId::new_v4();

        system.register_node(node1, 1_000_000).unwrap();
        system.register_node(node2, 2_000_000).unwrap();
        system.register_node(node3, 3_000_000).unwrap();

        // Set reputation and uptime
        system.update_reputation(node1, 0.8).unwrap();
        system.update_reputation(node2, 0.9).unwrap();
        system.update_reputation(node3, 0.7).unwrap();

        system.update_uptime(node1, 0.85).unwrap();
        system.update_uptime(node2, 0.95).unwrap();
        system.update_uptime(node3, 0.80).unwrap();

        // Calculate weights
        system.calculate_weights().unwrap();

        // Node 2 should have highest weight (most stake + good reputation + best uptime)
        let w1 = system.get_weight(&node1).unwrap();
        let w2 = system.get_weight(&node2).unwrap();
        let w3 = system.get_weight(&node3).unwrap();

        assert!(w2.total_weight > w1.total_weight);
        assert!(w2.total_weight > w3.total_weight);
    }

    #[tokio::test]
    async fn test_vote_calculation() {
        let config = WeightConfig::default();
        let system = WeightedVotingSystem::new(config).unwrap();

        let node1 = NodeId::new_v4();
        let node2 = NodeId::new_v4();

        system.register_node(node1, 1_000_000).unwrap();
        system.register_node(node2, 1_000_000).unwrap();

        system.update_reputation(node1, 0.8).unwrap();
        system.update_reputation(node2, 0.8).unwrap();
        system.update_uptime(node1, 0.9).unwrap();
        system.update_uptime(node2, 0.9).unwrap();

        system.calculate_weights().unwrap();

        // 100% approval
        let mut votes = HashMap::new();
        votes.insert(node1, true);
        votes.insert(node2, true);

        let result = system.calculate_vote_result(&votes).unwrap();
        assert!((result - 1.0).abs() < 0.01);

        // 50% approval
        votes.insert(node2, false);
        let result = system.calculate_vote_result(&votes).unwrap();
        assert!((result - 0.5).abs() < 0.01);
    }
}
