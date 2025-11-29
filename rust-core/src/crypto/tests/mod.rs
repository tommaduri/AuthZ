//! Comprehensive test suite for cretoai-crypto
//!
//! This test suite follows Test-Driven Development (TDD) methodology,
//! specifically the London School (mock-driven) approach.
//!
//! ## Test Organization
//!
//! - `unit/` - Unit tests for individual components
//! - `integration/` - Integration tests for complete workflows
//! - `mocks/` - Mock implementations for testing
//!
//! ## Running Tests
//!
//! ```bash
//! # Run all tests
//! cargo test -p cretoai-crypto
//!
//! # Run only unit tests
//! cargo test -p cretoai-crypto --lib
//!
//! # Run specific test module
//! cargo test -p cretoai-crypto signature_tests
//!
//! # Run with ignored tests (requires full implementation)
//! cargo test -p cretoai-crypto -- --ignored
//!
//! # Run with coverage
//! cargo tarpaulin -p cretoai-crypto
//! ```
//!
//! ## Test Coverage Goals
//!
//! - Statements: >90%
//! - Branches: >85%
//! - Functions: >90%
//! - Lines: >90%
//!
//! ## TDD Workflow
//!
//! 1. Write failing test (RED)
//! 2. Implement minimal code to pass (GREEN)
//! 3. Refactor and improve (REFACTOR)
//! 4. Repeat
//!
//! Many tests are marked `#[ignore]` because the implementation
//! is pending. Remove the `ignore` attribute as features are implemented.

pub mod unit;
pub mod integration;
pub mod mocks;

// Re-export commonly used test utilities
pub use mocks::{
    MockSigner, MockKeyStore, MockKEM, MockHasher,
    MockAgentIdentity, MockRotationPolicy,
};
