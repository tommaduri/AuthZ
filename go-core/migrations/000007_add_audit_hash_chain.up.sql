-- Migration: Add hash chain columns for audit log integrity
-- Description: Adds prev_hash and current_hash columns to enable tamper-evident audit logging
-- Version: 7
-- Date: 2025-11-27

-- Add hash chain columns to auth_audit_logs
ALTER TABLE auth_audit_logs
ADD COLUMN IF NOT EXISTS prev_hash TEXT,
ADD COLUMN IF NOT EXISTS current_hash TEXT NOT NULL DEFAULT '';

-- Create indexes for hash chain verification
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_tenant_timestamp
    ON auth_audit_logs(tenant_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_event_type
    ON auth_audit_logs(event_type, timestamp);

CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_user_id
    ON auth_audit_logs(user_id, timestamp) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_agent_id
    ON auth_audit_logs(agent_id, timestamp) WHERE agent_id IS NOT NULL;

-- Create trigger to prevent audit log modifications (append-only)
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit logs are immutable (cannot UPDATE or DELETE)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_audit_log_update
BEFORE UPDATE OR DELETE ON auth_audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_modification();

-- Comment on new columns
COMMENT ON COLUMN auth_audit_logs.prev_hash IS 'SHA-256 hash of previous event in the chain';
COMMENT ON COLUMN auth_audit_logs.current_hash IS 'SHA-256 hash of this event (includes prev_hash for chain integrity)';
