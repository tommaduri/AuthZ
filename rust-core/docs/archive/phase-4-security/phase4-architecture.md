# Phase 4: MCP Integration Layer - System Architecture

**Version**: 1.0
**Date**: 2025-11-27
**Status**: Design Specification

---

## Executive Summary

This document specifies the architecture for Phase 4 of the CretoAI AI platform: the Model Context Protocol (MCP) Integration Layer. This layer provides a standards-compliant MCP server implementation that enables AI agents to discover, register, and communicate over quantum-resistant QUIC transport with Byzantine fault-tolerant consensus.

**Key Architectural Principles:**
- **Quantum-Resistant**: All communication secured with ML-KEM-768 + X25519 hybrid KEM
- **Byzantine Fault-Tolerant**: Leverages Avalanche consensus for distributed coordination
- **High Performance**: Tokio async runtime with lock-free data structures where possible
- **Standards-Compliant**: Full MCP specification support (tools, resources, prompts)
- **Distributed Memory**: DAG-based persistent context with RocksDB backend

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Component Architecture](#2-component-architecture)
3. [Module Structure](#3-module-structure)
4. [Data Flow Diagrams](#4-data-flow-diagrams)
5. [Concurrency Model](#5-concurrency-model)
6. [Integration Architecture](#6-integration-architecture)
7. [Error Handling Strategy](#7-error-handling-strategy)
8. [Security Architecture](#8-security-architecture)
9. [Performance Considerations](#9-performance-considerations)
10. [Testing Strategy](#10-testing-strategy)

---

## 1. System Overview

### 1.1 Architecture Layers

```text
┌─────────────────────────────────────────────────────────────────┐
│                     MCP Client Applications                      │
│              (Claude Desktop, IDEs, Automation Tools)            │
└────────────────────────────┬────────────────────────────────────┘
                             │ JSON-RPC 2.0 over WebSocket/stdio
┌────────────────────────────▼────────────────────────────────────┐
│                        MCPServer                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ToolRouter    │  │PromptExecutor│  │ResourceMgr   │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                  │                   │
│  ┌──────▼─────────────────▼──────────────────▼───────┐          │
│  │           AgentRegistry & ContextManager           │          │
│  └──────┬─────────────────┬──────────────────┬───────┘          │
└─────────┼─────────────────┼──────────────────┼──────────────────┘
          │                 │                  │
┌─────────▼─────────────────▼──────────────────▼──────────────────┐
│                    SecurityLayer (Auth/Authz)                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│               MessageCodec (Serialization/Validation)            │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                      ConnectionPool                              │
│               (Manages agent QUIC connections)                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│              QuicTransport (Quantum-Resistant TLS)               │
│                      (Phase 1: Completed)                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│             ConsensusNode (Avalanche over DAG)                   │
│                      (Phase 2: Completed)                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│               DAG Storage (RocksDB Persistence)                  │
│                      (Phase 2: Completed)                        │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Design Goals

| Goal | Description | Success Criteria |
|------|-------------|------------------|
| **Standards Compliance** | Full MCP specification support | Pass MCP test suite |
| **Performance** | Sub-10ms latency for local operations | Benchmark validation |
| **Scalability** | Support 1000+ concurrent agent connections | Load testing |
| **Security** | Zero-trust architecture with quantum resistance | Security audit |
| **Reliability** | 99.9% uptime with automatic failover | SLA monitoring |

---

## 2. Component Architecture

### 2.1 Component Overview

```text
┌─────────────────────────────────────────────────────────────────┐
│                           MCPServer                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. MCPServer         - Main server coordinator                 │
│  2. AgentRegistry     - Agent discovery and registration        │
│  3. ToolRouter        - Route tool invocation requests          │
│  4. ContextManager    - Distributed shared memory               │
│  5. PromptExecutor    - Distributed prompt execution            │
│  6. SecurityLayer     - Authentication and authorization        │
│  7. MessageCodec      - MCP message serialization               │
│  8. ConnectionPool    - QUIC connection lifecycle               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Component Responsibilities

#### 2.2.1 MCPServer

**Purpose**: Main entry point and coordination hub for the MCP server.

**Responsibilities**:
- Accept incoming MCP client connections (WebSocket/stdio)
- Route JSON-RPC 2.0 requests to appropriate handlers
- Maintain server state and configuration
- Coordinate lifecycle of all subcomponents
- Emit telemetry and observability metrics

**Key Traits**:
```rust
pub trait McpServerTrait {
    async fn start(&mut self) -> Result<()>;
    async fn stop(&mut self) -> Result<()>;
    async fn handle_request(&self, request: JsonRpcRequest) -> Result<JsonRpcResponse>;
    fn register_tool(&mut self, tool: ToolDefinition) -> Result<()>;
    fn register_resource(&mut self, resource: ResourceDefinition) -> Result<()>;
    fn register_prompt(&mut self, prompt: PromptDefinition) -> Result<()>;
}
```

#### 2.2.2 AgentRegistry

**Purpose**: Service discovery and registration for AI agents in the network.

**Responsibilities**:
- Register agents with capabilities and metadata
- Handle agent heartbeats and liveness probes
- Maintain distributed agent directory (stored in DAG)
- Query agents by capability, availability, reputation
- Propagate registration updates via consensus

**Key Traits**:
```rust
pub trait AgentRegistryTrait {
    async fn register_agent(&self, info: AgentInfo) -> Result<AgentId>;
    async fn unregister_agent(&self, agent_id: &AgentId) -> Result<()>;
    async fn find_agents(&self, query: AgentQuery) -> Result<Vec<AgentInfo>>;
    async fn update_agent_status(&self, agent_id: &AgentId, status: AgentStatus) -> Result<()>;
    async fn get_agent_info(&self, agent_id: &AgentId) -> Result<AgentInfo>;
}
```

#### 2.2.3 ToolRouter

**Purpose**: Route tool invocation requests to appropriate agent handlers.

**Responsibilities**:
- Maintain tool registry (tool name → handler mapping)
- Validate tool invocation arguments against schema
- Route requests to local handlers or remote agents via QUIC
- Implement load balancing and retry logic
- Track tool invocation metrics and latency

**Key Traits**:
```rust
pub trait ToolRouterTrait {
    async fn invoke_tool(&self, request: ToolInvocation) -> Result<ToolResult>;
    fn register_local_tool(&mut self, tool: LocalToolHandler) -> Result<()>;
    async fn discover_remote_tools(&self) -> Result<Vec<RemoteToolInfo>>;
    fn get_tool_schema(&self, tool_name: &str) -> Result<ToolSchema>;
}
```

#### 2.2.4 ContextManager

**Purpose**: Distributed shared memory for conversation context and state.

**Responsibilities**:
- Store and retrieve context entries across sessions
- Implement efficient caching with LRU eviction
- Persist critical context to DAG for durability
- Replicate context updates via consensus
- Handle context expiration and garbage collection

**Key Traits**:
```rust
pub trait ContextManagerTrait {
    async fn store_context(&self, key: ContextKey, value: ContextValue, ttl: Option<Duration>) -> Result<()>;
    async fn retrieve_context(&self, key: &ContextKey) -> Result<Option<ContextValue>>;
    async fn delete_context(&self, key: &ContextKey) -> Result<()>;
    async fn list_contexts(&self, prefix: &str) -> Result<Vec<ContextKey>>;
    async fn sync_context(&self) -> Result<SyncStats>;
}
```

#### 2.2.5 PromptExecutor

**Purpose**: Execute MCP prompts with distributed agent coordination.

**Responsibilities**:
- Parse and validate prompt templates
- Substitute variables and resolve references
- Coordinate multi-step prompt execution
- Aggregate results from multiple agents
- Handle timeout and cancellation

**Key Traits**:
```rust
pub trait PromptExecutorTrait {
    async fn execute_prompt(&self, request: PromptRequest) -> Result<PromptResult>;
    async fn execute_distributed_prompt(&self, request: DistributedPromptRequest) -> Result<AggregatedResult>;
    fn register_prompt_template(&mut self, template: PromptTemplate) -> Result<()>;
    async fn cancel_prompt(&self, execution_id: &ExecutionId) -> Result<()>;
}
```

#### 2.2.6 SecurityLayer

**Purpose**: Authentication, authorization, and security policy enforcement.

**Responsibilities**:
- Authenticate MCP clients (API keys, JWT tokens)
- Verify agent identities using quantum-resistant signatures
- Enforce capability-based access control (CBAC)
- Rate limiting and DDoS protection
- Audit logging of security events

**Key Traits**:
```rust
pub trait SecurityLayerTrait {
    async fn authenticate_client(&self, credentials: ClientCredentials) -> Result<ClientSession>;
    async fn verify_agent_signature(&self, agent_id: &AgentId, message: &[u8], signature: &[u8]) -> Result<bool>;
    fn authorize_tool_access(&self, client: &ClientSession, tool: &str) -> Result<bool>;
    fn authorize_resource_access(&self, client: &ClientSession, resource: &str) -> Result<bool>;
    async fn log_security_event(&self, event: SecurityEvent) -> Result<()>;
}
```

#### 2.2.7 MessageCodec

**Purpose**: Serialize and deserialize MCP messages with validation.

**Responsibilities**:
- Encode/decode JSON-RPC 2.0 messages
- Validate message structure against MCP schema
- Handle binary data encoding (base64)
- Support streaming message parsing
- Version negotiation and compatibility

**Key Traits**:
```rust
pub trait MessageCodecTrait {
    fn encode(&self, message: &McpMessage) -> Result<Vec<u8>>;
    fn decode(&self, data: &[u8]) -> Result<McpMessage>;
    fn validate(&self, message: &McpMessage) -> Result<()>;
    fn supports_version(&self, version: &str) -> bool;
}
```

#### 2.2.8 ConnectionPool

**Purpose**: Manage lifecycle of QUIC connections to agents.

**Responsibilities**:
- Establish and maintain QUIC connections
- Connection pooling and reuse
- Health checks and automatic reconnection
- Circuit breaker pattern for failing agents
- Connection metrics and monitoring

**Key Traits**:
```rust
pub trait ConnectionPoolTrait {
    async fn get_connection(&self, agent_id: &AgentId) -> Result<QuicConnection>;
    async fn release_connection(&self, conn: QuicConnection) -> Result<()>;
    async fn remove_connection(&self, agent_id: &AgentId) -> Result<()>;
    fn get_pool_stats(&self) -> PoolStats;
    async fn health_check(&self, agent_id: &AgentId) -> Result<HealthStatus>;
}
```

---

## 3. Module Structure

### 3.1 Directory Layout

```text
src/mcp/
├── lib.rs                      # Module root and public API
├── error.rs                    # MCP-specific error types
├── server/
│   ├── mod.rs                  # MCPServer implementation
│   ├── config.rs               # Server configuration
│   ├── state.rs                # Server state management
│   └── lifecycle.rs            # Start/stop/reload logic
├── registry/
│   ├── mod.rs                  # AgentRegistry
│   ├── agent_info.rs           # Agent metadata structures
│   ├── query.rs                # Agent query DSL
│   ├── storage.rs              # Registry persistence layer
│   └── sync.rs                 # Cross-node registry sync
├── router/
│   ├── mod.rs                  # ToolRouter
│   ├── local_handler.rs        # Local tool execution
│   ├── remote_handler.rs       # Remote tool invocation via QUIC
│   ├── load_balancer.rs        # Request distribution
│   └── retry.rs                # Retry and circuit breaker
├── context/
│   ├── mod.rs                  # ContextManager
│   ├── cache.rs                # In-memory LRU cache
│   ├── persistence.rs          # DAG-backed persistence
│   ├── sync.rs                 # Context replication
│   └── gc.rs                   # Garbage collection
├── executor/
│   ├── mod.rs                  # PromptExecutor
│   ├── parser.rs               # Prompt template parsing
│   ├── coordinator.rs          # Multi-agent coordination
│   └── aggregator.rs           # Result aggregation
├── security/
│   ├── mod.rs                  # SecurityLayer
│   ├── auth.rs                 # Authentication providers
│   ├── authz.rs                # Authorization policies
│   ├── rate_limit.rs           # Rate limiting
│   └── audit.rs                # Audit logging
├── codec/
│   ├── mod.rs                  # MessageCodec
│   ├── jsonrpc.rs              # JSON-RPC 2.0 codec
│   ├── validation.rs           # Schema validation
│   └── streaming.rs            # Streaming parser
├── pool/
│   ├── mod.rs                  # ConnectionPool
│   ├── connection.rs           # Connection wrapper
│   ├── manager.rs              # Pool management
│   └── health.rs               # Health checking
└── protocol/
    ├── mod.rs                  # MCP protocol types
    ├── messages.rs             # Message structures
    ├── tools.rs                # Tool definitions
    ├── resources.rs            # Resource definitions
    └── prompts.rs              # Prompt definitions
```

### 3.2 Core Data Structures

#### 3.2.1 MCP Protocol Types

```rust
// src/mcp/protocol/messages.rs

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// JSON-RPC 2.0 request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String, // Must be "2.0"
    pub id: RequestId,
    pub method: String,
    pub params: serde_json::Value,
}

/// JSON-RPC 2.0 response
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum JsonRpcResponse {
    Success {
        jsonrpc: String,
        id: RequestId,
        result: serde_json::Value,
    },
    Error {
        jsonrpc: String,
        id: RequestId,
        error: JsonRpcError,
    },
}

/// Request ID (string or number)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(untagged)]
pub enum RequestId {
    String(String),
    Number(i64),
}

/// JSON-RPC error object
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

/// MCP message envelope
#[derive(Debug, Clone)]
pub enum McpMessage {
    Request(JsonRpcRequest),
    Response(JsonRpcResponse),
    Notification(JsonRpcNotification),
}

/// JSON-RPC notification (no response expected)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcNotification {
    pub jsonrpc: String,
    pub method: String,
    pub params: serde_json::Value,
}
```

#### 3.2.2 Tool Definitions

```rust
// src/mcp/protocol/tools.rs

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Tool definition (exposed by server)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: ToolSchema,
}

/// JSON Schema for tool parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolSchema {
    #[serde(rename = "type")]
    pub schema_type: String, // "object"
    pub properties: HashMap<String, SchemaProperty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaProperty {
    #[serde(rename = "type")]
    pub property_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enum_values: Option<Vec<Value>>,
}

/// Tool invocation request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolInvocation {
    pub tool_name: String,
    pub arguments: HashMap<String, Value>,
}

/// Tool execution result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub content: Vec<ToolContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ToolContent {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image { data: String, mime_type: String },
    #[serde(rename = "resource")]
    Resource { resource: ResourceReference },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceReference {
    pub uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}
```

#### 3.2.3 Agent Registry Types

```rust
// src/mcp/registry/agent_info.rs

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::time::SystemTime;

pub type AgentId = String;

/// Agent registration information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInfo {
    pub agent_id: AgentId,
    pub name: String,
    pub version: String,
    pub capabilities: Vec<String>,
    pub endpoints: Vec<AgentEndpoint>,
    pub metadata: HashMap<String, String>,
    pub status: AgentStatus,
    pub registered_at: SystemTime,
    pub last_heartbeat: SystemTime,
    pub public_key: Vec<u8>, // Dilithium public key
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentEndpoint {
    pub protocol: String, // "quic", "http", "grpc"
    pub address: SocketAddr,
    pub priority: u8, // 0 = highest priority
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum AgentStatus {
    Online,
    Offline,
    Degraded,
    Maintenance,
}

/// Query DSL for finding agents
#[derive(Debug, Clone, Default)]
pub struct AgentQuery {
    pub capabilities: Option<Vec<String>>, // AND logic
    pub status: Option<AgentStatus>,
    pub max_results: Option<usize>,
    pub metadata_filters: HashMap<String, String>,
}
```

#### 3.2.4 Context Storage Types

```rust
// src/mcp/context/mod.rs

use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime};

pub type ContextKey = String;

/// Context value with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextValue {
    pub data: serde_json::Value,
    pub created_at: SystemTime,
    pub expires_at: Option<SystemTime>,
    pub version: u64,
    pub tags: Vec<String>,
}

/// Context entry (key + value)
#[derive(Debug, Clone)]
pub struct ContextEntry {
    pub key: ContextKey,
    pub value: ContextValue,
}

/// Cache statistics
#[derive(Debug, Clone)]
pub struct CacheStats {
    pub hits: u64,
    pub misses: u64,
    pub evictions: u64,
    pub size: usize,
    pub capacity: usize,
}
```

### 3.3 Error Type Hierarchy

```rust
// src/mcp/error.rs

use thiserror::Error;
use vigilia_network::error::NetworkError;
use vigilia_dag::error::DagError;

pub type Result<T> = std::result::Result<T, McpError>;

#[derive(Error, Debug)]
pub enum McpError {
    #[error("Network error: {0}")]
    Network(#[from] NetworkError),

    #[error("DAG error: {0}")]
    Dag(#[from] DagError),

    #[error("Protocol error: {0}")]
    Protocol(String),

    #[error("Invalid request: {0}")]
    InvalidRequest(String),

    #[error("Tool not found: {0}")]
    ToolNotFound(String),

    #[error("Tool execution failed: {0}")]
    ToolExecutionFailed(String),

    #[error("Resource not found: {0}")]
    ResourceNotFound(String),

    #[error("Authentication failed: {0}")]
    AuthenticationFailed(String),

    #[error("Authorization failed: {0}")]
    AuthorizationFailed(String),

    #[error("Agent not found: {0}")]
    AgentNotFound(String),

    #[error("Agent offline: {0}")]
    AgentOffline(String),

    #[error("Context not found: {0}")]
    ContextNotFound(String),

    #[error("Timeout: {0}")]
    Timeout(String),

    #[error("Rate limit exceeded")]
    RateLimitExceeded,

    #[error("Internal error: {0}")]
    Internal(String),

    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl McpError {
    /// Convert to JSON-RPC error code
    pub fn to_jsonrpc_code(&self) -> i32 {
        match self {
            McpError::Protocol(_) | McpError::InvalidRequest(_) => -32600,
            McpError::ToolNotFound(_) | McpError::ResourceNotFound(_) => -32601,
            McpError::AuthenticationFailed(_) | McpError::AuthorizationFailed(_) => -32000,
            McpError::Timeout(_) => -32001,
            McpError::RateLimitExceeded => -32002,
            _ => -32603, // Internal error
        }
    }
}
```

---

## 4. Data Flow Diagrams

### 4.1 Agent Registration Flow

```text
┌─────────┐                                                         ┌─────────┐
│ Agent A │                                                         │ Agent B │
└────┬────┘                                                         └────┬────┘
     │                                                                   │
     │ 1. QUIC connect with hybrid KEM                                  │
     │ ────────────────────────────────────────────────────────────────►│
     │                                                                   │
     │ 2. Register RPC {name, capabilities, endpoint}                   │
     │ ────────────────────────────────────────────────────────────────►│
     │                        ┌──────────────────┐                      │
     │                        │ AgentRegistry    │                      │
     │                        │   - Validate     │                      │
     │                        │   - Store in DAG │                      │
     │                        │   - Assign ID    │                      │
     │                        └──────────────────┘                      │
     │                                 │                                 │
     │                                 │ 3. Propagate via Consensus      │
     │                                 ▼                                 │
     │                        ┌──────────────────┐                      │
     │                        │ ConsensusNode    │                      │
     │                        │   - Create vertex│                      │
     │                        │   - Broadcast    │                      │
     │                        │   - Wait quorum  │                      │
     │                        └──────────────────┘                      │
     │                                                                   │
     │ 4. Registration success {agent_id}                                │
     │ ◄────────────────────────────────────────────────────────────────│
     │                                                                   │
     │ 5. Periodic heartbeat every 30s                                   │
     │ ────────────────────────────────────────────────────────────────►│
     │                                                                   │
```

**Steps:**
1. Agent establishes QUIC connection with quantum-resistant handshake
2. Agent sends registration RPC with metadata and capabilities
3. Registry validates, stores in DAG, and propagates via consensus
4. Registry returns unique `agent_id` to agent
5. Agent sends periodic heartbeats to maintain `Online` status

### 4.2 Tool Invocation Flow

```text
┌────────────┐                                                    ┌─────────┐
│ MCP Client │                                                    │ Agent C │
└─────┬──────┘                                                    └────┬────┘
      │                                                                │
      │ 1. tools/call RPC {name: "analyze", args: {...}}              │
      │ ──────────────────────────────────────────────────────►       │
      │                    ┌──────────────────┐                       │
      │                    │ MCPServer        │                       │
      │                    │   - Authenticate │                       │
      │                    │   - Validate     │                       │
      │                    └────────┬─────────┘                       │
      │                             │                                 │
      │                             ▼                                 │
      │                    ┌──────────────────┐                       │
      │                    │ ToolRouter       │                       │
      │                    │   - Find handler │                       │
      │                    │   - Check schema │                       │
      │                    └────────┬─────────┘                       │
      │                             │                                 │
      │                             │ 2a. Local tool?                 │
      │                             ├───────────► Execute locally     │
      │                             │             Return result       │
      │                             │                                 │
      │                             │ 2b. Remote tool?                │
      │                             │                                 │
      │                             ▼                                 │
      │                    ┌──────────────────┐                       │
      │                    │ ConnectionPool   │                       │
      │                    │   - Get conn     │                       │
      │                    └────────┬─────────┘                       │
      │                             │                                 │
      │                             │ 3. Forward RPC over QUIC        │
      │                             ├────────────────────────────────►│
      │                             │                                 │
      │                             │ 4. Execute tool                 │
      │                             │                          ┌──────▼─────┐
      │                             │                          │ Local Tool │
      │                             │                          │  Handler   │
      │                             │                          └──────┬─────┘
      │                             │                                 │
      │                             │ 5. Return result                │
      │                             │◄────────────────────────────────┤
      │                             │                                 │
      │                             │ 6. Store in ContextManager      │
      │                             ├───────────► {result, timestamp} │
      │                             │                                 │
      │ 7. Return result to client                                    │
      │ ◄──────────────────────────┴─────────────────────────────────│
      │                                                                │
```

**Steps:**
1. Client sends `tools/call` RPC with tool name and arguments
2. MCPServer authenticates client and validates request
3. ToolRouter determines if tool is local or remote
   - **Local**: Execute in-process, return result
   - **Remote**: Forward to agent via QUIC
4. Remote agent executes tool handler
5. Result returned over QUIC connection
6. ContextManager optionally caches result for future use
7. MCPServer returns result to client

### 4.3 Context Sharing Flow

```text
┌─────────┐                  ┌─────────┐                  ┌─────────┐
│ Agent A │                  │ Agent B │                  │ Agent C │
└────┬────┘                  └────┬────┘                  └────┬────┘
     │                            │                            │
     │ 1. Store context           │                            │
     │    {key: "task/123",       │                            │
     │     value: {...}}          │                            │
     │ ─────────────────────────► │                            │
     │                    ┌───────▼────────┐                   │
     │                    │ ContextManager │                   │
     │                    │   - Cache      │                   │
     │                    │   - Validate   │                   │
     │                    └───────┬────────┘                   │
     │                            │                            │
     │                            │ 2. Persist to DAG          │
     │                            ▼                            │
     │                    ┌──────────────┐                     │
     │                    │ DAG Storage  │                     │
     │                    │   - Create   │                     │
     │                    │     vertex   │                     │
     │                    └──────┬───────┘                     │
     │                           │                             │
     │                           │ 3. Replicate via Consensus  │
     │                           ▼                             │
     │                    ┌──────────────┐                     │
     │                    │ Consensus    │                     │
     │                    │   - Propose  │                     │
     │                    │   - Query    │                     │
     │                    │   - Finalize │                     │
     │                    └──────┬───────┘                     │
     │                           │                             │
     │ 4. Context available      │                             │
     │    for retrieval          │                             │
     │                           │                             │
     │                           │ 5. Agent C queries context  │
     │                           │◄────────────────────────────┤
     │                           │                             │
     │                           │ 6. Return from cache/DAG    │
     │                           ├────────────────────────────►│
     │                           │                             │
```

**Steps:**
1. Agent A stores context entry with key and value
2. ContextManager writes to in-memory cache and DAG
3. Consensus layer replicates to other nodes
4. Context entry becomes queryable by all agents
5. Agent C requests context by key
6. ContextManager returns from cache (fast path) or DAG (slow path)

### 4.4 Distributed Prompt Execution Flow

```text
┌────────────┐
│ MCP Client │
└─────┬──────┘
      │
      │ 1. prompts/execute RPC
      │    {name: "analyze_codebase",
      │     args: {repo: "..."}}
      │ ─────────────────────────►
      │                   ┌────────────────┐
      │                   │ PromptExecutor │
      │                   │   - Parse      │
      │                   │   - Plan steps │
      │                   └────────┬───────┘
      │                            │
      │                            │ 2. Decompose into sub-tasks
      │                            ▼
      │                   ┌─────────────────────────┐
      │                   │ Task 1: Code Analysis   │
      │                   │ Task 2: Test Coverage   │
      │                   │ Task 3: Documentation   │
      │                   └────────┬────────────────┘
      │                            │
      │                            │ 3. Find capable agents
      │                            ▼
      │                   ┌──────────────────┐
      │                   │ AgentRegistry    │
      │                   │   - Query by     │
      │                   │     capability   │
      │                   └────────┬─────────┘
      │                            │
      │                            │ 4. Dispatch tasks (parallel)
      │      ┌─────────────────────┼─────────────────────┐
      │      │                     │                     │
      │      ▼                     ▼                     ▼
      │ ┌─────────┐         ┌─────────┐         ┌─────────┐
      │ │ Agent A │         │ Agent B │         │ Agent C │
      │ │ (Coder) │         │ (Tester)│         │  (Docs) │
      │ └────┬────┘         └────┬────┘         └────┬────┘
      │      │                   │                   │
      │      │ 5. Execute tasks in parallel          │
      │      │                   │                   │
      │      │ 6. Return results │                   │
      │      └───────────────────┴───────────────────┘
      │                            │
      │                            ▼
      │                   ┌──────────────────┐
      │                   │ Result Aggregator│
      │                   │   - Merge        │
      │                   │   - Format       │
      │                   └────────┬─────────┘
      │                            │
      │ 7. Return aggregated result│
      │ ◄──────────────────────────┘
      │
```

**Steps:**
1. Client requests prompt execution with name and arguments
2. PromptExecutor parses template and decomposes into sub-tasks
3. AgentRegistry queried to find agents with required capabilities
4. Tasks dispatched in parallel to capable agents
5. Each agent executes its task independently
6. Results collected from all agents
7. Results aggregated and formatted, then returned to client

---

## 5. Concurrency Model

### 5.1 Async Runtime Architecture

**Runtime**: Tokio (current-thread or multi-threaded scheduler)

**Pattern**: Message-passing with shared state via `Arc<RwLock<T>>` or lock-free structures

```rust
// Example: MCPServer concurrency architecture

use tokio::sync::{mpsc, RwLock};
use std::sync::Arc;

pub struct MCPServer {
    // Immutable config
    config: ServerConfig,

    // Shared mutable state (read-heavy, infrequent writes)
    agent_registry: Arc<AgentRegistry>,
    tool_router: Arc<ToolRouter>,
    context_manager: Arc<ContextManager>,

    // Message channels for async coordination
    command_tx: mpsc::Sender<ServerCommand>,
    command_rx: mpsc::Receiver<ServerCommand>,

    // Connection pool (lock-free)
    connection_pool: Arc<ConnectionPool>,

    // Security layer (stateless, safe to clone)
    security: Arc<SecurityLayer>,
}

enum ServerCommand {
    RegisterAgent(AgentInfo, oneshot::Sender<Result<AgentId>>),
    InvokeTool(ToolInvocation, oneshot::Sender<Result<ToolResult>>),
    StoreContext(ContextKey, ContextValue, oneshot::Sender<Result<()>>),
    Shutdown,
}

impl MCPServer {
    pub async fn start(&mut self) -> Result<()> {
        // Spawn worker tasks
        tokio::spawn(self.handle_commands());
        tokio::spawn(self.health_check_loop());
        tokio::spawn(self.gc_loop());

        // Start listening for client connections
        self.listen().await
    }

    async fn handle_commands(&mut self) {
        while let Some(cmd) = self.command_rx.recv().await {
            match cmd {
                ServerCommand::RegisterAgent(info, resp) => {
                    let result = self.agent_registry.register_agent(info).await;
                    let _ = resp.send(result);
                }
                ServerCommand::InvokeTool(req, resp) => {
                    let result = self.tool_router.invoke_tool(req).await;
                    let _ = resp.send(result);
                }
                ServerCommand::StoreContext(key, value, resp) => {
                    let result = self.context_manager.store_context(key, value, None).await;
                    let _ = resp.send(result);
                }
                ServerCommand::Shutdown => break,
            }
        }
    }
}
```

### 5.2 Lock Strategy

| Component | Lock Type | Rationale |
|-----------|-----------|-----------|
| **AgentRegistry** | `Arc<RwLock<HashMap<AgentId, AgentInfo>>>` | Read-heavy workload, infrequent updates |
| **ToolRouter** | `Arc<RwLock<HashMap<String, ToolHandler>>>` | Static after initialization, rare additions |
| **ContextManager** | `Arc<DashMap<ContextKey, ContextValue>>` | Lock-free concurrent HashMap for high contention |
| **ConnectionPool** | `Arc<DashMap<AgentId, Connection>>` | Lock-free for frequent get/release operations |
| **SecurityLayer** | No locks (stateless) | Immutable credentials, crypto operations are self-contained |

**Recommendation**: Use `dashmap::DashMap` for hot paths with high contention (context cache, connection pool). Use `tokio::sync::RwLock` for read-heavy data structures with rare writes.

### 5.3 Message Passing Channels

```rust
// Channel patterns for inter-component communication

// Command pattern (request/response)
let (cmd_tx, cmd_rx) = mpsc::channel::<Command>(100);
let (resp_tx, resp_rx) = oneshot::channel::<Result<Response>>();

// Event bus pattern (broadcast)
let (event_tx, _event_rx) = broadcast::channel::<Event>(1000);

// Work queue pattern (multi-producer, single-consumer)
let (task_tx, task_rx) = mpsc::unbounded_channel::<Task>();

// Bounded channel with backpressure
let (bounded_tx, bounded_rx) = mpsc::channel::<Item>(50);
```

**Best Practices**:
- Use bounded channels with backpressure for work queues
- Use unbounded channels only for critical control messages
- Use `oneshot` for request/response patterns
- Use `broadcast` for event notifications to multiple subscribers

### 5.4 Task Spawning Strategy

```rust
// Pattern 1: Long-lived worker tasks
tokio::spawn(async move {
    loop {
        select! {
            Some(work) = work_rx.recv() => process(work).await,
            _ = shutdown_rx.changed() => break,
        }
    }
});

// Pattern 2: Short-lived request handlers
tokio::spawn(async move {
    match handle_request(req).await {
        Ok(resp) => resp_tx.send(resp),
        Err(e) => error!("Request failed: {}", e),
    }
});

// Pattern 3: Background maintenance tasks
tokio::spawn(async move {
    let mut interval = tokio::time::interval(Duration::from_secs(60));
    loop {
        interval.tick().await;
        perform_gc().await;
    }
});
```

### 5.5 Cancellation and Graceful Shutdown

```rust
use tokio::sync::broadcast;
use tokio::select;

pub struct ShutdownCoordinator {
    shutdown_tx: broadcast::Sender<()>,
}

impl ShutdownCoordinator {
    pub fn new() -> Self {
        let (shutdown_tx, _) = broadcast::channel(1);
        Self { shutdown_tx }
    }

    pub fn shutdown(&self) {
        let _ = self.shutdown_tx.send(());
    }

    pub fn subscribe(&self) -> broadcast::Receiver<()> {
        self.shutdown_tx.subscribe()
    }
}

// Usage in worker task
async fn worker(mut shutdown_rx: broadcast::Receiver<()>) {
    loop {
        select! {
            // Normal work
            Some(item) = queue.recv() => process(item).await,

            // Shutdown signal
            _ = shutdown_rx.recv() => {
                cleanup().await;
                break;
            }
        }
    }
}
```

---

## 6. Integration Architecture

### 6.1 MCPServer ↔ QuicTransport Integration

**Interface**: MCPServer uses `QuicTransport` for all agent-to-agent communication.

```rust
// src/mcp/server/mod.rs

use vigilia_network::libp2p::quic::{QuicTransport, QuicTransportConfig};

impl MCPServer {
    pub fn new(config: ServerConfig, quic_transport: Arc<QuicTransport>) -> Result<Self> {
        // MCPServer takes ownership of or shares QuicTransport
        Ok(Self {
            config,
            transport: quic_transport,
            // ... other fields
        })
    }

    async fn send_to_agent(&self, agent_id: &AgentId, message: &[u8]) -> Result<Vec<u8>> {
        // 1. Resolve agent_id to SocketAddr via AgentRegistry
        let agent_info = self.agent_registry.get_agent_info(agent_id).await?;
        let addr = agent_info.endpoints.first()
            .ok_or_else(|| McpError::AgentNotFound(agent_id.clone()))?
            .address;

        // 2. Get or establish QUIC connection
        let conn = self.connection_pool.get_connection(agent_id).await?;

        // 3. Open bidirectional stream
        let (mut send, mut recv) = conn.open_bi().await
            .map_err(|e| McpError::Network(NetworkError::Connection(e.to_string())))?;

        // 4. Send message
        send.write_all(message).await
            .map_err(|e| McpError::Network(NetworkError::Transport(e.to_string())))?;
        send.finish().await
            .map_err(|e| McpError::Network(NetworkError::Transport(e.to_string())))?;

        // 5. Receive response
        let response = recv.read_to_end(1024 * 1024).await // 1 MB limit
            .map_err(|e| McpError::Network(NetworkError::Transport(e.to_string())))?;

        Ok(response)
    }
}
```

**Key Points**:
- MCPServer never manages raw sockets; delegates all transport to `QuicTransport`
- Connection pool wraps `QuicTransport` connections for reuse
- All agent communication benefits from quantum-resistant handshake automatically

### 6.2 ToolRouter ↔ ConsensusNode Integration

**Interface**: ToolRouter uses `ConsensusNode` to achieve consensus on tool execution order in distributed scenarios.

```rust
// src/mcp/router/mod.rs

use vigilia_network::consensus::{ConsensusNode, VertexProposal};

impl ToolRouter {
    pub async fn invoke_distributed_tool(&self, request: ToolInvocation) -> Result<ToolResult> {
        // 1. Create vertex proposal for tool invocation
        let proposal = VertexProposal {
            payload: bincode::serialize(&request)?,
            parents: self.consensus.get_current_tips().await?,
        };

        // 2. Submit to consensus
        let vertex_id = self.consensus.propose_vertex(proposal).await
            .map_err(|e| McpError::Internal(format!("Consensus proposal failed: {}", e)))?;

        // 3. Wait for finalization (optional, depends on consistency requirements)
        self.consensus.wait_for_finality(&vertex_id, Duration::from_secs(5)).await?;

        // 4. Execute tool after consensus confirms ordering
        let result = self.execute_local_or_remote(&request).await?;

        // 5. Store result in DAG for audit trail
        self.context_manager.store_tool_result(&vertex_id, &result).await?;

        Ok(result)
    }
}
```

**Use Cases for Consensus**:
- **Conflict Resolution**: Multiple agents invoking tools that modify shared state
- **Audit Trail**: Immutable log of all tool invocations
- **Byzantine Tolerance**: Ensure honest majority agrees on execution order

### 6.3 ContextManager ↔ DAG Integration

**Interface**: ContextManager uses DAG storage for persistent, replicated context.

```rust
// src/mcp/context/persistence.rs

use vigilia_dag::{DagGraph, Vertex, VertexBuilder};

impl ContextManager {
    pub async fn persist_to_dag(&self, key: &ContextKey, value: &ContextValue) -> Result<()> {
        // 1. Serialize context entry
        let payload = bincode::serialize(&(key, value))
            .map_err(|e| McpError::Internal(format!("Serialization failed: {}", e)))?;

        // 2. Create DAG vertex
        let vertex = VertexBuilder::new(self.agent_id.clone())
            .id(format!("context/{}", key))
            .payload(payload)
            .build();

        // 3. Add to DAG graph
        self.dag.add_vertex(vertex).await
            .map_err(|e| McpError::Dag(e))?;

        // 4. Optionally store in DAG storage for durability
        self.dag.persist().await
            .map_err(|e| McpError::Internal(format!("DAG persist failed: {}", e)))?;

        Ok(())
    }

    pub async fn retrieve_from_dag(&self, key: &ContextKey) -> Result<Option<ContextValue>> {
        let vertex_id = format!("context/{}", key);

        match self.dag.get_vertex(&vertex_id).await {
            Ok(vertex) => {
                let (_key, value): (ContextKey, ContextValue) = bincode::deserialize(&vertex.payload)
                    .map_err(|e| McpError::Internal(format!("Deserialization failed: {}", e)))?;
                Ok(Some(value))
            }
            Err(DagError::InvalidVertex(_)) => Ok(None), // Not found
            Err(e) => Err(McpError::Dag(e)),
        }
    }
}
```

**Benefits**:
- **Persistence**: Context survives server restarts
- **Replication**: Context automatically replicated to other nodes via consensus
- **Versioning**: DAG provides natural versioning (each vertex is immutable)
- **Audit**: Full history of context changes

### 6.4 Integration Architecture Diagram

```text
┌───────────────────────────────────────────────────────────────┐
│                        MCPServer                              │
└───────────┬───────────────────────────────────┬───────────────┘
            │                                   │
            │ uses                              │ uses
            ▼                                   ▼
┌───────────────────────┐         ┌──────────────────────────┐
│   QuicTransport       │         │   ConsensusNode          │
│   (Phase 1)           │         │   (Phase 2)              │
│                       │         │                          │
│  - Hybrid KEM         │         │  - Avalanche BFT         │
│  - QUIC streams       │         │  - Vertex ordering       │
│  - Connection mgmt    │         │  - Finality detection    │
└───────────────────────┘         └──────────┬───────────────┘
                                              │
                                              │ stores in
                                              ▼
                                  ┌─────────────────────────┐
                                  │   DAG Storage           │
                                  │   (Phase 2)             │
                                  │                         │
                                  │  - RocksDB backend      │
                                  │  - Vertex persistence   │
                                  │  - Snapshot/restore     │
                                  └─────────────────────────┘
```

---

## 7. Error Handling Strategy

### 7.1 Error Categories and Recovery

| Error Type | Category | Recovery Strategy | Retry | Timeout |
|------------|----------|-------------------|-------|---------|
| `Network` | Transient | Exponential backoff retry | Yes | 10s |
| `Timeout` | Transient | Retry with increased timeout | Yes | 30s |
| `AuthenticationFailed` | Permanent | Reject request, log | No | N/A |
| `ToolNotFound` | Permanent | Return error to client | No | N/A |
| `AgentOffline` | Transient | Retry or failover to backup | Yes | 5s |
| `RateLimitExceeded` | Transient | Backoff and retry | Yes | Variable |
| `Internal` | Unknown | Log, alert, return generic error | No | N/A |

### 7.2 Circuit Breaker Pattern

```rust
// src/mcp/pool/circuit_breaker.rs

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

pub struct CircuitBreaker {
    failure_count: AtomicU64,
    threshold: u64,
    timeout: Duration,
    last_failure: std::sync::Mutex<Option<Instant>>,
    state: std::sync::Mutex<CircuitState>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CircuitState {
    Closed,  // Normal operation
    Open,    // Failing, reject requests
    HalfOpen, // Testing if recovered
}

impl CircuitBreaker {
    pub fn new(threshold: u64, timeout: Duration) -> Self {
        Self {
            failure_count: AtomicU64::new(0),
            threshold,
            timeout,
            last_failure: std::sync::Mutex::new(None),
            state: std::sync::Mutex::new(CircuitState::Closed),
        }
    }

    pub async fn call<F, T, E>(&self, f: F) -> Result<T, E>
    where
        F: Future<Output = Result<T, E>>,
    {
        // Check if circuit is open
        if *self.state.lock().unwrap() == CircuitState::Open {
            // Check if timeout elapsed
            if let Some(last_failure) = *self.last_failure.lock().unwrap() {
                if last_failure.elapsed() > self.timeout {
                    // Transition to half-open
                    *self.state.lock().unwrap() = CircuitState::HalfOpen;
                } else {
                    return Err(/* CircuitOpen error */);
                }
            }
        }

        // Execute function
        match f.await {
            Ok(result) => {
                // Success: reset failure count and close circuit
                self.failure_count.store(0, Ordering::SeqCst);
                *self.state.lock().unwrap() = CircuitState::Closed;
                Ok(result)
            }
            Err(e) => {
                // Failure: increment count
                let count = self.failure_count.fetch_add(1, Ordering::SeqCst) + 1;
                *self.last_failure.lock().unwrap() = Some(Instant::now());

                // Open circuit if threshold exceeded
                if count >= self.threshold {
                    *self.state.lock().unwrap() = CircuitState::Open;
                }

                Err(e)
            }
        }
    }
}
```

### 7.3 Retry Logic with Exponential Backoff

```rust
// src/mcp/router/retry.rs

use tokio::time::{sleep, Duration};

pub struct RetryPolicy {
    pub max_attempts: u32,
    pub initial_delay: Duration,
    pub max_delay: Duration,
    pub multiplier: f64,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_attempts: 3,
            initial_delay: Duration::from_millis(100),
            max_delay: Duration::from_secs(10),
            multiplier: 2.0,
        }
    }
}

pub async fn retry_with_backoff<F, T, E>(
    policy: &RetryPolicy,
    mut f: F,
) -> Result<T, E>
where
    F: FnMut() -> BoxFuture<'static, Result<T, E>>,
    E: std::fmt::Display,
{
    let mut attempt = 0;
    let mut delay = policy.initial_delay;

    loop {
        attempt += 1;

        match f().await {
            Ok(result) => return Ok(result),
            Err(e) if attempt >= policy.max_attempts => {
                warn!("All {} retry attempts failed: {}", policy.max_attempts, e);
                return Err(e);
            }
            Err(e) => {
                info!("Attempt {} failed: {}, retrying in {:?}", attempt, e, delay);
                sleep(delay).await;

                // Exponential backoff
                delay = std::cmp::min(
                    Duration::from_secs_f64(delay.as_secs_f64() * policy.multiplier),
                    policy.max_delay,
                );
            }
        }
    }
}
```

---

## 8. Security Architecture

### 8.1 Authentication Mechanisms

**Supported Methods**:
1. **API Key**: Static bearer tokens for trusted clients
2. **JWT**: Time-limited tokens with claims for delegated access
3. **mTLS**: Quantum-resistant certificate-based mutual authentication

```rust
// src/mcp/security/auth.rs

pub enum ClientCredentials {
    ApiKey(String),
    Jwt(String),
    Certificate(Vec<u8>), // Dilithium certificate
}

impl SecurityLayer {
    pub async fn authenticate_client(&self, creds: ClientCredentials) -> Result<ClientSession> {
        match creds {
            ClientCredentials::ApiKey(key) => self.verify_api_key(&key).await,
            ClientCredentials::Jwt(token) => self.verify_jwt(&token).await,
            ClientCredentials::Certificate(cert) => self.verify_certificate(&cert).await,
        }
    }

    async fn verify_api_key(&self, key: &str) -> Result<ClientSession> {
        // Constant-time comparison
        let stored_hash = self.api_key_store.get_hash(key).await?;
        let provided_hash = blake3::hash(key.as_bytes());

        if constant_time_eq(&stored_hash, provided_hash.as_bytes()) {
            Ok(ClientSession {
                client_id: "api_key_client".to_string(),
                permissions: vec!["tools:call".to_string(), "resources:read".to_string()],
                expires_at: None, // API keys don't expire
            })
        } else {
            Err(McpError::AuthenticationFailed("Invalid API key".to_string()))
        }
    }

    async fn verify_jwt(&self, token: &str) -> Result<ClientSession> {
        use jsonwebtoken::{decode, DecodingKey, Validation};

        let key = DecodingKey::from_secret(self.jwt_secret.as_ref());
        let validation = Validation::default();

        let token_data = decode::<Claims>(token, &key, &validation)
            .map_err(|e| McpError::AuthenticationFailed(format!("JWT invalid: {}", e)))?;

        Ok(ClientSession {
            client_id: token_data.claims.sub,
            permissions: token_data.claims.permissions,
            expires_at: Some(SystemTime::UNIX_EPOCH + Duration::from_secs(token_data.claims.exp)),
        })
    }

    async fn verify_certificate(&self, cert: &[u8]) -> Result<ClientSession> {
        // Use vigilia_crypto to verify Dilithium signature
        use vigilia_crypto::signatures::dilithium::DilithiumVerifier;

        let verifier = DilithiumVerifier::new();
        let cert_data = parse_certificate(cert)?;

        verifier.verify(&cert_data.message, &cert_data.signature, &cert_data.public_key)
            .map_err(|e| McpError::AuthenticationFailed(format!("Certificate invalid: {}", e)))?;

        Ok(ClientSession {
            client_id: format!("cert:{}", hex::encode(&cert_data.public_key[..8])),
            permissions: cert_data.permissions,
            expires_at: cert_data.not_after,
        })
    }
}
```

### 8.2 Authorization Model (CBAC)

**Capability-Based Access Control**:
- Each client session has a set of capabilities (permissions)
- Each operation requires specific capabilities
- Authorization checks are stateless and fast

```rust
// src/mcp/security/authz.rs

pub struct AuthorizationPolicy {
    rules: HashMap<String, Vec<String>>, // operation -> required capabilities
}

impl SecurityLayer {
    pub fn authorize_tool_access(&self, session: &ClientSession, tool: &str) -> Result<bool> {
        let required = self.authz_policy.required_capabilities(&format!("tools:{}", tool))?;

        Ok(session.permissions.iter().any(|perm| required.contains(perm)))
    }

    pub fn authorize_resource_access(&self, session: &ClientSession, resource: &str) -> Result<bool> {
        let required = self.authz_policy.required_capabilities(&format!("resources:{}", resource))?;

        Ok(session.permissions.iter().any(|perm| required.contains(perm)))
    }
}
```

### 8.3 Rate Limiting

**Algorithm**: Token bucket with distributed coordination

```rust
// src/mcp/security/rate_limit.rs

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use std::time::{Duration, Instant};

pub struct RateLimiter {
    buckets: Arc<RwLock<HashMap<String, TokenBucket>>>,
    config: RateLimitConfig,
}

struct TokenBucket {
    tokens: f64,
    last_refill: Instant,
}

#[derive(Clone)]
pub struct RateLimitConfig {
    pub capacity: f64,      // Maximum tokens
    pub refill_rate: f64,   // Tokens per second
}

impl RateLimiter {
    pub async fn check_and_consume(&self, client_id: &str, cost: f64) -> Result<()> {
        let mut buckets = self.buckets.write().await;

        let bucket = buckets.entry(client_id.to_string())
            .or_insert_with(|| TokenBucket {
                tokens: self.config.capacity,
                last_refill: Instant::now(),
            });

        // Refill tokens based on elapsed time
        let elapsed = bucket.last_refill.elapsed().as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * self.config.refill_rate)
            .min(self.config.capacity);
        bucket.last_refill = Instant::now();

        // Check if enough tokens
        if bucket.tokens >= cost {
            bucket.tokens -= cost;
            Ok(())
        } else {
            Err(McpError::RateLimitExceeded)
        }
    }
}
```

---

## 9. Performance Considerations

### 9.1 Performance Targets

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| **Tool Invocation Latency (Local)** | < 10ms p99 | Histogram |
| **Tool Invocation Latency (Remote)** | < 50ms p99 | Histogram |
| **Context Retrieval (Cache Hit)** | < 1ms p99 | Histogram |
| **Context Retrieval (DAG Miss)** | < 100ms p99 | Histogram |
| **Agent Registration** | < 200ms p99 | Histogram |
| **Throughput (Requests/sec)** | > 10,000 | Counter |
| **Memory Usage** | < 2GB under load | Gauge |
| **CPU Usage** | < 80% per core | Gauge |

### 9.2 Optimization Strategies

#### 9.2.1 Connection Pooling

**Problem**: Opening new QUIC connections has overhead (handshake latency)

**Solution**: Maintain a pool of reusable connections per agent

```rust
// src/mcp/pool/manager.rs

pub struct ConnectionPool {
    pools: DashMap<AgentId, Vec<PooledConnection>>,
    max_per_agent: usize,
}

impl ConnectionPool {
    pub async fn get_connection(&self, agent_id: &AgentId) -> Result<PooledConnection> {
        // Fast path: reuse existing connection
        if let Some(mut pool) = self.pools.get_mut(agent_id) {
            if let Some(conn) = pool.pop() {
                if conn.is_healthy().await {
                    return Ok(conn);
                }
            }
        }

        // Slow path: create new connection
        let conn = self.create_new_connection(agent_id).await?;
        Ok(conn)
    }
}
```

#### 9.2.2 Context Caching

**Problem**: Frequent DAG reads are slow

**Solution**: LRU cache with write-through to DAG

```rust
// src/mcp/context/cache.rs

use lru::LruCache;

pub struct ContextCache {
    cache: RwLock<LruCache<ContextKey, ContextValue>>,
    capacity: usize,
}

impl ContextCache {
    pub async fn get(&self, key: &ContextKey) -> Option<ContextValue> {
        self.cache.write().await.get(key).cloned()
    }

    pub async fn put(&self, key: ContextKey, value: ContextValue) {
        self.cache.write().await.put(key, value);
    }
}
```

#### 9.2.3 Batch Operations

**Problem**: High overhead for many small operations

**Solution**: Batch DAG writes and consensus proposals

```rust
// src/mcp/context/persistence.rs

pub struct BatchWriter {
    pending: Arc<Mutex<Vec<ContextEntry>>>,
    flush_interval: Duration,
}

impl BatchWriter {
    pub async fn add(&self, entry: ContextEntry) {
        let mut pending = self.pending.lock().await;
        pending.push(entry);

        if pending.len() >= 100 {
            self.flush(&mut pending).await;
        }
    }

    async fn flush(&self, entries: &mut Vec<ContextEntry>) {
        if entries.is_empty() { return; }

        // Single DAG transaction for all entries
        self.dag.put_batch(entries).await;
        entries.clear();
    }
}
```

### 9.3 Profiling and Monitoring

**Instrumentation**: Use `tracing` crate for structured logging and metrics

```rust
use tracing::{info, warn, error, instrument};

#[instrument(skip(self), fields(agent_id = %agent_id))]
pub async fn register_agent(&self, agent_id: &AgentId, info: AgentInfo) -> Result<()> {
    let start = Instant::now();

    // Operation logic...

    let duration = start.elapsed();
    info!(duration_ms = duration.as_millis(), "Agent registered");

    Ok(())
}
```

---

## 10. Testing Strategy

### 10.1 Unit Tests

**Coverage Target**: > 80% line coverage

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_agent_registration() {
        let registry = AgentRegistry::new();
        let info = AgentInfo {
            agent_id: "test-001".to_string(),
            name: "Test Agent".to_string(),
            capabilities: vec!["analyze".to_string()],
            // ...
        };

        let result = registry.register_agent(info.clone()).await;
        assert!(result.is_ok());

        let retrieved = registry.get_agent_info(&"test-001".to_string()).await;
        assert_eq!(retrieved.unwrap().name, "Test Agent");
    }
}
```

### 10.2 Integration Tests

**Scenarios**:
- End-to-end tool invocation (client → server → agent → server → client)
- Multi-agent consensus on tool execution order
- Context replication across multiple nodes
- Failover when agent goes offline

```rust
#[tokio::test]
async fn test_distributed_tool_invocation() {
    // Setup 3-node cluster
    let node1 = setup_node("node1", 9001).await;
    let node2 = setup_node("node2", 9002).await;
    let node3 = setup_node("node3", 9003).await;

    // Register agent on node2
    let agent_info = create_test_agent("analyzer");
    node2.register_agent(agent_info).await.unwrap();

    // Client connects to node1
    let client = McpClient::connect("127.0.0.1:9001").await.unwrap();

    // Invoke tool (should route to node2)
    let result = client.invoke_tool("analyze", json!({"file": "test.rs"})).await;
    assert!(result.is_ok());
}
```

### 10.3 Performance Benchmarks

**Framework**: Criterion.rs

```rust
use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn bench_tool_invocation(c: &mut Criterion) {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let server = runtime.block_on(async { setup_test_server().await });

    c.bench_function("local_tool_invocation", |b| {
        b.iter(|| {
            runtime.block_on(async {
                server.invoke_tool(black_box("echo"), black_box(json!({"msg": "test"}))).await
            })
        })
    });
}

criterion_group!(benches, bench_tool_invocation);
criterion_main!(benches);
```

### 10.4 Security Testing

**Methods**:
- Fuzz testing with `cargo-fuzz`
- Authentication bypass attempts
- Authorization escalation testing
- Rate limit evasion testing
- Signature verification with invalid keys

---

## Appendix A: Configuration Reference

```rust
// src/mcp/server/config.rs

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub bind_address: String,
    pub port: u16,
    pub max_connections: usize,
    pub request_timeout: Duration,

    pub quic: QuicConfig,
    pub security: SecurityConfig,
    pub context: ContextConfig,
    pub consensus: ConsensusConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuicConfig {
    pub max_idle_timeout: Duration,
    pub keep_alive_interval: Duration,
    pub max_concurrent_streams: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityConfig {
    pub enable_authentication: bool,
    pub api_key_hash_algorithm: String, // "blake3"
    pub jwt_secret: Option<String>,
    pub rate_limit_capacity: f64,
    pub rate_limit_refill_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextConfig {
    pub cache_capacity: usize,
    pub persistence_enabled: bool,
    pub gc_interval: Duration,
    pub default_ttl: Duration,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsensusConfig {
    pub enable_consensus: bool,
    pub finality_timeout: Duration,
    pub min_quorum_size: usize,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            bind_address: "0.0.0.0".to_string(),
            port: 8080,
            max_connections: 1000,
            request_timeout: Duration::from_secs(30),

            quic: QuicConfig {
                max_idle_timeout: Duration::from_secs(60),
                keep_alive_interval: Duration::from_secs(5),
                max_concurrent_streams: 100,
            },

            security: SecurityConfig {
                enable_authentication: true,
                api_key_hash_algorithm: "blake3".to_string(),
                jwt_secret: None,
                rate_limit_capacity: 100.0,
                rate_limit_refill_rate: 10.0,
            },

            context: ContextConfig {
                cache_capacity: 10000,
                persistence_enabled: true,
                gc_interval: Duration::from_secs(300),
                default_ttl: Duration::from_secs(3600),
            },

            consensus: ConsensusConfig {
                enable_consensus: true,
                finality_timeout: Duration::from_secs(5),
                min_quorum_size: 3,
            },
        }
    }
}
```

---

## Appendix B: Deployment Checklist

- [ ] Build release binary: `cargo build --release -p cretoai-mcp`
- [ ] Run security audit: `cargo audit`
- [ ] Run benchmarks: `cargo bench -p cretoai-mcp`
- [ ] Generate documentation: `cargo doc --no-deps`
- [ ] Create systemd service file
- [ ] Configure firewall rules (allow QUIC port)
- [ ] Set up monitoring (Prometheus + Grafana)
- [ ] Configure log aggregation (Loki)
- [ ] Create backup schedule for DAG storage
- [ ] Document operational runbook

---

## Appendix C: Future Enhancements

**Phase 4.1 (Post-MVP)**:
- WebSocket transport for browser clients
- Server-sent events (SSE) for streaming responses
- GraphQL API for advanced queries

**Phase 4.2 (Advanced)**:
- Multi-region deployment with gossip protocol
- Zero-downtime rolling upgrades
- Advanced observability (distributed tracing with OpenTelemetry)

**Phase 4.3 (Enterprise)**:
- RBAC with fine-grained permissions
- Audit log compliance (GDPR, SOC2)
- High availability with automatic failover

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-27 | System Architect | Initial architecture specification |

---

**End of Document**
