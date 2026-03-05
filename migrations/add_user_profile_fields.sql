-- ============================================================================
-- Migration: Add Profile Fields to User Table
-- ============================================================================
-- This migration adds profile fields for email template personalization
-- Run this in your Supabase SQL Editor
-- ============================================================================

-- Add profile fields to User table
ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "classification" TEXT,
ADD COLUMN IF NOT EXISTS "major" TEXT,
ADD COLUMN IF NOT EXISTS "university" TEXT,
ADD COLUMN IF NOT EXISTS "career" TEXT;

-- Add comments to document the purpose
COMMENT ON COLUMN "User"."classification" IS 'User classification (e.g., Freshman, Sophomore, Junior, Senior)';
COMMENT ON COLUMN "User"."major" IS 'User major/field of study';
COMMENT ON COLUMN "User"."university" IS 'User university name';
COMMENT ON COLUMN "User"."career" IS 'User career interest/industry';
