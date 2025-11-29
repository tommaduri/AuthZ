//! Mock implementations for isolated testing

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Mock network for testing without real connections
pub struct MockNetwork {
    nodes: Arc<Mutex<HashMap<[u8; 32], MockNode>>>,
    message_log: Arc<Mutex<Vec<MockMessage>>>,
    latency_ms: u64,
    packet_loss_rate: f64,
}

impl MockNetwork {
    pub fn new() -> Self {
        Self {
            nodes: Arc::new(Mutex::new(HashMap::new())),
            message_log: Arc::new(Mutex::new(Vec::new())),
            latency_ms: 10,
            packet_loss_rate: 0.0,
        }
    }

    pub fn with_latency(mut self, latency_ms: u64) -> Self {
        self.latency_ms = latency_ms;
        self
    }

    pub fn with_packet_loss(mut self, rate: f64) -> Self {
        self.packet_loss_rate = rate;
        self
    }

    pub fn add_node(&self, id: [u8; 32]) {
        let mut nodes = self.nodes.lock().unwrap();
        nodes.insert(id, MockNode::new(id));
    }

    pub fn send_message(&self, from: [u8; 32], to: [u8; 32], payload: Vec<u8>) -> Result<(), MockError> {
        // Simulate packet loss
        if rand::random::<f64>() < self.packet_loss_rate {
            return Err(MockError::PacketLost);
        }

        let message = MockMessage {
            from,
            to,
            payload,
            timestamp: std::time::Instant::now(),
        };

        self.message_log.lock().unwrap().push(message);

        // Simulate latency
        std::thread::sleep(std::time::Duration::from_millis(self.latency_ms));

        Ok(())
    }

    pub fn get_message_count(&self) -> usize {
        self.message_log.lock().unwrap().len()
    }

    pub fn clear_log(&self) {
        self.message_log.lock().unwrap().clear();
    }
}

pub struct MockNode {
    pub id: [u8; 32],
    pub received_messages: Arc<Mutex<Vec<Vec<u8>>>>,
    pub is_byzantine: bool,
}

impl MockNode {
    pub fn new(id: [u8; 32]) -> Self {
        Self {
            id,
            received_messages: Arc::new(Mutex::new(Vec::new())),
            is_byzantine: false,
        }
    }

    pub fn receive(&self, message: Vec<u8>) {
        self.received_messages.lock().unwrap().push(message);
    }

    pub fn message_count(&self) -> usize {
        self.received_messages.lock().unwrap().len()
    }
}

pub struct MockMessage {
    pub from: [u8; 32],
    pub to: [u8; 32],
    pub payload: Vec<u8>,
    pub timestamp: std::time::Instant,
}

/// Mock cryptography for deterministic testing
pub struct MockCrypto {
    deterministic: bool,
}

impl MockCrypto {
    pub fn new() -> Self {
        Self {
            deterministic: false,
        }
    }

    pub fn deterministic() -> Self {
        Self {
            deterministic: true,
        }
    }

    pub fn sign(&self, message: &[u8], _secret_key: &[u8]) -> Vec<u8> {
        if self.deterministic {
            // Deterministic signature for testing
            let mut sig = vec![0u8; 64];
            sig[0] = message.len() as u8;
            sig
        } else {
            vec![0u8; 64]
        }
    }

    pub fn verify(&self, _message: &[u8], _signature: &[u8], _public_key: &[u8]) -> bool {
        true // Always verify in mock
    }

    pub fn encrypt(&self, plaintext: &[u8], _public_key: &[u8]) -> Vec<u8> {
        // Simple XOR for mock
        plaintext.iter().map(|b| b ^ 0x42).collect()
    }

    pub fn decrypt(&self, ciphertext: &[u8], _secret_key: &[u8]) -> Vec<u8> {
        // Reverse XOR
        ciphertext.iter().map(|b| b ^ 0x42).collect()
    }
}

/// Mock DAG for testing without full implementation
pub struct MockDAG {
    vertices: Arc<Mutex<HashMap<[u8; 32], MockVertex>>>,
    finalized: Arc<Mutex<Vec<[u8; 32]>>>,
}

impl MockDAG {
    pub fn new() -> Self {
        Self {
            vertices: Arc::new(Mutex::new(HashMap::new())),
            finalized: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn insert(&self, vertex: MockVertex) -> Result<(), MockError> {
        let hash = vertex.hash();
        self.vertices.lock().unwrap().insert(hash, vertex);
        Ok(())
    }

    pub fn get(&self, hash: &[u8; 32]) -> Option<MockVertex> {
        self.vertices.lock().unwrap().get(hash).cloned()
    }

    pub fn finalize(&self, hash: [u8; 32]) {
        self.finalized.lock().unwrap().push(hash);
    }

    pub fn is_finalized(&self, hash: &[u8; 32]) -> bool {
        self.finalized.lock().unwrap().contains(hash)
    }

    pub fn vertex_count(&self) -> usize {
        self.vertices.lock().unwrap().len()
    }
}

#[derive(Clone)]
pub struct MockVertex {
    pub data: Vec<u8>,
    pub parents: Vec<[u8; 32]>,
    pub creator: [u8; 32],
}

impl MockVertex {
    pub fn new(data: Vec<u8>, parents: Vec<[u8; 32]>, creator: [u8; 32]) -> Self {
        Self { data, parents, creator }
    }

    pub fn hash(&self) -> [u8; 32] {
        let mut hash = [0u8; 32];
        hash[0] = self.data.len() as u8;
        hash
    }
}

/// Mock consensus for testing agreement protocols
pub struct MockConsensus {
    votes: Arc<Mutex<HashMap<[u8; 32], Vec<bool>>>>,
    threshold: f64,
}

impl MockConsensus {
    pub fn new(threshold: f64) -> Self {
        Self {
            votes: Arc::new(Mutex::new(HashMap::new())),
            threshold,
        }
    }

    pub fn vote(&self, proposal: [u8; 32], vote: bool) {
        self.votes
            .lock()
            .unwrap()
            .entry(proposal)
            .or_insert_with(Vec::new)
            .push(vote);
    }

    pub fn check_consensus(&self, proposal: &[u8; 32]) -> Option<bool> {
        let votes = self.votes.lock().unwrap();
        if let Some(votes) = votes.get(proposal) {
            let yes_votes = votes.iter().filter(|&&v| v).count();
            let total_votes = votes.len();

            if total_votes == 0 {
                return None;
            }

            let yes_ratio = yes_votes as f64 / total_votes as f64;
            Some(yes_ratio >= self.threshold)
        } else {
            None
        }
    }
}

/// Mock exchange for testing trading operations
pub struct MockExchange {
    balances: Arc<Mutex<HashMap<([u8; 32], String), f64>>>,
    orders: Arc<Mutex<Vec<MockOrder>>>,
    trades: Arc<Mutex<Vec<MockTrade>>>,
}

impl MockExchange {
    pub fn new() -> Self {
        Self {
            balances: Arc::new(Mutex::new(HashMap::new())),
            orders: Arc::new(Mutex::new(Vec::new())),
            trades: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn deposit(&self, user: [u8; 32], asset: String, amount: f64) {
        let mut balances = self.balances.lock().unwrap();
        *balances.entry((user, asset)).or_insert(0.0) += amount;
    }

    pub fn get_balance(&self, user: [u8; 32], asset: &str) -> f64 {
        let balances = self.balances.lock().unwrap();
        *balances.get(&(user, asset.to_string())).unwrap_or(&0.0)
    }

    pub fn place_order(&self, order: MockOrder) {
        self.orders.lock().unwrap().push(order);
    }

    pub fn match_orders(&self) -> usize {
        // Simple matching logic for testing
        let mut orders = self.orders.lock().unwrap();
        let mut trades = self.trades.lock().unwrap();
        let mut matched = 0;

        // Simplified matching
        for i in 0..orders.len() {
            for j in (i + 1)..orders.len() {
                if orders[i].can_match(&orders[j]) {
                    trades.push(MockTrade {
                        buyer: orders[i].user,
                        seller: orders[j].user,
                        amount: orders[i].amount.min(orders[j].amount),
                        price: orders[i].price,
                    });
                    matched += 1;
                }
            }
        }

        matched
    }
}

#[derive(Clone)]
pub struct MockOrder {
    pub user: [u8; 32],
    pub side: OrderSide,
    pub amount: f64,
    pub price: f64,
}

impl MockOrder {
    pub fn can_match(&self, other: &MockOrder) -> bool {
        self.side != other.side && self.price >= other.price
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum OrderSide {
    Buy,
    Sell,
}

pub struct MockTrade {
    pub buyer: [u8; 32],
    pub seller: [u8; 32],
    pub amount: f64,
    pub price: f64,
}

/// Mock error type
#[derive(Debug)]
pub enum MockError {
    PacketLost,
    InvalidData,
    NotFound,
}

impl std::fmt::Display for MockError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MockError::PacketLost => write!(f, "Packet lost"),
            MockError::InvalidData => write!(f, "Invalid data"),
            MockError::NotFound => write!(f, "Not found"),
        }
    }
}

impl std::error::Error for MockError {}
