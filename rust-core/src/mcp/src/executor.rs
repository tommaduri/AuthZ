//! Prompt Executor
//!
//! Executes AI prompts with context management.

use crate::context::{ContextEntry, ContextManager};
use crate::error::{McpError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

/// Prompt execution request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptRequest {
    pub prompt: String,
    pub context_id: Option<String>,
    pub parameters: HashMap<String, serde_json::Value>,
    pub max_tokens: Option<usize>,
    pub temperature: Option<f32>,
}

/// Prompt execution result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptResult {
    pub content: String,
    pub context_id: Option<String>,
    pub metadata: PromptMetadata,
}

/// Prompt execution metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptMetadata {
    pub tokens_used: usize,
    pub execution_time_ms: u64,
    pub model: String,
    pub timestamp: i64,
}

/// Prompt executor for AI operations
pub struct PromptExecutor {
    context_manager: Arc<ContextManager>,
    default_model: String,
    max_tokens_default: usize,
    temperature_default: f32,
}

impl PromptExecutor {
    /// Create a new prompt executor
    pub fn new(context_manager: Arc<ContextManager>) -> Self {
        Self {
            context_manager,
            default_model: "vigilia-ai-v1".to_string(),
            max_tokens_default: 2048,
            temperature_default: 0.7,
        }
    }

    /// Execute a prompt
    pub async fn execute(&self, request: PromptRequest) -> Result<PromptResult> {
        let start_time = std::time::Instant::now();

        // Get context if provided
        let context_entries = if let Some(ref context_id) = request.context_id {
            if self.context_manager.has_context(context_id).await {
                self.context_manager.get_all(context_id).await?
            } else {
                Vec::new()
            }
        } else {
            Vec::new()
        };

        // Build prompt with context
        let full_prompt = self.build_full_prompt(&request.prompt, &context_entries);

        // Execute prompt (mock implementation)
        let result_content = self.execute_model(&full_prompt, &request).await?;

        // Update context with result if context_id provided
        if let Some(ref context_id) = request.context_id {
            if self.context_manager.has_context(context_id).await {
                self.store_result_in_context(context_id, &request.prompt, &result_content)
                    .await?;
            }
        }

        let execution_time = start_time.elapsed().as_millis() as u64;

        // Calculate tokens before moving result_content
        let tokens_used = self.estimate_tokens(&full_prompt) + self.estimate_tokens(&result_content);

        Ok(PromptResult {
            content: result_content,
            context_id: request.context_id.clone(),
            metadata: PromptMetadata {
                tokens_used,
                execution_time_ms: execution_time,
                model: self.default_model.clone(),
                timestamp: chrono::Utc::now().timestamp(),
            },
        })
    }

    /// Execute a prompt with streaming (placeholder)
    pub async fn execute_stream(&self, request: PromptRequest) -> Result<Vec<String>> {
        // In production, this would stream tokens as they're generated
        let result = self.execute(request).await?;

        // Mock streaming by splitting into chunks
        let chunks: Vec<String> = result
            .content
            .split_whitespace()
            .map(|s| s.to_string())
            .collect();

        Ok(chunks)
    }

    /// Build full prompt with context
    fn build_full_prompt(&self, prompt: &str, context_entries: &[ContextEntry]) -> String {
        if context_entries.is_empty() {
            return prompt.to_string();
        }

        let mut full_prompt = String::new();
        full_prompt.push_str("Context:\n");

        for entry in context_entries {
            full_prompt.push_str(&format!(
                "  {}: {}\n",
                entry.key,
                entry.value.to_string()
            ));
        }

        full_prompt.push_str("\nPrompt:\n");
        full_prompt.push_str(prompt);

        full_prompt
    }

    /// Execute the model (mock implementation)
    async fn execute_model(&self, prompt: &str, request: &PromptRequest) -> Result<String> {
        // In production, this would call an actual AI model
        // For now, we return a mock response

        let max_tokens = request.max_tokens.unwrap_or(self.max_tokens_default);
        let _temperature = request.temperature.unwrap_or(self.temperature_default);

        // Mock response
        let response = format!(
            "Response to: {}\n(max_tokens: {}, model: {})",
            prompt.chars().take(50).collect::<String>(),
            max_tokens,
            self.default_model
        );

        Ok(response)
    }

    /// Store execution result in context
    async fn store_result_in_context(
        &self,
        context_id: &str,
        prompt: &str,
        result: &str,
    ) -> Result<()> {
        // Store prompt
        self.context_manager
            .set(
                context_id,
                format!("prompt_{}", uuid::Uuid::new_v4()),
                serde_json::json!(prompt),
                HashMap::new(),
            )
            .await?;

        // Store result
        self.context_manager
            .set(
                context_id,
                format!("result_{}", uuid::Uuid::new_v4()),
                serde_json::json!(result),
                HashMap::new(),
            )
            .await?;

        Ok(())
    }

    /// Estimate token count (simple heuristic)
    fn estimate_tokens(&self, text: &str) -> usize {
        // Simple estimation: ~4 characters per token
        (text.len() / 4).max(1)
    }

    /// Get execution statistics
    pub fn get_stats(&self) -> ExecutorStats {
        ExecutorStats {
            default_model: self.default_model.clone(),
            max_tokens_default: self.max_tokens_default,
            temperature_default: self.temperature_default,
        }
    }

    /// Update default configuration
    pub fn configure(&mut self, model: Option<String>, max_tokens: Option<usize>, temperature: Option<f32>) {
        if let Some(m) = model {
            self.default_model = m;
        }
        if let Some(t) = max_tokens {
            self.max_tokens_default = t;
        }
        if let Some(temp) = temperature {
            self.temperature_default = temp;
        }
    }
}

/// Executor statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutorStats {
    pub default_model: String,
    pub max_tokens_default: usize,
    pub temperature_default: f32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_execute_without_context() {
        let context_manager = Arc::new(ContextManager::default());
        let executor = PromptExecutor::new(context_manager);

        let request = PromptRequest {
            prompt: "Hello, world!".to_string(),
            context_id: None,
            parameters: HashMap::new(),
            max_tokens: Some(100),
            temperature: Some(0.7),
        };

        let result = executor.execute(request).await.unwrap();

        assert!(!result.content.is_empty());
        assert_eq!(result.context_id, None);
        assert!(result.metadata.tokens_used > 0);
    }

    #[tokio::test]
    async fn test_execute_with_context() {
        let context_manager = Arc::new(ContextManager::default());
        let executor = PromptExecutor::new(Arc::clone(&context_manager));

        let context_id = context_manager.create_context().await.unwrap();

        context_manager
            .set(
                &context_id,
                "user_name".to_string(),
                serde_json::json!("Alice"),
                HashMap::new(),
            )
            .await
            .unwrap();

        let request = PromptRequest {
            prompt: "Hello!".to_string(),
            context_id: Some(context_id.clone()),
            parameters: HashMap::new(),
            max_tokens: None,
            temperature: None,
        };

        let result = executor.execute(request).await.unwrap();

        assert!(!result.content.is_empty());
        assert_eq!(result.context_id, Some(context_id.clone()));

        // Verify context was updated
        let count = context_manager.entry_count(&context_id).await.unwrap();
        assert!(count > 1); // Original entry + prompt + result
    }

    #[tokio::test]
    async fn test_execute_stream() {
        let context_manager = Arc::new(ContextManager::default());
        let executor = PromptExecutor::new(context_manager);

        let request = PromptRequest {
            prompt: "Tell me a story".to_string(),
            context_id: None,
            parameters: HashMap::new(),
            max_tokens: Some(100),
            temperature: Some(0.8),
        };

        let chunks = executor.execute_stream(request).await.unwrap();

        assert!(!chunks.is_empty());
    }

    #[tokio::test]
    async fn test_estimate_tokens() {
        let context_manager = Arc::new(ContextManager::default());
        let executor = PromptExecutor::new(context_manager);

        let text = "Hello, world! This is a test.";
        let tokens = executor.estimate_tokens(text);

        assert!(tokens > 0);
        assert!(tokens < text.len()); // Should be less than character count
    }

    #[tokio::test]
    async fn test_get_stats() {
        let context_manager = Arc::new(ContextManager::default());
        let executor = PromptExecutor::new(context_manager);

        let stats = executor.get_stats();

        assert_eq!(stats.default_model, "vigilia-ai-v1");
        assert_eq!(stats.max_tokens_default, 2048);
        assert_eq!(stats.temperature_default, 0.7);
    }

    #[tokio::test]
    async fn test_configure() {
        let context_manager = Arc::new(ContextManager::default());
        let mut executor = PromptExecutor::new(context_manager);

        executor.configure(
            Some("custom-model".to_string()),
            Some(4096),
            Some(0.5),
        );

        let stats = executor.get_stats();

        assert_eq!(stats.default_model, "custom-model");
        assert_eq!(stats.max_tokens_default, 4096);
        assert_eq!(stats.temperature_default, 0.5);
    }

    #[tokio::test]
    async fn test_build_full_prompt() {
        let context_manager = Arc::new(ContextManager::default());
        let executor = PromptExecutor::new(context_manager);

        let entries = vec![
            ContextEntry {
                key: "key1".to_string(),
                value: serde_json::json!("value1"),
                timestamp: 0,
                metadata: HashMap::new(),
            },
            ContextEntry {
                key: "key2".to_string(),
                value: serde_json::json!("value2"),
                timestamp: 0,
                metadata: HashMap::new(),
            },
        ];

        let full_prompt = executor.build_full_prompt("Test prompt", &entries);

        assert!(full_prompt.contains("Context:"));
        assert!(full_prompt.contains("key1"));
        assert!(full_prompt.contains("key2"));
        assert!(full_prompt.contains("Test prompt"));
    }
}
