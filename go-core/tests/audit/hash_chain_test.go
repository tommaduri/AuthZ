package audit_test

import (
	"testing"
	"time"

	"github.com/authz-engine/go-core/internal/audit"
	"github.com/authz-engine/go-core/pkg/types"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHashChain_ComputeEventHash(t *testing.T) {
	hc := audit.NewHashChain()

	event := &types.AuditEvent{
		EventType: types.EventTypeLoginSuccess,
		ActorID:   "user-123",
		TenantID:  "tenant-abc",
		IPAddress: "192.168.1.1",
		Success:   true,
		Timestamp: time.Now().UTC(),
		Metadata: map[string]interface{}{
			"method": "password",
		},
	}

	hash, err := hc.ComputeEventHash(event)
	require.NoError(t, err)
	assert.NotEmpty(t, hash)
	assert.Equal(t, 64, len(hash)) // SHA-256 hex = 64 chars
	assert.Equal(t, "", event.PrevHash) // Genesis event
	assert.Equal(t, hash, event.Hash)
}

func TestHashChain_ComputeEventHash_Deterministic(t *testing.T) {
	hc := audit.NewHashChain()

	event1 := &types.AuditEvent{
		EventType: types.EventTypeTokenIssued,
		ActorID:   "user-456",
		TenantID:  "tenant-xyz",
		IPAddress: "10.0.0.1",
		Success:   true,
		Timestamp: time.Date(2025, 11, 27, 10, 0, 0, 0, time.UTC),
		Metadata: map[string]interface{}{
			"token_type": "Bearer",
		},
	}

	hash1, err := hc.ComputeEventHash(event1)
	require.NoError(t, err)

	// Compute again - should be identical
	hc2 := audit.NewHashChain()
	event2 := &types.AuditEvent{
		EventType: types.EventTypeTokenIssued,
		ActorID:   "user-456",
		TenantID:  "tenant-xyz",
		IPAddress: "10.0.0.1",
		Success:   true,
		Timestamp: time.Date(2025, 11, 27, 10, 0, 0, 0, time.UTC),
		Metadata: map[string]interface{}{
			"token_type": "Bearer",
		},
	}

	hash2, err := hc2.ComputeEventHash(event2)
	require.NoError(t, err)

	assert.Equal(t, hash1, hash2, "Hashes should be deterministic")
}

func TestHashChain_ChainedEvents(t *testing.T) {
	hc := audit.NewHashChain()

	// First event (genesis)
	event1 := &types.AuditEvent{
		EventType: types.EventTypeLoginSuccess,
		ActorID:   "user-1",
		TenantID:  "tenant-1",
		Success:   true,
		Timestamp: time.Now().UTC(),
	}

	hash1, err := hc.ComputeEventHash(event1)
	require.NoError(t, err)
	hc.UpdateLastHash(hash1)

	// Second event (should link to first)
	event2 := &types.AuditEvent{
		EventType: types.EventTypeAPIKeyCreated,
		ActorID:   "user-1",
		TenantID:  "tenant-1",
		Success:   true,
		Timestamp: time.Now().UTC().Add(1 * time.Second),
	}

	hash2, err := hc.ComputeEventHash(event2)
	require.NoError(t, err)

	assert.Equal(t, hash1, event2.PrevHash, "Second event should link to first")
	assert.NotEqual(t, hash1, hash2, "Hashes should be different")
	hc.UpdateLastHash(hash2)

	// Third event (should link to second)
	event3 := &types.AuditEvent{
		EventType: types.EventTypeLogout,
		ActorID:   "user-1",
		TenantID:  "tenant-1",
		Success:   true,
		Timestamp: time.Now().UTC().Add(2 * time.Second),
	}

	hash3, err := hc.ComputeEventHash(event3)
	require.NoError(t, err)

	assert.Equal(t, hash2, event3.PrevHash, "Third event should link to second")
	assert.NotEqual(t, hash2, hash3, "Hashes should be different")
}

func TestHashChain_VerifyEventHash(t *testing.T) {
	hc := audit.NewHashChain()

	event := &types.AuditEvent{
		EventType: types.EventTypeLoginFailure,
		ActorID:   "user-bad",
		TenantID:  "tenant-1",
		Success:   false,
		Timestamp: time.Now().UTC(),
	}

	hash, err := hc.ComputeEventHash(event)
	require.NoError(t, err)
	event.Hash = hash

	// Verify should pass
	valid, err := hc.VerifyEventHash(event)
	require.NoError(t, err)
	assert.True(t, valid)

	// Tamper with event
	event.ActorID = "user-tampered"

	// Verify should fail
	valid, err = hc.VerifyEventHash(event)
	require.NoError(t, err)
	assert.False(t, valid, "Tampered event should fail verification")
}

func TestHashChain_VerifyChain_Valid(t *testing.T) {
	hc := audit.NewHashChain()

	events := make([]*types.AuditEvent, 5)
	for i := 0; i < 5; i++ {
		event := &types.AuditEvent{
			EventType: types.EventTypeAPIKeyValidated,
			ActorID:   "user-1",
			TenantID:  "tenant-1",
			Success:   true,
			Timestamp: time.Now().UTC().Add(time.Duration(i) * time.Second),
		}

		hash, err := hc.ComputeEventHash(event)
		require.NoError(t, err)
		hc.UpdateLastHash(hash)
		events[i] = event
	}

	// Verify entire chain
	valid, err := audit.VerifyChain(events)
	require.NoError(t, err)
	assert.True(t, valid, "Valid chain should verify successfully")
}

func TestHashChain_VerifyChain_BrokenChain(t *testing.T) {
	hc := audit.NewHashChain()

	events := make([]*types.AuditEvent, 5)
	for i := 0; i < 5; i++ {
		event := &types.AuditEvent{
			EventType: types.EventTypeTokenRefreshed,
			ActorID:   "user-1",
			TenantID:  "tenant-1",
			Success:   true,
			Timestamp: time.Now().UTC().Add(time.Duration(i) * time.Second),
		}

		hash, err := hc.ComputeEventHash(event)
		require.NoError(t, err)
		hc.UpdateLastHash(hash)
		events[i] = event
	}

	// Tamper with event 2
	events[2].ActorID = "user-tampered"

	// Verify should fail
	valid, err := audit.VerifyChain(events)
	assert.Error(t, err, "Broken chain should return error")
	assert.False(t, valid)
	assert.Contains(t, err.Error(), "has invalid hash")
}

func TestHashChain_VerifyChain_ModifiedPrevHash(t *testing.T) {
	hc := audit.NewHashChain()

	events := make([]*types.AuditEvent, 5)
	for i := 0; i < 5; i++ {
		event := &types.AuditEvent{
			EventType: types.EventTypeRateLimitExceeded,
			ActorID:   "user-1",
			TenantID:  "tenant-1",
			Success:   false,
			Timestamp: time.Now().UTC().Add(time.Duration(i) * time.Second),
		}

		hash, err := hc.ComputeEventHash(event)
		require.NoError(t, err)
		hc.UpdateLastHash(hash)
		events[i] = event
	}

	// Modify prev_hash of event 3
	events[3].PrevHash = "tampered-hash"

	// Verify should fail
	valid, err := audit.VerifyChain(events)
	assert.Error(t, err, "Broken chain link should return error")
	assert.False(t, valid)
	assert.Contains(t, err.Error(), "broken chain")
}

func TestHashChain_EmptyChain(t *testing.T) {
	events := []*types.AuditEvent{}
	valid, err := audit.VerifyChain(events)
	require.NoError(t, err)
	assert.True(t, valid, "Empty chain should be valid")
}

func TestHashChain_InitializeWithHash(t *testing.T) {
	hc := audit.NewHashChain()
	assert.False(t, hc.IsInitialized())

	expectedHash := "abc123def456"
	hc.InitializeWithHash(expectedHash)

	assert.True(t, hc.IsInitialized())
	assert.Equal(t, expectedHash, hc.GetLastHash())

	// Next event should use this hash
	event := &types.AuditEvent{
		EventType: types.EventTypePermissionDenied,
		ActorID:   "user-1",
		TenantID:  "tenant-1",
		Success:   false,
		Timestamp: time.Now().UTC(),
	}

	_, err := hc.ComputeEventHash(event)
	require.NoError(t, err)
	assert.Equal(t, expectedHash, event.PrevHash)
}

func TestHashChain_ConcurrentAccess(t *testing.T) {
	hc := audit.NewHashChain()

	// Simulate concurrent access from multiple goroutines
	done := make(chan bool, 10)

	for i := 0; i < 10; i++ {
		go func(id int) {
			event := &types.AuditEvent{
				EventType: types.EventTypeLoginSuccess,
				ActorID:   "user-" + uuid.NewString(),
				TenantID:  "tenant-1",
				Success:   true,
				Timestamp: time.Now().UTC(),
			}

			hash, err := hc.ComputeEventHash(event)
			assert.NoError(t, err)
			hc.UpdateLastHash(hash)

			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	// Hash chain should have some final hash
	assert.NotEmpty(t, hc.GetLastHash())
}

func TestHashChain_AllEventTypes(t *testing.T) {
	eventTypes := []types.EventType{
		types.EventTypeAPIKeyCreated,
		types.EventTypeAPIKeyValidated,
		types.EventTypeAPIKeyRevoked,
		types.EventTypeTokenIssued,
		types.EventTypeTokenRefreshed,
		types.EventTypeTokenRevoked,
		types.EventTypeLoginSuccess,
		types.EventTypeLoginFailure,
		types.EventTypeLogout,
		types.EventTypeRateLimitExceeded,
		types.EventTypePermissionDenied,
	}

	hc := audit.NewHashChain()

	for _, eventType := range eventTypes {
		event := &types.AuditEvent{
			EventType: eventType,
			ActorID:   "user-1",
			TenantID:  "tenant-1",
			Success:   true,
			Timestamp: time.Now().UTC(),
		}

		hash, err := hc.ComputeEventHash(event)
		require.NoError(t, err, "Failed for event type: %s", eventType)
		assert.NotEmpty(t, hash)
		hc.UpdateLastHash(hash)
	}
}
