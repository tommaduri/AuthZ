//! ML-DSA-87 Multi-Signature Aggregation for CretoAI
//!
//! Implements threshold signature scheme using post-quantum ML-DSA-87
//! (Module-Lattice Digital Signature Algorithm, formerly Dilithium).
//!
//! ## Features
//!
//! - **Signature Aggregation**: Combine multiple signatures into compact proof
//! - **Threshold Validation**: Verify t-of-n signature schemes
//! - **Partial Signatures**: Support incremental signature collection
//! - **Byzantine Safety**: Detect and reject invalid partial signatures

use crate::{NodeId, Result, ConsensusError};
use cretoai_crypto::signatures::{SignatureScheme, ML_DSA_87, Signature, PublicKey};
use dashmap::DashMap;
use parking_lot::RwLock;
use prometheus::{register_counter, register_histogram, Counter, Histogram};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Instant;
use tracing::{debug, info, warn, error};

/// Maximum size for aggregated signature (bytes)
pub const MAX_AGGREGATED_SIGNATURE_SIZE: usize = 1024 * 100; // 100 KB

/// Partial signature from a single node
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartialSignature {
    /// Node that created this signature
    pub node_id: NodeId,

    /// ML-DSA-87 signature bytes
    pub signature: Vec<u8>,

    /// Public key for verification
    pub public_key: Vec<u8>,

    /// Timestamp of signature creation
    pub timestamp: i64,
}

/// Aggregated multi-signature
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AggregatedSignature {
    /// Message that was signed
    pub message_hash: Vec<u8>,

    /// Individual signatures from nodes
    pub signatures: Vec<PartialSignature>,

    /// Bitmap of participating nodes
    pub signers: HashSet<NodeId>,

    /// Total weight of signers (if using weighted voting)
    pub total_weight: f64,

    /// Timestamp of aggregation
    pub aggregated_at: i64,
}

impl AggregatedSignature {
    /// Create new empty aggregated signature
    pub fn new(message_hash: Vec<u8>) -> Self {
        Self {
            message_hash,
            signatures: Vec::new(),
            signers: HashSet::new(),
            total_weight: 0.0,
            aggregated_at: chrono::Utc::now().timestamp(),
        }
    }

    /// Add a partial signature
    pub fn add_signature(&mut self, sig: PartialSignature, weight: f64) -> Result<()> {
        if self.signers.contains(&sig.node_id) {
            return Err(ConsensusError::DuplicateSignature(sig.node_id));
        }

        self.signers.insert(sig.node_id);
        self.signatures.push(sig);
        self.total_weight += weight;

        Ok(())
    }

    /// Get number of signatures
    pub fn signature_count(&self) -> usize {
        self.signatures.len()
    }

    /// Check if threshold is met
    pub fn meets_threshold(&self, threshold: f64) -> bool {
        self.total_weight >= threshold
    }

    /// Serialize to bytes (for network transmission)
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        bincode::serialize(self)
            .map_err(|e| ConsensusError::Serialization(e.to_string()))
    }

    /// Deserialize from bytes
    pub fn from_bytes(data: &[u8]) -> Result<Self> {
        bincode::deserialize(data)
            .map_err(|e| ConsensusError::Serialization(e.to_string()))
    }
}

/// Multi-signature manager configuration
#[derive(Debug, Clone)]
pub struct MultiSigConfig {
    /// Signature scheme to use
    pub scheme: String,

    /// Threshold for acceptance (weighted sum)
    pub threshold: f64,

    /// Maximum age for partial signatures (seconds)
    pub max_signature_age_secs: i64,

    /// Maximum signatures to store per message
    pub max_signatures_per_message: usize,
}

impl Default for MultiSigConfig {
    fn default() -> Self {
        Self {
            scheme: "ml-dsa-87".to_string(),
            threshold: 0.67,
            max_signature_age_secs: 300, // 5 minutes
            max_signatures_per_message: 1000,
        }
    }
}

/// Multi-signature manager
pub struct MultiSignatureManager {
    /// Configuration
    config: MultiSigConfig,

    /// ML-DSA-87 signature scheme
    scheme: Arc<ML_DSA_87>,

    /// Active signature collections (message_hash -> AggregatedSignature)
    collections: Arc<DashMap<Vec<u8>, AggregatedSignature>>,

    /// Node public keys (NodeId -> PublicKey)
    public_keys: Arc<DashMap<NodeId, PublicKey>>,

    /// Node vote weights (NodeId -> weight)
    weights: Arc<DashMap<NodeId, f64>>,

    /// Metrics
    metrics: Arc<MultiSigMetrics>,
}

/// Prometheus metrics
struct MultiSigMetrics {
    /// Total signatures collected
    signatures_collected: Counter,

    /// Signatures rejected (invalid)
    signatures_rejected: Counter,

    /// Signature aggregations completed
    aggregations_completed: Counter,

    /// Signature verification time
    verification_duration: Histogram,

    /// Aggregation time
    aggregation_duration: Histogram,
}

impl MultiSigMetrics {
    fn new() -> Result<Self> {
        Ok(Self {
            signatures_collected: register_counter!(
                "multisig_signatures_collected_total",
                "Total partial signatures collected"
            )?,
            signatures_rejected: register_counter!(
                "multisig_signatures_rejected_total",
                "Total signatures rejected as invalid"
            )?,
            aggregations_completed: register_counter!(
                "multisig_aggregations_completed_total",
                "Total signature aggregations completed"
            )?,
            verification_duration: register_histogram!(
                "multisig_verification_duration_seconds",
                "Time to verify a partial signature"
            )?,
            aggregation_duration: register_histogram!(
                "multisig_aggregation_duration_seconds",
                "Time to aggregate signatures"
            )?,
        })
    }
}

impl MultiSignatureManager {
    /// Create new multi-signature manager
    pub fn new(config: MultiSigConfig) -> Result<Self> {
        let scheme = Arc::new(ML_DSA_87::new());

        Ok(Self {
            config,
            scheme,
            collections: Arc::new(DashMap::new()),
            public_keys: Arc::new(DashMap::new()),
            weights: Arc::new(DashMap::new()),
            metrics: Arc::new(MultiSigMetrics::new()?),
        })
    }

    /// Register a node's public key
    pub fn register_public_key(&self, node_id: NodeId, public_key: PublicKey) {
        self.public_keys.insert(node_id, public_key);
        debug!("Registered public key for node {}", node_id);
    }

    /// Set node's vote weight
    pub fn set_node_weight(&self, node_id: NodeId, weight: f64) {
        self.weights.insert(node_id, weight);
        debug!("Set weight {} for node {}", weight, node_id);
    }

    /// Add a partial signature to the collection
    pub fn add_partial_signature(
        &self,
        message_hash: Vec<u8>,
        partial_sig: PartialSignature,
    ) -> Result<bool> {
        let start = Instant::now();

        // Check signature age
        let age = chrono::Utc::now().timestamp() - partial_sig.timestamp;
        if age > self.config.max_signature_age_secs {
            warn!("Rejecting stale signature from node {} (age: {}s)",
                  partial_sig.node_id, age);
            self.metrics.signatures_rejected.inc();
            return Err(ConsensusError::StaleSignature);
        }

        // Verify signature
        if !self.verify_partial_signature(&message_hash, &partial_sig)? {
            warn!("Invalid signature from node {}", partial_sig.node_id);
            self.metrics.signatures_rejected.inc();
            return Err(ConsensusError::InvalidSignature {
                node_id: partial_sig.node_id,
            });
        }

        self.metrics.verification_duration.observe(start.elapsed().as_secs_f64());

        // Get node weight
        let weight = self.weights.get(&partial_sig.node_id)
            .map(|w| *w.value())
            .unwrap_or(1.0);

        // Add to collection
        let mut collection = self.collections
            .entry(message_hash.clone())
            .or_insert_with(|| AggregatedSignature::new(message_hash.clone()));

        collection.add_signature(partial_sig.clone(), weight)?;

        let threshold_met = collection.meets_threshold(self.config.threshold);

        if threshold_met {
            info!("Threshold met for message: {}/{} signatures, weight: {:.2}",
                  collection.signature_count(),
                  self.weights.len(),
                  collection.total_weight);
        }

        self.metrics.signatures_collected.inc();

        Ok(threshold_met)
    }

    /// Verify a partial signature
    fn verify_partial_signature(
        &self,
        message_hash: &[u8],
        partial_sig: &PartialSignature,
    ) -> Result<bool> {
        // Get public key
        let public_key = self.public_keys.get(&partial_sig.node_id)
            .ok_or_else(|| ConsensusError::UnknownNode(partial_sig.node_id))?;

        // Verify using ML-DSA-87
        // Signature is just a Vec<u8> type alias
        let signature = &partial_sig.signature;

        match self.scheme.verify(&public_key, message_hash, signature) {
            Ok(valid) => Ok(valid),
            Err(e) => {
                error!("Signature verification error: {}", e);
                Ok(false)
            }
        }
    }

    /// Get aggregated signature if threshold is met
    pub fn get_aggregated_signature(&self, message_hash: &[u8]) -> Option<AggregatedSignature> {
        self.collections
            .get(message_hash)
            .filter(|sig| sig.meets_threshold(self.config.threshold))
            .map(|sig| sig.clone())
    }

    /// Complete aggregation and remove from active collections
    pub fn finalize_aggregation(&self, message_hash: &[u8]) -> Result<AggregatedSignature> {
        let start = Instant::now();

        let (_, sig) = self.collections.remove(message_hash)
            .ok_or_else(|| ConsensusError::NoSignatureCollection)?;

        if !sig.meets_threshold(self.config.threshold) {
            return Err(ConsensusError::InsufficientSignatures {
                have: sig.total_weight,
                need: self.config.threshold,
            });
        }

        self.metrics.aggregation_duration.observe(start.elapsed().as_secs_f64());
        self.metrics.aggregations_completed.inc();

        info!("Finalized aggregation: {} signatures, weight: {:.2}",
              sig.signature_count(), sig.total_weight);

        Ok(sig)
    }

    /// Verify an aggregated signature
    pub fn verify_aggregated_signature(&self, agg_sig: &AggregatedSignature) -> Result<bool> {
        let start = Instant::now();

        // Verify each partial signature
        for partial in &agg_sig.signatures {
            if !self.verify_partial_signature(&agg_sig.message_hash, partial)? {
                warn!("Invalid partial signature from node {} in aggregated sig",
                      partial.node_id);
                return Ok(false);
            }
        }

        // Verify threshold
        if !agg_sig.meets_threshold(self.config.threshold) {
            warn!("Aggregated signature doesn't meet threshold: {} < {}",
                  agg_sig.total_weight, self.config.threshold);
            return Ok(false);
        }

        self.metrics.verification_duration.observe(start.elapsed().as_secs_f64());

        Ok(true)
    }

    /// Get collection status
    pub fn get_collection_status(&self, message_hash: &[u8]) -> Option<CollectionStatus> {
        self.collections.get(message_hash).map(|sig| {
            CollectionStatus {
                signature_count: sig.signature_count(),
                total_weight: sig.total_weight,
                threshold: self.config.threshold,
                threshold_met: sig.meets_threshold(self.config.threshold),
                signers: sig.signers.clone(),
            }
        })
    }

    /// Clean up old signature collections
    pub fn cleanup_old_collections(&self) {
        let cutoff = chrono::Utc::now().timestamp() - self.config.max_signature_age_secs;

        self.collections.retain(|_, sig| sig.aggregated_at > cutoff);

        debug!("Cleaned up old signature collections");
    }

    /// Get statistics
    pub fn get_stats(&self) -> MultiSigStats {
        MultiSigStats {
            active_collections: self.collections.len(),
            registered_nodes: self.public_keys.len(),
            total_signatures_collected: self.metrics.signatures_collected.get() as u64,
            total_signatures_rejected: self.metrics.signatures_rejected.get() as u64,
            total_aggregations: self.metrics.aggregations_completed.get() as u64,
        }
    }
}

/// Collection status for a message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionStatus {
    pub signature_count: usize,
    pub total_weight: f64,
    pub threshold: f64,
    pub threshold_met: bool,
    pub signers: HashSet<NodeId>,
}

/// Multi-signature statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiSigStats {
    pub active_collections: usize,
    pub registered_nodes: usize,
    pub total_signatures_collected: u64,
    pub total_signatures_rejected: u64,
    pub total_aggregations: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_aggregated_signature_basic() {
        let mut agg = AggregatedSignature::new(vec![1, 2, 3, 4]);

        assert_eq!(agg.signature_count(), 0);
        assert!(!agg.meets_threshold(0.67));

        let partial = PartialSignature {
            node_id: NodeId::new_v4(),
            signature: vec![0; 64],
            public_key: vec![0; 32],
            timestamp: chrono::Utc::now().timestamp(),
        };

        agg.add_signature(partial, 0.5).unwrap();
        assert_eq!(agg.signature_count(), 1);
        assert!(!agg.meets_threshold(0.67));

        let partial2 = PartialSignature {
            node_id: NodeId::new_v4(),
            signature: vec![0; 64],
            public_key: vec![0; 32],
            timestamp: chrono::Utc::now().timestamp(),
        };

        agg.add_signature(partial2, 0.3).unwrap();
        assert_eq!(agg.signature_count(), 2);
        assert!(agg.meets_threshold(0.67));
    }

    #[test]
    fn test_duplicate_signature() {
        let mut agg = AggregatedSignature::new(vec![1, 2, 3, 4]);
        let node_id = NodeId::new_v4();

        let partial = PartialSignature {
            node_id,
            signature: vec![0; 64],
            public_key: vec![0; 32],
            timestamp: chrono::Utc::now().timestamp(),
        };

        agg.add_signature(partial.clone(), 0.5).unwrap();

        // Duplicate should fail
        let result = agg.add_signature(partial, 0.5);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_multisig_manager() {
        let config = MultiSigConfig::default();
        let manager = MultiSignatureManager::new(config).unwrap();

        // Register nodes with keys
        let (keypair1, _) = manager.scheme.generate_keypair().unwrap();
        let (keypair2, _) = manager.scheme.generate_keypair().unwrap();

        let node1 = NodeId::new_v4();
        let node2 = NodeId::new_v4();

        manager.register_public_key(node1, keypair1.public_key.clone());
        manager.register_public_key(node2, keypair2.public_key.clone());

        manager.set_node_weight(node1, 0.5);
        manager.set_node_weight(node2, 0.5);

        let message = b"test message";
        let message_hash = blake3::hash(message).as_bytes().to_vec();

        // Create signatures
        let sig1 = manager.scheme.sign(message, &keypair1).unwrap();
        let partial1 = PartialSignature {
            node_id: node1,
            signature: sig1.bytes.clone(),
            public_key: keypair1.public_key.to_bytes(),
            timestamp: chrono::Utc::now().timestamp(),
        };

        // Add first signature
        let threshold_met = manager
            .add_partial_signature(message_hash.clone(), partial1)
            .unwrap();

        assert!(!threshold_met); // 0.5 < 0.67

        // Add second signature
        let sig2 = manager.scheme.sign(message, &keypair2).unwrap();
        let partial2 = PartialSignature {
            node_id: node2,
            signature: sig2.bytes.clone(),
            public_key: keypair2.public_key.to_bytes(),
            timestamp: chrono::Utc::now().timestamp(),
        };

        let threshold_met = manager
            .add_partial_signature(message_hash.clone(), partial2)
            .unwrap();

        assert!(threshold_met); // 1.0 >= 0.67

        // Finalize
        let agg_sig = manager.finalize_aggregation(&message_hash).unwrap();
        assert_eq!(agg_sig.signature_count(), 2);
        assert!(agg_sig.meets_threshold(0.67));
    }
}
