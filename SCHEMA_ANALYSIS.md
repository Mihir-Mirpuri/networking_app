# Database Schema Analysis: Current vs MVP

This document analyzes the differences between the current Prisma schema implementation and the MVP database schema specification.

---

## Executive Summary

The current implementation uses a **simplified, user-scoped model** where each user's candidates are stored independently. The MVP schema introduces a **centralized, multi-user architecture** that separates shared person data from user-specific relationship data.

**Key Architectural Difference:**
- **Current:** `Candidate` table combines both person data and user-specific data
- **MVP:** `Person` (shared) + `UserCandidate` (user-specific) separation

---

## Detailed Comparison

### 1. Core User & Authentication

#### ✅ **User Model** - MATCHES
Both schemas have identical `User` models with:
- Basic user info (name, email, image)
- Email sending limits (dailySendCount, lastSendDate)
- Timestamps

#### ✅ **Account Model** - MATCHES
Both schemas have identical OAuth account models for Gmail integration.

#### ✅ **Session Model** - MATCHES
Both schemas have identical session models.

#### ✅ **VerificationToken Model** - MATCHES
Both schemas have identical verification token models.

#### ❌ **UserResume Model** - MISSING IN CURRENT
**MVP Schema:**
- Stores user's resume files
- Fields: filename, fileUrl, fileSize, mimeType, version, isActive, uploadedAt
- Allows resume attachment to emails

**Current Schema:**
- ❌ Not implemented

---

### 2. Discovery & People

#### ❌ **Person Model** - MISSING IN CURRENT
**MVP Schema:**
- Centralized table for actual people (shared across all users)
- Fields: fullName, firstName, lastName, company, role, linkedinUrl
- Unique by: fullName + company + role
- Purpose: One person record, multiple users can network with them

**Current Schema:**
- ❌ Not implemented (person data is in Candidate)

#### ❌ **UserCandidate Model** - MISSING IN CURRENT
**MVP Schema:**
- User-specific relationship data
- Links: userId → personId
- Fields: email, emailStatus, emailConfidence, manualEmailConfirmed
- Unique by: userId + personId
- Purpose: Each user has their own relationship with each person

**Current Schema:**
- ❌ Not implemented (relationship data is in Candidate)

#### ⚠️ **Candidate Model** - DIFFERENT APPROACH
**Current Schema:**
- Combines both person data AND user-specific data
- Fields: fullName, firstName, lastName, company, role, university, email, emailStatus, emailConfidence, manualEmailConfirmed, sendStatus
- Unique by: userId + fullName + company
- Links directly to: User, EmailDraft, SendLog, SourceLink

**MVP Schema:**
- ❌ This model doesn't exist - replaced by Person + UserCandidate

**Key Difference:**
- Current: Each user has their own Candidate records (no sharing)
- MVP: Person is shared, UserCandidate is user-specific

**Impact:**
- Current approach: If User A and User B both find "John Doe at Goldman Sachs", there are 2 separate Candidate records
- MVP approach: One Person record for John, two UserCandidate records (one per user)

---

### 3. Source Links

#### ⚠️ **SourceLink Model** - DIFFERENT RELATIONSHIP
**Current Schema:**
- Links to: `Candidate` (candidateId)
- Fields: kind, url, title, snippet, domain
- User-specific (each user's candidates have their own source links)

**MVP Schema:**
- Links to: `Person` (personId)
- Fields: kind, url, title, snippet, domain
- Shared across all users (if User A finds John's LinkedIn, User B can see it)

**Key Difference:**
- Current: Source links are user-specific
- MVP: Source links are shared (collective discovery benefit)

---

### 4. Email Generation & Sending

#### ❌ **EmailTemplate Model** - MISSING IN CURRENT
**MVP Schema:**
- Stores ChatGPT prompts/templates for generating emails
- Fields: name, prompt, isDefault
- Multiple templates per user
- Links to: User

**Current Schema:**
- ❌ Not implemented
- Note: Seed file references a Campaign model (outdated) that had templateSubject and templateBody

#### ⚠️ **EmailDraft Model** - DIFFERENT STRUCTURE
**Current Schema:**
- Links to: `Candidate` (candidateId)
- Fields: subject, body, createdAt, updatedAt
- Simple draft storage

**MVP Schema:**
- Links to: `UserCandidate` (userCandidateId)
- Fields: subject, body, status, templateId, userEdited, editedSubject, editedBody, attachResume, resumeId
- More complex with approval workflow and resume attachment

**Key Differences:**
1. **Relationship:** Candidate vs UserCandidate
2. **Status field:** MVP has status (PENDING, APPROVED, REJECTED, SENT)
3. **Template reference:** MVP links to EmailTemplate
4. **User editing:** MVP tracks if user edited and stores edited versions
5. **Resume attachment:** MVP supports per-email resume attachment

---

### 5. Send Log

#### ⚠️ **SendLog Model** - DIFFERENT STRUCTURE
**Current Schema:**
- Links to: `User` (userId), `Candidate` (candidateId, optional)
- Fields: toEmail, toName, company, subject, body, status, errorMessage, gmailMessageId, sentAt
- Stores recipient name and company directly

**MVP Schema:**
- Links to: `User` (userId), `UserCandidate` (userCandidateId)
- Fields: toEmail, subject, body, resumeAttached, resumeId, status, errorMessage, gmailMessageId, sentAt
- No toName or company (can be derived from UserCandidate → Person)

**Key Differences:**
1. **Relationship:** Candidate vs UserCandidate
2. **Resume tracking:** MVP tracks if resume was attached and which one
3. **Recipient info:** Current stores toName/company directly, MVP derives from relationships

---

## Missing Enums

**Current Schema has:**
- EmailStatus ✅
- SendStatus ✅
- SourceLinkKind ✅
- SendLogStatus ✅

**MVP Schema additionally has:**
- EmailDraftStatus (PENDING, APPROVED, REJECTED, SENT) ❌

---

## Data Model Architecture Comparison

### Current Architecture (User-Scoped)
```
User
  └── Candidate (person data + user-specific data combined)
       ├── SourceLink (user-specific)
       ├── EmailDraft (user-specific)
       └── SendLog (user-specific)
```

**Characteristics:**
- Each user's data is isolated
- No sharing of person information between users
- Simpler structure, easier to implement
- Duplicate person data if multiple users find the same person

### MVP Architecture (Centralized + User-Scoped)
```
User
  ├── UserResume
  ├── EmailTemplate
  └── UserCandidate (user-specific relationship)
       ├── Person (shared person data)
       │    └── SourceLink (shared)
       ├── EmailDraft (user-specific)
       └── SendLog (user-specific)
```

**Characteristics:**
- Person data is centralized and shared
- User-specific data (email, status) is separate
- Collective discovery benefits (if User A finds John's LinkedIn, User B can see it)
- More complex structure, but scales better
- No duplicate person data

---

## Migration Complexity

### High Impact Changes

1. **Split Candidate into Person + UserCandidate**
   - Requires data migration
   - Need to deduplicate person data
   - Update all code references from Candidate to Person/UserCandidate

2. **Change SourceLink relationship**
   - From Candidate → Person
   - Need to migrate existing source links

3. **Change EmailDraft relationship**
   - From Candidate → UserCandidate
   - Need to migrate existing drafts

4. **Change SendLog relationship**
   - From Candidate → UserCandidate
   - Need to migrate existing logs

### Medium Impact Changes

5. **Add UserResume model**
   - New table, no migration needed
   - Update EmailDraft and SendLog to support resume attachment

6. **Add EmailTemplate model**
   - New table, no migration needed
   - Update EmailDraft to reference template

7. **Enhance EmailDraft model**
   - Add status, templateId, userEdited fields
   - Add resume attachment fields

---

## Code Impact Areas

Based on the codebase structure, these files will need updates:

1. **Prisma Schema** (`prisma/schema.prisma`)
   - Complete restructure of models

2. **Seed File** (`prisma/seed.ts`)
   - References non-existent Campaign model
   - Needs complete rewrite

3. **Discovery Service** (`src/lib/services/discovery.ts`)
   - Currently creates Candidate records
   - Should create Person + UserCandidate records

4. **Enrichment Service** (`src/lib/services/enrichment.ts`)
   - Currently updates Candidate records
   - Should update Person + UserCandidate records

5. **Search Actions** (`src/app/actions/search.ts`)
   - Likely queries/creates Candidate records
   - Should query/create Person + UserCandidate

6. **Send Actions** (`src/app/actions/send.ts`, `sendlog.ts`)
   - Likely references Candidate
   - Should reference UserCandidate

7. **Components** (various in `src/components/`)
   - Any component displaying candidate data
   - Need to handle Person + UserCandidate relationship

---

## Recommendations

### Option 1: Full Migration to MVP Schema
**Pros:**
- Matches MVP specification exactly
- Enables multi-user benefits (shared discovery)
- Better scalability
- Cleaner separation of concerns

**Cons:**
- Significant refactoring effort
- Data migration required
- All code needs updates

### Option 2: Hybrid Approach
**Pros:**
- Gradual migration
- Less disruptive

**Cons:**
- Temporary complexity
- Still need full migration eventually

### Option 3: Keep Current Schema
**Pros:**
- No migration needed
- Simpler for single-user scenarios

**Cons:**
- Doesn't match MVP specification
- No multi-user benefits
- Will need migration later if scaling

---

## Summary Table

| Feature | Current Schema | MVP Schema | Status |
|---------|---------------|------------|--------|
| User | ✅ | ✅ | Match |
| Account | ✅ | ✅ | Match |
| Session | ✅ | ✅ | Match |
| VerificationToken | ✅ | ✅ | Match |
| UserResume | ❌ | ✅ | Missing |
| Person | ❌ | ✅ | Missing |
| UserCandidate | ❌ | ✅ | Missing |
| Candidate | ✅ | ❌ | Different approach |
| SourceLink | ⚠️ (to Candidate) | ⚠️ (to Person) | Different relationship |
| EmailTemplate | ❌ | ✅ | Missing |
| EmailDraft | ⚠️ (simple) | ⚠️ (complex) | Different structure |
| SendLog | ⚠️ (to Candidate) | ⚠️ (to UserCandidate) | Different relationship |

---

## Next Steps

1. **Decide on migration approach** (full, hybrid, or keep current)
2. **Create migration plan** if proceeding with MVP schema
3. **Update Prisma schema** to match MVP
4. **Create data migration scripts** to move existing Candidate data
5. **Update all code references** from Candidate to Person/UserCandidate
6. **Add missing models** (UserResume, EmailTemplate)
7. **Enhance EmailDraft** with status and resume support
8. **Update seed file** to match new schema
