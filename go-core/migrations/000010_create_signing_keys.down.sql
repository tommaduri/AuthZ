-- Drop signing keys table
DROP INDEX IF EXISTS idx_signing_keys_expires_at;
DROP INDEX IF EXISTS idx_signing_keys_status;
DROP TABLE IF EXISTS signing_keys;
