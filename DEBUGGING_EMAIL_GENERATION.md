# Email Generation Debugging Guide

## Issues Found and Fixed

### 1. **Critical Bug: Undeclared Variable**
- **Location**: `src/components/search/SearchPageClient.tsx` line 103
- **Issue**: Reference to `hasUpdates` variable that was never declared, causing a runtime error
- **Fix**: Removed the unused variable reference

### 2. **Missing Debugging Throughout the Flow**
- Added comprehensive logging at every step of the email generation process

## Debugging Points Added

### Queue Operations (`src/app/actions/search.ts`)
- Logs when attempting to queue email generation
- Logs queue data preparation
- Logs successful job queuing with job ID
- Enhanced error logging with full error details

### Groq API Service (`src/lib/services/groq-email.ts`)
- Logs when email generation starts
- Logs API key presence check
- Logs API request creation
- Logs API response received
- Logs content parsing steps
- Enhanced error logging with status codes and error types

### Queue Connection (`src/lib/queue.ts`)
- Logs Redis connection creation
- Logs connection events (connect, ready, close, error)
- Enhanced error handling

### Worker (`src/worker/index.ts`)
- Logs job processing start
- Logs job data received
- Logs Groq API call
- Logs database update operations
- Enhanced error logging with full error details

### Client Polling (`src/components/search/SearchPageClient.tsx`)
- Logs polling start/stop
- Logs status check operations
- Logs when drafts are ready
- Logs timeout events

### Status Checking (`src/app/actions/jobs.ts`)
- Logs status check requests
- Logs database queries
- Logs draft status found
- Logs when drafts are missing

## How to Debug

### 1. Check Server Logs
When you perform a search, you should see logs like:
```
[Search] Attempting to queue email generation for userCandidateId: ...
[Search] Queue data prepared: ...
[Search] Successfully queued job with ID: ... for userCandidateId: ...
```

### 2. Check Worker Logs
If the worker is running, you should see:
```
[Worker] [Job ...] Processing email generation for userCandidateId: ...
[Worker] [Job ...] Calling generateEmailWithGroq...
[Groq] Starting email generation...
[Groq] API key found, proceeding with request...
[Groq] Making API request to Groq...
[Groq] API request completed successfully
[Worker] [Job ...] Email generated successfully
[Worker] [Job ...] Updating EmailDraft in database...
[Worker] [Job ...] Successfully generated and saved email for userCandidateId: ...
```

### 3. Check Client Logs (Browser Console)
You should see:
```
[Polling] Checking draft status for X userCandidateIds...
[Polling] Status result: Found X results
[Polling] Draft ready for userCandidateId: ...
```

## Common Issues to Check

### 1. Worker Not Running
**Symptom**: Jobs are queued but never processed
**Check**: 
- Is the worker process running? (`npm run worker` or similar)
- Check worker logs for startup messages
- Verify `REDIS_URL` is set correctly

### 2. Redis Connection Issues
**Symptom**: Queue operations fail silently
**Check**:
- Look for `[Queue] Redis connection error:` in logs
- Verify `REDIS_URL` environment variable
- Check Redis server is accessible

### 3. Groq API Key Missing
**Symptom**: `[Groq] ERROR: GROQ_API_KEY environment variable is not set`
**Check**:
- Verify `GROQ_API_KEY` is set in `.env` file
- Restart the application after adding the key

### 4. Groq API Errors
**Symptom**: API calls fail
**Check**:
- Look for `[Groq] ERROR` messages in logs
- Check for rate limit errors (429 status)
- Verify API key is valid

### 5. Database Issues
**Symptom**: Drafts not updating
**Check**:
- Look for `[Worker]` or `[Jobs]` error messages
- Verify database connection
- Check if EmailDraft records exist

## Next Steps

1. **Run the application** and perform a search
2. **Check all log outputs** (server, worker, browser console)
3. **Identify where the flow stops** based on the last log message
4. **Check environment variables**:
   - `GROQ_API_KEY` - Required for email generation
   - `REDIS_URL` - Required for job queue
   - Database connection variables

## Testing the Flow

1. Start the Next.js server
2. Start the worker process (separate terminal)
3. Perform a search in the UI
4. Watch the logs in both terminals and browser console
5. The logs will show exactly where the process stops if there's an issue
