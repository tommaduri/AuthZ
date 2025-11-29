-- Migration: Create policy embeddings table
-- Description: Stores vector embeddings for semantic policy matching and pattern optimization
-- Version: 13
-- Date: 2025-11-28
-- Dependencies: Requires pgvector extension (migration 000011)

-- Policy Embeddings table
-- Stores vector representations of policies for semantic similarity search
CREATE TABLE IF NOT EXISTS policy_embeddings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Policy reference
    policy_id TEXT NOT NULL,
    policy_type TEXT NOT NULL,

    -- Vector embedding
    embedding vector(1536) NOT NULL,  -- OpenAI ada-002 embedding size

    -- Embedding metadata
    model_version TEXT NOT NULL,
    embedding_model TEXT NOT NULL DEFAULT 'text-embedding-ada-002',

    -- Policy content hash for invalidation
    content_hash TEXT NOT NULL,

    -- Multi-tenancy
    tenant_id TEXT NOT NULL,

    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,

    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Statistics
    similarity_search_count INTEGER NOT NULL DEFAULT 0,
    last_used_at TIMESTAMP WITH TIME ZONE,

    -- Constraints
    CONSTRAINT policy_embeddings_policy_id_tenant_unique UNIQUE (policy_id, tenant_id),
    CONSTRAINT policy_embeddings_policy_id_check CHECK (length(policy_id) > 0),
    CONSTRAINT policy_embeddings_policy_type_check CHECK (policy_type IN (
        'access_policy', 'permission_policy', 'role_policy',
        'resource_policy', 'derived_role', 'condition_policy'
    )),
    CONSTRAINT policy_embeddings_tenant_id_check CHECK (length(tenant_id) > 0),
    CONSTRAINT policy_embeddings_model_version_check CHECK (length(model_version) > 0),
    CONSTRAINT policy_embeddings_content_hash_check CHECK (length(content_hash) = 64) -- SHA-256 hex
);

-- Add table and column comments
COMMENT ON TABLE policy_embeddings IS 'Vector embeddings for semantic policy similarity search and pattern matching optimization';
COMMENT ON COLUMN policy_embeddings.embedding IS 'Vector embedding of policy content (1536 dimensions for OpenAI ada-002)';
COMMENT ON COLUMN policy_embeddings.model_version IS 'Version identifier of the embedding model used';
COMMENT ON COLUMN policy_embeddings.content_hash IS 'SHA-256 hash of policy content for cache invalidation';
COMMENT ON COLUMN policy_embeddings.similarity_search_count IS 'Number of times this embedding was used in similarity searches';

-- Create HNSW index for fast approximate nearest neighbor search
-- HNSW (Hierarchical Navigable Small World) is optimal for high-dimensional vectors
CREATE INDEX idx_policy_embeddings_hnsw_cosine
    ON policy_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

COMMENT ON INDEX idx_policy_embeddings_hnsw_cosine IS 'HNSW index for cosine similarity search (optimal for normalized embeddings)';

-- Alternative: IVFFlat index (faster build time, slightly slower search)
-- Uncomment if HNSW build time is too long for large datasets
/*
CREATE INDEX idx_policy_embeddings_ivfflat_cosine
    ON policy_embeddings
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
*/

-- Create additional HNSW index for L2 distance (Euclidean)
CREATE INDEX idx_policy_embeddings_hnsw_l2
    ON policy_embeddings
    USING hnsw (embedding vector_l2_ops)
    WITH (m = 16, ef_construction = 64);

COMMENT ON INDEX idx_policy_embeddings_hnsw_l2 IS 'HNSW index for L2 distance search (Euclidean distance)';

-- Create indexes for efficient querying
-- Index for tenant-scoped queries
CREATE INDEX idx_policy_embeddings_tenant_id
    ON policy_embeddings (tenant_id, policy_type);

-- Index for policy lookups
CREATE INDEX idx_policy_embeddings_policy_id
    ON policy_embeddings (policy_id, tenant_id);

-- Index for content hash verification
CREATE INDEX idx_policy_embeddings_content_hash
    ON policy_embeddings (content_hash, tenant_id);

-- Index for model version queries (for migration/upgrade scenarios)
CREATE INDEX idx_policy_embeddings_model_version
    ON policy_embeddings (model_version, tenant_id);

-- Index for audit and statistics
CREATE INDEX idx_policy_embeddings_last_used
    ON policy_embeddings (tenant_id, last_used_at DESC NULLS LAST);

CREATE INDEX idx_policy_embeddings_search_count
    ON policy_embeddings (tenant_id, similarity_search_count DESC);

-- Enable Row-Level Security
ALTER TABLE policy_embeddings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for tenant isolation
CREATE POLICY policy_embeddings_tenant_isolation ON policy_embeddings
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant', true));

CREATE POLICY policy_embeddings_insert_policy ON policy_embeddings
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true));

CREATE POLICY policy_embeddings_update_policy ON policy_embeddings
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant', true))
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true));

CREATE POLICY policy_embeddings_delete_policy ON policy_embeddings
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant', true));

-- Create trigger for updated_at timestamp
CREATE OR REPLACE FUNCTION update_policy_embeddings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER policy_embeddings_updated_at_trigger
    BEFORE UPDATE ON policy_embeddings
    FOR EACH ROW
    EXECUTE FUNCTION update_policy_embeddings_updated_at();

-- Create function for semantic policy search
CREATE OR REPLACE FUNCTION search_similar_policies(
    query_embedding vector(1536),
    query_tenant_id TEXT,
    similarity_threshold FLOAT8 DEFAULT 0.8,
    max_results INTEGER DEFAULT 10,
    policy_type_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
    policy_id TEXT,
    policy_type TEXT,
    similarity_score FLOAT8,
    content_hash TEXT,
    metadata JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        pe.policy_id,
        pe.policy_type,
        cosine_similarity(pe.embedding, query_embedding) as similarity_score,
        pe.content_hash,
        pe.metadata
    FROM policy_embeddings pe
    WHERE
        pe.tenant_id = query_tenant_id
        AND (policy_type_filter IS NULL OR pe.policy_type = policy_type_filter)
        AND cosine_similarity(pe.embedding, query_embedding) >= similarity_threshold
    ORDER BY pe.embedding <=> query_embedding  -- Cosine distance operator
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION search_similar_policies IS 'Search for semantically similar policies using vector embeddings';

-- Create function to update search statistics
CREATE OR REPLACE FUNCTION update_embedding_stats(
    embedding_id UUID
)
RETURNS void AS $$
BEGIN
    UPDATE policy_embeddings
    SET
        similarity_search_count = similarity_search_count + 1,
        last_used_at = NOW()
    WHERE id = embedding_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_embedding_stats IS 'Increment usage statistics for policy embedding';

-- Create function to batch upsert embeddings
CREATE OR REPLACE FUNCTION upsert_policy_embedding(
    p_policy_id TEXT,
    p_policy_type TEXT,
    p_embedding vector(1536),
    p_model_version TEXT,
    p_content_hash TEXT,
    p_tenant_id TEXT,
    p_metadata JSONB DEFAULT '{}'::jsonb,
    p_embedding_model TEXT DEFAULT 'text-embedding-ada-002'
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO policy_embeddings (
        policy_id,
        policy_type,
        embedding,
        model_version,
        embedding_model,
        content_hash,
        tenant_id,
        metadata
    ) VALUES (
        p_policy_id,
        p_policy_type,
        p_embedding,
        p_model_version,
        p_embedding_model,
        p_content_hash,
        p_tenant_id,
        p_metadata
    )
    ON CONFLICT (policy_id, tenant_id)
    DO UPDATE SET
        embedding = EXCLUDED.embedding,
        model_version = EXCLUDED.model_version,
        content_hash = EXCLUDED.content_hash,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION upsert_policy_embedding IS 'Insert or update policy embedding with content hash validation';

-- Create view for embedding statistics
CREATE VIEW policy_embedding_stats AS
SELECT
    tenant_id,
    policy_type,
    COUNT(*) as total_embeddings,
    AVG(similarity_search_count) as avg_search_count,
    MAX(last_used_at) as most_recent_use,
    COUNT(DISTINCT model_version) as model_versions,
    pg_size_pretty(pg_total_relation_size('policy_embeddings')) as total_size
FROM policy_embeddings
GROUP BY tenant_id, policy_type;

COMMENT ON VIEW policy_embedding_stats IS 'Aggregated statistics for policy embeddings by tenant and type';

-- Create function to identify stale embeddings (not used in 90 days)
CREATE OR REPLACE FUNCTION identify_stale_embeddings(
    days_threshold INTEGER DEFAULT 90
)
RETURNS TABLE (
    id UUID,
    policy_id TEXT,
    tenant_id TEXT,
    days_since_use INTEGER,
    similarity_search_count INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        pe.id,
        pe.policy_id,
        pe.tenant_id,
        EXTRACT(DAY FROM NOW() - COALESCE(pe.last_used_at, pe.created_at))::INTEGER as days_since_use,
        pe.similarity_search_count
    FROM policy_embeddings pe
    WHERE
        COALESCE(pe.last_used_at, pe.created_at) < NOW() - (days_threshold || ' days')::INTERVAL
    ORDER BY COALESCE(pe.last_used_at, pe.created_at) ASC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION identify_stale_embeddings IS 'Identify embeddings not used recently for potential cleanup';
