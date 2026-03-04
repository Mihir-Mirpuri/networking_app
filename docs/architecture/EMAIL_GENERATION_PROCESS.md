# Full Email Generation Process Mapped Out

## Context

- **ExpandedReview.tsx** is the primary email composition UI. It opens when a user clicks on a search result and handles draft generation, refinement, editing, and sending.
- **ComposeEmailModal.tsx** is a separate direct-compose flow for ad-hoc emails (no Person/UserCandidate involved).
- **Server Actions** live in `src/app/actions/search.ts` (draft generation, refinement), `src/app/actions/send.ts` (sending, scheduling), and `src/app/actions/compose.ts` (direct compose).
- **Key files:** `search.ts` (draft generation actions), `send.ts` (send pipeline), `compose.ts` (direct compose), `personalization.ts` (Groq LLM calls), `gmail.ts` (Gmail API), `email-pattern.ts` (free email generation), `enrichment.ts` (Apollo API), `ExpandedReview.tsx` (review modal), `ComposeEmailModal.tsx` (compose modal).

---

## Part 1: Placeholder Draft Generation (During Search)

When search results are returned, each result gets a placeholder email draft. This happens inside `buildResultsWithDrafts()`, called at the end of `searchPeopleAction()` and `loadMorePeopleAction()`.

### Step 1: Template Resolution

```
buildResultsWithDrafts(people, userId, templateId, user)
 |
 |-- resolveTemplateForUser(userId, templateId)
 |   |
 |   |-- IF templateId provided:
 |   |   |-- Check hardcoded EMAIL_TEMPLATES array (4 built-in templates)
 |   |   \-- Else query EmailTemplate table by ID
 |   |
 |   |-- ELSE: query user's default template (isDefault = true)
 |   |
 |   \-- FALLBACK: EMAIL_TEMPLATES[0] (hardcoded default)
 |
 |-- Template contains:
 |   |-- subject: e.g. "Coffee Chat Request — {company}"
 |   \-- body: e.g. "Hi {first_name}, I'm {user_name} from {university}..."
```

**Hardcoded templates** (EMAIL_TEMPLATES in search.ts): 4 built-in templates covering coffee chat, informational interview, mentorship, and referral request. Users can also create custom templates stored in the EmailTemplate table.

### Step 2: Placeholder Variable Replacement

```
 |-- For each person in results:
 |   |
 |   |-- prisma.userCandidate.upsert()           // create user→person relationship
 |   |   |-- Key: (userId, personId) unique
 |   |   \-- Sets email context from Person record
 |   |
 |   |-- generateEmailDraft(template, person, user)
 |   |   |-- Replace variables in subject + body:
 |   |   |   |-- {first_name}    → person.firstName
 |   |   |   |-- {last_name}     → person.lastName
 |   |   |   |-- {company}       → person.company
 |   |   |   |-- {role}          → person.role
 |   |   |   |-- {user_name}     → user.name
 |   |   |   |-- {university}    → user.university
 |   |   |   |-- {major}         → user.major
 |   |   |   |-- {classification}→ user.classification
 |   |   |   \-- {career}        → user.career
 |   |   \-- Return { subject, body } with variables filled
 |   |
 |   |-- prisma.emailDraft.upsert()
 |   |   |-- Key: userCandidateId (1:1 with UserCandidate)
 |   |   |-- Sets subject, body from placeholder generation
 |   |   |-- status = PENDING
 |   |   \-- userEdited = false
 |   |
 |   \-- Map to SearchResultWithDraft { person fields + draft subject/body }
```

**Output:** Each search result carries a placeholder draft — template text with variables replaced but NO personalization. The draft is saved to the EmailDraft table for persistence.

---

## Part 2: LLM Draft Generation (On Profile Open)

When the user clicks on a search result, `ExpandedReview` opens and automatically triggers LLM-powered draft generation.

### Step 1: Context Assembly

```
User clicks person in search results
 |
 \-- ExpandedReview mounts → useEffect triggers generateLLMDraftAction()
     |
     |-- AUTH + FETCH CONTEXT ----------------------------------
     |-- getServerSession()                        // which user?
     |-- prisma.person.findUnique(personId)        // recipient data
     |   \-- Fetches: name, company, role, location, education (school, degree, field, year)
     |
     |-- prisma.user.findUnique(userId)            // sender data
     |   \-- Fetches: name, university, classification, major, career, emailInstructions
     |
     |-- getUserResumeSummary(userId)              // parsed resume text
     |   |-- Query UserResume where isActive = true
     |   |-- If exists: return resume summary text
     |   \-- If none: return null
     |
     |-- getRecentSentEmails(userId, limit: 3)    // style reference
     |   |-- Query SendLog where status = SUCCESS, ordered by sentAt DESC
     |   |-- Return last 3 sent email subjects + bodies
     |   \-- Only included if >= 3 emails exist (for statistical representativeness)
     |
     |-- generateEmailDraft(template, person, user)  // placeholder as reference
```

### Step 2: Groq LLM Call

```
     |-- generateEmailWithLLM(context)             <-- lib/services/personalization.ts
     |   |
     |   |-- MODEL: llama-3.3-70b-versatile
     |   |-- TEMPERATURE: 0.7
     |   |
     |   |-- SYSTEM PROMPT:
     |   |   |-- "You are a professional email writer for networking outreach"
     |   |   |-- Structure: exactly 2 paragraphs
     |   |   |-- Tone: casual but respectful, no filler phrases
     |   |   |-- Format: respond with SUBJECT: ... then BODY: ...
     |   |   \-- Rules: no generic flattery, no "I hope this finds you well"
     |   |
     |   |-- USER PROMPT (5 blocks):
     |   |   |
     |   |   |-- Block 1: Recipient Context
     |   |   |   \-- Name, role, company, location, education details
     |   |   |
     |   |   |-- Block 2: Sender Context
     |   |   |   \-- Name, university, major, classification, career, resume summary
     |   |   |
     |   |   |-- Block 3: Custom Instructions (if user set emailInstructions)
     |   |   |   \-- e.g. "Always mention my interest in sustainability"
     |   |   |
     |   |   |-- Block 4: Previous Sent Emails (if >= 3 exist)
     |   |   |   \-- Last 3 successful sends as style examples
     |   |   |
     |   |   \-- Block 5: Reference Template
     |   |       \-- Placeholder draft as structural guide (not to copy verbatim)
     |   |
     |   |-- Call Groq API → response text
     |   \-- Parse response: extract SUBJECT: and BODY: sections
     |
     |-- UPDATE EmailDraft with LLM-generated content
     |   |-- subject = parsed subject
     |   |-- body = parsed body
     |   \-- userEdited remains false
     |
     \-- Return { subject, body } to ExpandedReview
```

**Key design decisions:**
- **On-demand generation** — LLM drafts are only generated when the user opens a profile, not during search. This saves Groq API calls for people the user never reviews.
- **Style matching** — Previous sent emails teach the LLM the user's writing style, but only when 3+ exist.
- **Resume integration** — Active resume summary is included as sender context for relevant talking points.
- **Custom instructions** — User's `emailInstructions` field (set in profile) is passed directly as a prompt block.

---

## Part 3: Draft Refinement

After an LLM draft is generated, the user can iteratively refine it with natural language instructions.

```
User types refinement instruction (e.g. "Make it shorter", "Mention my Python experience")
 |
 \-- refineDraftAction({ personId, instruction, currentSubject, currentBody })
     |
     |-- prisma.person.findUnique(personId)        // recipient context
     |
     |-- refineEmailWithLLM(context)               <-- lib/services/personalization.ts
     |   |
     |   |-- MODEL: llama-3.3-70b-versatile
     |   |-- TEMPERATURE: 0.5 (lower = more consistent refinements)
     |   |
     |   |-- SYSTEM PROMPT:
     |   |   |-- "Apply ONLY the requested change"
     |   |   |-- "Keep the same structure and length unless asked otherwise"
     |   |   \-- Format: respond with SUBJECT: ... then BODY: ...
     |   |
     |   |-- USER PROMPT:
     |   |   |-- Current email (subject + body)
     |   |   |-- Refinement instruction
     |   |   \-- Recipient context (name, company, role)
     |   |
     |   \-- Parse response: extract SUBJECT: and BODY: sections
     |
     \-- Return refined { subject, body } to ExpandedReview
```

**Notes:**
- Each refinement is a **stateless** Groq call — no chat history is maintained between refinements.
- Lower temperature (0.5 vs 0.7) ensures refinements are conservative and predictable.
- The user can refine multiple times; each refinement takes the current draft as input.
- Refinement does NOT update the EmailDraft in the database — edits are held in component state until send.

---

## Part 4: Manual Editing

The user can also directly edit the subject and body text in `ExpandedReview`. Edits are tracked in component state and override the LLM-generated content at send time.

```
ExpandedReview state:
 |-- subject      ← LLM draft (or user edit)
 |-- body         ← LLM draft (or user edit)
 |-- isEdited     ← tracks if user has manually changed the draft
```

Manual edits and LLM refinements both update the same state. The final content at send time is whatever is currently in the textarea fields.

---

## Part 5: Email Enrichment (Send-Time)

Before an email can be sent, the recipient needs an email address. Enrichment is deferred to send time to save Apollo credits.

### Three-Tier Email Resolution

```
enrichPersonBeforeSend(person)                    <-- src/app/actions/send.ts
 |
 |-- TIER 1: Existing email ----------------------------
 |-- IF person.email exists → use it, done
 |
 |-- TIER 2: Pattern matching (free) -------------------
 |-- getCompanyPattern(person.company)
 |   |-- Normalize company name
 |   |-- Query CompanyEmailPattern table
 |   |-- IF confidence >= 0.8 AND NOT useApolloFallback:
 |   |   \-- generateEmailFromPattern(firstName, lastName, pattern, domain)
 |   \-- ELSE: return null
 |
 |-- Pattern formats supported:
 |   |-- first.last    → john.smith@company.com
 |   |-- firstlast     → johnsmith@company.com
 |   |-- flast          → jsmith@company.com
 |   |-- f.last         → j.smith@company.com
 |   |-- first_last    → john_smith@company.com
 |   |-- first          → john@company.com
 |   |-- last.first    → smith.john@company.com
 |   \-- lastfirst     → smithjohn@company.com
 |
 |-- TIER 3: Apollo API (paid) -------------------------
 |-- findEmail(firstName, lastName, company, linkedinUrl)
 |   |-- POST https://api.apollo.io/v1/people/match
 |   |-- Sends: name, organization, LinkedIn URL
 |   |-- Parses: email, confidence, status, location, education
 |   \-- Updates Person record:
 |       |-- email, emailStatus (VERIFIED/UNVERIFIED/MISSING)
 |       |-- emailConfidence, emailDeliverable
 |       |-- apolloEnrichedAt, apolloStatus
 |       \-- city, state, country (also updated from Apollo)
 |
 \-- IF all tiers fail → return error (person is un-contactable)
```

**Why send-time enrichment:**
- Pattern matching is free but only works for ~60% of companies
- Apollo costs per call — only pay when the user actually wants to send
- People where Apollo previously found nothing are excluded from search results entirely (`apolloEnrichedAt IS NOT NULL AND email IS NULL`)

---

## Part 6: Send Pipeline

### Path A: Immediate Send (from ExpandedReview)

```
User clicks Send in ExpandedReview
 |
 \-- handleSend()                                  <-- ExpandedReview.tsx
     |-- Validate: subject + body not empty
     |-- Call sendSingleEmailAction()
     |
     \-- sendSingleEmailAction(person)             <-- src/app/actions/send.ts
         |
         |-- AUTH + LIMIT CHECK --------------------------------
         |-- getServerSession()
         |-- checkDailyLimit(userId)
         |   |-- Get user's dailySendCount + lastSendDate
         |   |-- If new day → reset counter
         |   |-- If limit reached → return error
         |   \-- Pro users: unlimited (remaining = -1)
         |
         |-- ENRICH -----------------------------------------
         |-- enrichPersonBeforeSend(person)         // resolve email (3 tiers)
         |-- IF no email resolved → return error
         |
         |-- SEND -------------------------------------------
         |-- getUserTokens(userId)                  // OAuth access + refresh tokens
         |-- sendEmail({
         |   |   to: resolvedEmail,
         |   |   from: user.email,
         |   |   subject: draft subject,
         |   |   body: draft body,
         |   |   resumeId: (if attachResume),
         |   |   userId
         |   })
         |   |
         |   |-- IF TEST_MODE → log to console, skip Gmail API
         |   |
         |   |-- Download resume from Supabase (if resumeId provided)
         |   |   \-- Creates signed URL, downloads, converts to base64
         |   |
         |   |-- createMimeMessage()
         |   |   |-- Build RFC 2822 MIME headers (From, To, Subject, Date, Message-ID)
         |   |   |-- IF no attachments: text/plain body
         |   |   |-- IF attachments: multipart/mixed with boundaries
         |   |   \-- Base64url encode entire message
         |   |
         |   |-- Refresh OAuth token if < 5 min until expiry (proactive)
         |   |-- gmail.users.messages.send({ userId: 'me', raw: encoded })
         |   |-- On 401: refresh token + retry once (reactive)
         |   \-- Return { success, messageId, threadId }
         |
         |-- RECORD ------------------------------------------
         |-- prisma.sendLog.create({
         |   |   userId, userCandidateId, personId,
         |   |   toEmail, subject, body,
         |   |   status: SUCCESS/FAILED,
         |   |   gmailMessageId, gmailThreadId
         |   })
         |-- prisma.emailDraft.update({ status: SENT })
         |-- incrementDailyCount(userId)
         \-- upsertOutreachTrackerOnSend()          // link to outreach tracking
```

### Path B: Bulk Send (from Search Results)

```
User selects multiple people and clicks Send
 |
 \-- sendEmailsAction(people: PersonToSend[])      <-- src/app/actions/send.ts
     |
     |-- Separate: scheduled (has scheduledFor) vs immediate
     |-- Process scheduled emails first (scheduleEmailAction for each)
     |
     |-- checkDailyLimit(userId)
     |-- getUserTokens(userId)
     |
     |-- For each person (batch limit: 10):
     |   |-- enrichPersonBeforeSend()               // resolve email
     |   |-- sendEmail()                            // Gmail API
     |   |-- Create SendLog
     |   |-- Update EmailDraft status = SENT
     |   |-- Upsert OutreachTracker
     |   \-- Increment daily count
     |
     |-- Combine scheduled + immediate results
     \-- Return { success, results: SendResult[] }
```

### Path C: Direct Compose Send

```
User opens Compose modal (no Person involved)
 |
 \-- ComposeEmailModal.tsx
     |-- Load templates, resumes, user profile
     |-- User fills: recipient email/name, subject, body
     |-- Optional: select template, attach resume, upload files
     |   |-- File limits: max 5 files, 10MB each
     |   \-- Files converted to base64 before send
     |
     \-- sendComposedEmailAction()                 <-- src/app/actions/compose.ts
         |-- Validate email format, subject/body required
         |-- Resume ownership check (if attached)
         |-- sendEmail() with file attachments
         |-- Create SendLog with directRecipientEmail/Name
         |   (no UserCandidate — this is a freeform send)
         |-- Increment daily count
         \-- Upsert OutreachTracker
```

**Key difference:** Direct compose uses `directRecipientEmail` and `directRecipientName` on SendLog instead of linking to a Person/UserCandidate.

---

## Part 7: Scheduled Email Processing

Users can schedule emails for future delivery instead of sending immediately.

### Scheduling

```
User clicks Schedule in ExpandedReview → picks date/time
 |
 \-- scheduleEmailAction(person, scheduledFor)     <-- src/app/actions/send.ts
     |-- Validate: scheduledFor >= 5 minutes in future
     |-- enrichPersonBeforeSend()                   // resolve email now, not at send time
     |-- prisma.scheduledEmail.create({
     |       userId, userCandidateId, personId,
     |       toEmail, subject, body, resumeId,
     |       scheduledFor, status: PENDING
     |   })
     |-- incrementDailyCount()                      // counts at schedule time
     \-- Return success
```

### Cron Execution

```
GET /api/cron/send-scheduled-emails               <-- Cron job (Bearer CRON_SECRET)
 |
 |-- Query: ScheduledEmail WHERE status=PENDING AND scheduledFor <= NOW
 |
 |-- For each email:
 |   |-- Fetch user (email for From: field)
 |   |-- getUserTokens()
 |   |-- sendEmail()
 |   |-- On success:
 |   |   |-- Update ScheduledEmail: status=SENT, sentAt=now()
 |   |   |-- Create SendLog
 |   |   \-- Update EmailDraft: status=SENT
 |   \-- On failure:
 |       |-- Update ScheduledEmail: status=FAILED, errorMessage
 |       \-- Create SendLog: status=FAILED
 |
 \-- Return { processed, results }
```

### Management Actions

- `getScheduledEmailsAction()` — list pending scheduled emails
- `cancelScheduledEmailAction()` — cancel (daily limit NOT refunded)
- `updateScheduledEmailAction()` — change scheduled time

---

## Part 8: Outreach Tracking

Every successful send (immediate, scheduled, or composed) creates an outreach tracking record.

```
upsertOutreachTrackerOnSend()                     <-- src/app/actions/outreach.ts
 |
 |-- Upsert OutreachTracker:
 |   |-- Key: (userId, contactEmail) unique
 |   |-- On create: set dateEmailed = now(), status = SENT
 |   |-- On update: link userCandidateId, gmailThreadId, update dateEmailed
 |
 |-- Link SendLog to OutreachTracker
 \-- Return success
```

OutreachTracker enables the user to see all their outreach history across search results, compose sends, and scheduled emails in one unified view.

---

## Part 9: Gmail Integration Details

### Token Management

```
getUserTokens(userId)                             <-- lib/services/gmail.ts
 |-- Query Account table (NextAuth OAuth record)
 |-- Return { accessToken, refreshToken, expiresAt }
 |
 Token refresh strategy:
 |-- PROACTIVE: if expiresAt < now() + 5 minutes → refresh before sending
 |-- REACTIVE: on 401 error → refresh + retry once
 |-- Save new tokens + expiry to Account table
```

### MIME Message Construction

```
createMimeMessage({ from, to, subject, body, attachments })
 |
 |-- Build RFC 2822 headers:
 |   |-- From, To, Subject
 |   |-- Date (RFC 2822 format)
 |   |-- Message-ID (unique)
 |   |-- MIME-Version: 1.0
 |   \-- For replies: In-Reply-To + References headers
 |
 |-- IF no attachments:
 |   \-- Content-Type: text/plain; charset=utf-8
 |
 |-- IF attachments (resume + files):
 |   |-- Content-Type: multipart/mixed; boundary=...
 |   |-- Part 1: text/plain body
 |   \-- Parts 2-N: base64-encoded attachments with Content-Disposition
 |
 \-- Base64url encode entire message for Gmail API
```

### Reply Threading

```
sendReplyEmail()                                  <-- lib/services/gmail.ts
 |-- Same as sendEmail() but adds:
 |   |-- In-Reply-To header (original messageId)
 |   |-- References header (for threading)
 |   \-- threadId parameter (keeps conversation together in Gmail)
```

---

## Data Model Summary

```
EmailTemplate (reusable)
 |-- prompt (subject + body with {variables})
 |-- attachResume, isDefault
 |-- userId → User
 |
 ▼ (resolved at search time)
 |
EmailDraft (per UserCandidate, 1:1)
 |-- subject, body (placeholder → LLM-generated)
 |-- status: PENDING → APPROVED → SENT/REJECTED
 |-- userEdited (boolean)
 |-- editedSubject, editedBody (user modifications)
 |-- userCandidateId → UserCandidate
 |
 ▼ (on send)
 |
SendLog (audit trail)
 |-- toEmail, subject, body
 |-- status: SUCCESS / FAILED
 |-- gmailMessageId, gmailThreadId
 |-- userId, userCandidateId (nullable), personId (nullable)
 |-- directRecipientEmail, directRecipientName (for compose sends)
 |
 ▼ (parallel)
 |
ScheduledEmail (deferred sends)
 |-- scheduledFor, sentAt
 |-- status: PENDING → SENT / FAILED / CANCELLED
 |-- toEmail, subject, body, resumeId
 |-- userId, userCandidateId, personId
 |
 ▼ (linked)
 |
OutreachTracker (unified tracking)
 |-- contactEmail (unique per user)
 |-- dateEmailed, status
 |-- gmailThreadId (for reply threading)
 |-- userId, userCandidateId, sendLogId
```

---

## Key Constants

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| LLM model | llama-3.3-70b-versatile | personalization.ts | Groq model for draft generation |
| Generation temp | 0.7 | personalization.ts | Temperature for initial LLM drafts |
| Refinement temp | 0.5 | personalization.ts | Temperature for refinement (more conservative) |
| Style sample size | 3 | personalization.ts | Minimum sent emails needed for style matching |
| Batch send limit | 10 | send.ts | Maximum people per bulk send |
| Schedule minimum | 5 minutes | send.ts | Minimum time in future for scheduling |
| File attachment limit | 5 files | ComposeEmailModal.tsx | Max file attachments per compose |
| File size limit | 10 MB | ComposeEmailModal.tsx | Max size per attached file |
| Pattern confidence | 0.8 | email-pattern.ts | Minimum confidence to use a company pattern |
| Token refresh buffer | 5 minutes | gmail.ts | Proactive OAuth token refresh threshold |
| Daily limit (free) | varies | credits.ts | Free tier daily send limit |
| Daily limit (pro) | unlimited | credits.ts | Pro tier has no send limit |

---

## End-to-End Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│ SEARCH (searchPeopleAction)                                      │
│  → Placeholder drafts (template + variable replacement)          │
│  → Saved to EmailDraft table (status: PENDING)                   │
└──────────┬───────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────┐
│ PROFILE OPEN (ExpandedReview)                                    │
│  → Auto-trigger generateLLMDraftAction                           │
│  → Groq LLM: 5-block prompt → personalized draft                │
│  → EmailDraft updated with LLM content                           │
└──────────┬───────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────┐
│ OPTIONAL: REFINE / EDIT                                          │
│  → refineDraftAction (natural language instruction → Groq)       │
│  → OR manual text editing in textarea                            │
│  → Each refinement is a stateless Groq call (temp=0.5)          │
└──────────┬───────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────┐
│ SEND                                                             │
│                                                                  │
│  Path A: Send Now                                                │
│   → enrichPersonBeforeSend (pattern → Apollo → error)            │
│   → sendEmail (Gmail API, MIME, OAuth token refresh)             │
│   → SendLog + EmailDraft.status=SENT + OutreachTracker           │
│                                                                  │
│  Path B: Schedule                                                │
│   → enrichPersonBeforeSend (resolve email now)                   │
│   → ScheduledEmail (PENDING) → cron job → sendEmail             │
│                                                                  │
│  Path C: Direct Compose                                          │
│   → User-entered recipient + content                             │
│   → sendComposedEmailAction → Gmail API                          │
│   → SendLog (directRecipientEmail) + OutreachTracker             │
└──────────────────────────────────────────────────────────────────┘
```

---

## Error Handling

| Scenario | Handling |
|----------|----------|
| LLM generation fails | Falls back to placeholder draft (template with variables) |
| LLM refinement fails | Returns error, keeps current draft unchanged |
| No email found (all 3 tiers) | Error returned, person shown as un-contactable |
| Gmail API 401 | Refresh OAuth token + retry once |
| Gmail API other error | SendLog.status=FAILED, error shown to user |
| Daily limit reached | LimitReachedModal shown with upgrade options |
| Scheduled time < 5 min | Rejected with validation error |
| File too large (>10MB) | Rejected at upload, before send |
| Resume not found | Skip attachment, send without it |
| Apollo rate limited | Return API_ERROR, skip enrichment |
