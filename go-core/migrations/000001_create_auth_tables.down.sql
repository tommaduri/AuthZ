-- Migration Rollback: Drop authentication tables
-- Description: Safely removes all authentication tables and policies
-- Version: 1
-- Date: 2025-11-26

-- Drop RLS policies first
DROP POLICY IF EXISTS rate_limit_state_insert_policy ON rate_limit_state;
DROP POLICY IF EXISTS rate_limit_state_tenant_isolation ON rate_limit_state;

DROP POLICY IF EXISTS auth_audit_logs_insert_policy ON auth_audit_logs;
DROP POLICY IF EXISTS auth_audit_logs_tenant_isolation ON auth_audit_logs;

DROP POLICY IF EXISTS refresh_tokens_insert_policy ON refresh_tokens;
DROP POLICY IF EXISTS refresh_tokens_tenant_isolation ON refresh_tokens;

DROP POLICY IF EXISTS api_keys_insert_policy ON api_keys;
DROP POLICY IF EXISTS api_keys_tenant_isolation ON api_keys;

-- Drop partition template
DROP TABLE IF EXISTS auth_audit_logs_template;

-- Drop tables (CASCADE to handle dependencies)
DROP TABLE IF EXISTS rate_limit_state CASCADE;
DROP TABLE IF EXISTS auth_audit_logs CASCADE;
DROP TABLE IF EXISTS refresh_tokens CASCADE;
DROP TABLE IF EXISTS api_keys CASCADE;

-- Note: We don't drop extensions as they might be used by other parts of the system
-- DROP EXTENSION IF EXISTS "pgcrypto";
-- DROP EXTENSION IF EXISTS "uuid-ossp";
