#!/usr/bin/env bash
# Vigilia AI Protocol Build Script

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

echo_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

echo_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check for required tools
check_dependencies() {
    echo_info "Checking dependencies..."

    if ! command -v cargo &> /dev/null; then
        echo_error "cargo not found. Please install Rust: https://rustup.rs/"
        exit 1
    fi

    if ! command -v wasm-pack &> /dev/null; then
        echo_warn "wasm-pack not found. Installing..."
        cargo install wasm-pack
    fi

    echo_info "All dependencies satisfied"
}

# Build Rust workspace
build_rust() {
    echo_info "Building Rust workspace..."
    cargo build --release --all-features
    echo_info "Rust build complete"
}

# Build WASM packages
build_wasm() {
    echo_info "Building WASM packages..."
    wasm-pack build --target web --out-dir pkg
    wasm-pack build --target nodejs --out-dir pkg-node
    echo_info "WASM build complete"
}

# Run tests
run_tests() {
    echo_info "Running tests..."
    cargo test --all --all-features
    echo_info "Tests passed"
}

# Run linting
run_lint() {
    echo_info "Running linter..."
    cargo clippy --all-targets --all-features -- -D warnings
    echo_info "Linting passed"
}

# Format check
check_format() {
    echo_info "Checking code formatting..."
    cargo fmt --all -- --check
    echo_info "Format check passed"
}

# Main build process
main() {
    local BUILD_WASM=false
    local RUN_TESTS=false
    local RUN_LINT=false
    local CHECK_FMT=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --wasm)
                BUILD_WASM=true
                shift
                ;;
            --test)
                RUN_TESTS=true
                shift
                ;;
            --lint)
                RUN_LINT=true
                shift
                ;;
            --format)
                CHECK_FMT=true
                shift
                ;;
            --all)
                BUILD_WASM=true
                RUN_TESTS=true
                RUN_LINT=true
                CHECK_FMT=true
                shift
                ;;
            *)
                echo_error "Unknown option: $1"
                echo "Usage: $0 [--wasm] [--test] [--lint] [--format] [--all]"
                exit 1
                ;;
        esac
    done

    check_dependencies
    build_rust

    if [ "$BUILD_WASM" = true ]; then
        build_wasm
    fi

    if [ "$RUN_TESTS" = true ]; then
        run_tests
    fi

    if [ "$RUN_LINT" = true ]; then
        run_lint
    fi

    if [ "$CHECK_FMT" = true ]; then
        check_format
    fi

    echo_info "Build complete! 🚀"
}

main "$@"
