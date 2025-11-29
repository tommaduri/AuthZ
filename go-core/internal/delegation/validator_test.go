// Package delegation_test provides tests for DelegationValidator (TDD - RED phase)
package delegation_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/authz-engine/go-core/internal/delegation"
	"github.com/authz-engine/go-core/pkg/types"
)

// TestDelegationValidator_ValidateChain tests chain validation logic
func TestDelegationValidator_ValidateChain(t *testing.T) {
	validator := delegation.NewValidator()

	tests := []struct {
		name    string
		chain   *types.DelegationChain
		wantErr bool
		errMsg  string
	}{
		{
			name: "valid chain",
			chain: &types.DelegationChain{
				SourceAgentID: "agent-alice",
				TargetAgentID: "agent-bob",
				Scopes:        []string{"read:documents"},
				MaxHops:       5,
				ExpiresAt:     time.Now().Add(1 * time.Hour),
				CreatedAt:     time.Now(),
			},
			wantErr: false,
		},
		{
			name: "expired chain",
			chain: &types.DelegationChain{
				SourceAgentID: "agent-alice",
				TargetAgentID: "agent-bob",
				Scopes:        []string{"read:documents"},
				MaxHops:       5,
				ExpiresAt:     time.Now().Add(-1 * time.Hour),
				CreatedAt:     time.Now(),
			},
			wantErr: true,
			errMsg:  "expired",
		},
		{
			name: "exceeds max hops",
			chain: &types.DelegationChain{
				SourceAgentID: "agent-alice",
				TargetAgentID: "agent-bob",
				Scopes:        []string{"read:documents"},
				MaxHops:       10,
				ExpiresAt:     time.Now().Add(1 * time.Hour),
				CreatedAt:     time.Now(),
			},
			wantErr: true,
			errMsg:  "exceeds limit",
		},
		{
			name: "empty scopes",
			chain: &types.DelegationChain{
				SourceAgentID: "agent-alice",
				TargetAgentID: "agent-bob",
				Scopes:        []string{},
				MaxHops:       5,
				ExpiresAt:     time.Now().Add(1 * time.Hour),
				CreatedAt:     time.Now(),
			},
			wantErr: true,
			errMsg:  "scope",
		},
		{
			name: "missing source agent",
			chain: &types.DelegationChain{
				SourceAgentID: "",
				TargetAgentID: "agent-bob",
				Scopes:        []string{"read:*"},
				MaxHops:       5,
				ExpiresAt:     time.Now().Add(1 * time.Hour),
				CreatedAt:     time.Now(),
			},
			wantErr: true,
			errMsg:  "source",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validator.ValidateChain(tt.chain)
			if tt.wantErr {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errMsg)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

// TestDelegationValidator_ValidateAgentStatus tests agent status validation
func TestDelegationValidator_ValidateAgentStatus(t *testing.T) {
	validator := delegation.NewValidator()

	tests := []struct {
		name    string
		agent   types.Agent
		wantErr bool
		errMsg  string
	}{
		{
			name: "active agent",
			agent: types.Agent{
				ID:          "agent-test",
				Type:        types.AgentTypeAI,
				DisplayName: "Test Agent",
				Status:      types.StatusActive,
			},
			wantErr: false,
		},
		{
			name: "suspended agent",
			agent: types.Agent{
				ID:          "agent-test",
				Type:        types.AgentTypeAI,
				DisplayName: "Test Agent",
				Status:      types.StatusSuspended,
			},
			wantErr: true,
			errMsg:  "not active",
		},
		{
			name: "revoked agent",
			agent: types.Agent{
				ID:          "agent-test",
				Type:        types.AgentTypeAI,
				DisplayName: "Test Agent",
				Status:      types.StatusRevoked,
			},
			wantErr: true,
			errMsg:  "not active",
		},
		{
			name: "expired agent",
			agent: types.Agent{
				ID:          "agent-test",
				Type:        types.AgentTypeAI,
				DisplayName: "Test Agent",
				Status:      types.StatusActive,
				ExpiresAt:   timePtr(time.Now().Add(-1 * time.Hour)),
			},
			wantErr: true,
			errMsg:  "expired",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validator.ValidateAgentStatus(&tt.agent)
			if tt.wantErr {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errMsg)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

// TestDelegationValidator_ValidateCredentials tests credential validation
func TestDelegationValidator_ValidateCredentials(t *testing.T) {
	validator := delegation.NewValidator()

	tests := []struct {
		name        string
		credentials []types.Credential
		wantErr     bool
	}{
		{
			name: "valid API key credential",
			credentials: []types.Credential{
				{
					ID:       "cred-1",
					Type:     "api-key",
					Value:    "hashed-key-123",
					IssuedAt: time.Now(),
				},
			},
			wantErr: false,
		},
		{
			name: "valid certificate credential",
			credentials: []types.Credential{
				{
					ID:       "cred-2",
					Type:     "certificate",
					Value:    "-----BEGIN CERTIFICATE-----",
					IssuedAt: time.Now(),
				},
			},
			wantErr: false,
		},
		{
			name:        "missing credentials",
			credentials: []types.Credential{},
			wantErr:     true,
		},
		{
			name: "invalid credential type",
			credentials: []types.Credential{
				{
					ID:       "cred-3",
					Type:     "unknown",
					Value:    "some-value",
					IssuedAt: time.Now(),
				},
			},
			wantErr: true,
		},
		{
			name: "all credentials expired",
			credentials: []types.Credential{
				{
					ID:        "cred-4",
					Type:      "api-key",
					Value:     "hashed-key-456",
					IssuedAt:  time.Now().Add(-2 * time.Hour),
					ExpiresAt: timePtr(time.Now().Add(-1 * time.Hour)),
				},
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			agent := types.Agent{
				ID:          "agent-test",
				Type:        types.AgentTypeAI,
				DisplayName: "Test Agent",
				Status:      types.StatusActive,
				Credentials: tt.credentials,
			}

			err := validator.ValidateCredentials(&agent)
			if tt.wantErr {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

// TestDelegationValidator_ValidateScopeMatch tests scope matching validation
func TestDelegationValidator_ValidateScopeMatch(t *testing.T) {
	validator := delegation.NewValidator()

	tests := []struct {
		name           string
		chainScopes    []string
		requestedScope string
		wantErr        bool
	}{
		{
			name:           "exact scope match",
			chainScopes:    []string{"read:documents", "write:documents"},
			requestedScope: "read:documents",
			wantErr:        false,
		},
		{
			name:           "wildcard scope match",
			chainScopes:    []string{"read:*"},
			requestedScope: "read:documents",
			wantErr:        false,
		},
		{
			name:           "full wildcard match",
			chainScopes:    []string{"*"},
			requestedScope: "anything:anywhere",
			wantErr:        false,
		},
		{
			name:           "no scope match",
			chainScopes:    []string{"read:documents"},
			requestedScope: "delete:documents",
			wantErr:        true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			chain := &types.DelegationChain{
				SourceAgentID: "agent-test",
				TargetAgentID: "agent-target",
				Scopes:        tt.chainScopes,
				MaxHops:       5,
				ExpiresAt:     time.Now().Add(1 * time.Hour),
				CreatedAt:     time.Now(),
			}

			err := validator.ValidateScopeMatch(chain, tt.requestedScope)
			if tt.wantErr {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

// TestDelegationValidator_ValidateDelegationRequest tests full request validation
func TestDelegationValidator_ValidateDelegationRequest(t *testing.T) {
	validator := delegation.NewValidator()

	validChain := &types.DelegationChain{
		SourceAgentID: "agent-alice",
		TargetAgentID: "agent-bob",
		Scopes:        []string{"read:documents"},
		MaxHops:       5,
		ExpiresAt:     time.Now().Add(1 * time.Hour),
		CreatedAt:     time.Now(),
	}

	tests := []struct {
		name    string
		request *types.DelegationRequest
		wantErr bool
		errMsg  string
	}{
		{
			name: "valid delegation request",
			request: &types.DelegationRequest{
				SourceAgent: types.Agent{
					ID:     "agent-alice",
					Type:   "ai-assistant",
					Status: "active",
					Credentials: map[string]interface{}{
						"type":   "api-key",
						"apiKey": "key-123",
					},
				},
				TargetAgent: types.Agent{
					ID:     "agent-bob",
					Type:   "automation-bot",
					Status: "active",
					Credentials: map[string]interface{}{
						"type":   "api-key",
						"apiKey": "key-456",
					},
				},
				Chain: validChain,
				Principal: types.Principal{
					ID:    "user-charlie",
					Roles: []string{"admin"},
				},
				Action: "read",
				Resource: types.Resource{
					Kind: "document",
					ID:   "doc-123",
				},
			},
			wantErr: false,
		},
		{
			name: "inactive source agent",
			request: &types.DelegationRequest{
				SourceAgent: types.Agent{
					ID:     "agent-alice",
					Status: "revoked",
				},
				TargetAgent: types.Agent{
					ID:     "agent-bob",
					Status: "active",
				},
				Chain:  validChain,
				Action: "read",
			},
			wantErr: true,
			errMsg:  "source agent",
		},
		{
			name: "scope mismatch",
			request: &types.DelegationRequest{
				SourceAgent: types.Agent{
					ID:     "agent-alice",
					Status: "active",
					Credentials: map[string]interface{}{
						"type":   "api-key",
						"apiKey": "key-123",
					},
				},
				TargetAgent: types.Agent{
					ID:     "agent-bob",
					Status: "active",
					Credentials: map[string]interface{}{
						"type":   "api-key",
						"apiKey": "key-456",
					},
				},
				Chain: &types.DelegationChain{
					SourceAgentID: "agent-alice",
					TargetAgentID: "agent-bob",
					Scopes:        []string{"write:documents"}, // Only write, not read
					MaxHops:       5,
					ExpiresAt:     time.Now().Add(1 * time.Hour),
					CreatedAt:     time.Now(),
				},
				Action: "read", // Requesting read, but chain only allows write
				Resource: types.Resource{
					Kind: "document",
					ID:   "doc-123",
				},
			},
			wantErr: true,
			errMsg:  "scope",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validator.ValidateDelegationRequest(tt.request)
			if tt.wantErr {
				require.Error(t, err)
				if tt.errMsg != "" {
					assert.Contains(t, err.Error(), tt.errMsg)
				}
			} else {
				require.NoError(t, err)
			}
		})
	}
}

// TestDelegationValidator_CheckChainLength tests delegation chain length validation
func TestDelegationValidator_CheckChainLength(t *testing.T) {
	validator := delegation.NewValidator()

	tests := []struct {
		name        string
		chainLength int
		maxHops     int
		wantErr     bool
	}{
		{
			name:        "within limit - 1 hop",
			chainLength: 1,
			maxHops:     5,
			wantErr:     false,
		},
		{
			name:        "within limit - 5 hops",
			chainLength: 5,
			maxHops:     5,
			wantErr:     false,
		},
		{
			name:        "exceeds limit - 6 hops",
			chainLength: 6,
			maxHops:     5,
			wantErr:     true,
		},
		{
			name:        "custom max hops - within limit",
			chainLength: 3,
			maxHops:     3,
			wantErr:     false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validator.CheckChainLength(tt.chainLength, tt.maxHops)
			if tt.wantErr {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

// Helper function to create time pointer
func timePtr(t time.Time) *time.Time {
	return &t
}
