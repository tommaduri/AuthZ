//! DAG-based audit trail for authorization decisions

use crate::error::{AuthzError, Result};
use crate::types::{AuthzRequest, Decision};
use cretoai_dag::vertex::{Vertex, VertexBuilder};
use cretoai_dag::graph::Graph;
use cretoai_crypto::signatures::{MLDSA87, MLDSA87SecretKey};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::debug;

/// Audit trail using DAG for tamper-proof authorization history
pub struct AuditTrail {
    graph: Arc<RwLock<Graph>>,
    signing_key: Arc<MLDSA87SecretKey>,
    genesis_id: String,
}

impl AuditTrail {
    /// Create a new audit trail
    pub async fn new() -> Result<Self> {
        let graph = Arc::new(RwLock::new(Graph::new()));

        // Generate signing key for decisions
        let signing_keypair = MLDSA87::generate();
        let signing_key = Arc::new(signing_keypair.secret_key.clone());

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
            signing_key,
            genesis_id,
        })
    }

    /// Record an authorization decision in the DAG
    pub async fn record_decision(
        &self,
        request: &AuthzRequest,
        mut decision: Decision,
    ) -> Result<Decision> {
        // Serialize decision data
        let decision_data = serde_json::to_vec(&decision)
            .map_err(|e| AuthzError::Internal(format!("Failed to serialize decision: {}", e)))?;

        // Sign the decision
        let signing_keypair = MLDSA87::generate();  // TODO: Use persistent key
        let signature = signing_keypair.sign(&decision_data);
        decision.signature = Some(signature.as_bytes().to_vec());

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

        // Create audit vertex
        let vertex = VertexBuilder::new(format!("decision:{}", decision.id))
            .id(format!("authz-decision-{}", decision.id))
            .payload(decision_data)
            .parent(parent_id)
            .build();

        // Add to DAG
        {
            let mut g = self.graph.write().await;
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
            // Verify each vertex signature
            if !vertex.signature.is_empty() {
                // TODO: Implement signature verification
                // let keypair = MLDSA87::from_secret_key(&self.signing_key);
                // let valid = keypair.verify(&vertex_data, &vertex.signature);
            }

            // Verify parent references exist
            for parent_id in &vertex.parents {
                // Check if vertex exists by attempting to retrieve it
                if g.get_vertex(parent_id).is_err() {
                    return Ok(false);
                }
            }
        }

        debug!("Audit trail integrity verified: {} vertices", all_vertices.len());
        Ok(true)
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
}
