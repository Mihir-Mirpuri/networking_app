# Email Attachment Implementation Analysis

## What Was Implemented ✅

### 1. **Compose Email Flow (Complete)**
The custom compose email feature has full attachment support:

**Files:**
- `src/components/compose/ComposeEmailModal.tsx` - UI component
- `src/app/actions/compose.ts` - Server action
- `src/lib/services/gmail.ts` - Email sending service

**Features Implemented:**
- ✅ File picker UI with drag & drop support
- ✅ Multiple file selection (up to 5 files)
- ✅ File size validation (10MB max per file)
- ✅ File type display and removal
- ✅ Base64 encoding of files
- ✅ Resume attachment option (separate from file attachments)
- ✅ MIME message creation with multipart/mixed encoding
- ✅ Attachment validation (size, count, format)
- ✅ SendLog tracking for attachments

**Code Flow:**
```
ComposeEmailModal.tsx
  → fileToBase64() converts File to base64
  → sendComposedEmailAction() validates and processes
  → sendEmail() with additionalAttachments parameter
  → createMimeMessage() creates multipart MIME
  → Gmail API sends email with attachments
```

### 2. **Gmail Service Layer (Partial)**
- ✅ `sendEmail()` accepts `additionalAttachments?: EmailAttachment[]`
- ✅ Combines resume attachments with custom file attachments
- ✅ `createMimeMessage()` handles multipart encoding
- ✅ Proper MIME boundary generation
- ✅ Base64 encoding with 76-character line breaks
- ✅ Content-Type and Content-Disposition headers

---

## What's Missing ❌

### 1. **Search/Discovery Email Flow (Main Feature)**
The primary email sending flow from search results does NOT support custom attachments.

**Missing in:**
- `src/app/actions/send.ts` - `PersonToSend` interface
- `src/app/actions/send.ts` - `sendEmailsAction()` function
- `src/components/search/ExpandedReview.tsx` - UI component
- `src/components/search/SearchPageClient.tsx` - Send handlers

**What needs to be added:**

#### A. Update `PersonToSend` Interface
```typescript
// src/app/actions/send.ts
export interface PersonToSend {
  email: string;
  subject: string;
  body: string;
  userCandidateId?: string;
  resumeId?: string;
  scheduledFor?: Date;
  attachments?: EmailAttachment[]; // ❌ MISSING
}
```

#### B. Update `sendEmailsAction()` to Pass Attachments
```typescript
// src/app/actions/send.ts - Line 102-110
const sendResult = await sendEmail(
  accessToken,
  refreshToken,
  session.user.email,
  person.email,
  person.subject,
  person.body,
  person.resumeId,
  session.user.id, // ❌ MISSING: person.attachments
);
```

Should be:
```typescript
const sendResult = await sendEmail(
  accessToken,
  refreshToken,
  session.user.email,
  person.email,
  person.subject,
  person.body,
  person.resumeId,
  session.user.id,
  person.attachments // ✅ ADD THIS
);
```

#### C. Add File Attachment UI to ExpandedReview
- File picker input
- File list display
- File removal
- File size validation
- Base64 conversion before sending

#### D. Update SearchPageClient Send Handlers
- `handleSendFromReview()` - Add attachments to PersonToSend
- `handleBulkSend()` - Add attachments to each person

### 2. **Reply Email Flow**
Follow-up/reply emails don't support custom attachments.

**Missing in:**
- `src/lib/services/gmail.ts` - `sendReplyEmail()` function
- `src/app/actions/send.ts` - `sendFollowUpAction()` function
- `src/components/history/EmailHistoryClient.tsx` - Follow-up UI

**What needs to be added:**

#### A. Update `sendReplyEmail()` Signature
```typescript
// src/lib/services/gmail.ts - Line 444
export async function sendReplyEmail(
  accessToken: string,
  refreshToken: string | undefined,
  fromEmail: string,
  toEmail: string,
  subject: string,
  body: string,
  threadId: string,
  originalMessageId?: string,
  resumeId?: string | null,
  userId?: string
  // ❌ MISSING: additionalAttachments?: EmailAttachment[]
): Promise<SendResult>
```

#### B. Update `sendFollowUpAction()` Interface
```typescript
// src/app/actions/send.ts - Line 394
export interface SendFollowUpInput {
  toEmail: string;
  subject: string;
  body: string;
  threadId: string;
  originalMessageId?: string;
  userCandidateId: string;
  resumeId?: string;
  // ❌ MISSING: attachments?: EmailAttachment[]
}
```

#### C. Add Attachment UI to Follow-up Modal
- File picker in follow-up email UI
- Pass attachments through to `sendFollowUpAction()`

### 3. **Scheduled Email Flow**
Scheduled emails don't support custom attachments.

**Missing in:**
- `src/app/actions/send.ts` - `scheduleEmailAction()` function
- `prisma/schema.prisma` - `ScheduledEmail` model
- `src/app/api/cron/send-scheduled-emails/route.ts` - Cron handler

**What needs to be added:**

#### A. Database Schema Update
```prisma
// prisma/schema.prisma
model ScheduledEmail {
  // ... existing fields
  // ❌ MISSING: attachments JSON? // Store serialized attachments
}
```

**Note:** Storing attachments in database is tricky because:
- Attachments are large (up to 10MB each)
- Base64 encoding increases size by ~33%
- 5 attachments × 10MB = 50MB+ per email

**Options:**
1. **Store in Supabase Storage** (Recommended)
   - Upload attachments to storage bucket
   - Store file URLs in database
   - Download when sending

2. **Store in Database as JSON** (Not recommended)
   - Large database bloat
   - Slow queries
   - Expensive storage

3. **Don't Support Attachments for Scheduled** (Simplest)
   - Only allow resume attachments
   - Custom attachments only for immediate sends

#### B. Update ScheduledEmail Model
If using storage approach:
```prisma
model ScheduledEmail {
  // ... existing fields
  attachmentUrls Json? // Array of Supabase storage URLs
}
```

#### C. Update Cron Handler
- Download attachments from storage before sending
- Convert to EmailAttachment format
- Pass to sendEmail()

### 4. **SendLog Tracking**
SendLog doesn't track custom attachments (only resume attachments).

**Missing in:**
- `prisma/schema.prisma` - `SendLog` model
- `src/app/actions/send.ts` - SendLog creation

**What needs to be added:**

#### A. Database Schema
```prisma
// prisma/schema.prisma
model SendLog {
  // ... existing fields
  resumeAttached Boolean @default(false)
  resumeId String?
  // ❌ MISSING: attachmentsCount Int @default(0)
  // ❌ MISSING: attachmentNames Json? // Array of filenames
}
```

#### B. Update SendLog Creation
```typescript
// src/app/actions/send.ts - Line 114
await prisma.sendLog.create({
  data: {
    // ... existing fields
    attachmentsCount: person.attachments?.length || 0,
    attachmentNames: person.attachments?.map(a => a.filename) || null,
  },
});
```

---

## Implementation Priority

### High Priority (Core Functionality)
1. **Search/Discovery Email Flow** - This is the main feature users will use
   - Add attachments to PersonToSend interface
   - Update sendEmailsAction to pass attachments
   - Add file picker UI to ExpandedReview
   - Update SearchPageClient handlers

### Medium Priority (Feature Completeness)
2. **Reply Email Flow** - Users may want to attach files in replies
   - Update sendReplyEmail signature
   - Update sendFollowUpAction interface
   - Add attachment UI to follow-up modal

3. **SendLog Tracking** - For audit/analytics
   - Add attachment fields to SendLog
   - Update all SendLog creation points

### Low Priority (Edge Case)
4. **Scheduled Email Flow** - Complex due to storage requirements
   - Decide on storage approach
   - Implement if needed (may not be worth the complexity)

---

## Technical Considerations

### File Size Limits
- **Current:** 10MB per file, 5 files max
- **Gmail Limit:** 25MB total per email
- **Consideration:** Should validate total size across all attachments

### Base64 Encoding
- **Current:** Files converted to base64 in frontend
- **Issue:** Base64 increases size by ~33%
- **Consideration:** For large files, consider streaming or chunked upload

### Storage for Scheduled Emails
- **Option 1:** Supabase Storage (Recommended)
  - Upload when scheduling
  - Download when sending
  - Clean up after sending
  
- **Option 2:** Don't support attachments for scheduled
  - Simpler implementation
  - Users can send immediately with attachments

### MIME Encoding
- **Current:** Properly implemented in `createMimeMessage()`
- **Status:** ✅ Working correctly
- **No changes needed**

---

## Testing Checklist

Once implementation is complete, test:

- [ ] Single email with custom attachment from search results
- [ ] Bulk send with attachments
- [ ] Email with both resume and custom attachments
- [ ] Email with only custom attachments (no resume)
- [ ] File size validation (10MB limit)
- [ ] File count validation (5 file limit)
- [ ] Invalid file type handling
- [ ] Follow-up email with attachments
- [ ] SendLog correctly tracks attachments
- [ ] Attachment names display correctly in history
- [ ] Error handling when attachment upload fails
- [ ] Error handling when attachment download fails (scheduled)

---

## Summary

**What Works:**
- ✅ Compose email flow (custom emails) - Fully functional
- ✅ Resume attachments - Working everywhere
- ✅ MIME encoding - Properly implemented

**What's Missing:**
- ❌ Search/discovery email flow - No custom attachment support
- ❌ Reply/follow-up emails - No custom attachment support
- ❌ Scheduled emails - No custom attachment support
- ❌ SendLog tracking - Doesn't track custom attachments

**Estimated Effort to Complete:**
- High Priority: 4-6 hours
- Medium Priority: 2-3 hours
- Low Priority: 4-8 hours (if implementing scheduled email attachments)

**Total: 10-17 hours** to make attachments fully functional across all email flows.

---

*Analysis Date: [Current Date]*
*Based on code review of attachment implementation*
