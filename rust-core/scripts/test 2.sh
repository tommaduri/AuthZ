#!/usr/bin/env bash
# Vigilia AI Protocol Test Script

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

# Run unit tests
run_unit_tests() {
    echo_info "Running unit tests..."
    cargo test --all --lib
}

# Run integration tests
run_integration_tests() {
    echo_info "Running integration tests..."
    cargo test --all --test '*'
}

# Run benchmarks
run_benchmarks() {
    echo_info "Running benchmarks..."
    cargo bench --all
}

# Run WASM tests
run_wasm_tests() {
    echo_info "Running WASM tests..."
    wasm-pack test --headless --firefox --chrome
}

# Coverage report
generate_coverage() {
    echo_info "Generating coverage report..."
    cargo tarpaulin --out Html --output-dir coverage
}

main() {
    case "${1:-all}" in
        unit)
            run_unit_tests
            ;;
        integration)
            run_integration_tests
            ;;
        bench)
            run_benchmarks
            ;;
        wasm)
            run_wasm_tests
            ;;
        coverage)
            generate_coverage
            ;;
        all)
            run_unit_tests
            run_integration_tests
            ;;
        *)
            echo "Usage: $0 [unit|integration|bench|wasm|coverage|all]"
            exit 1
            ;;
    esac

    echo_info "Tests complete! ✅"
}

main "$@"
