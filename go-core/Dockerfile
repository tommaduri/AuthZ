# Build stage
FROM golang:1.22-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git ca-certificates tzdata

# Set working directory
WORKDIR /app

# Copy go mod files
COPY go.mod go.sum* ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s -X main.Version=$(git describe --tags --always --dirty 2>/dev/null || echo 'dev') \
    -X main.BuildTime=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
    -X main.GitCommit=$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')" \
    -o /authz-server ./cmd/authz-server

# Final stage
FROM alpine:3.19

# Install runtime dependencies
RUN apk add --no-cache ca-certificates tzdata

# Create non-root user
RUN adduser -D -g '' authz
USER authz

# Set working directory
WORKDIR /app

# Copy binary from builder
COPY --from=builder /authz-server /app/authz-server

# Copy config files
COPY --from=builder /app/configs /app/configs

# Expose gRPC port
EXPOSE 50051

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Set default environment variables
ENV AUTHZ_PORT=50051 \
    AUTHZ_LOG_LEVEL=info \
    AUTHZ_LOG_FORMAT=json \
    AUTHZ_CACHE_ENABLED=true \
    AUTHZ_CACHE_SIZE=100000 \
    AUTHZ_WORKERS=16

# Run the server
ENTRYPOINT ["/app/authz-server"]
CMD ["--port", "50051", "--cache", "--cache-size", "100000", "--workers", "16"]
