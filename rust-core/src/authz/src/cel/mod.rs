//! CEL (Common Expression Language) expression engine for policy evaluation
//!
//! This module provides CEL expression compilation and evaluation with caching
//! for high-performance policy condition evaluation.

pub mod engine;
pub mod functions;
pub mod context;
pub mod error;
pub mod convert;

pub use engine::Engine;
pub use context::EvalContext;
pub use error::{CelError, Result};
