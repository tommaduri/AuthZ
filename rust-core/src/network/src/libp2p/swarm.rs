//! LibP2P Swarm implementation for Vigilia AI
//!
//! Provides the core networking infrastructure using LibP2P's Gossipsub,
//! Kademlia DHT, and mDNS for distributed message propagation.

use crate::error::NetworkError;
use futures::StreamExt;
use libp2p::{
    gossipsub::{
        self, Behaviour as Gossipsub, Event as GossipsubEvent, Message as GossipsubMessage,
        IdentTopic, MessageAuthenticity, MessageId, TopicHash, ValidationMode,
    },
    identify, identity,
    kad::{store::MemoryStore, Behaviour as Kademlia, Event as KademliaEvent},
    mdns,
    swarm::{NetworkBehaviour, Swarm, SwarmEvent},
    Multiaddr, PeerId, SwarmBuilder,
};
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

/// Custom message ID function using BLAKE3
fn message_id_fn(message: &GossipsubMessage) -> MessageId {
    let mut hasher = blake3::Hasher::new();
    hasher.update(&message.data);
    if let Some(ref source) = message.source {
        hasher.update(&source.to_bytes());
    }
    MessageId::from(hasher.finalize().as_bytes().to_vec())
}

/// Network behaviour combining Gossipsub, Kademlia, mDNS, and Identify
/// The macro will generate VigiliaNetworkBehaviourEvent automatically
#[derive(NetworkBehaviour)]
pub struct VigiliaNetworkBehaviour {
    pub gossipsub: Gossipsub,
    pub kademlia: Kademlia<MemoryStore>,
    pub mdns: mdns::tokio::Behaviour,
    pub identify: identify::Behaviour,
}

/// Vigilia LibP2P Swarm wrapper
pub struct VigiliaSwarm {
    swarm: Swarm<VigiliaNetworkBehaviour>,
    local_peer_id: PeerId,
    subscribed_topics: HashMap<String, IdentTopic>,
    message_cache: Arc<RwLock<HashMap<MessageId, Vec<u8>>>>,
    agent_id: String,
}

impl VigiliaSwarm {
    /// Create a new Vigilia swarm
    pub async fn new(agent_id: String) -> crate::error::Result<Self> {
        // Generate a random keypair for this node
        let local_key = identity::Keypair::generate_ed25519();
        let local_peer_id = PeerId::from(local_key.public());

        info!("Creating Vigilia swarm for agent {} with peer ID {}", agent_id, local_peer_id);

        // Configure Gossipsub with Byzantine resistance
        let gossipsub_config = gossipsub::ConfigBuilder::default()
            .heartbeat_interval(Duration::from_secs(1))
            .mesh_n(6)
            .mesh_n_low(4)
            .mesh_n_high(12)
            .mesh_outbound_min(2)
            .history_length(5)
            .history_gossip(3)
            .validation_mode(ValidationMode::Strict)
            .message_id_fn(message_id_fn)
            .flood_publish(false)
            .duplicate_cache_time(Duration::from_secs(120))
            .build()
            .map_err(|e| NetworkError::Configuration(e.to_string()))?;

        // Create Gossipsub with message signing
        let gossipsub = Gossipsub::new(
            MessageAuthenticity::Signed(local_key.clone()),
            gossipsub_config,
        )
        .map_err(|e| NetworkError::Configuration(e.to_string()))?;

        // Create Kademlia DHT
        let store = MemoryStore::new(local_peer_id);
        let kademlia = Kademlia::new(local_peer_id, store);

        // Create mDNS for local discovery
        let mdns = mdns::tokio::Behaviour::new(
            mdns::Config::default(),
            local_peer_id,
        )
        .map_err(|e| NetworkError::Configuration(e.to_string()))?;

        // Create Identify protocol
        let identify = identify::Behaviour::new(identify::Config::new(
            "/vigilia/1.0.0".to_string(),
            local_key.public(),
        ));

        // Combine behaviours
        let behaviour = VigiliaNetworkBehaviour {
            gossipsub,
            kademlia,
            mdns,
            identify,
        };

        // Build the swarm
        let swarm = SwarmBuilder::with_existing_identity(local_key)
            .with_tokio()
            .with_tcp(
                Default::default(),
                (libp2p::tls::Config::new, libp2p::noise::Config::new),
                libp2p::yamux::Config::default,
            )
            .map_err(|e| NetworkError::Configuration(e.to_string()))?
            .with_quic()
            .with_behaviour(|_| behaviour)
            .map_err(|e| NetworkError::Configuration(e.to_string()))?
            .with_swarm_config(|c| {
                c.with_idle_connection_timeout(Duration::from_secs(60))
            })
            .build();

        Ok(Self {
            swarm,
            local_peer_id,
            subscribed_topics: HashMap::new(),
            message_cache: Arc::new(RwLock::new(HashMap::new())),
            agent_id,
        })
    }

    /// Get local peer ID
    pub fn local_peer_id(&self) -> &PeerId {
        &self.local_peer_id
    }

    /// Get agent ID
    pub fn agent_id(&self) -> &str {
        &self.agent_id
    }

    /// Listen on an address
    pub fn listen_on(&mut self, addr: Multiaddr) -> crate::error::Result<()> {
        self.swarm
            .listen_on(addr.clone())
            .map_err(|e| NetworkError::Connection(format!("Failed to listen on {}: {}", addr, e)))?;
        info!("Listening on {}", addr);
        Ok(())
    }

    /// Dial a peer
    pub fn dial(&mut self, addr: Multiaddr) -> crate::error::Result<()> {
        self.swarm
            .dial(addr.clone())
            .map_err(|e| NetworkError::Connection(format!("Failed to dial {}: {}", addr, e)))?;
        debug!("Dialing {}", addr);
        Ok(())
    }

    /// Subscribe to a topic
    pub fn subscribe(&mut self, topic_name: &str) -> crate::error::Result<()> {
        let topic = IdentTopic::new(topic_name);
        self.swarm
            .behaviour_mut()
            .gossipsub
            .subscribe(&topic)
            .map_err(|e| NetworkError::Subscription(format!("Failed to subscribe to {}: {}", topic_name, e)))?;

        self.subscribed_topics.insert(topic_name.to_string(), topic);
        info!("Subscribed to topic: {}", topic_name);
        Ok(())
    }

    /// Unsubscribe from a topic
    pub fn unsubscribe(&mut self, topic_name: &str) -> crate::error::Result<()> {
        if let Some(topic) = self.subscribed_topics.remove(topic_name) {
            self.swarm
                .behaviour_mut()
                .gossipsub
                .unsubscribe(&topic)
                .map_err(|e| NetworkError::Subscription(format!("Failed to unsubscribe from {}: {}", topic_name, e)))?;
            info!("Unsubscribed from topic: {}", topic_name);
        }
        Ok(())
    }

    /// Publish a message to a topic
    pub async fn publish(&mut self, topic_name: &str, data: Vec<u8>) -> crate::error::Result<MessageId> {
        let topic = self.subscribed_topics
            .get(topic_name)
            .ok_or_else(|| NetworkError::Subscription(format!("Not subscribed to topic: {}", topic_name)))?;

        let message_id = self.swarm
            .behaviour_mut()
            .gossipsub
            .publish(topic.clone(), data.clone())
            .map_err(|e| NetworkError::Publication(format!("Failed to publish to {}: {}", topic_name, e)))?;

        // Cache the message
        self.message_cache.write().await.insert(message_id.clone(), data);

        debug!("Published message {:?} to topic {}", message_id, topic_name);
        Ok(message_id)
    }

    /// Check if subscribed to a topic
    pub fn is_subscribed(&self, topic_name: &str) -> bool {
        self.subscribed_topics.contains_key(topic_name)
    }

    /// Get connected peers
    pub fn connected_peers(&self) -> Vec<PeerId> {
        self.swarm.connected_peers().cloned().collect()
    }

    /// Get peer count
    pub fn peer_count(&self) -> usize {
        self.swarm.connected_peers().count()
    }

    /// Get mesh peers for a topic
    pub fn mesh_peers(&self, topic_name: &str) -> Vec<PeerId> {
        if let Some(topic) = self.subscribed_topics.get(topic_name) {
            self.swarm
                .behaviour()
                .gossipsub
                .mesh_peers(&topic.hash())
                .cloned()
                .collect()
        } else {
            Vec::new()
        }
    }

    /// Process next event from the swarm
    pub async fn next_event(&mut self) -> Option<VigiliaEvent> {
        loop {
            match self.swarm.select_next_some().await {
                SwarmEvent::Behaviour(event) => {
                    match event {
                        VigiliaNetworkBehaviourEvent::Gossipsub(gossip_event) => {
                            match gossip_event {
                                GossipsubEvent::Message {
                                    propagation_source,
                                    message_id,
                                    message,
                                } => {
                                    debug!(
                                        "Received message {:?} from {:?} on topic {:?}",
                                        message_id, propagation_source, message.topic
                                    );

                                    // Find topic name
                                    let topic_name = self.subscribed_topics
                                        .iter()
                                        .find(|(_, t)| t.hash() == message.topic)
                                        .map(|(name, _)| name.clone());

                                    if let Some(topic_name) = topic_name {
                                        return Some(VigiliaEvent::Message {
                                            topic: topic_name,
                                            data: message.data,
                                            source: message.source,
                                        });
                                    }
                                }
                                GossipsubEvent::Subscribed { peer_id, topic } => {
                                    debug!("Peer {} subscribed to {:?}", peer_id, topic);
                                    return Some(VigiliaEvent::PeerSubscribed {
                                        peer_id,
                                        topic: topic.to_string(),
                                    });
                                }
                                GossipsubEvent::Unsubscribed { peer_id, topic } => {
                                    debug!("Peer {} unsubscribed from {:?}", peer_id, topic);
                                    return Some(VigiliaEvent::PeerUnsubscribed {
                                        peer_id,
                                        topic: topic.to_string(),
                                    });
                                }
                                GossipsubEvent::GossipsubNotSupported { peer_id } => {
                                    warn!("Peer {} does not support Gossipsub", peer_id);
                                }
                            }
                        }
                        VigiliaNetworkBehaviourEvent::Kademlia(kad_event) => {
                            match kad_event {
                                KademliaEvent::RoutingUpdated { peer, .. } => {
                                    debug!("Routing table updated with peer: {}", peer);
                                }
                                _ => {}
                            }
                        }
                        VigiliaNetworkBehaviourEvent::Mdns(mdns_event) => {
                            match mdns_event {
                                mdns::Event::Discovered(peers) => {
                                    for (peer_id, addr) in peers {
                                        info!("Discovered peer {} at {}", peer_id, addr);
                                        self.swarm.behaviour_mut().gossipsub.add_explicit_peer(&peer_id);
                                    }
                                }
                                mdns::Event::Expired(peers) => {
                                    for (peer_id, _) in peers {
                                        debug!("Peer {} expired from mDNS", peer_id);
                                        self.swarm.behaviour_mut().gossipsub.remove_explicit_peer(&peer_id);
                                    }
                                }
                            }
                        }
                        VigiliaNetworkBehaviourEvent::Identify(identify_event) => {
                            match identify_event {
                                identify::Event::Received { peer_id, info } => {
                                    debug!("Identified peer {}: {:?}", peer_id, info.protocol_version);
                                }
                                _ => {}
                            }
                        }
                    }
                }
                SwarmEvent::ConnectionEstablished { peer_id, endpoint, .. } => {
                    info!("Connection established with {} at {:?}", peer_id, endpoint);
                    return Some(VigiliaEvent::PeerConnected { peer_id });
                }
                SwarmEvent::ConnectionClosed { peer_id, cause, .. } => {
                    info!("Connection closed with {}: {:?}", peer_id, cause);
                    return Some(VigiliaEvent::PeerDisconnected { peer_id });
                }
                SwarmEvent::IncomingConnection { .. } => {}
                SwarmEvent::IncomingConnectionError { .. } => {}
                SwarmEvent::OutgoingConnectionError { .. } => {}
                SwarmEvent::NewListenAddr { address, .. } => {
                    info!("Listening on {}", address);
                }
                SwarmEvent::ExpiredListenAddr { .. } => {}
                SwarmEvent::ListenerClosed { .. } => {}
                SwarmEvent::ListenerError { .. } => {}
                SwarmEvent::Dialing { .. } => {}
                _ => {}
            }
        }
    }
}

/// Vigilia network events
#[derive(Debug)]
pub enum VigiliaEvent {
    /// New message received
    Message {
        topic: String,
        data: Vec<u8>,
        source: Option<PeerId>,
    },
    /// Peer subscribed to a topic
    PeerSubscribed {
        peer_id: PeerId,
        topic: String,
    },
    /// Peer unsubscribed from a topic
    PeerUnsubscribed {
        peer_id: PeerId,
        topic: String,
    },
    /// Peer connected
    PeerConnected {
        peer_id: PeerId,
    },
    /// Peer disconnected
    PeerDisconnected {
        peer_id: PeerId,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_swarm_creation() {
        let swarm = VigiliaSwarm::new("test-agent".to_string()).await.unwrap();
        assert_eq!(swarm.agent_id(), "test-agent");
        assert!(swarm.local_peer_id().to_string().len() > 0);
    }

    #[tokio::test]
    async fn test_topic_subscription() {
        let mut swarm = VigiliaSwarm::new("test-agent".to_string()).await.unwrap();

        swarm.subscribe("test-topic").unwrap();
        assert!(swarm.is_subscribed("test-topic"));

        swarm.unsubscribe("test-topic").unwrap();
        assert!(!swarm.is_subscribed("test-topic"));
    }

    #[tokio::test]
    async fn test_listen_on() {
        let mut swarm = VigiliaSwarm::new("test-agent".to_string()).await.unwrap();

        let addr: Multiaddr = "/ip4/127.0.0.1/tcp/0".parse().unwrap();
        swarm.listen_on(addr).unwrap();
    }
}
