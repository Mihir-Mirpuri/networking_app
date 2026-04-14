-- ============================================================================
-- Retrieval V2 Migration: pg_trgm + HNSW + composite indexes
--
-- Prerequisites: pgvector 0.8.0 already installed
-- Run via Supabase SQL editor (not prisma migrate)
-- All statements are idempotent (safe to re-run)
--
-- Usage: paste into Supabase SQL editor and execute
-- NOTE: CONCURRENTLY cannot run inside a transaction block. If running in
--       Supabase SQL editor, execute each CREATE INDEX CONCURRENTLY statement
--       separately, or remove CONCURRENTLY and accept a brief table lock.
-- ============================================================================

-- Step 1: Enable pg_trgm extension for fuzzy text matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Step 2: Set default similarity threshold for the % operator
-- 0.3 is the pg_trgm default; we set it explicitly for clarity.
-- This affects the session, not a permanent setting. The V2 function
-- sets it per-query via SET LOCAL for safety.
SELECT set_limit(0.3);

-- Step 3: GIN trigram index on company column
-- Supports the % (similarity) operator for fuzzy company matching.
-- Use IF NOT EXISTS to make this idempotent.
CREATE INDEX IF NOT EXISTS idx_person_company_trgm
  ON "Person" USING GIN (company gin_trgm_ops);

-- Step 4: GIN trigram index on role column
-- Supports potential future trgm-based role search as a fallback.
CREATE INDEX IF NOT EXISTS idx_person_role_trgm
  ON "Person" USING GIN (role gin_trgm_ops);

-- Step 5: HNSW vector index on role_embedding (cosine distance)
-- Accelerates ORDER BY (role_embedding <=> query_vector) queries.
-- m=16, ef_construction=64 are good defaults for 10K rows.
-- Note: IF NOT EXISTS is not supported for HNSW indexes in pgvector 0.8.0.
-- The DO block checks for existence first.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_person_role_embedding_hnsw'
  ) THEN
    CREATE INDEX idx_person_role_embedding_hnsw
      ON "Person" USING hnsw (role_embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
  END IF;
END
$$;

-- Step 6: Composite btree index for the common filter pattern
-- (company + email IS NOT NULL). Speeds up the most frequent query shape.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_person_company_email'
  ) THEN
    CREATE INDEX idx_person_company_email
      ON "Person" (company, email) WHERE email IS NOT NULL;
  END IF;
END
$$;

-- Verification: list all indexes on Person table
-- SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'Person';
