# CretoAI REST API

Production-ready HTTP API wrapper for CretoAI quantum-resistant cryptography platform.

## Features

- **Quantum-Resistant Crypto**: ML-KEM-768, ML-DSA-87 (NIST FIPS 203/204)
- **OpenAPI Documentation**: Auto-generated Swagger UI
- **CORS Support**: Cross-origin resource sharing enabled
- **Production Ready**: Logging, error handling, metrics

## Quick Start

### Run the Server

```bash
# From project root
cargo run --bin cretoai-api-server

# Server starts on http://0.0.0.0:8080
```

### Access Swagger UI

Open your browser to: http://localhost:8080/swagger-ui

### Health Check

```bash
curl http://localhost:8080/health
```

Response:
```json
{
  "status": "healthy",
  "version": "0.1.0",
  "quantum_ready": true
}
```

## API Endpoints

### Cryptographic Operations

#### Encrypt Data (ML-KEM-768)

```bash
curl -X POST http://localhost:8080/api/v1/crypto/encrypt \
  -H "Content-Type: application/json" \
  -d '{
    "plaintext": "SGVsbG8gV29ybGQ="
  }'
```

Response:
```json
{
  "ciphertext": "...",
  "public_key": "...",
  "algorithm": "ML-KEM-768"
}
```

#### Decrypt Data

```bash
curl -X POST http://localhost:8080/api/v1/crypto/decrypt \
  -H "Content-Type: application/json" \
  -d '{
    "ciphertext": "...",
    "private_key": "..."
  }'
```

#### Sign Message (ML-DSA-87)

```bash
curl -X POST http://localhost:8080/api/v1/crypto/sign \
  -H "Content-Type: application/json" \
  -d '{
    "message": "SGVsbG8gV29ybGQ=",
    "private_key": "..."
  }'
```

Response:
```json
{
  "signature": "...",
  "algorithm": "ML-DSA-87"
}
```

#### Verify Signature

```bash
curl -X POST http://localhost:8080/api/v1/crypto/verify \
  -H "Content-Type: application/json" \
  -d '{
    "message": "SGVsbG8gV29ybGQ=",
    "signature": "...",
    "public_key": "..."
  }'
```

### Vault Operations

#### Store Secret

```bash
curl -X POST http://localhost:8080/api/v1/vault/secrets \
  -H "Content-Type: application/json" \
  -d '{
    "key": "api-key",
    "value": "secret123",
    "metadata": {"type": "api_key"}
  }'
```

#### Retrieve Secret

```bash
curl http://localhost:8080/api/v1/vault/secrets/api-key
```

### Consensus Operations

#### Create DAG Vertex

```bash
curl -X POST http://localhost:8080/api/v1/consensus/vertex \
  -H "Content-Type: application/json" \
  -d '{
    "data": "dHJhbnNhY3Rpb24gZGF0YQ==",
    "parents": ["hash1", "hash2"]
  }'
```

#### Get Consensus Status

```bash
curl http://localhost:8080/api/v1/consensus/status
```

Response:
```json
{
  "vertex_count": 45678,
  "height": 12345,
  "finalized_count": 45600,
  "status": "healthy"
}
```

## Configuration

Environment variables:

```bash
RUST_LOG=info,cretoai_api=debug cargo run --bin cretoai-api-server
```

## Development

### Run Tests

```bash
cargo test -p cretoai-api
```

### Build Release

```bash
cargo build --release --bin cretoai-api-server
```

## Architecture

```
cretoai-api/
├── src/
│   ├── lib.rs              # Router and middleware setup
│   ├── models.rs           # Request/response models
│   ├── error.rs            # Error handling
│   ├── config.rs           # Configuration
│   ├── routes.rs           # Route definitions
│   ├── handlers/
│   │   ├── health.rs       # Health check
│   │   ├── crypto.rs       # Crypto operations
│   │   ├── vault.rs        # Vault operations
│   │   └── dag.rs          # Consensus operations
│   └── bin/
│       └── server.rs       # Server binary
├── Cargo.toml
└── README.md
```

## Postman Collection

Import OpenAPI spec from: http://localhost:8080/api-docs/openapi.json

## Security

- All cryptographic operations use NIST-approved post-quantum algorithms
- Secrets stored with quantum-safe encryption
- TLS recommended for production (use reverse proxy)

## Production Deployment

### Docker

```bash
docker build -t cretoai-api .
docker run -p 8080:8080 cretoai-api
```

### Kubernetes

See `/docs/deployment/kubernetes.md` for Helm charts.

## License

Dual licensed under MIT OR Apache-2.0.
