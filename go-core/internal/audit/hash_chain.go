package audit

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/authz-engine/go-core/pkg/types"
)

// HashChain manages the cryptographic hash chain for audit log integrity
type HashChain struct {
	mu          sync.RWMutex
	lastHash    string
	initialized bool
}

// NewHashChain creates a new hash chain manager
func NewHashChain() *HashChain {
	return &HashChain{
		lastHash:    "", // Genesis event has empty prev hash
		initialized: false,
	}
}

// InitializeWithHash sets the initial hash (for recovery/startup)
func (hc *HashChain) InitializeWithHash(hash string) {
	hc.mu.Lock()
	defer hc.mu.Unlock()
	hc.lastHash = hash
	hc.initialized = true
}

// ComputeEventHash computes the SHA-256 hash for an audit event
// Hash = SHA256(timestamp + event_type + actor_id + tenant_id + success + prev_hash + metadata)
func (hc *HashChain) ComputeEventHash(event *types.AuditEvent) (string, error) {
	hc.mu.RLock()
	prevHash := hc.lastHash
	hc.mu.RUnlock()

	// Set previous hash
	event.PrevHash = prevHash

	// Create hash input
	hashInput := struct {
		Timestamp   string                 `json:"timestamp"`
		EventType   string                 `json:"event_type"`
		ActorID     string                 `json:"actor_id"`
		AgentID     string                 `json:"agent_id,omitempty"`
		TenantID    string                 `json:"tenant_id"`
		IPAddress   string                 `json:"ip_address"`
		Success     bool                   `json:"success"`
		ErrorCode   string                 `json:"error_code,omitempty"`
		RequestID   string                 `json:"request_id,omitempty"`
		Metadata    map[string]interface{} `json:"metadata,omitempty"`
		PrevHash    string                 `json:"prev_hash"`
	}{
		Timestamp:   event.Timestamp.UTC().Format("2006-01-02T15:04:05.000000Z"),
		EventType:   string(event.EventType),
		ActorID:     event.ActorID,
		AgentID:     event.AgentID,
		TenantID:    event.TenantID,
		IPAddress:   event.IPAddress,
		Success:     event.Success,
		ErrorCode:   event.ErrorCode,
		RequestID:   event.RequestID,
		Metadata:    event.Metadata,
		PrevHash:    prevHash,
	}

	// Serialize to JSON for deterministic hashing
	jsonData, err := json.Marshal(hashInput)
	if err != nil {
		return "", fmt.Errorf("failed to marshal event for hashing: %w", err)
	}

	// Compute SHA-256 hash
	hash := sha256.Sum256(jsonData)
	hashHex := hex.EncodeToString(hash[:])

	// Set hash on event
	event.Hash = hashHex

	return hashHex, nil
}

// UpdateLastHash updates the chain with the latest hash
func (hc *HashChain) UpdateLastHash(hash string) {
	hc.mu.Lock()
	defer hc.mu.Unlock()
	hc.lastHash = hash
	hc.initialized = true
}

// GetLastHash returns the current last hash
func (hc *HashChain) GetLastHash() string {
	hc.mu.RLock()
	defer hc.mu.RUnlock()
	return hc.lastHash
}

// IsInitialized returns whether the hash chain has been initialized
func (hc *HashChain) IsInitialized() bool {
	hc.mu.RLock()
	defer hc.mu.RUnlock()
	return hc.initialized
}

// VerifyEventHash verifies that an event's hash is correct
func (hc *HashChain) VerifyEventHash(event *types.AuditEvent) (bool, error) {
	// Create a copy to avoid modifying original
	eventCopy := *event
	eventCopy.Hash = "" // Clear hash for recomputation

	// Create hash input
	hashInput := struct {
		Timestamp   string                 `json:"timestamp"`
		EventType   string                 `json:"event_type"`
		ActorID     string                 `json:"actor_id"`
		AgentID     string                 `json:"agent_id,omitempty"`
		TenantID    string                 `json:"tenant_id"`
		IPAddress   string                 `json:"ip_address"`
		Success     bool                   `json:"success"`
		ErrorCode   string                 `json:"error_code,omitempty"`
		RequestID   string                 `json:"request_id,omitempty"`
		Metadata    map[string]interface{} `json:"metadata,omitempty"`
		PrevHash    string                 `json:"prev_hash"`
	}{
		Timestamp:   eventCopy.Timestamp.UTC().Format("2006-01-02T15:04:05.000000Z"),
		EventType:   string(eventCopy.EventType),
		ActorID:     eventCopy.ActorID,
		AgentID:     eventCopy.AgentID,
		TenantID:    eventCopy.TenantID,
		IPAddress:   eventCopy.IPAddress,
		Success:     eventCopy.Success,
		ErrorCode:   eventCopy.ErrorCode,
		RequestID:   eventCopy.RequestID,
		Metadata:    eventCopy.Metadata,
		PrevHash:    eventCopy.PrevHash,
	}

	// Serialize and hash
	jsonData, err := json.Marshal(hashInput)
	if err != nil {
		return false, fmt.Errorf("failed to marshal event for verification: %w", err)
	}

	hash := sha256.Sum256(jsonData)
	computedHash := hex.EncodeToString(hash[:])

	return computedHash == event.Hash, nil
}

// VerifyChain verifies the integrity of a chain of events
func VerifyChain(events []*types.AuditEvent) (bool, error) {
	if len(events) == 0 {
		return true, nil
	}

	hc := NewHashChain()

	for i, event := range events {
		// Verify hash matches
		valid, err := hc.VerifyEventHash(event)
		if err != nil {
			return false, fmt.Errorf("failed to verify event %d: %w", i, err)
		}
		if !valid {
			return false, fmt.Errorf("event %d has invalid hash", i)
		}

		// Verify previous hash links correctly
		expectedPrevHash := hc.GetLastHash()
		if event.PrevHash != expectedPrevHash {
			return false, fmt.Errorf("event %d has broken chain: expected prev_hash %s, got %s",
				i, expectedPrevHash, event.PrevHash)
		}

		// Update chain
		hc.UpdateLastHash(event.Hash)
	}

	return true, nil
}
