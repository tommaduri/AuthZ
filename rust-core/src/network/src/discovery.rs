//! Kademlia DHT-based peer discovery implementation
//!
//! **DEPRECATED**: This simulated Kademlia DHT is deprecated in favor of real LibP2P Kademlia and mDNS.
//! Use `libp2p::VigiliaSwarm` with Kademlia and mDNS instead for production networking.
//!
//! Migration guide: See `docs/specs/option3-libp2p-integration.md`
//!
//! This module provides distributed peer discovery using the Kademlia DHT protocol.
//! It enables O(log N) peer lookups, maintains a distributed routing table with k-buckets,
//! and supports bootstrap node connection for joining the network.

use crate::error::{NetworkError, Result};
use std::collections::{HashMap, VecDeque};
use std::time::{Duration, SystemTime};

/// Discovery service configuration
#[derive(Debug, Clone)]
pub struct DiscoveryConfig {
    /// Replication factor (k-value in Kademlia, typically 20)
    pub replication_factor: usize,

    /// Number of bits in the key space (256 for SHA-256 based IDs)
    pub key_bits: usize,

    /// Timeout for peer queries
    pub query_timeout: Duration,

    /// Bootstrap nodes to connect to initially
    pub bootstrap_nodes: Vec<String>,

    /// Number of concurrent queries (alpha parameter, typically 3)
    pub concurrency: usize,

    /// Interval for refreshing k-buckets
    pub refresh_interval: Duration,

    /// Maximum consecutive failures before removing a peer
    pub max_failures: usize,
}

impl Default for DiscoveryConfig {
    fn default() -> Self {
        Self {
            replication_factor: 20,
            key_bits: 256,
            query_timeout: Duration::from_secs(10),
            bootstrap_nodes: Vec::new(),
            concurrency: 3,
            refresh_interval: Duration::from_secs(3600), // 1 hour
            max_failures: 3,
        }
    }
}

/// Entry in a k-bucket representing a peer
#[derive(Debug, Clone)]
pub struct PeerEntry {
    /// Peer identifier
    pub peer_id: String,

    /// Known addresses for this peer
    pub addresses: Vec<String>,

    /// Last time this peer was seen
    pub last_seen: SystemTime,

    /// Number of consecutive failures
    pub failures: usize,

    /// XOR distance from local node
    pub distance: Vec<u8>,

    /// Reputation score (0.0 to 1.0)
    pub reputation: f64,
}

impl PeerEntry {
    /// Create a new peer entry
    pub fn new(peer_id: String, distance: Vec<u8>) -> Self {
        Self {
            peer_id,
            addresses: Vec::new(),
            last_seen: SystemTime::now(),
            failures: 0,
            distance,
            reputation: 0.5,
        }
    }

    /// Update last seen timestamp
    pub fn touch(&mut self) {
        self.last_seen = SystemTime::now();
        self.failures = 0; // Reset failure count on successful contact
    }

    /// Record a failure
    pub fn record_failure(&mut self) {
        self.failures += 1;
    }

    /// Check if peer has exceeded maximum failures
    pub fn is_failed(&self, max_failures: usize) -> bool {
        self.failures >= max_failures
    }

    /// Add an address if not already present
    pub fn add_address(&mut self, addr: String) {
        if !self.addresses.contains(&addr) {
            self.addresses.push(addr);
        }
    }
}

/// K-bucket for storing peers at a specific distance range
#[derive(Debug)]
pub struct KBucket {
    /// Bucket index (0 to key_bits-1)
    pub index: usize,

    /// Peers in this bucket (most recently seen at the back)
    pub peers: VecDeque<PeerEntry>,

    /// Maximum capacity of this bucket
    pub capacity: usize,

    /// Last time this bucket was refreshed
    pub last_refresh: SystemTime,
}

impl KBucket {
    /// Create a new k-bucket
    pub fn new(index: usize, capacity: usize) -> Self {
        Self {
            index,
            peers: VecDeque::with_capacity(capacity),
            capacity,
            last_refresh: SystemTime::now(),
        }
    }

    /// Add a peer to the bucket (returns true if added)
    pub fn add_peer(&mut self, peer: PeerEntry) -> bool {
        // Check if peer already exists
        if let Some(pos) = self.peers.iter().position(|p| p.peer_id == peer.peer_id) {
            // Move to back (most recently seen)
            let mut existing = self.peers.remove(pos).unwrap();
            existing.touch();
            self.peers.push_back(existing);
            return true;
        }

        // Add new peer if space available
        if self.peers.len() < self.capacity {
            self.peers.push_back(peer);
            true
        } else {
            false // Bucket full
        }
    }

    /// Remove a peer from the bucket
    pub fn remove_peer(&mut self, peer_id: &str) -> Option<PeerEntry> {
        if let Some(pos) = self.peers.iter().position(|p| p.peer_id == peer_id) {
            self.peers.remove(pos)
        } else {
            None
        }
    }

    /// Get all peers in the bucket
    pub fn get_peers(&self) -> Vec<&PeerEntry> {
        self.peers.iter().collect()
    }

    /// Check if bucket needs refresh
    pub fn needs_refresh(&self, refresh_interval: Duration) -> bool {
        SystemTime::now()
            .duration_since(self.last_refresh)
            .unwrap_or(Duration::from_secs(0))
            >= refresh_interval
    }

    /// Mark bucket as refreshed
    pub fn mark_refreshed(&mut self) {
        self.last_refresh = SystemTime::now();
    }
}

/// Peer query state
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueryState {
    /// Query is running
    Active,

    /// Query completed successfully
    Completed,

    /// Query timed out
    TimedOut,

    /// Query failed
    Failed,
}

/// Ongoing peer lookup query
#[derive(Debug)]
pub struct PeerQuery {
    /// Query ID
    pub query_id: String,

    /// Target peer ID being searched
    pub target_id: String,

    /// Current query state
    pub state: QueryState,

    /// Peers found so far
    pub found_peers: Vec<PeerEntry>,

    /// Query start time
    pub started_at: SystemTime,

    /// Peers currently being queried
    pub pending: Vec<String>,
}

impl PeerQuery {
    /// Create a new peer query
    pub fn new(query_id: String, target_id: String) -> Self {
        Self {
            query_id,
            target_id,
            state: QueryState::Active,
            found_peers: Vec::new(),
            started_at: SystemTime::now(),
            pending: Vec::new(),
        }
    }

    /// Check if query has timed out
    pub fn has_timed_out(&self, timeout: Duration) -> bool {
        SystemTime::now()
            .duration_since(self.started_at)
            .unwrap_or(Duration::from_secs(0))
            >= timeout
    }
}

/// Kademlia DHT discovery service
pub struct Discovery {
    /// Local peer ID
    local_peer_id: String,

    /// Discovery configuration
    config: DiscoveryConfig,

    /// K-buckets for routing table (one per bit in key space)
    buckets: Vec<KBucket>,

    /// Active peer queries
    queries: HashMap<String, PeerQuery>,

    /// Bootstrap nodes
    bootstrap_nodes: Vec<String>,
}

impl Discovery {
    /// Create a new discovery service
    pub fn new(local_peer_id: String) -> Self {
        Self::with_config(local_peer_id, DiscoveryConfig::default())
    }

    /// Create a new discovery service with custom configuration
    pub fn with_config(local_peer_id: String, config: DiscoveryConfig) -> Self {
        let buckets = (0..config.key_bits)
            .map(|i| KBucket::new(i, config.replication_factor))
            .collect();

        Self {
            local_peer_id,
            bootstrap_nodes: config.bootstrap_nodes.clone(),
            config,
            buckets,
            queries: HashMap::new(),
        }
    }

    /// Get the local peer ID
    pub fn local_peer_id(&self) -> &str {
        &self.local_peer_id
    }

    /// Get the discovery configuration
    pub fn config(&self) -> &DiscoveryConfig {
        &self.config
    }

    /// Calculate XOR distance between two peer IDs
    pub fn calculate_distance(peer_id1: &str, peer_id2: &str) -> Vec<u8> {
        let bytes1 = peer_id1.as_bytes();
        let bytes2 = peer_id2.as_bytes();

        let max_len = bytes1.len().max(bytes2.len());
        let mut distance = vec![0u8; max_len];

        for i in 0..max_len {
            let b1 = bytes1.get(i).copied().unwrap_or(0);
            let b2 = bytes2.get(i).copied().unwrap_or(0);
            distance[i] = b1 ^ b2;
        }

        distance
    }

    /// Find the appropriate bucket index for a given distance
    fn bucket_index(&self, distance: &[u8]) -> usize {
        // Find the first non-zero byte and count leading zeros
        for (byte_idx, &byte) in distance.iter().enumerate() {
            if byte != 0 {
                let leading_zeros = byte.leading_zeros() as usize;
                return byte_idx * 8 + leading_zeros;
            }
        }
        self.config.key_bits - 1 // Maximum distance
    }

    /// Add a peer to the routing table
    pub fn add_peer(&mut self, peer_id: String, addresses: Vec<String>) -> Result<()> {
        if peer_id == self.local_peer_id {
            return Ok(()); // Don't add self
        }

        let distance = Self::calculate_distance(&self.local_peer_id, &peer_id);
        let bucket_idx = self.bucket_index(&distance);

        if bucket_idx >= self.buckets.len() {
            return Err(NetworkError::Discovery(
                "Bucket index out of range".to_string(),
            ));
        }

        let mut peer_entry = PeerEntry::new(peer_id.clone(), distance);
        for addr in addresses {
            peer_entry.add_address(addr);
        }

        let bucket = &mut self.buckets[bucket_idx];
        if bucket.add_peer(peer_entry) {
            tracing::debug!("Added peer {} to bucket {}", peer_id, bucket_idx);
            Ok(())
        } else {
            Err(NetworkError::Discovery(format!(
                "Bucket {} is full",
                bucket_idx
            )))
        }
    }

    /// Remove a peer from the routing table
    pub fn remove_peer(&mut self, peer_id: &str) -> Option<PeerEntry> {
        let distance = Self::calculate_distance(&self.local_peer_id, peer_id);
        let bucket_idx = self.bucket_index(&distance);

        if bucket_idx < self.buckets.len() {
            self.buckets[bucket_idx].remove_peer(peer_id)
        } else {
            None
        }
    }

    /// Find the k closest peers to a target ID
    pub fn find_closest_peers(&self, target_id: &str, k: usize) -> Vec<PeerEntry> {
        let mut all_peers: Vec<PeerEntry> = self
            .buckets
            .iter()
            .flat_map(|bucket| bucket.get_peers().into_iter().cloned())
            .collect();

        // Calculate distance from target and sort
        let target_distance_fn = |peer: &PeerEntry| -> Vec<u8> {
            Self::calculate_distance(target_id, &peer.peer_id)
        };

        all_peers.sort_by(|a, b| {
            let dist_a = target_distance_fn(a);
            let dist_b = target_distance_fn(b);
            dist_a.cmp(&dist_b)
        });

        all_peers.into_iter().take(k).collect()
    }

    /// Start a peer lookup query
    pub fn start_lookup(&mut self, target_id: String) -> String {
        let query_id = format!("query-{}", uuid::Uuid::new_v4());
        let query = PeerQuery::new(query_id.clone(), target_id.clone());

        tracing::info!("Starting peer lookup for {} (query: {})", target_id, query_id);

        self.queries.insert(query_id.clone(), query);
        query_id
    }

    /// Get query status
    pub fn query_status(&self, query_id: &str) -> Option<&PeerQuery> {
        self.queries.get(query_id)
    }

    /// Complete a query
    pub fn complete_query(&mut self, query_id: &str, state: QueryState) -> Result<()> {
        if let Some(query) = self.queries.get_mut(query_id) {
            query.state = state;
            Ok(())
        } else {
            Err(NetworkError::Discovery(format!(
                "Query not found: {}",
                query_id
            )))
        }
    }

    /// Add bootstrap nodes
    pub fn add_bootstrap_nodes(&mut self, nodes: Vec<String>) {
        self.bootstrap_nodes.extend(nodes);
    }

    /// Get bootstrap nodes
    pub fn bootstrap_nodes(&self) -> &[String] {
        &self.bootstrap_nodes
    }

    /// Get all peers from routing table
    pub fn all_peers(&self) -> Vec<PeerEntry> {
        self.buckets
            .iter()
            .flat_map(|bucket| bucket.get_peers().into_iter().cloned())
            .collect()
    }

    /// Get peer count
    pub fn peer_count(&self) -> usize {
        self.buckets.iter().map(|b| b.peers.len()).sum()
    }

    /// Cleanup failed peers
    pub fn cleanup_failed_peers(&mut self) -> usize {
        let mut removed = 0;
        for bucket in &mut self.buckets {
            bucket.peers.retain(|peer| {
                let keep = !peer.is_failed(self.config.max_failures);
                if !keep {
                    removed += 1;
                    tracing::debug!("Removing failed peer: {}", peer.peer_id);
                }
                keep
            });
        }
        removed
    }

    /// Get buckets that need refresh
    pub fn buckets_needing_refresh(&self) -> Vec<usize> {
        self.buckets
            .iter()
            .enumerate()
            .filter(|(_, bucket)| bucket.needs_refresh(self.config.refresh_interval))
            .map(|(idx, _)| idx)
            .collect()
    }

    /// Mark bucket as refreshed
    pub fn mark_bucket_refreshed(&mut self, bucket_idx: usize) {
        if bucket_idx < self.buckets.len() {
            self.buckets[bucket_idx].mark_refreshed();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_discovery_config_default() {
        let config = DiscoveryConfig::default();
        assert_eq!(config.replication_factor, 20);
        assert_eq!(config.key_bits, 256);
        assert_eq!(config.concurrency, 3);
        assert_eq!(config.max_failures, 3);
    }

    #[test]
    fn test_peer_entry_creation() {
        let distance = vec![0xFF, 0x00];
        let peer = PeerEntry::new("peer-123".to_string(), distance.clone());

        assert_eq!(peer.peer_id, "peer-123");
        assert_eq!(peer.distance, distance);
        assert_eq!(peer.failures, 0);
        assert_eq!(peer.reputation, 0.5);
    }

    #[test]
    fn test_peer_entry_failure_tracking() {
        let mut peer = PeerEntry::new("peer-123".to_string(), vec![0xFF]);

        peer.record_failure();
        assert_eq!(peer.failures, 1);
        assert!(!peer.is_failed(3));

        peer.record_failure();
        peer.record_failure();
        assert_eq!(peer.failures, 3);
        assert!(peer.is_failed(3));

        peer.touch();
        assert_eq!(peer.failures, 0);
    }

    #[test]
    fn test_kbucket_creation() {
        let bucket = KBucket::new(5, 20);
        assert_eq!(bucket.index, 5);
        assert_eq!(bucket.capacity, 20);
        assert_eq!(bucket.peers.len(), 0);
    }

    #[test]
    fn test_kbucket_add_peer() {
        let mut bucket = KBucket::new(0, 20);
        let peer = PeerEntry::new("peer-1".to_string(), vec![0x01]);

        assert!(bucket.add_peer(peer.clone()));
        assert_eq!(bucket.peers.len(), 1);

        // Adding same peer should update position
        assert!(bucket.add_peer(peer.clone()));
        assert_eq!(bucket.peers.len(), 1);
    }

    #[test]
    fn test_kbucket_full() {
        let mut bucket = KBucket::new(0, 2);

        let peer1 = PeerEntry::new("peer-1".to_string(), vec![0x01]);
        let peer2 = PeerEntry::new("peer-2".to_string(), vec![0x02]);
        let peer3 = PeerEntry::new("peer-3".to_string(), vec![0x03]);

        assert!(bucket.add_peer(peer1));
        assert!(bucket.add_peer(peer2));
        assert!(!bucket.add_peer(peer3)); // Should fail - bucket full
        assert_eq!(bucket.peers.len(), 2);
    }

    #[test]
    fn test_kbucket_remove_peer() {
        let mut bucket = KBucket::new(0, 20);
        let peer = PeerEntry::new("peer-1".to_string(), vec![0x01]);

        bucket.add_peer(peer);
        assert_eq!(bucket.peers.len(), 1);

        let removed = bucket.remove_peer("peer-1");
        assert!(removed.is_some());
        assert_eq!(bucket.peers.len(), 0);
    }

    #[test]
    fn test_calculate_distance() {
        let distance = Discovery::calculate_distance("abc", "abd");
        // 'c' ^ 'd' = 0x63 ^ 0x64 = 0x07
        assert_eq!(distance[2], 0x07);
    }

    #[test]
    fn test_discovery_creation() {
        let discovery = Discovery::new("local-peer".to_string());
        assert_eq!(discovery.local_peer_id(), "local-peer");
        assert_eq!(discovery.peer_count(), 0);
        assert_eq!(discovery.buckets.len(), 256);
    }

    #[test]
    fn test_discovery_add_peer() {
        let mut discovery = Discovery::new("local-peer".to_string());

        let result = discovery.add_peer(
            "remote-peer".to_string(),
            vec!["/ip4/127.0.0.1/tcp/8000".to_string()],
        );

        assert!(result.is_ok());
        assert_eq!(discovery.peer_count(), 1);
    }

    #[test]
    fn test_discovery_find_closest_peers() {
        let mut discovery = Discovery::new("local-peer".to_string());

        discovery
            .add_peer("peer-1".to_string(), vec![])
            .unwrap();
        discovery
            .add_peer("peer-2".to_string(), vec![])
            .unwrap();
        discovery
            .add_peer("peer-3".to_string(), vec![])
            .unwrap();

        let closest = discovery.find_closest_peers("peer-2", 2);
        assert_eq!(closest.len(), 2);
        assert_eq!(closest[0].peer_id, "peer-2"); // Exact match should be first
    }

    #[test]
    fn test_discovery_start_lookup() {
        let mut discovery = Discovery::new("local-peer".to_string());
        let query_id = discovery.start_lookup("target-peer".to_string());

        let query = discovery.query_status(&query_id);
        assert!(query.is_some());
        assert_eq!(query.unwrap().state, QueryState::Active);
    }

    #[test]
    fn test_discovery_cleanup_failed_peers() {
        let mut discovery = Discovery::new("local-peer".to_string());

        // Add a peer
        discovery.add_peer("peer-1".to_string(), vec![]).unwrap();

        // Mark it as failed
        let distance = Discovery::calculate_distance("local-peer", "peer-1");
        let bucket_idx = discovery.bucket_index(&distance);
        if let Some(peer) = discovery.buckets[bucket_idx]
            .peers
            .iter_mut()
            .find(|p| p.peer_id == "peer-1")
        {
            for _ in 0..3 {
                peer.record_failure();
            }
        }

        let removed = discovery.cleanup_failed_peers();
        assert_eq!(removed, 1);
        assert_eq!(discovery.peer_count(), 0);
    }

    #[test]
    fn test_bootstrap_nodes() {
        let mut discovery = Discovery::new("local-peer".to_string());

        discovery.add_bootstrap_nodes(vec![
            "/ip4/127.0.0.1/tcp/8001".to_string(),
            "/ip4/127.0.0.1/tcp/8002".to_string(),
        ]);

        assert_eq!(discovery.bootstrap_nodes().len(), 2);
    }
}
