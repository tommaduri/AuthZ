-- Migration rollback: Remove hash chain columns
-- Version: 7
-- Date: 2025-11-27

-- Drop trigger
DROP TRIGGER IF EXISTS prevent_audit_log_update ON auth_audit_logs;
DROP FUNCTION IF EXISTS prevent_audit_log_modification();

-- Drop indexes
DROP INDEX IF EXISTS idx_auth_audit_logs_agent_id;
DROP INDEX IF EXISTS idx_auth_audit_logs_user_id;
DROP INDEX IF EXISTS idx_auth_audit_logs_event_type;
DROP INDEX IF EXISTS idx_auth_audit_logs_tenant_timestamp;

-- Drop hash chain columns
ALTER TABLE auth_audit_logs
DROP COLUMN IF EXISTS current_hash,
DROP COLUMN IF EXISTS prev_hash;
