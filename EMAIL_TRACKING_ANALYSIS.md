# Email Tracking System - Current Flow & Implementation Status

## Executive Summary

This document provides a comprehensive analysis of the email tracking system for user emails. It covers what's currently implemented, how the system works, and what still needs to be built to achieve full email conversation tracking.

---

## Table of Contents

1. [Current Implementation](#current-implementation)
2. [Database Schema](#database-schema)
3. [Email Sending Flow](#email-sending-flow)
4. [Gmail Integration](#gmail-integration)
5. [Webhook Infrastructure](#webhook-infrastructure)
6. [What's Missing](#whats-missing)
7. [Implementation Roadmap](#implementation-roadmap)

---

## Current Implementation

### ✅ What's Working

#### 1. **Email Sending & Logging**
- **Location**: `src/app/actions/send.ts`, `src/lib/services/gmail.ts`
- **Status**: ✅ Fully Implemented
- **Features**:
  - Sends emails via Gmail API
  - Logs all sent emails to `SendLog` table
  - Captures `gmailMessageId` for each successful send
  - Supports resume attachments
  - Handles scheduled emails via cron job
  - Implements daily send limits (30 emails/day)
  - Automatic token refresh for OAuth

#### 2. **Database Schema for Tracking**
- **Location**: `prisma/schema.prisma`, `migrations/add_gmail_conversation_tracking.sql`
- **Status**: ✅ Schema Created (Partially Used)
- **Tables**:
  - `SendLog` - Tracks all sent emails with `gmailMessageId`
  - `conversations` - Stores Gmail conversation threads
  - `messages` - Stores individual messages (sent and received)
  - `gmail_sync_state` - Tracks Gmail API sync state per user

#### 3. **Gmail Client Infrastructure**
- **Location**: `src/lib/gmail/client.ts`
- **Status**: ✅ Fully Implemented
- **Features**:
  - Authenticated Gmail client with auto token refresh
  - `startMailboxWatch()` function for push notifications
  - Error handling for OAuth token management

#### 4. **Gmail Message Parser**
- **Location**: `src/lib/gmail/parser.ts`
- **Status**: ✅ Fully Implemented
- **Features**:
  - Parses Gmail API message responses
  - Extracts headers (From, To, Subject, Date)
  - Decodes base64url-encoded body content
  - Handles both HTML and plain text
  - Extracts recipient lists and sender information

#### 5. **Webhook Endpoint**
- **Location**: `src/app/api/webhooks/gmail/route.ts`
- **Status**: ⚠️ Partially Implemented
- **Features**:
  - Receives Pub/Sub notifications from Gmail
  - Validates authentication
  - Parses Pub/Sub message format
  - Looks up userId from email address
  - **Missing**: Actual sync processing logic

#### 6. **Scheduled Email Processing**
- **Location**: `src/app/api/cron/send-scheduled-emails/route.ts`
- **Status**: ✅ Fully Implemented
- **Features**:
  - Processes scheduled emails via cron
  - Creates SendLog entries for scheduled sends
  - Handles failures gracefully

---

## Database Schema

### Core Tables

#### `SendLog` ✅ Fully Used
```prisma
model SendLog {
  id              String        @id @default(cuid())
  userId          String
  userCandidateId String
  toEmail         String
  subject         String
  body            String
  resumeAttached  Boolean       @default(false)
  resumeId        String?
  status          SendLogStatus
  errorMessage    String?
  gmailMessageId  String?       @unique  // ✅ Captured on send
  sentAt          DateTime      @default(now())
  messages        messages[]    // ✅ Link to messages table
}
```

**Current Usage**:
- ✅ Created for every email send (immediate and scheduled)
- ✅ `gmailMessageId` is populated when email is successfully sent
- ✅ Links to `UserCandidate` for person tracking
- ✅ Links to `messages` table via `sendLogId` foreign key

#### `conversations` ⚠️ Schema Exists, Not Populated
```prisma
model conversations {
  threadId      String     @id
  userId        String
  subject       String?
  lastMessageAt DateTime?
  messageCount  Int        @default(0)
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @default(now())
  messages      messages[]
}
```

**Current Status**:
- ✅ Table exists in database
- ❌ Not being created when emails are sent
- ❌ Not being updated when messages arrive
- ⚠️ Missing: `userCandidateId` field to link to person being contacted

#### `messages` ⚠️ Schema Exists, Not Populated
```prisma
model messages {
  messageId      String        @id
  threadId       String
  userId         String
  direction      String        // 'SENT' or 'RECEIVED'
  sender         String
  recipient_list Json          // JSONB array of emails
  subject        String?
  body_html      String?
  body_text      String?
  received_at    DateTime
  sendLogId      String?       // Links to SendLog for sent messages
  conversations  conversations @relation(...)
  User           User          @relation(...)
  SendLog        SendLog?      @relation(...)
}
```

**Current Status**:
- ✅ Table exists in database
- ❌ Not being created for sent emails
- ❌ Not being created for received emails
- ⚠️ Missing: Logic to link sent messages to SendLog via `gmailMessageId`

#### `gmail_sync_state` ⚠️ Schema Exists, Partially Used
```prisma
model gmail_sync_state {
  id               String    @id
  userId           String    @unique
  email_address    String
  historyId        String?   // Gmail historyId for incremental sync
  watch_expiration DateTime? // When Gmail watch subscription expires
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @default(now())
}
```

**Current Status**:
- ✅ Table exists in database
- ✅ Updated when `startMailboxWatch()` is called
- ❌ Not being used for incremental sync
- ⚠️ Missing: Logic to renew watch subscriptions before expiration

---

## Email Sending Flow

### Current Flow (Immediate Sends)

```
1. User clicks "Send" in UI
   ↓
2. sendEmailsAction() called
   ↓
3. Check daily limit (30 emails/day)
   ↓
4. Get OAuth tokens (access_token, refresh_token)
   ↓
5. For each email:
   a. sendEmail() → Gmail API
   b. Gmail returns messageId
   c. Create SendLog entry with:
      - userId, userCandidateId
      - toEmail, subject, body
      - gmailMessageId ✅
      - status: SUCCESS/FAILED
   ↓
6. Update EmailDraft status to SENT
   ↓
7. Increment daily send count
```

**What's Missing**:
- ❌ No creation of `conversations` record
- ❌ No creation of `messages` record for sent email
- ❌ No linking of sent message to conversation thread
- ❌ No fetching of Gmail threadId from sent message

### Current Flow (Scheduled Sends)

```
1. User schedules email
   ↓
2. scheduleEmailAction() creates ScheduledEmail record
   ↓
3. Cron job runs (send-scheduled-emails route)
   ↓
4. Query pending ScheduledEmails where scheduledFor <= now
   ↓
5. For each scheduled email:
   a. Get user tokens
   b. sendEmail() → Gmail API
   c. Create SendLog entry with gmailMessageId ✅
   d. Update ScheduledEmail status to SENT
   ↓
6. Return results
```

**What's Missing**:
- ❌ Same as immediate sends (no conversation/message tracking)

---

## Gmail Integration

### OAuth Scopes

**Current Scopes** (from `src/lib/auth.ts`):
```typescript
scopes: [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'openid'
]
```

**Missing Scopes for Full Tracking**:
- ❌ `https://www.googleapis.com/auth/gmail.readonly` - Required to read incoming messages
- ❌ `https://www.googleapis.com/auth/gmail.modify` - Required to modify message labels/status (optional)

### Gmail Watch Setup

**Location**: `src/lib/gmail/client.ts`

**Current Implementation**:
- ✅ `startMailboxWatch()` function exists
- ✅ Creates/updates `gmail_sync_state` record
- ✅ Stores `historyId` and `watch_expiration`
- ✅ Returns watch response

**What's Missing**:
- ❌ No automatic watch renewal before expiration
- ❌ No initialization of watch on user sign-in
- ❌ No handling of watch expiration

### Gmail API Usage

**Currently Used**:
- ✅ `gmail.users.messages.send()` - Sending emails
- ✅ `gmail.users.watch()` - Setting up push notifications

**Not Yet Used**:
- ❌ `gmail.users.messages.get()` - Fetching message details
- ❌ `gmail.users.messages.list()` - Listing messages
- ❌ `gmail.users.history.list()` - Incremental sync using historyId
- ❌ `gmail.users.threads.get()` - Getting thread information

---

## Webhook Infrastructure

### Current Implementation

**Location**: `src/app/api/webhooks/gmail/route.ts`

**What Works**:
1. ✅ Receives POST requests from Google Pub/Sub
2. ✅ Validates Bearer token authentication (`PUBSUB_WEBHOOK_SECRET`)
3. ✅ Parses Pub/Sub message format (base64-encoded JSON)
4. ✅ Extracts `emailAddress` and `historyId` from notification
5. ✅ Looks up `userId` from email address (checks User table, then gmail_sync_state)
6. ✅ Returns 200 OK to acknowledge receipt (prevents Pub/Sub retries)

**What's Missing**:
```typescript
async function processSync(userId: string): Promise<void> {
  console.log(`[Gmail Webhook] processSync called for userId: ${userId}`);
  console.log(`[Gmail Webhook] TODO: Implement sync logic to fetch and process new messages`);
  // Future implementation will:
  // 1. Get Gmail client for userId
  // 2. Use historyId to fetch changed messages
  // 3. Parse messages using parseGmailResponse
  // 4. Store in messages and conversations tables
}
```

**Required Implementation**:
1. Get Gmail client for userId
2. Use `gmail.users.history.list()` with `historyId` to get changed messages
3. For each changed message:
   - Fetch full message using `gmail.users.messages.get()`
   - Parse using `parseGmailResponse()`
   - Determine if message is SENT or RECEIVED
   - Get or create `conversations` record using `threadId`
   - Create or update `messages` record
   - Link to `SendLog` if it's a sent message (match by `gmailMessageId`)
   - Update `conversations.messageCount` and `lastMessageAt`
4. Update `gmail_sync_state.historyId` to latest value

---

## What's Missing

### Critical Missing Features

#### 1. **Sent Message Tracking** ❌
**Problem**: When an email is sent, we create a `SendLog` entry but don't create a `messages` record.

**Required**:
- After successful send, fetch the sent message from Gmail API to get:
  - `threadId` (Gmail thread ID)
  - Full message details
- Create or update `conversations` record
- Create `messages` record with `direction: 'SENT'`
- Link `messages.sendLogId` to `SendLog.id`

**Location to Modify**: `src/app/actions/send.ts` (after line 124)

#### 2. **Received Message Processing** ❌
**Problem**: When a reply arrives, we receive a webhook but don't process it.

**Required**:
- Implement `processSync()` function in webhook handler
- Fetch changed messages using Gmail History API
- Parse incoming messages
- Create/update `conversations` and `messages` records
- Determine if message is a reply to a sent email

**Location to Modify**: `src/app/api/webhooks/gmail/route.ts` (function `processSync`)

#### 3. **Conversation Linking** ❌
**Problem**: `conversations` table doesn't link to `UserCandidate` to know which person the conversation is with.

**Required**:
- Add `userCandidateId` field to `conversations` table (or determine from message recipients)
- Link conversations to people being contacted
- Update schema and migration

**Location to Modify**: 
- `prisma/schema.prisma` (add field)
- `migrations/add_gmail_conversation_tracking.sql` (add column)

#### 4. **Gmail Watch Initialization** ❌
**Problem**: Watch subscriptions are not automatically set up when users sign in.

**Required**:
- Call `startMailboxWatch()` after OAuth sign-in
- Store Pub/Sub topic name in environment
- Handle watch expiration and renewal

**Location to Modify**: 
- `src/lib/auth.ts` (after OAuth callback)
- Or create a separate API endpoint to initialize watch

#### 5. **OAuth Scope Updates** ❌
**Problem**: Current OAuth scopes don't include `gmail.readonly` needed to read messages.

**Required**:
- Add `gmail.readonly` scope to OAuth configuration
- Existing users will need to re-authenticate
- Handle scope upgrade flow

**Location to Modify**: `src/lib/auth.ts`

#### 6. **Thread ID Extraction** ❌
**Problem**: When sending email, we get `messageId` but not `threadId`.

**Required**:
- After sending, fetch the message to get `threadId`
- Or use Gmail API response which may include thread info
- Store threadId for conversation tracking

**Location to Modify**: `src/lib/services/gmail.ts` (sendEmail function)

### Nice-to-Have Features

#### 7. **Watch Renewal** ⚠️
- Automatically renew Gmail watch subscriptions before expiration
- Create cron job or scheduled task
- Check `gmail_sync_state.watch_expiration` and renew if < 7 days remaining

#### 8. **Initial Sync** ⚠️
- When user first enables tracking, sync existing messages
- Use `gmail.users.messages.list()` to get recent messages
- Process and store in database

#### 9. **Error Handling & Retry Logic** ⚠️
- Handle Gmail API rate limits
- Retry failed sync operations
- Log errors for debugging

#### 10. **Message Deduplication** ⚠️
- Ensure messages aren't processed twice
- Use `messageId` as primary key (already implemented)
- Handle webhook retries gracefully

---

## Implementation Roadmap

### Phase 1: Sent Message Tracking (High Priority)

**Goal**: Track sent emails in conversations and messages tables

**Tasks**:
1. Modify `sendEmail()` to fetch sent message details after send
2. Extract `threadId` from Gmail API response
3. Create or update `conversations` record
4. Create `messages` record with `direction: 'SENT'`
5. Link `messages.sendLogId` to `SendLog.id`

**Files to Modify**:
- `src/lib/services/gmail.ts` - Update `sendEmail()` function
- `src/app/actions/send.ts` - Update after send logic
- `src/app/api/cron/send-scheduled-emails/route.ts` - Update scheduled send logic

**Estimated Effort**: 4-6 hours

### Phase 2: OAuth Scope Update (High Priority)

**Goal**: Add `gmail.readonly` scope to enable message reading

**Tasks**:
1. Update OAuth scopes in `src/lib/auth.ts`
2. Create migration/script to handle existing users
3. Add UI to prompt users to re-authenticate if needed
4. Test scope upgrade flow

**Files to Modify**:
- `src/lib/auth.ts`
- `src/app/auth/signin/page.tsx` (if needed)

**Estimated Effort**: 2-3 hours

### Phase 3: Received Message Processing (High Priority)

**Goal**: Process incoming emails via webhook

**Tasks**:
1. Implement `processSync()` function in webhook handler
2. Use Gmail History API to fetch changed messages
3. Parse messages using existing `parseGmailResponse()`
4. Create/update `conversations` and `messages` records
5. Determine message direction (SENT vs RECEIVED)
6. Link received messages to conversations

**Files to Modify**:
- `src/app/api/webhooks/gmail/route.ts` - Implement `processSync()`
- Create helper functions in `src/lib/services/gmail.ts` for sync logic

**Estimated Effort**: 6-8 hours

### Phase 4: Conversation Linking (Medium Priority)

**Goal**: Link conversations to UserCandidate (person being contacted)

**Tasks**:
1. Add `userCandidateId` field to `conversations` table
2. Create migration
3. Update logic to determine which person a conversation is with
4. Link conversations to UserCandidate when creating/updating

**Files to Modify**:
- `prisma/schema.prisma`
- `migrations/add_gmail_conversation_tracking.sql`
- `src/app/api/webhooks/gmail/route.ts`
- `src/lib/services/gmail.ts`

**Estimated Effort**: 3-4 hours

### Phase 5: Watch Initialization (Medium Priority)

**Goal**: Automatically set up Gmail watch on user sign-in

**Tasks**:
1. Create API endpoint or function to initialize watch
2. Call after OAuth sign-in completes
3. Store Pub/Sub topic name in environment
4. Handle errors gracefully

**Files to Modify**:
- `src/lib/auth.ts` or create new endpoint
- `src/lib/gmail/client.ts` - Ensure `startMailboxWatch()` is ready

**Estimated Effort**: 2-3 hours

### Phase 6: Watch Renewal (Low Priority)

**Goal**: Automatically renew watch subscriptions

**Tasks**:
1. Create cron job or scheduled task
2. Check `gmail_sync_state.watch_expiration` for all users
3. Renew subscriptions that expire within 7 days
4. Update `gmail_sync_state` records

**Files to Create/Modify**:
- `src/app/api/cron/renew-gmail-watches/route.ts` (new)
- `vercel.json` or cron configuration

**Estimated Effort**: 3-4 hours

### Phase 7: Initial Sync (Low Priority)

**Goal**: Sync existing messages when user first enables tracking

**Tasks**:
1. Create API endpoint to trigger initial sync
2. Use `gmail.users.messages.list()` to get recent messages
3. Process and store in database
4. Handle large message volumes gracefully

**Files to Create/Modify**:
- `src/app/api/sync/gmail/route.ts` (new)
- `src/lib/services/gmail.ts` - Add sync functions

**Estimated Effort**: 4-6 hours

---

## Technical Details

### Gmail API Response Format

When sending an email, Gmail API returns:
```json
{
  "id": "19be7a0b91084d83",  // messageId
  "threadId": "19be7a0b91084d82",  // threadId (needed for conversations)
  "labelIds": ["SENT"]
}
```

**Current Usage**: We only capture `id` (messageId) in `SendLog.gmailMessageId`

**Needed**: Also capture `threadId` and use it to create/update conversations

### Gmail History API

For incremental sync, use:
```typescript
const history = await gmail.users.history.list({
  userId: 'me',
  startHistoryId: previousHistoryId,
  historyTypes: ['messageAdded']
});
```

This returns:
- `history` array with message IDs that changed
- New `historyId` to use for next sync

### Message Direction Detection

To determine if a message is SENT or RECEIVED:
1. Get user's email address from `User.email`
2. Check message `From` header:
   - If `From` matches user's email → `direction: 'SENT'`
   - Otherwise → `direction: 'RECEIVED'`

### Linking Sent Messages to SendLog

When processing a sent message:
1. Get `gmailMessageId` from message
2. Query `SendLog` where `gmailMessageId = messageId`
3. If found, set `messages.sendLogId = SendLog.id`
4. If not found, it's a message sent outside the app (still track it)

### Conversation Person Matching

To link a conversation to a person:
1. Get message recipients from `recipient_list`
2. For received messages, check `sender` field
3. Query `UserCandidate` where `email` matches recipient/sender
4. If found, link `conversations.userCandidateId`
5. If not found, conversation is with someone not in the system

---

## Testing Checklist

### Sent Message Tracking
- [ ] Send email via app
- [ ] Verify `conversations` record created
- [ ] Verify `messages` record created with `direction: 'SENT'`
- [ ] Verify `messages.sendLogId` links to `SendLog.id`
- [ ] Verify `conversations.threadId` matches Gmail threadId

### Received Message Processing
- [ ] Send test email to user's Gmail
- [ ] Verify webhook receives notification
- [ ] Verify `processSync()` runs successfully
- [ ] Verify `messages` record created with `direction: 'RECEIVED'`
- [ ] Verify `conversations` record updated (messageCount, lastMessageAt)

### Conversation Linking
- [ ] Send email to person in UserCandidate
- [ ] Verify `conversations.userCandidateId` is set correctly
- [ ] Receive reply from same person
- [ ] Verify conversation is linked to correct UserCandidate

### Watch Management
- [ ] Verify watch is created on sign-in
- [ ] Verify `gmail_sync_state` is updated
- [ ] Verify watch renewal before expiration
- [ ] Verify webhook receives notifications

### Error Handling
- [ ] Test with expired OAuth token
- [ ] Test with invalid historyId
- [ ] Test with Gmail API rate limits
- [ ] Test with duplicate messages (idempotency)

---

## Environment Variables Required

```bash
# Existing
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
PUBSUB_WEBHOOK_SECRET=...  # For webhook authentication
CRON_SECRET=...  # For cron job authentication

# May Need
GMAIL_PUBSUB_TOPIC=projects/PROJECT_ID/topics/TOPIC_NAME  # For watch setup
```

---

## Database Migrations Needed

1. **Add `userCandidateId` to conversations table** (if desired)
   ```sql
   ALTER TABLE "conversations" 
   ADD COLUMN "userCandidateId" TEXT,
   ADD CONSTRAINT "conversations_userCandidateId_fkey" 
     FOREIGN KEY ("userCandidateId") REFERENCES "UserCandidate"("id");
   ```

2. **Add index for userCandidateId** (if added)
   ```sql
   CREATE INDEX "conversations_userCandidateId_idx" 
   ON "conversations"("userCandidateId");
   ```

---

## Summary

### Current State
- ✅ Email sending works and logs to `SendLog`
- ✅ `gmailMessageId` is captured
- ✅ Database schema exists for conversations and messages
- ✅ Gmail client infrastructure is ready
- ✅ Webhook endpoint receives notifications
- ⚠️ But no actual message/conversation tracking is happening

### What Needs to Happen
1. **Immediate**: Implement sent message tracking (Phase 1)
2. **Immediate**: Add `gmail.readonly` scope (Phase 2)
3. **High Priority**: Implement received message processing (Phase 3)
4. **Medium Priority**: Link conversations to people (Phase 4)
5. **Medium Priority**: Initialize watch on sign-in (Phase 5)
6. **Low Priority**: Watch renewal and initial sync (Phases 6-7)

### Estimated Total Effort
- **Critical Path**: ~12-17 hours (Phases 1-3)
- **Full Implementation**: ~24-34 hours (All phases)

---

## Questions & Considerations

1. **Should conversations be linked to UserCandidate?**
   - Pro: Easy to see all conversations with a person
   - Con: What if conversation is with someone not in UserCandidate?
   - Alternative: Match by email address dynamically

2. **How to handle messages sent outside the app?**
   - Option A: Track all messages in user's Gmail
   - Option B: Only track messages related to sent emails
   - Recommendation: Track all, but mark which are "app-related"

3. **What to do with old messages?**
   - Option A: Only track new messages going forward
   - Option B: Initial sync of last 30 days of messages
   - Recommendation: Start with new messages, add initial sync later

4. **How to handle multiple email addresses per user?**
   - Current: One `gmail_sync_state` per user
   - May need: Support for multiple Gmail accounts per user
   - Recommendation: Start with single account, extend later

---

## Related Files Reference

### Core Files
- `src/app/actions/send.ts` - Email sending action
- `src/lib/services/gmail.ts` - Gmail service functions
- `src/lib/gmail/client.ts` - Gmail API client
- `src/lib/gmail/parser.ts` - Message parsing
- `src/app/api/webhooks/gmail/route.ts` - Webhook handler
- `src/app/api/cron/send-scheduled-emails/route.ts` - Scheduled email cron

### Database Files
- `prisma/schema.prisma` - Prisma schema
- `migrations/add_gmail_conversation_tracking.sql` - Migration SQL

### Configuration
- `src/lib/auth.ts` - OAuth configuration
- `vercel.json` - Cron job configuration (if exists)

---

*Last Updated: [Current Date]*
*Document Version: 1.0*
