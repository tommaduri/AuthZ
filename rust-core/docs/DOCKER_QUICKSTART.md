# 🐳 Docker Quickstart - CretoAI

**Get a working quantum-resistant security demo in under 5 minutes.**

---

## 📦 What You'll Get

A fully functional CretoAI cluster with:
- ✅ **REST API Server** - OpenAPI/Swagger UI for interactive testing
- ✅ **3 Consensus Nodes** - Byzantine fault-tolerant QR-Avalanche DAG
- ✅ **Quantum-Resistant Crypto** - ML-KEM, ML-DSA, BLAKE3
- ✅ **Health Monitoring** - Built-in health checks and metrics
- ✅ **Zero Configuration** - Everything pre-configured and ready

---

## 🚀 Quick Start

### Option 1: Automated Demo (Recommended)

```bash
# Clone and run
git clone https://github.com/Creto-Systems/cretoai.git
cd cretoai
./scripts/demo.sh
```

**The script will:**
1. Build all Docker images (first run takes 3-5 minutes)
2. Start API server + 3 consensus nodes
3. Wait for health checks
4. Run live quantum-resistant operations
5. Display real-time metrics
6. Keep services running for interactive testing

**Press Ctrl+C to stop and cleanup.**

---

### Option 2: Manual Docker Compose

```bash
# Start cluster
docker-compose -f docker-compose.demo.yml up -d

# Check status
docker-compose -f docker-compose.demo.yml ps

# View logs
docker-compose -f docker-compose.demo.yml logs -f api-server

# Stop cluster
docker-compose -f docker-compose.demo.yml down -v
```

---

## 🌐 Access Points

Once running:

| Service | URL | Purpose |
|---------|-----|---------|
| **REST API** | http://localhost:8080 | Main API endpoint |
| **Swagger UI** | http://localhost:8080/swagger-ui | Interactive API docs |
| **Health Check** | http://localhost:8080/health | Service health status |
| **Metrics** | http://localhost:8080/api/v1/metrics | Performance metrics |

---

## 🧪 Test the API

### Health Check
```bash
curl http://localhost:8080/health
```

**Expected response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-11-27T...",
  "version": "0.1.0",
  "consensus_nodes": 3
}
```

---

### Generate Quantum-Resistant Keypair

```bash
curl -X POST http://localhost:8080/api/v1/crypto/keygen \
  -H "Content-Type: application/json" \
  -d '{
    "algorithm": "dilithium",
    "security_level": 3
  }' | jq
```

**Response:**
```json
{
  "public_key": "base64_encoded_public_key...",
  "private_key": "base64_encoded_private_key...",
  "algorithm": "ML-DSA-87",
  "security_level": "NIST Level 5"
}
```

---

### Encrypt with ML-KEM (Kyber-768)

```bash
# Encode your message to base64 first
MESSAGE=$(echo -n "Hello, Quantum World!" | base64)

curl -X POST http://localhost:8080/api/v1/crypto/encrypt \
  -H "Content-Type: application/json" \
  -d "{
    \"data\": \"$MESSAGE\",
    \"algorithm\": \"kyber768\"
  }" | jq
```

**Response:**
```json
{
  "ciphertext": "base64_encoded_ciphertext...",
  "encapsulated_key": "base64_encoded_key...",
  "algorithm": "ML-KEM-768",
  "nonce": "..."
}
```

---

### Sign with ML-DSA (Dilithium-87)

```bash
MESSAGE=$(echo -n "Test message" | base64)

curl -X POST http://localhost:8080/api/v1/crypto/sign \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"$MESSAGE\",
    \"algorithm\": \"dilithium87\"
  }" | jq
```

**Response:**
```json
{
  "signature": "base64_encoded_signature...",
  "algorithm": "ML-DSA-87",
  "message_hash": "blake3_hash..."
}
```

---

### Submit Consensus Transaction

```bash
TRANSACTION=$(echo -n "Consensus test data" | base64)

curl -X POST http://localhost:8080/api/v1/consensus/transaction \
  -H "Content-Type: application/json" \
  -d "{
    \"data\": \"$TRANSACTION\",
    \"priority\": \"high\"
  }" | jq
```

**Response:**
```json
{
  "transaction_id": "uuid...",
  "status": "pending",
  "submitted_at": "timestamp..."
}
```

---

### Check Consensus Status

```bash
curl http://localhost:8080/api/v1/consensus/status | jq
```

**Response:**
```json
{
  "nodes": 3,
  "consensus_state": "finalized",
  "throughput_tps": 12847,
  "finality_latency_ms": 743,
  "total_transactions": 15234
}
```

---

## 🖥️ Interactive Testing (Swagger UI)

**Open in your browser:**
http://localhost:8080/swagger-ui

The Swagger UI provides:
- ✅ Complete API documentation
- ✅ Try-it-out functionality for all endpoints
- ✅ Request/response schemas
- ✅ Example values pre-filled
- ✅ No Postman/curl needed

---

## 📊 Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Docker Compose Cluster (172.21.0.0/16 network)        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────┐                                   │
│  │   API Server    │  :8080 (REST + Swagger)           │
│  │  172.21.0.10    │  Quantum-resistant operations     │
│  └────────┬────────┘                                   │
│           │                                             │
│  ┌────────┴─────────────────────────┐                  │
│  │                                  │                  │
│  ▼                 ▼                ▼                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │ Node 1   │  │ Node 2   │  │ Node 3   │             │
│  │ :9010/11 │  │ :9020/21 │  │ :9030/31 │             │
│  │172.21.0.11  │172.21.0.12  │172.21.0.13  │          │
│  └──────────┘  └──────────┘  └──────────┘             │
│  Bootstrap      Consensus     Consensus                │
│                                                         │
│  QR-Avalanche DAG Consensus (Byzantine fault-tolerant) │
│  ML-KEM + ML-DSA + BLAKE3 (Post-quantum cryptography)  │
└─────────────────────────────────────────────────────────┘
```

---

## 🔍 Monitoring & Debugging

### View Container Logs
```bash
# All services
docker-compose -f docker-compose.demo.yml logs -f

# Specific service
docker-compose -f docker-compose.demo.yml logs -f api-server
docker-compose -f docker-compose.demo.yml logs -f node-1
```

### Container Status
```bash
docker-compose -f docker-compose.demo.yml ps
```

### Execute Commands in Container
```bash
# Shell into API server
docker exec -it cretoai-api /bin/bash

# Shell into consensus node
docker exec -it cretoai-node-1 /bin/bash
```

### Check Resource Usage
```bash
docker stats
```

---

## 🧹 Cleanup

### Stop and Remove Containers
```bash
docker-compose -f docker-compose.demo.yml down
```

### Stop and Remove Containers + Volumes
```bash
docker-compose -f docker-compose.demo.yml down -v
```

### Remove Images
```bash
docker rmi cretoai-api cretoai-node
```

---

## ⚙️ Configuration

### Environment Variables

See `.env.example` for all available configuration options.

**Key variables:**
```bash
CRETOAI_API_HOST=0.0.0.0
CRETOAI_API_PORT=8080
CRETOAI_CONSENSUS_NODES=node-1:9000,node-2:9000,node-3:9000
RUST_LOG=info,cretoai_api=debug
```

### Custom Configuration

Edit `docker-compose.demo.yml` to:
- Change port mappings
- Adjust resource limits
- Add more consensus nodes
- Enable additional features

---

## 🚨 Troubleshooting

### API not responding
```bash
# Check if container is running
docker-compose -f docker-compose.demo.yml ps

# Check logs for errors
docker-compose -f docker-compose.demo.yml logs api-server

# Restart API server
docker-compose -f docker-compose.demo.yml restart api-server
```

### Health check failing
```bash
# Wait longer (first start can take 10-15 seconds)
sleep 15
curl http://localhost:8080/health

# Check if port is in use
lsof -i :8080

# Try different port
CRETOAI_API_PORT=8081 docker-compose -f docker-compose.demo.yml up -d
```

### Build failures
```bash
# Clean rebuild
docker-compose -f docker-compose.demo.yml build --no-cache

# Check Rust version in container
docker run --rm rust:1.75-slim rustc --version
```

### Consensus nodes not connecting
```bash
# Check network
docker network inspect cretoai_cretoai-demo

# Verify node logs
docker-compose -f docker-compose.demo.yml logs node-1 | grep "peer"

# Restart all nodes
docker-compose -f docker-compose.demo.yml restart node-1 node-2 node-3
```

---

## 🎯 Next Steps

1. ✅ **Explore Swagger UI** - http://localhost:8080/swagger-ui
2. ✅ **Try all endpoints** - Encrypt, sign, consensus operations
3. ✅ **Read the docs** - `/docs` directory for architecture details
4. ✅ **Run benchmarks** - See PHASE3-TDD-COMPLETE.md
5. ✅ **Customize** - Edit `.env` and `docker-compose.demo.yml`

---

## 📚 Additional Resources

- [Main README](../README.md) - Project overview
- [API Documentation](./api/) - Detailed API reference
- [Architecture Overview](./architecture/01-system-overview.md) - System design
- [Security Guide](../SECURITY.md) - Security best practices

---

**CretoAI: Quantum protection for the agentic enterprise** 🛡️

*When your business runs on AI agents, security isn't optional—it's foundational.*
