-- Create API keys table for API key authentication
CREATE TABLE IF NOT EXISTS api_keys (
    key_id UUID PRIMARY KEY,
    key_hash VARCHAR(64) NOT NULL UNIQUE, -- SHA-256 hash (64 hex chars)
    key_prefix VARCHAR(10) NOT NULL,      -- First 8 chars for identification
    agent_id VARCHAR(255) NOT NULL,
    tenant_id VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    scopes TEXT[],
    rate_limit_per_sec INT NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

-- Index for fast lookup by hash (primary authentication)
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

-- Index for fast lookup by prefix (for identification/display)
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);

-- Index for listing keys by agent
CREATE INDEX idx_api_keys_agent ON api_keys(agent_id, tenant_id);

-- Index for cleanup queries (finding expired keys)
CREATE INDEX idx_api_keys_expires ON api_keys(expires_at) WHERE expires_at IS NOT NULL;

-- Index for filtering non-revoked keys
CREATE INDEX idx_api_keys_active ON api_keys(revoked_at) WHERE revoked_at IS NULL;

-- Add comment for documentation
COMMENT ON TABLE api_keys IS 'Stores API keys for authentication with SHA-256 hashing';
COMMENT ON COLUMN api_keys.key_hash IS 'SHA-256 hash of the full API key (never store plaintext)';
COMMENT ON COLUMN api_keys.key_prefix IS 'First 8 characters of API key for identification';
COMMENT ON COLUMN api_keys.scopes IS 'Array of scopes/permissions for this API key';
COMMENT ON COLUMN api_keys.rate_limit_per_sec IS 'Maximum requests per second allowed for this key';
