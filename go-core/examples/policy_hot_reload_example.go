// Example demonstrating policy hot-reload functionality
package examples

import (
	"context"
	"fmt"
	"time"

	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/server"
	"go.uber.org/zap"
)

// Example1_AutomaticHotReload shows how to enable automatic policy hot-reload
func Example1_AutomaticHotReload() error {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	// Create configuration with hot-reload enabled
	cfg := server.DefaultConfig()
	cfg.Port = 50051
	cfg.PolicyDirPath = "/etc/authz-policies"
	cfg.EnablePolicyWatcher = true

	// Initialize engine
	eng, err := engine.NewEngine(logger)
	if err != nil {
		return fmt.Errorf("failed to create engine: %w", err)
	}

	// Create server
	srv, err := server.New(cfg, eng, logger)
	if err != nil {
		return fmt.Errorf("failed to create server: %w", err)
	}

	// Enable policy watcher
	ctx := context.Background()
	if err := srv.EnablePolicyWatcher(ctx, cfg.PolicyDirPath); err != nil {
		return fmt.Errorf("failed to enable policy watcher: %w", err)
	}

	logger.Info("Policy watcher enabled",
		zap.String("policy_dir", cfg.PolicyDirPath),
	)

	// Start server in background
	go func() {
		if err := srv.Start(); err != nil {
			logger.Error("Server error", zap.Error(err))
		}
	}()

	// Server is now listening and automatically reloading policies on changes
	time.Sleep(time.Hour) // Keep running

	return nil
}

// Example2_ManualReload shows how to manually trigger policy reload
func Example2_ManualReload() error {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	// Create and configure server
	cfg := server.DefaultConfig()
	eng, _ := engine.NewEngine(logger)
	srv, _ := server.New(cfg, eng, logger)

	ctx := context.Background()
	if err := srv.EnablePolicyWatcher(ctx, "/etc/authz-policies"); err != nil {
		return fmt.Errorf("failed to enable policy watcher: %w", err)
	}

	// Periodically reload policies (e.g., triggered by external event)
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		if err := srv.ReloadPolicies(ctx); err != nil {
			logger.Error("Failed to reload policies", zap.Error(err))
			continue
		}

		lastReload := srv.GetLastReloadTime()
		logger.Info("Policies reloaded successfully",
			zap.Time("timestamp", lastReload),
		)
	}

	return nil
}

// Example3_CheckWatcherStatus shows how to monitor watcher status
func Example3_CheckWatcherStatus() error {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	// Create and configure server
	cfg := server.DefaultConfig()
	eng, _ := engine.NewEngine(logger)
	srv, _ := server.New(cfg, eng, logger)

	ctx := context.Background()
	if err := srv.EnablePolicyWatcher(ctx, "/etc/authz-policies"); err != nil {
		return fmt.Errorf("failed to enable policy watcher: %w", err)
	}

	// Monitor watcher status periodically
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		if srv.IsPolicyWatcherRunning() {
			lastReload := srv.GetLastReloadTime()
			logger.Info("Watcher status",
				zap.Bool("running", true),
				zap.Time("last_reload", lastReload),
				zap.Duration("since_reload", time.Since(lastReload)),
			)
		} else {
			logger.Warn("Policy watcher is not running")
		}
	}

	return nil
}

// Example4_ErrorHandling shows how to handle reload errors gracefully
func Example4_ErrorHandling() error {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	cfg := server.DefaultConfig()
	eng, _ := engine.NewEngine(logger)
	srv, _ := server.New(cfg, eng, logger)

	ctx := context.Background()

	// Enable watcher - this will handle errors internally
	if err := srv.EnablePolicyWatcher(ctx, "/etc/authz-policies"); err != nil {
		logger.Error("Failed to enable policy watcher", zap.Error(err))
		// Server can continue to work with existing policies
	}

	// Attempt manual reload with error handling
	if err := srv.ReloadPolicies(ctx); err != nil {
		// Handle the error appropriately
		logger.Error("Policy reload failed, using existing policies",
			zap.Error(err),
			zap.Time("last_successful_reload", srv.GetLastReloadTime()),
		)

		// Optionally: send alert, increase monitoring, etc.
		// Alert monitoring system about reload failure
		// Continue serving with existing policies
		return nil // Service remains available
	}

	logger.Info("Policies reloaded successfully")
	return nil
}

// Example5_PolicyDirectory shows the expected directory structure
func Example5_PolicyDirectory() string {
	example := `
Expected Policy Directory Structure:
====================================

/etc/authz-policies/
├── document-access.yaml
├── resource-protection.yaml
├── user-roles.yaml
└── api-scopes.json

Example Policy File (document-access.yaml):
============================================

apiVersion: v1
name: document-access
resourceKind: document
rules:
  - name: allow-owner-read-write
    actions:
      - read
      - write
    effect: allow
    condition: "principal.id == resource.attr['owner']"
    roles:
      - document-owner

  - name: allow-viewer-read
    actions:
      - read
    effect: allow
    condition: "principal.roles.contains('viewer')"

  - name: deny-external-write
    actions:
      - write
    effect: deny
    condition: "principal.attr.get('source', '') == 'external'"

  - name: deny-all-others
    actions:
      - "*"
    effect: deny

How the System Works:
=====================

1. FileWatcher monitors /etc/authz-policies/
2. When a file changes, it waits 500ms for stability
3. Loader reads and parses all YAML/JSON files
4. Validator checks policy structure and CEL syntax
5. If validation succeeds, policies are reloaded
6. If validation fails, existing policies remain active
7. Events are logged with detailed information
`

	return example
}

// Example6_CELExpressions shows supported CEL expressions
func Example6_CELExpressions() string {
	example := `
Supported CEL Expressions in Policy Conditions:
===============================================

1. Role-based Access:
   - principal.roles.contains('admin')
   - principal.roles.contains('editor') && principal.roles.contains('reviewer')

2. Resource Attribute Checks:
   - resource.kind == 'document'
   - resource.id == 'doc-123'
   - resource.attr['owner'] == principal.id
   - resource.attr.get('sensitive', false) == true

3. Principal Attribute Checks:
   - principal.id == 'user-123'
   - principal.attr['department'] == 'engineering'
   - principal.attr.get('level', 0) >= 5

4. Context-based Checks:
   - context.get('ip_address', '') == '192.168.1.100'
   - context.get('time_of_day', '') == 'business_hours'

5. Complex Conditions:
   - principal.roles.contains('admin') || (
       principal.attr['team'] == resource.attr['team'] &&
       resource.attr.get('shared', false) == true
     )

All expressions MUST return boolean values
Type-checking happens at policy load time
`

	return example
}

// Example7_EventHandling shows how to process reload events
func Example7_EventHandling() error {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	cfg := server.DefaultConfig()
	eng, _ := engine.NewEngine(logger)
	srv, _ := server.New(cfg, eng, logger)

	ctx := context.Background()
	if err := srv.EnablePolicyWatcher(ctx, "/etc/authz-policies"); err != nil {
		return fmt.Errorf("failed to enable policy watcher: %w", err)
	}

	// The watcher automatically processes events in a background goroutine
	// Events are logged as:
	// - info: successful reload with policy IDs
	// - error: reload failure with error details
	//
	// You can check reload status at any time:
	for i := 0; i < 10; i++ {
		time.Sleep(time.Second)

		if srv.IsPolicyWatcherRunning() {
			lastReload := srv.GetLastReloadTime()
			logger.Info("Checking reload status",
				zap.Time("last_reload", lastReload),
			)
		}
	}

	return nil
}

// Example8_GracefulShutdown shows proper shutdown sequence
func Example8_GracefulShutdown() error {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	cfg := server.DefaultConfig()
	eng, _ := engine.NewEngine(logger)
	srv, _ := server.New(cfg, eng, logger)

	ctx := context.Background()
	if err := srv.EnablePolicyWatcher(ctx, "/etc/authz-policies"); err != nil {
		return fmt.Errorf("failed to enable policy watcher: %w", err)
	}

	// Run server in background
	go func() {
		if err := srv.Start(); err != nil {
			logger.Error("Server error", zap.Error(err))
		}
	}()

	// Server is running...
	time.Sleep(5 * time.Second)

	// Graceful shutdown:
	// 1. Stops accepting new connections
	// 2. Stops policy watcher
	// 3. Allows existing requests to complete
	// 4. Closes all resources
	srv.Stop()

	logger.Info("Server shut down gracefully")
	return nil
}
