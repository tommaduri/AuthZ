# Non-Human Identity (NHI) Best Practices

## Introduction

Non-Human Identities (NHI) represent autonomous AI agents, services, bots, and systems that require authentication, authorization, and audit trails—just like human users. As enterprises scale to millions of AI agents, managing NHI securely becomes critical.

This guide provides best practices for implementing NHI with **CretoAI AI** and **Creto AuthZ Engine**.

---

## What is NHI?

**Non-Human Identity (NHI)** refers to digital entities that:
- Operate autonomously without human intervention
- Have their own identity (keypairs, certificates)
- Require permissions to access resources
- Must be audited for compliance and security

**Examples**:
- AI agents (trading bots, customer service bots, analysis agents)
- Microservices (authentication service, payment processor)
- IoT devices (sensors, actuators, edge devices)
- CI/CD pipelines (build agents, deployment scripts)
- Scheduled jobs (cron tasks, data synchronization)

---

## NHI vs. Human Identity

| Characteristic | Human Identity | Non-Human Identity (NHI) |
|----------------|----------------|--------------------------|
| **Lifespan** | Years to decades | Minutes to years |
| **Scale** | Hundreds to thousands | Millions to billions |
| **Authentication** | Password, MFA, biometric | Keypair, certificate, API key |
| **Authorization** | Role-based (RBAC) | Policy-based (ABAC) + RBAC |
| **Key Rotation** | Manual (password reset) | Automated (scheduled rotation) |
| **Audit Requirements** | Moderate | High (regulatory compliance) |
| **Revocation** | Slow (days) | Instant (milliseconds) |

---

## Best Practices

### 1. Unique Identity Per Agent

**❌ BAD**: Shared credentials for all agents
```rust
// Multiple agents using the same API key
let api_key = "shared-secret-123";
agent_1.authenticate(api_key);
agent_2.authenticate(api_key);
agent_3.authenticate(api_key);
// Problem: Cannot trace actions to individual agents
```

**✅ GOOD**: Unique quantum-resistant keypair per agent
```rust
use vigilia_crypto::MLDSA87;

// Each agent gets unique identity
let agent_1_keypair = MLDSA87::generate();
let agent_2_keypair = MLDSA87::generate();
let agent_3_keypair = MLDSA87::generate();

vigilia_identity_store.register("agent-1", agent_1_keypair.public_key());
vigilia_identity_store.register("agent-2", agent_2_keypair.public_key());
vigilia_identity_store.register("agent-3", agent_3_keypair.public_key());

// Benefit: Audit trail shows exactly which agent performed each action
```

---

### 2. Least Privilege Authorization

**❌ BAD**: Admin permissions for all agents
```rust
authz_client.register_agent(
    agent_id: "trading-bot",
    policies: vec!["admin:*"],  // Too broad!
);
```

**✅ GOOD**: Minimal permissions required for the agent's function
```rust
authz_client.register_agent(
    agent_id: "trading-bot",
    policies: vec![
        "read:market-data",              // Can read market prices
        "write:trade-orders",             // Can place trades
        "read:portfolio:self",            // Can only read own portfolio
    ],
    attributes: HashMap::from([
        ("trading-limit", "1000000"),     // Max $1M per trade
        ("allowed-symbols", "AAPL,GOOGL"), // Limited to specific stocks
    ]),
);
```

---

### 3. Automated Key Rotation

**❌ BAD**: Static keys that never rotate
```rust
// Key generated once, used forever
let keypair = MLDSA87::generate();
// Risk: If compromised, unlimited time window for attacker
```

**✅ GOOD**: Scheduled key rotation (90-day default)
```rust
use tokio::time::{interval, Duration};

async fn rotate_agent_keys(agent_id: &str) {
    let mut rotation_interval = interval(Duration::from_secs(90 * 24 * 3600)); // 90 days

    loop {
        rotation_interval.tick().await;

        // Generate new keypair
        let new_keypair = MLDSA87::generate();

        // Update identity store
        vigilia_identity_store.rotate_key(
            agent_id,
            new_keypair.public_key(),
        ).await.expect("Key rotation failed");

        // Update AuthZ engine
        authz_client.update_agent_key(
            agent_id,
            new_keypair.public_key(),
        ).await.expect("AuthZ update failed");

        // Log rotation event
        log::info!("Rotated keypair for agent: {}", agent_id);
    }
}
```

---

### 4. Immutable Audit Trails

**❌ BAD**: Mutable database logs that can be altered
```sql
-- Logs in standard SQL database
INSERT INTO audit_log (agent_id, action, timestamp) VALUES ('agent-1', 'read:data', NOW());

-- Problem: Can be modified or deleted
DELETE FROM audit_log WHERE agent_id = 'agent-1';
```

**✅ GOOD**: Immutable DAG consensus for tamper-proof logs
```rust
// Every action recorded in CretoAI's DAG
vigilia_dag.record_event(AuthorizationEvent {
    agent: "agent-1",
    resource: "database/customer-records",
    action: "read",
    decision: "allow",
    policy_version: "v1.2.3",
    timestamp: SystemTime::now(),
    signature: agent_signature,  // Quantum-resistant proof
}).await?;

// Benefit: Cannot be deleted or modified retroactively
// Consensus ensures Byzantine fault tolerance
```

---

### 5. Agent Lifecycle Management

**❌ BAD**: Agents that persist indefinitely
```rust
// Create agent, no deactivation plan
let agent = create_agent("temp-bot").await;
// Runs forever, even after task is complete
```

**✅ GOOD**: Explicit lifecycle with termination
```rust
async fn execute_temporary_task(task: Task) {
    // 1. CREATE
    let agent_id = format!("temp-{}", uuid::Uuid::new_v4());
    let keypair = MLDSA87::generate();

    vigilia_identity_store.register(&agent_id, keypair.public_key()).await?;
    authz_client.register_agent(&agent_id, /* limited policies */).await?;

    // 2. EXECUTE
    agent.run(task).await?;

    // 3. TERMINATE (cleanup)
    authz_client.deactivate_agent(&agent_id, "task-completed").await?;
    vigilia_identity_store.revoke(&agent_id, "task-completed").await?;

    log::info!("Temporary agent {} terminated successfully", agent_id);
}
```

**Lifecycle States**:
```
[CREATION] → [ACTIVE] → [SUSPENDED] → [ACTIVE]
                ↓
          [TERMINATED] (final, cannot be reactivated)
```

---

### 6. Rate Limiting & Anomaly Detection

**❌ BAD**: No limits on agent behavior
```rust
// Agent can make unlimited requests
loop {
    agent.make_request().await;  // Potential DoS or abuse
}
```

**✅ GOOD**: Rate limiting and anomaly detection
```rust
use authz_policy::RateLimiter;

// Configure rate limits
authz_client.register_agent(
    agent_id: "api-scraper",
    policies: vec!["read:external-api"],
    rate_limits: RateLimits {
        requests_per_minute: 60,
        requests_per_hour: 1000,
        burst_size: 10,
    },
).await?;

// Anomaly detection (via CretoAI DAG analytics)
vigilia_analytics.detect_anomalies(
    agent_id: "api-scraper",
    baseline: AnomalyBaseline {
        typical_requests_per_hour: 500,
        stddev: 100,
    },
    alert_threshold: 3.0,  // Alert if > 3 standard deviations
).await?;
```

---

### 7. Segregation of Duties

**❌ BAD**: Single agent with multiple sensitive capabilities
```rust
authz_client.register_agent(
    agent_id: "finance-bot",
    policies: vec![
        "write:payments",        // Can initiate payments
        "approve:payments",      // Can approve payments
    ],
);
// Problem: No separation between initiator and approver
```

**✅ GOOD**: Separate agents for separate duties
```rust
// Agent 1: Payment initiator
authz_client.register_agent(
    agent_id: "payment-initiator",
    policies: vec!["write:payments"],  // Can create, not approve
).await?;

// Agent 2: Payment approver
authz_client.register_agent(
    agent_id: "payment-approver",
    policies: vec!["approve:payments"],  // Can approve, not create
).await?;

// Agent 3: Payment executor (only after approval)
authz_client.register_agent(
    agent_id: "payment-executor",
    policies: vec!["execute:approved-payments"],
).await?;
```

**Workflow**:
```
[payment-initiator] → Creates payment request
         ↓
[payment-approver] → Reviews and approves
         ↓
[payment-executor] → Executes approved payment
```

---

### 8. Quantum-Resistant Cryptography from Day One

**❌ BAD**: Classical cryptography (RSA, ECDSA)
```rust
// Using RSA-2048 (vulnerable to quantum computers)
let keypair = rsa::RsaPrivateKey::new(&mut rng, 2048)?;
// Risk: Will be broken by quantum computers in 10-15 years
```

**✅ GOOD**: NIST-approved post-quantum cryptography
```rust
use vigilia_crypto::{MLDSA87, MLKem768, BLAKE3};

// Quantum-resistant from the start
let signature_keypair = MLDSA87::generate();    // Digital signatures
let kem_keypair = MLKem768::generate();         // Key encapsulation
let hash = BLAKE3::hash(&message);               // Hashing

// Benefit: No need for costly migration when quantum computers arrive
```

---

### 9. Mutual TLS with PQC Certificates

**❌ BAD**: One-way TLS (only server authenticated)
```rust
// Agent connects to server without proving its identity
let client = HttpsClient::builder()
    .danger_accept_invalid_certs(true)  // Very bad!
    .build()?;
```

**✅ GOOD**: Mutual TLS with quantum-resistant certificates
```rust
use vigilia_network::PQCTls;

// Both agent and server authenticate each other
let mtls_config = PQCTls::builder()
    .client_cert(agent_pqc_cert)       // Agent's ML-DSA certificate
    .client_key(agent_keypair)
    .server_ca(server_pqc_ca)          // Server's CA (also PQC)
    .verify_server_cert(true)          // Validate server identity
    .build()?;

let client = HttpsClient::builder()
    .use_pqc_tls(mtls_config)
    .build()?;

// Benefit: Strong mutual authentication, quantum-resistant
```

---

### 10. Monitoring & Alerting

**❌ BAD**: No visibility into agent behavior
```rust
// Agent runs silently
agent.execute_task().await;
// No monitoring, no alerts if something goes wrong
```

**✅ GOOD**: Comprehensive monitoring and alerting
```rust
use vigilia_analytics::AgentMonitor;

// Real-time monitoring
let monitor = AgentMonitor::new(agent_id);

monitor.alert_on(AlertCondition::FailedAuthAttempts { threshold: 5 });
monitor.alert_on(AlertCondition::UnauthorizedAccessAttempt);
monitor.alert_on(AlertCondition::AnomalousTrafficPattern);
monitor.alert_on(AlertCondition::KeyRotationFailure);

// Dashboard metrics
monitor.track_metrics(vec![
    Metric::RequestsPerSecond,
    Metric::AuthorizationLatency,
    Metric::SuccessRate,
    Metric::ErrorRate,
]);

// Send alerts to ops team
monitor.notify_on_alert(NotificationChannel::Slack("#security-alerts"));
monitor.notify_on_alert(NotificationChannel::PagerDuty);
```

---

## Compliance Checklists

### SOC 2 Type II

- [ ] Unique identity per agent (user provisioning)
- [ ] Least privilege authorization (access control)
- [ ] Immutable audit trails (logging & monitoring)
- [ ] Automated key rotation (change management)
- [ ] Agent lifecycle management (termination procedures)
- [ ] Rate limiting (availability controls)
- [ ] Monitoring & alerting (incident response)

### FedRAMP Moderate/High

- [ ] Quantum-resistant cryptography (SC-12, SC-13)
- [ ] Multi-factor authentication for agents (IA-2)
- [ ] Audit logging with tamper-proof storage (AU-2, AU-9)
- [ ] Access control enforcement (AC-3)
- [ ] Identification and authentication (IA-3)
- [ ] Incident response procedures (IR-4, IR-5)

### CMMC 2.0 Level 2/3

- [ ] User identification and authentication (IA.L2-3.5.1)
- [ ] Device identification and authentication (IA.L2-3.5.2)
- [ ] Multifactor authentication (IA.L2-3.5.3)
- [ ] Audit record generation (AU.L2-3.3.1)
- [ ] Audit record protection (AU.L2-3.3.9)
- [ ] Access enforcement (AC.L2-3.1.3)

---

## Common Anti-Patterns

### 1. Hardcoded Secrets

```rust
// ❌ NEVER DO THIS
let api_key = "sk-prod-1234567890abcdef";  // Committed to Git
agent.authenticate(api_key);
```

**Fix**: Use environment variables or CretoAI Vault
```rust
// ✅ Load from secure vault
let api_key = vigilia_vault.get_secret("agent-001/api-key").await?;
agent.authenticate(&api_key);
```

---

### 2. Overly Broad Permissions

```rust
// ❌ "Just give the agent admin access"
authz_client.register_agent(agent_id, policies: vec!["*:*:*"]);
```

**Fix**: Grant minimal permissions
```rust
// ✅ Only what's needed
authz_client.register_agent(agent_id, policies: vec![
    "read:data:own-department",
    "write:reports:own-department",
]);
```

---

### 3. No Revocation Plan

```rust
// ❌ Agent runs forever
let agent = create_agent("bot-1").await;
// Never terminated, even if compromised
```

**Fix**: Implement instant revocation
```rust
// ✅ Can revoke immediately
authz_client.deactivate_agent("bot-1", "suspected-compromise").await?;
vigilia_identity_store.revoke("bot-1", "suspected-compromise").await?;
```

---

## Tools & Resources

### CretoAI AI CLI

```bash
# Generate agent keypair
cretoai-cli agent create \
  --agent-id "trading-bot-001" \
  --type financial-agent \
  --policies read:market-data,write:trade-orders

# Rotate agent key
cretoai-cli agent rotate-key --agent-id trading-bot-001

# Revoke agent
cretoai-cli agent revoke --agent-id trading-bot-001 --reason "compromised"

# Query audit trail
cretoai-cli audit query \
  --agent-id trading-bot-001 \
  --time-range "last-24h" \
  --decision deny
```

### Creto AuthZ Policy DSL

```yaml
# Define authorization policies
policies:
  - id: trading-bot-policy
    version: "1.0.0"
    agents:
      - "trading-bot-*"  # Wildcard for all trading bots
    rules:
      - resource: "market-data"
        action: "read"
        effect: allow

      - resource: "trade-orders"
        action: "write"
        effect: allow
        conditions:
          - attribute: trading-limit
            operator: "<="
            value: 1000000

      - resource: "admin/*"
        action: "*"
        effect: deny  # Explicitly deny admin access
```

---

## Getting Help

**Documentation**:
- [CretoAI AI Architecture](../architecture/01-system-overview.md)
- [Creto AuthZ Integration](../architecture/authz-integration.md)

**Community**:
- GitHub Discussions: https://github.com/Creto-Systems/vigilia/discussions
- Slack: #cretoai-ai (coming soon)

**Support**:
- Email: [support@vigilia.ai](mailto:support@vigilia.ai)
- Enterprise SLA: [enterprise@vigilia.ai](mailto:enterprise@vigilia.ai)

---

**Last Updated**: November 25, 2025
**Version**: 1.0.0
