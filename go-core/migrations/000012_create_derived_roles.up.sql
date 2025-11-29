-- Migration: Create derived roles table
-- Description: Supports hierarchical role inheritance with conditions and priorities
-- Version: 12
-- Date: 2025-11-28

-- Derived Roles table
-- Enables dynamic role assignment based on parent roles and conditions
CREATE TABLE IF NOT EXISTS derived_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Role identification
    name TEXT NOT NULL,
    description TEXT,

    -- Hierarchy definition
    parent_roles TEXT[] NOT NULL DEFAULT '{}',
    condition JSONB DEFAULT NULL,

    -- Priority and ordering
    priority INTEGER NOT NULL DEFAULT 100,

    -- Multi-tenancy
    tenant_id TEXT NOT NULL,

    -- Metadata and versioning
    metadata JSONB DEFAULT '{}'::jsonb,
    version INTEGER NOT NULL DEFAULT 1,

    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by TEXT,
    updated_by TEXT,

    -- State management
    enabled BOOLEAN NOT NULL DEFAULT true,

    -- Constraints
    CONSTRAINT derived_roles_name_tenant_unique UNIQUE (name, tenant_id),
    CONSTRAINT derived_roles_name_check CHECK (length(name) > 0 AND length(name) <= 255),
    CONSTRAINT derived_roles_tenant_id_check CHECK (length(tenant_id) > 0),
    CONSTRAINT derived_roles_priority_check CHECK (priority >= 0 AND priority <= 1000),
    CONSTRAINT derived_roles_parent_roles_check CHECK (
        parent_roles IS NOT NULL AND
        array_length(parent_roles, 1) > 0 AND
        array_length(parent_roles, 1) <= 50
    ),
    CONSTRAINT derived_roles_condition_structure_check CHECK (
        condition IS NULL OR
        (jsonb_typeof(condition) = 'object')
    )
);

-- Add table and column comments
COMMENT ON TABLE derived_roles IS 'Hierarchical role definitions with conditional inheritance and priority-based resolution';
COMMENT ON COLUMN derived_roles.name IS 'Unique role name within tenant scope';
COMMENT ON COLUMN derived_roles.parent_roles IS 'Array of parent role names this role inherits from';
COMMENT ON COLUMN derived_roles.condition IS 'Optional JSONB condition for dynamic role assignment (CEL expression context)';
COMMENT ON COLUMN derived_roles.priority IS 'Priority for conflict resolution (0-1000, higher = higher priority)';
COMMENT ON COLUMN derived_roles.version IS 'Optimistic locking version for concurrent updates';
COMMENT ON COLUMN derived_roles.enabled IS 'Whether this role is currently active';

-- Create indexes for efficient querying
-- GIN index for parent_roles array searches
CREATE INDEX idx_derived_roles_parent_roles_gin
    ON derived_roles USING GIN (parent_roles);

-- Index for tenant-scoped queries
CREATE INDEX idx_derived_roles_tenant_id
    ON derived_roles (tenant_id, enabled)
    WHERE enabled = true;

-- Index for priority-based ordering
CREATE INDEX idx_derived_roles_priority
    ON derived_roles (tenant_id, priority DESC, name);

-- Index for name lookups (covered index)
CREATE INDEX idx_derived_roles_name_tenant
    ON derived_roles (name, tenant_id)
    INCLUDE (parent_roles, priority, enabled);

-- Index for conditional roles (sparse index)
CREATE INDEX idx_derived_roles_conditional
    ON derived_roles (tenant_id)
    WHERE condition IS NOT NULL AND enabled = true;

-- Index for audit queries
CREATE INDEX idx_derived_roles_created_at
    ON derived_roles (tenant_id, created_at DESC);

CREATE INDEX idx_derived_roles_updated_at
    ON derived_roles (tenant_id, updated_at DESC);

-- Enable Row-Level Security
ALTER TABLE derived_roles ENABLE ROW LEVEL SECURITY;

-- RLS Policies for tenant isolation
CREATE POLICY derived_roles_tenant_isolation ON derived_roles
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant', true));

CREATE POLICY derived_roles_insert_policy ON derived_roles
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true));

CREATE POLICY derived_roles_update_policy ON derived_roles
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant', true))
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true));

CREATE POLICY derived_roles_delete_policy ON derived_roles
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant', true));

-- Create trigger for updated_at timestamp
CREATE OR REPLACE FUNCTION update_derived_roles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    NEW.version = OLD.version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER derived_roles_updated_at_trigger
    BEFORE UPDATE ON derived_roles
    FOR EACH ROW
    EXECUTE FUNCTION update_derived_roles_updated_at();

COMMENT ON TRIGGER derived_roles_updated_at_trigger ON derived_roles IS 'Automatically update timestamp and version on row modification';

-- Create materialized view for role hierarchy resolution
-- This can be refreshed periodically for performance optimization
CREATE MATERIALIZED VIEW derived_roles_hierarchy AS
WITH RECURSIVE role_tree AS (
    -- Base case: direct roles
    SELECT
        id,
        name,
        ARRAY[name] as role_path,
        parent_roles,
        priority,
        tenant_id,
        0 as depth
    FROM derived_roles
    WHERE enabled = true

    UNION ALL

    -- Recursive case: inherited roles
    SELECT
        dr.id,
        dr.name,
        rt.role_path || dr.name,
        dr.parent_roles,
        dr.priority,
        dr.tenant_id,
        rt.depth + 1
    FROM derived_roles dr
    INNER JOIN role_tree rt ON dr.name = ANY(rt.parent_roles)
    WHERE
        dr.enabled = true
        AND rt.depth < 10  -- Prevent infinite loops
        AND NOT dr.name = ANY(rt.role_path)  -- Prevent cycles
)
SELECT
    id,
    name,
    role_path,
    parent_roles,
    priority,
    tenant_id,
    depth,
    array_length(role_path, 1) as path_length
FROM role_tree;

COMMENT ON MATERIALIZED VIEW derived_roles_hierarchy IS 'Pre-computed role hierarchy tree for efficient inheritance resolution';

-- Create index on materialized view
CREATE INDEX idx_derived_roles_hierarchy_tenant
    ON derived_roles_hierarchy (tenant_id, name);

CREATE INDEX idx_derived_roles_hierarchy_depth
    ON derived_roles_hierarchy (tenant_id, depth);

-- Create function to refresh hierarchy view
CREATE OR REPLACE FUNCTION refresh_derived_roles_hierarchy()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY derived_roles_hierarchy;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_derived_roles_hierarchy IS 'Refresh the role hierarchy materialized view';

-- Create trigger to auto-refresh on role changes (optional, can be commented out for manual refresh)
-- Uncomment for automatic refresh (may impact write performance)
/*
CREATE OR REPLACE FUNCTION derived_roles_hierarchy_refresh_trigger()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM refresh_derived_roles_hierarchy();
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER derived_roles_hierarchy_auto_refresh
    AFTER INSERT OR UPDATE OR DELETE ON derived_roles
    FOR EACH STATEMENT
    EXECUTE FUNCTION derived_roles_hierarchy_refresh_trigger();
*/
