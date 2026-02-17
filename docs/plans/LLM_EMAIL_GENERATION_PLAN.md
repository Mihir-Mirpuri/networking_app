# LLM-Powered Personalized Email Generation

## Problem Statement

Current emails use template + placeholder replacement — identical structure for every user. The goal is LLM-generated emails that:
1. Are objectively good (compelling, concise, clear CTA)
2. Sound like the specific user (their voice, not generic LLM output)
3. Require zero iterations — get it right on the first try
4. Get better the more the user uses the app

Without style learning, every email from the app looks the same and becomes recognizable as bot-generated at scale. Style personalization is a credibility and deliverability feature, not just a nice-to-have.

## Architecture: 5-Block Prompt Assembly

Each email generation assembles a prompt from 5 blocks:

### Block 1: System Instructions (static, same for all users)
Quality guardrails hardcoded into every generation:
- Under 5 sentences
- Must include a specific, clear ask (coffee chat, advice, referral)
- Mention something specific about the recipient (not generic flattery)
- No filler phrases ("I hope this email finds you well")
- One email, no alternatives

### Block 2: Style Profile (from `User.styleProfile`)
Learned per-user, evolves over time. Example:
```json
{
  "tone": "casual-professional",
  "greeting": "Hi {first_name},",
  "closing": "Best, Kavita",
  "avgSentences": 4,
  "tendencies": ["mentions eagerness to learn", "references specific projects"],
  "avoids": ["exclamation marks", "overly formal language"],
  "recurringPhrases": ["would love to chat", "really interested in"]
}
```
Populated by Groq analysis of sent emails. Starts empty for new users.

### Block 3: Few-Shot Examples (from `SendLog`)
2-3 of the user's own previously sent emails, selected by relevance to the current recipient (industry/role match, falling back to recency). This is the most powerful block — the LLM naturally mimics the user's actual writing.

### Block 4: Recipient Context (from `Person` + LinkedIn + company research)
- Name, role, company, location
- LinkedIn about/education/activities
- Shared connections or similarities (from resume similarity matching)
- Company recent news/talking points

### Block 5: Sender Context (from `User` + `UserResume`)
- Name, university, classification, major, career interest
- Resume highlights (from existing resume summary extraction)

## Key Design Decisions

### No Vector DB / No RAG
The per-user corpus is small (10-100 short emails = ~2,000-5,000 tokens). Entire corpus fits easily in Groq's 128k context window. Use simple SQL queries for example selection, not vector embeddings. Can add vectors later if needed without changing the architecture.

### Style Profile Population
- Extracted by sending the user's full sent email corpus to Groq and asking for structured style analysis
- Triggered every 5th email send (batch, not real-time)
- Also triggered when a user edits a generated draft (dirty flag)
- Input: up to the most recent ~50 sent emails (older ones add diminishing signal)
- One LLM call per extraction, non-blocking (async after send)

### Progressive Trust Ladder
| Phase | Signal Available | Behavior |
|-------|-----------------|----------|
| Cold start (0 sent) | None | Blocks 1 + 4 + 5 only (quality guardrails + context) |
| Early (1-4 sent) | Few emails | Add Block 3 (few-shot examples) |
| Warm (5+ sent) | Corpus + profile | All 5 blocks (full personalization) |
| Mature (10+ sent) | Rich corpus | Contextual example selection by industry/role |

### Tone Slider (Not Two Modes)
Rather than offering "your style" vs "app style" as separate modes (which implies the user's style isn't good enough), offer a per-email tone/formality slider. Default to the user's natural tone. Let them adjust for specific situations (more formal for executives, more casual for peers).

---

## Implementation Steps

### Step 1: Basic LLM Generation (Blocks 1 + 4 + 5)

Replace placeholder system with Groq call. Foundation for everything else.

**Build:**
- New function `generateEmailWithLLM()` in `src/lib/services/personalization.ts` (or new file)
- Takes: recipient Person data, sender User data, resume summary
- Assembles system instructions + recipient context + sender context
- Calls Groq, returns `{ subject, body }`

**Change:**
- `generateEmailDraft()` in `src/app/actions/search.ts` — swap placeholder replacement for LLM call
- Keep old placeholder function as fallback if LLM fails

**Test:** Generate emails for different recipients, verify they're contextual and varied.

---

### Step 2: Few-Shot Examples (Block 3)

Add user's past sent emails as examples in the prompt.

**Build:**
- `getRelevantSentEmails(userId, limit)` in `src/lib/db/` — queries SendLog for recent successful sends
- Modify `generateEmailWithLLM()` to accept and include examples

**Change:**
- Generation call site fetches sent emails and passes them in
- Conditional: skip this block if user has fewer than 3 sent emails

**Test:** Send 5+ emails manually, then generate new ones. Should pick up phrasing patterns.

---

### Step 3: Style Profile Field + Extraction

Add persistent style profile populated by Groq analysis.

**Build:**
- Add to User model in `prisma/schema.prisma`:
  - `styleProfile Json?`
  - `styleProfileEmailCount Int @default(0)`
- Run `prisma db push`
- New function `extractStyleProfile(sentEmails[])` in personalization.ts
- New action `updateStyleProfileAction()` — fetches sent emails, calls extraction, saves to User

**Change:**
- Modify `generateEmailWithLLM()` to include style profile in prompt (Block 2)

**Test:** Call extraction manually, verify it produces reasonable profiles.

---

### Step 4: Automatic Trigger Logic

Wire up "every Nth send" trigger for style profile refresh.

**Build:**
- In send flow (`sendEmailsAction` and `sendComposedEmailAction` in `src/app/actions/send.ts`):
  - After successful send, increment counter
  - If `emailsSentSinceLastExtraction >= 5`, trigger async style profile refresh
- Refresh is non-blocking — don't make user wait

**Change:**
- Both send paths (search-based and direct compose) get the trigger check

**Test:** Send 5 emails, verify User.styleProfile gets populated automatically.

---

### Step 5: Edit-Diff Awareness

Use edits as signal to prioritize style refresh.

**Build:**
- Add `styleProfileDirty Boolean @default(false)` to User model
- When user sends an edited draft (`userEdited: true`), set dirty flag

**Change:**
- Send flow checks `userEdited` on draft, sets dirty flag
- Trigger condition becomes: `if (dirty || emailsSinceLastExtraction >= 5)`

**Effect:** System responds quickly when user is actively correcting output.

---

### Step 6: Contextual Example Selection

Pick most relevant few-shot examples instead of most recent.

**Build:**
- Modify `getRelevantSentEmails()` to accept target recipient's industry/role/company
- Query SendLog joined with Person data for similar recipients
- Selection priority: same industry > same role level > most recent

**Change:**
- Call site passes recipient context into retrieval function

**Effect:** Few-shot examples are contextually matched ("how this user writes to fintech engineers").

---

### Step 7: Outcome Tracking (Future — requires gmail.readonly)

Track which emails get replies to optimize for what actually works.

**Build:**
- Add `replyReceived Boolean @default(false)` to SendLog
- Gmail sync detects incoming replies to outbound threads (using gmailThreadId)
- Weight style profile extraction toward replied emails
- Weight few-shot selection toward replied emails

**Effect:** System optimizes for "sounds like the user AND gets responses."

---

## Cost Summary

| Step | New LLM Calls | Notes |
|------|---------------|-------|
| 1 | 1 per email generation | Replaces free placeholder replacement |
| 2 | 0 | Just more context in existing call |
| 3 | 1 per extraction (~every 5 sends) | Batch analysis, non-blocking |
| 4 | 0 | Just trigger wiring |
| 5 | 0 | Just trigger wiring |
| 6 | 0 | Better SQL query |
| 7 | 0 | Gmail sync logic |

Groq (llama-3.3-70b) costs are fractions of a cent per call at these token volumes.

## Existing Infrastructure That Supports This

Already in the codebase:
- Groq integration (`src/lib/services/personalization.ts`)
- SendLog stores every sent email with subject + body
- EmailDraft tracks `userEdited` + `editedSubject` + `editedBody`
- Resume summary extraction via Groq (`src/lib/services/resume-summary.ts`)
- LinkedIn personalization (similarity matching)
- Company research panel
- User profile fields (university, major, career, classification)
