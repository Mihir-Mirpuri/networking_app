-- pg_cron cleanup for scheduled email sending
-- This file is no longer needed as we've migrated to Vercel Cron Jobs
-- 
-- If you previously set up pg_cron to call the Supabase Edge Function,
-- run the following to unschedule the old job:

-- Unschedule the old edge function cron job
SELECT cron.unschedule('send-scheduled-emails');

-- To verify the job was removed:
-- SELECT * FROM cron.job WHERE jobname = 'send-scheduled-emails';
-- (Should return no rows)

-- Note: Scheduled emails are now processed by Vercel Cron Jobs
-- See vercel.json for the cron job configuration
-- The API route is at: /api/cron/send-scheduled-emails
