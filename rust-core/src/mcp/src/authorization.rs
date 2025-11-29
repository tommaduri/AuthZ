//! Capability-Based Access Control (CBAC)
//!
//! Provides fine-grained authorization for tool access and context operations.
//! Each agent is granted specific capabilities, and all operations are checked
//! against these capabilities before execution.

use crate::error::{McpError, Result};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Capability represents a specific permission
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Capability {
    /// Execute specific tool
    ExecuteTool(String),
    /// Execute any tool matching pattern
    ExecuteToolPattern(String),
    /// Read context
    ReadContext,
    /// Write context
    WriteContext,
    /// Manage agents (register/unregister)
    ManageAgents,
    /// Administer system
    Admin,
}

impl Capability {
    /// Check if this capability grants access to a tool
    pub fn grants_tool_access(&self, tool_name: &str) -> bool {
        match self {
            Capability::ExecuteTool(name) => name == tool_name,
            Capability::ExecuteToolPattern(pattern) => {
                // Simple wildcard matching (* at end)
                if pattern.ends_with('*') {
                    let prefix = &pattern[..pattern.len() - 1];
                    tool_name.starts_with(prefix)
                } else {
                    pattern == tool_name
                }
            }
            Capability::Admin => true, // Admin can execute any tool
            _ => false,
        }
    }

    /// Check if this capability grants context read access
    pub fn grants_context_read(&self) -> bool {
        matches!(self, Capability::ReadContext | Capability::Admin)
    }

    /// Check if this capability grants context write access
    pub fn grants_context_write(&self) -> bool {
        matches!(self, Capability::WriteContext | Capability::Admin)
    }

    /// Check if this capability grants agent management
    pub fn grants_agent_management(&self) -> bool {
        matches!(self, Capability::ManageAgents | Capability::Admin)
    }
}

/// Agent policy defines capabilities for an agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentPolicy {
    pub agent_id: String,
    pub capabilities: HashSet<Capability>,
    pub created_at: i64,
    pub expires_at: Option<i64>,
}

impl AgentPolicy {
    /// Create a new policy with capabilities
    pub fn new(agent_id: String, capabilities: Vec<Capability>) -> Self {
        Self {
            agent_id,
            capabilities: capabilities.into_iter().collect(),
            created_at: chrono::Utc::now().timestamp(),
            expires_at: None,
        }
    }

    /// Create a new policy with expiration
    pub fn with_expiration(
        agent_id: String,
        capabilities: Vec<Capability>,
        expires_at: i64,
    ) -> Self {
        Self {
            agent_id,
            capabilities: capabilities.into_iter().collect(),
            created_at: chrono::Utc::now().timestamp(),
            expires_at: Some(expires_at),
        }
    }

    /// Check if policy has expired
    pub fn is_expired(&self) -> bool {
        if let Some(expires_at) = self.expires_at {
            chrono::Utc::now().timestamp() > expires_at
        } else {
            false
        }
    }

    /// Check if policy grants specific capability
    pub fn has_capability(&self, capability: &Capability) -> bool {
        !self.is_expired() && self.capabilities.contains(capability)
    }

    /// Check if policy allows tool execution
    pub fn can_execute_tool(&self, tool_name: &str) -> bool {
        !self.is_expired()
            && self
                .capabilities
                .iter()
                .any(|cap| cap.grants_tool_access(tool_name))
    }

    /// Check if policy allows context read
    pub fn can_read_context(&self) -> bool {
        !self.is_expired()
            && self
                .capabilities
                .iter()
                .any(|cap| cap.grants_context_read())
    }

    /// Check if policy allows context write
    pub fn can_write_context(&self) -> bool {
        !self.is_expired()
            && self
                .capabilities
                .iter()
                .any(|cap| cap.grants_context_write())
    }
}

/// Authorization manager
pub struct AuthorizationManager {
    /// Agent policies indexed by agent ID
    policies: Arc<RwLock<HashMap<String, AgentPolicy>>>,
}

impl AuthorizationManager {
    /// Create a new authorization manager
    pub fn new() -> Self {
        Self {
            policies: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Add or update agent policy
    pub async fn set_policy(&self, policy: AgentPolicy) -> Result<()> {
        let mut policies = self.policies.write().await;
        policies.insert(policy.agent_id.clone(), policy);
        Ok(())
    }

    /// Remove agent policy
    pub async fn remove_policy(&self, agent_id: &str) -> Result<()> {
        let mut policies = self.policies.write().await;
        policies.remove(agent_id);
        Ok(())
    }

    /// Get agent policy
    pub async fn get_policy(&self, agent_id: &str) -> Option<AgentPolicy> {
        let policies = self.policies.read().await;
        policies.get(agent_id).cloned()
    }

    /// Check if agent can execute tool
    pub async fn authorize_tool_execution(
        &self,
        agent_id: &str,
        tool_name: &str,
    ) -> Result<()> {
        let policies = self.policies.read().await;

        let policy = policies.get(agent_id).ok_or_else(|| {
            McpError::Auth(format!("No policy found for agent: {}", agent_id))
        })?;

        if policy.is_expired() {
            return Err(McpError::Auth(format!(
                "Policy expired for agent: {}",
                agent_id
            )));
        }

        if policy.can_execute_tool(tool_name) {
            Ok(())
        } else {
            Err(McpError::Auth(format!(
                "Agent {} not authorized to execute tool: {}",
                agent_id, tool_name
            )))
        }
    }

    /// Check if agent can read context
    pub async fn authorize_context_read(&self, agent_id: &str) -> Result<()> {
        let policies = self.policies.read().await;

        let policy = policies.get(agent_id).ok_or_else(|| {
            McpError::Auth(format!("No policy found for agent: {}", agent_id))
        })?;

        if policy.is_expired() {
            return Err(McpError::Auth(format!(
                "Policy expired for agent: {}",
                agent_id
            )));
        }

        if policy.can_read_context() {
            Ok(())
        } else {
            Err(McpError::Auth(format!(
                "Agent {} not authorized to read context",
                agent_id
            )))
        }
    }

    /// Check if agent can write context
    pub async fn authorize_context_write(&self, agent_id: &str) -> Result<()> {
        let policies = self.policies.read().await;

        let policy = policies.get(agent_id).ok_or_else(|| {
            McpError::Auth(format!("No policy found for agent: {}", agent_id))
        })?;

        if policy.is_expired() {
            return Err(McpError::Auth(format!(
                "Policy expired for agent: {}",
                agent_id
            )));
        }

        if policy.can_write_context() {
            Ok(())
        } else {
            Err(McpError::Auth(format!(
                "Agent {} not authorized to write context",
                agent_id
            )))
        }
    }

    /// Grant capability to agent
    pub async fn grant_capability(&self, agent_id: &str, capability: Capability) -> Result<()> {
        let mut policies = self.policies.write().await;

        let policy = policies
            .get_mut(agent_id)
            .ok_or_else(|| McpError::Auth(format!("No policy found for agent: {}", agent_id)))?;

        policy.capabilities.insert(capability);
        Ok(())
    }

    /// Revoke capability from agent
    pub async fn revoke_capability(&self, agent_id: &str, capability: &Capability) -> Result<()> {
        let mut policies = self.policies.write().await;

        let policy = policies
            .get_mut(agent_id)
            .ok_or_else(|| McpError::Auth(format!("No policy found for agent: {}", agent_id)))?;

        policy.capabilities.remove(capability);
        Ok(())
    }

    /// Clean up expired policies
    pub async fn cleanup_expired(&self) -> usize {
        let mut policies = self.policies.write().await;
        let before = policies.len();

        policies.retain(|_, policy| !policy.is_expired());

        before - policies.len()
    }
}

impl Default for AuthorizationManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_tool_authorization() {
        let auth = AuthorizationManager::new();

        let policy = AgentPolicy::new(
            "agent-1".to_string(),
            vec![Capability::ExecuteTool("echo".to_string())],
        );

        auth.set_policy(policy).await.unwrap();

        // Should allow authorized tool
        assert!(auth
            .authorize_tool_execution("agent-1", "echo")
            .await
            .is_ok());

        // Should deny unauthorized tool
        assert!(auth
            .authorize_tool_execution("agent-1", "other")
            .await
            .is_err());
    }

    #[tokio::test]
    async fn test_wildcard_tool_authorization() {
        let auth = AuthorizationManager::new();

        let policy = AgentPolicy::new(
            "agent-1".to_string(),
            vec![Capability::ExecuteToolPattern("test_*".to_string())],
        );

        auth.set_policy(policy).await.unwrap();

        // Should match pattern
        assert!(auth
            .authorize_tool_execution("agent-1", "test_foo")
            .await
            .is_ok());

        assert!(auth
            .authorize_tool_execution("agent-1", "test_bar")
            .await
            .is_ok());

        // Should not match pattern
        assert!(auth
            .authorize_tool_execution("agent-1", "other")
            .await
            .is_err());
    }

    #[tokio::test]
    async fn test_context_authorization() {
        let auth = AuthorizationManager::new();

        let policy = AgentPolicy::new(
            "agent-1".to_string(),
            vec![Capability::ReadContext, Capability::WriteContext],
        );

        auth.set_policy(policy).await.unwrap();

        assert!(auth.authorize_context_read("agent-1").await.is_ok());
        assert!(auth.authorize_context_write("agent-1").await.is_ok());
    }

    #[tokio::test]
    async fn test_admin_capability() {
        let auth = AuthorizationManager::new();

        let policy = AgentPolicy::new("admin".to_string(), vec![Capability::Admin]);

        auth.set_policy(policy).await.unwrap();

        // Admin can do everything
        assert!(auth.authorize_tool_execution("admin", "any_tool").await.is_ok());
        assert!(auth.authorize_context_read("admin").await.is_ok());
        assert!(auth.authorize_context_write("admin").await.is_ok());
    }

    #[tokio::test]
    async fn test_policy_expiration() {
        let auth = AuthorizationManager::new();

        let past = chrono::Utc::now().timestamp() - 100; // 100 seconds ago

        let policy = AgentPolicy::with_expiration(
            "agent-1".to_string(),
            vec![Capability::ExecuteTool("echo".to_string())],
            past,
        );

        auth.set_policy(policy).await.unwrap();

        // Should fail due to expiration
        assert!(auth
            .authorize_tool_execution("agent-1", "echo")
            .await
            .is_err());
    }

    #[tokio::test]
    async fn test_grant_revoke_capability() {
        let auth = AuthorizationManager::new();

        let policy = AgentPolicy::new("agent-1".to_string(), vec![]);

        auth.set_policy(policy).await.unwrap();

        // Initially should fail
        assert!(auth
            .authorize_tool_execution("agent-1", "echo")
            .await
            .is_err());

        // Grant capability
        auth.grant_capability("agent-1", Capability::ExecuteTool("echo".to_string()))
            .await
            .unwrap();

        // Should now succeed
        assert!(auth
            .authorize_tool_execution("agent-1", "echo")
            .await
            .is_ok());

        // Revoke capability
        auth.revoke_capability("agent-1", &Capability::ExecuteTool("echo".to_string()))
            .await
            .unwrap();

        // Should fail again
        assert!(auth
            .authorize_tool_execution("agent-1", "echo")
            .await
            .is_err());
    }

    #[tokio::test]
    async fn test_cleanup_expired() {
        let auth = AuthorizationManager::new();

        let past = chrono::Utc::now().timestamp() - 100;
        let future = chrono::Utc::now().timestamp() + 100;

        auth.set_policy(AgentPolicy::with_expiration(
            "expired-1".to_string(),
            vec![],
            past,
        ))
        .await
        .unwrap();

        auth.set_policy(AgentPolicy::with_expiration(
            "valid-1".to_string(),
            vec![],
            future,
        ))
        .await
        .unwrap();

        let removed = auth.cleanup_expired().await;
        assert_eq!(removed, 1);

        // Expired policy should be gone
        assert!(auth.get_policy("expired-1").await.is_none());

        // Valid policy should remain
        assert!(auth.get_policy("valid-1").await.is_some());
    }
}
