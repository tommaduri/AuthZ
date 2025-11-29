-- Migration: Create policies table
-- Description: PostgreSQL schema for policy storage with JSONB and indexing

CREATE TABLE IF NOT EXISTS policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Policy identification
    name VARCHAR(255) NOT NULL,
    version VARCHAR(50) NOT NULL DEFAULT '1.0',

    -- Policy content (JSONB for flexibility)
    definition JSONB NOT NULL,

    -- Indexable fields extracted from definition
    resource_kind VARCHAR(255),
    actions TEXT[], -- Array of actions (read, write, delete, etc.)
    scope VARCHAR(255),

    -- Principal/role targeting
    principal_type VARCHAR(50), -- user, role, group
    principal_ids TEXT[], -- Specific principal IDs
    roles TEXT[], -- Roles this policy applies to

    -- Policy metadata
    description TEXT,
    enabled BOOLEAN NOT NULL DEFAULT true,
    priority INTEGER NOT NULL DEFAULT 0,

    -- Auditing
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by VARCHAR(255),
    updated_by VARCHAR(255),

    -- Multi-tenancy support
    tenant_id VARCHAR(255) DEFAULT 'default',

    CONSTRAINT policies_name_tenant_unique UNIQUE (name, tenant_id)
);

-- Indexes for fast policy lookup
CREATE INDEX IF NOT EXISTS idx_policies_resource_kind ON policies(resource_kind);
CREATE INDEX IF NOT EXISTS idx_policies_actions ON policies USING GIN (actions);
CREATE INDEX IF NOT EXISTS idx_policies_roles ON policies USING GIN (roles);
CREATE INDEX IF NOT EXISTS idx_policies_principal_ids ON policies USING GIN (principal_ids);
CREATE INDEX IF NOT EXISTS idx_policies_scope ON policies(scope);
CREATE INDEX IF NOT EXISTS idx_policies_tenant_id ON policies(tenant_id);
CREATE INDEX IF NOT EXISTS idx_policies_enabled ON policies(enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_policies_definition ON policies USING GIN (definition);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
CREATE TRIGGER update_policies_updated_at BEFORE UPDATE ON policies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE policies IS 'Authorization policies with JSONB storage and GIN indexing';
COMMENT ON COLUMN policies.definition IS 'Full policy definition in JSONB format';
COMMENT ON COLUMN policies.actions IS 'Extracted actions array for fast querying';
COMMENT ON COLUMN policies.roles IS 'Roles this policy applies to (for role-based lookups)';
