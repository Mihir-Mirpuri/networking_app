# Supabase Schema Setup Guide

## Overview

This guide explains how to set up the MVP database schema in your Supabase project.

## Quick Start

1. **Open Supabase SQL Editor**
   - Go to your Supabase project dashboard
   - Navigate to SQL Editor (left sidebar)
   - Click "New Query"

2. **Run the Schema Script**
   - Copy the entire contents of `supabase_schema.sql`
   - Paste into the SQL Editor
   - Click "Run" (or press Cmd/Ctrl + Enter)

3. **Verify Tables Created**
   - Go to Table Editor (left sidebar)
   - You should see all tables listed

## What Gets Created

### Enums (4 types)
- `EmailStatus` - MISSING, UNVERIFIED, VERIFIED, MANUAL
- `SourceLinkKind` - DISCOVERY, RESEARCH
- `SendLogStatus` - SUCCESS, FAILED
- `EmailDraftStatus` - PENDING, APPROVED, REJECTED, SENT

### Tables (11 tables)

#### Core User & Authentication
1. **User** - User accounts with daily send limits
2. **Account** - Gmail OAuth connections
3. **Session** - Login sessions
4. **VerificationToken** - Email verification tokens
5. **UserResume** - Resume file storage

#### Discovery & People
6. **Person** - Centralized person data (shared)
7. **UserCandidate** - User-specific relationships with people
8. **SourceLink** - Discovery/research links (shared)

#### Email Generation & Sending
9. **EmailTemplate** - ChatGPT prompts/templates
10. **EmailDraft** - AI-generated email drafts
11. **SendLog** - Audit log of sent emails

### Indexes (30+ indexes)
- Performance indexes on foreign keys
- Indexes on commonly queried fields
- Composite indexes for complex queries

### Triggers
- Auto-update `updatedAt` timestamps on all tables

### Optional: Row Level Security (RLS)
- Commented out by default
- Uncomment if you want multi-user security
- Adjust policies based on your auth setup

## Key Features

### 1. Centralized Person Data
- `Person` table stores shared person information
- Multiple users can network with the same person
- No duplicate person records

### 2. User-Specific Relationships
- `UserCandidate` links users to people
- Each user has their own email, status, etc.
- Privacy: user-specific data stays private

### 3. Shared Discovery
- `SourceLink` is linked to `Person` (not UserCandidate)
- If User A finds someone's LinkedIn, User B can see it
- Collective knowledge building

### 4. Resume Management
- `UserResume` supports multiple versions
- `isActive` flag for current resume
- Can attach resume to individual emails

### 5. Email Workflow
- `EmailTemplate` stores ChatGPT prompts
- `EmailDraft` tracks approval workflow
- `SendLog` provides complete audit trail

## Important Constraints

### Unique Constraints
- `User.email` - One account per email
- `Person.fullName + company + role` - One person record per unique combination
- `UserCandidate.userId + personId` - One relationship per user-person pair
- `EmailDraft.userCandidateId` - One draft per user-person relationship
- `SendLog.gmailMessageId` - One log per Gmail message

### Foreign Key Cascades
- Deleting a `User` cascades to: Account, Session, UserResume, UserCandidate, EmailTemplate, SendLog
- Deleting a `Person` cascades to: UserCandidate, SourceLink
- Deleting a `UserCandidate` cascades to: EmailDraft, SendLog
- Deleting an `EmailTemplate` sets `EmailDraft.templateId` to NULL
- Deleting a `UserResume` sets references to NULL (doesn't cascade)

## Data Types

- **IDs**: TEXT (for Prisma cuid() compatibility)
- **Timestamps**: TIMESTAMP WITH TIME ZONE
- **Booleans**: BOOLEAN
- **Numbers**: INTEGER, DOUBLE PRECISION
- **Text**: TEXT (unlimited length)

## Next Steps After Running Script

1. **Get Connection String**
   - Go to Settings → Database
   - Copy the connection string
   - Format: `postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres?sslmode=require`

2. **Update Environment Variables**
   ```env
   DATABASE_URL="postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres?sslmode=require"
   ```

3. **Update Prisma Schema**
   - Update `prisma/schema.prisma` to match MVP schema
   - Run `npx prisma generate`
   - Run `npx prisma db pull` to sync (optional)

4. **Test Connection**
   ```bash
   npx prisma studio
   ```
   - Should connect and show all tables

## Troubleshooting

### Error: "type already exists"
- You may have run the script before
- Drop existing types first:
  ```sql
  DROP TYPE IF EXISTS "EmailStatus" CASCADE;
  DROP TYPE IF EXISTS "SourceLinkKind" CASCADE;
  DROP TYPE IF EXISTS "SendLogStatus" CASCADE;
  DROP TYPE IF EXISTS "EmailDraftStatus" CASCADE;
  ```

### Error: "relation already exists"
- Tables already exist
- Either drop them first or use `CREATE TABLE IF NOT EXISTS` (modify script)

### Error: "permission denied"
- Make sure you're using the correct database user
- Supabase uses `postgres` user by default

### Connection Issues
- Check that connection string includes `?sslmode=require`
- Verify password is correct
- Check that IP is allowed (if using connection pooling)

## Row Level Security (RLS)

If you want to enable RLS for multi-user security:

1. Uncomment the RLS section in the SQL script
2. Adjust policies based on your auth system:
   - If using Supabase Auth: use `auth.uid()`
   - If using NextAuth: you'll need custom policies
   - If using custom auth: adjust accordingly

3. Test policies thoroughly before production

## Performance Considerations

### Indexes Created
- All foreign keys are indexed
- Common query fields are indexed
- Composite indexes for multi-column queries

### Query Optimization Tips
- Use indexes when querying by userId, personId, etc.
- Consider adding more indexes based on your query patterns
- Monitor slow queries in Supabase dashboard

## Backup & Migration

### Backup
- Supabase automatically backs up your database
- Manual backup: Use pg_dump or Supabase dashboard

### Migration
- Use Prisma migrations: `npx prisma migrate dev`
- Or use Supabase migrations: Create migration files in Supabase dashboard

## Support

If you encounter issues:
1. Check Supabase logs (Settings → Logs)
2. Verify all tables were created (Table Editor)
3. Test with a simple query:
   ```sql
   SELECT COUNT(*) FROM "User";
   ```

## Schema Validation

After running the script, verify with:

```sql
-- Check all tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- Check all enums exist
SELECT typname 
FROM pg_type 
WHERE typtype = 'e'
ORDER BY typname;

-- Check foreign keys
SELECT
  tc.table_name, 
  kcu.column_name, 
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name 
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
ORDER BY tc.table_name;
```
