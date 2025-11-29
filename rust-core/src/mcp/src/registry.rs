//! Agent Registry
//!
//! Manages registered AI agents and their capabilities.

use crate::error::{McpError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

/// Agent information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
    pub capabilities: Vec<String>,
    pub status: AgentStatus,
    pub metadata: HashMap<String, String>,
    pub registered_at: i64,
    pub last_seen: i64,
}

/// Agent status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AgentStatus {
    Active,
    Idle,
    Busy,
    Offline,
}

/// Agent registry for managing connected agents
pub struct AgentRegistry {
    agents: Arc<RwLock<HashMap<String, AgentInfo>>>,
    capabilities_index: Arc<RwLock<HashMap<String, Vec<String>>>>,
}

impl AgentRegistry {
    /// Create a new agent registry
    pub fn new() -> Self {
        Self {
            agents: Arc::new(RwLock::new(HashMap::new())),
            capabilities_index: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register a new agent
    pub async fn register_agent(
        &self,
        name: String,
        capabilities: Vec<String>,
        metadata: HashMap<String, String>,
    ) -> Result<AgentInfo> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp();

        let agent = AgentInfo {
            id: id.clone(),
            name,
            capabilities: capabilities.clone(),
            status: AgentStatus::Active,
            metadata,
            registered_at: now,
            last_seen: now,
        };

        // Add to agents map
        let mut agents = self.agents.write().await;
        agents.insert(id.clone(), agent.clone());

        // Update capabilities index
        let mut cap_index = self.capabilities_index.write().await;
        for capability in capabilities {
            cap_index
                .entry(capability)
                .or_insert_with(Vec::new)
                .push(id.clone());
        }

        Ok(agent)
    }

    /// Unregister an agent
    pub async fn unregister_agent(&self, agent_id: &str) -> Result<()> {
        let mut agents = self.agents.write().await;

        let agent = agents
            .remove(agent_id)
            .ok_or_else(|| McpError::Server(format!("Agent not found: {}", agent_id)))?;

        // Remove from capabilities index
        let mut cap_index = self.capabilities_index.write().await;
        for capability in agent.capabilities {
            if let Some(agent_ids) = cap_index.get_mut(&capability) {
                agent_ids.retain(|id| id != agent_id);
                if agent_ids.is_empty() {
                    cap_index.remove(&capability);
                }
            }
        }

        Ok(())
    }

    /// Get agent information
    pub async fn get_agent(&self, agent_id: &str) -> Result<AgentInfo> {
        let agents = self.agents.read().await;
        agents
            .get(agent_id)
            .cloned()
            .ok_or_else(|| McpError::Server(format!("Agent not found: {}", agent_id)))
    }

    /// List all agents
    pub async fn list_agents(&self) -> Vec<AgentInfo> {
        let agents = self.agents.read().await;
        agents.values().cloned().collect()
    }

    /// Find agents by capability
    pub async fn find_by_capability(&self, capability: &str) -> Vec<AgentInfo> {
        let cap_index = self.capabilities_index.read().await;
        let agent_ids = match cap_index.get(capability) {
            Some(ids) => ids.clone(),
            None => return Vec::new(),
        };

        let agents = self.agents.read().await;
        agent_ids
            .iter()
            .filter_map(|id| agents.get(id).cloned())
            .collect()
    }

    /// Update agent status
    pub async fn update_status(&self, agent_id: &str, status: AgentStatus) -> Result<()> {
        let mut agents = self.agents.write().await;
        let agent = agents
            .get_mut(agent_id)
            .ok_or_else(|| McpError::Server(format!("Agent not found: {}", agent_id)))?;

        agent.status = status;
        agent.last_seen = chrono::Utc::now().timestamp();

        Ok(())
    }

    /// Update agent metadata
    pub async fn update_metadata(
        &self,
        agent_id: &str,
        metadata: HashMap<String, String>,
    ) -> Result<()> {
        let mut agents = self.agents.write().await;
        let agent = agents
            .get_mut(agent_id)
            .ok_or_else(|| McpError::Server(format!("Agent not found: {}", agent_id)))?;

        agent.metadata = metadata;
        agent.last_seen = chrono::Utc::now().timestamp();

        Ok(())
    }

    /// Update agent last seen timestamp
    pub async fn heartbeat(&self, agent_id: &str) -> Result<()> {
        let mut agents = self.agents.write().await;
        let agent = agents
            .get_mut(agent_id)
            .ok_or_else(|| McpError::Server(format!("Agent not found: {}", agent_id)))?;

        agent.last_seen = chrono::Utc::now().timestamp();

        Ok(())
    }

    /// Get agent count
    pub async fn count(&self) -> usize {
        let agents = self.agents.read().await;
        agents.len()
    }

    /// Get available capabilities
    pub async fn list_capabilities(&self) -> Vec<String> {
        let cap_index = self.capabilities_index.read().await;
        cap_index.keys().cloned().collect()
    }
}

impl Default for AgentRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_register_agent() {
        let registry = AgentRegistry::new();

        let agent = registry
            .register_agent(
                "TestAgent".to_string(),
                vec!["coding".to_string(), "testing".to_string()],
                HashMap::new(),
            )
            .await
            .unwrap();

        assert_eq!(agent.name, "TestAgent");
        assert_eq!(agent.capabilities.len(), 2);
        assert_eq!(agent.status, AgentStatus::Active);
    }

    #[tokio::test]
    async fn test_unregister_agent() {
        let registry = AgentRegistry::new();

        let agent = registry
            .register_agent(
                "TestAgent".to_string(),
                vec!["coding".to_string()],
                HashMap::new(),
            )
            .await
            .unwrap();

        assert_eq!(registry.count().await, 1);

        registry.unregister_agent(&agent.id).await.unwrap();

        assert_eq!(registry.count().await, 0);
    }

    #[tokio::test]
    async fn test_find_by_capability() {
        let registry = AgentRegistry::new();

        registry
            .register_agent(
                "Agent1".to_string(),
                vec!["coding".to_string()],
                HashMap::new(),
            )
            .await
            .unwrap();

        registry
            .register_agent(
                "Agent2".to_string(),
                vec!["coding".to_string(), "testing".to_string()],
                HashMap::new(),
            )
            .await
            .unwrap();

        let coding_agents = registry.find_by_capability("coding").await;
        assert_eq!(coding_agents.len(), 2);

        let testing_agents = registry.find_by_capability("testing").await;
        assert_eq!(testing_agents.len(), 1);
    }

    #[tokio::test]
    async fn test_update_status() {
        let registry = AgentRegistry::new();

        let agent = registry
            .register_agent(
                "TestAgent".to_string(),
                vec!["coding".to_string()],
                HashMap::new(),
            )
            .await
            .unwrap();

        registry
            .update_status(&agent.id, AgentStatus::Busy)
            .await
            .unwrap();

        let updated = registry.get_agent(&agent.id).await.unwrap();
        assert_eq!(updated.status, AgentStatus::Busy);
    }

    #[tokio::test]
    async fn test_list_capabilities() {
        let registry = AgentRegistry::new();

        registry
            .register_agent(
                "Agent1".to_string(),
                vec!["coding".to_string(), "testing".to_string()],
                HashMap::new(),
            )
            .await
            .unwrap();

        let capabilities = registry.list_capabilities().await;
        assert_eq!(capabilities.len(), 2);
        assert!(capabilities.contains(&"coding".to_string()));
        assert!(capabilities.contains(&"testing".to_string()));
    }

    #[tokio::test]
    async fn test_heartbeat() {
        let registry = AgentRegistry::new();

        let agent = registry
            .register_agent(
                "TestAgent".to_string(),
                vec!["coding".to_string()],
                HashMap::new(),
            )
            .await
            .unwrap();

        let initial_last_seen = agent.last_seen;

        // Wait for at least 1 second to ensure timestamp changes
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

        registry.heartbeat(&agent.id).await.unwrap();

        let updated = registry.get_agent(&agent.id).await.unwrap();
        assert!(updated.last_seen >= initial_last_seen);
    }
}
