#!/bin/bash
# Local deployment script (no Docker required)
# Runs QUIC nodes directly on your machine

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}🛡️ Vigilia AI Local QUIC Network Deployment${NC}"
echo ""

# Build the example
echo -e "${BLUE}📦 Building QUIC node...${NC}"
cargo build --release --example quic_node

echo -e "${GREEN}✅ Build complete${NC}"
echo ""

# Start nodes in background
echo -e "${BLUE}🚀 Starting 3-node quantum-resistant network...${NC}"

# Node 1 (Bootstrap)
cargo run --release --example quic_node -- \
  --mode server \
  --port 9001 \
  --agent-id bootstrap-node \
  > /tmp/vigilia-node-1.log 2>&1 &
NODE1_PID=$!
echo -e "${GREEN}✅ Node 1 started (PID: $NODE1_PID, Port: 9001)${NC}"

sleep 1

# Node 2
cargo run --release --example quic_node -- \
  --mode server \
  --port 9002 \
  --agent-id peer-node-2 \
  > /tmp/vigilia-node-2.log 2>&1 &
NODE2_PID=$!
echo -e "${GREEN}✅ Node 2 started (PID: $NODE2_PID, Port: 9002)${NC}"

sleep 1

# Node 3
cargo run --release --example quic_node -- \
  --mode server \
  --port 9003 \
  --agent-id peer-node-3 \
  > /tmp/vigilia-node-3.log 2>&1 &
NODE3_PID=$!
echo -e "${GREEN}✅ Node 3 started (PID: $NODE3_PID, Port: 9003)${NC}"

sleep 2

echo ""
echo -e "${GREEN}🎉 Quantum-resistant QUIC network is running!${NC}"
echo ""
echo -e "${YELLOW}📊 Node Information:${NC}"
echo "  Node 1 (Bootstrap): localhost:9001 (PID: $NODE1_PID)"
echo "  Node 2 (Peer):      localhost:9002 (PID: $NODE2_PID)"
echo "  Node 3 (Peer):      localhost:9003 (PID: $NODE3_PID)"
echo ""
echo -e "${YELLOW}📋 View Logs:${NC}"
echo "  tail -f /tmp/vigilia-node-1.log"
echo "  tail -f /tmp/vigilia-node-2.log"
echo "  tail -f /tmp/vigilia-node-3.log"
echo ""
echo -e "${YELLOW}🧪 Test Connection:${NC}"
echo "  cargo run --release --example quic_node -- --mode client --server 127.0.0.1:9001"
echo ""
echo -e "${YELLOW}🛑 Stop Network:${NC}"
echo "  kill $NODE1_PID $NODE2_PID $NODE3_PID"
echo ""

# Save PIDs to file for cleanup
echo "$NODE1_PID" > /tmp/vigilia-pids.txt
echo "$NODE2_PID" >> /tmp/vigilia-pids.txt
echo "$NODE3_PID" >> /tmp/vigilia-pids.txt

echo -e "${GREEN}💡 Network is running in background${NC}"
echo -e "${GREEN}   Press Ctrl+C to stop this script (nodes will continue running)${NC}"
echo ""

# Wait for user interrupt
trap "echo -e '\n${YELLOW}⚠️  Nodes are still running. Stop them with: kill $NODE1_PID $NODE2_PID $NODE3_PID${NC}'; exit 0" INT

echo "Monitoring logs... (Ctrl+C to exit)"
tail -f /tmp/vigilia-node-1.log
