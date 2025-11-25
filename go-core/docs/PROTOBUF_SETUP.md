# Go gRPC Protobuf Generation Setup

This document describes the completed protobuf generation setup for the AuthZ Engine Go core.

## Overview

The gRPC protobuf setup provides type-safe, high-performance communication interfaces for the AuthZ Engine. All files have been generated from the proto definition and are ready for integration.

## Generated Files

### 1. Message Definitions (`authz.pb.go`)
**Location**: `/go-core/api/proto/authz/v1/authz.pb.go`
**Size**: ~47 KB

This file contains all message definitions and enums:

**Core Messages**:
- `CheckRequest` - Authorization check request with principal, resource, actions, and context
- `CheckResponse` - Authorization decision with per-action results and metadata
- `Principal` - Entity requesting access with ID, roles, and attributes
- `Resource` - Resource being accessed with kind, ID, and attributes
- `ActionResult` - Decision for a single action (effect, policy, rule, matched flag, metadata)
- `ResponseMetadata` - Evaluation details (duration, policies evaluated, cache hit status)

**Batch Operations**:
- `CheckBatchRequest` - Multiple authorization check requests
- `CheckBatchResponse` - Multiple responses with total processing duration

**Policy Management**:
- `LoadPoliciesRequest` - Load policies from file, URL, or inline
- `LoadPoliciesResponse` - Confirmation with count and errors
- `Policy` - Authorization policy with name, resource kind, and rules
- `Rule` - Single authorization rule with actions, effect, conditions, and roles
- `ReloadPoliciesRequest` - Trigger policy reload with optional force flag
- `ReloadPoliciesResponse` - Reload status, policy count, and duration

**Enums**:
- `Effect` - ALLOW, DENY, UNSPECIFIED
- `SourceType` - FILE, URL, INLINE, UNSPECIFIED

All messages include proper JSON marshaling, reflection support, and protobuf serialization.

### 2. gRPC Service Interface (`authz_grpc.pb.go`)
**Location**: `/go-core/api/proto/authz/v1/authz_grpc.pb.go`
**Size**: ~10 KB

This file contains the gRPC service definition:

**Service Methods**:
```
AuthzService:
  - Check(CheckRequest) -> CheckResponse
    Single authorization check

  - CheckBatch(CheckBatchRequest) -> CheckBatchResponse
    Parallel batch authorization checks

  - CheckStream(stream CheckRequest) -> stream CheckResponse
    Bidirectional streaming for high-throughput scenarios

  - LoadPolicies(LoadPoliciesRequest) -> LoadPoliciesResponse
    Load policies from source

  - ReloadPolicies(ReloadPoliciesRequest) -> ReloadPoliciesResponse
    Trigger policy reload
```

**Interfaces Generated**:
- `AuthzServiceClient` - Client-side interface
- `AuthzServiceServer` - Server-side interface (with unimplemented base)
- `AuthzService_CheckStreamClient` - Streaming client
- `AuthzService_CheckStreamServer` - Streaming server

Includes handler registration, interceptor support, and full gRPC metadata.

### 3. Proto Definition (`authz.proto`)
**Location**: `/go-core/api/proto/authz/v1/authz.proto`
**Size**: ~5 KB (source)

The canonical proto3 definition with full documentation for all messages and methods.

## Dependencies

All required dependencies are already in `go.mod`:
```go
google.golang.org/protobuf v1.33.0
google.golang.org/grpc v1.62.1
```

These provide:
- Message serialization/deserialization
- gRPC transport and handlers
- Type reflection support
- Streaming support

## Build Integration

### Makefile Targets

**Generate Protocol Buffers**:
```bash
make proto
```
Automatically detects and uses `buf` if available, falls back to manual `protoc` generation.

**Manual Generation** (when buf unavailable):
```bash
make proto-generate-manual
```
Uses the provided `generate-proto.sh` script.

**Lint Protocol Definitions**:
```bash
make proto-lint
```
Checks proto syntax and style (if buf available).

### Automatic Code Generation Script

**Location**: `/go-core/scripts/generate-proto.sh`

The script:
1. Verifies `protoc` is installed
2. Installs required Go plugins if missing:
   - `protoc-gen-go` - Go code generation
   - `protoc-gen-go-grpc` - gRPC service generation
3. Generates all `.pb.go` and `*_grpc.pb.go` files
4. Reports generated files and next steps

**Usage**:
```bash
./scripts/generate-proto.sh
```

**Requirements**:
- `protoc` command-line compiler (v3.21+)
- Go 1.24.0+
- Write access to `api/proto/authz/v1/`

## Implementation Guide

### Server Implementation

Create a struct implementing `AuthzServiceServer`:

```go
package server

import (
    context "context"
    authzv1 "github.com/authz-engine/go-core/api/proto/authz/v1"
)

type AuthzServer struct {
    authzv1.UnimplementedAuthzServiceServer
    // Add your dependencies here
}

func (s *AuthzServer) Check(ctx context.Context, req *authzv1.CheckRequest) (*authzv1.CheckResponse, error) {
    // Implement authorization check logic
    return &authzv1.CheckResponse{
        RequestId: req.RequestId,
        Results: map[string]*authzv1.ActionResult{
            "read": {
                Effect: authzv1.Effect_EFFECT_ALLOW,
                Policy: "default-policy",
                Matched: true,
            },
        },
    }, nil
}

// Implement other methods...
```

Register with gRPC:

```go
grpcServer := grpc.NewServer()
authzv1.RegisterAuthzServiceServer(grpcServer, &AuthzServer{})
```

### Client Usage

```go
client := authzv1.NewAuthzServiceClient(conn)

resp, err := client.Check(context.Background(), &authzv1.CheckRequest{
    RequestId: "req-123",
    Principal: &authzv1.Principal{
        Id: "user-456",
        Roles: []string{"admin"},
    },
    Resource: &authzv1.Resource{
        Kind: "document",
        Id: "doc-789",
    },
    Actions: []string{"read", "write"},
    IncludeMetadata: true,
})
```

### Streaming Example

```go
// Client-side bidirectional streaming
stream, err := client.CheckStream(context.Background())
if err != nil {
    log.Fatal(err)
}

// Send requests
stream.Send(&authzv1.CheckRequest{...})

// Receive responses
resp, err := stream.Recv()
```

## Code Organization

```
go-core/
├── api/proto/authz/v1/
│   ├── authz.proto           # Source proto definition
│   ├── authz.pb.go           # Generated message types
│   └── authz_grpc.pb.go      # Generated gRPC service
├── scripts/
│   └── generate-proto.sh     # Proto generation script
├── internal/server/
│   ├── server.go             # Main gRPC server
│   └── handlers.go           # RPC method implementations
├── Makefile                  # Build targets
└── go.mod                    # Dependencies (already configured)
```

## Regenerating Code

If the proto definition changes:

1. Update `api/proto/authz/v1/authz.proto`
2. Run regeneration:
   ```bash
   make proto
   # or
   make proto-generate-manual
   ```
3. Rebuild: `make build`

## Performance Characteristics

**Message Size** (approximate):
- CheckRequest: 200-500 bytes (with context)
- CheckResponse: 300-800 bytes (with metadata)
- CheckBatchRequest: N * request size
- CheckBatchResponse: N * response size + 8 bytes overhead

**Serialization**: Binary protobuf format provides:
- 50-70% smaller than JSON
- 2-3x faster than JSON
- Type-safe with schema validation
- Backward/forward compatible with proto3

## Next Steps

1. **Implement gRPC Service**:
   - Create `internal/server/handlers.go` with RPC method implementations
   - Wire authorization engine to gRPC handlers
   - Add logging and metrics interceptors

2. **Add Tests**:
   - Unit tests for each RPC method
   - Integration tests with real authorization engine
   - Streaming protocol tests

3. **Add Documentation**:
   - Service API documentation in `docs/API.md`
   - Examples in `examples/grpc-client/`
   - Integration guide for clients

4. **Configure Transport**:
   - Add TLS configuration
   - Enable gRPC reflection for tooling
   - Configure keepalive parameters
   - Add compression support

## Troubleshooting

**"protoc: command not found"**
- Install protobuf: `brew install protobuf` (macOS) or `apt-get install protobuf-compiler` (Linux)

**"protoc-gen-go: command not found"**
- Run `./scripts/generate-proto.sh` which auto-installs plugins, or:
- `go install google.golang.org/protobuf/cmd/protoc-gen-go@latest`

**Generated files not updating**
- Delete old `.pb.go` files manually
- Run `make proto-generate-manual` (bypass caching)
- Check file permissions in `api/proto/authz/v1/`

**Import errors in IDE**
- Run `go mod download`
- Run `make build` to validate compilation
- Reload IDE workspace

## References

- Protocol Buffers: https://developers.google.com/protocol-buffers
- gRPC: https://grpc.io/
- Go gRPC: https://pkg.go.dev/google.golang.org/grpc
- Go Protobuf: https://pkg.go.dev/google.golang.org/protobuf
