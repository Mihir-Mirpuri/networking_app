# Database Schema Documentation

This document describes all database tables and what data they store.

---

## Core User & Authentication

### `User`
Stores user account information and settings.

**Fields:**
- `id` - Unique identifier
- `name` - User's full name
- `email` - User's email address (unique)
- `emailVerified` - When email was verified
- `image` - Profile picture URL
- `dailySendCount` - Number of emails sent today
- `lastSendDate` - Last date emails were sent (for daily limit reset)
- `autoReplyEnabled` - Whether user wants AI-generated reply suggestions
- `createdAt` - Account creation timestamp
- `updatedAt` - Last update timestamp

**Purpose:** Main user account data and email sending limits.

**Unique Value:** Each record represents one user account. Uniqueness is enforced by `email` field.

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

**Purpose:** Stores user's resume files. Users can upload multiple versions, but typically one is marked as active. The resume can be attached to outreach emails or shared when networking.

**Unique Value:** Each record represents one resume file upload. Multiple records can exist per user (for version history), but typically one is marked as `isActive: true`.

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

**Purpose:** Stores Gmail OAuth tokens for accessing user's Gmail account (sending emails, reading conversations, syncing).

**Unique Value:** Each record represents one Gmail account connection. Uniqueness is enforced by combination of `provider` and `providerAccountId` (one Gmail account per user).

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

**Unique Value:** Each record represents one active login session. Uniqueness is enforced by `sessionToken` field (each session has a unique token).

---

### `VerificationToken`
Stores email verification tokens.

**Fields:**
- `identifier` - Email or identifier being verified
- `token` - Verification token
- `expires` - When token expires

**Purpose:** Used for email verification flows.

**Unique Value:** Each record represents one verification token. Uniqueness is enforced by `token` field (each token is unique).

---

## People & Contacts

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

**Purpose:** Centralized database of people that builds up as users discover them. Shared across all users - if User A finds "John Doe at Goldman Sachs", User B can see that person exists and benefit from shared discovery data (LinkedIn, company info, etc.). This prevents duplicate discovery work and allows collective knowledge building.

**Unique Value:** Each record represents one unique person. Uniqueness is enforced by combination of `fullName`, `company`, and `role` (one record per person). The same person can be networked with by multiple users, but there's only one Person record.

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
- `sendStatus` - Initial outreach send status (NOT_SENT, SENT, FAILED)
- `notes` - User's private notes about this person
- `createdAt` - When user added this person to their network
- `updatedAt` - Last update time

**Purpose:** Links users to people and stores user-specific data (email, send status, notes). Each user has their own relationship with each person. For example, if User A and User B both want to network with "John Doe at Goldman Sachs", there's one Person record for John, but two UserCandidate records (one for each user's relationship with John).

**Unique Value:** Each record represents one user's relationship with one person. Uniqueness is enforced by combination of `userId` and `personId` (one relationship per user-person pair). Multiple users can have relationships with the same person.

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

**Purpose:** Tracks where person information was discovered (LinkedIn, company website, etc.). Shared across all users - if User A finds John's LinkedIn, User B can see it too. This allows collective discovery benefits.

**Unique Value:** Each record represents one source link for a person. Multiple links can exist per person (one record per link found). Links are shared - all users can see discovery links for any person.

---

### `EmailDraft`
Stores draft emails for user-person relationships.

**Fields:**
- `id` - Unique identifier
- `userCandidateId` - Which user-person relationship this draft is for
- `subject` - Email subject
- `body` - Email body
- `createdAt` - Draft creation time
- `updatedAt` - Last edit time

**Purpose:** Pre-filled email templates before sending initial outreach. User-specific - each user has their own draft for their relationship with a person.

**Unique Value:** Each record represents one draft email. Uniqueness is typically one draft per user-person relationship (one-to-one relationship with UserCandidate).

---

### `SendLog`
Stores audit log of all sent emails.

**Fields:**
- `id` - Unique identifier
- `userId` - Who sent the email
- `userCandidateId` - Which user-person relationship this email is for
- `conversationId` - Related conversation (if part of ongoing thread)
- `toEmail` - Recipient email address
- `subject` - Email subject
- `body` - Email body
- `status` - Send status (SUCCESS or FAILED)
- `errorMessage` - Error message if failed
- `gmailMessageId` - Gmail's message ID
- `sentAt` - When email was sent

**Purpose:** Complete audit trail of all sent emails for compliance and tracking. Links to the user's relationship with a person (UserCandidate) - since the same person can be networked with by multiple users, each user's emails to that person are tracked separately.

**Unique Value:** Each record represents one email send attempt. Uniqueness is enforced by `gmailMessageId` (one log entry per Gmail message sent).

---

## Conversations & Messaging

### `Conversation`
Stores email conversation threads between users and people.

**Fields:**
- `id` - Unique identifier
- `userId` - Which user owns this conversation
- `userCandidateId` - Which user-person relationship this conversation is for
- `gmailThreadId` - Gmail's thread ID (unique per user's Gmail account)
- `subject` - Conversation subject
- `lastMessageAt` - When last message was sent/received
- `messageCount` - Total number of messages
- `unreadCount` - Number of unread messages
- `status` - Conversation status (ACTIVE, ARCHIVED, CLOSED)
- `autoReplyEnabled` - Whether AI reply suggestions are enabled for this conversation
- `autoReplyTemplate` - Custom reply template for this conversation
- `createdAt` - Conversation start time
- `updatedAt` - Last update time

**Purpose:** Represents an email thread/conversation between a user and a person. This is the core organizing concept - all networking happens through conversations. Multiple users can have separate conversations with the same person, but each user's conversation is tracked independently through their own UserCandidate relationship.

**Unique Value:** Each record represents one email conversation thread for one user. Uniqueness is enforced by combination of `userId` and `gmailThreadId` (one conversation per Gmail thread per user). The same person can have conversations with multiple users, each tracked separately.

---

### `Message`
Stores individual email messages in conversations.

**Fields:**
- `id` - Unique identifier
- `conversationId` - Which conversation this message belongs to
- `gmailMessageId` - Gmail's message ID (unique)
- `gmailThreadId` - Gmail's thread ID
- `inReplyTo` - Gmail message ID this replies to
- `references` - Array of message IDs in thread
- `fromEmail` - Sender email address
- `fromName` - Sender name
- `subject` - Email subject
- `body` - Email body (HTML)
- `bodyText` - Plain text version of body
- `snippet` - Short preview text
- `sentAt` - When email was sent
- `receivedAt` - When email was received
- `isRead` - Whether message has been read
- `isDraft` - Whether this is a draft
- `direction` - Message direction (SENT or RECEIVED)
- `aiProcessed` - Whether AI has processed this message
- `aiExtractedData` - JSON data extracted by AI (calendar events, etc.)
- `createdAt` - When message was stored
- `updatedAt` - Last update time

**Purpose:** Individual email messages in a conversation thread.

**Unique Value:** Each record represents one email message. Uniqueness is enforced by `gmailMessageId` (one record per Gmail message).

---

### `MessageRecipient`
Stores all recipients (TO, CC, BCC) for each message.

**Fields:**
- `id` - Unique identifier
- `messageId` - Which message this recipient is for
- `email` - Recipient email address
- `name` - Recipient name
- `type` - Recipient type (TO, CC, or BCC)

**Purpose:** Tracks who received each email (including CC'd people).

**Unique Value:** Each record represents one recipient for one message. Multiple records can exist per message (one per recipient, including CC/BCC).

---

### `ConversationParticipant`
Stores all people who have participated in a conversation.

**Fields:**
- `id` - Unique identifier
- `conversationId` - Which conversation
- `email` - Participant email address
- `name` - Participant name
- `isPrimary` - Whether this is a primary participant (user or the person they're networking with)

**Purpose:** Quick lookup of all people in a conversation (including CC'd participants).

**Unique Value:** Each record represents one participant in one conversation. Uniqueness is enforced by combination of `conversationId` and `email` (one record per person per conversation).

---

### `Attachment`
Stores email attachments.

**Fields:**
- `id` - Unique identifier
- `messageId` - Which message this attachment belongs to
- `filename` - File name
- `mimeType` - File MIME type
- `size` - File size in bytes
- `gmailAttachmentId` - Gmail's attachment ID
- `downloadUrl` - URL to download attachment

**Purpose:** Stores attachment metadata and download links.

**Unique Value:** Each record represents one attachment. Multiple attachments can exist per message (one record per file attached).

---

## AI & Suggested Replies

### `SuggestedReply`
Stores LLM-generated reply suggestions that need user approval.

**Fields:**
- `id` - Unique identifier
- `messageId` - The received message this reply is for
- `conversationId` - Which conversation
- `subject` - Suggested reply subject
- `body` - Suggested reply body
- `bodyText` - Plain text version
- `status` - Status (PENDING, APPROVED, EDITED, SENT, REJECTED)
- `approvedAt` - When user approved it
- `sentAt` - When reply was sent
- `sentMessageId` - Gmail message ID if sent
- `model` - AI model used (e.g., "gpt-4")
- `confidence` - AI confidence score
- `processingTime` - How long AI took (milliseconds)
- `userEdited` - Whether user edited before sending
- `userRejected` - Whether user rejected it
- `rejectionReason` - Why user rejected it
- `createdAt` - When suggestion was generated
- `updatedAt` - Last update time

**Purpose:** LLM-generated reply drafts that users can approve, edit, or reject before sending.

**Unique Value:** Each record represents one AI-generated reply suggestion. Typically one suggestion per received message (one-to-one relationship with message).

---

### `AIProcessing`
Stores AI processing results for messages.

**Fields:**
- `id` - Unique identifier
- `messageId` - Which message was processed
- `type` - Processing type (EXTRACT_CALENDAR_EVENT, GENERATE_REPLY, SENTIMENT_ANALYSIS, ACTION_ITEM_EXTRACTION)
- `input` - Original text that was processed
- `output` - AI response (JSON)
- `model` - AI model used
- `confidence` - AI confidence score
- `processingTime` - How long it took (milliseconds)
- `createdAt` - When processing happened

**Purpose:** Tracks all AI processing operations and results for audit and debugging.

**Unique Value:** Each record represents one AI processing operation. Multiple records can exist per message (one per processing type - e.g., calendar extraction, sentiment analysis, etc.).

---

## Notifications

### `Notification`
Stores in-app notifications for users.

**Fields:**
- `id` - Unique identifier
- `userId` - Who the notification is for
- `conversationId` - Related conversation (if applicable)
- `type` - Notification type (NEW_MESSAGE, CALENDAR_EVENT_CREATED, AUTO_REPLY_SENT, MEETING_REMINDER)
- `title` - Notification title
- `message` - Notification message
- `read` - Whether user has read it
- `metadata` - Additional data (JSON)
- `createdAt` - When notification was created

**Purpose:** In-app notifications for new messages, calendar events, etc.

**Unique Value:** Each record represents one notification. Multiple notifications can exist per user (one record per notification event).

---

### `NotificationSettings`
Stores user notification preferences.

**Fields:**
- `id` - Unique identifier
- `userId` - Which user these settings belong to
- `emailEnabled` - Whether email notifications are enabled
- `emailOnNewMessage` - Email when new message arrives
- `emailOnCalendarEvent` - Email when calendar event created
- `pushEnabled` - Whether push notifications are enabled
- `pushOnNewMessage` - Push when new message arrives
- `inAppEnabled` - Whether in-app notifications are enabled
- `quietHoursStart` - Quiet hours start (0-23)
- `quietHoursEnd` - Quiet hours end (0-23)

**Purpose:** User preferences for how they want to be notified.

**Unique Value:** Each record represents notification settings for one user. Typically one record per user (one-to-one relationship).

---

### `PushSubscription`
Stores user's push notification subscriptions for mobile notifications.

**Fields:**
- `id` - Unique identifier
- `userId` - Which user this subscription belongs to
- `endpoint` - Push service endpoint URL
- `keys` - Encryption keys (JSON: p256dh, auth)
- `userAgent` - Browser/device information
- `createdAt` - When subscription was created
- `updatedAt` - Last update timestamp

**Purpose:** Stores browser push notification subscriptions so the server can send push notifications to users' mobile devices when they receive email responses.

**Unique Value:** Each record represents one push notification subscription. Multiple subscriptions can exist per user (one per device/browser).

---

## Calendar Integration

### `CalendarEvent`
Stores calendar events extracted from emails or created manually.

**Fields:**
- `id` - Unique identifier
- `userId` - Who owns this event
- `conversationId` - Related conversation (if from email)
- `messageId` - Message that triggered this event (if from email)
- `googleCalendarId` - Google Calendar event ID (unique)
- `googleEventLink` - Link to Google Calendar event
- `title` - Event title
- `description` - Event description
- `startTime` - Event start time
- `endTime` - Event end time
- `location` - Event location
- `attendees` - Array of attendee email addresses
- `extractedFromText` - Original text that was parsed
- `confidence` - AI confidence score for extraction
- `status` - Event status (PENDING, CONFIRMED, CANCELLED, COMPLETED)
- `syncedToGoogle` - Whether synced to Google Calendar
- `createdAt` - When event was created
- `updatedAt` - Last update time

**Purpose:** Calendar events extracted from emails or created manually, synced with Google Calendar.

**Unique Value:** Each record represents one calendar event. Uniqueness is enforced by `googleCalendarId` if synced to Google Calendar, otherwise by `id` (one event per record).

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

### `ConversationStatus`
- `ACTIVE` - Active conversation
- `ARCHIVED` - Archived by user
- `CLOSED` - Conversation closed

### `MessageDirection`
- `SENT` - User sent this message
- `RECEIVED` - User received this message

### `RecipientType`
- `TO` - Primary recipient
- `CC` - Carbon copy recipient
- `BCC` - Blind carbon copy recipient

### `SuggestedReplyStatus`
- `PENDING` - Generated, waiting for approval
- `APPROVED` - User approved, ready to send
- `EDITED` - User edited before sending
- `SENT` - Successfully sent
- `REJECTED` - User rejected

### `NotificationType`
- `NEW_MESSAGE` - New message received
- `CALENDAR_EVENT_CREATED` - Calendar event created
- `AUTO_REPLY_SENT` - Auto-reply was sent
- `MEETING_REMINDER` - Meeting reminder

### `CalendarEventStatus`
- `PENDING` - Event pending
- `CONFIRMED` - Event confirmed
- `CANCELLED` - Event cancelled
- `COMPLETED` - Event completed

### `AIProcessingType`
- `EXTRACT_CALENDAR_EVENT` - Extract calendar event from text
- `GENERATE_REPLY` - Generate email reply
- `SENTIMENT_ANALYSIS` - Analyze message sentiment
- `ACTION_ITEM_EXTRACTION` - Extract action items

---

## Summary

**User Management:** `User`, `UserResume`, `Account` (Gmail only), `Session`, `VerificationToken`, `PushSubscription`

**People & Contacts:** `Person` (centralized), `UserCandidate` (user-specific relationships), `SourceLink`, `EmailDraft`, `SendLog`

**Conversations:** `Conversation`, `Message`, `MessageRecipient`, `ConversationParticipant`, `Attachment`

**AI Features:** `SuggestedReply`, `AIProcessing`

**Notifications:** `Notification`, `NotificationSettings`

**Calendar:** `CalendarEvent`

**Core Concept:** The `Conversation` table is the central organizing concept. All networking happens through email conversations with people.

**Architecture:**
- **`Person`** = Centralized database of actual people (shared across all users)
- **`UserCandidate`** = User-specific relationship data (email, send status, notes)
- **`Conversation`** = Email threads between users and people

**Benefits of Centralized Approach:**
- **Collective Discovery:** If User A finds John's LinkedIn, User B can see it too
- **Shared Enrichment:** Enrich a person once, all users benefit
- **Network Insights:** See how many users are networking with the same person
- **Privacy:** User-specific data (emails, send status, notes) stays private in UserCandidate
- **Less Duplication:** One Person record, multiple UserCandidate relationships

**Important:** Multiple users can email the same person (e.g., multiple students emailing the same Goldman Sachs associate). There's one `Person` record for that person, but each user has their own `UserCandidate` relationship and their own `Conversation` thread. This allows collective knowledge building while maintaining privacy for user-specific data.
