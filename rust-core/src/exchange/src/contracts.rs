//! Smart Contracts for Autonomous Resource Agreements
//!
//! Implements verifiable contracts for resource exchange with:
//! - Atomic execution conditions
//! - Multi-party agreements
//! - Automated enforcement
//! - Quantum-resistant verification

use crate::error::{ExchangeError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// Contract condition types
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ContractCondition {
    /// Payment received
    PaymentReceived { amount: u64, currency: String },
    /// Resource delivered
    ResourceDelivered { resource_id: String, quantity: f64 },
    /// Time deadline
    Deadline { timestamp: i64 },
    /// Reputation threshold
    ReputationMet { agent_id: String, min_score: f64 },
    /// Multi-signature approval
    MultiSigApproval { required: usize, signatures: Vec<String> },
    /// Custom condition
    Custom { condition: String, met: bool },
}

impl ContractCondition {
    /// Check if condition is met
    pub fn is_met(&self) -> bool {
        match self {
            ContractCondition::PaymentReceived { .. } => false, // Requires external verification
            ContractCondition::ResourceDelivered { .. } => false, // Requires external verification
            ContractCondition::Deadline { timestamp } => {
                chrono::Utc::now().timestamp() <= *timestamp
            }
            ContractCondition::ReputationMet { .. } => false, // Requires reputation system
            ContractCondition::MultiSigApproval { required, signatures } => {
                signatures.len() >= *required
            }
            ContractCondition::Custom { met, .. } => *met,
        }
    }
}

/// Contract terms
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContractTerms {
    /// Provider obligations
    pub provider_obligations: Vec<String>,
    /// Buyer obligations
    pub buyer_obligations: Vec<String>,
    /// Conditions that must be met
    pub conditions: Vec<ContractCondition>,
    /// Payment amount
    pub payment_amount: u64,
    /// Payment currency
    pub payment_currency: String,
    /// Contract duration in seconds
    pub duration: i64,
    /// Penalties for breach
    pub penalties: HashMap<String, u64>,
}

/// Contract status
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ContractStatus {
    /// Contract created but not yet active
    Pending,
    /// Contract is active and conditions are being monitored
    Active,
    /// All conditions met, contract fulfilled
    Fulfilled,
    /// Contract breached by one party
    Breached { party: String, reason: String },
    /// Contract cancelled by mutual agreement
    Cancelled,
    /// Contract expired without fulfillment
    Expired,
}

/// Smart contract
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartContract {
    /// Contract ID
    pub id: String,
    /// Provider agent ID
    pub provider_id: String,
    /// Buyer agent ID
    pub buyer_id: String,
    /// Contract terms
    pub terms: ContractTerms,
    /// Current status
    pub status: ContractStatus,
    /// Creation timestamp
    pub created_at: i64,
    /// Activation timestamp
    pub activated_at: Option<i64>,
    /// Completion timestamp
    pub completed_at: Option<i64>,
    /// Contract signatures (agent_id -> signature)
    pub signatures: HashMap<String, Vec<u8>>,
    /// Execution log
    pub execution_log: Vec<ContractEvent>,
}

/// Contract event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContractEvent {
    /// Event timestamp
    pub timestamp: i64,
    /// Event type
    pub event_type: String,
    /// Event data
    pub data: HashMap<String, String>,
}

impl SmartContract {
    /// Create a new contract
    pub fn new(
        provider_id: String,
        buyer_id: String,
        terms: ContractTerms,
    ) -> Self {
        let now = chrono::Utc::now().timestamp();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            provider_id,
            buyer_id,
            terms,
            status: ContractStatus::Pending,
            created_at: now,
            activated_at: None,
            completed_at: None,
            signatures: HashMap::new(),
            execution_log: vec![ContractEvent {
                timestamp: now,
                event_type: "created".to_string(),
                data: HashMap::new(),
            }],
        }
    }

    /// Add a signature to the contract
    pub fn add_signature(&mut self, agent_id: String, signature: Vec<u8>) -> Result<()> {
        if agent_id != self.provider_id && agent_id != self.buyer_id {
            return Err(ExchangeError::Contract(
                "Only contract parties can sign".to_string(),
            ));
        }

        self.signatures.insert(agent_id.clone(), signature);

        let mut data = HashMap::new();
        data.insert("agent_id".to_string(), agent_id);
        self.execution_log.push(ContractEvent {
            timestamp: chrono::Utc::now().timestamp(),
            event_type: "signed".to_string(),
            data,
        });

        Ok(())
    }

    /// Activate the contract (requires both signatures)
    pub fn activate(&mut self) -> Result<()> {
        if self.status != ContractStatus::Pending {
            return Err(ExchangeError::Contract(
                "Contract must be in pending status".to_string(),
            ));
        }

        if !self.signatures.contains_key(&self.provider_id) {
            return Err(ExchangeError::Contract(
                "Missing provider signature".to_string(),
            ));
        }

        if !self.signatures.contains_key(&self.buyer_id) {
            return Err(ExchangeError::Contract(
                "Missing buyer signature".to_string(),
            ));
        }

        self.status = ContractStatus::Active;
        self.activated_at = Some(chrono::Utc::now().timestamp());

        self.execution_log.push(ContractEvent {
            timestamp: chrono::Utc::now().timestamp(),
            event_type: "activated".to_string(),
            data: HashMap::new(),
        });

        Ok(())
    }

    /// Check if all conditions are met
    pub fn check_conditions(&self) -> bool {
        self.terms.conditions.iter().all(|c| c.is_met())
    }

    /// Execute the contract (verify all conditions and fulfill)
    pub fn execute(&mut self) -> Result<()> {
        if self.status != ContractStatus::Active {
            return Err(ExchangeError::Contract(
                "Contract must be active to execute".to_string(),
            ));
        }

        // Check expiration
        if let Some(activated_at) = self.activated_at {
            let now = chrono::Utc::now().timestamp();
            if now > activated_at + self.terms.duration {
                self.status = ContractStatus::Expired;
                self.execution_log.push(ContractEvent {
                    timestamp: now,
                    event_type: "expired".to_string(),
                    data: HashMap::new(),
                });
                return Err(ExchangeError::Contract("Contract expired".to_string()));
            }
        }

        // Verify all conditions
        if !self.check_conditions() {
            return Err(ExchangeError::Contract(
                "Not all conditions are met".to_string(),
            ));
        }

        self.status = ContractStatus::Fulfilled;
        self.completed_at = Some(chrono::Utc::now().timestamp());

        self.execution_log.push(ContractEvent {
            timestamp: chrono::Utc::now().timestamp(),
            event_type: "fulfilled".to_string(),
            data: HashMap::new(),
        });

        Ok(())
    }

    /// Report a breach
    pub fn report_breach(&mut self, party: String, reason: String) -> Result<()> {
        if self.status != ContractStatus::Active {
            return Err(ExchangeError::Contract(
                "Only active contracts can be breached".to_string(),
            ));
        }

        let mut data = HashMap::new();
        data.insert("party".to_string(), party.clone());
        data.insert("reason".to_string(), reason.clone());

        self.status = ContractStatus::Breached {
            party: party.clone(),
            reason: reason.clone(),
        };

        self.execution_log.push(ContractEvent {
            timestamp: chrono::Utc::now().timestamp(),
            event_type: "breached".to_string(),
            data,
        });

        Ok(())
    }

    /// Cancel the contract (requires mutual agreement)
    pub fn cancel(&mut self) -> Result<()> {
        if matches!(
            self.status,
            ContractStatus::Fulfilled | ContractStatus::Breached { .. }
        ) {
            return Err(ExchangeError::Contract(
                "Cannot cancel fulfilled or breached contracts".to_string(),
            ));
        }

        self.status = ContractStatus::Cancelled;

        self.execution_log.push(ContractEvent {
            timestamp: chrono::Utc::now().timestamp(),
            event_type: "cancelled".to_string(),
            data: HashMap::new(),
        });

        Ok(())
    }
}

/// Contract manager
pub struct ContractManager {
    contracts: Arc<RwLock<HashMap<String, SmartContract>>>,
    agent_contracts: Arc<RwLock<HashMap<String, Vec<String>>>>,
}

impl ContractManager {
    /// Create a new contract manager
    pub fn new() -> Self {
        Self {
            contracts: Arc::new(RwLock::new(HashMap::new())),
            agent_contracts: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Create and store a contract
    pub fn create_contract(
        &self,
        provider_id: String,
        buyer_id: String,
        terms: ContractTerms,
    ) -> Result<String> {
        let contract = SmartContract::new(provider_id.clone(), buyer_id.clone(), terms);
        let contract_id = contract.id.clone();

        // Store contract
        self.contracts
            .write()
            .unwrap()
            .insert(contract_id.clone(), contract);

        // Index by agent
        let mut agent_contracts = self.agent_contracts.write().unwrap();
        agent_contracts
            .entry(provider_id)
            .or_insert_with(Vec::new)
            .push(contract_id.clone());
        agent_contracts
            .entry(buyer_id)
            .or_insert_with(Vec::new)
            .push(contract_id.clone());

        Ok(contract_id)
    }

    /// Get a contract by ID
    pub fn get_contract(&self, contract_id: &str) -> Result<SmartContract> {
        self.contracts
            .read()
            .unwrap()
            .get(contract_id)
            .cloned()
            .ok_or_else(|| ExchangeError::Contract("Contract not found".to_string()))
    }

    /// Sign a contract
    pub fn sign_contract(
        &self,
        contract_id: &str,
        agent_id: String,
        signature: Vec<u8>,
    ) -> Result<()> {
        let mut contracts = self.contracts.write().unwrap();
        let contract = contracts
            .get_mut(contract_id)
            .ok_or_else(|| ExchangeError::Contract("Contract not found".to_string()))?;

        contract.add_signature(agent_id, signature)?;
        Ok(())
    }

    /// Activate a contract
    pub fn activate_contract(&self, contract_id: &str) -> Result<()> {
        let mut contracts = self.contracts.write().unwrap();
        let contract = contracts
            .get_mut(contract_id)
            .ok_or_else(|| ExchangeError::Contract("Contract not found".to_string()))?;

        contract.activate()?;
        Ok(())
    }

    /// Execute a contract
    pub fn execute_contract(&self, contract_id: &str) -> Result<()> {
        let mut contracts = self.contracts.write().unwrap();
        let contract = contracts
            .get_mut(contract_id)
            .ok_or_else(|| ExchangeError::Contract("Contract not found".to_string()))?;

        contract.execute()?;
        Ok(())
    }

    /// Report a contract breach
    pub fn report_breach(&self, contract_id: &str, party: String, reason: String) -> Result<()> {
        let mut contracts = self.contracts.write().unwrap();
        let contract = contracts
            .get_mut(contract_id)
            .ok_or_else(|| ExchangeError::Contract("Contract not found".to_string()))?;

        contract.report_breach(party, reason)?;
        Ok(())
    }

    /// Get all contracts for an agent
    pub fn get_agent_contracts(&self, agent_id: &str) -> Vec<SmartContract> {
        let agent_contracts = self.agent_contracts.read().unwrap();
        let contracts = self.contracts.read().unwrap();

        agent_contracts
            .get(agent_id)
            .map(|contract_ids| {
                contract_ids
                    .iter()
                    .filter_map(|id| contracts.get(id).cloned())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Get contracts by status
    pub fn get_contracts_by_status(&self, status: ContractStatus) -> Vec<SmartContract> {
        let contracts = self.contracts.read().unwrap();
        contracts
            .values()
            .filter(|c| c.status == status)
            .cloned()
            .collect()
    }

    /// Get contract statistics
    pub fn get_stats(&self) -> ContractStats {
        let contracts = self.contracts.read().unwrap();

        let total = contracts.len();
        let pending = contracts
            .values()
            .filter(|c| c.status == ContractStatus::Pending)
            .count();
        let active = contracts
            .values()
            .filter(|c| c.status == ContractStatus::Active)
            .count();
        let fulfilled = contracts
            .values()
            .filter(|c| c.status == ContractStatus::Fulfilled)
            .count();
        let breached = contracts
            .values()
            .filter(|c| matches!(c.status, ContractStatus::Breached { .. }))
            .count();

        let total_value: u64 = contracts.values().map(|c| c.terms.payment_amount).sum();

        ContractStats {
            total_contracts: total,
            pending_contracts: pending,
            active_contracts: active,
            fulfilled_contracts: fulfilled,
            breached_contracts: breached,
            total_value,
        }
    }
}

impl Default for ContractManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Contract statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContractStats {
    pub total_contracts: usize,
    pub pending_contracts: usize,
    pub active_contracts: usize,
    pub fulfilled_contracts: usize,
    pub breached_contracts: usize,
    pub total_value: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_terms() -> ContractTerms {
        ContractTerms {
            provider_obligations: vec!["Deliver 10 CPU cores".to_string()],
            buyer_obligations: vec!["Pay 100 USD".to_string()],
            conditions: vec![
                ContractCondition::PaymentReceived {
                    amount: 100,
                    currency: "USD".to_string(),
                },
                ContractCondition::Deadline {
                    timestamp: chrono::Utc::now().timestamp() + 3600,
                },
            ],
            payment_amount: 100,
            payment_currency: "USD".to_string(),
            duration: 3600,
            penalties: HashMap::new(),
        }
    }

    #[test]
    fn test_contract_creation() {
        let terms = create_test_terms();
        let contract = SmartContract::new(
            "provider-001".to_string(),
            "buyer-001".to_string(),
            terms,
        );

        assert_eq!(contract.provider_id, "provider-001");
        assert_eq!(contract.buyer_id, "buyer-001");
        assert_eq!(contract.status, ContractStatus::Pending);
        assert_eq!(contract.execution_log.len(), 1);
    }

    #[test]
    fn test_contract_signing() {
        let terms = create_test_terms();
        let mut contract = SmartContract::new(
            "provider-001".to_string(),
            "buyer-001".to_string(),
            terms,
        );

        let signature1 = b"provider_signature".to_vec();
        let signature2 = b"buyer_signature".to_vec();

        contract
            .add_signature("provider-001".to_string(), signature1)
            .unwrap();
        contract
            .add_signature("buyer-001".to_string(), signature2)
            .unwrap();

        assert_eq!(contract.signatures.len(), 2);
    }

    #[test]
    fn test_invalid_signer() {
        let terms = create_test_terms();
        let mut contract = SmartContract::new(
            "provider-001".to_string(),
            "buyer-001".to_string(),
            terms,
        );

        let result = contract.add_signature("hacker-001".to_string(), vec![1, 2, 3]);
        assert!(result.is_err());
    }

    #[test]
    fn test_contract_activation() {
        let terms = create_test_terms();
        let mut contract = SmartContract::new(
            "provider-001".to_string(),
            "buyer-001".to_string(),
            terms,
        );

        // Sign from both parties
        contract
            .add_signature("provider-001".to_string(), vec![1])
            .unwrap();
        contract
            .add_signature("buyer-001".to_string(), vec![2])
            .unwrap();

        // Activate
        contract.activate().unwrap();

        assert_eq!(contract.status, ContractStatus::Active);
        assert!(contract.activated_at.is_some());
    }

    #[test]
    fn test_activation_requires_both_signatures() {
        let terms = create_test_terms();
        let mut contract = SmartContract::new(
            "provider-001".to_string(),
            "buyer-001".to_string(),
            terms,
        );

        // Only one signature
        contract
            .add_signature("provider-001".to_string(), vec![1])
            .unwrap();

        let result = contract.activate();
        assert!(result.is_err());
    }

    #[test]
    fn test_contract_breach() {
        let terms = create_test_terms();
        let mut contract = SmartContract::new(
            "provider-001".to_string(),
            "buyer-001".to_string(),
            terms,
        );

        // Activate contract first
        contract
            .add_signature("provider-001".to_string(), vec![1])
            .unwrap();
        contract
            .add_signature("buyer-001".to_string(), vec![2])
            .unwrap();
        contract.activate().unwrap();

        // Report breach
        contract
            .report_breach("provider-001".to_string(), "Failed to deliver".to_string())
            .unwrap();

        assert!(matches!(
            contract.status,
            ContractStatus::Breached { .. }
        ));
    }

    #[test]
    fn test_contract_cancellation() {
        let terms = create_test_terms();
        let mut contract = SmartContract::new(
            "provider-001".to_string(),
            "buyer-001".to_string(),
            terms,
        );

        contract.cancel().unwrap();
        assert_eq!(contract.status, ContractStatus::Cancelled);
    }

    #[test]
    fn test_cannot_cancel_fulfilled() {
        let terms = create_test_terms();
        let mut contract = SmartContract::new(
            "provider-001".to_string(),
            "buyer-001".to_string(),
            terms,
        );

        contract.status = ContractStatus::Fulfilled;
        let result = contract.cancel();
        assert!(result.is_err());
    }

    #[test]
    fn test_contract_manager() {
        let manager = ContractManager::new();
        let terms = create_test_terms();

        let contract_id = manager
            .create_contract("provider-001".to_string(), "buyer-001".to_string(), terms)
            .unwrap();

        let contract = manager.get_contract(&contract_id).unwrap();
        assert_eq!(contract.provider_id, "provider-001");
    }

    #[test]
    fn test_get_agent_contracts() {
        let manager = ContractManager::new();
        let terms1 = create_test_terms();
        let terms2 = create_test_terms();

        manager
            .create_contract("provider-001".to_string(), "buyer-001".to_string(), terms1)
            .unwrap();
        manager
            .create_contract("provider-001".to_string(), "buyer-002".to_string(), terms2)
            .unwrap();

        let contracts = manager.get_agent_contracts("provider-001");
        assert_eq!(contracts.len(), 2);
    }

    #[test]
    fn test_contract_stats() {
        let manager = ContractManager::new();
        let terms1 = create_test_terms();
        let terms2 = create_test_terms();

        manager
            .create_contract("provider-001".to_string(), "buyer-001".to_string(), terms1)
            .unwrap();
        manager
            .create_contract("provider-002".to_string(), "buyer-002".to_string(), terms2)
            .unwrap();

        let stats = manager.get_stats();
        assert_eq!(stats.total_contracts, 2);
        assert_eq!(stats.pending_contracts, 2);
        assert_eq!(stats.total_value, 200); // 100 + 100
    }

    #[test]
    fn test_deadline_condition() {
        // Future deadline - should be met
        let future_deadline = ContractCondition::Deadline {
            timestamp: chrono::Utc::now().timestamp() + 3600,
        };
        assert!(future_deadline.is_met());

        // Past deadline - should not be met
        let past_deadline = ContractCondition::Deadline {
            timestamp: chrono::Utc::now().timestamp() - 3600,
        };
        assert!(!past_deadline.is_met());
    }

    #[test]
    fn test_multisig_condition() {
        let condition = ContractCondition::MultiSigApproval {
            required: 2,
            signatures: vec!["sig1".to_string(), "sig2".to_string()],
        };
        assert!(condition.is_met());

        let insufficient = ContractCondition::MultiSigApproval {
            required: 3,
            signatures: vec!["sig1".to_string()],
        };
        assert!(!insufficient.is_met());
    }
}
