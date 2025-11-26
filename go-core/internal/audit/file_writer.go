package audit

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"gopkg.in/natefinch/lumberjack.v2"
)

// fileWriter writes audit events to a file with rotation
type fileWriter struct {
	logger  *lumberjack.Logger
	encoder *json.Encoder
	mu      sync.Mutex
}

// NewFileWriter creates a new file writer with log rotation
func NewFileWriter(filename string, maxSizeMB, maxAgeDays, maxBackups int) (Writer, error) {
	// Ensure directory exists
	dir := filepath.Dir(filename)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("create directory: %w", err)
	}

	// Create lumberjack logger for rotation
	logger := &lumberjack.Logger{
		Filename:   filename,
		MaxSize:    maxSizeMB,
		MaxAge:     maxAgeDays,
		MaxBackups: maxBackups,
		LocalTime:  true,
		Compress:   true, // Compress rotated files
	}

	w := &fileWriter{
		logger:  logger,
		encoder: json.NewEncoder(logger),
	}

	// Write startup marker
	startupEvent := Event{
		Timestamp: time.Now(),
		EventType: EventTypeSystemStartup,
		EventID:   generateEventID(),
		Data: map[string]interface{}{
			"message": "Audit logging started",
		},
	}
	if err := w.Write(startupEvent); err != nil {
		return nil, fmt.Errorf("write startup event: %w", err)
	}

	return w, nil
}

// Write writes an event to the file
func (w *fileWriter) Write(event interface{}) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	return w.encoder.Encode(event)
}

// Close closes the file writer
func (w *fileWriter) Close() error {
	// Write shutdown marker
	shutdownEvent := Event{
		Timestamp: time.Now(),
		EventType: EventTypeSystemShutdown,
		EventID:   generateEventID(),
		Data: map[string]interface{}{
			"message": "Audit logging stopped",
		},
	}
	_ = w.Write(shutdownEvent)

	return w.logger.Close()
}
