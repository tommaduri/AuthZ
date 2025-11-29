-- Create signing keys table for RSA key rotation
CREATE TABLE IF NOT EXISTS signing_keys (
    kid VARCHAR(36) PRIMARY KEY,
    private_key_encrypted TEXT NOT NULL,
    public_key TEXT NOT NULL,
    algorithm VARCHAR(10) NOT NULL DEFAULT 'RS256',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    CONSTRAINT chk_status CHECK (status IN ('pending', 'active', 'expired'))
);

-- Create index for status lookups
CREATE INDEX idx_signing_keys_status ON signing_keys(status);

-- Create index for expiration cleanup queries
CREATE INDEX idx_signing_keys_expires_at ON signing_keys(expires_at) WHERE expires_at IS NOT NULL;

-- Add comment
COMMENT ON TABLE signing_keys IS 'Stores RSA signing keys for JWT token generation with rotation support';
COMMENT ON COLUMN signing_keys.kid IS 'Key ID - unique identifier used in JWT header';
COMMENT ON COLUMN signing_keys.private_key_encrypted IS 'PGP encrypted private key in PEM format';
COMMENT ON COLUMN signing_keys.public_key IS 'Public key in PEM format for JWKS endpoint';
COMMENT ON COLUMN signing_keys.status IS 'Key status: pending (not yet active), active (currently in use), expired (grace period ended)';
