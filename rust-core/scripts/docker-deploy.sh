#!/bin/bash
# Quick deployment script for Vigilia AI Quantum-Resistant QUIC network

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🛡️ Vigilia AI Quantum-Resistant QUIC Deployment${NC}"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker and try again.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker is running${NC}"

# Parse command
COMMAND=${1:-"start"}

case "$COMMAND" in
    start)
        echo -e "${BLUE}🚀 Building and starting quantum-resistant QUIC network...${NC}"
        echo ""
        docker-compose -f docker-compose.quic.yml up --build -d
        echo ""
        echo -e "${GREEN}✅ Network started successfully!${NC}"
        echo ""
        echo -e "${YELLOW}📊 View logs:${NC}"
        echo "  docker-compose -f docker-compose.quic.yml logs -f"
        echo ""
        echo -e "${YELLOW}🔍 Check status:${NC}"
        echo "  docker-compose -f docker-compose.quic.yml ps"
        echo ""
        ;;

    stop)
        echo -e "${BLUE}🛑 Stopping QUIC network...${NC}"
        docker-compose -f docker-compose.quic.yml down
        echo -e "${GREEN}✅ Network stopped${NC}"
        ;;

    logs)
        echo -e "${BLUE}📋 Showing logs (Ctrl+C to exit)...${NC}"
        docker-compose -f docker-compose.quic.yml logs -f
        ;;

    status)
        echo -e "${BLUE}📊 Network Status:${NC}"
        echo ""
        docker-compose -f docker-compose.quic.yml ps
        echo ""
        echo -e "${BLUE}🔍 Container Health:${NC}"
        docker ps --filter "name=vigilia-quic" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
        ;;

    clean)
        echo -e "${YELLOW}🧹 Cleaning up (removing volumes)...${NC}"
        docker-compose -f docker-compose.quic.yml down -v
        rm -rf docker-data/quic-*
        echo -e "${GREEN}✅ Cleanup complete${NC}"
        ;;

    test)
        echo -e "${BLUE}🧪 Running connection test...${NC}"
        echo ""
        docker-compose -f docker-compose.quic.yml up -d quic-node-1
        sleep 3
        docker-compose -f docker-compose.quic.yml run --rm quic-client \
            /usr/local/bin/quic_node --mode client --server 172.21.0.10:9001 --agent-id test-client
        ;;

    rebuild)
        echo -e "${BLUE}🔨 Rebuilding containers...${NC}"
        docker-compose -f docker-compose.quic.yml build --no-cache
        echo -e "${GREEN}✅ Rebuild complete${NC}"
        ;;

    shell)
        NODE=${2:-"quic-node-1"}
        echo -e "${BLUE}🐚 Opening shell in ${NODE}...${NC}"
        docker exec -it vigilia-${NODE} /bin/bash
        ;;

    *)
        echo -e "${YELLOW}Usage: $0 {start|stop|logs|status|clean|test|rebuild|shell}${NC}"
        echo ""
        echo "Commands:"
        echo "  start    - Build and start the QUIC network"
        echo "  stop     - Stop the network"
        echo "  logs     - View live logs"
        echo "  status   - Check container status"
        echo "  clean    - Stop and remove all data"
        echo "  test     - Run quick connection test"
        echo "  rebuild  - Rebuild containers from scratch"
        echo "  shell    - Open shell in container (default: quic-node-1)"
        echo ""
        echo "Examples:"
        echo "  $0 start           # Start the network"
        echo "  $0 logs            # Watch logs"
        echo "  $0 shell quic-node-2  # Shell into node 2"
        exit 1
        ;;
esac
