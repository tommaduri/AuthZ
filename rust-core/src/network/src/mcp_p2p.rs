//! MCP over P2P Transport
//!
//! Distributed Model Context Protocol server using gossip protocol for agent discovery
//! and remote tool invocation across the network.
//!
//! ## Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────┐
//! │          Distributed MCP Network                        │
//! │                                                         │
//! │  Agent 1 (Alice)        Agent 2 (Bob)      Agent 3 (Charlie) │
//! │  ┌──────────────┐      ┌──────────────┐   ┌──────────────┐  │
//! │  │ MCP Server   │◄────►│ MCP Server   │◄─►│ MCP Server   │  │
//! │  │ + Gossip     │      │ + Gossip     │   │ + Gossip     │  │
//! │  └──────────────┘      └──────────────┘   └──────────────┘  │
//! │         │                     │                   │          │
//! │         └─────────────────────┴───────────────────┘          │
//! │              Gossip Protocol (agent discovery,               │
//! │               tool calls, responses)                         │
//! └─────────────────────────────────────────────────────────────┘
//! ```

use crate::error::{NetworkError, Result};
use crate::gossip::{GossipConfig, GossipProtocol, Message, TopicHash};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::SystemTime;
use tokio::sync::RwLock;
use cretoai_mcp::server::{JsonRpcRequest, JsonRpcResponse, McpServer, McpServerConfig, Tool};

/// MCP P2P configuration
#[derive(Debug, Clone)]
pub struct McpP2PConfig {
    /// Agent ID for this MCP server
    pub agent_id: String,

    /// MCP server configuration
    pub mcp_config: McpServerConfig,

    /// Gossip protocol configuration
    pub gossip_config: GossipConfig,

    /// Agent announcement interval (seconds)
    pub announce_interval: u64,

    /// Agent timeout (seconds) - remove inactive agents
    pub agent_timeout: u64,
}

impl Default for McpP2PConfig {
    fn default() -> Self {
        Self {
            agent_id: format!("agent-{}", uuid::Uuid::new_v4()),
            mcp_config: McpServerConfig::default(),
            gossip_config: GossipConfig::default(),
            announce_interval: 30,
            agent_timeout: 120,
        }
    }
}

/// MCP message types for P2P communication
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum McpMessage {
    /// Agent announcement (capabilities, tools)
    AgentAnnouncement(AgentAnnouncement),

    /// Remote tool call request
    ToolCallRequest(ToolCallRequest),

    /// Remote tool call response
    ToolCallResponse(ToolCallResponse),

    /// Agent heartbeat (keep-alive)
    Heartbeat(AgentHeartbeat),
}

/// Agent announcement message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentAnnouncement {
    /// Agent ID
    pub agent_id: String,

    /// Agent name
    pub agent_name: String,

    /// Available tools
    pub tools: Vec<Tool>,

    /// Agent capabilities (tags)
    pub capabilities: Vec<String>,

    /// Timestamp
    pub timestamp: u64,
}

/// Remote tool call request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallRequest {
    /// Request ID (for matching responses)
    pub request_id: String,

    /// Source agent ID
    pub from_agent: String,

    /// Target agent ID
    pub to_agent: String,

    /// JSON-RPC request
    pub request: JsonRpcRequest,

    /// Timestamp
    pub timestamp: u64,
}

/// Remote tool call response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallResponse {
    /// Request ID (matches ToolCallRequest.request_id)
    pub request_id: String,

    /// JSON-RPC response
    pub response: JsonRpcResponse,

    /// Timestamp
    pub timestamp: u64,
}

/// Agent heartbeat
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentHeartbeat {
    /// Agent ID
    pub agent_id: String,

    /// Timestamp
    pub timestamp: u64,
}

/// Remote agent information
#[derive(Debug, Clone)]
pub struct RemoteAgent {
    /// Agent ID
    pub agent_id: String,

    /// Agent name
    pub agent_name: String,

    /// Available tools
    pub tools: Vec<Tool>,

    /// Capabilities
    pub capabilities: Vec<String>,

    /// Last seen timestamp
    pub last_seen: SystemTime,
}

/// MCP P2P node - distributed MCP server with agent discovery
pub struct McpP2PNode {
    /// Configuration
    config: McpP2PConfig,

    /// Local MCP server
    mcp_server: Arc<McpServer>,

    /// Gossip protocol for P2P communication
    gossip: Arc<RwLock<GossipProtocol>>,

    /// Remote agent registry
    agents: Arc<RwLock<HashMap<String, RemoteAgent>>>,

    /// Pending remote tool calls (request_id → response channel)
    pending_calls: Arc<RwLock<HashMap<String, tokio::sync::oneshot::Sender<ToolCallResponse>>>>,
}

impl McpP2PNode {
    /// Create a new MCP P2P node
    pub fn new(config: McpP2PConfig) -> Self {
        let mcp_server = Arc::new(McpServer::new(config.mcp_config.clone()));
        let gossip = Arc::new(RwLock::new(GossipProtocol::new(config.agent_id.clone())));

        Self {
            config,
            mcp_server,
            gossip,
            agents: Arc::new(RwLock::new(HashMap::new())),
            pending_calls: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Get local MCP server for tool/resource registration
    pub fn mcp_server(&self) -> Arc<McpServer> {
        Arc::clone(&self.mcp_server)
    }

    /// Subscribe to MCP topics
    pub async fn subscribe_topics(&self) -> Result<()> {
        let mut gossip = self.gossip.write().await;

        // Subscribe to agent announcements topic
        gossip.subscribe("mcp/announcements".to_string())?;

        // Subscribe to tool call requests for this agent
        gossip.subscribe(format!("mcp/calls/{}", self.config.agent_id))?;

        // Subscribe to tool call responses for this agent
        gossip.subscribe(format!("mcp/responses/{}", self.config.agent_id))?;

        // Subscribe to heartbeats
        gossip.subscribe("mcp/heartbeats".to_string())?;

        Ok(())
    }

    /// Announce this agent to the network
    pub async fn announce(&self) -> Result<()> {
        let tools = self.mcp_server.list_tools().await;

        let announcement = McpMessage::AgentAnnouncement(AgentAnnouncement {
            agent_id: self.config.agent_id.clone(),
            agent_name: self.config.mcp_config.name.clone(),
            tools,
            capabilities: vec!["mcp".to_string(), "distributed".to_string()],
            timestamp: SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        });

        self.publish_message("mcp/announcements", &announcement).await
    }

    /// Send heartbeat
    pub async fn heartbeat(&self) -> Result<()> {
        let heartbeat = McpMessage::Heartbeat(AgentHeartbeat {
            agent_id: self.config.agent_id.clone(),
            timestamp: SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        });

        self.publish_message("mcp/heartbeats", &heartbeat).await
    }

    /// Call a tool on a remote agent
    pub async fn call_remote_tool(
        &self,
        target_agent: &str,
        tool_name: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value> {
        let request_id = format!("req-{}", uuid::Uuid::new_v4());

        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            method: "tools/call".to_string(),
            params: Some(serde_json::json!({
                "name": tool_name,
                "arguments": params
            })),
            id: Some(serde_json::Value::String(request_id.clone())),
        };

        let tool_call = McpMessage::ToolCallRequest(ToolCallRequest {
            request_id: request_id.clone(),
            from_agent: self.config.agent_id.clone(),
            to_agent: target_agent.to_string(),
            request,
            timestamp: SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        });

        // Create response channel
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.pending_calls.write().await.insert(request_id, tx);

        // Send request
        let topic = format!("mcp/calls/{}", target_agent);
        self.publish_message(&topic, &tool_call).await?;

        // Wait for response with timeout
        let response = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            rx,
        )
        .await
        .map_err(|_| NetworkError::Timeout)?
        .map_err(|_| NetworkError::Transport("Response channel closed".to_string()))?;

        // Extract result from JSON-RPC response
        if let Some(result) = response.response.result {
            Ok(result)
        } else if let Some(error) = response.response.error {
            Err(NetworkError::Protocol(format!("Remote error: {}", error.message)))
        } else {
            Err(NetworkError::Protocol("Empty response".to_string()))
        }
    }

    /// Handle incoming MCP messages
    pub async fn handle_message(&self, _topic: &TopicHash, message: &Message) -> Result<()> {
        // Deserialize MCP message
        let mcp_message: McpMessage = serde_json::from_slice(&message.data)
            .map_err(|e| NetworkError::Protocol(format!("Invalid MCP message: {}", e)))?;

        match mcp_message {
            McpMessage::AgentAnnouncement(announcement) => {
                self.handle_announcement(announcement).await
            }
            McpMessage::ToolCallRequest(request) => {
                self.handle_tool_call_request(request).await
            }
            McpMessage::ToolCallResponse(response) => {
                self.handle_tool_call_response(response).await
            }
            McpMessage::Heartbeat(heartbeat) => {
                self.handle_heartbeat(heartbeat).await
            }
        }
    }

    /// Handle agent announcement
    async fn handle_announcement(&self, announcement: AgentAnnouncement) -> Result<()> {
        // Don't register self
        if announcement.agent_id == self.config.agent_id {
            return Ok(());
        }

        let remote_agent = RemoteAgent {
            agent_id: announcement.agent_id.clone(),
            agent_name: announcement.agent_name,
            tools: announcement.tools,
            capabilities: announcement.capabilities,
            last_seen: SystemTime::now(),
        };

        let mut agents = self.agents.write().await;
        agents.insert(announcement.agent_id, remote_agent);

        Ok(())
    }

    /// Handle tool call request
    async fn handle_tool_call_request(&self, request: ToolCallRequest) -> Result<()> {
        // Verify this request is for us
        if request.to_agent != self.config.agent_id {
            return Ok(()); // Not for us, ignore
        }

        // Handle the request locally
        let request_str = serde_json::to_string(&request.request)
            .map_err(|e| NetworkError::Protocol(format!("Serialization error: {}", e)))?;

        let response_str = self.mcp_server.handle_request(&request_str).await;

        let response: JsonRpcResponse = serde_json::from_str(&response_str)
            .map_err(|e| NetworkError::Protocol(format!("Invalid response: {}", e)))?;

        // Send response back
        let tool_response = McpMessage::ToolCallResponse(ToolCallResponse {
            request_id: request.request_id,
            response,
            timestamp: SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        });

        let topic = format!("mcp/responses/{}", request.from_agent);
        self.publish_message(&topic, &tool_response).await
    }

    /// Handle tool call response
    async fn handle_tool_call_response(&self, response: ToolCallResponse) -> Result<()> {
        // Find pending call
        let mut pending = self.pending_calls.write().await;
        if let Some(tx) = pending.remove(&response.request_id) {
            // Send response through channel (ignore if receiver dropped)
            let _ = tx.send(response);
        }

        Ok(())
    }

    /// Handle heartbeat
    async fn handle_heartbeat(&self, heartbeat: AgentHeartbeat) -> Result<()> {
        let mut agents = self.agents.write().await;
        if let Some(agent) = agents.get_mut(&heartbeat.agent_id) {
            agent.last_seen = SystemTime::now();
        }

        Ok(())
    }

    /// Publish MCP message to topic
    async fn publish_message(&self, topic: &str, message: &McpMessage) -> Result<()> {
        let data = serde_json::to_vec(message)
            .map_err(|e| NetworkError::Protocol(format!("Serialization error: {}", e)))?;

        let mut gossip = self.gossip.write().await;
        gossip.publish(topic.to_string(), data, vec![])?;

        Ok(())
    }

    /// List all discovered remote agents
    pub async fn list_agents(&self) -> Vec<RemoteAgent> {
        let agents = self.agents.read().await;
        agents.values().cloned().collect()
    }

    /// Search for agents by capability
    pub async fn search_agents(&self, capability: &str) -> Vec<RemoteAgent> {
        let agents = self.agents.read().await;
        agents
            .values()
            .filter(|agent| agent.capabilities.contains(&capability.to_string()))
            .cloned()
            .collect()
    }

    /// Cleanup inactive agents
    pub async fn cleanup_inactive_agents(&self) -> Result<usize> {
        let timeout_duration = std::time::Duration::from_secs(self.config.agent_timeout);
        let now = SystemTime::now();

        let mut agents = self.agents.write().await;
        let before_count = agents.len();

        agents.retain(|_, agent| {
            now.duration_since(agent.last_seen)
                .map(|d| d < timeout_duration)
                .unwrap_or(false)
        });

        let removed = before_count - agents.len();
        Ok(removed)
    }

    /// Get network statistics
    pub async fn get_stats(&self) -> McpP2PStats {
        let agents = self.agents.read().await;
        let pending = self.pending_calls.read().await;

        McpP2PStats {
            agent_id: self.config.agent_id.clone(),
            remote_agents: agents.len(),
            pending_calls: pending.len(),
            tools_available: self.mcp_server.list_tools().await.len(),
        }
    }
}

/// MCP P2P statistics
#[derive(Debug, Clone)]
pub struct McpP2PStats {
    /// This agent's ID
    pub agent_id: String,

    /// Number of discovered remote agents
    pub remote_agents: usize,

    /// Number of pending remote tool calls
    pub pending_calls: usize,

    /// Number of tools available locally
    pub tools_available: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_mcp_p2p_node_creation() {
        let config = McpP2PConfig::default();
        let node = McpP2PNode::new(config);

        assert!(node.mcp_server.list_tools().await.is_empty());
    }

    #[tokio::test]
    async fn test_subscribe_topics() {
        let config = McpP2PConfig {
            agent_id: "test-agent".to_string(),
            ..Default::default()
        };

        let node = McpP2PNode::new(config);
        let result = node.subscribe_topics().await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_agent_announcement() {
        let config = McpP2PConfig {
            agent_id: "alice".to_string(),
            ..Default::default()
        };

        let node = McpP2PNode::new(config);
        node.subscribe_topics().await.unwrap();

        let result = node.announce().await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_heartbeat() {
        let config = McpP2PConfig::default();
        let node = McpP2PNode::new(config);

        node.subscribe_topics().await.unwrap();
        let result = node.heartbeat().await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_list_agents() {
        let config = McpP2PConfig::default();
        let node = McpP2PNode::new(config);

        let agents = node.list_agents().await;
        assert_eq!(agents.len(), 0);
    }

    #[tokio::test]
    async fn test_cleanup_inactive_agents() {
        let config = McpP2PConfig::default();
        let node = McpP2PNode::new(config);

        let removed = node.cleanup_inactive_agents().await.unwrap();
        assert_eq!(removed, 0);
    }

    #[tokio::test]
    async fn test_get_stats() {
        let config = McpP2PConfig {
            agent_id: "test-agent".to_string(),
            ..Default::default()
        };

        let node = McpP2PNode::new(config);
        let stats = node.get_stats().await;

        assert_eq!(stats.agent_id, "test-agent");
        assert_eq!(stats.remote_agents, 0);
        assert_eq!(stats.pending_calls, 0);
    }
}
