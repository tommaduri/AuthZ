package security_test

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// AuditEvent represents a tamper-proof audit log entry
type AuditEvent struct {
	ID            string                 `json:"id"`
	TenantID      string                 `json:"tenant_id"`
	Timestamp     time.Time              `json:"timestamp"`
	EventType     string                 `json:"event_type"`
	UserID        string                 `json:"user_id"`
	Action        string                 `json:"action"`
	Resource      string                 `json:"resource"`
	Status        string                 `json:"status"`
	Metadata      map[string]interface{} `json:"metadata"`
	PreviousHash  string                 `json:"previous_hash"`
	CurrentHash   string                 `json:"current_hash"`
	Signature     string                 `json:"signature,omitempty"`
}

// AuditLog implements tamper-proof audit logging with hash chains
type AuditLog struct {
	events      []*AuditEvent
	mu          sync.RWMutex
	chainTail   string
	immutable   bool
}

func NewAuditLog() *AuditLog {
	return &AuditLog{
		events:    []*AuditEvent{},
		chainTail: "genesis",
		immutable: true,
	}
}

// TestHashChainValidation validates audit log hash chain integrity
func TestHashChainValidation(t *testing.T) {
	log := NewAuditLog()

	// Add multiple events
	events := []struct {
		eventType string
		action    string
		userID    string
	}{
		{"auth", "login", "user-123"},
		{"auth", "permission_check", "user-123"},
		{"policy", "update", "admin-456"},
		{"auth", "logout", "user-123"},
	}

	for _, evt := range events {
		event := &AuditEvent{
			ID:        generateID(),
			TenantID:  "tenant-123",
			Timestamp: time.Now(),
			EventType: evt.eventType,
			UserID:    evt.userID,
			Action:    evt.action,
			Status:    "success",
		}
		err := log.Append(event)
		require.NoError(t, err)
	}

	// Validate entire chain
	valid, brokenAt := log.ValidateChain()
	assert.True(t, valid, "Hash chain should be valid")
	assert.Equal(t, -1, brokenAt, "No broken links should exist")

	// Verify each link
	log.mu.RLock()
	for i := 1; i < len(log.events); i++ {
		current := log.events[i]
		previous := log.events[i-1]

		assert.Equal(t, previous.CurrentHash, current.PreviousHash,
			"Event %d should link to event %d", i, i-1)

		// Verify hash computation
		expectedHash := computeEventHash(current)
		assert.Equal(t, expectedHash, current.CurrentHash,
			"Event %d hash should match computed hash", i)
	}
	log.mu.RUnlock()
}

// TestTamperDetection validates detection of tampered events
func TestTamperDetection(t *testing.T) {
	log := NewAuditLog()

	// Create event chain
	for i := 0; i < 5; i++ {
		event := &AuditEvent{
			ID:        generateID(),
			TenantID:  "tenant-123",
			Timestamp: time.Now(),
			EventType: "auth",
			UserID:    "user-123",
			Action:    "test",
			Status:    "success",
		}
		err := log.Append(event)
		require.NoError(t, err)
	}

	// Tamper with middle event
	log.mu.Lock()
	log.events[2].Action = "tampered_action"
	log.mu.Unlock()

	// Validation should fail
	valid, brokenAt := log.ValidateChain()
	assert.False(t, valid, "Tampered chain should be invalid")
	assert.Equal(t, 2, brokenAt, "Tamper should be detected at event 2")
}

// TestImmutabilityEnforcement validates events cannot be modified
func TestImmutabilityEnforcement(t *testing.T) {
	log := NewAuditLog()

	event := &AuditEvent{
		ID:        "event-123",
		TenantID:  "tenant-123",
		Timestamp: time.Now(),
		EventType: "auth",
		UserID:    "user-123",
		Action:    "login",
		Status:    "success",
	}

	err := log.Append(event)
	require.NoError(t, err)

	// Attempt to modify
	err = log.UpdateEvent("event-123", "logout")
	assert.Error(t, err, "Should not allow event modification")
	assert.Contains(t, err.Error(), "immutable")
}

// TestNoDeletionOfAuditEvents validates events cannot be deleted
func TestNoDeletionOfAuditEvents(t *testing.T) {
	log := NewAuditLog()

	// Add events
	for i := 0; i < 5; i++ {
		event := &AuditEvent{
			ID:        generateID(),
			TenantID:  "tenant-123",
			Timestamp: time.Now(),
			EventType: "auth",
			UserID:    "user-123",
			Action:    "test",
			Status:    "success",
		}
		err := log.Append(event)
		require.NoError(t, err)
	}

	initialCount := log.Count()

	// Attempt to delete
	err := log.DeleteEvent("event-123")
	assert.Error(t, err, "Should not allow event deletion")

	// Count should be unchanged
	assert.Equal(t, initialCount, log.Count())
}

// TestChainRecoveryDetection validates broken chain detection
func TestChainRecoveryDetection(t *testing.T) {
	log := NewAuditLog()

	// Create valid chain
	for i := 0; i < 5; i++ {
		event := &AuditEvent{
			ID:        generateID(),
			TenantID:  "tenant-123",
			Timestamp: time.Now(),
			EventType: "auth",
			UserID:    "user-123",
			Action:    "test",
			Status:    "success",
		}
		err := log.Append(event)
		require.NoError(t, err)
	}

	// Break chain by modifying hash
	log.mu.Lock()
	log.events[2].CurrentHash = "invalid-hash"
	log.mu.Unlock()

	// Validate should detect break
	valid, brokenAt := log.ValidateChain()
	assert.False(t, valid)
	assert.Equal(t, 2, brokenAt)

	// Get integrity report
	report := log.IntegrityReport()
	assert.False(t, report.IsValid)
	assert.Equal(t, 2, report.FirstTamperedEvent)
	assert.Equal(t, 5, report.TotalEvents)
	assert.Equal(t, 2, report.ValidEvents)
}

// TestConcurrentAuditAppend validates thread-safe append operations
func TestConcurrentAuditAppend(t *testing.T) {
	log := NewAuditLog()

	concurrency := 50
	eventsPerGoroutine := 20

	var wg sync.WaitGroup

	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func(goroutineID int) {
			defer wg.Done()

			for j := 0; j < eventsPerGoroutine; j++ {
				event := &AuditEvent{
					ID:        generateID(),
					TenantID:  "tenant-123",
					Timestamp: time.Now(),
					EventType: "auth",
					UserID:    "user-123",
					Action:    "concurrent_test",
					Status:    "success",
				}
				err := log.Append(event)
				assert.NoError(t, err)
			}
		}(i)
	}

	wg.Wait()

	// Verify all events recorded
	expectedCount := concurrency * eventsPerGoroutine
	assert.Equal(t, expectedCount, log.Count())

	// Verify chain integrity
	valid, brokenAt := log.ValidateChain()
	assert.True(t, valid, "Chain should be valid after concurrent appends")
	assert.Equal(t, -1, brokenAt)
}

// TestAuditEventSignature validates cryptographic signatures
func TestAuditEventSignature(t *testing.T) {
	log := NewAuditLog()

	event := &AuditEvent{
		ID:        "event-123",
		TenantID:  "tenant-123",
		Timestamp: time.Now(),
		EventType: "auth",
		UserID:    "user-123",
		Action:    "login",
		Status:    "success",
		Metadata: map[string]interface{}{
			"ip": "192.168.1.100",
		},
	}

	// Sign event (in production, use real crypto)
	signature := signEvent(event)
	event.Signature = signature

	err := log.Append(event)
	require.NoError(t, err)

	// Verify signature
	retrieved := log.GetEvent("event-123")
	require.NotNil(t, retrieved)

	valid := verifyEventSignature(retrieved)
	assert.True(t, valid, "Event signature should be valid")

	// Tamper and verify signature fails
	retrieved.Action = "logout"
	valid = verifyEventSignature(retrieved)
	assert.False(t, valid, "Tampered event signature should be invalid")
}

// TestAuditLogPerformance validates performance requirements
func TestAuditLogPerformance(t *testing.T) {
	log := NewAuditLog()

	// Benchmark append operation
	iterations := 1000
	start := time.Now()

	for i := 0; i < iterations; i++ {
		event := &AuditEvent{
			ID:        generateID(),
			TenantID:  "tenant-123",
			Timestamp: time.Now(),
			EventType: "auth",
			UserID:    "user-123",
			Action:    "perf_test",
			Status:    "success",
		}
		err := log.Append(event)
		require.NoError(t, err)
	}

	elapsed := time.Since(start)
	avgTime := elapsed / time.Duration(iterations)

	t.Logf("Average append time: %v", avgTime)
	assert.Less(t, avgTime, 1*time.Millisecond,
		"Append should take less than 1ms per event")

	// Benchmark validation
	start = time.Now()
	valid, _ := log.ValidateChain()
	validationTime := time.Since(start)

	assert.True(t, valid)
	t.Logf("Full chain validation time for %d events: %v", iterations, validationTime)
}

// Implementation methods

func (a *AuditLog) Append(event *AuditEvent) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	// Set previous hash
	event.PreviousHash = a.chainTail

	// Compute current hash
	event.CurrentHash = computeEventHash(event)

	// Update chain tail
	a.chainTail = event.CurrentHash

	// Append to log
	a.events = append(a.events, event)

	return nil
}

func (a *AuditLog) ValidateChain() (bool, int) {
	a.mu.RLock()
	defer a.mu.RUnlock()

	if len(a.events) == 0 {
		return true, -1
	}

	// Validate genesis
	if a.events[0].PreviousHash != "genesis" {
		return false, 0
	}

	// Validate each link
	for i := 0; i < len(a.events); i++ {
		event := a.events[i]

		// Verify hash computation
		expectedHash := computeEventHash(event)
		if event.CurrentHash != expectedHash {
			return false, i
		}

		// Verify chain link (except first)
		if i > 0 {
			previous := a.events[i-1]
			if event.PreviousHash != previous.CurrentHash {
				return false, i
			}
		}
	}

	return true, -1
}

func (a *AuditLog) UpdateEvent(id string, newAction string) error {
	if a.immutable {
		return ErrImmutableLog
	}
	return nil
}

func (a *AuditLog) DeleteEvent(id string) error {
	return ErrCannotDelete
}

func (a *AuditLog) Count() int {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return len(a.events)
}

func (a *AuditLog) GetEvent(id string) *AuditEvent {
	a.mu.RLock()
	defer a.mu.RUnlock()

	for _, event := range a.events {
		if event.ID == id {
			return event
		}
	}
	return nil
}

type IntegrityReport struct {
	IsValid            bool
	TotalEvents        int
	ValidEvents        int
	FirstTamperedEvent int
}

func (a *AuditLog) IntegrityReport() *IntegrityReport {
	valid, brokenAt := a.ValidateChain()

	report := &IntegrityReport{
		IsValid:            valid,
		TotalEvents:        len(a.events),
		FirstTamperedEvent: brokenAt,
	}

	if valid {
		report.ValidEvents = len(a.events)
	} else {
		report.ValidEvents = brokenAt
	}

	return report
}

// Helper functions

func computeEventHash(event *AuditEvent) string {
	// Create canonical representation
	data := struct {
		ID           string
		TenantID     string
		Timestamp    time.Time
		EventType    string
		UserID       string
		Action       string
		Resource     string
		Status       string
		PreviousHash string
	}{
		ID:           event.ID,
		TenantID:     event.TenantID,
		Timestamp:    event.Timestamp,
		EventType:    event.EventType,
		UserID:       event.UserID,
		Action:       event.Action,
		Resource:     event.Resource,
		Status:       event.Status,
		PreviousHash: event.PreviousHash,
	}

	jsonData, _ := json.Marshal(data)
	hash := sha256.Sum256(jsonData)
	return hex.EncodeToString(hash[:])
}

func signEvent(event *AuditEvent) string {
	// Simplified signature (use real crypto in production)
	hash := computeEventHash(event)
	return "sig:" + hash[:16]
}

func verifyEventSignature(event *AuditEvent) bool {
	expectedSig := signEvent(event)
	return event.Signature == expectedSig
}

var idCounter int
var idMu sync.Mutex

func generateID() string {
	idMu.Lock()
	defer idMu.Unlock()
	idCounter++
	return time.Now().Format("20060102150405") + "-" + string(rune(idCounter))
}

var (
	ErrImmutableLog = assert.AnError
	ErrCannotDelete = assert.AnError
)
