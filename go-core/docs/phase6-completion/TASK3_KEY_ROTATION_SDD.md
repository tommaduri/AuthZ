# Technical Specification: Zero-Downtime Key Rotation (FR-8, P1)

## 1. Overview

### 1.1 Purpose
Implement zero-downtime cryptographic key rotation for JWT signing keys with JWKS endpoint, blue-green deployment strategy, and automatic key lifecycle management.

### 1.2 Scope
- JWKS (JSON Web Key Set) `key_id` rotation strategy
- Multiple active signing keys support (current + previous)
- Blue-green key deployment process
- Automatic key expiration and cleanup
- Backward-compatible JWT validation
- Key rotation orchestration service

### 1.3 Success Criteria
- ✅ Zero downtime during key rotation
- ✅ No token validation failures during rotation
- ✅ Automatic key lifecycle management
- ✅ Sub-100ms JWKS endpoint response (p99)
- ✅ Support for 2+ concurrent active keys

---

## 2. Database Schema

### 2.1 Signing Keys Table

```sql
-- Migration: 005_create_signing_keys.up.sql
CREATE TABLE IF NOT EXISTS signing_keys (
    -- Primary Key
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Key Identification
    key_id VARCHAR(255) NOT NULL UNIQUE, -- JWK kid (e.g., "key-2025-01-27-001")

    -- Key Material
    private_key_encrypted BYTEA NOT NULL, -- Encrypted PEM-encoded private key
    public_key_pem TEXT NOT NULL,         -- PEM-encoded public key
    public_key_jwk JSONB NOT NULL,        -- JWK format for JWKS endpoint

    -- Key Metadata
    algorithm VARCHAR(50) NOT NULL DEFAULT 'RS256',
    key_size INTEGER NOT NULL DEFAULT 2048,
    key_type VARCHAR(50) NOT NULL DEFAULT 'RSA',

    -- Lifecycle State
    state VARCHAR(50) NOT NULL DEFAULT 'pending',
    -- States: pending -> active_signing -> active_verification_only -> expired -> deleted

    -- Activation Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMP WITH TIME ZONE,
    signing_stopped_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,

    -- Rotation Metadata
    rotation_id UUID,                     -- Links keys in same rotation
    previous_key_id VARCHAR(255),         -- Reference to previous key
    next_key_id VARCHAR(255),             -- Reference to next key

    -- Usage Tracking
    tokens_signed_count BIGINT NOT NULL DEFAULT 0,
    last_used_for_signing TIMESTAMP WITH TIME ZONE,

    -- Security
    encryption_version INTEGER NOT NULL DEFAULT 1,
    checksum VARCHAR(64) NOT NULL,        -- SHA-256 checksum for integrity

    -- Constraints
    CONSTRAINT chk_state CHECK (state IN (
        'pending', 'active_signing', 'active_verification_only', 'expired', 'deleted'
    )),
    CONSTRAINT chk_algorithm CHECK (algorithm IN ('RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512')),
    CONSTRAINT chk_key_type CHECK (key_type IN ('RSA', 'EC')),
    CONSTRAINT chk_key_size CHECK (
        (key_type = 'RSA' AND key_size IN (2048, 4096)) OR
        (key_type = 'EC' AND key_size IN (256, 384, 521))
    )
);

-- Indexes for performance
CREATE INDEX idx_signing_keys_key_id ON signing_keys(key_id);
CREATE INDEX idx_signing_keys_state ON signing_keys(state) WHERE state IN ('active_signing', 'active_verification_only');
CREATE INDEX idx_signing_keys_rotation ON signing_keys(rotation_id) WHERE rotation_id IS NOT NULL;
CREATE INDEX idx_signing_keys_expires ON signing_keys(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_signing_keys_created ON signing_keys(created_at);

-- Unique constraint: Only one active_signing key at a time
CREATE UNIQUE INDEX idx_signing_keys_unique_active
    ON signing_keys(state)
    WHERE state = 'active_signing';
```

### 2.2 Key Rotation Events Table

```sql
-- Migration: 005_create_key_rotation_events.up.sql
CREATE TABLE IF NOT EXISTS key_rotation_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Rotation Identification
    rotation_id UUID NOT NULL,

    -- Event Details
    event_type VARCHAR(50) NOT NULL,
    -- Types: rotation_started, key_generated, key_activated, old_key_deactivated,
    --        rotation_completed, rotation_failed, key_expired, key_deleted

    event_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Key References
    old_key_id VARCHAR(255),
    new_key_id VARCHAR(255),

    -- Event Data
    event_data JSONB,

    -- Status
    status VARCHAR(50) NOT NULL DEFAULT 'success', -- success, failed, warning
    error_message TEXT,

    -- Audit
    initiated_by VARCHAR(255),
    duration_ms INTEGER,

    CONSTRAINT chk_event_type CHECK (event_type IN (
        'rotation_started', 'key_generated', 'key_activated',
        'old_key_deactivated', 'rotation_completed', 'rotation_failed',
        'key_expired', 'key_deleted', 'manual_rotation_triggered'
    )),
    CONSTRAINT chk_status CHECK (status IN ('success', 'failed', 'warning'))
);

-- Indexes
CREATE INDEX idx_key_rotation_events_rotation_id ON key_rotation_events(rotation_id);
CREATE INDEX idx_key_rotation_events_type ON key_rotation_events(event_type);
CREATE INDEX idx_key_rotation_events_timestamp ON key_rotation_events(event_timestamp);
CREATE INDEX idx_key_rotation_events_status ON key_rotation_events(status, event_timestamp);
```

### 2.3 Down Migration

```sql
-- Migration: 005_create_signing_keys.down.sql
DROP TABLE IF EXISTS key_rotation_events;
DROP TABLE IF EXISTS signing_keys CASCADE;
```

---

## 3. Key Lifecycle States

### 3.1 State Machine

```
┌─────────┐
│ pending │
└────┬────┘
     │ (activation)
     ▼
┌───────────────┐
│active_signing │ ◄──┐
└───────┬───────┘    │ (only one active_signing at a time)
        │            │
        │ (rotation: new key activated)
        ▼            │
┌──────────────────────────┐
│active_verification_only  │
└──────────┬───────────────┘
           │ (TTL expires)
           ▼
      ┌─────────┐
      │ expired │
      └────┬────┘
           │ (cleanup after retention period)
           ▼
      ┌─────────┐
      │ deleted │
      └─────────┘
```

### 3.2 State Descriptions

| State | Description | Can Sign? | Can Verify? | Duration |
|-------|-------------|-----------|-------------|----------|
| **pending** | Key generated but not yet activated | ❌ | ❌ | Minutes |
| **active_signing** | Current key used for signing new tokens | ✅ | ✅ | Days/Weeks |
| **active_verification_only** | Previous key, still validates old tokens | ❌ | ✅ | Token TTL + Grace Period |
| **expired** | Grace period ended, no longer in JWKS | ❌ | ❌ | Retention Period |
| **deleted** | Soft-deleted, retained for audit | ❌ | ❌ | Permanent |

### 3.3 State Transitions

```go
// internal/keyrotation/state_machine.go
package keyrotation

import "errors"

type KeyState string

const (
    StatePending                KeyState = "pending"
    StateActiveSigning          KeyState = "active_signing"
    StateActiveVerificationOnly KeyState = "active_verification_only"
    StateExpired                KeyState = "expired"
    StateDeleted                KeyState = "deleted"
)

var validTransitions = map[KeyState][]KeyState{
    StatePending: {
        StateActiveSigning,  // Normal activation
        StateDeleted,        // Cancelled before activation
    },
    StateActiveSigning: {
        StateActiveVerificationOnly, // Rotation to new key
    },
    StateActiveVerificationOnly: {
        StateExpired, // TTL expired
    },
    StateExpired: {
        StateDeleted, // Cleanup after retention
    },
    StateDeleted: {}, // Terminal state
}

func (s KeyState) CanTransitionTo(target KeyState) bool {
    allowed, exists := validTransitions[s]
    if !exists {
        return false
    }

    for _, allowedState := range allowed {
        if allowedState == target {
            return true
        }
    }
    return false
}
```

---

## 4. Key Rotation Process

### 4.1 Blue-Green Rotation Strategy

**Phases:**
1. **Blue (Current)**: Existing key signing new tokens
2. **Green (New)**: New key generated and staged
3. **Blue+Green (Overlap)**: Both keys active (signing vs verification)
4. **Green (Active)**: New key signing, old key verification-only
5. **Green (Exclusive)**: Old key expired and removed

### 4.2 Rotation Workflow

```
TIME: 0s
┌──────────────────────────┐
│ KEY-001 (active_signing) │ ◄─── Signing new tokens
└──────────────────────────┘
│ JWKS: [KEY-001]          │

TIME: +30s (Rotation Triggered)
┌──────────────────────────┐
│ KEY-001 (active_signing) │ ◄─── Still signing
│ KEY-002 (pending)        │ ◄─── Generated, not yet active
└──────────────────────────┘
│ JWKS: [KEY-001]          │

TIME: +60s (Green Activated)
┌──────────────────────────────────────┐
│ KEY-002 (active_signing)             │ ◄─── Now signing new tokens
│ KEY-001 (active_verification_only)   │ ◄─── Validates old tokens
└──────────────────────────────────────┘
│ JWKS: [KEY-002, KEY-001]             │

TIME: +3660s (1 hour + token TTL)
┌──────────────────────────┐
│ KEY-002 (active_signing) │ ◄─── Signing
│ KEY-001 (expired)        │ ◄─── Removed from JWKS
└──────────────────────────┘
│ JWKS: [KEY-002]          │

TIME: +90 days (Retention period)
┌──────────────────────────┐
│ KEY-002 (active_signing) │
│ KEY-001 (deleted)        │ ◄─── Soft-deleted
└──────────────────────────┘
```

### 4.3 Rotation Orchestrator Service

```go
// internal/keyrotation/orchestrator.go
package keyrotation

import (
    "context"
    "fmt"
    "time"

    "github.com/google/uuid"
)

type Orchestrator struct {
    keyRepo      *KeyRepository
    generator    *KeyGenerator
    encryptor    *KeyEncryptor
    eventRepo    *EventRepository
    logger       Logger
    metrics      MetricsCollector
}

type RotationConfig struct {
    Algorithm              string
    KeySize                int
    OverlapDuration        time.Duration // Default: 1 hour
    VerificationOnlyPeriod time.Duration // Default: Token TTL + 1 hour
    RetentionPeriod        time.Duration // Default: 90 days
}

func (o *Orchestrator) RotateKeys(ctx context.Context, config RotationConfig) error {
    rotationID := uuid.New()
    startTime := time.Now()

    o.logger.Info("Starting key rotation",
        zap.String("rotation_id", rotationID.String()),
        zap.String("algorithm", config.Algorithm),
    )

    // Record rotation started event
    o.recordEvent(ctx, rotationID, "rotation_started", nil, nil, "system")

    // Step 1: Get current active signing key
    currentKey, err := o.keyRepo.GetActiveSigningKey(ctx)
    if err != nil {
        o.recordFailedEvent(ctx, rotationID, "rotation_failed", err)
        return fmt.Errorf("failed to get current key: %w", err)
    }

    // Step 2: Generate new key pair
    newKey, err := o.generateNewKey(ctx, rotationID, config)
    if err != nil {
        o.recordFailedEvent(ctx, rotationID, "rotation_failed", err)
        return fmt.Errorf("failed to generate new key: %w", err)
    }

    o.recordEvent(ctx, rotationID, "key_generated", nil, newKey.KeyID, "system")

    // Step 3: Activate new key as active_signing
    if err := o.activateNewKey(ctx, rotationID, newKey, currentKey); err != nil {
        o.recordFailedEvent(ctx, rotationID, "rotation_failed", err)
        return fmt.Errorf("failed to activate new key: %w", err)
    }

    o.recordEvent(ctx, rotationID, "key_activated", currentKey.KeyID, newKey.KeyID, "system")

    // Step 4: Transition old key to active_verification_only
    if err := o.deactivateOldKey(ctx, rotationID, currentKey, newKey); err != nil {
        o.recordFailedEvent(ctx, rotationID, "rotation_failed", err)
        // Rollback: Reactivate old key
        o.rollbackActivation(ctx, currentKey, newKey)
        return fmt.Errorf("failed to deactivate old key: %w", err)
    }

    o.recordEvent(ctx, rotationID, "old_key_deactivated", currentKey.KeyID, newKey.KeyID, "system")

    // Step 5: Schedule old key expiration
    expiresAt := time.Now().Add(config.VerificationOnlyPeriod)
    if err := o.scheduleKeyExpiration(ctx, currentKey.ID, expiresAt); err != nil {
        o.logger.Warn("Failed to schedule key expiration", zap.Error(err))
    }

    // Step 6: Record successful rotation
    duration := time.Since(startTime)
    o.recordEventWithDuration(ctx, rotationID, "rotation_completed", currentKey.KeyID, newKey.KeyID, "system", duration)

    o.logger.Info("Key rotation completed successfully",
        zap.String("rotation_id", rotationID.String()),
        zap.String("old_key_id", currentKey.KeyID),
        zap.String("new_key_id", newKey.KeyID),
        zap.Duration("duration", duration),
    )

    o.metrics.RecordKeyRotation("success", duration)

    return nil
}

func (o *Orchestrator) generateNewKey(ctx context.Context, rotationID uuid.UUID, config RotationConfig) (*SigningKey, error) {
    // Generate key pair
    privateKey, publicKey, err := o.generator.GenerateRSAKeyPair(config.KeySize)
    if err != nil {
        return nil, err
    }

    // Create key ID with timestamp
    keyID := fmt.Sprintf("key-%s-%03d", time.Now().Format("2006-01-02"), o.getKeySequence())

    // Encrypt private key
    encryptedPrivateKey, err := o.encryptor.Encrypt(privateKey)
    if err != nil {
        return nil, err
    }

    // Convert to JWK format
    jwk, err := o.generator.PublicKeyToJWK(publicKey, keyID, config.Algorithm)
    if err != nil {
        return nil, err
    }

    // Create signing key record
    key := &SigningKey{
        ID:                  uuid.New(),
        KeyID:               keyID,
        PrivateKeyEncrypted: encryptedPrivateKey,
        PublicKeyPEM:        publicKey,
        PublicKeyJWK:        jwk,
        Algorithm:           config.Algorithm,
        KeySize:             config.KeySize,
        KeyType:             "RSA",
        State:               StatePending,
        RotationID:          &rotationID,
        Checksum:            o.calculateChecksum(publicKey),
    }

    // Save to database
    if err := o.keyRepo.Create(ctx, key); err != nil {
        return nil, err
    }

    return key, nil
}

func (o *Orchestrator) activateNewKey(ctx context.Context, rotationID uuid.UUID, newKey, currentKey *SigningKey) error {
    // Begin transaction
    tx, err := o.keyRepo.BeginTx(ctx)
    if err != nil {
        return err
    }
    defer tx.Rollback()

    // Update new key to active_signing
    newKey.State = StateActiveSigning
    newKey.ActivatedAt = timePtr(time.Now())
    newKey.PreviousKeyID = &currentKey.KeyID

    if err := o.keyRepo.UpdateInTx(tx, newKey); err != nil {
        return err
    }

    // Update current key's next_key_id reference
    currentKey.NextKeyID = &newKey.KeyID
    if err := o.keyRepo.UpdateInTx(tx, currentKey); err != nil {
        return err
    }

    return tx.Commit()
}

func (o *Orchestrator) deactivateOldKey(ctx context.Context, rotationID uuid.UUID, oldKey, newKey *SigningKey) error {
    oldKey.State = StateActiveVerificationOnly
    oldKey.SigningStoppedAt = timePtr(time.Now())

    return o.keyRepo.Update(ctx, oldKey)
}

func (o *Orchestrator) rollbackActivation(ctx context.Context, oldKey, newKey *SigningKey) {
    // Reactivate old key
    oldKey.State = StateActiveSigning
    oldKey.SigningStoppedAt = nil
    o.keyRepo.Update(ctx, oldKey)

    // Delete new key
    newKey.State = StateDeleted
    newKey.DeletedAt = timePtr(time.Now())
    o.keyRepo.Update(ctx, newKey)
}

func (o *Orchestrator) scheduleKeyExpiration(ctx context.Context, keyID uuid.UUID, expiresAt time.Time) error {
    return o.keyRepo.SetExpiration(ctx, keyID, expiresAt)
}
```

---

## 5. JWKS Endpoint Implementation

### 5.1 JWKS Handler

```go
// internal/jwks/handler.go
package jwks

import (
    "encoding/json"
    "net/http"
    "time"
)

type Handler struct {
    keyRepo *keyrotation.KeyRepository
    cache   Cache
    logger  Logger
}

type JWKSet struct {
    Keys []JWK `json:"keys"`
}

type JWK struct {
    KeyType   string   `json:"kty"`
    Use       string   `json:"use"`
    KeyID     string   `json:"kid"`
    Algorithm string   `json:"alg"`
    N         string   `json:"n,omitempty"` // RSA modulus
    E         string   `json:"e,omitempty"` // RSA exponent
    X         string   `json:"x,omitempty"` // EC x coordinate
    Y         string   `json:"y,omitempty"` // EC y coordinate
    Curve     string   `json:"crv,omitempty"` // EC curve
}

func (h *Handler) ServeJWKS(w http.ResponseWriter, r *http.Request) {
    startTime := time.Now()

    // Check cache first
    if cached, found := h.cache.Get("jwks"); found {
        h.writeCachedResponse(w, cached.([]byte))
        h.recordMetrics("cache_hit", time.Since(startTime))
        return
    }

    // Get active keys from database
    keys, err := h.keyRepo.GetActiveKeys(r.Context())
    if err != nil {
        h.writeErrorResponse(w, http.StatusInternalServerError, "Failed to retrieve keys")
        h.recordMetrics("error", time.Since(startTime))
        return
    }

    // Convert to JWK format
    jwks := JWKSet{Keys: make([]JWK, 0, len(keys))}
    for _, key := range keys {
        jwk, err := h.convertToJWK(key)
        if err != nil {
            h.logger.Warn("Failed to convert key to JWK", zap.String("key_id", key.KeyID), zap.Error(err))
            continue
        }
        jwks.Keys = append(jwks.Keys, jwk)
    }

    // Serialize to JSON
    response, err := json.Marshal(jwks)
    if err != nil {
        h.writeErrorResponse(w, http.StatusInternalServerError, "Failed to serialize JWKS")
        h.recordMetrics("error", time.Since(startTime))
        return
    }

    // Cache for 5 minutes
    h.cache.Set("jwks", response, 5*time.Minute)

    // Write response
    w.Header().Set("Content-Type", "application/json")
    w.Header().Set("Cache-Control", "public, max-age=300") // 5 minutes
    w.WriteHeader(http.StatusOK)
    w.Write(response)

    h.recordMetrics("success", time.Since(startTime))
}

func (h *Handler) convertToJWK(key *keyrotation.SigningKey) (JWK, error) {
    // Parse stored JWK from database
    var jwk JWK
    if err := json.Unmarshal([]byte(key.PublicKeyJWK), &jwk); err != nil {
        return JWK{}, err
    }
    return jwk, nil
}

func (h *Handler) writeCachedResponse(w http.ResponseWriter, data []byte) {
    w.Header().Set("Content-Type", "application/json")
    w.Header().Set("Cache-Control", "public, max-age=300")
    w.Header().Set("X-Cache", "HIT")
    w.WriteHeader(http.StatusOK)
    w.Write(data)
}
```

### 5.2 JWKS Response Format

```json
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "kid": "key-2025-01-27-001",
      "alg": "RS256",
      "n": "0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw",
      "e": "AQAB"
    },
    {
      "kty": "RSA",
      "use": "sig",
      "kid": "key-2025-01-26-003",
      "alg": "RS256",
      "n": "xjlKJz1ePPldGnD5T3smKKLQDJ0mqJeNmSXmPZ5zIjHFhG4N8oLlqCMJJJVQhfPWJqXHZmJBKJ3Xy8cKLLQDJ0mqJeNmSXmPZ5zIjHFhG4N8oLlqCMJJJVQhfPWJqXHZmJBKJ3Xy8cKLLQDJ0mqJeNmSXmPZ5zIjHFhG4N8oLlqCMJJJVQhfPWJqXHZmJBKJ3Xy8cK",
      "e": "AQAB"
    }
  ]
}
```

**Key Points:**
- `kid`: Unique key identifier for JWT header matching
- `use`: "sig" (signature verification)
- `alg`: Algorithm (RS256, RS384, RS512)
- `kty`: Key type (RSA, EC)
- Multiple keys support rotation overlap

---

## 6. JWT Validation with Multiple Keys

### 6.1 Token Validator

```go
// internal/jwt/validator.go
package jwt

import (
    "context"
    "fmt"

    "github.com/golang-jwt/jwt/v5"
)

type Validator struct {
    keyRepo   *keyrotation.KeyRepository
    keyCache  *KeyCache
    logger    Logger
}

func (v *Validator) ValidateToken(ctx context.Context, tokenString string) (*Claims, error) {
    // Parse token to extract kid from header
    token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
        // Get kid from token header
        kid, ok := token.Header["kid"].(string)
        if !ok {
            return nil, fmt.Errorf("missing kid in token header")
        }

        // Verify algorithm
        if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
            return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
        }

        // Get public key for kid
        publicKey, err := v.getPublicKeyForKID(ctx, kid)
        if err != nil {
            return nil, fmt.Errorf("failed to get public key for kid %s: %w", kid, err)
        }

        return publicKey, nil
    })

    if err != nil {
        return nil, err
    }

    if !token.Valid {
        return nil, fmt.Errorf("invalid token")
    }

    // Extract claims
    claims, ok := token.Claims.(jwt.MapClaims)
    if !ok {
        return nil, fmt.Errorf("invalid claims format")
    }

    return parseClaims(claims), nil
}

func (v *Validator) getPublicKeyForKID(ctx context.Context, kid string) (interface{}, error) {
    // Check cache first
    if key, found := v.keyCache.Get(kid); found {
        return key, nil
    }

    // Fetch from database
    keyData, err := v.keyRepo.GetByKeyID(ctx, kid)
    if err != nil {
        return nil, err
    }

    // Verify key is in valid state for verification
    if !keyData.CanVerify() {
        return nil, fmt.Errorf("key %s cannot be used for verification (state: %s)", kid, keyData.State)
    }

    // Parse PEM to public key
    publicKey, err := jwt.ParseRSAPublicKeyFromPEM([]byte(keyData.PublicKeyPEM))
    if err != nil {
        return nil, err
    }

    // Cache for 5 minutes
    v.keyCache.Set(kid, publicKey, 5*time.Minute)

    return publicKey, nil
}

// CanVerify checks if key state allows verification
func (k *SigningKey) CanVerify() bool {
    return k.State == StateActiveSigning || k.State == StateActiveVerificationOnly
}
```

---

## 7. Automated Key Rotation Scheduler

### 7.1 Cron-based Rotation

```go
// internal/keyrotation/scheduler.go
package keyrotation

import (
    "context"
    "time"

    "github.com/robfig/cron/v3"
)

type Scheduler struct {
    orchestrator *Orchestrator
    config       *SchedulerConfig
    cron         *cron.Cron
    logger       Logger
}

type SchedulerConfig struct {
    RotationInterval    time.Duration // Default: 30 days
    RotationCronSpec    string        // Alternative: "0 0 1 * *" (1st of month)
    AutoRotateEnabled   bool          // Default: false (require manual trigger)
    CleanupCronSpec     string        // "0 2 * * *" (2 AM daily)
}

func (s *Scheduler) Start(ctx context.Context) error {
    s.cron = cron.New(cron.WithLocation(time.UTC))

    // Schedule automatic rotation (if enabled)
    if s.config.AutoRotateEnabled {
        _, err := s.cron.AddFunc(s.config.RotationCronSpec, func() {
            if err := s.runRotation(ctx); err != nil {
                s.logger.Error("Scheduled rotation failed", zap.Error(err))
            }
        })
        if err != nil {
            return err
        }
        s.logger.Info("Automatic key rotation scheduled", zap.String("schedule", s.config.RotationCronSpec))
    }

    // Schedule key cleanup
    _, err := s.cron.AddFunc(s.config.CleanupCronSpec, func() {
        if err := s.runCleanup(ctx); err != nil {
            s.logger.Error("Key cleanup failed", zap.Error(err))
        }
    })
    if err != nil {
        return err
    }

    s.cron.Start()
    s.logger.Info("Key rotation scheduler started")
    return nil
}

func (s *Scheduler) runRotation(ctx context.Context) error {
    s.logger.Info("Starting scheduled key rotation")

    config := RotationConfig{
        Algorithm:              "RS256",
        KeySize:                2048,
        VerificationOnlyPeriod: 3600 * time.Second, // 1 hour
        RetentionPeriod:        90 * 24 * time.Hour, // 90 days
    }

    return s.orchestrator.RotateKeys(ctx, config)
}

func (s *Scheduler) runCleanup(ctx context.Context) error {
    s.logger.Info("Starting key cleanup")

    // Expire keys that have passed their expiration time
    expiredKeys, err := s.orchestrator.ExpireOldKeys(ctx)
    if err != nil {
        return err
    }
    s.logger.Info("Expired keys", zap.Int("count", len(expiredKeys)))

    // Delete keys that have passed retention period
    deletedKeys, err := s.orchestrator.CleanupExpiredKeys(ctx, s.config.RetentionPeriod)
    if err != nil {
        return err
    }
    s.logger.Info("Deleted keys", zap.Int("count", len(deletedKeys)))

    return nil
}

func (s *Scheduler) Stop() {
    if s.cron != nil {
        s.cron.Stop()
        s.logger.Info("Key rotation scheduler stopped")
    }
}
```

### 7.2 Key Expiration & Cleanup

```go
// internal/keyrotation/cleanup.go
package keyrotation

func (o *Orchestrator) ExpireOldKeys(ctx context.Context) ([]string, error) {
    // Find keys in active_verification_only state that have passed their expiration time
    expiredKeys, err := o.keyRepo.FindExpiredKeys(ctx)
    if err != nil {
        return nil, err
    }

    expiredKeyIDs := make([]string, 0, len(expiredKeys))

    for _, key := range expiredKeys {
        // Transition to expired state
        key.State = StateExpired
        if err := o.keyRepo.Update(ctx, key); err != nil {
            o.logger.Error("Failed to expire key", zap.String("key_id", key.KeyID), zap.Error(err))
            continue
        }

        // Record event
        o.recordEvent(ctx, uuid.Nil, "key_expired", key.KeyID, "", "system")

        expiredKeyIDs = append(expiredKeyIDs, key.KeyID)
        o.logger.Info("Key expired", zap.String("key_id", key.KeyID))
    }

    return expiredKeyIDs, nil
}

func (o *Orchestrator) CleanupExpiredKeys(ctx context.Context, retentionPeriod time.Duration) ([]string, error) {
    // Find keys in expired state that have passed retention period
    cutoffTime := time.Now().Add(-retentionPeriod)
    oldKeys, err := o.keyRepo.FindKeysExpiredBefore(ctx, cutoffTime)
    if err != nil {
        return nil, err
    }

    deletedKeyIDs := make([]string, 0, len(oldKeys))

    for _, key := range oldKeys {
        // Soft delete (update state to deleted)
        key.State = StateDeleted
        key.DeletedAt = timePtr(time.Now())

        if err := o.keyRepo.Update(ctx, key); err != nil {
            o.logger.Error("Failed to delete key", zap.String("key_id", key.KeyID), zap.Error(err))
            continue
        }

        // Record event
        o.recordEvent(ctx, uuid.Nil, "key_deleted", key.KeyID, "", "system")

        deletedKeyIDs = append(deletedKeyIDs, key.KeyID)
        o.logger.Info("Key deleted", zap.String("key_id", key.KeyID))
    }

    return deletedKeyIDs, nil
}
```

---

## 8. Security Considerations

### 8.1 Private Key Encryption

**Encryption Strategy:**
- Private keys MUST be encrypted at rest
- Use AES-256-GCM for encryption
- Unique encryption key per environment (from KMS/Vault)
- Key encryption key (KEK) rotation support

```go
// internal/keyrotation/encryptor.go
package keyrotation

import (
    "crypto/aes"
    "crypto/cipher"
    "crypto/rand"
    "encoding/base64"
    "io"
)

type KeyEncryptor struct {
    kek []byte // Key Encryption Key (32 bytes for AES-256)
}

func (e *KeyEncryptor) Encrypt(plaintext []byte) ([]byte, error) {
    block, err := aes.NewCipher(e.kek)
    if err != nil {
        return nil, err
    }

    aesGCM, err := cipher.NewGCM(block)
    if err != nil {
        return nil, err
    }

    // Generate random nonce
    nonce := make([]byte, aesGCM.NonceSize())
    if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
        return nil, err
    }

    // Encrypt and authenticate
    ciphertext := aesGCM.Seal(nonce, nonce, plaintext, nil)
    return ciphertext, nil
}

func (e *KeyEncryptor) Decrypt(ciphertext []byte) ([]byte, error) {
    block, err := aes.NewCipher(e.kek)
    if err != nil {
        return nil, err
    }

    aesGCM, err := cipher.NewGCM(block)
    if err != nil {
        return nil, err
    }

    nonceSize := aesGCM.NonceSize()
    if len(ciphertext) < nonceSize {
        return nil, errors.New("ciphertext too short")
    }

    nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]

    // Decrypt and verify authentication
    plaintext, err := aesGCM.Open(nil, nonce, ciphertext, nil)
    if err != nil {
        return nil, err
    }

    return plaintext, nil
}
```

### 8.2 Key ID Format

**Format:** `key-{DATE}-{SEQUENCE}`
- DATE: YYYY-MM-DD (e.g., 2025-01-27)
- SEQUENCE: 3-digit number (001, 002, ...)
- Example: `key-2025-01-27-001`

**Benefits:**
- Human-readable
- Chronologically sortable
- Supports multiple rotations per day
- Auditable

### 8.3 Checksum Verification

```go
func (o *Orchestrator) calculateChecksum(publicKeyPEM string) string {
    hash := sha256.Sum256([]byte(publicKeyPEM))
    return hex.EncodeToString(hash[:])
}

func (o *Orchestrator) verifyChecksum(key *SigningKey) bool {
    computed := o.calculateChecksum(key.PublicKeyPEM)
    return key.Checksum == computed
}
```

---

## 9. Performance Targets

### 9.1 JWKS Endpoint

| Metric | Target |
|--------|--------|
| p50 latency | < 10ms |
| p95 latency | < 50ms |
| p99 latency | < 100ms |
| Cache hit rate | > 95% |
| Availability | 99.99% |

### 9.2 Key Rotation

| Metric | Target |
|--------|--------|
| Total rotation duration | < 2 minutes |
| Zero downtime | ✅ Required |
| Failed validations during rotation | 0 |

---

## 10. Testing Requirements

### 10.1 Unit Tests

**Rotation Orchestrator:**
- ✅ Successful key generation
- ✅ Successful key activation
- ✅ Old key deactivation
- ✅ State transitions validation
- ✅ Rollback on failure
- ✅ Event recording

**JWKS Handler:**
- ✅ Returns active keys only
- ✅ Cache hit/miss logic
- ✅ Proper JWK format
- ✅ Multiple keys in response

**JWT Validator:**
- ✅ Validate with current key
- ✅ Validate with previous key (during overlap)
- ✅ Reject with expired key
- ✅ Reject with deleted key
- ✅ Missing kid → error

### 10.2 Integration Tests

```go
func TestKeyRotation_ZeroDowntime_Integration(t *testing.T) {
    ctx := context.Background()

    // Setup
    db := setupTestDB(t)
    redis := setupTestRedis(t)
    orchestrator := setupOrchestrator(db, redis)

    // Create initial key
    initialKey := createTestKey(t, db, "active_signing")

    // Issue 100 tokens with initial key
    tokens := issueTestTokens(t, 100, initialKey)

    // Start rotation
    config := RotationConfig{
        Algorithm:              "RS256",
        KeySize:                2048,
        VerificationOnlyPeriod: 1 * time.Hour,
    }

    go func() {
        err := orchestrator.RotateKeys(ctx, config)
        assert.NoError(t, err)
    }()

    // Continuously validate tokens during rotation
    time.Sleep(100 * time.Millisecond) // Wait for rotation to start

    for i := 0; i < 100; i++ {
        for _, token := range tokens {
            _, err := validator.ValidateToken(ctx, token)
            assert.NoError(t, err, "Token validation failed during rotation")
        }
        time.Sleep(100 * time.Millisecond)
    }

    // Verify new key is active
    newKey, err := orchestrator.keyRepo.GetActiveSigningKey(ctx)
    assert.NoError(t, err)
    assert.NotEqual(t, initialKey.KeyID, newKey.KeyID)

    // Verify JWKS contains both keys
    jwks := getJWKS(t)
    assert.Len(t, jwks.Keys, 2)
}
```

---

## 11. Monitoring & Alerts

### 11.1 Metrics

```go
var (
    keyRotationsTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "key_rotations_total",
            Help: "Total number of key rotations",
        },
        []string{"status"}, // success, failed
    )

    activeSigningKeysGauge = prometheus.NewGaugeVec(
        prometheus.GaugeOpts{
            Name: "active_signing_keys_total",
            Help: "Number of active signing keys by state",
        },
        []string{"state"},
    )

    jwksRequestsTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "jwks_requests_total",
            Help: "Total JWKS endpoint requests",
        },
        []string{"cache_status"}, // hit, miss
    )
)
```

### 11.2 Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| Rotation failed | key_rotations_total{status="failed"} > 0 | Critical |
| Multiple active signing keys | active_signing_keys_total > 1 for 5m | Critical |
| No active signing key | active_signing_keys_total == 0 | Critical |
| JWKS low cache hit rate | Cache hit rate < 80% for 10m | Warning |
| Old key not expired | active_verification_only key > 24h old | Warning |

---

## 12. Deployment Checklist

### 12.1 Pre-Deployment
- [ ] Run migration `005_create_signing_keys.up.sql`
- [ ] Generate initial signing key
- [ ] Configure key encryption (AES-256-GCM)
- [ ] Set up JWKS endpoint caching
- [ ] Configure rotation scheduler (cron)

### 12.2 Post-Deployment
- [ ] Verify JWKS endpoint responds with initial key
- [ ] Test manual key rotation
- [ ] Verify token validation with rotated keys
- [ ] Check rotation event logs
- [ ] Monitor JWKS cache performance

---

## 13. Runbook: Emergency Key Rotation

**Scenario:** Security breach, compromised signing key

**Steps:**
1. **Trigger immediate rotation:**
   ```bash
   curl -X POST https://api.example.com/admin/keys/rotate \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -d '{"reason": "security_breach"}'
   ```

2. **Verify new key active:**
   ```bash
   curl https://api.example.com/.well-known/jwks.json
   ```

3. **Revoke old tokens (optional):**
   - Add old key_id to revocation list
   - Force token re-issuance

4. **Monitor token validation errors:**
   - Check metrics for increased 401 errors
   - Review audit logs

5. **Post-incident:**
   - Document in rotation events
   - Update security procedures

---

## 14. Future Enhancements

### 14.1 Short-term
- [ ] Manual rotation trigger API
- [ ] Rotation status dashboard
- [ ] Key usage analytics
- [ ] Support for ES256/ES384/ES512 algorithms

### 14.2 Long-term
- [ ] Hardware Security Module (HSM) integration
- [ ] Multi-region key replication
- [ ] Automated rollback on validation failures
- [ ] A/B testing for rotation strategies

---

## 15. References

- RFC 7517: JSON Web Key (JWK)
- RFC 7518: JSON Web Algorithms (JWA)
- RFC 7519: JSON Web Token (JWT)
- NIST SP 800-57: Key Management Recommendations
- OWASP Cryptographic Storage Cheat Sheet
