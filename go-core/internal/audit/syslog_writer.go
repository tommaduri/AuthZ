package audit

import (
	"encoding/json"
	"fmt"
	"log/syslog"
	"sync"
)

// syslogWriter writes audit events to syslog
type syslogWriter struct {
	writer *syslog.Writer
	mu     sync.Mutex
}

// NewSyslogWriter creates a new syslog writer
func NewSyslogWriter(protocol, address string) (Writer, error) {
	// Default protocol if not specified
	if protocol == "" {
		protocol = "tcp"
	}

	// Connect to syslog
	writer, err := syslog.Dial(protocol, address, syslog.LOG_INFO|syslog.LOG_LOCAL0, "authz-engine")
	if err != nil {
		return nil, fmt.Errorf("connect to syslog: %w", err)
	}

	return &syslogWriter{
		writer: writer,
	}, nil
}

// Write writes an event to syslog as JSON
func (w *syslogWriter) Write(event interface{}) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	// Serialize event to JSON
	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}

	// Write to syslog
	return w.writer.Info(string(data))
}

// Close closes the syslog writer
func (w *syslogWriter) Close() error {
	return w.writer.Close()
}
