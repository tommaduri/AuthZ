# Docker Deployment Guide - CretoAI AI Quantum-Resistant QUIC

This guide shows how to deploy CretoAI AI's quantum-resistant QUIC transport locally using Docker.

## 🚀 Quick Start

### 1. Build and Run the Network

```bash
# Build and start 3-node quantum-resistant QUIC network
docker-compose -f docker-compose.quic.yml up --build

# Or run in detached mode
docker-compose -f docker-compose.quic.yml up --build -d
```

### 2. View Logs

```bash
# Watch all nodes
docker-compose -f docker-compose.quic.yml logs -f

# Watch specific node
docker logs -f cretoai-quic-1

# Watch client connection
docker logs -f cretoai-quic-client
```

### 3. Stop the Network

```bash
docker-compose -f docker-compose.quic.yml down

# Remove volumes as well
docker-compose -f docker-compose.quic.yml down -v
```

---

## 🏗️ Network Architecture

The deployment creates a 3-node quantum-resistant QUIC network:

```
┌─────────────────────────────────────────────────────┐
│           CretoAI AI QUIC Network                   │
│                (172.21.0.0/16)                      │
└─────────────────────────────────────────────────────┘
              │                │              │
    ┌─────────┴────────┐ ┌─────┴──────┐ ┌────┴────────┐
    │  Bootstrap Node  │ │  Peer Node │ │  Peer Node  │
    │  172.21.0.10     │ │  172.21.0.11│ │ 172.21.0.12 │
    │  Port: 9001/udp  │ │  9002/udp   │ │  9003/udp   │
    └──────────────────┘ └─────────────┘ └─────────────┘
              ▲
              │
    ┌─────────┴────────┐
    │   Test Client    │
    │  172.21.0.20     │
    └──────────────────┘
```

### Node Details

**Bootstrap Node (cretoai-quic-1)**:
- IP: `172.21.0.10`
- Port: `9001/udp` (mapped to host `9001/udp`)
- Agent ID: `cretoai-bootstrap`
- Role: Primary server accepting connections

**Peer Node 2 (cretoai-quic-2)**:
- IP: `172.21.0.11`
- Port: `9001/udp` (mapped to host `9002/udp`)
- Agent ID: `cretoai-peer-2`
- Role: Secondary server

**Peer Node 3 (cretoai-quic-3)**:
- IP: `172.21.0.12`
- Port: `9001/udp` (mapped to host `9003/udp`)
- Agent ID: `cretoai-peer-3`
- Role: Secondary server

**Test Client (cretoai-quic-client)**:
- IP: `172.21.0.20`
- Connects to: Bootstrap node `172.21.0.10:9001`
- Agent ID: `cretoai-test-client`
- Role: Demonstrates client connection

---

## 🔐 Quantum-Resistant Features

Each node implements:

### **Hybrid Key Exchange**
- **Classical**: X25519 ECDH (128-bit security)
- **Post-Quantum**: ML-KEM-768 (NIST Level 3, ~192-bit equivalent)
- **Combined**: Requires breaking both algorithms

### **NIST Standards**
- ✅ ML-KEM-768 (FIPS 203) - Key Encapsulation Mechanism
- ✅ Hybrid TLS 1.3 handshake
- ✅ BLAKE3 secret derivation with domain separation

### **Performance**
- Handshake latency: ~15.7ms (vs 15ms classical)
- Overhead: +0.7ms (~4.7% increase)
- Bandwidth: 2272 bytes (ML-KEM pubkey + ciphertext)

---

## 🔧 Configuration

### Environment Variables

Each container supports these environment variables:

- `RUST_LOG`: Log level (default: `info,vigilia_network=debug`)
- `VIGILIA_NODE_ID`: Unique node identifier
- `VIGILIA_DATA_DIR`: Data directory path (default: `/data`)

### Command-Line Arguments

The `quic_node` binary supports:

```bash
# Server mode
quic_node --mode server --port 9001 --agent-id my-agent

# Client mode
quic_node --mode client --server 172.21.0.10:9001 --agent-id my-client
```

**Arguments**:
- `--mode <server|client>`: Operation mode
- `--port <PORT>`: UDP port for server (default: 9001)
- `--server <ADDR:PORT>`: Server address for client
- `--agent-id <ID>`: Unique agent identifier

---

## 📊 Monitoring

### Check Node Status

```bash
# Check if nodes are running
docker ps | grep cretoai-quic

# Check health status
docker inspect cretoai-quic-1 | jq '.[0].State.Health'

# View resource usage
docker stats cretoai-quic-1 cretoai-quic-2 cretoai-quic-3
```

### View Handshake Logs

```bash
# Watch for successful handshakes
docker logs -f cretoai-quic-1 | grep -E "(handshake|connection|ML-KEM)"

# Example output:
# ✨ New connection from 172.21.0.20:xxxxx
# 🔑 Quantum-resistant handshake completed
# 🔐 Hybrid handshake: X25519 + ML-KEM-768 (NIST FIPS 203)
```

### Test Client Connection

```bash
# Run manual client test
docker-compose -f docker-compose.quic.yml run --rm quic-client \
  /usr/local/bin/quic_node --mode client --server 172.21.0.10:9001 --agent-id test-1

# Expected output:
# 🔌 Connecting to server at 172.21.0.10:9001
# ✅ Client identity generated
# 🤝 Initiating quantum-resistant handshake...
# ✨ Connected successfully!
# 🔐 Hybrid handshake complete: X25519 + ML-KEM-768
```

---

## 🧪 Testing

### Build Without Running

```bash
docker-compose -f docker-compose.quic.yml build
```

### Run Single Node

```bash
docker run --rm -it \
  -p 9001:9001/udp \
  -e RUST_LOG=info,vigilia_network=debug \
  cretoai-quic-1 \
  /usr/local/bin/quic_node --mode server --port 9001
```

### Interactive Shell

```bash
# Access running container
docker exec -it cretoai-quic-1 /bin/bash

# Or start with shell
docker run --rm -it --entrypoint /bin/bash cretoai-quic-1
```

---

## 📁 Data Persistence

Node data is stored in Docker volumes:

```bash
# List volumes
docker volume ls | grep vigilia

# Inspect volume
docker volume inspect docker-data_quic-1-data

# Backup volume
docker run --rm -v docker-data_quic-1-data:/data -v $(pwd):/backup \
  ubuntu tar czf /backup/quic-1-backup.tar.gz /data

# Restore volume
docker run --rm -v docker-data_quic-1-data:/data -v $(pwd):/backup \
  ubuntu tar xzf /backup/quic-1-backup.tar.gz -C /
```

---

## 🐛 Troubleshooting

### Nodes Won't Start

```bash
# Check Docker daemon
docker info

# Check network conflicts
docker network ls
docker network inspect cretoai-quic

# Recreate network
docker-compose -f docker-compose.quic.yml down
docker network rm cretoai-quic
docker-compose -f docker-compose.quic.yml up
```

### Client Can't Connect

```bash
# Check if server is listening
docker logs cretoai-quic-1 | grep "listening on"

# Test network connectivity
docker run --rm --network cretoai-quic alpine \
  ping -c 3 172.21.0.10

# Check firewall/iptables
sudo iptables -L | grep DOCKER
```

### High Memory Usage

```bash
# Check memory limits
docker stats --no-stream

# Set memory limits in docker-compose.quic.yml:
services:
  quic-node-1:
    deploy:
      resources:
        limits:
          memory: 512M
```

---

## 🚀 Production Deployment

For production environments, consider:

1. **TLS Certificates**: Use proper certificates instead of self-signed
2. **Secrets Management**: Use Docker secrets or environment files
3. **Load Balancing**: Add HAProxy or nginx for multiple nodes
4. **Monitoring**: Integrate Prometheus metrics
5. **Logging**: Configure centralized logging (ELK, Splunk)
6. **Security**: Run with minimal privileges, use security scanning

### Example Production Override

```yaml
# docker-compose.prod.yml
version: '3.8'
services:
  quic-node-1:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 1G
      restart_policy:
        condition: on-failure
        max_attempts: 3
    secrets:
      - agent_key
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

secrets:
  agent_key:
    external: true
```

Run with: `docker-compose -f docker-compose.quic.yml -f docker-compose.prod.yml up`

---

## 📚 Additional Resources

- [Phase 2 Architecture](./phase2-quinn-rustls-architecture.md)
- [QUIC Integration Tests](./quic-integration-tests-summary.md)
- [Project Structure](./PROJECT_STRUCTURE.md)
- [NIST FIPS 203 (ML-KEM)](https://csrc.nist.gov/pubs/fips/203/final)

---

## ✅ Success Indicators

You should see these logs indicating successful deployment:

```
cretoai-quic-1    | 🚀 CretoAI AI Quantum-Resistant QUIC Node
cretoai-quic-1    | Agent ID: cretoai-bootstrap
cretoai-quic-1    | ✅ Agent identity generated with ML-KEM-768 keypair
cretoai-quic-1    | 🎧 Server listening on 0.0.0.0:9001
cretoai-quic-1    | 🔐 Hybrid handshake: X25519 + ML-KEM-768 (NIST FIPS 203)
cretoai-quic-1    | 📊 Waiting for quantum-resistant connections...

cretoai-quic-client | 🔌 Connecting to server at 172.21.0.10:9001
cretoai-quic-client | 🤝 Initiating quantum-resistant handshake...
cretoai-quic-client | ✨ Connected successfully!
cretoai-quic-client | 🔐 Hybrid handshake complete: X25519 + ML-KEM-768

cretoai-quic-1    | ✨ New connection from 172.21.0.20:xxxxx
cretoai-quic-1    | 🔑 Quantum-resistant handshake completed
```

**Your quantum-resistant QUIC network is now running!** 🎉
