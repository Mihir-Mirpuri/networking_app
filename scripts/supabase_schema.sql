-- ============================================================================
-- MVP Database Schema for Networking App
-- Supabase PostgreSQL
-- ============================================================================
-- This script creates all tables, enums, constraints, and indexes for the MVP
-- Run this in your Supabase SQL Editor
-- ============================================================================

-- ============================================================================
-- STEP 1: Create Enums
-- ============================================================================

-- Email status for user-person relationships
CREATE TYPE "EmailStatus" AS ENUM (
  'MISSING',      -- Email not found
  'UNVERIFIED',   -- Email found but not verified
  'VERIFIED',     -- Email verified
  'MANUAL'        -- Email entered manually
);

-- Source link types
CREATE TYPE "SourceLinkKind" AS ENUM (
  'DISCOVERY',    -- Found during person discovery
  'RESEARCH'      -- Found during research phase
);

-- Send log status
CREATE TYPE "SendLogStatus" AS ENUM (
  'SUCCESS',      -- Email sent successfully
  'FAILED'        -- Email failed to send
);

-- Email draft status
CREATE TYPE "EmailDraftStatus" AS ENUM (
  'PENDING',      -- Generated, waiting for user review
  'APPROVED',     -- User approved, ready to send
  'REJECTED',     -- User rejected this draft
  'SENT'          -- Successfully sent
);

-- ============================================================================
-- STEP 2: Create Core User & Authentication Tables
-- ============================================================================

-- User table - Main user account data
CREATE TABLE "User" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT,
  "email" TEXT UNIQUE,
  "emailVerified" TIMESTAMP WITH TIME ZONE,
  "image" TEXT,
  "dailySendCount" INTEGER NOT NULL DEFAULT 0,
  "lastSendDate" TIMESTAMP WITH TIME ZONE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Account table - Gmail OAuth connections
CREATE TABLE "Account" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "refresh_token" TEXT,
  "access_token" TEXT,
  "expires_at" INTEGER,
  "token_type" TEXT,
  "scope" TEXT,
  "id_token" TEXT,
  "session_state" TEXT,
  "refresh_token_expires_in" INTEGER,
  CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") 
    REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "Account_provider_providerAccountId_key" 
    UNIQUE ("provider", "providerAccountId")
);

-- Session table - User login sessions
CREATE TABLE "Session" (
  "id" TEXT PRIMARY KEY,
  "sessionToken" TEXT UNIQUE NOT NULL,
  "userId" TEXT NOT NULL,
  "expires" TIMESTAMP WITH TIME ZONE NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") 
    REFERENCES "User"("id") ON DELETE CASCADE
);

-- VerificationToken table - Email verification tokens
CREATE TABLE "VerificationToken" (
  "identifier" TEXT NOT NULL,
  "token" TEXT UNIQUE NOT NULL,
  "expires" TIMESTAMP WITH TIME ZONE NOT NULL,
  CONSTRAINT "VerificationToken_identifier_token_key" 
    UNIQUE ("identifier", "token")
);

-- UserResume table - User's resume files
CREATE TABLE "UserResume" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "fileUrl" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "mimeType" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "uploadedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "UserResume_userId_fkey" FOREIGN KEY ("userId") 
    REFERENCES "User"("id") ON DELETE CASCADE
);

-- ============================================================================
-- STEP 3: Create Discovery & People Tables
-- ============================================================================

-- Person table - Centralized person data (shared across all users)
CREATE TABLE "Person" (
  "id" TEXT PRIMARY KEY,
  "fullName" TEXT NOT NULL,
  "firstName" TEXT,
  "lastName" TEXT,
  "company" TEXT NOT NULL,
  "role" TEXT,
  "linkedinUrl" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "Person_fullName_company_key" 
    UNIQUE ("fullName", "company")
);

-- UserCandidate table - User-specific relationship data with people
CREATE TABLE "UserCandidate" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "email" TEXT,
  "emailStatus" "EmailStatus" NOT NULL DEFAULT 'MISSING',
  "emailConfidence" DOUBLE PRECISION,
  "manualEmailConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "university" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "UserCandidate_userId_fkey" FOREIGN KEY ("userId") 
    REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "UserCandidate_personId_fkey" FOREIGN KEY ("personId") 
    REFERENCES "Person"("id") ON DELETE CASCADE,
  CONSTRAINT "UserCandidate_userId_personId_key" 
    UNIQUE ("userId", "personId")
);

-- SourceLink table - Links where person information was discovered (shared)
CREATE TABLE "SourceLink" (
  "id" TEXT PRIMARY KEY,
  "personId" TEXT NOT NULL,
  "kind" "SourceLinkKind" NOT NULL,
  "url" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "snippet" TEXT,
  "domain" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "SourceLink_personId_fkey" FOREIGN KEY ("personId") 
    REFERENCES "Person"("id") ON DELETE CASCADE,
  CONSTRAINT "SourceLink_personId_url_key" UNIQUE ("personId", "url")
);

-- ============================================================================
-- STEP 4: Create Email Generation & Sending Tables
-- ============================================================================

-- EmailTemplate table - User's ChatGPT prompts/templates
CREATE TABLE "EmailTemplate" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "EmailTemplate_userId_fkey" FOREIGN KEY ("userId") 
    REFERENCES "User"("id") ON DELETE CASCADE
);

-- EmailDraft table - AI-generated email drafts for review
CREATE TABLE "EmailDraft" (
  "id" TEXT PRIMARY KEY,
  "userCandidateId" TEXT NOT NULL UNIQUE,
  "templateId" TEXT,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" "EmailDraftStatus" NOT NULL DEFAULT 'PENDING',
  "userEdited" BOOLEAN NOT NULL DEFAULT false,
  "editedSubject" TEXT,
  "editedBody" TEXT,
  "attachResume" BOOLEAN NOT NULL DEFAULT false,
  "resumeId" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "EmailDraft_userCandidateId_fkey" FOREIGN KEY ("userCandidateId") 
    REFERENCES "UserCandidate"("id") ON DELETE CASCADE,
  CONSTRAINT "EmailDraft_templateId_fkey" FOREIGN KEY ("templateId") 
    REFERENCES "EmailTemplate"("id") ON DELETE SET NULL,
  CONSTRAINT "EmailDraft_resumeId_fkey" FOREIGN KEY ("resumeId") 
    REFERENCES "UserResume"("id") ON DELETE SET NULL
);

-- SendLog table - Audit log of all sent emails
CREATE TABLE "SendLog" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "userCandidateId" TEXT NOT NULL,
  "toEmail" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "resumeAttached" BOOLEAN NOT NULL DEFAULT false,
  "resumeId" TEXT,
  "status" "SendLogStatus" NOT NULL,
  "errorMessage" TEXT,
  "gmailMessageId" TEXT UNIQUE,
  "sentAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "SendLog_userId_fkey" FOREIGN KEY ("userId") 
    REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "SendLog_userCandidateId_fkey" FOREIGN KEY ("userCandidateId") 
    REFERENCES "UserCandidate"("id") ON DELETE CASCADE,
  CONSTRAINT "SendLog_resumeId_fkey" FOREIGN KEY ("resumeId") 
    REFERENCES "UserResume"("id") ON DELETE SET NULL
);

-- ============================================================================
-- STEP 5: Create Indexes for Performance
-- ============================================================================

-- User indexes
CREATE INDEX "User_email_idx" ON "User"("email");
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- Account indexes
CREATE INDEX "Account_userId_idx" ON "Account"("userId");
CREATE INDEX "Account_provider_providerAccountId_idx" 
  ON "Account"("provider", "providerAccountId");

-- Session indexes
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_sessionToken_idx" ON "Session"("sessionToken");
CREATE INDEX "Session_expires_idx" ON "Session"("expires");

-- VerificationToken indexes
CREATE INDEX "VerificationToken_token_idx" ON "VerificationToken"("token");
CREATE INDEX "VerificationToken_identifier_idx" ON "VerificationToken"("identifier");

-- UserResume indexes
CREATE INDEX "UserResume_userId_idx" ON "UserResume"("userId");
CREATE INDEX "UserResume_userId_isActive_idx" ON "UserResume"("userId", "isActive");

-- Person indexes
CREATE INDEX "Person_fullName_idx" ON "Person"("fullName");
CREATE INDEX "Person_company_idx" ON "Person"("company");
CREATE INDEX "Person_fullName_company_idx" 
  ON "Person"("fullName", "company");

-- UserCandidate indexes
CREATE INDEX "UserCandidate_userId_idx" ON "UserCandidate"("userId");
CREATE INDEX "UserCandidate_personId_idx" ON "UserCandidate"("personId");
CREATE INDEX "UserCandidate_emailStatus_idx" ON "UserCandidate"("emailStatus");
CREATE INDEX "UserCandidate_university_idx" ON "UserCandidate"("university");
CREATE INDEX "UserCandidate_userId_personId_idx" 
  ON "UserCandidate"("userId", "personId");

-- SourceLink indexes
CREATE INDEX "SourceLink_personId_idx" ON "SourceLink"("personId");
CREATE INDEX "SourceLink_kind_idx" ON "SourceLink"("kind");

-- EmailTemplate indexes
CREATE INDEX "EmailTemplate_userId_idx" ON "EmailTemplate"("userId");
CREATE INDEX "EmailTemplate_userId_isDefault_idx" 
  ON "EmailTemplate"("userId", "isDefault");

-- EmailDraft indexes
CREATE INDEX "EmailDraft_userCandidateId_idx" ON "EmailDraft"("userCandidateId");
CREATE INDEX "EmailDraft_templateId_idx" ON "EmailDraft"("templateId");
CREATE INDEX "EmailDraft_status_idx" ON "EmailDraft"("status");
CREATE INDEX "EmailDraft_resumeId_idx" ON "EmailDraft"("resumeId");

-- SendLog indexes
CREATE INDEX "SendLog_userId_idx" ON "SendLog"("userId");
CREATE INDEX "SendLog_userCandidateId_idx" ON "SendLog"("userCandidateId");
CREATE INDEX "SendLog_status_idx" ON "SendLog"("status");
CREATE INDEX "SendLog_sentAt_idx" ON "SendLog"("sentAt");
CREATE INDEX "SendLog_gmailMessageId_idx" ON "SendLog"("gmailMessageId");

-- ============================================================================
-- STEP 6: Create Functions for Auto-updating updatedAt Timestamps
-- ============================================================================

-- Function to update updatedAt timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updatedAt
CREATE TRIGGER update_user_updated_at
  BEFORE UPDATE ON "User"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_userresume_updated_at
  BEFORE UPDATE ON "UserResume"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_person_updated_at
  BEFORE UPDATE ON "Person"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_usercandidate_updated_at
  BEFORE UPDATE ON "UserCandidate"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_emailtemplate_updated_at
  BEFORE UPDATE ON "EmailTemplate"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_emaildraft_updated_at
  BEFORE UPDATE ON "EmailDraft"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STEP 7: Enable Row Level Security (RLS) - Optional but Recommended
-- ============================================================================
-- Uncomment these if you want to enable RLS for multi-user security
-- ============================================================================

/*
-- Enable RLS on all tables
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VerificationToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserResume" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Person" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserCandidate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SourceLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailDraft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SendLog" ENABLE ROW LEVEL SECURITY;

-- RLS Policies (example - adjust based on your auth setup)
-- Users can only see their own data
CREATE POLICY "Users can view own data" ON "User"
  FOR SELECT USING (auth.uid()::text = "id");

CREATE POLICY "Users can update own data" ON "User"
  FOR UPDATE USING (auth.uid()::text = "id");

-- UserCandidates are user-specific
CREATE POLICY "Users can view own candidates" ON "UserCandidate"
  FOR SELECT USING (auth.uid()::text = "userId");

-- Person data is shared (read-only for all authenticated users)
CREATE POLICY "Authenticated users can view persons" ON "Person"
  FOR SELECT USING (auth.role() = 'authenticated');

-- SourceLinks are shared (read-only for all authenticated users)
CREATE POLICY "Authenticated users can view source links" ON "SourceLink"
  FOR SELECT USING (auth.role() = 'authenticated');
*/

-- ============================================================================
-- Schema Creation Complete!
-- ============================================================================
-- Your MVP database schema is now ready.
-- 
-- Next steps:
-- 1. Update your Prisma schema to match this structure
-- 2. Run: npx prisma generate
-- 3. Connect your app using the Supabase connection string
-- ============================================================================
