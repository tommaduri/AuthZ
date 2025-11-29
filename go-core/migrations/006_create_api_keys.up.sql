-- Create API keys table for API key authentication
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash VARCHAR(64) NOT NULL UNIQUE,  -- SHA-256 hash (never plaintext)
    name VARCHAR(255),                      -- Human-readable name
    agent_id VARCHAR(255) NOT NULL,         -- Owner agent ID
    scopes TEXT[],                          -- Allowed scopes (e.g., {"read:*", "write:policies"})
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP,                   -- NULL = never expires
    last_used_at TIMESTAMP,
    revoked_at TIMESTAMP,
    rate_limit_rps INTEGER DEFAULT 100,     -- Requests per second
    metadata JSONB                          -- Extra key-value pairs
);

-- Indexes for performance
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_agent ON api_keys(agent_id);
CREATE INDEX idx_api_keys_active ON api_keys(revoked_at) WHERE revoked_at IS NULL;

-- Comments for documentation
COMMENT ON TABLE api_keys IS 'API keys for authentication with SHA-256 hashing';
COMMENT ON COLUMN api_keys.key_hash IS 'SHA-256 hash of the API key (never store plaintext)';
COMMENT ON COLUMN api_keys.scopes IS 'OAuth2-style scopes for authorization';
COMMENT ON COLUMN api_keys.rate_limit_rps IS 'Rate limit in requests per second';
