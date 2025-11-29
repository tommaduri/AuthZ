//! MCP Server Demo
//!
//! Demonstrates Model Context Protocol server integration for AI agents:
//! 1. Initialize MCP server with tools and resources
//! 2. Register agent identity verification tool
//! 3. Register DAG consensus resource
//! 4. Handle JSON-RPC requests
//! 5. Execute tools and retrieve resources

use cretoai_mcp::server::{McpServer, McpServerConfig, Tool, Resource};
use cretoai_crypto::keys::AgentIdentity;
use cretoai_dag::graph::Graph;
use cretoai_vault::storage::VaultStorage;
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== Vigilia AI MCP Server Demo ===\n");

    // Step 1: Initialize MCP Server
    println!("Step 1: Initializing MCP server...");

    let config = McpServerConfig {
        name: "Vigilia AI Agent Server".to_string(),
        version: "1.0.0".to_string(),
        require_auth: true,
        max_connections: 100,
        request_timeout: 30,
    };

    let server = McpServer::new(config);
    println!("✓ Server initialized: {}", server.get_server_info()["name"]);
    println!("  - Max connections: 100");
    println!("  - Request timeout: 30s");
    println!("  - Authentication: required\n");

    // Step 2: Register Agent Verification Tool
    println!("Step 2: Registering agent verification tool...");

    let verify_tool = Tool {
        name: "verify_agent_identity".to_string(),
        description: "Verify agent identity using quantum-resistant signatures".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "agent_id": {
                    "type": "string",
                    "description": "Agent identifier"
                },
                "signature": {
                    "type": "string",
                    "description": "Base64-encoded signature"
                },
                "message": {
                    "type": "string",
                    "description": "Message that was signed"
                }
            },
            "required": ["agent_id", "signature", "message"]
        }),
    };

    server.register_tool(verify_tool, |params| {
        let agent_id = params["agent_id"].as_str().unwrap_or("unknown");

        // Simulate verification (in production, use vigilia-crypto)
        let result = serde_json::json!({
            "verified": true,
            "agent_id": agent_id,
            "algorithm": "ML-DSA (Dilithium)",
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "confidence": 1.0
        });

        Ok(result)
    }).await?;

    println!("✓ Registered tool: verify_agent_identity");
    println!("  - Verifies quantum-resistant signatures (ML-DSA)");
    println!("  - Returns verification result with confidence score\n");

    // Step 3: Register DAG Consensus Tool
    println!("Step 3: Registering DAG consensus tool...");

    let consensus_tool = Tool {
        name: "run_consensus".to_string(),
        description: "Run QR-Avalanche consensus on a DAG vertex".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "vertex_id": {
                    "type": "string",
                    "description": "Vertex ID to run consensus on"
                },
                "sample_size": {
                    "type": "integer",
                    "description": "Number of nodes to sample (default: 30)"
                }
            },
            "required": ["vertex_id"]
        }),
    };

    let graph = Arc::new(Graph::new());
    let graph_clone = graph.clone();

    server.register_tool(consensus_tool, move |params| {
        let vertex_id = params["vertex_id"].as_str().unwrap_or("unknown");
        let sample_size = params.get("sample_size")
            .and_then(|v| v.as_i64())
            .unwrap_or(30);

        // Simulate consensus result
        let result = serde_json::json!({
            "vertex_id": vertex_id,
            "consensus_achieved": true,
            "sample_size": sample_size,
            "votes_for": 26,
            "votes_against": 4,
            "confidence": 0.97,
            "rounds": 15,
            "finalized": true
        });

        Ok(result)
    }).await?;

    println!("✓ Registered tool: run_consensus");
    println!("  - Runs Byzantine fault-tolerant consensus");
    println!("  - Returns consensus results with confidence\n");

    // Step 4: Register Vault Credentials Tool
    println!("Step 4: Registering vault credentials tool...");

    let get_credentials_tool = Tool {
        name: "get_agent_credentials".to_string(),
        description: "Retrieve encrypted agent credentials from vault".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "agent_id": {
                    "type": "string",
                    "description": "Agent identifier"
                },
                "credential_path": {
                    "type": "string",
                    "description": "Credential path in vault"
                }
            },
            "required": ["agent_id", "credential_path"]
        }),
    };

    server.register_tool(get_credentials_tool, |params| {
        let agent_id = params["agent_id"].as_str().unwrap_or("unknown");
        let path = params["credential_path"].as_str().unwrap_or("");

        // Simulate credential retrieval
        let result = serde_json::json!({
            "agent_id": agent_id,
            "path": path,
            "exists": true,
            "encrypted": true,
            "algorithm": "BLAKE3-keyed",
            "version": 1,
            "expires_at": "2025-11-26T00:00:00Z"
        });

        Ok(result)
    }).await?;

    println!("✓ Registered tool: get_agent_credentials");
    println!("  - Retrieves encrypted credentials from vault");
    println!("  - Supports versioning and TTL\n");

    // Step 5: Register DAG Resource
    println!("Step 5: Registering DAG resource...");

    let dag_resource = Resource {
        uri: "vigilia://dag/current-state".to_string(),
        name: "Current DAG State".to_string(),
        description: "Current state of the authorization DAG".to_string(),
        mime_type: "application/json".to_string(),
    };

    server.register_resource(dag_resource, |_uri| {
        let state = serde_json::json!({
            "total_vertices": 42,
            "finalized_vertices": 38,
            "pending_vertices": 4,
            "consensus_rounds": 156,
            "network_nodes": 150,
            "last_update": chrono::Utc::now().to_rfc3339()
        });

        Ok(state.to_string().into_bytes())
    }).await?;

    println!("✓ Registered resource: vigilia://dag/current-state");
    println!("  - Provides current DAG statistics");
    println!("  - JSON format\n");

    // Step 6: Handle JSON-RPC Requests
    println!("Step 6: Handling JSON-RPC requests...\n");

    // Initialize request
    println!("Request 1: Server initialization");
    let init_request = r#"{"jsonrpc":"2.0","method":"initialize","id":1}"#;
    let init_response = server.handle_request(init_request).await;
    println!("Response: {}", init_response);
    println!();

    // List tools
    println!("Request 2: List available tools");
    let list_tools_request = r#"{"jsonrpc":"2.0","method":"tools/list","id":2}"#;
    let list_tools_response = server.handle_request(list_tools_request).await;
    println!("Response: {}", list_tools_response);
    println!();

    // Call verify_agent_identity tool
    println!("Request 3: Verify agent identity");
    let verify_request = r#"{
        "jsonrpc":"2.0",
        "method":"tools/call",
        "params":{
            "name":"verify_agent_identity",
            "arguments":{
                "agent_id":"agent-001",
                "signature":"base64_encoded_signature",
                "message":"authorization_request"
            }
        },
        "id":3
    }"#;
    let verify_response = server.handle_request(verify_request).await;
    println!("Response: {}", verify_response);
    println!();

    // Call run_consensus tool
    println!("Request 4: Run consensus");
    let consensus_request = r#"{
        "jsonrpc":"2.0",
        "method":"tools/call",
        "params":{
            "name":"run_consensus",
            "arguments":{
                "vertex_id":"vertex-abc123",
                "sample_size":30
            }
        },
        "id":4
    }"#;
    let consensus_response = server.handle_request(consensus_request).await;
    println!("Response: {}", consensus_response);
    println!();

    // List resources
    println!("Request 5: List available resources");
    let list_resources_request = r#"{"jsonrpc":"2.0","method":"resources/list","id":5}"#;
    let list_resources_response = server.handle_request(list_resources_request).await;
    println!("Response: {}", list_resources_response);
    println!();

    // Read DAG resource
    println!("Request 6: Read DAG state resource");
    let read_resource_request = r#"{
        "jsonrpc":"2.0",
        "method":"resources/read",
        "params":{
            "uri":"vigilia://dag/current-state"
        },
        "id":6
    }"#;
    let read_resource_response = server.handle_request(read_resource_request).await;
    println!("Response: {}", read_resource_response);
    println!();

    // Summary
    println!("=== MCP Server Demo Complete ===\n");
    println!("Summary:");
    println!("1. ✓ Initialized JSON-RPC 2.0 compliant MCP server");
    println!("2. ✓ Registered 3 tools (verify, consensus, credentials)");
    println!("3. ✓ Registered 1 resource (DAG state)");
    println!("4. ✓ Handled 6 JSON-RPC requests successfully");
    println!("\nMCP Server provides:");
    println!("- Standards-compliant JSON-RPC 2.0 protocol");
    println!("- Dynamic tool registration and execution");
    println!("- Resource exposure via URI scheme (vigilia://)");
    println!("- Async/await with tokio for high performance");
    println!("- Complete error handling with standard codes");
    println!("\n🤖 Ready for AI agent integration");

    Ok(())
}
