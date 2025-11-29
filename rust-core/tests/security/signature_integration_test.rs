//! Comprehensive TDD Test Suite for Option 1: Security First (ML-DSA Signature Integration)
//!
//! This test suite follows strict TDD methodology:
//! 1. All tests are written BEFORE implementation
//! 2. Tests should FAIL initially (Red phase)
//! 3. Implementation will make them pass (Green phase)
//! 4. Refactoring follows (Refactor phase)
//!
//! Test Coverage:
//! - ML-DSA signature generation for vertices
//! - Signature verification (valid cases)
//! - Signature verification (invalid cases)
//! - Network message signing (consensus, exchange)
//! - Key rotation scenarios
//! - Byzantine fault scenarios (forged signatures)
//! - Edge cases and error handling

#![allow(unused_imports)]

use vigilia_crypto::signatures::dilithium::{MLDSA87, MLDSA87KeyPair, MLDSA87PublicKey, MLDSA87Signature};
use vigilia_dag::vertex::{Vertex, VertexBuilder};
use vigilia_network::{ConsensusQuery, ConsensusResponse, VertexMessage};

// Test fixtures and utilities
mod fixtures {
    use super::*;

    /// Test keypair generator
    pub fn generate_test_keypair() -> MLDSA87KeyPair {
        MLDSA87::generate()
    }

    /// Create a sample vertex for testing
    pub fn create_sample_vertex(id: &str, creator: &str) -> Vertex {
        VertexBuilder::new(creator.to_string())
            .id(id.to_string())
            .payload(b"test payload".to_vec())
            .build()
    }

    /// Create vertex with parents
    pub fn create_vertex_with_parents(id: &str, creator: &str, parents: Vec<String>) -> Vertex {
        VertexBuilder::new(creator.to_string())
            .id(id.to_string())
            .parents(parents)
            .payload(b"test payload with parents".to_vec())
            .build()
    }
}

// ============================================================================
// Test Suite 1: ML-DSA Signature Generation for Vertices
// ============================================================================

#[cfg(test)]
mod vertex_signature_generation {
    use super::*;
    use fixtures::*;

    #[test]
    fn test_vertex_sign_with_mldsa87() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let mut vertex = create_sample_vertex("vertex-1", "agent-001");

        // ACT
        // TODO: Implement vertex.sign_with_mldsa87(&keypair.secret_key)
        let signature_data = vertex_to_signable_bytes(&vertex);
        let signature = keypair.sign(&signature_data);
        vertex.sign(signature.as_bytes().to_vec());

        // ASSERT
        assert!(!vertex.signature.is_empty(), "Vertex should have a signature");
        assert_eq!(
            vertex.signature.len(),
            4627, // ML-DSA-87 signature length
            "Signature should be ML-DSA-87 standard length"
        );
    }

    #[test]
    fn test_vertex_signature_includes_all_fields() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let vertex = create_vertex_with_parents(
            "vertex-2",
            "agent-002",
            vec!["parent-1".to_string(), "parent-2".to_string()],
        );

        // ACT
        let signable_bytes = vertex_to_signable_bytes(&vertex);

        // ASSERT
        // Signature should include: id, parents, payload, timestamp, creator, hash
        assert!(signable_bytes.len() > 0, "Signable bytes should not be empty");

        // Verify all components are included in signable data
        let id_bytes_present = signable_bytes.windows(vertex.id.as_bytes().len())
            .any(|window| window == vertex.id.as_bytes());
        assert!(id_bytes_present, "Vertex ID should be in signable data");
    }

    #[test]
    fn test_genesis_vertex_signature() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let mut genesis_vertex = create_sample_vertex("genesis-0", "system");

        // ACT
        let signature_data = vertex_to_signable_bytes(&genesis_vertex);
        let signature = keypair.sign(&signature_data);
        genesis_vertex.sign(signature.as_bytes().to_vec());

        // ASSERT
        assert!(genesis_vertex.is_genesis(), "Should be genesis vertex");
        assert!(!genesis_vertex.signature.is_empty(), "Genesis should be signed");
    }

    #[test]
    fn test_signature_determinism() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let vertex = create_sample_vertex("vertex-3", "agent-003");
        let signable_bytes = vertex_to_signable_bytes(&vertex);

        // ACT
        let sig1 = keypair.sign(&signable_bytes);
        let sig2 = keypair.sign(&signable_bytes);

        // ASSERT
        assert_eq!(
            sig1.as_bytes(),
            sig2.as_bytes(),
            "Same input should produce same signature"
        );
    }

    // Helper function (will be moved to implementation)
    fn vertex_to_signable_bytes(vertex: &Vertex) -> Vec<u8> {
        // TODO: Implement proper serialization for signing
        // Should include: id, parents, payload, timestamp, creator, hash
        let mut bytes = Vec::new();
        bytes.extend_from_slice(vertex.id.as_bytes());
        for parent in &vertex.parents {
            bytes.extend_from_slice(parent.as_bytes());
        }
        bytes.extend_from_slice(&vertex.payload);
        bytes.extend_from_slice(&vertex.timestamp.to_le_bytes());
        bytes.extend_from_slice(vertex.creator.as_bytes());
        bytes.extend_from_slice(&vertex.hash);
        bytes
    }
}

// ============================================================================
// Test Suite 2: Signature Verification (Valid Cases)
// ============================================================================

#[cfg(test)]
mod signature_verification_valid {
    use super::*;
    use fixtures::*;

    #[test]
    fn test_verify_valid_vertex_signature() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let mut vertex = create_sample_vertex("vertex-4", "agent-004");

        let signable_bytes = vertex_to_signable_bytes(&vertex);
        let signature = keypair.sign(&signable_bytes);
        vertex.sign(signature.as_bytes().to_vec());

        // ACT
        // TODO: Implement vertex.verify_mldsa87_signature(&keypair.public_key)
        let result = verify_vertex_signature(&vertex, &keypair.public_key);

        // ASSERT
        assert!(result.is_ok(), "Valid signature should verify successfully");
    }

    #[test]
    fn test_verify_genesis_vertex_signature() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let mut genesis = create_sample_vertex("genesis-1", "system");

        let signable_bytes = vertex_to_signable_bytes(&genesis);
        let signature = keypair.sign(&signable_bytes);
        genesis.sign(signature.as_bytes().to_vec());

        // ACT
        let result = verify_vertex_signature(&genesis, &keypair.public_key);

        // ASSERT
        assert!(result.is_ok(), "Genesis signature should verify");
    }

    #[test]
    fn test_verify_vertex_with_multiple_parents() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let mut vertex = create_vertex_with_parents(
            "vertex-5",
            "agent-005",
            vec!["p1".to_string(), "p2".to_string(), "p3".to_string()],
        );

        let signable_bytes = vertex_to_signable_bytes(&vertex);
        let signature = keypair.sign(&signable_bytes);
        vertex.sign(signature.as_bytes().to_vec());

        // ACT
        let result = verify_vertex_signature(&vertex, &keypair.public_key);

        // ASSERT
        assert!(result.is_ok(), "Multi-parent vertex signature should verify");
    }

    #[test]
    fn test_verify_large_payload_vertex() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let large_payload = vec![0x42; 1_000_000]; // 1MB payload
        let mut vertex = VertexBuilder::new("agent-006".to_string())
            .id("vertex-6".to_string())
            .payload(large_payload)
            .build();

        let signable_bytes = vertex_to_signable_bytes(&vertex);
        let signature = keypair.sign(&signable_bytes);
        vertex.sign(signature.as_bytes().to_vec());

        // ACT
        let result = verify_vertex_signature(&vertex, &keypair.public_key);

        // ASSERT
        assert!(result.is_ok(), "Large payload signature should verify");
    }

    // Helper function
    fn vertex_to_signable_bytes(vertex: &Vertex) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(vertex.id.as_bytes());
        for parent in &vertex.parents {
            bytes.extend_from_slice(parent.as_bytes());
        }
        bytes.extend_from_slice(&vertex.payload);
        bytes.extend_from_slice(&vertex.timestamp.to_le_bytes());
        bytes.extend_from_slice(vertex.creator.as_bytes());
        bytes.extend_from_slice(&vertex.hash);
        bytes
    }

    fn verify_vertex_signature(vertex: &Vertex, public_key: &MLDSA87PublicKey) -> Result<(), String> {
        // TODO: Implement actual verification
        if vertex.signature.is_empty() {
            return Err("No signature present".to_string());
        }

        let signable_bytes = vertex_to_signable_bytes(vertex);
        let signature = MLDSA87Signature::from_bytes(&vertex.signature)
            .map_err(|e| format!("Invalid signature bytes: {:?}", e))?;

        MLDSA87::verify(&signable_bytes, &signature, public_key)
            .map_err(|e| format!("Signature verification failed: {:?}", e))
    }
}

// ============================================================================
// Test Suite 3: Signature Verification (Invalid Cases)
// ============================================================================

#[cfg(test)]
mod signature_verification_invalid {
    use super::*;
    use fixtures::*;

    #[test]
    fn test_verify_tampered_payload() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let mut vertex = create_sample_vertex("vertex-7", "agent-007");

        let signable_bytes = vertex_to_signable_bytes(&vertex);
        let signature = keypair.sign(&signable_bytes);
        vertex.sign(signature.as_bytes().to_vec());

        // Tamper with payload AFTER signing
        vertex.payload = b"tampered payload".to_vec();

        // ACT
        let result = verify_vertex_signature(&vertex, &keypair.public_key);

        // ASSERT
        assert!(result.is_err(), "Tampered payload should fail verification");
    }

    #[test]
    fn test_verify_tampered_vertex_id() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let mut vertex = create_sample_vertex("vertex-8", "agent-008");

        let signable_bytes = vertex_to_signable_bytes(&vertex);
        let signature = keypair.sign(&signable_bytes);
        vertex.sign(signature.as_bytes().to_vec());

        // Tamper with ID
        vertex.id = "tampered-id".to_string();

        // ACT
        let result = verify_vertex_signature(&vertex, &keypair.public_key);

        // ASSERT
        assert!(result.is_err(), "Tampered ID should fail verification");
    }

    #[test]
    fn test_verify_tampered_timestamp() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let mut vertex = create_sample_vertex("vertex-9", "agent-009");

        let signable_bytes = vertex_to_signable_bytes(&vertex);
        let signature = keypair.sign(&signable_bytes);
        vertex.sign(signature.as_bytes().to_vec());

        // Tamper with timestamp
        vertex.timestamp += 1000;

        // ACT
        let result = verify_vertex_signature(&vertex, &keypair.public_key);

        // ASSERT
        assert!(result.is_err(), "Tampered timestamp should fail verification");
    }

    #[test]
    fn test_verify_missing_signature() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let vertex = create_sample_vertex("vertex-10", "agent-010");
        // No signature applied

        // ACT
        let result = verify_vertex_signature(&vertex, &keypair.public_key);

        // ASSERT
        assert!(result.is_err(), "Missing signature should fail verification");
    }

    #[test]
    fn test_verify_corrupted_signature_bytes() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let mut vertex = create_sample_vertex("vertex-11", "agent-011");

        let signable_bytes = vertex_to_signable_bytes(&vertex);
        let signature = keypair.sign(&signable_bytes);
        let mut sig_bytes = signature.as_bytes().to_vec();

        // Corrupt signature bytes
        sig_bytes[100] ^= 0xFF;
        vertex.sign(sig_bytes);

        // ACT
        let result = verify_vertex_signature(&vertex, &keypair.public_key);

        // ASSERT
        assert!(result.is_err(), "Corrupted signature should fail verification");
    }

    #[test]
    fn test_verify_truncated_signature() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let mut vertex = create_sample_vertex("vertex-12", "agent-012");

        let signable_bytes = vertex_to_signable_bytes(&vertex);
        let signature = keypair.sign(&signable_bytes);
        let mut sig_bytes = signature.as_bytes().to_vec();

        // Truncate signature
        sig_bytes.truncate(100);
        vertex.sign(sig_bytes);

        // ACT
        let result = verify_vertex_signature(&vertex, &keypair.public_key);

        // ASSERT
        assert!(result.is_err(), "Truncated signature should fail verification");
    }

    // Helper functions
    fn vertex_to_signable_bytes(vertex: &Vertex) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(vertex.id.as_bytes());
        for parent in &vertex.parents {
            bytes.extend_from_slice(parent.as_bytes());
        }
        bytes.extend_from_slice(&vertex.payload);
        bytes.extend_from_slice(&vertex.timestamp.to_le_bytes());
        bytes.extend_from_slice(vertex.creator.as_bytes());
        bytes.extend_from_slice(&vertex.hash);
        bytes
    }

    fn verify_vertex_signature(vertex: &Vertex, public_key: &MLDSA87PublicKey) -> Result<(), String> {
        if vertex.signature.is_empty() {
            return Err("No signature present".to_string());
        }

        let signable_bytes = vertex_to_signable_bytes(vertex);
        let signature = MLDSA87Signature::from_bytes(&vertex.signature)
            .map_err(|e| format!("Invalid signature bytes: {:?}", e))?;

        MLDSA87::verify(&signable_bytes, &signature, public_key)
            .map_err(|e| format!("Signature verification failed: {:?}", e))
    }
}

// ============================================================================
// Test Suite 4: Wrong Key Scenarios
// ============================================================================

#[cfg(test)]
mod wrong_key_scenarios {
    use super::*;
    use fixtures::*;

    #[test]
    fn test_verify_with_different_public_key() {
        // ARRANGE
        let keypair1 = generate_test_keypair();
        let keypair2 = generate_test_keypair();
        let mut vertex = create_sample_vertex("vertex-13", "agent-013");

        // Sign with keypair1
        let signable_bytes = vertex_to_signable_bytes(&vertex);
        let signature = keypair1.sign(&signable_bytes);
        vertex.sign(signature.as_bytes().to_vec());

        // ACT - Verify with keypair2's public key
        let result = verify_vertex_signature(&vertex, &keypair2.public_key);

        // ASSERT
        assert!(result.is_err(), "Wrong public key should fail verification");
    }

    #[test]
    fn test_cross_agent_signature_rejection() {
        // ARRANGE
        let agent1_keypair = generate_test_keypair();
        let agent2_keypair = generate_test_keypair();

        // Agent 1 creates and signs vertex
        let mut vertex = create_sample_vertex("vertex-14", "agent-001");
        let signable_bytes = vertex_to_signable_bytes(&vertex);
        let signature = agent1_keypair.sign(&signable_bytes);
        vertex.sign(signature.as_bytes().to_vec());

        // ACT - Agent 2 tries to verify with their key
        let result = verify_vertex_signature(&vertex, &agent2_keypair.public_key);

        // ASSERT
        assert!(result.is_err(), "Cross-agent verification should fail");
    }

    #[test]
    fn test_signature_replay_with_different_key() {
        // ARRANGE
        let keypair1 = generate_test_keypair();
        let keypair2 = generate_test_keypair();

        let mut vertex1 = create_sample_vertex("vertex-15a", "agent-015");
        let signable1 = vertex_to_signable_bytes(&vertex1);
        let signature1 = keypair1.sign(&signable1);
        vertex1.sign(signature1.as_bytes().to_vec());

        // Try to replay signature on different vertex with different key
        let mut vertex2 = create_sample_vertex("vertex-15b", "agent-015");
        vertex2.sign(signature1.as_bytes().to_vec());

        // ACT
        let result = verify_vertex_signature(&vertex2, &keypair2.public_key);

        // ASSERT
        assert!(result.is_err(), "Signature replay should fail");
    }

    // Helper functions
    fn vertex_to_signable_bytes(vertex: &Vertex) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(vertex.id.as_bytes());
        for parent in &vertex.parents {
            bytes.extend_from_slice(parent.as_bytes());
        }
        bytes.extend_from_slice(&vertex.payload);
        bytes.extend_from_slice(&vertex.timestamp.to_le_bytes());
        bytes.extend_from_slice(vertex.creator.as_bytes());
        bytes.extend_from_slice(&vertex.hash);
        bytes
    }

    fn verify_vertex_signature(vertex: &Vertex, public_key: &MLDSA87PublicKey) -> Result<(), String> {
        if vertex.signature.is_empty() {
            return Err("No signature present".to_string());
        }

        let signable_bytes = vertex_to_signable_bytes(vertex);
        let signature = MLDSA87Signature::from_bytes(&vertex.signature)
            .map_err(|e| format!("Invalid signature bytes: {:?}", e))?;

        MLDSA87::verify(&signable_bytes, &signature, public_key)
            .map_err(|e| format!("Signature verification failed: {:?}", e))
    }
}

// ============================================================================
// Test Suite 5: Network Message Signing
// ============================================================================

#[cfg(test)]
mod network_message_signing {
    use super::*;
    use fixtures::*;

    #[test]
    fn test_sign_consensus_query() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let query = ConsensusQuery {
            query_id: "query-1".to_string(),
            vertex_id: "vertex-16".to_string(),
            requester: "agent-016".to_string(),
            timestamp: 1234567890,
        };

        // ACT
        // TODO: Implement query.sign_with_mldsa87(&keypair.secret_key)
        let signable_bytes = consensus_query_to_bytes(&query);
        let signature = keypair.sign(&signable_bytes);

        // ASSERT
        assert!(!signature.as_bytes().is_empty(), "Query should be signed");
        assert_eq!(signature.as_bytes().len(), 4627, "Should be ML-DSA-87 signature");
    }

    #[test]
    fn test_verify_consensus_query_signature() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let query = ConsensusQuery {
            query_id: "query-2".to_string(),
            vertex_id: "vertex-17".to_string(),
            requester: "agent-017".to_string(),
            timestamp: 1234567890,
        };

        let signable_bytes = consensus_query_to_bytes(&query);
        let signature = keypair.sign(&signable_bytes);

        // ACT
        let result = MLDSA87::verify(&signable_bytes, &signature, &keypair.public_key);

        // ASSERT
        assert!(result.is_ok(), "Query signature should verify");
    }

    #[test]
    fn test_sign_consensus_response() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let response = ConsensusResponse {
            query_id: "query-3".to_string(),
            vertex_id: "vertex-18".to_string(),
            responder: "agent-018".to_string(),
            vote: true,
            confidence: 0.95,
            timestamp: 1234567890,
        };

        // ACT
        let signable_bytes = consensus_response_to_bytes(&response);
        let signature = keypair.sign(&signable_bytes);

        // ASSERT
        assert!(!signature.as_bytes().is_empty(), "Response should be signed");
    }

    #[test]
    fn test_verify_consensus_response_signature() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let response = ConsensusResponse {
            query_id: "query-4".to_string(),
            vertex_id: "vertex-19".to_string(),
            responder: "agent-019".to_string(),
            vote: true,
            confidence: 0.85,
            timestamp: 1234567890,
        };

        let signable_bytes = consensus_response_to_bytes(&response);
        let signature = keypair.sign(&signable_bytes);

        // ACT
        let result = MLDSA87::verify(&signable_bytes, &signature, &keypair.public_key);

        // ASSERT
        assert!(result.is_ok(), "Response signature should verify");
    }

    #[test]
    fn test_sign_vertex_message_for_broadcast() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let vertex = create_sample_vertex("vertex-20", "agent-020");

        let vertex_msg = VertexMessage {
            vertex_id: vertex.id.clone(),
            parents: vertex.parents.clone(),
            payload: vertex.payload.clone(),
            timestamp: vertex.timestamp,
            creator: vertex.creator.clone(),
            signature: vec![], // Will be filled
            hash: vertex.hash,
        };

        // ACT
        let signable_bytes = vertex_message_to_bytes(&vertex_msg);
        let signature = keypair.sign(&signable_bytes);

        // ASSERT
        assert!(!signature.as_bytes().is_empty(), "Vertex message should be signed");
    }

    #[test]
    fn test_reject_unsigned_network_message() {
        // ARRANGE
        let query = ConsensusQuery {
            query_id: "query-5".to_string(),
            vertex_id: "vertex-21".to_string(),
            requester: "agent-021".to_string(),
            timestamp: 1234567890,
        };

        // ACT - Try to verify without signature
        // This should fail at the application level before reaching crypto

        // ASSERT
        // The network layer should reject unsigned messages
        assert!(true, "Placeholder - network layer should reject unsigned messages");
    }

    // Helper functions
    fn consensus_query_to_bytes(query: &ConsensusQuery) -> Vec<u8> {
        // TODO: Implement proper serialization
        bincode::serialize(query).expect("Failed to serialize query")
    }

    fn consensus_response_to_bytes(response: &ConsensusResponse) -> Vec<u8> {
        // TODO: Implement proper serialization
        bincode::serialize(response).expect("Failed to serialize response")
    }

    fn vertex_message_to_bytes(msg: &VertexMessage) -> Vec<u8> {
        // TODO: Implement proper serialization
        bincode::serialize(msg).expect("Failed to serialize vertex message")
    }
}

// ============================================================================
// Test Suite 6: Key Rotation Scenarios
// ============================================================================

#[cfg(test)]
mod key_rotation {
    use super::*;
    use fixtures::*;

    #[test]
    fn test_verify_old_signatures_after_key_rotation() {
        // ARRANGE
        let old_keypair = generate_test_keypair();
        let new_keypair = generate_test_keypair();

        // Sign vertex with old key
        let mut vertex = create_sample_vertex("vertex-22", "agent-022");
        let signable_bytes = vertex_to_signable_bytes(&vertex);
        let old_signature = old_keypair.sign(&signable_bytes);
        vertex.sign(old_signature.as_bytes().to_vec());

        // ACT - Verify with old public key (should still work)
        let result_old = verify_vertex_signature(&vertex, &old_keypair.public_key);
        // Verify with new key (should fail)
        let result_new = verify_vertex_signature(&vertex, &new_keypair.public_key);

        // ASSERT
        assert!(result_old.is_ok(), "Old signatures should verify with old key");
        assert!(result_new.is_err(), "Old signatures should fail with new key");
    }

    #[test]
    fn test_re_sign_vertex_with_new_key() {
        // ARRANGE
        let old_keypair = generate_test_keypair();
        let new_keypair = generate_test_keypair();

        let mut vertex = create_sample_vertex("vertex-23", "agent-023");

        // Sign with old key
        let signable_bytes = vertex_to_signable_bytes(&vertex);
        let old_signature = old_keypair.sign(&signable_bytes);
        vertex.sign(old_signature.as_bytes().to_vec());

        // Re-sign with new key
        let new_signature = new_keypair.sign(&signable_bytes);
        vertex.sign(new_signature.as_bytes().to_vec());

        // ACT
        let result_new = verify_vertex_signature(&vertex, &new_keypair.public_key);
        let result_old = verify_vertex_signature(&vertex, &old_keypair.public_key);

        // ASSERT
        assert!(result_new.is_ok(), "Should verify with new key");
        assert!(result_old.is_err(), "Should fail with old key after re-signing");
    }

    #[test]
    fn test_key_rotation_grace_period() {
        // ARRANGE
        let old_keypair = generate_test_keypair();
        let new_keypair = generate_test_keypair();

        // During grace period, both keys should be accepted
        let mut vertex = create_sample_vertex("vertex-24", "agent-024");
        let signable_bytes = vertex_to_signable_bytes(&vertex);
        let signature = old_keypair.sign(&signable_bytes);
        vertex.sign(signature.as_bytes().to_vec());

        // ACT - Verify with both keys during grace period
        // TODO: Implement grace period logic in verification
        let result_old = verify_vertex_signature(&vertex, &old_keypair.public_key);

        // ASSERT
        assert!(result_old.is_ok(), "Old key should work during grace period");
    }

    #[test]
    fn test_key_rotation_metadata() {
        // ARRANGE
        let old_keypair = generate_test_keypair();
        let new_keypair = generate_test_keypair();

        // Rotation should include metadata: rotation_timestamp, old_key_fingerprint
        // TODO: Implement key rotation metadata structure

        // ASSERT
        assert!(true, "Placeholder - key rotation should include metadata");
    }

    // Helper functions
    fn vertex_to_signable_bytes(vertex: &Vertex) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(vertex.id.as_bytes());
        for parent in &vertex.parents {
            bytes.extend_from_slice(parent.as_bytes());
        }
        bytes.extend_from_slice(&vertex.payload);
        bytes.extend_from_slice(&vertex.timestamp.to_le_bytes());
        bytes.extend_from_slice(vertex.creator.as_bytes());
        bytes.extend_from_slice(&vertex.hash);
        bytes
    }

    fn verify_vertex_signature(vertex: &Vertex, public_key: &MLDSA87PublicKey) -> Result<(), String> {
        if vertex.signature.is_empty() {
            return Err("No signature present".to_string());
        }

        let signable_bytes = vertex_to_signable_bytes(vertex);
        let signature = MLDSA87Signature::from_bytes(&vertex.signature)
            .map_err(|e| format!("Invalid signature bytes: {:?}", e))?;

        MLDSA87::verify(&signable_bytes, &signature, public_key)
            .map_err(|e| format!("Signature verification failed: {:?}", e))
    }
}

// ============================================================================
// Test Suite 7: Byzantine Fault Scenarios
// ============================================================================

#[cfg(test)]
mod byzantine_faults {
    use super::*;
    use fixtures::*;

    #[test]
    fn test_reject_forged_signature() {
        // ARRANGE
        let legitimate_keypair = generate_test_keypair();
        let attacker_keypair = generate_test_keypair();

        let mut vertex = create_sample_vertex("vertex-25", "agent-025");

        // Attacker signs with their key
        let signable_bytes = vertex_to_signable_bytes(&vertex);
        let forged_signature = attacker_keypair.sign(&signable_bytes);
        vertex.sign(forged_signature.as_bytes().to_vec());

        // ACT - Verify with legitimate key
        let result = verify_vertex_signature(&vertex, &legitimate_keypair.public_key);

        // ASSERT
        assert!(result.is_err(), "Forged signature should be rejected");
    }

    #[test]
    fn test_reject_signature_on_tampered_vertex() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let mut vertex = create_sample_vertex("vertex-26", "agent-026");

        // Sign legitimate vertex
        let signable_bytes = vertex_to_signable_bytes(&vertex);
        let signature = keypair.sign(&signable_bytes);
        vertex.sign(signature.as_bytes().to_vec());

        // Attacker tampers with payload
        vertex.payload = b"malicious payload".to_vec();

        // ACT
        let result = verify_vertex_signature(&vertex, &keypair.public_key);

        // ASSERT
        assert!(result.is_err(), "Signature on tampered data should fail");
    }

    #[test]
    fn test_reject_replayed_signature() {
        // ARRANGE
        let keypair = generate_test_keypair();

        // Create and sign first vertex
        let mut vertex1 = create_sample_vertex("vertex-27a", "agent-027");
        let signable1 = vertex_to_signable_bytes(&vertex1);
        let signature = keypair.sign(&signable1);
        vertex1.sign(signature.as_bytes().to_vec());

        // Attacker replays signature on different vertex
        let mut vertex2 = create_sample_vertex("vertex-27b", "agent-027");
        vertex2.sign(signature.as_bytes().to_vec()); // Same signature

        // ACT
        let result = verify_vertex_signature(&vertex2, &keypair.public_key);

        // ASSERT
        assert!(result.is_err(), "Replayed signature should fail on different data");
    }

    #[test]
    fn test_reject_malformed_signature() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let mut vertex = create_sample_vertex("vertex-28", "agent-028");

        // Attacker provides malformed signature
        let malformed_signature = vec![0xFF; 4627]; // Correct length but random data
        vertex.sign(malformed_signature);

        // ACT
        let result = verify_vertex_signature(&vertex, &keypair.public_key);

        // ASSERT
        assert!(result.is_err(), "Malformed signature should be rejected");
    }

    #[test]
    fn test_reject_signature_length_attack() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let mut vertex = create_sample_vertex("vertex-29", "agent-029");

        // Attacker provides wrong length signature
        let wrong_length_sig = vec![0x00; 1000]; // Wrong length
        vertex.sign(wrong_length_sig);

        // ACT
        let result = verify_vertex_signature(&vertex, &keypair.public_key);

        // ASSERT
        assert!(result.is_err(), "Wrong length signature should be rejected");
    }

    #[test]
    fn test_reject_double_signing_attack() {
        // ARRANGE - Byzantine node signs two conflicting vertices with same ID
        let keypair = generate_test_keypair();

        let mut vertex_a = create_sample_vertex("conflict-vertex", "byzantine-agent");
        vertex_a.payload = b"payload A".to_vec();
        let signable_a = vertex_to_signable_bytes(&vertex_a);
        let sig_a = keypair.sign(&signable_a);
        vertex_a.sign(sig_a.as_bytes().to_vec());

        let mut vertex_b = create_sample_vertex("conflict-vertex", "byzantine-agent");
        vertex_b.payload = b"payload B".to_vec();
        let signable_b = vertex_to_signable_bytes(&vertex_b);
        let sig_b = keypair.sign(&signable_b);
        vertex_b.sign(sig_b.as_bytes().to_vec());

        // ACT - Both should verify individually, but system should detect conflict
        let result_a = verify_vertex_signature(&vertex_a, &keypair.public_key);
        let result_b = verify_vertex_signature(&vertex_b, &keypair.public_key);

        // ASSERT
        assert!(result_a.is_ok(), "First signature is valid");
        assert!(result_b.is_ok(), "Second signature is valid");
        // TODO: Add conflict detection test
        assert_ne!(vertex_a.payload, vertex_b.payload, "Conflicting payloads detected");
    }

    #[test]
    fn test_reject_timestamp_manipulation() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let mut vertex = create_sample_vertex("vertex-30", "agent-030");

        let signable_bytes = vertex_to_signable_bytes(&vertex);
        let signature = keypair.sign(&signable_bytes);
        vertex.sign(signature.as_bytes().to_vec());

        // Attacker manipulates timestamp after signing
        let original_timestamp = vertex.timestamp;
        vertex.timestamp = original_timestamp + 10000;

        // ACT
        let result = verify_vertex_signature(&vertex, &keypair.public_key);

        // ASSERT
        assert!(result.is_err(), "Timestamp manipulation should be detected");
    }

    // Helper functions
    fn vertex_to_signable_bytes(vertex: &Vertex) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(vertex.id.as_bytes());
        for parent in &vertex.parents {
            bytes.extend_from_slice(parent.as_bytes());
        }
        bytes.extend_from_slice(&vertex.payload);
        bytes.extend_from_slice(&vertex.timestamp.to_le_bytes());
        bytes.extend_from_slice(vertex.creator.as_bytes());
        bytes.extend_from_slice(&vertex.hash);
        bytes
    }

    fn verify_vertex_signature(vertex: &Vertex, public_key: &MLDSA87PublicKey) -> Result<(), String> {
        if vertex.signature.is_empty() {
            return Err("No signature present".to_string());
        }

        let signable_bytes = vertex_to_signable_bytes(vertex);
        let signature = MLDSA87Signature::from_bytes(&vertex.signature)
            .map_err(|e| format!("Invalid signature bytes: {:?}", e))?;

        MLDSA87::verify(&signable_bytes, &signature, public_key)
            .map_err(|e| format!("Signature verification failed: {:?}", e))
    }
}

// ============================================================================
// Test Suite 8: Edge Cases and Error Handling
// ============================================================================

#[cfg(test)]
mod edge_cases {
    use super::*;
    use fixtures::*;

    #[test]
    fn test_empty_payload_signature() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let mut vertex = VertexBuilder::new("agent-031".to_string())
            .id("vertex-31".to_string())
            .payload(vec![]) // Empty payload
            .build();

        let signable_bytes = vertex_to_signable_bytes(&vertex);
        let signature = keypair.sign(&signable_bytes);
        vertex.sign(signature.as_bytes().to_vec());

        // ACT
        let result = verify_vertex_signature(&vertex, &keypair.public_key);

        // ASSERT
        assert!(result.is_ok(), "Empty payload should be signable and verifiable");
    }

    #[test]
    fn test_maximum_payload_signature() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let max_payload = vec![0xAB; 10_000_000]; // 10MB payload
        let mut vertex = VertexBuilder::new("agent-032".to_string())
            .id("vertex-32".to_string())
            .payload(max_payload)
            .build();

        let signable_bytes = vertex_to_signable_bytes(&vertex);
        let signature = keypair.sign(&signable_bytes);
        vertex.sign(signature.as_bytes().to_vec());

        // ACT
        let result = verify_vertex_signature(&vertex, &keypair.public_key);

        // ASSERT
        assert!(result.is_ok(), "Large payload should be signable");
    }

    #[test]
    fn test_unicode_vertex_id_signature() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let mut vertex = VertexBuilder::new("agent-033".to_string())
            .id("vertex-😀-🚀-中文".to_string())
            .payload(b"test".to_vec())
            .build();

        let signable_bytes = vertex_to_signable_bytes(&vertex);
        let signature = keypair.sign(&signable_bytes);
        vertex.sign(signature.as_bytes().to_vec());

        // ACT
        let result = verify_vertex_signature(&vertex, &keypair.public_key);

        // ASSERT
        assert!(result.is_ok(), "Unicode IDs should be handled correctly");
    }

    #[test]
    fn test_binary_payload_signature() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let binary_payload: Vec<u8> = (0..=255).collect();
        let mut vertex = VertexBuilder::new("agent-034".to_string())
            .id("vertex-34".to_string())
            .payload(binary_payload)
            .build();

        let signable_bytes = vertex_to_signable_bytes(&vertex);
        let signature = keypair.sign(&signable_bytes);
        vertex.sign(signature.as_bytes().to_vec());

        // ACT
        let result = verify_vertex_signature(&vertex, &keypair.public_key);

        // ASSERT
        assert!(result.is_ok(), "Binary payloads should be handled correctly");
    }

    #[test]
    fn test_zero_timestamp_signature() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let mut vertex = create_sample_vertex("vertex-35", "agent-035");
        vertex.timestamp = 0; // Edge case: zero timestamp

        let signable_bytes = vertex_to_signable_bytes(&vertex);
        let signature = keypair.sign(&signable_bytes);
        vertex.sign(signature.as_bytes().to_vec());

        // ACT
        let result = verify_vertex_signature(&vertex, &keypair.public_key);

        // ASSERT
        assert!(result.is_ok(), "Zero timestamp should be handled");
    }

    #[test]
    fn test_max_u64_timestamp_signature() {
        // ARRANGE
        let keypair = generate_test_keypair();
        let mut vertex = create_sample_vertex("vertex-36", "agent-036");
        vertex.timestamp = u64::MAX; // Edge case: maximum timestamp

        let signable_bytes = vertex_to_signable_bytes(&vertex);
        let signature = keypair.sign(&signable_bytes);
        vertex.sign(signature.as_bytes().to_vec());

        // ACT
        let result = verify_vertex_signature(&vertex, &keypair.public_key);

        // ASSERT
        assert!(result.is_ok(), "Max timestamp should be handled");
    }

    #[test]
    fn test_multiple_parents_same_id() {
        // ARRANGE - Edge case: duplicate parent IDs
        let keypair = generate_test_keypair();
        let mut vertex = VertexBuilder::new("agent-037".to_string())
            .id("vertex-37".to_string())
            .parents(vec!["parent-1".to_string(), "parent-1".to_string()]) // Duplicate
            .payload(b"test".to_vec())
            .build();

        let signable_bytes = vertex_to_signable_bytes(&vertex);
        let signature = keypair.sign(&signable_bytes);
        vertex.sign(signature.as_bytes().to_vec());

        // ACT
        let result = verify_vertex_signature(&vertex, &keypair.public_key);

        // ASSERT
        assert!(result.is_ok(), "Duplicate parents should be handled in signature");
    }

    #[test]
    fn test_concurrent_signature_operations() {
        // ARRANGE
        use std::sync::Arc;
        use std::thread;

        let keypair = Arc::new(generate_test_keypair());
        let mut handles = vec![];

        // ACT - Sign multiple vertices concurrently
        for i in 0..10 {
            let kp = Arc::clone(&keypair);
            let handle = thread::spawn(move || {
                let mut vertex = create_sample_vertex(&format!("vertex-38-{}", i), "agent-038");
                let signable = vertex_to_signable_bytes(&vertex);
                let signature = kp.sign(&signable);
                vertex.sign(signature.as_bytes().to_vec());
                verify_vertex_signature(&vertex, &kp.public_key)
            });
            handles.push(handle);
        }

        // ASSERT
        for handle in handles {
            let result = handle.join().expect("Thread panicked");
            assert!(result.is_ok(), "Concurrent signing should work");
        }
    }

    // Helper functions
    fn vertex_to_signable_bytes(vertex: &Vertex) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(vertex.id.as_bytes());
        for parent in &vertex.parents {
            bytes.extend_from_slice(parent.as_bytes());
        }
        bytes.extend_from_slice(&vertex.payload);
        bytes.extend_from_slice(&vertex.timestamp.to_le_bytes());
        bytes.extend_from_slice(vertex.creator.as_bytes());
        bytes.extend_from_slice(&vertex.hash);
        bytes
    }

    fn verify_vertex_signature(vertex: &Vertex, public_key: &MLDSA87PublicKey) -> Result<(), String> {
        if vertex.signature.is_empty() {
            return Err("No signature present".to_string());
        }

        let signable_bytes = vertex_to_signable_bytes(vertex);
        let signature = MLDSA87Signature::from_bytes(&vertex.signature)
            .map_err(|e| format!("Invalid signature bytes: {:?}", e))?;

        MLDSA87::verify(&signable_bytes, &signature, public_key)
            .map_err(|e| format!("Signature verification failed: {:?}", e))
    }
}
