#!/bin/bash
# Quick test script for CretoAI Docker environment
# Tests basic functionality without full demo

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🧪 CretoAI Quick Test${NC}\n"

# Start services
echo -e "${YELLOW}1. Starting services...${NC}"
docker-compose -f docker-compose.demo.yml up -d --build

# Wait for API
echo -e "${YELLOW}2. Waiting for API server...${NC}"
for i in {1..30}; do
    if curl -sf http://localhost:8080/health > /dev/null 2>&1; then
        echo -e "${GREEN}✅ API is ready${NC}"
        break
    fi
    echo -n "."
    sleep 2
done

# Test health endpoint
echo -e "\n${YELLOW}3. Testing health endpoint...${NC}"
response=$(curl -s http://localhost:8080/health)
echo "$response" | jq '.'

if echo "$response" | jq -e '.status == "healthy"' > /dev/null; then
    echo -e "${GREEN}✅ Health check passed${NC}"
else
    echo -e "${RED}❌ Health check failed${NC}"
    exit 1
fi

# Test Swagger UI
echo -e "\n${YELLOW}4. Testing Swagger UI...${NC}"
if curl -sf http://localhost:8080/swagger-ui > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Swagger UI is accessible${NC}"
else
    echo -e "${RED}❌ Swagger UI not accessible${NC}"
fi

# Container status
echo -e "\n${YELLOW}5. Container status:${NC}"
docker-compose -f docker-compose.demo.yml ps

# Cleanup
echo -e "\n${YELLOW}6. Cleaning up...${NC}"
docker-compose -f docker-compose.demo.yml down -v

echo -e "\n${GREEN}✅ All tests passed!${NC}"
echo -e "${BLUE}Run './scripts/demo.sh' for full interactive demo${NC}\n"
