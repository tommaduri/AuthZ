//! Payment Channels for High-Frequency Resource Trading
//!
//! Implements off-chain payment channels for:
//! - Instant micropayments
//! - Low transaction fees
//! - High throughput
//! - Cryptographic settlement

use crate::error::{ExchangeError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// Payment channel state
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChannelState {
    /// Channel opened and funded
    Open,
    /// Channel actively processing payments
    Active,
    /// Channel settlement initiated
    Settling,
    /// Channel closed and settled
    Closed,
    /// Channel disputed
    Disputed { reason: String },
}

/// Payment channel
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentChannel {
    /// Channel ID
    pub id: String,
    /// Sender agent ID
    pub sender_id: String,
    /// Receiver agent ID
    pub receiver_id: String,
    /// Channel state
    pub state: ChannelState,
    /// Total capacity (initial deposit)
    pub capacity: u64,
    /// Current balance (remaining funds)
    pub balance: u64,
    /// Sequence number for payments
    pub sequence: u64,
    /// Total paid through channel
    pub total_paid: u64,
    /// Channel creation timestamp
    pub created_at: i64,
    /// Channel expiration timestamp
    pub expires_at: i64,
    /// Last payment timestamp
    pub last_payment_at: Option<i64>,
    /// Settlement hash (for verification)
    pub settlement_hash: Option<Vec<u8>>,
}

impl PaymentChannel {
    /// Create a new payment channel
    pub fn new(
        sender_id: String,
        receiver_id: String,
        capacity: u64,
        duration: i64,
    ) -> Self {
        let now = chrono::Utc::now().timestamp();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            sender_id,
            receiver_id,
            state: ChannelState::Open,
            capacity,
            balance: capacity,
            sequence: 0,
            total_paid: 0,
            created_at: now,
            expires_at: now + duration,
            last_payment_at: None,
            settlement_hash: None,
        }
    }

    /// Activate the channel
    pub fn activate(&mut self) -> Result<()> {
        if self.state != ChannelState::Open {
            return Err(ExchangeError::Payment(
                "Channel must be in open state".to_string(),
            ));
        }
        self.state = ChannelState::Active;
        Ok(())
    }

    /// Process a payment
    pub fn pay(&mut self, amount: u64) -> Result<u64> {
        if self.state != ChannelState::Active {
            return Err(ExchangeError::Payment(
                "Channel must be active".to_string(),
            ));
        }

        // Check expiration
        if chrono::Utc::now().timestamp() > self.expires_at {
            self.state = ChannelState::Settling;
            return Err(ExchangeError::Payment("Channel expired".to_string()));
        }

        if amount > self.balance {
            return Err(ExchangeError::Payment(
                format!("Insufficient balance: {} < {}", self.balance, amount),
            ));
        }

        self.balance -= amount;
        self.total_paid += amount;
        self.sequence += 1;
        self.last_payment_at = Some(chrono::Utc::now().timestamp());

        Ok(self.sequence)
    }

    /// Initiate settlement
    pub fn settle(&mut self, settlement_hash: Vec<u8>) -> Result<()> {
        if matches!(self.state, ChannelState::Closed) {
            return Err(ExchangeError::Payment(
                "Channel already closed".to_string(),
            ));
        }

        self.state = ChannelState::Settling;
        self.settlement_hash = Some(settlement_hash);
        Ok(())
    }

    /// Finalize settlement and close channel
    pub fn close(&mut self) -> Result<u64> {
        if !matches!(self.state, ChannelState::Settling | ChannelState::Active) {
            return Err(ExchangeError::Payment(
                "Channel must be settling or active".to_string(),
            ));
        }

        self.state = ChannelState::Closed;
        Ok(self.total_paid)
    }

    /// Dispute the channel
    pub fn dispute(&mut self, reason: String) -> Result<()> {
        if self.state == ChannelState::Closed {
            return Err(ExchangeError::Payment(
                "Cannot dispute closed channel".to_string(),
            ));
        }

        self.state = ChannelState::Disputed { reason };
        Ok(())
    }

    /// Check if channel is expired
    pub fn is_expired(&self) -> bool {
        chrono::Utc::now().timestamp() > self.expires_at
    }

    /// Get remaining capacity
    pub fn remaining_capacity(&self) -> u64 {
        self.balance
    }
}

/// Payment record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Payment {
    /// Payment ID
    pub id: String,
    /// Channel ID
    pub channel_id: String,
    /// Amount
    pub amount: u64,
    /// Sequence number
    pub sequence: u64,
    /// Timestamp
    pub timestamp: i64,
    /// Payment signature
    pub signature: Option<Vec<u8>>,
}

/// Payment channel manager
pub struct ChannelManager {
    channels: Arc<RwLock<HashMap<String, PaymentChannel>>>,
    agent_channels: Arc<RwLock<HashMap<String, Vec<String>>>>,
    payments: Arc<RwLock<HashMap<String, Vec<Payment>>>>,
}

impl ChannelManager {
    /// Create a new channel manager
    pub fn new() -> Self {
        Self {
            channels: Arc::new(RwLock::new(HashMap::new())),
            agent_channels: Arc::new(RwLock::new(HashMap::new())),
            payments: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Open a new payment channel
    pub fn open_channel(
        &self,
        sender_id: String,
        receiver_id: String,
        capacity: u64,
        duration: i64,
    ) -> Result<String> {
        let channel = PaymentChannel::new(sender_id.clone(), receiver_id.clone(), capacity, duration);
        let channel_id = channel.id.clone();

        // Store channel
        self.channels
            .write()
            .unwrap()
            .insert(channel_id.clone(), channel);

        // Index by agents
        let mut agent_channels = self.agent_channels.write().unwrap();
        agent_channels
            .entry(sender_id)
            .or_insert_with(Vec::new)
            .push(channel_id.clone());
        agent_channels
            .entry(receiver_id)
            .or_insert_with(Vec::new)
            .push(channel_id.clone());

        Ok(channel_id)
    }

    /// Get a channel by ID
    pub fn get_channel(&self, channel_id: &str) -> Result<PaymentChannel> {
        self.channels
            .read()
            .unwrap()
            .get(channel_id)
            .cloned()
            .ok_or_else(|| ExchangeError::Payment("Channel not found".to_string()))
    }

    /// Activate a channel
    pub fn activate_channel(&self, channel_id: &str) -> Result<()> {
        let mut channels = self.channels.write().unwrap();
        let channel = channels
            .get_mut(channel_id)
            .ok_or_else(|| ExchangeError::Payment("Channel not found".to_string()))?;

        channel.activate()?;
        Ok(())
    }

    /// Process a payment
    pub fn process_payment(&self, channel_id: &str, amount: u64) -> Result<String> {
        let mut channels = self.channels.write().unwrap();
        let channel = channels
            .get_mut(channel_id)
            .ok_or_else(|| ExchangeError::Payment("Channel not found".to_string()))?;

        let sequence = channel.pay(amount)?;

        // Record payment
        let payment = Payment {
            id: uuid::Uuid::new_v4().to_string(),
            channel_id: channel_id.to_string(),
            amount,
            sequence,
            timestamp: chrono::Utc::now().timestamp(),
            signature: None,
        };

        let payment_id = payment.id.clone();
        self.payments
            .write()
            .unwrap()
            .entry(channel_id.to_string())
            .or_insert_with(Vec::new)
            .push(payment);

        Ok(payment_id)
    }

    /// Settle a channel
    pub fn settle_channel(&self, channel_id: &str, settlement_hash: Vec<u8>) -> Result<()> {
        let mut channels = self.channels.write().unwrap();
        let channel = channels
            .get_mut(channel_id)
            .ok_or_else(|| ExchangeError::Payment("Channel not found".to_string()))?;

        channel.settle(settlement_hash)?;
        Ok(())
    }

    /// Close a channel
    pub fn close_channel(&self, channel_id: &str) -> Result<u64> {
        let mut channels = self.channels.write().unwrap();
        let channel = channels
            .get_mut(channel_id)
            .ok_or_else(|| ExchangeError::Payment("Channel not found".to_string()))?;

        channel.close()
    }

    /// Get all channels for an agent
    pub fn get_agent_channels(&self, agent_id: &str) -> Vec<PaymentChannel> {
        let agent_channels = self.agent_channels.read().unwrap();
        let channels = self.channels.read().unwrap();

        agent_channels
            .get(agent_id)
            .map(|channel_ids| {
                channel_ids
                    .iter()
                    .filter_map(|id| channels.get(id).cloned())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Get payment history for a channel
    pub fn get_payment_history(&self, channel_id: &str) -> Vec<Payment> {
        self.payments
            .read()
            .unwrap()
            .get(channel_id)
            .cloned()
            .unwrap_or_default()
    }

    /// Cleanup expired channels
    pub fn cleanup_expired(&self) -> usize {
        let mut channels = self.channels.write().unwrap();
        let expired: Vec<String> = channels
            .iter()
            .filter(|(_, c)| c.is_expired() && c.state != ChannelState::Closed)
            .map(|(id, _)| id.clone())
            .collect();

        for id in &expired {
            if let Some(channel) = channels.get_mut(id) {
                let _ = channel.settle(vec![]);
            }
        }

        expired.len()
    }

    /// Get channel statistics
    pub fn get_stats(&self) -> ChannelStats {
        let channels = self.channels.read().unwrap();

        let total = channels.len();
        let open = channels
            .values()
            .filter(|c| c.state == ChannelState::Open)
            .count();
        let active = channels
            .values()
            .filter(|c| c.state == ChannelState::Active)
            .count();
        let closed = channels
            .values()
            .filter(|c| c.state == ChannelState::Closed)
            .count();

        let total_capacity: u64 = channels.values().map(|c| c.capacity).sum();
        let total_paid: u64 = channels.values().map(|c| c.total_paid).sum();

        ChannelStats {
            total_channels: total,
            open_channels: open,
            active_channels: active,
            closed_channels: closed,
            total_capacity,
            total_paid,
        }
    }
}

impl Default for ChannelManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Channel statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelStats {
    pub total_channels: usize,
    pub open_channels: usize,
    pub active_channels: usize,
    pub closed_channels: usize,
    pub total_capacity: u64,
    pub total_paid: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_channel_creation() {
        let channel = PaymentChannel::new(
            "sender-001".to_string(),
            "receiver-001".to_string(),
            1000,
            3600,
        );

        assert_eq!(channel.sender_id, "sender-001");
        assert_eq!(channel.receiver_id, "receiver-001");
        assert_eq!(channel.capacity, 1000);
        assert_eq!(channel.balance, 1000);
        assert_eq!(channel.state, ChannelState::Open);
    }

    #[test]
    fn test_channel_activation() {
        let mut channel = PaymentChannel::new(
            "sender-001".to_string(),
            "receiver-001".to_string(),
            1000,
            3600,
        );

        channel.activate().unwrap();
        assert_eq!(channel.state, ChannelState::Active);
    }

    #[test]
    fn test_payment_processing() {
        let mut channel = PaymentChannel::new(
            "sender-001".to_string(),
            "receiver-001".to_string(),
            1000,
            3600,
        );

        channel.activate().unwrap();
        let seq1 = channel.pay(100).unwrap();
        assert_eq!(seq1, 1);
        assert_eq!(channel.balance, 900);
        assert_eq!(channel.total_paid, 100);

        let seq2 = channel.pay(200).unwrap();
        assert_eq!(seq2, 2);
        assert_eq!(channel.balance, 700);
        assert_eq!(channel.total_paid, 300);
    }

    #[test]
    fn test_insufficient_balance() {
        let mut channel = PaymentChannel::new(
            "sender-001".to_string(),
            "receiver-001".to_string(),
            100,
            3600,
        );

        channel.activate().unwrap();
        let result = channel.pay(200);
        assert!(result.is_err());
    }

    #[test]
    fn test_channel_settlement() {
        let mut channel = PaymentChannel::new(
            "sender-001".to_string(),
            "receiver-001".to_string(),
            1000,
            3600,
        );

        channel.activate().unwrap();
        channel.pay(100).unwrap();

        channel.settle(vec![1, 2, 3, 4]).unwrap();
        assert_eq!(channel.state, ChannelState::Settling);
        assert!(channel.settlement_hash.is_some());
    }

    #[test]
    fn test_channel_closure() {
        let mut channel = PaymentChannel::new(
            "sender-001".to_string(),
            "receiver-001".to_string(),
            1000,
            3600,
        );

        channel.activate().unwrap();
        channel.pay(100).unwrap();
        channel.settle(vec![]).unwrap();

        let total = channel.close().unwrap();
        assert_eq!(total, 100);
        assert_eq!(channel.state, ChannelState::Closed);
    }

    #[test]
    fn test_channel_dispute() {
        let mut channel = PaymentChannel::new(
            "sender-001".to_string(),
            "receiver-001".to_string(),
            1000,
            3600,
        );

        channel.activate().unwrap();
        channel.dispute("Fraudulent payment".to_string()).unwrap();

        assert!(matches!(channel.state, ChannelState::Disputed { .. }));
    }

    #[test]
    fn test_channel_manager() {
        let manager = ChannelManager::new();

        let channel_id = manager
            .open_channel("sender-001".to_string(), "receiver-001".to_string(), 1000, 3600)
            .unwrap();

        let channel = manager.get_channel(&channel_id).unwrap();
        assert_eq!(channel.capacity, 1000);
    }

    #[test]
    fn test_process_payment_through_manager() {
        let manager = ChannelManager::new();

        let channel_id = manager
            .open_channel("sender-001".to_string(), "receiver-001".to_string(), 1000, 3600)
            .unwrap();

        manager.activate_channel(&channel_id).unwrap();
        manager.process_payment(&channel_id, 100).unwrap();

        let channel = manager.get_channel(&channel_id).unwrap();
        assert_eq!(channel.balance, 900);

        let history = manager.get_payment_history(&channel_id);
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].amount, 100);
    }

    #[test]
    fn test_get_agent_channels() {
        let manager = ChannelManager::new();

        manager
            .open_channel("sender-001".to_string(), "receiver-001".to_string(), 1000, 3600)
            .unwrap();
        manager
            .open_channel("sender-001".to_string(), "receiver-002".to_string(), 2000, 3600)
            .unwrap();

        let channels = manager.get_agent_channels("sender-001");
        assert_eq!(channels.len(), 2);
    }

    #[test]
    fn test_channel_stats() {
        let manager = ChannelManager::new();

        let ch1 = manager
            .open_channel("sender-001".to_string(), "receiver-001".to_string(), 1000, 3600)
            .unwrap();
        let ch2 = manager
            .open_channel("sender-002".to_string(), "receiver-002".to_string(), 2000, 3600)
            .unwrap();

        manager.activate_channel(&ch1).unwrap();
        manager.process_payment(&ch1, 100).unwrap();

        let stats = manager.get_stats();
        assert_eq!(stats.total_channels, 2);
        assert_eq!(stats.open_channels, 1);
        assert_eq!(stats.active_channels, 1);
        assert_eq!(stats.total_capacity, 3000);
        assert_eq!(stats.total_paid, 100);
    }
}
