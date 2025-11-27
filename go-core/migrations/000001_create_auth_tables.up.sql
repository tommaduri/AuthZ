-- Migration: Create core authentication tables
-- Description: Creates tables for API keys, refresh tokens, audit logs, and rate limiting
-- Version: 1
-- Date: 2025-11-26

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- API Keys table
-- Stores hashed API keys with metadata and rate limiting configuration
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    last_used_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    rate_limit_rps INTEGER NOT NULL DEFAULT 100,
    tenant_id TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_by TEXT,

    -- Constraints
    CONSTRAINT api_keys_key_hash_unique UNIQUE (key_hash),
    CONSTRAINT api_keys_name_check CHECK (length(name) > 0 AND length(name) <= 255),
    CONSTRAINT api_keys_agent_id_check CHECK (length(agent_id) > 0),
    CONSTRAINT api_keys_tenant_id_check CHECK (length(tenant_id) > 0),
    CONSTRAINT api_keys_rate_limit_check CHECK (rate_limit_rps > 0 AND rate_limit_rps <= 10000),
    CONSTRAINT api_keys_expires_check CHECK (expires_at IS NULL OR expires_at > created_at)
);

-- Add comment for documentation
COMMENT ON TABLE api_keys IS 'Stores API key hashes with authentication and rate limiting metadata';
COMMENT ON COLUMN api_keys.key_hash IS 'SHA-256 hash of the API key (never store plaintext)';
COMMENT ON COLUMN api_keys.scopes IS 'JSON array of permission scopes granted to this key';
COMMENT ON COLUMN api_keys.rate_limit_rps IS 'Requests per second allowed for this key';

-- Refresh Tokens table
-- Stores hashed refresh tokens for token rotation
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token_hash TEXT NOT NULL,
    user_id TEXT NOT NULL,
    agent_id TEXT,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMP WITH TIME ZONE,
    tenant_id TEXT NOT NULL,
    parent_token_id UUID,
    metadata JSONB DEFAULT '{}'::jsonb,

    -- Constraints
    CONSTRAINT refresh_tokens_token_hash_unique UNIQUE (token_hash),
    CONSTRAINT refresh_tokens_user_id_check CHECK (length(user_id) > 0),
    CONSTRAINT refresh_tokens_tenant_id_check CHECK (length(tenant_id) > 0),
    CONSTRAINT refresh_tokens_expires_check CHECK (expires_at > created_at),
    CONSTRAINT refresh_tokens_parent_fk FOREIGN KEY (parent_token_id) REFERENCES refresh_tokens(id) ON DELETE SET NULL
);

COMMENT ON TABLE refresh_tokens IS 'Stores refresh token hashes for secure token rotation';
COMMENT ON COLUMN refresh_tokens.token_hash IS 'SHA-256 hash of the refresh token';
COMMENT ON COLUMN refresh_tokens.parent_token_id IS 'Links to previous token in rotation chain';

-- Auth Audit Logs table
-- Comprehensive authentication event logging
CREATE TABLE IF NOT EXISTS auth_audit_logs (
    id UUID DEFAULT uuid_generate_v4(),
    event_type TEXT NOT NULL,
    user_id TEXT,
    agent_id TEXT,
    api_key_id UUID,
    ip_address INET,
    user_agent TEXT,
    success BOOLEAN NOT NULL,
    error_message TEXT,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    tenant_id TEXT NOT NULL,
    request_id TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,

    -- Composite primary key including timestamp for future partitioning support
    PRIMARY KEY (id, timestamp),

    -- Constraints
    CONSTRAINT auth_audit_logs_event_type_check CHECK (event_type IN (
        'api_key_created', 'api_key_validated', 'api_key_revoked',
        'token_issued', 'token_refreshed', 'token_revoked',
        'login_success', 'login_failure', 'logout',
        'rate_limit_exceeded', 'permission_denied'
    )),
    CONSTRAINT auth_audit_logs_tenant_id_check CHECK (length(tenant_id) > 0),
    CONSTRAINT auth_audit_logs_user_or_agent_check CHECK (user_id IS NOT NULL OR agent_id IS NOT NULL)
);

COMMENT ON TABLE auth_audit_logs IS 'Comprehensive audit trail for all authentication events';
COMMENT ON COLUMN auth_audit_logs.event_type IS 'Type of authentication event (enumerated values)';
COMMENT ON COLUMN auth_audit_logs.metadata IS 'Additional context data for the event';

-- Rate Limit State table
-- Stores current rate limiting state for token bucket algorithm
CREATE TABLE IF NOT EXISTS rate_limit_state (
    key TEXT NOT NULL,
    tokens DECIMAL(10, 4) NOT NULL,
    last_refill TIMESTAMP WITH TIME ZONE NOT NULL,
    tenant_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Constraints
    PRIMARY KEY (key, tenant_id),
    CONSTRAINT rate_limit_state_tokens_check CHECK (tokens >= 0),
    CONSTRAINT rate_limit_state_key_check CHECK (length(key) > 0),
    CONSTRAINT rate_limit_state_tenant_id_check CHECK (length(tenant_id) > 0)
);

COMMENT ON TABLE rate_limit_state IS 'Token bucket state for distributed rate limiting';
COMMENT ON COLUMN rate_limit_state.tokens IS 'Current number of available tokens';
COMMENT ON COLUMN rate_limit_state.last_refill IS 'Last time tokens were refilled';

-- Enable Row-Level Security (RLS)
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_state ENABLE ROW LEVEL SECURITY;

-- RLS Policies for tenant isolation
-- API Keys policies
CREATE POLICY api_keys_tenant_isolation ON api_keys
    USING (tenant_id = current_setting('app.current_tenant', true));

CREATE POLICY api_keys_insert_policy ON api_keys
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true));

-- Refresh Tokens policies
CREATE POLICY refresh_tokens_tenant_isolation ON refresh_tokens
    USING (tenant_id = current_setting('app.current_tenant', true));

CREATE POLICY refresh_tokens_insert_policy ON refresh_tokens
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true));

-- Audit Logs policies (read-only for tenant)
CREATE POLICY auth_audit_logs_tenant_isolation ON auth_audit_logs
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant', true));

CREATE POLICY auth_audit_logs_insert_policy ON auth_audit_logs
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true));

-- Rate Limit State policies
CREATE POLICY rate_limit_state_tenant_isolation ON rate_limit_state
    USING (tenant_id = current_setting('app.current_tenant', true));

CREATE POLICY rate_limit_state_insert_policy ON rate_limit_state
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true));

-- Partitioning for audit logs (by month for performance)
-- This will be extended in future migrations for automatic partition management
CREATE TABLE IF NOT EXISTS auth_audit_logs_template (
    LIKE auth_audit_logs INCLUDING ALL
) PARTITION BY RANGE (timestamp);

COMMENT ON TABLE auth_audit_logs_template IS 'Template for partitioned audit logs (future use)';
