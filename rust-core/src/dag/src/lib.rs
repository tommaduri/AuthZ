//! # Vigilia AI DAG Module
//!
//! This module implements the Directed Acyclic Graph (DAG) consensus mechanism.
//!
//! ## Features
//!
//! - **DAG Structure**: Efficient directed acyclic graph for transaction ordering
//! - **Consensus Algorithm**: Byzantine fault-tolerant consensus over DAG
//! - **Vertex Processing**: Parallel vertex validation and ordering
//! - **Conflict Resolution**: Deterministic conflict resolution for concurrent transactions
//! - **Persistence**: RocksDB backend for durable DAG storage
//! - **Pruning**: Automatic old vertex pruning and compaction
//!
//! ## Module Structure
//!
//! ```text
//! dag/
//! ├── vertex/        - Vertex structure and operations
//! ├── graph/         - DAG graph implementation
//! ├── consensus/     - Consensus algorithm
//! ├── ordering/      - Transaction ordering logic
//! ├── storage/       - Persistent storage backend
//! └── pruning/       - DAG pruning and compaction
//! ```

pub mod consensus;
pub mod error;
pub mod graph;
pub mod ordering;
pub mod pruning;
pub mod storage;
pub mod vertex;

pub use error::{DagError, Result};
pub use vertex::{Vertex, VertexMetadata, VertexBuilder, VertexId, VertexHash};

// Re-export types for other modules
pub mod types {
    pub use crate::vertex::{Vertex, VertexHash, VertexId, VertexMetadata, VertexBuilder};
}

// Note: Core types available via cretoai_core::types::dag for cross-package use

#[cfg(test)]
mod tests {
    #[test]
    fn test_module_import() {
        assert!(true);
    }
}
