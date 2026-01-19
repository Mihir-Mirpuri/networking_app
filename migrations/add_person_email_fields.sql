-- ============================================================================
-- Migration: Add Email Fields to Person Table
-- ============================================================================
-- This migration adds email caching fields to the Person table
-- Run this in your Supabase SQL Editor or via Prisma migrate
-- ============================================================================

-- Add email fields to Person table
ALTER TABLE "Person" 
ADD COLUMN IF NOT EXISTS "email" TEXT,
ADD COLUMN IF NOT EXISTS "emailStatus" "EmailStatus",
ADD COLUMN IF NOT EXISTS "emailConfidence" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "emailLastUpdated" TIMESTAMP WITH TIME ZONE;

-- Create index on emailStatus for faster queries
CREATE INDEX IF NOT EXISTS "Person_emailStatus_idx" ON "Person"("emailStatus");

-- Add comment to document the purpose
COMMENT ON COLUMN "Person"."email" IS 'Cached email address from Apollo API (shared across all users)';
COMMENT ON COLUMN "Person"."emailStatus" IS 'Status of the cached email: VERIFIED, UNVERIFIED, or MISSING';
COMMENT ON COLUMN "Person"."emailConfidence" IS 'Confidence score from Apollo API (0-100)';
COMMENT ON COLUMN "Person"."emailLastUpdated" IS 'Timestamp when email was last fetched/updated from Apollo';
