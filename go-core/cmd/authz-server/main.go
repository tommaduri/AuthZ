// Package main provides the entry point for the authorization server
package main

import (
	"flag"
	"fmt"
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
		port            = flag.Int("port", 50051, "gRPC server port")
		cacheEnabled    = flag.Bool("cache", true, "Enable decision cache")
		cacheSize       = flag.Int("cache-size", 100000, "Maximum cache entries")
		cacheTTL        = flag.Duration("cache-ttl", 5*time.Minute, "Cache TTL")
		workers         = flag.Int("workers", 16, "Number of parallel workers")
		logLevel        = flag.String("log-level", "info", "Log level (debug, info, warn, error)")
		logFormat       = flag.String("log-format", "json", "Log format (json, console)")
		showVersion     = flag.Bool("version", false, "Show version information")
		policyDir       = flag.String("policy-dir", "", "Directory to load policies from")
		enableReflect   = flag.Bool("reflection", true, "Enable gRPC reflection")
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
		zap.Int("port", *port),
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
		Port:             *port,
		EnableReflection: *enableReflect,
	}

	srv, err := server.New(srvConfig, eng, logger)
	if err != nil {
		logger.Fatal("Failed to create server", zap.Error(err))
	}

	// Start server in goroutine
	errChan := make(chan error, 1)
	go func() {
		errChan <- srv.Start()
	}()

	// Wait for shutdown signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-errChan:
		logger.Fatal("Server error", zap.Error(err))
	case sig := <-sigChan:
		logger.Info("Received shutdown signal", zap.String("signal", sig.String()))
		srv.Stop()
	}

	logger.Info("Server stopped")
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
