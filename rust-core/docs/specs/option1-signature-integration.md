# SPECIFICATION: Option 1 - Security First ML-DSA Signature Integration

**Project:** CretoAI
**Specification Phase:** Security Architecture & Implementation
**Version:** 1.0
**Date:** 2025-11-26
**Status:** Draft

---

## 1. Executive Summary

### 1.1 Purpose

This specification defines the comprehensive integration of ML-DSA (Module-Lattice-Based Digital Signature Algorithm, also known as Dilithium) quantum-resistant signatures into the CretoAI codebase, replacing all signature placeholders with production-ready cryptographic operations.

### 1.2 Scope

**In Scope:**
- Integration of ML-DSA-87 signatures across all DAG, network, and exchange modules
- Key management architecture (generation, storage, rotation, distribution)
- Signature verification flows for vertices, queries, responses, and orders
- Byzantine fault tolerance against signature-based attacks
- Test infrastructure for cryptographic operations
- Performance optimization for signature operations

**Out of Scope:**
- Hybrid signature schemes (covered in Option 2)
- Key escrow or recovery mechanisms
- Hardware security module (HSM) integration (future enhancement)
- Multi-signature or threshold signature schemes (future enhancement)

### 1.3 Success Criteria

1. **Security:**
   - All signature placeholders replaced with verified ML-DSA operations
   - Zero invalid signatures accepted in consensus
   - Byzantine attack scenarios handled correctly
   - Key material never exposed in logs or errors

2. **Performance:**
   - Signature generation: < 5ms per operation
   - Signature verification: < 10ms per operation
   - Minimal impact on consensus latency (< 10% overhead)
   - Efficient batch verification for multiple signatures

3. **Reliability:**
   - 100% test coverage for signature operations
   - All edge cases handled (expired keys, invalid signatures, etc.)
   - Graceful degradation on signature failures
   - Audit trail for all signature operations

---

## 2. Security Gap Analysis

### 2.1 Current Placeholder Locations

#### 2.1.1 DAG Module (`src/dag/src/vertex.rs`)

**Location:** Lines 120-127

```rust
/// Verify the vertex signature
pub fn verify_signature(&self, _public_key: &[u8]) -> Result<()> {
    // Placeholder: In production, use cretoai-crypto to verify ML-DSA signature
    if self.signature.is_empty() {
        return Err(DagError::InvalidVertex("Missing signature".to_string()));
    }

    // TODO: Integrate with cretoai-crypto for actual signature verification
    Ok(())
}
```

**Security Impact:** **CRITICAL**
- Accepts any non-empty signature without verification
- Allows Byzantine vertices to bypass cryptographic validation
- Enables double-spend and conflicting transaction attacks
- Compromises entire DAG integrity

**Attack Scenarios:**
1. **Signature Forgery:** Malicious node creates vertices with fake signatures
2. **Replay Attacks:** Old signed vertices replayed in new contexts
3. **Identity Spoofing:** Attacker impersonates legitimate nodes
4. **DAG Poisoning:** Invalid vertices accepted into consensus

#### 2.1.2 Network Module - Consensus P2P (`src/network/src/consensus_p2p.rs`)

**Locations:**
- Line 246: Vertex broadcast signing
- Line 295: Query signing
- Line 312: Response signing
- Line 403: Query response signing

```rust
// Line 246
let signature = vec![]; // TODO: Sign with ML-DSA

// Line 295
let signature = vec![]; // TODO: Sign

// Line 312
let signature = vec![]; // TODO: Sign

// Line 403
signature: vec![], // TODO: Sign
```

**Security Impact:** **CRITICAL**
- Consensus queries/responses not authenticated
- Sybil attacks possible (one node pretending to be many)
- Byzantine nodes can influence consensus without accountability
- No proof of participation in consensus rounds

**Attack Scenarios:**
1. **Vote Stuffing:** Single Byzantine node sends multiple unsigned responses
2. **Consensus Manipulation:** Unsigned queries accepted from any source
3. **Reputation Bypass:** No accountability for malicious votes
4. **Network Flooding:** Unauthenticated messages overwhelm honest nodes

#### 2.1.3 Network Module - Exchange P2P (`src/network/src/exchange_p2p.rs`)

**Location:** Line 256

```rust
let signature = vec![]; // TODO: Sign with ML-DSA
```

**Security Impact:** **HIGH**
- Resource marketplace orders not authenticated
- Double-listing attacks possible
- Payment fraud via unsigned orders
- Reputation system bypassed

**Attack Scenarios:**
1. **Order Manipulation:** Unsigned orders modified in transit
2. **Resource Theft:** Fake listings from non-providers
3. **Payment Fraud:** Unsigned payment commitments
4. **Marketplace Disruption:** Spam listings without accountability

### 2.2 Signature Requirements Matrix

| Module | Component | Signature Type | Priority | Verification Frequency |
|--------|-----------|----------------|----------|------------------------|
| DAG | Vertex Creation | Creator Signature | CRITICAL | Every vertex add |
| DAG | Vertex Verification | Signature Check | CRITICAL | Every consensus query |
| Network | Consensus Query | Requester Signature | CRITICAL | Every query |
| Network | Consensus Response | Responder Signature | CRITICAL | Every response |
| Network | Vertex Broadcast | Creator Signature | CRITICAL | Every broadcast |
| Exchange | Listing Broadcast | Provider Signature | HIGH | On publish |
| Exchange | Order Creation | Buyer Signature | HIGH | On order |
| Exchange | Order Update | Party Signature | HIGH | On status change |
| Exchange | Reputation Update | Rater Signature | MEDIUM | On update |

### 2.3 Key Material Requirements

| Key Type | Purpose | Rotation Frequency | Storage Location | Access Control |
|----------|---------|-------------------|------------------|----------------|
| Node Identity Key | DAG vertex signing | Yearly | Secure vault | Node owner only |
| Ephemeral Session Key | Network messages | Daily | Memory | Process only |
| Service Key | Marketplace operations | Monthly | Encrypted storage | Service processes |
| Consensus Key | Query/Response signing | Weekly | Memory + backup | Consensus module |

---

## 3. ML-DSA Integration Design

### 3.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                   CretoAI Signature Layer                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐      ┌──────────────┐      ┌─────────────┐  │
│  │  Key Manager │◄─────┤  Signer API  │◄─────┤  Verifier   │  │
│  │              │      │              │      │   API       │  │
│  │ - Generate   │      │ - Sign       │      │ - Verify    │  │
│  │ - Store      │      │ - Batch sign │      │ - Batch     │  │
│  │ - Rotate     │      │ - Async sign │      │   verify    │  │
│  │ - Distribute │      └──────────────┘      └─────────────┘  │
│  └──────┬───────┘            │                      │          │
│         │                    │                      │          │
│         ▼                    ▼                      ▼          │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │         cretoai-crypto ML-DSA87 Implementation           │ │
│  │  - pqcrypto-dilithium wrapper                            │ │
│  │  - Thread-safe operations                                │ │
│  │  - Error handling                                        │ │
│  └──────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
         │                    │                      │
         ▼                    ▼                      ▼
    ┌────────┐         ┌──────────┐         ┌───────────┐
    │  DAG   │         │ Network  │         │ Exchange  │
    │ Module │         │  Module  │         │  Module   │
    └────────┘         └──────────┘         └───────────┘
```

### 3.2 Component Specifications

#### 3.2.1 Signature Manager

**Purpose:** Central API for all signature operations

**Interface:**

```rust
pub struct SignatureManager {
    key_manager: Arc<KeyManager>,
    cache: SignatureCache,
}

impl SignatureManager {
    /// Sign data with ML-DSA-87
    pub fn sign(&self, data: &[u8], key_id: &str) -> Result<MLDSA87Signature>;

    /// Verify ML-DSA-87 signature
    pub fn verify(
        &self,
        data: &[u8],
        signature: &MLDSA87Signature,
        public_key: &MLDSA87PublicKey
    ) -> Result<()>;

    /// Batch sign multiple messages
    pub async fn batch_sign(
        &self,
        messages: Vec<&[u8]>,
        key_id: &str
    ) -> Result<Vec<MLDSA87Signature>>;

    /// Batch verify multiple signatures
    pub async fn batch_verify(
        &self,
        items: Vec<(Vec<u8>, MLDSA87Signature, MLDSA87PublicKey)>
    ) -> Result<Vec<bool>>;
}
```

**Requirements:**
- Thread-safe for concurrent signing/verification
- Signature caching to avoid redundant verifications
- Automatic key loading from KeyManager
- Detailed error reporting for debugging
- Performance metrics collection

#### 3.2.2 Key Manager

**Purpose:** Lifecycle management for cryptographic keys

**Interface:**

```rust
pub struct KeyManager {
    storage: Arc<dyn SecureStorage>,
    rotation_policy: RotationPolicy,
}

pub enum KeyPurpose {
    NodeIdentity,
    ConsensusSession,
    MarketplaceService,
    NetworkEphemeral,
}

impl KeyManager {
    /// Generate new ML-DSA-87 keypair
    pub fn generate_key(
        &self,
        purpose: KeyPurpose,
        label: String
    ) -> Result<String>; // Returns key_id

    /// Get public key
    pub fn get_public_key(&self, key_id: &str) -> Result<MLDSA87PublicKey>;

    /// Get secret key (restricted access)
    fn get_secret_key(&self, key_id: &str) -> Result<MLDSA87SecretKey>;

    /// Rotate key (generate new, mark old as deprecated)
    pub fn rotate_key(&self, old_key_id: &str) -> Result<String>; // Returns new key_id

    /// Export public keys for distribution
    pub fn export_public_keys(&self) -> Result<HashMap<String, MLDSA87PublicKey>>;

    /// Import peer public keys
    pub fn import_public_key(
        &self,
        peer_id: &str,
        public_key: MLDSA87PublicKey
    ) -> Result<()>;
}
```

**Key Storage Requirements:**
- Encryption at rest using AES-256-GCM
- Access control via permissions system
- Audit logging for all key access
- Secure deletion of deprecated keys
- Backup/recovery mechanisms

#### 3.2.3 Signature Cache

**Purpose:** Performance optimization for repeated verifications

**Interface:**

```rust
pub struct SignatureCache {
    verified_signatures: Arc<RwLock<LruCache<SignatureCacheKey, VerificationResult>>>,
    max_size: usize,
    ttl: Duration,
}

struct SignatureCacheKey {
    data_hash: [u8; 32], // BLAKE3 hash
    signature_hash: [u8; 32],
    public_key_hash: [u8; 32],
}

impl SignatureCache {
    /// Check if signature verification is cached
    pub fn get(
        &self,
        data: &[u8],
        signature: &MLDSA87Signature,
        public_key: &MLDSA87PublicKey
    ) -> Option<VerificationResult>;

    /// Cache verification result
    pub fn put(
        &self,
        data: &[u8],
        signature: &MLDSA87Signature,
        public_key: &MLDSA87PublicKey,
        result: VerificationResult,
    );

    /// Invalidate all cached entries for a public key
    pub fn invalidate_key(&self, public_key: &MLDSA87PublicKey);
}
```

**Cache Requirements:**
- LRU eviction policy
- Configurable TTL (default: 5 minutes)
- Thread-safe access
- Memory-bounded (default: 10,000 entries)
- Metrics for hit/miss rates

### 3.3 Module-Specific Integration

#### 3.3.1 DAG Module Integration

**File:** `src/dag/src/vertex.rs`

**Current Implementation:**
```rust
pub fn verify_signature(&self, _public_key: &[u8]) -> Result<()> {
    if self.signature.is_empty() {
        return Err(DagError::InvalidVertex("Missing signature".to_string()));
    }
    Ok(()) // TODO: Actual verification
}
```

**Required Implementation:**

```rust
use vigilia_crypto::signatures::{MLDSA87, MLDSA87PublicKey, MLDSA87Signature};

impl Vertex {
    /// Sign the vertex with creator's secret key
    pub fn sign_with_key(&mut self, signature_manager: &SignatureManager, key_id: &str) -> Result<()> {
        // Compute canonical signing payload
        let signing_payload = self.compute_signing_payload();

        // Generate signature
        let signature = signature_manager.sign(&signing_payload, key_id)?;

        // Store signature bytes
        self.signature = signature.as_bytes().to_vec();

        Ok(())
    }

    /// Verify the vertex signature
    pub fn verify_signature(&self, public_key: &MLDSA87PublicKey, signature_manager: &SignatureManager) -> Result<()> {
        // Validate signature not empty
        if self.signature.is_empty() {
            return Err(DagError::InvalidVertex("Missing signature".to_string()));
        }

        // Parse signature
        let signature = MLDSA87Signature::from_bytes(&self.signature)
            .map_err(|e| DagError::InvalidVertex(format!("Invalid signature format: {}", e)))?;

        // Compute signing payload
        let signing_payload = self.compute_signing_payload();

        // Verify signature
        signature_manager.verify(&signing_payload, &signature, public_key)
            .map_err(|e| DagError::InvalidVertex(format!("Signature verification failed: {}", e)))?;

        Ok(())
    }

    /// Compute canonical signing payload (deterministic)
    fn compute_signing_payload(&self) -> Vec<u8> {
        use blake3::Hasher;

        let mut hasher = Hasher::new();

        // Add all vertex fields in deterministic order
        hasher.update(self.id.as_bytes());
        hasher.update(&self.timestamp.to_le_bytes());

        // Add parents (sorted for determinism)
        let mut sorted_parents = self.parents.clone();
        sorted_parents.sort();
        for parent in sorted_parents {
            hasher.update(parent.as_bytes());
        }

        // Add payload
        hasher.update(&self.payload);

        // Add creator
        hasher.update(self.creator.as_bytes());

        // Return hash as signing payload (32 bytes)
        hasher.finalize().as_bytes().to_vec()
    }
}
```

**Key Design Decisions:**

1. **Canonical Signing Payload:** All vertices sign a BLAKE3 hash of their content, not raw content
   - **Rationale:** Reduces signature payload size, ensures determinism
   - **Trade-off:** Adds one hash operation per signature

2. **Signature Storage:** Signatures stored as raw bytes in `Vec<u8>`
   - **Rationale:** Flexible storage, no serialization overhead
   - **Trade-off:** Requires parsing on verification

3. **Error Handling:** Specific error messages for debugging
   - **Rationale:** Security audit trail, easier debugging
   - **Trade-off:** Verbose error types

#### 3.3.2 Network Consensus P2P Integration

**File:** `src/network/src/consensus_p2p.rs`

**Current Placeholders:**

1. **Vertex Broadcast** (Line 246)
2. **Query Signing** (Line 295)
3. **Response Signing** (Line 312, 403)

**Required Implementation:**

```rust
impl ConsensusP2PNode {
    /// Broadcast a vertex to the network (with signing)
    pub fn broadcast_vertex(
        &self,
        vertex: VertexMessage,
        signature_manager: &SignatureManager,
        key_id: &str
    ) -> Result<MessageId> {
        // Cache the vertex
        {
            let mut cache = self.vertex_cache.write().unwrap();
            cache.insert(vertex.vertex_id.clone(), vertex.clone());
        }

        // Serialize vertex for signing
        let p2p_msg = P2PMessage::Vertex(vertex.clone());
        let data = p2p_msg.to_bytes()?;

        // Sign the serialized message
        let signature = signature_manager.sign(&data, key_id)
            .map_err(|e| NetworkError::Signature(format!("Failed to sign vertex: {}", e)))?;

        // Publish with signature
        let mut gossip = self.gossip.write().unwrap();
        let msg_id = gossip.publish(
            VERTEX_TOPIC.to_string(),
            data,
            signature.as_bytes().to_vec(),
        )?;

        info!("Broadcast signed vertex {} (msg_id: {})", vertex.vertex_id, msg_id);
        Ok(msg_id)
    }

    /// Send a consensus query to the network (with signing)
    pub fn send_consensus_query(
        &self,
        vertex_id: String,
        sample_size: usize,
        signature_manager: &SignatureManager,
        key_id: &str,
    ) -> Result<String> {
        let query_id = uuid::Uuid::new_v4().to_string();
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let query = ConsensusQuery {
            query_id: query_id.clone(),
            vertex_id,
            requester: self.agent_id.clone(),
            timestamp,
        };

        // Register pending query
        {
            let mut pending = self.pending_queries.write().unwrap();
            pending.insert(
                query_id.clone(),
                PendingQuery {
                    query: query.clone(),
                    responses: Vec::new(),
                    expected_count: sample_size,
                    created_at: std::time::SystemTime::now(),
                },
            );
        }

        // Serialize and sign query
        let p2p_msg = P2PMessage::Query(query);
        let data = p2p_msg.to_bytes()?;
        let signature = signature_manager.sign(&data, key_id)
            .map_err(|e| NetworkError::Signature(format!("Failed to sign query: {}", e)))?;

        // Publish signed query
        let mut gossip = self.gossip.write().unwrap();
        gossip.publish(
            CONSENSUS_QUERY_TOPIC.to_string(),
            data,
            signature.as_bytes().to_vec(),
        )?;

        debug!("Sent signed consensus query {}", query_id);
        Ok(query_id)
    }

    /// Send a consensus response (with signing)
    pub fn send_consensus_response(
        &self,
        response: ConsensusResponse,
        signature_manager: &SignatureManager,
        key_id: &str,
    ) -> Result<()> {
        let p2p_msg = P2PMessage::Response(response.clone());
        let data = p2p_msg.to_bytes()?;

        // Sign response
        let signature = signature_manager.sign(&data, key_id)
            .map_err(|e| NetworkError::Signature(format!("Failed to sign response: {}", e)))?;

        let mut gossip = self.gossip.write().unwrap();
        gossip.publish(
            CONSENSUS_RESPONSE_TOPIC.to_string(),
            data,
            signature.as_bytes().to_vec(),
        )?;

        debug!("Sent signed consensus response for query {}", response.query_id);
        Ok(())
    }

    /// Handle received message (with signature verification)
    pub fn handle_message(
        &self,
        _topic: &TopicHash,
        message: &Message,
        signature_manager: &SignatureManager,
        peer_keys: &HashMap<String, MLDSA87PublicKey>,
    ) -> Result<()> {
        // Verify message signature
        let signature = MLDSA87Signature::from_bytes(&message.signature)
            .map_err(|e| NetworkError::Signature(format!("Invalid signature format: {}", e)))?;

        // Deserialize to get sender info
        let p2p_msg = P2PMessage::from_bytes(&message.data)?;

        // Get sender's public key
        let sender_id = match &p2p_msg {
            P2PMessage::Vertex(v) => &v.creator,
            P2PMessage::Query(q) => &q.requester,
            P2PMessage::Response(r) => &r.responder,
        };

        let sender_key = peer_keys.get(sender_id)
            .ok_or_else(|| NetworkError::Signature(format!("Unknown sender: {}", sender_id)))?;

        // Verify signature
        signature_manager.verify(&message.data, &signature, sender_key)
            .map_err(|e| NetworkError::Signature(format!("Signature verification failed from {}: {}", sender_id, e)))?;

        // Process verified message
        match p2p_msg {
            P2PMessage::Vertex(vertex) => {
                self.handle_vertex_message(vertex)?;
            }
            P2PMessage::Query(query) => {
                self.handle_consensus_query(query)?;
            }
            P2PMessage::Response(response) => {
                self.handle_consensus_response(response)?;
            }
        }

        Ok(())
    }
}
```

**Key Design Decisions:**

1. **Message-Level Signing:** Sign entire serialized P2P message
   - **Rationale:** Ensures integrity of all fields
   - **Trade-off:** Larger signature payload

2. **Peer Key Distribution:** Require peer public keys as parameter
   - **Rationale:** Caller controls trust model
   - **Trade-off:** Requires external key management

3. **Signature in Message Struct:** Add signature field to Message
   - **Rationale:** Clean separation of data and signature
   - **Trade-off:** Requires Message struct modification

#### 3.3.3 Exchange P2P Integration

**File:** `src/network/src/exchange_p2p.rs`

**Current Placeholder:** Line 256

**Required Implementation:**

```rust
impl ExchangeP2PNode {
    /// Broadcast a resource listing to the network (with signing)
    pub fn broadcast_listing(
        &self,
        mut listing: ResourceListingMessage,
        signature_manager: &SignatureManager,
        key_id: &str,
    ) -> Result<String> {
        let listing_id = listing.listing_id.clone();

        // Sign the listing
        let listing_bytes = bincode::serialize(&listing)
            .map_err(|e| NetworkError::Serialization(e.to_string()))?;

        let signature = signature_manager.sign(&listing_bytes, key_id)
            .map_err(|e| NetworkError::Signature(format!("Failed to sign listing: {}", e)))?;

        listing.signature = signature.as_bytes().to_vec();

        // Store in local cache
        {
            let mut listings = self.local_listings.write().unwrap();
            listings.insert(listing_id.clone(), listing.clone());
        }

        // Broadcast to network
        let msg = ExchangeMessage::ListingBroadcast(listing);
        let data = msg.to_bytes()?;

        let mut gossip = self.gossip.write().unwrap();
        gossip
            .publish(LISTING_TOPIC.to_string(), data, signature.as_bytes().to_vec())
            .map_err(|e| NetworkError::Gossip(e.to_string()))?;

        info!("Broadcast signed listing: {}", listing_id);
        Ok(listing_id)
    }

    /// Verify a received listing
    fn verify_listing(
        &self,
        listing: &ResourceListingMessage,
        signature_manager: &SignatureManager,
        provider_key: &MLDSA87PublicKey,
    ) -> Result<()> {
        // Parse signature
        let signature = MLDSA87Signature::from_bytes(&listing.signature)
            .map_err(|e| NetworkError::Signature(format!("Invalid listing signature: {}", e)))?;

        // Create a copy without signature for verification
        let mut unsigned_listing = listing.clone();
        unsigned_listing.signature = Vec::new();

        let listing_bytes = bincode::serialize(&unsigned_listing)
            .map_err(|e| NetworkError::Serialization(e.to_string()))?;

        // Verify signature
        signature_manager.verify(&listing_bytes, &signature, provider_key)
            .map_err(|e| NetworkError::Signature(format!("Listing verification failed: {}", e)))?;

        Ok(())
    }

    /// Create an order with distributed consensus (with signing)
    pub async fn create_order(
        &self,
        mut order: OrderRequestMessage,
        signature_manager: &SignatureManager,
        key_id: &str,
    ) -> Result<String> {
        let order_id = order.order_id.clone();

        // Sign the order
        let order_bytes = bincode::serialize(&order)
            .map_err(|e| NetworkError::Serialization(e.to_string()))?;

        let signature = signature_manager.sign(&order_bytes, key_id)
            .map_err(|e| NetworkError::Signature(format!("Failed to sign order: {}", e)))?;

        order.signature = signature.as_bytes().to_vec();

        // Store in active orders
        {
            let mut orders = self.active_orders.write().unwrap();
            orders.insert(order_id.clone(), order.clone());
        }

        // Process with consensus if enabled
        if let Some(ref consensus) = self.consensus_node {
            // Create vertex for order
            let vertex = VertexMessage {
                vertex_id: format!("order-{}", order_id),
                parents: vec![],
                payload: bincode::serialize(&order)
                    .map_err(|e| NetworkError::Serialization(e.to_string()))?,
                timestamp: order.timestamp as u64,
                creator: self.config.agent_id.clone(),
                signature: order.signature.clone(),
                hash: [0u8; 32], // Computed by vertex creation
            };

            consensus.add_vertex(vertex).await?;

            let finalized = consensus
                .run_consensus(&format!("order-{}", order_id))
                .await?;

            if !finalized {
                warn!("Order {} consensus timeout", order_id);
                return Err(NetworkError::Consensus("Consensus timeout".to_string()));
            }

            info!("Order {} finalized through consensus", order_id);
        } else {
            // Broadcast order without consensus
            let msg = ExchangeMessage::OrderRequest(order);
            let data = msg.to_bytes()?;

            let mut gossip = self.gossip.write().unwrap();
            gossip
                .publish(ORDER_TOPIC.to_string(), data, signature.as_bytes().to_vec())
                .map_err(|e| NetworkError::Gossip(e.to_string()))?;
        }

        info!("Created signed order: {}", order_id);
        Ok(order_id)
    }
}
```

**Key Design Decisions:**

1. **Embedded Signatures:** Signatures stored in message structs
   - **Rationale:** Self-contained messages
   - **Trade-off:** Requires careful serialization order

2. **Verification Before Caching:** Verify signatures before storing
   - **Rationale:** Prevents pollution of local cache
   - **Trade-off:** Additional verification overhead

3. **Provider Key Lookup:** Require external key resolution
   - **Rationale:** Flexible trust models
   - **Trade-off:** Caller responsibility

---

## 4. Key Management Specification

### 4.1 Key Generation

**Requirements:**

```rust
pub struct KeyGenerationConfig {
    /// Key purpose/type
    pub purpose: KeyPurpose,

    /// Human-readable label
    pub label: String,

    /// Optional expiration timestamp
    pub expires_at: Option<SystemTime>,

    /// Key usage constraints
    pub constraints: KeyConstraints,
}

pub struct KeyConstraints {
    /// Maximum signatures per day
    pub max_signatures_per_day: Option<u32>,

    /// Allowed operations
    pub allowed_operations: Vec<KeyOperation>,

    /// IP restrictions
    pub ip_whitelist: Vec<IpAddr>,
}

pub enum KeyOperation {
    SignVertex,
    SignQuery,
    SignResponse,
    SignListing,
    SignOrder,
}
```

**Generation Process:**

1. Validate configuration
2. Generate ML-DSA-87 keypair using `pqcrypto-dilithium`
3. Encrypt secret key with AES-256-GCM (key from vault)
4. Store metadata in key registry
5. Return key_id (UUID v4)

**Storage Format:**

```rust
pub struct StoredKey {
    pub key_id: String,
    pub purpose: KeyPurpose,
    pub label: String,
    pub public_key: Vec<u8>, // Raw public key bytes
    pub encrypted_secret_key: EncryptedData,
    pub created_at: SystemTime,
    pub expires_at: Option<SystemTime>,
    pub constraints: KeyConstraints,
    pub status: KeyStatus,
}

pub enum KeyStatus {
    Active,
    Deprecated,
    Revoked,
    Expired,
}

pub struct EncryptedData {
    pub ciphertext: Vec<u8>,
    pub nonce: [u8; 12], // GCM nonce
    pub tag: [u8; 16],   // Authentication tag
}
```

### 4.2 Key Storage

**Storage Backend:** CretoAI Vault module (`src/vault/`)

**Requirements:**
- Encryption at rest (AES-256-GCM)
- Access control via permissions
- Audit logging
- Secure deletion (zeroize on drop)

**Directory Structure:**

```
vault/
├── keys/
│   ├── metadata/           # JSON metadata files
│   │   ├── {key_id}.json
│   │   └── index.json      # All keys index
│   └── secrets/            # Encrypted secret keys
│       └── {key_id}.enc
├── peers/                  # Public keys of peers
│   └── {peer_id}.pub
└── audit/                  # Audit logs
    └── {date}.log
```

**Key Access Protocol:**

```rust
impl KeyManager {
    /// Get secret key (restricted, requires authentication)
    fn get_secret_key(&self, key_id: &str) -> Result<MLDSA87SecretKey> {
        // 1. Check access permissions
        self.check_access_permission(key_id)?;

        // 2. Load encrypted key
        let stored_key = self.storage.load_key(key_id)?;

        // 3. Verify key not expired/revoked
        if stored_key.status != KeyStatus::Active {
            return Err(CryptoError::KeyNotActive(key_id.to_string()));
        }

        // 4. Get vault master key
        let master_key = self.storage.get_master_key()?;

        // 5. Decrypt secret key
        let secret_bytes = self.decrypt_key_material(
            &stored_key.encrypted_secret_key,
            &master_key
        )?;

        // 6. Parse ML-DSA secret key
        let secret_key = MLDSA87SecretKey::from_bytes(&secret_bytes)
            .map_err(|e| CryptoError::InvalidSecretKey)?;

        // 7. Audit log access
        self.audit_log(AuditEvent::SecretKeyAccessed {
            key_id: key_id.to_string(),
            timestamp: SystemTime::now(),
        });

        Ok(secret_key)
    }
}
```

### 4.3 Key Rotation

**Rotation Policy:**

```rust
pub struct RotationPolicy {
    /// Automatic rotation interval
    pub rotation_interval: Duration,

    /// Grace period for old key
    pub deprecation_period: Duration,

    /// Notification before rotation
    pub notification_advance: Duration,
}

impl Default for RotationPolicy {
    fn default() -> Self {
        RotationPolicy {
            rotation_interval: Duration::from_secs(365 * 24 * 60 * 60), // 1 year
            deprecation_period: Duration::from_secs(30 * 24 * 60 * 60),  // 30 days
            notification_advance: Duration::from_secs(7 * 24 * 60 * 60), // 7 days
        }
    }
}
```

**Rotation Process:**

1. Generate new keypair with same purpose/constraints
2. Mark old key as "Deprecated" (still valid for verification)
3. Distribute new public key to all peers
4. Update local signing operations to use new key
5. After deprecation period, revoke old key
6. Audit log entire rotation event

**Implementation:**

```rust
impl KeyManager {
    pub fn rotate_key(&self, old_key_id: &str) -> Result<String> {
        // 1. Load old key metadata
        let old_key = self.storage.load_key_metadata(old_key_id)?;

        // 2. Verify old key is active
        if old_key.status != KeyStatus::Active {
            return Err(CryptoError::CannotRotateInactiveKey);
        }

        // 3. Generate new keypair
        let new_config = KeyGenerationConfig {
            purpose: old_key.purpose.clone(),
            label: format!("{} (rotated)", old_key.label),
            expires_at: Some(SystemTime::now() + self.rotation_policy.rotation_interval),
            constraints: old_key.constraints.clone(),
        };

        let new_key_id = self.generate_key(new_config)?;

        // 4. Mark old key as deprecated
        self.storage.update_key_status(old_key_id, KeyStatus::Deprecated)?;

        // 5. Schedule revocation
        let revocation_time = SystemTime::now() + self.rotation_policy.deprecation_period;
        self.schedule_revocation(old_key_id, revocation_time)?;

        // 6. Audit log
        self.audit_log(AuditEvent::KeyRotated {
            old_key_id: old_key_id.to_string(),
            new_key_id: new_key_id.clone(),
            timestamp: SystemTime::now(),
        });

        info!("Rotated key {} -> {}", old_key_id, new_key_id);
        Ok(new_key_id)
    }
}
```

### 4.4 Key Distribution

**Problem:** Peers need each other's public keys for signature verification

**Solution:** Peer Key Exchange Protocol

```rust
pub struct PeerKeyExchange {
    key_manager: Arc<KeyManager>,
    gossip: Arc<RwLock<GossipProtocol>>,
}

pub const PEER_KEY_TOPIC: &str = "vigilia/keys/exchange";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerKeyAnnouncement {
    pub peer_id: String,
    pub public_keys: HashMap<KeyPurpose, Vec<u8>>, // purpose -> public key bytes
    pub timestamp: u64,
    pub signature: Vec<u8>, // Self-signed with identity key
}

impl PeerKeyExchange {
    /// Announce own public keys to network
    pub fn announce_keys(&self) -> Result<()> {
        // 1. Collect all active public keys
        let keys = self.key_manager.export_public_keys()?;

        // 2. Create announcement
        let announcement = PeerKeyAnnouncement {
            peer_id: self.key_manager.get_node_id(),
            public_keys: keys.iter()
                .map(|(purpose, key)| (*purpose, key.as_bytes().to_vec()))
                .collect(),
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            signature: Vec::new(), // Will be filled
        };

        // 3. Sign announcement with identity key
        let announcement_bytes = bincode::serialize(&announcement)?;
        let identity_key_id = self.key_manager.get_identity_key_id()?;
        let signature = self.key_manager.sign(&announcement_bytes, &identity_key_id)?;

        let mut signed_announcement = announcement;
        signed_announcement.signature = signature.as_bytes().to_vec();

        // 4. Broadcast to network
        let data = bincode::serialize(&signed_announcement)?;
        let mut gossip = self.gossip.write().unwrap();
        gossip.publish(PEER_KEY_TOPIC.to_string(), data, signature.as_bytes().to_vec())?;

        info!("Announced public keys to network");
        Ok(())
    }

    /// Handle received key announcement
    pub fn handle_announcement(&self, announcement: PeerKeyAnnouncement) -> Result<()> {
        // 1. Verify announcement signature
        // (requires bootstrap trust or web-of-trust)

        // 2. Import peer public keys
        for (purpose, key_bytes) in announcement.public_keys {
            let public_key = MLDSA87PublicKey::from_bytes(&key_bytes)?;
            self.key_manager.import_public_key(&announcement.peer_id, public_key)?;
        }

        info!("Imported keys from peer {}", announcement.peer_id);
        Ok(())
    }
}
```

**Bootstrap Trust:**

For initial network bootstrap, use one of:
1. **Pre-shared Keys:** Distribute public keys out-of-band
2. **Certificate Authority:** Central CA signs peer keys
3. **Web of Trust:** Peers introduce each other
4. **Blockchain Anchor:** Public keys published on blockchain

**Recommendation:** Use pre-shared keys for initial deployment, migrate to web-of-trust for decentralization.

---

## 5. Signature Verification Flow

### 5.1 Vertex Verification Flow

```
┌────────────────────────────────────────────────────────────────┐
│              Vertex Received from Network                      │
└────────────────┬───────────────────────────────────────────────┘
                 │
                 ▼
      ┌──────────────────────┐
      │ Parse Vertex Message │
      └──────────┬───────────┘
                 │
                 ▼
      ┌──────────────────────┐
      │ Extract Signature    │
      │ and Creator ID       │
      └──────────┬───────────┘
                 │
                 ▼
      ┌──────────────────────┐
      │ Lookup Creator's     │
      │ Public Key           │
      └──────────┬───────────┘
                 │
                 ├─── Key Not Found ───► Reject (Unknown Creator)
                 │
                 ▼
      ┌──────────────────────┐
      │ Check Signature      │
      │ Cache                │
      └──────────┬───────────┘
                 │
                 ├─── Cache Hit ────────► Skip to Vertex Validation
                 │
                 ▼
      ┌──────────────────────┐
      │ Compute Signing      │
      │ Payload (BLAKE3)     │
      └──────────┬───────────┘
                 │
                 ▼
      ┌──────────────────────┐
      │ Verify ML-DSA        │
      │ Signature            │
      └──────────┬───────────┘
                 │
                 ├─── Invalid Signature ─► Reject (Log Attack Attempt)
                 │
                 ▼
      ┌──────────────────────┐
      │ Cache Verification   │
      │ Result               │
      └──────────┬───────────┘
                 │
                 ▼
      ┌──────────────────────┐
      │ Validate Vertex      │
      │ (Hash, Parents, etc) │
      └──────────┬───────────┘
                 │
                 ├─── Invalid ──────────► Reject
                 │
                 ▼
      ┌──────────────────────┐
      │ Add to DAG           │
      └──────────┬───────────┘
                 │
                 ▼
      ┌──────────────────────┐
      │ Initiate Consensus   │
      └────────────────────────┘
```

### 5.2 Query/Response Verification Flow

```
┌────────────────────────────────────────────────────────────────┐
│           Consensus Query/Response Received                    │
└────────────────┬───────────────────────────────────────────────┘
                 │
                 ▼
      ┌──────────────────────┐
      │ Deserialize Message  │
      └──────────┬───────────┘
                 │
                 ▼
      ┌──────────────────────┐
      │ Extract Signature    │
      │ and Sender ID        │
      └──────────┬───────────┘
                 │
                 ▼
      ┌──────────────────────┐
      │ Check Timestamp      │
      │ (Replay Prevention)  │
      └──────────┬───────────┘
                 │
                 ├─── Too Old ──────────► Reject (Expired)
                 ├─── Future ───────────► Reject (Clock Skew)
                 │
                 ▼
      ┌──────────────────────┐
      │ Lookup Sender's      │
      │ Public Key           │
      └──────────┬───────────┘
                 │
                 ├─── Not Found ─────────► Reject (Unknown Peer)
                 │
                 ▼
      ┌──────────────────────┐
      │ Verify Signature     │
      └──────────┬───────────┘
                 │
                 ├─── Invalid ───────────► Reject + Ban Peer (Byzantine)
                 │
                 ▼
      ┌──────────────────────┐
      │ Check Nonce/QueryID  │
      │ (Duplicate Detect)   │
      └──────────┬───────────┘
                 │
                 ├─── Duplicate ─────────► Reject (Already Processed)
                 │
                 ▼
      ┌──────────────────────┐
      │ Process Query or     │
      │ Aggregate Response   │
      └────────────────────────┘
```

### 5.3 Order Verification Flow

```
┌────────────────────────────────────────────────────────────────┐
│              Marketplace Order Received                        │
└────────────────┬───────────────────────────────────────────────┘
                 │
                 ▼
      ┌──────────────────────┐
      │ Parse Order Message  │
      └──────────┬───────────┘
                 │
                 ▼
      ┌──────────────────────┐
      │ Extract Signature    │
      │ and Buyer ID         │
      └──────────┬───────────┘
                 │
                 ▼
      ┌──────────────────────┐
      │ Validate Order       │
      │ Structure            │
      └──────────┬───────────┘
                 │
                 ├─── Invalid Fields ────► Reject
                 │
                 ▼
      ┌──────────────────────┐
      │ Lookup Buyer's       │
      │ Public Key           │
      └──────────┬───────────┘
                 │
                 ├─── Not Found ─────────► Reject (Unknown Buyer)
                 │
                 ▼
      ┌──────────────────────┐
      │ Verify Signature     │
      └──────────┬───────────┘
                 │
                 ├─── Invalid ───────────► Reject + Alert
                 │
                 ▼
      ┌──────────────────────┐
      │ Check Listing Exists │
      └──────────┬───────────┘
                 │
                 ├─── Not Found ─────────► Reject
                 │
                 ▼
      ┌──────────────────────┐
      │ Verify Listing       │
      │ Signature            │
      └──────────┬───────────┘
                 │
                 ├─── Invalid ───────────► Reject (Fake Listing)
                 │
                 ▼
      ┌──────────────────────┐
      │ Submit to Consensus  │
      │ (if enabled)         │
      └──────────┬───────────┘
                 │
                 ▼
      ┌──────────────────────┐
      │ Execute Order        │
      └────────────────────────┘
```

### 5.4 Error Handling Specification

**Signature Verification Errors:**

```rust
pub enum SignatureError {
    /// Signature missing
    MissingSignature {
        message_id: String,
        message_type: String,
    },

    /// Invalid signature format (parsing failed)
    InvalidFormat {
        error: String,
    },

    /// Signature verification failed (cryptographic failure)
    VerificationFailed {
        signer_id: String,
        reason: String,
    },

    /// Signer public key not found
    UnknownSigner {
        signer_id: String,
    },

    /// Expired signature
    Expired {
        timestamp: SystemTime,
        max_age: Duration,
    },

    /// Replay attack detected
    ReplayDetected {
        message_id: String,
        original_timestamp: SystemTime,
    },
}
```

**Error Handling Policy:**

| Error Type | Action | Log Level | Alert |
|------------|--------|-----------|-------|
| MissingSignature | Reject message | WARN | No |
| InvalidFormat | Reject message | WARN | No |
| VerificationFailed | Reject + Ban peer (temp) | ERROR | Yes |
| UnknownSigner | Reject + Request key | INFO | No |
| Expired | Reject message | INFO | No |
| ReplayDetected | Reject + Ban peer (perm) | CRITICAL | Yes |

**Temporary Ban Policy:**

```rust
pub struct BanPolicy {
    /// First offense ban duration
    pub initial_ban: Duration, // 1 hour

    /// Ban duration multiplier for repeat offenses
    pub multiplier: f64, // 2.0

    /// Maximum ban duration
    pub max_ban: Duration, // 7 days

    /// Time window for offense tracking
    pub offense_window: Duration, // 24 hours
}
```

---

## 6. Byzantine Attack Scenarios

### 6.1 Attack Taxonomy

#### 6.1.1 Signature Forgery Attack

**Scenario:** Attacker creates vertices signed with forged signatures

**Attack Vector:**
1. Attacker generates vertex with fake creator ID
2. Creates random signature bytes
3. Broadcasts to network

**Mitigation:**
- ML-DSA signature verification will fail
- Message rejected before entering DAG
- Peer temporarily banned for repeated attempts

**Test Case:**

```rust
#[test]
fn test_signature_forgery_attack() {
    let node = create_test_node();
    let signature_manager = create_test_signature_manager();

    // Create vertex with fake signature
    let mut fake_vertex = create_test_vertex();
    fake_vertex.signature = vec![0u8; 4595]; // ML-DSA-87 signature size but random

    // Try to broadcast
    let result = node.handle_vertex(&fake_vertex, &signature_manager);

    // Should fail verification
    assert!(result.is_err());
    assert_matches!(result.unwrap_err(),
        NetworkError::Signature(SignatureError::VerificationFailed { .. })
    );

    // Peer should be banned
    assert!(node.is_peer_banned(&fake_vertex.creator));
}
```

#### 6.1.2 Replay Attack

**Scenario:** Attacker replays old valid signed messages

**Attack Vector:**
1. Attacker captures legitimate signed vertex/query
2. Re-broadcasts same message later
3. Attempts to cause double-spend or consensus confusion

**Mitigation:**
- Timestamp validation (reject if > 60 seconds old)
- Nonce/message ID tracking (reject duplicates)
- Signature cache prevents re-processing

**Test Case:**

```rust
#[test]
fn test_replay_attack() {
    let node = create_test_node();
    let signature_manager = create_test_signature_manager();

    // Create and sign legitimate vertex
    let vertex = create_and_sign_vertex(&signature_manager);

    // Process first time (should succeed)
    assert!(node.handle_vertex(&vertex, &signature_manager).is_ok());

    // Try to replay same vertex (should fail)
    let result = node.handle_vertex(&vertex, &signature_manager);
    assert!(result.is_err());
    assert_matches!(result.unwrap_err(),
        NetworkError::Signature(SignatureError::ReplayDetected { .. })
    );
}
```

#### 6.1.3 Sybil Attack

**Scenario:** Single attacker creates multiple fake identities

**Attack Vector:**
1. Attacker generates multiple ML-DSA keypairs
2. Creates fake peer IDs for each
3. Participates in consensus with multiple votes

**Mitigation:**
- Peer reputation system (requires history)
- Stake-based consensus (requires economic cost)
- Proof-of-work for peer identity (computational cost)
- Social graph analysis (detect isolated clusters)

**Test Case:**

```rust
#[test]
fn test_sybil_attack_detection() {
    let consensus_node = create_consensus_node();

    // Attacker creates 10 fake identities
    let fake_peers: Vec<_> = (0..10)
        .map(|i| create_fake_peer(&format!("sybil-{}", i)))
        .collect();

    // All fake peers vote the same way
    let vertex_id = "target-vertex";
    for peer in &fake_peers {
        consensus_node.submit_vote(vertex_id, true, peer);
    }

    // Sybil detection should identify coordinated behavior
    let sybil_detected = consensus_node.detect_sybil_attack(vertex_id);
    assert!(sybil_detected);

    // Entire cluster should be isolated
    for peer in &fake_peers {
        assert!(consensus_node.is_peer_banned(&peer.id));
    }
}
```

#### 6.1.4 Key Compromise Attack

**Scenario:** Attacker steals a legitimate node's private key

**Attack Vector:**
1. Attacker compromises node's storage
2. Extracts encrypted secret key
3. Brute-forces or obtains decryption key
4. Signs malicious messages as legitimate node

**Mitigation:**
- Key rotation policy (limits damage window)
- Anomaly detection (unusual signing patterns)
- Key revocation mechanism
- Hardware security modules (future)

**Test Case:**

```rust
#[test]
fn test_key_compromise_mitigation() {
    let key_manager = create_key_manager();
    let node_id = "compromised-node";

    // Simulate compromise detection
    key_manager.detect_compromise(node_id);

    // Old key should be immediately revoked
    let old_key_id = key_manager.get_active_key(node_id).unwrap();
    assert_eq!(key_manager.get_key_status(&old_key_id), KeyStatus::Revoked);

    // New key should be automatically generated
    let new_key_id = key_manager.get_active_key(node_id).unwrap();
    assert_ne!(old_key_id, new_key_id);

    // Messages signed with old key should be rejected
    let old_signature = sign_with_key(&old_key_id, b"test");
    let result = key_manager.verify(b"test", &old_signature, &old_key_id);
    assert!(result.is_err());
}
```

#### 6.1.5 Consensus Stalling Attack

**Scenario:** Attacker sends invalid signatures to slow consensus

**Attack Vector:**
1. Attacker participates in consensus
2. Sends queries/responses with invalid signatures
3. Honest nodes waste CPU on verification
4. Consensus rounds timeout

**Mitigation:**
- Signature cache (prevents redundant verification)
- Fast-fail signature checks (reject malformed early)
- Peer banning (isolate repeat offenders)
- Reputation-weighted sampling (avoid low-rep peers)

**Test Case:**

```rust
#[test]
fn test_consensus_stalling_attack() {
    let consensus_node = create_consensus_node();
    let attacker_id = "staller";

    // Attacker sends 1000 queries with invalid signatures
    for i in 0..1000 {
        let invalid_query = create_invalid_query(&format!("query-{}", i), attacker_id);
        consensus_node.handle_query(&invalid_query);
    }

    // Peer should be banned before processing all
    assert!(consensus_node.is_peer_banned(attacker_id));

    // Consensus should still complete
    let vertex_id = "test-vertex";
    let finalized = consensus_node.run_consensus(vertex_id);
    assert!(finalized);
}
```

### 6.2 Byzantine Fault Tolerance Threshold

**Assumption:** Up to f Byzantine nodes in network of 3f + 1

**Signature-Specific BFT Requirements:**

1. **Query Responses:** Need 2f + 1 valid signatures for quorum
2. **Vertex Finalization:** Need > 2/3 of sampled peers with valid signatures
3. **Key Distribution:** Need majority of network to accept new keys
4. **Signature Verification:** Any single valid signature proves authenticity

**Configuration:**

```rust
pub struct BFTConfig {
    /// Maximum Byzantine nodes tolerated
    pub max_byzantine_ratio: f64, // 0.33 (1/3)

    /// Minimum network size for BFT guarantees
    pub min_network_size: usize, // 10

    /// Quorum threshold (must be > 2/3)
    pub quorum_threshold: f64, // 0.67

    /// Sample size for consensus queries
    pub sample_size: usize, // 10
}
```

---

## 7. Test Specifications

### 7.1 Unit Test Requirements

#### 7.1.1 Signature Operations

```rust
mod signature_tests {
    use super::*;

    #[test]
    fn test_sign_and_verify_success() {
        let sig_manager = SignatureManager::new();
        let key_id = sig_manager.generate_key(KeyPurpose::NodeIdentity, "test").unwrap();

        let data = b"test message";
        let signature = sig_manager.sign(data, &key_id).unwrap();

        let public_key = sig_manager.get_public_key(&key_id).unwrap();
        let result = sig_manager.verify(data, &signature, &public_key);

        assert!(result.is_ok());
    }

    #[test]
    fn test_verify_wrong_key_fails() {
        let sig_manager = SignatureManager::new();
        let key1 = sig_manager.generate_key(KeyPurpose::NodeIdentity, "key1").unwrap();
        let key2 = sig_manager.generate_key(KeyPurpose::NodeIdentity, "key2").unwrap();

        let data = b"test message";
        let signature = sig_manager.sign(data, &key1).unwrap();

        let wrong_public_key = sig_manager.get_public_key(&key2).unwrap();
        let result = sig_manager.verify(data, &signature, &wrong_public_key);

        assert!(result.is_err());
    }

    #[test]
    fn test_verify_wrong_data_fails() {
        let sig_manager = SignatureManager::new();
        let key_id = sig_manager.generate_key(KeyPurpose::NodeIdentity, "test").unwrap();

        let original_data = b"original message";
        let modified_data = b"modified message";

        let signature = sig_manager.sign(original_data, &key_id).unwrap();
        let public_key = sig_manager.get_public_key(&key_id).unwrap();

        let result = sig_manager.verify(modified_data, &signature, &public_key);
        assert!(result.is_err());
    }

    #[test]
    fn test_batch_sign_verify() {
        let sig_manager = SignatureManager::new();
        let key_id = sig_manager.generate_key(KeyPurpose::NodeIdentity, "test").unwrap();

        let messages = vec![b"msg1", b"msg2", b"msg3"];
        let signatures = sig_manager.batch_sign(messages.clone(), &key_id).await.unwrap();

        assert_eq!(signatures.len(), 3);

        let public_key = sig_manager.get_public_key(&key_id).unwrap();
        for (msg, sig) in messages.iter().zip(signatures.iter()) {
            assert!(sig_manager.verify(msg, sig, &public_key).is_ok());
        }
    }
}
```

#### 7.1.2 Key Management

```rust
mod key_management_tests {
    use super::*;

    #[test]
    fn test_key_generation() {
        let key_manager = KeyManager::new();
        let key_id = key_manager.generate_key(
            KeyPurpose::NodeIdentity,
            "test-key".to_string()
        ).unwrap();

        assert!(!key_id.is_empty());
        assert!(key_manager.get_public_key(&key_id).is_ok());
    }

    #[test]
    fn test_key_rotation() {
        let key_manager = KeyManager::new();
        let old_key_id = key_manager.generate_key(
            KeyPurpose::NodeIdentity,
            "original".to_string()
        ).unwrap();

        let new_key_id = key_manager.rotate_key(&old_key_id).unwrap();

        assert_ne!(old_key_id, new_key_id);

        // Old key should be deprecated
        let old_status = key_manager.get_key_status(&old_key_id);
        assert_eq!(old_status, KeyStatus::Deprecated);

        // New key should be active
        let new_status = key_manager.get_key_status(&new_key_id);
        assert_eq!(new_status, KeyStatus::Active);
    }

    #[test]
    fn test_key_expiration() {
        let key_manager = KeyManager::new();

        // Generate key that expires immediately
        let config = KeyGenerationConfig {
            purpose: KeyPurpose::NetworkEphemeral,
            label: "ephemeral".to_string(),
            expires_at: Some(SystemTime::now() - Duration::from_secs(1)),
            constraints: KeyConstraints::default(),
        };

        let key_id = key_manager.generate_key_with_config(config).unwrap();

        // Should be expired
        let result = key_manager.get_secret_key(&key_id);
        assert!(result.is_err());
    }

    #[test]
    fn test_peer_key_import_export() {
        let key_manager = KeyManager::new();
        let peer_id = "peer-123";

        // Generate local key
        let local_key_id = key_manager.generate_key(
            KeyPurpose::NodeIdentity,
            "local".to_string()
        ).unwrap();

        let public_key = key_manager.get_public_key(&local_key_id).unwrap();

        // Import as peer key
        key_manager.import_public_key(peer_id, public_key.clone()).unwrap();

        // Should be able to retrieve
        let retrieved = key_manager.get_peer_public_key(peer_id).unwrap();
        assert_eq!(retrieved.as_bytes(), public_key.as_bytes());
    }
}
```

#### 7.1.3 Vertex Signing/Verification

```rust
mod vertex_signature_tests {
    use super::*;

    #[test]
    fn test_vertex_sign_verify() {
        let sig_manager = SignatureManager::new();
        let key_id = sig_manager.generate_key(KeyPurpose::NodeIdentity, "creator").unwrap();

        let mut vertex = VertexBuilder::new("creator-001".to_string())
            .payload(vec![1, 2, 3])
            .build();

        // Sign vertex
        vertex.sign_with_key(&sig_manager, &key_id).unwrap();
        assert!(!vertex.signature.is_empty());

        // Verify signature
        let public_key = sig_manager.get_public_key(&key_id).unwrap();
        let result = vertex.verify_signature(&public_key, &sig_manager);
        assert!(result.is_ok());
    }

    #[test]
    fn test_vertex_signature_tampering() {
        let sig_manager = SignatureManager::new();
        let key_id = sig_manager.generate_key(KeyPurpose::NodeIdentity, "creator").unwrap();

        let mut vertex = VertexBuilder::new("creator-001".to_string())
            .payload(vec![1, 2, 3])
            .build();

        // Sign vertex
        vertex.sign_with_key(&sig_manager, &key_id).unwrap();

        // Tamper with payload
        vertex.payload = vec![4, 5, 6];

        // Verification should fail
        let public_key = sig_manager.get_public_key(&key_id).unwrap();
        let result = vertex.verify_signature(&public_key, &sig_manager);
        assert!(result.is_err());
    }

    #[test]
    fn test_genesis_vertex_signature() {
        let sig_manager = SignatureManager::new();
        let key_id = sig_manager.generate_key(KeyPurpose::NodeIdentity, "genesis").unwrap();

        let mut genesis = VertexBuilder::new("genesis-node".to_string())
            .id("genesis-0".to_string())
            .build();

        assert!(genesis.is_genesis());

        // Genesis vertices must be signed
        genesis.sign_with_key(&sig_manager, &key_id).unwrap();

        let public_key = sig_manager.get_public_key(&key_id).unwrap();
        assert!(genesis.verify_signature(&public_key, &sig_manager).is_ok());
    }
}
```

### 7.2 Integration Test Requirements

#### 7.2.1 End-to-End Consensus with Signatures

```rust
#[tokio::test]
async fn test_consensus_with_signature_verification() {
    // Setup network with 10 nodes
    let num_nodes = 10;
    let mut nodes = Vec::new();
    let mut sig_managers = Vec::new();

    for i in 0..num_nodes {
        let sig_manager = SignatureManager::new();
        let key_id = sig_manager.generate_key(
            KeyPurpose::NodeIdentity,
            format!("node-{}", i)
        ).unwrap();

        let node = ConsensusP2PNode::new(format!("node-{}", i));

        nodes.push((node, key_id));
        sig_managers.push(sig_manager);
    }

    // Exchange public keys between all nodes
    let mut peer_keys = HashMap::new();
    for (i, sig_manager) in sig_managers.iter().enumerate() {
        let key_id = &nodes[i].1;
        let public_key = sig_manager.get_public_key(key_id).unwrap();
        peer_keys.insert(format!("node-{}", i), public_key);
    }

    // Create and broadcast vertex from node 0
    let vertex = VertexMessage {
        vertex_id: "test-vertex".to_string(),
        parents: vec![],
        payload: vec![1, 2, 3],
        timestamp: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
        creator: "node-0".to_string(),
        signature: Vec::new(),
        hash: [0u8; 32],
    };

    let (node_0, key_0) = &nodes[0];
    node_0.broadcast_vertex(vertex, &sig_managers[0], key_0).unwrap();

    // All other nodes receive and verify
    for i in 1..num_nodes {
        let (node, _) = &nodes[i];
        let received_vertex = node.get_vertex("test-vertex").unwrap();

        // Verify signature
        let creator_key = peer_keys.get(&received_vertex.creator).unwrap();
        // ... verification logic
    }

    // Run consensus
    // ... consensus rounds with signed queries/responses

    // Verify final state
    // All honest nodes should finalize the vertex
}
```

#### 7.2.2 Byzantine Attack Simulation

```rust
#[tokio::test]
async fn test_byzantine_signature_attack_rejection() {
    let honest_nodes = 7;
    let byzantine_nodes = 3;
    let total_nodes = honest_nodes + byzantine_nodes;

    let mut network = create_test_network(total_nodes);

    // Byzantine nodes send invalid signatures
    for i in 0..byzantine_nodes {
        let byzantine_id = format!("byzantine-{}", i);

        // Create vertex with fake signature
        let fake_vertex = VertexMessage {
            vertex_id: format!("fake-{}", i),
            creator: byzantine_id.clone(),
            signature: vec![0u8; 4595], // Random bytes
            // ... other fields
        };

        network.broadcast_from_node(&byzantine_id, fake_vertex);
    }

    // Honest nodes should reject all byzantine messages
    for i in 0..honest_nodes {
        let honest_id = format!("honest-{}", i);
        let node = network.get_node(&honest_id);

        // Should not have any fake vertices
        for j in 0..byzantine_nodes {
            let fake_id = format!("fake-{}", j);
            assert!(node.get_vertex(&fake_id).is_none());
        }
    }

    // Byzantine nodes should be banned
    for i in 0..byzantine_nodes {
        let byzantine_id = format!("byzantine-{}", i);
        assert!(network.is_node_banned(&byzantine_id));
    }
}
```

### 7.3 Performance Test Requirements

#### 7.3.1 Signature Throughput

```rust
#[bench]
fn bench_signature_generation(b: &mut Bencher) {
    let sig_manager = SignatureManager::new();
    let key_id = sig_manager.generate_key(KeyPurpose::NodeIdentity, "bench").unwrap();
    let data = vec![0u8; 1024]; // 1KB payload

    b.iter(|| {
        sig_manager.sign(&data, &key_id).unwrap()
    });
}

#[bench]
fn bench_signature_verification(b: &mut Bencher) {
    let sig_manager = SignatureManager::new();
    let key_id = sig_manager.generate_key(KeyPurpose::NodeIdentity, "bench").unwrap();
    let data = vec![0u8; 1024];

    let signature = sig_manager.sign(&data, &key_id).unwrap();
    let public_key = sig_manager.get_public_key(&key_id).unwrap();

    b.iter(|| {
        sig_manager.verify(&data, &signature, &public_key).unwrap()
    });
}

#[tokio::bench]
async fn bench_batch_verification(b: &mut Bencher) {
    let sig_manager = SignatureManager::new();
    let key_id = sig_manager.generate_key(KeyPurpose::NodeIdentity, "bench").unwrap();

    let count = 100;
    let mut items = Vec::new();

    for i in 0..count {
        let data = format!("message-{}", i).into_bytes();
        let signature = sig_manager.sign(&data, &key_id).unwrap();
        let public_key = sig_manager.get_public_key(&key_id).unwrap();
        items.push((data, signature, public_key));
    }

    b.iter(|| {
        sig_manager.batch_verify(items.clone()).await.unwrap()
    });
}
```

**Performance Targets:**

| Operation | Target Latency | Acceptable Latency |
|-----------|----------------|-------------------|
| Sign (1KB) | < 3ms | < 5ms |
| Verify (1KB) | < 5ms | < 10ms |
| Batch Verify (100) | < 300ms | < 500ms |
| Key Generation | < 50ms | < 100ms |

#### 7.3.2 Consensus Overhead

```rust
#[tokio::test]
async fn test_consensus_latency_with_signatures() {
    let network = create_test_network(10);

    // Measure consensus without signatures (baseline)
    let baseline_start = Instant::now();
    network.run_consensus_unsigned("test-vertex-1").await;
    let baseline_duration = baseline_start.elapsed();

    // Measure consensus with signatures
    let signature_start = Instant::now();
    network.run_consensus_signed("test-vertex-2").await;
    let signature_duration = signature_start.elapsed();

    // Calculate overhead
    let overhead = (signature_duration.as_millis() as f64 / baseline_duration.as_millis() as f64) - 1.0;

    // Should be less than 10% overhead
    assert!(overhead < 0.10, "Signature overhead {} exceeds 10%", overhead);
}
```

### 7.4 Security Test Requirements

#### 7.4.1 Fuzzing

```rust
#[cfg(fuzzing)]
mod fuzz_tests {
    use super::*;
    use arbitrary::{Arbitrary, Unstructured};

    fuzz_target!(|data: &[u8]| {
        let mut unstructured = Unstructured::new(data);

        // Generate arbitrary vertex
        if let Ok(vertex_bytes) = <Vec<u8>>::arbitrary(&mut unstructured) {
            let sig_manager = SignatureManager::new();

            // Should never panic, only return errors
            let _ = VertexMessage::from_bytes(&vertex_bytes)
                .and_then(|v| v.verify_signature(&fake_key(), &sig_manager));
        }
    });

    fuzz_target!(|data: &[u8]| {
        let sig_manager = SignatureManager::new();
        let key_id = sig_manager.generate_key(KeyPurpose::NodeIdentity, "fuzz").unwrap();

        // Try to sign arbitrary data (should never panic)
        let _ = sig_manager.sign(data, &key_id);
    });
}
```

#### 7.4.2 Invariant Testing

```rust
#[cfg(test)]
mod invariant_tests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn test_signature_roundtrip(data in any::<Vec<u8>>()) {
            let sig_manager = SignatureManager::new();
            let key_id = sig_manager.generate_key(KeyPurpose::NodeIdentity, "prop").unwrap();

            // Sign data
            let signature = sig_manager.sign(&data, &key_id).unwrap();

            // Verify should always succeed
            let public_key = sig_manager.get_public_key(&key_id).unwrap();
            prop_assert!(sig_manager.verify(&data, &signature, &public_key).is_ok());
        }

        #[test]
        fn test_signature_uniqueness(data1 in any::<Vec<u8>>(), data2 in any::<Vec<u8>>()) {
            prop_assume!(data1 != data2);

            let sig_manager = SignatureManager::new();
            let key_id = sig_manager.generate_key(KeyPurpose::NodeIdentity, "prop").unwrap();

            let sig1 = sig_manager.sign(&data1, &key_id).unwrap();
            let sig2 = sig_manager.sign(&data2, &key_id).unwrap();

            // Different data should produce different signatures
            prop_assert_ne!(sig1.as_bytes(), sig2.as_bytes());
        }
    }
}
```

---

## 8. Dependencies and Integration Points

### 8.1 cretoai-crypto Integration

**Current Implementation:** `/Users/tommaduri/vigilia/src/crypto/`

**Required Components:**

1. **ML-DSA-87 Wrapper** (`src/crypto/src/signatures/dilithium.rs`) ✅ EXISTS
   - Already implemented with `pqcrypto-dilithium`
   - Provides: `MLDSA87`, `MLDSA87KeyPair`, `MLDSA87Signature`

2. **Thread Safety Wrapper** (NEW)
   ```rust
   // src/crypto/src/signatures/thread_safe.rs
   use std::sync::Arc;
   use parking_lot::RwLock;

   pub struct ThreadSafeSigner {
       inner: Arc<RwLock<MLDSA87KeyPair>>,
   }

   impl ThreadSafeSigner {
       pub fn sign(&self, data: &[u8]) -> Result<MLDSA87Signature> {
           let keypair = self.inner.read();
           Ok(keypair.sign(data))
       }
   }
   ```

3. **Error Types** (`src/crypto/src/error.rs`) ✅ EXISTS
   - Already has `SignatureVerificationFailed`
   - Need to add: `SignatureExpired`, `SignatureReplay`, `UnknownSigner`

### 8.2 DAG Module Integration

**Files to Modify:**

1. `src/dag/src/vertex.rs`
   - Add `sign_with_key()` method
   - Replace `verify_signature()` implementation
   - Add `compute_signing_payload()` helper

2. `src/dag/src/graph.rs`
   - Add signature verification on `add_vertex()`
   - Store creator public keys alongside vertices

3. `src/dag/src/consensus.rs`
   - Add signature manager parameter to consensus methods
   - Verify all vertices before consensus queries

### 8.3 Network Module Integration

**Files to Modify:**

1. `src/network/src/consensus_p2p.rs`
   - Add signature manager to `ConsensusP2PNode`
   - Replace all TODO signature placeholders
   - Add peer key distribution

2. `src/network/src/exchange_p2p.rs`
   - Add signature manager to `ExchangeP2PNode`
   - Sign all listings/orders/updates
   - Verify incoming messages

3. `src/network/src/gossip.rs`
   - Add signature field to `Message` struct
   - Verify signatures before propagation

### 8.4 Vault Module Integration

**Files to Modify:**

1. `src/vault/src/keys.rs`
   - Implement `KeyManager` for ML-DSA keys
   - Add key rotation logic
   - Implement secure storage

2. `src/vault/src/storage.rs`
   - Add encrypted key storage
   - Implement access control

3. `src/vault/src/crypto_integration.rs` ✅ EXISTS
   - Already has crypto module integration
   - Need to add signature-specific operations

### 8.5 Dependency Tree

```
cretoai-network
├── cretoai-crypto (signatures, keys)
│   └── pqcrypto-dilithium (ML-DSA-87)
├── cretoai-dag (vertex signing)
│   └── cretoai-crypto
├── cretoai-vault (key storage)
│   └── cretoai-crypto
└── cretoai-exchange (order signing)
    └── cretoai-crypto
```

**New Dependencies Required:**

```toml
[dependencies]
# Existing
pqcrypto-dilithium = "0.5"
pqcrypto-traits = "0.3"
blake3 = "1.5"
bincode = "1.3"
serde = { version = "1.0", features = ["derive"] }
uuid = { version = "1.0", features = ["v4"] }

# New for signature integration
parking_lot = "0.12"  # Thread-safe RwLock
lru = "0.12"          # Signature cache
tracing = "0.1"       # Audit logging
tokio = { version = "1.0", features = ["sync", "time"] }  # Async ops
```

### 8.6 Thread Safety Considerations

**Concurrent Access Patterns:**

1. **Signature Generation:**
   - Multiple threads may sign concurrently
   - Use `Arc<SignatureManager>` for shared access
   - Key access protected by `RwLock`

2. **Signature Verification:**
   - Highly concurrent (verifying network messages)
   - Use signature cache with `Arc<RwLock<LruCache>>`
   - Public keys are read-only (safe to clone)

3. **Key Rotation:**
   - Exclusive write access required
   - Use write lock on `KeyManager`
   - Atomic swap of active key

**Implementation:**

```rust
pub struct SignatureManager {
    key_manager: Arc<RwLock<KeyManager>>,
    cache: Arc<RwLock<SignatureCache>>,
}

// Safe to clone and share across threads
impl Clone for SignatureManager {
    fn clone(&self) -> Self {
        SignatureManager {
            key_manager: Arc::clone(&self.key_manager),
            cache: Arc::clone(&self.cache),
        }
    }
}
```

---

## 9. Implementation Roadmap

### 9.1 Phase 1: Foundation (Week 1-2)

**Deliverables:**

1. ✅ **Specification Document** (THIS DOCUMENT)
   - Complete security analysis
   - Design signatures for all modules
   - Test specifications

2. **Signature Manager Implementation**
   - Create `cretoai-crypto/src/signature_manager.rs`
   - Implement sign/verify APIs
   - Add signature cache
   - Unit tests

3. **Key Manager Implementation**
   - Create `cretoai-vault/src/key_manager.rs`
   - Implement key generation/storage
   - Add rotation logic
   - Unit tests

### 9.2 Phase 2: DAG Integration (Week 3)

**Deliverables:**

1. **Vertex Signing**
   - Modify `src/dag/src/vertex.rs`
   - Implement `sign_with_key()` and `verify_signature()`
   - Add `compute_signing_payload()`
   - Unit tests

2. **Graph Integration**
   - Modify `src/dag/src/graph.rs`
   - Add signature verification on vertex add
   - Store creator public keys
   - Integration tests

3. **Consensus Integration**
   - Modify `src/dag/src/consensus.rs`
   - Add signature manager parameter
   - Verify vertices before queries
   - Integration tests

### 9.3 Phase 3: Network Integration (Week 4-5)

**Deliverables:**

1. **Consensus P2P**
   - Modify `src/network/src/consensus_p2p.rs`
   - Replace all signature TODOs
   - Implement peer key exchange
   - Integration tests

2. **Exchange P2P**
   - Modify `src/network/src/exchange_p2p.rs`
   - Sign listings/orders/updates
   - Verify incoming messages
   - Integration tests

3. **Gossip Protocol**
   - Modify `src/network/src/gossip.rs`
   - Add signature field to messages
   - Verify before propagation
   - Integration tests

### 9.4 Phase 4: Security Testing (Week 6)

**Deliverables:**

1. **Byzantine Attack Tests**
   - Signature forgery tests
   - Replay attack tests
   - Sybil attack tests
   - Key compromise tests
   - Consensus stalling tests

2. **Fuzzing**
   - Set up cargo-fuzz
   - Fuzz vertex signatures
   - Fuzz network messages
   - Fix discovered issues

3. **Performance Testing**
   - Benchmark signature throughput
   - Measure consensus overhead
   - Optimize critical paths
   - Document results

### 9.5 Phase 5: Documentation & Deployment (Week 7)

**Deliverables:**

1. **API Documentation**
   - Rustdoc for all public APIs
   - Usage examples
   - Migration guide

2. **Security Audit**
   - External security review
   - Penetration testing
   - Fix critical issues

3. **Deployment**
   - Production deployment plan
   - Key generation for all nodes
   - Phased rollout
   - Monitoring

---

## 10. Acceptance Criteria

### 10.1 Functional Requirements

- [ ] All signature placeholders replaced with ML-DSA operations
- [ ] Vertex signing/verification implemented
- [ ] Query/response signing implemented
- [ ] Order/listing signing implemented
- [ ] Key generation and storage functional
- [ ] Key rotation mechanism working
- [ ] Peer key distribution operational

### 10.2 Security Requirements

- [ ] Zero invalid signatures accepted in production
- [ ] Byzantine attack tests pass (5 scenarios)
- [ ] Fuzzing runs 24h without crashes
- [ ] No key material exposed in logs/errors
- [ ] All audit events logged
- [ ] Temporary ban policy functional

### 10.3 Performance Requirements

- [ ] Signature generation < 5ms (95th percentile)
- [ ] Signature verification < 10ms (95th percentile)
- [ ] Consensus overhead < 10%
- [ ] Cache hit rate > 60%
- [ ] Key rotation < 100ms

### 10.4 Test Coverage Requirements

- [ ] Unit test coverage > 90%
- [ ] Integration test coverage > 80%
- [ ] All Byzantine attack scenarios tested
- [ ] Performance benchmarks passing
- [ ] Fuzzing integrated into CI

### 10.5 Documentation Requirements

- [ ] All public APIs documented (Rustdoc)
- [ ] Usage examples provided
- [ ] Migration guide written
- [ ] Security considerations documented
- [ ] Deployment guide created

---

## 11. Risk Assessment

### 11.1 Technical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| ML-DSA performance issues | HIGH | LOW | Benchmark early, optimize, use caching |
| Key storage compromise | CRITICAL | LOW | Use vault encryption, access control |
| Signature cache bugs | MEDIUM | MEDIUM | Extensive unit tests, invariant testing |
| Thread safety issues | HIGH | MEDIUM | Use proven concurrency primitives |
| Byzantine attacks | HIGH | HIGH | Comprehensive attack testing |

### 11.2 Integration Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Breaking existing consensus | CRITICAL | MEDIUM | Phased rollout, feature flags |
| Key distribution failures | HIGH | MEDIUM | Fallback to out-of-band key exchange |
| Peer incompatibility | MEDIUM | HIGH | Version negotiation, backward compat |
| Storage migration issues | MEDIUM | LOW | Thorough migration testing |

### 11.3 Operational Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Key loss/corruption | CRITICAL | LOW | Regular backups, recovery procedures |
| Performance degradation | MEDIUM | MEDIUM | Monitoring, auto-scaling |
| Audit log overflow | LOW | MEDIUM | Log rotation, compression |
| Clock skew issues | MEDIUM | MEDIUM | NTP sync, timestamp tolerance |

---

## 12. Future Enhancements (Out of Scope)

### 12.1 Hybrid Signatures (Option 2)

- Combine ML-DSA with Ed25519
- Provides defense-in-depth
- Smooth transition path

### 12.2 Hardware Security Modules

- Store keys in HSM
- FIPS 140-2 compliance
- Enterprise deployment

### 12.3 Threshold Signatures

- Require k-of-n signatures
- Enhanced security for critical operations
- Multi-party computation

### 12.4 Signature Aggregation

- Combine multiple signatures into one
- Reduce bandwidth/storage
- BLS-style aggregation

### 12.5 Zero-Knowledge Proofs

- Prove signature validity without revealing key
- Enhanced privacy
- zk-SNARKs integration

---

## 13. References

### 13.1 Standards and Specifications

1. **NIST FIPS 204** - Module-Lattice-Based Digital Signature Standard (ML-DSA)
   - https://csrc.nist.gov/publications/detail/fips/204/final

2. **CRYSTALS-Dilithium** - Original ML-DSA research
   - https://pq-crystals.org/dilithium/

3. **RFC 9380** - Byzantine Fault Tolerance
   - https://www.rfc-editor.org/rfc/rfc9380

### 13.2 Implementation References

1. **pqcrypto-dilithium** - Rust implementation
   - https://github.com/rustpq/pqcrypto

2. **BLAKE3** - Cryptographic hash function
   - https://github.com/BLAKE3-team/BLAKE3

3. **CretoAI Crypto Module** - Internal implementation
   - `/Users/tommaduri/vigilia/src/crypto/`

### 13.3 Security Research

1. **"Security Analysis of ML-DSA"** - NIST, 2024
2. **"Byzantine Fault Tolerance in Distributed Systems"** - Castro & Liskov, 1999
3. **"Post-Quantum Cryptography for DAGs"** - Research paper (hypothetical)

---

## Appendix A: Cryptographic Primitives

### A.1 ML-DSA-87 Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| Security Level | NIST Level 5 | 256-bit quantum security |
| Public Key Size | 2,592 bytes | Verification key |
| Secret Key Size | 4,864 bytes | Signing key |
| Signature Size | 4,595 bytes | Signature output |
| Signing Time | ~2-3ms | Average on modern CPU |
| Verification Time | ~4-5ms | Average on modern CPU |

### A.2 BLAKE3 Hash Properties

| Property | Value |
|----------|-------|
| Output Size | 32 bytes (256 bits) |
| Collision Resistance | 2^128 operations |
| Preimage Resistance | 2^256 operations |
| Performance | ~10 GB/s on modern CPU |

---

## Appendix B: Signature Message Formats

### B.1 Vertex Signing Payload

```rust
struct VertexSigningPayload {
    version: u8,              // 1 byte
    vertex_id: String,        // Variable
    timestamp: u64,           // 8 bytes
    parents: Vec<String>,     // Variable (sorted)
    payload_hash: [u8; 32],   // BLAKE3 of payload
    creator: String,          // Variable
}

// Serialized with bincode, then signed
```

### B.2 Query Signing Payload

```rust
struct QuerySigningPayload {
    version: u8,              // 1 byte
    query_id: String,         // Variable
    vertex_id: String,        // Variable
    requester: String,        // Variable
    timestamp: u64,           // 8 bytes
}
```

### B.3 Order Signing Payload

```rust
struct OrderSigningPayload {
    version: u8,              // 1 byte
    order_id: String,         // Variable
    listing_id: String,       // Variable
    buyer_id: String,         // Variable
    quantity: f64,            // 8 bytes
    total_price: f64,         // 8 bytes
    timestamp: i64,           // 8 bytes
}
```

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-26 | Claude (Specification Agent) | Initial specification |

---

**END OF SPECIFICATION**

This specification provides a comprehensive design for integrating ML-DSA quantum-resistant signatures into the CretoAI codebase, addressing all identified security gaps while maintaining performance and Byzantine fault tolerance requirements.
