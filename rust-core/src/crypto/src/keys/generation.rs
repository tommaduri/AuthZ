use crate::error::Result;
use crate::kem::{MLKem768, MLKem768KeyPair};
use crate::signatures::{MLDSA87, MLDSA87KeyPair};

/// Agent identity containing both signature and KEM keypairs
#[derive(Debug)]
pub struct AgentIdentity {
    pub signing_keypair: MLDSA87KeyPair,
    pub kem_keypair: MLKem768KeyPair,
    pub agent_id: String,
}

impl AgentIdentity {
    /// Generate a new agent identity with both signing and KEM keypairs
    pub fn generate(agent_id: String) -> Result<Self> {
        let signing_keypair = MLDSA87::generate();
        let kem_keypair = MLKem768::generate();

        Ok(AgentIdentity {
            signing_keypair,
            kem_keypair,
            agent_id,
        })
    }

    /// Get agent ID
    pub fn id(&self) -> &str {
        &self.agent_id
    }

    /// Get public signing key bytes
    pub fn signing_public_key_bytes(&self) -> &[u8] {
        self.signing_keypair.public_key.as_bytes()
    }

    /// Get public KEM key bytes
    pub fn kem_public_key_bytes(&self) -> &[u8] {
        self.kem_keypair.public_key.as_bytes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_identity_generation() {
        let identity = AgentIdentity::generate("agent-001".to_string()).unwrap();
        assert_eq!(identity.id(), "agent-001");
        assert!(!identity.signing_public_key_bytes().is_empty());
        assert!(!identity.kem_public_key_bytes().is_empty());
    }
}
