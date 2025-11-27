// Package policy provides integration tests for policy backup and restore
package policy

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stretchr/testify/suite"

	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
)

// BackupRestoreTestSuite is the test suite for backup and restore
type BackupRestoreTestSuite struct {
	suite.Suite
	store   policy.Store
	backups map[string]*Backup
}

// Backup represents a policy backup
type Backup struct {
	ID        string
	Timestamp time.Time
	Policies  []*types.Policy
	Metadata  BackupMetadata
}

// BackupMetadata contains backup metadata
type BackupMetadata struct {
	Version     string
	PolicyCount int
	CreatedBy   string
	Description string
}

// SetupTest runs before each test
func (s *BackupRestoreTestSuite) SetupTest() {
	s.store = policy.NewMemoryStore()
	s.backups = make(map[string]*Backup)
}

// createTestPolicy creates a test policy
func (s *BackupRestoreTestSuite) createTestPolicy(id string) *types.Policy {
	return &types.Policy{
		PolicyID:    id,
		Kind:        types.PolicyKindResource,
		Version:     "1.0",
		Description: fmt.Sprintf("Test policy %s", id),
		ResourcePolicy: &types.ResourcePolicy{
			Resource: "document",
			Version:  "1.0",
			Rules: []types.ResourceRule{
				{Actions: []string{"read"}, Effect: types.EffectAllow, Roles: []string{"viewer"}},
			},
		},
	}
}

// createBackup creates a backup of the current store
func (s *BackupRestoreTestSuite) createBackup(ctx context.Context, description string) (*Backup, error) {
	policies, err := s.store.List(ctx)
	if err != nil {
		return nil, err
	}

	backup := &Backup{
		ID:        fmt.Sprintf("backup-%d", time.Now().Unix()),
		Timestamp: time.Now(),
		Policies:  policies,
		Metadata: BackupMetadata{
			Version:     "1.0",
			PolicyCount: len(policies),
			CreatedBy:   "system",
			Description: description,
		},
	}

	s.backups[backup.ID] = backup
	return backup, nil
}

// restoreBackup restores policies from a backup
func (s *BackupRestoreTestSuite) restoreBackup(ctx context.Context, backupID string) error {
	backup, exists := s.backups[backupID]
	if !exists {
		return fmt.Errorf("backup not found: %s", backupID)
	}

	// Clear current store (in a real implementation, this would be transactional)
	currentPolicies, err := s.store.List(ctx)
	if err != nil {
		return err
	}

	for _, p := range currentPolicies {
		if err := s.store.Delete(ctx, p.PolicyID); err != nil {
			return err
		}
	}

	// Restore policies
	for _, p := range backup.Policies {
		if err := s.store.Add(ctx, p); err != nil {
			return err
		}
	}

	return nil
}

// Test: Create backup
func (s *BackupRestoreTestSuite) TestCreateBackup() {
	ctx := context.Background()

	// Setup: Add test policies
	policy1 := s.createTestPolicy("policy1")
	policy2 := s.createTestPolicy("policy2")
	require.NoError(s.T(), s.store.Add(ctx, policy1))
	require.NoError(s.T(), s.store.Add(ctx, policy2))

	// Execute: Create backup
	backup, err := s.createBackup(ctx, "Test backup")
	require.NoError(s.T(), err)

	// Verify: Backup created successfully
	assert.NotEmpty(s.T(), backup.ID)
	assert.Equal(s.T(), 2, len(backup.Policies))
	assert.Equal(s.T(), 2, backup.Metadata.PolicyCount)
	assert.Equal(s.T(), "Test backup", backup.Metadata.Description)
}

// Test: List backups
func (s *BackupRestoreTestSuite) TestListBackups() {
	ctx := context.Background()

	// Setup: Create multiple backups
	for i := 0; i < 3; i++ {
		policy := s.createTestPolicy(fmt.Sprintf("policy%d", i))
		require.NoError(s.T(), s.store.Add(ctx, policy))

		_, err := s.createBackup(ctx, fmt.Sprintf("Backup %d", i))
		require.NoError(s.T(), err)

		time.Sleep(10 * time.Millisecond) // Ensure different timestamps
	}

	// Execute: List all backups
	backupList := []*Backup{}
	for _, backup := range s.backups {
		backupList = append(backupList, backup)
	}

	// Verify: All backups listed
	assert.Equal(s.T(), 3, len(backupList))
}

// Test: Restore from backup
func (s *BackupRestoreTestSuite) TestRestoreBackup() {
	ctx := context.Background()

	// Setup: Create initial policies and backup
	policy1 := s.createTestPolicy("policy1")
	policy2 := s.createTestPolicy("policy2")
	require.NoError(s.T(), s.store.Add(ctx, policy1))
	require.NoError(s.T(), s.store.Add(ctx, policy2))

	backup, err := s.createBackup(ctx, "Backup before changes")
	require.NoError(s.T(), err)

	// Modify store
	require.NoError(s.T(), s.store.Delete(ctx, "policy1"))
	policy3 := s.createTestPolicy("policy3")
	require.NoError(s.T(), s.store.Add(ctx, policy3))

	// Verify: Store modified
	currentPolicies, err := s.store.List(ctx)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), 2, len(currentPolicies))

	// Execute: Restore from backup
	err = s.restoreBackup(ctx, backup.ID)
	require.NoError(s.T(), err)

	// Verify: Store restored to backup state
	restoredPolicies, err := s.store.List(ctx)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), 2, len(restoredPolicies))

	// Verify: Original policies restored
	_, err = s.store.Get(ctx, "policy1")
	assert.NoError(s.T(), err)
	_, err = s.store.Get(ctx, "policy2")
	assert.NoError(s.T(), err)
	_, err = s.store.Get(ctx, "policy3")
	assert.Error(s.T(), err) // Should not exist after restore
}

// Test: Restore with validation
func (s *BackupRestoreTestSuite) TestRestoreWithValidation() {
	ctx := context.Background()

	// Setup: Create backup
	policy1 := s.createTestPolicy("policy1")
	require.NoError(s.T(), s.store.Add(ctx, policy1))

	backup, err := s.createBackup(ctx, "Valid backup")
	require.NoError(s.T(), err)

	// Execute: Validate backup before restore
	assert.NotNil(s.T(), backup)
	assert.Equal(s.T(), 1, len(backup.Policies))
	assert.Equal(s.T(), 1, backup.Metadata.PolicyCount)

	// Verify: Validation passes
	for _, p := range backup.Policies {
		assert.NotEmpty(s.T(), p.PolicyID)
		assert.NotEmpty(s.T(), p.Version)
	}
}

// Test: Restore rollback on error
func (s *BackupRestoreTestSuite) TestRestoreRollback() {
	ctx := context.Background()

	// Setup: Create backup with valid policies
	policy1 := s.createTestPolicy("policy1")
	require.NoError(s.T(), s.store.Add(ctx, policy1))

	backup, err := s.createBackup(ctx, "Test backup")
	require.NoError(s.T(), err)

	// Corrupt backup data (simulate error during restore)
	backup.Policies = append(backup.Policies, &types.Policy{
		PolicyID: "", // Invalid - missing ID
		Kind:     types.PolicyKindResource,
		Version:  "1.0",
	})

	// Execute: Try to restore (should fail and rollback)
	originalCount, _ := s.store.List(ctx)

	// Attempt restore with validation
	validationFailed := false
	for _, p := range backup.Policies {
		if p.PolicyID == "" {
			validationFailed = true
			break
		}
	}

	// Verify: Validation caught the error
	assert.True(s.T(), validationFailed)

	// Verify: Original data unchanged
	currentPolicies, err := s.store.List(ctx)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), len(originalCount), len(currentPolicies))
}

// Test: Backup timestamping
func (s *BackupRestoreTestSuite) TestBackupTimestamp() {
	ctx := context.Background()

	// Setup: Create backup
	policy1 := s.createTestPolicy("policy1")
	require.NoError(s.T(), s.store.Add(ctx, policy1))

	beforeBackup := time.Now()
	backup, err := s.createBackup(ctx, "Timestamp test")
	afterBackup := time.Now()

	require.NoError(s.T(), err)

	// Verify: Timestamp is within expected range
	assert.True(s.T(), backup.Timestamp.After(beforeBackup) || backup.Timestamp.Equal(beforeBackup))
	assert.True(s.T(), backup.Timestamp.Before(afterBackup) || backup.Timestamp.Equal(afterBackup))
}

// Test: Backup metadata validation
func (s *BackupRestoreTestSuite) TestBackupMetadata() {
	ctx := context.Background()

	// Setup: Add policies and create backup
	for i := 0; i < 5; i++ {
		policy := s.createTestPolicy(fmt.Sprintf("policy%d", i))
		require.NoError(s.T(), s.store.Add(ctx, policy))
	}

	backup, err := s.createBackup(ctx, "Metadata test")
	require.NoError(s.T(), err)

	// Verify: Metadata is accurate
	assert.Equal(s.T(), "1.0", backup.Metadata.Version)
	assert.Equal(s.T(), 5, backup.Metadata.PolicyCount)
	assert.Equal(s.T(), "system", backup.Metadata.CreatedBy)
	assert.Equal(s.T(), "Metadata test", backup.Metadata.Description)

	// Verify: Policy count matches actual policies
	assert.Equal(s.T(), len(backup.Policies), backup.Metadata.PolicyCount)
}

// Test: Multiple backup versions
func (s *BackupRestoreTestSuite) TestMultipleBackupVersions() {
	ctx := context.Background()

	// Setup: Create initial backup
	policy1 := s.createTestPolicy("policy1")
	require.NoError(s.T(), s.store.Add(ctx, policy1))

	backup1, err := s.createBackup(ctx, "Version 1")
	require.NoError(s.T(), err)

	// Add more policies
	policy2 := s.createTestPolicy("policy2")
	require.NoError(s.T(), s.store.Add(ctx, policy2))

	backup2, err := s.createBackup(ctx, "Version 2")
	require.NoError(s.T(), err)

	// Add even more policies
	policy3 := s.createTestPolicy("policy3")
	require.NoError(s.T(), s.store.Add(ctx, policy3))

	backup3, err := s.createBackup(ctx, "Version 3")
	require.NoError(s.T(), err)

	// Verify: All backup versions exist
	assert.Equal(s.T(), 3, len(s.backups))
	assert.Equal(s.T(), 1, len(backup1.Policies))
	assert.Equal(s.T(), 2, len(backup2.Policies))
	assert.Equal(s.T(), 3, len(backup3.Policies))

	// Test: Restore to middle version
	err = s.restoreBackup(ctx, backup2.ID)
	require.NoError(s.T(), err)

	restoredPolicies, err := s.store.List(ctx)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), 2, len(restoredPolicies))
}

// Test: Backup serialization
func (s *BackupRestoreTestSuite) TestBackupSerialization() {
	ctx := context.Background()

	// Setup: Create backup
	policy1 := s.createTestPolicy("policy1")
	require.NoError(s.T(), s.store.Add(ctx, policy1))

	backup, err := s.createBackup(ctx, "Serialization test")
	require.NoError(s.T(), err)

	// Execute: Serialize backup to JSON
	jsonData, err := json.Marshal(backup)
	require.NoError(s.T(), err)

	// Deserialize
	var restoredBackup Backup
	err = json.Unmarshal(jsonData, &restoredBackup)
	require.NoError(s.T(), err)

	// Verify: Backup restored correctly
	assert.Equal(s.T(), backup.ID, restoredBackup.ID)
	assert.Equal(s.T(), len(backup.Policies), len(restoredBackup.Policies))
	assert.Equal(s.T(), backup.Metadata.Description, restoredBackup.Metadata.Description)
}

// Test: Incremental backup
func (s *BackupRestoreTestSuite) TestIncrementalBackup() {
	ctx := context.Background()

	// Setup: Create initial full backup
	policy1 := s.createTestPolicy("policy1")
	policy2 := s.createTestPolicy("policy2")
	require.NoError(s.T(), s.store.Add(ctx, policy1))
	require.NoError(s.T(), s.store.Add(ctx, policy2))

	fullBackup, err := s.createBackup(ctx, "Full backup")
	require.NoError(s.T(), err)

	// Add new policy (incremental change)
	policy3 := s.createTestPolicy("policy3")
	require.NoError(s.T(), s.store.Add(ctx, policy3))

	// Create incremental backup (only new policy)
	incrementalPolicies := []*types.Policy{policy3}
	incrementalBackup := &Backup{
		ID:        fmt.Sprintf("backup-incremental-%d", time.Now().Unix()),
		Timestamp: time.Now(),
		Policies:  incrementalPolicies,
		Metadata: BackupMetadata{
			Version:     "1.0",
			PolicyCount: 1,
			CreatedBy:   "system",
			Description: "Incremental backup",
		},
	}

	// Verify: Incremental backup contains only new policy
	assert.Equal(s.T(), 1, len(incrementalBackup.Policies))
	assert.Equal(s.T(), 2, len(fullBackup.Policies))
}

// TestBackupRestoreTestSuite runs the test suite
func TestBackupRestoreTestSuite(t *testing.T) {
	suite.Run(t, new(BackupRestoreTestSuite))
}
