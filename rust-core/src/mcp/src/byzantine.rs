//! Byzantine Fault Detection
//!
//! Detects and mitigates Byzantine faults (malicious or faulty agents) in the MCP network.
//! Tracks equivocation, invalid signatures, and reputation scores.

use crate::error::{McpError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Byzantine fault types
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ByzantineFault {
    /// Agent sent conflicting messages (equivocation)
    Equivocation {
        message1_hash: Vec<u8>,
        message2_hash: Vec<u8>,
    },
    /// Invalid signature verification
    InvalidSignature { message_hash: Vec<u8> },
    /// Replay attack attempt
    ReplayAttempt { nonce: String },
    /// Unauthorized action attempt
    UnauthorizedAction { action: String },
    /// Malformed message
    MalformedMessage { error: String },
}

/// Agent reputation score
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReputationScore {
    /// Agent ID
    pub agent_id: String,
    /// Current reputation (0.0 = untrusted, 1.0 = fully trusted)
    pub score: f64,
    /// Total messages sent
    pub total_messages: u64,
    /// Number of faults detected
    pub fault_count: u64,
    /// Last update timestamp
    pub last_update: i64,
    /// Is agent banned?
    pub banned: bool,
}

impl ReputationScore {
    /// Create initial reputation for new agent
    pub fn new(agent_id: String) -> Self {
        Self {
            agent_id,
            score: 0.5, // Start with neutral reputation
            total_messages: 0,
            fault_count: 0,
            last_update: chrono::Utc::now().timestamp(),
            banned: false,
        }
    }

    /// Record successful message
    pub fn record_success(&mut self) {
        self.total_messages += 1;

        // Increase reputation gradually
        self.score = (self.score + 0.01).min(1.0);
        self.last_update = chrono::Utc::now().timestamp();
    }

    /// Record Byzantine fault
    pub fn record_fault(&mut self, severity: f64) {
        self.fault_count += 1;

        // Decrease reputation based on severity (0.0-1.0)
        self.score = (self.score - severity).max(0.0);
        self.last_update = chrono::Utc::now().timestamp();

        // Auto-ban if reputation drops below threshold
        if self.score < 0.1 {
            self.banned = true;
        }
    }

    /// Check if agent is trustworthy (reputation >= 0.5)
    pub fn is_trusted(&self) -> bool {
        !self.banned && self.score >= 0.5
    }
}

/// Byzantine fault detector
pub struct ByzantineDetector {
    /// Agent reputations
    reputations: Arc<RwLock<HashMap<String, ReputationScore>>>,
    /// Detected faults (agent_id -> faults)
    faults: Arc<RwLock<HashMap<String, Vec<ByzantineFault>>>>,
    /// Message hashes for equivocation detection (agent_id:nonce -> hash)
    message_hashes: Arc<RwLock<HashMap<String, Vec<u8>>>>,
    /// Reputation threshold for trust (default: 0.5)
    trust_threshold: f64,
    /// Ban threshold (default: 0.1)
    ban_threshold: f64,
}

impl ByzantineDetector {
    /// Create a new Byzantine fault detector
    pub fn new() -> Self {
        Self {
            reputations: Arc::new(RwLock::new(HashMap::new())),
            faults: Arc::new(RwLock::new(HashMap::new())),
            message_hashes: Arc::new(RwLock::new(HashMap::new())),
            trust_threshold: 0.5,
            ban_threshold: 0.1,
        }
    }

    /// Create with custom thresholds
    pub fn with_thresholds(trust_threshold: f64, ban_threshold: f64) -> Self {
        Self {
            reputations: Arc::new(RwLock::new(HashMap::new())),
            faults: Arc::new(RwLock::new(HashMap::new())),
            message_hashes: Arc::new(RwLock::new(HashMap::new())),
            trust_threshold,
            ban_threshold,
        }
    }

    /// Get or create reputation for agent
    async fn get_or_create_reputation(&self, agent_id: &str) -> ReputationScore {
        let mut reputations = self.reputations.write().await;

        reputations
            .entry(agent_id.to_string())
            .or_insert_with(|| ReputationScore::new(agent_id.to_string()))
            .clone()
    }

    /// Record successful message from agent
    pub async fn record_success(&self, agent_id: &str) -> Result<()> {
        let mut reputations = self.reputations.write().await;

        let reputation = reputations
            .entry(agent_id.to_string())
            .or_insert_with(|| ReputationScore::new(agent_id.to_string()));

        reputation.record_success();
        Ok(())
    }

    /// Record Byzantine fault
    pub async fn record_fault(
        &self,
        agent_id: &str,
        fault: ByzantineFault,
    ) -> Result<()> {
        // Determine severity based on fault type
        let severity = match &fault {
            ByzantineFault::Equivocation { .. } => 0.3, // Serious
            ByzantineFault::InvalidSignature { .. } => 0.2,
            ByzantineFault::ReplayAttempt { .. } => 0.15,
            ByzantineFault::UnauthorizedAction { .. } => 0.1,
            ByzantineFault::MalformedMessage { .. } => 0.05, // Minor
        };

        // Update reputation
        {
            let mut reputations = self.reputations.write().await;
            let reputation = reputations
                .entry(agent_id.to_string())
                .or_insert_with(|| ReputationScore::new(agent_id.to_string()));

            reputation.record_fault(severity);
        }

        // Record fault
        {
            let mut faults = self.faults.write().await;
            faults
                .entry(agent_id.to_string())
                .or_insert_with(Vec::new)
                .push(fault);
        }

        Ok(())
    }

    /// Check for equivocation (conflicting messages with same nonce)
    pub async fn check_equivocation(
        &self,
        agent_id: &str,
        nonce: &str,
        message_hash: Vec<u8>,
    ) -> Result<bool> {
        let key = format!("{}:{}", agent_id, nonce);
        let mut hashes = self.message_hashes.write().await;

        if let Some(existing_hash) = hashes.get(&key) {
            if existing_hash != &message_hash {
                // Equivocation detected!
                self.record_fault(
                    agent_id,
                    ByzantineFault::Equivocation {
                        message1_hash: existing_hash.clone(),
                        message2_hash: message_hash.clone(),
                    },
                )
                .await?;

                return Ok(true);
            }
        } else {
            // Record this message hash
            hashes.insert(key, message_hash);
        }

        Ok(false)
    }

    /// Check if agent is trusted
    pub async fn is_trusted(&self, agent_id: &str) -> bool {
        let reputation = self.get_or_create_reputation(agent_id).await;
        reputation.is_trusted()
    }

    /// Check if agent is banned
    pub async fn is_banned(&self, agent_id: &str) -> bool {
        let reputation = self.get_or_create_reputation(agent_id).await;
        reputation.banned
    }

    /// Get agent reputation
    pub async fn get_reputation(&self, agent_id: &str) -> Option<ReputationScore> {
        let reputations = self.reputations.read().await;
        reputations.get(agent_id).cloned()
    }

    /// Get all agent reputations
    pub async fn list_reputations(&self) -> Vec<ReputationScore> {
        let reputations = self.reputations.read().await;
        reputations.values().cloned().collect()
    }

    /// Get faults for agent
    pub async fn get_faults(&self, agent_id: &str) -> Vec<ByzantineFault> {
        let faults = self.faults.read().await;
        faults.get(agent_id).cloned().unwrap_or_default()
    }

    /// Ban agent manually
    pub async fn ban_agent(&self, agent_id: &str) -> Result<()> {
        let mut reputations = self.reputations.write().await;

        let reputation = reputations
            .entry(agent_id.to_string())
            .or_insert_with(|| ReputationScore::new(agent_id.to_string()));

        reputation.banned = true;
        reputation.score = 0.0;

        Ok(())
    }

    /// Unban agent manually
    pub async fn unban_agent(&self, agent_id: &str) -> Result<()> {
        let mut reputations = self.reputations.write().await;

        if let Some(reputation) = reputations.get_mut(agent_id) {
            reputation.banned = false;
            reputation.score = 0.5; // Reset to neutral
        }

        Ok(())
    }

    /// Clean up old message hashes (beyond replay window)
    pub async fn cleanup_old_hashes(&self, max_age: i64) -> usize {
        let mut hashes = self.message_hashes.write().await;
        let before = hashes.len();

        // In production, we'd track timestamps for each hash
        // For now, just limit total hash count
        const MAX_HASHES: usize = 10000;

        if hashes.len() > MAX_HASHES {
            hashes.clear(); // Simple cleanup strategy
        }

        before - hashes.len()
    }
}

impl Default for ByzantineDetector {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_initial_reputation() {
        let detector = ByzantineDetector::new();

        let reputation = detector.get_or_create_reputation("agent-1").await;
        assert_eq!(reputation.score, 0.5);
        assert_eq!(reputation.fault_count, 0);
        assert!(!reputation.banned);
    }

    #[tokio::test]
    async fn test_record_success() {
        let detector = ByzantineDetector::new();

        detector.record_success("agent-1").await.unwrap();

        let reputation = detector.get_reputation("agent-1").await.unwrap();
        assert!(reputation.score > 0.5);
        assert_eq!(reputation.total_messages, 1);
    }

    #[tokio::test]
    async fn test_record_fault() {
        let detector = ByzantineDetector::new();

        detector
            .record_fault(
                "agent-1",
                ByzantineFault::InvalidSignature {
                    message_hash: vec![1, 2, 3],
                },
            )
            .await
            .unwrap();

        let reputation = detector.get_reputation("agent-1").await.unwrap();
        assert!(reputation.score < 0.5);
        assert_eq!(reputation.fault_count, 1);

        let faults = detector.get_faults("agent-1").await;
        assert_eq!(faults.len(), 1);
    }

    #[tokio::test]
    async fn test_equivocation_detection() {
        let detector = ByzantineDetector::new();

        let hash1 = vec![1, 2, 3];
        let hash2 = vec![4, 5, 6];

        // First message - no equivocation
        let eq1 = detector
            .check_equivocation("agent-1", "nonce-1", hash1.clone())
            .await
            .unwrap();
        assert!(!eq1);

        // Same message again - no equivocation
        let eq2 = detector
            .check_equivocation("agent-1", "nonce-1", hash1.clone())
            .await
            .unwrap();
        assert!(!eq2);

        // Different message with same nonce - equivocation!
        let eq3 = detector
            .check_equivocation("agent-1", "nonce-1", hash2)
            .await
            .unwrap();
        assert!(eq3);

        let faults = detector.get_faults("agent-1").await;
        assert_eq!(faults.len(), 1);
        assert!(matches!(faults[0], ByzantineFault::Equivocation { .. }));
    }

    #[tokio::test]
    async fn test_trust_threshold() {
        let detector = ByzantineDetector::new();

        // New agent starts neutral
        assert!(detector.is_trusted("agent-1").await);

        // Record multiple faults
        for _ in 0..5 {
            detector
                .record_fault(
                    "agent-1",
                    ByzantineFault::InvalidSignature {
                        message_hash: vec![1, 2, 3],
                    },
                )
                .await
                .unwrap();
        }

        // Should no longer be trusted
        assert!(!detector.is_trusted("agent-1").await);
    }

    #[tokio::test]
    async fn test_auto_ban() {
        let detector = ByzantineDetector::new();

        // Record severe faults
        for _ in 0..5 {
            detector
                .record_fault(
                    "agent-1",
                    ByzantineFault::Equivocation {
                        message1_hash: vec![1, 2, 3],
                        message2_hash: vec![4, 5, 6],
                    },
                )
                .await
                .unwrap();
        }

        // Should be auto-banned
        assert!(detector.is_banned("agent-1").await);
    }

    #[tokio::test]
    async fn test_manual_ban_unban() {
        let detector = ByzantineDetector::new();

        // Ban agent
        detector.ban_agent("agent-1").await.unwrap();
        assert!(detector.is_banned("agent-1").await);

        // Unban agent
        detector.unban_agent("agent-1").await.unwrap();
        assert!(!detector.is_banned("agent-1").await);

        let reputation = detector.get_reputation("agent-1").await.unwrap();
        assert_eq!(reputation.score, 0.5); // Reset to neutral
    }

    #[tokio::test]
    async fn test_list_reputations() {
        let detector = ByzantineDetector::new();

        detector.record_success("agent-1").await.unwrap();
        detector.record_success("agent-2").await.unwrap();
        detector.record_success("agent-3").await.unwrap();

        let reputations = detector.list_reputations().await;
        assert_eq!(reputations.len(), 3);
    }
}
