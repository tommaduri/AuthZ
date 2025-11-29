# Phase 4: MCP Integration Layer - Specification

**Version**: 1.0.0
**Date**: 2025-11-27
**Status**: Specification
**Author**: SPARC Specification Agent
**Dependencies**: Phase 1 (Crypto), Phase 2 (QUIC), Phase 3 (Consensus)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Requirements Analysis](#2-requirements-analysis)
3. [Protocol Specification](#3-protocol-specification)
4. [Integration Points](#4-integration-points)
5. [Performance Requirements](#5-performance-requirements)
6. [Security Requirements](#6-security-requirements)
7. [Success Criteria](#7-success-criteria)
8. [Implementation Roadmap](#8-implementation-roadmap)

---

## 1. Executive Summary

### 1.1 Purpose

This specification defines the integration of the Model Context Protocol (MCP) with CretoAI's quantum-resistant, consensus-based distributed network. The MCP Integration Layer enables AI agents to discover each other, invoke tools, share context/memory, and execute distributed prompts across the CretoAI network while leveraging the existing QUIC transport and Avalanche consensus infrastructure.

### 1.2 Context

**Completed Phases**:
- ✅ **Phase 1 (Crypto)**: ML-KEM-768, ML-DSA-87, BLAKE3 hashing
- ✅ **Phase 2 (QUIC)**: Hybrid X25519+ML-KEM-768 transport, Quinn/Rustls
- ✅ **Phase 3 (Consensus)**: Avalanche DAG consensus with Byzantine fault tolerance

**Current Phase**:
- 🎯 **Phase 4 (MCP)**: AI agent coordination, tool invocation, context sharing

### 1.3 Goals

1. **Agent Discovery**: Enable AI agents to discover and register with the network
2. **Tool Invocation**: Route tool calls between distributed AI agents
3. **Context Sharing**: Synchronize memory and context across agents
4. **Distributed Prompts**: Execute prompts that span multiple agents
5. **Quantum Security**: Maintain post-quantum cryptographic guarantees
6. **Consensus Integration**: Use DAG consensus for critical operations (agent registration, tool execution logs)

### 1.4 Non-Goals

- Full MCP client/server implementation (focus on protocol adaptation)
- Browser-based MCP (focus on server-to-server)
- MCP sampling or roots protocols (defer to future phases)
- Natural language processing (MCP layer is protocol only)

### 1.5 Key Innovations

1. **Consensus-Based Agent Registry**: Agent registrations finalized via Avalanche consensus
2. **Distributed Tool Routing**: Tools can be invoked across network boundaries
3. **Quantum-Resistant MCP**: All MCP messages signed with ML-DSA-87
4. **Context DAG**: Agent memory/context stored in consensus DAG
5. **Peer-to-Peer MCP**: No central MCP server required

---

## 2. Requirements Analysis

### 2.1 Functional Requirements

#### FR-MCP-001: Agent Discovery and Registration
- **ID**: FR-MCP-001
- **Priority**: High
- **Description**: AI agents must discover and register with the distributed network
- **Acceptance Criteria**:
  - Agents broadcast registration via QUIC gossip
  - Registration includes agent capabilities (supported tools, resources)
  - Registration finalized via Avalanche consensus
  - Registered agents queryable via DHT-like lookup
  - Agent heartbeats maintain liveness

**Specification**:
```rust
pub struct AgentRegistration {
    /// Unique agent identifier (derived from public key)
    pub agent_id: String,

    /// Human-readable agent name
    pub name: String,

    /// Agent capabilities
    pub capabilities: AgentCapabilities,

    /// Network address for MCP connections
    pub mcp_address: SocketAddr,

    /// Public key for signature verification
    pub public_key: Vec<u8>,

    /// Registration timestamp
    pub timestamp: u64,

    /// ML-DSA-87 signature
    pub signature: Vec<u8>,
}

pub struct AgentCapabilities {
    /// Supported MCP tools
    pub tools: Vec<ToolDefinition>,

    /// Supported MCP resources
    pub resources: Vec<ResourceDefinition>,

    /// Supported MCP prompts
    pub prompts: Vec<PromptDefinition>,

    /// Maximum concurrent requests
    pub max_concurrent_requests: usize,
}
```

#### FR-MCP-002: Tool Discovery
- **ID**: FR-MCP-002
- **Priority**: High
- **Description**: Agents discover available tools across the network
- **Acceptance Criteria**:
  - Query returns all matching tools from registered agents
  - Tool definitions include schema (input/output types)
  - Tool availability updated in real-time (heartbeat failures)
  - Tool routing optimized for latency (prefer local agents)

**Specification**:
```rust
pub struct ToolDefinition {
    /// Tool name (e.g., "read_file", "execute_code")
    pub name: String,

    /// Tool description
    pub description: String,

    /// Input schema (JSON Schema)
    pub input_schema: serde_json::Value,

    /// Provider agent ID
    pub provider_agent: String,

    /// Estimated latency (milliseconds)
    pub estimated_latency_ms: u64,
}

/// Query tools across network
pub async fn query_tools(pattern: &str) -> Result<Vec<ToolDefinition>> {
    // Search local registry (fast path)
    let local_results = search_local_registry(pattern)?;

    // Query remote agents via QUIC
    let remote_results = query_remote_agents(pattern).await?;

    // Merge and rank by latency
    Ok(merge_and_rank(local_results, remote_results))
}
```

#### FR-MCP-003: Tool Invocation
- **ID**: FR-MCP-003
- **Priority**: High
- **Description**: Agents invoke tools on remote agents with result streaming
- **Acceptance Criteria**:
  - Tool invocation uses QUIC bidirectional streams
  - Arguments serialized with JSON (MCP standard)
  - Results streamed back incrementally (QUIC stream)
  - Invocation logged to consensus DAG (audit trail)
  - Timeout handling (default 30 seconds)

**Specification**:
```rust
/// MCP tool invocation request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolInvocation {
    /// Request ID (UUID)
    pub request_id: String,

    /// Tool name
    pub tool_name: String,

    /// Arguments (JSON object)
    pub arguments: serde_json::Value,

    /// Caller agent ID
    pub caller_agent: String,

    /// Timestamp
    pub timestamp: u64,

    /// ML-DSA-87 signature
    pub signature: Vec<u8>,
}

/// MCP tool invocation result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    /// Request ID (matches invocation)
    pub request_id: String,

    /// Result content (JSON)
    pub content: Vec<serde_json::Value>,

    /// Is error?
    pub is_error: bool,

    /// Provider agent ID
    pub provider_agent: String,

    /// Timestamp
    pub timestamp: u64,

    /// ML-DSA-87 signature
    pub signature: Vec<u8>,
}

/// Invoke tool on remote agent
pub async fn invoke_tool(
    target_agent: &str,
    tool_name: &str,
    arguments: serde_json::Value,
) -> Result<impl Stream<Item = ToolResult>> {
    // Step 1: Create signed invocation
    let invocation = create_signed_invocation(tool_name, arguments)?;

    // Step 2: Route to target agent via QUIC
    let connection = get_agent_connection(target_agent).await?;
    let (send, recv) = connection.open_bi().await?;

    // Step 3: Send invocation
    send_json(&send, &invocation).await?;

    // Step 4: Stream results
    let result_stream = stream_json_results(recv);

    // Step 5: Log to consensus DAG (async)
    tokio::spawn(log_invocation_to_dag(invocation));

    Ok(result_stream)
}
```

#### FR-MCP-004: Resource Discovery and Access
- **ID**: FR-MCP-004
- **Priority**: Medium
- **Description**: Agents access resources (files, data) from remote agents
- **Acceptance Criteria**:
  - Resources queryable by URI pattern
  - Resource content streamed via QUIC
  - Resource updates propagated via consensus DAG
  - Access control via agent signatures

**Specification**:
```rust
pub struct ResourceDefinition {
    /// Resource URI (e.g., "file:///path/to/file")
    pub uri: String,

    /// Resource description
    pub description: String,

    /// MIME type
    pub mime_type: String,

    /// Provider agent ID
    pub provider_agent: String,

    /// Size in bytes (if known)
    pub size: Option<u64>,
}

/// Read resource from remote agent
pub async fn read_resource(uri: &str) -> Result<Vec<u8>> {
    // Step 1: Resolve URI to agent
    let provider = resolve_resource_provider(uri)?;

    // Step 2: Create signed request
    let request = create_signed_resource_request(uri)?;

    // Step 3: Send via QUIC
    let connection = get_agent_connection(&provider).await?;
    let (send, recv) = connection.open_bi().await?;
    send_json(&send, &request).await?;

    // Step 4: Receive streamed content
    let content = read_stream_to_bytes(recv).await?;

    Ok(content)
}
```

#### FR-MCP-005: Context Synchronization
- **ID**: FR-MCP-005
- **Priority**: High
- **Description**: Agent memory/context shared across distributed agents
- **Acceptance Criteria**:
  - Context entries stored in consensus DAG
  - Context entries finalized via Avalanche consensus
  - Context queries return consistent views
  - Context updates propagated within 1 second

**Specification**:
```rust
pub struct ContextEntry {
    /// Entry ID (deterministic hash of content)
    pub entry_id: String,

    /// Context key (namespaced)
    pub key: String,

    /// Context value (arbitrary JSON)
    pub value: serde_json::Value,

    /// Owner agent ID
    pub owner_agent: String,

    /// Timestamp
    pub timestamp: u64,

    /// TTL (seconds, 0 = permanent)
    pub ttl: u64,

    /// ML-DSA-87 signature
    pub signature: Vec<u8>,
}

/// Write context entry (stored in DAG)
pub async fn write_context(
    key: &str,
    value: serde_json::Value,
    ttl: u64,
) -> Result<String> {
    // Step 1: Create signed context entry
    let entry = create_signed_context_entry(key, value, ttl)?;

    // Step 2: Convert to DAG vertex
    let vertex = context_entry_to_vertex(entry)?;

    // Step 3: Add to DAG and run consensus
    dag.add_vertex(vertex.clone())?;
    consensus.run_consensus(&vertex.id).await?;

    // Step 4: Return entry ID
    Ok(entry.entry_id)
}

/// Read context entry (from finalized DAG)
pub async fn read_context(key: &str) -> Result<Option<serde_json::Value>> {
    // Step 1: Query DAG for key
    let vertices = dag.query_by_payload_pattern(&format!("context:{}", key))?;

    // Step 2: Filter finalized vertices only
    let finalized = vertices
        .into_iter()
        .filter(|v| v.metadata.finalized)
        .collect::<Vec<_>>();

    // Step 3: Get most recent entry
    let latest = finalized
        .into_iter()
        .max_by_key(|v| v.timestamp);

    // Step 4: Extract value
    Ok(latest.map(|v| extract_context_value(&v)))
}
```

#### FR-MCP-006: Distributed Prompt Execution
- **ID**: FR-MCP-006
- **Priority**: Medium
- **Description**: Execute prompts that coordinate multiple agents
- **Acceptance Criteria**:
  - Prompt templates support agent placeholders
  - Prompt execution routes to appropriate agents
  - Prompt results aggregated from multiple agents
  - Prompt execution logged to consensus DAG

**Specification**:
```rust
pub struct PromptTemplate {
    /// Prompt name
    pub name: String,

    /// Prompt description
    pub description: String,

    /// Arguments schema (JSON Schema)
    pub arguments: serde_json::Value,

    /// Prompt template (mustache-like)
    pub template: String,

    /// Agent routing hints
    pub agent_hints: Vec<String>,
}

/// Execute distributed prompt
pub async fn execute_prompt(
    prompt_name: &str,
    arguments: serde_json::Value,
) -> Result<Vec<serde_json::Value>> {
    // Step 1: Load prompt template
    let template = load_prompt_template(prompt_name)?;

    // Step 2: Render template with arguments
    let rendered = render_template(&template, arguments)?;

    // Step 3: Parse agent routing
    let agent_tasks = parse_agent_routing(&rendered)?;

    // Step 4: Execute tasks in parallel
    let results = execute_tasks_parallel(agent_tasks).await?;

    // Step 5: Aggregate results
    Ok(aggregate_results(results))
}
```

### 2.2 Non-Functional Requirements

#### NFR-MCP-001: Latency
- **ID**: NFR-MCP-001
- **Category**: Performance
- **Description**: MCP operations must be low-latency
- **Metrics**:
  - Tool invocation latency: <100ms p95 (local network)
  - Tool invocation latency: <500ms p95 (WAN)
  - Context read latency: <50ms p95 (finalized entries)
  - Agent discovery latency: <200ms p95

#### NFR-MCP-002: Throughput
- **ID**: NFR-MCP-002
- **Category**: Performance
- **Description**: System must support high concurrent tool invocations
- **Metrics**:
  - Tool invocations: >1000/sec per agent
  - Context writes: >500/sec per agent
  - Agent registrations: >100/sec network-wide

#### NFR-MCP-003: Security
- **ID**: NFR-MCP-003
- **Category**: Security
- **Description**: All MCP messages must be quantum-resistant signed
- **Metrics**:
  - All MCP messages signed with ML-DSA-87
  - All QUIC connections use hybrid KEM
  - No unsigned messages accepted
  - Signature verification: 100% of incoming messages

#### NFR-MCP-004: Reliability
- **ID**: NFR-MCP-004
- **Category**: Reliability
- **Description**: System must handle agent failures gracefully
- **Metrics**:
  - Agent heartbeat interval: 5 seconds
  - Agent failure detection: <15 seconds
  - Tool invocation retry: 3 attempts with exponential backoff
  - Context synchronization: eventual consistency within 5 seconds

#### NFR-MCP-005: Scalability
- **ID**: NFR-MCP-005
- **Category**: Scalability
- **Description**: Support large-scale agent networks
- **Metrics**:
  - Minimum: 10 agents (development)
  - Target: 100 agents (production)
  - Stretch: 1000+ agents (future)
  - Agent registry size: O(N) memory, O(log N) lookup

### 2.3 Constraints

#### Technical Constraints

1. **MCP Protocol Version**: MCP 2024-11-05 (latest stable)
2. **Transport**: QUIC-only (leverage Phase 2)
3. **Consensus**: All critical operations use Avalanche DAG (Phase 3)
4. **Serialization**: JSON for MCP messages (protocol standard), bincode for internal
5. **Crypto**: ML-DSA-87 signatures required for all messages

#### Business Constraints

1. **Timeline**: Phase 4 completion target: 4 weeks
2. **Resources**: 1 senior developer + specification agent
3. **Budget**: No external API dependencies (self-contained)

#### Regulatory Constraints

1. **Cryptographic Compliance**: NIST-standardized PQC algorithms
2. **Data Privacy**: No PII in context entries (application layer responsibility)
3. **Audit Trail**: All tool invocations logged to consensus DAG

### 2.4 Integration Points

#### 2.4.1 Phase 1: Crypto Integration

```rust
use vigilia_crypto::{
    signatures::{MLDSA87, MLDSA87KeyPair, MLDSA87Signature},
    keys::AgentIdentity,
};

/// Sign MCP message
fn sign_mcp_message(message: &McpMessage, identity: &AgentIdentity) -> Result<Vec<u8>> {
    let message_bytes = serde_json::to_vec(message)?;
    let signature = identity.mldsa_keypair.sign(&message_bytes);
    Ok(signature.as_bytes().to_vec())
}

/// Verify MCP message signature
fn verify_mcp_message(
    message: &McpMessage,
    signature: &[u8],
    public_key: &[u8],
) -> Result<()> {
    let message_bytes = serde_json::to_vec(message)?;
    let sig = MLDSA87Signature::from_bytes(signature)?;
    let pk = MLDSA87PublicKey::from_bytes(public_key)?;
    MLDSA87::verify(&message_bytes, &sig, &pk)?;
    Ok(())
}
```

#### 2.4.2 Phase 2: QUIC Integration

```rust
use vigilia_network::libp2p::quic::{QuicTransport, Connection};

/// Send MCP request via QUIC
async fn send_mcp_request(
    connection: &Connection,
    request: McpRequest,
) -> Result<McpResponse> {
    // Open bidirectional stream
    let (mut send, mut recv) = connection.open_bi().await?;

    // Send request (JSON)
    let request_json = serde_json::to_vec(&request)?;
    send.write_all(&request_json).await?;
    send.finish().await?;

    // Receive response (JSON)
    let response_bytes = recv.read_to_end(10_000_000).await?; // 10MB max
    let response = serde_json::from_slice(&response_bytes)?;

    Ok(response)
}
```

#### 2.4.3 Phase 3: Consensus Integration

```rust
use vigilia_dag::{Vertex, VertexBuilder, Graph};
use vigilia_consensus::ConsensusEngine;

/// Store context entry in consensus DAG
async fn store_context_in_dag(
    entry: ContextEntry,
    dag: &Arc<Graph>,
    consensus: &Arc<ConsensusEngine>,
) -> Result<String> {
    // Create vertex from context entry
    let payload = serde_json::to_vec(&entry)?;
    let vertex = VertexBuilder::new(entry.owner_agent.clone())
        .payload(payload)
        .metadata(vec![("type", "context_entry")])
        .build();

    // Add to DAG
    dag.add_vertex(vertex.clone())?;

    // Run consensus
    consensus.run_consensus(&vertex.id).await?;

    // Return vertex ID
    Ok(vertex.id)
}
```

---

## 3. Protocol Specification

### 3.1 MCP Message Types

#### 3.1.1 Agent Registration Message

```rust
/// Agent registration (broadcast via gossip)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRegistrationMessage {
    /// Message type
    #[serde(rename = "type")]
    pub msg_type: String, // "agent_registration"

    /// Agent registration
    pub registration: AgentRegistration,

    /// Signature (ML-DSA-87)
    pub signature: String, // base64-encoded
}
```

**Wire Format (JSON)**:
```json
{
  "type": "agent_registration",
  "registration": {
    "agent_id": "agent_abc123...",
    "name": "File System Agent",
    "capabilities": {
      "tools": [
        {
          "name": "read_file",
          "description": "Read file contents",
          "inputSchema": {
            "type": "object",
            "properties": {
              "path": { "type": "string" }
            }
          }
        }
      ],
      "resources": [],
      "prompts": [],
      "max_concurrent_requests": 100
    },
    "mcp_address": "192.168.1.10:9001",
    "public_key": "base64...",
    "timestamp": 1701234567890
  },
  "signature": "base64..."
}
```

#### 3.1.2 Tool Invocation Message

```rust
/// MCP tool invocation (JSONRPC 2.0 compatible)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolInvocationMessage {
    /// JSONRPC version
    pub jsonrpc: String, // "2.0"

    /// Method name
    pub method: String, // "tools/call"

    /// Request ID
    pub id: String,

    /// Parameters
    pub params: ToolInvocationParams,

    /// Signature (ML-DSA-87)
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolInvocationParams {
    /// Tool name
    pub name: String,

    /// Arguments
    pub arguments: serde_json::Value,

    /// Caller agent ID
    pub caller_agent: String,
}
```

**Wire Format (JSON)**:
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": "req_123",
  "params": {
    "name": "read_file",
    "arguments": {
      "path": "/etc/hosts"
    },
    "caller_agent": "agent_xyz789..."
  },
  "signature": "base64..."
}
```

#### 3.1.3 Tool Result Message

```rust
/// MCP tool result (JSONRPC 2.0 response)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResultMessage {
    /// JSONRPC version
    pub jsonrpc: String, // "2.0"

    /// Request ID
    pub id: String,

    /// Result (if success)
    pub result: Option<ToolResultContent>,

    /// Error (if failure)
    pub error: Option<JsonRpcError>,

    /// Signature (ML-DSA-87)
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResultContent {
    /// Result content (MCP standard)
    pub content: Vec<ContentItem>,

    /// Is error?
    #[serde(default)]
    pub isError: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentItem {
    /// Content type
    #[serde(rename = "type")]
    pub content_type: String, // "text", "image", "resource"

    /// Text content (if type=text)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,

    /// Resource URI (if type=resource)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
}
```

**Wire Format (JSON)**:
```json
{
  "jsonrpc": "2.0",
  "id": "req_123",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "127.0.0.1 localhost\n..."
      }
    ],
    "isError": false
  },
  "signature": "base64..."
}
```

### 3.2 Protocol Flows

#### 3.2.1 Agent Registration Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Agent Registration Flow                      │
└─────────────────────────────────────────────────────────────────┘

    NEW AGENT                    NETWORK NODES

    [1] GENERATE IDENTITY
         │
         ├─ Generate ML-DSA-87 keypair
         ├─ Derive agent_id from public key
         │
         ▼

    [2] CREATE REGISTRATION ─────────────────────► [3] RECEIVE REGISTRATION
         │                                              │
         ├─ AgentRegistration                           ├─ Verify signature
         ├─ Sign with ML-DSA-87                         ├─ Validate capabilities
         │                                              ├─ Add to local registry
         │                                              │
         │                   Gossip via QUIC            │
         │                                              ▼

                                               [4] PROPAGATE TO NETWORK
                                                    │
                                                    ├─ Gossip to k peers
                                                    ├─ Store in consensus DAG
                                                    │
                                                    ▼

                                               [5] CONSENSUS FINALIZATION
                                                    │
                                                    ├─ Run Avalanche consensus
                                                    ├─ Finalize registration
                                                    │
                                                    ▼

    [6] REGISTRATION COMPLETE ◄───────────────── CONFIRMED
         │
         ├─ Agent now discoverable
         ├─ Start heartbeat timer
         │
         ▼

    [7] HEARTBEAT LOOP (every 5s)
         │
         └─ Send heartbeat message
```

#### 3.2.2 Tool Invocation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Tool Invocation Flow                         │
└─────────────────────────────────────────────────────────────────┘

    CALLER AGENT                             PROVIDER AGENT

    [1] DISCOVER TOOL
         │
         ├─ Query local registry
         ├─ Find provider agent
         │
         ▼

    [2] CREATE INVOCATION ───────────────────► [3] RECEIVE INVOCATION
         │                                          │
         ├─ ToolInvocationMessage                   ├─ Verify signature
         ├─ Sign with ML-DSA-87                     ├─ Validate arguments
         │                                          ├─ Check rate limits
         │          QUIC Bidirectional               │
         │                                          ▼

                                              [4] EXECUTE TOOL
                                                   │
                                                   ├─ Run tool implementation
                                                   ├─ Generate result
                                                   │
                                                   ▼

    [6] RECEIVE RESULT ◄─────────────────────── [5] SEND RESULT
         │                                          │
         ├─ Verify signature                        ├─ ToolResultMessage
         ├─ Extract content                         ├─ Sign with ML-DSA-87
         │                                          │
         ▼                                          ▼

    [7] LOG TO DAG                            [8] LOG TO DAG
         │                                          │
         └─ Store invocation record                 └─ Store execution record
```

#### 3.2.3 Context Synchronization Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                 Context Synchronization Flow                    │
└─────────────────────────────────────────────────────────────────┘

    WRITER AGENT                             READER AGENT(S)

    [1] WRITE CONTEXT
         │
         ├─ ContextEntry
         ├─ Sign with ML-DSA-87
         │
         ▼

    [2] CONVERT TO VERTEX
         │
         ├─ Create DAG vertex
         ├─ Payload = ContextEntry
         │
         ▼

    [3] ADD TO DAG ───────────────────────────► [4] RECEIVE VERTEX
         │                                           │
         │         Propagate via QUIC                ├─ Verify signature
         │                                           ├─ Add to local DAG
         │                                           │
         ▼                                           ▼

    [5] RUN CONSENSUS ◄─────────────────────── [6] RUN CONSENSUS
         │                                           │
         ├─ Avalanche query rounds                   ├─ Vote: accept
         │                                           │
         ▼                                           ▼

    [7] FINALIZE ◄────────────────────────────► [8] FINALIZE
         │                                           │
         ├─ Mark vertex as finalized                 ├─ Mark vertex as finalized
         ├─ Update context index                     ├─ Update context index
         │                                           │
         │                                           ▼
         │
         │                                      [9] READ CONTEXT
         │                                           │
         │                                           ├─ Query finalized vertices
         │                                           └─ Return latest value
```

### 3.3 Message Serialization

**Choice**: **JSON for MCP messages** (protocol standard), **bincode for internal**

**Rationale**:
- MCP protocol specification uses JSON
- Human-readable for debugging
- Schema validation with JSON Schema
- Interoperable with non-Rust MCP clients

**Internal Optimization**:
- Registry stored in bincode (compact)
- DAG vertices use bincode (Phase 3)
- Only MCP wire protocol uses JSON

### 3.4 Error Handling

```rust
/// MCP error codes (JSONRPC 2.0 compatible)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    /// Error code
    pub code: i32,

    /// Error message
    pub message: String,

    /// Additional data
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

/// MCP error codes
pub mod error_codes {
    /// Parse error (invalid JSON)
    pub const PARSE_ERROR: i32 = -32700;

    /// Invalid request
    pub const INVALID_REQUEST: i32 = -32600;

    /// Method not found
    pub const METHOD_NOT_FOUND: i32 = -32601;

    /// Invalid params
    pub const INVALID_PARAMS: i32 = -32602;

    /// Internal error
    pub const INTERNAL_ERROR: i32 = -32603;

    /// Agent not found
    pub const AGENT_NOT_FOUND: i32 = -32001;

    /// Tool not found
    pub const TOOL_NOT_FOUND: i32 = -32002;

    /// Signature verification failed
    pub const SIGNATURE_INVALID: i32 = -32003;

    /// Consensus timeout
    pub const CONSENSUS_TIMEOUT: i32 = -32004;
}
```

---

## 4. Integration Points

### 4.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                   MCP Integration Architecture                  │
└─────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│                     APPLICATION LAYER                          │
│  (AI Agents, Tools, Resources, Prompts)                        │
└────────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
┌───────────────────────────────────────────────────────────────┐
│                  MCP INTEGRATION LAYER (NEW)                   │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐  │
│  │   Agent     │  │     Tool     │  │      Context        │  │
│  │  Registry   │  │   Routing    │  │  Synchronization    │  │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬──────────┘  │
│         │                │                      │              │
│         └────────────────┼──────────────────────┘              │
│                          │                                     │
└──────────────────────────┼─────────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
┌────────────────┐  ┌────────────┐  ┌─────────────┐
│   CONSENSUS    │  │  NETWORK   │  │   CRYPTO    │
│ (Phase 3 DAG)  │  │ (Phase 2   │  │ (Phase 1    │
│                │  │    QUIC)   │  │   ML-DSA)   │
└────────────────┘  └────────────┘  └─────────────┘
```

### 4.2 Component Interfaces

#### 4.2.1 McpServer

```rust
/// MCP server implementation (per-agent)
pub struct McpServer {
    /// Agent identity
    identity: Arc<AgentIdentity>,

    /// QUIC transport
    transport: Arc<QuicTransport>,

    /// DAG and consensus
    dag: Arc<Graph>,
    consensus: Arc<ConsensusEngine>,

    /// Agent registry
    registry: Arc<RwLock<AgentRegistry>>,

    /// Tool handlers
    tool_handlers: HashMap<String, Arc<dyn ToolHandler>>,

    /// Resource handlers
    resource_handlers: HashMap<String, Arc<dyn ResourceHandler>>,
}

impl McpServer {
    /// Create new MCP server
    pub fn new(
        identity: Arc<AgentIdentity>,
        transport: Arc<QuicTransport>,
        dag: Arc<Graph>,
        consensus: Arc<ConsensusEngine>,
    ) -> Self;

    /// Start MCP server (listen for requests)
    pub async fn start(&mut self) -> Result<()>;

    /// Register tool handler
    pub fn register_tool(
        &mut self,
        tool: ToolDefinition,
        handler: Arc<dyn ToolHandler>,
    );

    /// Register resource handler
    pub fn register_resource(
        &mut self,
        resource: ResourceDefinition,
        handler: Arc<dyn ResourceHandler>,
    );

    /// Invoke tool on remote agent
    pub async fn invoke_tool(
        &self,
        target_agent: &str,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> Result<ToolResult>;

    /// Read context entry
    pub async fn read_context(&self, key: &str) -> Result<Option<serde_json::Value>>;

    /// Write context entry
    pub async fn write_context(
        &self,
        key: &str,
        value: serde_json::Value,
        ttl: u64,
    ) -> Result<String>;
}
```

#### 4.2.2 AgentRegistry

```rust
/// Agent registry (distributed, consensus-backed)
pub struct AgentRegistry {
    /// Local registry (fast lookup)
    local_agents: HashMap<String, AgentRegistration>,

    /// Remote agents (discovered via network)
    remote_agents: HashMap<String, AgentRegistration>,

    /// Heartbeat tracker
    heartbeats: HashMap<String, Instant>,

    /// DAG and consensus (for finalization)
    dag: Arc<Graph>,
    consensus: Arc<ConsensusEngine>,
}

impl AgentRegistry {
    /// Register local agent
    pub async fn register_local(&mut self, registration: AgentRegistration) -> Result<()>;

    /// Lookup agent by ID
    pub fn lookup(&self, agent_id: &str) -> Option<&AgentRegistration>;

    /// Query agents by capability
    pub fn query_by_tool(&self, tool_name: &str) -> Vec<&AgentRegistration>;

    /// Update heartbeat
    pub fn update_heartbeat(&mut self, agent_id: &str);

    /// Prune stale agents (no heartbeat for 15s)
    pub fn prune_stale(&mut self);
}
```

#### 4.2.3 ToolRouter

```rust
/// Tool routing (select optimal agent for tool)
pub struct ToolRouter {
    /// Agent registry
    registry: Arc<RwLock<AgentRegistry>>,

    /// Latency tracker
    latency_tracker: Arc<RwLock<LatencyTracker>>,
}

impl ToolRouter {
    /// Route tool invocation to best agent
    pub async fn route_tool(
        &self,
        tool_name: &str,
    ) -> Result<String> {
        // Step 1: Find agents with tool
        let agents = self.registry.read().await.query_by_tool(tool_name);

        // Step 2: Rank by latency
        let ranked = self.latency_tracker.read().await.rank_agents(&agents);

        // Step 3: Select best agent
        Ok(ranked.first().ok_or(ToolNotFound)?.agent_id.clone())
    }
}
```

### 4.3 Dependency Graph

```
cretoai-mcp (NEW)
    ├─ cretoai-consensus (Phase 3)
    │   ├─ ConsensusEngine
    │   └─ ConsensusNode
    │
    ├─ cretoai-network (Phase 2)
    │   ├─ QuicTransport
    │   └─ Connection
    │
    ├─ cretoai-dag (existing)
    │   ├─ Graph
    │   ├─ Vertex
    │   └─ VertexBuilder
    │
    ├─ cretoai-crypto (Phase 1)
    │   ├─ MLDSA87
    │   └─ AgentIdentity
    │
    └─ External Dependencies
        ├─ tokio (async runtime)
        ├─ serde_json (MCP messages)
        ├─ jsonrpc-core (JSONRPC 2.0)
        └─ tracing (logging)
```

---

## 5. Performance Requirements

### 5.1 Latency Targets

| Operation | Target | Measurement | Conditions |
|-----------|--------|-------------|------------|
| **Agent registration** | <200ms | Propagation + consensus | 7-node network |
| **Tool discovery** | <50ms | Registry lookup | Local cache hit |
| **Tool invocation (local)** | <100ms p95 | Request + execution + response | Same datacenter |
| **Tool invocation (remote)** | <500ms p95 | Network latency included | Cross-region |
| **Context write** | <150ms p95 | DAG write + consensus | 7-node network |
| **Context read** | <50ms p95 | Finalized vertex lookup | Local DAG |
| **Heartbeat processing** | <10ms | Update timestamp | No consensus required |

### 5.2 Throughput Targets

| Metric | Target | Conditions |
|--------|--------|------------|
| **Agent registrations** | >100/sec | Network-wide |
| **Tool invocations** | >1000/sec | Per agent |
| **Context writes** | >500/sec | Per agent |
| **Context reads** | >5000/sec | Per agent |
| **Heartbeats** | >1000/sec | Network-wide |

### 5.3 Resource Utilization

| Resource | Target | Per Agent |
|----------|--------|-----------|
| **Memory** | <100MB | Base MCP server |
| **Memory** | <500MB | With 10,000 context entries |
| **CPU** | <20% | Idle |
| **CPU** | <60% | Max tool invocation load |
| **Network** | <5 Mbps | Typical |
| **Network** | <50 Mbps | Peak |

### 5.4 Scalability Targets

| Network Size | Agent Discovery | Tool Invocation | Context Sync |
|--------------|-----------------|-----------------|--------------|
| **10 agents** | <50ms | <50ms | <100ms |
| **100 agents** | <200ms | <100ms | <500ms |
| **1000 agents** | <500ms | <200ms | <1s |

**Scalability Strategy**:
- Agent registry: DHT-like distributed hash table (future optimization)
- Tool routing: Local cache with TTL (5 seconds)
- Context synchronization: Eventual consistency via consensus DAG

---

## 6. Security Requirements

### 6.1 Cryptographic Requirements

#### SEC-MCP-001: Message Signing
- **Requirement**: All MCP messages must be signed with ML-DSA-87
- **Verification**: 100% of incoming messages verified
- **Rejection**: Invalid signatures rejected immediately
- **Logging**: Signature failures logged and counted

#### SEC-MCP-002: Transport Security
- **Requirement**: All QUIC connections use hybrid X25519+ML-KEM-768
- **Verification**: No plaintext connections allowed
- **Enforcement**: Connection refused if handshake fails

#### SEC-MCP-003: Identity Binding
- **Requirement**: Agent ID derived from ML-DSA public key (deterministic)
- **Verification**: Agent ID = BLAKE3(public_key)[0..32]
- **Enforcement**: Registration rejected if ID doesn't match key

### 6.2 Access Control

#### SEC-MCP-004: Tool Invocation Authorization
- **Requirement**: Tools can specify allowed caller agents
- **Verification**: Caller agent ID verified via signature
- **Enforcement**: Invocation rejected if caller not authorized

**Example**:
```rust
pub struct ToolDefinition {
    pub name: String,
    // ...
    /// Allowed caller agents (empty = public)
    pub allowed_callers: Vec<String>,
}

fn verify_tool_authorization(
    tool: &ToolDefinition,
    caller: &str,
) -> Result<()> {
    if tool.allowed_callers.is_empty() {
        return Ok(()); // Public tool
    }

    if !tool.allowed_callers.contains(&caller.to_string()) {
        return Err(Unauthorized);
    }

    Ok(())
}
```

#### SEC-MCP-005: Context Access Control
- **Requirement**: Context entries have owner agent ID
- **Verification**: Only owner can update context entry
- **Enforcement**: Write rejected if signer != owner

### 6.3 Audit Trail

#### SEC-MCP-006: Invocation Logging
- **Requirement**: All tool invocations logged to consensus DAG
- **Format**: InvocationRecord vertex
- **Retention**: Permanent (finalized in DAG)
- **Queryable**: Via DAG query API

**InvocationRecord**:
```rust
pub struct InvocationRecord {
    pub request_id: String,
    pub tool_name: String,
    pub caller_agent: String,
    pub provider_agent: String,
    pub arguments_hash: [u8; 32], // BLAKE3 hash (privacy)
    pub result_hash: [u8; 32],
    pub timestamp: u64,
    pub latency_ms: u64,
    pub success: bool,
}
```

#### SEC-MCP-007: Context Change Logging
- **Requirement**: Context writes logged to consensus DAG
- **Format**: ContextEntry vertex (already designed)
- **Retention**: TTL-based (configurable)
- **Queryable**: Via DAG query API

### 6.4 Rate Limiting

#### SEC-MCP-008: Per-Agent Rate Limits
- **Requirement**: Agents specify max_concurrent_requests
- **Enforcement**: Tool invocations queued if limit exceeded
- **Response**: HTTP 429 equivalent (JSONRPC error)

#### SEC-MCP-009: Network-Wide Rate Limits
- **Requirement**: Global rate limit (DDoS protection)
- **Enforcement**: Per-agent token bucket
- **Response**: Temporary blacklist if limit violated

---

## 7. Success Criteria

### 7.1 Functional Success Criteria

| Criterion | Metric | Target | Verification |
|-----------|--------|--------|--------------|
| **FS-MCP-001**: Agent registration | Agents register successfully | 100% | Integration test |
| **FS-MCP-002**: Tool discovery | Query returns matching tools | 100% recall | Unit test |
| **FS-MCP-003**: Tool invocation | Remote tool execution works | 100% | Integration test |
| **FS-MCP-004**: Context sync | Context written and read | 100% consistency | Integration test |
| **FS-MCP-005**: Distributed prompt | Multi-agent prompt executes | 100% | Integration test |

### 7.2 Performance Success Criteria

| Criterion | Metric | Target | Verification |
|-----------|--------|--------|--------------|
| **PS-MCP-001**: Tool invocation latency | Time from request to result | <100ms p95 (local) | Benchmark |
| **PS-MCP-002**: Tool throughput | Invocations per second | >1000/agent | Load test |
| **PS-MCP-003**: Context read latency | Time to read finalized entry | <50ms p95 | Benchmark |
| **PS-MCP-004**: Context write latency | Time to write + finalize | <150ms p95 | Benchmark |
| **PS-MCP-005**: Memory usage | Per-agent memory | <500MB | Resource monitor |

### 7.3 Security Success Criteria

| Criterion | Metric | Target | Verification |
|-----------|--------|--------|--------------|
| **SS-MCP-001**: Message signing | All messages signed | 100% | Code audit |
| **SS-MCP-002**: Signature verification | Invalid signatures rejected | 100% | Fuzz test |
| **SS-MCP-003**: Transport security | QUIC with hybrid KEM | 100% | Connection test |
| **SS-MCP-004**: Audit trail | Invocations logged | 100% | Integration test |

### 7.4 Reliability Success Criteria

| Criterion | Metric | Target | Verification |
|-----------|--------|--------|--------------|
| **RS-MCP-001**: Agent failure detection | Stale agent removal | <15s | Chaos test |
| **RS-MCP-002**: Tool invocation retry | Failed invocations retried | 3 attempts | Integration test |
| **RS-MCP-003**: Context consistency | All nodes see same value | Eventual (5s) | Chaos test |
| **RS-MCP-004**: Partition recovery | Context sync after partition | <10s | Chaos test |

### 7.5 Acceptance Tests

#### Test 1: Basic MCP Flow
```
Given: 2 agents (A, B) on network
When: Agent A registers with file_read tool
And: Agent B discovers file_read tool
And: Agent B invokes file_read on Agent A
Then:
  - Tool invocation succeeds
  - Result returned within 100ms
  - Invocation logged to DAG
  - Signatures verified
```

#### Test 2: Context Synchronization
```
Given: 3 agents (A, B, C) on network
When: Agent A writes context("key", "value1")
And: Wait 1 second (consensus finalization)
And: Agent B reads context("key")
And: Agent C reads context("key")
Then:
  - Both B and C read "value1"
  - Consistency: 100%
  - Latency: <50ms (read)
```

#### Test 3: Agent Failure
```
Given: 3 agents (A, B, C) on network
When: Agent B crashes (SIGKILL)
And: Wait 15 seconds
And: Agent A queries for tools
Then:
  - Agent B no longer in registry
  - Agent B's tools unavailable
  - Network continues operating
```

#### Test 4: Large-Scale Network
```
Given: 100 agents on network
When: Agent 1 invokes tool on Agent 50
And: Measure latency
Then:
  - Invocation succeeds
  - Latency: <200ms p95
  - Memory: <500MB per agent
```

---

## 8. Implementation Roadmap

### 8.1 Phase 4A: Core MCP Integration (Week 1)

**Goal**: Basic MCP server with tool invocation

#### Tasks:
1. ✅ Create `cretoai-mcp` crate
2. ✅ Implement `McpServer` struct
3. ✅ Implement agent registration protocol
4. ✅ Implement `AgentRegistry` with local storage
5. ✅ Implement tool discovery (local only)
6. ✅ Implement tool invocation (single agent)
7. ✅ Add ML-DSA-87 signature verification
8. ✅ Write unit tests for message serialization

**Acceptance Criteria**:
- Single agent can register and start MCP server
- Tools invoked locally (same process)
- All messages signed and verified

**Deliverables**:
- `src/mcp/mod.rs` - Public API
- `src/mcp/server.rs` - McpServer implementation
- `src/mcp/registry.rs` - AgentRegistry
- `src/mcp/messages.rs` - Message types
- `tests/mcp/basic_test.rs` - Unit tests

### 8.2 Phase 4B: Network Integration (Week 2)

**Goal**: Distributed MCP across QUIC network

#### Tasks:
1. ✅ Integrate `QuicTransport` for MCP messages
2. ✅ Implement agent registration gossip
3. ✅ Implement remote tool invocation via QUIC
4. ✅ Implement tool routing (select best agent)
5. ✅ Add latency tracking
6. ✅ Implement heartbeat protocol
7. ✅ Write integration tests for 3-agent network

**Acceptance Criteria**:
- 3 agents can register and discover each other
- Remote tool invocation works across QUIC
- Agent failures detected within 15 seconds

**Deliverables**:
- `src/mcp/network.rs` - Network integration
- `src/mcp/routing.rs` - Tool routing
- `src/mcp/heartbeat.rs` - Heartbeat protocol
- `tests/mcp/network_test.rs` - Integration tests

### 8.3 Phase 4C: Consensus Integration (Week 3)

**Goal**: Context synchronization via DAG

#### Tasks:
1. ✅ Implement context entry to DAG vertex conversion
2. ✅ Implement `write_context` (DAG + consensus)
3. ✅ Implement `read_context` (query finalized vertices)
4. ✅ Implement invocation logging to DAG
5. ✅ Add context TTL and expiration
6. ✅ Implement context query optimization (indexing)
7. ✅ Write chaos tests (partition, crash)

**Acceptance Criteria**:
- Context entries synchronized across network
- Context reads return consistent values
- Invocations logged and queryable
- System recovers from network partitions

**Deliverables**:
- `src/mcp/context.rs` - Context synchronization
- `src/mcp/audit.rs` - Invocation logging
- `tests/mcp/consensus_test.rs` - Consensus integration tests
- `tests/mcp/chaos_test.rs` - Chaos tests

### 8.4 Phase 4D: Performance & Production (Week 4)

**Goal**: Optimize for production deployment

#### Tasks:
1. ✅ Add connection pooling for QUIC
2. ✅ Implement parallel tool invocation
3. ✅ Add caching for tool discovery
4. ✅ Optimize context query (secondary indices)
5. ✅ Add Prometheus metrics
6. ✅ Write benchmarks for latency and throughput
7. ✅ Write load tests (100+ agents)
8. ✅ Write deployment documentation

**Acceptance Criteria**:
- Tool invocation latency: <100ms p95 (local)
- Tool throughput: >1000/sec per agent
- Context read latency: <50ms p95
- Memory: <500MB per agent (100-agent network)

**Deliverables**:
- `src/mcp/cache.rs` - Caching layer
- `src/mcp/metrics.rs` - Prometheus metrics
- `benches/mcp_bench.rs` - Benchmarks
- `tests/mcp/load_test.rs` - Load tests
- `docs/MCP_DEPLOYMENT.md` - Deployment guide

### 8.5 Phase 4E: Advanced Features (Future)

**Goal**: Distributed prompt execution and resources

#### Tasks (Future Work):
1. ⏳ Implement resource discovery protocol
2. ⏳ Implement resource access via QUIC streaming
3. ⏳ Implement prompt template engine
4. ⏳ Implement distributed prompt execution
5. ⏳ Implement prompt result aggregation
6. ⏳ Add MCP sampling protocol support
7. ⏳ Add MCP roots protocol support

**Note**: These features deferred to Phase 5+ based on priority.

---

## Appendices

### Appendix A: MCP Protocol Compatibility

**MCP Version**: 2024-11-05

**Supported Features**:
- ✅ Tools: `tools/list`, `tools/call`
- ✅ Resources: `resources/list`, `resources/read`
- ✅ Prompts: `prompts/list`, `prompts/get`
- ❌ Sampling: (not implemented)
- ❌ Roots: (not implemented)

**Extensions**:
- ✨ Agent discovery (custom)
- ✨ Context synchronization (custom)
- ✨ Consensus-backed registry (custom)

### Appendix B: Example Tool Handler

```rust
/// Example: File read tool handler
pub struct FileReadTool {
    /// Allowed paths (security)
    allowed_paths: Vec<PathBuf>,
}

#[async_trait]
impl ToolHandler for FileReadTool {
    async fn handle(&self, arguments: serde_json::Value) -> Result<ToolResult> {
        // Step 1: Parse arguments
        let path_str = arguments.get("path")
            .and_then(|v| v.as_str())
            .ok_or(InvalidArguments)?;

        let path = PathBuf::from(path_str);

        // Step 2: Security check
        if !self.allowed_paths.iter().any(|p| path.starts_with(p)) {
            return Err(Unauthorized);
        }

        // Step 3: Read file
        let content = tokio::fs::read_to_string(&path).await?;

        // Step 4: Create result
        let result = ToolResult {
            content: vec![ContentItem {
                content_type: "text".to_string(),
                text: Some(content),
                uri: None,
            }],
            is_error: false,
        };

        Ok(result)
    }
}
```

### Appendix C: Glossary

| Term | Definition |
|------|------------|
| **MCP** | Model Context Protocol - standard for AI agent communication |
| **Tool** | A function that can be invoked by an AI agent |
| **Resource** | A data source (file, API, database) exposed to agents |
| **Prompt** | A template for generating prompts across multiple agents |
| **Context** | Shared memory/state synchronized across agents |
| **Agent Registry** | Distributed directory of available agents and capabilities |
| **Tool Routing** | Selecting the optimal agent to handle a tool invocation |
| **Consensus DAG** | Directed Acyclic Graph with Avalanche consensus (Phase 3) |

---

## Document Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2025-11-27 | SPARC Specification Agent | Initial specification |

---

**END OF SPECIFICATION**
