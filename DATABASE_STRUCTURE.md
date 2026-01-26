# Supabase Database Structure Analysis

## Overview
This document provides a comprehensive overview of the Supabase database structure for the Lattice networking application, with focus on email-related tables that will be relevant for Gmail conversation tracking.

## Database Schema

### Core Tables

#### 1. **User** (4 rows)
Primary user authentication and profile table.
- **Key Fields:**
  - `id` (text, PK)
  - `email` (text, unique, nullable)
  - `name`, `image`, `emailVerified`
  - `dailySendCount` (integer, default: 0) - Rate limiting
  - `lastSendDate` (timestamp, nullable) - Rate limiting
  - `classification`, `major`, `university`, `career` - User profile fields
  - `createdAt`, `updatedAt`

#### 2. **Account** (3 rows)
OAuth account linking (NextAuth.js).
- **Key Fields:**
  - `id` (text, PK)
  - `userId` (FK → User.id)
  - `provider`, `providerAccountId`
  - `access_token`, `refresh_token`, `expires_at` - OAuth tokens
  - `scope`, `token_type`, `id_token`

#### 3. **Session** (7 rows)
User session management (NextAuth.js).
- **Key Fields:**
  - `id` (text, PK)
  - `sessionToken` (text, unique)
  - `userId` (FK → User.id)
  - `expires` (timestamp)

### Person & Discovery Tables

#### 4. **Person** (516 rows)
Shared database of discovered professionals.
- **Key Fields:**
  - `id` (text, PK)
  - `fullName`, `firstName`, `lastName`
  - `company`, `role`
  - `linkedinUrl` (nullable)
  - `email` (nullable) - Cached from Apollo API
  - `emailStatus` (enum: MISSING, UNVERIFIED, VERIFIED, MANUAL)
  - `emailConfidence` (double precision, 0-100)
  - `emailLastUpdated` (timestamp)
  - `createdAt`, `updatedAt`
- **Indexes:**
  - Unique: `(fullName, company)`
  - Index: `emailStatus`

#### 5. **UserCandidate** (537 rows)
Junction table linking users to discovered persons.
- **Key Fields:**
  - `id` (text, PK)
  - `userId` (FK → User.id)
  - `personId` (FK → Person.id)
  - `email` (nullable) - User-specific email override
  - `emailStatus` (enum: MISSING, UNVERIFIED, VERIFIED, MANUAL)
  - `emailConfidence` (double precision)
  - `manualEmailConfirmed` (boolean, default: false)
  - `university` (nullable)
  - `doNotShow` (boolean, default: false)
  - `createdAt`, `updatedAt`
- **Indexes:**
  - Unique: `(userId, personId)`
  - Indexes: `userId`, `personId`, `emailStatus`, `university`, `(userId, doNotShow)`

#### 6. **SourceLink** (527 rows)
Source URLs where persons were discovered.
- **Key Fields:**
  - `id` (text, PK)
  - `personId` (FK → Person.id)
  - `kind` (enum: DISCOVERY, RESEARCH)
  - `url`, `title`, `snippet`, `domain`
  - `createdAt`

### Email Management Tables

#### 7. **EmailTemplate** (2 rows)
User-defined email templates for outreach.
- **Key Fields:**
  - `id` (text, PK)
  - `userId` (FK → User.id)
  - `name`, `prompt` (text)
  - `isDefault` (boolean, default: false)
  - `attachResume` (boolean, default: false)
  - `resumeId` (FK → UserResume.id, nullable)
  - `createdAt`, `updatedAt`
- **Indexes:**
  - Indexes: `userId`, `resumeId`, `(userId, isDefault)`

#### 8. **EmailDraft** (537 rows)
Generated email drafts before sending.
- **Key Fields:**
  - `id` (text, PK)
  - `userCandidateId` (FK → UserCandidate.id, unique)
  - `templateId` (FK → EmailTemplate.id, nullable)
  - `subject`, `body` (text)
  - `status` (enum: PENDING, APPROVED, REJECTED, SENT)
  - `userEdited` (boolean, default: false)
  - `editedSubject`, `editedBody` (nullable)
  - `attachResume` (boolean, default: false)
  - `resumeId` (FK → UserResume.id, nullable)
  - `createdAt`, `updatedAt`
- **Indexes:**
  - Unique: `userCandidateId`
  - Indexes: `templateId`, `resumeId`, `status`

#### 9. **SendLog** (15 rows) ⭐ **Key for Gmail Tracking**
Audit trail of all sent emails.
- **Key Fields:**
  - `id` (text, PK)
  - `userId` (FK → User.id)
  - `userCandidateId` (FK → UserCandidate.id)
  - `toEmail`, `subject`, `body`
  - `resumeAttached` (boolean, default: false)
  - `resumeId` (FK → UserResume.id, nullable)
  - `status` (enum: SUCCESS, FAILED)
  - `errorMessage` (nullable)
  - **`gmailMessageId`** (text, nullable, unique) ⭐ **Already exists!**
  - `sentAt` (timestamp, default: now())
- **Indexes:**
  - Unique: `gmailMessageId`
  - Indexes: `userId`, `userCandidateId`, `status`, `sentAt`, `gmailMessageId`

#### 10. **ScheduledEmail** (2 rows)
Emails scheduled for future sending.
- **Key Fields:**
  - `id` (text, PK)
  - `userId` (FK → User.id)
  - `userCandidateId` (FK → UserCandidate.id)
  - `toEmail`, `subject`, `body`
  - `resumeId` (FK → UserResume.id, nullable)
  - `scheduledFor` (timestamp)
  - `status` (enum: PENDING, SENT, FAILED, CANCELLED)
  - `errorMessage` (nullable)
  - `sentAt` (timestamp, nullable)
  - `createdAt`, `updatedAt`
- **Indexes:**
  - Indexes: `userId`, `scheduledFor`, `(status, scheduledFor)`

### Supporting Tables

#### 11. **UserResume** (2 rows)
User-uploaded resume files.
- **Key Fields:**
  - `id` (text, PK)
  - `userId` (FK → User.id)
  - `filename`, `fileUrl`, `fileSize`, `mimeType`
  - `version` (integer, default: 1)
  - `isActive` (boolean, default: false)
  - `uploadedAt`, `createdAt`, `updatedAt`
- **Indexes:**
  - Indexes: `userId`, `(userId, isActive)`

#### 12. **VerificationToken** (0 rows)
Email verification tokens (NextAuth.js).

## Key Observations for Gmail Conversation Tracking

### ✅ Existing Infrastructure
1. **`SendLog.gmailMessageId`** - Already exists with unique index
   - This is the Gmail message ID for sent emails
   - **Current Status**: ✅ 100% populated (11/11 successful sends have Gmail message IDs)
   - Format: Gmail internal message ID (e.g., "19be7a0b91084d83")
   - Unique constraint prevents duplicate tracking

2. **OAuth Integration** - Google OAuth is configured
   - Provider: `google` in `Account` table
   - **Current Scopes**: `gmail.send`, `userinfo.email`, `userinfo.profile`, `openid`
   - ⚠️ **Missing Scopes for Conversation Tracking**: 
     - `gmail.readonly` - Required to read incoming messages
     - `gmail.modify` - Required to modify message labels/status
   - All accounts have `access_token` and `refresh_token` stored

### 🔍 What's Missing for Full Conversation Tracking

To implement comprehensive Gmail conversation tracking, you'll likely need:

1. **Gmail Thread ID** - Gmail groups related messages into threads
   - Could add `gmailThreadId` to `SendLog` table
   - Or create a separate `GmailConversation` table

2. **Incoming Messages Table** - Track replies and incoming emails
   - New table: `GmailMessage` or `EmailReply`
   - Fields: `gmailMessageId`, `gmailThreadId`, `fromEmail`, `toEmail`, `subject`, `body`, `receivedAt`, `userId`
   - Link to `SendLog` via `gmailThreadId` or `inReplyTo` field

3. **Conversation State** - Track conversation status
   - Could add `conversationStatus` enum to `SendLog` or new table
   - Values: INITIAL, REPLIED, CLOSED, etc.

4. **Message Relationships** - Link replies to original messages
   - Foreign key from replies to `SendLog.id` or `SendLog.gmailMessageId`
   - Or use `gmailThreadId` to group all messages in a thread

## Database Relationships Summary

```
User
├── Account (OAuth)
├── Session
├── UserCandidate
│   ├── Person
│   │   └── SourceLink
│   ├── EmailDraft
│   │   └── EmailTemplate
│   ├── SendLog ⭐ (has gmailMessageId)
│   └── ScheduledEmail
└── UserResume
    ├── EmailTemplate
    ├── EmailDraft
    ├── SendLog
    └── ScheduledEmail
```

## Enums

- **EmailStatus**: MISSING, UNVERIFIED, VERIFIED, MANUAL
- **EmailDraftStatus**: PENDING, APPROVED, REJECTED, SENT
- **SendLogStatus**: SUCCESS, FAILED
- **ScheduledEmailStatus**: PENDING, SENT, FAILED, CANCELLED
- **SourceLinkKind**: DISCOVERY, RESEARCH

## Indexes Summary

- **SendLog** has excellent indexing for Gmail tracking:
  - Unique index on `gmailMessageId` (prevents duplicates)
  - Index on `gmailMessageId` (for lookups)
  - Indexes on `userId`, `userCandidateId`, `status`, `sentAt`

## Recommendations for Gmail Conversation Tracking

1. ✅ **`gmailMessageId` population** - Already working perfectly (100% coverage)
2. **Update OAuth Scopes** - Add `gmail.readonly` and/or `gmail.modify` to existing Google OAuth configuration
   - Users will need to re-authorize to grant new permissions
   - Consider migration strategy for existing users
3. **Add `gmailThreadId`** - Store thread ID alongside message ID for conversation grouping
   - Gmail groups related messages into threads automatically
   - Thread ID can be retrieved when sending or by querying the message
4. **Create `GmailMessage` table** - Track incoming emails/replies
   - Link to `SendLog` via `gmailThreadId` or `inReplyTo` field
   - Store full message metadata (from, to, subject, body, date, labels)
5. **Add conversation metadata** - Track reply count, last activity, conversation status
   - Could add fields to `SendLog` or create separate `GmailConversation` table
6. **Consider webhook/polling strategy** - How will you detect new replies?
   - **Gmail Push Notifications** (recommended): Real-time via Pub/Sub
   - **Polling**: Periodic checks via Gmail API (less efficient)
   - **Hybrid**: Push for active conversations, polling as fallback

## Next Steps

When you're ready to implement Gmail conversation tracking, I can help you:
1. Design the schema additions (new tables/columns)
2. Create migration scripts
3. Design the API integration points
4. Plan the data synchronization strategy
