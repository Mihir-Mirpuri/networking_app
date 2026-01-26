-- ============================================================================
-- Migration: Add Gmail Conversation Tracking Tables
-- ============================================================================
-- This migration creates tables for Gmail conversation tracking:
-- - gmail_sync_state: Tracks Gmail API sync state per user
-- - conversations: Stores Gmail conversation threads
-- - messages: Stores all Gmail messages (sent and received)
-- Run this in your Supabase SQL Editor or via Prisma migrate
-- ============================================================================

-- ============================================================================
-- STEP 1: Create gmail_sync_state table
-- ============================================================================

CREATE TABLE IF NOT EXISTS "gmail_sync_state" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "email_address" TEXT NOT NULL,
  "historyId" TEXT,
  "watch_expiration" TIMESTAMP WITH TIME ZONE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "gmail_sync_state_userId_fkey" FOREIGN KEY ("userId") 
    REFERENCES "User"("id") ON DELETE CASCADE
);

-- ============================================================================
-- STEP 2: Create conversations table
-- ============================================================================

CREATE TABLE IF NOT EXISTS "conversations" (
  "threadId" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "subject" TEXT,
  "lastMessageAt" TIMESTAMP WITH TIME ZONE,
  "messageCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "conversations_userId_fkey" FOREIGN KEY ("userId") 
    REFERENCES "User"("id") ON DELETE CASCADE
);

-- ============================================================================
-- STEP 3: Create messages table
-- ============================================================================

CREATE TABLE IF NOT EXISTS "messages" (
  "messageId" TEXT PRIMARY KEY,
  "threadId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "sender" TEXT NOT NULL,
  "recipient_list" JSONB NOT NULL,
  "subject" TEXT,
  "body_html" TEXT,
  "body_text" TEXT,
  "received_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "sendLogId" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "messages_threadId_fkey" FOREIGN KEY ("threadId") 
    REFERENCES "conversations"("threadId") ON DELETE CASCADE,
  CONSTRAINT "messages_userId_fkey" FOREIGN KEY ("userId") 
    REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "messages_sendLogId_fkey" FOREIGN KEY ("sendLogId") 
    REFERENCES "SendLog"("id") ON DELETE SET NULL,
  CONSTRAINT "messages_direction_check" CHECK ("direction" IN ('SENT', 'RECEIVED'))
);

-- ============================================================================
-- STEP 4: Add unique constraints
-- ============================================================================

-- One sync state per user
CREATE UNIQUE INDEX IF NOT EXISTS "gmail_sync_state_userId_key" 
  ON "gmail_sync_state"("userId");

-- One conversation per user per thread (prevent duplicates)
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_userId_threadId_key" 
  ON "conversations"("userId", "threadId");

-- messageId is already primary key (unique by definition), but ensure idempotency
-- Primary key constraint already enforces uniqueness

-- ============================================================================
-- STEP 5: Create indexes for performance
-- ============================================================================

-- gmail_sync_state indexes
CREATE INDEX IF NOT EXISTS "gmail_sync_state_userId_idx" 
  ON "gmail_sync_state"("userId");
CREATE INDEX IF NOT EXISTS "gmail_sync_state_email_address_idx" 
  ON "gmail_sync_state"("email_address");

-- conversations indexes
CREATE INDEX IF NOT EXISTS "conversations_userId_idx" 
  ON "conversations"("userId");
CREATE INDEX IF NOT EXISTS "conversations_userId_lastMessageAt_idx" 
  ON "conversations"("userId", "lastMessageAt");

-- messages indexes
CREATE INDEX IF NOT EXISTS "messages_threadId_idx" 
  ON "messages"("threadId");
CREATE INDEX IF NOT EXISTS "messages_userId_idx" 
  ON "messages"("userId");
CREATE INDEX IF NOT EXISTS "messages_userId_threadId_idx" 
  ON "messages"("userId", "threadId");
CREATE INDEX IF NOT EXISTS "messages_userId_received_at_idx" 
  ON "messages"("userId", "received_at");
CREATE INDEX IF NOT EXISTS "messages_sender_idx" 
  ON "messages"("sender");
CREATE INDEX IF NOT EXISTS "messages_sendLogId_idx" 
  ON "messages"("sendLogId");

-- GIN index for JSONB recipient_list queries
CREATE INDEX IF NOT EXISTS "messages_recipient_list_idx" 
  ON "messages" USING GIN ("recipient_list");

-- ============================================================================
-- STEP 6: Add table and column comments for documentation
-- ============================================================================

COMMENT ON TABLE "gmail_sync_state" IS 'Stores Gmail API sync state per user for push notifications and history tracking';
COMMENT ON COLUMN "gmail_sync_state"."id" IS 'Primary key identifier';
COMMENT ON COLUMN "gmail_sync_state"."userId" IS 'Links to User table - one sync state per user';
COMMENT ON COLUMN "gmail_sync_state"."email_address" IS 'Gmail address being synced (should match User.email for single-account users)';
COMMENT ON COLUMN "gmail_sync_state"."historyId" IS 'Gmail historyId for incremental sync';
COMMENT ON COLUMN "gmail_sync_state"."watch_expiration" IS 'When current Gmail watch subscription expires';

COMMENT ON TABLE "conversations" IS 'Stores Gmail conversation threads, grouping related messages together';
COMMENT ON COLUMN "conversations"."threadId" IS 'Gmail thread ID (primary key)';
COMMENT ON COLUMN "conversations"."userId" IS 'Owner of this conversation - user-specific';
COMMENT ON COLUMN "conversations"."subject" IS 'Conversation subject (from most recent message)';
COMMENT ON COLUMN "conversations"."lastMessageAt" IS 'Timestamp of last message in thread for sorting';
COMMENT ON COLUMN "conversations"."messageCount" IS 'Number of messages in this thread';

COMMENT ON TABLE "messages" IS 'Stores all Gmail messages (both sent and received) with full content';
COMMENT ON COLUMN "messages"."messageId" IS 'Gmail message ID (primary key, unique for idempotency)';
COMMENT ON COLUMN "messages"."threadId" IS 'Thread this message belongs to - links to conversations table';
COMMENT ON COLUMN "messages"."userId" IS 'Owner of this message - user-specific';
COMMENT ON COLUMN "messages"."direction" IS 'Message direction: SENT or RECEIVED';
COMMENT ON COLUMN "messages"."sender" IS 'Sender email address';
COMMENT ON COLUMN "messages"."recipient_list" IS 'Array of recipient email addresses in JSONB format: ["to@example.com", "cc@example.com"]';
COMMENT ON COLUMN "messages"."subject" IS 'Message subject';
COMMENT ON COLUMN "messages"."body_html" IS 'HTML body content';
COMMENT ON COLUMN "messages"."body_text" IS 'Plain text body content';
COMMENT ON COLUMN "messages"."received_at" IS 'When message was received/sent (Gmail timestamp)';
COMMENT ON COLUMN "messages"."sendLogId" IS 'Link to SendLog table if this is a sent message (nullable)';
