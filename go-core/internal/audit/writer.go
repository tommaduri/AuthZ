package audit

// Writer writes audit events to a destination
type Writer interface {
	// Write writes an event
	Write(event interface{}) error

	// Close closes the writer
	Close() error
}
