-- Migration: Rollback pgvector extension
-- Description: Removes pgvector extension and helper functions
-- Version: 11
-- Date: 2025-11-28

-- Drop helper functions
DROP FUNCTION IF EXISTS l2_distance_normalized(vector, vector);
DROP FUNCTION IF EXISTS cosine_similarity(vector, vector);

-- Drop extension (will cascade to all vector columns)
-- WARNING: This will remove all vector data!
DROP EXTENSION IF EXISTS vector CASCADE;
