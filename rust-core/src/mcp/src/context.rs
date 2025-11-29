//! MCP Context Management
//!
//! Manages conversation context with DAG persistence.

use crate::error::{McpError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

/// Context entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextEntry {
    pub key: String,
    pub value: serde_json::Value,
    pub timestamp: i64,
    pub metadata: HashMap<String, String>,
}

/// Context snapshot
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextSnapshot {
    pub context_id: String,
    pub entries: HashMap<String, ContextEntry>,
    pub created_at: i64,
}

/// Context manager for maintaining conversation state
pub struct ContextManager {
    contexts: Arc<RwLock<HashMap<String, HashMap<String, ContextEntry>>>>,
    max_contexts: usize,
    max_entries_per_context: usize,
}

impl ContextManager {
    /// Create a new context manager
    pub fn new(max_contexts: usize, max_entries_per_context: usize) -> Self {
        Self {
            contexts: Arc::new(RwLock::new(HashMap::new())),
            max_contexts,
            max_entries_per_context,
        }
    }

    /// Create a new context
    pub async fn create_context(&self) -> Result<String> {
        let mut contexts = self.contexts.write().await;

        if contexts.len() >= self.max_contexts {
            return Err(McpError::Context(
                "Maximum contexts reached".to_string(),
            ));
        }

        let context_id = Uuid::new_v4().to_string();
        contexts.insert(context_id.clone(), HashMap::new());

        Ok(context_id)
    }

    /// Delete a context
    pub async fn delete_context(&self, context_id: &str) -> Result<()> {
        let mut contexts = self.contexts.write().await;
        contexts
            .remove(context_id)
            .ok_or_else(|| McpError::Context(format!("Context not found: {}", context_id)))?;

        Ok(())
    }

    /// Set a value in context
    pub async fn set(
        &self,
        context_id: &str,
        key: String,
        value: serde_json::Value,
        metadata: HashMap<String, String>,
    ) -> Result<()> {
        let mut contexts = self.contexts.write().await;

        let context = contexts
            .get_mut(context_id)
            .ok_or_else(|| McpError::Context(format!("Context not found: {}", context_id)))?;

        if context.len() >= self.max_entries_per_context && !context.contains_key(&key) {
            return Err(McpError::Context(
                "Maximum entries per context reached".to_string(),
            ));
        }

        let entry = ContextEntry {
            key: key.clone(),
            value,
            timestamp: chrono::Utc::now().timestamp(),
            metadata,
        };

        context.insert(key, entry);

        Ok(())
    }

    /// Get a value from context
    pub async fn get(&self, context_id: &str, key: &str) -> Result<ContextEntry> {
        let contexts = self.contexts.read().await;

        let context = contexts
            .get(context_id)
            .ok_or_else(|| McpError::Context(format!("Context not found: {}", context_id)))?;

        context
            .get(key)
            .cloned()
            .ok_or_else(|| McpError::Context(format!("Key not found: {}", key)))
    }

    /// Get multiple values from context
    pub async fn get_many(&self, context_id: &str, keys: &[String]) -> Result<Vec<ContextEntry>> {
        let contexts = self.contexts.read().await;

        let context = contexts
            .get(context_id)
            .ok_or_else(|| McpError::Context(format!("Context not found: {}", context_id)))?;

        let mut entries = Vec::new();
        for key in keys {
            if let Some(entry) = context.get(key) {
                entries.push(entry.clone());
            }
        }

        Ok(entries)
    }

    /// Get all entries in a context
    pub async fn get_all(&self, context_id: &str) -> Result<Vec<ContextEntry>> {
        let contexts = self.contexts.read().await;

        let context = contexts
            .get(context_id)
            .ok_or_else(|| McpError::Context(format!("Context not found: {}", context_id)))?;

        Ok(context.values().cloned().collect())
    }

    /// Remove a value from context
    pub async fn remove(&self, context_id: &str, key: &str) -> Result<()> {
        let mut contexts = self.contexts.write().await;

        let context = contexts
            .get_mut(context_id)
            .ok_or_else(|| McpError::Context(format!("Context not found: {}", context_id)))?;

        context
            .remove(key)
            .ok_or_else(|| McpError::Context(format!("Key not found: {}", key)))?;

        Ok(())
    }

    /// Clear all entries in a context
    pub async fn clear(&self, context_id: &str) -> Result<()> {
        let mut contexts = self.contexts.write().await;

        let context = contexts
            .get_mut(context_id)
            .ok_or_else(|| McpError::Context(format!("Context not found: {}", context_id)))?;

        context.clear();

        Ok(())
    }

    /// Check if a context exists
    pub async fn has_context(&self, context_id: &str) -> bool {
        let contexts = self.contexts.read().await;
        contexts.contains_key(context_id)
    }

    /// Get context entry count
    pub async fn entry_count(&self, context_id: &str) -> Result<usize> {
        let contexts = self.contexts.read().await;

        let context = contexts
            .get(context_id)
            .ok_or_else(|| McpError::Context(format!("Context not found: {}", context_id)))?;

        Ok(context.len())
    }

    /// List all context IDs
    pub async fn list_contexts(&self) -> Vec<String> {
        let contexts = self.contexts.read().await;
        contexts.keys().cloned().collect()
    }

    /// Create a snapshot of a context
    pub async fn snapshot(&self, context_id: &str) -> Result<ContextSnapshot> {
        let contexts = self.contexts.read().await;

        let context = contexts
            .get(context_id)
            .ok_or_else(|| McpError::Context(format!("Context not found: {}", context_id)))?;

        Ok(ContextSnapshot {
            context_id: context_id.to_string(),
            entries: context.clone(),
            created_at: chrono::Utc::now().timestamp(),
        })
    }

    /// Restore a context from a snapshot
    pub async fn restore(&self, snapshot: ContextSnapshot) -> Result<()> {
        let mut contexts = self.contexts.write().await;

        if contexts.len() >= self.max_contexts && !contexts.contains_key(&snapshot.context_id) {
            return Err(McpError::Context(
                "Maximum contexts reached".to_string(),
            ));
        }

        contexts.insert(snapshot.context_id, snapshot.entries);

        Ok(())
    }

    /// Merge one context into another
    pub async fn merge(&self, source_id: &str, target_id: &str) -> Result<()> {
        let mut contexts = self.contexts.write().await;

        let source = contexts
            .get(source_id)
            .ok_or_else(|| McpError::Context(format!("Source context not found: {}", source_id)))?
            .clone();

        let target = contexts
            .get_mut(target_id)
            .ok_or_else(|| McpError::Context(format!("Target context not found: {}", target_id)))?;

        for (key, entry) in source {
            if target.len() >= self.max_entries_per_context && !target.contains_key(&key) {
                break;
            }
            target.insert(key, entry);
        }

        Ok(())
    }
}

impl Default for ContextManager {
    fn default() -> Self {
        Self::new(1000, 10000)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_create_context() {
        let manager = ContextManager::default();

        let context_id = manager.create_context().await.unwrap();

        assert!(manager.has_context(&context_id).await);
    }

    #[tokio::test]
    async fn test_set_and_get() {
        let manager = ContextManager::default();

        let context_id = manager.create_context().await.unwrap();

        manager
            .set(
                &context_id,
                "key1".to_string(),
                serde_json::json!("value1"),
                HashMap::new(),
            )
            .await
            .unwrap();

        let entry = manager.get(&context_id, "key1").await.unwrap();

        assert_eq!(entry.value, serde_json::json!("value1"));
    }

    #[tokio::test]
    async fn test_get_many() {
        let manager = ContextManager::default();

        let context_id = manager.create_context().await.unwrap();

        manager
            .set(
                &context_id,
                "key1".to_string(),
                serde_json::json!("value1"),
                HashMap::new(),
            )
            .await
            .unwrap();

        manager
            .set(
                &context_id,
                "key2".to_string(),
                serde_json::json!("value2"),
                HashMap::new(),
            )
            .await
            .unwrap();

        let entries = manager
            .get_many(
                &context_id,
                &[
                    "key1".to_string(),
                    "key2".to_string(),
                    "key3".to_string(),
                ],
            )
            .await
            .unwrap();

        assert_eq!(entries.len(), 2);
    }

    #[tokio::test]
    async fn test_get_all() {
        let manager = ContextManager::default();

        let context_id = manager.create_context().await.unwrap();

        manager
            .set(
                &context_id,
                "key1".to_string(),
                serde_json::json!("value1"),
                HashMap::new(),
            )
            .await
            .unwrap();

        manager
            .set(
                &context_id,
                "key2".to_string(),
                serde_json::json!("value2"),
                HashMap::new(),
            )
            .await
            .unwrap();

        let entries = manager.get_all(&context_id).await.unwrap();

        assert_eq!(entries.len(), 2);
    }

    #[tokio::test]
    async fn test_remove() {
        let manager = ContextManager::default();

        let context_id = manager.create_context().await.unwrap();

        manager
            .set(
                &context_id,
                "key1".to_string(),
                serde_json::json!("value1"),
                HashMap::new(),
            )
            .await
            .unwrap();

        assert_eq!(manager.entry_count(&context_id).await.unwrap(), 1);

        manager.remove(&context_id, "key1").await.unwrap();

        assert_eq!(manager.entry_count(&context_id).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn test_clear() {
        let manager = ContextManager::default();

        let context_id = manager.create_context().await.unwrap();

        manager
            .set(
                &context_id,
                "key1".to_string(),
                serde_json::json!("value1"),
                HashMap::new(),
            )
            .await
            .unwrap();

        manager
            .set(
                &context_id,
                "key2".to_string(),
                serde_json::json!("value2"),
                HashMap::new(),
            )
            .await
            .unwrap();

        assert_eq!(manager.entry_count(&context_id).await.unwrap(), 2);

        manager.clear(&context_id).await.unwrap();

        assert_eq!(manager.entry_count(&context_id).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn test_delete_context() {
        let manager = ContextManager::default();

        let context_id = manager.create_context().await.unwrap();

        assert!(manager.has_context(&context_id).await);

        manager.delete_context(&context_id).await.unwrap();

        assert!(!manager.has_context(&context_id).await);
    }

    #[tokio::test]
    async fn test_snapshot_and_restore() {
        let manager = ContextManager::default();

        let context_id = manager.create_context().await.unwrap();

        manager
            .set(
                &context_id,
                "key1".to_string(),
                serde_json::json!("value1"),
                HashMap::new(),
            )
            .await
            .unwrap();

        let snapshot = manager.snapshot(&context_id).await.unwrap();

        manager.delete_context(&context_id).await.unwrap();

        manager.restore(snapshot).await.unwrap();

        assert!(manager.has_context(&context_id).await);

        let entry = manager.get(&context_id, "key1").await.unwrap();

        assert_eq!(entry.value, serde_json::json!("value1"));
    }

    #[tokio::test]
    async fn test_merge_contexts() {
        let manager = ContextManager::default();

        let context1 = manager.create_context().await.unwrap();
        let context2 = manager.create_context().await.unwrap();

        manager
            .set(
                &context1,
                "key1".to_string(),
                serde_json::json!("value1"),
                HashMap::new(),
            )
            .await
            .unwrap();

        manager
            .set(
                &context2,
                "key2".to_string(),
                serde_json::json!("value2"),
                HashMap::new(),
            )
            .await
            .unwrap();

        manager.merge(&context1, &context2).await.unwrap();

        assert_eq!(manager.entry_count(&context2).await.unwrap(), 2);
    }

    #[tokio::test]
    async fn test_max_contexts_limit() {
        let manager = ContextManager::new(2, 100);

        manager.create_context().await.unwrap();
        manager.create_context().await.unwrap();

        let result = manager.create_context().await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_max_entries_limit() {
        let manager = ContextManager::new(10, 2);

        let context_id = manager.create_context().await.unwrap();

        manager
            .set(
                &context_id,
                "key1".to_string(),
                serde_json::json!("value1"),
                HashMap::new(),
            )
            .await
            .unwrap();

        manager
            .set(
                &context_id,
                "key2".to_string(),
                serde_json::json!("value2"),
                HashMap::new(),
            )
            .await
            .unwrap();

        let result = manager
            .set(
                &context_id,
                "key3".to_string(),
                serde_json::json!("value3"),
                HashMap::new(),
            )
            .await;

        assert!(result.is_err());
    }
}
