# Getting Started with CretoAI

Get a quantum-resistant security platform running in **under 5 minutes**.

---

## Prerequisites

- **Docker** installed and running
- **2GB** free disk space
- **Ports** 8080, 9000-9003 available

*Optional: Rust toolchain for building from source or running benchmarks*

---

## Quick Start (3 Steps)

### 1. Clone Repository

```bash
git clone https://github.com/Creto-Systems/Creto-AI.git
cd Creto-AI
```

### 2. Start Demo Environment

```bash
./scripts/demo.sh
```

**This will:**
- Build REST API server Docker image
- Start API server on port 8080
- Wait for health checks
- Display access URLs

### 3. Access Services

**REST API:** http://localhost:8080
**Swagger UI:** http://localhost:8080/swagger-ui
**Health Check:** http://localhost:8080/health

---

## What to Try

### 1. Explore the Interactive API

Open Swagger UI at http://localhost:8080/swagger-ui

**Try these operations:**

**Encrypt with ML-KEM-768:**
```bash
curl -X POST http://localhost:8080/api/v1/crypto/encrypt \
  -H "Content-Type: application/json" \
  -d '{
    "plaintext": "SGVsbG8sIFF1YW50dW0gV29ybGQh"
  }'
```

**Sign with ML-DSA-87:**
```bash
curl -X POST http://localhost:8080/api/v1/crypto/sign \
  -H "Content-Type: application/json" \
  -d '{
    "message": "VGVzdCBtZXNzYWdl",
    "private_key": "..."
  }'
```

**Verify Signature:**
```bash
curl -X POST http://localhost:8080/api/v1/crypto/verify \
  -H "Content-Type: application/json" \
  -d '{
    "message": "VGVzdCBtZXNzYWdl",
    "signature": "...",
    "public_key": "..."
  }'
```

### 2. Run Performance Benchmarks

```bash
# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Run benchmarks
cargo bench --features=benchmark

# View results
cat docs/benchmarks/PERFORMANCE_RESULTS.md
```

**Expected Results:**
- **ML-DSA-87 Signing:** 56,000+ TPS
- **ML-KEM-768 Encryption:** 25,000+ TPS
- **Simulated Consensus:** 10,000+ TPS with 177ms finality

### 3. Deploy to Kubernetes

```bash
# Requires kubectl and a running cluster
./scripts/k8s-deploy.sh

# Verify deployment
kubectl get pods -n cretoai
kubectl get svc -n cretoai

# Access API via LoadBalancer
export API_URL=$(kubectl get svc cretoai-api -n cretoai -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
curl http://$API_URL:8080/health
```

### 4. Run Tests

```bash
# Unit tests
cargo test --all

# Integration tests
cargo test --package cretoai-dag --test '*'
cargo test --package cretoai-network --test '*'

# E2E tests (when binary builds succeed)
cargo test --package cretoai-e2e-tests
```

---

## Development Setup

### Build from Source

```bash
# Clone repository
git clone https://github.com/Creto-Systems/Creto-AI.git
cd Creto-AI

# Build all workspace crates
cargo build --release --all

# Build specific components
cargo build --release --bin cretoai-api-server    # REST API
cargo build --release --bin cretoai-node          # Consensus node (when available)
```

### Run Locally (Without Docker)

```bash
# Start REST API server
cargo run --release --bin cretoai-api-server

# Access at http://localhost:8080
```

### Watch for Changes

```bash
# Install cargo-watch
cargo install cargo-watch

# Auto-rebuild on changes
cargo watch -x 'run --bin cretoai-api-server'
```

---

## Next Steps

### Explore Documentation

**Architecture:**
- [Node Architecture](docs/architecture/NODE_ARCHITECTURE.md) - Consensus node design (1,900 lines)
- [Phase 6 Status](docs/PHASE_6_STATUS.md) - Implementation status (90% complete)
- [Storage Design](docs/storage/PHASE_6_STORAGE.md) - RocksDB persistence

**Testing:**
- [E2E Testing](tests/e2e/README.md) - 24 comprehensive tests
- [Performance Benchmarks](docs/benchmarks/README.md) - Validated results

**Deployment:**
- [Docker Guide](QUICKSTART_DOCKER.md) - Complete Docker deployment
- [Kubernetes Guide](k8s/README.md) - Production k8s setup
- [Helm Charts](charts/cretoai/README.md) - Parameterized deployment

### Run Integration Tests

```bash
# Storage tests (RocksDB)
cargo test --package cretoai-dag --test storage_tests

# Network tests (QUIC)
cargo test --package cretoai-network --test quic_tests

# Consensus tests (BFT)
cargo test --package cretoai-consensus --test bft_tests
```

### Deploy Production Environment

1. **Configure Node** - Edit `config/node.toml.example`
2. **Generate Keypair** - `cretoai-node keygen --output ./keys`
3. **Deploy Cluster** - Use Kubernetes manifests in `k8s/`
4. **Monitor Health** - Prometheus metrics on port 9090

---

## Troubleshooting

### Docker not running

```bash
# macOS
open -a Docker

# Linux
sudo systemctl start docker

# Verify
docker ps
```

### Ports already in use

```bash
# Check what's using port 8080
lsof -i :8080

# Option 1: Stop conflicting service
# Option 2: Edit docker-compose.demo.yml to use different ports
```

### Build failing

```bash
# Clear Docker cache
docker system prune -a

# Rebuild from scratch
./scripts/demo.sh
```

### Rust build errors

```bash
# Update Rust toolchain
rustup update

# Clean build artifacts
cargo clean

# Rebuild
cargo build --release
```

### Can't access Swagger UI

**Check if API is running:**
```bash
curl http://localhost:8080/health
```

**Expected response:**
```json
{
  "status": "healthy",
  "version": "0.6.0",
  "quantum_ready": true
}
```

**If not running:**
```bash
# Check Docker logs
docker logs $(docker ps -q --filter ancestor=cretoai-api:latest)

# Restart demo
./scripts/demo.sh
```

---

## Examples

### Complete Encryption Flow

```bash
# 1. Encrypt data with ML-KEM-768
ENCRYPTED=$(curl -s -X POST http://localhost:8080/api/v1/crypto/encrypt \
  -H "Content-Type: application/json" \
  -d '{"plaintext": "SGVsbG8sIFF1YW50dW0gV29ybGQh"}')

# Extract ciphertext and public key
echo $ENCRYPTED | jq '.'

# 2. Decrypt (requires private key from encryption response)
curl -X POST http://localhost:8080/api/v1/crypto/decrypt \
  -H "Content-Type: application/json" \
  -d "{
    \"ciphertext\": \"$(echo $ENCRYPTED | jq -r '.ciphertext')\",
    \"private_key\": \"$(echo $ENCRYPTED | jq -r '.private_key')\"
  }"
```

### Complete Signing Flow

```bash
# 1. Generate keypair and sign
SIGNED=$(curl -s -X POST http://localhost:8080/api/v1/crypto/sign \
  -H "Content-Type: application/json" \
  -d '{"message": "VGVzdCBtZXNzYWdl"}')

echo $SIGNED | jq '.'

# 2. Verify signature
curl -X POST http://localhost:8080/api/v1/crypto/verify \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"VGVzdCBtZXNzYWdl\",
    \"signature\": \"$(echo $SIGNED | jq -r '.signature')\",
    \"public_key\": \"$(echo $SIGNED | jq -r '.public_key')\"
  }"
```

---

## Support

**Documentation:** [Full Index](docs/INDEX.md)
**Issues:** https://github.com/Creto-Systems/Creto-AI/issues
**Security:** security@cretoai.ai
**Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md)

---

**Ready to deploy?** See [QUICKSTART_DOCKER.md](QUICKSTART_DOCKER.md) for production deployment.
