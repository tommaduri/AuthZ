# Creto AuthZ Engine Integration Architecture

## Overview

CretoAI AI provides the **quantum-resistant cryptographic foundation** for Creto's next-generation authorization engine. This document describes how the two systems integrate to enable enterprise-scale deployment of autonomous AI agents with Non-Human Identity (NHI) management.

---

## Architecture Stack

```
┌─────────────────────────────────────────────────────────────────┐
│                    Enterprise Applications                      │
│          (Business Logic, Workflows, Dashboards)                │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ gRPC/REST API
                         │
┌────────────────────────▼────────────────────────────────────────┐
│               AI Agent Orchestration Layer                      │
│  • Agent Lifecycle Management                                   │
│  • Task Assignment & Scheduling                                 │
│  • Inter-Agent Communication                                    │
│  • Monitoring & Observability                                   │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ Agent Actions
                         │
┌────────────────────────▼────────────────────────────────────────┐
│              Creto AuthZ Engine (In Development)                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Policy Decision Point (PDP)                              │  │
│  │  • Evaluate authorization policies                       │  │
│  │  • Agent-to-resource permission checks                   │  │
│  │  • Role-based access control (RBAC)                      │  │
│  │  • Attribute-based access control (ABAC)                 │  │
│  └──────────────────────┬───────────────────────────────────┘  │
│                         │                                        │
│  ┌──────────────────────▼───────────────────────────────────┐  │
│  │ Policy Administration Point (PAP)                        │  │
│  │  • Define authorization policies                         │  │
│  │  • Manage role assignments                               │  │
│  │  • Configure attribute rules                             │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ Cryptographic Validation
                         │
┌────────────────────────▼────────────────────────────────────────┐
│               CretoAI AI (This Repository)                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Agent Identity & Authentication                          │  │
│  │  • Quantum-resistant keypair generation (ML-DSA)         │  │
│  │  • Agent identity registration                           │  │
│  │  • Mutual TLS with PQC certificates                      │  │
│  │  • Agent-to-agent authentication                         │  │
│  └──────────────────────┬───────────────────────────────────┘  │
│                         │                                        │
│  ┌──────────────────────▼───────────────────────────────────┐  │
│  │ Quantum-Resistant Cryptography                           │  │
│  │  • ML-KEM-768 (key exchange)                             │  │
│  │  • ML-DSA (digital signatures)                           │  │
│  │  • BLAKE3 (hashing)                                      │  │
│  │  • HQC (encryption)                                      │  │
│  └──────────────────────┬───────────────────────────────────┘  │
│                         │                                        │
│  ┌──────────────────────▼───────────────────────────────────┐  │
│  │ Immutable Audit Trail (DAG Consensus)                    │  │
│  │  • QR-Avalanche consensus                                │  │
│  │  • Tamper-proof authorization logs                       │  │
│  │  • Byzantine fault tolerance                             │  │
│  │  • Sub-second finality                                   │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Integration Points

### 1. Agent Identity Registration

When a new AI agent is created, it must be registered in both systems:

**CretoAI AI**:
```rust
use vigilia_crypto::MLDSA87;

// Generate quantum-resistant keypair
let agent_keypair = MLDSA87::generate();
let agent_id = format!("agent-{}", uuid::Uuid::new_v4());

// Store in CretoAI's identity registry
vigilia_identity_store.register(
    agent_id.clone(),
    agent_keypair.public_key(),
    metadata: AgentMetadata {
        created_at: SystemTime::now(),
        agent_type: "financial-trading-agent",
        owner: "enterprise-customer-001",
    }
).await?;
```

**Creto AuthZ Engine**:
```rust
// Register agent with authorization policies
authz_client.register_agent(
    agent_id: agent_id.clone(),
    public_key: agent_keypair.public_key(),
    roles: vec!["trader", "portfolio-manager"],
    policies: vec![
        "read:market-data",
        "write:trade-orders",
        "read:portfolio:self",
    ],
    attributes: HashMap::from([
        ("department", "finance"),
        ("risk-level", "low"),
        ("trading-limit", "1000000"),
    ]),
).await?;
```

**Result**: Agent has a quantum-resistant identity (CretoAI) and authorization policies (Creto AuthZ).

---

### 2. Authorization Flow

Every agent action goes through this flow:

```
┌────────────┐
│   Agent    │
│  (agent-A) │
└──────┬─────┘
       │
       │ 1. Request access to resource
       │    (signed with ML-DSA private key)
       ▼
┌────────────────────────────────────┐
│    Creto AuthZ Engine (PDP)        │
│                                    │
│  2. Validate agent signature       │───┐
│     (via CretoAI crypto library)   │   │ CretoAI
│                                    │   │ validates
│  3. Evaluate authorization policy  │   │ signature
│     - Check agent roles            │   │
│     - Check resource permissions   │◄──┘
│     - Check attribute constraints  │
│                                    │
│  4. Make authorization decision    │
│     → ALLOW or DENY                │
└────────────┬───────────────────────┘
             │
             │ 5. Log decision to audit trail
             ▼
┌──────────────────────────────────────┐
│   CretoAI AI (DAG Consensus)         │
│                                      │
│  • Record authorization event        │
│  • Consensus timestamp               │
│  • Immutable, tamper-proof log       │
│  • Byzantine fault tolerance         │
└──────────────────────────────────────┘
```

**Code Example**:
```rust
// Agent-A wants to access resource
let request = AuthorizationRequest {
    agent_id: "agent-A",
    resource: "database/customer-records",
    action: "read",
    context: HashMap::from([
        ("ip_address", "10.0.1.42"),
        ("time", "2026-01-15T14:30:00Z"),
    ]),
};

// Sign request with quantum-resistant signature
let signature = agent_keypair.sign(&request.to_bytes());

// Submit to Creto AuthZ
let response = authz_client.authorize(
    request,
    signature,
).await?;

// CretoAI validates signature cryptographically
// AuthZ evaluates policies
match response.decision {
    Decision::Allow => {
        // Access granted
        // CretoAI logs to DAG for audit trail
        vigilia_dag.record_event(AuthorizationEvent {
            agent: "agent-A",
            resource: "database/customer-records",
            action: "read",
            decision: "allow",
            policy_version: "v1.2.3",
            timestamp: response.timestamp,
        }).await?;

        // Proceed with resource access
    }
    Decision::Deny => {
        // Access denied
        // Also logged to DAG
    }
}
```

---

### 3. Immutable Audit Trails

Every authorization decision is recorded in CretoAI's quantum-resistant DAG:

**What Gets Logged**:
- **Agent ID** - Which agent requested access
- **Resource** - What resource was accessed
- **Action** - What action was performed (read, write, delete)
- **Decision** - Was access granted or denied
- **Policy Version** - Which policy version was applied
- **Timestamp** - When the request occurred (consensus timestamp)
- **Signature** - Quantum-resistant proof of authenticity

**Why This Matters**:
- **Regulatory Compliance** - SOC 2, ISO 27001, HIPAA, GDPR require audit trails
- **Forensic Analysis** - Investigate security incidents or breaches
- **Non-Repudiation** - Agents cannot deny actions they performed
- **Tamper-Proof** - DAG consensus ensures logs cannot be altered retroactively
- **Quantum-Safe** - Audit trails remain valid even if quantum computers break classical crypto

**Example Audit Query**:
```rust
// Query all actions by agent-A in the last 24 hours
let events = vigilia_dag.query_events(QueryFilter {
    agent_id: Some("agent-A"),
    time_range: TimeRange::last_24_hours(),
    decision: None, // Both allow and deny
}).await?;

// Results:
// [
//   { agent: "agent-A", resource: "db/customers", action: "read", decision: "allow", timestamp: "2026-01-15T14:30:00Z" },
//   { agent: "agent-A", resource: "api/trades", action: "write", decision: "allow", timestamp: "2026-01-15T15:45:00Z" },
//   { agent: "agent-A", resource: "admin/users", action: "delete", decision: "deny", timestamp: "2026-01-15T16:20:00Z" },
// ]
```

---

## Non-Human Identity (NHI) Management

### Agent Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                        Agent Lifecycle                          │
└─────────────────────────────────────────────────────────────────┘

1. CREATION
   ├─ Generate ML-DSA keypair (CretoAI)
   ├─ Register identity in CretoAI identity store
   ├─ Register with Creto AuthZ (roles, policies, attributes)
   └─ Issue PQC certificate for mTLS

2. ACTIVE OPERATIONS
   ├─ Authenticate with CretoAI (ML-DSA signatures)
   ├─ Request authorization from Creto AuthZ
   ├─ Perform authorized actions
   ├─ Log all actions to CretoAI DAG
   └─ Periodic key rotation (90-day default)

3. SUSPENSION (temporary deactivation)
   ├─ Revoke authorization policies (Creto AuthZ)
   ├─ Mark identity as suspended (CretoAI)
   ├─ Log suspension event to DAG
   └─ Existing sessions remain valid until expiry

4. REACTIVATION
   ├─ Re-enable authorization policies (Creto AuthZ)
   ├─ Mark identity as active (CretoAI)
   └─ Log reactivation event to DAG

5. TERMINATION (permanent deletion)
   ├─ Revoke all authorization policies (Creto AuthZ)
   ├─ Revoke PQC certificates (CretoAI)
   ├─ Mark identity as terminated (cannot be reactivated)
   ├─ Log termination event to DAG
   └─ Retain audit trail for compliance (7 years default)
```

### Key Rotation

CretoAI supports **automatic key rotation** for long-lived agents:

```rust
// Rotate agent keypair (recommended every 90 days)
let new_keypair = MLDSA87::generate();

// Update CretoAI identity store
vigilia_identity_store.rotate_key(
    agent_id: "agent-A",
    old_public_key: current_keypair.public_key(),
    new_public_key: new_keypair.public_key(),
    rotation_reason: "scheduled-rotation",
).await?;

// Update Creto AuthZ Engine
authz_client.update_agent_key(
    agent_id: "agent-A",
    new_public_key: new_keypair.public_key(),
).await?;

// Log rotation event to DAG
vigilia_dag.record_event(KeyRotationEvent {
    agent: "agent-A",
    old_key_hash: BLAKE3::hash(current_keypair.public_key()),
    new_key_hash: BLAKE3::hash(new_keypair.public_key()),
    timestamp: SystemTime::now(),
}).await?;
```

**Benefits**:
- **Reduced Blast Radius** - If a key is compromised, exposure window is limited
- **Compliance** - Meets NIST 800-53 key rotation requirements
- **Quantum Safety** - Limits time window for quantum attacks

---

## Scalability

### Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| **Agent Registration** | 1,000+ per second | Parallel keypair generation |
| **Authorization Checks** | 100,000+ per second | Cached policy evaluation |
| **Audit Log Writes** | 50,000+ per second | DAG consensus throughput |
| **Concurrent Agents** | 1M+ active agents | Tested with connection pooling |
| **Policy Evaluation Latency** | < 10ms (p95) | In-memory policy engine |
| **Signature Verification** | < 1ms (p95) | SIMD-accelerated ML-DSA |

### Horizontal Scaling

Both CretoAI and Creto AuthZ are designed for horizontal scaling:

**CretoAI AI**:
- **DAG Nodes** - Add more nodes for higher throughput
- **Identity Store** - Sharded by agent ID prefix
- **Cryptographic Operations** - Parallelizable across CPU cores

**Creto AuthZ Engine**:
- **Policy Decision Points (PDP)** - Stateless, can scale horizontally
- **Policy Store** - Distributed cache (Redis, Memcached)
- **Policy Administration** - Read replicas for high availability

---

## Deployment Models

### 1. Shared Infrastructure (Multi-Tenant SaaS)

```
┌─────────────────────────────────────────────────────────────┐
│                 Creto Cloud Platform                        │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  Customer A  │  │  Customer B  │  │  Customer C  │     │
│  │  100 agents  │  │  500 agents  │  │ 1,000 agents │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
│         │                 │                 │              │
│         └─────────────────┴─────────────────┘              │
│                           │                                │
│  ┌────────────────────────▼─────────────────────────────┐  │
│  │       Shared Creto AuthZ Engine                      │  │
│  │  (Tenant isolation via policy namespacing)           │  │
│  └────────────────────────┬─────────────────────────────┘  │
│                           │                                │
│  ┌────────────────────────▼─────────────────────────────┐  │
│  │       Shared CretoAI AI Cluster                      │  │
│  │  (Tenant isolation via identity namespacing)         │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Use Case**: Startups, SMBs, non-sensitive workloads

---

### 2. Dedicated Infrastructure (Enterprise On-Prem)

```
┌─────────────────────────────────────────────────────────────┐
│                Enterprise Customer VPC/Data Center          │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │      Enterprise Applications & Agents                │  │
│  │  (10,000+ agents, sensitive data)                    │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                     │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │   Dedicated Creto AuthZ Engine Cluster              │  │
│  │  (3-node HA, internal network only)                  │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                     │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │   Dedicated CretoAI AI Cluster                       │  │
│  │  (5-node DAG consensus, encrypted at rest)           │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Use Case**: Fortune 500, government agencies, critical infrastructure

---

### 3. Air-Gapped (Classified Networks)

```
┌─────────────────────────────────────────────────────────────┐
│            Classified Network (IL5, Top Secret)             │
│                   (No Internet Access)                      │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Intelligence Analysis Agents (AI/ML Workloads)      │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                     │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │   Creto AuthZ Engine (Air-Gapped Deployment)        │  │
│  │  • Policy updates via manual import                  │  │
│  │  • No external dependencies                          │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                     │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │   CretoAI AI (FIPS 140-3 validated cryptography)    │  │
│  │  • Hardware Security Module (HSM) key storage        │  │
│  │  • CNSA 2.0 compliant                                │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Use Case**: DoD, Intelligence Community, nuclear facilities

---

## Security Considerations

### Threat Model

**Threats Mitigated**:
1. **Quantum Computer Attacks** - ML-KEM/ML-DSA resist quantum algorithms
2. **Agent Impersonation** - Digital signatures prevent spoofing
3. **Unauthorized Access** - AuthZ policies enforce least privilege
4. **Audit Log Tampering** - DAG consensus provides immutability
5. **Byzantine Agents** - Consensus tolerates up to 33.3% malicious nodes

**Threats NOT Mitigated** (out of scope):
1. **Side-Channel Attacks** - Timing attacks, power analysis (requires HSM)
2. **Physical Access** - Adversary with hardware access
3. **Social Engineering** - Compromised admin credentials
4. **Zero-Day Exploits** - Unpatched vulnerabilities in dependencies

### Defense in Depth

```
┌────────────────────────────────────────────────────────────┐
│  Layer 1: Network Security                                │
│  • Firewall rules, VPC isolation, mTLS                    │
└────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────┐
│  Layer 2: Agent Authentication (CretoAI)                  │
│  • Quantum-resistant signatures, certificate validation   │
└────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────┐
│  Layer 3: Authorization Policies (Creto AuthZ)            │
│  • Role-based access control, attribute constraints       │
└────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────┐
│  Layer 4: Audit & Monitoring (CretoAI DAG)                │
│  • Immutable logs, anomaly detection, alerting            │
└────────────────────────────────────────────────────────────┘
```

---

## Compliance

### Government Standards

**NSA CNSA 2.0**:
- ✅ ML-KEM-768 for key exchange
- ✅ ML-DSA for digital signatures
- ✅ BLAKE3 for hashing
- ✅ 256-bit symmetric keys minimum

**FedRAMP Moderate/High**:
- ✅ Audit logging (AC-2, AU-2, AU-3)
- ✅ Access control enforcement (AC-3)
- ✅ Identification and authentication (IA-2, IA-3)
- ✅ Cryptographic protection (SC-12, SC-13)

**CMMC 2.0 Level 2/3**:
- ✅ Access control (AC.L2-3.1.1 through AC.L2-3.1.22)
- ✅ Audit and accountability (AU.L2-3.3.1 through AU.L2-3.3.9)
- ✅ Identification and authentication (IA.L2-3.5.1 through IA.L2-3.5.11)

---

## API Reference

### CretoAI AI

```rust
// Agent identity management
pub trait IdentityStore {
    async fn register(&self, agent_id: String, public_key: PublicKey, metadata: AgentMetadata) -> Result<()>;
    async fn get(&self, agent_id: &str) -> Result<AgentIdentity>;
    async fn rotate_key(&self, agent_id: &str, old_key: PublicKey, new_key: PublicKey) -> Result<()>;
    async fn revoke(&self, agent_id: &str, reason: String) -> Result<()>;
}

// Cryptographic operations
pub trait CryptoProvider {
    fn generate_keypair(&self) -> Keypair;
    fn sign(&self, keypair: &Keypair, message: &[u8]) -> Signature;
    fn verify(&self, public_key: &PublicKey, message: &[u8], signature: &Signature) -> bool;
    fn encapsulate(&self, public_key: &PublicKey) -> (Ciphertext, SharedSecret);
    fn decapsulate(&self, keypair: &Keypair, ciphertext: &Ciphertext) -> SharedSecret;
}

// DAG consensus & audit
pub trait AuditLog {
    async fn record_event(&self, event: AuthorizationEvent) -> Result<EventId>;
    async fn query_events(&self, filter: QueryFilter) -> Result<Vec<AuthorizationEvent>>;
    async fn verify_integrity(&self, event_id: EventId) -> Result<bool>;
}
```

### Creto AuthZ Engine

```rust
// Authorization client
pub trait AuthzClient {
    async fn register_agent(&self, req: RegisterAgentRequest) -> Result<AgentId>;
    async fn authorize(&self, req: AuthorizationRequest, signature: Signature) -> Result<AuthorizationResponse>;
    async fn update_agent_key(&self, agent_id: &str, new_key: PublicKey) -> Result<()>;
    async fn deactivate_agent(&self, agent_id: &str, reason: String) -> Result<()>;
}

// Policy management
pub trait PolicyStore {
    async fn create_policy(&self, policy: Policy) -> Result<PolicyId>;
    async fn get_policy(&self, policy_id: &str) -> Result<Policy>;
    async fn update_policy(&self, policy_id: &str, policy: Policy) -> Result<()>;
    async fn delete_policy(&self, policy_id: &str) -> Result<()>;
    async fn evaluate(&self, req: AuthorizationRequest) -> Result<Decision>;
}
```

---

## Next Steps

### For Developers

1. **Read the Quick Start** - Get CretoAI AI running locally
2. **Review Code Examples** - See `/examples/authz-integration/` for sample code
3. **Join the Community** - Contribute to CretoAI AI development
4. **Test the Integration** - Use the Creto AuthZ Engine beta (contact: authz@creto.com)

### For Enterprise Customers

1. **Schedule a Demo** - See CretoAI + AuthZ in action
2. **Proof of Concept** - Deploy in your environment (30-day trial)
3. **Design Partner Program** - Shape the product roadmap
4. **Enterprise Support** - SLA-backed support and professional services

**Contact**: [partnerships@vigilia.ai](mailto:partnerships@vigilia.ai)

---

**Last Updated**: November 25, 2025
**Version**: 1.0.0
**Status**: CretoAI AI (production), Creto AuthZ Engine (beta)
