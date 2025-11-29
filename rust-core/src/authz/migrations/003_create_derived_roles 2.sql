-- Migration: Create derived_roles table
-- Description: Support for hierarchical role inheritance with conditional logic

CREATE TABLE IF NOT EXISTS derived_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Role identification
    name VARCHAR(255) NOT NULL,
    description TEXT,

    -- Role hierarchy
    parent_roles TEXT[] NOT NULL DEFAULT '{}', -- Array of parent role names

    -- Conditional logic (optional CEL expression)
    -- Example: "request.time > timestamp('2024-01-01T00:00:00Z')"
    condition JSONB,

    -- Priority for conflict resolution (higher = higher priority)
    priority INTEGER NOT NULL DEFAULT 0,

    -- Multi-tenancy support
    tenant_id VARCHAR(255) NOT NULL DEFAULT 'default',

    -- Optimistic locking for concurrent updates
    version INTEGER NOT NULL DEFAULT 1,

    -- Metadata
    enabled BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB,

    -- Auditing
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by VARCHAR(255),
    updated_by VARCHAR(255),

    -- Constraints
    CONSTRAINT derived_roles_name_tenant_unique UNIQUE (name, tenant_id),
    CONSTRAINT derived_roles_priority_check CHECK (priority >= 0 AND priority <= 1000),
    CONSTRAINT derived_roles_version_check CHECK (version > 0)
);

-- Indexes for fast role lookup and traversal
CREATE INDEX IF NOT EXISTS idx_derived_roles_parent_roles
    ON derived_roles USING GIN (parent_roles);

CREATE INDEX IF NOT EXISTS idx_derived_roles_tenant_id
    ON derived_roles(tenant_id);

CREATE INDEX IF NOT EXISTS idx_derived_roles_enabled
    ON derived_roles(enabled) WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_derived_roles_priority
    ON derived_roles(priority DESC);

CREATE INDEX IF NOT EXISTS idx_derived_roles_condition
    ON derived_roles USING GIN (condition) WHERE condition IS NOT NULL;

-- Unique index on (name, tenant_id) for fast lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_derived_roles_name_tenant
    ON derived_roles(name, tenant_id);

-- Trigger to automatically update updated_at and increment version
CREATE OR REPLACE FUNCTION update_derived_roles_metadata()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    NEW.version = OLD.version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_derived_roles_metadata_trigger
    BEFORE UPDATE ON derived_roles
    FOR EACH ROW
    EXECUTE FUNCTION update_derived_roles_metadata();

-- Function to check for circular dependencies in role hierarchy
CREATE OR REPLACE FUNCTION check_role_hierarchy_cycles()
RETURNS TRIGGER AS $$
DECLARE
    visited_roles TEXT[] := ARRAY[NEW.name];
    roles_to_check TEXT[] := NEW.parent_roles;
    current_role TEXT;
    parent_list TEXT[];
BEGIN
    -- Prevent self-reference
    IF NEW.name = ANY(NEW.parent_roles) THEN
        RAISE EXCEPTION 'Role cannot be its own parent: %', NEW.name;
    END IF;

    -- Check for cycles using BFS
    WHILE array_length(roles_to_check, 1) > 0 LOOP
        current_role := roles_to_check[1];
        roles_to_check := roles_to_check[2:array_length(roles_to_check, 1)];

        -- If we've seen this role before, we have a cycle
        IF current_role = ANY(visited_roles) THEN
            RAISE EXCEPTION 'Circular dependency detected in role hierarchy: %', current_role;
        END IF;

        visited_roles := visited_roles || current_role;

        -- Get parent roles of current role
        SELECT parent_roles INTO parent_list
        FROM derived_roles
        WHERE name = current_role AND tenant_id = NEW.tenant_id;

        -- Add parents to check list
        IF parent_list IS NOT NULL THEN
            roles_to_check := roles_to_check || parent_list;
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_derived_roles_cycles
    BEFORE INSERT OR UPDATE ON derived_roles
    FOR EACH ROW
    EXECUTE FUNCTION check_role_hierarchy_cycles();

-- Function to get all inherited roles (including transitive)
CREATE OR REPLACE FUNCTION get_inherited_roles(
    role_name VARCHAR(255),
    tenant VARCHAR(255) DEFAULT 'default'
)
RETURNS TABLE(inherited_role VARCHAR(255), depth INTEGER) AS $$
WITH RECURSIVE role_hierarchy AS (
    -- Base case: direct parents
    SELECT
        unnest(parent_roles) as inherited_role,
        1 as depth,
        ARRAY[name] as path
    FROM derived_roles
    WHERE name = role_name AND tenant_id = tenant AND enabled = true

    UNION

    -- Recursive case: parents of parents
    SELECT
        unnest(dr.parent_roles) as inherited_role,
        rh.depth + 1 as depth,
        rh.path || dr.name as path
    FROM role_hierarchy rh
    JOIN derived_roles dr ON dr.name = rh.inherited_role AND dr.tenant_id = tenant
    WHERE NOT (dr.name = ANY(rh.path)) -- Prevent cycles
        AND dr.enabled = true
        AND rh.depth < 10 -- Maximum depth limit
)
SELECT DISTINCT inherited_role, MIN(depth) as depth
FROM role_hierarchy
GROUP BY inherited_role
ORDER BY depth, inherited_role;
$$ LANGUAGE sql STABLE;

-- Row Level Security (RLS) policies for multi-tenancy
ALTER TABLE derived_roles ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see roles in their tenant
CREATE POLICY derived_roles_tenant_isolation ON derived_roles
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant', TRUE)::VARCHAR);

-- Policy: Users can only modify roles in their tenant
CREATE POLICY derived_roles_tenant_modification ON derived_roles
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', TRUE)::VARCHAR)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', TRUE)::VARCHAR);

-- Comments for documentation
COMMENT ON TABLE derived_roles IS 'Hierarchical role definitions with inheritance and conditional logic';
COMMENT ON COLUMN derived_roles.parent_roles IS 'Array of parent role names for inheritance';
COMMENT ON COLUMN derived_roles.condition IS 'Optional CEL expression for conditional role activation';
COMMENT ON COLUMN derived_roles.priority IS 'Priority for conflict resolution (0-1000, higher wins)';
COMMENT ON COLUMN derived_roles.version IS 'Version number for optimistic locking';
COMMENT ON FUNCTION get_inherited_roles(VARCHAR, VARCHAR) IS 'Get all inherited roles transitively with depth';
COMMENT ON FUNCTION check_role_hierarchy_cycles() IS 'Prevent circular dependencies in role hierarchy';
