//! Compatibility layer for transitioning from simulated to real LibP2P
//!
//! This module provides compatibility helpers during the migration from
//! simulated gossip to real LibP2P Gossipsub.

use crate::error::Result;
use super::swarm::VigiliaSwarm;
use libp2p::PeerId;

/// Compatibility wrapper for migrating from GossipProtocol to LibP2P
pub struct LibP2PCompat {
    swarm: VigiliaSwarm,
}

impl LibP2PCompat {
    /// Create a new compatibility wrapper
    pub async fn new(agent_id: String) -> Result<Self> {
        let swarm = VigiliaSwarm::new(agent_id).await?;
        Ok(Self { swarm })
    }

    /// Get the underlying swarm
    pub fn swarm(&self) -> &VigiliaSwarm {
        &self.swarm
    }

    /// Get the underlying swarm mutably
    pub fn swarm_mut(&mut self) -> &mut VigiliaSwarm {
        &mut self.swarm
    }
}
