package audit

import (
	"context"
	"fmt"
	"time"
)

// Logger logs audit events
type Logger interface {
	// LogAuthzCheck logs authorization check
	LogAuthzCheck(ctx context.Context, event *AuthzCheckEvent)

	// LogPolicyChange logs policy changes
	LogPolicyChange(ctx context.Context, change *PolicyChange)

	// LogAgentAction logs agent operations
	LogAgentAction(ctx context.Context, action *AgentAction)

	// Flush flushes pending logs
	Flush() error

	// Close closes logger and flushes remaining logs
	Close() error
}

// Config for audit logger
type Config struct {
	// Enabled enables audit logging
	Enabled bool

	// Output type: stdout, file, syslog
	Type string

	// For file output
	FilePath       string
	FileMaxSize    int // MB
	FileMaxAge     int // Days
	FileMaxBackups int

	// For syslog
	SyslogAddr     string
	SyslogProtocol string // tcp, udp, unix

	// Performance tuning
	BufferSize    int           // Ring buffer size (default: 1000)
	FlushInterval time.Duration // Batch interval (default: 100ms)
}

// DefaultConfig returns default configuration
func DefaultConfig() Config {
	return Config{
		Enabled:       true,
		Type:          "stdout",
		BufferSize:    1000,
		FlushInterval: 100 * time.Millisecond,
		FileMaxSize:   100,  // 100MB
		FileMaxAge:    30,   // 30 days
		FileMaxBackups: 10,
	}
}

// Validate validates the configuration
func (c *Config) Validate() error {
	if !c.Enabled {
		return nil
	}

	if c.Type == "" {
		return fmt.Errorf("audit type is required")
	}

	if c.Type != "stdout" && c.Type != "file" && c.Type != "syslog" {
		return fmt.Errorf("invalid audit type: %s (must be stdout, file, or syslog)", c.Type)
	}

	if c.Type == "file" && c.FilePath == "" {
		return fmt.Errorf("file path is required for file output")
	}

	if c.Type == "syslog" && c.SyslogAddr == "" {
		return fmt.Errorf("syslog address is required for syslog output")
	}

	if c.BufferSize <= 0 {
		c.BufferSize = 1000
	}

	if c.FlushInterval <= 0 {
		c.FlushInterval = 100 * time.Millisecond
	}

	return nil
}

// NewLogger creates a new audit logger
func NewLogger(cfg Config) (Logger, error) {
	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}

	if !cfg.Enabled {
		return &noopLogger{}, nil
	}

	var writer Writer
	var err error

	switch cfg.Type {
	case "stdout":
		writer = NewStdoutWriter()
	case "file":
		writer, err = NewFileWriter(cfg.FilePath, cfg.FileMaxSize, cfg.FileMaxAge, cfg.FileMaxBackups)
		if err != nil {
			return nil, fmt.Errorf("create file writer: %w", err)
		}
	case "syslog":
		writer, err = NewSyslogWriter(cfg.SyslogProtocol, cfg.SyslogAddr)
		if err != nil {
			return nil, fmt.Errorf("create syslog writer: %w", err)
		}
	default:
		return nil, fmt.Errorf("unsupported audit type: %s", cfg.Type)
	}

	return newAsyncLogger(writer, cfg), nil
}

// noopLogger is a no-op logger used when audit logging is disabled
type noopLogger struct{}

func (n *noopLogger) LogAuthzCheck(ctx context.Context, event *AuthzCheckEvent)    {}
func (n *noopLogger) LogPolicyChange(ctx context.Context, change *PolicyChange)   {}
func (n *noopLogger) LogAgentAction(ctx context.Context, action *AgentAction)     {}
func (n *noopLogger) Flush() error                                                { return nil }
func (n *noopLogger) Close() error                                                { return nil }
