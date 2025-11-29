// Mock Infrastructure for MCP Integration Testing
// Following London School TDD - Mock all external dependencies

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use async_trait::async_trait;
use serde_json::Value;

/// Mock QUIC Transport for testing network operations
#[derive(Clone)]
pub struct MockQuicTransport {
    pub sent_messages: Arc<Mutex<Vec<(String, Vec<u8>)>>>,
    pub connection_results: Arc<Mutex<HashMap<String, Result<(), String>>>>,
    pub receive_queue: Arc<Mutex<Vec<Vec<u8>>>>,
    pub latency_ms: Arc<Mutex<u64>>,
}

impl MockQuicTransport {
    pub fn new() -> Self {
        Self {
            sent_messages: Arc::new(Mutex::new(Vec::new())),
            connection_results: Arc::new(Mutex::new(HashMap::new())),
            receive_queue: Arc::new(Mutex::new(Vec::new())),
            latency_ms: Arc::new(Mutex::new(0)),
        }
    }

    pub fn with_connection_error(mut self, agent_id: &str, error: String) -> Self {
        self.connection_results
            .lock()
            .unwrap()
            .insert(agent_id.to_string(), Err(error));
        self
    }

    pub fn with_latency(self, ms: u64) -> Self {
        *self.latency_ms.lock().unwrap() = ms;
        self
    }

    pub fn expect_message_sent(&self, agent_id: &str, data: Vec<u8>) {
        let messages = self.sent_messages.lock().unwrap();
        assert!(
            messages.iter().any(|(id, msg)| id == agent_id && msg == &data),
            "Expected message to {} not found",
            agent_id
        );
    }

    pub fn queue_incoming_message(&self, data: Vec<u8>) {
        self.receive_queue.lock().unwrap().push(data);
    }
}

#[async_trait]
pub trait QuicTransport: Send + Sync {
    async fn connect(&self, agent_id: &str) -> Result<(), String>;
    async fn send(&self, agent_id: &str, data: Vec<u8>) -> Result<(), String>;
    async fn receive(&self) -> Result<Vec<u8>, String>;
    fn get_latency_ms(&self) -> u64;
}

#[async_trait]
impl QuicTransport for MockQuicTransport {
    async fn connect(&self, agent_id: &str) -> Result<(), String> {
        let results = self.connection_results.lock().unwrap();
        results.get(agent_id).cloned().unwrap_or(Ok(()))
    }

    async fn send(&self, agent_id: &str, data: Vec<u8>) -> Result<(), String> {
        self.sent_messages
            .lock()
            .unwrap()
            .push((agent_id.to_string(), data));
        Ok(())
    }

    async fn receive(&self) -> Result<Vec<u8>, String> {
        let mut queue = self.receive_queue.lock().unwrap();
        queue.pop().ok_or_else(|| "No messages available".to_string())
    }

    fn get_latency_ms(&self) -> u64 {
        *self.latency_ms.lock().unwrap()
    }
}

/// Mock Consensus Node for testing Byzantine coordination
#[derive(Clone)]
pub struct MockConsensusNode {
    pub proposals: Arc<Mutex<Vec<Value>>>,
    pub votes: Arc<Mutex<HashMap<String, bool>>>,
    pub consensus_results: Arc<Mutex<HashMap<String, bool>>>,
    pub byzantine_nodes: Arc<Mutex<Vec<String>>>,
}

impl MockConsensusNode {
    pub fn new() -> Self {
        Self {
            proposals: Arc::new(Mutex::new(Vec::new())),
            votes: Arc::new(Mutex::new(HashMap::new())),
            consensus_results: Arc::new(Mutex::new(HashMap::new())),
            byzantine_nodes: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn with_byzantine_node(self, node_id: &str) -> Self {
        self.byzantine_nodes.lock().unwrap().push(node_id.to_string());
        self
    }

    pub fn with_consensus_result(self, proposal_id: &str, result: bool) -> Self {
        self.consensus_results
            .lock()
            .unwrap()
            .insert(proposal_id.to_string(), result);
        self
    }

    pub fn expect_proposal_submitted(&self, proposal: &Value) {
        let proposals = self.proposals.lock().unwrap();
        assert!(
            proposals.iter().any(|p| p == proposal),
            "Expected proposal not found"
        );
    }

    pub fn expect_vote_cast(&self, proposal_id: &str, vote: bool) {
        let votes = self.votes.lock().unwrap();
        assert_eq!(
            votes.get(proposal_id),
            Some(&vote),
            "Expected vote not found"
        );
    }
}

#[async_trait]
pub trait ConsensusNode: Send + Sync {
    async fn propose(&self, proposal: Value) -> Result<String, String>;
    async fn vote(&self, proposal_id: &str, approve: bool) -> Result<(), String>;
    async fn check_consensus(&self, proposal_id: &str) -> Result<bool, String>;
    fn is_byzantine(&self, node_id: &str) -> bool;
}

#[async_trait]
impl ConsensusNode for MockConsensusNode {
    async fn propose(&self, proposal: Value) -> Result<String, String> {
        self.proposals.lock().unwrap().push(proposal.clone());
        Ok(format!("proposal-{}", uuid::Uuid::new_v4()))
    }

    async fn vote(&self, proposal_id: &str, approve: bool) -> Result<(), String> {
        self.votes
            .lock()
            .unwrap()
            .insert(proposal_id.to_string(), approve);
        Ok(())
    }

    async fn check_consensus(&self, proposal_id: &str) -> Result<bool, String> {
        let results = self.consensus_results.lock().unwrap();
        results
            .get(proposal_id)
            .copied()
            .ok_or_else(|| "Proposal not found".to_string())
    }

    fn is_byzantine(&self, node_id: &str) -> bool {
        self.byzantine_nodes.lock().unwrap().contains(&node_id.to_string())
    }
}

/// Mock Agent Registry for testing agent management
#[derive(Clone)]
pub struct MockAgentRegistry {
    pub registered_agents: Arc<Mutex<HashMap<String, AgentMetadata>>>,
    pub registration_callbacks: Arc<Mutex<Vec<Box<dyn Fn(&str) + Send>>>>,
    pub lookup_errors: Arc<Mutex<HashMap<String, String>>>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AgentMetadata {
    pub agent_id: String,
    pub capabilities: Vec<String>,
    pub tools: Vec<String>,
    pub endpoint: String,
    pub public_key: Vec<u8>,
}

impl MockAgentRegistry {
    pub fn new() -> Self {
        Self {
            registered_agents: Arc::new(Mutex::new(HashMap::new())),
            registration_callbacks: Arc::new(Mutex::new(Vec::new())),
            lookup_errors: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn with_agent(self, metadata: AgentMetadata) -> Self {
        self.registered_agents
            .lock()
            .unwrap()
            .insert(metadata.agent_id.clone(), metadata);
        self
    }

    pub fn with_lookup_error(self, agent_id: &str, error: String) -> Self {
        self.lookup_errors
            .lock()
            .unwrap()
            .insert(agent_id.to_string(), error);
        self
    }

    pub fn expect_agent_registered(&self, agent_id: &str) {
        let agents = self.registered_agents.lock().unwrap();
        assert!(
            agents.contains_key(agent_id),
            "Expected agent {} to be registered",
            agent_id
        );
    }

    pub fn expect_agent_not_registered(&self, agent_id: &str) {
        let agents = self.registered_agents.lock().unwrap();
        assert!(
            !agents.contains_key(agent_id),
            "Expected agent {} not to be registered",
            agent_id
        );
    }
}

#[async_trait]
pub trait AgentRegistry: Send + Sync {
    async fn register(&self, metadata: AgentMetadata) -> Result<(), String>;
    async fn lookup(&self, agent_id: &str) -> Result<AgentMetadata, String>;
    async fn list_by_capability(&self, capability: &str) -> Vec<AgentMetadata>;
    async fn unregister(&self, agent_id: &str) -> Result<(), String>;
}

#[async_trait]
impl AgentRegistry for MockAgentRegistry {
    async fn register(&self, metadata: AgentMetadata) -> Result<(), String> {
        let mut agents = self.registered_agents.lock().unwrap();
        if agents.contains_key(&metadata.agent_id) {
            return Err("Agent already registered".to_string());
        }
        agents.insert(metadata.agent_id.clone(), metadata);
        Ok(())
    }

    async fn lookup(&self, agent_id: &str) -> Result<AgentMetadata, String> {
        let errors = self.lookup_errors.lock().unwrap();
        if let Some(error) = errors.get(agent_id) {
            return Err(error.clone());
        }

        let agents = self.registered_agents.lock().unwrap();
        agents
            .get(agent_id)
            .cloned()
            .ok_or_else(|| "Agent not found".to_string())
    }

    async fn list_by_capability(&self, capability: &str) -> Vec<AgentMetadata> {
        let agents = self.registered_agents.lock().unwrap();
        agents
            .values()
            .filter(|a| a.capabilities.contains(&capability.to_string()))
            .cloned()
            .collect()
    }

    async fn unregister(&self, agent_id: &str) -> Result<(), String> {
        let mut agents = self.registered_agents.lock().unwrap();
        agents.remove(agent_id).ok_or_else(|| "Agent not found".to_string())?;
        Ok(())
    }
}

/// Mock Tool Router for testing tool invocation
#[derive(Clone)]
pub struct MockToolRouter {
    pub tool_handlers: Arc<Mutex<HashMap<String, Box<dyn Fn(Value) -> Result<Value, String> + Send>>>>,
    pub invocation_log: Arc<Mutex<Vec<(String, Value)>>>,
    pub authorization_results: Arc<Mutex<HashMap<String, bool>>>,
}

impl MockToolRouter {
    pub fn new() -> Self {
        Self {
            tool_handlers: Arc::new(Mutex::new(HashMap::new())),
            invocation_log: Arc::new(Mutex::new(Vec::new())),
            authorization_results: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn with_tool_error(self, tool_name: &str) -> Self {
        // Tool will return error when invoked
        self
    }

    pub fn with_authorization(self, agent_tool: &str, authorized: bool) -> Self {
        self.authorization_results
            .lock()
            .unwrap()
            .insert(agent_tool.to_string(), authorized);
        self
    }

    pub fn expect_tool_invoked(&self, tool_name: &str, params: &Value) {
        let log = self.invocation_log.lock().unwrap();
        assert!(
            log.iter().any(|(name, p)| name == tool_name && p == params),
            "Expected tool {} to be invoked with {:?}",
            tool_name,
            params
        );
    }

    pub fn expect_tool_not_invoked(&self, tool_name: &str) {
        let log = self.invocation_log.lock().unwrap();
        assert!(
            !log.iter().any(|(name, _)| name == tool_name),
            "Expected tool {} not to be invoked",
            tool_name
        );
    }
}

#[async_trait]
pub trait ToolRouter: Send + Sync {
    async fn invoke(
        &self,
        agent_id: &str,
        tool_name: &str,
        params: Value,
    ) -> Result<Value, String>;
    async fn list_tools(&self, agent_id: &str) -> Vec<String>;
    fn is_authorized(&self, agent_id: &str, tool_name: &str) -> bool;
}

#[async_trait]
impl ToolRouter for MockToolRouter {
    async fn invoke(
        &self,
        agent_id: &str,
        tool_name: &str,
        params: Value,
    ) -> Result<Value, String> {
        // Check authorization
        let auth_key = format!("{}:{}", agent_id, tool_name);
        let auth_results = self.authorization_results.lock().unwrap();
        if let Some(&authorized) = auth_results.get(&auth_key) {
            if !authorized {
                return Err("Unauthorized tool access".to_string());
            }
        }

        // Log invocation
        self.invocation_log
            .lock()
            .unwrap()
            .push((tool_name.to_string(), params.clone()));

        // Return mock result
        Ok(Value::Object(serde_json::Map::new()))
    }

    async fn list_tools(&self, _agent_id: &str) -> Vec<String> {
        vec!["tool1".to_string(), "tool2".to_string()]
    }

    fn is_authorized(&self, agent_id: &str, tool_name: &str) -> bool {
        let auth_key = format!("{}:{}", agent_id, tool_name);
        let auth_results = self.authorization_results.lock().unwrap();
        auth_results.get(&auth_key).copied().unwrap_or(true)
    }
}

/// Mock Context Store for testing context sharing
#[derive(Clone)]
pub struct MockContextStore {
    pub contexts: Arc<Mutex<HashMap<String, Value>>>,
    pub sync_log: Arc<Mutex<Vec<String>>>,
    pub retrieval_errors: Arc<Mutex<HashMap<String, String>>>,
}

impl MockContextStore {
    pub fn new() -> Self {
        Self {
            contexts: Arc::new(Mutex::new(HashMap::new())),
            sync_log: Arc::new(Mutex::new(Vec::new())),
            retrieval_errors: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn with_context(self, key: &str, value: Value) -> Self {
        self.contexts.lock().unwrap().insert(key.to_string(), value);
        self
    }

    pub fn with_retrieval_error(self, key: &str, error: String) -> Self {
        self.retrieval_errors
            .lock()
            .unwrap()
            .insert(key.to_string(), error);
        self
    }

    pub fn expect_context_stored(&self, key: &str) {
        let contexts = self.contexts.lock().unwrap();
        assert!(contexts.contains_key(key), "Expected context {} to be stored", key);
    }

    pub fn expect_sync_performed(&self, key: &str) {
        let log = self.sync_log.lock().unwrap();
        assert!(
            log.iter().any(|k| k == key),
            "Expected context {} to be synced",
            key
        );
    }
}

#[async_trait]
pub trait ContextStore: Send + Sync {
    async fn store(&self, key: &str, value: Value) -> Result<(), String>;
    async fn retrieve(&self, key: &str) -> Result<Value, String>;
    async fn sync(&self, key: &str, agents: Vec<String>) -> Result<(), String>;
    async fn delete(&self, key: &str) -> Result<(), String>;
}

#[async_trait]
impl ContextStore for MockContextStore {
    async fn store(&self, key: &str, value: Value) -> Result<(), String> {
        self.contexts.lock().unwrap().insert(key.to_string(), value);
        Ok(())
    }

    async fn retrieve(&self, key: &str) -> Result<Value, String> {
        let errors = self.retrieval_errors.lock().unwrap();
        if let Some(error) = errors.get(key) {
            return Err(error.clone());
        }

        let contexts = self.contexts.lock().unwrap();
        contexts
            .get(key)
            .cloned()
            .ok_or_else(|| "Context not found".to_string())
    }

    async fn sync(&self, key: &str, _agents: Vec<String>) -> Result<(), String> {
        self.sync_log.lock().unwrap().push(key.to_string());
        Ok(())
    }

    async fn delete(&self, key: &str) -> Result<(), String> {
        let mut contexts = self.contexts.lock().unwrap();
        contexts.remove(key).ok_or_else(|| "Context not found".to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn mock_quic_transport_sends_message() {
        let transport = MockQuicTransport::new();
        transport.send("agent-1", vec![1, 2, 3]).await.unwrap();
        transport.expect_message_sent("agent-1", vec![1, 2, 3]);
    }

    #[tokio::test]
    async fn mock_consensus_node_records_proposal() {
        let node = MockConsensusNode::new();
        let proposal = serde_json::json!({"action": "test"});
        node.propose(proposal.clone()).await.unwrap();
        node.expect_proposal_submitted(&proposal);
    }

    #[tokio::test]
    async fn mock_agent_registry_prevents_duplicate_registration() {
        let registry = MockAgentRegistry::new();
        let metadata = AgentMetadata {
            agent_id: "agent-1".to_string(),
            capabilities: vec![],
            tools: vec![],
            endpoint: "localhost".to_string(),
            public_key: vec![],
        };

        registry.register(metadata.clone()).await.unwrap();
        let result = registry.register(metadata).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn mock_tool_router_logs_invocations() {
        let router = MockToolRouter::new();
        let params = serde_json::json!({"param": "value"});
        router.invoke("agent-1", "tool1", params.clone()).await.unwrap();
        router.expect_tool_invoked("tool1", &params);
    }

    #[tokio::test]
    async fn mock_context_store_retrieves_stored_context() {
        let store = MockContextStore::new();
        let value = serde_json::json!({"key": "value"});
        store.store("context-1", value.clone()).await.unwrap();
        let retrieved = store.retrieve("context-1").await.unwrap();
        assert_eq!(retrieved, value);
    }
}
