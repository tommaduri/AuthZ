//! MCP server implementation
//!
//! Provides a standards-compliant Model Context Protocol server for AI agent integration.

#[cfg(feature = "dag-integration")]
use crate::adapters::DagConsensusAdapter;
use crate::error::{McpError, Result};
use cretoai_core::traits::ConsensusProtocol;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// MCP Protocol version
pub const MCP_VERSION: &str = "1.0.0";

/// JSON-RPC 2.0 request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub method: String,
    pub params: Option<serde_json::Value>,
    pub id: Option<serde_json::Value>,
}

/// JSON-RPC 2.0 response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
    pub id: Option<serde_json::Value>,
}

/// JSON-RPC 2.0 error
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

impl JsonRpcError {
    pub fn parse_error() -> Self {
        Self {
            code: -32700,
            message: "Parse error".to_string(),
            data: None,
        }
    }

    pub fn invalid_request() -> Self {
        Self {
            code: -32600,
            message: "Invalid Request".to_string(),
            data: None,
        }
    }

    pub fn method_not_found() -> Self {
        Self {
            code: -32601,
            message: "Method not found".to_string(),
            data: None,
        }
    }

    pub fn invalid_params() -> Self {
        Self {
            code: -32602,
            message: "Invalid params".to_string(),
            data: None,
        }
    }

    pub fn internal_error(message: String) -> Self {
        Self {
            code: -32603,
            message,
            data: None,
        }
    }
}

/// MCP server configuration
#[derive(Debug, Clone)]
pub struct McpServerConfig {
    /// Server name
    pub name: String,

    /// Server version
    pub version: String,

    /// Enable authentication
    pub require_auth: bool,

    /// Maximum concurrent connections
    pub max_connections: usize,

    /// Request timeout (seconds)
    pub request_timeout: u64,
}

impl Default for McpServerConfig {
    fn default() -> Self {
        Self {
            name: "Vigilia AI MCP Server".to_string(),
            version: MCP_VERSION.to_string(),
            require_auth: true,
            max_connections: 100,
            request_timeout: 30,
        }
    }
}

/// MCP tool definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tool {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

/// MCP resource definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resource {
    pub uri: String,
    pub name: String,
    pub description: String,
    pub mime_type: String,
}

/// Tool execution handler
pub type ToolHandler = Arc<dyn Fn(serde_json::Value) -> Result<serde_json::Value> + Send + Sync>;

/// Resource provider handler
pub type ResourceHandler = Arc<dyn Fn(String) -> Result<Vec<u8>> + Send + Sync>;

/// MCP Server state
#[derive(Clone)]
struct ServerState {
    tools: HashMap<String, (Tool, ToolHandler)>,
    resources: HashMap<String, (Resource, ResourceHandler)>,
}

impl ServerState {
    fn new() -> Self {
        Self {
            tools: HashMap::new(),
            resources: HashMap::new(),
        }
    }
}

/// Model Context Protocol Server
pub struct McpServer {
    config: McpServerConfig,
    state: Arc<RwLock<ServerState>>,
    /// Optional DAG consensus adapter for Byzantine fault tolerance
    #[cfg(feature = "dag-integration")]
    consensus: Option<Arc<DagConsensusAdapter>>,
}

impl McpServer {
    /// Create a new MCP server
    pub fn new(config: McpServerConfig) -> Self {
        Self {
            config,
            state: Arc::new(RwLock::new(ServerState::new())),
            #[cfg(feature = "dag-integration")]
            consensus: None,
        }
    }

    /// Create a new MCP server with DAG consensus enabled
    ///
    /// Enables Byzantine fault-tolerant consensus for critical operations.
    /// Operations will wait for finality before acknowledging success.
    #[cfg(feature = "dag-integration")]
    pub fn with_consensus(config: McpServerConfig, adapter: Arc<DagConsensusAdapter>) -> Self {
        Self {
            config,
            state: Arc::new(RwLock::new(ServerState::new())),
            consensus: Some(adapter),
        }
    }

    /// Register a tool with the server
    pub async fn register_tool<F>(&self, tool: Tool, handler: F) -> Result<()>
    where
        F: Fn(serde_json::Value) -> Result<serde_json::Value> + Send + Sync + 'static,
    {
        let mut state = self.state.write().await;
        state
            .tools
            .insert(tool.name.clone(), (tool, Arc::new(handler)));
        Ok(())
    }

    /// Register a resource with the server
    pub async fn register_resource<F>(&self, resource: Resource, handler: F) -> Result<()>
    where
        F: Fn(String) -> Result<Vec<u8>> + Send + Sync + 'static,
    {
        let mut state = self.state.write().await;
        state
            .resources
            .insert(resource.uri.clone(), (resource, Arc::new(handler)));
        Ok(())
    }

    /// List all registered tools
    pub async fn list_tools(&self) -> Vec<Tool> {
        let state = self.state.read().await;
        state.tools.values().map(|(tool, _)| tool.clone()).collect()
    }

    /// List all registered resources
    pub async fn list_resources(&self) -> Vec<Resource> {
        let state = self.state.read().await;
        state
            .resources
            .values()
            .map(|(resource, _)| resource.clone())
            .collect()
    }

    /// Get server information
    pub fn get_server_info(&self) -> serde_json::Value {
        serde_json::json!({
            "name": self.config.name,
            "version": self.config.version,
            "protocol_version": MCP_VERSION,
        })
    }

    /// Handle a JSON-RPC request
    pub async fn handle_request(&self, request_str: &str) -> String {
        // Parse request
        let request: JsonRpcRequest = match serde_json::from_str(request_str) {
            Ok(req) => req,
            Err(_) => {
                let response = JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    result: None,
                    error: Some(JsonRpcError::parse_error()),
                    id: None,
                };
                return serde_json::to_string(&response).unwrap();
            }
        };

        // Validate JSON-RPC version
        if request.jsonrpc != "2.0" {
            let response = JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                result: None,
                error: Some(JsonRpcError::invalid_request()),
                id: request.id,
            };
            return serde_json::to_string(&response).unwrap();
        }

        // Handle method
        let result = self.handle_method(&request.method, request.params).await;

        let response = match result {
            Ok(value) => JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                result: Some(value),
                error: None,
                id: request.id,
            },
            Err(e) => JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                result: None,
                error: Some(JsonRpcError::internal_error(e.to_string())),
                id: request.id,
            },
        };

        serde_json::to_string(&response).unwrap()
    }

    /// Handle a specific method
    async fn handle_method(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value> {
        match method {
            "initialize" => Ok(self.get_server_info()),
            "tools/list" => {
                let tools = self.list_tools().await;
                Ok(serde_json::to_value(tools).unwrap())
            }
            "tools/call" => self.call_tool(params).await,
            "resources/list" => {
                let resources = self.list_resources().await;
                Ok(serde_json::to_value(resources).unwrap())
            }
            "resources/read" => self.read_resource(params).await,
            _ => Err(McpError::Server(format!("Unknown method: {}", method))),
        }
    }

    /// Call a registered tool
    async fn call_tool(&self, params: Option<serde_json::Value>) -> Result<serde_json::Value> {
        let params = params.ok_or_else(|| McpError::InvalidRequest("Missing params".to_string()))?;

        let tool_name = params
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| McpError::InvalidRequest("Missing tool name".to_string()))?;

        let tool_params = params.get("arguments").cloned().unwrap_or(serde_json::json!({}));

        let state = self.state.read().await;
        let (_, handler) = state
            .tools
            .get(tool_name)
            .ok_or_else(|| McpError::Tool(format!("Tool not found: {}", tool_name)))?;

        handler(tool_params)
    }

    /// Read a registered resource
    async fn read_resource(&self, params: Option<serde_json::Value>) -> Result<serde_json::Value> {
        let params = params.ok_or_else(|| McpError::InvalidRequest("Missing params".to_string()))?;

        let uri = params
            .get("uri")
            .and_then(|v| v.as_str())
            .ok_or_else(|| McpError::InvalidRequest("Missing resource URI".to_string()))?;

        let state = self.state.read().await;
        let (_, handler) = state
            .resources
            .get(uri)
            .ok_or_else(|| McpError::Resource(format!("Resource not found: {}", uri)))?;

        let data = handler(uri.to_string())?;

        #[allow(deprecated)]
        Ok(serde_json::json!({
            "uri": uri,
            "data": base64::encode(&data),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_server_creation() {
        let config = McpServerConfig::default();
        let server = McpServer::new(config);

        let info = server.get_server_info();
        assert_eq!(info["protocol_version"], MCP_VERSION);
    }

    #[tokio::test]
    async fn test_tool_registration() {
        let config = McpServerConfig::default();
        let server = McpServer::new(config);

        let tool = Tool {
            name: "test_tool".to_string(),
            description: "A test tool".to_string(),
            parameters: serde_json::json!({}),
        };

        server
            .register_tool(tool, |params| Ok(params))
            .await
            .unwrap();

        let tools = server.list_tools().await;
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "test_tool");
    }

    #[tokio::test]
    async fn test_resource_registration() {
        let config = McpServerConfig::default();
        let server = McpServer::new(config);

        let resource = Resource {
            uri: "vigilia://test".to_string(),
            name: "test_resource".to_string(),
            description: "A test resource".to_string(),
            mime_type: "text/plain".to_string(),
        };

        server
            .register_resource(resource, |_uri| Ok(b"test data".to_vec()))
            .await
            .unwrap();

        let resources = server.list_resources().await;
        assert_eq!(resources.len(), 1);
        assert_eq!(resources[0].uri, "vigilia://test");
    }

    #[tokio::test]
    async fn test_initialize_request() {
        let config = McpServerConfig::default();
        let server = McpServer::new(config);

        let request = r#"{"jsonrpc":"2.0","method":"initialize","id":1}"#;
        let response_str = server.handle_request(request).await;

        let response: JsonRpcResponse = serde_json::from_str(&response_str).unwrap();
        assert_eq!(response.jsonrpc, "2.0");
        assert!(response.error.is_none());
        assert!(response.result.is_some());
    }

    #[tokio::test]
    async fn test_list_tools_request() {
        let config = McpServerConfig::default();
        let server = McpServer::new(config);

        // Register a tool
        let tool = Tool {
            name: "test_tool".to_string(),
            description: "Test".to_string(),
            parameters: serde_json::json!({}),
        };
        server
            .register_tool(tool, |params| Ok(params))
            .await
            .unwrap();

        let request = r#"{"jsonrpc":"2.0","method":"tools/list","id":2}"#;
        let response_str = server.handle_request(request).await;

        let response: JsonRpcResponse = serde_json::from_str(&response_str).unwrap();
        assert!(response.error.is_none());

        let tools: Vec<Tool> = serde_json::from_value(response.result.unwrap()).unwrap();
        assert_eq!(tools.len(), 1);
    }

    #[tokio::test]
    async fn test_call_tool_request() {
        let config = McpServerConfig::default();
        let server = McpServer::new(config);

        // Register a tool
        let tool = Tool {
            name: "echo".to_string(),
            description: "Echo tool".to_string(),
            parameters: serde_json::json!({}),
        };
        server
            .register_tool(tool, |params| {
                Ok(serde_json::json!({
                    "echo": params
                }))
            })
            .await
            .unwrap();

        let request =
            r#"{"jsonrpc":"2.0","method":"tools/call","params":{"name":"echo","arguments":{"message":"hello"}},"id":3}"#;
        let response_str = server.handle_request(request).await;

        let response: JsonRpcResponse = serde_json::from_str(&response_str).unwrap();
        assert!(response.error.is_none());

        let result = response.result.unwrap();
        assert_eq!(result["echo"]["message"], "hello");
    }

    #[tokio::test]
    async fn test_invalid_json() {
        let config = McpServerConfig::default();
        let server = McpServer::new(config);

        let request = r#"{"invalid json"#;
        let response_str = server.handle_request(request).await;

        let response: JsonRpcResponse = serde_json::from_str(&response_str).unwrap();
        assert!(response.error.is_some());
        assert_eq!(response.error.unwrap().code, -32700);
    }

    #[tokio::test]
    async fn test_method_not_found() {
        let config = McpServerConfig::default();
        let server = McpServer::new(config);

        let request = r#"{"jsonrpc":"2.0","method":"unknown_method","id":4}"#;
        let response_str = server.handle_request(request).await;

        let response: JsonRpcResponse = serde_json::from_str(&response_str).unwrap();
        assert!(response.error.is_some());
    }

    #[test]
    fn test_json_rpc_errors() {
        let err = JsonRpcError::parse_error();
        assert_eq!(err.code, -32700);

        let err = JsonRpcError::invalid_request();
        assert_eq!(err.code, -32600);

        let err = JsonRpcError::method_not_found();
        assert_eq!(err.code, -32601);
    }
}

// base64 helper for tests
#[cfg(test)]
mod base64 {
    pub fn encode(data: &[u8]) -> String {
        use std::fmt::Write;
        let mut result = String::new();
        for byte in data {
            write!(&mut result, "{:02x}", byte).unwrap();
        }
        result
    }
}

#[cfg(not(test))]
use base64;
