-- Migration: Rollback derived roles table
-- Description: Removes derived_roles table and related objects
-- Version: 12
-- Date: 2025-11-28

-- Drop triggers
-- DROP TRIGGER IF EXISTS derived_roles_hierarchy_auto_refresh ON derived_roles;
DROP TRIGGER IF EXISTS derived_roles_updated_at_trigger ON derived_roles;

-- Drop functions
-- DROP FUNCTION IF EXISTS derived_roles_hierarchy_refresh_trigger();
DROP FUNCTION IF EXISTS refresh_derived_roles_hierarchy();
DROP FUNCTION IF EXISTS update_derived_roles_updated_at();

-- Drop materialized view
DROP MATERIALIZED VIEW IF EXISTS derived_roles_hierarchy;

-- Drop policies
DROP POLICY IF EXISTS derived_roles_delete_policy ON derived_roles;
DROP POLICY IF EXISTS derived_roles_update_policy ON derived_roles;
DROP POLICY IF EXISTS derived_roles_insert_policy ON derived_roles;
DROP POLICY IF EXISTS derived_roles_tenant_isolation ON derived_roles;

-- Drop indexes (will be dropped with table, but explicit for clarity)
DROP INDEX IF EXISTS idx_derived_roles_updated_at;
DROP INDEX IF EXISTS idx_derived_roles_created_at;
DROP INDEX IF EXISTS idx_derived_roles_conditional;
DROP INDEX IF EXISTS idx_derived_roles_name_tenant;
DROP INDEX IF EXISTS idx_derived_roles_priority;
DROP INDEX IF EXISTS idx_derived_roles_tenant_id;
DROP INDEX IF EXISTS idx_derived_roles_parent_roles_gin;

-- Drop table
DROP TABLE IF EXISTS derived_roles;
