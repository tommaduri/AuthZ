//! MCP Tools Implementation
//!
//! Tool registration, routing, and execution.

use crate::error::{McpError, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Tool definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: ToolParameters,
    pub returns: String,
}

/// Tool parameters schema
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolParameters {
    pub properties: HashMap<String, ParameterProperty>,
    pub required: Vec<String>,
}

/// Parameter property definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParameterProperty {
    #[serde(rename = "type")]
    pub param_type: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<serde_json::Value>,
}

/// Tool execution result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub success: bool,
    pub data: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ToolResult {
    pub fn success(data: serde_json::Value) -> Self {
        Self {
            success: true,
            data,
            error: None,
        }
    }

    pub fn error(message: String) -> Self {
        Self {
            success: false,
            data: serde_json::Value::Null,
            error: Some(message),
        }
    }
}

/// Tool trait for implementing custom tools
#[async_trait]
pub trait Tool: Send + Sync {
    /// Get tool definition
    fn definition(&self) -> ToolDefinition;

    /// Execute the tool
    async fn execute(&self, arguments: serde_json::Value) -> Result<ToolResult>;

    /// Validate arguments before execution
    fn validate_arguments(&self, arguments: &serde_json::Value) -> Result<()> {
        let definition = self.definition();

        // Check required parameters
        for required_param in &definition.parameters.required {
            if !arguments.get(required_param).is_some() {
                return Err(McpError::InvalidRequest(format!(
                    "Missing required parameter: {}",
                    required_param
                )));
            }
        }

        Ok(())
    }
}

/// Tool router for managing and executing tools
pub struct ToolRouter {
    tools: Arc<RwLock<HashMap<String, Arc<dyn Tool>>>>,
}

impl ToolRouter {
    /// Create a new tool router
    pub fn new() -> Self {
        Self {
            tools: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register a tool
    pub async fn register_tool(&self, tool: Arc<dyn Tool>) -> Result<()> {
        let definition = tool.definition();
        let mut tools = self.tools.write().await;

        if tools.contains_key(&definition.name) {
            return Err(McpError::Tool(format!(
                "Tool already registered: {}",
                definition.name
            )));
        }

        tools.insert(definition.name.clone(), tool);

        Ok(())
    }

    /// Unregister a tool
    pub async fn unregister_tool(&self, tool_name: &str) -> Result<()> {
        let mut tools = self.tools.write().await;
        tools
            .remove(tool_name)
            .ok_or_else(|| McpError::Tool(format!("Tool not found: {}", tool_name)))?;

        Ok(())
    }

    /// List all registered tools
    pub async fn list_tools(&self) -> Vec<ToolDefinition> {
        let tools = self.tools.read().await;
        tools
            .values()
            .map(|tool| tool.definition())
            .collect()
    }

    /// Get a specific tool definition
    pub async fn get_tool_definition(&self, tool_name: &str) -> Result<ToolDefinition> {
        let tools = self.tools.read().await;
        let tool = tools
            .get(tool_name)
            .ok_or_else(|| McpError::Tool(format!("Tool not found: {}", tool_name)))?;

        Ok(tool.definition())
    }

    /// Execute a tool
    pub async fn execute_tool(
        &self,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> Result<ToolResult> {
        let tools = self.tools.read().await;
        let tool = tools
            .get(tool_name)
            .ok_or_else(|| McpError::Tool(format!("Tool not found: {}", tool_name)))?
            .clone();

        // Release the lock before executing
        drop(tools);

        // Validate arguments
        tool.validate_arguments(&arguments)?;

        // Execute the tool
        tool.execute(arguments).await
    }

    /// Check if a tool is registered
    pub async fn has_tool(&self, tool_name: &str) -> bool {
        let tools = self.tools.read().await;
        tools.contains_key(tool_name)
    }

    /// Get tool count
    pub async fn count(&self) -> usize {
        let tools = self.tools.read().await;
        tools.len()
    }
}

impl Default for ToolRouter {
    fn default() -> Self {
        Self::new()
    }
}

// Example tool implementation
pub struct EchoTool;

#[async_trait]
impl Tool for EchoTool {
    fn definition(&self) -> ToolDefinition {
        let mut properties = HashMap::new();
        properties.insert(
            "message".to_string(),
            ParameterProperty {
                param_type: "string".to_string(),
                description: "Message to echo".to_string(),
                default: None,
            },
        );

        ToolDefinition {
            name: "echo".to_string(),
            description: "Echoes back the provided message".to_string(),
            parameters: ToolParameters {
                properties,
                required: vec!["message".to_string()],
            },
            returns: "string".to_string(),
        }
    }

    async fn execute(&self, arguments: serde_json::Value) -> Result<ToolResult> {
        let message = arguments
            .get("message")
            .and_then(|v| v.as_str())
            .ok_or_else(|| McpError::InvalidRequest("Missing message parameter".to_string()))?;

        Ok(ToolResult::success(serde_json::json!({
            "echo": message
        })))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_register_tool() {
        let router = ToolRouter::new();

        let echo_tool = Arc::new(EchoTool);
        router.register_tool(echo_tool).await.unwrap();

        assert_eq!(router.count().await, 1);
        assert!(router.has_tool("echo").await);
    }

    #[tokio::test]
    async fn test_unregister_tool() {
        let router = ToolRouter::new();

        let echo_tool = Arc::new(EchoTool);
        router.register_tool(echo_tool).await.unwrap();

        assert_eq!(router.count().await, 1);

        router.unregister_tool("echo").await.unwrap();

        assert_eq!(router.count().await, 0);
    }

    #[tokio::test]
    async fn test_execute_tool() {
        let router = ToolRouter::new();

        let echo_tool = Arc::new(EchoTool);
        router.register_tool(echo_tool).await.unwrap();

        let args = serde_json::json!({
            "message": "Hello, World!"
        });

        let result = router.execute_tool("echo", args).await.unwrap();

        assert!(result.success);
        assert_eq!(result.data["echo"], "Hello, World!");
    }

    #[tokio::test]
    async fn test_missing_required_parameter() {
        let router = ToolRouter::new();

        let echo_tool = Arc::new(EchoTool);
        router.register_tool(echo_tool).await.unwrap();

        let args = serde_json::json!({});

        let result = router.execute_tool("echo", args).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_tool_not_found() {
        let router = ToolRouter::new();

        let args = serde_json::json!({});

        let result = router.execute_tool("nonexistent", args).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_list_tools() {
        let router = ToolRouter::new();

        let echo_tool = Arc::new(EchoTool);
        router.register_tool(echo_tool).await.unwrap();

        let tools = router.list_tools().await;
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "echo");
    }

    #[tokio::test]
    async fn test_get_tool_definition() {
        let router = ToolRouter::new();

        let echo_tool = Arc::new(EchoTool);
        router.register_tool(echo_tool).await.unwrap();

        let definition = router.get_tool_definition("echo").await.unwrap();
        assert_eq!(definition.name, "echo");
        assert_eq!(definition.parameters.required, vec!["message"]);
    }

    #[tokio::test]
    async fn test_duplicate_registration() {
        let router = ToolRouter::new();

        let echo_tool1 = Arc::new(EchoTool);
        router.register_tool(echo_tool1).await.unwrap();

        let echo_tool2 = Arc::new(EchoTool);
        let result = router.register_tool(echo_tool2).await;

        assert!(result.is_err());
    }
}
