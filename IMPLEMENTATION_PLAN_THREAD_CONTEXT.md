# Implementation Plan: Thread-Aware Meeting Extraction

## Overview

Redesign the meeting extraction system to analyze full email threads instead of individual messages. The goal is to detect **confirmed meetings** (not just proposals) by understanding conversation context.

## Current State

```
Incoming message → Pre-filter (regex) → LLM (single message) → Suggestion
```

**Problem:** A reply like "Yes!" or "Works for me" contains no meeting keywords but confirms a meeting proposed in an earlier message.

## Target State

```
Incoming reply → Fetch thread messages → LLM (full conversation) → Detect CONFIRMED meeting → Suggestion
```

**Key change:** Only create suggestions for meetings that have been **mutually agreed upon**, not just proposed.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/services/calendarParser.ts` | New input type, new prompt for thread analysis |
| `src/lib/services/meetingExtractor.ts` | Fetch thread context, remove pre-filter gate |
| `src/lib/services/email-sync.ts` | Pass threadId to extractor |
| `src/lib/types/meetingSuggestion.ts` | Update types if needed |

---

## Detailed Changes

### 1. Update `calendarParser.ts`

#### 1.1 New Input Type

```typescript
interface ThreadMessage {
  direction: 'SENT' | 'RECEIVED';
  sender: string;
  subject: string | null;
  bodyText: string | null;
  receivedAt: Date;
}

interface CalendarParserInput {
  messageId: string;          // The triggering message (latest reply)
  threadId: string;
  thread: ThreadMessage[];    // Full conversation, chronological order
  userEmail: string;          // To identify which messages are from the user
  userTimezone?: string;
}
```

#### 1.2 New LLM Prompt

The prompt must:
- Analyze the full conversation flow
- Identify if a meeting has been **confirmed** (both parties agreed)
- NOT trigger on proposals that haven't been accepted
- Extract meeting details from the context

```
SYSTEM PROMPT:
You are analyzing an email conversation to determine if a meeting has been CONFIRMED.

A meeting is CONFIRMED when:
- One party proposes a specific time/date
- The other party explicitly agrees (e.g., "Yes", "Works for me", "See you then")

A meeting is NOT confirmed when:
- Someone proposes but no response yet
- Response is ambiguous ("Maybe", "Let me check")
- Response declines or suggests alternative

Return:
- isConfirmed: boolean (true ONLY if meeting is mutually agreed)
- meetingDetails: extracted details if confirmed
```

#### 1.3 Updated Output Type

```typescript
interface LLMExtractionResult {
  isConfirmed: boolean;      // NEW: true only if meeting is agreed upon
  hasMeeting: boolean;       // Keep for backwards compat (same as isConfirmed)
  // ... rest of fields
}
```

### 2. Update `meetingExtractor.ts`

#### 2.1 New Input Type

```typescript
interface EmailForExtraction {
  messageId: string;
  threadId: string;           // NEW
  userId: string;
  userEmail: string;          // NEW: to identify user's messages
  // Remove single-message fields, thread will be fetched
}
```

#### 2.2 Fetch Thread Context

```typescript
async function fetchThreadContext(threadId: string, userId: string): Promise<ThreadMessage[]> {
  const messages = await prisma.messages.findMany({
    where: { threadId, userId },
    orderBy: { received_at: 'asc' },
    select: {
      direction: true,
      sender: true,
      subject: true,
      body_text: true,
      received_at: true,
    },
  });

  return messages.map(m => ({
    direction: m.direction,
    sender: m.sender,
    subject: m.subject,
    bodyText: m.body_text,
    receivedAt: m.received_at,
  }));
}
```

#### 2.3 Remove Pre-filter Gate

- Remove the pre-filter check that skips messages
- Every incoming reply in an app-initiated thread gets analyzed
- The LLM decides if a meeting is confirmed (not regex)

#### 2.4 Updated Flow

```typescript
export async function extractMeetingFromEmail(email: EmailForExtraction): Promise<ExtractionResult> {
  // 1. Skip if suggestion already exists for this thread
  const existing = await checkExistingSuggestion(email.threadId);
  if (existing) return { extracted: false, skippedReason: 'Suggestion exists for thread' };

  // 2. Fetch full thread context
  const thread = await fetchThreadContext(email.threadId, email.userId);

  // 3. Call LLM with full thread
  const result = await parseCalendarFromThread({
    messageId: email.messageId,
    threadId: email.threadId,
    thread,
    userEmail: email.userEmail,
  });

  // 4. Only store if meeting is CONFIRMED
  if (result.isConfirmed) {
    return await storeMeetingSuggestion(...);
  }

  return { extracted: false, skippedReason: 'No confirmed meeting' };
}
```

### 3. Update `email-sync.ts`

#### 3.1 Pass Thread Info to Extractor

```typescript
// In fetchAndProcessMessage(), update the extractor call:
if (direction === 'RECEIVED') {
  extractMeetingFromEmail({
    messageId,
    threadId,
    userId,
    userEmail,
  }).then(result => {
    // ... logging
  });
}
```

### 4. Update Suggestion Deduplication

Current: One suggestion per `messageId`
New: One suggestion per `threadId` (a thread can only have one confirmed meeting)

Consider adding `threadId` to `ExtractedMeetingSuggestion` model or using the existing unique constraint on `messageId` but checking thread-level.

---

## Edge Cases to Handle

1. **Multiple meeting proposals in one thread**
   - LLM should identify the most recent confirmed meeting
   - Or return "ambiguous" if unclear which was confirmed

2. **Meeting time changed**
   - "How about 3pm instead?" → "Sure!"
   - LLM should extract the final agreed time (3pm), not the original proposal

3. **Meeting cancelled after confirmation**
   - "Actually, I need to reschedule"
   - LLM should return `isConfirmed: false`

4. **Long threads with multiple back-and-forth**
   - Limit context to last N messages (e.g., 10) to control token usage
   - Or summarize older messages

---

## Token/Cost Considerations

**Current:** ~500 tokens per message (when pre-filter passes)
**New:** ~1000-2000 tokens per thread (depending on length)

Mitigations:
- Only process replies to app-initiated threads (already filtered in email-sync.ts)
- Limit thread context to last 10 messages
- Truncate long message bodies

---

## Testing Plan

1. **Unit tests for calendarParser.ts**
   - Thread with proposal + acceptance → `isConfirmed: true`
   - Thread with proposal only → `isConfirmed: false`
   - Thread with proposal + decline → `isConfirmed: false`
   - Thread with time change + acceptance → correct time extracted

2. **Integration test**
   - Seed a thread with multiple messages
   - Call extractor
   - Verify suggestion created with correct details

3. **Manual testing**
   - Send test email proposing meeting
   - Reply with "Yes"
   - Verify suggestion appears

---

## Implementation Order

1. **Phase 1: Update Types**
   - Add new types to `calendarParser.ts`
   - Add `ThreadMessage` interface
   - Update `CalendarParserInput`

2. **Phase 2: Update LLM Prompt**
   - Write new system prompt for thread analysis
   - Write new user prompt builder
   - Add `isConfirmed` to output

3. **Phase 3: Update meetingExtractor.ts**
   - Add `fetchThreadContext` function
   - Remove pre-filter gate
   - Update main function to use thread

4. **Phase 4: Update email-sync.ts**
   - Pass `threadId` and `userEmail` to extractor

5. **Phase 5: Testing**
   - Write test cases
   - Manual end-to-end test

---

## Rollback Plan

Keep the pre-filter code but bypass it with a feature flag:

```typescript
const USE_THREAD_CONTEXT = process.env.USE_THREAD_CONTEXT === 'true';
```

This allows quick rollback if issues arise.
