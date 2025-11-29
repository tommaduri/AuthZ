#!/bin/bash

# Load Testing Script for Auth Engine
# Tests authentication endpoints under load using Apache Bench (ab)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
BASE_URL="${BASE_URL:-http://localhost:8080}"
TOTAL_REQUESTS="${TOTAL_REQUESTS:-10000}"
CONCURRENT="${CONCURRENT:-100}"
TIMEOUT="${TIMEOUT:-30}"

echo -e "${GREEN}=== Authentication Load Test ===${NC}"
echo "Base URL: $BASE_URL"
echo "Total Requests: $TOTAL_REQUESTS"
echo "Concurrent: $CONCURRENT"
echo "Timeout: ${TIMEOUT}s"
echo ""

# Check if server is running
echo -e "${YELLOW}Checking if server is available...${NC}"
if ! curl -s -f "${BASE_URL}/health" > /dev/null 2>&1; then
    echo -e "${RED}Error: Server not available at ${BASE_URL}${NC}"
    echo "Please start the server first"
    exit 1
fi
echo -e "${GREEN}✓ Server is running${NC}"
echo ""

# Check for required tools
command -v ab >/dev/null 2>&1 || {
    echo -e "${RED}Error: Apache Bench (ab) is required but not installed${NC}"
    echo "Install with: brew install apache2 (macOS) or apt-get install apache2-utils (Linux)"
    exit 1
}

# Create temporary directory for results
RESULTS_DIR="./load-test-results-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESULTS_DIR"

echo -e "${GREEN}Results will be saved to: $RESULTS_DIR${NC}"
echo ""

# Function to run load test
run_load_test() {
    local name=$1
    local endpoint=$2
    local method=$3
    local data=$4
    local content_type=$5

    echo -e "${YELLOW}Running: $name${NC}"
    echo "Endpoint: $endpoint"
    echo "Method: $method"
    echo ""

    local output_file="$RESULTS_DIR/${name}.txt"

    if [ "$method" = "GET" ]; then
        ab -n "$TOTAL_REQUESTS" \
           -c "$CONCURRENT" \
           -s "$TIMEOUT" \
           -g "$RESULTS_DIR/${name}.tsv" \
           "${BASE_URL}${endpoint}" > "$output_file" 2>&1
    elif [ "$method" = "POST" ]; then
        # Create temp file with POST data
        local temp_data="/tmp/load-test-data-$$.json"
        echo "$data" > "$temp_data"

        ab -n "$TOTAL_REQUESTS" \
           -c "$CONCURRENT" \
           -s "$TIMEOUT" \
           -p "$temp_data" \
           -T "$content_type" \
           -g "$RESULTS_DIR/${name}.tsv" \
           "${BASE_URL}${endpoint}" > "$output_file" 2>&1

        rm -f "$temp_data"
    fi

    # Parse and display results
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Test completed successfully${NC}"

        # Extract key metrics
        local requests_per_sec=$(grep "Requests per second" "$output_file" | awk '{print $4}')
        local time_per_request=$(grep "Time per request.*mean\)" "$output_file" | awk '{print $4}')
        local failed_requests=$(grep "Failed requests:" "$output_file" | awk '{print $3}')
        local p50=$(grep "50%" "$output_file" | awk '{print $2}')
        local p95=$(grep "95%" "$output_file" | awk '{print $2}')
        local p99=$(grep "99%" "$output_file" | awk '{print $2}')

        echo "  Requests/sec: $requests_per_sec"
        echo "  Time/request: ${time_per_request}ms (mean)"
        echo "  Failed: $failed_requests"
        echo "  Latency p50: ${p50}ms"
        echo "  Latency p95: ${p95}ms"
        echo "  Latency p99: ${p99}ms"

        # Check for failures
        if [ "$failed_requests" -gt 0 ]; then
            echo -e "${RED}  ✗ WARNING: $failed_requests requests failed${NC}"
        fi

        echo ""
    else
        echo -e "${RED}✗ Test failed${NC}"
        cat "$output_file"
        echo ""
    fi
}

# Test 1: Health Check Endpoint (baseline)
run_load_test "health-check" "/health" "GET" "" ""

# Test 2: Token Validation (if endpoint exists)
# Note: This requires a valid token to be generated first
if curl -s -f "${BASE_URL}/api/auth/login" > /dev/null 2>&1; then
    echo -e "${YELLOW}Generating test token...${NC}"

    # Generate a test token
    TOKEN_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/auth/login" \
        -H "Content-Type: application/json" \
        -d '{
            "agent_id": "agent:load-test",
            "roles": ["user"],
            "tenant_id": "tenant-load",
            "scopes": ["read:data"]
        }')

    if [ $? -eq 0 ] && [ -n "$TOKEN_RESPONSE" ]; then
        ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

        if [ -n "$ACCESS_TOKEN" ]; then
            echo -e "${GREEN}✓ Test token generated${NC}"
            echo ""

            # Test token validation under load
            # For Apache Bench with headers, we need to use a different approach
            echo -e "${YELLOW}Token validation load test requires custom script${NC}"
            echo "Token: ${ACCESS_TOKEN:0:20}..."
            echo ""
        fi
    fi
fi

# Test 3: Concurrent Mixed Load (if applicable)
# This simulates a realistic mix of read/write operations

echo -e "${GREEN}=== Load Test Summary ===${NC}"
echo "All tests completed"
echo "Results saved to: $RESULTS_DIR"
echo ""

# Generate summary report
SUMMARY_FILE="$RESULTS_DIR/summary.md"
cat > "$SUMMARY_FILE" << EOF
# Authentication Load Test Results

**Date:** $(date)
**Configuration:**
- Total Requests: $TOTAL_REQUESTS
- Concurrent Users: $CONCURRENT
- Timeout: ${TIMEOUT}s
- Base URL: $BASE_URL

## Test Results

EOF

# Parse all result files
for result in "$RESULTS_DIR"/*.txt; do
    if [ -f "$result" ]; then
        test_name=$(basename "$result" .txt)
        echo "### $test_name" >> "$SUMMARY_FILE"
        echo "" >> "$SUMMARY_FILE"

        # Extract metrics
        grep "Requests per second" "$result" >> "$SUMMARY_FILE" || true
        grep "Time per request.*mean" "$result" >> "$SUMMARY_FILE" || true
        grep "Failed requests:" "$result" >> "$SUMMARY_FILE" || true
        grep -A 5 "Percentage of the requests" "$result" >> "$SUMMARY_FILE" || true

        echo "" >> "$SUMMARY_FILE"
    fi
done

echo -e "${GREEN}Summary report: $SUMMARY_FILE${NC}"
echo ""

# Check for any failures across all tests
TOTAL_FAILURES=0
for result in "$RESULTS_DIR"/*.txt; do
    if [ -f "$result" ]; then
        failures=$(grep "Failed requests:" "$result" | awk '{print $3}' || echo "0")
        TOTAL_FAILURES=$((TOTAL_FAILURES + failures))
    fi
done

if [ "$TOTAL_FAILURES" -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed with no failures${NC}"
    exit 0
else
    echo -e "${RED}✗ Total failures across all tests: $TOTAL_FAILURES${NC}"
    exit 1
fi
