//! Peer discovery using mDNS and DHT

use crate::{
    error::{NetworkError, Result},
    network_types::*,
};
use parking_lot::RwLock;
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::Arc,
    time::Duration,
};
use tokio::sync::mpsc;
use tracing::{debug, error, info};

/// Peer discovery manager
pub struct PeerDiscovery {
    /// Enable mDNS discovery
    enable_mdns: bool,

    /// Enable DHT discovery
    enable_dht: bool,

    /// Discovered peers
    peers: Arc<RwLock<HashMap<PeerId, PeerInfo>>>,

    /// Peer announcement channel
    peer_tx: mpsc::UnboundedSender<PeerInfo>,
    peer_rx: Arc<RwLock<Option<mpsc::UnboundedReceiver<PeerInfo>>>>,
}

impl PeerDiscovery {
    /// Create a new peer discovery manager
    pub fn new(enable_mdns: bool, enable_dht: bool) -> Self {
        let (peer_tx, peer_rx) = mpsc::unbounded_channel();

        Self {
            enable_mdns,
            enable_dht,
            peers: Arc::new(RwLock::new(HashMap::new())),
            peer_tx,
            peer_rx: Arc::new(RwLock::new(Some(peer_rx))),
        }
    }

    /// Start peer discovery
    pub async fn start(&mut self, local_peer_id: PeerId, listen_addr: SocketAddr) -> Result<()> {
        info!("Starting peer discovery (mDNS: {}, DHT: {})", self.enable_mdns, self.enable_dht);

        if self.enable_mdns {
            self.start_mdns(local_peer_id, listen_addr).await?;
        }

        if self.enable_dht {
            self.start_dht(local_peer_id).await?;
        }

        Ok(())
    }

    /// Start mDNS discovery
    async fn start_mdns(&self, local_peer_id: PeerId, listen_addr: SocketAddr) -> Result<()> {
        let peers = self.peers.clone();
        let peer_tx = self.peer_tx.clone();

        tokio::spawn(async move {
            info!("Starting mDNS service discovery");

            // Create mDNS service
            let mdns = match mdns_sd::ServiceDaemon::new() {
                Ok(daemon) => daemon,
                Err(e) => {
                    error!("Failed to create mDNS daemon: {}", e);
                    return;
                }
            };

            // Register our service
            let service_type = "_cretoai._udp.local.";
            let instance_name = format!("cretoai-{}", local_peer_id);

            let my_service = match mdns_sd::ServiceInfo::new(
                service_type,
                &instance_name,
                &instance_name,
                "",
                listen_addr.port(),
                None,
            ) {
                Ok(service) => service,
                Err(e) => {
                    error!("Failed to create service info: {}", e);
                    return;
                }
            };

            if let Err(e) = mdns.register(my_service) {
                error!("Failed to register mDNS service: {}", e);
                return;
            }

            info!("Registered mDNS service: {}", instance_name);

            // Browse for other services
            let receiver = match mdns.browse(service_type) {
                Ok(rx) => rx,
                Err(e) => {
                    error!("Failed to browse mDNS services: {}", e);
                    return;
                }
            };

            // Process discovered services
            while let Ok(event) = receiver.recv() {
                match event {
                    mdns_sd::ServiceEvent::ServiceResolved(info) => {
                        debug!("Discovered mDNS peer: {}", info.get_fullname());

                        // Extract peer information
                        if let Some(addr) = info.get_addresses().iter().next() {
                            let peer_info = PeerInfo {
                                peer_id: PeerId::new(), // Would extract from service name
                                addresses: vec![SocketAddr::new(*addr, info.get_port())],
                                public_key: vec![],
                                metadata: PeerMetadata {
                                    node_type: "consensus".to_string(),
                                    version: "0.1.0".to_string(),
                                    capabilities: vec!["dag".to_string(), "bft".to_string()],
                                    reputation: 1.0,
                                },
                            };

                            peers.write().insert(peer_info.peer_id, peer_info.clone());

                            if let Err(e) = peer_tx.send(peer_info) {
                                error!("Failed to send peer announcement: {}", e);
                            }
                        }
                    }
                    mdns_sd::ServiceEvent::ServiceRemoved(_, fullname) => {
                        debug!("mDNS peer removed: {}", fullname);
                    }
                    _ => {}
                }
            }
        });

        Ok(())
    }

    /// Start DHT discovery (Kademlia)
    async fn start_dht(&self, _local_peer_id: PeerId) -> Result<()> {
        // This would implement full Kademlia DHT
        // For now, it's a placeholder
        info!("DHT discovery not yet implemented");
        Ok(())
    }

    /// Discover peers
    pub async fn discover_peers(&self) -> Result<Vec<PeerInfo>> {
        let peers = self.peers.read();
        Ok(peers.values().cloned().collect())
    }

    /// Get peer by ID
    pub fn get_peer(&self, peer_id: PeerId) -> Option<PeerInfo> {
        self.peers.read().get(&peer_id).cloned()
    }

    /// Add manually discovered peer
    pub fn add_peer(&self, peer_info: PeerInfo) {
        self.peers.write().insert(peer_info.peer_id, peer_info.clone());
        let _ = self.peer_tx.send(peer_info);
    }

    /// Remove peer
    pub fn remove_peer(&self, peer_id: PeerId) {
        self.peers.write().remove(&peer_id);
    }

    /// Get peer announcement receiver
    pub fn take_peer_receiver(&self) -> Option<mpsc::UnboundedReceiver<PeerInfo>> {
        self.peer_rx.write().take()
    }

    /// Get all discovered peers
    pub fn get_all_peers(&self) -> Vec<PeerInfo> {
        self.peers.read().values().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_peer_storage() {
        let discovery = PeerDiscovery::new(false, false);

        let peer_info = PeerInfo {
            peer_id: PeerId::new(),
            addresses: vec!["127.0.0.1:9001".parse().unwrap()],
            public_key: vec![1, 2, 3],
            metadata: PeerMetadata {
                node_type: "test".to_string(),
                version: "1.0".to_string(),
                capabilities: vec![],
                reputation: 1.0,
            },
        };

        discovery.add_peer(peer_info.clone());

        let retrieved = discovery.get_peer(peer_info.peer_id);
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().peer_id, peer_info.peer_id);
    }
}
