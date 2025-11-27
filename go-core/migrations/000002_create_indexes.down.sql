-- Migration Rollback: Drop performance indexes
-- Description: Removes all indexes created for query optimization
-- Version: 2
-- Date: 2025-11-26

-- Rate Limit State indexes
DROP INDEX IF EXISTS idx_rate_limit_state_tenant;
DROP INDEX IF EXISTS idx_rate_limit_state_updated;

-- Auth Audit Logs indexes
DROP INDEX IF EXISTS idx_auth_audit_logs_tenant_event_time;
DROP INDEX IF EXISTS idx_auth_audit_logs_metadata;
DROP INDEX IF EXISTS idx_auth_audit_logs_request_id;
DROP INDEX IF EXISTS idx_auth_audit_logs_ip;
DROP INDEX IF EXISTS idx_auth_audit_logs_failures;
DROP INDEX IF EXISTS idx_auth_audit_logs_event_type;
DROP INDEX IF EXISTS idx_auth_audit_logs_tenant_id;
DROP INDEX IF EXISTS idx_auth_audit_logs_agent_id;
DROP INDEX IF EXISTS idx_auth_audit_logs_user_id;
DROP INDEX IF EXISTS idx_auth_audit_logs_timestamp;

-- Refresh Tokens indexes
DROP INDEX IF EXISTS idx_refresh_tokens_expires;
DROP INDEX IF EXISTS idx_refresh_tokens_parent;
DROP INDEX IF EXISTS idx_refresh_tokens_active;
DROP INDEX IF EXISTS idx_refresh_tokens_tenant_id;
DROP INDEX IF EXISTS idx_refresh_tokens_user_id;
DROP INDEX IF EXISTS idx_refresh_tokens_token_hash;

-- API Keys indexes
DROP INDEX IF EXISTS idx_api_keys_last_used;
DROP INDEX IF EXISTS idx_api_keys_metadata;
DROP INDEX IF EXISTS idx_api_keys_scopes;
DROP INDEX IF EXISTS idx_api_keys_active;
DROP INDEX IF EXISTS idx_api_keys_tenant_id;
DROP INDEX IF EXISTS idx_api_keys_agent_id;
DROP INDEX IF EXISTS idx_api_keys_key_hash;
