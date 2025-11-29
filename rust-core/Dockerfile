# ============================================================================
# Multi-Stage Dockerfile for Rust Authorization Engine (Phase 6)
# ============================================================================
# Production-ready build with:
# - Multi-stage build for minimal image size
# - Distroless runtime (no shell, minimal CVE exposure)
# - Non-root user execution
# - Layer caching for faster builds
# - Build-time dependency caching
# - Health checks
# - Optimized binary size (LTO, strip)
# ============================================================================

# ============================================================================
# Stage 1: Build Environment
# ============================================================================
FROM rust:1.75-slim AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# ============================================================================
# Dependency Caching Layer
# Copy only Cargo files to cache dependencies
# ============================================================================
COPY Cargo.toml Cargo.lock ./
COPY src/authz/Cargo.toml ./src/authz/
COPY src/api-server/Cargo.toml ./src/api-server/

# Create dummy source files for dependency build
RUN mkdir -p src/authz/src src/api-server/src && \
    echo "fn main() {}" > src/authz/src/main.rs && \
    echo "fn main() {}" > src/api-server/src/main.rs

# Build dependencies (cached layer)
RUN cargo build --release && rm -rf src/*/src

# ============================================================================
# Build Application
# ============================================================================
COPY . .

# Extract version info from git
RUN export VERSION=$(git describe --tags --always --dirty 2>/dev/null || echo 'dev') && \
    export BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) && \
    export GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown') && \
    echo "Building authz-server $VERSION (commit: $GIT_COMMIT, time: $BUILD_TIME)"

# Build authz-server with optimizations
RUN cargo build --release --bin authz-server && \
    ls -lh /build/target/release/authz-server

# ============================================================================
# Stage 2: Runtime Environment (Distroless)
# ============================================================================
FROM gcr.io/distroless/cc-debian12:nonroot

# OCI image metadata
LABEL org.opencontainers.image.title="Rust Authorization Engine" \
      org.opencontainers.image.description="High-performance authz server with ReBAC, ABAC, RBAC" \
      org.opencontainers.image.vendor="Creto Systems" \
      org.opencontainers.image.licenses="MIT OR Apache-2.0"

WORKDIR /app

# Copy binary from builder
COPY --from=builder --chown=nonroot:nonroot /build/target/release/authz-server /app/authz-server

# Expose ports
EXPOSE 50051 8080 8081

# Environment defaults
ENV AUTHZ_GRPC_PORT=50051 \
    AUTHZ_HTTP_PORT=8080 \
    AUTHZ_REST_PORT=8081 \
    AUTHZ_LOG_LEVEL=info \
    AUTHZ_LOG_FORMAT=json \
    RUST_BACKTRACE=1

# Health check (distroless compatible)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD ["/app/authz-server", "--health-check"]

USER nonroot:nonroot

ENTRYPOINT ["/app/authz-server"]
CMD ["--grpc-port", "50051", "--http-port", "8080", "--rest-port", "8081"]
