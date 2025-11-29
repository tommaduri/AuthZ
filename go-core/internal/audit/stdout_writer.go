package audit

import (
	"encoding/json"
	"os"
	"sync"
)

// stdoutWriter writes audit events to stdout as JSON
type stdoutWriter struct {
	encoder *json.Encoder
	mu      sync.Mutex
}

// NewStdoutWriter creates a new stdout writer
func NewStdoutWriter() Writer {
	return &stdoutWriter{
		encoder: json.NewEncoder(os.Stdout),
	}
}

// Write writes an event to stdout as JSON
func (w *stdoutWriter) Write(event interface{}) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	return w.encoder.Encode(event)
}

// Close closes the writer (no-op for stdout)
func (w *stdoutWriter) Close() error {
	return nil
}
