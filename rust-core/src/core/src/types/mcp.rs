//! MCP protocol types

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

/// Unique identifier for an AI agent
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AgentId(pub String);

impl AgentId {
    /// Create a new agent ID
    pub fn new<S: Into<String>>(id: S) -> Self {
        AgentId(id.into())
    }

    /// Get the agent ID as a string
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for AgentId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl From<String> for AgentId {
    fn from(s: String) -> Self {
        AgentId(s)
    }
}

impl From<&str> for AgentId {
    fn from(s: &str) -> Self {
        AgentId(s.to_string())
    }
}

/// Unique identifier for an MCP message
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct MessageId(pub String);

impl MessageId {
    /// Create a new message ID
    pub fn new<S: Into<String>>(id: S) -> Self {
        MessageId(id.into())
    }

    /// Generate a random message ID
    pub fn generate() -> Self {
        MessageId(uuid::Uuid::new_v4().to_string())
    }

    /// Get the message ID as a string
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for MessageId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Information about an AI agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInfo {
    /// Agent identifier
    pub id: AgentId,
    /// Agent name
    pub name: String,
    /// Agent capabilities
    pub capabilities: Vec<String>,
    /// Agent version
    pub version: String,
    /// Additional metadata
    pub metadata: HashMap<String, String>,
}

impl AgentInfo {
    /// Create a new agent info
    pub fn new(id: AgentId, name: String, version: String) -> Self {
        AgentInfo {
            id,
            name,
            capabilities: Vec::new(),
            version,
            metadata: HashMap::new(),
        }
    }

    /// Add a capability
    pub fn with_capability(mut self, capability: String) -> Self {
        self.capabilities.push(capability);
        self
    }

    /// Add metadata
    pub fn with_metadata(mut self, key: String, value: String) -> Self {
        self.metadata.insert(key, value);
        self
    }
}

/// Definition of an MCP tool
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    /// Tool name
    pub name: String,
    /// Tool description
    pub description: String,
    /// Input schema (JSON Schema)
    pub input_schema: serde_json::Value,
    /// Output schema (JSON Schema)
    pub output_schema: Option<serde_json::Value>,
}

impl ToolDefinition {
    /// Create a new tool definition
    pub fn new(name: String, description: String, input_schema: serde_json::Value) -> Self {
        ToolDefinition {
            name,
            description,
            input_schema,
            output_schema: None,
        }
    }

    /// Set output schema
    pub fn with_output_schema(mut self, schema: serde_json::Value) -> Self {
        self.output_schema = Some(schema);
        self
    }
}

/// MCP message types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum McpMessage {
    /// Tool invocation request
    ToolCall {
        id: MessageId,
        tool_name: String,
        arguments: serde_json::Value,
    },
    /// Tool invocation response
    ToolResult {
        id: MessageId,
        result: serde_json::Value,
    },
    /// Resource request
    ResourceRequest {
        id: MessageId,
        resource_uri: String,
    },
    /// Resource response
    ResourceResponse {
        id: MessageId,
        content: Vec<u8>,
    },
    /// Context sharing
    ContextShare {
        id: MessageId,
        context: serde_json::Value,
    },
    /// Agent discovery
    AgentDiscovery {
        id: MessageId,
        query: Option<String>,
    },
    /// Agent announcement
    AgentAnnouncement {
        id: MessageId,
        agent_info: AgentInfo,
    },
    /// Error response
    Error {
        id: MessageId,
        code: i32,
        message: String,
    },
}

impl McpMessage {
    /// Get the message ID
    pub fn id(&self) -> &MessageId {
        match self {
            McpMessage::ToolCall { id, .. }
            | McpMessage::ToolResult { id, .. }
            | McpMessage::ResourceRequest { id, .. }
            | McpMessage::ResourceResponse { id, .. }
            | McpMessage::ContextShare { id, .. }
            | McpMessage::AgentDiscovery { id, .. }
            | McpMessage::AgentAnnouncement { id, .. }
            | McpMessage::Error { id, .. } => id,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_id() {
        let agent_id = AgentId::new("agent-1");
        assert_eq!(agent_id.as_str(), "agent-1");
        assert_eq!(agent_id.to_string(), "agent-1");
    }

    #[test]
    fn test_message_id() {
        let msg_id = MessageId::generate();
        assert!(!msg_id.as_str().is_empty());
    }

    #[test]
    fn test_agent_info() {
        let info = AgentInfo::new(
            AgentId::new("agent-1"),
            "Test Agent".to_string(),
            "1.0.0".to_string(),
        )
        .with_capability("code_generation".to_string())
        .with_metadata("model".to_string(), "claude-3".to_string());

        assert_eq!(info.capabilities.len(), 1);
        assert_eq!(info.metadata.len(), 1);
    }

    #[test]
    fn test_tool_definition() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "query": {"type": "string"}
            }
        });

        let tool = ToolDefinition::new(
            "search".to_string(),
            "Search the web".to_string(),
            schema,
        );

        assert_eq!(tool.name, "search");
        assert!(tool.output_schema.is_none());
    }

    #[test]
    fn test_mcp_message() {
        let msg = McpMessage::ToolCall {
            id: MessageId::generate(),
            tool_name: "calculate".to_string(),
            arguments: serde_json::json!({"x": 5, "y": 3}),
        };

        assert!(!msg.id().as_str().is_empty());
    }
}
