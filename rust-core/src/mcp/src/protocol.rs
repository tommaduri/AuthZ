//! MCP Protocol Message Types
//!
//! Defines the core message types for the Model Context Protocol over QUIC.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// MCP Protocol version
pub const MCP_PROTOCOL_VERSION: &str = "2024.11";

/// Message types in the MCP protocol
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum McpMessage {
    /// Initialize connection
    Initialize(InitializeRequest),
    /// Initialize response
    InitializeResponse(InitializeResponse),

    /// Tool call request
    ToolCall(ToolCallRequest),
    /// Tool call response
    ToolCallResponse(ToolCallResponse),

    /// Resource read request
    ResourceRead(ResourceReadRequest),
    /// Resource read response
    ResourceReadResponse(ResourceReadResponse),

    /// Context update
    ContextUpdate(ContextUpdateMessage),
    /// Context query
    ContextQuery(ContextQueryMessage),
    /// Context response
    ContextResponse(ContextResponseMessage),

    /// Prompt execution request
    PromptExecute(PromptExecuteRequest),
    /// Prompt execution response
    PromptExecuteResponse(PromptExecuteResponse),

    /// Error message
    Error(ErrorMessage),

    /// Heartbeat/ping
    Ping(PingMessage),
    /// Pong response
    Pong(PongMessage),
}

impl McpMessage {
    /// Get the message ID
    pub fn message_id(&self) -> &str {
        match self {
            Self::Initialize(msg) => &msg.id,
            Self::InitializeResponse(msg) => &msg.id,
            Self::ToolCall(msg) => &msg.id,
            Self::ToolCallResponse(msg) => &msg.id,
            Self::ResourceRead(msg) => &msg.id,
            Self::ResourceReadResponse(msg) => &msg.id,
            Self::ContextUpdate(msg) => &msg.id,
            Self::ContextQuery(msg) => &msg.id,
            Self::ContextResponse(msg) => &msg.id,
            Self::PromptExecute(msg) => &msg.id,
            Self::PromptExecuteResponse(msg) => &msg.id,
            Self::Error(msg) => &msg.id,
            Self::Ping(msg) => &msg.id,
            Self::Pong(msg) => &msg.id,
        }
    }
}

/// Initialize connection request
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InitializeRequest {
    pub id: String,
    pub protocol_version: String,
    pub client_info: ClientInfo,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClientInfo {
    pub name: String,
    pub version: String,
}

/// Initialize response
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InitializeResponse {
    pub id: String,
    pub protocol_version: String,
    pub server_info: ServerInfo,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServerInfo {
    pub name: String,
    pub version: String,
}

/// Tool call request
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolCallRequest {
    pub id: String,
    pub tool_name: String,
    pub arguments: serde_json::Value,
    pub context_id: Option<String>,
}

/// Tool call response
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolCallResponse {
    pub id: String,
    pub result: serde_json::Value,
    pub context_id: Option<String>,
}

/// Resource read request
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ResourceReadRequest {
    pub id: String,
    pub uri: String,
}

/// Resource read response
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ResourceReadResponse {
    pub id: String,
    pub uri: String,
    pub content: Vec<u8>,
    pub mime_type: String,
}

/// Context update message
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContextUpdateMessage {
    pub id: String,
    pub context_id: String,
    pub updates: Vec<ContextEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContextEntry {
    pub key: String,
    pub value: serde_json::Value,
    pub timestamp: i64,
}

/// Context query message
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContextQueryMessage {
    pub id: String,
    pub context_id: String,
    pub keys: Vec<String>,
}

/// Context response message
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContextResponseMessage {
    pub id: String,
    pub context_id: String,
    pub entries: Vec<ContextEntry>,
}

/// Prompt execution request
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PromptExecuteRequest {
    pub id: String,
    pub prompt: String,
    pub context_id: Option<String>,
    pub parameters: serde_json::Value,
}

/// Prompt execution response
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PromptExecuteResponse {
    pub id: String,
    pub result: String,
    pub context_id: Option<String>,
    pub metadata: serde_json::Value,
}

/// Error message
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ErrorMessage {
    pub id: String,
    pub code: i32,
    pub message: String,
    pub details: Option<serde_json::Value>,
}

impl ErrorMessage {
    pub fn new(id: String, code: i32, message: String) -> Self {
        Self {
            id,
            code,
            message,
            details: None,
        }
    }

    pub fn with_details(mut self, details: serde_json::Value) -> Self {
        self.details = Some(details);
        self
    }
}

/// Ping message
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PingMessage {
    pub id: String,
    pub timestamp: i64,
}

/// Pong message
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PongMessage {
    pub id: String,
    pub timestamp: i64,
    pub echo_timestamp: i64,
}

/// Helper to generate message IDs
pub fn generate_message_id() -> String {
    Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_serialization() {
        let msg = McpMessage::Initialize(InitializeRequest {
            id: "test-123".to_string(),
            protocol_version: MCP_PROTOCOL_VERSION.to_string(),
            client_info: ClientInfo {
                name: "TestClient".to_string(),
                version: "1.0.0".to_string(),
            },
            capabilities: vec!["tools".to_string(), "resources".to_string()],
        });

        let json = serde_json::to_string(&msg).unwrap();
        let deserialized: McpMessage = serde_json::from_str(&json).unwrap();

        assert_eq!(msg, deserialized);
    }

    #[test]
    fn test_message_id_extraction() {
        let msg = McpMessage::ToolCall(ToolCallRequest {
            id: "tool-call-456".to_string(),
            tool_name: "test_tool".to_string(),
            arguments: serde_json::json!({}),
            context_id: None,
        });

        assert_eq!(msg.message_id(), "tool-call-456");
    }

    #[test]
    fn test_error_message_builder() {
        let err = ErrorMessage::new("err-1".to_string(), 500, "Internal error".to_string())
            .with_details(serde_json::json!({"cause": "timeout"}));

        assert_eq!(err.code, 500);
        assert!(err.details.is_some());
    }
}
