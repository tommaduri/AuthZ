package audit

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/authz-engine/go-core/pkg/types"
)

// Logger logs audit events
type Logger interface {
	// LogAuthzCheck logs authorization check
	LogAuthzCheck(ctx context.Context, event *AuthzCheckEvent)

	// LogPolicyChange logs policy changes
	LogPolicyChange(ctx context.Context, change *PolicyChange)

	// LogAgentAction logs agent operations
	LogAgentAction(ctx context.Context, action *AgentAction)

	// Log asynchronously logs an authentication audit event
	Log(event *types.AuditEvent) error

	// LogSync synchronously logs an authentication audit event
	LogSync(ctx context.Context, event *types.AuditEvent) error

	// Query retrieves audit events based on query criteria
	Query(ctx context.Context, query *types.AuditQuery) (*types.AuditQueryResult, error)

	// VerifyIntegrity verifies the hash chain integrity
	VerifyIntegrity(ctx context.Context, tenantID string, startTime, endTime time.Time) (bool, error)

	// GetStatistics retrieves aggregate statistics
	GetStatistics(ctx context.Context, tenantID string, timeRange time.Duration) (*types.AuditStatistics, error)

	// Flush flushes pending logs
	Flush() error

	// Close closes logger and flushes remaining logs
	Close() error
}

// Config for audit logger
type Config struct {
	// Enabled enables audit logging
	Enabled bool

	// Output type: stdout, file, syslog, db (database)
	Type string

	// For file output
	FilePath       string
	FileMaxSize    int // MB
	FileMaxAge     int // Days
	FileMaxBackups int

	// For syslog
	SyslogAddr     string
	SyslogProtocol string // tcp, udp, unix

	// For database output (authentication audit logging with hash chains)
	DB *sql.DB

	// Performance tuning
	BufferSize    int           // Ring buffer size (default: 1000)
	FlushInterval time.Duration // Batch interval (default: 100ms)
	BatchSize     int           // Batch size for database writes (default: 100)
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
func NewLogger(cfg *Config) (Logger, error) {
	if cfg == nil {
		cfg = &Config{}
		*cfg = DefaultConfig()
	}

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}

	if !cfg.Enabled && cfg.DB == nil {
		return &noopLogger{}, nil
	}

	// If DB is provided, use the auth audit logger with hash chains
	if cfg.DB != nil {
		authCfg := &AuthAuditConfig{
			DB:            cfg.DB,
			BufferSize:    cfg.BufferSize,
			FlushInterval: cfg.FlushInterval,
			BatchSize:     cfg.BatchSize,
		}
		authLogger, err := NewAuthAuditLogger(authCfg)
		if err != nil {
			return nil, fmt.Errorf("create auth audit logger: %w", err)
		}
		return &unifiedLogger{authLogger: authLogger}, nil
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

	return newAsyncLogger(writer, *cfg), nil
}

// noopLogger is a no-op logger used when audit logging is disabled
type noopLogger struct{}

func (n *noopLogger) LogAuthzCheck(ctx context.Context, event *AuthzCheckEvent) {}
func (n *noopLogger) LogPolicyChange(ctx context.Context, change *PolicyChange) {}
func (n *noopLogger) LogAgentAction(ctx context.Context, action *AgentAction)   {}
func (n *noopLogger) Log(event *types.AuditEvent) error                         { return nil }
func (n *noopLogger) LogSync(ctx context.Context, event *types.AuditEvent) error {
	return nil
}
func (n *noopLogger) Query(ctx context.Context, query *types.AuditQuery) (*types.AuditQueryResult, error) {
	return &types.AuditQueryResult{}, nil
}
func (n *noopLogger) VerifyIntegrity(ctx context.Context, tenantID string, startTime, endTime time.Time) (bool, error) {
	return true, nil
}
func (n *noopLogger) GetStatistics(ctx context.Context, tenantID string, timeRange time.Duration) (*types.AuditStatistics, error) {
	return &types.AuditStatistics{}, nil
}
func (n *noopLogger) Flush() error { return nil }
func (n *noopLogger) Close() error { return nil }

// unifiedLogger wraps AuthAuditLogger and provides compatibility with both APIs
type unifiedLogger struct {
	authLogger *AuthAuditLogger
}

func (u *unifiedLogger) LogAuthzCheck(ctx context.Context, event *AuthzCheckEvent) {
	// Convert AuthzCheckEvent to AuditEvent (not implemented for now)
}

func (u *unifiedLogger) LogPolicyChange(ctx context.Context, change *PolicyChange) {
	// Convert PolicyChange to AuditEvent (not implemented for now)
}

func (u *unifiedLogger) LogAgentAction(ctx context.Context, action *AgentAction) {
	// Convert AgentAction to AuditEvent (not implemented for now)
}

func (u *unifiedLogger) Log(event *types.AuditEvent) error {
	return u.authLogger.LogAuthEvent(event)
}

func (u *unifiedLogger) LogSync(ctx context.Context, event *types.AuditEvent) error {
	return u.authLogger.LogAuthEventSync(ctx, event)
}

func (u *unifiedLogger) Query(ctx context.Context, query *types.AuditQuery) (*types.AuditQueryResult, error) {
	return u.authLogger.Query(ctx, query)
}

func (u *unifiedLogger) VerifyIntegrity(ctx context.Context, tenantID string, startTime, endTime time.Time) (bool, error) {
	return u.authLogger.VerifyIntegrity(ctx, tenantID, startTime, endTime)
}

func (u *unifiedLogger) GetStatistics(ctx context.Context, tenantID string, timeRange time.Duration) (*types.AuditStatistics, error) {
	return u.authLogger.GetStatistics(ctx, tenantID, timeRange)
}

func (u *unifiedLogger) Flush() error {
	// AuthAuditLogger handles flushing automatically
	return nil
}

func (u *unifiedLogger) Close() error {
	return u.authLogger.Close()
}
