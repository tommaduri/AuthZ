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

# Database configuration
DB_HOST ?= localhost
DB_PORT ?= 5432
DB_USER ?= postgres
DB_PASSWORD ?= postgres
DB_NAME ?= authz
DB_SSL_MODE ?= disable
DB_URL = postgres://$(DB_USER):$(DB_PASSWORD)@$(DB_HOST):$(DB_PORT)/$(DB_NAME)?sslmode=$(DB_SSL_MODE)

TEST_DB_NAME ?= authz_test
TEST_DB_URL = postgres://$(DB_USER):$(DB_PASSWORD)@$(DB_HOST):$(DB_PORT)/$(TEST_DB_NAME)?sslmode=$(DB_SSL_MODE)

MIGRATIONS_DIR = ./migrations

# Database Migrations
migrate-install:
	@echo "Installing golang-migrate..."
	go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest

migrate-up:
	@echo "Running migrations..."
	migrate -database "$(DB_URL)" -path $(MIGRATIONS_DIR) up

migrate-down:
	@echo "Rolling back last migration..."
	migrate -database "$(DB_URL)" -path $(MIGRATIONS_DIR) down 1

migrate-version:
	@migrate -database "$(DB_URL)" -path $(MIGRATIONS_DIR) version

migrate-force:
	@if [ -z "$(VERSION)" ]; then echo "Error: VERSION required. Usage: make migrate-force VERSION=1"; exit 1; fi
	@migrate -database "$(DB_URL)" -path $(MIGRATIONS_DIR) force $(VERSION)

migrate-create:
	@if [ -z "$(NAME)" ]; then echo "Error: NAME required. Usage: make migrate-create NAME=add_table"; exit 1; fi
	@migrate create -ext sql -dir $(MIGRATIONS_DIR) -seq $(NAME)

# Database Management
db-create:
	@psql -h $(DB_HOST) -p $(DB_PORT) -U $(DB_USER) -d postgres -c "CREATE DATABASE $(DB_NAME);"

db-drop:
	@psql -h $(DB_HOST) -p $(DB_PORT) -U $(DB_USER) -d postgres -c "DROP DATABASE IF EXISTS $(DB_NAME);"

db-reset: db-drop db-create migrate-up

db-shell:
	@psql -h $(DB_HOST) -p $(DB_PORT) -U $(DB_USER) -d $(DB_NAME)

# Test Database
test-db-create:
	@psql -h $(DB_HOST) -p $(DB_PORT) -U $(DB_USER) -d postgres -c "DROP DATABASE IF EXISTS $(TEST_DB_NAME);"
	@psql -h $(DB_HOST) -p $(DB_PORT) -U $(DB_USER) -d postgres -c "CREATE DATABASE $(TEST_DB_NAME);"

test-db-migrate: test-db-create
	@migrate -database "$(TEST_DB_URL)" -path $(MIGRATIONS_DIR) up

test-db: test-db-create test-db-migrate
	@$(GOTEST) ./tests/db/... -v

# Docker Database
docker-db-start:
	@docker run -d --name authz-postgres \
		-e POSTGRES_USER=$(DB_USER) \
		-e POSTGRES_PASSWORD=$(DB_PASSWORD) \
		-e POSTGRES_DB=$(DB_NAME) \
		-p $(DB_PORT):5432 postgres:15-alpine
	@echo "Waiting for database..."
	@sleep 3

docker-db-stop:
	@docker stop authz-postgres || true
	@docker rm authz-postgres || true

# Help
help:
	@echo "Available targets:"
	@echo "  build             - Build the server and CLI binaries"
	@echo "  test              - Run all tests with race detection"
	@echo "  bench             - Run benchmarks"
	@echo "  lint              - Run linter"
	@echo "  proto             - Generate protobuf code"
	@echo "  docker            - Build Docker image"
	@echo "  run               - Build and run the server"
	@echo "  dev               - Run in development mode"
	@echo "  clean             - Clean build artifacts"
	@echo "  coverage          - Generate coverage report"
	@echo ""
	@echo "Database Migrations:"
	@echo "  migrate-install   - Install golang-migrate tool"
	@echo "  migrate-up        - Run all pending migrations"
	@echo "  migrate-down      - Rollback last migration"
	@echo "  migrate-version   - Show current migration version"
	@echo "  migrate-force     - Force migration version (VERSION=n)"
	@echo "  migrate-create    - Create new migration (NAME=xxx)"
	@echo ""
	@echo "Database Management:"
	@echo "  db-create         - Create database"
	@echo "  db-drop           - Drop database"
	@echo "  db-reset          - Reset database (drop, create, migrate)"
	@echo "  db-shell          - Open PostgreSQL shell"
	@echo "  test-db           - Run database tests"
	@echo "  docker-db-start   - Start PostgreSQL in Docker"
	@echo "  docker-db-stop    - Stop PostgreSQL Docker container"
