//! Reputation system for tracking agent trustworthiness
//!
//! Implements a decentralized reputation scoring system based on
//! completed transactions, reviews, and behavior metrics.

use crate::error::{ExchangeError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// Agent reputation record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentReputation {
    /// Agent ID
    pub agent_id: String,
    /// Overall reputation score (0.0 - 1.0)
    pub score: f64,
    /// Total completed transactions
    pub total_transactions: u64,
    /// Successful transactions
    pub successful_transactions: u64,
    /// Failed transactions
    pub failed_transactions: u64,
    /// Total reviews received
    pub total_reviews: u64,
    /// Average review rating (0.0 - 5.0)
    pub average_rating: f64,
    /// Last updated timestamp
    pub last_updated: i64,
}

impl AgentReputation {
    /// Create a new reputation record with default neutral score
    pub fn new(agent_id: String) -> Self {
        Self {
            agent_id,
            score: 0.5,                   // Neutral starting score
            total_transactions: 0,
            successful_transactions: 0,
            failed_transactions: 0,
            total_reviews: 0,
            average_rating: 3.0,          // Neutral rating
            last_updated: chrono::Utc::now().timestamp(),
        }
    }

    /// Calculate reputation score based on transaction history and reviews
    pub fn calculate_score(&self) -> f64 {
        if self.total_transactions == 0 {
            return 0.5; // Neutral for new agents
        }

        // Success rate component (0.0 - 0.5)
        let success_rate = self.successful_transactions as f64 / self.total_transactions as f64;
        let success_component = success_rate * 0.5;

        // Review rating component (0.0 - 0.5)
        let review_component = if self.total_reviews > 0 {
            (self.average_rating / 5.0) * 0.5
        } else {
            0.25 // Neutral if no reviews
        };

        // Combine components
        let raw_score = success_component + review_component;

        // Apply experience boost for established agents
        let experience_multiplier = if self.total_transactions >= 100 {
            1.1
        } else if self.total_transactions >= 50 {
            1.05
        } else {
            1.0
        };

        (raw_score * experience_multiplier).min(1.0)
    }

    /// Update score based on transaction outcome
    pub fn record_transaction(&mut self, success: bool) {
        self.total_transactions += 1;
        if success {
            self.successful_transactions += 1;
        } else {
            self.failed_transactions += 1;
        }
        self.score = self.calculate_score();
        self.last_updated = chrono::Utc::now().timestamp();
    }

    /// Add a review rating
    pub fn add_review(&mut self, rating: f64) {
        let total_rating = self.average_rating * self.total_reviews as f64 + rating;
        self.total_reviews += 1;
        self.average_rating = total_rating / self.total_reviews as f64;
        self.score = self.calculate_score();
        self.last_updated = chrono::Utc::now().timestamp();
    }

    /// Check if reputation meets minimum threshold
    pub fn meets_threshold(&self, threshold: f64) -> bool {
        self.score >= threshold
    }
}

/// Reputation manager
pub struct ReputationManager {
    reputations: Arc<RwLock<HashMap<String, AgentReputation>>>,
    min_score_for_provider: f64,
    min_score_for_buyer: f64,
}

impl ReputationManager {
    /// Create a new reputation manager
    pub fn new() -> Self {
        Self {
            reputations: Arc::new(RwLock::new(HashMap::new())),
            min_score_for_provider: 0.3,
            min_score_for_buyer: 0.2,
        }
    }

    /// Create with custom thresholds
    pub fn with_thresholds(min_provider: f64, min_buyer: f64) -> Self {
        Self {
            reputations: Arc::new(RwLock::new(HashMap::new())),
            min_score_for_provider: min_provider,
            min_score_for_buyer: min_buyer,
        }
    }

    /// Get or create reputation for an agent
    pub fn get_reputation(&self, agent_id: &str) -> AgentReputation {
        let reputations = self.reputations.read().unwrap();
        reputations.get(agent_id).cloned().unwrap_or_else(|| {
            drop(reputations);
            let rep = AgentReputation::new(agent_id.to_string());
            self.reputations.write().unwrap().insert(agent_id.to_string(), rep.clone());
            rep
        })
    }

    /// Record a transaction outcome
    pub fn record_transaction(&self, agent_id: &str, success: bool) -> Result<()> {
        let mut reputations = self.reputations.write().unwrap();
        let reputation = reputations
            .entry(agent_id.to_string())
            .or_insert_with(|| AgentReputation::new(agent_id.to_string()));

        reputation.record_transaction(success);
        Ok(())
    }

    /// Add a review for an agent
    pub fn add_review(&self, agent_id: &str, rating: f64) -> Result<()> {
        if rating < 0.0 || rating > 5.0 {
            return Err(ExchangeError::Reputation(
                "Rating must be between 0.0 and 5.0".to_string(),
            ));
        }

        let mut reputations = self.reputations.write().unwrap();
        let reputation = reputations
            .entry(agent_id.to_string())
            .or_insert_with(|| AgentReputation::new(agent_id.to_string()));

        reputation.add_review(rating);
        Ok(())
    }

    /// Check if agent can act as provider
    pub fn can_be_provider(&self, agent_id: &str) -> bool {
        let rep = self.get_reputation(agent_id);
        rep.meets_threshold(self.min_score_for_provider)
    }

    /// Check if agent can act as buyer
    pub fn can_be_buyer(&self, agent_id: &str) -> bool {
        let rep = self.get_reputation(agent_id);
        rep.meets_threshold(self.min_score_for_buyer)
    }

    /// Get top rated agents
    pub fn get_top_agents(&self, limit: usize) -> Vec<AgentReputation> {
        let reputations = self.reputations.read().unwrap();
        let mut agents: Vec<AgentReputation> = reputations.values().cloned().collect();
        agents.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
        agents.into_iter().take(limit).collect()
    }

    /// Get reputation statistics
    pub fn get_stats(&self) -> ReputationStats {
        let reputations = self.reputations.read().unwrap();

        let total_agents = reputations.len();
        let high_reputation = reputations.values().filter(|r| r.score >= 0.7).count();
        let low_reputation = reputations.values().filter(|r| r.score < 0.3).count();

        let total_transactions: u64 = reputations.values().map(|r| r.total_transactions).sum();
        let total_reviews: u64 = reputations.values().map(|r| r.total_reviews).sum();

        ReputationStats {
            total_agents,
            high_reputation_agents: high_reputation,
            low_reputation_agents: low_reputation,
            total_transactions,
            total_reviews,
        }
    }
}

impl Default for ReputationManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Reputation statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReputationStats {
    pub total_agents: usize,
    pub high_reputation_agents: usize,
    pub low_reputation_agents: usize,
    pub total_transactions: u64,
    pub total_reviews: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_agent_neutral_score() {
        let rep = AgentReputation::new("agent-001".to_string());
        assert_eq!(rep.score, 0.5);
        assert_eq!(rep.total_transactions, 0);
    }

    #[test]
    fn test_successful_transactions_increase_score() {
        let mut rep = AgentReputation::new("agent-001".to_string());

        // Record 10 successful transactions
        for _ in 0..10 {
            rep.record_transaction(true);
        }

        assert_eq!(rep.successful_transactions, 10);
        assert_eq!(rep.total_transactions, 10);
        assert!(rep.score > 0.5); // Should increase from neutral
    }

    #[test]
    fn test_failed_transactions_decrease_score() {
        let mut rep = AgentReputation::new("agent-001".to_string());

        // Record 10 failed transactions
        for _ in 0..10 {
            rep.record_transaction(false);
        }

        assert_eq!(rep.failed_transactions, 10);
        assert!(rep.score < 0.5); // Should decrease from neutral
    }

    #[test]
    fn test_mixed_transactions() {
        let mut rep = AgentReputation::new("agent-001".to_string());

        // 70% success rate
        for _ in 0..7 {
            rep.record_transaction(true);
        }
        for _ in 0..3 {
            rep.record_transaction(false);
        }

        assert_eq!(rep.successful_transactions, 7);
        assert_eq!(rep.failed_transactions, 3);
        assert!(rep.score > 0.5); // Above neutral with 70% success
    }

    #[test]
    fn test_review_ratings() {
        let mut rep = AgentReputation::new("agent-001".to_string());

        rep.add_review(5.0);
        rep.add_review(4.0);
        rep.add_review(5.0);

        assert_eq!(rep.total_reviews, 3);
        assert_eq!(rep.average_rating, (5.0 + 4.0 + 5.0) / 3.0);
    }

    #[test]
    fn test_reputation_threshold() {
        let mut rep = AgentReputation::new("agent-001".to_string());

        // Build up good reputation
        for _ in 0..20 {
            rep.record_transaction(true);
        }

        assert!(rep.meets_threshold(0.5));
        assert!(rep.meets_threshold(0.7));
    }

    #[test]
    fn test_reputation_manager() {
        let manager = ReputationManager::new();

        let rep = manager.get_reputation("agent-001");
        assert_eq!(rep.score, 0.5);
    }

    #[test]
    fn test_record_transaction_through_manager() {
        let manager = ReputationManager::new();

        manager.record_transaction("agent-001", true).unwrap();
        manager.record_transaction("agent-001", true).unwrap();
        manager.record_transaction("agent-001", false).unwrap();

        let rep = manager.get_reputation("agent-001");
        assert_eq!(rep.total_transactions, 3);
        assert_eq!(rep.successful_transactions, 2);
    }

    #[test]
    fn test_add_review_through_manager() {
        let manager = ReputationManager::new();

        manager.add_review("agent-001", 5.0).unwrap();
        manager.add_review("agent-001", 4.5).unwrap();

        let rep = manager.get_reputation("agent-001");
        assert_eq!(rep.total_reviews, 2);
    }

    #[test]
    fn test_invalid_review_rating() {
        let manager = ReputationManager::new();

        assert!(manager.add_review("agent-001", 6.0).is_err());
        assert!(manager.add_review("agent-001", -1.0).is_err());
    }

    #[test]
    fn test_can_be_provider() {
        let manager = ReputationManager::new();

        // New agent with neutral score (0.5) should pass 0.3 threshold
        assert!(manager.can_be_provider("agent-001"));

        // Build bad reputation
        for _ in 0..20 {
            manager.record_transaction("agent-002", false).unwrap();
        }
        assert!(!manager.can_be_provider("agent-002"));
    }

    #[test]
    fn test_top_agents() {
        let manager = ReputationManager::new();

        // Create agents with different scores using reviews to ensure different scores
        for _ in 0..10 {
            manager.record_transaction("agent-001", true).unwrap();
        }
        manager.add_review("agent-001", 5.0).unwrap(); // Highest score

        for _ in 0..5 {
            manager.record_transaction("agent-002", true).unwrap();
        }
        manager.add_review("agent-002", 4.0).unwrap(); // Middle score

        for _ in 0..2 {
            manager.record_transaction("agent-003", true).unwrap();
        }
        manager.add_review("agent-003", 3.0).unwrap(); // Lowest score

        let top = manager.get_top_agents(2);
        assert_eq!(top.len(), 2);
        // Verify the top agent has highest score
        assert!(top[0].score >= top[1].score);
        // Verify agent-001 is in the top 2
        assert!(top.iter().any(|a| a.agent_id == "agent-001"));
    }

    #[test]
    fn test_reputation_stats() {
        let manager = ReputationManager::new();

        manager.record_transaction("agent-001", true).unwrap();
        manager.record_transaction("agent-002", true).unwrap();
        manager.add_review("agent-001", 5.0).unwrap();

        let stats = manager.get_stats();
        assert_eq!(stats.total_agents, 2);
        assert_eq!(stats.total_transactions, 2);
        assert_eq!(stats.total_reviews, 1);
    }
}
