-- Migration: Rollback policy embeddings table
-- Description: Removes policy_embeddings table and related objects
-- Version: 13
-- Date: 2025-11-28

-- Drop view
DROP VIEW IF EXISTS policy_embedding_stats;

-- Drop functions
DROP FUNCTION IF EXISTS identify_stale_embeddings(INTEGER);
DROP FUNCTION IF EXISTS upsert_policy_embedding(TEXT, TEXT, vector, TEXT, TEXT, TEXT, JSONB, TEXT);
DROP FUNCTION IF EXISTS update_embedding_stats(UUID);
DROP FUNCTION IF EXISTS search_similar_policies(vector, TEXT, FLOAT8, INTEGER, TEXT);
DROP FUNCTION IF EXISTS update_policy_embeddings_updated_at();

-- Drop trigger
DROP TRIGGER IF EXISTS policy_embeddings_updated_at_trigger ON policy_embeddings;

-- Drop policies
DROP POLICY IF EXISTS policy_embeddings_delete_policy ON policy_embeddings;
DROP POLICY IF EXISTS policy_embeddings_update_policy ON policy_embeddings;
DROP POLICY IF EXISTS policy_embeddings_insert_policy ON policy_embeddings;
DROP POLICY IF EXISTS policy_embeddings_tenant_isolation ON policy_embeddings;

-- Drop indexes (will be dropped with table, but explicit for clarity)
DROP INDEX IF EXISTS idx_policy_embeddings_search_count;
DROP INDEX IF EXISTS idx_policy_embeddings_last_used;
DROP INDEX IF EXISTS idx_policy_embeddings_model_version;
DROP INDEX IF EXISTS idx_policy_embeddings_content_hash;
DROP INDEX IF EXISTS idx_policy_embeddings_policy_id;
DROP INDEX IF EXISTS idx_policy_embeddings_tenant_id;
DROP INDEX IF EXISTS idx_policy_embeddings_hnsw_l2;
-- DROP INDEX IF EXISTS idx_policy_embeddings_ivfflat_cosine;  -- If created
DROP INDEX IF EXISTS idx_policy_embeddings_hnsw_cosine;

-- Drop table
DROP TABLE IF EXISTS policy_embeddings;
