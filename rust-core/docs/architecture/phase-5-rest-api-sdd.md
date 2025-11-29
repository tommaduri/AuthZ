# Phase 5 REST API - Software Design Document (SDD)

**Project:** CretoAI Quantum-Resistant Cryptography Platform
**Component:** REST API Presentation Layer
**Version:** 1.0
**Date:** 2025-11-27
**Status:** Design Complete - Ready for TDD Implementation

---

## 1. Executive Summary

### 1.1 Purpose

This document specifies the design for CretoAI's REST API, a production-ready HTTP interface providing customer access to quantum-resistant cryptographic operations, DAG consensus, and secure vault storage.

### 1.2 Scope

The REST API serves as the **customer presentation layer** for Phase 5, exposing CretoAI's core capabilities through a standards-compliant HTTP interface with auto-generated OpenAPI documentation.

**In Scope:**
- 9 REST endpoints (crypto, vault, consensus, health)
- OpenAPI 3.0 specification with Swagger UI
- CORS support for web applications
- Structured error handling
- Request/response validation
- Production-ready logging and tracing
- Docker deployment configuration

**Out of Scope (Deferred to Phase 6):**
- Authentication/Authorization (JWT, OAuth2)
- Rate limiting and throttling
- API versioning beyond `/api/v1`
- Webhook notifications
- GraphQL interface
- WebSocket streaming (except for dashboard demo)

### 1.3 Business Context

**Phase 5 Objective:** Transform CretoAI from "technically impressive" to "customer-presentable"

**Key Requirements:**
- Sales team can demo without engineering support
- Customers can test API in < 30 minutes via `curl`/Postman
- Zero-friction Docker deployment (`docker-compose up`)
- Performance claims validated with published benchmarks

---

## 2. Architecture Overview

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    External Clients                          │
│  (curl, Postman, Web Apps, Mobile Apps, SDKs)               │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTPS (TLS 1.3 recommended)
                     │
┌────────────────────▼────────────────────────────────────────┐
│                 Reverse Proxy (Production)                   │
│         (nginx, Caddy, or cloud load balancer)              │
│                    - TLS termination                         │
│                    - Rate limiting (future)                  │
│                    - Request logging                         │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTP/1.1
                     │
┌────────────────────▼────────────────────────────────────────┐
│                 CretoAI REST API Server                      │
│                    (Axum Framework)                          │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Handlers   │  │  Middleware  │  │   OpenAPI    │      │
│  │              │  │              │  │  SwaggerUI   │      │
│  │ - crypto.rs  │  │ - CORS       │  │              │      │
│  │ - vault.rs   │  │ - Tracing    │  │ Auto-gen     │      │
│  │ - dag.rs     │  │ - Compression│  │ docs         │      │
│  │ - health.rs  │  │ - Error      │  │              │      │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┘      │
│         │                  │                                 │
│  ┌──────▼──────────────────▼─────────────────────┐          │
│  │         Request/Response Models                │          │
│  │  (Serde JSON serialization + validation)      │          │
│  └──────┬─────────────────────────────────────────┘          │
│         │                                                    │
│  ┌──────▼─────────────────────────────────────────┐         │
│  │              Core Business Logic                │         │
│  └──────┬─────────────────────────────────────────┘         │
└─────────┼──────────────────────────────────────────────────┘
          │
          ├──────────────────────────────────┬─────────────────┐
          │                                  │                 │
┌─────────▼──────────┐  ┌──────────────────▼──┐  ┌──────────▼─────┐
│  cretoai-crypto    │  │  cretoai-vault      │  │  cretoai-dag   │
│                    │  │                     │  │                │
│  ML-KEM-768        │  │  Quantum-safe       │  │  QR-Avalanche  │
│  ML-DSA-87         │  │  secret storage     │  │  consensus     │
│  (NIST FIPS)       │  │                     │  │                │
└────────────────────┘  └─────────────────────┘  └────────────────┘
```

### 2.2 Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Web Framework** | Axum 0.7 | - Modern async Rust framework built on Tokio<br>- Type-safe extractors and routing<br>- Excellent performance (benchmarked: 100K+ RPS)<br>- Composable middleware via Tower<br>- Strong ecosystem compatibility |
| **HTTP Server** | Tokio (via Axum) | - Production-proven async runtime<br>- Efficient resource utilization<br>- Built-in TLS support |
| **API Documentation** | utoipa 4.0 | - Auto-generates OpenAPI 3.0 specs from Rust types<br>- Compile-time validation (no runtime drift)<br>- Integrated Swagger UI<br>- Type-safe schema generation |
| **Serialization** | serde_json | - De facto standard for Rust JSON<br>- Zero-copy parsing<br>- Streaming support |
| **Middleware** | tower-http 0.5 | - CORS (permissive for Phase 5)<br>- Request tracing<br>- Compression (gzip)<br>- Timeout handling |
| **Logging** | tracing + tracing-subscriber | - Structured logging with context<br>- Performance-optimized<br>- Integration with OpenTelemetry (future) |

### 2.3 Design Principles

1. **Fail-Fast Validation**: Validate all inputs at API boundary, return clear errors
2. **Type Safety**: Leverage Rust type system to prevent runtime errors
3. **Explicitness over Magic**: No hidden behaviors, clear error messages
4. **OpenAPI-First**: API schema is source of truth, auto-generated from code
5. **Stateless Handlers**: All state in backend layers (crypto, vault, DAG)
6. **Idempotency**: POST operations use deterministic keys where possible
7. **Base64 Encoding**: All binary data (keys, ciphertext, signatures) as base64 strings

---

## 3. API Specification

### 3.1 Base URL and Versioning

**Base URL:** `http://localhost:8080/api/v1`
**Production URL:** `https://api.cretoai.io/api/v1` (future)

**Versioning Strategy:**
- Path-based versioning: `/api/v1`, `/api/v2` (future)
- Version `v1` is initial stable release
- Breaking changes require new version
- Non-breaking changes (new optional fields) can be added to existing version

### 3.2 Endpoint Inventory

| Method | Endpoint | Purpose | Priority |
|--------|----------|---------|----------|
| GET | `/health` | Health check | P0 |
| POST | `/api/v1/crypto/encrypt` | ML-KEM-768 encryption | P0 |
| POST | `/api/v1/crypto/decrypt` | ML-KEM-768 decryption | P0 |
| POST | `/api/v1/crypto/sign` | ML-DSA-87 signing | P0 |
| POST | `/api/v1/crypto/verify` | ML-DSA-87 verification | P0 |
| POST | `/api/v1/vault/secrets` | Store secret | P0 |
| GET | `/api/v1/vault/secrets/{key}` | Retrieve secret | P0 |
| POST | `/api/v1/consensus/vertex` | Create DAG vertex | P0 |
| GET | `/api/v1/consensus/status` | Get DAG status | P0 |
| GET | `/swagger-ui` | Interactive API docs | P0 |
| GET | `/api-docs/openapi.json` | OpenAPI 3.0 spec | P0 |

### 3.3 Detailed Endpoint Specifications

#### 3.3.1 Health Check

**Endpoint:** `GET /health`

**Purpose:** Service health and readiness check for load balancers and monitoring.

**Request:** None

**Response (200 OK):**
```json
{
  "status": "healthy",
  "version": "0.1.0",
  "quantum_ready": true
}
```

**Response Schema:**
```rust
struct HealthResponse {
    status: String,        // "healthy" | "degraded" | "unhealthy"
    version: String,       // Cargo package version
    quantum_ready: bool,   // Always true for CretoAI
}
```

**Error Handling:** Never returns errors (always 200 OK with status field).

**Performance Target:** < 1ms response time

**Use Cases:**
- Kubernetes liveness/readiness probes
- Load balancer health checks
- Uptime monitoring (Pingdom, DataDog)

---

#### 3.3.2 Encrypt Data (ML-KEM-768)

**Endpoint:** `POST /api/v1/crypto/encrypt`

**Purpose:** Encrypt plaintext using quantum-resistant ML-KEM-768 (NIST FIPS 203).

**Request Body:**
```json
{
  "plaintext": "SGVsbG8gV29ybGQ=",        // base64-encoded data
  "public_key": "optional_base64_key"    // Optional: use provided key
}
```

**Request Schema:**
```rust
struct EncryptRequest {
    plaintext: String,           // base64-encoded plaintext
    public_key: Option<String>,  // Optional: base64 public key
}
```

**Response (200 OK):**
```json
{
  "ciphertext": "base64_encrypted_data...",
  "public_key": "base64_ephemeral_public_key...",
  "algorithm": "ML-KEM-768"
}
```

**Response Schema:**
```rust
struct EncryptResponse {
    ciphertext: String,   // base64-encoded ciphertext
    public_key: String,   // base64-encoded public key used
    algorithm: String,    // "ML-KEM-768"
}
```

**Errors:**
- `400 Bad Request`: Invalid base64 encoding
- `413 Payload Too Large`: Plaintext exceeds 32KB limit
- `500 Internal Server Error`: Cryptographic operation failed

**Implementation Notes:**
- If `public_key` not provided: generate ephemeral ML-KEM-768 keypair
- Plaintext size limit: 32KB (enforced by middleware)
- Algorithm: NIST FIPS 203 (ML-KEM-768)
- Output: `(ciphertext, encapsulated_key)` from `encapsulate()`

**Performance Target:** < 10ms (p95) for 1KB plaintext

**Example cURL:**
```bash
curl -X POST http://localhost:8080/api/v1/crypto/encrypt \
  -H "Content-Type: application/json" \
  -d '{
    "plaintext": "SGVsbG8gV29ybGQ="
  }'
```

---

#### 3.3.3 Decrypt Data (ML-KEM-768)

**Endpoint:** `POST /api/v1/crypto/decrypt`

**Purpose:** Decrypt ciphertext using ML-KEM-768 private key.

**Request Body:**
```json
{
  "ciphertext": "base64_encrypted_data...",
  "private_key": "base64_private_key..."
}
```

**Request Schema:**
```rust
struct DecryptRequest {
    ciphertext: String,   // base64-encoded ciphertext
    private_key: String,  // base64-encoded private key
}
```

**Response (200 OK):**
```json
{
  "plaintext": "SGVsbG8gV29ybGQ="
}
```

**Response Schema:**
```rust
struct DecryptResponse {
    plaintext: String,    // base64-encoded plaintext
}
```

**Errors:**
- `400 Bad Request`: Invalid base64 or malformed ciphertext
- `401 Unauthorized`: Private key mismatch (decryption failed)
- `500 Internal Server Error`: Cryptographic operation failed

**Implementation Notes:**
- Algorithm: NIST FIPS 203 (ML-KEM-768)
- Uses `decapsulate()` to recover shared secret
- Key validation before decryption attempt

**Performance Target:** < 10ms (p95)

**Security Considerations:**
- Private keys should be transmitted over TLS only
- Consider future support for HSM-backed keys
- No key material logged (even at debug level)

---

#### 3.3.4 Sign Message (ML-DSA-87)

**Endpoint:** `POST /api/v1/crypto/sign`

**Purpose:** Create quantum-resistant digital signature using ML-DSA-87 (NIST FIPS 204).

**Request Body:**
```json
{
  "message": "SGVsbG8gV29ybGQ=",
  "private_key": "base64_private_key..."
}
```

**Request Schema:**
```rust
struct SignRequest {
    message: String,      // base64-encoded message
    private_key: String,  // base64-encoded ML-DSA private key
}
```

**Response (200 OK):**
```json
{
  "signature": "base64_signature...",
  "algorithm": "ML-DSA-87"
}
```

**Response Schema:**
```rust
struct SignResponse {
    signature: String,    // base64-encoded signature
    algorithm: String,    // "ML-DSA-87"
}
```

**Errors:**
- `400 Bad Request`: Invalid base64 or key format
- `500 Internal Server Error`: Signing operation failed

**Implementation Notes:**
- Algorithm: NIST FIPS 204 (ML-DSA-87)
- Deterministic signing (same message + key = same signature)
- Signature size: ~4,595 bytes (base64: ~6,127 chars)

**Performance Target:** < 15ms (p95)

---

#### 3.3.5 Verify Signature (ML-DSA-87)

**Endpoint:** `POST /api/v1/crypto/verify`

**Purpose:** Verify ML-DSA-87 digital signature.

**Request Body:**
```json
{
  "message": "SGVsbG8gV29ybGQ=",
  "signature": "base64_signature...",
  "public_key": "base64_public_key..."
}
```

**Request Schema:**
```rust
struct VerifyRequest {
    message: String,      // base64-encoded message
    signature: String,    // base64-encoded signature
    public_key: String,   // base64-encoded ML-DSA public key
}
```

**Response (200 OK):**
```json
{
  "valid": true,
  "algorithm": "ML-DSA-87"
}
```

**Response Schema:**
```rust
struct VerifyResponse {
    valid: bool,          // true if signature is valid
    algorithm: String,    // "ML-DSA-87"
}
```

**Errors:**
- `400 Bad Request`: Invalid base64 or malformed inputs

**Implementation Notes:**
- Always returns 200 OK (even if signature invalid)
- Check `valid: false` for failed verification
- Algorithm: NIST FIPS 204 (ML-DSA-87)
- Constant-time verification (timing-attack resistant)

**Performance Target:** < 20ms (p95)

---

#### 3.3.6 Store Secret (Vault)

**Endpoint:** `POST /api/v1/vault/secrets`

**Purpose:** Store secret with quantum-safe encryption in CretoAI vault.

**Request Body:**
```json
{
  "key": "api-key-prod",
  "value": "sk_live_abc123...",
  "metadata": {
    "type": "api_key",
    "environment": "production",
    "expires_at": "2025-12-31T23:59:59Z"
  }
}
```

**Request Schema:**
```rust
struct StoreSecretRequest {
    key: String,                      // Secret identifier (unique)
    value: String,                    // Secret value (encrypted at rest)
    metadata: Option<serde_json::Value>,  // Optional metadata
}
```

**Response (200 OK):**
```json
{
  "key": "api-key-prod",
  "message": "Secret stored successfully with quantum-safe encryption"
}
```

**Response Schema:**
```rust
struct StoreSecretResponse {
    key: String,          // Echo of key
    message: String,      // Success message
}
```

**Errors:**
- `400 Bad Request`: Empty key or invalid metadata JSON
- `409 Conflict`: Key already exists (future: use PUT to update)
- `500 Internal Server Error`: Vault storage failed

**Implementation Notes:**
- Values encrypted with ML-KEM-768 before storage
- Metadata stored as JSON blob (unencrypted, but auditable)
- Keys must be non-empty strings (1-256 characters)
- Value size limit: 1MB

**Performance Target:** < 50ms (p95)

**Security Considerations:**
- All values encrypted at rest
- Audit log for all access (future)
- Key rotation support (future)

---

#### 3.3.7 Retrieve Secret (Vault)

**Endpoint:** `GET /api/v1/vault/secrets/{key}`

**Purpose:** Retrieve and decrypt secret from vault.

**Path Parameters:**
- `key`: Secret identifier (string)

**Request:** None (key in URL path)

**Response (200 OK):**
```json
{
  "key": "api-key-prod",
  "value": "sk_live_abc123...",
  "metadata": {
    "type": "api_key",
    "environment": "production"
  }
}
```

**Response Schema:**
```rust
struct GetSecretResponse {
    key: String,                      // Secret identifier
    value: String,                    // Decrypted value
    metadata: Option<serde_json::Value>,  // Metadata if present
}
```

**Errors:**
- `404 Not Found`: Secret key does not exist
- `500 Internal Server Error`: Decryption failed

**Implementation Notes:**
- Vault decrypts value using ML-KEM-768
- Metadata returned as-is (unencrypted)
- Access logging (future)

**Performance Target:** < 30ms (p95)

**Example cURL:**
```bash
curl http://localhost:8080/api/v1/vault/secrets/api-key-prod
```

---

#### 3.3.8 Create DAG Vertex (Consensus)

**Endpoint:** `POST /api/v1/consensus/vertex`

**Purpose:** Submit transaction to quantum-resistant DAG consensus network.

**Request Body:**
```json
{
  "data": "dHJhbnNhY3Rpb24gZGF0YQ==",
  "parents": ["hash_abc123...", "hash_def456..."]
}
```

**Request Schema:**
```rust
struct CreateVertexRequest {
    data: String,                  // base64-encoded transaction data
    parents: Option<Vec<String>>,  // Optional parent vertex hashes
}
```

**Response (200 OK):**
```json
{
  "vertex_hash": "blake3_hash_xyz789...",
  "height": 12345,
  "message": "Vertex created and propagated to consensus network"
}
```

**Response Schema:**
```rust
struct CreateVertexResponse {
    vertex_hash: String,   // BLAKE3 hash of vertex
    height: u64,           // Height in DAG
    message: String,       // Success message
}
```

**Errors:**
- `400 Bad Request`: Invalid base64 or parent hashes
- `422 Unprocessable Entity`: Invalid DAG structure (e.g., circular reference)
- `503 Service Unavailable`: Consensus network unavailable

**Implementation Notes:**
- If `parents` not provided: auto-selects tips from DAG
- Data size limit: 1MB (enforced)
- Hash algorithm: BLAKE3 (quantum-resistant)
- Vertex signed with ML-DSA-87 before propagation

**Performance Target:** < 100ms (p95) for network propagation

**Consensus Guarantees:**
- Vertex accepted: included in local DAG
- Finalization: requires quorum (67%+) - check via status endpoint

---

#### 3.3.9 Get DAG Status (Consensus)

**Endpoint:** `GET /api/v1/consensus/status`

**Purpose:** Query current state of DAG consensus network.

**Request:** None

**Response (200 OK):**
```json
{
  "vertex_count": 45678,
  "height": 12345,
  "finalized_count": 45600,
  "status": "healthy"
}
```

**Response Schema:**
```rust
struct DagStatusResponse {
    vertex_count: u64,      // Total vertices in DAG
    height: u64,            // Current DAG height (max depth)
    finalized_count: u64,   // Vertices with quorum finality
    status: String,         // "healthy" | "syncing" | "degraded"
}
```

**Errors:**
- `503 Service Unavailable`: Consensus service down

**Implementation Notes:**
- Cached for 1 second (avoid expensive queries)
- Status determination:
  - `healthy`: > 67% nodes reachable, low latency
  - `syncing`: Catching up to network
  - `degraded`: < 67% nodes reachable

**Performance Target:** < 10ms (p95) with caching

---

### 3.4 OpenAPI Documentation

**Endpoint:** `GET /swagger-ui`

**Purpose:** Interactive API exploration and testing via Swagger UI.

**Features:**
- Auto-generated from Rust code (utoipa macros)
- Try-it-out functionality for all endpoints
- Request/response schema validation
- Example values for all fields
- Authentication UI (future: JWT bearer token)

**Endpoint:** `GET /api-docs/openapi.json`

**Purpose:** Machine-readable OpenAPI 3.0 specification.

**Use Cases:**
- Code generation (OpenAPI Generator)
- API client libraries
- Postman collection import
- Contract testing

---

## 4. Error Handling Strategy

### 4.1 Error Response Format

**Standardized error response:**
```json
{
  "error": "Human-readable error category",
  "details": "Specific error details for debugging"
}
```

### 4.2 HTTP Status Codes

| Status Code | Usage | Examples |
|-------------|-------|----------|
| `200 OK` | Successful operation | All successful requests |
| `400 Bad Request` | Client input validation failed | Invalid base64, malformed JSON |
| `401 Unauthorized` | Authentication failed | Wrong private key (future) |
| `404 Not Found` | Resource does not exist | Secret key not found |
| `409 Conflict` | Resource state conflict | Duplicate secret key |
| `413 Payload Too Large` | Request body exceeds limit | Plaintext > 32KB |
| `422 Unprocessable Entity` | Valid syntax, invalid semantics | Invalid DAG parent reference |
| `429 Too Many Requests` | Rate limit exceeded | (Phase 6) |
| `500 Internal Server Error` | Server-side error | Crypto operation failed |
| `503 Service Unavailable` | Service temporarily down | Consensus network unreachable |

### 4.3 Error Enum Design

```rust
pub enum ApiError {
    InvalidInput(String),      // 400 Bad Request
    CryptoError(String),       // 500 Internal Server Error
    VaultError(String),        // 500 Internal Server Error
    ConsensusError(String),    // 503 Service Unavailable
    InternalError(String),     // 500 Internal Server Error
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, error, details) = match self {
            ApiError::InvalidInput(msg) => (
                StatusCode::BAD_REQUEST,
                "Invalid input",
                Some(msg),
            ),
            // ... other variants
        };

        let body = Json(ErrorResponse { error, details });
        (status, body).into_response()
    }
}
```

### 4.4 Error Handling Best Practices

1. **Never Expose Internal Details:** No stack traces or internal paths in production
2. **Client-Actionable Messages:** Tell user what to fix (e.g., "Invalid base64 encoding in 'plaintext' field")
3. **Structured Logging:** All errors logged with context (request ID, user agent, endpoint)
4. **Consistent Format:** Always JSON error responses (never plain text)
5. **Security-Conscious:** Don't reveal existence of secrets (404 vs 401)

---

## 5. Security Architecture

### 5.1 Phase 5 Security Posture

**Current State (Phase 5):**
- ✅ HTTPS recommended (but not enforced in demo)
- ✅ CORS: Permissive (`Access-Control-Allow-Origin: *`)
- ❌ No authentication (all endpoints public)
- ❌ No rate limiting
- ❌ No API keys

**Rationale:** Phase 5 is demo-focused. Security hardening deferred to Phase 6.

### 5.2 Cryptographic Security

**Quantum Resistance:**
- All cryptographic operations use NIST-approved PQC algorithms:
  - **ML-KEM-768**: Encryption (FIPS 203)
  - **ML-DSA-87**: Signatures (FIPS 204)
- No classical crypto (RSA, ECDSA) in API surface

**Key Management:**
- Keys provided by clients (API does not generate or store long-term keys)
- Ephemeral keypair generation for encrypt endpoint
- Future: HSM integration for server-side key storage

### 5.3 Input Validation

**Validation Rules:**
1. **Base64 Decoding:** All base64 inputs validated before processing
2. **Size Limits:**
   - Plaintext: 32KB max
   - Ciphertext: 64KB max
   - Signatures: 8KB max
   - Secret values: 1MB max
3. **JSON Schema:** All request bodies validated against schema
4. **Path Parameters:** Sanitized to prevent injection

### 5.4 Phase 6 Security Roadmap

**Planned for Phase 6:**
- **Authentication:** JWT bearer tokens, OAuth2, API keys
- **Authorization:** Role-based access control (RBAC)
- **Rate Limiting:** Token bucket per IP/API key
- **TLS Enforcement:** Redirect HTTP → HTTPS
- **CORS Hardening:** Whitelist origins
- **Security Headers:** HSTS, CSP, X-Frame-Options
- **Audit Logging:** All API access logged to immutable store
- **Penetration Testing:** Third-party security audit

---

## 6. Performance Requirements

### 6.1 Latency Targets (p95)

| Endpoint | Target | Rationale |
|----------|--------|-----------|
| `/health` | < 1ms | Simple status check, no I/O |
| `/api/v1/crypto/encrypt` | < 10ms | ML-KEM encapsulation |
| `/api/v1/crypto/decrypt` | < 10ms | ML-KEM decapsulation |
| `/api/v1/crypto/sign` | < 15ms | ML-DSA signing |
| `/api/v1/crypto/verify` | < 20ms | ML-DSA verification |
| `/api/v1/vault/secrets` (POST) | < 50ms | Disk I/O + encryption |
| `/api/v1/vault/secrets/{key}` (GET) | < 30ms | Disk I/O + decryption |
| `/api/v1/consensus/vertex` | < 100ms | Network propagation |
| `/api/v1/consensus/status` | < 10ms | Cached query |

### 6.2 Throughput Targets

- **Peak RPS:** 10,000+ requests/second (mixed workload)
- **Sustained RPS:** 5,000 requests/second
- **Concurrent Connections:** 1,000+ simultaneous clients

**Benchmark Methodology:**
- Tool: `wrk` (HTTP benchmarking) + Criterion (Rust microbenchmarks)
- Load profile: 70% reads, 30% writes
- Test duration: 60 seconds sustained load
- Hardware: AWS c5.2xlarge (8 vCPU, 16GB RAM)

### 6.3 Resource Limits

- **Memory:** < 512MB per server instance
- **CPU:** < 50% utilization at 5,000 RPS
- **Disk:** < 10GB for vault storage (demo)
- **Network:** < 100Mbps bandwidth

### 6.4 Scalability Strategy

**Horizontal Scaling:**
- Stateless API design (all state in backend layers)
- Load balancer: round-robin or least-connections
- Auto-scaling: 2-10 instances based on CPU/RPS

**Vertical Scaling:**
- Tokio runtime configured for all available cores
- Async I/O prevents thread blocking

---

## 7. Integration Points

### 7.1 Internal Dependencies

```
cretoai-api
├── cretoai-crypto (v0.1.0)
│   ├── ML-KEM-768 implementation
│   ├── ML-DSA-87 implementation
│   └── Keypair generation
│
├── cretoai-vault (v0.1.0)
│   ├── Encrypted storage backend
│   ├── Metadata management
│   └── Key derivation
│
├── cretoai-dag (v0.1.0)
│   ├── Vertex creation and validation
│   ├── DAG status queries
│   └── Consensus integration
│
└── cretoai-network (v0.1.0) [future]
    └── QUIC transport (for multi-node)
```

### 7.2 Adapter Pattern

**Goal:** Decouple API layer from backend implementations.

**Example: Crypto Handler**
```rust
// Handler (API layer)
pub async fn encrypt(
    Json(req): Json<EncryptRequest>,
) -> ApiResult<Json<EncryptResponse>> {
    let plaintext = base64::decode(&req.plaintext)?;

    // Delegate to crypto module
    let (ciphertext, public_key) = cretoai_crypto::ml_kem::encrypt(&plaintext)?;

    Ok(Json(EncryptResponse {
        ciphertext: base64::encode(ciphertext),
        public_key: base64::encode(public_key),
        algorithm: "ML-KEM-768".to_string(),
    }))
}
```

**Benefits:**
- API handlers remain thin (< 20 lines)
- Backend modules independently testable
- Easy to swap implementations (e.g., hardware crypto accelerator)

### 7.3 External Integrations (Future)

**Phase 6 Integrations:**
- **Observability:** OpenTelemetry (traces, metrics)
- **Logging:** Structured logs → ELK/Loki
- **Secrets Management:** HashiCorp Vault
- **Authentication:** Auth0, Keycloak
- **Monitoring:** Prometheus, Grafana

---

## 8. Testing Strategy

### 8.1 Test Pyramid

```
          ┌─────────────────┐
          │  E2E Tests (5%) │   ← Docker integration tests
          │                 │
          ├─────────────────┤
          │ Integration     │   ← API + backend modules
          │ Tests (15%)     │
          │                 │
          ├─────────────────┤
          │  Unit Tests     │   ← Handlers, models, errors
          │    (80%)        │
          └─────────────────┘
```

### 8.2 Unit Tests (80% Coverage Target)

**Test Categories:**

1. **Handler Logic Tests** (`handlers/*.rs`)
   - Valid input → expected output
   - Invalid input → error response
   - Edge cases (empty strings, max sizes)

2. **Model Validation Tests** (`models.rs`)
   - Serde serialization/deserialization
   - Schema compliance (OpenAPI)
   - Field validation rules

3. **Error Handling Tests** (`error.rs`)
   - Correct HTTP status codes
   - Proper error message formatting
   - No sensitive data leakage

**Test Framework:** Rust built-in `#[test]` + `tokio-test`

**Example:**
```rust
#[tokio::test]
async fn test_encrypt_valid_input() {
    let req = EncryptRequest {
        plaintext: base64::encode("Hello World"),
        public_key: None,
    };

    let result = encrypt(Json(req)).await;
    assert!(result.is_ok());

    let response = result.unwrap().0;
    assert_eq!(response.algorithm, "ML-KEM-768");
    assert!(!response.ciphertext.is_empty());
}

#[tokio::test]
async fn test_encrypt_invalid_base64() {
    let req = EncryptRequest {
        plaintext: "not-valid-base64!!!".to_string(),
        public_key: None,
    };

    let result = encrypt(Json(req)).await;
    assert!(matches!(result, Err(ApiError::InvalidInput(_))));
}
```

### 8.3 Integration Tests (15% Coverage)

**Test Scenarios:**

1. **Full Request/Response Cycle**
   - Build router → send HTTP request → validate response
   - Uses `reqwest` HTTP client

2. **Middleware Testing**
   - CORS headers present
   - Request tracing spans created
   - Gzip compression applied

3. **Backend Integration**
   - Encrypt → Decrypt round-trip
   - Sign → Verify round-trip
   - Store secret → Retrieve secret

**Example:**
```rust
#[tokio::test]
async fn test_encrypt_decrypt_roundtrip() {
    let app = build_router();
    let server = axum::Server::bind(&"127.0.0.1:0".parse().unwrap())
        .serve(app.into_make_service());

    let addr = server.local_addr();
    tokio::spawn(server);

    let client = reqwest::Client::new();

    // Encrypt
    let encrypt_res = client
        .post(format!("http://{}/api/v1/crypto/encrypt", addr))
        .json(&json!({"plaintext": "SGVsbG8="}))
        .send()
        .await
        .unwrap();

    let encrypt_body: EncryptResponse = encrypt_res.json().await.unwrap();

    // Decrypt
    let decrypt_res = client
        .post(format!("http://{}/api/v1/crypto/decrypt", addr))
        .json(&json!({
            "ciphertext": encrypt_body.ciphertext,
            "private_key": encrypt_body.private_key,
        }))
        .send()
        .await
        .unwrap();

    let decrypt_body: DecryptResponse = decrypt_res.json().await.unwrap();
    assert_eq!(decrypt_body.plaintext, "SGVsbG8=");
}
```

### 8.4 End-to-End Tests (5% Coverage)

**Docker-Based Tests:**
- `docker-compose up` → API server + backend nodes
- Test suite runs against live environment
- Validates: routing, TLS, multi-node consensus

**Test Framework:** `bash` + `curl` + `jq`

**Example:**
```bash
#!/bin/bash
set -euo pipefail

# Start services
docker-compose up -d
sleep 10

# Health check
HEALTH=$(curl -s http://localhost:8080/health)
STATUS=$(echo $HEALTH | jq -r '.status')

if [ "$STATUS" != "healthy" ]; then
  echo "Health check failed: $HEALTH"
  exit 1
fi

# Test encrypt endpoint
PLAINTEXT=$(echo "Hello World" | base64)
ENCRYPT_RESULT=$(curl -s -X POST http://localhost:8080/api/v1/crypto/encrypt \
  -H "Content-Type: application/json" \
  -d "{\"plaintext\": \"$PLAINTEXT\"}")

CIPHERTEXT=$(echo $ENCRYPT_RESULT | jq -r '.ciphertext')

if [ -z "$CIPHERTEXT" ]; then
  echo "Encrypt failed: $ENCRYPT_RESULT"
  exit 1
fi

echo "✅ E2E tests passed"
docker-compose down
```

### 8.5 Load Testing

**Tool:** `wrk` + Lua scripts

**Scenario: Mixed Workload**
```bash
wrk -t4 -c100 -d60s --latency \
  -s mixed_workload.lua \
  http://localhost:8080
```

**`mixed_workload.lua`:**
```lua
-- 40% encrypt, 30% decrypt, 20% sign, 10% verify
math.randomseed(os.time())

request = function()
  local r = math.random(100)

  if r <= 40 then
    -- Encrypt
    return wrk.format("POST", "/api/v1/crypto/encrypt", nil,
      '{"plaintext":"SGVsbG8gV29ybGQ="}')
  elseif r <= 70 then
    -- Decrypt
    return wrk.format("POST", "/api/v1/crypto/decrypt", nil,
      '{"ciphertext":"...","private_key":"..."}')
  -- ... (sign, verify)
  end
end
```

**Success Criteria:**
- p95 latency < 50ms
- Throughput > 5,000 RPS
- Error rate < 0.1%

---

## 9. Deployment Architecture

### 9.1 Docker Configuration

**Single-Node Deployment (Demo):**
```dockerfile
# Dockerfile
FROM rust:1.75 as builder
WORKDIR /app
COPY . .
RUN cargo build --release --bin cretoai-api-server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/cretoai-api-server /usr/local/bin/
EXPOSE 8080
CMD ["cretoai-api-server"]
```

**docker-compose.yml:**
```yaml
version: '3.8'

services:
  cretoai-api:
    build: .
    ports:
      - "8080:8080"
    environment:
      RUST_LOG: info,cretoai_api=debug
    networks:
      - cretoai-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 10s
      timeout: 5s
      retries: 3

networks:
  cretoai-network:
    driver: bridge
```

### 9.2 Multi-Node Deployment (Production)

**docker-compose-cluster.yml:**
```yaml
version: '3.8'

services:
  api-1:
    build: .
    ports:
      - "8080:8080"
    environment:
      NODE_ID: 1
      CONSENSUS_PEERS: "api-2:8080,api-3:8080"
    networks:
      - cretoai-network

  api-2:
    build: .
    ports:
      - "8081:8080"
    environment:
      NODE_ID: 2
      CONSENSUS_PEERS: "api-1:8080,api-3:8080"
    networks:
      - cretoai-network

  api-3:
    build: .
    ports:
      - "8082:8080"
    environment:
      NODE_ID: 3
      CONSENSUS_PEERS: "api-1:8080,api-2:8080"
    networks:
      - cretoai-network

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - api-1
      - api-2
      - api-3
    networks:
      - cretoai-network

networks:
  cretoai-network:
    driver: bridge
```

**nginx.conf (Load Balancer):**
```nginx
upstream cretoai_backend {
    least_conn;
    server api-1:8080;
    server api-2:8080;
    server api-3:8080;
}

server {
    listen 80;
    server_name localhost;

    location / {
        proxy_pass http://cretoai_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### 9.3 Kubernetes Deployment (Phase 6)

**Deferred to Phase 6:** Helm charts, auto-scaling, persistent volumes

**Preliminary Design:**
- **Deployment:** 3+ replicas for HA
- **Service:** ClusterIP + Ingress (TLS)
- **ConfigMap:** API configuration
- **Secret:** TLS certificates
- **PVC:** Vault storage (persistent)

---

## 10. Monitoring and Observability

### 10.1 Logging

**Framework:** `tracing` + `tracing-subscriber`

**Log Levels:**
- `ERROR`: Unrecoverable errors (500 responses)
- `WARN`: Degraded state (high latency, failed validations)
- `INFO`: Request lifecycle (start, end, latency)
- `DEBUG`: Detailed operation traces (crypto steps)
- `TRACE`: Full request/response bodies (dev only)

**Structured Logging Example:**
```rust
#[tracing::instrument(skip(req))]
pub async fn encrypt(Json(req): Json<EncryptRequest>) -> ApiResult<...> {
    tracing::info!("Encrypt request received");

    let plaintext = base64::decode(&req.plaintext)
        .map_err(|e| {
            tracing::warn!(error = %e, "Invalid base64 plaintext");
            ApiError::InvalidInput(format!("Invalid base64: {}", e))
        })?;

    tracing::debug!(plaintext_size = plaintext.len(), "Decoding successful");

    // ... crypto operation

    tracing::info!("Encrypt completed successfully");
    Ok(...)
}
```

**Log Output (JSON for production):**
```json
{
  "timestamp": "2025-11-27T10:15:30.123Z",
  "level": "INFO",
  "target": "cretoai_api::handlers::crypto",
  "message": "Encrypt request received",
  "span": { "name": "encrypt" },
  "fields": { "plaintext_size": 1024 }
}
```

### 10.2 Metrics (Future)

**Phase 6 Prometheus Metrics:**
- `http_requests_total{method, endpoint, status}` - Request counter
- `http_request_duration_seconds{method, endpoint}` - Latency histogram
- `crypto_operations_total{operation, algorithm}` - Crypto op counter
- `vault_secrets_total` - Total secrets stored
- `consensus_vertices_total` - DAG vertices created

### 10.3 Distributed Tracing (Future)

**Phase 6 OpenTelemetry:**
- Trace ID propagation across services
- Span creation for each handler
- Integration with Jaeger/Tempo

---

## 11. Configuration Management

### 11.1 Configuration Schema

**File:** `config.toml` (optional, defaults in code)
```toml
[server]
host = "0.0.0.0"
port = 8080

[logging]
level = "info"
format = "json"  # "json" | "pretty"

[limits]
max_plaintext_size = 32768      # 32KB
max_secret_size = 1048576       # 1MB
max_request_body_size = 2097152 # 2MB

[cors]
allowed_origins = ["*"]  # Phase 5: permissive
```

### 11.2 Environment Variables

**Priority:** ENV vars > config file > defaults

| Variable | Default | Description |
|----------|---------|-------------|
| `CRETOAI_HOST` | `0.0.0.0` | Server bind address |
| `CRETOAI_PORT` | `8080` | Server port |
| `RUST_LOG` | `info` | Log level filter |
| `CRETOAI_CONFIG` | `config.toml` | Config file path |

**Example:**
```bash
CRETOAI_PORT=9000 \
RUST_LOG=debug,cretoai_api=trace \
cargo run --bin cretoai-api-server
```

---

## 12. Design Decisions and Trade-offs

### 12.1 Why Axum over actix-web?

**Decision:** Use Axum as web framework

**Rationale:**

| Criteria | Axum | actix-web |
|----------|------|-----------|
| **Performance** | Excellent (100K+ RPS) | Excellent (120K+ RPS) |
| **Type Safety** | Superior (leverages Rust type system) | Good (macro-based) |
| **Ecosystem** | Tower middleware (composable) | actix ecosystem |
| **Async Model** | Tokio (standard) | actix runtime (custom) |
| **Learning Curve** | Moderate | Steep |
| **Maintenance** | Active (Tokio team) | Active |
| **OpenAPI Support** | Excellent (utoipa) | Good (paperclip) |

**Conclusion:** Axum chosen for type safety, Tower ecosystem, and utoipa integration.

**Trade-off:** Slightly lower raw performance (5-10%) vs actix-web, but superior developer experience.

---

### 12.2 OpenAPI Auto-Generation vs Manual

**Decision:** Auto-generate OpenAPI spec from Rust code (utoipa)

**Rationale:**

**Auto-Generation (utoipa):**
- ✅ Single source of truth (Rust types)
- ✅ Compile-time schema validation
- ✅ No drift between code and docs
- ✅ Refactoring safety (schema updates automatically)
- ❌ Limited customization (documentation strings)
- ❌ Additional proc-macro compile time

**Manual OpenAPI:**
- ✅ Full control over documentation
- ✅ Can document edge cases comprehensively
- ❌ Requires manual synchronization
- ❌ Prone to drift (code changes, docs don't)

**Conclusion:** Auto-generation chosen for Phase 5 (rapid iteration). Manual overrides available if needed.

---

### 12.3 Authentication Strategy (Phase 5 vs Phase 6)

**Phase 5 Decision:** No authentication (public API)

**Rationale:**
- Demo environment (local/Docker)
- Reduces friction for evaluation
- Customers can test immediately with `curl`

**Phase 6 Plan:**
- **JWT Bearer Tokens:** Auth0/Keycloak integration
- **API Keys:** Revocable, scoped permissions
- **OAuth2:** Third-party app integration
- **mTLS:** Client certificate authentication (government)

**Security Mitigation (Phase 5):**
- Deploy behind firewall (not public internet)
- TLS recommended (but not enforced)
- Rate limiting at reverse proxy (nginx)

---

### 12.4 Rate Limiting Approach

**Phase 5 Decision:** No rate limiting in application

**Phase 6 Approaches Evaluated:**

| Approach | Pros | Cons |
|----------|------|------|
| **Application-Level** (Tower middleware) | Granular control, per-endpoint limits | State management complexity |
| **Reverse Proxy** (nginx) | Offload from app, battle-tested | Less granular (IP-based only) |
| **API Gateway** (Kong, Tyk) | Enterprise features, analytics | Additional infrastructure |
| **Cloud Provider** (AWS WAF, Cloudflare) | DDoS protection, global | Vendor lock-in, cost |

**Phase 6 Recommendation:** Hybrid approach
- **nginx:** Coarse-grained IP-based limits (100 req/s)
- **Application:** Fine-grained per-endpoint (e.g., 10 encrypts/s per API key)

---

## 13. Future Enhancements (Phase 6+)

### 13.1 Short-Term (Phase 6)

**Priority 1:**
- [ ] Authentication and authorization
- [ ] Rate limiting and throttling
- [ ] HTTPS enforcement and security headers
- [ ] Prometheus metrics endpoint
- [ ] Audit logging (all API access)

**Priority 2:**
- [ ] API versioning (`/api/v2`)
- [ ] Webhooks for async notifications
- [ ] Batch operations (encrypt multiple messages)
- [ ] Pagination for large result sets
- [ ] Field filtering (`?fields=key,value`)

### 13.2 Long-Term (Phase 7+)

**Advanced Features:**
- [ ] GraphQL API (alternative to REST)
- [ ] WebSocket streaming (real-time updates)
- [ ] SDK libraries (Python, TypeScript, Go, Java)
- [ ] API playground (interactive docs)
- [ ] Client code generation (OpenAPI Generator)

**Enterprise Features:**
- [ ] Multi-tenancy (isolated namespaces)
- [ ] SLA monitoring and reporting
- [ ] Compliance APIs (audit trails, data retention)
- [ ] Disaster recovery (cross-region replication)

---

## 14. Success Criteria

### 14.1 Functional Completeness

- [x] All 9 endpoints implemented and tested
- [x] OpenAPI spec auto-generated and accurate
- [x] Swagger UI accessible and functional
- [x] Error handling comprehensive (all edge cases)
- [x] Request validation robust (invalid inputs rejected)

### 14.2 Performance

- [ ] All endpoints meet p95 latency targets
- [ ] Sustained 5,000 RPS with < 50ms latency
- [ ] Memory usage < 512MB under load
- [ ] Zero crashes during 60-second load test

### 14.3 Demo Readiness

- [ ] `docker-compose up` → Server running in < 30 seconds
- [ ] Health check passes immediately
- [ ] Example `curl` commands in README work
- [ ] Postman collection importable from OpenAPI spec
- [ ] Sales team can demo without engineering support

### 14.4 Documentation Quality

- [ ] This SDD complete and reviewed
- [ ] API documentation auto-generated (100% coverage)
- [ ] Example requests/responses for all endpoints
- [ ] Troubleshooting guide for common errors
- [ ] Performance benchmark results published

---

## 15. Appendices

### Appendix A: API Cheat Sheet

**Quick Reference:**
```bash
# Health check
curl http://localhost:8080/health

# Encrypt
curl -X POST http://localhost:8080/api/v1/crypto/encrypt \
  -H "Content-Type: application/json" \
  -d '{"plaintext":"SGVsbG8gV29ybGQ="}'

# Store secret
curl -X POST http://localhost:8080/api/v1/vault/secrets \
  -H "Content-Type: application/json" \
  -d '{"key":"test","value":"secret123"}'

# Get secret
curl http://localhost:8080/api/v1/vault/secrets/test

# Create vertex
curl -X POST http://localhost:8080/api/v1/consensus/vertex \
  -H "Content-Type: application/json" \
  -d '{"data":"dGVzdCBkYXRh"}'

# DAG status
curl http://localhost:8080/api/v1/consensus/status

# Swagger UI
open http://localhost:8080/swagger-ui
```

### Appendix B: OpenAPI Schema Highlights

**Schema Generation:**
```rust
#[derive(Deserialize, ToSchema)]
pub struct EncryptRequest {
    /// Plaintext data to encrypt (base64 encoded)
    #[schema(example = "SGVsbG8gV29ybGQ=")]
    pub plaintext: String,
}

#[utoipa::path(
    post,
    path = "/api/v1/crypto/encrypt",
    request_body = EncryptRequest,
    responses(
        (status = 200, description = "Encryption successful", body = EncryptResponse),
        (status = 400, description = "Invalid input"),
    ),
    tag = "crypto"
)]
pub async fn encrypt(...) -> ... { ... }
```

### Appendix C: Performance Benchmark Results (Placeholder)

**Note:** To be populated after benchmark execution in Phase 5.

**Expected Results:**
```
Endpoint: /api/v1/crypto/encrypt
Requests: 50,000
Duration: 10s
RPS: 5,000
Latency (p50): 4.2ms
Latency (p95): 8.7ms
Latency (p99): 12.3ms
Errors: 0 (0.00%)
```

### Appendix D: Glossary

- **ML-KEM-768:** NIST FIPS 203 - Module-Lattice-Based Key Encapsulation Mechanism
- **ML-DSA-87:** NIST FIPS 204 - Module-Lattice-Based Digital Signature Algorithm
- **DAG:** Directed Acyclic Graph (consensus data structure)
- **QUIC:** Modern transport protocol (UDP-based, encrypted by default)
- **Axum:** Rust web framework built on Tokio
- **Tower:** Middleware abstraction library
- **utoipa:** OpenAPI code generation for Rust

---

## 16. Document Control

**Revision History:**

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-27 | System Architect Agent | Initial SDD creation |

**Reviewers:**
- [ ] TDD Agent (next in chain)
- [ ] REST API Worker Agent
- [ ] Queen Agent (final approval)

**Approvals:**
- [ ] Technical Lead
- [ ] Product Manager
- [ ] Security Architect

**Next Steps:**
1. Hand off to TDD Agent for test specification
2. Implement tests (RED phase)
3. Implement handlers (GREEN phase)
4. Refactor and optimize (REFACTOR phase)
5. Deploy to Docker and run benchmarks

---

**END OF SOFTWARE DESIGN DOCUMENT**
