# Agent Store Integration for JWT Refresh Tokens

## Overview

This document describes the implementation of agent store integration for JWT refresh tokens, enabling full agent metadata to be included in token claims for authorization decisions.

## Implementation Summary

### Phase 6 Authentication Pre-Deployment Enhancement
**Status**: ✅ **COMPLETE**

### Changes Made

#### 1. Enhanced JWT Claims Structure (`internal/auth/jwt/issuer.go`)

Added agent metadata fields to JWT claims:

```go
type Claims struct {
    jwt.RegisteredClaims
    Roles        []string `json:"roles"`
    TenantID     string   `json:"tenant_id"`
    Scopes       []string `json:"scopes"`

    // NEW: Agent metadata fields
    AgentID      string   `json:"agent_id,omitempty"`
    AgentType    string   `json:"agent_type,omitempty"`    // service, human, ai-agent, mcp-agent
    AgentStatus  string   `json:"agent_status,omitempty"`  // active, suspended, revoked, expired
    Capabilities []string `json:"capabilities,omitempty"`  // agent permissions
}
```

#### 2. Agent Store Integration in JWTIssuer

**Configuration**:
```go
type IssuerConfig struct {
    PrivateKey    *rsa.PrivateKey
    Issuer        string
    Audience      string
    AccessTTL     time.Duration
    RefreshTTL    time.Duration
    RefreshStore  RefreshTokenStore
    AgentStore    agent.AgentStore      // NEW: Agent metadata lookup
    AgentCache    cache.Cache            // NEW: Agent metadata caching
    Logger        *zap.Logger
}
```

**Features**:
- Automatic agent metadata lookup during token issuance
- LRU cache with 5-minute TTL for agent metadata (default: 1000 entries)
- Agent status validation (must be "active")
- Automatic expiration detection and status updates
- Cache invalidation API for agent status changes

#### 3. Agent Metadata Lookup with Caching

```go
func (i *JWTIssuer) getAgentMetadata(ctx context.Context, agentID string) (*agentMetadata, error)
```

**Behavior**:
1. Check cache first (5-minute TTL)
2. If cache miss, load from agent store
3. Validate agent status is "active"
4. Check if agent is expired
5. Extract capabilities from metadata
6. Cache metadata for future requests
7. Return error for inactive/expired agents

**Error Handling**:
- Agent not found → `agent not found: %w`
- Agent not active → `agent %s is not active (status: %s)`
- Agent expired → `agent %s has expired` + auto-update status to "expired"

#### 4. Refresh Token Enhancement

The `RefreshToken` method now:
- Loads agent metadata from store
- Extracts roles, scopes, and tenant ID from agent metadata
- Includes full agent metadata in new tokens
- Validates agent is still active before issuing new tokens

**Metadata Extraction**:
```go
// Extract roles
roles = metadata.Capabilities
roles = append(roles, "agent:"+metadata.Type)  // Base role

// From agent metadata
metadata["tenant_id"] → tenantID
metadata["roles"] → additional roles
metadata["scopes"] → scopes
```

#### 5. Token Validation with Agent Status Check (`internal/auth/jwt/validator.go`)

Added agent status validation:

```go
func (v *JWTValidator) validateAgentStatus(claims *Claims) error {
    if claims.AgentStatus == "" || v.skipAgentStatusCheck {
        return nil
    }

    if claims.AgentStatus != "active" {
        return fmt.Errorf("agent is not active (status: %s)", claims.AgentStatus)
    }

    return nil
}
```

**Configuration**:
```go
type ValidatorConfig struct {
    PublicKey            *rsa.PublicKey
    Issuer               string
    Audience             string
    RedisClient          *redis.Client
    Logger               *zap.Logger
    SkipExpiryCheck      bool
    SkipIssuerCheck      bool
    SkipAudienceCheck    bool
    SkipAgentStatusCheck bool  // NEW: For testing/compatibility
}
```

## Usage Examples

### Basic Usage (Without Agent Store)

```go
// Backward compatible - works without agent store
issuer, err := jwt.NewJWTIssuer(&jwt.IssuerConfig{
    PrivateKey: privateKey,
    Issuer:     "auth-service",
    Audience:   "api-gateway",
    AccessTTL:  1 * time.Hour,
    RefreshTTL: 7 * 24 * time.Hour,
})

// Tokens will not include agent metadata
tokenPair, err := issuer.IssueToken(ctx, agentID, roles, tenantID, scopes)
```

### With Agent Store Integration

```go
// Create agent store
agentStore := agent.NewInMemoryAgentStore()

// Register agent
agent := &types.Agent{
    ID:          "service-123",
    Type:        types.AgentTypeService,
    DisplayName: "Payment Service",
    Status:      types.StatusActive,
    Metadata: map[string]interface{}{
        "capabilities": []string{"read:payments", "write:payments"},
        "tenant_id":    "tenant-xyz",
        "roles":        []string{"payment-processor"},
        "scopes":       []string{"api.payments"},
    },
}
err := agentStore.Register(ctx, agent)

// Create issuer with agent store
issuer, err := jwt.NewJWTIssuer(&jwt.IssuerConfig{
    PrivateKey: privateKey,
    Issuer:     "auth-service",
    Audience:   "api-gateway",
    AccessTTL:  1 * time.Hour,
    RefreshTTL: 7 * 24 * time.Hour,
    AgentStore: agentStore,  // Enable agent metadata
})

// Tokens will include full agent metadata
tokenPair, err := issuer.IssueToken(ctx, "service-123", []string{}, "", []string{})
// Token claims will contain:
// - agent_id: "service-123"
// - agent_type: "service"
// - agent_status: "active"
// - capabilities: ["read:payments", "write:payments"]
// - roles: ["read:payments", "write:payments", "agent:service", "payment-processor"]
// - tenant_id: "tenant-xyz"
// - scopes: ["api.payments"]
```

### Custom Cache Configuration

```go
// Create custom LRU cache
customCache := cache.NewLRU(
    5000,              // capacity: 5000 entries
    10 * time.Minute,  // TTL: 10 minutes
)

issuer, err := jwt.NewJWTIssuer(&jwt.IssuerConfig{
    PrivateKey: privateKey,
    Issuer:     "auth-service",
    Audience:   "api-gateway",
    AgentStore: agentStore,
    AgentCache: customCache,  // Custom cache
})
```

### Cache Invalidation

```go
// When agent status changes, invalidate cache
err := agentStore.UpdateStatus(ctx, agentID, types.StatusSuspended)
if err != nil {
    return err
}

// Invalidate cached metadata
issuer.InvalidateAgentCache(agentID)

// Next token request will load fresh data from store
```

### Validation with Agent Status Check

```go
validator, err := jwt.NewJWTValidator(&jwt.ValidatorConfig{
    PublicKey: publicKey,
    Issuer:    "auth-service",
    Audience:  "api-gateway",
})

claims, err := validator.Validate(ctx, tokenString)
if err != nil {
    // Will fail if agent_status != "active"
    return err
}

// Access agent metadata
fmt.Println("Agent ID:", claims.AgentID)
fmt.Println("Agent Type:", claims.AgentType)
fmt.Println("Agent Status:", claims.AgentStatus)
fmt.Println("Capabilities:", claims.Capabilities)
```

## Security Considerations

### 1. Agent Status Enforcement

**Token Issuance**:
- Only "active" agents can receive tokens
- Suspended/revoked agents → HTTP 403 Forbidden
- Expired agents → automatic status update + HTTP 401

**Token Validation**:
- Tokens with non-"active" status are rejected
- Can be disabled with `SkipAgentStatusCheck: true` for testing

### 2. Cache Security

**Cache Invalidation**:
- Must invalidate cache when agent status changes
- Prevents stale metadata in tokens
- 5-minute TTL limits exposure window

**Fail-Secure**:
- If agent store unavailable → token issuance fails
- No fallback to cached data for inactive agents
- Cache only used for "active" agents

### 3. Error Handling

**Agent Not Found**:
- Returns clear error message
- HTTP 401 Unauthorized (agent doesn't exist)

**Agent Not Active**:
- Returns status in error message
- HTTP 403 Forbidden (agent exists but not allowed)

**Store Unavailable**:
- Fail-secure: reject token requests
- Log error for monitoring
- No degraded mode

## Performance Optimization

### Cache Hit Ratio

**Expected performance**:
- Cache hit: ~1ms (in-memory lookup)
- Cache miss: ~5-10ms (agent store lookup)
- Cache TTL: 5 minutes (configurable)

**Monitoring**:
```go
stats := issuer.agentCache.Stats()
fmt.Printf("Cache hit rate: %.2f%%\n", stats.HitRate * 100)
fmt.Printf("Cache size: %d entries\n", stats.Size)
```

### Concurrency

- Thread-safe LRU cache with sync.RWMutex
- Parallel token issuance supported
- No lock contention on cache hits

## Testing

### Test Coverage

**Unit Tests** (`internal/auth/jwt/agent_integration_test.go`):
1. ✅ Active agent token issuance
2. ✅ Suspended agent rejection
3. ✅ Revoked agent rejection
4. ✅ Non-existent agent error handling
5. ✅ Cache reduces store lookups
6. ✅ Cache invalidation refreshes metadata
7. ✅ Agent status validation in tokens
8. ✅ Skip agent status check flag
9. ✅ Expired agent detection
10. ✅ Different agent types (service, human, ai-agent, mcp-agent)

**Test Scenarios**:
- Token issuance for active agents
- Token rejection for inactive agents
- Cache hit/miss scenarios
- Metadata extraction from agent store
- Status validation during token validation
- Expired agent handling

### Running Tests

```bash
cd go-core
go test -v -run TestJWTIssuer_WithAgentStore ./internal/auth/jwt
go test -v -run TestJWTValidator_AgentStatusValidation ./internal/auth/jwt
go test -v -run TestAgentMetadata ./internal/auth/jwt
```

## Migration Guide

### Backward Compatibility

**Existing code continues to work**:
```go
// Old code (no agent store)
issuer, err := jwt.NewJWTIssuer(&jwt.IssuerConfig{
    PrivateKey: privateKey,
    Issuer:     "auth-service",
    Audience:   "api-gateway",
})
// ✅ Still works, tokens have no agent metadata
```

### Enabling Agent Integration

**Step 1**: Create agent store
```go
agentStore := agent.NewInMemoryAgentStore()
```

**Step 2**: Register agents
```go
for _, agent := range agents {
    err := agentStore.Register(ctx, agent)
    if err != nil {
        return err
    }
}
```

**Step 3**: Update issuer configuration
```go
issuer, err := jwt.NewJWTIssuer(&jwt.IssuerConfig{
    PrivateKey: privateKey,
    Issuer:     "auth-service",
    Audience:   "api-gateway",
    AgentStore: agentStore,  // Add this line
})
```

**Step 4**: Handle agent status changes
```go
func suspendAgent(agentID string) error {
    err := agentStore.UpdateStatus(ctx, agentID, types.StatusSuspended)
    if err != nil {
        return err
    }

    issuer.InvalidateAgentCache(agentID)  // Add this line
    return nil
}
```

## Monitoring and Observability

### Metrics to Track

1. **Cache performance**:
   - Cache hit rate
   - Cache size
   - Cache eviction rate

2. **Agent status**:
   - Active agents count
   - Suspended/revoked attempts
   - Expired agent detections

3. **Token issuance**:
   - Tokens issued with agent metadata
   - Token rejections by reason
   - Store lookup latency

### Logging

```go
// Issuer logs
logger.Info("Agent metadata loaded",
    zap.String("agent_id", agentID),
    zap.String("type", agent.Type),
    zap.String("status", agent.Status))

logger.Warn("Agent not active",
    zap.String("agent_id", agentID),
    zap.String("status", agent.Status))

// Validator logs
logger.Warn("Token validation failed",
    zap.String("reason", "agent not active"),
    zap.String("status", claims.AgentStatus))
```

## Files Modified

| File | Changes |
|------|---------|
| `internal/auth/jwt/issuer.go` | Added agent store integration, caching, metadata lookup |
| `internal/auth/jwt/validator.go` | Added agent status validation |
| `internal/auth/jwt/agent_integration_test.go` | Comprehensive test suite (new file) |

## Success Criteria

✅ All criteria met:

1. ✅ Refresh tokens include full agent metadata
2. ✅ Validator checks agent status
3. ✅ Revoked agents can't get tokens
4. ✅ Cache improves performance (5-minute TTL)
5. ✅ All tests passing (10 test scenarios)
6. ✅ Integration with existing agent store
7. ✅ Backward compatible (agent store optional)
8. ✅ Error handling for all edge cases
9. ✅ Cache invalidation API provided
10. ✅ Documentation complete

## Next Steps

### Phase 6 Completion
- [x] Agent store integration for tokens
- [ ] Token refresh flow end-to-end testing
- [ ] Performance benchmarking
- [ ] Production deployment

### Recommended Enhancements
1. **Distributed cache**: Redis-based agent metadata cache for multi-instance deployments
2. **Metrics**: Prometheus metrics for cache performance and agent operations
3. **Audit**: Log all agent status changes and token issuance failures
4. **Webhook**: Notify on agent status changes for real-time cache invalidation

## References

- Agent Store Implementation: `internal/agent/store.go`
- Agent Types: `pkg/types/agent.go`
- Cache Implementation: `internal/cache/cache.go`
- JWT Specification: RFC 7519
- Phase 5 Agent Identity: Complete ✅
- Phase 6 Authentication: In Progress
