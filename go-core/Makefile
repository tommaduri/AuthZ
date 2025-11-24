.PHONY: all build test bench lint proto clean docker run

# Variables
BINARY_NAME=authz-server
CLI_NAME=authz-cli
VERSION=$(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
BUILD_TIME=$(shell date -u +"%Y-%m-%dT%H:%M:%SZ")
LDFLAGS=-ldflags "-X main.Version=$(VERSION) -X main.BuildTime=$(BUILD_TIME)"

# Go parameters
GOCMD=go
GOBUILD=$(GOCMD) build
GOTEST=$(GOCMD) test
GOGET=$(GOCMD) get
GOMOD=$(GOCMD) mod

all: proto build test

# Build
build:
	CGO_ENABLED=0 $(GOBUILD) $(LDFLAGS) -o bin/$(BINARY_NAME) ./cmd/authz-server
	CGO_ENABLED=0 $(GOBUILD) $(LDFLAGS) -o bin/$(CLI_NAME) ./cmd/authz-cli

build-linux:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 $(GOBUILD) $(LDFLAGS) -o bin/$(BINARY_NAME)-linux-amd64 ./cmd/authz-server

# Test
test:
	$(GOTEST) -v -race -cover ./...

test-short:
	$(GOTEST) -v -short ./...

# Benchmarks
bench:
	$(GOTEST) -bench=. -benchmem ./...

bench-cel:
	$(GOTEST) -bench=. -benchmem ./internal/cel/...

bench-cache:
	$(GOTEST) -bench=. -benchmem ./internal/cache/...

# Coverage
coverage:
	$(GOTEST) -coverprofile=coverage.out ./...
	$(GOCMD) tool cover -html=coverage.out -o coverage.html

# Lint
lint:
	golangci-lint run ./...

# Proto generation (supports both buf and manual protoc)
proto:
	@command -v buf >/dev/null 2>&1 && buf generate || ./scripts/generate-proto.sh

proto-lint:
	@command -v buf >/dev/null 2>&1 && buf lint || echo "buf not installed, skipping lint"

proto-generate-manual:
	./scripts/generate-proto.sh

# Dependencies
deps:
	$(GOMOD) download
	$(GOMOD) tidy

# Clean
clean:
	rm -rf bin/
	rm -rf dist/
	rm -f coverage.out coverage.html

# Docker
docker:
	docker build -t authz-engine:$(VERSION) .

docker-push:
	docker push authz-engine:$(VERSION)

# Run
run:
	$(GOBUILD) -o bin/$(BINARY_NAME) ./cmd/authz-server
	./bin/$(BINARY_NAME) -config configs/config.yaml

# Development
dev:
	$(GOCMD) run ./cmd/authz-server -config configs/config.yaml

# Install tools
tools:
	go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
	go install github.com/bufbuild/buf/cmd/buf@latest

# Performance profiling
profile-cpu:
	$(GOTEST) -cpuprofile=cpu.prof -bench=. ./internal/engine/...
	go tool pprof -http=:8080 cpu.prof

profile-mem:
	$(GOTEST) -memprofile=mem.prof -bench=. ./internal/engine/...
	go tool pprof -http=:8080 mem.prof

# Generate mocks (if needed)
mocks:
	mockgen -source=internal/policy/store.go -destination=internal/policy/mock_store.go -package=policy

# Help
help:
	@echo "Available targets:"
	@echo "  build        - Build the server and CLI binaries"
	@echo "  test         - Run all tests with race detection"
	@echo "  bench        - Run benchmarks"
	@echo "  lint         - Run linter"
	@echo "  proto        - Generate protobuf code"
	@echo "  docker       - Build Docker image"
	@echo "  run          - Build and run the server"
	@echo "  dev          - Run in development mode"
	@echo "  clean        - Clean build artifacts"
	@echo "  coverage     - Generate coverage report"
