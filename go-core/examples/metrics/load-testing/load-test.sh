#!/bin/bash
# Load Testing Script using Apache Bench for Authorization Engine
# Tests authorization checks with varying concurrency and duration patterns

set -e

# Configuration
ENDPOINT="${ENDPOINT:-http://localhost:8080/v1/check}"
OUTPUT_DIR="${OUTPUT_DIR:-./results}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Test configurations
CONCURRENCY_LEVELS=(10 50 100)
REQUEST_COUNTS=(1000 5000 10000)
POLICIES=("viewer" "editor" "admin")

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Check if Apache Bench is installed
check_dependencies() {
    if ! command -v ab &> /dev/null; then
        print_error "Apache Bench (ab) is not installed. Please install it first."
        echo "  macOS: brew install httpd"
        echo "  Ubuntu: sudo apt-get install apache2-utils"
        exit 1
    fi

    if ! command -v jq &> /dev/null; then
        print_warning "jq is not installed. CSV generation may be limited."
        echo "  macOS: brew install jq"
        echo "  Ubuntu: sudo apt-get install jq"
    fi
}

# Generate request payload for different policies
generate_request() {
    local policy=$1
    local resource_type="document"
    local action="read"

    case $policy in
        "editor")
            action="write"
            ;;
        "admin")
            action="delete"
            ;;
    esac

    cat > "/tmp/request_${policy}.json" <<EOF
{
  "subject": "user:test_${policy}@example.com",
  "action": "${action}",
  "resource": "resource:${resource_type}:12345",
  "context": {
    "ip_address": "192.168.1.100",
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "policy": "${policy}"
  }
}
EOF
    echo "/tmp/request_${policy}.json"
}

# Parse Apache Bench output and extract metrics
parse_ab_output() {
    local output_file=$1
    local csv_file=$2

    # Extract key metrics
    local total_requests=$(grep "Complete requests:" "$output_file" | awk '{print $3}')
    local failed_requests=$(grep "Failed requests:" "$output_file" | awk '{print $3}')
    local requests_per_sec=$(grep "Requests per second:" "$output_file" | awk '{print $4}')
    local time_per_request=$(grep "Time per request:" "$output_file" | head -1 | awk '{print $4}')
    local p50=$(grep "50%" "$output_file" | awk '{print $2}')
    local p95=$(grep "95%" "$output_file" | awk '{print $2}')
    local p99=$(grep "99%" "$output_file" | awk '{print $2}')
    local p100=$(grep "100%" "$output_file" | awk '{print $2}')

    # Append to CSV
    echo "$total_requests,$failed_requests,$requests_per_sec,$time_per_request,$p50,$p95,$p99,$p100" >> "$csv_file"
}

# Run a single test
run_test() {
    local concurrency=$1
    local requests=$2
    local policy=$3
    local request_file=$4

    local test_name="${policy}_c${concurrency}_n${requests}"
    local output_file="${OUTPUT_DIR}/${TIMESTAMP}_${test_name}.txt"

    print_status "Running test: $test_name (Concurrency: $concurrency, Requests: $requests, Policy: $policy)"

    # Run Apache Bench
    ab -n "$requests" \
       -c "$concurrency" \
       -p "$request_file" \
       -T "application/json" \
       -g "${OUTPUT_DIR}/${TIMESTAMP}_${test_name}.tsv" \
       "$ENDPOINT" > "$output_file" 2>&1

    # Check if test was successful
    if [ $? -eq 0 ]; then
        print_status "Test completed: $test_name"

        # Display summary
        echo ""
        grep "Requests per second:" "$output_file"
        grep "Time per request:" "$output_file" | head -1
        grep "95%" "$output_file"
        grep "99%" "$output_file"
        echo ""

        return 0
    else
        print_error "Test failed: $test_name"
        cat "$output_file"
        return 1
    fi
}

# Generate CSV report
generate_csv_report() {
    local csv_file="${OUTPUT_DIR}/${TIMESTAMP}_summary.csv"

    print_status "Generating CSV report: $csv_file"

    # CSV Header
    echo "Policy,Concurrency,Requests,Total_Completed,Failed,RPS,Mean_Time_ms,P50_ms,P95_ms,P99_ms,P100_ms" > "$csv_file"

    # Parse all test results
    for result_file in "${OUTPUT_DIR}/${TIMESTAMP}"_*.txt; do
        [ -f "$result_file" ] || continue

        local filename=$(basename "$result_file")
        local policy=$(echo "$filename" | cut -d'_' -f2)
        local concurrency=$(echo "$filename" | cut -d'_' -f3 | sed 's/c//')
        local requests=$(echo "$filename" | cut -d'_' -f4 | sed 's/n//' | sed 's/.txt//')

        local total=$(grep "Complete requests:" "$result_file" | awk '{print $3}')
        local failed=$(grep "Failed requests:" "$result_file" | awk '{print $3}')
        local rps=$(grep "Requests per second:" "$result_file" | awk '{print $4}')
        local mean=$(grep "Time per request:" "$result_file" | head -1 | awk '{print $4}')
        local p50=$(grep "50%" "$result_file" | awk '{print $2}')
        local p95=$(grep "95%" "$result_file" | awk '{print $2}')
        local p99=$(grep "99%" "$result_file" | awk '{print $2}')
        local p100=$(grep "100%" "$result_file" | awk '{print $2}')

        echo "$policy,$concurrency,$requests,$total,$failed,$rps,$mean,$p50,$p95,$p99,$p100" >> "$csv_file"
    done

    print_status "CSV report generated successfully"
}

# Validate SLO targets
validate_slo() {
    local csv_file="${OUTPUT_DIR}/${TIMESTAMP}_summary.csv"
    local slo_p99_ms=0.01  # 10µs = 0.01ms

    print_status "Validating SLO targets (p99 < 10µs)"

    local violations=0

    while IFS=',' read -r policy concurrency requests total failed rps mean p50 p95 p99 p100; do
        # Skip header
        if [ "$policy" = "Policy" ]; then
            continue
        fi

        # Check if p99 exceeds SLO
        if (( $(echo "$p99 > $slo_p99_ms" | bc -l) )); then
            print_error "SLO VIOLATION: $policy (c=$concurrency, n=$requests) - p99=${p99}ms > ${slo_p99_ms}ms"
            ((violations++))
        else
            print_status "SLO MET: $policy (c=$concurrency, n=$requests) - p99=${p99}ms"
        fi
    done < "$csv_file"

    echo ""
    if [ $violations -eq 0 ]; then
        print_status "All tests met SLO targets!"
    else
        print_warning "Found $violations SLO violations"
    fi
}

# Main execution
main() {
    print_status "Starting Load Testing Suite"
    print_status "Endpoint: $ENDPOINT"
    print_status "Output Directory: $OUTPUT_DIR"
    echo ""

    # Check dependencies
    check_dependencies

    # Check if server is running
    if ! curl -s -f "$ENDPOINT" > /dev/null 2>&1; then
        print_warning "Cannot reach endpoint: $ENDPOINT"
        print_warning "Make sure the authorization server is running"
        read -p "Continue anyway? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi

    # Generate request files for each policy
    local request_files=()
    for policy in "${POLICIES[@]}"; do
        request_files+=("$(generate_request "$policy")")
    done

    # Run tests for each combination
    local total_tests=$((${#CONCURRENCY_LEVELS[@]} * ${#REQUEST_COUNTS[@]} * ${#POLICIES[@]}))
    local current_test=0

    for policy in "${POLICIES[@]}"; do
        local request_file=$(generate_request "$policy")

        for concurrency in "${CONCURRENCY_LEVELS[@]}"; do
            for requests in "${REQUEST_COUNTS[@]}"; do
                ((current_test++))
                echo ""
                print_status "Progress: $current_test / $total_tests"

                run_test "$concurrency" "$requests" "$policy" "$request_file"

                # Brief pause between tests
                sleep 2
            done
        done
    done

    # Generate CSV report
    echo ""
    generate_csv_report

    # Validate SLO
    echo ""
    validate_slo

    # Cleanup temp files
    rm -f /tmp/request_*.json

    echo ""
    print_status "Load testing completed!"
    print_status "Results saved to: $OUTPUT_DIR"
    print_status "Summary CSV: ${OUTPUT_DIR}/${TIMESTAMP}_summary.csv"
}

# Run main
main "$@"
