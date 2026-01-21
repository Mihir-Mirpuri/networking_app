-- pg_cron setup for scheduled email sending
-- Run this in Supabase SQL Editor after deploying the edge function

-- First, ensure pg_cron extension is enabled (should already be done)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Get your project details:
-- 1. SUPABASE_URL: From Settings -> API -> Project URL (e.g., https://xxxxx.supabase.co)
-- 2. SUPABASE_ANON_KEY: From Settings -> API -> anon public key
-- 3. Replace the placeholders below with your actual values

-- Schedule the edge function to run every minute
-- Note: Replace YOUR_PROJECT_REF with your Supabase project reference ID
-- You can find this in your Supabase dashboard URL or project settings

SELECT cron.schedule(
  'send-scheduled-emails',
  '* * * * *', -- Every minute (cron syntax: minute hour day month weekday)
  $$
  SELECT
    net.http_post(
      url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-scheduled-emails',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer YOUR_SUPABASE_ANON_KEY'
      )
    ) AS request_id;
  $$
);

-- To verify the job was created:
-- SELECT * FROM cron.job WHERE jobname = 'send-scheduled-emails';

-- To unschedule the job (if needed):
-- SELECT cron.unschedule('send-scheduled-emails');

-- To view job execution history:
-- SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'send-scheduled-emails') ORDER BY start_time DESC LIMIT 10;
