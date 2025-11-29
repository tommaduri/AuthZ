//! CEL expression engine with compiled program caching

use dashmap::DashMap;
use std::sync::Arc;
use cel_interpreter::{Context, Program};
use cel_interpreter::objects::Value as CelValue;
use serde_json::Value;

use crate::cel::{
    context::EvalContext,
    error::{CelError, Result},
    functions::{has_role, is_owner, in_list},
    convert::{json_to_cel, cel_to_json},
};

/// CEL engine for compiling and evaluating expressions
pub struct Engine {
    /// Compiled program cache (thread-safe)
    program_cache: Arc<DashMap<String, Arc<Program>>>,
}

impl Engine {
    /// Create a new CEL engine
    pub fn new() -> Self {
        Self {
            program_cache: Arc::new(DashMap::new()),
        }
    }

    /// Compile a CEL expression and cache the result
    ///
    /// # Arguments
    /// * `expr` - CEL expression string
    ///
    /// # Returns
    /// Compiled program (from cache if available)
    ///
    /// # Errors
    /// Returns error if expression cannot be compiled
    pub fn compile(&self, expr: &str) -> Result<Arc<Program>> {
        // Check cache first
        if let Some(prog) = self.program_cache.get(expr) {
            return Ok(prog.clone());
        }

        // Compile expression
        let program = Program::compile(expr)
            .map_err(|e| CelError::CompilationError(format!("{:?}", e)))?;

        // Cache compiled program
        let arc_program = Arc::new(program);
        self.program_cache.insert(expr.to_string(), arc_program.clone());

        Ok(arc_program)
    }

    /// Evaluate a compiled program with the given context
    ///
    /// # Arguments
    /// * `program` - Compiled CEL program
    /// * `ctx` - Evaluation context with variables
    ///
    /// # Returns
    /// Boolean result of evaluation
    ///
    /// # Errors
    /// Returns error if evaluation fails or result is not boolean
    pub fn evaluate(&self, program: &Program, ctx: &EvalContext) -> Result<bool> {
        // Create CEL context
        let mut cel_context = Context::default();

        // Add variables from context
        let vars = ctx.to_variables();
        for (key, value) in vars {
            let cel_value = json_to_cel(&value);
            let _ = cel_context.add_variable(key, cel_value);
        }

        // Register custom functions
        self.register_functions(&mut cel_context);

        // Execute program
        let result = program.execute(&cel_context)
            .map_err(|e| CelError::EvaluationError(format!("{:?}", e)))?;

        // Convert result to boolean
        Self::to_bool(&result)
    }

    /// Compile and evaluate an expression in one call
    ///
    /// # Arguments
    /// * `expr` - CEL expression string
    /// * `ctx` - Evaluation context
    ///
    /// # Returns
    /// Boolean result of evaluation
    pub fn evaluate_expression(&self, expr: &str, ctx: &EvalContext) -> Result<bool> {
        let program = self.compile(expr)?;
        self.evaluate(&program, ctx)
    }

    /// Clear the compiled program cache
    pub fn clear_cache(&self) {
        self.program_cache.clear();
    }

    /// Get cache statistics
    pub fn cache_stats(&self) -> CacheStats {
        CacheStats {
            size: self.program_cache.len(),
        }
    }

    /// Register custom functions with CEL context
    fn register_functions(&self, _context: &mut Context) {
        // Note: cel-interpreter v0.8 requires function registration via
        // ResolveResult trait implementation. Custom functions are implemented
        // as native Rust functions that are called during evaluation.
        //
        // For now, we'll implement custom functions in CEL expressions directly:
        // - hasRole: Check if principal.roles contains the role
        // - isOwner: Check if principal.id == resource.attributes.ownerId
        // - inList: Check if value is in list
        //
        // These can be expressed in CEL as:
        // - hasRole(P, "admin") -> P.roles.exists(r, r == "admin")
        // - isOwner(P, R) -> P.id == R.attributes.ownerId
        // - inList(val, list) -> val in list
        //
        // TODO: Implement custom function registration with v0.8 API
    }

    /// Convert CEL result to boolean
    fn to_bool(value: &CelValue) -> Result<bool> {
        match value {
            CelValue::Bool(b) => Ok(*b),
            _ => Err(CelError::NonBooleanResult),
        }
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

/// Cache statistics
#[derive(Debug, Clone)]
pub struct CacheStats {
    /// Number of cached programs
    pub size: usize,
}

// Thread safety: Engine is Send + Sync because DashMap is thread-safe
unsafe impl Send for Engine {}
unsafe impl Sync for Engine {}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;

    fn create_test_context() -> EvalContext {
        let mut principal = HashMap::new();
        principal.insert("id".to_string(), json!("user123"));
        principal.insert("role".to_string(), json!("admin"));
        principal.insert("roles".to_string(), json!(["admin", "editor"]));

        let mut resource = HashMap::new();
        resource.insert("kind".to_string(), json!("document"));
        resource.insert("id".to_string(), json!("doc123"));

        let mut attrs = HashMap::new();
        attrs.insert("ownerId".to_string(), json!("user123"));
        resource.insert("attributes".to_string(), json!(attrs));

        EvalContext::new()
            .with_principal(principal)
            .with_resource(resource)
    }

    #[test]
    fn test_engine_creation() {
        let engine = Engine::new();
        assert_eq!(engine.cache_stats().size, 0);
    }

    #[test]
    fn test_simple_expression() {
        let engine = Engine::new();
        let ctx = create_test_context();

        // Simple boolean
        let result = engine.evaluate_expression("true", &ctx).unwrap();
        assert!(result);

        let result = engine.evaluate_expression("false", &ctx).unwrap();
        assert!(!result);
    }

    #[test]
    fn test_variable_access() {
        let engine = Engine::new();
        let ctx = create_test_context();

        // Access principal.role
        let result = engine.evaluate_expression(
            "principal.role == 'admin'",
            &ctx
        ).unwrap();
        assert!(result);

        // Access with alias
        let result = engine.evaluate_expression(
            "P.role == 'admin'",
            &ctx
        ).unwrap();
        assert!(result);
    }

    #[test]
    fn test_has_role_expression() {
        let engine = Engine::new();
        let ctx = create_test_context();

        // Test role checking using CEL's exists() function
        let result = engine.evaluate_expression(
            "'admin' in principal.roles",
            &ctx
        ).unwrap();
        assert!(result);

        let result = engine.evaluate_expression(
            "'viewer' in principal.roles",
            &ctx
        ).unwrap();
        assert!(!result);
    }

    #[test]
    fn test_is_owner_expression() {
        let engine = Engine::new();
        let ctx = create_test_context();

        // Test ownership using direct property comparison
        let result = engine.evaluate_expression(
            "principal.id == resource.attributes.ownerId",
            &ctx
        ).unwrap();
        assert!(result);
    }

    #[test]
    fn test_complex_expression() {
        let engine = Engine::new();
        let ctx = create_test_context();

        let result = engine.evaluate_expression(
            "(principal.role == 'admin') || isOwner(principal, resource)",
            &ctx
        ).unwrap();
        assert!(result);
    }

    #[test]
    fn test_program_caching() {
        let engine = Engine::new();
        let ctx = create_test_context();

        // First evaluation should cache
        let _ = engine.evaluate_expression("true", &ctx).unwrap();
        assert_eq!(engine.cache_stats().size, 1);

        // Second evaluation should use cache
        let _ = engine.evaluate_expression("true", &ctx).unwrap();
        assert_eq!(engine.cache_stats().size, 1);

        // Different expression should add to cache
        let _ = engine.evaluate_expression("false", &ctx).unwrap();
        assert_eq!(engine.cache_stats().size, 2);
    }

    #[test]
    fn test_cache_clear() {
        let engine = Engine::new();
        let ctx = create_test_context();

        let _ = engine.evaluate_expression("true", &ctx).unwrap();
        assert_eq!(engine.cache_stats().size, 1);

        engine.clear_cache();
        assert_eq!(engine.cache_stats().size, 0);
    }

    #[test]
    fn test_compilation_error() {
        let engine = Engine::new();

        let result = engine.compile("invalid syntax @#$");
        assert!(result.is_err());
        assert!(matches!(result, Err(CelError::CompilationError(_))));
    }

    #[test]
    fn test_non_boolean_result() {
        let engine = Engine::new();
        let ctx = create_test_context();

        // Expression that returns string
        let result = engine.evaluate_expression("'hello'", &ctx);
        assert!(result.is_err());
        assert!(matches!(result, Err(CelError::NonBooleanResult)));
    }
}
