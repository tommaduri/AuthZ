use crate::error::Result;
use crate::keys::generation::AgentIdentity;
use std::time::{SystemTime, Duration};

/// Key rotation policy
pub struct KeyRotationPolicy {
    pub rotation_interval: Duration,
    pub max_key_age: Duration,
}

impl Default for KeyRotationPolicy {
    fn default() -> Self {
        KeyRotationPolicy {
            rotation_interval: Duration::from_secs(90 * 24 * 60 * 60), // 90 days
            max_key_age: Duration::from_secs(365 * 24 * 60 * 60),      // 1 year
        }
    }
}

/// Key with metadata for rotation tracking
pub struct RotatableKey {
    pub identity: AgentIdentity,
    pub created_at: SystemTime,
    pub last_rotated: SystemTime,
    pub rotation_policy: KeyRotationPolicy,
}

impl RotatableKey {
    /// Create a new rotatable key
    pub fn new(agent_id: String, policy: KeyRotationPolicy) -> Result<Self> {
        let identity = AgentIdentity::generate(agent_id)?;
        let now = SystemTime::now();

        Ok(RotatableKey {
            identity,
            created_at: now,
            last_rotated: now,
            rotation_policy: policy,
        })
    }

    /// Check if key needs rotation
    pub fn needs_rotation(&self) -> bool {
        let now = SystemTime::now();
        if let Ok(age) = now.duration_since(self.last_rotated) {
            age >= self.rotation_policy.rotation_interval
        } else {
            false
        }
    }

    /// Check if key is expired
    pub fn is_expired(&self) -> bool {
        let now = SystemTime::now();
        if let Ok(age) = now.duration_since(self.created_at) {
            age >= self.rotation_policy.max_key_age
        } else {
            false
        }
    }

    /// Rotate the key (generate new identity)
    pub fn rotate(&mut self) -> Result<()> {
        self.identity = AgentIdentity::generate(self.identity.agent_id.clone())?;
        self.last_rotated = SystemTime::now();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_rotation() {
        let mut policy = KeyRotationPolicy::default();
        policy.rotation_interval = Duration::from_secs(0); // Immediate rotation for testing

        let mut key = RotatableKey::new("agent-001".to_string(), policy).unwrap();

        // Should need rotation immediately with 0 interval
        assert!(key.needs_rotation());

        key.rotate().unwrap();
    }
}
