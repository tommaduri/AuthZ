//! Transport adapters for MCP
//!
//! This module provides various transport layer adapters for the MCP server.

pub mod quic_transport;

#[cfg(feature = "dag-integration")]
pub mod dag_consensus;

pub use quic_transport::{QuicTransportAdapter, QuicConnection};

#[cfg(feature = "dag-integration")]
pub use dag_consensus::DagConsensusAdapter;
