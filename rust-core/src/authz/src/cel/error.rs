//! Error types for CEL operations

use thiserror::Error;

/// CEL operation errors
#[derive(Error, Debug)]
pub enum CelError {
    #[error("CEL compilation failed: {0}")]
    CompilationError(String),

    #[error("CEL evaluation failed: {0}")]
    EvaluationError(String),

    #[error("Type conversion error: {0}")]
    TypeConversionError(String),

    #[error("Function execution error: {0}")]
    FunctionError(String),

    #[error("Invalid expression: {0}")]
    InvalidExpression(String),

    #[error("Variable not found: {0}")]
    VariableNotFound(String),

    #[error("Expression did not return boolean result")]
    NonBooleanResult,
}

/// Result type for CEL operations
pub type Result<T> = std::result::Result<T, CelError>;
