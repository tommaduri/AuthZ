-- Migration: Enable pgvector extension and create helper functions
-- Description: Vector similarity search support for policy embeddings

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Helper function: Cosine similarity (returns 0-1, higher is more similar)
CREATE OR REPLACE FUNCTION cosine_similarity(a vector, b vector)
RETURNS float AS $$
BEGIN
    RETURN 1 - (a <=> b);
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

-- Helper function: Normalized L2 distance (returns 0-1, lower is more similar)
CREATE OR REPLACE FUNCTION l2_distance_normalized(a vector, b vector)
RETURNS float AS $$
DECLARE
    max_distance float := sqrt(2); -- Maximum possible L2 distance for normalized vectors
BEGIN
    RETURN (a <-> b) / max_distance;
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

-- Helper function: Check if vectors are normalized (for validation)
CREATE OR REPLACE FUNCTION is_vector_normalized(v vector, tolerance float DEFAULT 0.01)
RETURNS boolean AS $$
DECLARE
    magnitude float;
BEGIN
    -- Calculate magnitude using inner product with itself
    magnitude := sqrt(v <#> v);
    RETURN abs(magnitude - 1.0) < tolerance;
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

-- Comments for documentation
COMMENT ON EXTENSION vector IS 'Vector similarity search extension (pgvector)';
COMMENT ON FUNCTION cosine_similarity(vector, vector) IS 'Cosine similarity between two vectors (0-1, higher = more similar)';
COMMENT ON FUNCTION l2_distance_normalized(vector, vector) IS 'Normalized L2 distance between vectors (0-1, lower = more similar)';
COMMENT ON FUNCTION is_vector_normalized(vector, float) IS 'Check if a vector is normalized (magnitude ≈ 1)';
