-- Migration: Create performance indexes
-- Description: Creates indexes for query optimization and multi-tenant performance
-- Version: 2
-- Date: 2025-11-26

-- API Keys indexes
-- Primary lookup by key hash (already unique constraint, but explicit index for clarity)
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys USING btree (key_hash);

-- Lookup by agent for listing keys
CREATE INDEX IF NOT EXISTS idx_api_keys_agent_id ON api_keys USING btree (agent_id);

-- Multi-tenant queries
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_id ON api_keys USING btree (tenant_id);

-- Active keys lookup (non-revoked, non-expired)
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys USING btree (tenant_id, revoked_at, expires_at)
    WHERE revoked_at IS NULL;

-- Scopes search using GIN index for JSONB
CREATE INDEX IF NOT EXISTS idx_api_keys_scopes ON api_keys USING gin (scopes);

-- Metadata search using GIN index for JSONB
CREATE INDEX IF NOT EXISTS idx_api_keys_metadata ON api_keys USING gin (metadata);

-- Usage tracking
CREATE INDEX IF NOT EXISTS idx_api_keys_last_used ON api_keys USING btree (last_used_at DESC NULLS LAST);

-- Refresh Tokens indexes
-- Primary lookup by token hash (already unique constraint)
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens USING btree (token_hash);

-- User token lookup
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens USING btree (user_id);

-- Multi-tenant queries
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_tenant_id ON refresh_tokens USING btree (tenant_id);

-- Active tokens lookup (non-revoked, non-expired)
-- Note: Cannot use NOW() in partial index (not IMMUTABLE). Query will filter at runtime.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_active ON refresh_tokens USING btree (tenant_id, user_id, revoked_at, expires_at)
    WHERE revoked_at IS NULL;

-- Token rotation chain lookup
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_parent ON refresh_tokens USING btree (parent_token_id)
    WHERE parent_token_id IS NOT NULL;

-- Expired token cleanup
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens USING btree (expires_at)
    WHERE revoked_at IS NULL;

-- Auth Audit Logs indexes
-- Time-series queries (most common access pattern)
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_timestamp ON auth_audit_logs USING btree (timestamp DESC);

-- User activity lookup
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_user_id ON auth_audit_logs USING btree (user_id, timestamp DESC)
    WHERE user_id IS NOT NULL;

-- Agent activity lookup
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_agent_id ON auth_audit_logs USING btree (agent_id, timestamp DESC)
    WHERE agent_id IS NOT NULL;

-- Multi-tenant queries
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_tenant_id ON auth_audit_logs USING btree (tenant_id, timestamp DESC);

-- Event type analysis
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_event_type ON auth_audit_logs USING btree (event_type, timestamp DESC);

-- Security monitoring (failed events)
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_failures ON auth_audit_logs USING btree (tenant_id, timestamp DESC)
    WHERE success = false;

-- IP-based security analysis
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_ip ON auth_audit_logs USING btree (ip_address, timestamp DESC)
    WHERE ip_address IS NOT NULL;

-- Request correlation
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_request_id ON auth_audit_logs USING btree (request_id)
    WHERE request_id IS NOT NULL;

-- Metadata search using GIN index for JSONB
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_metadata ON auth_audit_logs USING gin (metadata);

-- Composite index for common queries (tenant + event type + time range)
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_tenant_event_time ON auth_audit_logs
    USING btree (tenant_id, event_type, timestamp DESC);

-- Rate Limit State indexes
-- Primary key already provides index on (key, tenant_id)

-- Cleanup of stale entries (by last update time)
CREATE INDEX IF NOT EXISTS idx_rate_limit_state_updated ON rate_limit_state USING btree (updated_at);

-- Tenant-wide rate limit monitoring
CREATE INDEX IF NOT EXISTS idx_rate_limit_state_tenant ON rate_limit_state USING btree (tenant_id, updated_at DESC);

-- Statistics and monitoring
-- Collect statistics for query optimizer
ANALYZE api_keys;
ANALYZE refresh_tokens;
ANALYZE auth_audit_logs;
ANALYZE rate_limit_state;

-- Performance notes
COMMENT ON INDEX idx_api_keys_scopes IS 'GIN index for fast JSONB containment queries on scopes';
COMMENT ON INDEX idx_api_keys_active IS 'Partial index for active (non-revoked, non-expired) keys';
COMMENT ON INDEX idx_auth_audit_logs_timestamp IS 'B-tree index optimized for time-series queries (DESC for recent-first)';
COMMENT ON INDEX idx_auth_audit_logs_failures IS 'Partial index for security monitoring of failed auth attempts';
