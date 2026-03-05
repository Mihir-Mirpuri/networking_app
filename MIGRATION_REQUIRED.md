# Database Migration Required

## Issue

The Person table in your database is **missing the email caching columns**. The Prisma schema has been updated, but the actual database table hasn't been migrated yet.

### Symptoms
- All email lookups show "CACHE MISS" even for existing Person records
- Logs show: `Person exists at [Company] but has no email or MISSING status`
- Apollo API is being called for every person, even ones that should be cached

### Root Cause
The Person table was created without the email fields. The schema update added:
- `email` (TEXT)
- `emailStatus` (EmailStatus enum)
- `emailConfidence` (DOUBLE PRECISION)
- `emailLastUpdated` (TIMESTAMP)

But these columns don't exist in your actual database table yet.

## Solution

You have two options to add the columns:

### Option 1: Use Prisma (Recommended if you have DATABASE_URL set)

```bash
npm run db:push
```

This will sync your Prisma schema with the database and add the missing columns.

### Option 2: Run SQL Migration Manually (If Prisma doesn't work)

1. Open your Supabase SQL Editor (or your database admin tool)
2. Run the SQL from: `migrations/add_person_email_fields.sql`

Or copy-paste this:

```sql
-- Add email fields to Person table
ALTER TABLE "Person" 
ADD COLUMN IF NOT EXISTS "email" TEXT,
ADD COLUMN IF NOT EXISTS "emailStatus" "EmailStatus",
ADD COLUMN IF NOT EXISTS "emailConfidence" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "emailLastUpdated" TIMESTAMP WITH TIME ZONE;

-- Create index on emailStatus for faster queries
CREATE INDEX IF NOT EXISTS "Person_emailStatus_idx" ON "Person"("emailStatus");
```

## After Migration

Once the migration is complete:
1. Existing Person records will have `NULL` for email fields (expected)
2. New searches will populate the email cache
3. Subsequent searches for the same person+company will show "CACHE HIT" ✅
4. Apollo API calls will be reduced by 80-90% after initial population

## Verification

After running the migration, test by:
1. Searching for a person (should call Apollo and cache the email)
2. Searching for the same person again (should show "CACHE HIT" in logs)
3. Check the UI - emails should have a purple "Cache" badge on second search

## Files Modified

- ✅ `prisma/schema.prisma` - Schema updated with email fields
- ✅ `src/lib/services/email-cache.ts` - Caching logic implemented
- ✅ `src/lib/db/person-service.ts` - Email update functions added
- ✅ `src/app/actions/search.ts` - Uses caching service
- ⏳ **Database migration** - **NEEDS TO BE RUN**
