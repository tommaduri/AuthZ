#!/bin/bash
# CretoAI Quantum-Resistant Demo
# Automated 5-minute demonstration of post-quantum cryptography

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
API_URL="http://localhost:8080"
DEMO_COMPOSE="docker-compose.demo.yml"

echo -e "${CYAN}"
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║       CretoAI: Quantum-Resistant Security Demo                ║"
echo "║       Post-Quantum Cryptography in Action                     ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Function to print section headers
section() {
    echo -e "\n${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${MAGENTA}  $1${NC}"
    echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

# Function to wait for service
wait_for_service() {
    local url=$1
    local max_attempts=30
    local attempt=1

    echo -e "${YELLOW}⏳ Waiting for service at $url...${NC}"

    while [ $attempt -le $max_attempts ]; do
        if curl -sf "$url" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Service is ready!${NC}"
            return 0
        fi
        echo -e "${YELLOW}   Attempt $attempt/$max_attempts...${NC}"
        sleep 2
        ((attempt++))
    done

    echo -e "${RED}❌ Service failed to start${NC}"
    return 1
}

# Function to make API call with pretty output
api_call() {
    local method=$1
    local endpoint=$2
    local data=$3
    local description=$4

    echo -e "${BLUE}📡 $description${NC}"
    echo -e "${CYAN}   $method $endpoint${NC}"

    if [ -n "$data" ]; then
        echo -e "${CYAN}   Request: $data${NC}"
        response=$(curl -s -X "$method" "$API_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data")
    else
        response=$(curl -s -X "$method" "$API_URL$endpoint")
    fi

    echo -e "${GREEN}   Response:${NC}"
    echo "$response" | jq '.' 2>/dev/null || echo "$response"
    echo ""
}

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}🧹 Cleaning up...${NC}"
    docker-compose -f "$DEMO_COMPOSE" down -v 2>/dev/null || true
}

# Trap Ctrl+C and cleanup
trap cleanup EXIT INT TERM

# Step 1: Start the cluster
section "1️⃣  Starting CretoAI Cluster"
echo -e "${BLUE}🚀 Launching Docker Compose environment...${NC}"
docker-compose -f "$DEMO_COMPOSE" up -d --build

# Step 2: Wait for health checks
section "2️⃣  Waiting for Health Checks"
wait_for_service "$API_URL/health"

# Give consensus nodes time to connect
echo -e "${YELLOW}⏳ Waiting for consensus nodes to synchronize (10s)...${NC}"
sleep 10

# Step 3: Display cluster status
section "3️⃣  Cluster Status"
echo -e "${BLUE}📊 Docker containers:${NC}"
docker-compose -f "$DEMO_COMPOSE" ps

echo -e "\n${BLUE}🏥 Health check:${NC}"
curl -s "$API_URL/health" | jq '.'

# Step 4: Demonstrate quantum-resistant operations
section "4️⃣  Quantum-Resistant Cryptography Demo"

# 4.1: Key Generation
echo -e "${CYAN}🔐 Demonstrating ML-DSA (Dilithium) Digital Signatures${NC}\n"
api_call POST "/api/v1/crypto/keygen" \
    '{"algorithm":"dilithium","security_level":3}' \
    "Generate quantum-resistant keypair"

# 4.2: Encryption
echo -e "${CYAN}🔒 Demonstrating ML-KEM (Kyber) Encryption${NC}\n"
api_call POST "/api/v1/crypto/encrypt" \
    '{"data":"SGVsbG8sIFF1YW50dW0gV29ybGQh","algorithm":"kyber768"}' \
    "Encrypt data with quantum-resistant algorithm"

# 4.3: Signature
echo -e "${CYAN}✍️  Digital Signature with ML-DSA${NC}\n"
api_call POST "/api/v1/crypto/sign" \
    '{"message":"VGhpcyBpcyBhIHRlc3QgbWVzc2FnZQ==","algorithm":"dilithium87"}' \
    "Sign message with post-quantum signature"

# 4.4: Consensus operation
section "5️⃣  Quantum-Resistant Consensus Demo"
echo -e "${CYAN}🌐 Submitting transaction to Byzantine consensus${NC}\n"
api_call POST "/api/v1/consensus/transaction" \
    '{"data":"Q29uc2Vuc3VzIHRlc3QgZGF0YQ==","priority":"high"}' \
    "Submit transaction to QR-Avalanche DAG"

sleep 3

echo -e "${CYAN}📊 Query consensus state${NC}\n"
api_call GET "/api/v1/consensus/status" \
    "" \
    "Check consensus finality and throughput"

# Step 6: Access Swagger UI
section "6️⃣  Interactive API Documentation"
echo -e "${GREEN}📚 Swagger UI is available at:${NC}"
echo -e "${CYAN}   → http://localhost:8080/swagger-ui${NC}\n"

echo -e "${BLUE}You can explore all API endpoints interactively in your browser${NC}"
echo -e "${BLUE}Try the following operations:${NC}"
echo -e "  • POST /api/v1/crypto/keygen     - Generate quantum-resistant keys"
echo -e "  • POST /api/v1/crypto/encrypt    - ML-KEM encryption"
echo -e "  • POST /api/v1/crypto/sign       - ML-DSA signatures"
echo -e "  • POST /api/v1/consensus/tx      - Submit consensus transaction"
echo -e "  • GET  /api/v1/consensus/status  - Check network status"

# Step 7: Example curl commands
section "7️⃣  Example curl Commands"
cat << 'EOF'
# Health check
curl http://localhost:8080/health

# Generate quantum-resistant keypair
curl -X POST http://localhost:8080/api/v1/crypto/keygen \
  -H "Content-Type: application/json" \
  -d '{"algorithm":"dilithium","security_level":3}'

# Encrypt with ML-KEM (Kyber)
curl -X POST http://localhost:8080/api/v1/crypto/encrypt \
  -H "Content-Type: application/json" \
  -d '{"data":"SGVsbG8sIFdvcmxkIQ==","algorithm":"kyber768"}'

# Sign with ML-DSA (Dilithium)
curl -X POST http://localhost:8080/api/v1/crypto/sign \
  -H "Content-Type: application/json" \
  -d '{"message":"VGVzdCBtZXNzYWdl","algorithm":"dilithium87"}'

# Submit consensus transaction
curl -X POST http://localhost:8080/api/v1/consensus/transaction \
  -H "Content-Type: application/json" \
  -d '{"data":"VHJhbnNhY3Rpb24gZGF0YQ==","priority":"high"}'
EOF

# Step 8: Performance metrics
section "8️⃣  Performance Metrics"
echo -e "${BLUE}📈 Real-time metrics:${NC}"
api_call GET "/api/v1/metrics" \
    "" \
    "Fetch consensus throughput and latency"

# Final summary
section "✅ Demo Complete!"
echo -e "${GREEN}CretoAI cluster is running with:${NC}"
echo -e "  ${CYAN}✓${NC} REST API Server:        http://localhost:8080"
echo -e "  ${CYAN}✓${NC} Swagger UI:             http://localhost:8080/swagger-ui"
echo -e "  ${CYAN}✓${NC} 3 Consensus Nodes:      Byzantine fault-tolerant"
echo -e "  ${CYAN}✓${NC} Quantum-Resistant:      ML-KEM + ML-DSA + BLAKE3"
echo -e "  ${CYAN}✓${NC} Performance:            10,000+ TPS baseline\n"

echo -e "${YELLOW}📝 Next steps:${NC}"
echo -e "  1. Open Swagger UI in your browser"
echo -e "  2. Try the interactive API endpoints"
echo -e "  3. View container logs: ${CYAN}docker-compose -f $DEMO_COMPOSE logs -f${NC}"
echo -e "  4. Stop demo: ${CYAN}docker-compose -f $DEMO_COMPOSE down${NC}\n"

echo -e "${MAGENTA}Press Ctrl+C to stop the demo and cleanup${NC}"

# Keep running
echo -e "\n${BLUE}🔄 Demo is running. Press Ctrl+C to stop...${NC}\n"
tail -f /dev/null
