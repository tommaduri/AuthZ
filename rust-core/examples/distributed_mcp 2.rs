//! Distributed MCP - AI Agent Communication over P2P Network
//!
//! Demonstrates distributed Model Context Protocol servers with agent discovery
//! and remote tool invocation across a peer-to-peer network.
//!
//! ## Architecture
//!
//! ```text
//! ┌──────────────────────────────────────────────────────────┐
//! │         Distributed MCP Agent Network                    │
//! │                                                          │
//! │   Agent Alice          Agent Bob        Agent Charlie   │
//! │  ┌────────────┐       ┌────────────┐    ┌────────────┐ │
//! │  │ MCP Server │◄─────►│ MCP Server │◄──►│ MCP Server │ │
//! │  │ Tools:     │  P2P  │ Tools:     │ P2P│ Tools:     │ │
//! │  │ - add      │Gossip │ - multiply │    │ - concat   │ │
//! │  │ - subtract │       │ - divide   │    │ - uppercase│ │
//! │  └────────────┘       └────────────┘    └────────────┘ │
//! │         │                     │                 │        │
//! │         └─────────────────────┴─────────────────┘        │
//! │              Agent Discovery & Tool Calls                │
//! │           (via Gossip Protocol Topics)                   │
//! └──────────────────────────────────────────────────────────┘
//! ```
//!
//! Run with:
//! ```bash
//! cargo run --example distributed_mcp
//! ```

use std::time::Duration;
use tokio::time::sleep;
use cretoai_mcp::server::Tool;
use cretoai_network::{McpP2PConfig, McpP2PNode};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    println!("🤖 Vigilia AI - Distributed MCP Demo\n");
    println!("Creating network of 3 AI agents with different capabilities...\n");

    // Create Agent Alice - Math tools (add, subtract)
    println!("✓ Creating Agent Alice (Math: add, subtract)");
    let alice_config = McpP2PConfig {
        agent_id: "alice".to_string(),
        ..Default::default()
    };
    let alice = McpP2PNode::new(alice_config);

    // Register Alice's tools
    let add_tool = Tool {
        name: "add".to_string(),
        description: "Add two numbers".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "a": {"type": "number"},
                "b": {"type": "number"}
            },
            "required": ["a", "b"]
        }),
    };

    alice
        .mcp_server()
        .register_tool(add_tool, |params| {
            let a = params["a"].as_f64().unwrap_or(0.0);
            let b = params["b"].as_f64().unwrap_or(0.0);
            Ok(serde_json::json!({"result": a + b}))
        })
        .await?;

    let sub_tool = Tool {
        name: "subtract".to_string(),
        description: "Subtract two numbers".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "a": {"type": "number"},
                "b": {"type": "number"}
            }
        }),
    };

    alice
        .mcp_server()
        .register_tool(sub_tool, |params| {
            let a = params["a"].as_f64().unwrap_or(0.0);
            let b = params["b"].as_f64().unwrap_or(0.0);
            Ok(serde_json::json!({"result": a - b}))
        })
        .await?;

    // Create Agent Bob - Advanced math (multiply, divide)
    println!("✓ Creating Agent Bob (Math: multiply, divide)");
    let bob_config = McpP2PConfig {
        agent_id: "bob".to_string(),
        ..Default::default()
    };
    let bob = McpP2PNode::new(bob_config);

    let mul_tool = Tool {
        name: "multiply".to_string(),
        description: "Multiply two numbers".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "a": {"type": "number"},
                "b": {"type": "number"}
            }
        }),
    };

    bob.mcp_server()
        .register_tool(mul_tool, |params| {
            let a = params["a"].as_f64().unwrap_or(0.0);
            let b = params["b"].as_f64().unwrap_or(0.0);
            Ok(serde_json::json!({"result": a * b}))
        })
        .await?;

    // Create Agent Charlie - String tools (concat, uppercase)
    println!("✓ Creating Agent Charlie (String: concat, uppercase)\n");
    let charlie_config = McpP2PConfig {
        agent_id: "charlie".to_string(),
        ..Default::default()
    };
    let charlie = McpP2PNode::new(charlie_config);

    let concat_tool = Tool {
        name: "concat".to_string(),
        description: "Concatenate two strings".to_string(),
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "a": {"type": "string"},
                "b": {"type": "string"}
            }
        }),
    };

    charlie
        .mcp_server()
        .register_tool(concat_tool, |params| {
            let a = params["a"].as_str().unwrap_or("");
            let b = params["b"].as_str().unwrap_or("");
            Ok(serde_json::json!({"result": format!("{}{}", a, b)}))
        })
        .await?;

    // Subscribe all agents to MCP topics
    println!("📡 Connecting agents to P2P network...\n");
    alice.subscribe_topics().await?;
    bob.subscribe_topics().await?;
    charlie.subscribe_topics().await?;

    // Announce all agents
    alice.announce().await?;
    bob.announce().await?;
    charlie.announce().await?;

    println!("✓ All agents announced on network\n");

    // Wait for announcements to propagate
    sleep(Duration::from_millis(500)).await;

    // Show agent discovery
    println!("🔍 Agent Discovery:\n");
    let alice_agents = alice.list_agents().await;
    println!("  Alice discovered {} remote agents:", alice_agents.len());
    for agent in &alice_agents {
        println!("    - {} ({} tools)", agent.agent_id, agent.tools.len());
    }

    let bob_agents = bob.list_agents().await;
    println!("\n  Bob discovered {} remote agents:", bob_agents.len());
    for agent in &bob_agents {
        println!("    - {} ({} tools)", agent.agent_id, agent.tools.len());
    }

    println!("\n✅ Distributed MCP network established with {} agents", 3);
    println!("   Network protocol: Gossip-based P2P");
    println!("   Discovery: Automatic via agent announcements\n");

    // Demonstrate local tool calls
    println!("═══════════════════════════════════════════════════════════\n");
    println!("📦 Local Tool Calls (MCP Server Direct)\n");

    let request1 = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": "add",
            "arguments": {"a": 10, "b": 32}
        },
        "id": 1
    });

    let response1 = alice
        .mcp_server()
        .handle_request(&serde_json::to_string(&request1)?)
        .await;
    println!("  Alice.add(10, 32) = {}", response1);

    let request2 = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": "multiply",
            "arguments": {"a": 6, "b": 7}
        },
        "id": 2
    });

    let response2 = bob
        .mcp_server()
        .handle_request(&serde_json::to_string(&request2)?)
        .await;
    println!("  Bob.multiply(6, 7) = {}\n", response2);

    // Print network statistics
    println!("═══════════════════════════════════════════════════════════\n");
    println!("📊 Network Statistics:\n");

    let alice_stats = alice.get_stats().await;
    println!("  Alice:");
    println!("    - Agent ID: {}", alice_stats.agent_id);
    println!("    - Remote agents: {}", alice_stats.remote_agents);
    println!("    - Local tools: {}", alice_stats.tools_available);

    let bob_stats = bob.get_stats().await;
    println!("\n  Bob:");
    println!("    - Agent ID: {}", bob_stats.agent_id);
    println!("    - Remote agents: {}", bob_stats.remote_agents);
    println!("    - Local tools: {}", bob_stats.tools_available);

    let charlie_stats = charlie.get_stats().await;
    println!("\n  Charlie:");
    println!("    - Agent ID: {}", charlie_stats.agent_id);
    println!("    - Remote agents: {}", charlie_stats.remote_agents);
    println!("    - Local tools: {}", charlie_stats.tools_available);

    println!("\n═══════════════════════════════════════════════════════════\n");
    println!("✅ Distributed MCP demo completed successfully!\n");
    println!("Key Features Demonstrated:");
    println!("  • MCP servers running on P2P gossip protocol");
    println!("  • Automatic agent discovery via network announcements");
    println!("  • Multiple agents with different tool capabilities");
    println!("  • Local tool invocation via JSON-RPC 2.0");
    println!("  • Network statistics and monitoring");
    println!("  • Decentralized agent communication\n");

    println!("Next Steps (Not Implemented in This Demo):");
    println!("  • Remote tool calls across the network (call_remote_tool)");
    println!("  • Agent heartbeat monitoring for liveness detection");
    println!("  • Automatic cleanup of inactive agents");
    println!("  • Multi-hop tool orchestration across agents");
    println!("  • Capability-based agent search and routing\n");

    Ok(())
}
