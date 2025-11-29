//! Evaluation context for CEL expressions

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

/// Context containing all variables available during CEL evaluation
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EvalContext {
    /// Principal attributes (user, roles, etc.)
    pub principal: HashMap<String, Value>,

    /// Resource attributes (owner, type, etc.)
    pub resource: HashMap<String, Value>,

    /// Request metadata (time, IP, etc.)
    pub request: HashMap<String, Value>,

    /// Additional context variables
    pub context: HashMap<String, Value>,
}

impl EvalContext {
    /// Create a new evaluation context
    pub fn new() -> Self {
        Self::default()
    }

    /// Create context with principal attributes
    pub fn with_principal(mut self, principal: HashMap<String, Value>) -> Self {
        self.principal = principal;
        self
    }

    /// Create context with resource attributes
    pub fn with_resource(mut self, resource: HashMap<String, Value>) -> Self {
        self.resource = resource;
        self
    }

    /// Create context with request metadata
    pub fn with_request(mut self, request: HashMap<String, Value>) -> Self {
        self.request = request;
        self
    }

    /// Create context with additional context variables
    pub fn with_context(mut self, context: HashMap<String, Value>) -> Self {
        self.context = context;
        self
    }

    /// Get all variables as a flat map for CEL evaluation
    pub fn to_variables(&self) -> HashMap<String, Value> {
        let mut vars = HashMap::new();

        // Add principal and alias
        vars.insert("principal".to_string(), Value::Object(
            self.principal.clone().into_iter()
                .map(|(k, v)| (k, v))
                .collect()
        ));
        vars.insert("P".to_string(), Value::Object(
            self.principal.clone().into_iter()
                .map(|(k, v)| (k, v))
                .collect()
        ));

        // Add resource and alias
        vars.insert("resource".to_string(), Value::Object(
            self.resource.clone().into_iter()
                .map(|(k, v)| (k, v))
                .collect()
        ));
        vars.insert("R".to_string(), Value::Object(
            self.resource.clone().into_iter()
                .map(|(k, v)| (k, v))
                .collect()
        ));

        // Add request
        vars.insert("request".to_string(), Value::Object(
            self.request.clone().into_iter()
                .map(|(k, v)| (k, v))
                .collect()
        ));

        // Add context
        vars.insert("context".to_string(), Value::Object(
            self.context.clone().into_iter()
                .map(|(k, v)| (k, v))
                .collect()
        ));

        vars
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_eval_context_creation() {
        let ctx = EvalContext::new();
        assert!(ctx.principal.is_empty());
        assert!(ctx.resource.is_empty());
        assert!(ctx.request.is_empty());
        assert!(ctx.context.is_empty());
    }

    #[test]
    fn test_eval_context_builder() {
        let mut principal = HashMap::new();
        principal.insert("id".to_string(), Value::String("user123".to_string()));

        let mut resource = HashMap::new();
        resource.insert("kind".to_string(), Value::String("document".to_string()));

        let ctx = EvalContext::new()
            .with_principal(principal.clone())
            .with_resource(resource.clone());

        assert_eq!(ctx.principal.get("id"), principal.get("id"));
        assert_eq!(ctx.resource.get("kind"), resource.get("kind"));
    }

    #[test]
    fn test_to_variables_includes_aliases() {
        let mut principal = HashMap::new();
        principal.insert("role".to_string(), Value::String("admin".to_string()));

        let ctx = EvalContext::new().with_principal(principal);
        let vars = ctx.to_variables();

        // Should have both principal and P alias
        assert!(vars.contains_key("principal"));
        assert!(vars.contains_key("P"));

        // Both should have same content
        assert_eq!(vars.get("principal"), vars.get("P"));
    }
}
