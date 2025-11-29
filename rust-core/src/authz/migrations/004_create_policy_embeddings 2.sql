-- Migration: Create policy_embeddings table
-- Description: Vector embeddings for semantic policy search and similarity matching

CREATE TABLE IF NOT EXISTS policy_embeddings (
    policy_id UUID PRIMARY KEY,

    -- Vector embedding (OpenAI ada-002: 1536 dimensions)
    embedding vector(1536) NOT NULL,

    -- Model metadata
    model_version VARCHAR(50) NOT NULL DEFAULT 'text-embedding-ada-002',

    -- Content hash for cache invalidation
    content_hash VARCHAR(64) NOT NULL,

    -- Performance tracking
    last_accessed_at TIMESTAMP WITH TIME ZONE,
    access_count INTEGER NOT NULL DEFAULT 0,

    -- Auditing
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Foreign key to policies table
    CONSTRAINT fk_policy_embeddings_policy
        FOREIGN KEY (policy_id)
        REFERENCES policies(id)
        ON DELETE CASCADE,

    -- Ensure content_hash is unique per policy
    CONSTRAINT policy_embeddings_content_hash_unique UNIQUE (policy_id, content_hash)
);

-- HNSW index for fast cosine similarity search
-- m=16: number of bi-directional links (trade-off: build time vs search quality)
-- ef_construction=64: size of dynamic candidate list (higher = better quality, slower build)
CREATE INDEX IF NOT EXISTS idx_policy_embeddings_cosine
    ON policy_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- HNSW index for L2 distance search (alternative distance metric)
CREATE INDEX IF NOT EXISTS idx_policy_embeddings_l2
    ON policy_embeddings
    USING hnsw (embedding vector_l2_ops)
    WITH (m = 16, ef_construction = 64);

-- B-tree indexes for filtering
CREATE INDEX IF NOT EXISTS idx_policy_embeddings_model_version
    ON policy_embeddings(model_version);

CREATE INDEX IF NOT EXISTS idx_policy_embeddings_last_accessed
    ON policy_embeddings(last_accessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_policy_embeddings_access_count
    ON policy_embeddings(access_count DESC);

-- Trigger to update updated_at timestamp
CREATE TRIGGER update_policy_embeddings_updated_at
    BEFORE UPDATE ON policy_embeddings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to update access tracking
CREATE OR REPLACE FUNCTION track_embedding_access()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_accessed_at = NOW();
    NEW.access_count = OLD.access_count + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger is manually invoked by application when embedding is accessed
-- (Not automatic to avoid overhead on all queries)

-- Function: Semantic search for similar policies
CREATE OR REPLACE FUNCTION search_similar_policies(
    query_embedding vector(1536),
    similarity_threshold float DEFAULT 0.7,
    max_results integer DEFAULT 10,
    filter_tenant_id VARCHAR(255) DEFAULT NULL
)
RETURNS TABLE(
    policy_id UUID,
    similarity_score float,
    policy_name VARCHAR(255),
    policy_description TEXT,
    resource_kind VARCHAR(255),
    actions TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        pe.policy_id,
        cosine_similarity(pe.embedding, query_embedding) as similarity_score,
        p.name as policy_name,
        p.description as policy_description,
        p.resource_kind,
        p.actions
    FROM policy_embeddings pe
    JOIN policies p ON pe.policy_id = p.id
    WHERE
        cosine_similarity(pe.embedding, query_embedding) >= similarity_threshold
        AND p.enabled = true
        AND (filter_tenant_id IS NULL OR p.tenant_id = filter_tenant_id)
    ORDER BY similarity_score DESC
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function: Find policies by semantic query with metadata filtering
CREATE OR REPLACE FUNCTION search_policies_by_embedding(
    query_embedding vector(1536),
    filter_resource_kind VARCHAR(255) DEFAULT NULL,
    filter_actions TEXT[] DEFAULT NULL,
    similarity_threshold float DEFAULT 0.7,
    max_results integer DEFAULT 10
)
RETURNS TABLE(
    policy_id UUID,
    similarity_score float,
    policy_data JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        pe.policy_id,
        cosine_similarity(pe.embedding, query_embedding) as similarity_score,
        jsonb_build_object(
            'id', p.id,
            'name', p.name,
            'description', p.description,
            'resource_kind', p.resource_kind,
            'actions', p.actions,
            'definition', p.definition,
            'priority', p.priority
        ) as policy_data
    FROM policy_embeddings pe
    JOIN policies p ON pe.policy_id = p.id
    WHERE
        cosine_similarity(pe.embedding, query_embedding) >= similarity_threshold
        AND p.enabled = true
        AND (filter_resource_kind IS NULL OR p.resource_kind = filter_resource_kind)
        AND (filter_actions IS NULL OR p.actions && filter_actions)
    ORDER BY similarity_score DESC
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function: Batch update embeddings (for reindexing)
CREATE OR REPLACE FUNCTION batch_update_embeddings(
    updates JSONB
)
RETURNS TABLE(updated_count integer) AS $$
DECLARE
    update_record JSONB;
    count integer := 0;
BEGIN
    FOR update_record IN SELECT * FROM jsonb_array_elements(updates)
    LOOP
        INSERT INTO policy_embeddings (
            policy_id,
            embedding,
            model_version,
            content_hash
        )
        VALUES (
            (update_record->>'policy_id')::UUID,
            (update_record->>'embedding')::vector(1536),
            update_record->>'model_version',
            update_record->>'content_hash'
        )
        ON CONFLICT (policy_id) DO UPDATE SET
            embedding = EXCLUDED.embedding,
            model_version = EXCLUDED.model_version,
            content_hash = EXCLUDED.content_hash,
            updated_at = NOW();

        count := count + 1;
    END LOOP;

    RETURN QUERY SELECT count;
END;
$$ LANGUAGE plpgsql;

-- Function: Get embedding statistics
CREATE OR REPLACE FUNCTION get_embedding_stats()
RETURNS TABLE(
    total_embeddings bigint,
    unique_models bigint,
    avg_access_count numeric,
    most_accessed_policy UUID,
    least_accessed_policy UUID,
    oldest_embedding timestamp with time zone,
    newest_embedding timestamp with time zone
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)::bigint as total_embeddings,
        COUNT(DISTINCT model_version)::bigint as unique_models,
        AVG(access_count)::numeric as avg_access_count,
        (SELECT policy_id FROM policy_embeddings ORDER BY access_count DESC LIMIT 1) as most_accessed_policy,
        (SELECT policy_id FROM policy_embeddings ORDER BY access_count ASC LIMIT 1) as least_accessed_policy,
        MIN(created_at) as oldest_embedding,
        MAX(created_at) as newest_embedding
    FROM policy_embeddings;
END;
$$ LANGUAGE plpgsql STABLE;

-- Comments for documentation
COMMENT ON TABLE policy_embeddings IS 'Vector embeddings for semantic policy search using pgvector';
COMMENT ON COLUMN policy_embeddings.embedding IS 'Vector embedding (1536 dimensions for OpenAI ada-002)';
COMMENT ON COLUMN policy_embeddings.content_hash IS 'SHA-256 hash of policy content for cache invalidation';
COMMENT ON COLUMN policy_embeddings.model_version IS 'Embedding model version identifier';
COMMENT ON INDEX idx_policy_embeddings_cosine IS 'HNSW index for fast cosine similarity search';
COMMENT ON INDEX idx_policy_embeddings_l2 IS 'HNSW index for fast L2 distance search';
COMMENT ON FUNCTION search_similar_policies(vector, float, integer, VARCHAR) IS 'Find semantically similar policies using cosine similarity';
COMMENT ON FUNCTION search_policies_by_embedding(vector, VARCHAR, TEXT[], float, integer) IS 'Search policies with semantic matching and metadata filtering';
COMMENT ON FUNCTION batch_update_embeddings(JSONB) IS 'Batch upsert embeddings for efficient reindexing';
COMMENT ON FUNCTION get_embedding_stats() IS 'Get statistics about policy embeddings usage and coverage';
