//! Error types for the DAG module

use thiserror::Error;

pub type Result<T> = std::result::Result<T, DagError>;

#[derive(Debug, Error)]
pub enum DagError {
    #[error("Vertex error: {0}")]
    Vertex(String),

    #[error("Graph error: {0}")]
    Graph(String),

    #[error("Consensus error: {0}")]
    Consensus(String),

    #[error("Ordering error: {0}")]
    Ordering(String),

    #[error("Storage error: {0}")]
    Storage(String),

    #[error("Pruning error: {0}")]
    Pruning(String),

    #[error("Cycle detected in DAG")]
    CycleDetected,

    #[error("Invalid vertex: {0}")]
    InvalidVertex(String),

    #[error("Generic DAG error: {0}")]
    Generic(String),
}
