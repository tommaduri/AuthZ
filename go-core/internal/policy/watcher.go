// Package policy provides policy storage, management, and hot-reload capabilities
package policy

import (
	"context"
	"fmt"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"go.uber.org/zap"
)

// ReloadedEvent represents a policy reload event
type ReloadedEvent struct {
	Timestamp time.Time
	PolicyIDs []string
	Error     error
}

// FileWatcher monitors a directory for policy file changes and triggers reloads
type FileWatcher struct {
	watcher         *fsnotify.Watcher
	pollingPath     string
	loader          *Loader
	store           Store
	logger           *zap.Logger
	debounceTimeout time.Duration
	debounceTimer   *time.Timer
	debounceOnce    sync.Once
	eventChan       chan ReloadedEvent
	stopChan        chan struct{}
	mu              sync.RWMutex
	isWatching      bool
}

// NewFileWatcher creates a new file watcher for policy directory
func NewFileWatcher(path string, store Store, loader *Loader, logger *zap.Logger) (*FileWatcher, error) {
	if logger == nil {
		logger = zap.NewNop()
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("failed to create fsnotify watcher: %w", err)
	}

	fw := &FileWatcher{
		watcher:         watcher,
		pollingPath:     path,
		loader:          loader,
		store:           store,
		logger:          logger,
		debounceTimeout: 500 * time.Millisecond,
		eventChan:       make(chan ReloadedEvent, 10),
		stopChan:        make(chan struct{}),
		isWatching:      false,
	}

	return fw, nil
}

// Watch starts watching the policy directory for changes
func (fw *FileWatcher) Watch(ctx context.Context) error {
	fw.mu.Lock()
	if fw.isWatching {
		fw.mu.Unlock()
		return fmt.Errorf("watcher is already running")
	}
	fw.isWatching = true
	fw.mu.Unlock()

	if err := fw.watcher.Add(fw.pollingPath); err != nil {
		fw.mu.Lock()
		fw.isWatching = false
		fw.mu.Unlock()
		return fmt.Errorf("failed to add path to watcher: %w", err)
	}

	fw.logger.Info("Starting policy file watcher",
		zap.String("path", fw.pollingPath),
		zap.Duration("debounce", fw.debounceTimeout),
	)

	go fw.watchLoop(ctx)
	return nil
}

// watchLoop processes file system events with debouncing
func (fw *FileWatcher) watchLoop(ctx context.Context) {
	defer func() {
		fw.mu.Lock()
		fw.isWatching = false
		fw.mu.Unlock()
		fw.logger.Info("Policy file watcher stopped")
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case <-fw.stopChan:
			return

		case event, ok := <-fw.watcher.Events:
			if !ok {
				return
			}

			if fw.shouldProcessEvent(event) {
				fw.handleEvent(event)
			}

		case err, ok := <-fw.watcher.Errors:
			if !ok {
				return
			}
			fw.logger.Error("Watcher error", zap.Error(err))
		}
	}
}

// shouldProcessEvent determines if an event should trigger a reload
func (fw *FileWatcher) shouldProcessEvent(event fsnotify.Event) bool {
	// Only process policy files (YAML/JSON)
	ext := filepath.Ext(event.Name)
	return ext == ".yaml" || ext == ".yml" || ext == ".json"
}

// handleEvent processes a file system event with debouncing
func (fw *FileWatcher) handleEvent(event fsnotify.Event) {
	fw.mu.Lock()
	defer fw.mu.Unlock()

	fw.logger.Debug("Policy file change detected",
		zap.String("file", event.Name),
		zap.String("op", event.Op.String()),
	)

	// Reset debounce timer
	if fw.debounceTimer != nil {
		fw.debounceTimer.Stop()
	}

	fw.debounceTimer = time.AfterFunc(fw.debounceTimeout, func() {
		fw.performReload()
	})
}

// performReload loads all policy files and updates the store
func (fw *FileWatcher) performReload() {
	fw.logger.Info("Reloading policies from disk",
		zap.String("path", fw.pollingPath),
	)

	// Load all policies from the directory
	policies, err := fw.loader.LoadFromDirectory(fw.pollingPath)
	if err != nil {
		fw.logger.Error("Failed to load policies",
			zap.String("path", fw.pollingPath),
			zap.Error(err),
		)
		fw.eventChan <- ReloadedEvent{
			Timestamp: time.Now(),
			Error:     err,
		}
		return
	}

	// Validate all policies
	validator := NewValidator()
	for _, policy := range policies {
		if err := validator.ValidatePolicy(policy); err != nil {
			fw.logger.Error("Policy validation failed",
				zap.String("policy", policy.Name),
				zap.Error(err),
			)
			fw.eventChan <- ReloadedEvent{
				Timestamp: time.Now(),
				Error:     fmt.Errorf("validation failed for policy %s: %w", policy.Name, err),
			}
			return
		}
	}

	// Clear existing policies and add new ones
	if store, ok := fw.store.(*MemoryStore); ok {
		store.Clear()
		policyIDs := make([]string, 0, len(policies))
		for _, policy := range policies {
			if err := store.Add(policy); err != nil {
				fw.logger.Error("Failed to add policy",
					zap.String("policy", policy.Name),
					zap.Error(err),
				)
				fw.eventChan <- ReloadedEvent{
					Timestamp: time.Now(),
					Error:     err,
				}
				return
			}
			policyIDs = append(policyIDs, policy.Name)
		}

		fw.logger.Info("Policies reloaded successfully",
			zap.Int("count", len(policies)),
			zap.Strings("policies", policyIDs),
		)

		fw.eventChan <- ReloadedEvent{
			Timestamp: time.Now(),
			PolicyIDs: policyIDs,
		}
	} else {
		fw.logger.Warn("Store is not a MemoryStore, skipping reload")
	}
}

// EventChan returns a channel for receiving reload events
func (fw *FileWatcher) EventChan() <-chan ReloadedEvent {
	return fw.eventChan
}

// Stop stops watching for file changes
func (fw *FileWatcher) Stop() error {
	fw.mu.Lock()
	defer fw.mu.Unlock()

	if !fw.isWatching {
		return nil
	}

	close(fw.stopChan)

	if fw.debounceTimer != nil {
		fw.debounceTimer.Stop()
	}

	if err := fw.watcher.Close(); err != nil {
		fw.logger.Error("Error closing watcher", zap.Error(err))
		return err
	}

	close(fw.eventChan)
	return nil
}

// SetDebounceTimeout sets the debounce timeout for file changes
func (fw *FileWatcher) SetDebounceTimeout(d time.Duration) {
	fw.mu.Lock()
	defer fw.mu.Unlock()
	fw.debounceTimeout = d
}

// IsWatching returns true if the watcher is currently active
func (fw *FileWatcher) IsWatching() bool {
	fw.mu.RLock()
	defer fw.mu.RUnlock()
	return fw.isWatching
}
