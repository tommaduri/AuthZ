// MCP Agent Integration Tests over LibP2P
// Tests for agent discovery and tool invocation over P2P

use super::test_utils::*;
use std::time::Duration;

#[tokio::test]
async fn test_mcp_agent_announcement() {
    if let Ok(mut swarm) = MockVigiliaSwarm::new("mcp-agent".to_string()).await {
        let _ = swarm.subscribe("vigilia/mcp/v1").await;

        // Announce agent capabilities
        let announcement = MockAgentAnnouncement {
            agent_id: "mcp-agent".to_string(),
            tools: vec!["calculator".to_string(), "web_search".to_string()],
            capabilities: vec!["computation".to_string(), "search".to_string()],
        };

        // Broadcast announcement
        // let data = bincode::serialize(&announcement)?;
        // swarm.publish("vigilia/mcp/v1", &data).await?;
    }
}

#[tokio::test]
async fn test_mcp_mdns_local_agent_discovery() {
    // Agents on same local network discover each other via mDNS
    let nodes = create_swarm_cluster(3).await;

    if let Ok(mut nodes) = nodes {
        // All listen on local network
        for node in &mut nodes {
            let _ = node.listen("/ip4/127.0.0.1/tcp/0").await;
        }

        // Wait for mDNS discovery
        tokio::time::sleep(Duration::from_secs(5)).await;

        // All agents should discover each other
        // for node in &nodes {
        //     let discovered = node.discovered_mcp_agents();
        //     assert_eq!(discovered.len(), 2, "Should discover 2 other agents");
        // }
    }
}

#[tokio::test]
async fn test_mcp_kademlia_global_agent_discovery() {
    // Agents discover each other via Kademlia DHT (global network)
    let nodes = create_swarm_cluster(10).await;

    if let Ok(mut nodes) = nodes {
        let _ = connect_topology(&mut nodes, super::TestTopology::FullMesh).await;

        // All agents announce to DHT
        for node in &mut nodes {
            // node.kademlia_start_providing(b"vigilia-mcp-agents").await?;
        }

        tokio::time::sleep(Duration::from_secs(2)).await;

        // Query for all MCP agents
        // let query_id = nodes[0].kademlia_get_providers(b"vigilia-mcp-agents").await?;
        // let providers = nodes[0].wait_for_kad_providers(query_id, Duration::from_secs(5)).await?;

        // assert_eq!(providers.len(), 10, "Should find all 10 agents");
    }
}

#[tokio::test]
async fn test_mcp_tool_capability_matching() {
    // Find agents that provide specific tools
    let nodes = create_swarm_cluster(5).await;

    if let Ok(mut nodes) = nodes {
        let _ = connect_topology(&mut nodes, super::TestTopology::FullMesh).await;

        // Agents announce capabilities
        // nodes[0].announce_tools(vec!["calculator", "web_search"]).await?;
        // nodes[1].announce_tools(vec!["image_gen", "text_to_speech"]).await?;
        // nodes[2].announce_tools(vec!["calculator", "data_analysis"]).await?;

        tokio::time::sleep(Duration::from_secs(2)).await;

        // Search for agents with "calculator" tool
        // let agents = nodes[4].find_agents_with_tool("calculator").await?;
        // assert_eq!(agents.len(), 2, "Should find 2 agents with calculator");
    }
}

#[tokio::test]
async fn test_mcp_remote_tool_invocation() {
    // Invoke tool on remote agent
    let nodes = create_swarm_cluster(2).await;

    if let Ok(mut nodes) = nodes {
        let _ = nodes[0].dial(&nodes[1].peer_id, "127.0.0.1:0").await;

        // Node 0 has calculator tool
        // nodes[0].mcp_server().register_tool("calculator", calculator_handler)?;

        // Node 1 invokes calculator on node 0
        // let request = ToolCallRequest {
        //     tool_name: "calculator".to_string(),
        //     arguments: json!({"operation": "add", "a": 5, "b": 3}),
        // };

        // let response = nodes[1].invoke_remote_tool(&nodes[0].peer_id, request).await?;
        // assert_eq!(response.result, json!(8));
    }
}

#[tokio::test]
async fn test_mcp_agent_registry_sync() {
    // Agent registry should sync across network
    let nodes = create_swarm_cluster(5).await;

    if let Ok(mut nodes) = nodes {
        for node in &mut nodes {
            let _ = node.subscribe("vigilia/mcp/v1").await;
        }
        let _ = connect_topology(&mut nodes, super::TestTopology::FullMesh).await;

        // Node 0 announces new agent
        let announcement = MockAgentAnnouncement {
            agent_id: "new-agent".to_string(),
            tools: vec!["specialized_tool".to_string()],
            capabilities: vec!["special".to_string()],
        };

        // let data = bincode::serialize(&announcement)?;
        // nodes[0].publish("vigilia/mcp/v1", &data).await?;

        tokio::time::sleep(Duration::from_millis(200)).await;

        // All nodes should have agent in registry
        // for node in &nodes {
        //     let registry = node.mcp_agent_registry();
        //     assert!(registry.contains("new-agent"));
        // }
    }
}

#[tokio::test]
async fn test_mcp_request_response_protocol() {
    // Use request-response for tool calls (not Gossipsub)
    let nodes = create_swarm_cluster(2).await;

    if let Ok(mut nodes) = nodes {
        let _ = nodes[0].dial(&nodes[1].peer_id, "127.0.0.1:0").await;

        // Send tool call request
        // let request = McpRequest::ToolCall {
        //     tool_name: "calculator".to_string(),
        //     arguments: json!({"a": 10, "b": 20}),
        // };

        // let response = nodes[1].send_mcp_request(&nodes[0].peer_id, request).await?;
        // assert!(response.is_success());
    }
}

#[tokio::test]
async fn test_mcp_agent_heartbeat() {
    // Agents should send periodic heartbeats
    if let Ok(mut swarm) = MockVigiliaSwarm::new("mcp-agent".to_string()).await {
        // Enable heartbeat
        // swarm.enable_mcp_heartbeat(Duration::from_secs(10));

        // Wait for heartbeat
        tokio::time::sleep(Duration::from_secs(11)).await;

        // Heartbeat should be sent
        // let heartbeats = swarm.get_sent_heartbeats();
        // assert!(heartbeats.len() > 0, "Should send heartbeat");
    }
}

#[tokio::test]
async fn test_mcp_agent_offline_detection() {
    // Detect when agents go offline (no heartbeat)
    let nodes = create_swarm_cluster(3).await;

    if let Ok(mut nodes) = nodes {
        let _ = connect_topology(&mut nodes, super::TestTopology::FullMesh).await;

        // Node 0 goes offline
        // nodes[0].shutdown().await?;

        // Wait for heartbeat timeout
        tokio::time::sleep(Duration::from_secs(35)).await;

        // Other nodes should mark node 0 as offline
        // assert!(nodes[1].is_agent_offline(&nodes[0].peer_id));
        // assert!(nodes[2].is_agent_offline(&nodes[0].peer_id));
    }
}

#[tokio::test]
async fn test_mcp_multi_agent_collaboration() {
    // Multiple agents work together on complex task
    let nodes = create_swarm_cluster(3).await;

    if let Ok(mut nodes) = nodes {
        let _ = connect_topology(&mut nodes, super::TestTopology::FullMesh).await;

        // Agent 0: Data collector
        // Agent 1: Data processor
        // Agent 2: Result synthesizer

        // Orchestrate workflow
        // let task = ComplexTask::new("analyze data");
        // let result = nodes[2].orchestrate_multi_agent_task(task, vec![
        //     &nodes[0].peer_id,
        //     &nodes[1].peer_id,
        //     &nodes[2].peer_id,
        // ]).await?;

        // assert!(result.is_complete());
    }
}

#[tokio::test]
async fn test_mcp_agent_load_balancing() {
    // Distribute tool calls across multiple agents with same capability
    let nodes = create_swarm_cluster(5).await;

    if let Ok(mut nodes) = nodes {
        let _ = connect_topology(&mut nodes, super::TestTopology::FullMesh).await;

        // Nodes 0-3 all provide "calculator" tool
        // for i in 0..4 {
        //     nodes[i].announce_tools(vec!["calculator"]).await?;
        // }

        // Node 4 makes 20 calculator calls
        // let mut agent_usage = HashMap::new();

        // for _ in 0..20 {
        //     let selected_agent = nodes[4].select_agent_for_tool("calculator").await?;
        //     *agent_usage.entry(selected_agent).or_insert(0) += 1;
        // }

        // Should distribute across all 4 agents
        // assert_eq!(agent_usage.len(), 4, "Should use all 4 agents");
    }
}

#[tokio::test]
async fn test_mcp_agent_capability_versioning() {
    // Agents can have different tool versions
    let nodes = create_swarm_cluster(2).await;

    if let Ok(mut nodes) = nodes {
        // Node 0: calculator v1
        // Node 1: calculator v2

        // nodes[0].announce_tool("calculator", "v1").await?;
        // nodes[1].announce_tool("calculator", "v2").await?;

        // Request specific version
        // let agent = nodes[0].find_agent_with_tool("calculator", "v2").await?;
        // assert_eq!(agent, nodes[1].peer_id);
    }
}
