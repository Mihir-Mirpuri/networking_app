# Gmail Client Test Suite

This folder contains test files for the Gmail client utility functionality.

## Prerequisites

1. **Database Migration**: Run the migration first
   ```sql
   -- Execute in Supabase SQL Editor
   -- File: migrations/add_gmail_conversation_tracking.sql
   ```

2. **Prisma Client**: Generate Prisma client with new models
   ```bash
   npx prisma generate
   ```

3. **Environment Variables**: Ensure these are set in `.env`
   ```
   GOOGLE_CLIENT_ID=your_client_id
   GOOGLE_CLIENT_SECRET=your_client_secret
   GOOGLE_PUBSUB_TOPIC=projects/YOUR_PROJECT_ID/topics/YOUR_TOPIC_NAME
   DATABASE_URL=your_database_url
   ```

4. **User Authentication**: At least one user must be signed in with Google OAuth

## Test Files

### 1. `test-get-client.ts`
Tests the `getGmailClient()` function.

**What it tests:**
- Client creation
- Gmail profile retrieval
- Label listing
- Message listing

**Run:**
```bash
npx tsx tests/gmail-client/test-get-client.ts
```

**Expected output:**
- ✅ Client created successfully
- ✅ Profile retrieved with email and message counts
- ✅ Labels listed
- ✅ Messages listed

### 2. `test-watch.ts`
Tests the `startMailboxWatch()` function.

**What it tests:**
- Watch initialization
- Database state updates
- Expiration tracking

**Run:**
```bash
npx tsx tests/gmail-client/test-watch.ts
```

**Expected output:**
- ✅ Watch started successfully
- ✅ History ID returned
- ✅ Expiration date set (typically ~7 days from now)
- ✅ Database record created/updated in `gmail_sync_state`

### 3. `test-email-sync.ts`
Tests the full email sync pipeline.

**What it tests:**
- `syncUserMailbox()` function
- Incremental sync (using historyId)
- Full sync fallback (last 7 days)
- Message parsing and storage
- Conversation upsert
- SendLog linking for sent messages

**Run:**
```bash
npx tsx tests/gmail-client/test-email-sync.ts
```

**Expected output:**
- Shows before/after message counts
- Lists processed messages with direction (SENT/RECEIVED)
- Shows linked SendLog for outbound messages
- Updates historyId in gmail_sync_state

### 4. `test-api-routes.ts`
Contains example API route code for testing via HTTP endpoints.

**To use:**
1. Create `src/app/api/test-gmail/client/route.ts` with the client route code
2. Create `src/app/api/test-gmail/watch/route.ts` with the watch route code
3. Visit the endpoints in your browser or use curl

**Endpoints:**
- `GET /api/test-gmail/client` - Test getGmailClient()
- `POST /api/test-gmail/watch` - Test startMailboxWatch()

## Common Issues

### "No Google account found"
- **Solution**: User needs to sign in with Google OAuth first
- Visit `/auth/signin` and sign in with Google

### "No refresh token available"
- **Solution**: User needs to re-authorize to grant `gmail.readonly` scope
- Update OAuth scopes in `src/lib/auth.ts` to include `gmail.readonly`
- User must sign out and sign back in

### "GOOGLE_PUBSUB_TOPIC not set"
- **Solution**: Add to `.env` file
- Format: `projects/PROJECT_ID/topics/TOPIC_NAME`

### "Invalid topic" or "Permission denied"
- **Solution**: Verify in Google Cloud Console:
  1. Topic exists in Pub/Sub
  2. Gmail service account (`gmail-api-push@system.gserviceaccount.com`) has Publisher role
  3. Topic name format is correct

### "Gmail API error: 403"
- **Solution**: 
  1. Ensure Gmail API is enabled in Google Cloud Console
  2. User must have granted `gmail.readonly` scope
  3. Check OAuth consent screen configuration

## Next Steps

After successful testing:

1. **Use in your application**: Import and use `getGmailClient()` and `startMailboxWatch()` in your app code
2. **Set up webhook handler**: Create an endpoint to receive Pub/Sub notifications from Gmail
3. **Build sync functionality**: Use the client to sync conversations and messages to your database

## Notes

- Watch subscriptions expire after ~7 days and need to be renewed
- Token refresh happens automatically via the OAuth2Client event listener
- All database updates happen automatically when tokens refresh
- The client can be reused for multiple Gmail API operations
