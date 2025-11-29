//! Byzantine behavior detection and reputation tracking
//!
//! Provides mechanisms to detect and penalize Byzantine (malicious) behavior
//! in the distributed consensus network, including:
//! - Equivocation detection (double-voting)
//! - Invalid signature tracking
//! - Reputation scoring
//! - Trust evaluation

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tracing::{warn, info};

/// Byzantine behavior detection and reputation management
#[derive(Debug, Clone)]
pub struct ByzantineDetector {
    /// Track signatures seen from each peer per vertex
    /// Map: peer_id -> vertex_id -> votes
    peer_votes: Arc<RwLock<HashMap<String, HashMap<String, Vec<Vec<u8>>>>>>,

    /// Reputation scores (0.0 = malicious, 1.0 = honest)
    reputation: Arc<RwLock<HashMap<String, f64>>>,

    /// Count of invalid signatures per peer
    invalid_sig_count: Arc<RwLock<HashMap<String, u32>>>,

    /// Count of equivocations per peer
    equivocation_count: Arc<RwLock<HashMap<String, u32>>>,
}

impl ByzantineDetector {
    /// Create a new Byzantine detector
    pub fn new() -> Self {
        Self {
            peer_votes: Arc::new(RwLock::new(HashMap::new())),
            reputation: Arc::new(RwLock::new(HashMap::new())),
            invalid_sig_count: Arc::new(RwLock::new(HashMap::new())),
            equivocation_count: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Check for double-voting (equivocation)
    ///
    /// Returns true if equivocation is detected (peer voted differently for same vertex)
    pub fn detect_equivocation(&self, peer_id: &str, vertex_id: &str, vote: &[u8]) -> bool {
        let mut votes = self.peer_votes.write().unwrap();

        let peer_votes = votes.entry(peer_id.to_string())
            .or_insert_with(HashMap::new);

        let vertex_votes = peer_votes.entry(vertex_id.to_string())
            .or_insert_with(Vec::new);

        // Check if peer already voted differently
        for existing_vote in vertex_votes.iter() {
            if existing_vote != vote {
                warn!("⚠️  Equivocation detected from peer {} on vertex {}", peer_id, vertex_id);

                // Record equivocation
                let mut equivocations = self.equivocation_count.write().unwrap();
                *equivocations.entry(peer_id.to_string()).or_insert(0) += 1;

                // Severely penalize reputation (halve it)
                self.reduce_reputation(peer_id, 0.5);
                return true;
            }
        }

        // Record this vote
        vertex_votes.push(vote.to_vec());
        false
    }

    /// Report invalid signature from a peer
    pub fn report_invalid_signature(&self, peer_id: String) {
        warn!("⚠️  Invalid signature detected from peer {}", peer_id);

        // Track invalid signature count
        let mut invalid_sigs = self.invalid_sig_count.write().unwrap();
        *invalid_sigs.entry(peer_id.clone()).or_insert(0) += 1;

        // Reduce reputation by 30%
        self.reduce_reputation(&peer_id, 0.7);
    }

    /// Reduce peer reputation by multiplying with factor
    pub fn reduce_reputation(&self, peer_id: &str, factor: f64) {
        let mut rep = self.reputation.write().unwrap();
        let current = rep.get(peer_id).copied().unwrap_or(1.0);
        let new_rep = (current * factor).max(0.0);
        rep.insert(peer_id.to_string(), new_rep);

        if new_rep < 0.3 {
            warn!("🚨 Peer {} marked as Byzantine (reputation: {:.2})", peer_id, new_rep);
        } else if new_rep < 0.5 {
            warn!("⚠️  Peer {} has low reputation: {:.2}", peer_id, new_rep);
        }
    }

    /// Increase peer reputation (reward good behavior)
    pub fn increase_reputation(&self, peer_id: &str, amount: f64) {
        let mut rep = self.reputation.write().unwrap();
        let current = rep.get(peer_id).copied().unwrap_or(1.0);
        let new_rep = (current + amount).min(1.0);
        rep.insert(peer_id.to_string(), new_rep);
    }

    /// Check if peer should be trusted
    ///
    /// Returns true if peer's reputation is above the trust threshold (0.5)
    pub fn is_trusted(&self, peer_id: &str) -> bool {
        let rep = self.reputation.read().unwrap();
        rep.get(peer_id).copied().unwrap_or(1.0) > 0.5
    }

    /// Get peer's current reputation score
    pub fn get_reputation(&self, peer_id: &str) -> f64 {
        let rep = self.reputation.read().unwrap();
        rep.get(peer_id).copied().unwrap_or(1.0)
    }

    /// Get Byzantine statistics for a peer
    pub fn get_peer_stats(&self, peer_id: &str) -> PeerStats {
        let invalid_sigs = self.invalid_sig_count.read().unwrap();
        let equivocations = self.equivocation_count.read().unwrap();
        let reputation = self.get_reputation(peer_id);

        PeerStats {
            peer_id: peer_id.to_string(),
            reputation,
            invalid_signatures: invalid_sigs.get(peer_id).copied().unwrap_or(0),
            equivocations: equivocations.get(peer_id).copied().unwrap_or(0),
            is_trusted: reputation > 0.5,
        }
    }

    /// Get all untrusted peers
    pub fn get_untrusted_peers(&self) -> Vec<String> {
        let rep = self.reputation.read().unwrap();
        rep.iter()
            .filter(|(_, &score)| score <= 0.5)
            .map(|(peer_id, _)| peer_id.clone())
            .collect()
    }

    /// Reset reputation for a peer (for testing or reconciliation)
    pub fn reset_peer(&self, peer_id: &str) {
        let mut rep = self.reputation.write().unwrap();
        rep.insert(peer_id.to_string(), 1.0);

        let mut invalid_sigs = self.invalid_sig_count.write().unwrap();
        invalid_sigs.remove(peer_id);

        let mut equivocations = self.equivocation_count.write().unwrap();
        equivocations.remove(peer_id);

        info!("Reset reputation for peer {}", peer_id);
    }

    /// Get total number of tracked peers
    pub fn peer_count(&self) -> usize {
        self.reputation.read().unwrap().len()
    }
}

impl Default for ByzantineDetector {
    fn default() -> Self {
        Self::new()
    }
}

/// Statistics for a peer's Byzantine behavior
#[derive(Debug, Clone)]
pub struct PeerStats {
    /// Peer identifier
    pub peer_id: String,
    /// Current reputation score (0.0 - 1.0)
    pub reputation: f64,
    /// Number of invalid signatures detected
    pub invalid_signatures: u32,
    /// Number of equivocations detected
    pub equivocations: u32,
    /// Whether peer is currently trusted
    pub is_trusted: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_byzantine_detector_creation() {
        let detector = ByzantineDetector::new();
        assert_eq!(detector.peer_count(), 0);
    }

    #[test]
    fn test_initial_reputation() {
        let detector = ByzantineDetector::new();

        // Unknown peers start with reputation 1.0
        assert_eq!(detector.get_reputation("peer1"), 1.0);
        assert!(detector.is_trusted("peer1"));
    }

    #[test]
    fn test_equivocation_detection() {
        let detector = ByzantineDetector::new();

        let vote1 = vec![1, 2, 3];
        let vote2 = vec![4, 5, 6];

        // First vote should not detect equivocation
        assert!(!detector.detect_equivocation("peer1", "vertex1", &vote1));

        // Same vote should not detect equivocation
        assert!(!detector.detect_equivocation("peer1", "vertex1", &vote1));

        // Different vote should detect equivocation
        assert!(detector.detect_equivocation("peer1", "vertex1", &vote2));

        // Reputation should be reduced
        assert!(detector.get_reputation("peer1") < 1.0);
        assert!(!detector.is_trusted("peer1")); // Should be below 0.5 threshold
    }

    #[test]
    fn test_invalid_signature_reporting() {
        let detector = ByzantineDetector::new();

        detector.report_invalid_signature("peer1".to_string());

        let stats = detector.get_peer_stats("peer1");
        assert_eq!(stats.invalid_signatures, 1);
        assert!(stats.reputation < 1.0);
    }

    #[test]
    fn test_multiple_invalid_signatures() {
        let detector = ByzantineDetector::new();

        // Report multiple invalid signatures
        for _ in 0..3 {
            detector.report_invalid_signature("peer1".to_string());
        }

        let stats = detector.get_peer_stats("peer1");
        assert_eq!(stats.invalid_signatures, 3);

        // Reputation should be very low (0.7^3 ≈ 0.34)
        assert!(stats.reputation < 0.4);
        assert!(!stats.is_trusted);
    }

    #[test]
    fn test_reputation_reduction() {
        let detector = ByzantineDetector::new();

        // Start with full reputation
        assert_eq!(detector.get_reputation("peer1"), 1.0);

        // Reduce by 50%
        detector.reduce_reputation("peer1", 0.5);
        assert_eq!(detector.get_reputation("peer1"), 0.5);

        // Reduce again by 50%
        detector.reduce_reputation("peer1", 0.5);
        assert_eq!(detector.get_reputation("peer1"), 0.25);

        // Should not be trusted
        assert!(!detector.is_trusted("peer1"));
    }

    #[test]
    fn test_reputation_increase() {
        let detector = ByzantineDetector::new();

        // Reduce reputation first
        detector.reduce_reputation("peer1", 0.5);
        assert_eq!(detector.get_reputation("peer1"), 0.5);

        // Increase reputation
        detector.increase_reputation("peer1", 0.3);
        assert_eq!(detector.get_reputation("peer1"), 0.8);
        assert!(detector.is_trusted("peer1"));

        // Should cap at 1.0
        detector.increase_reputation("peer1", 0.5);
        assert_eq!(detector.get_reputation("peer1"), 1.0);
    }

    #[test]
    fn test_untrusted_peers_list() {
        let detector = ByzantineDetector::new();

        // Add some peers with varying reputations
        detector.reduce_reputation("peer1", 0.3); // 0.3 - untrusted
        detector.reduce_reputation("peer2", 0.8); // 0.8 - trusted
        detector.reduce_reputation("peer3", 0.4); // 0.4 - untrusted

        let untrusted = detector.get_untrusted_peers();
        assert_eq!(untrusted.len(), 2);
        assert!(untrusted.contains(&"peer1".to_string()));
        assert!(untrusted.contains(&"peer3".to_string()));
    }

    #[test]
    fn test_peer_stats() {
        let detector = ByzantineDetector::new();

        detector.report_invalid_signature("peer1".to_string());
        detector.detect_equivocation("peer1", "vertex1", &[1, 2, 3]);
        detector.detect_equivocation("peer1", "vertex1", &[4, 5, 6]);

        let stats = detector.get_peer_stats("peer1");
        assert_eq!(stats.peer_id, "peer1");
        assert_eq!(stats.invalid_signatures, 1);
        assert_eq!(stats.equivocations, 1);
        assert!(!stats.is_trusted);
    }

    #[test]
    fn test_peer_reset() {
        let detector = ByzantineDetector::new();

        // Damage reputation
        detector.report_invalid_signature("peer1".to_string());
        detector.detect_equivocation("peer1", "vertex1", &[1, 2, 3]);
        detector.detect_equivocation("peer1", "vertex1", &[4, 5, 6]);

        assert!(!detector.is_trusted("peer1"));

        // Reset
        detector.reset_peer("peer1");

        let stats = detector.get_peer_stats("peer1");
        assert_eq!(stats.reputation, 1.0);
        assert_eq!(stats.invalid_signatures, 0);
        assert_eq!(stats.equivocations, 0);
        assert!(stats.is_trusted);
    }

    #[test]
    fn test_multiple_vertices_equivocation() {
        let detector = ByzantineDetector::new();

        // Honest behavior on vertex1
        detector.detect_equivocation("peer1", "vertex1", &[1, 2, 3]);
        detector.detect_equivocation("peer1", "vertex1", &[1, 2, 3]);
        assert!(detector.is_trusted("peer1"));

        // Byzantine behavior on vertex2
        detector.detect_equivocation("peer1", "vertex2", &[1, 2, 3]);
        detector.detect_equivocation("peer1", "vertex2", &[4, 5, 6]);
        assert!(!detector.is_trusted("peer1"));
    }
}
