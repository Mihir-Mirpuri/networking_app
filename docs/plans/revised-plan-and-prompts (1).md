# Revised Implementation Plan & Claude Code Prompts

## What Changed After Reviewing Your Schema

### Key Findings

1. **`EmailDraft`** exists with `subject`, `body`, `status`, and a 1:1 link to `UserCandidate`. It has NO tracking fields currently.

2. **`SendLog`** already stores `gmailMessageId` and `gmailThreadId` — so the original plan's idea of putting those on EmailDraft is partially redundant.

3. **`OutreachTracker`** already has `responseReceivedAt`, `gmailThreadId`, and a rich status enum (`RESPONDED`, `GHOSTED`, etc.). It links to `UserCandidate` and `SendLog[]`.

4. **`conversations` and `messages`** tables already exist for the Gmail sync/readonly system. These are tied to `gmail_sync_state` and `processed_notifications`. This is your gmail.readonly infrastructure.

5. **`UserCandidate`** is the central hub: it connects User → Person → EmailDraft → OutreachTracker → SendLog.

### Design Decision: New Tables, Not Modified Existing Ones

Since you'll eventually migrate back to `gmail.readonly`, the relay system should live in its own tables. This means:

- **Don't add tracking fields to `EmailDraft`** — it's a drafting model, not a tracking model
- **Don't reuse `conversations`/`messages`** — those are for Gmail sync
- **Minimal additions to `OutreachTracker`** — only universal status fields that apply regardless of tracking method

### New Tables

**`EmailTracker`** — one per sent email, owns the relay identity and tracking data:
- Links to `SendLog` (which already has gmailMessageId/gmailThreadId)
- Holds replyToken, replyToAddress, relayDomain
- Holds open tracking counters
- This is the table you'll eventually deprecate when you switch back to gmail.readonly

**`RelayMessage`** — stores both sides of relay conversations:
- Links to `EmailTracker`
- Direction, content, threading headers, classification
- Named differently from `messages` to avoid confusion with the Gmail sync table

### Fields Added to Existing Tables

**`OutreachTracker`** gets only these (they're useful regardless of relay vs gmail.readonly):
- `repliedAt` — when the first human reply came in
- `replySnippet` — preview text
- `isAutoReply` — was it an OOO
- `messageCount` — total messages in thread
- `lastMessageAt` / `lastMessageDirection` — latest activity

These fields are about outreach status, not about the relay mechanism, so they belong on OutreachTracker permanently.

### Relationship Chain

```
UserCandidate
  → EmailDraft (1:1, drafting)
  → SendLog (1:many, send history)
      → EmailTracker (1:1, relay tracking — NEW)
          → RelayMessage[] (1:many, conversation — NEW)
  → OutreachTracker (1:1, status dashboard)
```

`EmailTracker` links to `SendLog` rather than `EmailDraft` because SendLog is where the actual send event lives (with gmailMessageId, gmailThreadId, toEmail, etc.). EmailDraft is about the draft content before sending.

---

## Revised Prisma Schema Additions

```prisma
model EmailTracker {
  id              String    @id @default(cuid())
  sendLogId       String    @unique
  
  // Relay identity
  replyToken      String    @unique
  replyToAddress  String               // thread.TOKEN@relay.com
  relayDomain     String               // which relay domain was used
  
  // Open tracking
  openedAt        DateTime?
  openCount       Int       @default(0)
  lastOpenedAt    DateTime?
  
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  
  // Relations
  sendLog         SendLog        @relation(fields: [sendLogId], references: [id], onDelete: Cascade)
  relayMessages   RelayMessage[]
  
  @@index([replyToken])
  @@index([sendLogId])
}

model RelayMessage {
  id              String    @id @default(cuid())
  emailTrackerId  String
  
  // Direction
  direction       String               // 'user_to_banker' | 'banker_to_user'
  
  // Participants
  fromAddress     String
  fromName        String?
  toAddress       String
  toName          String?
  
  // Content
  subject         String?
  bodyText        String?
  bodyHtml        String?              // Sanitized for inbound messages
  snippet         String?              // First 200 chars for preview
  
  // Threading headers
  messageId       String?   @unique    // This message's Message-ID
  inReplyTo       String?              // Parent message's Message-ID
  references      String?              // Space-separated ancestor chain
  
  // Classification (inbound only)
  classification  String?              // 'human_reply' | 'auto_reply' | 'bounce'
  
  receivedAt      DateTime  @default(now())
  createdAt       DateTime  @default(now())
  
  // Relations
  emailTracker    EmailTracker @relation(fields: [emailTrackerId], references: [id], onDelete: Cascade)
  
  @@index([emailTrackerId, createdAt])
}
```

Plus additions to OutreachTracker (new fields only):
```prisma
// Add to existing OutreachTracker model:
  repliedAt             DateTime?
  replySnippet          String?
  replyClassification   String?          // 'human_reply' | 'auto_reply' | 'bounce'
  isAutoReply           Boolean  @default(false)
  messageCount          Int      @default(1)
  lastMessageAt         DateTime?
  lastMessageDirection  String?          // 'user_to_banker' | 'banker_to_user'
```

And a relation added to SendLog:
```prisma
// Add to existing SendLog model:
  emailTracker    EmailTracker?
```

---

## Why This Is Better for Migration

When you get gmail.readonly back:
1. Banker replies land directly in Gmail → your existing `conversations`/`messages` tables handle them
2. You stop generating replyTokens and relay addresses
3. `EmailTracker` and `RelayMessage` tables become dormant (or you migrate any active conversations)
4. `OutreachTracker` fields like `repliedAt` and `messageCount` keep working — they don't care about the source
5. No cleanup needed on `EmailDraft` or `SendLog`

---

## Revised Claude Code Prompts

### Prompt 1: Reply Token Library + Database Schema

```
I'm building a stealth reply-to proxy for email tracking in my Next.js app.

First, read my Prisma schema at prisma/schema.prisma to understand the existing models — particularly EmailDraft, SendLog, OutreachTracker, and UserCandidate.

Then do the following:

1. Create a reply token utility at `src/lib/reply-token.ts` with:
   - `generateReplyToken()` — generates a crypto-random 10-byte base64url token
   - `buildReplyToAddress(displayName, token, domainIndex?)` — returns { address, displayName, domain } using relay domains from env var RELAY_DOMAINS (comma-separated, e.g., "mailbridge.io,relayhub.net"). Picks a random domain if domainIndex not specified.
   - `extractTokenFromAddress(email)` — extracts token from "thread.TOKEN@domain" format, returns null if format doesn't match

2. Create TWO new Prisma models (do NOT modify EmailDraft or the existing `conversations`/`messages` tables — those are for a different system):

   **EmailTracker** — one per sent email, linked to SendLog (1:1):
   - id (cuid), sendLogId (String @unique, relation to SendLog)
   - replyToken (String @unique), replyToAddress (String), relayDomain (String)
   - openedAt (DateTime?), openCount (Int @default(0)), lastOpenedAt (DateTime?)
   - createdAt, updatedAt
   - Relation: sendLog (SendLog), relayMessages (RelayMessage[])
   - Indexes on replyToken and sendLogId

   **RelayMessage** — stores both sides of relay conversations:
   - id (cuid), emailTrackerId (String, relation to EmailTracker)
   - direction (String: 'user_to_banker' or 'banker_to_user')
   - fromAddress, fromName?, toAddress, toName?
   - subject?, bodyText?, bodyHtml?, snippet?
   - messageId? (@unique), inReplyTo?, references?
   - classification? (String: 'human_reply' | 'auto_reply' | 'bounce')
   - receivedAt, createdAt
   - Index on [emailTrackerId, createdAt]

3. Add a relation from SendLog to EmailTracker (add `emailTracker EmailTracker?` to SendLog).

4. Add these fields to the EXISTING OutreachTracker model (do not remove or change any existing fields):
   - repliedAt (DateTime?)
   - replySnippet (String?)
   - replyClassification (String?)
   - isAutoReply (Boolean @default(false))
   - messageCount (Int @default(1))
   - lastMessageAt (DateTime?)
   - lastMessageDirection (String?)

5. Run `npx prisma db push` to apply changes.

IMPORTANT: The existing `conversations`, `messages`, `gmail_sync_state`, and `processed_notifications` tables are part of a Gmail sync system that will be re-enabled later. Do NOT touch them.
```

---

### Prompt 2: Open Tracking Endpoint

```
I need a tracking pixel endpoint for my email system. This endpoint interacts with the new EmailTracker model (not EmailDraft).

Read my schema to see the EmailTracker model, then:

1. Create a tracking pixel endpoint at `src/app/api/track/[emailTrackerId]/pixel.png/route.ts`:
   - Returns a 1x1 transparent PNG (hardcoded base64 buffer)
   - Fire-and-forget: increments openCount and sets lastOpenedAt on EmailTracker
   - Only sets openedAt if it's currently null (first open)
   - Headers: Content-Type image/png, Cache-Control no-store

Look at my existing API routes for patterns and conventions.
```

---

### Prompt 3: Modify Email Send Flow

```
I need to modify my existing email send flow to add Reply-To headers, tracking, and create an EmailTracker + initial RelayMessage when an email is sent.

Read my existing send actions (search for sendSingleEmailAction, sendEmailsAction, or similar in src/app/actions/) and my Gmail client setup. Also read SendLog and EmailTracker models in the schema.

Modify the send flow so that AFTER a successful send (after SendLog is created):

1. Generate a reply token using generateReplyToken() from src/lib/reply-token.ts
2. Build a Reply-To address using buildReplyToAddress() — display name should be the user's name so it looks natural
3. BEFORE sending: modify the MIME message to include:
   - Reply-To header: "User Name" <thread.TOKEN@relay.com>
   - A tracking pixel <img> tag appended to the HTML body, pointing to /api/track/[emailTrackerId]/pixel.png
4. After sending via Gmail API, fetch the sent message to get the Message-ID header
5. Create an EmailTracker record linked to the SendLog, with: replyToken, replyToAddress, relayDomain
6. Create a RelayMessage record linked to the EmailTracker with:
   - direction: 'user_to_banker'
   - fromAddress: user's Gmail, fromName: user's name
   - toAddress: recipient email, toName: recipient name
   - subject, bodyHtml (the final HTML with tracking pixel), snippet (plain text preview, 200 chars)
   - messageId: the Message-ID header from Gmail

Note: The EmailTracker ID won't exist yet when you build the tracking pixel URL. You'll need to either: (a) create the EmailTracker first with a placeholder, then update after send, or (b) use the SendLog ID for tracking URLs and look up the EmailTracker from it. Choose whichever approach is cleaner given the existing code structure.

IMPORTANT: The From address must ALWAYS be the user's real Gmail. The Reply-To is the relay address. Keep the existing send flow working — augment it, don't break it.
```

---

### Prompt 4: Email Classification + HTML Sanitization

```
Create two utility libraries for processing inbound emails from bankers:

1. `src/lib/email-classify.ts` — classifyInboundEmail(headers, subject, fromAddress) returns 'human_reply' | 'auto_reply' | 'bounce':
   
   Auto-reply detection:
   - Auto-Submitted header contains "auto"
   - X-Auto-Reply header is "yes"
   - X-Auto-Response-Suppress header exists
   - Precedence is "bulk" or "auto_reply"
   
   OOO detection by subject:
   - "out of office", "out of the office", "automatic reply", "auto-reply", "auto reply", "away from office", "on vacation"
   
   Bounce detection:
   - Content-Type includes "delivery-status"
   - Return-Path is "<>"
   - From contains "mailer-daemon" or "postmaster"
   
   Default: 'human_reply'

2. `src/lib/email-sanitize.ts` — sanitizeHtml(html) that strips dangerous content:
   - Allow: p, br, b, strong, i, em, u, a, ul, ol, li, blockquote, div, span, h1-h6, table/thead/tbody/tr/td/th
   - Allow attributes: href, target, style only
   - Forbid: script, iframe, object, embed, form, input
   - No data attributes

Install whichever sanitization library works best in a Next.js serverless environment (sanitize-html or isomorphic-dompurify). Write tests for both utilities covering the cases above.
```

---

### Prompt 5: Inbound Email Webhook (SendGrid)

```
Create the SendGrid Inbound Parse webhook at src/app/api/webhooks/inbound-email/route.ts.

This endpoint receives POST requests from SendGrid when a banker replies to a relay address (e.g., thread.TOKEN@mailbridge.io). Read my schema to understand EmailTracker, RelayMessage, OutreachTracker, SendLog, UserCandidate, Person, and User relationships.

The handler should:

1. Authenticate: check query param `secret` matches env var INBOUND_WEBHOOK_SECRET (SendGrid Inbound Parse doesn't forward Basic Auth headers, so use ?secret=XYZ in the webhook URL)
2. Reject payloads >10MB
3. Parse SendGrid formData: from, subject, text, html, headers, envelope
4. Extract reply token from the envelope "to" addresses using extractTokenFromAddress from src/lib/reply-token.ts
5. Look up EmailTracker by replyToken, including: sendLog (with userCandidate.user, userCandidate.person), and find the associated OutreachTracker (via sendLog.outreachTrackerId or sendLog.userCandidate.outreachTracker)
6. Parse raw headers string into key-value pairs (handle multiline header folding)
7. Classify with classifyInboundEmail from src/lib/email-classify.ts
8. Sanitize HTML with sanitizeHtml from src/lib/email-sanitize.ts
9. Create a RelayMessage with direction 'banker_to_user', all parsed fields, and the classification
10. Update OutreachTracker based on classification:
    - human_reply: set status RESPONDED, repliedAt, replySnippet, increment messageCount (wrap in a transaction to avoid race conditions between the conditional update and the increment)
    - bounce: update the related Person's emailStatus to BOUNCED (if accessible)
    - auto_reply: set isAutoReply true, replyClassification 'auto_reply', increment messageCount
11. For human_reply ONLY: send a notification email to the user via SendGrid (@sendgrid/mail):
    - From: notifications@signl.app
    - Subject: "[Sender Name] replied to your outreach"
    - Body: short snippet + link to Signl (NEXT_PUBLIC_APP_URL)
    - Do NOT include the full reply content — just a teaser to drive them into the app
12. Always return 200, even for unknown tokens (prevent SendGrid retry loops)

Install @sendgrid/mail. The env vars needed: SENDGRID_API_KEY, INBOUND_WEBHOOK_SECRET.
```

---

### Prompt 6: In-App Reply (Server Actions)

```
Create two server actions for the in-app reply system. Read the schema to understand the relationships: EmailTracker → SendLog → UserCandidate → User/Person, and EmailTracker → RelayMessage[].

1. `src/app/actions/sendReplyAction.ts`:
   - Params: emailTrackerId, replyBody (HTML string), userId
   - Fetch EmailTracker with: sendLog.userCandidate.user, sendLog.userCandidate.person, sendLog (for gmailThreadId), and the latest RelayMessage
   - Verify the user owns this conversation (userId must match)
   - Build threading headers:
     - In-Reply-To: the most recent RelayMessage's messageId
     - References: all messageIds from all RelayMessages in this tracker, space-separated, chronological
   - Build subject with "Re:" prefix if not already present
   - Build raw MIME with: From (user's Gmail), To (banker's email from Person), Reply-To (EmailTracker.replyToAddress — keeps the relay in the loop), In-Reply-To, References, Subject, HTML body
   - Send via Gmail API with threadId from SendLog.gmailThreadId to keep in same Gmail thread
   - Fetch sent message to get new Message-ID
   - Store as RelayMessage (direction: user_to_banker)
   - Update OutreachTracker: increment messageCount, set lastMessageAt, lastMessageDirection 'user_to_banker'
   - Return { success: true, messageId }

2. `src/app/actions/getConversationAction.ts`:
   - Params: emailTrackerId, userId
   - Fetch EmailTracker with all RelayMessages (ordered createdAt asc), and related sendLog.userCandidate.user/person
   - Verify user owns the conversation
   - Return: { emailTracker info, banker info (name/email/company/role from Person), messages array, tracking signals (opened, openCount) }

Look at existing server action patterns and the Gmail client setup (search for getGmailClient or similar) for conventions.
```

---

### Prompt 7: Conversation Thread UI

```
Build the conversation thread UI for viewing and replying to email conversations in Signl.

Look at my existing components, UI patterns, and styling approach first. Then create a ConversationThread component (place it wherever matches my component structure):

- Props: emailTrackerId, userId
- Uses getConversationAction to load data
- Header: banker name, role @ company, tracking signals (opened Xx)
- Message thread:
  - user_to_banker messages styled differently from banker_to_user (e.g., right-aligned vs left, different bg color)
  - Auto-reply messages get a distinct badge/label
  - Each message shows: sender name, timestamp, rendered HTML body (already sanitized server-side)
- Reply box at bottom:
  - Textarea + Send button
  - Calls sendReplyAction on submit
  - Disabled while sending, shows loading state
  - Clears input and refreshes conversation on success
  - Error handling with user feedback
- Polls for new messages every 30 seconds while mounted (useEffect with setInterval)

Integrate this component into whatever page currently shows outreach details or email status — look at the existing outreach tracker UI for the right place to add it.
```

---

### Prompt 8: Security Hardening + Data Retention

```
Add security hardening and data retention to the email tracking system.

1. Rate limiting:
   - Check if I already use Upstash or any rate limiting library. If yes, use the same approach. If not, install @upstash/ratelimit and @upstash/redis (or use a simple in-memory rate limiter if I don't have Redis/Upstash set up).
   - Add rate limiting to:
     - /api/webhooks/inbound-email: 100 requests/minute
     - /api/track/[emailTrackerId]/pixel.png: 1000 requests/minute

2. Data retention cron at `src/app/api/cron/purge-conversations/route.ts`:
   - Redacts bodyText and bodyHtml on RelayMessage records older than 90 days (set to "[REDACTED — retention policy]")
   - Nullifies replySnippet on OutreachTracker for old records
   - Keeps metadata intact (timestamps, direction, classification)
   - Check if I already have Vercel cron config (vercel.json) and add this job

3. Security review — check all the new endpoints for:
   - Missing error handling or try/catch
   - Missing input validation
   - Any potential security issues (XSS, injection)
   - Confirm the webhook authentication works correctly
```

---

### Prompt 9: Integration Testing + Wiring Check

```
Review the entire email tracking + relay system for correctness and integration issues.

1. Trace the full data flow and verify:
   - Send flow creates SendLog → EmailTracker → first RelayMessage correctly
   - Webhook finds EmailTracker via replyToken → creates RelayMessage → updates OutreachTracker
   - sendReplyAction reads RelayMessages for threading → sends via Gmail API → stores new RelayMessage
   - getConversationAction returns the right shaped data for the UI
   - ConversationThread component is wired into the outreach UI

2. Check relationship consistency:
   - EmailTracker.sendLogId correctly references SendLog
   - RelayMessage.emailTrackerId correctly references EmailTracker
   - The path from webhook inbound to finding the OutreachTracker works (EmailTracker → SendLog → outreachTrackerId or sendLog.userCandidate.outreachTracker)

3. Write tests for:
   - Token generation + extraction roundtrip
   - Email classification (various header combos)
   - HTML sanitization (blocks scripts, allows safe tags)

4. Run the TypeScript build and fix any type errors.

5. Create a summary of all new env vars needed:
   - RELAY_DOMAINS
   - INBOUND_WEBHOOK_SECRET
   - SENDGRID_API_KEY
   - Any others that were introduced

6. Flag anything that looks broken, inconsistent, or could fail at runtime.
```

---

## Migration Path Summary

**Now (relay system):**
- `EmailTracker` + `RelayMessage` handle all tracking and conversations
- Relay proxy catches banker replies
- Users reply through Signl UI

**Later (gmail.readonly restored):**
- Re-enable Gmail watch/sync → `conversations` + `messages` tables resume
- Stop generating replyTokens (or keep as fallback)
- `EmailTracker` + `RelayMessage` become dormant
- `OutreachTracker` fields (repliedAt, messageCount, etc.) keep working — they're source-agnostic
- No schema cleanup needed on core tables
