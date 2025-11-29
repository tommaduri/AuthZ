# CretoAI Core Package - Software Design Document (SDD)

**Version**: 1.0.0
**Date**: 2025-11-27
**Status**: Draft
**Author**: CretoAI Architecture Team

---

## 1. Executive Summary

This document outlines the design for `cretoai-core`, a new foundational package that will resolve the circular dependency issue in the CretoAI project. The circular dependency chain is:

```
cretoai-dag → cretoai-network → cretoai-mcp → cretoai-dag
```

The `cretoai-core` package will extract shared types, traits, and error definitions used across all packages, serving as the single source of truth for common data structures.

---

## 2. Problem Statement

### 2.1 Current Circular Dependency

The current architecture exhibits a circular dependency:

```
┌──────────────┐
│  cretoai-dag │
└──────┬───────┘
       │ depends on
       ▼
┌──────────────────┐
│ cretoai-network  │
└──────┬───────────┘
       │ depends on (optional)
       ▼
┌──────────────┐
│ cretoai-mcp  │
└──────┬───────┘
       │ would need
       ▼
┌──────────────┐
│  cretoai-dag │  ◄── CIRCULAR!
└──────────────┘
```

### 2.2 Impact

- **Compilation Issues**: Prevents MCP from using DAG types directly
- **Code Duplication**: Types are duplicated across packages (e.g., `VertexMessage` in network, `Vertex` in DAG)
- **Maintenance Burden**: Changes to shared types require updates in multiple locations
- **Testing Complexity**: Circular dependencies complicate unit testing and mocking
- **Feature Flags Workaround**: Current use of optional dependencies is a brittle solution

### 2.3 Evidence from Codebase

From `/Users/tommaduri/cretoai/src/mcp/Cargo.toml`:
```toml
# cretoai-network = { path = "../network" }  # Circular dependency
# cretoai-dag = { path = "../dag" }  # Circular dependency
```

---

## 3. Proposed Solution: cretoai-core Package

### 3.1 Architecture Overview

The new dependency graph after introducing `cretoai-core`:

```
                    ┌──────────────────┐
                    │  cretoai-core    │  ◄── Foundation Layer
                    │  (Types, Traits) │
                    └────────┬─────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ cretoai-crypto  │  │  cretoai-dag    │  │ cretoai-network │
└─────────────────┘  └────────┬────────┘  └────────┬────────┘
                              │                     │
                              └──────────┬──────────┘
                                         │
                                         ▼
                                 ┌─────────────────┐
                                 │  cretoai-mcp    │
                                 └─────────────────┘
```

**Key Principles:**
- `cretoai-core` has ZERO dependencies (except standard library)
- All other packages depend on `cretoai-core`
- No circular dependencies possible
- Single source of truth for common types

---

## 4. Module Structure

### 4.1 Package Layout

```
cretoai-core/
├── Cargo.toml
├── src/
│   ├── lib.rs              # Package root with re-exports
│   ├── types/              # Common type definitions
│   │   ├── mod.rs
│   │   ├── vertex.rs       # Vertex types
│   │   ├── message.rs      # P2P message types
│   │   ├── consensus.rs    # Consensus types
│   │   ├── peer.rs         # Peer and network types
│   │   └── context.rs      # Context and metadata types
│   ├── traits/             # Common trait definitions
│   │   ├── mod.rs
│   │   ├── serializable.rs # Serialization traits
│   │   ├── verifiable.rs   # Signature verification
│   │   └── identifiable.rs # ID generation and management
│   ├── error/              # Error types
│   │   ├── mod.rs
│   │   └── core_error.rs   # Core error enum
│   └── constants/          # Shared constants
│       ├── mod.rs
│       └── protocol.rs     # Protocol versions, topics
└── tests/
    └── integration_tests.rs
```

### 4.2 Module Responsibilities

#### 4.2.1 Types Module (`types/`)

**Purpose**: Define all shared data structures used across packages.

**Contents**:
- `VertexId`, `VertexHash` type aliases
- `VertexMetadata` struct
- `P2PMessage` envelope types
- `ConsensusQuery`, `ConsensusResponse` types
- `PeerId`, `TopicHash` type aliases
- `ContextEntry` types

#### 4.2.2 Traits Module (`traits/`)

**Purpose**: Define common behaviors and interfaces.

**Contents**:
- `Serializable` - Binary serialization trait
- `Verifiable` - Signature verification trait
- `Identifiable` - ID generation and extraction
- `Timestamped` - Timestamp management

#### 4.2.3 Error Module (`error/`)

**Purpose**: Centralized error types for cross-package error handling.

**Contents**:
- `CoreError` enum with common error variants
- Conversion traits for package-specific errors

#### 4.2.4 Constants Module (`constants/`)

**Purpose**: Shared constants and protocol definitions.

**Contents**:
- Protocol version strings
- Topic names for P2P communication
- Default configuration values

---

## 5. Detailed Type Definitions

### 5.1 Vertex Types (`types/vertex.rs`)

```rust
//! Core vertex types for DAG operations

use serde::{Deserialize, Serialize};

/// Unique vertex identifier
pub type VertexId = String;

/// Vertex hash (BLAKE3)
pub type VertexHash = [u8; 32];

/// Metadata for consensus tracking
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct VertexMetadata {
    /// Confidence score (0.0 to 1.0)
    pub confidence: f64,

    /// Number of confirmations from other vertices
    pub confirmations: u32,

    /// Whether this vertex is finalized
    pub finalized: bool,

    /// Round number in consensus
    pub round: u64,

    /// Chit value (used in Avalanche consensus)
    pub chit: bool,
}

impl VertexMetadata {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_confidence(mut self, confidence: f64) -> Self {
        self.confidence = confidence.clamp(0.0, 1.0);
        self
    }

    pub fn is_finalized(&self) -> bool {
        self.finalized
    }
}
```

### 5.2 Message Types (`types/message.rs`)

```rust
//! P2P message envelope types

use serde::{Deserialize, Serialize};

/// Message ID for tracking
pub type MessageId = String;

/// Topic hash for pub/sub routing
pub type TopicHash = String;

/// Generic P2P message envelope
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageEnvelope<T> {
    /// Message ID
    pub id: MessageId,

    /// Source peer ID
    pub sender: String,

    /// Timestamp (milliseconds since epoch)
    pub timestamp: u64,

    /// Message payload
    pub payload: T,

    /// Signature (for verification)
    pub signature: Vec<u8>,
}

impl<T> MessageEnvelope<T> {
    pub fn new(id: MessageId, sender: String, payload: T) -> Self {
        Self {
            id,
            sender,
            timestamp: current_timestamp_ms(),
            payload,
            signature: Vec::new(),
        }
    }
}

/// Get current timestamp in milliseconds
pub fn current_timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}
```

### 5.3 Consensus Types (`types/consensus.rs`)

```rust
//! Consensus-related types

use serde::{Deserialize, Serialize};
use super::vertex::{VertexId, VertexHash};

/// DAG vertex message for network propagation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VertexMessage {
    /// Vertex ID
    pub vertex_id: VertexId,

    /// Parent vertex IDs
    pub parents: Vec<VertexId>,

    /// Transaction payload
    pub payload: Vec<u8>,

    /// Timestamp
    pub timestamp: u64,

    /// Creator agent ID
    pub creator: String,

    /// Quantum-resistant signature (ML-DSA)
    pub signature: Vec<u8>,

    /// Vertex hash (BLAKE3)
    pub hash: VertexHash,
}

/// Consensus query message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsensusQuery {
    /// Query ID for response matching
    pub query_id: String,

    /// Vertex ID being queried
    pub vertex_id: VertexId,

    /// Requester peer ID
    pub requester: String,

    /// Query timestamp
    pub timestamp: u64,
}

/// Consensus response message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsensusResponse {
    /// Query ID this responds to
    pub query_id: String,

    /// Vertex ID
    pub vertex_id: VertexId,

    /// Responder peer ID
    pub responder: String,

    /// Vote: true = accept, false = reject
    pub vote: bool,

    /// Confidence score (0.0 - 1.0)
    pub confidence: f64,

    /// Response timestamp
    pub timestamp: u64,

    /// Response signature
    pub signature: Vec<u8>,
}
```

### 5.4 Peer Types (`types/peer.rs`)

```rust
//! Peer and network types

use serde::{Deserialize, Serialize};

/// Peer identifier
pub type PeerId = String;

/// Network address
pub type NetworkAddress = String;

/// Peer information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerInfo {
    /// Peer ID
    pub id: PeerId,

    /// Network addresses
    pub addresses: Vec<NetworkAddress>,

    /// Public key (for verification)
    pub public_key: Vec<u8>,

    /// Reputation score
    pub reputation: f64,

    /// Last seen timestamp
    pub last_seen: u64,
}
```

### 5.5 Context Types (`types/context.rs`)

```rust
//! Context and metadata types for MCP

use serde::{Deserialize, Serialize};

/// Context entry for MCP protocol
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ContextEntry {
    /// Key identifier
    pub key: String,

    /// Value (JSON)
    pub value: serde_json::Value,

    /// Timestamp
    pub timestamp: i64,
}

impl ContextEntry {
    pub fn new(key: String, value: serde_json::Value) -> Self {
        Self {
            key,
            value,
            timestamp: chrono::Utc::now().timestamp(),
        }
    }
}
```

---

## 6. Trait Definitions

### 6.1 Serializable Trait (`traits/serializable.rs`)

```rust
//! Serialization trait for binary encoding

use crate::error::{CoreError, Result};

/// Trait for types that can be serialized to/from bytes
pub trait Serializable: Sized {
    /// Serialize to bytes
    fn to_bytes(&self) -> Result<Vec<u8>>;

    /// Deserialize from bytes
    fn from_bytes(data: &[u8]) -> Result<Self>;
}

// Blanket implementation for serde types
impl<T> Serializable for T
where
    T: serde::Serialize + for<'de> serde::Deserialize<'de>,
{
    fn to_bytes(&self) -> Result<Vec<u8>> {
        bincode::serialize(self)
            .map_err(|e| CoreError::Serialization(e.to_string()))
    }

    fn from_bytes(data: &[u8]) -> Result<Self> {
        bincode::deserialize(data)
            .map_err(|e| CoreError::Serialization(e.to_string()))
    }
}
```

### 6.2 Verifiable Trait (`traits/verifiable.rs`)

```rust
//! Signature verification trait

use crate::error::Result;

/// Trait for types that support signature verification
pub trait Verifiable {
    /// Verify signature with public key
    fn verify_signature(&self, public_key: &[u8]) -> Result<()>;

    /// Get the data to be signed (message hash)
    fn signable_data(&self) -> Vec<u8>;
}
```

### 6.3 Identifiable Trait (`traits/identifiable.rs`)

```rust
//! ID generation and management trait

/// Trait for types with unique identifiers
pub trait Identifiable {
    type Id;

    /// Get the unique identifier
    fn id(&self) -> &Self::Id;

    /// Generate a new unique ID
    fn generate_id() -> Self::Id;
}
```

### 6.4 Timestamped Trait (`traits/timestamped.rs`)

```rust
//! Timestamp management trait

/// Trait for types with timestamps
pub trait Timestamped {
    /// Get timestamp (milliseconds since epoch)
    fn timestamp(&self) -> u64;

    /// Set timestamp
    fn set_timestamp(&mut self, timestamp: u64);

    /// Get age in milliseconds
    fn age_ms(&self) -> u64 {
        crate::types::message::current_timestamp_ms() - self.timestamp()
    }
}
```

---

## 7. Error Definitions

### 7.1 Core Error Type (`error/core_error.rs`)

```rust
//! Core error types for CretoAI

use thiserror::Error;

pub type Result<T> = std::result::Result<T, CoreError>;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("Deserialization error: {0}")]
    Deserialization(String),

    #[error("Invalid data: {0}")]
    InvalidData(String),

    #[error("Verification failed: {0}")]
    VerificationFailed(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Invalid ID: {0}")]
    InvalidId(String),

    #[error("Timeout")]
    Timeout,

    #[error("Generic core error: {0}")]
    Generic(String),
}

// Conversion trait for package-specific errors
impl CoreError {
    pub fn from_network_error(msg: impl Into<String>) -> Self {
        CoreError::Generic(format!("Network: {}", msg.into()))
    }

    pub fn from_dag_error(msg: impl Into<String>) -> Self {
        CoreError::Generic(format!("DAG: {}", msg.into()))
    }

    pub fn from_mcp_error(msg: impl Into<String>) -> Self {
        CoreError::Generic(format!("MCP: {}", msg.into()))
    }
}
```

---

## 8. Constants and Protocol Definitions

### 8.1 Protocol Constants (`constants/protocol.rs`)

```rust
//! Protocol constants and topic definitions

/// MCP Protocol version
pub const MCP_PROTOCOL_VERSION: &str = "2024.11";

/// Topic for DAG vertex propagation
pub const VERTEX_TOPIC: &str = "vigilia/dag/vertices";

/// Topic for consensus queries
pub const CONSENSUS_QUERY_TOPIC: &str = "vigilia/dag/consensus/query";

/// Topic for consensus responses
pub const CONSENSUS_RESPONSE_TOPIC: &str = "vigilia/dag/consensus/response";

/// Default consensus confidence threshold
pub const DEFAULT_CONFIDENCE_THRESHOLD: f64 = 0.9;

/// Default query sample size
pub const DEFAULT_QUERY_SAMPLE_SIZE: usize = 20;

/// Default query timeout (seconds)
pub const DEFAULT_QUERY_TIMEOUT_SECS: u64 = 30;
```

---

## 9. Dependencies

### 9.1 Cargo.toml

```toml
[package]
name = "cretoai-core"
version = "0.1.0"
edition = "2021"
authors = ["Creto Systems - CretoAI Team"]
license = "MIT OR Apache-2.0"
description = "Core types and traits for CretoAI - foundation layer"
repository = "https://github.com/creto-systems/cretoai-core"

[dependencies]
# Serialization (required for types)
serde = { workspace = true }
serde_json = { workspace = true }
bincode = { workspace = true }

# Error handling
thiserror = { workspace = true }

# Utilities
uuid = { workspace = true }
chrono = { workspace = true }

[dev-dependencies]
tokio-test = { workspace = true }
proptest = { workspace = true }

[features]
default = []
```

### 9.2 Dependency Philosophy

- **Minimal Dependencies**: Only include essential crates
- **Workspace Dependencies**: Reuse versions from workspace
- **No Internal Dependencies**: `cretoai-core` depends on NO other CretoAI packages
- **Stable APIs**: Only depend on stable, well-maintained crates

---

## 10. Migration Plan

### 10.1 Phase 1: Create cretoai-core Package (Week 1)

**Tasks**:
1. Create `src/core/` directory structure
2. Copy shared types from network/dag/mcp into core
3. Define traits and error types
4. Write comprehensive unit tests
5. Add to workspace in root `Cargo.toml`

**Success Criteria**:
- `cretoai-core` compiles independently
- 100% test coverage on core types
- Zero external dependencies (except std lib + serde/bincode)

### 10.2 Phase 2: Update cretoai-dag (Week 2)

**Tasks**:
1. Add `cretoai-core` dependency to `dag/Cargo.toml`
2. Replace local types with `cretoai_core::types::*`
3. Implement core traits for DAG types
4. Update tests to use core types
5. Remove duplicate type definitions

**Migration Example**:
```rust
// Before
use crate::vertex::{VertexId, VertexMetadata};

// After
use cretoai_core::types::{VertexId, VertexMetadata};
```

**Success Criteria**:
- All DAG tests pass
- No duplicate type definitions
- Reduced code by ~200 lines

### 10.3 Phase 3: Update cretoai-network (Week 2)

**Tasks**:
1. Add `cretoai-core` dependency
2. Replace `VertexMessage`, `ConsensusQuery`, `ConsensusResponse` with core types
3. Update P2P message handling to use core types
4. Remove duplicate definitions

**Success Criteria**:
- Network tests pass
- P2P communication works with core types
- Code reduction ~300 lines

### 10.4 Phase 4: Update cretoai-mcp (Week 3)

**Tasks**:
1. Add `cretoai-core` dependency
2. Enable `cretoai-dag` and `cretoai-network` dependencies (no longer circular!)
3. Use core types for vertex and consensus operations
4. Update protocol types to use `ContextEntry` from core

**Success Criteria**:
- MCP server compiles with full DAG/network integration
- All tests pass
- Circular dependency eliminated

### 10.5 Phase 5: Integration Testing (Week 3-4)

**Tasks**:
1. Run full integration test suite
2. Verify P2P consensus works end-to-end
3. Benchmark performance (ensure no regression)
4. Update documentation

**Success Criteria**:
- All integration tests pass
- Performance within 5% of baseline
- Zero circular dependencies
- Documentation updated

---

## 11. Dependency Graph Comparison

### 11.1 Before (Current State)

```
cretoai-crypto (no deps)
    ↓
cretoai-dag ──────────┐
    ↓                 │
cretoai-network       │
    ↓ (optional)      │
cretoai-mcp ──────────┘  ◄── CIRCULAR!
```

### 11.2 After (With cretoai-core)

```
cretoai-core (no deps except std/serde)
    ↓
    ├──→ cretoai-crypto
    ├──→ cretoai-dag
    ├──→ cretoai-network
    └──→ cretoai-mcp

Transitive:
    cretoai-dag → cretoai-network → cretoai-mcp

✓ No circular dependencies!
```

---

## 12. Testing Strategy

### 12.1 Unit Tests

**Coverage Requirements**:
- 100% coverage on all types
- 100% coverage on traits
- 100% coverage on error conversions

**Test Files**:
```
tests/
├── types/
│   ├── vertex_tests.rs
│   ├── message_tests.rs
│   ├── consensus_tests.rs
│   └── peer_tests.rs
├── traits/
│   ├── serializable_tests.rs
│   └── verifiable_tests.rs
└── error/
    └── core_error_tests.rs
```

### 12.2 Property-Based Tests

Use `proptest` for:
- Serialization roundtrips
- Type invariants
- Timestamp ordering

**Example**:
```rust
#[test]
fn prop_vertex_metadata_confidence_bounded() {
    proptest!(|(confidence in any::<f64>())| {
        let mut meta = VertexMetadata::new();
        meta.confidence = confidence.clamp(0.0, 1.0);
        prop_assert!(meta.confidence >= 0.0 && meta.confidence <= 1.0);
    });
}
```

### 12.3 Integration Tests

**Scenarios**:
1. DAG uses core types for vertex creation
2. Network serializes/deserializes core message types
3. MCP exchanges vertex messages via core types
4. Cross-package error conversions work

---

## 13. Success Criteria

### 13.1 Functional Requirements

- ✅ **Circular Dependency Eliminated**: No circular references in dependency graph
- ✅ **Type Consolidation**: Single source of truth for shared types
- ✅ **Full Integration**: MCP can use DAG and Network types directly
- ✅ **Backward Compatibility**: Existing APIs minimally impacted

### 13.2 Non-Functional Requirements

- ✅ **Performance**: <5% performance degradation
- ✅ **Code Quality**: 100% test coverage on core types
- ✅ **Documentation**: All public APIs documented
- ✅ **Build Time**: Total build time <10 minutes

### 13.3 Code Metrics

| Metric | Before | After | Target |
|--------|--------|-------|--------|
| Circular Dependencies | 1 | 0 | 0 |
| Duplicate Type Definitions | ~15 | 0 | 0 |
| Total Lines of Code | ~12,000 | ~11,500 | <12,000 |
| Build Time | 8 min | 7 min | <10 min |
| Test Coverage (core) | N/A | 100% | 100% |

---

## 14. Risks and Mitigation

### 14.1 Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking API Changes | Medium | High | Provide compatibility layer for 1 release cycle |
| Performance Regression | Low | Medium | Comprehensive benchmarks before/after |
| Hidden Dependencies | Low | Medium | Use `cargo tree` to verify no cycles |
| Test Failures | Medium | High | Incremental migration with continuous testing |

### 14.2 Rollback Plan

If critical issues arise:
1. Revert to feature flags (`core-types` feature)
2. Keep old types alongside new ones temporarily
3. Gradual migration instead of big-bang

---

## 15. Future Enhancements

### 15.1 Phase 2 Features (Post-Launch)

- **Validation Framework**: Add `Validate` trait for type validation
- **Builder Pattern**: Add builders for complex types
- **Codec Registry**: Pluggable serialization formats (JSON, MessagePack, Protobuf)
- **Type Versioning**: Support for protocol evolution

### 15.2 Performance Optimizations

- Zero-copy serialization with `bytes` crate
- Arena allocation for batch operations
- SIMD acceleration for hash operations

---

## 16. References

### 16.1 Related Documents

- [Phase 2 Implementation Specification](../specs/phase2-implementation.md)
- [Avalanche Consensus Integration](../specs/avalanche-consensus-integration.md)
- [LibP2P Integration Guide](../specs/option3-libp2p-integration.md)

### 16.2 External References

- [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/)
- [Cargo Workspaces](https://doc.rust-lang.org/book/ch14-03-cargo-workspaces.html)
- [Serde Documentation](https://serde.rs/)

---

## 17. Approval and Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| System Architect | CretoAI Team | 2025-11-27 | [Pending] |
| Lead Developer | CretoAI Team | [TBD] | [Pending] |
| QA Lead | CretoAI Team | [TBD] | [Pending] |

---

## Appendix A: Type Extraction Summary

### A.1 Types to Extract from cretoai-dag

| Type | Current Location | New Location |
|------|------------------|--------------|
| `VertexId` | `dag/src/vertex.rs` | `core/src/types/vertex.rs` |
| `VertexHash` | `dag/src/vertex.rs` | `core/src/types/vertex.rs` |
| `VertexMetadata` | `dag/src/vertex.rs` | `core/src/types/vertex.rs` |

### A.2 Types to Extract from cretoai-network

| Type | Current Location | New Location |
|------|------------------|--------------|
| `VertexMessage` | `network/src/consensus_p2p.rs` | `core/src/types/consensus.rs` |
| `ConsensusQuery` | `network/src/consensus_p2p.rs` | `core/src/types/consensus.rs` |
| `ConsensusResponse` | `network/src/consensus_p2p.rs` | `core/src/types/consensus.rs` |
| `MessageId` | `network/src/gossip.rs` | `core/src/types/message.rs` |
| `TopicHash` | `network/src/gossip.rs` | `core/src/types/message.rs` |

### A.3 Types to Extract from cretoai-mcp

| Type | Current Location | New Location |
|------|------------------|--------------|
| `ContextEntry` | `mcp/src/protocol.rs` | `core/src/types/context.rs` |

---

## Appendix B: Command Reference

### B.1 Build Commands

```bash
# Build entire workspace
cargo build --workspace

# Build only core package
cargo build -p cretoai-core

# Run tests
cargo test --workspace

# Check for circular dependencies
cargo tree -p cretoai-mcp
```

### B.2 Migration Commands

```bash
# Add core dependency to a package
cd src/dag
cargo add --path ../core

# Update imports
rg "use crate::vertex::" --files-with-matches | xargs sed -i 's/use crate::vertex::/use cretoai_core::types::vertex::/g'
```

---

**END OF DOCUMENT**
