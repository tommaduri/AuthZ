# Quick Start: Deploy Vigilia AI Locally with Docker 🚀

Get a 3-node quantum-resistant QUIC network running in **under 2 minutes**.

## Prerequisites

- Docker installed and running
- 2GB free disk space
- Ports 9001-9003 available

## 🎯 One-Command Deployment

```bash
# Clone and deploy
git clone https://github.com/Creto-Systems/vigilia.git
cd vigilia
./scripts/docker-deploy.sh start
```

**That's it!** Your quantum-resistant network is now running.

---

## 📊 Verify Deployment

### Check Status
```bash
./scripts/docker-deploy.sh status
```

Expected output:
```
vigilia-quic-1    Up (healthy)   0.0.0.0:9001->9001/udp
vigilia-quic-2    Up             0.0.0.0:9002->9001/udp
vigilia-quic-3    Up             0.0.0.0:9003->9001/udp
```

### View Logs
```bash
./scripts/docker-deploy.sh logs
```

Look for these success indicators:
```
✅ Agent identity generated with ML-KEM-768 keypair
🎧 Server listening on 0.0.0.0:9001
🔐 Hybrid handshake: X25519 + ML-KEM-768 (NIST FIPS 203)
✨ New connection from 172.21.0.20
🔑 Quantum-resistant handshake completed
```

---

## 🧪 Test Connection

```bash
./scripts/docker-deploy.sh test
```

This runs a test client that connects to the bootstrap node and verifies the quantum-resistant handshake.

Expected output:
```
🔌 Connecting to server at 172.21.0.10:9001
✅ Client identity generated
🤝 Initiating quantum-resistant handshake...
✨ Connected successfully!
🔐 Hybrid handshake complete: X25519 + ML-KEM-768
```

---

## 🔍 What's Running?

Your local deployment includes:

### Network Architecture
```
┌─────────────────────────────────────────┐
│    Vigilia AI QUIC Network              │
│    (172.21.0.0/16)                      │
└─────────────────────────────────────────┘
        │            │            │
  ┌─────┴─────┐ ┌───┴────┐ ┌────┴─────┐
  │ Bootstrap │ │ Peer 2 │ │ Peer 3   │
  │ Node      │ │ Node   │ │ Node     │
  │ :9001     │ │ :9002  │ │ :9003    │
  └───────────┘ └────────┘ └──────────┘
```

### Security Features

✅ **Quantum-Resistant**: ML-KEM-768 (NIST FIPS 203)
✅ **Hybrid Crypto**: X25519 + ML-KEM-768
✅ **TLS 1.3**: Modern transport encryption
✅ **QUIC**: Low-latency UDP transport

**Performance:**
- Handshake: ~15.7ms (vs 15ms classical)
- Overhead: +0.7ms only
- Bandwidth: 2272 bytes post-quantum overhead

---

## 📋 Common Commands

```bash
# Start network
./scripts/docker-deploy.sh start

# Stop network
./scripts/docker-deploy.sh stop

# View logs (live)
./scripts/docker-deploy.sh logs

# Check status
./scripts/docker-deploy.sh status

# Run connection test
./scripts/docker-deploy.sh test

# Clean everything (remove data)
./scripts/docker-deploy.sh clean

# Rebuild containers
./scripts/docker-deploy.sh rebuild

# Open shell in node
./scripts/docker-deploy.sh shell quic-node-1
```

---

## 🐛 Troubleshooting

### Docker not running?
```bash
# macOS
open -a Docker

# Linux
sudo systemctl start docker
```

### Ports already in use?
```bash
# Check what's using ports 9001-9003
lsof -i :9001
lsof -i :9002
lsof -i :9003

# Edit docker-compose.quic.yml to use different ports
```

### Build failing?
```bash
# Clear Docker cache and rebuild
docker system prune -a
./scripts/docker-deploy.sh rebuild
```

### Can't connect?
```bash
# Check if containers are running
docker ps | grep vigilia-quic

# Check logs for errors
./scripts/docker-deploy.sh logs | grep -i error

# Restart network
./scripts/docker-deploy.sh stop
./scripts/docker-deploy.sh start
```

---

## 📚 Next Steps

### Run Tests
```bash
# Run all quantum QUIC tests
cargo test --package vigilia-network quic

# Run integration tests
cargo test --package vigilia-network quic -- --ignored
```

### Explore Examples
```bash
# Multi-node consensus
cargo run --example multinode_test

# Byzantine fault tolerance
cargo run --example byzantine_test

# Agent authorization
cargo run --example agent_authorization
```

### Learn More
- [Full Docker Deployment Guide](./docs/DOCKER_DEPLOYMENT.md)
- [Phase 2 Architecture](./docs/phase2-quinn-rustls-architecture.md)
- [QUIC Integration Tests](./docs/quic-integration-tests-summary.md)
- [Project README](./README.md)

---

## 🎓 Understanding the Output

When you run `./scripts/docker-deploy.sh logs`, you'll see:

```
vigilia-quic-1 | 🚀 Vigilia AI Quantum-Resistant QUIC Node
```
→ Node starting up

```
vigilia-quic-1 | ✅ Agent identity generated with ML-KEM-768 keypair
```
→ Post-quantum cryptographic identity created (NIST FIPS 203)

```
vigilia-quic-1 | 🎧 Server listening on 0.0.0.0:9001
```
→ QUIC server ready to accept connections

```
vigilia-quic-1 | 🔐 Hybrid handshake: X25519 + ML-KEM-768
```
→ Using both classical and quantum-resistant key exchange

```
vigilia-quic-1 | ✨ New connection from 172.21.0.20
vigilia-quic-1 | 🔑 Quantum-resistant handshake completed
```
→ Successfully established secure quantum-resistant connection

---

## 💡 Pro Tips

### Monitor Resource Usage
```bash
docker stats vigilia-quic-1 vigilia-quic-2 vigilia-quic-3
```

### Export Logs for Analysis
```bash
docker-compose -f docker-compose.quic.yml logs > deployment.log
```

### Run in Production Mode
```bash
# Set production logging
RUST_LOG=warn docker-compose -f docker-compose.quic.yml up -d
```

### Connect Your Own Client
```bash
# From your host machine
cargo run --example quic_node -- \
  --mode client \
  --server 127.0.0.1:9001 \
  --agent-id my-test-client
```

---

## ✅ Success Criteria

Your deployment is successful if:

1. ✅ All 3 nodes show "Up (healthy)" in status
2. ✅ Logs show "quantum-resistant handshake completed"
3. ✅ Test client connects successfully
4. ✅ No errors in logs for 1 minute

**Congratulations!** You're running a quantum-resistant AI agent network. 🎉

---

## 🚀 Production Deployment

For production environments:
- See [DOCKER_DEPLOYMENT.md](./docs/DOCKER_DEPLOYMENT.md) for advanced configuration
- Configure proper TLS certificates
- Set up monitoring and alerting
- Use Docker Swarm or Kubernetes for orchestration
- Implement backup and disaster recovery

---

**Questions?** Check the [full documentation](./docs/DOCKER_DEPLOYMENT.md) or open an issue on GitHub.
