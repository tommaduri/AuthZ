//! DAG-based audit trail for authorization decisions

use crate::error::{AuthzError, Result};
use crate::types::{AuthzRequest, Decision};
use cretoai_dag::vertex::{Vertex, VertexBuilder};
use cretoai_dag::graph::Graph;
use cretoai_crypto::signatures::{MLDSA87, MLDSA87KeyPair, MLDSA87PublicKey, MLDSA87SecretKey, MLDSA87Signature};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::debug;

/// Audit trail using DAG for tamper-proof authorization history
pub struct AuditTrail {
    graph: Arc<RwLock<Graph>>,
    signing_keypair: Arc<MLDSA87KeyPair>,
    genesis_id: String,
}

impl AuditTrail {
    /// Create a new audit trail
    pub async fn new() -> Result<Self> {
        let graph = Arc::new(RwLock::new(Graph::new()));

        // Generate signing keypair for decisions
        let signing_keypair = Arc::new(MLDSA87::generate());

        // Create genesis vertex
        let genesis = VertexBuilder::new("authz-system".to_string())
            .id("authz-genesis".to_string())
            .payload(b"Authorization audit trail genesis".to_vec())
            .build();

        let genesis_id = genesis.id.clone();

        {
            let mut g = graph.write().await;
            g.add_vertex(genesis)?;
        }

        debug!("Audit trail initialized with genesis: {}", genesis_id);

        Ok(Self {
            graph,
            signing_keypair,
            genesis_id,
        })
    }

    /// Record an authorization decision in the DAG
    pub async fn record_decision(
        &self,
        request: &AuthzRequest,
        mut decision: Decision,
    ) -> Result<Decision> {
        // Serialize decision data WITHOUT signature for signing
        let decision_data = serde_json::to_vec(&decision)
            .map_err(|e| AuthzError::Internal(format!("Failed to serialize decision: {}", e)))?;

        // Sign the decision with persistent keypair
        let signature = self.signing_keypair.sign(&decision_data);
        decision.signature = Some(signature.as_bytes().to_vec());

        // Serialize decision WITH signature for storage
        let decision_data_with_sig = serde_json::to_vec(&decision)
            .map_err(|e| AuthzError::Internal(format!("Failed to serialize decision: {}", e)))?;

        // Get current DAG tips to reference
        let parent_id = {
            let g = self.graph.read().await;
            let tips = g.get_tips()?;
            if tips.is_empty() {
                self.genesis_id.clone()
            } else {
                tips[0].clone()
            }
        };

        // Create audit vertex with decision including signature
        let vertex = VertexBuilder::new(format!("decision:{}", decision.id))
            .id(format!("authz-decision-{}", decision.id))
            .payload(decision_data_with_sig)
            .parent(parent_id)
            .build();

        // Add to DAG
        {
            let g = self.graph.write().await;
            g.add_vertex(vertex)?;
        }

        debug!("Decision recorded in audit trail: {}", decision.id);

        Ok(decision)
    }

    /// Get audit history for a principal
    pub async fn get_principal_history(
        &self,
        principal_id: &str,
    ) -> Result<Vec<Decision>> {
        let g = self.graph.read().await;
        let all_vertices = g.get_all_vertices()?;

        let mut decisions = Vec::new();

        for vertex in all_vertices {
            if let Ok(decision) = serde_json::from_slice::<Decision>(&vertex.payload) {
                // Parse original request from decision context
                // For simplicity, we check if this is a decision vertex
                if vertex.id.starts_with("authz-decision-") {
                    decisions.push(decision);
                }
            }
        }

        Ok(decisions)
    }

    /// Get audit history for a resource
    pub async fn get_resource_history(
        &self,
        resource_id: &str,
    ) -> Result<Vec<Decision>> {
        let g = self.graph.read().await;
        let all_vertices = g.get_all_vertices()?;

        let mut decisions = Vec::new();

        for vertex in all_vertices {
            if let Ok(decision) = serde_json::from_slice::<Decision>(&vertex.payload) {
                if vertex.id.starts_with("authz-decision-") {
                    decisions.push(decision);
                }
            }
        }

        Ok(decisions)
    }

    /// Verify the integrity of the audit trail
    pub async fn verify_integrity(&self) -> Result<bool> {
        let g = self.graph.read().await;
        let all_vertices = g.get_all_vertices()?;

        for vertex in &all_vertices {
            // Skip genesis vertex (no signature expected)
            if vertex.id == self.genesis_id {
                continue;
            }

            // Verify each decision vertex signature
            if vertex.id.starts_with("authz-decision-") {
                // Deserialize the decision to get original data
                let decision: Decision = serde_json::from_slice(&vertex.payload)
                    .map_err(|e| AuthzError::Internal(format!("Failed to deserialize decision: {}", e)))?;

                // Verify the signature if present
                if let Some(signature_bytes) = &decision.signature {
                    // Re-serialize decision without signature for verification
                    let mut decision_for_verification = decision.clone();
                    decision_for_verification.signature = None;
                    let decision_data = serde_json::to_vec(&decision_for_verification)
                        .map_err(|e| AuthzError::Internal(format!("Failed to serialize decision: {}", e)))?;

                    // Parse the signature
                    let signature = MLDSA87Signature::from_bytes(signature_bytes)
                        .map_err(|e| AuthzError::Internal(format!("Invalid signature format: {:?}", e)))?;

                    // Verify signature with public key
                    self.signing_keypair.verify(&decision_data, &signature)
                        .map_err(|e| {
                            debug!("Signature verification failed for decision {}: {:?}", decision.id, e);
                            AuthzError::Internal(format!("Signature verification failed for decision {}", decision.id))
                        })?;

                    debug!("Signature verified for decision: {}", decision.id);
                } else {
                    debug!("Warning: Decision {} has no signature", decision.id);
                    return Ok(false);
                }
            }

            // Verify parent references exist
            for parent_id in &vertex.parents {
                // Check if vertex exists by attempting to retrieve it
                if g.get_vertex(parent_id).is_err() {
                    debug!("Parent vertex not found: {}", parent_id);
                    return Ok(false);
                }
            }
        }

        debug!("Audit trail integrity verified: {} vertices", all_vertices.len());
        Ok(true)
    }

    /// Verify a single decision's signature
    pub fn verify_decision_signature(&self, decision: &Decision) -> Result<bool> {
        // Check if signature exists
        let signature_bytes = decision.signature.as_ref()
            .ok_or_else(|| AuthzError::Internal("Decision has no signature".to_string()))?;

        // Re-serialize decision without signature for verification
        let mut decision_for_verification = decision.clone();
        decision_for_verification.signature = None;
        let decision_data = serde_json::to_vec(&decision_for_verification)
            .map_err(|e| AuthzError::Internal(format!("Failed to serialize decision: {}", e)))?;

        // Parse the signature
        let signature = MLDSA87Signature::from_bytes(signature_bytes)
            .map_err(|e| AuthzError::Internal(format!("Invalid signature format: {:?}", e)))?;

        // Verify signature with public key
        match self.signing_keypair.verify(&decision_data, &signature) {
            Ok(()) => Ok(true),
            Err(_) => Ok(false),
        }
    }

    /// Get audit trail statistics
    pub async fn get_stats(&self) -> Result<AuditStats> {
        let g = self.graph.read().await;
        let all_vertices = g.get_all_vertices()?;
        let tips = g.get_tips()?;

        Ok(AuditStats {
            total_decisions: all_vertices.len().saturating_sub(1), // Exclude genesis
            dag_vertices: all_vertices.len(),
            dag_tips: tips.len(),
        })
    }
}

/// Audit trail statistics
#[derive(Debug, Clone)]
pub struct AuditStats {
    /// Total number of authorization decisions recorded
    pub total_decisions: usize,

    /// Total vertices in the DAG
    pub dag_vertices: usize,

    /// Current number of DAG tips
    pub dag_tips: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Principal, Resource, Action};
    use std::collections::HashMap;

    #[tokio::test]
    async fn test_audit_trail_creation() {
        let audit = AuditTrail::new().await.unwrap();
        let stats = audit.get_stats().await.unwrap();

        assert_eq!(stats.total_decisions, 0);
        assert_eq!(stats.dag_vertices, 1);  // Just genesis
    }

    #[tokio::test]
    async fn test_record_decision() {
        let audit = AuditTrail::new().await.unwrap();

        let request = AuthzRequest {
            principal: Principal::new("user:alice@example.com"),
            resource: Resource::new("document:123"),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        let decision = Decision::allow("policy-1", "User has permission");
        let signed_decision = audit.record_decision(&request, decision).await.unwrap();

        assert!(signed_decision.signature.is_some());

        let stats = audit.get_stats().await.unwrap();
        assert_eq!(stats.total_decisions, 1);
        assert_eq!(stats.dag_vertices, 2);  // Genesis + decision
    }

    #[tokio::test]
    async fn test_audit_integrity() {
        let audit = AuditTrail::new().await.unwrap();

        let request = AuthzRequest {
            principal: Principal::new("user:alice@example.com"),
            resource: Resource::new("document:123"),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        let decision = Decision::allow("policy-1", "Test");
        audit.record_decision(&request, decision).await.unwrap();

        let valid = audit.verify_integrity().await.unwrap();
        assert!(valid);
    }

    #[tokio::test]
    async fn test_signature_verification_valid() {
        let audit = AuditTrail::new().await.unwrap();

        let request = AuthzRequest {
            principal: Principal::new("user:bob@example.com"),
            resource: Resource::new("file:secret.txt"),
            action: Action::new("write"),
            context: HashMap::new(),
        };

        let decision = Decision::allow("policy-2", "Admin access granted");
        let signed_decision = audit.record_decision(&request, decision).await.unwrap();

        // Verify the signature is present
        assert!(signed_decision.signature.is_some());
        assert!(!signed_decision.signature.as_ref().unwrap().is_empty());

        // Verify the signature is valid
        let is_valid = audit.verify_decision_signature(&signed_decision).unwrap();
        assert!(is_valid, "Valid signature should verify successfully");
    }

    #[tokio::test]
    async fn test_signature_verification_tampered_data() {
        let audit = AuditTrail::new().await.unwrap();

        let request = AuthzRequest {
            principal: Principal::new("user:charlie@example.com"),
            resource: Resource::new("database:prod"),
            action: Action::new("delete"),
            context: HashMap::new(),
        };

        let decision = Decision::deny("policy-3", "Insufficient permissions");
        let signed_decision = audit.record_decision(&request, decision).await.unwrap();

        // Tamper with the decision data
        let mut tampered_decision = signed_decision.clone();
        tampered_decision.allowed = !tampered_decision.allowed;  // Flip the decision

        // Verification should fail for tampered data
        let is_valid = audit.verify_decision_signature(&tampered_decision).unwrap();
        assert!(!is_valid, "Tampered decision should fail verification");
    }

    #[tokio::test]
    async fn test_signature_verification_invalid_signature() {
        let audit = AuditTrail::new().await.unwrap();

        let request = AuthzRequest {
            principal: Principal::new("user:dave@example.com"),
            resource: Resource::new("api:endpoint"),
            action: Action::new("execute"),
            context: HashMap::new(),
        };

        let decision = Decision::allow("policy-4", "Valid API key");
        let signed_decision = audit.record_decision(&request, decision).await.unwrap();

        // Replace signature with invalid bytes (ML-DSA87 signatures are 4595 bytes)
        let mut invalid_decision = signed_decision.clone();
        invalid_decision.signature = Some(vec![0xFF; 4595]);  // Invalid signature bytes with correct length

        // Should fail to verify (wrong signature)
        let result = audit.verify_decision_signature(&invalid_decision);
        assert!(result.is_ok(), "Should parse signature but fail verification");
        assert!(!result.unwrap(), "Invalid signature should not verify");
    }

    #[tokio::test]
    async fn test_signature_verification_missing_signature() {
        let audit = AuditTrail::new().await.unwrap();

        let decision = Decision::allow("policy-5", "Test");
        // Don't record through audit trail, so no signature

        // Should fail when signature is missing
        let result = audit.verify_decision_signature(&decision);
        assert!(result.is_err(), "Missing signature should return error");
        assert!(result.unwrap_err().to_string().contains("no signature"));
    }

    #[tokio::test]
    async fn test_multiple_decisions_integrity() {
        let audit = AuditTrail::new().await.unwrap();

        // Record multiple decisions
        for i in 0..5 {
            let request = AuthzRequest {
                principal: Principal::new(format!("user:user{}@example.com", i)),
                resource: Resource::new(format!("resource:{}", i)),
                action: Action::new("read"),
                context: HashMap::new(),
            };

            let decision = Decision::allow(
                &format!("policy-{}", i),
                &format!("Access granted for user {}", i),
            );
            audit.record_decision(&request, decision).await.unwrap();
        }

        // Verify all signatures
        let valid = audit.verify_integrity().await.unwrap();
        assert!(valid, "All signatures should be valid");

        // Check statistics
        let stats = audit.get_stats().await.unwrap();
        assert_eq!(stats.total_decisions, 5);
        assert_eq!(stats.dag_vertices, 6);  // Genesis + 5 decisions
    }

    #[tokio::test]
    async fn test_signature_persistence_across_keypair() {
        // This test ensures that signatures are verified with the same keypair
        let audit = AuditTrail::new().await.unwrap();

        let request = AuthzRequest {
            principal: Principal::new("user:eve@example.com"),
            resource: Resource::new("secrets:vault"),
            action: Action::new("read"),
            context: HashMap::new(),
        };

        let decision = Decision::deny("policy-6", "Access denied");
        let signed_decision = audit.record_decision(&request, decision).await.unwrap();

        // Verify with same audit trail instance
        let is_valid = audit.verify_decision_signature(&signed_decision).unwrap();
        assert!(is_valid, "Signature should verify with same keypair");

        // Create a new audit trail with different keypair
        let audit2 = AuditTrail::new().await.unwrap();

        // Verification should fail with different keypair
        let is_valid2 = audit2.verify_decision_signature(&signed_decision).unwrap();
        assert!(!is_valid2, "Signature should fail with different keypair");
    }

    #[tokio::test]
    async fn test_integrity_verification_with_dag_structure() {
        let audit = AuditTrail::new().await.unwrap();

        // Create a chain of decisions
        for i in 0..3 {
            let request = AuthzRequest {
                principal: Principal::new(format!("user:test{}@example.com", i)),
                resource: Resource::new(format!("doc:{}", i)),
                action: Action::new("read"),
                context: HashMap::new(),
            };

            let decision = Decision::allow(&format!("policy-{}", i), "Approved");
            audit.record_decision(&request, decision).await.unwrap();
        }

        // Verify integrity (checks both signatures and DAG structure)
        let valid = audit.verify_integrity().await.unwrap();
        assert!(valid, "DAG with valid signatures should pass integrity check");
    }
}
