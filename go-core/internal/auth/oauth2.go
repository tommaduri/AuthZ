package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

const (
	// BcryptCost is the cost factor for bcrypt hashing (RFC 6749 recommends strong hashing)
	BcryptCost = 12

	// GrantTypeClientCredentials is the OAuth2 client credentials grant type
	GrantTypeClientCredentials = "client_credentials"

	// DefaultTokenExpiration is the default access token expiration (1 hour)
	DefaultTokenExpiration = time.Hour
)

var (
	// ErrInvalidGrantType is returned when the grant type is not supported
	ErrInvalidGrantType = errors.New("invalid grant_type: only 'client_credentials' is supported")

	// ErrInvalidClientCredentials is returned when client credentials are invalid
	ErrInvalidClientCredentials = errors.New("invalid client credentials")

	// ErrInvalidScope is returned when requested scope is not allowed
	ErrInvalidScope = errors.New("requested scope is not allowed for this client")

	// ErrMissingClientID is returned when client_id is missing
	ErrMissingClientID = errors.New("client_id is required")

	// ErrMissingClientSecret is returned when client_secret is missing
	ErrMissingClientSecret = errors.New("client_secret is required")
)

// OAuth2Handler handles OAuth2 client credentials flow (RFC 6749 Section 4.4)
type OAuth2Handler struct {
	store       OAuth2ClientStore
	jwtIssuer   *JWTIssuer
	tokenExpiry time.Duration
}

// NewOAuth2Handler creates a new OAuth2 handler
func NewOAuth2Handler(store OAuth2ClientStore, jwtIssuer *JWTIssuer) *OAuth2Handler {
	return &OAuth2Handler{
		store:       store,
		jwtIssuer:   jwtIssuer,
		tokenExpiry: DefaultTokenExpiration,
	}
}

// SetTokenExpiry sets a custom token expiration duration
func (h *OAuth2Handler) SetTokenExpiry(expiry time.Duration) {
	h.tokenExpiry = expiry
}

// TokenRequest represents an OAuth2 token request
type TokenRequest struct {
	GrantType    string `json:"grant_type"`
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
	Scope        string `json:"scope,omitempty"`
}

// TokenResponse represents an OAuth2 token response (RFC 6749 Section 5.1)
type TokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int64  `json:"expires_in"`
	Scope       string `json:"scope,omitempty"`
}

// ErrorResponse represents an OAuth2 error response (RFC 6749 Section 5.2)
type ErrorResponse struct {
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description,omitempty"`
}

// IssueToken handles the OAuth2 client credentials token request
func (h *OAuth2Handler) IssueToken(ctx context.Context, req *TokenRequest) (*TokenResponse, error) {
	// Validate grant type (RFC 6749 Section 4.4.2)
	if req.GrantType != GrantTypeClientCredentials {
		return nil, ErrInvalidGrantType
	}

	// Validate required fields
	if req.ClientID == "" {
		return nil, ErrMissingClientID
	}
	if req.ClientSecret == "" {
		return nil, ErrMissingClientSecret
	}

	// Parse client_id as UUID
	clientID, err := uuid.Parse(req.ClientID)
	if err != nil {
		return nil, fmt.Errorf("invalid client_id format: %w", err)
	}

	// Retrieve client from store
	client, err := h.store.GetClient(ctx, clientID)
	if err != nil {
		if errors.Is(err, ErrClientNotFound) ||
		   errors.Is(err, ErrClientRevoked) ||
		   errors.Is(err, ErrClientExpired) {
			return nil, ErrInvalidClientCredentials
		}
		return nil, fmt.Errorf("failed to retrieve client: %w", err)
	}

	// Verify client secret using constant-time comparison via bcrypt
	err = bcrypt.CompareHashAndPassword([]byte(client.ClientSecretHash), []byte(req.ClientSecret))
	if err != nil {
		return nil, ErrInvalidClientCredentials
	}

	// Parse and validate requested scopes
	requestedScopes := parseScopes(req.Scope)
	if len(requestedScopes) > 0 {
		for _, scope := range requestedScopes {
			if !client.HasScope(scope) {
				return nil, ErrInvalidScope
			}
		}
	} else {
		// If no scope requested, use all client scopes
		requestedScopes = client.Scopes
	}

	// Issue JWT access token
	now := time.Now()
	expiresAt := now.Add(h.tokenExpiry)

	token, err := h.jwtIssuer.IssueToken(&TokenClaims{
		Subject:   client.ClientID.String(),
		TenantID:  client.TenantID,
		Scopes:    requestedScopes,
		IssuedAt:  now,
		ExpiresAt: expiresAt,
		TokenType: "access_token",
		Extra: map[string]interface{}{
			"client_name": client.Name,
			"grant_type":  GrantTypeClientCredentials,
		},
	})

	if err != nil {
		return nil, fmt.Errorf("failed to issue token: %w", err)
	}

	// Return OAuth2-compliant response (RFC 6749 Section 5.1)
	return &TokenResponse{
		AccessToken: token,
		TokenType:   "Bearer",
		ExpiresIn:   int64(h.tokenExpiry.Seconds()),
		Scope:       strings.Join(requestedScopes, " "),
	}, nil
}

// CreateClient creates a new OAuth2 client with a hashed secret
func (h *OAuth2Handler) CreateClient(ctx context.Context, name, tenantID string, scopes []string, secret string, expiresAt *time.Time) (*OAuth2Client, error) {
	// Generate new client ID
	clientID := uuid.New()

	// Hash the client secret using bcrypt
	secretHash, err := bcrypt.GenerateFromPassword([]byte(secret), BcryptCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash client secret: %w", err)
	}

	client := &OAuth2Client{
		ClientID:         clientID,
		ClientSecretHash: string(secretHash),
		Name:             name,
		TenantID:         tenantID,
		Scopes:           scopes,
		CreatedAt:        time.Now(),
		ExpiresAt:        expiresAt,
	}

	if err := h.store.CreateClient(ctx, client); err != nil {
		return nil, err
	}

	return client, nil
}

// RevokeClient revokes an OAuth2 client
func (h *OAuth2Handler) RevokeClient(ctx context.Context, clientID uuid.UUID) error {
	return h.store.RevokeClient(ctx, clientID)
}

// parseScopes parses a space-delimited scope string into a slice
func parseScopes(scope string) []string {
	if scope == "" {
		return []string{}
	}

	scopes := strings.Split(scope, " ")
	result := make([]string, 0, len(scopes))

	for _, s := range scopes {
		s = strings.TrimSpace(s)
		if s != "" {
			result = append(result, s)
		}
	}

	return result
}
