-- OAuth2 Client Credentials Table (RFC 6749)
-- Stores OAuth2 client applications for service-to-service authentication

CREATE TABLE IF NOT EXISTS oauth2_clients (
    client_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_secret_hash VARCHAR(60) NOT NULL, -- bcrypt hashed (cost 12)
    name VARCHAR(255) NOT NULL,
    tenant_id VARCHAR(255) NOT NULL,
    scopes TEXT[] DEFAULT '{}', -- Allowed scopes for this client
    grant_types TEXT[] DEFAULT '{client_credentials}', -- RFC 6749 grant types
    redirect_uris TEXT[] DEFAULT '{}', -- For future authorization code flow

    -- Rate limiting
    rate_limit_per_sec INT DEFAULT 1000, -- Requests per second
    rate_limit_burst INT DEFAULT 2000, -- Burst capacity

    -- Lifecycle
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ, -- Optional expiration
    revoked_at TIMESTAMPTZ, -- Soft delete

    -- Metadata
    metadata JSONB DEFAULT '{}',

    CONSTRAINT oauth2_clients_tenant_name_unique UNIQUE(tenant_id, name)
);

-- Indexes for performance
CREATE INDEX idx_oauth2_clients_tenant ON oauth2_clients(tenant_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_oauth2_clients_expires ON oauth2_clients(expires_at) WHERE revoked_at IS NULL AND expires_at IS NOT NULL;

-- Updated timestamp trigger
CREATE OR REPLACE FUNCTION update_oauth2_clients_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER oauth2_clients_updated_at
    BEFORE UPDATE ON oauth2_clients
    FOR EACH ROW
    EXECUTE FUNCTION update_oauth2_clients_updated_at();

-- Comments for documentation
COMMENT ON TABLE oauth2_clients IS 'OAuth2 client credentials for service-to-service authentication (RFC 6749)';
COMMENT ON COLUMN oauth2_clients.client_secret_hash IS 'bcrypt hash of client secret (cost 12, ~250ms verification time)';
COMMENT ON COLUMN oauth2_clients.scopes IS 'Allowed OAuth2 scopes (e.g., read:policies, write:policies)';
COMMENT ON COLUMN oauth2_clients.rate_limit_per_sec IS 'Token bucket rate limit (requests per second)';
