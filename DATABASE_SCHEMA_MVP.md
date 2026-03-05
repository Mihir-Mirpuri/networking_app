# Database Schema - MVP Version

This is the simplified schema for the MVP. It's designed to easily expand into the full schema as features are added.

---

## Core User & Authentication

### `User`
Stores user account information.

**Fields:**
- `id` - Unique identifier
- `name` - User's full name
- `email` - User's email address (unique)
- `emailVerified` - When email was verified
- `image` - Profile picture URL
- `dailySendCount` - Number of emails sent today
- `lastSendDate` - Last date emails were sent (for daily limit reset)
- `createdAt` - Account creation timestamp
- `updatedAt` - Last update timestamp

**Purpose:** Main user account data and email sending limits.

**Unique Value:** Each record represents one user account. Uniqueness is enforced by `email` field.

---

### `Account`
Stores Gmail OAuth connection for the user.

**Fields:**
- `id` - Unique identifier
- `userId` - Which user this account belongs to
- `type` - Account type (e.g., "oauth")
- `provider` - Always "google" (Gmail only)
- `providerAccountId` - User's Google account ID
- `refresh_token` - Gmail OAuth refresh token
- `access_token` - Gmail OAuth access token
- `expires_at` - When access token expires
- `token_type` - Token type (usually "Bearer")
- `scope` - Gmail OAuth scopes granted (gmail.send, gmail.readonly)
- `id_token` - Google ID token
- `session_state` - Session state
- `refresh_token_expires_in` - Refresh token expiration

**Purpose:** Stores Gmail OAuth tokens for sending emails.

**Unique Value:** Each record represents one Gmail account connection. Uniqueness is enforced by combination of `provider` and `providerAccountId`.

---

### `Session`
Stores user login sessions.

**Fields:**
- `id` - Unique identifier
- `sessionToken` - Unique session token
- `userId` - Which user this session belongs to
- `expires` - When session expires
- `createdAt` - Session creation time

**Purpose:** Tracks who is currently logged in.

**Unique Value:** Each record represents one active login session. Uniqueness is enforced by `sessionToken` field.

---

### `VerificationToken`
Stores email verification tokens.

**Fields:**
- `identifier` - Email or identifier being verified
- `token` - Verification token
- `expires` - When token expires

**Purpose:** Used for email verification flows.

**Unique Value:** Each record represents one verification token. Uniqueness is enforced by `token` field.

---

### `UserResume`
Stores user's resume files.

**Fields:**
- `id` - Unique identifier
- `userId` - Which user owns this resume
- `filename` - Original file name (e.g., "John_Doe_Resume.pdf")
- `fileUrl` - URL to stored file (S3, Supabase Storage, etc.)
- `fileSize` - File size in bytes
- `mimeType` - File MIME type (e.g., "application/pdf")
- `version` - Resume version number (increments on updates)
- `isActive` - Whether this is the current/active resume
- `uploadedAt` - When resume was uploaded
- `createdAt` - Record creation timestamp
- `updatedAt` - Last update timestamp

**Purpose:** Stores user's resume files. Users can upload multiple versions, but typically one is marked as active. Users can choose to attach their resume when sending networking emails.

**Unique Value:** Each record represents one resume file upload. Multiple records can exist per user (for version history), but typically one is marked as `isActive: true`.

---

## Discovery & People

### `Person`
Stores actual people (centralized, shared across all users).

**Fields:**
- `id` - Unique identifier
- `fullName` - Full name
- `firstName` - First name
- `lastName` - Last name
- `company` - Company they work at
- `role` - Job title/role
- `linkedinUrl` - LinkedIn profile URL (if found)
- `createdAt` - When person was first added to system
- `updatedAt` - Last update time

**Purpose:** Centralized database of people that builds up as users discover them. Shared across all users.

**Unique Value:** Each record represents one unique person. Uniqueness is enforced by combination of `fullName`, `company`, and `role`.

---

### `UserCandidate`
Stores user-specific relationship data with people.

**Fields:**
- `id` - Unique identifier
- `userId` - Which user this relationship belongs to
- `personId` - Which person this relationship is with
- `email` - Email address (if found) - user-specific
- `emailStatus` - Email status (MISSING, UNVERIFIED, VERIFIED, MANUAL)
- `emailConfidence` - Confidence score for email (0-1)
- `manualEmailConfirmed` - Whether user manually confirmed email
- `createdAt` - When user added this person to their network
- `updatedAt` - Last update time

**Purpose:** Links users to people and stores user-specific data (email, email status). Used to track who the user wants to network with.

**Unique Value:** Each record represents one user's relationship with one person. Uniqueness is enforced by combination of `userId` and `personId`.

---

### `SourceLink`
Stores links where person information was discovered (shared across all users).

**Fields:**
- `id` - Unique identifier
- `personId` - Which person this link is for
- `kind` - Link type (DISCOVERY or RESEARCH)
- `url` - Link URL
- `title` - Link title
- `snippet` - Link description/snippet
- `domain` - Domain name
- `createdAt` - When link was found

**Purpose:** Tracks where person information was discovered (LinkedIn, company website, etc.). Shared across all users.

**Unique Value:** Each record represents one source link for a person. Multiple links can exist per person.

---

## Email Generation & Sending

### `EmailTemplate`
Stores user's ChatGPT prompt/template for generating networking emails.

**Fields:**
- `id` - Unique identifier
- `userId` - Which user owns this template
- `name` - Template name (e.g., "Finance Outreach")
- `prompt` - ChatGPT prompt/template text
- `isDefault` - Whether this is the default template
- `createdAt` - Template creation time
- `updatedAt` - Last update time

**Purpose:** Stores the ChatGPT prompt that users create to generate networking emails. Users can have multiple templates.

**Unique Value:** Each record represents one email template. Multiple templates can exist per user.

---

### `EmailDraft`
Stores AI-generated email drafts for review before sending.

**Fields:**
- `id` - Unique identifier
- `userCandidateId` - Which user-person relationship this draft is for
- `templateId` - Which template was used to generate this
- `subject` - Email subject (AI-generated)
- `body` - Email body (AI-generated)
- `status` - Draft status (PENDING, APPROVED, REJECTED, SENT)
- `userEdited` - Whether user edited the draft
- `editedSubject` - User-edited subject (if changed)
- `editedBody` - User-edited body (if changed)
- `attachResume` - Whether user wants to attach resume to this email
- `resumeId` - Which resume to attach (if attachResume is true)
- `createdAt` - When draft was generated
- `updatedAt` - Last update time

**Purpose:** Stores ChatGPT-generated email drafts that users can review, edit, approve, or reject before sending. Users can choose to attach their resume to each email individually.

**Unique Value:** Each record represents one email draft. Typically one draft per user-person relationship.

---

### `SendLog`
Stores audit log of all sent emails.

**Fields:**
- `id` - Unique identifier
- `userId` - Who sent the email
- `userCandidateId` - Which user-person relationship this email is for
- `toEmail` - Recipient email address
- `subject` - Email subject (final version sent)
- `body` - Email body (final version sent)
- `resumeAttached` - Whether resume was attached to this email
- `resumeId` - Which resume was attached (if any)
- `status` - Send status (SUCCESS or FAILED)
- `errorMessage` - Error message if failed
- `gmailMessageId` - Gmail's message ID
- `sentAt` - When email was sent

**Purpose:** Complete audit trail of all sent emails. Used to track who has been messaged to prevent duplicate sends. Also tracks if resume was attached.

**Unique Value:** Each record represents one email send attempt. Uniqueness is enforced by `gmailMessageId` (one log entry per Gmail message sent).

---

## Enums (Status Values)

### `EmailStatus`
- `MISSING` - Email not found
- `UNVERIFIED` - Email found but not verified
- `VERIFIED` - Email verified
- `MANUAL` - Email entered manually

### `SendStatus`
- `NOT_SENT` - Not sent yet
- `SENT` - Successfully sent
- `FAILED` - Failed to send

### `SourceLinkKind`
- `DISCOVERY` - Found during person discovery
- `RESEARCH` - Found during research phase

### `SendLogStatus`
- `SUCCESS` - Email sent successfully
- `FAILED` - Email failed to send

### `EmailDraftStatus`
- `PENDING` - Generated, waiting for user review
- `APPROVED` - User approved, ready to send
- `REJECTED` - User rejected this draft
- `SENT` - Successfully sent

---

## Summary

**User Management:** `User`, `UserResume`, `Account` (Gmail only), `Session`, `VerificationToken`

**Discovery:** `Person` (centralized), `UserCandidate` (user-specific relationships), `SourceLink`

**Email Generation:** `EmailTemplate` (ChatGPT prompts), `EmailDraft` (AI-generated drafts for review)

**Sending:** `SendLog` (tracks sent emails to prevent duplicates)

---

## MVP Workflow

1. **User uploads resume** → `UserResume` record created (optional, can do anytime)
2. **User searches for people** → Enters search criteria (school, company, role) → Discovery runs (no database record - just a search action)
3. **Discovery finds people** → Creates `Person` records (if new) → Creates `UserCandidate` relationships for user
4. **User sets ChatGPT template** → `EmailTemplate` record created (or uses existing default)
5. **AI generates emails** → Creates `EmailDraft` records for each person in user's network
6. **User reviews drafts** → Can edit, approve, or reject each draft → Can choose to attach resume per email
7. **User sends emails** → Creates `SendLog` records (with resume attachment info) → Updates `EmailDraft` status to SENT
8. **User views sent list** → Queries `SendLog` to see who they've messaged (prevents duplicates)

**Note:** Campaigns are not stored. The search form is just a temporary action to discover people. Once people are found, they're added to the user's network (`UserCandidate`), and the search criteria are discarded.

---

## Migration Path to Full Schema

This MVP schema is designed to easily expand:

**To add conversations:**
- Add `Conversation` table (links to `UserCandidate`)
- Add `Message` table (links to `Conversation`)
- Add `MessageRecipient`, `ConversationParticipant`, `Attachment` tables

**To add AI features:**
- Add `SuggestedReply` table (links to `Message`)
- Add `AIProcessing` table (links to `Message`)

**To add notifications:**
- Add `Notification` table
- Add `NotificationSettings` table
- Add `PushSubscription` table

**To add calendar:**
- Add `CalendarEvent` table (links to `Conversation` or `Message`)

The core structure (`Person`, `UserCandidate`, `SendLog`) remains the same - we just add new tables on top.

---

## Why This MVP Schema is Easy to Build On

**1. Modular Design:**
- Each feature is in its own table(s)
- Adding new features = adding new tables, not restructuring existing ones
- Core tables (`Person`, `UserCandidate`, `SendLog`) stay stable

**2. Clear Relationships:**
- `UserCandidate` is the central relationship table
- Everything links through it: `EmailDraft` → `UserCandidate`, `SendLog` → `UserCandidate`
- Future: `Conversation` → `UserCandidate` (easy to add)

**3. No Breaking Changes:**
- Adding `Conversation` table doesn't affect existing `EmailDraft` or `SendLog`
- Adding `Message` table doesn't affect `EmailDraft`
- Can add features incrementally without refactoring

**4. Scalable Structure:**
- `Person` table is already centralized (ready for multi-user)
- `UserCandidate` separates shared data from user-specific data
- Easy to add indexes, relationships, etc. later

**5. Migration Path:**
- MVP → Full schema is additive (add tables, don't remove)
- Can migrate data gradually
- No data loss when expanding
