//! NAT traversal and relay functionality for peer connectivity
//!
//! Provides STUN/TURN-style relay functionality to enable connectivity
//! between peers behind NAT/firewalls.

use crate::error::{NetworkError, Result};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::time::{Duration, SystemTime};

/// Relay configuration
#[derive(Debug, Clone)]
pub struct RelayConfig {
    /// Maximum relay bandwidth per client (bytes/sec)
    pub max_bandwidth_per_client: u64,

    /// Maximum number of relay clients
    pub max_clients: usize,

    /// Relay reservation timeout
    pub reservation_timeout: Duration,

    /// Circuit timeout (how long to keep circuits alive)
    pub circuit_timeout: Duration,

    /// Enable STUN functionality (public address discovery)
    pub enable_stun: bool,

    /// Enable TURN functionality (full relay)
    pub enable_turn: bool,

    /// Maximum concurrent circuits per client
    pub max_circuits_per_client: usize,
}

impl Default for RelayConfig {
    fn default() -> Self {
        Self {
            max_bandwidth_per_client: 1_000_000, // 1 MB/s
            max_clients: 100,
            reservation_timeout: Duration::from_secs(60),
            circuit_timeout: Duration::from_secs(120),
            enable_stun: true,
            enable_turn: true,
            max_circuits_per_client: 10,
        }
    }
}

/// NAT type detected by STUN
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NatType {
    /// No NAT, direct connectivity
    None,

    /// Full cone NAT (any external endpoint can send data)
    FullCone,

    /// Restricted cone NAT (only endpoints we've sent to can reply)
    RestrictedCone,

    /// Port restricted cone NAT (only specific port+IP combos can reply)
    PortRestrictedCone,

    /// Symmetric NAT (different mapping for each destination)
    Symmetric,

    /// Unknown NAT type
    Unknown,
}

/// STUN binding response
#[derive(Debug, Clone)]
pub struct StunBinding {
    /// Mapped public address
    pub mapped_addr: SocketAddr,

    /// NAT type detected
    pub nat_type: NatType,

    /// Time when binding was discovered
    pub discovered_at: SystemTime,
}

impl StunBinding {
    pub fn new(mapped_addr: SocketAddr, nat_type: NatType) -> Self {
        Self {
            mapped_addr,
            nat_type,
            discovered_at: SystemTime::now(),
        }
    }
}

/// Relay reservation for TURN-style relaying
#[derive(Debug, Clone)]
pub struct RelayReservation {
    /// Reservation ID
    pub id: String,

    /// Client peer ID
    pub client_id: String,

    /// Relay address allocated to client
    pub relay_addr: SocketAddr,

    /// Time when reservation was created
    pub created_at: SystemTime,

    /// Time when reservation expires
    pub expires_at: SystemTime,

    /// Bytes relayed for this reservation
    pub bytes_relayed: u64,
}

impl RelayReservation {
    pub fn new(id: String, client_id: String, relay_addr: SocketAddr, timeout: Duration) -> Self {
        let now = SystemTime::now();
        Self {
            id,
            client_id,
            relay_addr,
            created_at: now,
            expires_at: now + timeout,
            bytes_relayed: 0,
        }
    }

    pub fn is_expired(&self) -> bool {
        SystemTime::now() > self.expires_at
    }

    pub fn refresh(&mut self, timeout: Duration) {
        self.expires_at = SystemTime::now() + timeout;
    }
}

/// Circuit state for relay connections
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitState {
    /// Circuit is being established
    Establishing,

    /// Circuit is active and relaying data
    Active,

    /// Circuit is closing
    Closing,

    /// Circuit is closed
    Closed,
}

/// Relay circuit connecting two peers through a relay
#[derive(Debug, Clone)]
pub struct RelayCircuit {
    /// Circuit ID
    pub id: String,

    /// Source peer ID
    pub source_peer: String,

    /// Destination peer ID
    pub dest_peer: String,

    /// Circuit state
    pub state: CircuitState,

    /// Time when circuit was created
    pub created_at: SystemTime,

    /// Time of last activity
    pub last_activity: SystemTime,

    /// Bytes sent through circuit
    pub bytes_sent: u64,

    /// Bytes received through circuit
    pub bytes_received: u64,
}

impl RelayCircuit {
    pub fn new(id: String, source_peer: String, dest_peer: String) -> Self {
        let now = SystemTime::now();
        Self {
            id,
            source_peer,
            dest_peer,
            state: CircuitState::Establishing,
            created_at: now,
            last_activity: now,
            bytes_sent: 0,
            bytes_received: 0,
        }
    }

    pub fn activate(&mut self) {
        self.state = CircuitState::Active;
        self.last_activity = SystemTime::now();
    }

    pub fn close(&mut self) {
        self.state = CircuitState::Closed;
        self.last_activity = SystemTime::now();
    }

    pub fn is_idle(&self, timeout: Duration) -> bool {
        if let Ok(elapsed) = self.last_activity.elapsed() {
            elapsed > timeout
        } else {
            false
        }
    }

    pub fn record_sent(&mut self, bytes: u64) {
        self.bytes_sent += bytes;
        self.last_activity = SystemTime::now();
    }

    pub fn record_received(&mut self, bytes: u64) {
        self.bytes_received += bytes;
        self.last_activity = SystemTime::now();
    }
}

/// Relay client information
#[derive(Debug, Clone)]
pub struct RelayClient {
    /// Client peer ID
    pub peer_id: String,

    /// Client's reservation if any
    pub reservation: Option<RelayReservation>,

    /// Active circuits for this client
    pub circuits: Vec<String>,

    /// Total bytes relayed for this client
    pub total_bytes_relayed: u64,

    /// Connection time
    pub connected_at: SystemTime,
}

impl RelayClient {
    pub fn new(peer_id: String) -> Self {
        Self {
            peer_id,
            reservation: None,
            circuits: Vec::new(),
            total_bytes_relayed: 0,
            connected_at: SystemTime::now(),
        }
    }

    pub fn add_circuit(&mut self, circuit_id: String) {
        self.circuits.push(circuit_id);
    }

    pub fn remove_circuit(&mut self, circuit_id: &str) {
        self.circuits.retain(|id| id != circuit_id);
    }
}

/// Relay node providing NAT traversal services
#[derive(Debug)]
pub struct RelayNode {
    /// Node configuration
    config: RelayConfig,

    /// Active relay clients
    clients: HashMap<String, RelayClient>,

    /// Active relay circuits
    circuits: HashMap<String, RelayCircuit>,

    /// STUN bindings cache
    stun_bindings: HashMap<String, StunBinding>,

    /// Next circuit ID
    next_circuit_id: u64,
}

impl RelayNode {
    pub fn new(config: RelayConfig) -> Self {
        Self {
            config,
            clients: HashMap::new(),
            circuits: HashMap::new(),
            stun_bindings: HashMap::new(),
            next_circuit_id: 0,
        }
    }

    /// Perform STUN binding discovery
    pub fn stun_bind(&mut self, peer_id: String, local_addr: SocketAddr) -> Result<StunBinding> {
        if !self.config.enable_stun {
            return Err(NetworkError::Relay("STUN is disabled".to_string()));
        }

        // In a real implementation, this would send STUN requests
        // For now, we'll simulate with the local address
        let binding = StunBinding::new(local_addr, NatType::None);
        self.stun_bindings.insert(peer_id, binding.clone());

        Ok(binding)
    }

    /// Create a relay reservation (TURN allocation)
    pub fn create_reservation(&mut self, peer_id: String, relay_addr: SocketAddr) -> Result<String> {
        if !self.config.enable_turn {
            return Err(NetworkError::Relay("TURN is disabled".to_string()));
        }

        if self.clients.len() >= self.config.max_clients {
            return Err(NetworkError::Relay("Maximum relay clients reached".to_string()));
        }

        let reservation_id = format!("reservation-{}", uuid::Uuid::new_v4());
        let reservation = RelayReservation::new(
            reservation_id.clone(),
            peer_id.clone(),
            relay_addr,
            self.config.reservation_timeout,
        );

        let client = self.clients.entry(peer_id.clone()).or_insert_with(|| {
            RelayClient::new(peer_id)
        });

        client.reservation = Some(reservation);

        Ok(reservation_id)
    }

    /// Refresh an existing reservation
    pub fn refresh_reservation(&mut self, peer_id: &str) -> Result<()> {
        if let Some(client) = self.clients.get_mut(peer_id) {
            if let Some(reservation) = &mut client.reservation {
                reservation.refresh(self.config.reservation_timeout);
                Ok(())
            } else {
                Err(NetworkError::Relay("No reservation found".to_string()))
            }
        } else {
            Err(NetworkError::Relay("Client not found".to_string()))
        }
    }

    /// Create a relay circuit between two peers
    pub fn create_circuit(&mut self, source_peer: String, dest_peer: String) -> Result<String> {
        // Ensure client exists and check circuit limit
        let client = self.clients.entry(source_peer.clone()).or_insert_with(|| {
            RelayClient::new(source_peer.clone())
        });

        if client.circuits.len() >= self.config.max_circuits_per_client {
            return Err(NetworkError::Relay("Maximum circuits per client reached".to_string()));
        }

        let circuit_id = format!("circuit-{}", self.next_circuit_id);
        self.next_circuit_id += 1;

        let circuit = RelayCircuit::new(circuit_id.clone(), source_peer.clone(), dest_peer);
        self.circuits.insert(circuit_id.clone(), circuit);

        // Add circuit to client
        if let Some(client) = self.clients.get_mut(&source_peer) {
            client.add_circuit(circuit_id.clone());
        }

        Ok(circuit_id)
    }

    /// Activate a relay circuit
    pub fn activate_circuit(&mut self, circuit_id: &str) -> Result<()> {
        if let Some(circuit) = self.circuits.get_mut(circuit_id) {
            circuit.activate();
            Ok(())
        } else {
            Err(NetworkError::Relay("Circuit not found".to_string()))
        }
    }

    /// Close a relay circuit
    pub fn close_circuit(&mut self, circuit_id: &str) -> Result<()> {
        if let Some(circuit) = self.circuits.get_mut(circuit_id) {
            let source_peer = circuit.source_peer.clone();
            circuit.close();

            // Remove from client's circuit list
            if let Some(client) = self.clients.get_mut(&source_peer) {
                client.remove_circuit(circuit_id);
            }

            Ok(())
        } else {
            Err(NetworkError::Relay("Circuit not found".to_string()))
        }
    }

    /// Relay data through a circuit
    pub fn relay_data(&mut self, circuit_id: &str, data: &[u8], direction: DataDirection) -> Result<()> {
        if let Some(circuit) = self.circuits.get_mut(circuit_id) {
            if circuit.state != CircuitState::Active {
                return Err(NetworkError::Relay("Circuit is not active".to_string()));
            }

            let bytes = data.len() as u64;

            match direction {
                DataDirection::SourceToDest => circuit.record_sent(bytes),
                DataDirection::DestToSource => circuit.record_received(bytes),
            }

            // Update client stats
            if let Some(client) = self.clients.get_mut(&circuit.source_peer) {
                client.total_bytes_relayed += bytes;
            }

            Ok(())
        } else {
            Err(NetworkError::Relay("Circuit not found".to_string()))
        }
    }

    /// Clean up expired reservations and idle circuits
    pub fn cleanup(&mut self) {
        // Remove expired reservations
        let mut expired_clients = Vec::new();
        for (peer_id, client) in &mut self.clients {
            if let Some(reservation) = &client.reservation {
                if reservation.is_expired() {
                    client.reservation = None;
                    if client.circuits.is_empty() {
                        expired_clients.push(peer_id.clone());
                    }
                }
            }
        }

        for peer_id in expired_clients {
            self.clients.remove(&peer_id);
        }

        // Remove idle circuits
        let mut idle_circuits = Vec::new();
        for (circuit_id, circuit) in &self.circuits {
            if circuit.is_idle(self.config.circuit_timeout) {
                idle_circuits.push(circuit_id.clone());
            }
        }

        for circuit_id in idle_circuits {
            if let Some(circuit) = self.circuits.get(&circuit_id) {
                let source_peer = circuit.source_peer.clone();
                if let Some(client) = self.clients.get_mut(&source_peer) {
                    client.remove_circuit(&circuit_id);
                }
            }
            self.circuits.remove(&circuit_id);
        }
    }

    /// Get relay statistics
    pub fn get_stats(&self) -> RelayStats {
        RelayStats {
            active_clients: self.clients.len(),
            active_circuits: self.circuits.len(),
            stun_bindings: self.stun_bindings.len(),
            total_bytes_relayed: self.clients.values()
                .map(|c| c.total_bytes_relayed)
                .sum(),
        }
    }

    /// Get circuit information
    pub fn get_circuit(&self, circuit_id: &str) -> Option<&RelayCircuit> {
        self.circuits.get(circuit_id)
    }

    /// Get client information
    pub fn get_client(&self, peer_id: &str) -> Option<&RelayClient> {
        self.clients.get(peer_id)
    }
}

/// Data direction for relay
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DataDirection {
    /// From source to destination
    SourceToDest,

    /// From destination to source
    DestToSource,
}

/// Relay statistics
#[derive(Debug, Clone)]
pub struct RelayStats {
    pub active_clients: usize,
    pub active_circuits: usize,
    pub stun_bindings: usize,
    pub total_bytes_relayed: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr};

    #[test]
    fn test_relay_config_default() {
        let config = RelayConfig::default();
        assert_eq!(config.max_bandwidth_per_client, 1_000_000);
        assert_eq!(config.max_clients, 100);
        assert!(config.enable_stun);
        assert!(config.enable_turn);
        assert_eq!(config.max_circuits_per_client, 10);
    }

    #[test]
    fn test_nat_type_variants() {
        assert_eq!(NatType::None, NatType::None);
        assert_ne!(NatType::FullCone, NatType::Symmetric);
    }

    #[test]
    fn test_stun_binding_creation() {
        let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1)), 8080);
        let binding = StunBinding::new(addr, NatType::FullCone);

        assert_eq!(binding.mapped_addr, addr);
        assert_eq!(binding.nat_type, NatType::FullCone);
    }

    #[test]
    fn test_relay_reservation_creation() {
        let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)), 9000);
        let reservation = RelayReservation::new(
            "res-1".to_string(),
            "peer-1".to_string(),
            addr,
            Duration::from_secs(60),
        );

        assert_eq!(reservation.id, "res-1");
        assert_eq!(reservation.client_id, "peer-1");
        assert_eq!(reservation.relay_addr, addr);
        assert!(!reservation.is_expired());
    }

    #[test]
    fn test_relay_reservation_refresh() {
        let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)), 9000);
        let mut reservation = RelayReservation::new(
            "res-1".to_string(),
            "peer-1".to_string(),
            addr,
            Duration::from_secs(1),
        );

        std::thread::sleep(Duration::from_millis(1100));
        assert!(reservation.is_expired());

        reservation.refresh(Duration::from_secs(60));
        assert!(!reservation.is_expired());
    }

    #[test]
    fn test_relay_circuit_creation() {
        let circuit = RelayCircuit::new(
            "circuit-1".to_string(),
            "peer-1".to_string(),
            "peer-2".to_string(),
        );

        assert_eq!(circuit.id, "circuit-1");
        assert_eq!(circuit.source_peer, "peer-1");
        assert_eq!(circuit.dest_peer, "peer-2");
        assert_eq!(circuit.state, CircuitState::Establishing);
        assert_eq!(circuit.bytes_sent, 0);
        assert_eq!(circuit.bytes_received, 0);
    }

    #[test]
    fn test_relay_circuit_lifecycle() {
        let mut circuit = RelayCircuit::new(
            "circuit-1".to_string(),
            "peer-1".to_string(),
            "peer-2".to_string(),
        );

        assert_eq!(circuit.state, CircuitState::Establishing);

        circuit.activate();
        assert_eq!(circuit.state, CircuitState::Active);

        circuit.close();
        assert_eq!(circuit.state, CircuitState::Closed);
    }

    #[test]
    fn test_relay_circuit_data_tracking() {
        let mut circuit = RelayCircuit::new(
            "circuit-1".to_string(),
            "peer-1".to_string(),
            "peer-2".to_string(),
        );

        circuit.record_sent(1000);
        assert_eq!(circuit.bytes_sent, 1000);

        circuit.record_received(500);
        assert_eq!(circuit.bytes_received, 500);
    }

    #[test]
    fn test_relay_circuit_idle_detection() {
        let circuit = RelayCircuit::new(
            "circuit-1".to_string(),
            "peer-1".to_string(),
            "peer-2".to_string(),
        );

        // Should not be idle immediately
        assert!(!circuit.is_idle(Duration::from_secs(1)));
    }

    #[test]
    fn test_relay_client_creation() {
        let client = RelayClient::new("peer-1".to_string());

        assert_eq!(client.peer_id, "peer-1");
        assert!(client.reservation.is_none());
        assert_eq!(client.circuits.len(), 0);
        assert_eq!(client.total_bytes_relayed, 0);
    }

    #[test]
    fn test_relay_client_circuit_management() {
        let mut client = RelayClient::new("peer-1".to_string());

        client.add_circuit("circuit-1".to_string());
        client.add_circuit("circuit-2".to_string());
        assert_eq!(client.circuits.len(), 2);

        client.remove_circuit("circuit-1");
        assert_eq!(client.circuits.len(), 1);
        assert_eq!(client.circuits[0], "circuit-2");
    }

    #[test]
    fn test_relay_node_creation() {
        let config = RelayConfig::default();
        let relay = RelayNode::new(config);

        let stats = relay.get_stats();
        assert_eq!(stats.active_clients, 0);
        assert_eq!(stats.active_circuits, 0);
        assert_eq!(stats.stun_bindings, 0);
    }

    #[test]
    fn test_relay_node_stun_bind() {
        let config = RelayConfig::default();
        let mut relay = RelayNode::new(config);

        let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1)), 8080);
        let binding = relay.stun_bind("peer-1".to_string(), addr).unwrap();

        assert_eq!(binding.mapped_addr, addr);
        assert_eq!(binding.nat_type, NatType::None);

        let stats = relay.get_stats();
        assert_eq!(stats.stun_bindings, 1);
    }

    #[test]
    fn test_relay_node_create_reservation() {
        let config = RelayConfig::default();
        let mut relay = RelayNode::new(config);

        let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)), 9000);
        let reservation_id = relay.create_reservation("peer-1".to_string(), addr).unwrap();

        assert!(reservation_id.starts_with("reservation-"));

        let client = relay.get_client("peer-1").unwrap();
        assert!(client.reservation.is_some());
    }

    #[test]
    fn test_relay_node_refresh_reservation() {
        let config = RelayConfig::default();
        let mut relay = RelayNode::new(config);

        let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)), 9000);
        relay.create_reservation("peer-1".to_string(), addr).unwrap();

        assert!(relay.refresh_reservation("peer-1").is_ok());
        assert!(relay.refresh_reservation("nonexistent").is_err());
    }

    #[test]
    fn test_relay_node_create_circuit() {
        let config = RelayConfig::default();
        let mut relay = RelayNode::new(config);

        let circuit_id = relay.create_circuit("peer-1".to_string(), "peer-2".to_string()).unwrap();

        assert!(circuit_id.starts_with("circuit-"));

        let circuit = relay.get_circuit(&circuit_id).unwrap();
        assert_eq!(circuit.source_peer, "peer-1");
        assert_eq!(circuit.dest_peer, "peer-2");
        assert_eq!(circuit.state, CircuitState::Establishing);
    }

    #[test]
    fn test_relay_node_activate_circuit() {
        let config = RelayConfig::default();
        let mut relay = RelayNode::new(config);

        let circuit_id = relay.create_circuit("peer-1".to_string(), "peer-2".to_string()).unwrap();
        relay.activate_circuit(&circuit_id).unwrap();

        let circuit = relay.get_circuit(&circuit_id).unwrap();
        assert_eq!(circuit.state, CircuitState::Active);
    }

    #[test]
    fn test_relay_node_close_circuit() {
        let config = RelayConfig::default();
        let mut relay = RelayNode::new(config);

        let circuit_id = relay.create_circuit("peer-1".to_string(), "peer-2".to_string()).unwrap();
        relay.close_circuit(&circuit_id).unwrap();

        let circuit = relay.get_circuit(&circuit_id).unwrap();
        assert_eq!(circuit.state, CircuitState::Closed);
    }

    #[test]
    fn test_relay_node_relay_data() {
        let config = RelayConfig::default();
        let mut relay = RelayNode::new(config);

        let circuit_id = relay.create_circuit("peer-1".to_string(), "peer-2".to_string()).unwrap();
        relay.activate_circuit(&circuit_id).unwrap();

        let data = vec![1, 2, 3, 4, 5];
        relay.relay_data(&circuit_id, &data, DataDirection::SourceToDest).unwrap();

        let circuit = relay.get_circuit(&circuit_id).unwrap();
        assert_eq!(circuit.bytes_sent, 5);

        relay.relay_data(&circuit_id, &data, DataDirection::DestToSource).unwrap();
        let circuit = relay.get_circuit(&circuit_id).unwrap();
        assert_eq!(circuit.bytes_received, 5);
    }

    #[test]
    fn test_relay_node_max_circuits_per_client() {
        let mut config = RelayConfig::default();
        config.max_circuits_per_client = 2;
        let mut relay = RelayNode::new(config);

        relay.create_circuit("peer-1".to_string(), "peer-2".to_string()).unwrap();
        relay.create_circuit("peer-1".to_string(), "peer-3".to_string()).unwrap();

        let result = relay.create_circuit("peer-1".to_string(), "peer-4".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn test_relay_node_cleanup() {
        let config = RelayConfig::default();
        let mut relay = RelayNode::new(config);

        let circuit_id = relay.create_circuit("peer-1".to_string(), "peer-2".to_string()).unwrap();
        relay.activate_circuit(&circuit_id).unwrap();

        relay.cleanup();

        // Circuit should still exist (not idle yet)
        assert!(relay.get_circuit(&circuit_id).is_some());
    }

    #[test]
    fn test_data_direction_variants() {
        assert_eq!(DataDirection::SourceToDest, DataDirection::SourceToDest);
        assert_ne!(DataDirection::SourceToDest, DataDirection::DestToSource);
    }
}
