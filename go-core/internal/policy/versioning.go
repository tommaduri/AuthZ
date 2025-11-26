package policy

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/authz-engine/go-core/pkg/types"
)

// PolicyVersion represents a versioned policy snapshot
type PolicyVersion struct {
	Version   int64                  `json:"version"`
	Timestamp time.Time              `json:"timestamp"`
	Policies  map[string]*types.Policy `json:"policies"`
	Checksum  string                 `json:"checksum"`
	Comment   string                 `json:"comment,omitempty"`
}

// VersionStore manages policy version history with LRU eviction
type VersionStore struct {
	mu             sync.RWMutex
	versions       []*PolicyVersion
	currentVersion int64
	maxVersions    int
}

// NewVersionStore creates a new version store with the specified maximum number of versions to retain
func NewVersionStore(maxVersions int) *VersionStore {
	if maxVersions <= 0 {
		maxVersions = 10
	}
	return &VersionStore{
		versions:       make([]*PolicyVersion, 0, maxVersions),
		currentVersion: 0,
		maxVersions:    maxVersions,
	}
}

// SaveVersion saves a new policy version and returns the created version
func (vs *VersionStore) SaveVersion(policies map[string]*types.Policy, comment string) (*PolicyVersion, error) {
	vs.mu.Lock()
	defer vs.mu.Unlock()

	// Calculate checksum for the policy set
	checksum, err := vs.calculateChecksum(policies)
	if err != nil {
		return nil, fmt.Errorf("failed to calculate checksum: %w", err)
	}

	// Check if this is a duplicate (same checksum as current version)
	if len(vs.versions) > 0 {
		latest := vs.versions[len(vs.versions)-1]
		if latest.Checksum == checksum {
			// No changes, return existing version
			return latest, nil
		}
	}

	// Create new version
	vs.currentVersion++
	version := &PolicyVersion{
		Version:   vs.currentVersion,
		Timestamp: time.Now(),
		Policies:  vs.deepCopyPolicies(policies),
		Checksum:  checksum,
		Comment:   comment,
	}

	// Add to versions list
	vs.versions = append(vs.versions, version)

	// Evict oldest versions if we exceed maxVersions (LRU)
	if len(vs.versions) > vs.maxVersions {
		// Keep the most recent maxVersions
		vs.versions = vs.versions[len(vs.versions)-vs.maxVersions:]
	}

	return version, nil
}

// GetVersion retrieves a specific policy version by version number
func (vs *VersionStore) GetVersion(version int64) (*PolicyVersion, error) {
	vs.mu.RLock()
	defer vs.mu.RUnlock()

	for _, v := range vs.versions {
		if v.Version == version {
			return v, nil
		}
	}

	return nil, fmt.Errorf("version %d not found", version)
}

// GetCurrentVersion returns the current (latest) policy version
func (vs *VersionStore) GetCurrentVersion() (*PolicyVersion, error) {
	vs.mu.RLock()
	defer vs.mu.RUnlock()

	if len(vs.versions) == 0 {
		return nil, fmt.Errorf("no versions available")
	}

	return vs.versions[len(vs.versions)-1], nil
}

// GetPreviousVersion returns the version before the current one (for rollback)
func (vs *VersionStore) GetPreviousVersion() (*PolicyVersion, error) {
	vs.mu.RLock()
	defer vs.mu.RUnlock()

	if len(vs.versions) < 2 {
		return nil, fmt.Errorf("no previous version available")
	}

	return vs.versions[len(vs.versions)-2], nil
}

// ListVersions returns all stored versions in chronological order
func (vs *VersionStore) ListVersions() []*PolicyVersion {
	vs.mu.RLock()
	defer vs.mu.RUnlock()

	// Return a copy to prevent external modification
	result := make([]*PolicyVersion, len(vs.versions))
	copy(result, vs.versions)
	return result
}

// GetVersionCount returns the number of stored versions
func (vs *VersionStore) GetVersionCount() int {
	vs.mu.RLock()
	defer vs.mu.RUnlock()

	return len(vs.versions)
}

// Clear removes all versions (for testing)
func (vs *VersionStore) Clear() {
	vs.mu.Lock()
	defer vs.mu.Unlock()

	vs.versions = make([]*PolicyVersion, 0, vs.maxVersions)
	vs.currentVersion = 0
}

// calculateChecksum computes a SHA256 checksum of the policy set for change detection
func (vs *VersionStore) calculateChecksum(policies map[string]*types.Policy) (string, error) {
	// Serialize policies to JSON in a deterministic way
	data, err := json.Marshal(policies)
	if err != nil {
		return "", fmt.Errorf("failed to marshal policies: %w", err)
	}

	// Calculate SHA256 hash
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:]), nil
}

// deepCopyPolicies creates a deep copy of the policies map
func (vs *VersionStore) deepCopyPolicies(policies map[string]*types.Policy) map[string]*types.Policy {
	if policies == nil {
		return nil
	}

	copied := make(map[string]*types.Policy, len(policies))
	for id, policy := range policies {
		// Note: This is a shallow copy of Policy struct
		// If Policy contains pointers/slices that need deep copying, enhance this
		policyCopy := *policy
		copied[id] = &policyCopy
	}
	return copied
}

// PolicyVersionStats returns statistics about the version store
type PolicyVersionStats struct {
	TotalVersions    int       `json:"total_versions"`
	CurrentVersion   int64     `json:"current_version"`
	OldestVersion    int64     `json:"oldest_version,omitempty"`
	OldestTimestamp  time.Time `json:"oldest_timestamp,omitempty"`
	LatestTimestamp  time.Time `json:"latest_timestamp,omitempty"`
	MaxVersions      int       `json:"max_versions"`
}

// GetStats returns statistics about the version store
func (vs *VersionStore) GetStats() PolicyVersionStats {
	vs.mu.RLock()
	defer vs.mu.RUnlock()

	stats := PolicyVersionStats{
		TotalVersions:  len(vs.versions),
		CurrentVersion: vs.currentVersion,
		MaxVersions:    vs.maxVersions,
	}

	if len(vs.versions) > 0 {
		stats.OldestVersion = vs.versions[0].Version
		stats.OldestTimestamp = vs.versions[0].Timestamp
		stats.LatestTimestamp = vs.versions[len(vs.versions)-1].Timestamp
	}

	return stats
}
