// Package main provides the entry point for the authorization server
package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/internal/server"
)

var (
	// Version information (set at build time)
	Version   = "dev"
	BuildTime = "unknown"
	GitCommit = "unknown"
)

func main() {
	// Parse command line flags
	var (
		grpcPort        = flag.Int("grpc-port", 50051, "gRPC server port")
		httpPort        = flag.Int("http-port", 8080, "HTTP server port for health/metrics")
		cacheEnabled    = flag.Bool("cache", true, "Enable decision cache")
		cacheSize       = flag.Int("cache-size", 100000, "Maximum cache entries")
		cacheTTL        = flag.Duration("cache-ttl", 5*time.Minute, "Cache TTL")
		workers         = flag.Int("workers", 16, "Number of parallel workers")
		logLevel        = flag.String("log-level", "info", "Log level (debug, info, warn, error)")
		logFormat       = flag.String("log-format", "json", "Log format (json, console)")
		showVersion     = flag.Bool("version", false, "Show version information")
		policyDir       = flag.String("policy-dir", "", "Directory to load policies from")
		enableReflect   = flag.Bool("reflection", true, "Enable gRPC reflection")
		gracefulTimeout = flag.Duration("shutdown-timeout", 30*time.Second, "Graceful shutdown timeout")
	)
	flag.Parse()

	// Show version and exit
	if *showVersion {
		fmt.Printf("authz-server %s\n", Version)
		fmt.Printf("  Build Time: %s\n", BuildTime)
		fmt.Printf("  Git Commit: %s\n", GitCommit)
		os.Exit(0)
	}

	// Initialize logger
	logger, err := initLogger(*logLevel, *logFormat)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize logger: %v\n", err)
		os.Exit(1)
	}
	defer logger.Sync()

	logger.Info("Starting authorization server",
		zap.String("version", Version),
		zap.Int("grpc_port", *grpcPort),
		zap.Int("http_port", *httpPort),
	)

	// Initialize policy store
	store := policy.NewMemoryStore()

	// Load policies from directory if specified
	if *policyDir != "" {
		if err := loadPoliciesFromDir(store, *policyDir, logger); err != nil {
			logger.Fatal("Failed to load policies", zap.Error(err))
		}
	}

	// Initialize decision engine
	engConfig := engine.Config{
		CacheEnabled:    *cacheEnabled,
		CacheSize:       *cacheSize,
		CacheTTL:        *cacheTTL,
		ParallelWorkers: *workers,
	}

	eng, err := engine.New(engConfig, store)
	if err != nil {
		logger.Fatal("Failed to create engine", zap.Error(err))
	}

	logger.Info("Decision engine initialized",
		zap.Bool("cache_enabled", *cacheEnabled),
		zap.Int("cache_size", *cacheSize),
		zap.Int("workers", *workers),
	)

	// Initialize gRPC server
	srvConfig := server.Config{
		Port:             *grpcPort,
		EnableReflection: *enableReflect,
	}

	grpcSrv, err := server.New(srvConfig, eng, logger)
	if err != nil {
		logger.Fatal("Failed to create gRPC server", zap.Error(err))
	}

	// Create metrics and health handlers
	metricsCollector := server.NewMetricsCollector()
	metricsHandler := server.NewMetricsHandler(metricsCollector)

	// Create minimal engine for health checks
	healthEngine := &server.Engine{
		cacheEnabled: *cacheEnabled,
	}
	healthHandler := server.NewHealthHandler(healthEngine, logger)

	// Initialize HTTP mux for health/metrics
	httpMux := http.NewServeMux()
	server.RegisterHealthHandlers(httpMux, healthHandler)
	server.RegisterMetricsHandlers(httpMux, metricsHandler)

	// Create HTTP server
	httpSrv := &http.Server{
		Addr:         fmt.Sprintf(":%d", *httpPort),
		Handler:      httpMux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Channels for error handling
	errChan := make(chan error, 2)
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Start gRPC server
	go func() {
		logger.Info("Starting gRPC server", zap.Int("port", *grpcPort))
		errChan <- grpcSrv.Start()
	}()

	// Start HTTP server for health/metrics
	go func() {
		logger.Info("Starting HTTP server for health/metrics", zap.Int("port", *httpPort))
		errChan <- httpSrv.ListenAndServe()
	}()

	// Wait for shutdown signal or error
	select {
	case err := <-errChan:
		if err != http.ErrServerClosed {
			logger.Fatal("Server error", zap.Error(err))
		}
	case sig := <-sigChan:
		logger.Info("Received shutdown signal", zap.String("signal", sig.String()))

		// Graceful shutdown context
		ctx, cancel := context.WithTimeout(context.Background(), *gracefulTimeout)
		defer cancel()

		// Mark as not ready to stop accepting new requests
		healthHandler.SetReady(false)
		logger.Info("Server marked as not ready for new requests")

		// Give in-flight requests time to complete
		time.Sleep(5 * time.Second)

		// Stop gRPC server
		logger.Info("Stopping gRPC server")
		grpcSrv.Stop()

		// Stop HTTP server
		logger.Info("Stopping HTTP server")
		httpSrv.Shutdown(ctx)
	}

	logger.Info("Server stopped successfully")
}

// initLogger initializes the zap logger
func initLogger(level, format string) (*zap.Logger, error) {
	// Parse log level
	var zapLevel zapcore.Level
	switch level {
	case "debug":
		zapLevel = zapcore.DebugLevel
	case "info":
		zapLevel = zapcore.InfoLevel
	case "warn":
		zapLevel = zapcore.WarnLevel
	case "error":
		zapLevel = zapcore.ErrorLevel
	default:
		zapLevel = zapcore.InfoLevel
	}

	// Build config
	var config zap.Config
	if format == "console" {
		config = zap.NewDevelopmentConfig()
	} else {
		config = zap.NewProductionConfig()
	}
	config.Level = zap.NewAtomicLevelAt(zapLevel)

	return config.Build()
}

// loadPoliciesFromDir loads policies from a directory (placeholder)
func loadPoliciesFromDir(store *policy.MemoryStore, dir string, logger *zap.Logger) error {
	// In a real implementation, this would:
	// 1. Read YAML/JSON policy files from the directory
	// 2. Parse them into Policy structs
	// 3. Add them to the store

	logger.Info("Policy loading from directory not yet implemented",
		zap.String("dir", dir),
	)

	return nil
}
