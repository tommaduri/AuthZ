#!/bin/bash

# generate-proto.sh - Generate protobuf code from proto files
# This script generates Go code from .proto files using protoc

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "AuthZ Engine - Protobuf Code Generation"
echo "========================================"
echo ""

# Check if protoc is installed
if ! command -v protoc &> /dev/null; then
    echo "ERROR: protoc is not installed or not in PATH"
    echo ""
    echo "Installation instructions:"
    echo "  macOS:   brew install protobuf"
    echo "  Linux:   apt-get install protobuf-compiler"
    echo "  Windows: https://github.com/protocolbuffers/protobuf/releases"
    echo ""
    exit 1
fi

# Check if Go plugins are installed
check_plugin() {
    if ! command -v $1 &> /dev/null; then
        echo "Installing $1..."
        go install $2
    fi
}

check_plugin "protoc-gen-go" "google.golang.org/protobuf/cmd/protoc-gen-go@latest"
check_plugin "protoc-gen-go-grpc" "google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest"

echo "Generating protobuf code..."
echo ""

# Navigate to project root
cd "$PROJECT_ROOT"

# Generate Go code for all proto files
PROTO_DIR="${PROJECT_ROOT}/api/proto"

protoc \
    --go_out=. \
    --go-grpc_out=. \
    --go_opt=module=github.com/authz-engine/go-core \
    --go-grpc_opt=module=github.com/authz-engine/go-core \
    -I"${PROTO_DIR}" \
    $(find "${PROTO_DIR}" -name "*.proto")

echo ""
echo "Proto generation completed successfully!"
echo ""

# List generated files
echo "Generated files:"
find "${PROTO_DIR}" -name "*.pb.go" -o -name "*_grpc.pb.go" | while read file; do
    echo "  - $file"
done

echo ""
echo "Next steps:"
echo "  1. Review generated code in api/proto/authz/v1/"
echo "  2. Implement gRPC service handlers in internal/server/"
echo "  3. Run 'make build' to compile the project"
echo ""
