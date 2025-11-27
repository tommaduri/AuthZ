package audit

import (
	"testing"
	"time"

	"github.com/authz-engine/go-core/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewHashChain(t *testing.T) {
	hc := NewHashChain()
	assert.NotNil(t, hc)
	assert.False(t, hc.IsInitialized())
	assert.Empty(t, hc.GetLastHash())
}

func TestHashChain_InitializeWithHash(t *testing.T) {
	hc := NewHashChain()
	testHash := "abc123def456"

	hc.InitializeWithHash(testHash)

	assert.True(t, hc.IsInitialized())
	assert.Equal(t, testHash, hc.GetLastHash())
}

func TestHashChain_ComputeEventHash(t *testing.T) {
	hc := NewHashChain()

	event := types.NewAuditEventBuilder(
		types.EventAuthLoginSuccess,
		"user-123",
		"tenant-1",
	).
		WithRequestContext("192.168.1.1", "Mozilla/5.0").
		WithRequestID("req-123").
		WithSuccess(true).
		WithMetadata("session_id", "sess-abc").
		Build()

	hash, err := hc.ComputeEventHash(event)
	require.NoError(t, err)
	assert.NotEmpty(t, hash)
	assert.Len(t, hash, 64) // SHA-256 produces 64 hex chars
	assert.Equal(t, hash, event.Hash)
	assert.Empty(t, event.PrevHash) // First event
}

func TestHashChain_UpdateLastHash(t *testing.T) {
	hc := NewHashChain()

	// First event
	event1 := types.NewAuditEventBuilder(
		types.EventAuthLoginSuccess,
		"user-1",
		"tenant-1",
	).WithSuccess(true).Build()

	hash1, err := hc.ComputeEventHash(event1)
	require.NoError(t, err)

	hc.UpdateLastHash(hash1)
	assert.Equal(t, hash1, hc.GetLastHash())

	// Second event should reference first
	event2 := types.NewAuditEventBuilder(
		types.EventAuthTokenIssued,
		"user-1",
		"tenant-1",
	).WithSuccess(true).Build()

	hash2, err := hc.ComputeEventHash(event2)
	require.NoError(t, err)

	assert.Equal(t, hash1, event2.PrevHash)
	assert.Equal(t, hash2, event2.Hash)
	assert.NotEqual(t, hash1, hash2)
}

func TestHashChain_VerifyEventHash(t *testing.T) {
	hc := NewHashChain()

	event := types.NewAuditEventBuilder(
		types.EventAuthLoginSuccess,
		"user-123",
		"tenant-1",
	).
		WithRequestContext("192.168.1.1", "Mozilla/5.0").
		WithSuccess(true).
		Build()

	// Compute hash
	_, err := hc.ComputeEventHash(event)
	require.NoError(t, err)

	// Verify hash is correct
	valid, err := hc.VerifyEventHash(event)
	require.NoError(t, err)
	assert.True(t, valid)

	// Tamper with event
	event.ActorID = "different-user"

	// Verification should fail
	valid, err = hc.VerifyEventHash(event)
	require.NoError(t, err)
	assert.False(t, valid, "Tampered event should fail verification")
}

func TestHashChain_DeterministicHash(t *testing.T) {
	// Same event data should produce same hash
	createEvent := func() *types.AuditEvent {
		return &types.AuditEvent{
			Timestamp:  time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC),
			EventType:  types.EventAuthLoginSuccess,
			ActorID:    "user-123",
			TenantID:   "tenant-1",
			IPAddress:  "192.168.1.1",
			UserAgent:  "Mozilla/5.0",
			Success:    true,
			PrevHash:   "",
			Metadata:   map[string]interface{}{"key": "value"},
		}
	}

	hc := NewHashChain()

	event1 := createEvent()
	hash1, err := hc.ComputeEventHash(event1)
	require.NoError(t, err)

	event2 := createEvent()
	hash2, err := hc.ComputeEventHash(event2)
	require.NoError(t, err)

	assert.Equal(t, hash1, hash2, "Identical events should produce identical hashes")
}

func TestHashChain_DifferentDataProducesDifferentHash(t *testing.T) {
	hc := NewHashChain()

	event1 := types.NewAuditEventBuilder(
		types.EventAuthLoginSuccess,
		"user-1",
		"tenant-1",
	).WithSuccess(true).Build()

	hash1, err := hc.ComputeEventHash(event1)
	require.NoError(t, err)

	event2 := types.NewAuditEventBuilder(
		types.EventAuthLoginSuccess,
		"user-2", // Different user
		"tenant-1",
	).WithSuccess(true).Build()

	hash2, err := hc.ComputeEventHash(event2)
	require.NoError(t, err)

	assert.NotEqual(t, hash1, hash2, "Different events should produce different hashes")
}

func TestVerifyChain_EmptyChain(t *testing.T) {
	events := []*types.AuditEvent{}
	valid, err := VerifyChain(events)
	require.NoError(t, err)
	assert.True(t, valid, "Empty chain is valid")
}

func TestVerifyChain_ValidChain(t *testing.T) {
	hc := NewHashChain()

	// Create chain of events
	events := []*types.AuditEvent{}

	for i := 0; i < 5; i++ {
		event := types.NewAuditEventBuilder(
			types.EventAuthLoginSuccess,
			"user-1",
			"tenant-1",
		).WithSuccess(true).Build()

		hash, err := hc.ComputeEventHash(event)
		require.NoError(t, err)

		hc.UpdateLastHash(hash)
		events = append(events, event)
	}

	// Verify entire chain
	valid, err := VerifyChain(events)
	require.NoError(t, err)
	assert.True(t, valid, "Valid chain should pass verification")
}

func TestVerifyChain_InvalidHash(t *testing.T) {
	hc := NewHashChain()

	// Create chain
	events := []*types.AuditEvent{}
	for i := 0; i < 3; i++ {
		event := types.NewAuditEventBuilder(
			types.EventAuthLoginSuccess,
			"user-1",
			"tenant-1",
		).WithSuccess(true).Build()

		hash, err := hc.ComputeEventHash(event)
		require.NoError(t, err)

		hc.UpdateLastHash(hash)
		events = append(events, event)
	}

	// Tamper with middle event's hash
	events[1].Hash = "tampered_hash_123"

	// Verification should fail
	valid, err := VerifyChain(events)
	// Expect an error or invalid result
	if err != nil {
		assert.Error(t, err, "Tampered chain should return error")
	} else {
		assert.False(t, valid, "Tampered chain should fail verification")
	}
}

func TestVerifyChain_BrokenLink(t *testing.T) {
	hc := NewHashChain()

	// Create chain
	events := []*types.AuditEvent{}
	for i := 0; i < 3; i++ {
		event := types.NewAuditEventBuilder(
			types.EventAuthLoginSuccess,
			"user-1",
			"tenant-1",
		).WithSuccess(true).Build()

		hash, err := hc.ComputeEventHash(event)
		require.NoError(t, err)

		hc.UpdateLastHash(hash)
		events = append(events, event)
	}

	// Break the chain by modifying prev_hash
	events[2].PrevHash = "wrong_previous_hash"

	// Verification should fail
	valid, err := VerifyChain(events)
	// Expect an error or invalid result
	if err != nil {
		assert.Error(t, err, "Broken chain should return error")
	} else {
		assert.False(t, valid, "Broken chain should fail verification")
	}
}

func TestHashChain_ConcurrentAccess(t *testing.T) {
	hc := NewHashChain()

	// Test concurrent reads and writes
	done := make(chan bool)

	// Writer goroutine
	go func() {
		for i := 0; i < 100; i++ {
			event := types.NewAuditEventBuilder(
				types.EventAuthLoginSuccess,
				"user-1",
				"tenant-1",
			).WithSuccess(true).Build()

			hash, err := hc.ComputeEventHash(event)
			require.NoError(t, err)
			hc.UpdateLastHash(hash)
		}
		done <- true
	}()

	// Reader goroutine
	go func() {
		for i := 0; i < 100; i++ {
			_ = hc.GetLastHash()
			_ = hc.IsInitialized()
		}
		done <- true
	}()

	// Wait for both goroutines
	<-done
	<-done
}

func TestHashChain_MetadataIncludedInHash(t *testing.T) {
	hc := NewHashChain()

	event1 := types.NewAuditEventBuilder(
		types.EventAuthLoginSuccess,
		"user-1",
		"tenant-1",
	).
		WithSuccess(true).
		WithMetadata("key", "value1").
		Build()

	hash1, err := hc.ComputeEventHash(event1)
	require.NoError(t, err)

	event2 := types.NewAuditEventBuilder(
		types.EventAuthLoginSuccess,
		"user-1",
		"tenant-1",
	).
		WithSuccess(true).
		WithMetadata("key", "value2"). // Different metadata
		Build()

	hash2, err := hc.ComputeEventHash(event2)
	require.NoError(t, err)

	assert.NotEqual(t, hash1, hash2, "Different metadata should produce different hashes")
}

// Benchmark tests
func BenchmarkHashChain_ComputeHash(b *testing.B) {
	hc := NewHashChain()

	event := types.NewAuditEventBuilder(
		types.EventAuthLoginSuccess,
		"user-123",
		"tenant-1",
	).
		WithRequestContext("192.168.1.1", "Mozilla/5.0").
		WithSuccess(true).
		WithMetadata("session_id", "sess-abc").
		WithMetadata("ip_country", "US").
		Build()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = hc.ComputeEventHash(event)
	}
}

func BenchmarkHashChain_VerifyHash(b *testing.B) {
	hc := NewHashChain()

	event := types.NewAuditEventBuilder(
		types.EventAuthLoginSuccess,
		"user-123",
		"tenant-1",
	).
		WithRequestContext("192.168.1.1", "Mozilla/5.0").
		WithSuccess(true).
		Build()

	_, _ = hc.ComputeEventHash(event)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = hc.VerifyEventHash(event)
	}
}
