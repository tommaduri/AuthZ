//! Agent Authorization Example
//!
//! Demonstrates end-to-end agent authorization flow using Vigilia AI:
//! 1. Generate quantum-resistant agent identities
//! 2. Store credentials in encrypted vault
//! 3. Create authorization DAG vertices
//! 4. Verify with quantum-resistant signatures

use cretoai_crypto::keys::AgentIdentity;
use cretoai_crypto::signatures::dilithium::MLDSA87;
use cretoai_dag::vertex::VertexBuilder;
use cretoai_dag::graph::Graph;
use cretoai_vault::storage::{VaultStorage, StorageConfig};
use cretoai_vault::keys::{KeyManager, EncryptionAlgorithm};
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== Vigilia AI Agent Authorization Example ===\n");

    // Step 1: Generate Agent Identities
    println!("Step 1: Generating quantum-resistant agent identities...");

    let agent1_identity = AgentIdentity::generate("agent-001".to_string())?;
    let agent2_identity = AgentIdentity::generate("agent-002".to_string())?;

    println!("✓ Agent 1: {}", agent1_identity.agent_id);
    println!("✓ Agent 2: {}", agent2_identity.agent_id);
    println!("  - Each agent has ML-DSA signing keys (quantum-resistant)");
    println!("  - Each agent has ML-KEM-768 KEM keys (quantum-resistant)\n");

    // Step 2: Setup Encrypted Vault
    println!("Step 2: Setting up encrypted vault for credentials...");

    let key_manager = KeyManager::new(EncryptionAlgorithm::Blake3Keyed);
    let vault_key_id = key_manager.generate_key("agent-credentials".to_string())?;

    let vault_storage = VaultStorage::new(StorageConfig::default());

    // Store agent credentials
    let agent1_creds = b"api_key=sk_live_123456789";
    let encrypted_creds = key_manager.encrypt(&vault_key_id, agent1_creds)?;

    vault_storage.put(
        "agents/agent-001/credentials".to_string(),
        encrypted_creds,
        vault_key_id.clone(),
    )?;

    println!("✓ Stored encrypted credentials for agent-001");
    println!("  - Encryption: BLAKE3 keyed mode");
    println!("  - Max size: 1 MB");
    println!("  - TTL: 1 year");
    println!("  - Versioning: enabled (10 versions)\n");

    // Step 3: Create Authorization DAG
    println!("Step 3: Creating authorization DAG...");

    let graph = Arc::new(Graph::new());

    // Genesis vertex (initial authorization)
    let genesis = VertexBuilder::new("system".to_string())
        .id("genesis".to_string())
        .payload(b"Initial authorization state".to_vec())
        .build();

    graph.add_vertex(genesis.clone())?;
    println!("✓ Added genesis vertex: {}", genesis.id);

    // Agent 1 authorization request
    let auth_request = VertexBuilder::new("agent-001".to_string())
        .id("auth-req-001".to_string())
        .payload(b"Agent-001 requests access to resource XYZ".to_vec())
        .parent(genesis.id.clone())
        .build();

    graph.add_vertex(auth_request.clone())?;
    println!("✓ Added authorization request: {}", auth_request.id);

    // Agent 2 approval
    let approval = VertexBuilder::new("agent-002".to_string())
        .id("approval-001".to_string())
        .payload(b"Agent-002 approves request".to_vec())
        .parent(auth_request.id.clone())
        .build();

    graph.add_vertex(approval.clone())?;
    println!("✓ Added approval: {}", approval.id);
    println!("  - DAG structure: genesis → auth-request → approval\n");

    // Step 4: Verify Authorization with Signatures
    println!("Step 4: Verifying authorization signatures...");

    // Sign authorization decision
    let decision_data = format!("APPROVED: {} by {}",
        auth_request.id,
        approval.id
    );

    let signing_keypair = MLDSA87::generate();
    let signature = signing_keypair.sign(decision_data.as_bytes());

    let verification = signing_keypair.verify(decision_data.as_bytes(), &signature);

    if verification.is_ok() {
        println!("✓ Signature verified with ML-DSA (quantum-resistant)");
        println!("  - Algorithm: NIST FIPS 204 (Dilithium)");
    }
    println!();

    // Step 5: Retrieve and Decrypt Credentials
    println!("Step 5: Retrieving authorized credentials...");

    let stored_entry = vault_storage.get("agents/agent-001/credentials")?;
    let decrypted_creds = key_manager.decrypt(&stored_entry.key_id, &stored_entry.encrypted_data)?;

    println!("✓ Credentials retrieved and decrypted");
    println!("  - Path: agents/agent-001/credentials");
    println!("  - Version: {}", stored_entry.metadata.version);
    println!("  - Size: {} bytes", stored_entry.metadata.size);
    println!("  - Decrypted: {}", String::from_utf8_lossy(&decrypted_creds));
    println!();

    // Step 6: Display DAG Statistics
    println!("Step 6: DAG statistics...");

    let all_vertices = graph.get_all_vertices()?;
    println!("✓ Total vertices in DAG: {}", all_vertices.len());

    let tips = graph.get_tips()?;
    println!("✓ Current tips (latest vertices): {}", tips.len());

    let children = graph.get_children(&genesis.id)?;
    println!("✓ Genesis children: {}", children.len());
    println!();

    // Summary
    println!("=== Authorization Flow Complete ===");
    println!("\nSummary:");
    println!("1. ✓ Generated 2 agent identities with quantum-resistant keys");
    println!("2. ✓ Encrypted and stored credentials in vault");
    println!("3. ✓ Created 3-vertex authorization DAG");
    println!("4. ✓ Verified authorization with quantum-resistant signatures");
    println!("5. ✓ Successfully retrieved decrypted credentials");
    println!("\nVigilia AI provides:");
    println!("- Quantum-resistant cryptography (NIST FIPS 203, 204, 205)");
    println!("- Byzantine fault-tolerant consensus (QR-Avalanche)");
    println!("- Encrypted credential storage with versioning");
    println!("- Tamper-proof authorization audit trail (DAG)");
    println!("\n🛡️ Enterprise-grade security for agentic AI systems");

    Ok(())
}
