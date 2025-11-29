-- Migration: Enable pgvector extension for vector similarity search
-- Description: Adds pgvector extension support for policy embeddings and semantic search
-- Version: 11
-- Date: 2025-11-28

-- Enable pgvector extension for vector operations
-- This extension provides vector data types and similarity search functions
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify extension is loaded
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
    ) THEN
        RAISE EXCEPTION 'Failed to load pgvector extension';
    END IF;
END $$;

-- Add comments for documentation
COMMENT ON EXTENSION vector IS 'Vector data type and ivfflat/hnsw access methods for similarity search';

-- Create helper function for cosine similarity (used for policy matching)
CREATE OR REPLACE FUNCTION cosine_similarity(a vector, b vector)
RETURNS float8
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
    SELECT 1 - (a <=> b);
$$;

COMMENT ON FUNCTION cosine_similarity IS 'Calculate cosine similarity between two vectors (returns 0-1, higher is more similar)';

-- Create helper function for L2 distance normalization
CREATE OR REPLACE FUNCTION l2_distance_normalized(a vector, b vector)
RETURNS float8
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
    SELECT 1 / (1 + (a <-> b));
$$;

COMMENT ON FUNCTION l2_distance_normalized IS 'Calculate normalized L2 distance (returns 0-1, higher is more similar)';
