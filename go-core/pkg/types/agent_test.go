package types

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAgent_ValidTypes tests that valid agent types are accepted
func TestAgent_ValidTypes(t *testing.T) {
	validTypes := []string{"service", "human", "ai-agent", "mcp-agent"}

	for _, agentType := range validTypes {
		t.Run("type_"+agentType, func(t *testing.T) {
			agent := &Agent{
				ID:          "test-agent-" + agentType,
				Type:        agentType,
				DisplayName: "Test Agent",
				Status:      StatusActive,
				Credentials: []Credential{},
				Metadata:    make(map[string]interface{}),
				CreatedAt:   time.Now(),
				UpdatedAt:   time.Now(),
			}

			assert.Equal(t, agentType, agent.Type)
		})
	}
}

// TestAgent_ValidStatuses tests that valid agent statuses are accepted
func TestAgent_ValidStatuses(t *testing.T) {
	validStatuses := []string{StatusActive, StatusSuspended, StatusRevoked, StatusExpired}

	for _, status := range validStatuses {
		t.Run("status_"+status, func(t *testing.T) {
			agent := &Agent{
				ID:          "test-agent",
				Type:        "service",
				DisplayName: "Test Agent",
				Status:      status,
				Credentials: []Credential{},
				Metadata:    make(map[string]interface{}),
				CreatedAt:   time.Now(),
				UpdatedAt:   time.Now(),
			}

			assert.Equal(t, status, agent.Status)
		})
	}
}

// TestAgent_IsActive tests the IsActive method
func TestAgent_IsActive(t *testing.T) {
	tests := []struct {
		name     string
		status   string
		expected bool
	}{
		{"active agent", StatusActive, true},
		{"suspended agent", StatusSuspended, false},
		{"revoked agent", StatusRevoked, false},
		{"expired agent", StatusExpired, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			agent := &Agent{
				ID:          "test-agent",
				Type:        "service",
				DisplayName: "Test Agent",
				Status:      tt.status,
				Credentials: []Credential{},
				Metadata:    make(map[string]interface{}),
				CreatedAt:   time.Now(),
				UpdatedAt:   time.Now(),
			}

			assert.Equal(t, tt.expected, agent.IsActive())
		})
	}
}

// TestAgent_IsExpired tests the IsExpired method
func TestAgent_IsExpired(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name      string
		expiresAt *time.Time
		expected  bool
	}{
		{
			name:      "no expiration",
			expiresAt: nil,
			expected:  false,
		},
		{
			name: "expired agent",
			expiresAt: func() *time.Time {
				t := now.Add(-1 * time.Hour)
				return &t
			}(),
			expected: true,
		},
		{
			name: "not yet expired",
			expiresAt: func() *time.Time {
				t := now.Add(1 * time.Hour)
				return &t
			}(),
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			agent := &Agent{
				ID:          "test-agent",
				Type:        "service",
				DisplayName: "Test Agent",
				Status:      StatusActive,
				Credentials: []Credential{},
				Metadata:    make(map[string]interface{}),
				CreatedAt:   now,
				UpdatedAt:   now,
				ExpiresAt:   tt.expiresAt,
			}

			assert.Equal(t, tt.expected, agent.IsExpired())
		})
	}
}

// TestAgent_HasValidCredential tests credential validation
func TestAgent_HasValidCredential(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name        string
		credentials []Credential
		expected    bool
	}{
		{
			name:        "no credentials",
			credentials: []Credential{},
			expected:    false,
		},
		{
			name: "valid credential",
			credentials: []Credential{
				{
					ID:        "cred-1",
					Type:      "api-key",
					Value:     "hashed-api-key",
					IssuedAt:  now.Add(-1 * time.Hour),
					ExpiresAt: nil,
				},
			},
			expected: true,
		},
		{
			name: "expired credential",
			credentials: []Credential{
				{
					ID:       "cred-1",
					Type:     "api-key",
					Value:    "hashed-api-key",
					IssuedAt: now.Add(-2 * time.Hour),
					ExpiresAt: func() *time.Time {
						t := now.Add(-1 * time.Hour)
						return &t
					}(),
				},
			},
			expected: false,
		},
		{
			name: "mixed credentials - one valid",
			credentials: []Credential{
				{
					ID:       "cred-expired",
					Type:     "api-key",
					Value:    "expired-key",
					IssuedAt: now.Add(-2 * time.Hour),
					ExpiresAt: func() *time.Time {
						t := now.Add(-1 * time.Hour)
						return &t
					}(),
				},
				{
					ID:        "cred-valid",
					Type:      "oauth-token",
					Value:     "valid-token",
					IssuedAt:  now.Add(-30 * time.Minute),
					ExpiresAt: nil,
				},
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			agent := &Agent{
				ID:          "test-agent",
				Type:        "service",
				DisplayName: "Test Agent",
				Status:      StatusActive,
				Credentials: tt.credentials,
				Metadata:    make(map[string]interface{}),
				CreatedAt:   now,
				UpdatedAt:   now,
			}

			assert.Equal(t, tt.expected, agent.HasValidCredential())
		})
	}
}

// TestAgent_ToPrincipal tests conversion to Principal for authorization
func TestAgent_ToPrincipal(t *testing.T) {
	now := time.Now()
	agent := &Agent{
		ID:          "agent-123",
		Type:        "service",
		DisplayName: "Payment Service",
		Status:      StatusActive,
		Credentials: []Credential{},
		Metadata: map[string]interface{}{
			"service_name": "payment-api",
			"version":      "v1.0.0",
		},
		CreatedAt: now,
		UpdatedAt: now,
	}

	principal := agent.ToPrincipal()

	require.NotNil(t, principal)
	assert.Equal(t, "agent-123", principal.ID)
	assert.Contains(t, principal.Roles, "agent:service")
	assert.Equal(t, agent.Metadata, principal.Attributes)
}

// TestAgent_ToPrincipal_WithCustomRoles tests Principal conversion with custom roles
func TestAgent_ToPrincipal_WithCustomRoles(t *testing.T) {
	now := time.Now()
	agent := &Agent{
		ID:          "agent-456",
		Type:        "ai-agent",
		DisplayName: "GitHub Assistant",
		Status:      StatusActive,
		Credentials: []Credential{},
		Metadata: map[string]interface{}{
			"roles": []string{"github-reader", "issue-manager"},
		},
		CreatedAt: now,
		UpdatedAt: now,
	}

	principal := agent.ToPrincipal()

	require.NotNil(t, principal)
	assert.Equal(t, "agent-456", principal.ID)
	assert.Contains(t, principal.Roles, "agent:ai-agent")
	// Custom roles from metadata should also be included
	assert.Contains(t, principal.Roles, "github-reader")
	assert.Contains(t, principal.Roles, "issue-manager")
}

// TestCredential_IsExpired tests credential expiration check
func TestCredential_IsExpired(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name      string
		expiresAt *time.Time
		expected  bool
	}{
		{
			name:      "no expiration",
			expiresAt: nil,
			expected:  false,
		},
		{
			name: "expired credential",
			expiresAt: func() *time.Time {
				t := now.Add(-1 * time.Hour)
				return &t
			}(),
			expected: true,
		},
		{
			name: "not yet expired",
			expiresAt: func() *time.Time {
				t := now.Add(1 * time.Hour)
				return &t
			}(),
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cred := &Credential{
				ID:        "cred-1",
				Type:      "api-key",
				Value:     "hashed-value",
				IssuedAt:  now.Add(-1 * time.Hour),
				ExpiresAt: tt.expiresAt,
			}

			assert.Equal(t, tt.expected, cred.IsExpired())
		})
	}
}

// TestAgent_Validate tests agent validation
func TestAgent_Validate(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name        string
		agent       *Agent
		expectError bool
		errorMsg    string
	}{
		{
			name: "valid agent",
			agent: &Agent{
				ID:          "valid-agent",
				Type:        "service",
				DisplayName: "Valid Service",
				Status:      StatusActive,
				Credentials: []Credential{},
				Metadata:    make(map[string]interface{}),
				CreatedAt:   now,
				UpdatedAt:   now,
			},
			expectError: false,
		},
		{
			name: "missing ID",
			agent: &Agent{
				Type:        "service",
				DisplayName: "No ID Agent",
				Status:      StatusActive,
				Credentials: []Credential{},
				Metadata:    make(map[string]interface{}),
				CreatedAt:   now,
				UpdatedAt:   now,
			},
			expectError: true,
			errorMsg:    "agent ID is required",
		},
		{
			name: "invalid type",
			agent: &Agent{
				ID:          "test-agent",
				Type:        "invalid-type",
				DisplayName: "Invalid Type Agent",
				Status:      StatusActive,
				Credentials: []Credential{},
				Metadata:    make(map[string]interface{}),
				CreatedAt:   now,
				UpdatedAt:   now,
			},
			expectError: true,
			errorMsg:    "invalid agent type",
		},
		{
			name: "invalid status",
			agent: &Agent{
				ID:          "test-agent",
				Type:        "service",
				DisplayName: "Invalid Status Agent",
				Status:      "invalid-status",
				Credentials: []Credential{},
				Metadata:    make(map[string]interface{}),
				CreatedAt:   now,
				UpdatedAt:   now,
			},
			expectError: true,
			errorMsg:    "invalid agent status",
		},
		{
			name: "missing display name",
			agent: &Agent{
				ID:          "test-agent",
				Type:        "service",
				DisplayName: "",
				Status:      StatusActive,
				Credentials: []Credential{},
				Metadata:    make(map[string]interface{}),
				CreatedAt:   now,
				UpdatedAt:   now,
			},
			expectError: true,
			errorMsg:    "agent display name is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.agent.Validate()

			if tt.expectError {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errorMsg)
			} else {
				require.NoError(t, err)
			}
		})
	}
}
